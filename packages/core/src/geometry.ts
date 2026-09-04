/* =============================================================================
   LAYER 3 - GEOMETRY
   Corner filleting, uniform resampling and the nearest-point locator,
   extracted verbatim from IndyGP_Phase1.html.
   ========================================================================== */

import { clamp, clamp01, lerp } from './config';
import type { CircuitNode } from './circuit';

export interface Vec2 { x: number; z: number }

export interface Centreline {
  pts: Float32Array;
  tan: Float32Array;
  nrm: Float32Array;
  cum: Float32Array;
  curv: Float32Array;
  count: number;
  length: number;
  step: number;
}

export interface LocateResult {
  index: number;
  s: number;
  lateral: number;
  tx: number;
  tz: number;
  px: number;
  pz: number;
  curv: number;
}

export type Locator = (x: number, z: number, hint: number) => LocateResult;

/* ---------- begin verbatim Layer 3 ---------- */

export function buildCentreline(nodes: CircuitNode[], step: number): Centreline {
  const n = nodes.length;
  if (n < 3) throw new Error('a circuit needs at least three nodes');

  const P = nodes.map(nd => ({ x:nd.x, z:nd.z }));
  const dir: Vec2[] = [], len: number[] = [];
  for (let i = 0; i < n; i++){
    const a = P[i], b = P[(i+1)%n];
    const dx = b.x-a.x, dz = b.z-a.z, L = Math.hypot(dx,dz);
    if (L < 1) throw new Error('circuit nodes ' + i + ' and ' + ((i+1)%n) + ' are on top of each other');
    dir.push({ x:dx/L, z:dz/L });  len.push(L);
  }

  // turn angle, handedness (cross > 0 is a right-hander in this frame) and
  // the tangent offset each fillet consumes along its two straights
  const ang = new Array<number>(n), hand = new Array<number>(n), off = new Array<number>(n);
  for (let i = 0; i < n; i++){
    const u = dir[(i-1+n)%n], v = dir[i];
    ang[i]  = Math.acos(clamp(u.x*v.x + u.z*v.z, -1, 1));
    hand[i] = (u.x*v.z - u.z*v.x) >= 0 ? 1 : -1;
    const r = nodes[i].r || 0;
    off[i]  = (ang[i] < 1e-4 || r <= 0) ? 0 : r * Math.tan(ang[i]/2);
  }
  for (let pass = 0; pass < 4; pass++){
    for (let i = 0; i < n; i++){
      const j = (i+1)%n, cap = 0.98*len[i], sum = off[i]+off[j];
      if (sum > cap && sum > 0){ const k = cap/sum; off[i] *= k; off[j] *= k; }
    }
  }

  // walk the loop, emitting straights and arcs
  const raw: Vec2[] = [];
  const push = (x: number, z: number): void => {
    const last = raw[raw.length-1];
    if (!last || Math.hypot(last.x-x, last.z-z) > 0.05) raw.push({x,z});
  };
  for (let i = 0; i < n; i++){
    const u = dir[(i-1+n)%n], v = dir[i], p = P[i], t = off[i];
    if (t < 0.02){ push(p.x, p.z); continue; }
    const A = { x:p.x - u.x*t, z:p.z - u.z*t };
    const B = { x:p.x + v.x*t, z:p.z + v.z*t };
    const R = t / Math.tan(ang[i]/2);
    const nx = -u.z*hand[i], nz = u.x*hand[i];        // unit normal toward the arc centre
    const O  = { x:A.x + nx*R, z:A.z + nz*R };
    const a0 = Math.atan2(A.z-O.z, A.x-O.x);
    const sweep = ang[i] * hand[i];
    const steps = Math.max(2, Math.ceil(R*ang[i]/2.5));
    for (let s = 0; s <= steps; s++){
      const a = a0 + sweep*(s/steps);
      push(O.x + Math.cos(a)*R, O.z + Math.sin(a)*R);
    }
    push(B.x, B.z);
  }

  // resample at a uniform step so s (arc length) maps linearly to index
  const segLen: number[] = [];
  let total = 0;
  for (let i = 0; i < raw.length; i++){
    const a = raw[i], b = raw[(i+1)%raw.length];
    const L = Math.hypot(b.x-a.x, b.z-a.z);
    segLen.push(L); total += L;
  }
  const count = Math.max(64, Math.round(total/step));
  const even  = total / count;
  const pts = new Float32Array(count*2);
  let seg = 0, walked = 0;
  for (let i = 0; i < count; i++){
    const target = i*even;
    while (seg < segLen.length-1 && walked + segLen[seg] < target){ walked += segLen[seg]; seg++; }
    const f = segLen[seg] > 1e-6 ? (target - walked)/segLen[seg] : 0;
    const a = raw[seg], b = raw[(seg+1)%raw.length];
    pts[i*2]   = a.x + (b.x-a.x)*f;
    pts[i*2+1] = a.z + (b.z-a.z)*f;
  }

  // tangents, right-hand normals, curvature
  const tan = new Float32Array(count*2), nrm = new Float32Array(count*2),
        cum = new Float32Array(count+1), curv = new Float32Array(count);
  for (let i = 0; i < count; i++){
    const p0 = ((i-1)+count)%count, p1 = (i+1)%count;
    const dx = pts[p1*2]-pts[p0*2], dz = pts[p1*2+1]-pts[p0*2+1];
    const L = Math.hypot(dx,dz) || 1;
    tan[i*2] = dx/L; tan[i*2+1] = dz/L;
    nrm[i*2] = -tan[i*2+1]; nrm[i*2+1] = tan[i*2];   // right of travel
    cum[i] = i*even;
  }
  cum[count] = total;
  for (let i = 0; i < count; i++){
    const a = ((i-1)+count)%count, b = (i+1)%count;
    const ux = pts[i*2]-pts[a*2],  uz = pts[i*2+1]-pts[a*2+1];
    const vx = pts[b*2]-pts[i*2],  vz = pts[b*2+1]-pts[i*2+1];
    const lu = Math.hypot(ux,uz)||1, lv = Math.hypot(vx,vz)||1;
    const cr = (ux/lu)*(vz/lv) - (uz/lu)*(vx/lv);
    const dt = clamp((ux/lu)*(vx/lv) + (uz/lu)*(vz/lv), -1, 1);
    curv[i] = (Math.acos(dt) / even) * (cr >= 0 ? 1 : -1);
  }
  return { pts, tan, nrm, cum, curv, count, length: total, step: even };
}

/* Nearest-point query. Walks a window around the last known index, which is
   O(1) for a car that cannot teleport, and falls back to a full sweep. */
export function makeLocator(cl: Centreline): Locator {
  const W = 90;
  function scan(x: number, z: number, from: number, to: number) {
    let best = { d2:Infinity, i:0, f:0 };
    for (let k = from; k <= to; k++){
      const i = ((k % cl.count) + cl.count) % cl.count, j = (i+1)%cl.count;
      const ax = cl.pts[i*2], az = cl.pts[i*2+1];
      const bx = cl.pts[j*2], bz = cl.pts[j*2+1];
      const dx = bx-ax, dz = bz-az, L2 = dx*dx + dz*dz;
      let f = L2 > 1e-9 ? ((x-ax)*dx + (z-az)*dz)/L2 : 0;
      f = clamp01(f);
      const px = ax + dx*f, pz = az + dz*f;
      const d2 = (x-px)*(x-px) + (z-pz)*(z-pz);
      if (d2 < best.d2) best = { d2, i, f };
    }
    return best;
  }
  return function locate(x: number, z: number, hint: number): LocateResult {
    let b = scan(x, z, hint-W, hint+W);
    if (Math.sqrt(b.d2) > W*cl.step*0.5) b = scan(x, z, 0, cl.count-1);
    const i = b.i, j = (i+1)%cl.count;
    const tx = lerp(cl.tan[i*2],   cl.tan[j*2],   b.f);
    const tz = lerp(cl.tan[i*2+1], cl.tan[j*2+1], b.f);
    const tl = Math.hypot(tx,tz)||1;
    const px = lerp(cl.pts[i*2], cl.pts[j*2], b.f);
    const pz = lerp(cl.pts[i*2+1], cl.pts[j*2+1], b.f);
    // signed lateral offset: positive is right of the direction of travel
    const lateral = (x-px)*(-tz/tl) + (z-pz)*(tx/tl);
    return { index:i, s:(cl.cum[i] + b.f*cl.step) % cl.length, lateral,
             tx:tx/tl, tz:tz/tl, px, pz, curv:cl.curv[i] };
  };
}

/* ---------- end verbatim Layer 3 ---------- */
