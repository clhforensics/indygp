/* M4D PIT LANE — core data (2026-09-07).
 *
 * Geography (Chris's refs): entry on the RIGHT just before T11 (Capitol
 * southbound), curling right to run PARALLEL between T11 and T12 on the
 * north side of Ohio St (westbound — pit is on the driver's right),
 * exit curling back onto the West St stretch just after the T12 sign.
 * Trees/paddock on the north side; garages face the boxes.
 *
 * HARD RULE: pit corridor stays >= 2.6 m clear of the barrier plane
 * (CL -9.4). Pit wall separates pit lane from the track; boxes/garages
 * sit on the far (north) side of the pit lane.
 *
 * Frame: z grows SOUTH. North of Ohio = z < -270 (MORE negative).
 */

export interface PitPathPoint {
  x: number;
  z: number;
}

/* World-space centreline of the pit lane, entry to exit.
   Ohio St CL is z=-270; barrier plane z=-279.4; pit wall z=-281;
   pit lane centre z=-287 (10 m wide: z -282..-292). */
const WAYPOINTS: PitPathPoint[] = [
  /* CHRIS-CORRECTED GEOMETRY (v2, after the 2/10 review):
     Track: Capitol runs SOUTHBOUND past T10 to T11 at (410,-270), then
     RIGHT onto Ohio westbound to T12 at (0,-270), then LEFT onto West St
     southbound. Pit = branch RIGHT (west) off Capitol BEFORE T11, run the
     lane NORTH of Ohio (z≈-287), exit by curling onto the West St stretch
     south of T12. Entry/exit cross the Ohio north verge at z≈-283, which
     is where the barrier/fence OPENINGS go (render kit). */
  { x: 405, z: -292 },   // capture: ON Capitol, 22 m before the T11 CL
  { x: 399, z: -283 },   // branch right (west), crossing the verge
  { x: 390, z: -285 },   // joining the parallel
  { x: 378, z: -287 },
  /* parallel: westbound between T11 (x=410) and T12 (x=0) */
  { x: 300, z: -287 },
  { x: 220, z: -287 },
  { x: 140, z: -287 },
  { x: 70, z: -287 },
  { x: 30, z: -287 },    // past the T12 corner, still parallel
  /* exit: curl left (south) onto the West St stretch — stay EAST of the
     West St CL (x>0) until below the T12 corner, then merge southbound.
     AUDIT: minimum approach to any CL outside the final merge >= 10 m. */
  { x: 16, z: -285 },
  { x: 10, z: -277 },
  { x: 9, z: -263 },     // exit opening: crosses Ohio perpendicular at x≈9
  { x: 6, z: -250 },
  { x: 3, z: -240 },
  { x: 0, z: -230 },     // merged: on West St CL heading south
  { x: 0, z: -216 },
];

export interface PitPath {
  pts: PitPathPoint[];
  cum: number[];        // cumulative arc length per point
  length: number;
  /** speed-limit zone along the path (s range) */
  limitFromS: number;
  limitToS: number;
  /** s values of the 5 box centres */
  boxS: number[];
  entryCapture: { x: number; z: number; r: number };
}

let cached: PitPath | null = null;

export function getPitPath(): PitPath {
  if (cached) return cached;
  const cum: number[] = [0];
  for (let i = 1; i < WAYPOINTS.length; i++) {
    const dx = WAYPOINTS[i].x - WAYPOINTS[i - 1].x;
    const dz = WAYPOINTS[i].z - WAYPOINTS[i - 1].z;
    cum.push(cum[i - 1] + Math.hypot(dx, dz));
  }
  const length = cum[cum.length - 1];

  /* speed limit from the parallel entry to the start of the exit curl */
  const limitFromS = cum[3];
  const limitToS = cum[9];

  /* 5 boxes spaced along the parallel section (centred) */
  const parallelStart = cum[4];
  const parallelEnd = cum[7];
  const boxS: number[] = [];
  for (let b = 0; b < 5; b++) {
    boxS.push(parallelStart + ((b + 0.5) * (parallelEnd - parallelStart)) / 5);
  }

  cached = {
    pts: WAYPOINTS,
    cum,
    length,
    limitFromS,
    limitToS,
    boxS,
    entryCapture: { x: 406, z: -295, r: 30 },
  };
  return cached;
}

/* Position + heading at arc length s along the pit path. */
export function samplePitPath(
  s: number,
): { x: number; z: number; tx: number; tz: number } {
  const p = getPitPath();
  const sc = Math.max(0, Math.min(p.length, s));
  let i = 1;
  while (i < p.cum.length - 1 && p.cum[i] < sc) i++;
  const t = (sc - p.cum[i - 1]) / Math.max(0.0001, p.cum[i] - p.cum[i - 1]);
  const a = p.pts[i - 1];
  const b = p.pts[i];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  return {
    x: a.x + dx * t,
    z: a.z + dz * t,
    tx: dx / len,
    tz: dz / len,
  };
}

/* Project a world position onto the path; returns s and lateral offset. */
export function projectOnPitPath(
  x: number,
  z: number,
): { s: number; lateral: number } {
  const p = getPitPath();
  let best = { s: 0, lateral: Infinity };
  for (let i = 1; i < p.pts.length; i++) {
    const a = p.pts[i - 1];
    const b = p.pts[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < Math.abs(best.lateral)) {
      best = { s: p.cum[i - 1] + t * Math.sqrt(len2), lateral: d };
    }
  }
  return best;
}

/* Speed limit inside the zone (game units, m/s ≈ 50 mph pit lane). */
export const PIT_SPEED_LIMIT = 22;
/* Stationary stop time in the box (seconds, includes the tire change). */
export const PIT_STOP_SECONDS = 3.2;

export const PIT_LANES = {
  /* lanes for AI pit approximation (offset from Ohio CL, negative = north) */
  aiPitLaneOffset: -16,
};
