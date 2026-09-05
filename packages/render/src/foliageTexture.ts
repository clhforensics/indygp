import * as THREE from 'three';

/* Shared clumpy-foliage canopy texture.

   Realism pass: instead of one smooth gradient dome (reads as a green
   lollipop), the silhouette is the UNION of 16 overlapping lobes, each
   carrying its own lightness so the canopy reads as separate leaf masses.
   Big interior holes let sky punch through, and a bottom-strip exclusion
   keeps everything off the trunk zone.

   The painter is deterministic (seeded hash) so both tree systems —
   instanced trackside tiles and landmark trees — produce identical cards. */

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + n * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function paintFoliageCanvas(
  cv: HTMLCanvasElement,
  colors: { highlight: number; base: number; shadow: number },
): void {
  const ctx = cv.getContext('2d')!;
  const w = cv.width;
  const h = cv.height;
  ctx.clearRect(0, 0, w, h);

  const cx = w * 0.5;
  const cy = h * 0.46;
  const rBase = w * 0.46;
  const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
  const cHi = hex(colors.highlight);
  const cBase = hex(colors.base);
  const cSh = hex(colors.shadow);

  /* Canopy = union of lobes. Each lobe gets a flat-ish radial fill whose
     lightness depends on its height (sun above) plus per-lobe jitter, so
     neighbouring clumps contrast — that contrast is what reads as foliage. */
  const lobes = 16;
  for (let i = 0; i < lobes; i++) {
    const ang = hash(3.1 * i + 0.7) * Math.PI * 2;
    const dist = rBase * (0.15 + hash(5.3 * i + 1.3) * 0.55);
    const lx = cx + Math.cos(ang) * dist;
    const ly = cy + Math.sin(ang) * dist * 0.85;
    const lr = rBase * (0.34 + hash(7.7 * i + 2.9) * 0.30);
    if (ly + lr > h * 0.96) continue;   // keep the trunk strip clear

    const heightT = 1 - (ly / h);                       // 1 top .. 0 bottom
    const jitter = (hash(9.1 * i + 4.1) - 0.5) * 0.5;
    const pick = heightT + jitter;
    const fill = pick > 0.62 ? cHi : pick > 0.30 ? cBase : cSh;
    const grd = ctx.createRadialGradient(
      lx - lr * 0.25, ly - lr * 0.35, lr * 0.15,
      lx, ly, lr,
    );
    grd.addColorStop(0, fill);
    grd.addColorStop(1, pick > 0.62 ? cBase : cSh);
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(lx, ly, lr, 0, Math.PI * 2);
    ctx.fill();
  }

  /* Leaf-scale mottling: light dabs sunward (top-right of each pixel's
     height), dark dabs low — cheap but breaks up the flat fills. */
  for (let i = 0; i < 150; i++) {
    const x = hash(11.3 * i + 1.1) * w;
    const y = hash(17.7 * i + 2.4) * h;
    const r = 1.5 + hash(23.1 * i + 6.8) * 4;
    const topness = 1 - y / h;
    ctx.fillStyle = `rgba(255,255,225,${(0.06 + hash(29.9 * i + 3.5) * 0.16) * topness})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 120; i++) {
    const x = hash(13.7 * i + 5.1) * w;
    const y = hash(19.9 * i + 8.6) * h;
    const r = 1.5 + hash(31.1 * i + 9.9) * 3.5;
    const botness = y / h;
    ctx.fillStyle = `rgba(6,16,5,${(0.08 + hash(37.7 * i + 4.2) * 0.16) * botness})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  /* Sky holes: bigger and fewer than before, placed inside the canopy mass
     (not near the silhouette edge, which would shred it). */
  ctx.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 9; i++) {
    const ang = hash(41.9 * i + 6.3) * Math.PI * 2;
    const dist = rBase * hash(43.3 * i + 7.1) * 0.55;
    const hx = cx + Math.cos(ang) * dist;
    const hy = cy + Math.sin(ang) * dist * 0.8;
    const hr = 2.5 + hash(47.1 * i + 8.9) * 5;
    ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

export function makeFoliageTexture(
  renderer: THREE.WebGLRenderer | null,
  colors: { highlight: number; base: number; shadow: number },
  size = 128,
): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  paintFoliageCanvas(cv, colors);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (renderer) tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.needsUpdate = true;
  return tex;
}
