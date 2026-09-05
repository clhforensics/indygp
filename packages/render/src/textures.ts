
/* =============================================================================
   LAYER 5 - ADVANCED PROCEDURAL TEXTURES - INDYGP-PBR-V1Every surface is still generated with canvas at load time: zero image files,
   zero network dependencies. What changed in Phase 1 is that each surface now
   emits a full material set instead of one colour map:

     map           albedo, sRGB encoded
     roughnessMap  linear grey
     metalnessMap  linear grey            (glass and metal surfaces only)
     emissiveMap   sRGB                   (facades only)
     normalMap     linear, Sobel-filtered from a procedural height field

   Every painter builds a numeric height field alongside its colour, and a 3x3
   Sobel operator converts that field into a tangent-space normal map. Sign
   convention: with flipY on a CanvasTexture, texture V rises as the image row
   falls, so the green channel carries +dHeight/dImageY. That is the OpenGL
   tangent-space convention Three.js expects.
   ========================================================================== */

import * as THREE from 'three';
import { QUALITY } from './quality';

export interface MapSet {
  map: THREE.Texture;
  roughnessMap: THREE.Texture;
  normalMap: THREE.Texture;
  metalnessMap: THREE.Texture | null;
  emissiveMap: THREE.Texture | null;
}

export interface TextureDeps { tick: (msg?: string) => void }

/* -------------------------------------------------------------- primitives - */

function clampf(v: number, a: number, b: number): number { return v < a ? a : (v > b ? b : v); }
function mix(a: number, b: number, t: number): number { return a + (b - a) * t; }
function smoothstep(t: number): number { return t * t * (3 - 2 * t); }

/* Deterministic PRNG. The prototype hash01 is fine for coarse decisions but
   streaks visibly when used as per-pixel grain, so surface noise uses this. */
function makeRng(seed: number) {
  let s = (seed * 1831565813) >>> 0;
  return function next(): number {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ctx2d(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('2D canvas is unavailable in this browser');
  return { c: c, g: g };
}

/* Tileable value noise: the lattice wraps on both axes so every map is seamless
   no matter which axis the mesh repeats on. */
function valueNoise(w: number, h: number, cx: number, cy: number, seed: number): Float32Array {
  cx = Math.max(1, Math.round(cx));
  cy = Math.max(1, Math.round(cy));
  const rng = makeRng(seed);
  const lat = new Float32Array(cx * cy);
  for (let i = 0; i < lat.length; i++) lat[i] = rng();
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = (y / h) * cy;
    const y0 = Math.floor(fy);
    const ty = smoothstep(fy - y0);
    const ya = ((y0 % cy) + cy) % cy;
    const yb = (ya + 1) % cy;
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * cx;
      const x0 = Math.floor(fx);
      const tx = smoothstep(fx - x0);
      const xa = ((x0 % cx) + cx) % cx;
      const xb = (xa + 1) % cx;
      const top = mix(lat[ya * cx + xa], lat[ya * cx + xb], tx);
      const bot = mix(lat[yb * cx + xa], lat[yb * cx + xb], tx);
      out[y * w + x] = mix(top, bot, ty);
    }
  }
  return out;
}

function fbm(w: number, h: number, cells: number, oct: number, gain: number, seed: number): Float32Array {
  const out = new Float32Array(w * h);
  let amp = 1, norm = 0;
  let cx = cells, cy = Math.max(1, Math.round(cells * (h / w)));
  for (let o = 0; o < oct; o++) {
    const layer = valueNoise(w, h, cx, cy, seed + o * 977);
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * amp;
    norm += amp; amp *= gain; cx *= 2; cy *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function grain(w: number, h: number, seed: number): Float32Array {
  const rng = makeRng(seed);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = rng();
  return out;
}

/* Rasterise a 2D painter and read back its red channel as a 0..1 mask. Used to
   stamp geometric detail (paint, joints, patches) into the numeric buffers. */
function maskFrom(w: number, h: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void): Float32Array {
  const made = ctx2d(w, h);
  made.g.fillStyle = '#000';
  made.g.fillRect(0, 0, w, h);
  paint(made.g, w, h);
  const px = made.g.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = px[i * 4] / 255;
  return out;
}

/* ------------------------------------------------------------- buffer pack - */

interface Buffers {
  w: number; h: number;
  col: Float32Array; rgh: Float32Array; mtl: Float32Array;
  emi: Float32Array; hgt: Float32Array;
  useMtl: boolean; useEmi: boolean;
}

function buffers(w: number, h: number): Buffers {
  return {
    w: w, h: h,
    col: new Float32Array(w * h * 3),
    rgh: new Float32Array(w * h),
    mtl: new Float32Array(w * h),
    emi: new Float32Array(w * h * 3),
    hgt: new Float32Array(w * h),
    useMtl: false, useEmi: false
  };
}

function setCol(b: Buffers, i: number, r: number, g: number, bl: number): void {
  b.col[i * 3] = r; b.col[i * 3 + 1] = g; b.col[i * 3 + 2] = bl;
}
function setEmi(b: Buffers, i: number, r: number, g: number, bl: number): void {
  b.emi[i * 3] = r; b.emi[i * 3 + 1] = g; b.emi[i * 3 + 2] = bl;
}

function texFrom(canvas: HTMLCanvasElement, repX: boolean, repY: boolean, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = repX ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.wrapT = repY ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  /* Every generated map is power-of-two, so a full mip chain is available.
     Being explicit here matters: a minified facade sampled without mips
     aliases into shimmering noise and thrashes the texture cache, which is
     far more expensive than the mip memory it saves. */
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  /* Baseline anisotropy. Grazing-angle surfaces override this per material
     in world.ts via MatOpts.aniso; everything else stays cheap. */
  t.anisotropy = QUALITY.tex.anisotropy;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function rgbCanvas(src: Float32Array, w: number, h: number): HTMLCanvasElement {
  const made = ctx2d(w, h);
  const img = made.g.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < w * h; i++) {
    d[i * 4]     = Math.round(clampf(src[i * 3], 0, 1) * 255);
    d[i * 4 + 1] = Math.round(clampf(src[i * 3 + 1], 0, 1) * 255);
    d[i * 4 + 2] = Math.round(clampf(src[i * 3 + 2], 0, 1) * 255);
    d[i * 4 + 3] = 255;
  }
  made.g.putImageData(img, 0, 0);
  return made.c;
}

function greyCanvas(src: Float32Array, w: number, h: number): HTMLCanvasElement {
  const made = ctx2d(w, h);
  const img = made.g.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < w * h; i++) {
    const v = Math.round(clampf(src[i], 0, 1) * 255);
    d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  made.g.putImageData(img, 0, 0);
  return made.c;
}

/* 3x3 Sobel over the height field, wrapping on both axes so tiling stays seamless. */
function normalCanvas(hgt: Float32Array, w: number, h: number, strength: number): HTMLCanvasElement {
  const made = ctx2d(w, h);
  const img = made.g.createImageData(w, h);
  const d = img.data;
  const at = function (x: number, y: number): number {
    const xi = ((x % w) + w) % w;
    const yi = ((y % h) + h) % h;
    return hgt[yi * w + xi];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = at(x - 1, y - 1), tc = at(x, y - 1), tr = at(x + 1, y - 1);
      const ml = at(x - 1, y),                        mr = at(x + 1, y);
      const bl = at(x - 1, y + 1), bc = at(x, y + 1), br = at(x + 1, y + 1);
      const dx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
      const dy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
      let nx = -dx * strength, ny = dy * strength, nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx *= inv; ny *= inv; nz *= inv;
      const o = (y * w + x) * 4;
      d[o]     = Math.round((nx * 0.5 + 0.5) * 255);
      d[o + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      d[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      d[o + 3] = 255;
    }
  }
  made.g.putImageData(img, 0, 0);
  return made.c;
}

function packMaps(b: Buffers, repX: boolean, repY: boolean, strength: number): MapSet {
  return {
    map: texFrom(rgbCanvas(b.col, b.w, b.h), repX, repY, true),
    roughnessMap: texFrom(greyCanvas(b.rgh, b.w, b.h), repX, repY, false),
    normalMap: texFrom(normalCanvas(b.hgt, b.w, b.h, strength), repX, repY, false),
    metalnessMap: b.useMtl ? texFrom(greyCanvas(b.mtl, b.w, b.h), repX, repY, false) : null,
    emissiveMap: b.useEmi ? texFrom(rgbCanvas(b.emi, b.w, b.h), repX, repY, true) : null
  };
}

/* ================================================================= ASPHALT = */
/* U runs across the carriageway (no repeat), V along the lap, repeating every
   8 m. Everything drawn here therefore has to tile in V. */
function buildAsphalt(): MapSet {
  const W = QUALITY.tex.road.w, H = QUALITY.tex.road.h;
  const b = buffers(W, H);

  const aggregate = fbm(W, H, 30, 4, 0.55, 1103);
  const undulate  = fbm(W, H, 5, 3, 0.52, 4507);
  const speck     = grain(W, H, 3181);
  const paintWear = fbm(W, H, 14, 3, 0.5, 8821);
  const patchWear = fbm(W, H, 9, 3, 0.5, 6607);

  /* Dark resurfacing patches. Each blob is drawn three times so it survives the
     V wrap intact instead of being clipped at the seam. */
  const patchMask = maskFrom(W, H, function (g, w, h) {
    const rng = makeRng(20507);
    g.fillStyle = '#fff';
    for (let p = 0; p < 6; p++) {
      const cx = rng() * w, cy = rng() * h;
      const pw = 26 + rng() * 74, ph = 34 + rng() * 120;
      for (let dup = -1; dup <= 1; dup++) {
        g.save();
        g.translate(cx, cy + dup * h);
        g.beginPath();
        const steps = 22;
        for (let s = 0; s <= steps; s++) {
          const a = (s / steps) * Math.PI * 2;
          const rag = 0.76 + 0.34 * rng();
          const px = Math.cos(a) * pw * 0.5 * rag;
          const py = Math.sin(a) * ph * 0.5 * rag;
          if (s === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.closePath(); g.fill(); g.restore();
      }
    }
  });

  /* Two solid edge lines plus a dashed centre line. The dash cycle divides H
     exactly so the marking tiles cleanly along the lap. */
  const paintMask = maskFrom(W, H, function (g, w, h) {
    g.fillStyle = '#fff';
    const edge = Math.max(3, Math.round(w * 0.031));
    g.fillRect(Math.round(w * 0.023), 0, edge, h);
    g.fillRect(w - Math.round(w * 0.023) - edge, 0, edge, h);
    const dashOn = Math.round(h * 0.33);
    const cycle = Math.round(h * 0.5);
    const cw = Math.max(3, Math.round(w * 0.024));
    for (let y = 0; y < h; y += cycle) g.fillRect(Math.round(w * 0.5 - cw * 0.5), y, cw, dashOn);
  });

  const band = function (u: number, centre: number, width: number): number {
    const t = (u - centre) / width;
    return Math.exp(-t * t);
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = x / W;
      const agg = aggregate[i], sp = speck[i], und = undulate[i];

      /* R2 (reference-matched): real sunlit street asphalt is LIGHT grey, not
         black. Base lifted 0.135 -> 0.34 with stronger large-scale tonal
         drift (patching, wear) per the IndyCar street-circuit reference. */
      let lum = 0.34 + agg * 0.09 + (sp - 0.5) * 0.075 + (und - 0.5) * 0.14;
      let rgh = 0.97 - agg * 0.04 + (sp - 0.5) * 0.030;
      let hgt = agg * 0.70 + sp * 0.26 + und * 0.38;

      /* Long asphalt repair seams: sparse dark bands crossing the full width
         on the V axis, like the tar-and-repair lines in reference photos. */
      const seamBucket = Math.floor(y / (H * 0.25));
      const seamPhase = ((makeRng(seamBucket * 37 + 11)() > 0.55) ? 1 : 0);
      const seam = Math.exp(-Math.pow((y % (H * 0.25)) / (H * 0.004), 2)) * seamPhase;
      lum *= 1 - seam * 0.34;
      hgt -= seam * 0.2;

      /* Two rubbered wheel paths: the classic dark twin lines. Visible but
         soft-edged against the lighter base. */
      const wear = Math.max(band(u, 0.315, 0.105), band(u, 0.685, 0.105));
      lum *= 1 - 0.30 * wear;
      hgt -= 0.11 * wear;

      /* Dusty, marble-strewn margins outside the used line. */
      const margin = clampf((Math.abs(u - 0.5) - 0.345) / 0.115, 0, 1);
      lum += 0.048 * margin * (0.45 + agg * 0.55);
      rgh += 0.055 * margin;
      hgt += 0.10 * margin * sp;

      /* Resurfacing patch: fresher, darker, tighter aggregate, sits proud. */
      const patch = patchMask[i] * clampf(patchWear[i] * 1.5, 0, 1);
      if (patch > 0.01) {
        lum = mix(lum, 0.082 + agg * 0.045, patch);
        rgh = mix(rgh, 0.79 - agg * 0.05, patch);
        hgt = mix(hgt, 0.55 + agg * 0.25, patch) + patch * 0.22;
      }

      /* Weathered thermoplastic paint sitting on top of the aggregate. */
      const paint = paintMask[i] * clampf(0.35 + paintWear[i] * 1.15, 0, 1);
      if (paint > 0.01) {
        lum = mix(lum, 0.74 - sp * 0.08, paint * 0.94);
        rgh = mix(rgh, 0.58 + sp * 0.06, paint);
        hgt += 0.16 * paint;
      }

      setCol(b, i, lum * 0.96, lum * 0.995, lum * 1.06);
      b.rgh[i] = clampf(rgh, 0.55, 1);
      b.hgt[i] = hgt;
    }
  }
  return packMaps(b, false, true, QUALITY.normalScale.road * 1.6);
}

/* =============================================================== CROSSWALK = */
/* Applied as a decal plane at each corner approach. U across the street. */
function buildCrosswalk(): MapSet {
  const W = QUALITY.tex.crosswalk.w, H = QUALITY.tex.crosswalk.h;
  const b = buffers(W, H);
  const agg = fbm(W, H, 26, 4, 0.55, 5153);
  const sp = grain(W, H, 2711);
  const wear = fbm(W, H, 10, 3, 0.5, 9403);

  const bars = maskFrom(W, H, function (g, w, h) {
    g.fillStyle = '#fff';
    const n = 7;
    const barW = w / (n * 2 - 1);
    for (let k = 0; k < n; k++) g.fillRect(k * barW * 2, h * 0.06, barW, h * 0.88);
  });

  for (let i = 0; i < W * H; i++) {
    let lum = 0.105 + agg[i] * 0.075 + (sp[i] - 0.5) * 0.05;
    let rgh = 0.90 - agg[i] * 0.10;
    let hgt = agg[i] * 0.7 + sp[i] * 0.25;

    /* Tyres scrub the paint away unevenly; wear drives both alpha and grime. */
    const paint = bars[i] * clampf(0.28 + wear[i] * 1.25, 0, 1);
    if (paint > 0.01) {
      lum = mix(lum, 0.70 - sp[i] * 0.10, paint * 0.95);
      rgh = mix(rgh, 0.60 + sp[i] * 0.07, paint);
      hgt += 0.18 * paint;
    }
    setCol(b, i, lum * 0.985, lum, lum * 1.06);
    b.rgh[i] = clampf(rgh, 0.05, 1);
    b.hgt[i] = hgt;
  }
  return packMaps(b, false, false, QUALITY.normalScale.crosswalk * 1.5);
}

/* ============================================================== KERBSTONES = */
function buildKerb(): MapSet {
  const W = QUALITY.tex.kerb.w, H = QUALITY.tex.kerb.h;
  const b = buffers(W, H);
  const gr = fbm(W, H, 12, 3, 0.5, 3313);
  const sp = grain(W, H, 7717);

  for (let y = 0; y < H; y++) {
    const red = (y % H) < H * 0.5;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = x / W;
      const n = gr[i] * 0.6 + sp[i] * 0.4;

      let r: number, g: number, bl: number;
      /* Sun-faded paint: the R1 sun + exposure blow the original saturated
         red out to toy-plastic. Chalkier base, greyer shadow joint. */
      if (red) { r = 0.52 + n * 0.10; g = 0.185 + n * 0.055; bl = 0.155 + n * 0.045; }
      else     { r = 0.80 + n * 0.09; g = 0.785 + n * 0.09; bl = 0.745 + n * 0.09; }

      /* Tyre scuffing concentrates on the inner lip, where cars ride the kerb. */
      const scuff = clampf(1 - u / 0.28, 0, 1) * (0.35 + sp[i] * 0.4);
      r *= 1 - scuff * 0.34; g *= 1 - scuff * 0.30; bl *= 1 - scuff * 0.26;

      const dy = Math.min(y % (H * 0.5), (H * 0.5) - (y % (H * 0.5)));
      const joint = clampf(1 - dy / 2.5, 0, 1);
      r *= 1 - joint * 0.45; g *= 1 - joint * 0.45; bl *= 1 - joint * 0.45;

      setCol(b, i, r, g, bl);
      b.rgh[i] = clampf(0.62 + n * 0.22 - scuff * 0.10 + joint * 0.2, 0.05, 1);
      b.hgt[i] = n * 0.5 + u * 0.35 - joint * 0.85;
    }
  }
  return packMaps(b, false, true, QUALITY.normalScale.kerb * 1.4);
}

/* ========================================================= TRACK BARRIERS = */
/* The wall ribbon maps U to height (0 ground, 1 cap) and V along the wall,
   repeating every 6 m, so the two painted panels work out at 3 m each. */
function buildBarrier(): MapSet {
  const W = QUALITY.tex.barrier.w, H = QUALITY.tex.barrier.h;
  const b = buffers(W, H);
  const conc = fbm(W, H, 16, 4, 0.55, 5501);
  const sp = grain(W, H, 9091);
  const grime = fbm(W, H, 7, 3, 0.5, 1237);
  const chipNoise = fbm(W, H, 26, 3, 0.5, 4409);

  const chipMask = maskFrom(W, H, function (g, w, h) {
    const rng = makeRng(31337);
    g.fillStyle = '#fff';
    for (let c = 0; c < 26; c++) {
      const cx = rng() * w, cy = rng() * h;
      const rx = 1.2 + rng() * 3.4, ry = 1.2 + rng() * 5.2;
      for (let dup = -1; dup <= 1; dup++) {
        g.beginPath();
        g.ellipse(cx, cy + dup * h, rx, ry, rng() * Math.PI, 0, Math.PI * 2);
        g.fill();
      }
    }
  });

  for (let y = 0; y < H; y++) {
    const panelRed = (y % H) < H * 0.5;
    const dy = Math.min(y % (H * 0.5), (H * 0.5) - (y % (H * 0.5)));
    const panelJoint = clampf(1 - dy / 3.0, 0, 1);

    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = x / W;
      const n = conc[i] * 0.65 + sp[i] * 0.35;

      /* Bare concrete underneath everything. */
      let r = 0.70 + n * 0.14, g = 0.695 + n * 0.14, bl = 0.665 + n * 0.14;
      let rgh = 0.90 - n * 0.10;
      let hgt = n * 0.55;

      /* Paint covers the middle band; the plinth and the cap stay bare concrete. */
      const painted = clampf((u - 0.085) / 0.06, 0, 1) * clampf((0.915 - u) / 0.055, 0, 1);
      const chipped = clampf(chipMask[i] + (chipNoise[i] - 0.72) * 2.2, 0, 1);
      const cover = painted * (1 - chipped);
      if (cover > 0.01) {
        const pr = panelRed ? 0.60 : 0.885;
        const pg = panelRed ? 0.185 : 0.875;
        const pb = panelRed ? 0.135 : 0.845;
        r = mix(r, pr * (0.93 + n * 0.14), cover);
        g = mix(g, pg * (0.93 + n * 0.14), cover);
        bl = mix(bl, pb * (0.93 + n * 0.14), cover);
        rgh = mix(rgh, 0.52 + n * 0.14, cover);
        hgt += cover * 0.12;
      }

      /* Road grime climbing the plinth, rubber scuff at bumper height. */
      const dirt = clampf(1 - u / 0.24, 0, 1) * (0.45 + grime[i] * 0.55);
      const scuff = Math.exp(-Math.pow((u - 0.46) / 0.13, 2)) * clampf(grime[i] * 1.4 - 0.35, 0, 1);
      const soil = clampf(dirt * 0.8 + scuff * 0.7, 0, 1);
      r *= 1 - soil * 0.46; g *= 1 - soil * 0.48; bl *= 1 - soil * 0.50;
      rgh = clampf(rgh + soil * 0.18, 0.05, 1);

      /* Recessed joints between panels, chamfer under the cap. */
      r *= 1 - panelJoint * 0.42; g *= 1 - panelJoint * 0.42; bl *= 1 - panelJoint * 0.42;
      hgt -= panelJoint * 0.95;
      hgt += clampf((u - 0.93) / 0.05, 0, 1) * 0.35;

      setCol(b, i, r, g, bl);
      b.rgh[i] = clampf(rgh, 0.05, 1);
      b.hgt[i] = hgt - chipped * 0.5;
    }
  }
  return packMaps(b, false, true, QUALITY.normalScale.barrier * 1.5);
}

/* ======================================================== INDIANA LIMESTONE */
function buildLimestone(): MapSet {
  const W = QUALITY.tex.limestone.w, H = QUALITY.tex.limestone.h;
  const b = buffers(W, H);
  const granule = fbm(W, H, 40, 4, 0.55, 2207);
  const sp = grain(W, H, 6151);
  const blotch = fbm(W, H, 6, 3, 0.5, 8443);
  const streakNoise = fbm(W, H, 24, 3, 0.55, 1493);

  const COLS = 2, ROWS = 4;
  const bw = W / COLS, bh = H / ROWS;
  const rng = makeRng(70707);
  const tintOf: number[] = [];
  for (let k = 0; k < COLS * ROWS; k++) tintOf.push(rng());

  /* Weathering streaks bleed downward from the joints where water runs off. */
  const streakMask = maskFrom(W, H, function (g, w, h) {
    const r2 = makeRng(4242);
    for (let s = 0; s < 22; s++) {
      const x = r2() * w;
      const y0 = Math.floor(r2() * ROWS) * (h / ROWS);
      const len = (0.25 + r2() * 0.6) * (h / ROWS);
      const wid = 1.5 + r2() * 6;
      const grad = g.createLinearGradient(0, y0, 0, y0 + len);
      grad.addColorStop(0, 'rgba(255,255,255,0.85)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      for (let dup = -1; dup <= 1; dup++) g.fillRect(x - wid * 0.5 + dup * w, y0, wid, len);
    }
  });

  for (let y = 0; y < H; y++) {
    const row = Math.floor(y / bh);
    const dyj = Math.min(y % bh, bh - (y % bh));
    /* Alternate courses shift half a block, like real ashlar coursing. */
    const shift = (row % 2) ? bw * 0.5 : 0;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const xs = (x + shift) % W;
      const col = Math.floor(xs / bw);
      const dxj = Math.min(xs % bw, bw - (xs % bw));
      const joint = clampf(1 - Math.min(dxj, dyj) / 2.6, 0, 1);
      const tint = tintOf[(row % ROWS) * COLS + (col % COLS)];

      const gr = granule[i] * 0.55 + sp[i] * 0.45;
      const base = 0.795 + (tint - 0.5) * 0.055 + (blotch[i] - 0.5) * 0.05 + (gr - 0.5) * 0.085;
      let r = base, g = base * 0.968, bl = base * 0.892;
      let rgh = 0.70 + gr * 0.18;

      const streak = streakMask[i] * clampf(streakNoise[i] * 1.3, 0, 1);
      r *= 1 - streak * 0.30; g *= 1 - streak * 0.31; bl *= 1 - streak * 0.28;
      rgh += streak * 0.16;

      r *= 1 - joint * 0.30; g *= 1 - joint * 0.30; bl *= 1 - joint * 0.29;

      const domeX = 1 - Math.pow(((xs % bw) / bw - 0.5) * 2, 2);
      const domeY = 1 - Math.pow(((y % bh) / bh - 0.5) * 2, 2);

      setCol(b, i, r, g, bl);
      b.rgh[i] = clampf(rgh + joint * 0.14, 0.05, 1);
      b.hgt[i] = gr * 0.45 + domeX * domeY * 0.20 - joint * 1.05;
    }
  }
  return packMaps(b, true, true, QUALITY.normalScale.limestone * 1.5);
}

/* =========================================================== GLASS FACADES = */
interface FacadeStyle {
  cols: number; rows: number; mullion: number;
  glass: number[]; spandrel: number[];
  litChance: number; spandrelBand: number; seed: number;
}

const FACADE_STYLES: FacadeStyle[] = [
  /* 0 - Circle towers: tight curtain wall, mostly glass, cool blue */
  { cols: 8, rows: 10, mullion: 2, glass: [0.115, 0.150, 0.190], spandrel: [0.215, 0.230, 0.250], litChance: 0.34, spandrelBand: 0.14, seed: 611 },
  /* 1 - mid-rise office: punched windows in a warm stone frame */
  { cols: 6, rows: 7,  mullion: 5, glass: [0.095, 0.115, 0.145], spandrel: [0.400, 0.372, 0.330], litChance: 0.30, spandrelBand: 0.30, seed: 977 },
  /* 2 - older masonry block: small deep-set openings */
  { cols: 5, rows: 6,  mullion: 7, glass: [0.080, 0.090, 0.112], spandrel: [0.330, 0.278, 0.238], litChance: 0.24, spandrelBand: 0.36, seed: 1523 },
  /* 3 - low commercial: wide ribbon glazing, dark metal */
  { cols: 4, rows: 5,  mullion: 4, glass: [0.130, 0.160, 0.182], spandrel: [0.175, 0.180, 0.190], litChance: 0.42, spandrelBand: 0.22, seed: 2129 }
];

function buildFacade(styleIndex: number): MapSet {
  const st = FACADE_STYLES[styleIndex % FACADE_STYLES.length];
  const W = QUALITY.tex.facade.w, H = QUALITY.tex.facade.h;
  const b = buffers(W, H);
  b.useMtl = true;
  b.useEmi = true;

  const dirt = fbm(W, H, 8, 3, 0.5, st.seed);
  const sp = grain(W, H, st.seed + 313);
  const streak = fbm(W, H, 30, 3, 0.55, st.seed + 727);

  const cw = W / st.cols, ch = H / st.rows;
  const rng = makeRng(st.seed);

  /* Per-window interior state. "depth" fakes how far into the room the light
     falls: a shallow value means a bright pane near the glass, a deep value a
     dim glow well back from it. That variation is what stops a lit grid from
     reading as a flat checkerboard. */
  const cells = st.cols * st.rows;
  const lit = new Uint8Array(cells);
  const warmth = new Float32Array(cells);
  const depth = new Float32Array(cells);
  const blindDrop = new Float32Array(cells);
  for (let k = 0; k < cells; k++) {
    lit[k] = rng() < st.litChance ? 1 : 0;
    warmth[k] = rng();
    depth[k] = 0.28 + rng() * 0.72;
    blindDrop[k] = rng() < 0.32 ? 0.25 + rng() * 0.45 : 0;
  }

  for (let y = 0; y < H; y++) {
    const rowIdx = Math.floor(y / ch);
    const inRow = (y % ch) / ch;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const colIdx = Math.floor(x / cw);
      const inCol = (x % cw) / cw;
      const k = rowIdx * st.cols + colIdx;

      const mx = Math.min(x % cw, cw - (x % cw));
      const my = Math.min(y % ch, ch - (y % ch));
      const frame = (mx < st.mullion || my < st.mullion) ? 1 : 0;
      const spandrel = inRow > (1 - st.spandrelBand) ? 1 : 0;
      const isGlass = frame === 0 && spandrel === 0;

      let r: number, g: number, bl: number, rgh: number, mtl: number, hgt: number;
      let er = 0, eg = 0, eb = 0;

      if (isGlass) {
        /* Glass: dark albedo, low roughness, high metalness so the environment
           map supplies almost all of the visible colour. */
        r = st.glass[0]; g = st.glass[1]; bl = st.glass[2];
        rgh = 0.055 + sp[i] * 0.035 + dirt[i] * 0.05;
        mtl = 0.86;
        hgt = -0.55;

        if (lit[k]) {
          /* Light falls off with distance into the room, so the top of the pane
             (closer to the ceiling fixture) reads brighter than the sill. */
          const falloff = clampf(1 - inRow * depth[k] * 1.35, 0, 1);
          const blind = blindDrop[k] > 0 && inRow < blindDrop[k] ? 0.18 : 1;
          const gain = falloff * blind * (0.55 + 0.45 * (1 - depth[k]));
          const warm = warmth[k];
          er = gain * (0.98 + warm * 0.02);
          eg = gain * (0.80 + warm * 0.16);
          eb = gain * (0.55 + warm * 0.34);
          rgh += 0.02;
        }
      } else if (spandrel === 1 && frame === 0) {
        /* Opaque spandrel panel below each window. */
        r = st.spandrel[0]; g = st.spandrel[1]; bl = st.spandrel[2];
        rgh = 0.60 + sp[i] * 0.14;
        mtl = 0.18;
        hgt = 0.25;
      } else {
        /* Mullion / structural frame, proud of the glass line. */
        r = st.spandrel[0] * 0.78; g = st.spandrel[1] * 0.78; bl = st.spandrel[2] * 0.80;
        rgh = 0.45 + sp[i] * 0.12;
        mtl = 0.55;
        hgt = 0.9;
      }

      /* Airborne grime collects on the frames and streaks down the glass. */
      const soil = clampf(dirt[i] * 0.7 + streak[i] * 0.4 - 0.25, 0, 1);
      const soilAmt = isGlass ? soil * 0.28 : soil * 0.5;
      r *= 1 - soilAmt * 0.35; g *= 1 - soilAmt * 0.36; bl *= 1 - soilAmt * 0.34;
      rgh = clampf(rgh + soilAmt * 0.22, 0.03, 1);

      setCol(b, i, r, g, bl);
      setEmi(b, i, er, eg, eb);
      b.rgh[i] = rgh;
      b.mtl[i] = mtl;
      b.hgt[i] = hgt + sp[i] * 0.08;
    }
  }
  return packMaps(b, true, true, QUALITY.normalScale.facade * 1.2);
}

/* ==================================================================== ROOF = */
function buildRoof(): MapSet {
  const W = QUALITY.tex.roof.w, H = QUALITY.tex.roof.h;
  const b = buffers(W, H);
  const gv = fbm(W, H, 18, 4, 0.55, 3701);
  const sp = grain(W, H, 8123);
  const seam = maskFrom(W, H, function (g, w, h) {
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    for (let k = 1; k < 4; k++) {
      g.beginPath(); g.moveTo(0, (k / 4) * h); g.lineTo(w, (k / 4) * h); g.stroke();
      g.beginPath(); g.moveTo((k / 4) * w, 0); g.lineTo((k / 4) * w, h); g.stroke();
    }
  });
  for (let i = 0; i < W * H; i++) {
    const n = gv[i] * 0.6 + sp[i] * 0.4;
    const base = 0.135 + n * 0.075;
    const s = seam[i];
    setCol(b, i, base * (1 - s * 0.3), base * (1 - s * 0.3), base * 1.05 * (1 - s * 0.3));
    b.rgh[i] = clampf(0.88 - n * 0.12 + s * 0.06, 0.05, 1);
    b.hgt[i] = n * 0.6 - s * 0.7;
  }
  return packMaps(b, true, true, QUALITY.normalScale.ground * 1.3);
}

/* ============================================================ CITY GROUND = */
function buildGround(): MapSet {
  const W = QUALITY.tex.ground.w, H = QUALITY.tex.ground.h;
  const b = buffers(W, H);
  const gv = fbm(W, H, 22, 4, 0.55, 4111);
  const sp = grain(W, H, 5279);
  const slabs = maskFrom(W, H, function (g, w, h) {
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.strokeRect(0, 0, w, h);
    g.beginPath();
    g.moveTo(w / 2, 0); g.lineTo(w / 2, h);
    g.moveTo(0, h / 2); g.lineTo(w, h / 2);
    g.stroke();
  });
  for (let i = 0; i < W * H; i++) {
    const n = gv[i] * 0.6 + sp[i] * 0.4;
    const base = 0.108 + n * 0.062;
    const j = slabs[i];
    setCol(b, i, base * (1 - j * 0.28), base * (1 - j * 0.28) * 1.01, base * 1.06 * (1 - j * 0.28));
    b.rgh[i] = clampf(0.90 - n * 0.10 + j * 0.05, 0.05, 1);
    b.hgt[i] = n * 0.55 - j * 0.8;
  }
  return packMaps(b, true, true, QUALITY.normalScale.ground * 1.3);
}

/* ================================================== THE YARD OF BRICKS ==== */
function buildBricks(): MapSet {
  const W = QUALITY.tex.bricks.w, H = QUALITY.tex.bricks.h;
  const b = buffers(W, H);
  const gv = fbm(W, H, 24, 4, 0.55, 6733);
  const sp = grain(W, H, 4931);
  const bw = 32, bh = 16;

  for (let y = 0; y < H; y++) {
    const row = Math.floor(y / bh);
    const shift = (row % 2) ? bw * 0.5 : 0;
    const dyj = Math.min(y % bh, bh - (y % bh));
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const xs = (x + shift) % W;
      const dxj = Math.min(xs % bw, bw - (xs % bw));
      const joint = clampf(1 - Math.min(dxj, dyj) / 2.0, 0, 1);
      const n = gv[i] * 0.6 + sp[i] * 0.4;
      const tone = 0.78 + (n - 0.5) * 0.42;

      let r = 0.395 * tone, g = 0.176 * tone, bl = 0.128 * tone;
      /* Mortar between the bricks is pale and rough. */
      r = mix(r, 0.52 + n * 0.08, joint * 0.85);
      g = mix(g, 0.50 + n * 0.08, joint * 0.85);
      bl = mix(bl, 0.47 + n * 0.08, joint * 0.85);

      setCol(b, i, r, g, bl);
      b.rgh[i] = clampf(0.74 + n * 0.14 + joint * 0.1, 0.05, 1);
      const domeX = 1 - Math.pow(((xs % bw) / bw - 0.5) * 2, 2);
      const domeY = 1 - Math.pow(((y % bh) / bh - 0.5) * 2, 2);
      b.hgt[i] = n * 0.35 + domeX * domeY * 0.5 - joint * 1.1;
    }
  }
  return packMaps(b, true, true, QUALITY.normalScale.bricks * 1.6);
}

/* ==================================================== LANDMARK TEXTURES ==
   INDYGP-LANDMARKS-V1

   Ten map sets built for the Washington & Meridian corridor, driven directly
   from the reference photography. They use exactly the same buffers / Sobel
   pipeline as the generic surfaces above, so albedo, roughness, metalness,
   emissive and normal all stay consistent under the same sun.
   ========================================================================= */

/* Recessed window opening shared by the two masonry facade builders. Returns
   0 outside the opening, 1 deep inside it, with a soft reveal at the edge. */
function windowMask(inBayX: number, inFloorY: number,
                    x0: number, x1: number, y0: number, y1: number): number {
  if (inBayX < x0 || inBayX > x1 || inFloorY < y0 || inFloorY > y1) return 0;
  const ex = Math.min(inBayX - x0, x1 - inBayX) / 0.05;
  const ey = Math.min(inFloorY - y0, y1 - inFloorY) / 0.05;
  return clampf(Math.min(ex, ey), 0, 1);
}

/* --- 1. Merchants National Bank shaft: aged dark red masonry ---------------
   One tile is four bays wide by four floors tall. The piers stand proud, the
   spandrels sit back, and the brick coursing runs across both. */
function buildBankBrick(): MapSet {
  const W = 256, H = 256;
  const b = buffers(W, H);
  b.useMtl = true;
  b.useEmi = true;

  const coarse = fbm(W, H, 10, 3, 0.5, 9311);
  const sp = grain(W, H, 4177);
  const soot = fbm(W, H, 5, 3, 0.55, 2683);
  const BRW = 16, BRH = 8;
  const BAYS = 4, FLOORS = 4;
  const bayW = W / BAYS, floorH = H / FLOORS;

  const rng = makeRng(8087);
  const litCell = new Uint8Array(BAYS * FLOORS);
  const litWarm = new Float32Array(BAYS * FLOORS);
  const litDepth = new Float32Array(BAYS * FLOORS);
  for (let k = 0; k < litCell.length; k++) {
    litCell[k] = rng() < 0.26 ? 1 : 0;
    litWarm[k] = rng();
    litDepth[k] = 0.35 + rng() * 0.6;
  }

  for (let y = 0; y < H; y++) {
    const floorIdx = Math.floor(y / floorH);
    const inFloor = (y % floorH) / floorH;
    const brickRow = Math.floor(y / BRH);
    const shift = (brickRow % 2) ? BRW * 0.5 : 0;
    const dyj = Math.min(y % BRH, BRH - (y % BRH));

    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const bayIdx = Math.floor(x / bayW);
      const inBay = (x % bayW) / bayW;
      const xs = (x + shift) % W;
      const dxj = Math.min(xs % BRW, BRW - (xs % BRW));
      const joint = clampf(1 - Math.min(dxj, dyj) / 1.6, 0, 1);
      const n = coarse[i] * 0.55 + sp[i] * 0.45;
      const k = floorIdx * BAYS + bayIdx;

      /* Piers straddle the bay boundary; the window sits in the middle. */
      const edge = Math.min(inBay, 1 - inBay);
      const pier = clampf(1 - edge / 0.17, 0, 1);
      const win = windowMask(inBay, inFloor, 0.28, 0.72, 0.14, 0.74);

      /* Aged red masonry: iron-spotted, unevenly fired. */
      let r = 0.268 + n * 0.128;
      let g = 0.112 + n * 0.062;
      let bl = 0.088 + n * 0.050;
      let rgh = 0.86 - n * 0.10;
      let mtl = 0.02;
      let hgt = 0.42 + n * 0.30 + pier * 0.55 - joint * 0.85;
      let er = 0, eg = 0, eb = 0;

      /* Pale mortar. */
      r = mix(r, 0.44 + n * 0.10, joint * 0.8);
      g = mix(g, 0.42 + n * 0.10, joint * 0.8);
      bl = mix(bl, 0.39 + n * 0.10, joint * 0.8);
      rgh = mix(rgh, 0.92, joint * 0.6);

      if (win > 0.01) {
        /* Deep-set sash: dark glass, a stone sill, and interior light. */
        const glassR = 0.072, glassG = 0.086, glassB = 0.108;
        r = mix(r, glassR, win);
        g = mix(g, glassG, win);
        bl = mix(bl, glassB, win);
        rgh = mix(rgh, 0.075 + sp[i] * 0.03, win);
        mtl = mix(mtl, 0.82, win);
        hgt = mix(hgt, -0.95, win);
        if (litCell[k]) {
          const falloff = clampf(1 - (inFloor - 0.14) / 0.60 * litDepth[k] * 1.3, 0, 1);
          const gain = falloff * win * (0.5 + 0.5 * (1 - litDepth[k]));
          er = gain * 0.99;
          eg = gain * (0.76 + litWarm[k] * 0.18);
          eb = gain * (0.48 + litWarm[k] * 0.32);
        }
        /* Limestone sill under every opening. */
        const sill = (inFloor > 0.74 && inFloor < 0.80) ? 1 : 0;
        if (sill) {
          r = mix(r, 0.70, 0.9); g = mix(g, 0.67, 0.9); bl = mix(bl, 0.60, 0.9);
          rgh = 0.72; mtl = 0.02; hgt = 0.85;
        }
      }

      /* A century of soot, heaviest under the sills and in the reveals. */
      const dirt = clampf(soot[i] * 1.25 - 0.35, 0, 1) * (0.4 + 0.6 * (1 - pier));
      r *= 1 - dirt * 0.30; g *= 1 - dirt * 0.31; bl *= 1 - dirt * 0.30;

      setCol(b, i, r, g, bl);
      setEmi(b, i, er, eg, eb);
      b.rgh[i] = clampf(rgh + dirt * 0.10, 0.04, 1);
      b.mtl[i] = mtl;
      b.hgt[i] = hgt;
    }
  }
  return packMaps(b, true, true, 1.15);
}

/* --- 2. Pale limestone pier facade (Dept of Health, SE corner block) ------- */
function buildLimestonePier(): MapSet {
  const W = 256, H = 256;
  const b = buffers(W, H);
  b.useMtl = true;
  b.useEmi = true;

  const granule = fbm(W, H, 34, 4, 0.55, 5119);
  const sp = grain(W, H, 7307);
  const streak = fbm(W, H, 22, 3, 0.55, 1861);
  const BAYS = 4, FLOORS = 4;
  const bayW = W / BAYS, floorH = H / FLOORS;

  const rng = makeRng(6421);
  const litCell = new Uint8Array(BAYS * FLOORS);
  const litWarm = new Float32Array(BAYS * FLOORS);
  for (let k = 0; k < litCell.length; k++) {
    litCell[k] = rng() < 0.22 ? 1 : 0;
    litWarm[k] = rng();
  }

  for (let y = 0; y < H; y++) {
    const floorIdx = Math.floor(y / floorH);
    const inFloor = (y % floorH) / floorH;
    const courseJ = clampf(1 - Math.min(y % floorH, floorH - (y % floorH)) / 1.8, 0, 1);

    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const bayIdx = Math.floor(x / bayW);
      const inBay = (x % bayW) / bayW;
      const edge = Math.min(inBay, 1 - inBay);
      const pier = clampf(1 - edge / 0.20, 0, 1);
      const win = windowMask(inBay, inFloor, 0.30, 0.70, 0.16, 0.76);
      const gr = granule[i] * 0.55 + sp[i] * 0.45;
      const k = floorIdx * BAYS + bayIdx;

      /* Cream Indiana limestone, slightly warmer on the piers where the rain
         does not wash it. */
      const base = 0.760 + (gr - 0.5) * 0.075 + pier * 0.028;
      let r = base, g = base * 0.968, bl = base * 0.888;
      let rgh = 0.70 + gr * 0.16;
      let mtl = 0.02;
      let hgt = gr * 0.35 + pier * 0.60 - courseJ * 0.55;
      let er = 0, eg = 0, eb = 0;

      if (win > 0.01) {
        r = mix(r, 0.085, win); g = mix(g, 0.098, win); bl = mix(bl, 0.122, win);
        rgh = mix(rgh, 0.08 + sp[i] * 0.03, win);
        mtl = mix(mtl, 0.84, win);
        hgt = mix(hgt, -0.90, win);
        if (litCell[k]) {
          const gain = clampf(1 - (inFloor - 0.16) / 0.6, 0, 1) * win * 0.75;
          er = gain * 0.98;
          eg = gain * (0.82 + litWarm[k] * 0.14);
          eb = gain * (0.58 + litWarm[k] * 0.30);
        }
      }

      /* Vertical weathering, exactly the dark runoff visible in the photographs. */
      const soil = clampf(streak[i] * 1.35 - 0.42, 0, 1) * (1 - win);
      r *= 1 - soil * 0.24; g *= 1 - soil * 0.25; bl *= 1 - soil * 0.23;

      setCol(b, i, r, g, bl);
      setEmi(b, i, er, eg, eb);
      b.rgh[i] = clampf(rgh + soil * 0.14 + courseJ * 0.08, 0.04, 1);
      b.mtl[i] = mtl;
      b.hgt[i] = hgt;
    }
  }
  return packMaps(b, true, true, 1.1);
}

/* --- 3. Rusticated limestone base: deep horizontal channels ---------------- */
function buildRustication(): MapSet {
  const W = 256, H = 128;
  const b = buffers(W, H);
  const granule = fbm(W, H, 28, 4, 0.55, 3739);
  const sp = grain(W, H, 8263);
  const COURSES = 4, PER = 3;
  const ch = H / COURSES, cwid = W / PER;

  for (let y = 0; y < H; y++) {
    const row = Math.floor(y / ch);
    const dyj = Math.min(y % ch, ch - (y % ch));
    const shift = (row % 2) ? cwid * 0.5 : 0;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const xs = (x + shift) % W;
      const dxj = Math.min(xs % cwid, cwid - (xs % cwid));
      /* Horizontal channels are cut far deeper than the vertical ones. */
      const chanH = clampf(1 - dyj / 3.4, 0, 1);
      const chanV = clampf(1 - dxj / 2.0, 0, 1);
      const gr = granule[i] * 0.55 + sp[i] * 0.45;
      const base = 0.745 + (gr - 0.5) * 0.09;

      /* Each block is very slightly pillowed, the way tooled ashlar is. */
      const domeX = 1 - Math.pow(((xs % cwid) / cwid - 0.5) * 2, 2);
      const domeY = 1 - Math.pow(((y % ch) / ch - 0.5) * 2, 2);
      const shade = 1 - chanH * 0.34 - chanV * 0.22;

      setCol(b, i, base * shade, base * 0.966 * shade, base * 0.884 * shade);
      b.rgh[i] = clampf(0.74 + gr * 0.16 + chanH * 0.10, 0.05, 1);
      b.hgt[i] = gr * 0.30 + domeX * domeY * 0.40 - chanH * 1.30 - chanV * 0.70;
    }
  }
  return packMaps(b, true, true, 1.6);
}

/* --- 4. Classical cornice: dentils, modillions and fascia ------------------ */
function buildDentil(): MapSet {
  const W = 128, H = 64;
  const b = buffers(W, H);
  const gr = fbm(W, H, 16, 3, 0.5, 2477);
  const sp = grain(W, H, 9587);
  const DENTILS = 16, dw = W / DENTILS;

  for (let y = 0; y < H; y++) {
    const v = y / H;    // 0 = top of the band
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const n = gr[i] * 0.6 + sp[i] * 0.4;
      const base = 0.775 + (n - 0.5) * 0.075;
      let hgt = n * 0.25;

      /* Reading down the band: cyma, corona, dentil course, then bed mould. */
      if (v < 0.22) hgt += 0.9 - v * 1.4;
      else if (v < 0.42) hgt += 1.05;
      else if (v < 0.72) {
        const inD = (x % dw) / dw;
        const tooth = (inD > 0.28 && inD < 0.78) ? 1 : 0;
        hgt += tooth ? 0.95 : -0.55;
      } else hgt += 0.35 + (1 - v) * 0.5;

      const ao = clampf(1 - Math.abs(v - 0.58) / 0.16, 0, 1) * 0.30;
      const shade = 1 - ao;
      setCol(b, i, base * shade, base * 0.966 * shade, base * 0.884 * shade);
      b.rgh[i] = clampf(0.74 + n * 0.14 + ao * 0.1, 0.05, 1);
      b.hgt[i] = hgt;
    }
  }
  return packMaps(b, true, true, 1.7);
}

/* --- 5/6. Ground-floor retail shopfront with a fabric awning ---------------
   Reads top to bottom: awning, sign fascia, transom, glazing, kickplate.
   Awning colour is the only difference between the two variants: blue over
   the T-Mobile frontage on the west side, maroon over Jimmy John's east. */
function buildShopfront(awning: number[], seed: number): MapSet {
  const W = 256, H = 128;
  const b = buffers(W, H);
  b.useMtl = true;
  b.useEmi = true;

  const cloth = fbm(W, H, 40, 3, 0.5, seed);
  const sp = grain(W, H, seed + 411);
  const dust = fbm(W, H, 9, 3, 0.5, seed + 823);
  const BAYS = 6, bayW = W / BAYS;

  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const inBay = (x % bayW) / bayW;
      const mull = clampf(1 - Math.min(inBay, 1 - inBay) / 0.07, 0, 1);
      const n = sp[i];

      let r: number, g: number, bl: number, rgh: number, mtl: number, hgt: number;
      let er = 0, eg = 0, eb = 0;

      if (v < 0.155) {
        /* Awning: ribbed canvas, matte, projecting. */
        const rib = 0.5 + 0.5 * Math.cos((x / bayW) * Math.PI * 2);
        const shade = 0.82 + rib * 0.22 + (cloth[i] - 0.5) * 0.10;
        r = awning[0] * shade; g = awning[1] * shade; bl = awning[2] * shade;
        rgh = 0.88; mtl = 0.0;
        hgt = 1.15 + rib * 0.25;
      } else if (v < 0.265) {
        /* Sign fascia: dark board with a lit legend. */
        r = 0.062; g = 0.068; bl = 0.076;
        rgh = 0.48; mtl = 0.30; hgt = 0.55;
        const letters = (inBay > 0.18 && inBay < 0.82 && v > 0.185 && v < 0.238) ? 1 : 0;
        if (letters) { er = 0.92; eg = 0.86; eb = 0.74; }
      } else if (v < 0.335) {
        /* Transom light above the display glass. */
        r = 0.10; g = 0.11; bl = 0.125;
        rgh = 0.07; mtl = 0.80; hgt = -0.35;
        er = 0.34; eg = 0.30; eb = 0.24;
      } else if (v < 0.885) {
        /* Display glazing: bright interior, strong reflections. */
        r = 0.098; g = 0.108; bl = 0.126;
        rgh = 0.055 + n * 0.02; mtl = 0.88; hgt = -0.55;
        const depth = clampf(1 - (v - 0.335) / 0.55, 0, 1);
        const glow = 0.30 + depth * 0.55;
        er = glow * 0.96; eg = glow * 0.90; eb = glow * 0.80;
      } else {
        /* Granite kickplate at the pavement. */
        r = 0.115 + n * 0.035; g = 0.088 + n * 0.030; bl = 0.082 + n * 0.028;
        rgh = 0.30; mtl = 0.12; hgt = 0.25;
      }

      /* Anodised mullions between the bays, in front of everything. */
      if (v > 0.265) {
        r = mix(r, 0.075, mull); g = mix(g, 0.079, mull); bl = mix(bl, 0.085, mull);
        rgh = mix(rgh, 0.34, mull); mtl = mix(mtl, 0.72, mull);
        hgt = mix(hgt, 0.85, mull);
        er *= 1 - mull; eg *= 1 - mull; eb *= 1 - mull;
      }

      const soil = clampf(dust[i] * 1.2 - 0.45, 0, 1);
      r *= 1 - soil * 0.18; g *= 1 - soil * 0.18; bl *= 1 - soil * 0.17;

      setCol(b, i, r, g, bl);
      setEmi(b, i, er, eg, eb);
      b.rgh[i] = clampf(rgh, 0.03, 1);
      b.mtl[i] = mtl;
      b.hgt[i] = hgt;
    }
  }
  return packMaps(b, true, false, 1.2);
}

/* --- 7. Red brick pavers: the corner plazas and the Circle carriageway ----- */
function buildPlazaBrick(): MapSet {
  const W = 128, H = 128;
  const b = buffers(W, H);
  const gv = fbm(W, H, 20, 4, 0.55, 4643);
  const sp = grain(W, H, 1237);
  const wear = fbm(W, H, 6, 3, 0.5, 7919);
  const BW = 24, BH = 12;

  for (let y = 0; y < H; y++) {
    const row = Math.floor(y / BH);
    const shift = (row % 2) ? BW * 0.5 : 0;
    const dyj = Math.min(y % BH, BH - (y % BH));
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const xs = (x + shift) % W;
      const dxj = Math.min(xs % BW, BW - (xs % BW));
      const joint = clampf(1 - Math.min(dxj, dyj) / 1.7, 0, 1);
      const n = gv[i] * 0.55 + sp[i] * 0.45;
      /* Pavers are fired unevenly: some run brown, some almost orange. */
      const tone = 0.72 + (n - 0.5) * 0.55;

      let r = 0.415 * tone, g = 0.196 * tone, bl = 0.148 * tone;
      r = mix(r, 0.40 + n * 0.09, joint * 0.82);
      g = mix(g, 0.375 + n * 0.09, joint * 0.82);
      bl = mix(bl, 0.345 + n * 0.09, joint * 0.82);

      /* Foot traffic polishes the crowns of the pavers. */
      const polish = clampf(wear[i] * 1.4 - 0.5, 0, 1) * (1 - joint);
      const domeX = 1 - Math.pow(((xs % BW) / BW - 0.5) * 2, 2);
      const domeY = 1 - Math.pow(((y % BH) / BH - 0.5) * 2, 2);

      setCol(b, i, r, g, bl);
      b.rgh[i] = clampf(0.82 + n * 0.12 - polish * 0.26 + joint * 0.06, 0.06, 1);
      b.hgt[i] = n * 0.28 + domeX * domeY * 0.55 - joint * 1.20;
    }
  }
  return packMaps(b, true, true, 1.5);
}

/* --- 8. Monument limestone: tight vertical drafted joints ------------------ */
function buildMonumentStone(): MapSet {
  const W = 256, H = 256;
  const b = buffers(W, H);
  const granule = fbm(W, H, 44, 4, 0.55, 6197);
  const sp = grain(W, H, 3457);
  const streak = fbm(W, H, 30, 3, 0.55, 8971);
  const COURSES = 8, PER = 4;
  const ch = H / COURSES, cwid = W / PER;

  for (let y = 0; y < H; y++) {
    const row = Math.floor(y / ch);
    const dyj = Math.min(y % ch, ch - (y % ch));
    const shift = (row % 2) ? cwid * 0.5 : 0;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const xs = (x + shift) % W;
      const dxj = Math.min(xs % cwid, cwid - (xs % cwid));
      const joint = clampf(1 - Math.min(dxj, dyj) / 1.5, 0, 1);
      const gr = granule[i] * 0.5 + sp[i] * 0.5;
      /* Brighter and cleaner than the general city limestone: the Monument is
         washed, and it reads almost white against the sky in the photographs. */
      const base = 0.845 + (gr - 0.5) * 0.062;
      let r = base, g = base * 0.974, bl = base * 0.918;
      let rgh = 0.62 + gr * 0.16;

      const soil = clampf(streak[i] * 1.25 - 0.55, 0, 1);
      r *= 1 - soil * 0.16; g *= 1 - soil * 0.17; bl *= 1 - soil * 0.15;
      r *= 1 - joint * 0.20; g *= 1 - joint * 0.20; bl *= 1 - joint * 0.19;

      setCol(b, i, r, g, bl);
      b.rgh[i] = clampf(rgh + joint * 0.10 + soil * 0.10, 0.05, 1);
      b.hgt[i] = gr * 0.30 - joint * 0.80;
    }
  }
  return packMaps(b, true, true, 1.2);
}

/* --- 9. Bronze with verdigris: the cascades and the sculpture groups ------- */
function buildBronze(): MapSet {
  const W = 128, H = 128;
  const b = buffers(W, H);
  const patina = fbm(W, H, 9, 4, 0.55, 5843);
  const fine = fbm(W, H, 32, 3, 0.5, 2311);
  const sp = grain(W, H, 6089);

  for (let i = 0; i < W * H; i++) {
    const p = clampf(patina[i] * 1.35 - 0.30, 0, 1);
    const n = fine[i] * 0.6 + sp[i] * 0.4;
    /* Dark cast bronze under a green-blue carbonate bloom. */
    const br = 0.118 + n * 0.062, bg = 0.082 + n * 0.048, bb = 0.052 + n * 0.032;
    const vr = 0.155 + n * 0.05, vg = 0.288 + n * 0.06, vb = 0.238 + n * 0.05;
    setCol(b, i, mix(br, vr, p), mix(bg, vg, p), mix(bb, vb, p));
    /* Where the patina has taken hold the metal stops behaving like metal. */
    b.rgh[i] = clampf(mix(0.32, 0.78, p) + (n - 0.5) * 0.10, 0.05, 1);
    b.mtl[i] = mix(0.94, 0.22, p);
    b.hgt[i] = n * 0.45 + p * 0.25;
  }
  b.useMtl = true;
  return packMaps(b, true, true, 1.1);
}

/* --- 10. Turn 1 intersection: saw-cut utility patches over old asphalt -----
   Clamped, not tiled: one 46 m square laid over the junction. Everything in
   the reference photograph is here except the paint, which is applied as
   separate decals so the striping can be positioned per approach. */
function buildIntersection(): MapSet {
  const W = 512, H = 512;
  const b = buffers(W, H);

  const aggregate = fbm(W, H, 48, 4, 0.55, 1409);
  const speck = grain(W, H, 7127);
  const undulate = fbm(W, H, 7, 3, 0.52, 3167);
  const patchWear = fbm(W, H, 12, 3, 0.5, 9679);

  /* Rectangular saw cuts where the utilities have been opened and backfilled
     with concrete. Deliberately axis-aligned and slightly overlapping, which
     is what makes them read as municipal repairs rather than random noise. */
  const cuts = maskFrom(W, H, function (g, w, h) {
    const rng = makeRng(4271);
    g.fillStyle = '#fff';
    for (let k = 0; k < 14; k++) {
      const cw = 34 + rng() * 130;
      const chh = 26 + rng() * 96;
      const cx = rng() * (w - cw);
      const cy = rng() * (h - chh);
      g.fillRect(cx, cy, cw, chh);
    }
    /* Two long trench cuts crossing the junction. */
    g.fillRect(0, h * 0.42, w, 30);
    g.fillRect(w * 0.58, 0, 26, h);
  });

  /* The seam around each cut, where the joint sealant has been poured. */
  const seams = maskFrom(W, H, function (g, w, h) {
    const rng = makeRng(4271);
    g.strokeStyle = '#fff';
    g.lineWidth = 3;
    for (let k = 0; k < 14; k++) {
      const cw = 34 + rng() * 130;
      const chh = 26 + rng() * 96;
      const cx = rng() * (w - cw);
      const cy = rng() * (h - chh);
      g.strokeRect(cx, cy, cw, chh);
    }
    g.strokeRect(0, h * 0.42, w, 30);
    g.strokeRect(w * 0.58, 0, 26, h);
  });

  /* Manhole and valve covers, with a raised collar. */
  const covers = maskFrom(W, H, function (g, w, h) {
    const rng = makeRng(9133);
    for (let k = 0; k < 7; k++) {
      const cx = 40 + rng() * (w - 80);
      const cy = 40 + rng() * (h - 80);
      const rad = 9 + rng() * 13;
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#888';
      g.lineWidth = 3;
      g.beginPath(); g.arc(cx, cy, rad + 2.5, 0, Math.PI * 2); g.stroke();
    }
  });

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const agg = aggregate[i], sp = speck[i], und = undulate[i];

      let lum = 0.112 + agg * 0.082 + (sp - 0.5) * 0.055 + (und - 0.5) * 0.034;
      let rgh = 0.900 - agg * 0.100 + (sp - 0.5) * 0.048;
      let hgt = agg * 0.62 + sp * 0.24 + und * 0.42;
      let tintR = 0.985, tintG = 1.0, tintB = 1.07;

      /* Concrete backfill: much lighter, far greyer, and slightly sunken. */
      const cut = cuts[i] * clampf(patchWear[i] * 1.6, 0.35, 1);
      if (cut > 0.01) {
        lum = mix(lum, 0.268 + agg * 0.052, cut);
        rgh = mix(rgh, 0.845 - agg * 0.05, cut);
        hgt = mix(hgt, 0.34 + agg * 0.18, cut) - cut * 0.28;
        tintR = mix(tintR, 1.01, cut);
        tintB = mix(tintB, 0.99, cut);
      }

      /* Black sealant in the saw kerf. */
      const seam = seams[i];
      if (seam > 0.01) {
        lum = mix(lum, 0.052, seam);
        rgh = mix(rgh, 0.62, seam);
        hgt -= seam * 0.9;
      }

      /* Cast iron cover, sitting proud of its collar. */
      const cov = covers[i];
      if (cov > 0.01) {
        lum = mix(lum, 0.088 + sp * 0.05, cov);
        rgh = mix(rgh, 0.52 + sp * 0.10, cov);
        b.mtl[i] = cov * 0.55;
        hgt = mix(hgt, 0.95, cov);
      }

      /* Polished tyre paths where traffic turns through the junction. */
      const u = x / W, v = y / H;
      const polish = Math.exp(-Math.pow((v - 0.5) / 0.30, 2)) *
                     Math.exp(-Math.pow((u - 0.5) / 0.34, 2));
      lum *= 1 - 0.16 * polish;
      rgh -= 0.16 * polish;

      setCol(b, i, lum * tintR, lum * tintG, lum * tintB);
      b.rgh[i] = clampf(rgh, 0.04, 1);
      b.hgt[i] = hgt;
    }
  }
  b.useMtl = true;
  return packMaps(b, false, false, 1.45);
}

/* ================================================ PENNSYLVANIA ST SECTOR ==
   INDYGP-PENN-V1

   Eight map sets for the corridor between Turn 4 and Turn 5, driven from the
   reference photography: the Union Station railway underpass, the Gainbridge
   Fieldhouse elevations, and the dark commercial brick that lines the west
   side of the straight. Same buffers / Sobel pipeline as everything above, so
   they light identically under the same sun.
   ========================================================================= */

/* --- 1. Aged structural concrete: deck fascia, abutments, parapets ---------
   Photo 1 reads as cast-in-place concrete with horizontal form-board lines,
   long dark runoff streaks below the deck edge, orange rust bleed where the
   reinforcement has started to go, and pale efflorescence blooms. */
function buildBridgeConcrete(): MapSet {
  const W = 256, H = 256;
  const b = buffers(W, H);

  const coarse = fbm(W, H, 12, 4, 0.55, 7213);
  const fine = fbm(W, H, 46, 3, 0.5, 3319);
  const sp = grain(W, H, 8623);
  const stainNoise = fbm(W, H, 20, 3, 0.55, 1063);
  const BOARD = 21;

  /* Runoff streaks hanging from the top of the panel. */
  const streaks = maskFrom(W, H, function (g, w, h) {
    const rng = makeRng(5171);
    for (let s = 0; s < 26; s++) {
      const x = rng() * w;
      const len = (0.25 + rng() * 0.65) * h;
      const wid = 2 + rng() * 9;
      const grad = g.createLinearGradient(0, 0, 0, len);
      grad.addColorStop(0, 'rgba(255,255,255,0.9)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      for (let dup = -1; dup <= 1; dup++) g.fillRect(x - wid * 0.5 + dup * w, 0, wid, len);
    }
  });

  /* Rust bleed: short rusty tails under discrete corrosion points. */
  const rust = maskFrom(W, H, function (g, w, h) {
    const rng = makeRng(9377);
    for (let s = 0; s < 12; s++) {
      const x = rng() * w;
      const y = rng() * h * 0.8;
      const len = 14 + rng() * 46;
      const wid = 2 + rng() * 5;
      const grad = g.createLinearGradient(0, y, 0, y + len);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      for (let dup = -1; dup <= 1; dup++) g.fillRect(x - wid * 0.5 + dup * w, y, wid, len);
    }
  });

  /* Spalled patches where the face has broken away to the aggregate. */
  const spall = maskFrom(W, H, function (g, w, h) {
    const rng = makeRng(2447);
    g.fillStyle = '#fff';
    for (let s = 0; s < 9; s++) {
      const cx = rng() * w, cy = rng() * h;
      const rx = 4 + rng() * 15, ry = 4 + rng() * 12;
      for (let dup = -1; dup <= 1; dup++) {
        g.beginPath();
        const steps = 14;
        for (let k = 0; k <= steps; k++) {
          const a = (k / steps) * Math.PI * 2;
          const rag = 0.65 + rng() * 0.5;
          const px = cx + dup * w + Math.cos(a) * rx * rag;
          const py = cy + Math.sin(a) * ry * rag;
          if (k === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.closePath(); g.fill();
      }
    }
  });

  for (let y = 0; y < H; y++) {
    const dBoard = Math.min(y % BOARD, BOARD - (y % BOARD));
    const seam = clampf(1 - dBoard / 1.5, 0, 1);
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const n = coarse[i] * 0.45 + fine[i] * 0.32 + sp[i] * 0.23;

      let r = 0.545 + n * 0.145;
      let g = 0.542 + n * 0.145;
      let bl = 0.524 + n * 0.142;
      let rgh = 0.90 - n * 0.10;
      let hgt = n * 0.48 - seam * 0.75;

      /* Efflorescence: pale, chalky, slightly rougher. */
      const bloom = clampf(stainNoise[i] * 1.5 - 0.85, 0, 1);
      r = mix(r, 0.755, bloom); g = mix(g, 0.752, bloom); bl = mix(bl, 0.735, bloom);
      rgh = mix(rgh, 0.96, bloom);

      /* Dark runoff. */
      const soil = streaks[i] * clampf(stainNoise[i] * 1.4 - 0.18, 0, 1);
      r *= 1 - soil * 0.40; g *= 1 - soil * 0.41; bl *= 1 - soil * 0.39;

      /* Rust bleed, applied after the soot so it stays legible. */
      const rb = rust[i] * clampf(fine[i] * 1.3, 0.3, 1);
      r = mix(r, 0.372, rb * 0.85);
      g = mix(g, 0.168, rb * 0.85);
      bl = mix(bl, 0.086, rb * 0.85);
      rgh = mix(rgh, 0.94, rb);

      /* Spall: exposed aggregate, darker and much rougher, set back. */
      const sc = spall[i];
      if (sc > 0.01) {
        r = mix(r, 0.352 + fine[i] * 0.16, sc);
        g = mix(g, 0.340 + fine[i] * 0.16, sc);
        bl = mix(bl, 0.322 + fine[i] * 0.15, sc);
        rgh = mix(rgh, 0.98, sc);
        hgt -= sc * 0.85;
      }

      setCol(b, i, r, g, bl);
      b.rgh[i] = clampf(rgh, 0.06, 1);
      b.hgt[i] = hgt;
    }
  }
  return packMaps(b, true, true, 1.35);
}

/* --- 2. Retaining wall concrete: the same material, much filthier ----------
   U runs bottom to top of the wall so the grime gradient is driven directly by
   height, which is how it reads in photo 1: black at the kerb, fading out by
   about two thirds of the way up. */
function buildTunnelWall(): MapSet {
  const W = 128, H = 256;
  const b = buffers(W, H);

  const panel = fbm(W, H, 14, 4, 0.55, 4409);
  const fine = fbm(W, H, 40, 3, 0.5, 6737);
  const sp = grain(W, H, 1949);
  const grime = fbm(W, H, 9, 3, 0.55, 8117);
  const PANEL_W = 42;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const u = 1 - (y / H);                 // 0 at the kerb, 1 at the coping
      const dPanel = Math.min(x % PANEL_W, PANEL_W - (x % PANEL_W));
      const joint = clampf(1 - dPanel / 1.8, 0, 1);
      const n = panel[i] * 0.42 + fine[i] * 0.34 + sp[i] * 0.24;

      let r = 0.500 + n * 0.140;
      let g = 0.497 + n * 0.140;
      let bl = 0.482 + n * 0.138;
      let rgh = 0.92 - n * 0.09;
      let hgt = n * 0.42 - joint * 0.90;

      /* Road spray and exhaust soot climbing the wall. */
      const dirt = clampf(1 - u / 0.62, 0, 1) * (0.42 + grime[i] * 0.58);
      r *= 1 - dirt * 0.60; g *= 1 - dirt * 0.62; bl *= 1 - dirt * 0.62;

      /* Rubber scuff band at bumper height. */
      const scuff = Math.exp(-Math.pow((u - 0.11) / 0.055, 2)) *
                    clampf(grime[i] * 1.5 - 0.30, 0, 1);
      r *= 1 - scuff * 0.55; g *= 1 - scuff * 0.57; bl *= 1 - scuff * 0.57;

      /* Coping stone along the very top. */
      const cope = clampf((u - 0.945) / 0.03, 0, 1);
      r = mix(r, 0.615 + n * 0.09, cope);
      g = mix(g, 0.610 + n * 0.09, cope);
      bl = mix(bl, 0.588 + n * 0.09, cope);
      hgt += cope * 0.65;

      setCol(b, i, r, g, bl);
      b.rgh[i] = clampf(rgh + dirt * 0.05, 0.06, 1);
      b.hgt[i] = hgt;
    }
  }
  return packMaps(b, false, true, 1.3);
}

/* --- 3. Weathered riveted steel: the plate girders ------------------------- */
function buildRustedSteel(): MapSet {
  const W = 128, H = 128;
  const b = buffers(W, H);
  b.useMtl = true;

  const scale = fbm(W, H, 11, 4, 0.55, 3167);
  const pit = fbm(W, H, 44, 3, 0.5, 7691);
  const sp = grain(W, H, 5443);
  const paint = fbm(W, H, 7, 3, 0.55, 2131);

  /* Rivet heads on a regular grid: raised, and they hold their paint longer
     than the flat plate around them. */
  const rivets = maskFrom(W, H, function (g, w, h) {
    g.fillStyle = '#fff';
    const step = 16;
    for (let y = step / 2; y < h; y += step) {
      for (let x = step / 2; x < w; x += step) {
        g.beginPath(); g.arc(x, y, 3.1, 0, Math.PI * 2); g.fill();
      }
    }
  });

  for (let i = 0; i < W * H; i++) {
    const n = scale[i] * 0.5 + pit[i] * 0.3 + sp[i] * 0.2;
    const riv = rivets[i];

    /* Corroded base: orange-brown, rough, and no longer behaving as metal. */
    let r = 0.348 + n * 0.185;
    let g = 0.166 + n * 0.108;
    let bl = 0.092 + n * 0.062;
    let rgh = 0.90 - n * 0.14;
    let mtl = 0.24;

    /* Surviving paint: dark blue-grey, smoother, properly metallic. */
    const held = clampf(paint[i] * 1.55 - 0.52, 0, 1) * (0.55 + riv * 0.45);
    r = mix(r, 0.128 + n * 0.05, held);
    g = mix(g, 0.146 + n * 0.05, held);
    bl = mix(bl, 0.158 + n * 0.05, held);
    rgh = mix(rgh, 0.46 + n * 0.10, held);
    mtl = mix(mtl, 0.86, held);

    setCol(b, i, r, g, bl);
    b.rgh[i] = clampf(rgh, 0.06, 1);
    b.mtl[i] = mtl;
    b.hgt[i] = n * 0.42 + riv * 0.95 - clampf(pit[i] * 1.4 - 0.9, 0, 1) * 0.5;
  }
  return packMaps(b, true, true, 1.45);
}

/* --- 4. Deck soffit: the tunnel ceiling, with transverse beam coffers ------ */
function buildDeckSoffit(): MapSet {
  const W = 128, H = 128;
  const b = buffers(W, H);
  const gv = fbm(W, H, 16, 4, 0.55, 6299);
  const sp = grain(W, H, 4093);
  const grime = fbm(W, H, 6, 3, 0.55, 1523);
  const BEAM = 32;

  for (let y = 0; y < H; y++) {
    const inBeam = (y % BEAM) / BEAM;
    /* A shallow rib every 32 px, with the bay between it set back. */
    const rib = (inBeam < 0.22) ? 1 : 0;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const n = gv[i] * 0.6 + sp[i] * 0.4;

      /* Deliberately dark: this face never sees the sun, and in photo 1 the
         soffit is the blackest thing in the frame. */
      let base = 0.255 + n * 0.105;
      const soot = clampf(grime[i] * 1.4 - 0.25, 0, 1);
      base *= 1 - soot * 0.42;

      const shade = rib ? 1.10 : 0.86;
      setCol(b, i, base * shade, base * shade * 0.995, base * shade * 0.965);
      b.rgh[i] = clampf(0.94 - n * 0.08, 0.08, 1);
      b.hgt[i] = n * 0.35 + (rib ? 0.95 : -0.35);
    }
  }
  return packMaps(b, true, true, 1.4);
}

/* --- 5. Arena brick: warm red-orange with limestone string courses ---------
   Larger format than the Merchants Bank brick and considerably cleaner: the
   Fieldhouse dates from 1999, not 1912. */
function buildArenaBrick(): MapSet {
  const W = 256, H = 256;
  const b = buffers(W, H);
  const coarse = fbm(W, H, 9, 3, 0.5, 8837);
  const sp = grain(W, H, 2687);
  const dust = fbm(W, H, 6, 3, 0.55, 4231);
  const BRW = 20, BRH = 9;
  const BAND_EVERY = 64;

  for (let y = 0; y < H; y++) {
    const row = Math.floor(y / BRH);
    const shift = (row % 2) ? BRW * 0.5 : 0;
    const dyj = Math.min(y % BRH, BRH - (y % BRH));
    /* Limestone string course punctuating the brick every few metres. */
    const inBand = (y % BAND_EVERY) < 9;
    const bandEdge = clampf(1 - Math.min(y % BAND_EVERY, 9 - (y % BAND_EVERY)) / 1.4, 0, 1);

    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const xs = (x + shift) % W;
      const dxj = Math.min(xs % BRW, BRW - (xs % BRW));
      const joint = clampf(1 - Math.min(dxj, dyj) / 1.5, 0, 1);
      const n = coarse[i] * 0.5 + sp[i] * 0.5;

      let r: number, g: number, bl: number, rgh: number, hgt: number;

      if (inBand) {
        /* Buff limestone band, proud of the brick face. */
        const base = 0.735 + (n - 0.5) * 0.075;
        r = base; g = base * 0.958; bl = base * 0.868;
        rgh = 0.74 + n * 0.14;
        hgt = 0.85 + n * 0.2 - bandEdge * 0.4;
      } else {
        /* Red-orange facing brick, unevenly fired. */
        const tone = 0.80 + (n - 0.5) * 0.44;
        r = 0.408 * tone; g = 0.178 * tone; bl = 0.132 * tone;
        r = mix(r, 0.455 + n * 0.09, joint * 0.80);
        g = mix(g, 0.428 + n * 0.09, joint * 0.80);
        bl = mix(bl, 0.398 + n * 0.09, joint * 0.80);
        rgh = 0.82 + n * 0.12 + joint * 0.06;
        const domeX = 1 - Math.pow(((xs % BRW) / BRW - 0.5) * 2, 2);
        const domeY = 1 - Math.pow(((y % BRH) / BRH - 0.5) * 2, 2);
        hgt = n * 0.30 + domeX * domeY * 0.45 - joint * 1.05;
      }

      const soil = clampf(dust[i] * 1.2 - 0.55, 0, 1);
      r *= 1 - soil * 0.16; g *= 1 - soil * 0.17; bl *= 1 - soil * 0.16;

      setCol(b, i, r, g, bl);
      b.rgh[i] = clampf(rgh + soil * 0.08, 0.06, 1);
      b.hgt[i] = hgt;
    }
  }
  return packMaps(b, true, true, 1.3);
}

/* --- 6. Arena curtain wall: dark tinted glass in a heavy mullion grid ------
   Photo 2 shows this reading almost black-teal in shade with hard specular
   returns off the sun, so the albedo goes very dark and metalness very high:
   the environment map supplies nearly all the visible colour. */
function buildArenaGlass(): MapSet {
  const W = 256, H = 256;
  const b = buffers(W, H);
  b.useMtl = true;
  b.useEmi = true;

  const dirt = fbm(W, H, 8, 3, 0.5, 3541);
  const sp = grain(W, H, 7433);
  const streak = fbm(W, H, 28, 3, 0.55, 6151);
  const COLS = 6, ROWS = 8;
  const cw = W / COLS, ch = H / ROWS;
  const MULL = 5;

  const rng = makeRng(9091);
  const cells = COLS * ROWS;
  const lit = new Uint8Array(cells);
  const depth = new Float32Array(cells);
  for (let k = 0; k < cells; k++) {
    lit[k] = rng() < 0.30 ? 1 : 0;
    depth[k] = 0.30 + rng() * 0.65;
  }

  for (let y = 0; y < H; y++) {
    const rowIdx = Math.floor(y / ch);
    const inRow = (y % ch) / ch;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const colIdx = Math.floor(x / cw);
      const k = rowIdx * COLS + colIdx;
      const mx = Math.min(x % cw, cw - (x % cw));
      const my = Math.min(y % ch, ch - (y % ch));
      const frame = (mx < MULL || my < MULL) ? 1 : 0;

      let r: number, g: number, bl: number, rgh: number, mtl: number, hgt: number;
      let er = 0, eg = 0, eb = 0;

      if (frame) {
        /* Dark anodised aluminium mullion, standing proud. */
        r = 0.088; g = 0.094; bl = 0.100;
        rgh = 0.40 + sp[i] * 0.10;
        mtl = 0.72;
        hgt = 0.95;
      } else {
        /* Tinted vision glass. */
        r = 0.052; g = 0.076; bl = 0.086;
        rgh = 0.045 + sp[i] * 0.025;
        mtl = 0.92;
        hgt = -0.65;
        if (lit[k]) {
          const falloff = clampf(1 - inRow * depth[k] * 1.25, 0, 1);
          const gain = falloff * (0.42 + 0.34 * (1 - depth[k]));
          er = gain * 0.86; eg = gain * 0.88; eb = gain * 0.82;
        }
      }

      const soil = clampf(dirt[i] * 0.65 + streak[i] * 0.45 - 0.35, 0, 1);
      const amt = frame ? soil * 0.45 : soil * 0.22;
      r *= 1 - amt * 0.34; g *= 1 - amt * 0.35; bl *= 1 - amt * 0.33;

      setCol(b, i, r, g, bl);
      setEmi(b, i, er, eg, eb);
      b.rgh[i] = clampf(rgh + amt * 0.18, 0.03, 1);
      b.mtl[i] = mtl;
      b.hgt[i] = hgt + sp[i] * 0.06;
    }
  }
  return packMaps(b, true, true, 1.15);
}

/* --- 7. Arena base: large smooth sandy-buff ashlar ------------------------- */
function buildArenaBase(): MapSet {
  const W = 256, H = 128;
  const b = buffers(W, H);
  const granule = fbm(W, H, 32, 4, 0.55, 1873);
  const sp = grain(W, H, 5867);
  const blotch = fbm(W, H, 5, 3, 0.5, 9209);
  const COLS = 3, ROWS = 3;
  const bw = W / COLS, bh = H / ROWS;

  for (let y = 0; y < H; y++) {
    const row = Math.floor(y / bh);
    const dyj = Math.min(y % bh, bh - (y % bh));
    const shift = (row % 2) ? bw * 0.5 : 0;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const xs = (x + shift) % W;
      const dxj = Math.min(xs % bw, bw - (xs % bw));
      const joint = clampf(1 - Math.min(dxj, dyj) / 2.2, 0, 1);
      const gr = granule[i] * 0.55 + sp[i] * 0.45;

      /* Sandier and warmer than the Monument stone. */
      const base = 0.735 + (gr - 0.5) * 0.070 + (blotch[i] - 0.5) * 0.042;
      let r = base * 1.0, g = base * 0.944, bl = base * 0.828;
      r *= 1 - joint * 0.26; g *= 1 - joint * 0.26; bl *= 1 - joint * 0.25;

      const domeX = 1 - Math.pow(((xs % bw) / bw - 0.5) * 2, 2);
      const domeY = 1 - Math.pow(((y % bh) / bh - 0.5) * 2, 2);

      setCol(b, i, r, g, bl);
      b.rgh[i] = clampf(0.70 + gr * 0.16 + joint * 0.10, 0.06, 1);
      b.hgt[i] = gr * 0.30 + domeX * domeY * 0.26 - joint * 0.95;
    }
  }
  return packMaps(b, true, true, 1.2);
}

/* --- 8. Dark commercial brick: the west side of the straight ---------------
   Photos 2 and 3: dark brown-maroon brick, a strictly uniform grid of punched
   openings with deep reveals, a stone sill under each, and a flat parapet. */
function buildCommercialBrick(): MapSet {
  const W = 256, H = 256;
  const b = buffers(W, H);
  b.useMtl = true;
  b.useEmi = true;

  const coarse = fbm(W, H, 8, 3, 0.5, 2909);
  const sp = grain(W, H, 6427);
  const soot = fbm(W, H, 6, 3, 0.55, 8291);
  const BRW = 17, BRH = 8;
  const BAYS = 4, FLOORS = 4;
  const bayW = W / BAYS, floorH = H / FLOORS;

  const rng = makeRng(3623);
  const cells = BAYS * FLOORS;
  const lit = new Uint8Array(cells);
  const warm = new Float32Array(cells);
  for (let k = 0; k < cells; k++) { lit[k] = rng() < 0.20 ? 1 : 0; warm[k] = rng(); }

  for (let y = 0; y < H; y++) {
    const floorIdx = Math.floor(y / floorH);
    const inFloor = (y % floorH) / floorH;
    const row = Math.floor(y / BRH);
    const shift = (row % 2) ? BRW * 0.5 : 0;
    const dyj = Math.min(y % BRH, BRH - (y % BRH));

    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const bayIdx = Math.floor(x / bayW);
      const inBay = (x % bayW) / bayW;
      const xs = (x + shift) % W;
      const dxj = Math.min(xs % BRW, BRW - (xs % BRW));
      const joint = clampf(1 - Math.min(dxj, dyj) / 1.5, 0, 1);
      const n = coarse[i] * 0.5 + sp[i] * 0.5;
      const k = floorIdx * BAYS + bayIdx;
      const win = windowMask(inBay, inFloor, 0.30, 0.70, 0.20, 0.70);

      /* Dark brown-maroon common brick. */
      let r = 0.198 + n * 0.098;
      let g = 0.108 + n * 0.058;
      let bl = 0.092 + n * 0.048;
      let rgh = 0.88 - n * 0.09;
      let mtl = 0.02;
      let hgt = 0.35 + n * 0.28 - joint * 0.85;
      let er = 0, eg = 0, eb = 0;

      r = mix(r, 0.318 + n * 0.08, joint * 0.75);
      g = mix(g, 0.296 + n * 0.08, joint * 0.75);
      bl = mix(bl, 0.278 + n * 0.08, joint * 0.75);

      if (win > 0.01) {
        r = mix(r, 0.066, win); g = mix(g, 0.076, win); bl = mix(bl, 0.094, win);
        rgh = mix(rgh, 0.075 + sp[i] * 0.025, win);
        mtl = mix(mtl, 0.84, win);
        hgt = mix(hgt, -1.0, win);
        if (lit[k]) {
          const gain = clampf(1 - (inFloor - 0.20) / 0.50, 0, 1) * win * 0.68;
          er = gain * 0.97;
          eg = gain * (0.80 + warm[k] * 0.16);
          eb = gain * (0.55 + warm[k] * 0.32);
        }
        /* Stone sill. */
        if (inFloor > 0.70 && inFloor < 0.755) {
          r = mix(r, 0.585, 0.9); g = mix(g, 0.560, 0.9); bl = mix(bl, 0.500, 0.9);
          rgh = 0.76; mtl = 0.02; hgt = 0.80;
        }
      }

      const dirt = clampf(soot[i] * 1.25 - 0.42, 0, 1);
      r *= 1 - dirt * 0.26; g *= 1 - dirt * 0.27; bl *= 1 - dirt * 0.26;

      setCol(b, i, r, g, bl);
      setEmi(b, i, er, eg, eb);
      b.rgh[i] = clampf(rgh + dirt * 0.08, 0.04, 1);
      b.mtl[i] = mtl;
      b.hgt[i] = hgt;
    }
  }
  return packMaps(b, true, true, 1.2);
}

export interface LandmarkTextures {
  bankBrick: MapSet;
  limestonePier: MapSet;
  rustication: MapSet;
  dentil: MapSet;
  shopBlue: MapSet;
  shopMaroon: MapSet;
  plazaBrick: MapSet;
  monumentStone: MapSet;
  bronze: MapSet;
  intersection: MapSet;
  bridgeConcrete: MapSet;
  tunnelWall: MapSet;
  rustedSteel: MapSet;
  deckSoffit: MapSet;
  arenaBrick: MapSet;
  arenaGlass: MapSet;
  arenaBase: MapSet;
  commercialBrick: MapSet;
}

export function buildLandmarkTextures(): LandmarkTextures {
  return {
    bankBrick: buildBankBrick(),
    limestonePier: buildLimestonePier(),
    rustication: buildRustication(),
    dentil: buildDentil(),
    shopBlue: buildShopfront([0.098, 0.212, 0.470], 5501),
    shopMaroon: buildShopfront([0.352, 0.078, 0.072], 7717),
    plazaBrick: buildPlazaBrick(),
    monumentStone: buildMonumentStone(),
    bronze: buildBronze(),
    intersection: buildIntersection(),
    bridgeConcrete: buildBridgeConcrete(),
    tunnelWall: buildTunnelWall(),
    rustedSteel: buildRustedSteel(),
    deckSoffit: buildDeckSoffit(),
    arenaBrick: buildArenaBrick(),
    arenaGlass: buildArenaGlass(),
    arenaBase: buildArenaBase(),
    commercialBrick: buildCommercialBrick()
  };
}

/* ============================================ UNLIT SIGNAGE (colour only) = */

const FONT_DISPLAY = "'Arial Narrow', 'Liberation Sans Narrow', Arial, sans-serif";
const FONT_DATA = "Consolas, 'Courier New', monospace";

export function canvasTex(
  w: number, h: number,
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  repX: boolean, repY: boolean
): THREE.CanvasTexture {
  const made = ctx2d(w, h);
  draw(made.g, w, h);
  return texFrom(made.c, repX, repY, true);
}

export function signTex(turn: number, street: string, dir: string): THREE.CanvasTexture {
  return canvasTex(256, 256, function (g, w, h) {
    g.fillStyle = '#0B0D10'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#FFB114'; g.lineWidth = 8; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#FFB114'; g.textAlign = 'center';
    g.font = '700 132px ' + FONT_DISPLAY;
    g.fillText('T' + turn, w / 2, 132);
    g.fillStyle = '#E8E2D5';
    g.font = '600 30px ' + FONT_DISPLAY;
    const words = street.split(' ');
    let line = '', y = 176;
    for (let i = 0; i < words.length; i++) {
      const test = line ? line + ' ' + words[i] : words[i];
      if (g.measureText(test).width > w - 36 && line) { g.fillText(line, w / 2, y); y += 32; line = words[i]; }
      else line = test;
    }
    g.fillText(line, w / 2, y);
    g.fillStyle = '#9E3B2A'; g.fillRect(w / 2 - 46, h - 42, 92, 26);
    g.fillStyle = '#E8E2D5';
    g.font = '600 18px ' + FONT_DATA;
    g.fillText(dir === 'L' ? 'LEFT' : 'RIGHT', w / 2, h - 23);
  }, false, false);
}

/* Vertical arena banner, hung on the corner facing the driver. Text is drawn
   rotated so the finished map can be mapped straight onto a tall plane
   without stretching the glyphs. */
export function arenaBannerTex(): THREE.CanvasTexture {
  return canvasTex(256, 1024, function (g, w, h) {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0.00, '#0E6B3A');
    grd.addColorStop(0.55, '#128A47');
    grd.addColorStop(1.00, '#0A5730');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.22)';
    g.lineWidth = 6;
    g.strokeRect(9, 9, w - 18, h - 18);
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate(-Math.PI / 2);
    g.textAlign = 'center';
    g.fillStyle = '#F2F6F3';
    g.font = '700 104px ' + FONT_DISPLAY;
    g.fillText('GAINBRIDGE', 0, -14);
    g.font = '600 56px ' + FONT_DISPLAY;
    g.fillStyle = 'rgba(242,246,243,.86)';
    g.fillText('FIELDHOUSE', 0, 52);
    g.restore();
  }, false, false);
}

function buildBanner(): THREE.CanvasTexture {
  return canvasTex(1024, 256, function (g, w, h) {
    g.fillStyle = '#0B0D10'; g.fillRect(0, 0, w, h);
    const sq = 32;
    for (let x = 0; x * sq < w; x++) {
      for (let y = 0; y < 2; y++) {
        g.fillStyle = ((x + y) % 2) ? '#E8E2D5' : '#14181E';
        g.fillRect(x * sq, y * sq, sq, sq);
        g.fillRect(x * sq, h - (y + 1) * sq, sq, sq);
      }
    }
    g.fillStyle = '#FFB114'; g.textAlign = 'center';
    g.font = '700 96px ' + FONT_DISPLAY;
    g.fillText('START / FINISH', w / 2, h / 2 + 34);
  }, false, false);
}

function buildSky(): THREE.CanvasTexture {
  /* R1 sky: deeper blue zenith for Indianapolis afternoon clarity, warm sun
     haze near the horizon. Blue channel stays believable in shadow fills. */
  return canvasTex(16, 512, function (g, w, h) {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0.00, '#1F3D66');
    grd.addColorStop(0.34, '#4E7CB0');
    grd.addColorStop(0.62, '#9FC0D8');
    grd.addColorStop(0.80, '#E8D3A8');
    grd.addColorStop(1.00, '#C9A277');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }, false, false);
}

/* ================================================================ FACTORY = */

export interface TextureLibrary extends LandmarkTextures {
  road: MapSet;
  crosswalk: MapSet;
  kerb: MapSet;
  wall: MapSet;
  limestone: MapSet;
  ground: MapSet;
  bricks: MapSet;
  roof: MapSet;
  facades: MapSet[];
  sky: THREE.CanvasTexture;
}

export function createTextures(deps: TextureDeps) {
  const tick = deps.tick;

  tick('Milling asphalt and kerbstones');
  const road = buildAsphalt();
  const crosswalk = buildCrosswalk();
  const kerb = buildKerb();

  tick('Pouring the concrete barriers');
  const wall = buildBarrier();
  const bricks = buildBricks();

  tick('Quarrying Indiana limestone');
  const limestone = buildLimestone();
  const ground = buildGround();
  const roof = buildRoof();

  tick('Glazing the curtain walls');
  const facades: MapSet[] = [];
  for (let s = 0; s < QUALITY.city.styles; s++) facades.push(buildFacade(s));

  tick('Carving the Meridian Street facades');
  const lm = buildLandmarkTextures();

  const TEX: TextureLibrary = {
    road: road, crosswalk: crosswalk, kerb: kerb, wall: wall,
    limestone: limestone, ground: ground, bricks: bricks, roof: roof,
    facades: facades, sky: buildSky(),
    bankBrick: lm.bankBrick,
    limestonePier: lm.limestonePier,
    rustication: lm.rustication,
    dentil: lm.dentil,
    shopBlue: lm.shopBlue,
    shopMaroon: lm.shopMaroon,
    plazaBrick: lm.plazaBrick,
    monumentStone: lm.monumentStone,
    bronze: lm.bronze,
    intersection: lm.intersection,
    bridgeConcrete: lm.bridgeConcrete,
    tunnelWall: lm.tunnelWall,
    rustedSteel: lm.rustedSteel,
    deckSoffit: lm.deckSoffit,
    arenaBrick: lm.arenaBrick,
    arenaGlass: lm.arenaGlass,
    arenaBase: lm.arenaBase,
    commercialBrick: lm.commercialBrick
  };

  return { TEX: TEX, signTex: signTex, SF_BANNER: buildBanner(), canvasTex: canvasTex };
}

export type TextureSet = ReturnType<typeof createTextures>;
