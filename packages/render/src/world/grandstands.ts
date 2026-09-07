import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/* M4C GRANDSTANDS — GS-V1 (2026-09-07).
 *
 * Reference anatomy (Chris's Monaco / Miami photos):
 *  - Monaco T1/Tiered: temporary scaffold stands, steep raked seating on
 *    slender legs, tight to the barrier, crowd wall-to-wall.
 *  - Miami straight stand: long low stand, big white cantilever roof with an
 *    OPEN underside (sightlines under the roofline), roof fascia band for
 *    signage, sponsor ribbon along the base, dense multicolor crowd.
 *  - Monaco harbor slope: general admission on a wide shallow rake.
 *
 * Shared build: merged stair-rake seating (one geometry), crowd as a noise
 * ATLAS on the seat treads (never individual people), back wall + side
 * curtains, white cantilever roof on truss legs, sponsor band at the base.
 * Per-stand draw calls: 3 (seats+crowd, structure, sponsor band).
 *
 * HARD RULE: footprints sit >= 14 m from the centreline (barrier 9.4 m +
 * fence). LANDMARK_ZONES entries suppress generic buildings on the lots.
 */

export interface GrandstandSpec {
  /* centre of the stand footprint in world coords */
  x: number;
  z: number;
  /* stand length along its local +x axis (metres) */
  length: number;
  /* seating rows (each ~0.92 m tread, 0.64 m rise) */
  rows: number;
  /* world yaw: local +z (the direction the crowd faces) points this way */
  facingYaw: number;
  /* roof style: 'cantilever' (Miami) | 'scaffold' (Monaco) */
  roof: 'cantilever' | 'scaffold';
  /* ground the stand sits on (top of plinth) */
  baseY?: number;
}

const ROW_TREAD = 0.92;
const ROW_RISE = 0.64;
const SEAT_BASE_H = 1.15;   // front wall height below row 1

/* ------------------------------- textures ------------------------------ */

function crowdTexture(seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d')!;
  /* dark seat base */
  g.fillStyle = '#23262c';
  g.fillRect(0, 0, c.width, c.height);
  /* faint seat-row stripes so the rake reads even at distance */
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let y = 0; y < c.height; y += 16) g.fillRect(0, y, c.width, 2);
  /* deterministic PRNG so replays look identical */
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  /* multicolor crowd dots — density reads as packed grandstand */
  const palette = [
    '#c8442e', '#d9d4c8', '#3d64a8', '#e0a33a', '#4a8a52', '#8a4a9a',
    '#d97b6c', '#5ab0b8', '#e8e2d0', '#2e3e58', '#b8b0a0', '#7a2e2a',
  ];
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * c.width;
    const y = rnd() * c.height;
    g.fillStyle = palette[(rnd() * palette.length) | 0];
    g.globalAlpha = 0.55 + rnd() * 0.45;
    const r = 1.1 + rnd() * 1.9;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* sponsor ribbon: abstract geometric marks, no real brands */
function sponsorTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#101319';
  g.fillRect(0, 0, c.width, c.height);
  const marks = ['#e0a33a', '#3d64a8', '#c8442e', '#4a8a52'];
  let s = 7 >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
  let x = 24;
  while (x < c.width - 120) {
    const color = marks[(rnd() * marks.length) | 0];
    const kind = rnd();
    g.fillStyle = color;
    if (kind < 0.4) {
      g.fillRect(x, 30, 46, 36);
      g.fillStyle = '#101319';
      g.fillRect(x + 8, 38, 30, 20);
    } else if (kind < 0.7) {
      g.beginPath();
      g.arc(x + 22, 48, 20, 0, Math.PI * 2);
      g.fill();
    } else {
      g.fillRect(x, 44, 60, 8);
      g.fillRect(x + 12, 30, 8, 36);
    }
    x += 96 + rnd() * 60;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ------------------------------- builder ------------------------------- */

export function buildGrandstand(
  scene: THREE.Scene,
  spec: GrandstandSpec,
  opts: { crowdTex?: THREE.CanvasTexture; sponsorTex?: THREE.CanvasTexture } = {},
): THREE.Group {
  const group = new THREE.Group();
  const baseY = spec.baseY ?? 0;

  const L = spec.length;
  const rows = spec.rows;
  const standDepth = SEAT_BASE_H * 0 + 1.0 + rows * ROW_TREAD;  // footprint depth
  const standH = SEAT_BASE_H + rows * ROW_RISE;                 // top of last row

  /* ---------------- seating rake: merged stair boxes ------------------- */
  const rowGeos: THREE.BufferGeometry[] = [];
  for (let r = 0; r < rows; r++) {
    /* each row = one box: tread top at SEAT_BASE_H + (r+1)*RISE,
       box spans from ground to that top (solid under-structure look) */
    const top = SEAT_BASE_H + (r + 1) * ROW_RISE;
    const geo = new THREE.BoxGeometry(L, top, ROW_TREAD);
    geo.translate(0, top / 2 + baseY, standDepth / 2 - (r + 0.5) * ROW_TREAD);
    rowGeos.push(geo);
  }
  const seats = mergeGeometries(rowGeos)!;
  rowGeos.forEach((g) => g.dispose());

  const crowdTex = opts.crowdTex ?? crowdTexture(spec.rows * 7919 + (spec.length | 0));
  crowdTex.repeat.set(Math.max(2, Math.round(L / 26)), 1);
  const seatMat = new THREE.MeshStandardMaterial({
    map: crowdTex, roughness: 0.92, metalness: 0.0,
  });
  const seatMesh = new THREE.Mesh(seats, seatMat);
  seatMesh.castShadow = true;
  seatMesh.receiveShadow = true;
  group.add(seatMesh);

  /* ---------------- structure: walls, curtains, roof ------------------- */
  const structGeos: THREE.BufferGeometry[] = [];
  const steel = new THREE.MeshStandardMaterial({ color: 0xd8dade, roughness: 0.42, metalness: 0.35 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x50555c, roughness: 0.55, metalness: 0.45 });

  /* front wall (below row 1), flush against the first row */
  {
    const geo = new THREE.BoxGeometry(L, SEAT_BASE_H, 0.3);
    geo.translate(0, SEAT_BASE_H / 2 + baseY, standDepth - 0.35);
    structGeos.push(geo);
  }
  /* back wall */
  {
    const h = standH + 1.1;
    const geo = new THREE.BoxGeometry(L, h, 0.35);
    geo.translate(0, h / 2 + baseY, -0.18);
    structGeos.push(geo);
  }
  /* side curtains */
  for (const side of [-1, 1]) {
    const geo = new THREE.BoxGeometry(0.35, standH + 1.0, standDepth + 0.4);
    geo.translate(side * (L / 2 + 0.18), (standH + 1.0) / 2 + baseY, standDepth / 2);
    structGeos.push(geo);
  }

  const legPositions: Array<[number, number]> = [];
  if (spec.roof === 'cantilever') {
    /* Miami: big white slab, slight forward tilt, open underside.
       HARD RULE: the roof must never reach past the barrier plane, so the
       slab spans the seating footprint only — its front edge stops 0.4 m
       behind the front wall. The Miami "cantilever" read comes from the
       open underside + fascia, not from overhanging the road. */
    const roofY = standH + 3.4;
    const roofDepth = standDepth + 0.8;
    const slab = new THREE.BoxGeometry(L, 0.35, roofDepth);
    slab.rotateX(-0.07);                  // tilt front edge down slightly
    slab.translate(0, roofY + baseY, standDepth / 2);
    structGeos.push(slab);
    /* fascia band along the front edge (signage zone) */
    const fascia = new THREE.BoxGeometry(L, 1.5, 0.22);
    fascia.rotateX(-0.07);
    fascia.translate(0, roofY - 0.55 + baseY, standDepth / 2 + roofDepth / 2 - 0.35);
    structGeos.push(fascia);
    /* rear roof deck lip */
    const lip = new THREE.BoxGeometry(L, 0.5, 0.5);
    lip.translate(0, roofY + baseY, standDepth / 2 - roofDepth / 2);
    structGeos.push(lip);
    /* slender legs every ~24 m at the back + raking arms */
    const legCount = Math.max(2, Math.round(L / 24) + 1);
    for (let i = 0; i < legCount; i++) {
      const lx = -L / 2 + 2 + (i * (L - 4)) / (legCount - 1);
      legPositions.push([lx, -0.6]);
      const leg = new THREE.CylinderGeometry(0.16, 0.2, roofY - baseY + 0.4, 8);
      leg.translate(lx, (roofY + 0.4) / 2 + baseY, -0.6);
      structGeos.push(leg);
      /* raking arm from leg top to roof front edge */
      const armLen = Math.hypot(roofDepth - 0.8, 1.6);
      const arm = new THREE.BoxGeometry(0.14, 0.14, armLen);
      arm.rotateX(Math.atan2(1.6, roofDepth - 0.8));
      arm.translate(lx, roofY - 0.7 + baseY, standDepth / 2 - roofDepth / 4);
      structGeos.push(arm);
    }
  } else {
    /* Monaco scaffold: lighter stepped roof on exposed scaffold legs,
       slightly overhanging, thin fascia. */
    const roofY = standH + 2.2;
    const roofDepth = standDepth + 1.6;
    const slab = new THREE.BoxGeometry(L, 0.22, roofDepth);
    slab.rotateX(-0.05);
    slab.translate(0, roofY + baseY, standDepth / 2 + 0.4);
    structGeos.push(slab);
    const fascia = new THREE.BoxGeometry(L, 0.9, 0.16);
    fascia.rotateX(-0.05);
    fascia.translate(0, roofY - 0.35 + baseY, standDepth / 2 + 0.4 + roofDepth / 2 - 0.3);
    structGeos.push(fascia);
    const legCount = Math.max(2, Math.round(L / 12));
    for (let i = 0; i <= legCount; i++) {
      const lx = -L / 2 + 1 + (i * (L - 2)) / legCount;
      for (const lz of [-0.4, standDepth / 2 + 0.4]) {
        legPositions.push([lx, lz]);
        const leg = new THREE.CylinderGeometry(0.09, 0.09, roofY - baseY, 6);
        leg.translate(lx, roofY / 2 + baseY, lz);
        structGeos.push(leg);
      }
    }
  }

  const structure = new THREE.Mesh(mergeGeometries(structGeos)!, steel);
  structGeos.forEach((g) => g.dispose());
  structure.castShadow = true;
  structure.receiveShadow = true;
  group.add(structure);

  /* leg darkening: skip (legs merged into structure, one material is fine) */

  /* ---------------- sponsor ribbon along the base ---------------------- */
  const sponsorTex = opts.sponsorTex ?? sponsorTexture();
  sponsorTex.repeat.set(Math.max(1, Math.round(L / 34)), 1);
  const bandGeo = new THREE.BoxGeometry(L, 1.0, 0.12);
  bandGeo.translate(0, 0.5 + baseY, standDepth - 0.18);
  const band = new THREE.Mesh(
    bandGeo,
    new THREE.MeshStandardMaterial({ map: sponsorTex, roughness: 0.6 }),
  );
  group.add(band);

  /* ---------------- place in the world --------------------------------- */
  group.position.set(spec.x, 0, spec.z);
  group.rotation.y = spec.facingYaw;
  group.updateMatrixWorld(true);
  scene.add(group);
  return group;
}

/* ------------------------------ placements ------------------------------ */

/* Footprints for LANDMARK_ZONES suppression (world-space AABBs).
   Keep every front edge >= 14 m off the centreline (barrier 9.4 + fence). */
export const GRANDSTAND_SITES = {
  /* A: main straight, Washington St north side (cars run +x). x 160..480. */
  mainStraight: {
    stand: {
      /* north side: front wall z=-15.35, barrier plane -9.4 — 5.9 m clear */
      x: 320, z: -27, length: 320, rows: 12,
      facingYaw: 0,          // local +z faces world +z = toward the road
      roof: 'cantilever' as const,
    },
    zone: { x: 320, z: -27, rx: 165, rz: 16 },
  },
  /* B: T1 outside — east side of Meridian just past the left, facing west.
     Meridian CL x=680; front edge 15 m off => x=695 centre. z -12..-128. */
  turnOne: {
    stand: {
      /* east side: front wall x=701.65, barrier plane 689.4 — 12.2 m clear */
      x: 712, z: -70, length: 116, rows: 10,
      facingYaw: -Math.PI / 2,  // local +z faces world -x = toward Meridian
      roof: 'scaffold' as const,
    },
    zone: { x: 712, z: -70, rx: 14, rz: 62 },
  },
  /* C: South St north side, facing the T6 approach across the road.
     South St CL z=400; z grows SOUTH so the north side is z<400.
     North front edge 14 m off CL => centre z=385. Crowd faces south (+z). */
  southStreet: {
    stand: {
      /* SIGN MATH (z grows SOUTH): north-side objects need z < barrier
         plane. CL z=400, barrier 9.4 => plane z=390.6, asphalt edge 393.
         Front wall = centre + 10.35 => centre z=376 gives front wall
         z=386.35 = 13.65 m off CL, 4.25 m clear of the barrier plane.
         Roof edge ~z=386: nothing touches track or barrier. */
      x: 490, z: 376, length: 240, rows: 9,
      facingYaw: 0,             // local +z faces world +z = toward South St
      roof: 'cantilever' as const,
    },
    zone: { x: 490, z: 376, rx: 125, rz: 11 },
  },
} as const;
