import * as THREE from 'three';

/* ============================================================================ *
 * R2 ROAD WEAR OVERLAY — INDYGP-ROADWEAR-V1                                    *
 *                                                                              *
 * A transparent decal ribbon laid 1 cm above the road PNG surface. Adds the    *
 * large-scale "used street" story the base albedo lacks: dark rubber lines on  *
 * the racing line, light worn patches, tonal drift, edge grime.                *
 *                                                                              *
 * U spans the carriageway 0..1 (kerb to kerb), V repeats along the lap.        *
 * Alpha comes from the map's own alpha channel (CanvasTexture with alpha).     *
 * ============================================================================ */

export interface RoadWearMaps {
  map: THREE.Texture;
}

function makeWearCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Cheap deterministic value-noise via layered sine hashing (no deps). */
function fbm1(x: number, y: number, seed: number): number {
  let v = 0, amp = 0.5, fx = x, fy = y;
  for (let o = 0; o < 4; o++) {
    const s = Math.sin(fx * 12.9898 + fy * 78.233 + seed * 3.7) * 43758.5453;
    v += amp * (s - Math.floor(s));
    amp *= 0.5; fx *= 2.03; fy *= 2.01;
  }
  return v;
}

export function createRoadWearMaps(): RoadWearMaps {
  const W = 512, H = 512;
  const canvas = makeWearCanvas(W, H);
  const g = canvas.getContext('2d')!;

  const img = g.createImageData(W, H);
  const d = img.data;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const u = x / W;
      const v = y / H;

      /* --- racing-line rubber: two soft dark bands, slightly wandering ---- */
      const wander = (fbm1(v * 6.0, 0.3, 11) - 0.5) * 0.05;
      const lineL = 0.315 + wander;
      const lineR = 0.685 + wander;
      const dl = Math.abs(u - lineL), dr = Math.abs(u - lineR);
      const band = Math.min(dl, dr);
      const rubber = Math.max(0, 1 - band / 0.085);
      const rubberMod = 0.55 + 0.45 * fbm1(u * 9, v * 40, 23);

      /* --- large-scale patchy tonal drift --------------------------------- */
      const patch = fbm1(u * 3.2, v * 7.0, 41);

      /* --- edge grime: darker smear near kerbs ---------------------------- */
      const edge = Math.max(0, Math.abs(u - 0.5) * 2 - 0.82) / 0.18;

      /* compose color: darker rubber, lighter worn patches */
      let lum = 0.5 + (patch - 0.5) * 0.24;         // base drift around mid
      lum *= 1 - rubber * 0.42 * rubberMod;         // rubber darkens
      lum *= 1 - edge * 0.28;                       // grime at edges

      /* alpha: mostly transparent; rubber + grime show, patches subtle */
      let alpha = rubber * 0.55 * rubberMod + edge * 0.35 + Math.max(0, 0.5 - patch) * 0.12;
      alpha = Math.min(1, alpha);

      const c = Math.max(0, Math.min(255, Math.round(lum * 255)));
      d[i] = c; d[i + 1] = c; d[i + 2] = c;
      d[i + 3] = Math.round(alpha * 255);
    }
  }
  g.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  return { map: tex };
}
