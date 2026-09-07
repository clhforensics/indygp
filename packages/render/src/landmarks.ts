
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
const ARENA_CZ = 245;          // north of the viaduct: z 192–298, ~24m clear of bridge (z 322+)

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
  { x: 295, z: 493, rx: 52, rz: 90 },                         // Lucas Oil Stadium (LOS-V2.7, east face at Chris's mark x=335)
  { x: 412, z: 438, rx: 34, rz: 22 },                         // South St district: hotel (SOUTH side)
  { x: 559, z: 438, rx: 34, rz: 22 },                         // South St district: parking garage (SOUTH)
  { x: 704, z: 440, rx: 46, rz: 25 },                         // South St district: warehouse (SOUTH)
  { x: ARENA_CX, z: ARENA_CZ, rx: 66, rz: 60 },               // Gainbridge Fieldhouse
  { x: PENN, z: UNDERPASS_Z, rx: 36, rz: 28 },                // Union Station underpass
  { x: MISSOURI, z: 336, rx: 72, rz: 44 },                    // Missouri railway overpass
  { x: PENN - 48, z: 135, rx: 32, rz: 190 },                  // Penn corridor, west side
  { x: PENN + 46, z: -30, rx: 30, rz: 78 },                   // Penn corridor, east infill
  /* M4C grandstand footprints (GS-V1) — generic lots keep out */
  { x: 320, z: -27, rx: 165, rz: 16 },                        // main straight stand
  { x: 712, z: -70, rx: 14, rz: 62 },                         // T1 outside stand
  { x: 490, z: 376, rx: 125, rz: 11 }                         // South St stand
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

  /* REHAB V2.3 — curtain-wall glass TEXTURE, matching the reference photo:
     the real glazing reads as distinct blue-green panels in a fine mullion
     grid, not a flat tint. Repeating canvas: panel field + darker grid lines
     + a soft sky highlight per panel. */
  const mkCurtainTex = (repX: number, repY: number): THREE.CanvasTexture => {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    const g = cv.getContext('2d');
    if (g) {
      g.fillStyle = '#2F7184';
      g.fillRect(0, 0, 256, 256);
      for (let px = 0; px < 4; px++) {
        for (let py = 0; py < 6; py++) {
          const t = ((px * 7 + py * 13) % 10) / 10;
          g.fillStyle = t < 0.33 ? '#3A8095' : t < 0.72 ? '#2B6A7D' : '#276173';
          g.fillRect(px * 64 + 2, py * 43 + 2, 60, 39);
          /* Soft sky highlight on the upper edge of each panel. */
          g.fillStyle = 'rgba(210,235,240,0.16)';
          g.fillRect(px * 64 + 2, py * 43 + 2, 60, 9);
        }
      }
      /* Mullion grid lines. */
      g.fillStyle = '#1E3A44';
      for (let px = 0; px <= 4; px++) g.fillRect(px * 64 - 2, 0, 4, 256);
      for (let py = 0; py <= 6; py++) g.fillRect(0, py * 43 - 2, 256, 4);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repX, repY);
    tex.anisotropy = 4;
    return tex;
  };
  const curtainGlass = new THREE.MeshStandardMaterial({
    color: 0xFFFFFF, map: mkCurtainTex(8, 2),
    roughness: 0.14, metalness: 0.16,
    transparent: true, opacity: 0.82,
    envMapIntensity: QUALITY.envInt.glass, side: THREE.DoubleSide
  });
  const domeGlass = new THREE.MeshStandardMaterial({
    color: 0xFFFFFF, map: mkCurtainTex(8, 4),
    roughness: 0.14, metalness: 0.16,
    transparent: true, opacity: 0.82,
    envMapIntensity: QUALITY.envInt.glass, side: THREE.DoubleSide
  });
  const linkGlass = new THREE.MeshStandardMaterial({
    color: 0xFFFFFF, map: mkCurtainTex(6, 2),
    roughness: 0.14, metalness: 0.16,
    transparent: true, opacity: 0.82,
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
    curtainGlass
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
    domeGlass
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
      linkGlass
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
      /* REHAB V2.2 font fix: 26px letter-spaced copies were ~616px wide but
         only 341px apart -> copies overlapped into garble. 22px with natural
         spacing ≈ 300px per copy, fits the 341px slot. Three copies cover the
         full wrap; band rotated so one complete name faces the straight. */
      ng.font = 'bold 22px Georgia, serif';
      ng.textAlign = 'center';
      ng.textBaseline = 'middle';
      ng.fillStyle = '#3A332B';
      for (const cx of [171, 512, 853]) {
        ng.fillText('INDIANAPOLIS ARTSGARDEN', cx, 50);
      }
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
      /* Rotate half a copy-slot so a name CENTER faces the start/finish
         approach, not the seam between two copies. */
      nameBand.rotation.y = Math.PI / 2;
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

    /* REHAB JW-V2 — reference-photo pass (West & Washington corner view):
       the tower is BRIGHT reflective blue curtain glass (the old flat dark
       0x2E68A8 read nearly black in-game), the roof cuts a sharp diagonal
       along the facade, "JW MARRIOTT" is lettered on the concave glass, and
       the podium is blue-green glass, not limestone. */
    const mkBlueCurtain = (): THREE.CanvasTexture => {
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = 256;
      const g = cv.getContext('2d');
      if (g) {
        g.fillStyle = '#2E68A8';
        g.fillRect(0, 0, 256, 256);
        for (let px = 0; px < 4; px++) {
          for (let py = 0; py < 6; py++) {
            const t = ((px * 11 + py * 5) % 10) / 10;
            g.fillStyle = t < 0.30 ? '#4C8FD4' : t < 0.70 ? '#2E68A8' : '#23568E';
            g.fillRect(px * 64 + 2, py * 43 + 2, 60, 39);
            /* Sky reflection sheen on each panel. */
            g.fillStyle = 'rgba(215,235,250,0.22)';
            g.fillRect(px * 64 + 2, py * 43 + 2, 60, 10);
          }
        }
        g.fillStyle = '#16283E';
        for (let px = 0; px <= 4; px++) g.fillRect(px * 64 - 2, 0, 4, 256);
        for (let py = 0; py <= 6; py++) g.fillRect(0, py * 43 - 2, 256, 4);
      }
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(6, 14);
      tex.anisotropy = 4;
      return tex;
    };
    const blueGlass = new THREE.MeshStandardMaterial({
      color: 0xFFFFFF, map: mkBlueCurtain(),
      roughness: 0.10, metalness: 0.55,
      envMapIntensity: 1.55, side: THREE.DoubleSide
    });
    const spandrel = kit.solid(0x1B3A57, 0.44, 0.55, 1.0);
    const mullion = kit.solid(0x141C26, 0.38, 0.70, 0.9);

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

    /* Mechanical crown — the real tower's roof shears down in a sharp
       diagonal: tall flat end at the north (Maryland) corner, sweeping down
       to the roofline at the south (Washington) corner. Wedge cross-section
       in the (z, height) plane — local -z is NNE, +z is SSW — extruded along
       the facade normal. Shear is GLASS: the curtain wall continues up the
       diagonal in the references. */
    {
      const wedgeShape = new THREE.Shape();
      wedgeShape.moveTo(-58, H + 9);   // north end, tall
      wedgeShape.lineTo(20, H);        // shears down to the roofline, south
      wedgeShape.lineTo(-58, H);       // roofline back to the north edge
      wedgeShape.closePath();
      const wedge = new THREE.Mesh(
        new THREE.ExtrudeGeometry(wedgeShape, { depth: 34, bevelEnabled: false }),
        blueGlass
      );
      /* Shape-x already maps to group z under rotation.y = -PI/2; the
         extrusion (shape-z 0..34) maps to group x = position.x - z, so
         position.x = 2 lays it over the core footprint (x -32..2). */
      wedge.rotation.y = -Math.PI / 2;
      wedge.position.set(2, 0, 0);
      wedge.castShadow = true;
      wedge.receiveShadow = true;
      grp.add(wedge);
    }

    /* REHAB JW-V2: podium is the blue-green glass annex in the references,
       not limestone. */
    const podium = new THREE.Mesh(new THREE.BoxGeometry(46, 7.5, 82), new THREE.MeshStandardMaterial({
      color: 0x3E7D8C, roughness: 0.14, metalness: 0.35,
      envMapIntensity: QUALITY.envInt.glass
    }));
    podium.position.set(-11, 3.75, BIAS);
    podium.castShadow = true;
    podium.receiveShadow = true;
    grp.add(podium);

    /* REHAB JW-V2: "JW MARRIOTT" lettering on the concave glass face, per the
       West & Washington reference. Canvas decal plane floated just proud of
       the arc's chord centre, facing the facade normal (local +x). */
    {
      const jc = document.createElement('canvas');
      jc.width = 512; jc.height = 64;
      const jg = jc.getContext('2d');
      if (jg) {
        jg.clearRect(0, 0, 512, 64);
        jg.font = 'bold 34px Helvetica, Arial, sans-serif';
        jg.textAlign = 'center';
        jg.textBaseline = 'middle';
        jg.fillStyle = 'rgba(235,242,248,0.92)';
        jg.fillText('J W   M A R R I O T T', 256, 34);
        const jTex = new THREE.CanvasTexture(jc);
        jTex.colorSpace = THREE.SRGBColorSpace;
        jTex.anisotropy = 4;
        const jMat = new THREE.MeshBasicMaterial({
          map: jTex, transparent: true, depthWrite: false
        });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(30, 3.75), jMat);
        /* Concave facade chord centre sits at local x≈0; float the decal just
           proud of the glass, facing the facade normal (+x). */
        sign.rotation.y = Math.PI / 2;
        sign.position.set(2.5, 42, BIAS);
        grp.add(sign);
      }
    }

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

      /* --- Lucas Oil Stadium LOS-V3: full reference rebuild (2026-09-07) ---
   Chris: "this is an iconic stadium; not just some block blob." V3 rebuilds
   the anatomy from the Street View + satellite refs:
   - long red-brick mass on a limestone podium, vertical brick piers with
     recessed blue-green glazing between (north + east facades)
   - signature CORNER ATRIUM at the north-east corner: full-height angled
     glass wall with steel mullion grid, raked top, brick cheek walls —
     the wedge every TV shot shows coming up South St
   - dark-maroon LUCAS OIL STADIUM lettering on the brick header band above
     the atrium, plus a white copy high on the east gable for the approach
   - closed-roof form: clerestory glass band, twin steel roof panels to a
     ridge running the long (north-south) axis, gable end closures

   Placement (Chris, round 7): STADIUM east face at his mark x=479
   (HUD: T6 Missouri 329 m -> car x = 150 + 329). CX = 439.
   The mass rotates +0.10 rad about its centre (satellite-ref angle); the
   ROTATED part is the building only — plaza/fence/poles stay axis-aligned
   in the parent group so the barrier line can never be violated:
   worst rotated corner reaches world z = 422.6; fence line z = 417.5;
   corridorGuard(minCentreline 10) verifies nothing crosses the roadway. */
  {
    const grp = new THREE.Group();
    const brick = kit.pbr(T.arenaBrick, {
      envIntensity: QUALITY.envInt.facade, normalScale: 0.8, emissiveIntensity: 1.0
    });
    const pierBrick = kit.pbr(T.arenaBrick, {
      envIntensity: QUALITY.envInt.facade * 1.1, normalScale: 0.85, repeatX: 2, repeatY: 6
    });
    const base = kit.pbr(T.arenaBase, {
      envIntensity: QUALITY.envInt.stone, normalScale: 0.65, repeatX: 10, repeatY: 1
    });
    const plaza = kit.pbr(T.arenaBase, {
      envIntensity: QUALITY.envInt.stone, normalScale: 0.5, repeatX: 14, repeatY: 4
    });
    const steel = kit.solid(0x8A9098, 0.38, 0.80, 1.0);
    const steelDark = kit.solid(0x3A4046, 0.52, 0.72, 0.9);
    const glass = new THREE.MeshStandardMaterial({
      color: 0x2B4250, roughness: 0.07, metalness: 0.85, envMapIntensity: 1.75,
      emissive: 0x101E28, emissiveIntensity: 0.55
    });

    const CX = 439, CZ = 500, W = 80, D = 150, HB = 34;
    /* Rotated building subgroup: children are LOCAL to (CX, CZ). */
    const sg = new THREE.Group();
    sg.position.set(CX, 0, CZ);
    sg.rotation.y = 0.10;                      // satellite-ref angle, ~6 deg
    grp.add(sg);

    /* Podium base course and main brick mass. */
    add(sg, box(W + 3, 4, D + 3), base, 0, 2, 0);
    add(sg, boxUv(box(W, HB - 4, D), W, HB - 4, D, 13, 4.2), brick,
        0, 4 + (HB - 4) / 2, 0);
    /* Top cornice band. */
    add(sg, box(W + 2, 1.8, D + 2), base, 0, HB + 0.9, 0);
    /* Clerestory glass band between the mass and the roof. */
    add(sg, box(W - 10, 9, D - 10), glass, 0, HB + 6.3, 0);

    /* Vertical brick piers + recessed glass strips, NORTH facade (South St).
       Piers stop short of the north-east corner where the atrium takes over. */
    const bays = 7;
    for (let i = 0; i <= bays; i++) {
      const px = -W / 2 + 4 + (i * (W - 8)) / bays;
      if (px > 8) continue;                    // atrium corner owns the east end
      add(sg, box(3.4, HB - 4, 1.6), pierBrick, px, 4 + (HB - 4) / 2,
          -D / 2 + 0.4);
      if (i < bays) {
        const nx = -W / 2 + 4 + ((i + 1) * (W - 8)) / bays;
        if (nx > 8) continue;                  // bay swallowed by the atrium
        const g = new THREE.Mesh(
            new THREE.PlaneGeometry((W - 8) / bays - 3.6, HB - 9), glass);
        g.position.set((px + nx) / 2, 4 + (HB - 9) / 2 + 1.5, -D / 2 - 0.25);
        g.receiveShadow = true;
        sg.add(g);
      }
    }
    /* EAST facade (Missouri / T6 approach): same pier + glazing language. */
    for (let i = 0; i <= 9; i++) {
      const pz = -D / 2 + 5 + (i * (D - 10)) / 9;
      add(sg, box(1.6, HB - 4, 3.4), pierBrick, W / 2 - 0.4,
          4 + (HB - 4) / 2, pz);
      if (i < 9 && pz > -D / 2 + 22) {         // lower bays sit behind the atrium
        const nz = -D / 2 + 5 + ((i + 1) * (D - 10)) / 9;
        const g = new THREE.Mesh(
            new THREE.PlaneGeometry((D - 10) / 9 - 3.6, HB - 9), glass);
        g.rotation.y = Math.PI / 2;
        g.position.set(W / 2 + 0.25, 4 + (HB - 9) / 2 + 1.5, (pz + nz) / 2);
        g.receiveShadow = true;
        sg.add(g);
      }
    }

    /* THE CORNER ATRIUM: full-height angled glass wall at the north-east
       corner, rotated 45 deg to face the oncoming driver up South St. */
    {
      const atr = new THREE.Group();
      const wplane = new THREE.Mesh(new THREE.PlaneGeometry(34, HB - 2), glass);
      wplane.rotation.x = -0.08;               // top rakes back into the mass
      wplane.receiveShadow = true;
      atr.add(wplane);
      /* Mullion grid over the glass. */
      for (let i = 0; i <= 8; i++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, HB - 1.6, 0.5),
            steelDark);
        m.position.set(-17 + i * 4.25, 0, 0.35);
        atr.add(m);
      }
      for (let j = 0; j <= 4; j++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(34, 0.5, 0.5), steelDark);
        m.position.set(0, -(HB - 2) / 2 + j * ((HB - 2) / 4), 0.35);
        atr.add(m);
      }
      atr.position.set(W / 2 - 16, 4 + (HB - 2) / 2, -D / 2 + 12);
      atr.rotation.y = Math.PI / 4;            // faces north-east
      sg.add(atr);
      /* Brick cheek walls closing the wedge against both facades. */
      add(sg, box(12, HB - 2, 2), pierBrick, 6, 4 + (HB - 2) / 2, -D / 2 + 3);
      add(sg, box(2, HB - 2, 12), pierBrick, W / 2 - 1, 4 + (HB - 2) / 2,
          -D / 2 + 6);
      /* Brick header band above the atrium carrying the name lettering. */
      add(sg, box(52, 15, 2.4), pierBrick, -2, HB + 7.4, -D / 2 + 0.9);
    }

    /* LUCAS OIL STADIUM lettering (canvas decals): maroon on the brick
       header above the atrium, white high on the east gable for the
       T6 approach — the money shot reads from 300 m out. */
    /* Reference lettering: LUCAS OIL in RED, STADIUM in white beneath. */
    const mkNameTex = function (): THREE.CanvasTexture {
      const cv = document.createElement('canvas');
      cv.width = 2048; cv.height = 512;
      const ng = cv.getContext('2d');
      if (ng) {
        ng.clearRect(0, 0, 2048, 512);
        ng.textAlign = 'center';
        ng.textBaseline = 'middle';
        ng.font = 'bold 170px Georgia, serif';
        ng.fillStyle = '#C41E2A';              // Lucas Oil red
        ng.fillText('LUCAS OIL', 1024, 150);
        ng.font = 'bold 120px Georgia, serif';
        ng.fillStyle = '#EFEAE2';              // STADIUM white
        ng.fillText('S T A D I U M', 1024, 360);
      }
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      return t;
    };
    {
      const nameMat = new THREE.MeshBasicMaterial({
        map: mkNameTex(), transparent: true, side: THREE.DoubleSide
      });
      /* North: above the big window wall, on the brick header. */
      const nName = new THREE.Mesh(new THREE.PlaneGeometry(46, 11.5), nameMat);
      nName.position.set(-2, HB + 7.4, -D / 2 - 0.35);
      nName.rotation.y = Math.PI;
      sg.add(nName);
      /* East: high on the gable end for the T6 approach. */
      const eName = new THREE.Mesh(new THREE.PlaneGeometry(30, 7.5), nameMat);
      eName.position.set(W / 2 + 0.35, HB + 12, 0);
      eName.rotation.y = Math.PI / 2;
      sg.add(eName);
    }

    /* THE REFERENCE WINDOW WALL: one huge swept glass field dominating the
       centre of the north facade (135-170 W South St look) — brick border
       already frames it via the piers. Slight rake + forward bow. */
    {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(58, 27), glass);
      wall.rotation.x = -0.05;
      wall.position.set(-2, 4 + 14.6, -D / 2 - 0.55);
      wall.receiveShadow = true;
      sg.add(wall);
      /* Super-mullions dividing the field into tall bays. */
      for (let i = 0; i <= 7; i++) {
        add(sg, box(0.8, 27, 0.8), steelDark, -31 + i * (58 / 7),
            4 + 14.6, -D / 2 - 0.35);
      }
      for (let j = 1; j <= 3; j++) {
        add(sg, box(58, 0.7, 0.7), steelDark, -2, 4 + 3 + j * (24 / 3),
            -D / 2 - 0.35);
      }
    }

    /* CLOSED-roof form: clerestory + twin steel panels rising to a ridge
       that runs the LONG axis (z), gable closures on the east/west ends. */
    const panel = function (side: number): void {
      const p = new THREE.Mesh(
          new THREE.BoxGeometry(W * 0.46, 1.8, D * 0.94), steel);
      p.rotation.z = side * 0.055;
      p.position.set(side * W * 0.225, HB + 13, 0);
      p.castShadow = true;
      sg.add(p);
    };
    panel(-1); panel(1);
    add(sg, box(2.6, 1.5, D * 0.94), steelDark, 0, HB + 16.3, 0);
    add(sg, box(2.2, 7.5, W * 0.94), steel, W * 0.47, HB + 13, 0);
    add(sg, box(2.2, 7.5, W * 0.94), steel, -W * 0.47, HB + 13, 0);

    /* Hauler/garage dock annex on the WEST face (Missouri corner side). */
    add(sg, boxUv(box(9, 12, D * 0.62), 9, 12, D * 0.62, 4, 4), brick,
        -W / 2 + 4.5, 6, D * 0.12);
    add(sg, box(10, 1.2, D * 0.62 + 1), base, -W / 2 + 4.5, 12.6, D * 0.12);
    for (let i = 0; i < 5; i++) {
      add(sg, box(0.4, 5.5, 7), steelDark, -W / 2 - 0.2, 4.75,
          D * 0.12 - 22 + i * 11);
    }

    /* Plaza + fence + poles: AXIS-ALIGNED in the parent group, locked to
       the 411-418 sidewalk band. Rotation of the mass can never drag these
       across the barrier line. */
    add(grp, box(W + 6, 0.3, 7), plaza, CX, 0.15, 414.5);
    const fenceRun = function (x0: number, z0: number, x1: number, z1: number): void {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(2, Math.round(len / 4));
      const ang = Math.atan2(x1 - x0, z1 - z0);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        add(grp, box(0.22, 3.0, 0.22), steelDark,
            x0 + (x1 - x0) * t, 1.5, z0 + (z1 - z0) * t);
      }
      for (let r = 0; r < 3; r++) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, len), steelDark);
        rail.position.set((x0 + x1) / 2, 0.85 + r * 1.0, (z0 + z1) / 2);
        rail.rotation.y = ang;
        grp.add(rail);
      }
    };
    fenceRun(CX - W / 2 - 3, 417.5, CX + W / 2 + 3, 417.5);
    fenceRun(CX + W / 2 + 3, 417.5, CX + W / 2 + 3, CZ + D / 2);
    fenceRun(CX - W / 2 - 3, 417.5, CX - W / 2 - 3, CZ + D / 2);
    for (let i = 0; i < 4; i++) {
      const lx = CX - W / 2 + 10 + i * ((W - 20) / 3);
      add(grp, new THREE.CylinderGeometry(0.28, 0.42, 12, 8), steelDark,
          lx, 6, 414.5);
      add(grp, box(3.2, 0.5, 1.1), steelDark, lx, 12.2, 414.5);
    }

corridorGuard(kit, grp, 'Lucas Oil Stadium', 10);
    seal(kit, grp);
  }

  /* --- Victory Field VF-V2: reference rehab from West St + satellite refs ---
   Replaces the V1 scaled anchor. Anatomy from the reference photography
   (home plate on the WEST side, batter faces ENE, so the OPEN outfield
   faces S West St and the Maryland St corner):
   - double-deck brick grandstand wraps home plate down the first-base
     (south/southwest) side — the tall mass, press box on top
   - single-deck seating partway down the left-field (north) line, then
     the bowl OPENS into the lawn berm along Maryland St
   - West St frontage is LOW: outfield wall, tree line, open plaza
   - videoboard at the left-field shoulder, aux board on the berm
   Track clearance (hard rule, nothing inside the border):
   - West St barrier line sits at x ~ -9.4; the low outfield wall at x = -24
     keeps ~15 m clear — the stadium fills the block right up to the track,
     matching the real park's tight West St frontage.
   - Turn 7 exit diagonal toward White River passes z ~ 75 at x = -129;
     the first-base stand's north edge stays at z >= 118 (~40 m clear).
   - The Missouri/West hairpin apex stays east of x = -10; berm and
     facade stay west of x = -100. */
  {
    const grp = new THREE.Group();
    const brick = kit.pbr(T.arenaBrick, {
      envIntensity: QUALITY.envInt.facade, normalScale: 0.8, emissiveIntensity: 1.1
    });
    const concourse = kit.pbr(T.arenaBase, {
      envIntensity: QUALITY.envInt.stone, normalScale: 0.65, repeatX: 6, repeatY: 1
    });
    const steel = kit.solid(0x5E6670, 0.42, 0.78, 0.95);
    const steelDark = kit.solid(0x2E343B, 0.5, 0.7, 0.85);
    const turf = kit.solid(0x2B6E38, 0.94, 0.02, 0.22);
    const turfDark = kit.solid(0x235C2E, 0.94, 0.02, 0.22);
    const dirt = kit.solid(0x8A6646, 0.96, 0.01, 0.16);
    const chalk = kit.solid(0xF1EEE5, 0.9, 0.0, 0.12);
    const seatRed = kit.solid(0x7A2E2A, 0.82, 0.05, 0.35);
    const seatBlue = kit.solid(0x27405C, 0.82, 0.05, 0.35);
    const glass = kit.solid(0x24343F, 0.25, 0.7, 1.35);

    const CX = -120;
    const CZ = 218;

    /* Concourse podium: thin street-level slab (the real park sits at grade,
       the old 4 m plinth buried the playing surface). */
    const podium = new THREE.Mesh(new THREE.BoxGeometry(196, 0.9, 146), concourse);
    podium.position.set(CX, 0.45, CZ);
    podium.castShadow = true;
    podium.receiveShadow = true;
    grp.add(podium);

    /* ---------------- grandstand masses (lower bowl + upper deck) -------- */
    /* Curved double-deck bowl wrapping home plate from the NW gap around
       west to south (cylinder shells, theta measured from due south).
       Arc starts at 1.21PI so the bowl never reaches north of z = 145,
       keeping 15 m+ clear of the T7 diagonal. */
    brick.side = THREE.DoubleSide;
    seatRed.side = THREE.DoubleSide;
    seatBlue.side = THREE.DoubleSide;
    glass.side = THREE.DoubleSide;
    const bowlCX = CX + 12;
    const bowlCZ = CZ - 8;
    const lowerBowl = new THREE.Mesh(
      new THREE.CylinderGeometry(76, 82, 15, 40, 1, true, Math.PI * 1.21, Math.PI * 0.79), brick);
    lowerBowl.position.set(bowlCX, 8.4, bowlCZ);
    lowerBowl.castShadow = true;
    lowerBowl.receiveShadow = true;
    grp.add(lowerBowl);
    const bowlSeats = new THREE.Mesh(
      new THREE.CylinderGeometry(72.5, 78, 12, 40, 1, true, Math.PI * 1.21, Math.PI * 0.79), seatRed);
    bowlSeats.position.set(bowlCX, 8.2, bowlCZ);
    grp.add(bowlSeats);
    const upperDeck = new THREE.Mesh(
      new THREE.CylinderGeometry(84, 88, 9.5, 40, 1, true, Math.PI * 1.24, Math.PI * 0.66), brick);
    upperDeck.position.set(bowlCX, 21.0, bowlCZ - 2);
    upperDeck.castShadow = true;
    upperDeck.receiveShadow = true;
    grp.add(upperDeck);
    const upperSeats = new THREE.Mesh(
      new THREE.CylinderGeometry(80.5, 84, 7, 40, 1, true, Math.PI * 1.24, Math.PI * 0.66), seatRed);
    upperSeats.position.set(bowlCX, 20.8, bowlCZ - 2);
    grp.add(upperSeats);
    /* Canopy: flat steel ring over both decks. */
    const canopy = new THREE.Mesh(
      new THREE.RingGeometry(66, 104, 40, 1, Math.PI * 0.75, Math.PI * 0.75), steel);
    canopy.rotation.x = -Math.PI / 2;
    canopy.position.set(bowlCX, 26.2, CZ - 6);
    canopy.castShadow = true;
    grp.add(canopy);
    /* Press box: curved glass band riding the canopy behind home plate. */
    const press = new THREE.Mesh(
      new THREE.CylinderGeometry(92, 92, 6, 24, 1, true, Math.PI * 1.45, Math.PI * 0.35), glass);
    press.position.set(bowlCX, 29.5, bowlCZ);
    press.castShadow = true;
    grp.add(press);

    /* First-base/left-field line: single deck, rounded ends (capsule-ish
       via cylinder segment), stopping well short of the T7 diagonal. */
    const lfStand = new THREE.Mesh(
      new THREE.CylinderGeometry(76, 76, 9, 24, 1, true, Math.PI * 1.07, Math.PI * 0.14), brick);
    lfStand.position.set(bowlCX, 6.1, bowlCZ);
    lfStand.castShadow = true;
    lfStand.receiveShadow = true;
    grp.add(lfStand);
    const lfSeats = new THREE.Mesh(
      new THREE.CylinderGeometry(73, 73, 7, 24, 1, true, Math.PI * 1.07, Math.PI * 0.14), seatRed);
    lfSeats.position.set(bowlCX, 6.0, bowlCZ);
    grp.add(lfSeats);
    const capLF = new THREE.Mesh(
      new THREE.RingGeometry(62, 84, 24, 1, Math.PI * 1.05, Math.PI * 0.18), steel);
    capLF.rotation.x = -Math.PI / 2;
    capLF.position.set(bowlCX, 10.9, bowlCZ);
    capLF.castShadow = true;
    grp.add(capLF);

    /* LAWN BERM along the Maryland St side: rounded (half-cylinder) stepped
       grass shelves in the NE quadrant — the real park's right-field berm
       faces Maryland St. Kept south of the diagonal corridor. */
    for (let i = 0; i < 3; i++) {
      const r = 46 - i * 9;
      const h = 4.5 - i * 0.6;
      const berm = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r + 4, h, 24, 1, false, Math.PI * 1.34, Math.PI * 0.5), i === 2 ? turf : turfDark);
      berm.position.set(bowlCX, (4.5 - h) / 2 + 0.45, bowlCZ);
      berm.castShadow = true;
      berm.receiveShadow = true;
      grp.add(berm);
    }

    /* ---------------- West St edge: LOW and OPEN (per reference) --------- */
    /* No grandstand or facade here — the real park's West St frontage is a
       low brick outfield wall, a tree line, and open plaza. */
    const westWall = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.2, 112), brick);
    westWall.position.set(CX + 96, 1.6, CZ - 8);
    westWall.castShadow = true;
    westWall.receiveShadow = true;
    grp.add(westWall);

    /* ---------------- the playing field ---------------------------------- */
    /* The dirt diamond + strips are what make it read as baseball from a
       distance — dirt tones and chalk must survive far viewing. */
    const field = new THREE.Mesh(new THREE.CircleGeometry(60, 40), turf);
    field.scale.set(1.14, 1, 0.82);
    field.rotation.x = -Math.PI / 2;
    field.position.set(CX + 12, 0.95, CZ - 4);
    field.receiveShadow = true;
    grp.add(field);

    /* Mowing stripes: alternating arc bands across the outfield grass. */
    for (let s = 0; s < 5; s++) {
      const stripe = new THREE.Mesh(new THREE.RingGeometry(20 + s * 8, 27 + s * 8, 36, 1, Math.PI * 0.08, Math.PI * 0.62), s % 2 === 0 ? turfDark : turf);
      stripe.scale.set(1.14, 0.82, 1);
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(CX + 12, 0.96, CZ - 4);
      stripe.receiveShadow = true;
      grp.add(stripe);
    }

    /* Warning track ring just inside the outfield wall — wide enough to
       read as dirt, not a smudge, from across West St. */
    const warn = new THREE.Mesh(new THREE.RingGeometry(46, 57, 40), dirt);
    warn.scale.set(1.14, 0.82, 1);
    warn.rotation.x = -Math.PI / 2;
    warn.position.set(CX + 12, 0.97, CZ - 4);
    warn.receiveShadow = true;
    grp.add(warn);

    /* Infield dirt: home plate SW, centre field NE (per the satellite ref). */
    const HPX = CX - 34;
    const HPZ = CZ + 34;
    const diamond = new THREE.Mesh(new THREE.PlaneGeometry(56, 56), dirt);
    diamond.rotation.x = -Math.PI / 2;
    diamond.rotation.z = Math.PI / 4;
    diamond.position.set(HPX + 34, 0.97, HPZ - 34);
    diamond.receiveShadow = true;
    grp.add(diamond);
    const mound = new THREE.Mesh(new THREE.CircleGeometry(4.2, 14), dirt);
    mound.rotation.x = -Math.PI / 2;
    mound.position.set(HPX + 30, 0.975, HPZ - 30);
    grp.add(mound);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 1.1), chalk);
    plate.position.set(HPX, 0.98, HPZ);
    plate.rotation.y = Math.PI / 4;
    grp.add(plate);
    const baseXZ: Array<[number, number]> = [
      [HPX + 19, HPZ - 5],   // first base (SE of the mound line)
      [HPX + 24, HPZ - 24],  // second base
      [HPX + 5, HPZ - 19]    // third base
    ];
    for (const [bx, bz] of baseXZ) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.9), chalk);
      base.position.set(bx, 0.1, bz);
      grp.add(base);
    }
    const foul1 = new THREE.Mesh(new THREE.BoxGeometry(62, 0.05, 0.28), chalk);
    foul1.position.set(HPX + 26, 0.98, HPZ - 6);
    foul1.rotation.y = Math.PI * 0.06;
    grp.add(foul1);
    const foul3 = new THREE.Mesh(new THREE.BoxGeometry(62, 0.05, 0.28), chalk);
    foul3.position.set(HPX + 6, 0.98, HPZ - 26);
    foul3.rotation.y = -Math.PI * 0.06;
    grp.add(foul3);

    /* Outfield wall REMOVED (VF-V3, Chris): the dark curved cylinder segment
       read as a random black arc lying in the grass. The park boundary is now
       the perimeter iron fence below, like the real park's fence line. */

    /* ---------------- perimeter iron fence (VF-V3) ----------------------- */
    /* Iron fence on the podium edge, all four sides: posts every 4 m with
       bottom, mid and top rails. Bars, not a solid wall, so the field stays
       visible from West St like the real park's frontage. */
    const fenceH = 3.0;
    const FX = 97;   // half-extents: just inside the podium edge (196 x 146)
    const FZ = 71;
    const postGeo = new THREE.BoxGeometry(0.16, fenceH, 0.16);
    const railGeoX = new THREE.BoxGeometry(2 * FX + 0.4, 0.1, 0.1);
    const railGeoZ = new THREE.BoxGeometry(0.1, 0.1, 2 * FZ + 0.4);
    /* South + north runs (constant z, varying x) */
    for (const sz of [-FZ, FZ]) {
      for (const ry of [0.85, 2.1, 2.85]) {  // bottom, mid, top rails
        const rail = new THREE.Mesh(railGeoX, steelDark);
        rail.position.set(CX, ry, CZ + sz);
        grp.add(rail);
      }
      for (let px = -FX; px <= FX + 0.1; px += 4) {
        const post = new THREE.Mesh(postGeo, steelDark);
        post.position.set(CX + px, 0.9 + fenceH / 2, CZ + sz);
        post.castShadow = true;
        grp.add(post);
      }
    }
    /* East + west runs (constant x, varying z) */
    for (const sx of [-FX, FX]) {
      for (const ry of [0.85, 2.1, 2.85]) {
        const rail = new THREE.Mesh(railGeoZ, steelDark);
        rail.position.set(CX + sx, ry, CZ);
        grp.add(rail);
      }
      for (let pz = -FZ; pz <= FZ + 0.1; pz += 4) {
        const post = new THREE.Mesh(postGeo, steelDark);
        post.position.set(CX + sx, 0.9 + fenceH / 2, CZ + pz);
        post.castShadow = true;
        grp.add(post);
      }
    }

    /* Left-field videoboard: the big one, above the LF line stand, facing
       home plate (matches the satellite: board at the NW shoulder). */
    const board = new THREE.Mesh(new THREE.BoxGeometry(20, 10.5, 2.6), steelDark);
    board.position.set(CX - 66, 12.0, CZ - 66);
    board.rotation.y = -Math.PI * 0.25;
    board.castShadow = true;
    board.receiveShadow = true;
    grp.add(board);
    const boardFace = new THREE.Mesh(new THREE.PlaneGeometry(16.5, 8.4), kit.solid(0x0F1720, 0.45, 0.2, 0.5));
    boardFace.position.set(CX - 59.6, 12.0, CZ - 59.6);
    boardFace.rotation.y = -Math.PI * 0.25;
    grp.add(boardFace);

    /* Auxiliary board on the Maryland-side berm shoulder, visible down
       West St past the low outfield wall. */
    const aux = new THREE.Mesh(new THREE.BoxGeometry(10, 5.5, 1.8), steelDark);
    aux.position.set(CX + 62, 12.0, CZ - 46);
    aux.castShadow = true;
    grp.add(aux);
    const auxFace = new THREE.Mesh(new THREE.PlaneGeometry(8.2, 4.4), kit.solid(0x101820, 0.45, 0.2, 0.4));
    auxFace.position.set(CX + 62, 12.0, CZ - 44.9);
    auxFace.rotation.y = 0;
    grp.add(auxFace);

    /* Six light towers (VF-V3): standing ON the perimeter fence line —
       x/y at the fence runs — with masts grounded on the podium top
       (y = 0.9). The old th/2 + 4 offset was a leftover from the deleted
       4 m plinth and left every mast floating. */
    const towers: Array<[number, number, number]> = [
      [CX - 84, CZ - FZ, 34], [CX - 84, CZ + FZ, 34],
      [CX + 34, CZ - FZ, 30], [CX + 34, CZ + FZ, 30],
      [CX + FX, CZ - 30, 26], [CX + FX, CZ + 22, 26]
    ];
    for (const [tx, tz, th] of towers) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, th, 10), steel);
      mast.position.set(tx, 0.9 + th / 2, tz);
      mast.castShadow = true;
      grp.add(mast);
      /* Concrete base pad so the mast reads solid with the ground. */
      const pad = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 2.6), concourse);
      pad.position.set(tx, 0.45, tz);
      grp.add(pad);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.5, 1.4), steel);
      bar.position.set(tx, 0.9 + th + 0.6, tz);
      bar.rotation.y = Math.PI / 4;
      bar.castShadow = true;
      grp.add(bar);
    }

    seal(kit, grp);
  }

  /* Gainbridge Fieldhouse has moved to buildPennSector, where it is built
     from the corridor photography rather than as a generic skyline anchor. */
}

/* ============================================== SOUTH STREET DISTRICT ======
   INDYGP-SSD-V1 (2026-09-07) — the blocks the driver passes on the LEFT
   between Turn 5 (Penn, x=820) and Turn 6 (Missouri, x=150), built from the
   two South Street reference views and the Street View at 131 W South St:

   1  Holiday Inn Express & Suites block (x~205): mid-rise red brick hotel
      with a simple rectangular mass and punched windows, set behind a
      surface parking lot fronting South St
   2  white/grey parking structure (x~300): open-sided deck garage with
      visible floor bands and parked-car hints, the big light-grey mass in
      the aerial ref
   3  dark brick warehouse run (x~560): long low-pitch industrial block with
      a stepped parapet, chain-link + barbwire along the sidewalk edge
   Surface lots with striped stalls, light poles and chain-link fence fill
   the gaps, exactly as the refs show south of the rail cut.

   Footprints are inside the exclusion zones added to LANDMARK_ZONES, so the
   generic generator will never overlap them. */

function buildSouthStreetDistrict(kit: LandmarkKit): void {
  const T = kit.TEX;
  const brickMat = kit.pbr(T.commercialBrick, {
    envIntensity: QUALITY.envInt.facade, normalScale: 0.85, repeatX: 6, repeatY: 4
  });
  const baseMat = kit.pbr(T.arenaBase, {
    envIntensity: QUALITY.envInt.stone, normalScale: 0.6, repeatX: 5, repeatY: 1
  });
  const garageMat = kit.pbr(T.bridgeConcrete, {
    envIntensity: QUALITY.envInt.stone, normalScale: 0.7, repeatX: 8, repeatY: 3
  });
  const steelDark = kit.solid(0x3A4046, 0.52, 0.72, 0.9);
  const glass = kit.solid(0x24343F, 0.25, 0.7, 1.35);
  const lotMat = kit.pbr(T.arenaBase, {
    envIntensity: QUALITY.envInt.stone, normalScale: 0.5, repeatX: 12, repeatY: 3
  });
  const stripe = kit.solid(0xE8E4D8, 0.9, 0.0, 0.1);
  const carCols = [0x8C9199, 0x2E343B, 0x7A2E2A, 0x24343F, 0xB9BDC4];

  /* Lot helper: asphalt pad, striped stalls, light poles, chain-link run.
       SOUTH-SIDE layout: the lot sits BETWEEN the building and South St, so
       lz is the lot centre and the chain-link runs along the lot's NORTH
       (street) edge at lz - ld/2, kept at z >= 411. */
  const lot = function (grp: THREE.Group, lx: number, lz: number, lw: number,
                        ld: number, stalls: number): void {
    add(grp, box(lw, 0.12, ld), lotMat, lx, 0.06, lz);
    for (let i = 0; i < stalls; i++) {
      const sx = lx - lw / 2 + 3 + i * ((lw - 6) / Math.max(1, stalls - 1));
      add(grp, box(0.3, 0.02, 5), stripe, sx, 0.13, lz + ld * 0.18);
    }
    for (let p = 0; p < 2; p++) {
      const px = lx + (p === 0 ? -lw / 2 + 5 : lw / 2 - 5);
      add(grp, new THREE.CylinderGeometry(0.22, 0.34, 10, 8), steelDark,
          px, 5, lz + ld / 2 - 3);
      add(grp, box(2.6, 0.4, 0.9), steelDark, px, 10.2, lz + ld / 2 - 3);
    }
    /* Chain-link along the STREET edge: slim posts + one rail line; bar-style
       like VF-V3 so the lot still reads through it. Never north of z=412. */
    const fz = Math.max(412, lz - ld / 2);
    const n = Math.round(lw / 4);
    for (let i = 0; i <= n; i++) {
      add(grp, box(0.16, 2.2, 0.16), steelDark, lx - lw / 2 + i * (lw / n),
          1.1, fz);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(lw, 0.1, 0.1), steelDark);
    rail.position.set(lx, 1.9, fz);
    grp.add(rail);
  };

  /* Parked-car helper: simple low two-box body + darker glass band. */
  const parkedCar = function (grp: THREE.Group, x: number, z: number,
                              rot: number): void {
    const c = carCols[Math.floor(hash01(x * 0.37 + z * 0.11) * carCols.length)];
    const body = kit.solid(c, 0.6, 0.25, 0.7);
    add(grp, box(4.4, 1.15, 1.9), body, x, 0.75, z, rot);
    add(grp, box(2.4, 0.75, 1.75), glass, x, 1.55, z, rot);
  };

  /* ---- 1. Hotel block (Holiday Inn Express massing) ---------------------- */
  {
    const grp = new THREE.Group();
    const HX = 412, HZ = 451, HW2 = 30, HD = 26, HH = 30;
    add(grp, box(HW2 + 2, 2.4, HD + 2), baseMat, HX, 1.2, HZ);
    add(grp, boxUv(box(HW2, HH - 2.4, HD), HW2, HH - 2.4, HD, 4.2, 3.4), brickMat,
        HX, 2.4 + (HH - 2.4) / 2, HZ);
    add(grp, box(HW2 + 1, 1.2, HD + 1), baseMat, HX, HH + 0.6, HZ);
    /* Rooftop plant + stair bulkhead. */
    add(grp, box(5, 2.6, 4), steelDark, HX - 8, HH + 2.1, HZ + 5);
    add(grp, box(4, 3.2, 4.4), brickMat, HX + 9, HH + 2.8, HZ - 4);
    /* Entrance canopy on the north (street) face. */
    add(grp, box(10, 0.6, 5), steelDark, HX, 4.6, HZ - HD / 2 - 2.5);
    /* Lot BETWEEN building and street: spans z 411-425, never on the road. */
    lot(grp, HX, 418, 44, 14, 9);
    for (let i = 0; i < 5; i++) {
      parkedCar(grp, HX - 16 + i * 8, 418, 0);
    }
    corridorGuard(kit, grp, 'South St hotel', 10);
    seal(kit, grp);
  }

  /* ---- 2. Parking structure (light-grey deck garage) ---------------------- */
  {
    const grp = new THREE.Group();
    const GX = 559, GZ = 451, GW = 58, GD = 26, LEVELS = 4, LH = 3.1;
    add(grp, box(GW + 2, 1.0, GD + 2), garageMat, GX, 0.5, GZ);
    for (let l = 0; l < LEVELS; l++) {
      const y = 1.0 + l * LH + LH / 2;
      /* Open deck slab with ramp cut reads via the slim parapet bands. */
      add(grp, box(GW, 0.7, GD), garageMat, GX, y, GZ);
      add(grp, box(GW + 0.6, 1.0, 0.5), garageMat, GX, y + LH / 2, GZ - GD / 2);
      add(grp, box(0.5, 1.0, GD + 0.6), garageMat, GX - GW / 2, y + LH / 2, GZ);
      add(grp, box(0.5, 1.0, GD + 0.6), garageMat, GX + GW / 2, y + LH / 2, GZ);
    }
    /* Support columns expressed on the street face between deck bands. */
    for (let c = 0; c <= 8; c++) {
      add(grp, box(1.0, LEVELS * LH, 1.0), garageMat, GX - GW / 2 + c * (GW / 8),
          1.0 + LEVELS * LH / 2, GZ - GD / 2 + 0.8);
    }
    add(grp, box(GW + 1, 0.9, GD + 1), garageMat, GX, 1.0 + LEVELS * LH + 0.45, GZ);
    /* Parked hints on the top deck. */
    for (let i = 0; i < 4; i++) {
      parkedCar(grp, GX - 18 + i * 12, GZ + 2 + (i % 2) * 6, Math.PI / 2);
    }
    /* Lot BETWEEN building and street: spans z 411-425. */
    lot(grp, GX, 418, 40, 14, 8);
    corridorGuard(kit, grp, 'South St parking deck', 10);
    seal(kit, grp);
  }

  /* ---- 3. Dark brick warehouse run ---------------------------------------- */
  {
    const grp = new THREE.Group();
    const WX = 704, WZ = 453, WW = 84, WD = 30, WH = 16;
    add(grp, boxUv(box(WW, WH, WD), WW, WH, WD, 4.5, 3.6), brickMat,
        WX, WH / 2, WZ);
    /* Stepped parapet: three raised sections across the street facade. */
    for (let s = 0; s < 3; s++) {
      add(grp, box(WW / 3 - 2, 1.8, 1.2), brickMat,
          WX - WW / 2 + WW / 6 + s * (WW / 3), WH + 0.9, WZ - WD / 2 + 0.4);
    }
    /* Loading doors + high windows on the north face. */
    for (let d = 0; d < 4; d++) {
      add(grp, box(6, 4.6, 0.4), steelDark, WX - WW / 2 + 12 + d * 20, 2.3,
          WZ - WD / 2 - 0.1);
    }
    for (let w = 0; w < 10; w++) {
      add(grp, box(4, 2, 0.3), glass, WX - WW / 2 + 5 + w * 8.4, WH - 3.4,
          WZ - WD / 2 - 0.1);
    }
    /* Lot BETWEEN building and street: spans z 411-423. */
    lot(grp, WX, 417, 70, 12, 12);
    for (let i = 0; i < 6; i++) {
      parkedCar(grp, WX - 26 + i * 11, 417, 0);
    }
    corridorGuard(kit, grp, 'South St warehouse', 10);
    seal(kit, grp);
  }
}

/* ============================================== PENNSYLVANIA STREET SECTOR ==
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

    /* REHAB GB-V2 — reference-photo pass (aerial + Penn Ave street views):
       the real building is THREE distinct masses, not one brick box under a
       full-length barrel. West/north corner: flat glass atrium whose top edge
       is a semicircular ARCH, under a long dark entry canopy with the
       GAINBRIDGE FIELDHOUSE name band. Middle: 4-storey brick office block
       with dark green spandrel ribbon windows. East core: the metal barrel
       vault, whose NORTH gable is glazed with an exposed steel truss arch,
       and a projecting brick sign tower carrying the vertical banner. */

    /* --- West atrium: glass rectangle + half-disc arch, north portion ------ */
    const ATR_Z = ARENA_CZ - D / 2 + 28;      // atrium centre, north half
    const ATR_W = 48;                          // along the facade (z)
    const ATR_GlassH = BODY_H * 0.80;
    const glassRect = new THREE.Mesh(new THREE.PlaneGeometry(ATR_W, ATR_GlassH), arenaGlassMat);
    glassRect.position.set(westFace - 0.35, BASE_H + 0.8 + ATR_GlassH * 0.5, ATR_Z);
    glassRect.rotation.y = -Math.PI / 2;
    glassRect.receiveShadow = true;
    grp.add(glassRect);

    /* The arch: a half-disc of glazing capping the rectangle. CircleGeometry
       faces +z; rotating -90 deg about y points it west at the driver. */
    const ATR_R = ATR_W / 2;
    const atrArch = new THREE.Mesh(new THREE.CircleGeometry(ATR_R, 28, 0, Math.PI), arenaGlassMat);
    atrArch.position.set(westFace - 0.35, BASE_H + 0.8 + ATR_GlassH, ATR_Z);
    atrArch.rotation.y = -Math.PI / 2;
    atrArch.receiveShadow = true;
    grp.add(atrArch);

    /* Arch surround — limestone rim so the curve reads from distance. */
    const atrRim = new THREE.Mesh(new THREE.TorusGeometry(ATR_R + 0.4, 0.55, 8, 28, Math.PI), arenaBaseMat);
    atrRim.position.set(westFace - 0.55, BASE_H + 0.8 + ATR_GlassH, ATR_Z);
    atrRim.rotation.y = -Math.PI / 2;
    atrRim.rotation.x = 0;
    /* torus lies in xy-plane facing +z; rotate to face west like the disc */
    atrRim.rotation.set(0, -Math.PI / 2, 0);
    grp.add(atrRim);

    /* Dark steel mullion grid over the atrium glass: verticals + arch ribs. */
    for (let mi = 0; mi <= 8; mi++) {
      const mz = ATR_Z - ATR_R + (ATR_W / 8) * mi;
      const mull = new THREE.Mesh(new THREE.BoxGeometry(0.28, ATR_GlassH, 0.28), trimMat);
      mull.position.set(westFace - 0.5, BASE_H + 0.8 + ATR_GlassH * 0.5, mz);
      grp.add(mull);
      /* vertical mullions continue up into the arch, shortened by chord. */
      const ca = (mi / 8) * Math.PI;
      const chord = Math.abs(Math.sin(ca)) * ATR_R;
      if (chord > 1.2) {
        const up = new THREE.Mesh(new THREE.BoxGeometry(0.28, chord, 0.28), trimMat);
        up.position.set(westFace - 0.5, BASE_H + 0.8 + ATR_GlassH + chord * 0.5, mz);
        grp.add(up);
      }
    }

    /* --- Entry canopy with name band, across the atrium -------------------- */
    const canopyMat = kit.solid(0x1E2325, 0.52, 0.5, 0.6);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.0, ATR_W + 6), canopyMat);
    canopy.position.set(westFace - 2.0, BASE_H + 0.8 + 8.2, ATR_Z);
    canopy.castShadow = true;
    grp.add(canopy);

    /* Name band on the canopy fascia, facing west: GAINBRIDGE FIELDHOUSE. */
    const nameCanvas = document.createElement('canvas');
    nameCanvas.width = 1024; nameCanvas.height = 80;
    const ng = nameCanvas.getContext('2d');
    if (ng) {
      ng.fillStyle = '#14181A';
      ng.fillRect(0, 0, 1024, 80);
      ng.fillStyle = '#F2C230';                  // the yellow chevron
      ng.beginPath();
      ng.moveTo(48, 18); ng.lineTo(78, 40); ng.lineTo(48, 62); ng.lineTo(62, 40);
      ng.closePath(); ng.fill();
      ng.fillStyle = '#FFFFFF';
      ng.font = 'bold 44px Arial, sans-serif';
      ng.textBaseline = 'middle';
      ng.fillText('GAINBRIDGE  FIELDHOUSE', 110, 42);
    }
    const nameTex = new THREE.CanvasTexture(nameCanvas);
    nameTex.colorSpace = THREE.SRGBColorSpace;
    nameTex.anisotropy = 4;
    const nameMat = new THREE.MeshStandardMaterial({
      map: nameTex, roughness: 0.5, metalness: 0.1,
      emissive: 0xFFFFFF, emissiveMap: nameTex, emissiveIntensity: 0.35
    });
    const nameBand = new THREE.Mesh(new THREE.PlaneGeometry(ATR_W - 2, 3.4), nameMat);
    nameBand.position.set(westFace - 4.4, BASE_H + 0.8 + 8.2, ATR_Z);
    nameBand.rotation.y = -Math.PI / 2;
    grp.add(nameBand);

    /* --- Fan entry pavilion: projecting glazed box with shallow arched roof,
       just before the arena core (the "mini building" in the references) --- */
    const PAV_W = 5.6;                        // how far it projects west
    const PAV_D = 20;                         // extent along the facade (z)
    const PAV_H = BASE_H + 0.8 + 7.0;         // top of its glass, below the eaves
    const PAV_Z = ATR_Z + ATR_R + PAV_D / 2;   // ON the facade, tucked between
                                               // atrium arch and corner tower
    const pavGlass = new THREE.Mesh(
      new THREE.BoxGeometry(PAV_W, PAV_H - BASE_H - 1.2, PAV_D),
      arenaGlassMat
    );
    pavGlass.position.set(westFace - PAV_W / 2, (PAV_H + BASE_H + 1.2) / 2, PAV_Z);
    pavGlass.castShadow = true;
    pavGlass.receiveShadow = true;
    grp.add(pavGlass);

    /* Limestone base + dark roof slab with a slight camber. */
    const pavBase = new THREE.Mesh(new THREE.BoxGeometry(PAV_W + 0.8, 1.2, PAV_D + 0.8), arenaBaseMat);
    pavBase.position.set(westFace - PAV_W / 2, BASE_H + 0.6, PAV_Z);
    grp.add(pavBase);

    const pavRoof = new THREE.Mesh(new THREE.CylinderGeometry(PAV_W / 2, PAV_W / 2, PAV_D, 12, 1, false, -Math.PI / 2, Math.PI), trimMat);
    pavRoof.rotation.x = Math.PI / 2;         // same orientation as the main barrel
    pavRoof.scale.z = 0.30;                    // shallow camber (local z = vertical bulge)
    pavRoof.position.set(westFace - PAV_W / 2, PAV_H, PAV_Z);
    pavRoof.castShadow = true;
    grp.add(pavRoof);

    /* Mullions on the street-facing (west) side. */
    for (let mi = 0; mi <= 4; mi++) {
      const mz = PAV_Z - PAV_D / 2 + (PAV_D / 4) * mi;
      const mull = new THREE.Mesh(new THREE.BoxGeometry(0.24, PAV_H - BASE_H - 1.2, 0.24), trimMat);
      mull.position.set(westFace - PAV_W - 0.05, (PAV_H + BASE_H + 1.2) / 2, mz);
      grp.add(mull);
    }

    /* --- Mid block: dark green spandrel ribbon windows, west face ---------- */
    const spandrelMat = kit.solid(0x2E4A3E, 0.42, 0.35, 0.7);
    for (let row = 0; row < 3; row++) {
      const ribbon = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 2.4, D * 0.52),
        spandrelMat
      );
      ribbon.position.set(
        westFace - 0.3,
        BASE_H + 0.8 + 5.5 + row * (BODY_H / 3.4),
        ARENA_CZ + D * 0.16
      );
      grp.add(ribbon);
    }

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

    /* Barrel vault. REHAB GB-V2: in the reference the vault covers only the
       EAST arena core (~55% of the footprint), not the whole building. Axis
       still runs north-south so the curved flank faces Pennsylvania. */
    const VAULT_R = W * 0.42;
    const VAULT_LEN = 58;
    /* GB-V2c: reference shows a SHALLOW segmental barrel, not a semicircle.
       Flatten the half-cylinder to 45% height (apex ~22m above the wall, not 50)
       so it reads as the low metal-clad dome in the photos. */
    const VAULT_FLAT = 0.45;
    const VAULT_CZ = ARENA_CZ + 16;
    const vault = new THREE.Mesh(
      new THREE.CylinderGeometry(VAULT_R, VAULT_R, VAULT_LEN, 40, 1, false, -Math.PI / 2, Math.PI),
      vaultMat
    );
    vault.rotation.x = Math.PI / 2;
    vault.scale.z = VAULT_FLAT;   // local z is the cross-section's vertical after the x-rotation
    vault.position.set(ARENA_CX + 10, wallTop + 0.5, VAULT_CZ);
    vault.castShadow = true;
    vault.receiveShadow = true;
    (vault.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;  // GB-V2d: no see-through shell
    grp.add(vault);

    /* Eave ring beams where the barrel springs off the walls — ties the dome
       to the mass so it stops reading as a floating shell. */
    for (let e = -1; e <= 1; e += 2) {
      const eave = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, VAULT_LEN + 1.2), trimMat);
      eave.position.set(ARENA_CX + 10 + e * VAULT_R, wallTop + 0.2, VAULT_CZ);
      eave.castShadow = true;
      grp.add(eave);
    }

    /* Standing-seam ribs along the vault — bisect stage 2: ribs ON, truss OFF */
    for (let i = 0; i <= 12; i++) {
      const a = -Math.PI / 2 + (i / 12) * Math.PI;
      const rx = Math.cos(a) * (VAULT_R + 0.18);
      const ry = Math.sin(a) * (VAULT_R + 0.18) * VAULT_FLAT;
      if (ry < -0.5) continue;
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, VAULT_LEN), trimMat);
      rib.position.set(ARENA_CX + 10 + rx, wallTop + 0.5 + ry, VAULT_CZ);
      grp.add(rib);
    }

    /* NORTH vault gable: glazed with an exposed steel truss arch — the
       signature the driver sees approaching down Pennsylvania. */
    const VAULT_NZ = VAULT_CZ - VAULT_LEN / 2;
    const gableGlass = new THREE.Mesh(
      new THREE.CircleGeometry(VAULT_R, 32, 0, Math.PI),
      arenaGlassMat
    );
    gableGlass.position.set(ARENA_CX + 10, wallTop + 0.5, VAULT_NZ + 0.6);
    gableGlass.scale.y = VAULT_FLAT;   // match the flattened barrel cross-section
    gableGlass.rotation.y = Math.PI;   // face north (toward -z / the driver)
    gableGlass.receiveShadow = true;
    grp.add(gableGlass);

    /* GB-V2e: the "exposed truss arch" is rendered as vertical mullion bands
       rising into the gable glass (chord-shortened), exactly like the atrium.
       Radial/protruding bar arches silhouette as spikes from the approach —
       verified by bisection — so none are used. */
    for (let mi = -5; mi <= 5; mi++) {
      const mx = (mi / 5) * (VAULT_R * 0.92);
      const chordY = Math.sqrt(Math.max(0, 1 - (mx / VAULT_R) ** 2)) * VAULT_R * VAULT_FLAT;
      if (chordY < 1.2) continue;
      const mull = new THREE.Mesh(new THREE.BoxGeometry(0.30, chordY, 0.24), trimMat);
      mull.position.set(ARENA_CX + 10 + mx, wallTop + 0.5 + chordY * 0.5, VAULT_NZ + 0.45);
      grp.add(mull);
    }

    /* SOUTH vault gable: plain brick half-disc closing the far end. */
    const VAULT_SZ = VAULT_CZ + VAULT_LEN / 2;
    const gableBrick = new THREE.Mesh(
      new THREE.CircleGeometry(VAULT_R, 32, 0, Math.PI),
      arenaBrickMat
    );
    gableBrick.position.set(ARENA_CX + 10, wallTop + 0.5, VAULT_SZ + 0.3);
    gableBrick.receiveShadow = true;
    grp.add(gableBrick);

    /* Flat service roof east of the vault. */
    const flat = new THREE.Mesh(new THREE.BoxGeometry(W * 0.05, 0.6, VAULT_LEN), roofMat);
    flat.position.set(ARENA_CX + 10 + W * 0.46, wallTop + 0.9, VAULT_CZ);
    flat.receiveShadow = true;
    grp.add(flat);

    /* --- Brick sign tower with the vertical GAINBRIDGE banner --------------
       Projects from the west face at the junction of the mid block and the
       arena core, facing back up Pennsylvania into the oncoming driver. */
    const TOWER_H = wallTop + 6;   // GB-V2b: dropped 3 so the vault truss arch reads over the junction from the north
    const tower = new THREE.Mesh(new THREE.BoxGeometry(11, TOWER_H, 13), arenaBrickMat);
    tower.position.set(westFace + 5.0, TOWER_H / 2, ARENA_CZ + 15);
    tower.castShadow = true;
    tower.receiveShadow = true;
    grp.add(tower);

    const towerCap = new THREE.Mesh(new THREE.BoxGeometry(12.2, 1.2, 14.2), trimMat);
    towerCap.position.set(westFace + 5.0, TOWER_H + 0.6, ARENA_CZ + 15);
    towerCap.castShadow = true;
    grp.add(towerCap);

    const bannerTex = arenaBannerTex();
    const bannerMat = new THREE.MeshStandardMaterial({
      map: bannerTex, roughness: 0.62, metalness: 0.05,
      emissive: 0x0E6B3A, emissiveIntensity: 0.30,
      envMapIntensity: 0.6, side: THREE.DoubleSide
    });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 17.6), bannerMat);
    banner.position.set(westFace - 0.9, TOWER_H * 0.62, ARENA_CZ + 15);
    banner.rotation.y = -Math.PI / 2;
    banner.castShadow = true;
    grp.add(banner);

    /* Its mounting frame on the tower face. */
    for (let s = -1; s <= 1; s += 2) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 18.6, 0.30), trimMat);
      post.position.set(westFace - 0.65, TOWER_H * 0.62, ARENA_CZ + 15 + s * 2.4);
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
     REMOVED 2026-09-06 (Chris, per Street View refs): the last remaining block
     (z=-96, 38x30x29) sat on the real Delaware-fronting plaza/construction
     site just north of the Fieldhouse — no building exists there. The east
     side of Penn now runs open from the underpass to the arena's north face,
     matching the Apr-2026 Google Street View of 110 S Pennsylvania St. */
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
  buildSouthStreetDistrict(kit);
  buildMissouriRailOverpass(kit);
  /* hash01 is re-exported by the core barrel and used by the lot generator;
     referenced here so the import surface matches the rest of the package. */
  void hash01;
}
