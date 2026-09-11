import type * as THREE from 'three';
import {
  DEFAULT_OPPONENT_GRID_SLOTS,
  STARTING_GRID_SLOT_COUNT,
  getStartingGridSlot,
  teamPhysicsAt,
  refSpeedAt,
  refBrakeAt,
  refThrottleAt,
  type TeamSpec,
  parsePersonaParam,
  assignPersonasRandom,
  type PersonaSpec,
  TIRE_SPECS, tireGripFactor, TIRE_WEAR_MAX,
  type TireId,
  AI_ROSTER, getRoster, parseRosterParam, clampPace, clampWearRate,
  type AiDriverEntry,
  evaluatePitDecision, createFuelState, burnFuel, refuelFull,
  pitTransitSeconds, releaseDelayFor,
  createRng,
  type FuelState,
} from '@indygp/core';
import type { Centreline } from '@indygp/core';

interface OpponentVisual {
  carRoot: THREE.Group;
  carBody: THREE.Group;
  frontAxle: THREE.Group[];
  allWheels: THREE.Mesh[];
  team?: TeamSpec;
  /* M3-BRAKELIGHTS: small rear strip mesh; material color toggled on brake. */
  brakeLight?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}

interface CompetitionTurn {
  s: number;
  radius: number;
}

interface CompetitionDeps {
  CL: Centreline;
  TURNS: CompetitionTurn[];
  opponents: OpponentVisual[];
  startLineS: number;
  gridOffset: number;
  /* PERSONAS-V1: parsed ?personas= param (random default). */
  personaMode?: { mode: 'random' | 'none' | 'single'; persona: PersonaSpec | null };
  /* M3-DIFFICULTY: scales the whole field's pace — NOT catch-up. */
  difficulty?: 'novice' | 'pro' | 'elite';
  /* RACE-V1: race mode's total laps (0 = open/practice, no fuel strategy). */
  totalLaps?: number;
  /* RACE-V1: ?roster=random shuffles the named AI roster. */
  rosterRandom?: boolean;
  /* QA-AUDIT M-3: fixed seed for deterministic harness runs (game omits it). */
  seed?: number;
  /* COLLISION-V1: the player as an obstacle the AI must see and avoid.
     step() receives him each tick; competition also reports contact events
     back so main.ts can scrub the player car (kinematic AI vs real physics
     player — the AI side is handled internally, the player's externally). */
  playerS?: number;
  playerLane?: number;
  playerSpeed?: number;
}

/* M3-DIFFICULTY: novice/pro/elite multipliers on AI_PACE_SCALE. 1.0 (pro)
   = the field runs Chris's measured laps exactly. Elite raises the ceiling
   for drivers fast enough to exploit it; novice eases the whole field. */
const DIFFICULTY_SCALE: Record<'novice' | 'pro' | 'elite', number> = {
  novice: 0.955,
  pro: 1.0,
  elite: 1.035,
};

interface DriverProfile {
  pace: number;
  cornerSkill: number;
  launch: number;
  consistency: number;
  lineBias: number;
  overtake: number;
  traction: number;
  exitAttack: number;
  phase: number;
  /* PERSONAS-V1: brake-point bias — negative brakes later, positive earlier.
     Implemented as a multiplier on the reference-profile look-ahead distances
     in targetSpeedFor: a late braker "sees" the corner sooner at distance, so
     we shrink look-ahead (arrive later = brake later). */
  brakeBias?: number;
  /* W1a BRAKING CHARACTER: multiplier on the AI's entry decel (AI_BRAKING_ENTRY).
     > 1 = brave late braker (carries speed deeper, needs the same distance),
     < 1 = early/safe braker (eases off sooner). Seeded per-driver, then
     layered by persona. Distinct from brakeBias, which moves the brake POINT;
     this shapes how HARD and how LONG the brake phase runs. */
  brakingEntry?: number;
  /* W1a CORNERING CHARACTER: mid-corner speed appetite multiplier on the
     straight-stretch ceiling in targetSpeedFor (> 1 hugs the limit through
     corners). Feeds the brake-light glow intensity too — committed corner
     entry = brighter, steadier light. */
  cornerCommit?: number;
  /** Per-corner mistake probability from the persona (0 = metronome). */
  mistake?: number;
  /** Persona tag for HUD / debugging; null = no persona (?personas=none). */
  personaTag?: string | null;
  /* M3-DEFENSE: persona defense trait (0 = never covers the line). */
  defenseBias?: number;
}

interface OpponentState {
  visual: OpponentVisual;
  id: number;
  s: number;
  speed: number;
  acceleration: number;
  targetSpeed: number;
  lane: number;
  laneTarget: number;
  laneVelocity: number;
  baseLane: number;
  driver: DriverProfile;
  wheelSpin: number;
  steer: number;
  elapsed: number;
  exitPenalty: number;
  lap: number;
  progress: number;
  /* PERSONAS-V1 mistake machinery. */
  mistakeTimer: number;
  mistakeCooldown: number;
  /* M2-TIRES: AI compound + wear. Wear follows the same falloff curve as the
     player so late-race AI pace varies honestly. */
  tireSpec: (typeof TIRE_SPECS)[TireId];
  tireWear: number;
  /** CHRIS-REFLAP: multiplier this driver applies to Chris's reference lap. */
  paceFactor: number;
  /* M3-BRAKELIGHTS: true while the driver is shedding meaningful speed. */
  braking: boolean;
  /** Centreline length (m) — pedal-trace lookups wrap the lap by it. */
  lapLength: number;
  /* W1b LIGHTS: brake pedal pressure 0..1 (0 = not braking). Derived from
     the commanded decel vs the driver's capability; drives the pulsing
     rear-light glow (F1 rain-light style) instead of a binary flip. */
  brakePressure: number;
  /** Smoothed light brightness 0..1 — eases so the pulse never snaps. */
  brakeGlow: number;
  /** Phase offset so a pack of brakers doesn't pulse in lockstep. */
  lightPhase: number;
  /* W1a BRAKE-TO-ARRIVE: the profile speed to hit and the distance left to
     shed it, computed in targetSpeedFor and consumed by
     desiredAcceleration. Replaces target-collapsing bang-bang braking:
     the AI now brakes AT the brake point at the physically-correct rate
     (v²-vt²)/(2d) instead of chasing a collapsed target 200 m early.
     brakeTargetEndD = the distance to the zone END (the corner apex
     itself) — deceleration is always computed over the REMAINING
     distance to that end, so the required rate converges as the car
     approaches instead of exploding when the start point passes. */
  brakeTargetV: number;
  brakeTargetD: number;
  brakeTargetEndD: number;
  /* M3-SLIPSTREAM: current draft multiplier (1 = no tow). */
  draft: number;
  /* M3-DEFENSE: cooldown so a leader may cover the line once per straight. */
  defenseCooldown: number;
  defenseSide: number;
  defenseBias?: number;
  /* M4D-PITS: none -> inPit (timer) -> none; wear-gated. */
  pitState: 'none' | 'inPit';
  pitTimer: number;
  /* COLLISION-V1: active contact state (paired with contactCarId). While
     active, BOTH cars decelerate until separation clears the pair. */
  contactCarId: number | null;   // -1 = player
  contactTimer: number;
  /* COLLISION-V1: post-contact immunity — a just-separated pair may not
     re-contact for a short window (stops scrape-retrigger spam). */
  contactCooldown: number;
  /* COLLISION-V1 pass commitment: once a driver has swerved out of overlap
     to pass, hold the swerve for this many seconds — prevents the
     swerve-out/pull-back flicker that pinned cars behind slower traffic. */
  passCommitTimer: number;
  passCommitSide: number;
  /* RACE-V1 roster identity + strategy state. */
  rosterEntry: AiDriverEntry;
  fuel: FuelState;
  lapsSinceStop: number;
  raceLap: number;
  releaseHoldS: number;
  pitStops: number;
  totalPitLossS: number;
  lapTimes: number[];       // completed lap times (s)
  lapClock: number;         // seconds since last line crossing
  bestLapS: number | null;
  lastLapS: number | null;
  finishTimeS: number | null;
}

interface TurnContext {
  sign: number;
  distance: number;
  radius: number;
}


/* INDYGP-H2.4-COMPETITIVE-EXIT: entry quality now influences corner-exit drive. */
/* Deterministic traits remain; there is still no rubber-banding. */
const DRIVERS: DriverProfile[] = [
  {
    pace: 0.955,
    cornerSkill: 0.94,
    launch: 0.9,
    consistency: 0.028,
    lineBias: -0.16,
    overtake: 0.9,
    traction: 0.92,
    exitAttack: 0.93,
    phase: 0.4,
    brakingEntry: 0.94, cornerCommit: 0.98,
  },
  {
    pace: 0.995,
    cornerSkill: 0.985,
    launch: 0.95,
    consistency: 0.02,
    lineBias: 0.12,
    overtake: 1.0,
    traction: 0.98,
    exitAttack: 0.99,
    phase: 2.2,
    brakingEntry: 0.99, cornerCommit: 1.0,
  },
  {
    pace: 1.035,
    cornerSkill: 1.02,
    launch: 1.0,
    consistency: 0.014,
    lineBias: -0.02,
    overtake: 1.08,
    traction: 1.03,
    exitAttack: 1.04,
    phase: 4.1,
    brakingEntry: 1.0,  cornerCommit: 1.04,
  },
  /* TEAMS-V1: profiles 4-9 fill the five-team grid. Varied but honest —
     same envelope as the original three, no catch-up behavior. */
  {
    pace: 0.972,
    cornerSkill: 0.955,
    launch: 0.92,
    consistency: 0.024,
    lineBias: 0.05,
    overtake: 0.94,
    traction: 0.95,
    exitAttack: 0.96,
    phase: 1.3,
    brakingEntry: 0.92, cornerCommit: 0.96,
  },
  {
    pace: 1.008,
    cornerSkill: 0.995,
    launch: 0.97,
    consistency: 0.019,
    lineBias: -0.1,
    overtake: 1.02,
    traction: 1.0,
    exitAttack: 1.0,
    phase: 3.2,
    brakingEntry: 0.97, cornerCommit: 1.02,
  },
  {
    pace: 0.938,
    cornerSkill: 0.93,
    launch: 0.88,
    consistency: 0.032,
    lineBias: 0.16,
    overtake: 0.88,
    traction: 0.9,
    exitAttack: 0.91,
    phase: 5.0,
    brakingEntry: 0.88, cornerCommit: 0.95,
  },
  {
    pace: 1.021,
    cornerSkill: 1.008,
    launch: 0.99,
    consistency: 0.016,
    lineBias: 0.08,
    overtake: 1.05,
    traction: 1.01,
    exitAttack: 1.02,
    phase: 0.9,
    brakingEntry: 0.99, cornerCommit: 1.03,
  },
  {
    pace: 0.984,
    cornerSkill: 0.972,
    launch: 0.94,
    consistency: 0.022,
    lineBias: -0.06,
    overtake: 0.97,
    traction: 0.97,
    exitAttack: 0.98,
    phase: 2.8,
    brakingEntry: 0.96, cornerCommit: 0.99,
  },
  {
    pace: 0.961,
    cornerSkill: 0.948,
    launch: 0.9,
    consistency: 0.027,
    lineBias: 0.11,
    overtake: 0.92,
    traction: 0.94,
    exitAttack: 0.94,
    phase: 4.7,
    brakingEntry: 0.93, cornerCommit: 0.97,
  },
];

const MPH_TO_MPS = 0.44704;
/* CHRIS-TUNE (2026-09-07): with the reference-lap model this is the global
   difficulty dial — 1.0 = the field runs Chris's measured profile exactly.
   Raise to make the pack quicker than the recorded laps, lower to ease off. */
const AI_PACE_SCALE = 1.0;
/* CHRIS-PARITY: compress the driver-table spread. The raw profiles span ~10%
   which strings the field out over seconds; compressed to ~3.5% of the
   deviation the field laps within a couple of seconds, with team/engine
   bias providing the remaining, realistic spread. */
const AI_SPREAD_COMPRESS = 0.35;
function tighten(value: number): number {
  return 1 + (value - 1) * AI_SPREAD_COMPRESS;
}
/* PERSONAS-V2 (2026-09-07 Chris feedback): the AI arrived at corners hot —
   the reference profile records where Chris ENDED UP, not how he got there
   (brake, then progressive throttle out). Entry allowance now assumes a more
   conservative decel (AI_BRAKING_ENTRY below) so the AI pre-slows like the
   data, while corner-EXIT ceilings (desiredAcceleration) keep their full
   power for competition — no granny throttle. */
const AI_BRAKING_ENTRY = 8.6;
/* W1a BRAKE-TO-ARRIVE (2026-09-09): the AI brake authority. Was 12.5 while
   the PLAYER's brake is 45 m/s² (CFG.car.brake) — the AI had a quarter of
   the player's braking and physically could not follow Chris's telemetry
   brake points (his profile legitimately contains ~38 m/s² decels). That
   single mismatch caused: 200 m-early "random" straight braking (the only
   way to make the corner), 3-4 s clamp-stabs, and invisible panic stops 8 m
   from the apex. Player-equivalent authority + brake-to-arrive = the AI
   brakes AT the 100 m board like the profile data says. Grip-scaled so
   worn/cold tires still bite less. */
const AI_BRAKE_MAX = 38;

/* ============================================================================
   COLLISION-V1 (2026-09-10, Chris spec):
   1. AI must AVOID collisions at all costs — back off, swerve, lift.
   2. Real contact slows BOTH cars until contact ends, then control resumes.
   Frames: everything lives in the (track-s, lateral-lane) frame the AI
   already uses; the player is fed into that frame from main.ts each tick.
   ========================================================================== */
/* Half-width of a car in the lateral frame. Grid spacing is 2.15 m per slot,
   road half-width ~4.6 m (wallOffset 9.4 includes the verge) — 1.05 m makes
   two side-by-side cars (|Δlane| < 2.1) touchable, matching the grid. */
const CAR_HALF_WIDTH = 1.05;
/* Car length for the longitudinal test (F1 car ≈ 5.4 m; +margin). */
const CAR_HALF_LENGTH = 2.9;

/* PERSONAS-V2 straights: Chris pulls away down the straights because the
   ref-lap ceiling (85.6 m/s ≈ 191 mph) sits under his power-curve ceiling
   (95 m/s ≈ 212 mph) and the old AI clamp was 88. Straight bias lets the AI
   stretch toward ~92 m/s where the profile is already near-flat, without
   touching corner speeds — and without rubber-banding (it's a constant,
   pace-independent multiplier). */
const AI_STRAIGHT_CLAMP = 92 * AI_PACE_SCALE;
const NORMAL_CORNER_MIN = 65 * MPH_TO_MPS;
const NORMAL_CORNER_MAX = 85 * MPH_TO_MPS;
const TIGHT_CORNER_MIN = 60 * MPH_TO_MPS;
const TIGHT_CORNER_MAX = 65 * MPH_TO_MPS;

const clamp = (value: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, value));

const clamp01 = (value: number): number => clamp(value, 0, 1);

function wrapS(value: number, length: number): number {
  return ((value % length) + length) % length;
}

function wrapAngle(value: number): number {
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

function signedTrackDelta(fromS: number, toS: number, length: number): number {
  let delta = wrapS(toS - fromS, length);
  if (delta > length * 0.5) delta -= length;
  return delta;
}

function sampleCentreline(CL: Centreline, s: number) {
  const wrapped = wrapS(s, CL.length);
  const raw = wrapped / CL.step;
  const i0 = Math.floor(raw) % CL.count;
  const i1 = (i0 + 1) % CL.count;
  const alpha = raw - Math.floor(raw);

  const x0 = CL.pts[i0 * 2];
  const z0 = CL.pts[i0 * 2 + 1];
  const x1 = CL.pts[i1 * 2];
  const z1 = CL.pts[i1 * 2 + 1];

  let tx = CL.tan[i0 * 2] * (1 - alpha) + CL.tan[i1 * 2] * alpha;
  let tz = CL.tan[i0 * 2 + 1] * (1 - alpha) + CL.tan[i1 * 2 + 1] * alpha;
  const len = Math.hypot(tx, tz) || 1;
  tx /= len;
  tz /= len;

  return {
    x: x0 * (1 - alpha) + x1 * alpha,
    z: z0 * (1 - alpha) + z1 * alpha,
    tx,
    tz,
  };
}

function headingAt(CL: Centreline, s: number): number {
  const sample = sampleCentreline(CL, s);
  return Math.atan2(sample.tz, sample.tx);
}

function curvatureAt(CL: Centreline, s: number): number {
  const halfWindow = 6;
  const before = headingAt(CL, s - halfWindow);
  const after = headingAt(CL, s + halfWindow);
  return Math.abs(wrapAngle(after - before)) / (halfWindow * 2);
}

function curvatureSpeedEnvelope(
  state: OpponentState,
  CL: Centreline
): number {
  /* CHRIS-PARITY: extended look-ahead so the envelope can brake from true
     straight-line speed (300 m) with the AI's civil decel instead of arriving
     at corner windows hot. */
  const lookAhead = [0, 12, 28, 50, 78, 115, 160, 215, 280, 300];
  const lateralAccel =
    17.5 * AI_PACE_SCALE *
    state.driver.cornerSkill *
    clamp(state.driver.pace, 0.94, 1.04);
  const braking = 10.5 * AI_PACE_SCALE;
  let allowed = Number.POSITIVE_INFINITY;

  for (const distance of lookAhead) {
    const curvature = curvatureAt(CL, state.s + distance);
    if (curvature < 0.0025) continue;

    const monumentLike = curvature >= 0.052;
    const minCurveSpeed = monumentLike ? TIGHT_CORNER_MIN : NORMAL_CORNER_MIN;
    const maxCurveSpeed = monumentLike ? TIGHT_CORNER_MAX : NORMAL_CORNER_MAX;
    const curveSpeed = clamp(
      Math.sqrt(lateralAccel / curvature),
      minCurveSpeed,
      maxCurveSpeed
    );

    const currentSpeedAllowance = Math.sqrt(
      curveSpeed * curveSpeed + 2 * braking * distance
    );

    allowed = Math.min(allowed, currentSpeedAllowance);
  }

  return allowed;
}

function turnSignAt(CL: Centreline, turnS: number): number {
  const before = sampleCentreline(CL, turnS - 14);
  const after = sampleCentreline(CL, turnS + 14);
  const cross = before.tx * after.tz - before.tz * after.tx;
  return Math.abs(cross) < 0.015 ? 0 : Math.sign(cross);
}

function nearestTurnContext(
  state: OpponentState,
  CL: Centreline,
  TURNS: CompetitionTurn[]
): TurnContext | null {
  let best: TurnContext | null = null;

  for (const turn of TURNS) {
    const distance = signedTrackDelta(state.s, turn.s, CL.length);
    if (distance < -48 || distance > 118) continue;

    const sign = turnSignAt(CL, turn.s);
    if (sign === 0) continue;

    const candidate = {
      sign,
      distance,
      radius: Math.max(8, turn.radius || 8),
    };

    if (!best || Math.abs(candidate.distance) < Math.abs(best.distance)) {
      best = candidate;
    }
  }

  return best;
}

function racingLineOffset(context: TurnContext | null): number {
  if (!context) return 0;

  const { sign, distance, radius } = context;
  const strength = clamp01((62 - radius) / 46);

  /* W1 LINE MODEL v2 (Chris's recording, 2026-09-10): the old approach
     ramp only started 118 m out and peaked at ~1.8 m — cars read glued to
     the centreline until the last second ("lines are definitely different
     than what I take"). Real line: commit to the outside EARLY (210 m) and
     reach full road width by ~70 m out, hold it to the brake point. */
  if (distance > 32) {
    const approach = clamp01((210 - distance) / 140);
    const eased = approach * approach * (3 - 2 * approach); // smoothstep
    return -sign * (1.55 + strength * 0.85) * eased;
  }

  if (distance >= -14) {
    const apex = 1 - clamp01(Math.abs(distance) / 46);
    /* W1 LINE v2.1 (recording 2): cars sat mid-road at the apex — the
       outside→inside transfer couldn't complete in the window. Stronger
       apex pull closes the transfer: a real racer dives to the kerb. */
    return sign * (1.25 + strength * 1.3) * apex;
  }

  const unwind = 1 - clamp01((-distance - 14) / 34);
  return sign * (0.58 + strength * 0.66) * unwind;
}

function driverRhythm(state: OpponentState): number {
  const { consistency, phase } = state.driver;
  const slow = Math.sin(state.elapsed * 0.43 + phase) * consistency;
  const slower =
    Math.sin(state.elapsed * 0.17 + phase * 1.7) *
    consistency *
    0.55;
  return 1 + slow + slower;
}

function markerSpeedEnvelope(
  state: OpponentState,
  CL: Centreline,
  TURNS: CompetitionTurn[],
  cruise: number,
  rhythm: number
): number {
  let target = cruise;

  for (const turn of TURNS) {
    const signed = signedTrackDelta(state.s, turn.s, CL.length);
    if (signed < -52 || signed > 92) continue;

    const radius = Math.max(8, turn.radius || 8);
    const monumentLike = radius <= 16;
    const cornerBase = monumentLike
      ? 62 * MPH_TO_MPS
      : radius <= 22
        ? 66 * MPH_TO_MPS
        : radius <= 32
          ? 74 * MPH_TO_MPS
          : radius <= 45
            ? 81 * MPH_TO_MPS
            : NORMAL_CORNER_MAX;
    const cornerFloor = monumentLike ? TIGHT_CORNER_MIN : NORMAL_CORNER_MIN;
    const cornerCeiling = monumentLike ? TIGHT_CORNER_MAX : NORMAL_CORNER_MAX;
    const cornerSpeed = clamp(
      cornerBase *
        AI_PACE_SCALE *
        state.driver.cornerSkill *
        state.driver.pace *
        clamp(rhythm, 0.97, 1.02),
      cornerFloor,
      cornerCeiling * AI_PACE_SCALE
    );

    if (signed >= 0) {
      const entryBlend = clamp01((92 - signed) / 72);
      target = Math.min(
        target,
        cruise + (cornerSpeed - cruise) * entryBlend
      );
      continue;
    }

    const exitProgress = clamp01((-signed - 8) / 44);
    const exitTarget =
      cornerSpeed + (cruise - cornerSpeed) * exitProgress;
    target = Math.min(target, exitTarget);
  }

  return target;
}

function targetSpeedFor(
  state: OpponentState,
  CL: Centreline,
  TURNS: CompetitionTurn[]
): number {
  /* CHRIS-REFLAP (2026-09-07): the AI's speed target is Chris's measured
     telemetry profile (one value per 10 m), scaled by this driver's blended
     trait. The profile already contains the real braking points, apex speeds
     and straight-line speeds — no analytic guessing. A small look-ahead min()
     keeps the car from targeting a fast bucket just before a slow one (it
     must still be able to slow down between buckets). */
  /* TELEMETRY-V2 COORD FIX (2026-09-10): the profile/pedal arrays are
     indexed LINE-RELATIVE (telemetry progressS subtracts startLineS), but
     state.s is ABSOLUTE centreline. Every follower lookup was shifted by
     S_LINE = 553.7 m — brake zones fired on the preceding straight ("not
     every corner" + "intermittent straight braking" — both Chris's
     observations). All profile reads now use the line-relative progress. */
  const s = state.progress;
  /* M2-TIRES: worn tires slow corner entry and mid-corner via paceFactor's
     grip term — the same falloff curve the player's physics uses. */
  const tireGrip = state.tireSpec.grip * tireGripFactor(state.tireSpec, state.tireWear);
  /* PERSONAS-V1: brake-point trait. The allowance sqrt(v²+2b·d) grows with
     look-ahead distance, so scaling d scales how long the driver keeps speed
     before a corner: negative brakeBias (late braker) sees corners "later"
     (larger d_eff → higher current allowed speed → brakes deeper); positive
     brakeBias (smooth/early) shrinks d_eff and brakes earlier. */
  /* PROFILE-FOLLOWER (2026-09-09, Chris's directive: "use reference laps to
     get the logic rewired"). All the hand-rolled machinery — look-ahead
     allowance min, straight-boost gate, min-scan, brake margins — is GONE.
     The reference profile IS the driver model: it encodes where Chris
     braked, how hard, and what speed he carried. The follower's job is
     only to EXECUTE the profile as a speed plan and derive the brake
     trace from the profile's own decel:

     1. plan speed = profile(s) * paceFactor — the speed to be AT, now.
     2. look ahead ~120 m for the biggest upcoming slow-down that the car
        is currently over-speed for; derive the required decel a =
        (v²-vt²)/(2d) and stash (vt, d) as the brake zone. brakingEntry
        bravery shifts the zone START (brave = shorter margin = later,
        harder; safe = longer margin, earlier, gentler) — character lives
        where it belongs, at the brake point.
     3. desiredAcceleration executes the zone; the brake lights render the
        commanded decel, so lights fire exactly where Chris braked. */

  let planV = refSpeedAt(s, CL.length) * state.paceFactor;
  /* CORNER-GRIP HONESTY (Chris: "uncanny cornering ability"): apex speeds
     are a grip limit from Chris's own telemetry, not a pace dial — a car
     cannot corner 5% faster than the data's limit just by being quick.
     Where Chris was on/just off the brakes (his corner envelope), compress
     paceFactor to at most +1.5%; full paceFactor applies only on straights
     (top-speed differences ARE realistic). */
  {
    const chrisBrk = refBrakeAt(s, CL.length);
    const chrisBrkBehind = refBrakeAt(s - 60, CL.length);
    const chrisBrkAhead = refBrakeAt(s + 60, CL.length);
    const cornerish = Math.max(chrisBrk, chrisBrkBehind * 0.6, chrisBrkAhead * 0.6);
    if (cornerish > 0.08) {
      const flat = 1 + (state.paceFactor - 1) * 0.32;  // compress toward 1
      planV = refSpeedAt(s, CL.length) * flat;
    }
  }

  /* TELEMETRY-V2 PEDAL-TRACE ZONES: the brake trace is Chris's own. Scan
     ahead for the first bucket where REF_BRAKE > 0.15 (he's on the brakes)
     AND the profile there is slower than we are — that's his brake point.
     The zone runs to where the profile reaches its min (apex). brakingEntry
     bravery only modulates the pressure cap, not the point: Chris's brake
     points ARE the points; character = how hard each driver leans on them. */
  let zoneV = 0, zoneD = 0, zoneEndD = 0;
  const hereBrake = refBrakeAt(s, CL.length);
  if (hereBrake < 0.12) {
    /* not already inside a Chris brake zone — look ahead for the next one */
    let apexV = Infinity, apexD = 0;
    let inZone = false;
    for (let d = 10; d <= 420; d += 10) {
      const bAhead = refBrakeAt(s + d, CL.length);
      const vAhead = refSpeedAt(s + d, CL.length);
      if (bAhead > 0.15) {
        if (!inZone) { inZone = true; zoneD = Math.max(d - 10, 8); }
        if (vAhead < apexV) { apexV = vAhead; apexD = d; }
      } else if (inZone && bAhead < 0.05 && d > zoneD + 30) {
        break;   // Chris released — zone over
      }
    }
    if (inZone && apexV < state.speed - 2) {
      zoneV = Math.max(apexV, TIGHT_CORNER_MIN) * state.paceFactor;
      zoneEndD = apexD + 15;
    } else {
      zoneV = 0; zoneD = 0; zoneEndD = 0;
    }
  } else {
    /* inside a Chris brake zone: follow the profile down to its local min */
    let apexV = refSpeedAt(s, CL.length);
    let apexD = 0;
    for (let d = 10; d <= 200; d += 10) {
      const vAhead = refSpeedAt(s + d, CL.length);
      if (vAhead < apexV) { apexV = vAhead; apexD = d; }
      if (refBrakeAt(s + d, CL.length) < 0.05 && d > 30) break;
    }
    zoneV = Math.max(apexV, TIGHT_CORNER_MIN) * state.paceFactor;
    zoneD = 8;
    zoneEndD = apexD + 15;
  }
  state.brakeTargetV = zoneV;
  state.brakeTargetD = zoneD;
  state.brakeTargetEndD = zoneEndD;

  /* the speed plan: where the profile is flat, allow the AI to stretch a
     little above it (power-curve headroom) — but only where CHRIS was
     himself at full throttle here and 100 m ahead (thr >= 0.95): his
     throttle-on buckets ARE the straights; no descent guessing. */
  if (planV >= 78) {
    const flatAhead = refThrottleAt(s, CL.length) >= 0.95 &&
      refThrottleAt(s + 100, CL.length) >= 0.9;
    if (flatAhead) {
      const commit = clamp(
        (state.driver.cornerCommit ?? 1) * state.paceFactor,
        0.94, 1.06,
      );
      planV = Math.min(planV * 1.09 * commit, AI_STRAIGHT_CLAMP * state.paceFactor);
    }
  }
  void TURNS;
  return clamp(planV, TIGHT_CORNER_MIN, AI_STRAIGHT_CLAMP);
}

function interactionFor(
  state: OpponentState,
  states: OpponentState[],
  CL: Centreline,
  player: { s: number | null; lane: number | null; speed: number | null },
): { laneBias: number; speedCap: number; draft: number; ahead: OpponentState | null } {
  /*
   * Race intent (SHIPPED, restored 2026-09-10 late): attack a slower rival
   * whenever there is usable closing speed. COLLISION-V1 lesson: the
   * avoidance rewrite (overlap gating, stoppableV, back-off taxes) made the
   * player-in-the-pack a 30 m speed governor and pinned the field below
   * race pace — Chris: "not running at race speed". The AI's anti-contact
   * protection now lives ENTIRELY in resolveContacts (real collisions cost
   * real time); this function is the shipped race-intent model again, with
   * the player treated as just another car in the train.
   */
  let nearestAhead: OpponentState | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestIsPlayer = false;

  for (const other of states) {
    if (other === state) continue;
    if (other.pitState === 'inPit' || state.pitState === 'inPit') continue;

    const delta = signedTrackDelta(state.s, other.s, CL.length);
    if (delta <= 0 || delta >= nearestDistance) continue;

    nearestAhead = other;
    nearestDistance = delta;
    nearestIsPlayer = false;
  }

  /* the player is in the train too — same margins, no special governor */
  if (player.s != null) {
    const pDelta = signedTrackDelta(state.s, player.s, CL.length);
    if (pDelta > 0 && pDelta < nearestDistance) {
      nearestDistance = pDelta;
      nearestIsPlayer = true;
    }
  }
  const aheadSpeed = nearestIsPlayer ? (player.speed ?? 0) : nearestAhead?.speed ?? 0;
  const aheadObj = nearestIsPlayer ? null : nearestAhead;

  if ((nearestAhead === null && !nearestIsPlayer) || nearestDistance > 30) {
    return { laneBias: 0, speedCap: Number.POSITIVE_INFINITY, draft: 1, ahead: nearestAhead };
  }

  const closing = state.speed - aheadSpeed;
  const overtakeSide = state.id % 2 === 0 ? 1 : -1;
  const aggression = state.driver.overtake;

  /* M3-SLIPSTREAM: sitting within ~15 m behind a car raises the draft
     ceiling — only meaningful where targetSpeed is flat-out (straights),
     because targetSpeedFor already caps corner speeds lower. 3.5% max,
     constant — no rubber-band, it's how a draft works. */
  const draft =
    nearestDistance < 15 ? 1.035 : nearestDistance < 25 ? 1.015 : 1;

  if (nearestDistance < 6.5) {
    return {
      laneBias: overtakeSide * 1.5 * aggression,
      speedCap: Math.max(16, aheadSpeed - 2.2),
      draft,
      ahead: aheadObj,
    };
  }

  if (nearestDistance < 17 && closing > 0.6) {
    return {
      laneBias: overtakeSide * 1.4 * aggression,
      speedCap: aheadSpeed + 2.4,
      draft,
      ahead: aheadObj,
    };
  }

  if (nearestDistance < 25 && closing > 0.2) {
    return {
      laneBias: overtakeSide * 0.72 * aggression,
      speedCap: aheadSpeed + 4.2,
      draft,
      ahead: aheadObj,
    };
  }

  return { laneBias: 0, speedCap: Number.POSITIVE_INFINITY, draft, ahead: aheadObj };
}


/* ============================================================================
   COLLISION-V1 CONTACT RESOLUTION
   Overlapping pairs (longitudinal AND lateral) enter contact: BOTH cars
   decelerate hard while contact persists. Contact ends when the pair
   separates — gap opens past car length OR lanes split past car width.
   A gentle lateral push (both directions apart) helps the grind end and
   reads on camera as cars bouncing off each other.
   ========================================================================== */
const CONTACT_DECEL = 6.5;        // m/s² both cars shed while touching (full severity)
const CONTACT_DECEL_MIN = 1.2;    // m/s² floor for light grazes (severity ~0)
const CONTACT_SEPARATE_D = 7.5;   // gap (m) that ends contact
const CONTACT_SEPARATE_LAT = 2.3; // lateral split that ends contact
const CONTACT_PUSH = 0.9;         // lateral push each car receives (m/s)
const CONTACT_IMMUNITY_S = 2.0;   // post-separation re-contact immunity (s)

export interface ContactEvent {
  aId: number;            // AI id, or -1 for the player
  bId: number;            // AI id, or -1 for the player
  playerInvolved: boolean;
  severity: number;       // 0..1 (closing overlap depth)
  closing: number;        // m/s gap-shrink rate at impact (impact energy proxy)
}

/* Returns contact events raised THIS tick (AI-vs-AI and player-vs-AI).
   Player side effects (speed scrub) are applied by main.ts on the real
   physics car; AI side effects are applied here directly. */
function resolveContacts(
  states: OpponentState[],
  dt: number,
  CL: Centreline,
  player: { s: number | null; lane: number | null; speed: number | null; laneVel?: number },
): ContactEvent[] {
  const events: ContactEvent[] = [];

  /* --- AI vs AI pairs --- */
  for (let i = 0; i < states.length; i++) {
    const a = states[i];
    if (a.pitState === 'inPit') continue;
    for (let j = i + 1; j < states.length; j++) {
      const b = states[j];
      if (b.pitState === 'inPit') continue;

      const dAB = signedTrackDelta(a.s, b.s, CL.length);
      const dBA = signedTrackDelta(b.s, a.s, CL.length);
      const gap = Math.min(Math.abs(dAB), Math.abs(dBA));
      const latGap = Math.abs(a.lane - b.lane);
      /* Closing speed of the pair: positive = gap shrinking. Nose-to-tail
         on the same line at MATCHED speed is drafting — legal racing, not
         contact. (The 10%-speed regression: with the whole field on one
         racing line, overlap alone fired contacts on every pair, the mutual
         decel cascaded, and the player scrub compounded it per pass.) */
      const closing = Math.max(
        (a.speed - b.speed) * Math.sign(dAB),
        (b.speed - a.speed) * Math.sign(dBA),
      );
      /* Contact needs MOTION (grid artifact guard) and a CLOSING component
         (matched-speed overlap is draft, not touch). Side-by-side at
         matched speed with lanes HELD is wheel-to-wheel racing — only
         converging lanes (one car squeezing across) is a collision. */
      const moving = a.speed > 1 || b.speed > 1;
      const latConverging = latGap < CAR_HALF_WIDTH * 2 &&
        Math.sign(a.laneVelocity - b.laneVelocity) === Math.sign(b.lane - a.lane || 1) &&
        Math.abs(a.laneVelocity - b.laneVelocity) > 0.5;
      const touching = moving && (closing > 3.0 || latConverging) &&
        gap < CAR_HALF_LENGTH * 2 && latGap < CAR_HALF_WIDTH * 2;

      /* COLLISION-V1 side-by-side squeeze: two cars wheel-to-wheel with
         converging lines — the trailing car yields speed AND lateral room
         BEFORE metal touches. Only when actually CLOSING — drafting at
         matched speed behind a car is normal, not a squeeze. */
      const sideBySide = gap < 6 && latGap < CAR_HALF_WIDTH * 2.4 && closing > 0.5;
      if (sideBySide && !touching && a.contactCarId == null && b.contactCarId == null) {
        const trailing = dAB > 0 ? a : b;   // dAB>0: b ahead of a
        const leading = trailing === a ? b : a;
        /* trailing car lifts slightly and leans away */
        trailing.targetSpeed = Math.min(trailing.targetSpeed, leading.speed - 0.8);
        const away = Math.sign(trailing.lane - leading.lane) || 1;
        trailing.laneTarget = clamp(
          trailing.laneTarget + away * 0.5 * dt * 10,
          -2.9, 2.9,
        );
      }

      if (touching) {
        const severity = clamp01(1 - gap / (CAR_HALF_LENGTH * 2));
        if (a.contactCarId == null && b.contactCarId == null &&
            a.contactCooldown <= 0 && b.contactCooldown <= 0) {
          a.contactCarId = b.id;
          b.contactCarId = a.id;
          a.contactTimer = 0;
          b.contactTimer = 0;
          /* HUD events only for NOTICEABLE hits: a light apex rub (low
             severity, low closing) is racing - no note, no scrub. */
          if (severity >= 0.25 || closing >= 6) {
            events.push({
              aId: a.id, bId: b.id, playerInvolved: false,
              severity,
              closing,
            });
          }
        }
        a.contactTimer += dt;
        b.contactTimer += dt;
        /* Chris spec: contact slows BOTH cars until contact ends - scaled
           by severity so a light graze nudges and a solid hit bleeds hard.
           Asymmetric: the trailing car of the pair carries more of the cost
           (the driver who should have yielded), the leader less. */
        const decel = CONTACT_DECEL_MIN + (CONTACT_DECEL - CONTACT_DECEL_MIN) * severity;
        const trailingA = dAB > 0;   // b ahead of a => a is trailing
        const decelA = decel * (trailingA ? 1.15 : 0.85);
        const decelB = decel * (trailingA ? 0.85 : 1.15);
        a.speed = Math.max(4, a.speed - decelA * dt);
        b.speed = Math.max(4, b.speed - decelB * dt);
        /* gentle separation push, both cars apart (helps the grind end) */
        const pushDir = a.lane <= b.lane ? -1 : 1;
        a.laneVelocity += pushDir * CONTACT_PUSH * dt;
        b.laneVelocity -= pushDir * CONTACT_PUSH * dt;
      } else if (a.contactCarId === b.id) {
        /* contact only ends on genuine separation */
        if (gap > CONTACT_SEPARATE_D || latGap > CONTACT_SEPARATE_LAT) {
          a.contactCarId = null;
          b.contactCarId = null;
          a.contactCooldown = CONTACT_IMMUNITY_S;
          b.contactCooldown = CONTACT_IMMUNITY_S;
        }
      }
    }
  }

  /* --- player vs AI --- */
  if (player.s != null && player.lane != null) {
    for (const a of states) {
      if (a.pitState === 'inPit') continue;
      const d = Math.abs(signedTrackDelta(a.s, player.s, CL.length));
      const latGap = Math.abs(a.lane - player.lane);
      /* matched-speed draft behind the player is NOT contact — need a
         closing component (player faster than the AI he's catching, or
         the AI ramming him from behind). */
      const dSigned = signedTrackDelta(a.s, player.s, CL.length);
      const closing = Math.max(
        ((player.speed ?? 0) - a.speed) * Math.sign(dSigned),
        (a.speed - (player.speed ?? 0)) * -Math.sign(dSigned),
      );
      const moving = a.speed > 1 || (player.speed ?? 0) > 1;
      /* side-by-side at matched speed = wheel-to-wheel racing; contact only
         on strong closing (rear-end) or converging lanes (squeeze across). */
      const latConverging = latGap < CAR_HALF_WIDTH * 2 &&
        Math.sign(a.laneVelocity - player.laneVel) ===
          Math.sign(a.lane - player.lane || 1) &&
        Math.abs(a.laneVelocity - player.laneVel) > 0.6;
      const touching = moving && (closing > 3.0 || latConverging) &&
        d < CAR_HALF_LENGTH * 2 && latGap < CAR_HALF_WIDTH * 2;

      if (touching) {
        const severity = clamp01(1 - d / (CAR_HALF_LENGTH * 2));
        if (a.contactCarId !== -1 && a.contactCooldown <= 0) {
          a.contactCarId = -1;
          a.contactTimer = 0;
          if (severity >= 0.25 || closing >= 6) {
            events.push({
              aId: a.id, bId: -1, playerInvolved: true,
              severity,
              closing,
            });
          }
        }
        a.contactTimer += dt;
        /* the AI car sheds speed while in contact (player scrubbed outside) */
        const decel = CONTACT_DECEL_MIN + (CONTACT_DECEL - CONTACT_DECEL_MIN) * severity;
        a.speed = Math.max(4, a.speed - decel * dt);
        const pushDir = a.lane <= player.lane ? -1 : 1;
        a.laneVelocity += pushDir * CONTACT_PUSH * dt;
      } else if (a.contactCarId === -1) {
        if (d > CONTACT_SEPARATE_D || latGap > CONTACT_SEPARATE_LAT) {
          a.contactCarId = null;
          a.contactCooldown = CONTACT_IMMUNITY_S;
        }
      }
    }
  }

  return events;
}

function updateExitPenalty(
  state: OpponentState,
  turn: TurnContext | null,
  dt: number
): void {
  if (!turn) {
    state.exitPenalty = Math.max(0, state.exitPenalty - dt * 0.32);
    return;
  }

  if (turn.distance > 0 && turn.distance < 58) {
    const speedOvershoot = clamp01(
      (state.speed - state.targetSpeed) / 9
    );
    const lineError = clamp01(
      Math.abs(state.laneTarget - state.lane) / 1.8
    );
    const skillPenalty = clamp01(
      (1.02 - state.driver.cornerSkill) * 1.8
    );
    const demand = clamp(
      speedOvershoot * 0.5 +
        lineError * 0.22 +
        skillPenalty * 0.12,
      0,
      0.52
    );

    state.exitPenalty += clamp(
      demand - state.exitPenalty,
      -0.24 * dt,
      0.9 * dt
    );
    return;
  }

  const recovering =
    turn.distance <= 0 && turn.distance > -62;

  state.exitPenalty = Math.max(
    0,
    state.exitPenalty -
      dt *
        (recovering
          ? 0.08 + state.driver.traction * 0.12
          : 0.3)
  );
}

function desiredAcceleration(
  state: OpponentState,
  turn: TurnContext | null,
  deltaSpeed: number
): number {
  if (deltaSpeed < -0.25) {
    /* W1a-FIX BRAKE-TO-ARRIVE (2026-09-09, Chris's brake-light
       observations): the old `deltaSpeed * 1.8` was bang-bang — full brake
       authority the instant the collapsed target dipped below speed. The
       AI braked 200 m early on straights and panic-stabbed 8 m from the
       apex (front-runners' invisible one-flash "no braking"; mid-pack
       "random straight braking"). Now: when targetSpeedFor has marked a
       brake zone (brakeTargetD > 0), decel at the physically-correct rate
       to ARRIVE at the zone speed AT the zone: a = (v²-vt²)/(2d), scaled
       by the driver's brakingEntry bravery and tire grip. Outside a zone
       (small speed trims) keep the gentle proportional fallback. */
    const zoneV = state.brakeTargetV;
    /* remaining distance to the zone END (the corner entry). The zone
       START (brakeTargetD) passes as the car advances, but the required
       rate must be computed over the distance REMAINING to the end — not
       the static start offset — or it explodes as the car closes in. */
    const remD = state.brakeTargetEndD > 0 ? state.brakeTargetEndD : state.brakeTargetD;
    if (remD > 0 && zoneV > 0 && state.speed > zoneV) {
      const v2 = state.speed * state.speed;
      const vt2 = zoneV * zoneV;
      const required = (v2 - vt2) / (2 * Math.max(remD, 8));
      const tireGrip = state.tireSpec.grip * tireGripFactor(state.tireSpec, state.tireWear);
      /* TELEMETRY-V2: pressure mirrors Chris's own brake trace at this
         spot (refBrakeAt 0..1) — the lights then render HIS pressure
         shape, with each driver's bravery modulating ±10% around it. */
      /* COORD FIX: progress is line-relative, matching the pedal arrays. */
      const chrisPressure = refBrakeAt(state.progress, state.lapLength);
      const pressure = clamp(chrisPressure * (state.driver.brakingEntry ?? 1) * 1.05, 0.25, 1.0);
      const brakeCap = AI_BRAKE_MAX * tireGrip * pressure;
      return clamp(-required, -brakeCap, -2.2);
    }
    const rate = 1.8 * (0.45 + 0.55 * clamp01(-deltaSpeed / 30));
    return clamp(deltaSpeed * rate, -AI_BRAKE_MAX, -2.2);
  }

  if (deltaSpeed <= 0.25) {
    return 0;
  }

  const cornerZone =
    turn && turn.distance > -54 && turn.distance < 48;
  const exitZone =
    turn && turn.distance <= 6 && turn.distance > -62;

  /* CHRIS-ACCEL (2026-09-07): the old 2.15-5.1 m/s2 ceilings meant the AI
     could never reach the reference-profile speeds — the player pulls ~30
     m/s2 out of corners. Ceilings now match the player car's power curve so
     targetSpeed is the binding constraint, not throttle. */
  if (exitZone && turn) {
    const exitProgress = clamp01(
      (-turn.distance + 6) / 68
    );
    const progressiveBase =
      (6.0 + exitProgress * 16.0) * AI_PACE_SCALE;
    const tractionScale =
      state.driver.traction *
      state.driver.exitAttack *
      (1 - state.exitPenalty * 0.72);

    return Math.min(
      progressiveBase *
        state.driver.launch *
        tractionScale,
      deltaSpeed * 1.15
    );
  }

  const base = cornerZone ? 9.0 : 22.0;
  return Math.min(
    base * AI_PACE_SCALE * state.driver.launch,
    deltaSpeed * 1.15
  );
}

function updateLongitudinal(
  state: OpponentState,
  turn: TurnContext | null,
  dt: number
): void {
  const deltaSpeed = state.targetSpeed - state.speed;
  const desired = desiredAcceleration(state, turn, deltaSpeed);

  /* CHRIS-ACCEL: ceiling raised to match the player power curve (32 m/s2 at
     zero speed). Jerk up so the throttle actually stamps, not trickles. */
  const jerk =
    desired < state.acceleration ? 18 : 14;
  state.acceleration += clamp(
    desired - state.acceleration,
    -jerk * dt,
    jerk * dt
  );

    /* W1a: decel ceiling now AI_BRAKE_MAX (player-equivalent); the old -12.5
     was a quarter of the player's brake and the root of the braking bugs. */
  state.acceleration = clamp(state.acceleration, -AI_BRAKE_MAX, 30 * AI_PACE_SCALE);
  state.speed = Math.max(0, state.speed + state.acceleration * dt);
  /* M3-BRAKELIGHTS + W1b: continuous brake pressure from commanded decel.
     0 below ~1.2 m/s² (coast/regen), 1.0 by ~8.7 m/s² (a real stop). The
     binary `braking` flag stays for replay/HUD use at the same threshold. */
  const decel = -state.acceleration;
  /* Light threshold above lift-and-coast: Chris's own pre-zone lift reads
     ~2.5-4 m/s2 in the telemetry with thr 0.5-0.8 — a driver easing OFF,
     not braking. Lights fire on genuine pedal (>= ~3.5 m/s2), matching the
     pressure curve Chris's trace produces inside his real zones. */
  state.brakePressure = clamp01((decel - 3.2) / 6.0);
  state.braking = decel > 4.0;

  /* W1a BRAKE-TO-ARRIVE: the old unconditional catcher (-7.5 m/s² whenever
     speed exceeded the collapsed target) was the bang-bang brake — it ran
     on TOP of desiredAcceleration, producing 200 m-early stabs. Now, while
     a brake zone is active the brake-to-arrive rate in desiredAcceleration
     governs; the catcher only guards against overshooting the zone speed
     itself (soft 0.5 m/s² trim), never hard-brakes on its own. */
  const inBrakeZone = state.brakeTargetD > 0 && state.brakeTargetV > 0;
  if (state.speed > state.targetSpeed + 0.8) {
    if (inBrakeZone) {
      state.speed = Math.max(
        state.targetSpeed,
        state.speed - 0.5 * dt
      );
    } else {
      state.speed = Math.max(
        state.targetSpeed,
        state.speed - 7.5 * dt
      );
    }
  }
}

export function createCompetition({
  CL,
  TURNS,
  opponents,
  startLineS,
  gridOffset,
  personaMode = { mode: 'random', persona: null },
  difficulty = 'pro',
  totalLaps = 30,
  rosterRandom = false,
  /* QA-AUDIT M-3: deterministic sim randomness. The game passes nothing
     (time-based seed); the harness passes a fixed seed so replays are
     byte-identical and regressions reproducible. */
  seed,
}: CompetitionDeps) {
  const rng = createRng(seed ?? (Date.now() & 0x7fffffff));
  /* M3-DIFFICULTY: one multiplicative dial over the whole field. Applied in
     paceFactor so it flows through every speed path (profile, straights,
     tire grip) — never as a catch-up term tied to the player's position. */
  const difficultyScale = DIFFICULTY_SCALE[difficulty] ?? 1;
  /* PERSONAS-V1: one persona per AI driver. Default = random per race; a
     single persona id pins the whole pack (useful for testing one behavior). */
  const personas = personaMode.mode === 'single' && personaMode.persona
    ? opponents.map(() => personaMode.persona as PersonaSpec)
    : personaMode.mode === 'none'
      ? opponents.map(() => null)
      : assignPersonasRandom(opponents.length, rng.next);

  /* RACE-V1: named roster. Slot i of the field takes roster entry i; extra
     opponents beyond the roster reuse entries round-robin. */
  const roster = getRoster(rosterRandom);

  const states: OpponentState[] = opponents.map((visual, index) => {
    /* TEAMS-V1: each opponent carries its team; the team's pace bias and the
       intra-team driver spread (car 1 vs car 2) seed the DriverProfile. */
    const team = visual.team;
    const base = DRIVERS[index] ?? DRIVERS[DRIVERS.length - 1];
    /* CHRIS-PARITY: compress raw profile spread, then layer team bias,
       intra-team spread and engine power. */
    const teamBias = team ? team.aiPaceBias : 0;
    const carNoInTeam = index % 2; // 0 = team leader, 1 = teammate
    const teamSpread = carNoInTeam === 0 ? 0.004 : -0.006;
    const engineBias = team ? teamPhysicsAt(team, 0).power - 1 : 0;
    const driver: DriverProfile = {
      pace: tighten(base.pace) * (1 + teamBias + teamSpread + engineBias * 0.35),
      cornerSkill: tighten(base.cornerSkill) *
        (1 + (team ? (team.chassis.latGrip - 1) * 0.4 : 0)),
      launch: tighten(base.launch),
      consistency: base.consistency,
      lineBias: base.lineBias,
      overtake: tighten(base.overtake),
      traction: tighten(base.traction),
      exitAttack: tighten(base.exitAttack) *
        (1 + (team ? (team.chassis.topSpeed - 1) * 0.5 : 0)),
      phase: base.phase,
      /* PERSONAS-V1: layer persona deltas on top of team/driver blend. */
      brakingEntry: base.brakingEntry ?? 1,
      cornerCommit: base.cornerCommit ?? 1,
      brakeBias: base.brakeBias ?? 0,
      mistake: base.mistake ?? 0,
      personaTag: base.personaTag ?? null,
    };
    const persona = personas[index] ?? null;
    if (persona) {
      driver.pace *= persona.pace ?? 1;
      driver.cornerSkill *= persona.cornerSkill ?? 1;
      driver.consistency *= persona.consistencyMul ?? 1;
      driver.overtake *= persona.overtake ?? 1;
      driver.traction *= persona.traction ?? 1;
      driver.exitAttack *= persona.exitAttack ?? 1;
      driver.launch *= persona.launch ?? 1;
      /* W1a: persona layering on the new character traits. brakeBias is
         the brake-POINT axis (negative = late braker = deeper entry): map
         late personas toward the 1.0 deep baseline, smooth ones earlier.
         Sign: brakeBias -1 (LBA) -> +10% depth; +1 -> -10% depth. Capped
         at 1.0 (the overshoot-catcher ceiling measured above).
         cornerCommit follows the persona's cornerSkill intent. */
      driver.brakingEntry = Math.min(1, driver.brakingEntry * (1 - (persona.brakeBias ?? 0) * 0.1));
      driver.cornerCommit *= 1 + ((persona.cornerSkill ?? 1) - 1) * 0.9;
      driver.lineBias += persona.lineBias ?? 0;
      driver.brakeBias = persona.brakeBias ?? driver.brakeBias;
      driver.mistake = persona.mistake ?? driver.mistake;
      driver.defenseBias = persona.defense ?? 0;
      driver.personaTag = persona.tag;
    }
    /* COLLISION-V1 FIX (Chris's 2026-09-10 7:05pm recording): the old
       fallback (index+1) re-issued slots — with 9 opponents the table
       [3,5,6] ran out and slots 4/5/6 were DOUBLED: two pairs spawned
       inside each other and one car spawned in the PLAYER'S box (slot 4).
       Pre-collision that was cosmetic; with contact physics it fired
       sev-1.0 contacts at green, pinned three pairs at 4 m/s, and turned
       the launch into a pile-up. Fill EVERY unused slot exactly once:
       player owns 4, opponents take 1,2,3,5,6,7,8,9,10 in order. */
    const OPPONENT_SLOT_ORDER = [1, 2, 3, 5, 6, 7, 8, 9, 10];
    const requestedSlot = OPPONENT_SLOT_ORDER[index] ??
      STARTING_GRID_SLOT_COUNT;
    const grid = getStartingGridSlot(requestedSlot, gridOffset);
    const raceS = wrapS(startLineS + grid.longitudinal, CL.length);
    const raceProgress = wrapS(raceS - startLineS, CL.length);

    return {
      visual,
      id: index,
      s: raceS,
      speed: 0,
      acceleration: 0,
      targetSpeed: 0,
      lane: grid.lateral,
      laneTarget: grid.lateral,
      laneVelocity: 0,
      baseLane: grid.lateral,
      driver,
      wheelSpin: 0,
      braking: false,
      lapLength: CL.length,
      /* W1b LIGHTS: continuous brake state for the pulsing rear light. */
      brakePressure: 0,
      brakeGlow: 0,
      lightPhase: rng.next() * Math.PI * 2,
      /* W1a BRAKE-TO-ARRIVE: recomputed every tick by targetSpeedFor. */
      brakeTargetV: 0,
      brakeTargetD: 0,
      brakeTargetEndD: 0,
      steer: 0,
      elapsed: 0,
      exitPenalty: 0,
      lap: 0,
      progress: raceProgress,
      mistakeTimer: 0,
      mistakeCooldown: 6 + rng.next() * 10,
      /* M2-TIRES: strategy flavor — aggressive personas go Soft, conservative
         go Hard, everyone else Medium. Illyrian teams lean Soft to exploit
         early power; Vulcan (St. Clair) leans Hard for the long game. */
      tireSpec: TIRE_SPECS[(() => {
        if (!persona) return 'medium';
        const care = persona.tireCare ?? 1;
        if (care >= 1.1) return 'medium';      // tire-preservers don't need softs
        if (care <= 0.9) return 'hard';        // gentle drivers stretch a hard set
        return rng.next() < 0.6 ? 'soft' : 'medium';
      })() as TireId],
      tireWear: 0,
      pitState: 'none' as 'none' | 'inPit',
      pitTimer: 0,
      /* COLLISION-V1: no contact at spawn. */
      contactCarId: null,
      contactTimer: 0,
      contactCooldown: 0,
      passCommitTimer: 0,
      passCommitSide: 0,
      /* RACE-V1: roster identity + strategy state. */
      rosterEntry: roster[index % roster.length],
      fuel: createFuelState(roster[index % roster.length].fuelTankLaps),
      lapsSinceStop: 0,
      raceLap: 0,
      releaseHoldS: 0,
      pitStops: 0,
      totalPitLossS: 0,
      lapTimes: [],
      lapClock: 0,
      bestLapS: null,
      lastLapS: null,
      finishTimeS: null,
      paceFactor: clamp(
        driver.pace * AI_PACE_SCALE * difficultyScale,
        difficultyScale < 1 ? 0.86 : 0.9,
        difficultyScale > 1 ? 1.14 : 1.1,
      ),
      /* M3-SLIPSTREAM: draft multiplier applied to targetSpeed on straights. */
      draft: 1,
      /* M3-DEFENSE: cooldown so a leader may move once per straight. */
      defenseCooldown: 0,
      defenseSide: 0,
    };
  });

  /* RACE-V1: optional lap-complete hook (main.ts feeds the RaceSession). */
  let onLapComplete: ((state: OpponentState, lapSeconds: number) => void) | null = null;

  /* COLLISION-V1: the player's live (s, lane, speed) — scoped PER COMPETITION
     (closure state, not module-level: two competitions in one process must
     not share a player). Set by step() from main.ts each tick; null until
     the first feed (headless sims without a player behave as shipped). */
  const playerRef: {
    s: number | null; lane: number | null; speed: number | null; laneVel: number;
  } = { s: null, lane: null, speed: null, laneVel: 0 };

  function presentState(state: OpponentState, dt: number): void {
    const here = sampleCentreline(CL, state.s);
    const ahead = sampleCentreline(CL, state.s + 7);

    const nx = -here.tz;
    const nz = here.tx;
    const x = here.x + nx * state.lane;
    const z = here.z + nz * state.lane;

    const aheadLane = state.lane + clamp(
      state.laneVelocity * 0.75,
      -0.7,
      0.7
    );
    const aheadNx = -ahead.tz;
    const aheadNz = ahead.tx;
    const aheadX = ahead.x + aheadNx * aheadLane;
    const aheadZ = ahead.z + aheadNz * aheadLane;

    const yaw = Math.atan2(aheadZ - z, aheadX - x);
    const centreYaw = Math.atan2(here.tz, here.tx);
    const aheadYaw = Math.atan2(ahead.tz, ahead.tx);

    state.steer = clamp(
      wrapAngle(aheadYaw - centreYaw) * 1.55 +
        state.laneVelocity * 0.08,
      -0.42,
      0.42
    );

    /* W1 VISUAL SLIP REVERTED (recording 3, Chris: "overrotated — weird
       sliding and angling, very unnatural"): laneVelocity is NOISY in
       traffic (interaction biases + error-scaled slew), and multiplying it
       into body yaw made ordinary position moves read as drifts. Back to
       the clean kinematic heading. */
    state.visual.carRoot.position.set(x, 0, z);
    state.visual.carRoot.rotation.y = -yaw;
    state.visual.carBody.rotation.x = 0;
    state.visual.carBody.rotation.z = clamp(
      state.steer * 0.032,
      -0.032,
      0.032
    );

    for (const pivot of state.visual.frontAxle) {
      pivot.rotation.y = -state.steer;
    }

    for (const wheel of state.visual.allWheels) {
      wheel.rotation.z = -state.wheelSpin;
    }

    /* M3-BRAKELIGHTS + W1b FLASHING BRAKE LIGHTS: F1-style pulsing rear
       light. Brightness = brake pressure × a 4 Hz pulse (FIA rear-light
       rain-light cadence), de-pulsed to solid when the driver is at heavy
       pressure for a while (locked-in stop) — and the glow eases in/out so
       it never snaps. At rest the strip sits at its dim dark-red park state.
       Per-driver phase offsets stop a braking pack from flashing in unison. */
    if (state.visual.brakeLight) {
      const mat = state.visual.brakeLight.material as THREE.MeshBasicMaterial;
      const pulseWindow = state.elapsed % 1;          // 1 s cycle
      const pulse = pulseWindow < 0.125 ? 1 : pulseWindow < 0.25 ? 0 : pulseWindow < 0.375 ? 1 : 0;
      const pulseMix = state.brakePressure > 0.85 ? 1 : pulse; // hard stop = solid
      const brightness = state.brakePressure * pulseMix;
      /* ease 12/s toward target — fast enough to read, slow enough to blend */
      state.brakeGlow += (brightness - state.brakeGlow) * Math.min(1, dt * 12);
      const g = state.brakeGlow;
      if (g < 0.02) {
        mat.color.setHex(0x4a0806);                    // park/dim state
      } else {
        /* blend dark red -> bright red by glow; slight orange bias at full */
        const r = Math.round(0x4a + g * (0xff - 0x4a));
        const gr = Math.round(0x08 + g * (0x20 - 0x08));
        const b = Math.round(0x06 + g * (0x1a - 0x06));
        mat.color.setRGB(r / 255, gr / 255, b / 255);
      }
    }
  }

  function step(
    dt: number,
    player?: { s: number; lane: number; speed: number; laneVel?: number } | null,
  ): ContactEvent[] {
    /* COLLISION-V1: feed the player into the AI's world.
       - object: live (s, lane, speed) from main.ts
       - null: player is off-frame (pit transit) — stop seeing him
       - undefined: no feed yet (headless sims) — keep prior behaviour */
    if (player === null) {
      playerRef.s = null;
      playerRef.lane = null;
      playerRef.speed = null;
    } else if (player && Number.isFinite(player.s) && Number.isFinite(player.lane)) {
      playerRef.s = player.s;
      playerRef.lane = player.lane;
      playerRef.speed = Math.max(0, player.speed);
      playerRef.laneVel = Number.isFinite(player.laneVel as number)
        ? (player.laneVel as number) : playerRef.laneVel;
    }

    const contactEvents = resolveContacts(states, dt, CL, playerRef);

    for (const state of states) {
      state.elapsed += dt;

      const turn = nearestTurnContext(state, CL, TURNS);
      const raceLine = racingLineOffset(turn);
      const interaction = interactionFor(state, states, CL, playerRef);

      /* M3-DEFENSE: a leader with a persona defense trait shadows the
         attacker's lane once per straight (move-once rule). The attacker
         must then genuinely pick the other side. Cooldown enforced; the
         shift is a modest line bias toward the chaser's lane, capped. */
      state.defenseCooldown = Math.max(0, state.defenseCooldown - dt);
      if (
        interaction.ahead === null &&
        state.defenseCooldown <= 0 &&
        state.driver.personaTag !== null
      ) {
        /* find chaser (car directly behind within 20 m) */
        let chaser: OpponentState | null = null;
        let chaserDist = Number.POSITIVE_INFINITY;
        for (const other of states) {
          if (other === state) continue;
          const behind = -signedTrackDelta(state.s, other.s, CL.length);
          if (behind > 0 && behind < 20 && behind < chaserDist) {
            chaser = other;
            chaserDist = behind;
          }
        }
        const defense = state.driver.defenseBias ?? 0;
        if (chaser && defense > 0) {
          const shift = clamp(
            (chaser.lane - state.laneTarget) * 0.4 * defense * 0.6,
            -0.55,
            0.55,
          );
          if (Math.abs(shift) > 0.08) {
            state.defenseSide = Math.sign(shift);
            state.defenseBias = shift;
            state.defenseCooldown = 5; // move-once per straight-ish window
          }
        } else {
          state.defenseBias = 0;
        }
      }
      /* decays back to the natural line */
      state.defenseBias = (state.defenseBias ?? 0) *
        Math.max(0, 1 - dt * (state.defenseCooldown > 0 ? 0.12 : 1.6));

      state.laneTarget = clamp(
        state.driver.lineBias +
          state.baseLane * 0.08 +
          raceLine +
          interaction.laneBias +
          (state.defenseBias ?? 0),
        -2.9,   /* W1 LINE v2: use the road — 2.25 read as centreline-glued */
        2.9
      );

      const laneError = state.laneTarget - state.lane;
      /* W1 LINE v2.1-tamed (recording 3): the 2.7 m/s slew cap let cars
         snap across the road in traffic. Keep the transfer possible but
         gentler: cap 2.3, softer error scaling. */
      const errBig = clamp01(Math.abs(laneError) / 2.2);
      const slewCap = 1.2 + errBig * 1.1;   // 1.2 .. 2.3 m/s
      const stiffness =
        (interaction.laneBias === 0 ? 3.4 : 4.4) * (1 + errBig * 0.3);
      const damping =
        (interaction.laneBias === 0 ? 3.4 : 4.2) * (1 + errBig * 0.2);

      state.laneVelocity +=
        (laneError * stiffness -
          state.laneVelocity * damping) *
        dt;
      state.laneVelocity = clamp(
        state.laneVelocity,
        -slewCap,
        slewCap
      );
      state.lane += state.laneVelocity * dt;

      /* M3-SLIPSTREAM: draft lift applies only where the car is flat-out —
         below the straight-stretch threshold the profile is corner-bound and
         a lift there would be a free corner-speed cheat. */
      {
        const hereV = refSpeedAt(state.progress, CL.length); /* COORD FIX */
        const draftBoost = hereV >= 80 ? interaction.draft : 1;
        state.draft = draftBoost;
        state.targetSpeed = Math.min(
          targetSpeedFor(state, CL, TURNS) * draftBoost,
          interaction.speedCap * (draftBoost > 1 ? 1 + (draftBoost - 1) * 0.5 : 1)
        );
      }

      /* M2-TIRES: AI wear accumulates from speed + cornering, scaled by the
         persona's tireCare (Rubber Whisperer 0.7 = kind, Quali Gunner 1.35 =
         brutal). Softs start ~6% quicker; the same falloff curve eventually
         takes that back — honest strategy, no rubber-banding.
         PARITY (2026-09-07 Chris feedback): the player's wear uses real
         |latAccel|/33 which averages ~0.9 in corners; the AI's proxy
         (1-|turnDist|/90) peaks at ~0.65 — AI was wearing ~25% slower over a
         stint. AI_LOAD_PARITY brings the proxy average level with the
         player's, so the same compound wears at the same rate for both. */
      {
        const AI_LOAD_PARITY = 1.30;
        const cornerLoad = clamp(
          (Math.abs(state.speed - state.targetSpeed) / 18 +
            (turn ? Math.min(1, 1 - Math.abs(turn.distance) / 90) : 0)) *
            AI_LOAD_PARITY,
          0,
          1,
        );
        /* PARITY (2026-09-07 Chris feedback, MEASURED-ANCHOR 2026-09-08 PM):
           Chris's 3-lap QA sample (94% health on softs, 1:20.6 pace) gives
           1.94%/lap — avg corner load 0.61, ~8 s slide/lap. Wear terms mirror
           the player's advanceWear: same distance floor, slip proxy 0.00003/s
           (= 8 s x 0.0003 spread over the lap), AI_LOAD_PARITY 1.30 so the
           corner proxy averages the player's measured 0.61. */
        const care = state.driver.personaTag === 'QLG' ? 1.35
          : state.driver.personaTag === 'RUB' ? 0.7 : 1;
        /* RACE-V1: the roster's tireWearRate (0.9..1.1) rides on top of the
           persona care factor — named drivers keep their tire character. */
        state.tireWear = Math.min(
          TIRE_WEAR_MAX,
          state.tireWear + (
            0.00003 * (state.speed / 40) +
            0.00003 +
            state.tireSpec.wearRate * cornerLoad
          ) * dt * care * state.rosterEntry.tireWearRate,
        );
      }

      /* M4D-PITS + RACE-V1 PIT STRATEGY: the decoupled strategy engine
         (core/pitStrategy.ts) decides when a car boxes — tire health < 30%
         or fuel <= 2 laps, min 5 laps between stops. The transit model
         subtracts the honest position loss (limiter delta + fixed transit +
         2.5 s swap), and the car is held off the racing line for that
         duration before being released back into a >= 12 m gap. */
      {
        /* Fuel burns with distance covered this lap. */
        burnFuel(state.fuel, (state.speed * dt) / CL.length);
        const decision = evaluatePitDecision(
          {
            tireWear: state.tireWear,
            fuelLapsRemaining: state.fuel.lapsRemaining,
            lapsSinceLastStop: state.lapsSinceStop,
            compound: state.tireSpec,
            paceFactor: state.paceFactor,
            lapSeconds: 84,
          },
          totalLaps,
          state.raceLap,
          state.rosterEntry.aggression,
        );
        if (state.pitState === 'none' && decision.shouldBox &&
            state.s > 300 && state.s < 410 && state.speed < 40) {
          state.pitState = 'inPit';
          state.pitTimer = pitTransitSeconds(state.speed);
          state.releaseHoldS = 0;
        }
        if (state.pitState === 'inPit') {
          state.pitTimer -= dt;
          state.targetSpeed = 0;
          state.speed = Math.max(0, state.speed - 9 * dt);
          state.laneTarget = 2.1;   // park at the box line (north edge)
          if (state.pitTimer <= 0) {
            /* Service: fresh compound per strategy, full fuel for the stint. */
            state.tireSpec = TIRE_SPECS[decision.nextCompound as TireId];
            state.tireWear = 0;
            refuelFull(state.fuel, Math.max(6, totalLaps - state.raceLap));
            state.pitStops += 1;
            /* Gap-order release: hold at the limiter until there's room. */
            const gaps: number[] = [];
            for (const other of states) {
              if (other === state) continue;
              const d = signedTrackDelta(state.s, other.s, CL.length);
              if (d > 0 && d < 80) gaps.push(d);
            }
            state.releaseHoldS = releaseDelayFor(gaps);
            state.pitState = 'none';
          }
        }
        /* Held at the exit at the limiter until the gap opens. */
        if (state.releaseHoldS > 0 && state.pitState === 'none') {
          state.releaseHoldS -= dt;
          state.targetSpeed = Math.min(state.targetSpeed, 22);
        }
      }

      /* PERSONAS-V1 mistake model: on corner entry, a persona's `mistake`
         probability fires a brief targetSpeed dip (run wide / hesitate) and
         occasionally a lane wobble. Cooldown keeps errors sparse and organic —
         never rubber-band and never stack into a crash loop. */
      state.mistakeCooldown -= dt;
      state.mistakeTimer = Math.max(0, state.mistakeTimer - dt);
      if (
        turn &&
        turn.distance > 0 &&
        turn.distance < 48 &&
        state.mistakeCooldown <= 0 &&
        state.speed > 14
      ) {
        if (rng.next() < state.driver.mistake) {
          const dipScale = 0.9 + rng.next() * 0.06;
          state.targetSpeed *= dipScale;
          state.laneVelocity += (rng.next() < 0.5 ? -1 : 1) * 0.5;
          state.mistakeTimer = 0.5 + rng.next() * 0.7;
        }
        /* Failed roll still consumes some cooldown so we don't roll 30×/s. */
        state.mistakeCooldown = 3 + rng.next() * 4;
      }
      if (state.mistakeTimer > 0) {
        state.targetSpeed *= 0.965;
      }

      updateExitPenalty(state, turn, dt);
      updateLongitudinal(state, turn, dt);

      /* INDYGP-H4-CLASSIFICATION: track genuine start/finish crossings. */
      const nextS = wrapS(
        state.s + state.speed * dt,
        CL.length
      );
      const nextProgress = wrapS(nextS - startLineS, CL.length);
      const crossedLine =
        state.progress > CL.length * 0.82 &&
        nextProgress < CL.length * 0.18;
      if (crossedLine && state.speed > 0) {
        state.lap += 1;
        state.raceLap = state.lap;
        state.lapsSinceStop += 1;
        /* RACE-V1 lap timing: close out the lap that just ended.
           2026-09-08 FIX: the grid-to-line crossing seconds after the green
           is a PARTIAL (2-4 s), not a lap — it was polluting bestLapS with
           impossible times (Vale 2.55 s "fastest lap" in the first sprint).
           A real lap here is ~84 s; anything under 30 s on lap 0 is the
           formation partial: advance the counter, record no time. */
        const lapS = state.lapClock;
        const isGridPartial = state.lap === 1 && lapS < 30;
        if (!isGridPartial) {
          state.lapTimes.push(lapS);
          state.lastLapS = lapS;
          if (state.bestLapS == null || lapS < state.bestLapS) state.bestLapS = lapS;
          if (onLapComplete) onLapComplete(state, lapS);
        }
        state.lapClock = 0;
      }
      state.lapClock += dt;
      state.s = nextS;
      state.progress = nextProgress;
      state.wheelSpin +=
        (state.speed / 0.375) * dt;
    }

    /* COLLISION-V1: contact persists — the AI's controller would otherwise
       re-accelerate straight through the car it hit. While contactTimer is
       fresh, the target follows the real speed so the follower doesn't
       fight the contact deceleration. Immunity windows tick down. */
    for (const state of states) {
      state.contactCooldown = Math.max(0, state.contactCooldown - dt);
      state.passCommitTimer = Math.max(0, state.passCommitTimer - dt);
      if (state.contactCarId != null) {
        state.targetSpeed = Math.min(state.targetSpeed, state.speed);
      }
    }

    return contactEvents;
  }

  function present(dt: number): void {
    for (const state of states) {
      presentState(state, dt);
    }
  }

  function getClassification(playerLap: number, playerProgress: number) {
    const entries = [
      {
        id: 'player',
        label: 'YOU',
        lap: Math.max(0, playerLap),
        progress: wrapS(playerProgress, CL.length),
      },
      ...states.map((state) => ({
        id: `rival-${state.id + 1}`,
        label: state.visual.team ? state.visual.team.short : `RIVAL ${state.id + 1}`,
        lap: state.lap,
        progress: state.progress,
      })),
    ].map((entry) => ({
      ...entry,
      totalDistance: entry.lap * CL.length + entry.progress,
    }));

    entries.sort((a, b) => {
      const distance = b.totalDistance - a.totalDistance;
      if (Math.abs(distance) > 0.001) return distance;
      return a.id === 'player' ? -1 : b.id === 'player' ? 1 : a.id.localeCompare(b.id);
    });

    const playerIndex = entries.findIndex((entry) => entry.id === 'player');
    return {
      playerPosition: playerIndex + 1,
      fieldSize: entries.length,
      entries,
    };
  }

  /* RACE-V1: named-driver live stats for HUD + results export. */
  function getRivalStats() {
    return states.map((state) => ({
      id: `rival-${state.id + 1}`,
      name: state.rosterEntry.name,
      short: state.rosterEntry.short,
      number: state.rosterEntry.number,
      team: state.rosterEntry.team,
      pace: state.rosterEntry.pace,
      /* W1a QA: expose the composite character traits for headless sims. */
      brakingEntry: state.driver.brakingEntry ?? 1,
      cornerCommit: state.driver.cornerCommit ?? 1,
      paceFactor: state.paceFactor,
      tireWearRate: state.rosterEntry.tireWearRate,
      compound: state.tireSpec.id as TireId,
      tireWear: state.tireWear,
      fuelLapsRemaining: state.fuel.lapsRemaining,
      lap: state.lap,
      progress: state.progress,
      lapTimes: [...state.lapTimes],
      bestLapS: state.bestLapS,
      lastLapS: state.lastLapS,
      pitStops: state.pitStops,
      inPit: state.pitState === 'inPit',
    }));
  }

  present(1 / 120); /* initial present — nominal frame step for the light ease */

  return {
    count: states.length,
    step,
    present,
    getClassification,
    /* RACE-V1 additions. */
    setLapCompleteListener: (fn: ((state: OpponentState, lapSeconds: number) => void) | null) => { onLapComplete = fn; },
    getRivalStats,
    rivalFinishState: () => states.map((s) => ({
      id: `rival-${s.id + 1}`,
      lap: s.lap,
      bestLapS: s.bestLapS,
      pitStops: s.pitStops,
    })),
  };
}
