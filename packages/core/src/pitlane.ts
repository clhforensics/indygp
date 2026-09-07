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
  /* entry: peel right off Capitol (CL x=410, southbound).
     HARD-RULE AUDIT: every non-capture waypoint >= 12 m from the nearest
     track CL (Capitol x=410 / Ohio z=-270; barrier plane 9.4 + 2.6). */
  { x: 402, z: -196 },   // capture point (on Capitol, right half)
  { x: 398, z: -222 },   // 12 m off Capitol CL
  { x: 396, z: -244 },   // 14 m off Capitol CL, begin the curl
  { x: 388, z: -258 },   // 22 m off Capitol / 12 m off Ohio
  { x: 382, z: -268 },
  { x: 370, z: -276 },   // parallel begins (pit lane z -282..-292)
  { x: 350, z: -282 },
  /* parallel: westbound between T11 (x=410) and T12 (x=0) */
  { x: 300, z: -286 },
  { x: 220, z: -287 },
  { x: 140, z: -287 },
  { x: 70, z: -286 },
  /* exit: continue past the T12 sign, curl left onto West St (CL x=0, +z) */
  { x: 20, z: -284 },
  { x: -18, z: -282 },
  { x: -44, z: -276 },
  { x: -54, z: -262 },
  { x: -52, z: -246 },
  { x: -40, z: -232 },
  { x: -20, z: -221 },
  { x: 0, z: -214 },     // merge back onto West St CL
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

  /* speed limit from the end of the curl to the start of the exit curl */
  const limitFromS = cum[4];   // z=-258, approaching the parallel
  const limitToS = cum[14];    // past the T12 sign, beginning the merge curl

  /* 5 boxes spaced along the parallel section (centred) */
  const parallelStart = cum[7];
  const parallelEnd = cum[10];
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
    entryCapture: { x: 402, z: -200, r: 26 },
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
