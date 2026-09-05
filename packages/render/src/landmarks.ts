
/* =============================================================================
   LANDMARK GEOMETRY - INDYGP-LANDMARKS-V1The Washington & Meridian corridor, the Soldiers' & Sailors' Monument, the
   Artsgarden and the outer skyline anchors, built from the reference
   photography rather than from the generic lot generator.

   Coordinate frame is the circuit frame: x grows EAST, z grows SOUTH, one unit
   is one metre. Washington St is z = 0, Meridian St is x = 680, and Monument
   Circle is centred on (680, -130) with a 55 m carriageway radius.

   CORNER ASSIGNMENT, from the photographs
     SW  Merchants National Bank / Barnes & Thornburg, 11 S Meridian St.
         The tower is on the WEST side of Meridian, SOUTH of Washington.
     NW  Indiana Department of Health block, pale limestone over a polished
         granite plinth, blue awnings above the T-Mobile shopfront.
     NE  dark red brick six-storey, black shopfronts, maroon awnings.
     SE  cream limestone eight-storey over a retail base.

   Every landmark is merged down to a handful of meshes per material and
   registered with the Phase 2F distance culler.
   ========================================================================== */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CFG, hash01, AVE, ST, CIRCLE } from '@indygp/core';
import type { Centreline, Locator, TurnInfo } from '@indygp/core';
import { QUALITY } from './quality';
import { paintFoliageCanvas } from './foliageTexture';
import { arenaBannerTex } from './textures';
import type { MapSet, TextureLibrary } from './textures';

/* pbr() and solid() are handed in from world.ts rather than duplicated here,
   which keeps a single definition of the material conventions and avoids a
   circular import between the two modules. */
export interface LandmarkKit {
  scene: THREE.Scene;
  TEX: TextureLibrary;
  pbr: (set: MapSet, o: any) => THREE.MeshStandardMaterial;
  solid: (color: number, roughness: number, metalness: number, envInt: number) => THREE.MeshStandardMaterial;
  register: (mesh: THREE.Object3D, cx: number, cz: number, r: number) => void;
  locate: Locator;
  CL: Centreline;
  TURNS: TurnInfo[];
  SF_BANNER: THREE.Texture;
}

const MERIDIAN = AVE.MERIDIAN;
const WASHINGTON = ST.WASHINGTON;
const MISSOURI = AVE.MISSOURI;
const WEST = AVE.WEST;
const WHITE_RIVER = AVE.WHITE_RIVER;

/* INDYGP-PENN-V1
   Pennsylvania Street sector anchors, Turn 4 (Market, z -130) south to
   Turn 5 (South St, z 400). Driving south the tangent is (0, +1), so the
   right-hand normal is (-1, 0): west is the driver's right and the
   Fieldhouse on the east side is genuinely on the left. */
const PENN = AVE.PENN;
const UNDERPASS_Z = 330;      // Union Station viaduct, between Georgia and South
const ARENA_CX = 902;         // Gainbridge, east of Penn, west of Delaware
const ARENA_CZ = 190;         // between Maryland (130) and Georgia (250)

/* Half-width of the street canyon at Turn 1: the building line sits this far
   from the centreline, leaving room for the 7 m carriageway, the 9.4 m barrier
   line and a pavement. */
const CANYON = 22;

/* Rectangles the generic lot generator must leave alone. Half-extents. */
export const LANDMARK_ZONES: Array<{ x: number; z: number; rx: number; rz: number }> = [
  { x: MERIDIAN - 44, z: WASHINGTON + 44, rx: 30, rz: 30 },   // SW  Merchants Bank
  { x: MERIDIAN - 46, z: WASHINGTON - 44, rx: 32, rz: 30 },   // NW  Dept of Health
  { x: MERIDIAN + 42, z: WASHINGTON - 40, rx: 28, rz: 26 },   // NE  Jimmy John's block
  { x: MERIDIAN + 44, z: WASHINGTON + 42, rx: 28, rz: 28 },   // SE  limestone eight-storey
  { x: MERIDIAN - 42, z: -62, rx: 26, rz: 22 },               // Meridian west infill
  { x: MERIDIAN + 42, z: -62, rx: 26, rz: 22 },               // Meridian east infill
  { x: -78, z: 45, rx: 42, rz: 52 },                        // JW Marriott (fixed)
  { x: WEST - 190, z: 180, rx: 140, rz: 112 },              // Victory Field
  { x: WHITE_RIVER + 170, z: 40, rx: 120, rz: 95 },         // White River overpass corridor
  { x: 410, z: 520, rx: 105, rz: 80 },                        // Lucas Oil Stadium
  { x: ARENA_CX, z: ARENA_CZ, rx: 66, rz: 60 },               // Gainbridge Fieldhouse
  { x: PENN, z: UNDERPASS_Z, rx: 36, rz: 28 },                // Union Station underpass
  { x: MISSOURI, z: 336, rx: 72, rz: 44 },                    // Missouri railway overpass
  { x: PENN - 48, z: 135, rx: 32, rz: 190 },                  // Penn corridor, west side
  { x: PENN + 46, z: -30, rx: 30, rz: 78 }                    // Penn corridor, east infill
];

export function inLandmarkZone(x: number, z: number, pad: number): boolean {
  for (let i = 0; i < LANDMARK_ZONES.length; i++) {
    const zn = LANDMARK_ZONES[i];
    if (Math.abs(x - zn.x) < zn.rx + pad && Math.abs(z - zn.z) < zn.rz + pad) return true;
  }
  return false;
}

/* ------------------------------------------------------------- primitives - */

function box(w: number, h: number, d: number): THREE.BoxGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material,
             x: number, y: number, z: number, ry?: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (ry) m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/* Scale a BoxGeometry's UVs so one unit is one storey by one bay. BoxGeometry
   lays out six faces of four vertices: +x, -x, +y, -y, +z, -z. */
function boxUv(geo: THREE.BoxGeometry, w: number, h: number, d: number,
               bay: number, storey: number): THREE.BoxGeometry {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const bw = Math.max(1, Math.round(w / bay));
  const bd = Math.max(1, Math.round(d / bay));
  const fl = Math.max(1, Math.round(h / storey));
  const scale = [[bd, fl], [bd, fl], [bw, bd], [bw, bd], [bw, fl], [bw, fl]];
  for (let f = 0; f < 6; f++) {
    for (let q = 0; q < 4; q++) {
      const vi = f * 4 + q;
      uv.setXY(vi, uv.getX(vi) * scale[f][0], uv.getY(vi) * scale[f][1]);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

/* Foliage billboard card shared by all landmark trees: clumpy multi-lobe
   canopy with sky holes, painted by the shared foliageTexture painter so
   landmark trees match the instanced street trees exactly. */
let landmarkFoliageTex: THREE.Texture | null = null;
function getFoliageTexture(): THREE.Texture {
  if (landmarkFoliageTex) return landmarkFoliageTex;
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  paintFoliageCanvas(cv, {
    highlight: 0xa3c67f,
    base: 0x6b9152,
    shadow: 0x47663a,
  });
  landmarkFoliageTex = new THREE.CanvasTexture(cv);
  landmarkFoliageTex.colorSpace = THREE.SRGBColorSpace;
  return landmarkFoliageTex;
}

/* Crossed-billboard street tree: two intersecting alpha-cutout quads instead
   of the old solid icosahedron blob. leafMat is retained in the signature for
   call-site compatibility but no longer drives the canopy. */
function tree(parent: THREE.Object3D, x: number, z: number, scale: number,
              trunkMat: THREE.Material, leafMat: THREE.Material): void {
  // Trunk MUST scale with the canopy and reach INTO the visible foliage dome:
  // the card's bottom ~18% is transparent (dome cut out at the top), so a
  // trunk ending at the card base leaves a floating gap. Top at 5.8*scale
  // lands inside the dome (visible foliage starts ~4.7*scale).
  add(parent, new THREE.CylinderGeometry(0.55 * scale, 0.8 * scale, 5.8 * scale, 8),
      trunkMat, x, 2.9 * scale, z);
  const W = 10.0 * scale, H = 8.8 * scale;
  const bbMat = new THREE.MeshStandardMaterial({
    map: getFoliageTexture(),
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0.0,
  });
  const a = new THREE.PlaneGeometry(W, H);
  a.translate(0, H * 0.5, 0);
  const b = new THREE.PlaneGeometry(W, H);
  b.translate(0, H * 0.5, 0);
  b.rotateY(Math.PI / 2);
  // Diagonal pair: mid-depth layer so the crown has volume from any angle.
  const c = new THREE.PlaneGeometry(W * 0.86, H * 0.86);
  c.translate(0, H * 0.86 * 0.5, 0);
  c.rotateY(Math.PI / 4);
  const d = new THREE.PlaneGeometry(W * 0.86, H * 0.86);
  d.translate(0, H * 0.86 * 0.5, 0);
  d.rotateY(Math.PI / 4 + Math.PI / 2);
  const canopy = mergeGeometries([a, b, c, d])!;
  const leaf = new THREE.Mesh(canopy, bbMat);
  leaf.position.set(x, 3.8 * scale, z);
  leaf.rotation.y = (x * 13.7 + z * 7.3) % Math.PI;
  leaf.castShadow = true;
  parent.add(leaf);
}

/* Register a finished group with the distance culler using its real bounds. */
function seal(kit: LandmarkKit, grp: THREE.Group): void {
  kit.scene.add(grp);
  grp.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(grp);
  const c = bb.getCenter(new THREE.Vector3());
  const s = bb.getSize(new THREE.Vector3());
  kit.register(grp, c.x, c.z, 0.5 * Math.hypot(s.x, s.y, s.z));
}

/* ------------------------------------------------------------ INDYGP-MARRIOTT-FIX-V1 --
   CORRIDOR GUARD

   Exact distance from a world point to the circuit centreline. Brute force
   over every resampled point, which costs nothing at build time and is exact
   to within half the 2 m sample step. This deliberately does not reuse
   makeLocator: that helper walks a 90 m window around a caller-supplied hint
   and only falls back to a full sweep when the window comes up empty, so a
   landmark sitting near two different parts of the lap can be handed the wrong
   nearest segment. For a one-off build-time check, exhaustive is correct. */
function centrelineDistance(CL: Centreline, x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < CL.count; i++) {
    const dx = x - CL.pts[i * 2];
    const dz = z - CL.pts[i * 2 + 1];
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}

export interface CorridorReport {
  label: string;
  minCentreline: number;
  closestSlabX: number;
  slabLimit: number;
  nudge: number;
}

/* Two independent safety tests on a finished landmark group.

   1. The driving slab, as specified: no geometry may fall inside
      Math.abs(x) < CFG.track.halfWidth + 15.
   2. The real one: no geometry corner may come closer than minCentreline to
      the circuit centreline anywhere on the lap.

   Test 1 alone would have passed the broken JW Marriott build, because that
   mesh was clipping the Maryland diagonal around x = -80 rather than the West
   Street straight at x = 0. Test 2 is what actually catches it.

   Sampling is the eight corners of every child mesh's local bounding box,
   pushed through its world matrix. That over-approximates a curved surface
   slightly, which is the safe direction to be wrong in.

   If either test fails the group walks west in one metre steps until it
   clears. By design that never fires: the surveyed anchor clears on the first
   evaluation, and a non-zero nudge in the console means somebody has edited a
   landmark into the track. */
export function corridorGuard(kit: LandmarkKit, grp: THREE.Group,
                              label: string, minCentreline: number): CorridorReport {
  const slabLimit = CFG.track.halfWidth + 15;
  const pts: THREE.Vector3[] = [];
  const v = new THREE.Vector3();

  const sample = function (): void {
    pts.length = 0;
    grp.updateMatrixWorld(true);
    grp.traverse(function (o: THREE.Object3D) {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      const g = m.geometry as THREE.BufferGeometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox;
      if (!bb) return;
      for (let c = 0; c < 8; c++) {
        v.set(
          (c & 1) ? bb.max.x : bb.min.x,
          (c & 2) ? bb.max.y : bb.min.y,
          (c & 4) ? bb.max.z : bb.min.z
        ).applyMatrix4(m.matrixWorld);
        pts.push(v.clone());
      }
    });
  };

  let nudge = 0;
  let minC = Infinity;
  let closestSlab = Infinity;

  for (let attempt = 0; attempt <= 160; attempt++) {
    sample();
    minC = Infinity;
    closestSlab = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const d = centrelineDistance(kit.CL, p.x, p.z);
      if (d < minC) minC = d;
      const ax = Math.abs(p.x);
      if (ax < closestSlab) closestSlab = ax;
    }
    if (closestSlab >= slabLimit && minC >= minCentreline) break;
    grp.position.x -= 1;
    nudge += 1;
  }

  if (nudge > 0) {
    console.warn('[landmarks] ' + label + ' was nudged ' + nudge +
      ' m west to clear the circuit. Its surveyed anchor needs fixing.');
  }
  console.info('[landmarks] ' + label + ' clearance: centreline ' +
    minC.toFixed(1) + ' m (need ' + minCentreline.toFixed(1) + '), closest |x| ' +
    closestSlab.toFixed(1) + ' m (slab ' + slabLimit.toFixed(1) + '), nudge ' + nudge + ' m');

  return {
    label: label, minCentreline: minC, closestSlabX: closestSlab,
    slabLimit: slabLimit, nudge: nudge
  };
}


/* ------------------------------------------------------------- INDYGP-PENN-V1 --
   CLEARANCE GUARD

   corridorGuard is the wrong test for a bridge. It exists to shove a landmark
   sideways until nothing overhangs the circuit, which for a structure whose
   entire purpose is to span the circuit would push it west forever.

   This is the vertical equivalent. It walks every mesh corner that sits inside
   the barrier line and finds the lowest one: that is the real clearance a car
   sees. Anything below the requested minimum lifts the whole group until it
   clears. Geometry outside the barrier line is ignored at any height, which is
   what lets the abutments run to the ground beside the road. */
export interface ClearanceReport {
  label: string;
  clearance: number;
  required: number;
  lift: number;
  samples: number;
}

export function clearanceGuard(kit: LandmarkKit, grp: THREE.Group,
                               label: string, required: number): ClearanceReport {
  const wall = CFG.track.wallOffset;
  const v = new THREE.Vector3();
  let lift = 0;
  let lowest = Infinity;
  let samples = 0;

  for (let attempt = 0; attempt <= 40; attempt++) {
    grp.updateMatrixWorld(true);
    lowest = Infinity;
    samples = 0;
    grp.traverse(function (o: THREE.Object3D) {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      const g = m.geometry as THREE.BufferGeometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox;
      if (!bb) return;
      for (let c = 0; c < 8; c++) {
        v.set(
          (c & 1) ? bb.max.x : bb.min.x,
          (c & 2) ? bb.max.y : bb.min.y,
          (c & 4) ? bb.max.z : bb.min.z
        ).applyMatrix4(m.matrixWorld);
        if (centrelineDistance(kit.CL, v.x, v.z) >= wall) continue;
        samples++;
        if (v.y < lowest) lowest = v.y;
      }
    });
    if (samples === 0) {
      console.warn('[landmarks] ' + label + ' spans no part of the circuit. ' +
        'If it is meant to be a bridge, its anchor is wrong.');
      break;
    }
    if (lowest >= required) break;
    grp.position.y += 0.25;
    lift += 0.25;
  }

  if (lift > 0) {
    console.warn('[landmarks] ' + label + ' was lifted ' + lift.toFixed(2) +
      ' m to clear the carriageway. Its authored deck height needs fixing.');
  }
  console.info('[landmarks] ' + label + ' clearance: ' +
    (isFinite(lowest) ? lowest.toFixed(2) : 'n/a') + ' m over the track (need ' +
    required.toFixed(2) + '), ' + samples + ' spanning corners, lift ' + lift.toFixed(2) + ' m');

  return { label: label, clearance: lowest, required: required, lift: lift, samples: samples };
}

/* Sodium fixture positions under the Union Station deck. world.ts owns every
   light in the scene, so this module publishes the positions as data rather
   than instantiating PointLights of its own. */
export const PENN_TUNNEL_LIGHTS: Array<{ x: number; y: number; z: number }> = [];

/* Heavy classical cornice: fascia, dentil course, corona, cyma. Each band
   oversails the one below, which is what throws the deep shadow line visible
   along the top of the bank in the reference photograph. */
function cornice(kit: LandmarkKit, grp: THREE.Group, cx: number, cz: number,
                 w: number, d: number, y: number, stone: THREE.Material,
                 dentil: THREE.Material): number {
  add(grp, boxUv(box(w + 0.5, 0.7, d + 0.5), w, 0.7, d, 3.2, 0.7), stone, cx, y + 0.35, cz);
  add(grp, boxUv(box(w + 1.6, 1.1, d + 1.6), w, 1.1, d, 2.4, 1.1), dentil, cx, y + 1.25, cz);
  add(grp, boxUv(box(w + 2.6, 0.9, d + 2.6), w, 0.9, d, 3.2, 0.9), stone, cx, y + 2.25, cz);
  add(grp, boxUv(box(w + 1.8, 1.0, d + 1.8), w, 1.0, d, 3.2, 1.0), stone, cx, y + 3.2, cz);
  return y + 3.7;
}

/* A run of shopfront along one elevation, with the awning projecting over the
   pavement. dir is the outward normal: 'n', 's', 'e' or 'w'. */
function shopfront(kit: LandmarkKit, grp: THREE.Group, mat: THREE.Material,
                   awningColor: number, cx: number, cz: number,
                   runLength: number, dir: string): void {
  const H = 5.4;
  const isNS = (dir === 'n' || dir === 's');
  const outward = (dir === 'n' || dir === 'w') ? -1 : 1;
  const geo = isNS ? box(runLength, H, 0.35) : box(0.35, H, runLength);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const bays = Math.max(2, Math.round(runLength / 9));
  for (let f = 0; f < 6; f++) {
    for (let q = 0; q < 4; q++) {
      const vi = f * 4 + q;
      /* Only the two long elevations carry the shopfront artwork; the returns
         are thin enough that their stretch is invisible. */
      uv.setXY(vi, uv.getX(vi) * bays, uv.getY(vi));
    }
  }
  uv.needsUpdate = true;

  const px = isNS ? cx : cx + outward * 0.18;
  const pz = isNS ? cz + outward * 0.18 : cz;
  add(grp, geo, mat, px, H / 2, pz);

  /* The awning itself: a shallow angled slab on brackets. */
  const awnMat = kit.solid(awningColor, 0.90, 0.0, 0.35);
  const aGeo = isNS ? box(runLength * 0.94, 0.16, 2.2) : box(2.2, 0.16, runLength * 0.94);
  const ax = isNS ? cx : cx + outward * 1.25;
  const az = isNS ? cz + outward * 1.25 : cz;
  const awn = add(grp, aGeo, awnMat, ax, 4.55, az);
  awn.rotation.x = isNS ? outward * 0.16 : 0;
  awn.rotation.z = isNS ? 0 : -outward * 0.16;
}

/* Vertical piers standing proud of one elevation. These are real geometry on
   the two street-facing faces only; the returns rely on the normal map. */
function piers(kit: LandmarkKit, grp: THREE.Group, mat: THREE.Material,
               cx: number, cz: number, runLength: number, y0: number, y1: number,
               dir: string, count: number): void {
  const isNS = (dir === 'n' || dir === 's');
  const outward = (dir === 'n' || dir === 'w') ? -1 : 1;
  const h = y1 - y0;
  const spacing = runLength / count;
  for (let i = 0; i <= count; i++) {
    const off = -runLength / 2 + i * spacing;
    const g = isNS ? box(1.5, h, 0.55) : box(0.55, h, 1.5);
    const px = isNS ? cx + off : cx + outward * 0.28;
    const pz = isNS ? cz + outward * 0.28 : cz + off;
    add(grp, g, mat, px, y0 + h / 2, pz);
  }
}

/* =============================================== TURN 1 CORNER ARCHITECTURE */

export function buildTurnOneDistrict(kit: LandmarkKit): void {
  const T = kit.TEX;

  const brickMat = kit.pbr(T.bankBrick, {
    envIntensity: QUALITY.envInt.facade, normalScale: 0.85, emissiveIntensity: 1.4
  });
  const pierStone = kit.pbr(T.limestonePier, {
    envIntensity: QUALITY.envInt.facade, normalScale: 0.8, emissiveIntensity: 1.3
  });
  const rustMat = kit.pbr(T.rustication, {
    envIntensity: QUALITY.envInt.stone, normalScale: 0.95
  });
  const dentilMat = kit.pbr(T.dentil, {
    envIntensity: QUALITY.envInt.stone, normalScale: 1.0
  });
  const plainStone = kit.pbr(T.monumentStone, {
    envIntensity: QUALITY.envInt.stone, normalScale: 0.7, repeatX: 2, repeatY: 2
  });
  const shopBlue = kit.pbr(T.shopBlue, {
    envIntensity: QUALITY.envInt.glass, normalScale: 0.8, emissiveIntensity: 1.5
  });
  const shopMaroon = kit.pbr(T.shopMaroon, {
    envIntensity: QUALITY.envInt.glass, normalScale: 0.8, emissiveIntensity: 1.5
  });
  const granite = kit.solid(0x33201C, 0.16, 0.28, 1.1);
  const roofMat = kit.pbr(T.roof, {
    envIntensity: QUALITY.envInt.ground, normalScale: 0.5, repeatX: 3, repeatY: 3
  });
  const treeTrunkMat = kit.solid(0x8A6A48, 0.94, 0.0, 0.35);
  const treeLeafMat = kit.solid(0x2F6A2C, 0.80, 0.0, 0.18);

  /* --- SOUTHWEST: Merchants National Bank / Barnes & Thornburg -------------
     Seventeen storeys. Two-storey rusticated limestone base under a dark red
     brick shaft with continuous piers, closed by a very heavy cornice. This is
     the tallest thing on the corner and it frames the left of the shot looking
     north up Meridian. */
  {
    const grp = new THREE.Group();
    const W = 44, D = 42;
    const cx = MERIDIAN - CANYON - W / 2;
    const cz = WASHINGTON + CANYON + D / 2;

    add(grp, box(W + 0.6, 1.3, D + 0.6), granite, cx, 0.65, cz);
    add(grp, boxUv(box(W, 11.4, D), W, 11.4, D, 5.5, 5.7), rustMat, cx, 1.3 + 5.7, cz);
    add(grp, boxUv(box(W + 1.3, 1.0, D + 1.3), W, 1.0, D, 3.2, 1.0), plainStone, cx, 13.2, cz);

    const shaftBase = 13.7, shaftTop = 55.0;
    add(grp, boxUv(box(W, shaftTop - shaftBase, D), W, shaftTop - shaftBase, D, 4.4, 3.9),
        brickMat, cx, (shaftBase + shaftTop) / 2, cz);
    piers(kit, grp, brickMat, cx, cz + D / 2, W - 3, shaftBase, shaftTop, 's', 9);
    piers(kit, grp, brickMat, cx + W / 2, cz, D - 3, shaftBase, shaftTop, 'e', 9);

    const top = cornice(kit, grp, cx, cz, W, D, shaftTop, plainStone, dentilMat);
    add(grp, boxUv(box(W - 2, 2.4, D - 2), W, 2.4, D, 3.2, 2.4), plainStone, cx, top + 1.2, cz);
    add(grp, box(W - 4, 0.6, D - 4), roofMat, cx, top + 2.7, cz);

    /* Retail frontage on Washington and on Meridian. */
    shopfront(kit, grp, shopMaroon, 0x5A1712, cx, cz - D / 2, W - 2, 'n');
    shopfront(kit, grp, shopMaroon, 0x5A1712, cx - W / 2, cz, D - 2, 'w');
    seal(kit, grp);
  }

  /* --- NORTHWEST: Indiana Department of Health block ----------------------
     Pale limestone with strong vertical piers over a polished granite plinth,
     blue awnings along the T-Mobile shopfront. */
  {
    const grp = new THREE.Group();
    const W = 48, D = 40;
    const cx = MERIDIAN - CANYON - W / 2;
    const cz = WASHINGTON - CANYON - D / 2;

    add(grp, box(W + 0.5, 5.6, D + 0.5), granite, cx, 2.8, cz);
    const base = 5.6, topY = 41.0;
    add(grp, boxUv(box(W, topY - base, D), W, topY - base, D, 4.6, 4.0),
        pierStone, cx, (base + topY) / 2, cz);
    piers(kit, grp, pierStone, cx, cz + D / 2, W - 3, base, topY, 's', 10);
    piers(kit, grp, pierStone, cx + W / 2, cz, D - 3, base, topY, 'e', 8);

    const top = cornice(kit, grp, cx, cz, W, D, topY, plainStone, dentilMat);
    add(grp, box(W - 3, 0.7, D - 3), roofMat, cx, top + 0.35, cz);

    shopfront(kit, grp, shopBlue, 0x14357A, cx, cz + D / 2, W - 3, 's');
    shopfront(kit, grp, shopBlue, 0x14357A, cx + W / 2, cz, D - 3, 'e');
    seal(kit, grp);
  }

  /* --- NORTHEAST: dark red brick six-storey, Jimmy John's frontage --------- */
  {
    const grp = new THREE.Group();
    const W = 40, D = 36;
    const cx = MERIDIAN + CANYON + W / 2;
    const cz = WASHINGTON - CANYON - D / 2;

    add(grp, box(W + 0.4, 1.0, D + 0.4), granite, cx, 0.5, cz);
    const base = 1.0, topY = 25.5;
    add(grp, boxUv(box(W, topY - base, D), W, topY - base, D, 4.4, 3.9),
        brickMat, cx, (base + topY) / 2, cz);
    piers(kit, grp, brickMat, cx, cz + D / 2, W - 3, 6.0, topY, 's', 8);
    piers(kit, grp, brickMat, cx - W / 2, cz, D - 3, 6.0, topY, 'w', 7);

    const top = cornice(kit, grp, cx, cz, W, D, topY, plainStone, dentilMat);
    add(grp, box(W - 3, 0.7, D - 3), roofMat, cx, top + 0.35, cz);

    shopfront(kit, grp, shopMaroon, 0x5A1712, cx, cz + D / 2, W - 3, 's');
    shopfront(kit, grp, shopMaroon, 0x5A1712, cx - W / 2, cz, D - 3, 'w');
    seal(kit, grp);
  }

  /* --- SOUTHEAST: cream limestone eight-storey over retail ----------------- */
  {
    const grp = new THREE.Group();
    const W = 42, D = 40;
    const cx = MERIDIAN + CANYON + W / 2;
    const cz = WASHINGTON + CANYON + D / 2;

    add(grp, box(W + 0.4, 1.1, D + 0.4), granite, cx, 0.55, cz);
    add(grp, boxUv(box(W, 6.4, D), W, 6.4, D, 5.5, 6.4), rustMat, cx, 1.1 + 3.2, cz);
    const base = 7.5, topY = 33.0;
    add(grp, boxUv(box(W, topY - base, D), W, topY - base, D, 4.6, 4.0),
        pierStone, cx, (base + topY) / 2, cz);
    piers(kit, grp, pierStone, cx, cz - D / 2, W - 3, base, topY, 'n', 8);
    piers(kit, grp, pierStone, cx - W / 2, cz, D - 3, base, topY, 'w', 8);

    const top = cornice(kit, grp, cx, cz, W, D, topY, plainStone, dentilMat);
    add(grp, box(W - 3, 0.7, D - 3), roofMat, cx, top + 0.35, cz);

    shopfront(kit, grp, shopMaroon, 0x4A2018, cx, cz - D / 2, W - 3, 'n');
    shopfront(kit, grp, shopMaroon, 0x4A2018, cx - W / 2, cz, D - 3, 'w');
    seal(kit, grp);
  }

  /* --- Meridian corridor infill, Washington up to the Circle ---------------
     Two mid-block masonry runs keeping the canyon continuous in the view north
     toward the Monument. */
  const infill = [
    { x: MERIDIAN - CANYON - 22, z: -62, w: 44, d: 40, h: 30, mat: brickMat, face: 'e' },
    { x: MERIDIAN + CANYON + 22, z: -62, w: 44, d: 40, h: 27, mat: pierStone, face: 'w' }
  ];
  for (let i = 0; i < infill.length; i++) {
    const it = infill[i];
    const grp = new THREE.Group();
    add(grp, box(it.w + 0.4, 1.0, it.d + 0.4), granite, it.x, 0.5, it.z);
    add(grp, boxUv(box(it.w, it.h - 1.0, it.d), it.w, it.h - 1.0, it.d, 4.5, 3.9),
        it.mat, it.x, 1.0 + (it.h - 1.0) / 2, it.z);
    const fx = it.face === 'e' ? it.x + it.w / 2 : it.x - it.w / 2;
    piers(kit, grp, it.mat, fx, it.z, it.d - 3, 6, it.h, it.face, 8);
    const top = cornice(kit, grp, it.x, it.z, it.w, it.d, it.h, plainStone, dentilMat);
    add(grp, box(it.w - 3, 0.7, it.d - 3), roofMat, it.x, top + 0.35, it.z);
    shopfront(kit, grp, it.face === 'e' ? shopBlue : shopMaroon,
              it.face === 'e' ? 0x14357A : 0x5A1712,
              fx, it.z, it.d - 4, it.face);
    seal(kit, grp);
  }

  /* --- Washington Street final straight, Turn 13 approach ----------------- */
  {
    const cx = 175;
    const northGrp = new THREE.Group();
    const northW = 64, northD = 24, northH = 22;
    const northZ = -CANYON - northD / 2;
    add(northGrp, box(northW + 0.4, 1.0, northD + 0.4), granite, cx, 0.5, northZ);
    add(northGrp, boxUv(box(northW, northH - 1.0, northD), northW, northH - 1.0, northD, 5.0, 4.5),
        pierStone, cx, 1.0 + (northH - 1.0) / 2, northZ);
    piers(kit, northGrp, pierStone, cx, northZ, northW - 3, 6.0, northH, 's', 10);
    const northTop = cornice(kit, northGrp, cx, northZ, northW, northD, northH, plainStone, dentilMat);
    add(northGrp, box(northW - 3, 0.7, northD - 3), roofMat, cx, northTop + 0.35, northZ);
    add(northGrp, box(northW - 6, 0.9, 1.4), plainStone, cx, 6.8, northZ + northD / 2 - 0.8);
    add(northGrp, box(1.6, northH - 7.0, 0.5), pierStone, cx - northW / 2 + 1.0,
        1.0 + (northH - 7.0) / 2, northZ);
    add(northGrp, box(1.6, northH - 7.0, 0.5), pierStone, cx + northW / 2 - 1.0,
        1.0 + (northH - 7.0) / 2, northZ);
    shopfront(kit, northGrp, shopBlue, 0x14357A, cx, northZ, northW - 3, 's');
    seal(kit, northGrp);

    const southGrp = new THREE.Group();
    const southW = 50, southD = 22, southH = 20;
    const southZ = CANYON + southD / 2 + 16;
    add(southGrp, box(southW + 0.4, 1.0, southD + 0.4), granite, cx, 0.5, southZ);
    add(southGrp, boxUv(box(southW, southH - 1.0, southD), southW, southH - 1.0, southD, 5.0, 4.0),
        brickMat, cx, 1.0 + (southH - 1.0) / 2, southZ);
    piers(kit, southGrp, brickMat, cx, southZ, southW - 3, 6.0, southH, 'n', 8);
    const southTop = cornice(kit, southGrp, cx, southZ, southW, southD, southH, plainStone, dentilMat);
    add(southGrp, box(southW - 3, 0.7, southD - 3), roofMat, cx, southTop + 0.35, southZ);
    add(southGrp, box(southW - 6, 0.9, 1.4), plainStone, cx, 4.5, southZ - southD / 2 + 1.1);
    add(southGrp, box(southW - 6, 0.9, 1.4), plainStone, cx, southH - 1.8, southZ - southD / 2 + 1.1);
    add(southGrp, box(1.5, southH - 8.0, 0.5), brickMat, cx - southW / 2 + 1.0,
        1.0 + (southH - 8.0) / 2, southZ);
    add(southGrp, box(1.5, southH - 8.0, 0.5), brickMat, cx + southW / 2 - 1.0,
        1.0 + (southH - 8.0) / 2, southZ);
    shopfront(kit, southGrp, shopMaroon, 0x5A1712, cx, southZ, southW - 3, 'n');
    seal(kit, southGrp);

    const greenMat = kit.solid(0x2C8A3A, 0.82, 0.0, 0.28);
    const pathMat = kit.solid(0x6D6D6D, 0.84, 0.0, 0.28);
    const mulchMat = kit.solid(0x4B3A23, 0.92, 0.0, 0.28);
    const green = new THREE.Group();
    const greenX = 165;
    const greenZ = 36;
    add(green, box(92, 0.1, 40), greenMat, greenX, 0.05, greenZ);
    add(green, box(72, 0.12, 5), pathMat, greenX, 0.06, greenZ - 8);
    add(green, box(72, 0.07, 4), mulchMat, greenX, 0.04, greenZ - 5);

    const trees = [
      { x: 138, z: 22, s: 1.0 },
      { x: 148, z: 30, s: 1.1 },
      { x: 158, z: 38, s: 1.3 },
      { x: 168, z: 32, s: 1.25 },
      { x: 178, z: 24, s: 1.15 }
    ];
    for (let i = 0; i < trees.length; i++) {
      tree(green, trees[i].x, trees[i].z, trees[i].s, treeTrunkMat, treeLeafMat);
    }
    seal(kit, green);
  }

  /* --- Corner plazas, crosswalks, bike box and junction pavement ----------- */
  {
    const grp = new THREE.Group();
    const plazaMat = kit.pbr(T.plazaBrick, {
      envIntensity: QUALITY.envInt.ground, normalScale: 0.8,
      aniso: QUALITY.tex.anisotropyGrazing, repeatX: 5, repeatY: 5
    });
    const junctionMat = kit.pbr(T.intersection, {
      envIntensity: QUALITY.envInt.road, normalScale: 0.9,
      aniso: QUALITY.tex.anisotropyGrazing
    });
    const crossMat = kit.pbr(T.crosswalk, {
      envIntensity: QUALITY.envInt.road, normalScale: 0.7,
      aniso: QUALITY.tex.anisotropyGrazing
    });
    /* The green bike box on the north approach, straight out of photo two. */
    const bikeMat = kit.solid(0x1E6B3A, 0.86, 0.0, 0.35);

    const jg = new THREE.PlaneGeometry(46, 46);
    jg.rotateX(-Math.PI / 2);
    const junction = new THREE.Mesh(jg, junctionMat);
    junction.position.set(MERIDIAN, 0.028, WASHINGTON);
    junction.receiveShadow = true;
    grp.add(junction);

    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (let i = 0; i < corners.length; i++) {
      const sx = corners[i][0], sz = corners[i][1];
      const pg = new THREE.PlaneGeometry(19, 19);
      pg.rotateX(-Math.PI / 2);
      const plaza = new THREE.Mesh(pg, plazaMat);
      plaza.position.set(MERIDIAN + sx * 22.5, 0.055, WASHINGTON + sz * 22.5);
      plaza.receiveShadow = true;
      grp.add(plaza);

      /* Kerb return around each plaza. */
      const kerbMat = kit.solid(0x8B877D, 0.82, 0.02, 0.4);
      add(grp, box(19, 0.16, 0.5), kerbMat,
          MERIDIAN + sx * 22.5, 0.09, WASHINGTON + sz * 13.2);
      add(grp, box(0.5, 0.16, 19), kerbMat,
          MERIDIAN + sx * 13.2, 0.09, WASHINGTON + sz * 22.5);
    }

    /* Ladder crosswalks on all four approaches. */
    const walks = [
      { x: MERIDIAN, z: WASHINGTON - 18.5, w: 16, d: 4.4, ry: 0 },
      { x: MERIDIAN, z: WASHINGTON + 18.5, w: 16, d: 4.4, ry: 0 },
      { x: MERIDIAN - 18.5, z: WASHINGTON, w: 16, d: 4.4, ry: Math.PI / 2 },
      { x: MERIDIAN + 18.5, z: WASHINGTON, w: 16, d: 4.4, ry: Math.PI / 2 }
    ];
    for (let i = 0; i < walks.length; i++) {
      const wk = walks[i];
      const wg = new THREE.PlaneGeometry(wk.w, wk.d);
      wg.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(wg, crossMat);
      m.position.set(wk.x, 0.042, wk.z);
      m.rotation.y = wk.ry;
      m.receiveShadow = true;
      grp.add(m);
    }

    const bg = new THREE.PlaneGeometry(13, 5.5);
    bg.rotateX(-Math.PI / 2);
    const bikeBox = new THREE.Mesh(bg, bikeMat);
    bikeBox.position.set(MERIDIAN, 0.038, WASHINGTON - 12.0);
    bikeBox.receiveShadow = true;
    grp.add(bikeBox);

    seal(kit, grp);
  }
}

/* ====================================== SOLDIERS' AND SAILORS' MONUMENT ==== */

export function buildMonument(kit: LandmarkKit): void {
  const T = kit.TEX;
  const grp = new THREE.Group();

  const stone = kit.pbr(T.monumentStone, {
    envIntensity: QUALITY.envInt.stone, normalScale: 0.8, repeatX: 3, repeatY: 3
  });
  const stoneFine = kit.pbr(T.monumentStone, {
    envIntensity: QUALITY.envInt.stone, normalScale: 0.6, repeatX: 6, repeatY: 2
  });
  const bronzeMat = kit.pbr(T.bronze, {
    envIntensity: 1.15, normalScale: 0.9, repeatX: 2, repeatY: 2
  });
  const plazaMat = kit.pbr(T.plazaBrick, {
    envIntensity: QUALITY.envInt.ground, normalScale: 0.7,
    aniso: QUALITY.tex.anisotropyGrazing, repeatX: 22, repeatY: 22
  });
  const lawn = kit.solid(0x35521F, 0.94, 0.0, 0.32);
  const water = new THREE.MeshStandardMaterial({
    color: 0x2A5A6B, roughness: 0.045, metalness: 0.55, envMapIntensity: 1.9
  });
  /* The Victory finial reads as a hard, bright specular point against the sky
     in the reference photograph, so it is nearly pure metal. */
  const gilt = new THREE.MeshStandardMaterial({
    color: 0xD4A72C, roughness: 0.20, metalness: 0.96, envMapIntensity: 2.1
  });

  /* Brick-paved plaza inside the carriageway. */
  const pg = new THREE.CircleGeometry(CIRCLE.r - 12, 72);
  pg.rotateX(-Math.PI / 2);
  const plaza = new THREE.Mesh(pg, plazaMat);
  plaza.position.y = 0.05;
  plaza.receiveShadow = true;
  grp.add(plaza);

  /* Four lawn quadrants, exactly as they read from the air. */
  for (let q = 0; q < 4; q++) {
    const lg = new THREE.RingGeometry(21, 33, 24, 1, q * Math.PI / 2 + 0.20, Math.PI / 2 - 0.40);
    lg.rotateX(-Math.PI / 2);
    const lm = new THREE.Mesh(lg, lawn);
    lm.position.y = 0.09;
    lm.receiveShadow = true;
    grp.add(lm);
  }

  /* Stepped circular terrace. */
  const steps = [[24.5, 0.55], [22.6, 0.55], [20.8, 0.55]];
  let y = 0;
  for (let i = 0; i < steps.length; i++) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(steps[i][0], steps[i][0] + 0.5, steps[i][1], 64), stone);
    m.position.y = y + steps[i][1] / 2;
    m.castShadow = true;
    m.receiveShadow = true;
    grp.add(m);
    y += steps[i][1];
  }

  /* East and west cascade basins with their bronze surrounds. */
  const basinX = [-15.5, 15.5];
  for (let i = 0; i < basinX.length; i++) {
    const bx = basinX[i];
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(9.2, 9.6, 1.5, 40), stone);
    rim.position.set(bx, y + 0.75, 0);
    rim.castShadow = true;
    rim.receiveShadow = true;
    grp.add(rim);

    const wg = new THREE.CircleGeometry(8.4, 40);
    wg.rotateX(-Math.PI / 2);
    const surf = new THREE.Mesh(wg, water);
    surf.position.set(bx, y + 1.15, 0);
    surf.receiveShadow = true;
    grp.add(surf);

    /* Tiered cascade in the middle of each basin. */
    const tiers = [[4.4, 0.9], [3.0, 0.9], [1.7, 1.0]];
    let ty = y + 1.0;
    for (let t = 0; t < tiers.length; t++) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(tiers[t][0], tiers[t][0] + 0.7, tiers[t][1], 24), bronzeMat);
      c.position.set(bx, ty + tiers[t][1] / 2, 0);
      c.castShadow = true;
      grp.add(c);
      ty += tiers[t][1];
    }
    const finial = new THREE.Mesh(new THREE.SphereGeometry(1.0, 16, 12), bronzeMat);
    finial.position.set(bx, ty + 0.7, 0);
    finial.castShadow = true;
    grp.add(finial);
  }

  /* Lower plinth and the heavy square base. */
  y += 0.0;
  add(grp, boxUv(box(21, 3.0, 21), 21, 3.0, 21, 3.5, 3.0), stone, 0, y + 1.5, 0);
  y += 3.0;
  add(grp, boxUv(box(16.5, 9.2, 16.5), 16.5, 9.2, 16.5, 3.5, 3.1), stone, 0, y + 4.6, 0);

  /* The north and south sculpture groups, in bronze against the stone. */
  const groupZ = [-8.6, 8.6];
  for (let i = 0; i < groupZ.length; i++) {
    const gz = groupZ[i];
    const mass = new THREE.Mesh(new THREE.BoxGeometry(9.5, 6.4, 2.6), bronzeMat);
    mass.position.set(0, y + 3.6, gz);
    mass.castShadow = true;
    grp.add(mass);
    for (let f = -1; f <= 1; f++) {
      const fig = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 4.4, 10), bronzeMat);
      fig.position.set(f * 3.0, y + 6.4, gz - Math.sign(gz) * 1.0);
      fig.castShadow = true;
      grp.add(fig);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 10), bronzeMat);
      head.position.set(f * 3.0, y + 8.9, gz - Math.sign(gz) * 1.0);
      head.castShadow = true;
      grp.add(head);
    }
  }

  /* Corner pedestals on the base. */
  const ped = [[-7.2, -7.2], [7.2, -7.2], [-7.2, 7.2], [7.2, 7.2]];
  for (let i = 0; i < ped.length; i++) {
    add(grp, box(2.6, 2.4, 2.6), stone, ped[i][0], y + 10.4, ped[i][1]);
    const urn = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.15, 2.0, 14), bronzeMat);
    urn.position.set(ped[i][0], y + 12.6, ped[i][1]);
    urn.castShadow = true;
    grp.add(urn);
  }

  y += 9.2;
  /* Base cornice. */
  add(grp, boxUv(box(18.4, 1.4, 18.4), 18.4, 1.4, 18.4, 3.0, 1.4), stone, 0, y + 0.7, 0);
  y += 1.4;

  /* Transition drum, then the tapering shaft. */
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 7.4, 3.2, 32), stone);
  drum.position.y = y + 1.6;
  drum.castShadow = true;
  drum.receiveShadow = true;
  grp.add(drum);
  y += 3.2;

  const shaftH = 50.0;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 5.9, shaftH, 28, 1), stoneFine);
  shaft.position.y = y + shaftH / 2;
  shaft.castShadow = true;
  shaft.receiveShadow = true;
  grp.add(shaft);
  y += shaftH;

  /* Observation balcony: the flare visible just below the cap. */
  const balc = new THREE.Mesh(new THREE.CylinderGeometry(5.3, 3.4, 2.4, 32), stone);
  balc.position.y = y + 1.2;
  balc.castShadow = true;
  grp.add(balc);
  const rail = new THREE.Mesh(new THREE.TorusGeometry(5.1, 0.16, 8, 40), bronzeMat);
  rail.rotation.x = Math.PI / 2;
  rail.position.y = y + 2.5;
  rail.castShadow = true;
  grp.add(rail);
  y += 2.4;

  const upper = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3.1, 9.5, 24), stoneFine);
  upper.position.y = y + 4.75;
  upper.castShadow = true;
  grp.add(upper);
  y += 9.5;

  const capital = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 2.5, 2.2, 24), stone);
  capital.position.y = y + 1.1;
  capital.castShadow = true;
  grp.add(capital);
  y += 2.2;

  /* Victory, gilded, roughly 87 m above the plaza. */
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.45, 1.3, 16), stone);
  plinth.position.y = y + 0.65;
  plinth.castShadow = true;
  grp.add(plinth);
  y += 1.3;

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 1.10, 4.2, 14), gilt);
  torso.position.y = y + 2.1;
  torso.castShadow = true;
  grp.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 12), gilt);
  head.position.y = y + 4.7;
  head.castShadow = true;
  grp.add(head);
  const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.24, 3.0, 10), gilt);
  armL.position.set(-0.95, y + 3.9, 0);
  armL.rotation.z = 0.85;
  armL.castShadow = true;
  grp.add(armL);
  const torch = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.5, 12), gilt);
  torch.position.set(-1.95, y + 5.4, 0);
  torch.castShadow = true;
  grp.add(torch);
  const armR = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.24, 2.6, 10), gilt);
  armR.position.set(0.90, y + 3.5, 0);
  armR.rotation.z = -0.55;
  armR.castShadow = true;
  grp.add(armR);

  grp.position.set(CIRCLE.x, 0, CIRCLE.z);
  seal(kit, grp);
}

/* ================================================ MAST ARM TRAFFIC SIGNAL == */

/* heading is the direction the signal faces, in radians in the xz plane.
   Amber housings on long horizontal arms, green street-name blades and a
   pedestrian head on the pole, matching the reference photography. */
export function buildMastArmSignal(kit: LandmarkKit, x: number, z: number,
                                   heading: number, armLen: number,
                                   streetLabel: THREE.Texture | null): THREE.Group {
  const grp = new THREE.Group();
  const poleMat = kit.solid(0x1E2422, 0.44, 0.62, QUALITY.envInt.paint);
  const amber = kit.solid(0xD9A31C, 0.42, 0.22, 0.9);
  const backMat = kit.solid(0x14171A, 0.66, 0.10, 0.5);
  const signMat = kit.solid(0x1D6B3C, 0.58, 0.06, 0.6);
  const dark = kit.solid(0x0C0F12, 0.60, 0.12, 0.5);

  const POLE_H = 8.6;
  add(grp, new THREE.CylinderGeometry(0.34, 0.42, 1.0, 14), poleMat, 0, 0.5, 0);
  add(grp, new THREE.CylinderGeometry(0.145, 0.215, POLE_H, 14), poleMat, 0, 1.0 + POLE_H / 2, 0);
  add(grp, new THREE.CylinderGeometry(0.26, 0.20, 0.5, 14), poleMat, 0, POLE_H + 1.2, 0);

  /* The arm runs out along local +x and is dressed to the far side. */
  const armY = POLE_H + 0.95;
  const arm = add(grp, new THREE.CylinderGeometry(0.085, 0.135, armLen, 12), poleMat,
                  armLen / 2, armY, 0);
  arm.rotation.z = Math.PI / 2;

  /* A tapered brace back to the pole, which is what stops the arm reading as a
     floating stick from inside the car. */
  const braceLen = Math.hypot(armLen * 0.42, 2.2);
  const brace = add(grp, new THREE.CylinderGeometry(0.055, 0.08, braceLen, 8), poleMat,
                    armLen * 0.21, armY - 1.1, 0);
  brace.rotation.z = Math.PI / 2 - Math.atan2(2.2, armLen * 0.42);

  const heads = [armLen * 0.52, armLen * 0.88];
  for (let i = 0; i < heads.length; i++) {
    const hx = heads[i];
    add(grp, new THREE.CylinderGeometry(0.07, 0.07, 0.55, 8), poleMat, hx, armY - 0.28, 0);
    add(grp, new THREE.BoxGeometry(0.95, 1.62, 0.045), backMat, hx, armY - 1.42, 0.14);
    add(grp, new THREE.BoxGeometry(0.44, 1.34, 0.42), amber, hx, armY - 1.42, 0);

    const lamps = [
      { dy: 0.44, col: 0x3A0A08, emis: 0x000000, ei: 0 },
      { dy: 0.00, col: 0x3A2A06, emis: 0x000000, ei: 0 },
      { dy: -0.44, col: 0x0E3418, emis: 0x4FBF67, ei: 2.6 }
    ];
    for (let l = 0; l < lamps.length; l++) {
      const lm = new THREE.MeshStandardMaterial({
        color: lamps[l].col, emissive: lamps[l].emis,
        emissiveIntensity: lamps[l].ei, roughness: 0.34, metalness: 0.05
      });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 10), lm);
      bulb.position.set(hx, armY - 1.42 + lamps[l].dy, -0.22);
      grp.add(bulb);
      add(grp, new THREE.CylinderGeometry(0.175, 0.175, 0.20, 10, 1, true), amber,
          hx, armY - 1.42 + lamps[l].dy + 0.10, -0.26).rotation.x = Math.PI / 2;
    }
  }

  /* Green street-name blade near the arm tip. */
  if (streetLabel) {
    const blade = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.52),
      new THREE.MeshStandardMaterial({
        map: streetLabel, roughness: 0.55, metalness: 0.05,
        envMapIntensity: 0.6, side: THREE.DoubleSide
      })
    );
    blade.position.set(armLen * 0.70, armY + 0.55, 0);
    blade.castShadow = true;
    grp.add(blade);
  } else {
    add(grp, new THREE.BoxGeometry(2.6, 0.52, 0.04), signMat, armLen * 0.70, armY + 0.55, 0);
  }

  /* Pedestrian head and its push button on the pole. */
  add(grp, new THREE.BoxGeometry(0.46, 0.52, 0.30), dark, 0.34, 3.4, 0);
  add(grp, new THREE.BoxGeometry(0.16, 0.24, 0.12), dark, 0.30, 1.9, 0);

  grp.position.set(x, 0, z);
  grp.rotation.y = heading;
  return grp;
}

/* ==================================================== BACKGROUND ANCHORS == */

export function buildArtsgarden(kit: LandmarkKit): void {
  const l = kit.locate(CFG.track.startFinish.x, CFG.track.startFinish.z, 0);
  const grp = new THREE.Group();

  /* PR5 Commit 8J: strengthen blue-green Artsgarden glazing while preserving geometry. */
  const glass = new THREE.MeshStandardMaterial({
    color: 0x2F7184, roughness: 0.12, metalness: 0.18,
    transparent: true, opacity: 0.54,
    envMapIntensity: QUALITY.envInt.glass, side: THREE.DoubleSide
  });
  const lattice = kit.solid(0x1B1F24, 0.38, 0.78, QUALITY.envInt.paint);
  const frame = kit.solid(0x20282D, 0.34, 0.76, QUALITY.envInt.paint);

  /* REHAB V1: the old rectangular bridge box is replaced by the barrel vault
     below; the old shallow crown (8E-8H) is removed with it. */
  /* ARTSGARDEN REHAB V2 — reference photo correction. V1's barrel vault was
     the wrong form entirely. The real Artsgarden is a rounded glass ROTUNDA:
     a circular drum of blue-green curtain glazing crowned by a segmented
     arched dome, sitting on a stone fascia base above the intersection, with
     a fine dark mullion grid over every panel. Like a glass lantern over the
     crossing, not a tunnel through it. */

  const DRUM_R = 9.0;
  const BASE_Y = 10.0;      // underside of the stone fascia = road clearance
  const DRUM_H = 7.6;       // glazing drum, BASE_Y -> DOME_Y
  const DOME_Y = BASE_Y + DRUM_H;

  /* Stone fascia base band (the sign band in the photo). */
  const fascia = kit.solid(0x9C8E7E, 0.7, 0.04, 0.5);
  const baseRing = new THREE.Mesh(
    new THREE.CylinderGeometry(DRUM_R + 0.7, DRUM_R + 0.7, 1.5, 32),
    fascia
  );
  baseRing.position.y = BASE_Y + 0.75;
  baseRing.castShadow = true;
  grp.add(baseRing);

  /* Glass drum: open cylinder. */
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(DRUM_R, DRUM_R, DRUM_H, 32, 1, true),
    glass
  );
  drum.position.y = BASE_Y + 1.5 + DRUM_H / 2;
  drum.castShadow = false;
  grp.add(drum);

  /* Fine mullion grid: 24 verticals + two rails. */
  const MULLS = 24;
  for (let m = 0; m < MULLS; m++) {
    const a = (m / MULLS) * Math.PI * 2;
    const mul = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, DRUM_H, 0.14),
      frame
    );
    mul.position.set(Math.cos(a) * DRUM_R, BASE_Y + 1.5 + DRUM_H / 2, Math.sin(a) * DRUM_R);
    mul.rotation.y = -a;
    mul.castShadow = true;
    grp.add(mul);
  }
  for (let railIdx = 0; railIdx < 2; railIdx++) {
    const railY = BASE_Y + 1.5 + DRUM_H * (0.38 + railIdx * 0.36);
    const rail = new THREE.Mesh(
      new THREE.CylinderGeometry(DRUM_R + 0.06, DRUM_R + 0.06, 0.16, 32, 1, true),
      frame
    );
    rail.position.y = railY;
    grp.add(rail);
  }

  /* Segmented arched dome: squashed hemisphere of glazing + radial ribs +
     a ring tie at the spring line. */
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(DRUM_R, 32, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    glass
  );
  dome.scale.y = 0.62;
  dome.position.y = DOME_Y;
  dome.castShadow = false;
  grp.add(dome);

  for (let m = 0; m < MULLS; m++) {
    const a = (m / MULLS) * Math.PI * 2;
    const rib = new THREE.Mesh(
      new THREE.TorusGeometry(DRUM_R, 0.11, 6, 20, Math.PI / 2),
      frame
    );
    /* Half-torus in a vertical plane rotated to azimuth a. */
    rib.rotation.z = 0;
    rib.rotation.y = -a;
    rib.scale.y = 0.62;
    rib.position.y = DOME_Y;
    rib.castShadow = true;
    grp.add(rib);
  }
  const domeRing = new THREE.Mesh(
    new THREE.CylinderGeometry(DRUM_R + 0.06, DRUM_R + 0.06, 0.2, 32, 1, true),
    frame
  );
  domeRing.position.y = DOME_Y + 0.1;
  grp.add(domeRing);

  /* PR5 Commit 8A: remove legacy orbital Artsgarden geometry; lower structure retained. */

  /* PR5 Commit 8B: bounded side attachments anchor the Artsgarden to the street wall. */
  const attachment = kit.solid(0x8A7566, 0.72, 0.10, QUALITY.envInt.paint);
  const attachmentSides = [-1, 1];
  for (let i = 0; i < attachmentSides.length; i++) {
    const mass = new THREE.Mesh(
      new THREE.BoxGeometry(12, 15, 9),
      attachment
    );
    mass.position.set(0, 12.5, attachmentSides[i] * 20.5);
    mass.castShadow = true;
    mass.receiveShadow = true;
    grp.add(mass);
  }
  /* REHAB V2.1 — glass connector corridors. The rotunda hangs above the
     crossing; the real structure ties into the adjacent buildings with glazed
     links so it does not float. Each link runs from the drum edge to its side
     attachment mass at drum-floor height. */
  for (let i = 0; i < attachmentSides.length; i++) {
    const sideZ = attachmentSides[i];
    const linkLen = sideZ * 20.5 - sideZ * DRUM_R;   // drum edge -> mass face
    const link = new THREE.Mesh(
      new THREE.BoxGeometry(6.5, 3.4, Math.abs(linkLen)),
      glass
    );
    link.position.set(0, BASE_Y + 3.4, sideZ * (DRUM_R + Math.abs(linkLen) / 2));
    link.castShadow = true;
    grp.add(link);
    /* Dark frame rails top and bottom of each link. */
    for (let rIdx = 0; rIdx < 2; rIdx++) {
      const railY = BASE_Y + 3.4 + (rIdx === 0 ? 1.75 : -1.75);
      const linkRail = new THREE.Mesh(
        new THREE.BoxGeometry(6.7, 0.22, Math.abs(linkLen)),
        frame
      );
      linkRail.position.set(0, railY, sideZ * (DRUM_R + Math.abs(linkLen) / 2));
      linkRail.castShadow = true;
      grp.add(linkRail);
    }
  }

  /* REHAB V2.1 — engraved name band on the fascia, matching the real
     "INDIANAPOLIS ARTSGARDEN" lettering. Canvas texture on a slightly proud
     band wrapping the drum base; dark incised letters on the stone. */
  {
    const nameCv = document.createElement('canvas');
    nameCv.width = 1024; nameCv.height = 96;
    const ng = nameCv.getContext('2d');
    if (ng) {
      ng.fillStyle = '#9C8E7E';
      ng.fillRect(0, 0, 1024, 96);
      /* Subtle stone grain. */
      for (let gIdx = 0; gIdx < 900; gIdx++) {
        const gx = (gIdx * 127.3) % 1024;
        const gy = (gIdx * 211.7) % 96;
        ng.fillStyle = gIdx % 2 === 0 ? 'rgba(60,52,44,0.05)' : 'rgba(255,250,240,0.05)';
        ng.fillRect(gx, gy, 2, 2);
      }
      ng.font = 'bold 54px Georgia, serif';
      ng.textAlign = 'center';
      ng.textBaseline = 'middle';
      ng.fillStyle = '#3A332B';
      ng.fillText('I N D I A N A P O L I S   A R T S G A R D E N', 512, 50);
      const nameTex = new THREE.CanvasTexture(nameCv);
      nameTex.colorSpace = THREE.SRGBColorSpace;
      nameTex.anisotropy = 4;
      const nameMat = new THREE.MeshStandardMaterial({
        map: nameTex, roughness: 0.7, metalness: 0.04
      });
      const nameBand = new THREE.Mesh(
        new THREE.CylinderGeometry(DRUM_R + 0.74, DRUM_R + 0.74, 1.3, 32, 1, true),
        nameMat
      );
      nameBand.position.y = BASE_Y + 0.75;
      grp.add(nameBand);
    }
  }

  /* PR5 Commit 8K: restrained facade identity for the Artsgarden side attachment masses. */
  /* PR5 Commit 8L: strengthen side-facade material contrast without changing geometry. */
  const facadeStone = kit.solid(0xA88D72, 0.72, 0.03, 0.58);
  const facadeWindow = kit.solid(0x24414E, 0.24, 0.30, QUALITY.envInt.glass);
  const facadeFrontX = -6.10;
  const facadeBayOffsets = [-2.4, 0, 2.4];
  const facadePilasterOffsets = [-3.65, -1.2, 1.2, 3.65];
  for (let i = 0; i < attachmentSides.length; i++) {
    const sideZ = attachmentSides[i] * 20.5;

    const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.30, 1.45, 9.2), facadeStone);
    plinth.position.set(facadeFrontX, 5.75, sideZ);
    plinth.castShadow = true;
    grp.add(plinth);

    const cornice = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.52, 9.45), facadeStone);
    cornice.position.set(0, 20.16, sideZ);
    cornice.castShadow = true;
    cornice.receiveShadow = true;
    grp.add(cornice);

    for (let b = 0; b < facadeBayOffsets.length; b++) {
      const bay = new THREE.Mesh(new THREE.BoxGeometry(0.18, 8.6, 1.45), facadeWindow);
      bay.position.set(facadeFrontX - 0.02, 13.05, sideZ + facadeBayOffsets[b]);
      bay.castShadow = false;
      grp.add(bay);
    }

    for (let p = 0; p < facadePilasterOffsets.length; p++) {
      const pilaster = new THREE.Mesh(new THREE.BoxGeometry(0.28, 12.2, 0.30), facadeStone);
      pilaster.position.set(facadeFrontX - 0.05, 13.0, sideZ + facadePilasterOffsets[p]);
      pilaster.castShadow = true;
      grp.add(pilaster);
    }

    const bridgeJamb = new THREE.Mesh(new THREE.BoxGeometry(0.34, 10.2, 0.62), frame);
    bridgeJamb.position.set(facadeFrontX - 0.06, 14.5, attachmentSides[i] * 16.05);
    bridgeJamb.castShadow = true;
    grp.add(bridgeJamb);
  }
  /* PR5 Commit 8M: final side-mass proportion cleanup with bounded architectural trim. */
  const proportionBandY = [9.15, 16.85];
  for (let i = 0; i < attachmentSides.length; i++) {
    const sideZ = attachmentSides[i] * 20.5;

    for (let b = 0; b < proportionBandY.length; b++) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(12.25, 0.30, 9.25), facadeStone);
      band.position.set(0, proportionBandY[b], sideZ);
      band.castShadow = true;
      band.receiveShadow = true;
      grp.add(band);
    }

    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.4, 2.2), facadeStone);
    shoulder.position.set(-4.55, 17.55, attachmentSides[i] * 16.85);
    shoulder.castShadow = true;
    shoulder.receiveShadow = true;
    grp.add(shoulder);

    const shoulderWindow = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.45, 1.10), facadeWindow);
    shoulderWindow.position.set(-6.18, 17.45, attachmentSides[i] * 16.85);
    grp.add(shoulderWindow);
  }
  /* Support legs clear of the carriageway. */
  const sides = [-1, 1];
  for (let i = 0; i < sides.length; i++) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(5.0, 10.0, 5.0), frame);
    leg.position.set(0, 5, sides[i] * 23);
    leg.castShadow = true;
    leg.receiveShadow = true;
    grp.add(leg);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.30, 12, 10), frame);
    strut.position.set(0, 11.5, sides[i] * 19.5);
    strut.rotation.x = sides[i] * 0.42;
    strut.castShadow = true;
    grp.add(strut);
  }

  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 5.4),
    new THREE.MeshBasicMaterial({ map: kit.SF_BANNER, side: THREE.DoubleSide })
  );
  banner.position.set(0, 8.6, 0);
  banner.rotation.y = -Math.PI / 2; // flip the visible banner face so text reads forwards
  grp.add(banner);

  grp.position.set(l.px, 0, l.pz);
  grp.rotation.y = -Math.atan2(l.tz, l.tx);
  seal(kit, grp);
}

/* PR5 Commit 9A: reference-matched Washington left frontage massing.
   Local +X follows race direction; local +Z is the driver's left side.
   Massing order toward the Artsgarden follows the supplied street reference:
   dark tower -> pale historic midrise -> low warm podium. */
export function buildWashingtonReferenceFrontage(kit: LandmarkKit): void {
  const l = kit.locate(CFG.track.startFinish.x, CFG.track.startFinish.z, 0);
  const grp = new THREE.Group();

  /* PR5 Commit 9E: material/color balance only; frontage geometry is unchanged. */
  const darkTower = kit.solid(0x1D2730, 0.30, 0.60, QUALITY.envInt.facade);
  const historicStone = kit.solid(0xBDAE95, 0.76, 0.03, QUALITY.envInt.facade);
  const podiumStone = kit.solid(0x8E7059, 0.72, 0.04, QUALITY.envInt.facade);

  /* PR5 Commit 9C: mirror reference frontage to the driver's left (-Z). */
  const LEFT_Z = -35;
  const frontage = [
    { x: -78, w: 28, d: 18, h: 68, mat: darkTower },
    { x: -48, w: 30, d: 18, h: 46, mat: historicStone },
    { x: -20, w: 26, d: 18, h: 18, mat: podiumStone }
  ];

  for (let i = 0; i < frontage.length; i++) {
    const b = frontage[i];
    const mass = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), b.mat);
    mass.position.set(b.x, b.h * 0.5, LEFT_Z);
    mass.castShadow = true;
    mass.receiveShadow = true;
    grp.add(mass);
  }

  /* PR5 Commit 9B: reference-matched facade identity; F1 massing remains unchanged. */
  const frontageWindow = kit.solid(0x1F3743, 0.22, 0.38, QUALITY.envInt.facade);
  const towerMullion = kit.solid(0x66727A, 0.34, 0.62, QUALITY.envInt.facade);
  const historicTrim = kit.solid(0xD0C2AA, 0.80, 0.02, QUALITY.envInt.facade);
  const storefront = kit.solid(0x2B3E46, 0.28, 0.22, QUALITY.envInt.facade);
  const STREET_FACE_Z = -25.88;

  /* Dark foreground tower: vertical metal/glass rhythm, deliberately not a checkerboard. */
  const towerMullionX = [-88.5, -84.0, -79.5, -75.0, -70.5, -67.5];
  for (let i = 0; i < towerMullionX.length; i++) {
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(0.42, 61.0, 0.24), towerMullion);
    mullion.position.set(towerMullionX[i], 34.5, STREET_FACE_Z);
    mullion.castShadow = true;
    grp.add(mullion);
  }
  const towerSpandrelY = [13.5, 26.0, 38.5, 51.0];
  for (let i = 0; i < towerSpandrelY.length; i++) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(27.4, 0.34, 0.22), towerMullion);
    band.position.set(-78, towerSpandrelY[i], STREET_FACE_Z - 0.01);
    grp.add(band);
  }

  /* Historic pale midrise: tall recessed bays, stone piers, pronounced cornice. */
  const historicWindowX = [-59.0, -54.6, -50.2, -45.8, -41.4, -37.0];
  for (let i = 0; i < historicWindowX.length; i++) {
    const bay = new THREE.Mesh(new THREE.BoxGeometry(2.45, 25.5, 0.22), frontageWindow);
    bay.position.set(historicWindowX[i], 26.0, STREET_FACE_Z);
    grp.add(bay);
  }
  const historicPierX = [-61.8, -56.8, -52.4, -48.0, -43.6, -39.2, -34.8];
  for (let i = 0; i < historicPierX.length; i++) {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(0.48, 30.5, 0.28), historicTrim);
    pier.position.set(historicPierX[i], 26.0, STREET_FACE_Z - 0.02);
    pier.castShadow = true;
    grp.add(pier);
  }
  const historicGround = new THREE.Mesh(new THREE.BoxGeometry(29.4, 7.2, 0.24), storefront);
  historicGround.position.set(-48, 5.1, STREET_FACE_Z);
  grp.add(historicGround);

  const historicCornice = new THREE.Mesh(new THREE.BoxGeometry(31.0, 1.10, 19.0), historicTrim);
  historicCornice.position.set(-48, 44.8, -35);
  historicCornice.castShadow = true;
  historicCornice.receiveShadow = true;
  grp.add(historicCornice);

  const historicParapet = new THREE.Mesh(new THREE.BoxGeometry(26.0, 1.35, 18.5), historicTrim);
  historicParapet.position.set(-48, 46.4, -35);
  historicParapet.castShadow = true;
  grp.add(historicParapet);

  /* Low warm podium: continuous storefront rhythm toward the Artsgarden. */
  const storefrontX = [-29.0, -23.0, -17.0, -11.0];
  for (let i = 0; i < storefrontX.length; i++) {
    const shop = new THREE.Mesh(new THREE.BoxGeometry(4.6, 7.0, 0.24), storefront);
    shop.position.set(storefrontX[i], 5.2, STREET_FACE_Z);
    grp.add(shop);
  }
  const podiumCap = new THREE.Mesh(new THREE.BoxGeometry(26.4, 0.58, 18.4), historicTrim);
  podiumCap.position.set(-20, 16.5, -35);
  podiumCap.castShadow = true;
  podiumCap.receiveShadow = true;
  grp.add(podiumCap);
  /* PR5 Commit 9D: layered background massing behind the driver's-left street wall. */
  const rearDark = kit.solid(0x2A343D, 0.46, 0.38, QUALITY.envInt.facade);
  const rearLight = kit.solid(0xAAA49A, 0.80, 0.04, QUALITY.envInt.facade);
  const rearWarm = kit.solid(0x705449, 0.76, 0.05, QUALITY.envInt.facade);

  const rearMassing = [
    { x: -76, z: -55, w: 24, d: 18, h: 96, mat: rearDark },
    { x: -43, z: -56, w: 22, d: 18, h: 78, mat: rearLight },
    { x: -14, z: -52, w: 20, d: 14, h: 54, mat: rearWarm }
  ];

  for (let i = 0; i < rearMassing.length; i++) {
    const b = rearMassing[i];
    const mass = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), b.mat);
    mass.position.set(b.x, b.h * 0.5, b.z);
    mass.castShadow = true;
    mass.receiveShadow = true;
    grp.add(mass);
  }

  /* Simple setbacks create the stepped roofline visible in the reference canyon. */
  const rearDarkCap = new THREE.Mesh(new THREE.BoxGeometry(19, 11, 14), rearDark);
  rearDarkCap.position.set(-76, 101.5, -55);
  rearDarkCap.castShadow = true;
  grp.add(rearDarkCap);

  const rearLightCap = new THREE.Mesh(new THREE.BoxGeometry(16, 9, 14), rearLight);
  rearLightCap.position.set(-43, 82.5, -56);
  rearLightCap.castShadow = true;
  grp.add(rearLightCap);
  grp.position.set(l.px, 0, l.pz);
  grp.rotation.y = -Math.atan2(l.tz, l.tx);
  seal(kit, grp);
}
export function buildSkylineAnchors(kit: LandmarkKit): void {
  const T = kit.TEX;

  /* --- JW Marriott: the curved blue curtain wall on West St ----------------
     PLACEMENT FIX INDYGP-MARRIOTT-FIX-V1

     The previous build authored this in world space with the arc centre at
     x = -185 and a 90 m radius. Because Three's CylinderGeometry measures
     theta from +z rather than +x, the generated arc landed around
     x -212..-92, z 68..185, which is squarely on top of the Maryland Street
     diagonal running from Turn 7 (0, 130) out toward (-160, 90). The building
     was not near the West Street straight at all, which is why an x-only
     corridor test would never have caught it.

     It is now authored entirely in local space with the facade on local +x,
     dropped at the surveyed anchor and yawed so the concave sweep opens
     east-south-east, cupping the West Street straight the driver climbs into
     Turn 7.

     One deliberate asymmetry. The anchor sits exactly midway between
     Washington and Maryland as specified, but the mass is biased 19 m toward
     the north-north-east inside its own frame. With the facade pointing ESE
     the slab's long axis necessarily runs NNE to SSW, which is almost exactly
     perpendicular to the Maryland diagonal, so every metre of length toward
     the south-west spends a metre of the 44.9 m budget between the anchor and
     that centreline. Biasing the mass buys an 82 m facade instead of the 40 m
     one a symmetric slab would have been limited to. */
  {
    const grp = new THREE.Group();

    /* Surveyed anchor, exactly as directed. */
    const ANCHOR_X = -75;
    const ANCHOR_Z = 65;

    /* Compass bearing of the facade normal. East-south-east. Bearings run
       clockwise from north, and in this frame north is -z and east is +x, so a
       group yaw of (90 - bearing) degrees maps local +x onto that bearing. */
    const FACADE_BEARING = 112.5;
    const YAW = (90 - FACADE_BEARING) * Math.PI / 180;

    const H = 116;                                    // 34 storeys
    const R = 74;                                     // radius of curvature
    const HALF_CHORD = 41;                            // 82 m of glass
    const HALF_ANGLE = Math.asin(HALF_CHORD / R);
    const SAG = R * (1 - Math.cos(HALF_ANGLE));       // 12.4 m of sweep
    const BIAS = -19;                                 // lean away from Maryland
    const BACK = -32;                                 // rear face of the slab

    const blueGlass = new THREE.MeshStandardMaterial({
      color: 0x2E68A8, roughness: 0.055, metalness: 0.88,
      envMapIntensity: 1.55, side: THREE.DoubleSide
    });
    const spandrel = kit.solid(0x1B3A57, 0.44, 0.55, 1.0);
    const mullion = kit.solid(0x141C26, 0.38, 0.70, 0.9);
    const podiumStone = kit.pbr(T.limestonePier, {
      envIntensity: QUALITY.envInt.stone, normalScale: 0.7,
      emissiveIntensity: 1.05, repeatX: 5, repeatY: 1
    });

    /* Concave curtain wall. The cylinder axis sits at local +R, so the arc
       swept around local -x is the inside of the bowl and it opens toward
       local +x. DoubleSide keeps the lighting correct from the open side,
       because Three flips the shading normal on back faces. Theta is centred
       on -PI/2, which is the -x direction in CylinderGeometry's convention. */
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, H, 48, 1, true,
        -Math.PI / 2 - HALF_ANGLE, HALF_ANGLE * 2),
      blueGlass
    );
    wall.position.set(R, H / 2, BIAS);
    wall.castShadow = true;
    wall.receiveShadow = true;
    grp.add(wall);

    /* Horizontal floor bands standing 0.45 m proud of the glass. These are
       what make the curve legible at speed; a smooth cylinder reads flat. */
    for (let f = 5.5; f < H - 4; f += 7.6) {
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(R - 0.45, R - 0.45, 0.5, 48, 1, true,
          -Math.PI / 2 - HALF_ANGLE, HALF_ANGLE * 2),
        spandrel
      );
      band.position.set(R, f, BIAS);
      band.receiveShadow = true;
      grp.add(band);
    }

    /* Vertical mullion fins marching across the sweep. Each is rotated to sit
       normal to the arc: at arc angle a the inward normal is (cos a, -sin a),
       and a box with rotation.y = a maps its local +x onto exactly that. */
    const FINS = 13;
    for (let i = 0; i <= FINS; i++) {
      const a = -HALF_ANGLE + (i / FINS) * HALF_ANGLE * 2;
      const fx = R - R * Math.cos(a);
      const fz = BIAS + R * Math.sin(a);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.9, H - 5, 0.45), mullion);
      fin.position.set(fx + 0.32, (H - 5) / 2 + 1.5, fz);
      fin.rotation.y = a;
      fin.castShadow = true;
      grp.add(fin);
    }

    /* Rear slab, closing the plan and carrying the service elevations. */
    const core = new THREE.Mesh(new THREE.BoxGeometry(34, H, 77), spandrel);
    core.position.set((BACK + 2) / 2, H / 2, BIAS);
    core.castShadow = true;
    core.receiveShadow = true;
    grp.add(core);

    /* Mechanical crown and parapet. */
    const crown = new THREE.Mesh(new THREE.BoxGeometry(40, 4.5, 72), spandrel);
    crown.position.set(-8, H + 2.25, BIAS);
    crown.castShadow = true;
    crown.receiveShadow = true;
    grp.add(crown);

    const parapet = new THREE.Mesh(new THREE.BoxGeometry(42, 1.6, 74), mullion);
    parapet.position.set(-8, H + 5.3, BIAS);
    parapet.castShadow = true;
    grp.add(parapet);

    /* Limestone podium and the porte-cochere canopy facing the street. */
    const podium = new THREE.Mesh(new THREE.BoxGeometry(46, 7.5, 82), podiumStone);
    podium.position.set(-11, 3.75, BIAS);
    podium.castShadow = true;
    podium.receiveShadow = true;
    grp.add(podium);

    const canopy = new THREE.Mesh(new THREE.BoxGeometry(9, 0.7, 26), mullion);
    canopy.position.set(15, 7.2, BIAS + 4);
    canopy.castShadow = true;
    grp.add(canopy);

    for (let c = -1; c <= 1; c += 2) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.34, 6.9, 12), mullion);
      post.position.set(18.6, 3.45, BIAS + 4 + c * 11);
      post.castShadow = true;
      grp.add(post);
    }

    grp.position.set(ANCHOR_X, 0, ANCHOR_Z);
    grp.rotation.y = YAW;

    /* Directive 3. Verified against the driving slab and, more usefully,
       against the true centreline distance. Runs before seal() so any nudge is
       baked in before the culler records the bounds. */
    corridorGuard(kit, grp, 'JW Marriott', 16);
    seal(kit, grp);
  }

  /* --- Lucas Oil Stadium: red brick mass with a retractable roof ----------- */
  {
    const grp = new THREE.Group();
    const brick = kit.pbr(T.bankBrick, {
      envIntensity: QUALITY.envInt.facade, normalScale: 0.7,
      emissiveIntensity: 0.7, repeatX: 9, repeatY: 3
    });
    const stone = kit.pbr(T.monumentStone, {
      envIntensity: QUALITY.envInt.stone, normalScale: 0.6, repeatX: 8, repeatY: 1
    });
    const steel = kit.solid(0x767C84, 0.40, 0.80, 1.0);
    const glassWall = new THREE.MeshStandardMaterial({
      color: 0x33566E, roughness: 0.07, metalness: 0.85, envMapIntensity: 1.3
    });

    const CX = 410, CZ = 520, W = 190, D = 145, HB = 30;
    add(grp, box(W, HB, D), brick, CX, HB / 2, CZ);
    add(grp, box(W + 2.5, 2.0, D + 2.5), stone, CX, HB + 1.0, CZ);

    /* The great north window wall facing downtown. */
    const win = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.62, HB * 0.72), glassWall);
    win.position.set(CX, HB * 0.46, CZ - D / 2 - 0.4);
    win.receiveShadow = true;
    grp.add(win);

    /* Sloped upper bowl and the two roof panels. */
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.44, W * 0.50, 18, 4, 1, false, Math.PI / 4), steel);
    bowl.position.set(CX, HB + 10, CZ);
    bowl.castShadow = true;
    grp.add(bowl);
    const panels = [-1, 1];
    for (let i = 0; i < panels.length; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(W * 0.40, 2.2, D * 0.68), steel);
      p.position.set(CX + panels[i] * W * 0.21, HB + 20.5, CZ);
      p.castShadow = true;
      grp.add(p);
    }
    /* Corner masts. */
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (let i = 0; i < corners.length; i++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.6, 46, 10), steel);
      m.position.set(CX + corners[i][0] * W * 0.46, 23, CZ + corners[i][1] * D * 0.44);
      m.castShadow = true;
      grp.add(m);
    }
    seal(kit, grp);
  }

  /* --- Victory Field: scaled district anchor, open toward West St ---------- */
  {
    const grp = new THREE.Group();
    const brick = kit.pbr(T.commercialBrick, {
      envIntensity: QUALITY.envInt.facade, normalScale: 0.8, emissiveIntensity: 1.1
    });
    const concourse = kit.pbr(T.arenaBase, {
      envIntensity: QUALITY.envInt.stone, normalScale: 0.65, repeatX: 4, repeatY: 1
    });
    const steel = kit.solid(0x727983, 0.42, 0.78, 0.95);
    const turf = kit.solid(0x2B6E38, 0.94, 0.02, 0.22);
    const dirt = kit.solid(0x8A6646, 0.96, 0.01, 0.16);
    const fence = kit.solid(0x183825, 0.68, 0.20, 0.55);

    const CX = WEST - 190;
    const CZ = 180;
    const RX = 84;
    const RZ = 62;
    const BOWL_H = 14;

    const podium = new THREE.Mesh(new THREE.BoxGeometry(RX * 2.0, 4.0, RZ * 2.0), concourse);
    podium.position.set(CX, 2.1, CZ);
    podium.castShadow = true;
    podium.receiveShadow = true;
    grp.add(podium);

    /* U-shaped grandstand, intentionally open on the east side toward West St. */
    const westStand = new THREE.Mesh(new THREE.BoxGeometry(34, BOWL_H, 92), brick);
    westStand.position.set(CX - 46, BOWL_H / 2 + 4.2, CZ);
    westStand.castShadow = true;
    westStand.receiveShadow = true;
    grp.add(westStand);
    const northStand = new THREE.Mesh(new THREE.BoxGeometry(104, BOWL_H, 22), brick);
    northStand.position.set(CX - 12, BOWL_H / 2 + 4.2, CZ - 47);
    northStand.castShadow = true;
    northStand.receiveShadow = true;
    grp.add(northStand);
    const southStand = new THREE.Mesh(new THREE.BoxGeometry(104, BOWL_H, 22), brick);
    southStand.position.set(CX - 12, BOWL_H / 2 + 4.2, CZ + 47);
    southStand.castShadow = true;
    southStand.receiveShadow = true;
    grp.add(southStand);

    const capW = new THREE.Mesh(new THREE.BoxGeometry(35.6, 1.0, 93.6), steel);
    capW.position.set(CX - 46, BOWL_H + 4.7, CZ);
    capW.castShadow = true;
    grp.add(capW);
    const capN = new THREE.Mesh(new THREE.BoxGeometry(105.6, 1.0, 23.6), steel);
    capN.position.set(CX - 12, BOWL_H + 4.7, CZ - 47);
    capN.castShadow = true;
    grp.add(capN);
    const capS = new THREE.Mesh(new THREE.BoxGeometry(105.6, 1.0, 23.6), steel);
    capS.position.set(CX - 12, BOWL_H + 4.7, CZ + 47);
    capS.castShadow = true;
    grp.add(capS);

    const field = new THREE.Mesh(new THREE.CircleGeometry(54, 36), turf);
    field.scale.set(1.18, 1, 0.82);
    field.rotation.x = -Math.PI / 2;
    field.position.set(CX + 18, 0.06, CZ + 1);
    field.receiveShadow = true;
    grp.add(field);

    const infield = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), dirt);
    infield.rotation.x = -Math.PI / 2;
    infield.rotation.z = Math.PI / 4;
    infield.position.set(CX + 12, 0.08, CZ + 4.8);
    infield.receiveShadow = true;
    grp.add(infield);

    const mound = new THREE.Mesh(new THREE.CircleGeometry(2.6, 12), dirt);
    mound.rotation.x = -Math.PI / 2;
    mound.position.set(CX + 12, 0.085, CZ + 4.8);
    grp.add(mound);

    const chalk = kit.solid(0xF1EEE5, 0.9, 0.0, 0.12);
    const foulLeft = new THREE.Mesh(new THREE.BoxGeometry(58, 0.05, 0.28), chalk);
    foulLeft.position.set(CX + 24, 0.10, CZ + 24);
    foulLeft.rotation.y = Math.PI * 0.25;
    grp.add(foulLeft);
    const foulRight = new THREE.Mesh(new THREE.BoxGeometry(58, 0.05, 0.28), chalk);
    foulRight.position.set(CX + 24, 0.10, CZ - 14.5);
    foulRight.rotation.y = -Math.PI * 0.25;
    grp.add(foulRight);
    for (let b = 0; b < 4; b++) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.9), chalk);
      if (b === 0) base.position.set(CX + 12, 0.1, CZ + 4.8);
      if (b === 1) base.position.set(CX + 22, 0.1, CZ + 14.8);
      if (b === 2) base.position.set(CX + 32, 0.1, CZ + 4.8);
      if (b === 3) base.position.set(CX + 22, 0.1, CZ -5.2);
      grp.add(base);
    }

    const outfieldWall = new THREE.Mesh(
      new THREE.CylinderGeometry(54, 54, 4.8, 30, 1, true, Math.PI * 0.58, Math.PI * 0.96),
      fence
    );
    outfieldWall.scale.z = 0.80;
    outfieldWall.position.set(CX + 10, 2.4, CZ + 1.5);
    outfieldWall.castShadow = true;
    outfieldWall.receiveShadow = true;
    grp.add(outfieldWall);

    const board = new THREE.Mesh(new THREE.BoxGeometry(14, 7.2, 2.8), steel);
    board.position.set(CX - 32, 10.0, CZ - 30);
    board.castShadow = true;
    board.receiveShadow = true;
    grp.add(board);
    const boardFace = new THREE.Mesh(new THREE.PlaneGeometry(11.4, 5.8), kit.solid(0x0F1720, 0.45, 0.2, 0.18));
    boardFace.position.set(CX - 32, 10.0, CZ - 31.55);
    grp.add(boardFace);

    for (let i = 0; i < 4; i++) {
      const sx = (i < 2) ? -1 : 1;
      const sz = (i % 2 === 0) ? -1 : 1;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 24, 10), steel);
      mast.position.set(CX + sx * 66, 14, CZ + sz * 48);
      mast.castShadow = true;
      grp.add(mast);

      const bar = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.38, 1.2), steel);
      bar.position.set(CX + sx * 66, 25, CZ + sz * 48);
      bar.castShadow = true;
      grp.add(bar);
    }

    seal(kit, grp);
  }

  /* Gainbridge Fieldhouse has moved to buildPennSector, where it is built
     from the corridor photography rather than as a generic skyline anchor. */
}

/* ============================================ PENNSYLVANIA STREET SECTOR ==
   INDYGP-PENN-V1

   Turn 4 (Market St) south to Turn 5 (South St), built from the three
   reference photographs:

     1  the Union Station railway viaduct crossing Pennsylvania in a cut, with
        heavy flanking retaining walls, rusted plate girders and an aged
        concrete deck
     2  Gainbridge Fieldhouse on the east side, barrel-vault roof over a
        limestone base, red brick and dark tinted curtain wall, with the
        vertical banner on the corner facing the oncoming driver
     3  dark brick commercial mid-rises lining the west side, uniform punched
        windows and flat parapets, closing the canyon

   ONE HONEST LIMITATION. Photo 1 shows Pennsylvania genuinely sunken beneath
   the railway, with retaining walls rising well above the roadway. The circuit
   is planar: every centreline sample sits at y = 0 and Layer 4 has no vertical
   channel at all, so the road cannot dip. The walls here therefore rise from
   y = 0 instead of the road falling away from them. From inside the cockpit
   the corridor reads correctly; from the trackside-high camera the missing cut
   is visible. Fixing it properly means giving the centreline an elevation
   channel, which is a physics contract change, not a rendering one. */

export function buildPennSector(kit: LandmarkKit): void {
  const T = kit.TEX;

  const concreteMat = kit.pbr(T.bridgeConcrete, {
    envIntensity: QUALITY.envInt.stone, normalScale: 0.9, repeatX: 3, repeatY: 2
  });
  const concreteFine = kit.pbr(T.bridgeConcrete, {
    envIntensity: QUALITY.envInt.stone, normalScale: 0.75, repeatX: 6, repeatY: 1
  });
  const wallMat = kit.pbr(T.tunnelWall, {
    envIntensity: QUALITY.envInt.wall, normalScale: 0.95,
    aniso: QUALITY.tex.anisotropyGrazing
  });
  const steelMat = kit.pbr(T.rustedSteel, {
    envIntensity: 0.75, normalScale: 1.0, repeatX: 8, repeatY: 1
  });
  const soffitMat = kit.pbr(T.deckSoffit, {
    envIntensity: 0.30, normalScale: 0.85, repeatX: 5, repeatY: 3
  });
  const arenaBrickMat = kit.pbr(T.arenaBrick, {
    envIntensity: QUALITY.envInt.facade, normalScale: 0.8, repeatX: 1, repeatY: 1
  });
  const arenaGlassMat = kit.pbr(T.arenaGlass, {
    envIntensity: QUALITY.envInt.glass, normalScale: 0.7, emissiveIntensity: 1.35
  });
  const arenaBaseMat = kit.pbr(T.arenaBase, {
    envIntensity: QUALITY.envInt.stone, normalScale: 0.8, repeatX: 4, repeatY: 1
  });
  const commercialMat = kit.pbr(T.commercialBrick, {
    envIntensity: QUALITY.envInt.facade, normalScale: 0.8, emissiveIntensity: 1.3
  });
  const roofMat = kit.pbr(T.roof, {
    envIntensity: QUALITY.envInt.ground, normalScale: 0.5, repeatX: 4, repeatY: 4
  });
  const vaultMat = kit.solid(0xB9BDC0, 0.34, 0.62, 1.05);
  const trimMat = kit.solid(0x1A1E22, 0.42, 0.66, 0.85);
  const ballastMat = kit.solid(0x40403C, 0.96, 0.02, 0.30);
  const railMat = kit.solid(0x7A6A5C, 0.42, 0.80, 0.95);

  /* ------------------------------------------------- UNION STATION VIADUCT -
     Deck section, bottom up:
       0.00 .. 7.20  clear opening for the carriageway
       7.20 .. 8.40  rusted plate girders spanning east to west
       8.40 .. 10.00 concrete deck slab
      10.00 .. 11.30 parapet
      10.00 ..       ballast, sleepers and rail on the deck                */
  {
    const grp = new THREE.Group();

    const CLEAR = 7.20;        // underside of the girders
    const GIRDER = 1.20;
    const SLAB = 1.60;
    const PARAPET = 1.30;
    const SPAN_X = 44;         // deck length across the road
    const DEPTH_Z = 16;        // how long the tunnel is along the road
    const ABUT_INNER = 12.0;   // inner face of the abutments, |x| from centreline
    const ABUT_THICK = 7.0;

    const girderY = CLEAR + GIRDER / 2;
    const slabY = CLEAR + GIRDER + SLAB / 2;
    const deckTop = CLEAR + GIRDER + SLAB;

    /* Abutments. Inner faces sit 12 m from the centreline, comfortably outside
       the 9.4 m barrier line, so they carry the deck without ever entering the
       driving corridor. */
    const sides = [-1, 1];
    for (let s = 0; s < sides.length; s++) {
      const sx = sides[s];
      const cx = PENN + sx * (ABUT_INNER + ABUT_THICK / 2);
      const abut = new THREE.Mesh(
        new THREE.BoxGeometry(ABUT_THICK, CLEAR + GIRDER, DEPTH_Z + 2),
        concreteMat
      );
      abut.position.set(cx, (CLEAR + GIRDER) / 2, UNDERPASS_Z);
      abut.castShadow = true;
      abut.receiveShadow = true;
      grp.add(abut);

      /* Bearing shelf the girders sit on. */
      const shelf = new THREE.Mesh(
        new THREE.BoxGeometry(ABUT_THICK + 1.2, 0.7, DEPTH_Z + 2.6),
        concreteFine
      );
      shelf.position.set(cx, CLEAR - 0.35, UNDERPASS_Z);
      shelf.castShadow = true;
      shelf.receiveShadow = true;
      grp.add(shelf);

      /* Flanking retaining walls running out along the road, tapering down.
         These are what make the corridor read as a cut from inside the car. */
      const runs = [-1, 1];
      for (let r = 0; r < runs.length; r++) {
        const dir = runs[r];
        for (let seg = 0; seg < 4; seg++) {
          const segLen = 11;
          const h = 7.4 - seg * 1.45;
          const zc = UNDERPASS_Z + dir * (DEPTH_Z / 2 + 1.5 + segLen * (seg + 0.5));
          const wall = new THREE.Mesh(new THREE.BoxGeometry(2.2, h, segLen), wallMat);
          wall.position.set(PENN + sx * (ABUT_INNER + 1.1), h / 2, zc);
          wall.castShadow = true;
          wall.receiveShadow = true;
          grp.add(wall);

          const cope = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.45, segLen), concreteFine);
          cope.position.set(PENN + sx * (ABUT_INNER + 1.1), h + 0.22, zc);
          cope.castShadow = true;
          grp.add(cope);
        }
      }

      /* Splayed wing walls at each mouth. */
      for (let r = 0; r < runs.length; r++) {
        const dir = runs[r];
        const wing = new THREE.Mesh(new THREE.BoxGeometry(ABUT_THICK, 8.6, 9), concreteMat);
        wing.position.set(cx + sx * 1.6, 4.3, UNDERPASS_Z + dir * (DEPTH_Z / 2 + 4));
        wing.rotation.y = -sx * dir * 0.20;
        wing.castShadow = true;
        wing.receiveShadow = true;
        grp.add(wing);
      }
    }

    /* Plate girders. Seven of them spanning east to west, spaced along the
       road, each with a top and bottom flange and a web between. */
    const GIRDERS = 7;
    for (let i = 0; i < GIRDERS; i++) {
      const gz = UNDERPASS_Z - DEPTH_Z / 2 + (DEPTH_Z / (GIRDERS - 1)) * i;
      const web = new THREE.Mesh(new THREE.BoxGeometry(SPAN_X, GIRDER, 0.30), steelMat);
      web.position.set(PENN, girderY, gz);
      web.castShadow = true;
      web.receiveShadow = true;
      grp.add(web);

      const flangeGeo = new THREE.BoxGeometry(SPAN_X, 0.16, 0.90);
      const lower = new THREE.Mesh(flangeGeo, steelMat);
      lower.position.set(PENN, CLEAR + 0.08, gz);
      lower.castShadow = true;
      lower.receiveShadow = true;
      grp.add(lower);

      const upper = new THREE.Mesh(flangeGeo.clone(), steelMat);
      upper.position.set(PENN, CLEAR + GIRDER - 0.08, gz);
      upper.castShadow = true;
      grp.add(upper);
    }

    /* Cross bracing between the girders, visible from directly underneath. */
    for (let i = 0; i < GIRDERS - 1; i++) {
      const z0 = UNDERPASS_Z - DEPTH_Z / 2 + (DEPTH_Z / (GIRDERS - 1)) * (i + 0.5);
      for (let bx = -1; bx <= 1; bx++) {
        const brace = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, 0.22, DEPTH_Z / (GIRDERS - 1) * 1.05),
          steelMat
        );
        brace.position.set(PENN + bx * 13, girderY, z0);
        grp.add(brace);
      }
    }

    /* Soffit panel: a single dark plane closing the ceiling between the
       girders, which is what actually sells the tunnel from the cockpit. */
    const soffitGeo = new THREE.PlaneGeometry(SPAN_X - 1, DEPTH_Z);
    soffitGeo.rotateX(Math.PI / 2);
    const soffit = new THREE.Mesh(soffitGeo, soffitMat);
    soffit.position.set(PENN, CLEAR + GIRDER - 0.02, UNDERPASS_Z);
    soffit.receiveShadow = true;
    grp.add(soffit);

    /* Deck slab and its fascia beams. */
    const slab = new THREE.Mesh(new THREE.BoxGeometry(SPAN_X, SLAB, DEPTH_Z), concreteMat);
    slab.position.set(PENN, slabY, UNDERPASS_Z);
    slab.castShadow = true;
    slab.receiveShadow = true;
    grp.add(slab);

    const faces = [-1, 1];
    for (let f = 0; f < faces.length; f++) {
      const fz = UNDERPASS_Z + faces[f] * (DEPTH_Z / 2 + 0.35);
      const fascia = new THREE.Mesh(new THREE.BoxGeometry(SPAN_X + 1.4, SLAB + 0.9, 0.7), concreteFine);
      fascia.position.set(PENN, slabY - 0.2, fz);
      fascia.castShadow = true;
      fascia.receiveShadow = true;
      grp.add(fascia);

      const parapet = new THREE.Mesh(new THREE.BoxGeometry(SPAN_X + 1.4, PARAPET, 0.62), concreteMat);
      parapet.position.set(PENN, deckTop + PARAPET / 2, fz);
      parapet.castShadow = true;
      parapet.receiveShadow = true;
      grp.add(parapet);
    }

    /* Ballast, sleepers and two rails on the deck. */
    const ballast = new THREE.Mesh(new THREE.BoxGeometry(SPAN_X - 2, 0.85, DEPTH_Z - 2.2), ballastMat);
    ballast.position.set(PENN, deckTop + 0.42, UNDERPASS_Z);
    ballast.castShadow = true;
    ballast.receiveShadow = true;
    grp.add(ballast);

    const sleeperGeo = new THREE.BoxGeometry(2.6, 0.22, 0.28);
    const sleeperMat = kit.solid(0x2B2018, 0.94, 0.0, 0.25);
    for (let sZ = -6; sZ <= 6; sZ++) {
      const sl = new THREE.Mesh(sleeperGeo, sleeperMat);
      sl.position.set(PENN, deckTop + 0.94, UNDERPASS_Z + sZ * 1.0);
      sl.castShadow = true;
      grp.add(sl);
    }
    for (let rail = -1; rail <= 1; rail += 2) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, DEPTH_Z - 2.6), railMat);
      r.position.set(PENN + rail * 0.72, deckTop + 1.12, UNDERPASS_Z);
      r.castShadow = true;
      grp.add(r);
    }

    /* Emissive sodium fixtures on the soffit, and their positions published
       for world.ts to hang real PointLights on. */
    PENN_TUNNEL_LIGHTS.length = 0;
    const fixtureMat = new THREE.MeshStandardMaterial({
      color: 0x3A2A10, emissive: 0xFFC15E, emissiveIntensity: 3.1,
      roughness: 0.42, metalness: 0.10
    });
    const nFix = 3;
    for (let i = 0; i < nFix; i++) {
      const fz = UNDERPASS_Z - DEPTH_Z / 2 + (DEPTH_Z / (nFix + 1)) * (i + 1);
      const housing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.20, 0.55), fixtureMat);
      housing.position.set(PENN, CLEAR + GIRDER - 0.18, fz);
      grp.add(housing);
      const shroud = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.30, 0.85), trimMat);
      shroud.position.set(PENN, CLEAR + GIRDER - 0.02, fz);
      grp.add(shroud);
      PENN_TUNNEL_LIGHTS.push({ x: PENN, y: CLEAR + GIRDER - 0.55, z: fz });
    }

    /* Directive: the deck must never intrude on the driving corridor. This is
       the vertical test, not corridorGuard's horizontal one. */
    clearanceGuard(kit, grp, 'Union Station underpass', CLEAR - 0.05);
    seal(kit, grp);
  }

  /* Darkening decal over the carriageway inside the tunnel mouth. A plane at
     road level tints the asphalt without touching the car that drives over it,
     which a fog volume or a global ambient change could not do.

     R2 FIX (fake-glow defect): the original single 20x20 hard-edged square
     plus two opaque feather bands produced a bright pseudo-light pool at the
     Missouri St straight — the sudden dark-to-bright transition at the decal
     edge read as a spotlight. Replaced with one radial-gradient alpha map so
     the darkening fades smoothly to zero with no visible boundary. */
  {
    const T = document.createElement('canvas');
    T.width = 256; T.height = 256;
    const g2d = T.getContext('2d')!;
    const grad = g2d.createRadialGradient(128, 128, 10, 128, 128, 128);
    grad.addColorStop(0.0, 'rgba(0,0,0,1)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.85)');
    grad.addColorStop(1.0, 'rgba(0,0,0,0)');
    g2d.fillStyle = grad;
    g2d.fillRect(0, 0, 256, 256);
    const alphaMap = new THREE.CanvasTexture(T);

    const tint = new THREE.MeshBasicMaterial({
      color: QUALITY.penn.tunnelFloorTint,
      transparent: true,
      opacity: QUALITY.penn.tunnelFloorOpacity,
      alphaMap: alphaMap,
      depthWrite: false,
      fog: false
    });
    const geo = new THREE.PlaneGeometry(56, 72);
    geo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(geo, tint);
    floor.position.set(PENN, 0.048, UNDERPASS_Z);
    floor.renderOrder = 2;
    kit.scene.add(floor);
    kit.register(floor, PENN, UNDERPASS_Z, 36);
  }

  /* ---------------------------------------------- GAINBRIDGE FIELDHOUSE ----
     East side of Pennsylvania, so the driver's left running south. Limestone
     base, red brick and dark curtain wall above it, and the barrel vault
     running north to south so the long curved flank faces the street. */
  {
    const grp = new THREE.Group();
    const W = 118;                       // east to west
    const D = 106;                       // north to south
    const BASE_H = 9.0;
    const BODY_H = 19.5;
    const wallTop = BASE_H + BODY_H;
    const westFace = ARENA_CX - W / 2;

    /* Limestone plinth. */
    const base = new THREE.Mesh(new THREE.BoxGeometry(W, BASE_H, D), arenaBaseMat);
    base.position.set(ARENA_CX, BASE_H / 2, ARENA_CZ);
    base.castShadow = true;
    base.receiveShadow = true;
    grp.add(base);

    const baseCap = new THREE.Mesh(new THREE.BoxGeometry(W + 1.4, 0.8, D + 1.4), arenaBaseMat);
    baseCap.position.set(ARENA_CX, BASE_H + 0.4, ARENA_CZ);
    baseCap.castShadow = true;
    grp.add(baseCap);

    /* Brick body. */
    const bodyGeo = new THREE.BoxGeometry(W, BODY_H, D);
    (function () {
      const uv = bodyGeo.attributes.uv as THREE.BufferAttribute;
      const bw = Math.round(W / 12), bd = Math.round(D / 12), fl = Math.round(BODY_H / 6);
      const sc = [[bd, fl], [bd, fl], [bw, bd], [bw, bd], [bw, fl], [bw, fl]];
      for (let f = 0; f < 6; f++) {
        for (let q = 0; q < 4; q++) {
          const vi = f * 4 + q;
          uv.setXY(vi, uv.getX(vi) * sc[f][0], uv.getY(vi) * sc[f][1]);
        }
      }
      uv.needsUpdate = true;
    })();
    const body = new THREE.Mesh(bodyGeo, arenaBrickMat);
    body.position.set(ARENA_CX, BASE_H + 0.8 + BODY_H / 2, ARENA_CZ);
    body.castShadow = true;
    body.receiveShadow = true;
    grp.add(body);

    /* Curtain wall panels: a tall glazed bay on the west elevation facing the
       track, and a matching one wrapping the north corner the driver sees
       first. Both stand slightly proud of the brick. */
    const glassW = new THREE.Mesh(new THREE.PlaneGeometry(D * 0.62, BODY_H * 0.88), arenaGlassMat);
    glassW.position.set(westFace - 0.35, BASE_H + 0.8 + BODY_H * 0.50, ARENA_CZ - D * 0.06);
    glassW.rotation.y = -Math.PI / 2;
    glassW.receiveShadow = true;
    grp.add(glassW);

    const glassN = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.52, BODY_H * 0.86), arenaGlassMat);
    glassN.position.set(ARENA_CX - W * 0.14, BASE_H + 0.8 + BODY_H * 0.50, ARENA_CZ - D / 2 - 0.35);
    glassN.receiveShadow = true;
    grp.add(glassN);

    /* Projecting glazed entry pavilion on the north-west corner, which is the
       tallest thing on the elevation in photo 2. */
    const pav = new THREE.Mesh(new THREE.BoxGeometry(15, wallTop + 5.5, 15), arenaGlassMat);
    pav.position.set(westFace + 7, (wallTop + 5.5) / 2, ARENA_CZ - D / 2 + 7);
    pav.castShadow = true;
    pav.receiveShadow = true;
    grp.add(pav);

    const pavCap = new THREE.Mesh(new THREE.BoxGeometry(16.6, 1.1, 16.6), trimMat);
    pavCap.position.set(westFace + 7, wallTop + 6.05, ARENA_CZ - D / 2 + 7);
    pavCap.castShadow = true;
    grp.add(pavCap);

    /* Brick pilasters marching along the west elevation. */
    for (let i = -4; i <= 4; i++) {
      const p = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, BODY_H, 3.0),
        arenaBrickMat
      );
      p.position.set(westFace - 0.8, BASE_H + 0.8 + BODY_H / 2, ARENA_CZ + i * (D / 10));
      p.castShadow = true;
      grp.add(p);
    }

    /* Barrel vault. The cylinder axis runs north to south, so the curved flank
       presents to Pennsylvania. Rotating a cylinder onto the z axis takes
       rotation.x, and the sweep is centred on the top by starting theta at
       -PI/2 through a half turn. */
    const VAULT_R = W * 0.46;
    const vault = new THREE.Mesh(
      new THREE.CylinderGeometry(VAULT_R, VAULT_R, D * 0.96, 40, 1, false, -Math.PI / 2, Math.PI),
      vaultMat
    );
    vault.rotation.x = Math.PI / 2;
    vault.position.set(ARENA_CX, wallTop + 0.5, ARENA_CZ);
    vault.castShadow = true;
    vault.receiveShadow = true;
    grp.add(vault);

    /* Standing-seam ribs along the vault, which is what gives it scale. */
    for (let i = 0; i <= 12; i++) {
      const a = -Math.PI / 2 + (i / 12) * Math.PI;
      const rx = Math.cos(a) * (VAULT_R + 0.18);
      const ry = Math.sin(a) * (VAULT_R + 0.18);
      if (ry < -0.5) continue;
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, D * 0.96), trimMat);
      rib.position.set(ARENA_CX + rx, wallTop + 0.5 + ry, ARENA_CZ);
      grp.add(rib);
    }

    /* Gable walls closing each end of the vault. */
    const gableEnds = [-1, 1];
    for (let e = 0; e < gableEnds.length; e++) {
      const gz = ARENA_CZ + gableEnds[e] * (D * 0.48);
      const gable = new THREE.Mesh(
        new THREE.CircleGeometry(VAULT_R, 32, 0, Math.PI),
        arenaBrickMat
      );
      gable.position.set(ARENA_CX, wallTop + 0.5, gz + gableEnds[e] * 0.2);
      if (gableEnds[e] < 0) gable.rotation.y = Math.PI;
      gable.castShadow = true;
      gable.receiveShadow = true;
      grp.add(gable);
    }

    /* Flat service roof either side of the vault. */
    for (let s = -1; s <= 1; s += 2) {
      const flat = new THREE.Mesh(new THREE.BoxGeometry(W * 0.06, 0.6, D), roofMat);
      flat.position.set(ARENA_CX + s * W * 0.47, wallTop + 0.9, ARENA_CZ);
      flat.receiveShadow = true;
      grp.add(flat);
    }

    /* The vertical banner on the north-west corner, facing back up
       Pennsylvania into the oncoming driver. */
    const bannerTex = arenaBannerTex();
    const bannerMat = new THREE.MeshStandardMaterial({
      map: bannerTex, roughness: 0.62, metalness: 0.05,
      emissive: 0x0E6B3A, emissiveIntensity: 0.30,
      envMapIntensity: 0.6, side: THREE.DoubleSide
    });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 17.6), bannerMat);
    banner.position.set(westFace - 1.1, BASE_H + 11.5, ARENA_CZ - D / 2 + 16);
    banner.rotation.y = -Math.PI / 2;
    banner.castShadow = true;
    grp.add(banner);

    /* Its mounting frame. */
    for (let s = -1; s <= 1; s += 2) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 18.6, 0.30), trimMat);
      post.position.set(westFace - 0.85, BASE_H + 11.5, ARENA_CZ - D / 2 + 16 + s * 2.4);
      post.castShadow = true;
      grp.add(post);
    }

    corridorGuard(kit, grp, 'Gainbridge Fieldhouse', 17);
    seal(kit, grp);
  }

  /* ------------------------------------- WEST SIDE COMMERCIAL MID-RISES ----
     Photos 2 and 3: a continuous wall of dark brick, uniform punched windows,
     flat parapets and rooftop plant. They matter less individually than as a
     mass, because they are what makes the straight read as a canyon. */
  {
    const blocks = [
      { z: -78, w: 40, d: 48, h: 26 },
      { z: -18, w: 40, d: 44, h: 31 },
      { z: 38, w: 40, d: 42, h: 23 },
      { z: 96, w: 40, d: 48, h: 34 },
      { z: 160, w: 40, d: 44, h: 27 },
      { z: 222, w: 40, d: 46, h: 21 },
      { z: 282, w: 40, d: 40, h: 25 }
    ];
    const parapetMat = kit.solid(0x2A2622, 0.86, 0.04, 0.4);
    const plantMat = kit.solid(0x8C8F92, 0.62, 0.44, 0.7);

    for (let i = 0; i < blocks.length; i++) {
      const bk = blocks[i];
      const grp = new THREE.Group();
      /* East face 12 m clear of the centreline, so 2.6 m behind the barrier. */
      const cx = PENN - 12 - bk.w / 2;

      const geo = new THREE.BoxGeometry(bk.w, bk.h, bk.d);
      (function () {
        const uv = geo.attributes.uv as THREE.BufferAttribute;
        const bw = Math.max(2, Math.round(bk.w / 4.6));
        const bd = Math.max(2, Math.round(bk.d / 4.6));
        const fl = Math.max(2, Math.round(bk.h / 3.8));
        const sc = [[bd, fl], [bd, fl], [bw, bd], [bw, bd], [bw, fl], [bw, fl]];
        for (let f = 0; f < 6; f++) {
          for (let q = 0; q < 4; q++) {
            const vi = f * 4 + q;
            uv.setXY(vi, uv.getX(vi) * sc[f][0], uv.getY(vi) * sc[f][1]);
          }
        }
        uv.needsUpdate = true;
      })();
      const shell = new THREE.Mesh(geo, commercialMat);
      shell.position.set(cx, bk.h / 2, bk.z);
      shell.castShadow = true;
      shell.receiveShadow = true;
      grp.add(shell);

      /* Flat parapet standing above the roof line. */
      const par = new THREE.Mesh(new THREE.BoxGeometry(bk.w + 0.9, 1.5, bk.d + 0.9), parapetMat);
      par.position.set(cx, bk.h + 0.75, bk.z);
      par.castShadow = true;
      par.receiveShadow = true;
      grp.add(par);

      const deck = new THREE.Mesh(new THREE.BoxGeometry(bk.w - 1, 0.4, bk.d - 1), roofMat);
      deck.position.set(cx, bk.h + 0.2, bk.z);
      deck.receiveShadow = true;
      grp.add(deck);

      /* Rooftop plant, deterministic from the block index so it never flickers
         between reloads. */
      const units = 2 + Math.floor(hash01(i * 7.3 + 1.1) * 3);
      for (let u = 0; u < units; u++) {
        const ux = cx + (hash01(i * 3.1 + u * 5.7) - 0.5) * (bk.w - 8);
        const uz = bk.z + (hash01(i * 9.4 + u * 2.3) - 0.5) * (bk.d - 8);
        const uw = 2.2 + hash01(i + u * 1.9) * 3.4;
        const uh = 1.4 + hash01(i * 2.7 + u) * 1.8;
        const unit = new THREE.Mesh(new THREE.BoxGeometry(uw, uh, uw * 0.8), plantMat);
        unit.position.set(ux, bk.h + 0.4 + uh / 2, uz);
        unit.castShadow = true;
        unit.receiveShadow = true;
        grp.add(unit);
      }

      /* A single stair bulkhead per block. */
      const bulk = new THREE.Mesh(new THREE.BoxGeometry(4.2, 3.0, 4.6), commercialMat);
      bulk.position.set(cx + (hash01(i * 4.4) - 0.5) * (bk.w - 12), bk.h + 1.9, bk.z + bk.d * 0.22);
      bulk.castShadow = true;
      bulk.receiveShadow = true;
      grp.add(bulk);

      corridorGuard(kit, grp, 'Penn west block ' + (i + 1), 11.5);
      seal(kit, grp);
    }
  }

  /* ------------------------------ EAST INFILL NORTH OF THE FIELDHOUSE ------
     Photo 3 shows the east side continuing as brick mid-rises between Market
     and Maryland, before the arena takes over. */
  {
    const blocks = [
      { z: -84, w: 38, d: 46, h: 29 },
      { z: -26, w: 38, d: 44, h: 24 },
      { z: 32, w: 38, d: 42, h: 32 }
    ];
    const parapetMat = kit.solid(0x2A2622, 0.86, 0.04, 0.4);

    for (let i = 0; i < blocks.length; i++) {
      const bk = blocks[i];
      const grp = new THREE.Group();
      const cx = PENN + 12 + bk.w / 2;

      const geo = new THREE.BoxGeometry(bk.w, bk.h, bk.d);
      (function () {
        const uv = geo.attributes.uv as THREE.BufferAttribute;
        const bw = Math.max(2, Math.round(bk.w / 4.6));
        const bd = Math.max(2, Math.round(bk.d / 4.6));
        const fl = Math.max(2, Math.round(bk.h / 3.8));
        const sc = [[bd, fl], [bd, fl], [bw, bd], [bw, bd], [bw, fl], [bw, fl]];
        for (let f = 0; f < 6; f++) {
          for (let q = 0; q < 4; q++) {
            const vi = f * 4 + q;
            uv.setXY(vi, uv.getX(vi) * sc[f][0], uv.getY(vi) * sc[f][1]);
          }
        }
        uv.needsUpdate = true;
      })();
      const shell = new THREE.Mesh(geo, i === 1 ? arenaBrickMat : commercialMat);
      shell.position.set(cx, bk.h / 2, bk.z);
      shell.castShadow = true;
      shell.receiveShadow = true;
      grp.add(shell);

      const par = new THREE.Mesh(new THREE.BoxGeometry(bk.w + 0.9, 1.5, bk.d + 0.9), parapetMat);
      par.position.set(cx, bk.h + 0.75, bk.z);
      par.castShadow = true;
      par.receiveShadow = true;
      grp.add(par);

      const deck = new THREE.Mesh(new THREE.BoxGeometry(bk.w - 1, 0.4, bk.d - 1), roofMat);
      deck.position.set(cx, bk.h + 0.2, bk.z);
      deck.receiveShadow = true;
      grp.add(deck);

      corridorGuard(kit, grp, 'Penn east block ' + (i + 1), 11.5);
      seal(kit, grp);
    }
  }
}

/* ============================================== MISSOURI RAIL OVERPASS ======
   Modeled after the Penn underpass language so it reads as the same rail
   system: concrete abutments, rusted girders, slab deck, ballast and rails. */
export function buildMissouriRailOverpass(kit: LandmarkKit): void {
  const T = kit.TEX;
  const concreteMat = kit.pbr(T.bridgeConcrete, {
    envIntensity: QUALITY.envInt.stone, normalScale: 0.85, repeatX: 3, repeatY: 2
  });
  const concreteFine = kit.pbr(T.bridgeConcrete, {
    envIntensity: QUALITY.envInt.stone, normalScale: 0.72, repeatX: 5, repeatY: 1
  });
  const steelMat = kit.pbr(T.rustedSteel, {
    envIntensity: 0.72, normalScale: 1.0, repeatX: 7, repeatY: 1
  });
  const soffitMat = kit.pbr(T.deckSoffit, {
    envIntensity: 0.28, normalScale: 0.8, repeatX: 4, repeatY: 2
  });
  const ballastMat = kit.solid(0x42423C, 0.95, 0.02, 0.28);
  const railMat = kit.solid(0x786A60, 0.40, 0.79, 0.9);
  const sleeperMat = kit.solid(0x2C2119, 0.93, 0.0, 0.24);

  /* Fixed authored anchor on the straight Missouri run. Using locate() here can
     occasionally resolve to the nearby South St segment and rotate the bridge
     wrong, which makes it read as a split/parallel structure. */
  const anchorX = MISSOURI;
  const anchorZ = 336;

  const grp = new THREE.Group();
  grp.position.set(anchorX, 0, anchorZ);

  const CLEAR = 5.5;
  const GIRDER = 1.15;
  const SLAB = 1.45;
  const PARAPET = 1.15;
  const SPAN_X = 56;
  const DEPTH_Z = 13.5;
  const ABUT_INNER = 22;
  const ABUT_THICK = 6.2;
  const BASE_H = CLEAR + 0.45;
  const ABUT_H = 2.1;

  const girderY = CLEAR + GIRDER / 2;
  const slabY = CLEAR + GIRDER + SLAB / 2;
  const deckTop = CLEAR + GIRDER + SLAB;

  const sides = [-1, 1];
  for (let s = 0; s < sides.length; s++) {
    const sx = sides[s];
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(ABUT_THICK + 1.4, BASE_H, DEPTH_Z - 2.2),
      concreteMat
    );
    base.position.set(sx * (ABUT_INNER + ABUT_THICK / 2), BASE_H / 2, 0);
    base.castShadow = true;
    base.receiveShadow = true;
    grp.add(base);

    const abut = new THREE.Mesh(
      new THREE.BoxGeometry(ABUT_THICK, ABUT_H, DEPTH_Z + 1.6),
      concreteMat
    );
    abut.position.set(sx * (ABUT_INNER + ABUT_THICK / 2), CLEAR + 0.35 + ABUT_H / 2, 0);
    abut.castShadow = true;
    abut.receiveShadow = true;
    grp.add(abut);

    const shelf = new THREE.Mesh(
      new THREE.BoxGeometry(ABUT_THICK + 1.1, 0.62, DEPTH_Z + 2.2),
      concreteFine
    );
    shelf.position.set(sx * (ABUT_INNER + ABUT_THICK / 2), CLEAR + 0.1, 0);
    shelf.castShadow = true;
    shelf.receiveShadow = true;
    grp.add(shelf);

    /* Stepped approach walls so the bridge reads as a continuous railway
       embankment instead of a hard cut-off structure. Kept outside the track
       envelope at the slab ends only. */
    for (let dir = -1; dir <= 1; dir += 2) {
      for (let seg = 0; seg < 1; seg++) {
        const segLen = 5.5;
        const stepH = 3.9;
        const zc = dir * (DEPTH_Z / 2 + 1.3 + segLen * (seg + 0.5));

        const wall = new THREE.Mesh(
          new THREE.BoxGeometry(2.2, stepH, segLen),
          concreteMat
        );
        wall.position.set(sx * (ABUT_INNER + 1.2), stepH / 2, zc);
        wall.castShadow = true;
        wall.receiveShadow = true;
        grp.add(wall);

        const cap = new THREE.Mesh(
          new THREE.BoxGeometry(2.9, 0.34, segLen),
          concreteFine
        );
        cap.position.set(sx * (ABUT_INNER + 1.2), stepH + 0.17, zc);
        cap.castShadow = true;
        cap.receiveShadow = true;
        grp.add(cap);
      }
    }
  }

  const girders = 5;
  for (let i = 0; i < girders; i++) {
    const gz = -DEPTH_Z / 2 + (DEPTH_Z / (girders - 1)) * i;
    const web = new THREE.Mesh(new THREE.BoxGeometry(SPAN_X, GIRDER, 0.28), steelMat);
    web.position.set(0, girderY, gz);
    web.castShadow = true;
    web.receiveShadow = true;
    grp.add(web);

    const flangeGeo = new THREE.BoxGeometry(SPAN_X, 0.14, 0.82);
    const lower = new THREE.Mesh(flangeGeo, steelMat);
    lower.position.set(0, CLEAR + 0.07, gz);
    lower.castShadow = true;
    lower.receiveShadow = true;
    grp.add(lower);

    const upper = new THREE.Mesh(flangeGeo.clone(), steelMat);
    upper.position.set(0, CLEAR + GIRDER - 0.07, gz);
    upper.castShadow = true;
    grp.add(upper);
  }

  const soffitGeo = new THREE.PlaneGeometry(SPAN_X - 1.1, DEPTH_Z);
  soffitGeo.rotateX(Math.PI / 2);
  const soffit = new THREE.Mesh(soffitGeo, soffitMat);
  soffit.position.set(0, CLEAR + GIRDER - 0.02, 0);
  soffit.receiveShadow = true;
  grp.add(soffit);

  const slab = new THREE.Mesh(new THREE.BoxGeometry(SPAN_X, SLAB, DEPTH_Z), concreteMat);
  slab.position.set(0, slabY, 0);
  slab.castShadow = true;
  slab.receiveShadow = true;
  grp.add(slab);

  for (let f = -1; f <= 1; f += 2) {
    const fz = f * (DEPTH_Z / 2 + 0.34);
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(SPAN_X + 1.1, SLAB + 0.7, 0.65), concreteFine);
    fascia.position.set(0, slabY - 0.15, fz);
    fascia.castShadow = true;
    fascia.receiveShadow = true;
    grp.add(fascia);

    const parapet = new THREE.Mesh(new THREE.BoxGeometry(SPAN_X + 1.1, PARAPET, 0.55), concreteMat);
    parapet.position.set(0, deckTop + PARAPET / 2, fz);
    parapet.castShadow = true;
    parapet.receiveShadow = true;
    grp.add(parapet);
  }

  const ballast = new THREE.Mesh(new THREE.BoxGeometry(SPAN_X - 2, 0.74, DEPTH_Z - 1.8), ballastMat);
  ballast.position.set(0, deckTop + 0.37, 0);
  ballast.castShadow = true;
  ballast.receiveShadow = true;
  grp.add(ballast);

  for (let sZ = -5; sZ <= 5; sZ++) {
    const sleeper = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.2, 0.26), sleeperMat);
    sleeper.position.set(0, deckTop + 0.82, sZ * 1.0);
    sleeper.castShadow = true;
    grp.add(sleeper);
  }
  for (let rail = -1; rail <= 1; rail += 2) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, DEPTH_Z - 2.3), railMat);
    r.position.set(rail * 0.68, deckTop + 1.0, 0);
    r.castShadow = true;
    grp.add(r);
  }

  clearanceGuard(kit, grp, 'Missouri rail overpass', 0.05);
  seal(kit, grp);
}

/* ============================================== WHITE RIVER OVERPASS ========
   The physics track is planar, so this builds the visual illusion: road on a
   bridge deck with a lowered river channel running beneath it. */
export function buildWhiteRiverOverpass(kit: LandmarkKit): void {
  const T = kit.TEX;
  const roadMat = kit.pbr(T.road, {
    envIntensity: QUALITY.envInt.ground, normalScale: 0.7, repeatX: 2, repeatY: 3
  });
  const concreteMat = kit.pbr(T.bridgeConcrete, {
    envIntensity: QUALITY.envInt.stone, normalScale: 0.82, repeatX: 5, repeatY: 2
  });
  const wallMat = kit.pbr(T.tunnelWall, {
    envIntensity: QUALITY.envInt.wall, normalScale: 0.85,
    aniso: QUALITY.tex.anisotropyGrazing
  });
  const trimMat = kit.solid(0x7A8088, 0.42, 0.68, 0.9);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x254A58,
    roughness: 0.16,
    metalness: 0.04,
    transparent: true,
    opacity: 0.90,
    emissive: 0x0C232C,
    emissiveIntensity: 0.22,
    envMapIntensity: 1.0
  });
  const riverBedMat = kit.solid(0x3E403E, 0.98, 0.01, 0.16);

  const probe = kit.locate(WHITE_RIVER + 170, 40, 0);
  const grp = new THREE.Group();
  grp.position.set(probe.px, 0, probe.pz);
  grp.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(probe.tx, 0, probe.tz).normalize()
  );

  /* Keep the road center dry; water must be visible on both sides only. */
  const DRY_W = 30;
  const SIDE_W = 58;
  const RIVER_L = 52;
  const sideCenters = [-(DRY_W / 2 + SIDE_W / 2), (DRY_W / 2 + SIDE_W / 2)];

  for (let i = 0; i < sideCenters.length; i++) {
    const sx = sideCenters[i];

    const bed = new THREE.Mesh(new THREE.BoxGeometry(SIDE_W, 1.4, RIVER_L), riverBedMat);
    bed.position.set(sx, -4.7, 0);
    bed.receiveShadow = true;
    grp.add(bed);

    const water = new THREE.Mesh(new THREE.PlaneGeometry(SIDE_W - 6, RIVER_L - 6), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(sx, -4.02, 0);
    water.receiveShadow = true;
    grp.add(water);

    const innerWall = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.7, RIVER_L + 2), concreteMat);
    innerWall.position.set(sx + (sx < 0 ? 1 : -1) * (SIDE_W / 2 - 1.3), -1.85, 0);
    innerWall.castShadow = true;
    innerWall.receiveShadow = true;
    grp.add(innerWall);

    const outerWall = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3.1, RIVER_L + 4), wallMat);
    outerWall.position.set(sx + (sx < 0 ? -1 : 1) * (SIDE_W / 2 + 1.6), -2.4, 0);
    outerWall.rotation.z = (sx < 0 ? 1 : -1) * 0.18;
    outerWall.castShadow = true;
    outerWall.receiveShadow = true;
    grp.add(outerWall);
  }

  /* Road shoulders/bridge edges, outside the active carriageway. */
  for (let s = -1; s <= 1; s += 2) {
    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.12, RIVER_L + 6), roadMat);
    shoulder.position.set(s * (DRY_W / 2 + 3.75), 0.04, 0);
    shoulder.receiveShadow = true;
    grp.add(shoulder);

    const parapet = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, RIVER_L + 6), trimMat);
    parapet.position.set(s * (DRY_W / 2 + 7.3), 1.0, 0);
    parapet.castShadow = true;
    parapet.receiveShadow = true;
    grp.add(parapet);
  }

  seal(kit, grp);
}

/* ====================================================== TOP LEVEL INJECT == */

export function buildLandmarks(kit: LandmarkKit): void {
  buildTurnOneDistrict(kit);
  buildMonument(kit);
  buildArtsgarden(kit);
  buildWashingtonReferenceFrontage(kit);
  buildSkylineAnchors(kit);
  buildWhiteRiverOverpass(kit);
  buildPennSector(kit);
  buildMissouriRailOverpass(kit);
  /* hash01 is re-exported by the core barrel and used by the lot generator;
     referenced here so the import surface matches the rest of the package. */
  void hash01;
}
