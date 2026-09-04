import type * as THREE from 'three';
import {
  DEFAULT_OPPONENT_GRID_SLOTS,
  STARTING_GRID_SLOT_COUNT,
  getStartingGridSlot,
} from '@indygp/core';
import type { Centreline } from '@indygp/core';

interface OpponentVisual {
  carRoot: THREE.Group;
  carBody: THREE.Group;
  frontAxle: THREE.Group[];
  allWheels: THREE.Mesh[];
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
}

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
  },
];

const MPH_TO_MPS = 0.44704;
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
  const lookAhead = [0, 10, 20, 32, 46, 62, 78];
  const lateralAccel =
    17.5 *
    state.driver.cornerSkill *
    clamp(state.driver.pace, 0.94, 1.04);
  const braking = 10.5;
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

  if (distance > 32) {
    const approach = clamp01((118 - distance) / 86);
    return -sign * (0.78 + strength * 1.0) * approach;
  }

  if (distance >= -14) {
    const apex = 1 - clamp01(Math.abs(distance) / 46);
    return sign * (0.98 + strength * 1.12) * apex;
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
        state.driver.cornerSkill *
        state.driver.pace *
        clamp(rhythm, 0.97, 1.02),
      cornerFloor,
      cornerCeiling
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
  const rhythm = driverRhythm(state);
  const cruise = 72 * state.driver.pace * rhythm;

  const markerCap = markerSpeedEnvelope(
    state,
    CL,
    TURNS,
    cruise,
    rhythm
  );

  const curvatureCap = curvatureSpeedEnvelope(state, CL);

  return clamp(
    Math.min(cruise, markerCap, curvatureCap),
    TIGHT_CORNER_MIN,
    76
  );
}

function interactionFor(
  state: OpponentState,
  states: OpponentState[],
  CL: Centreline
): { laneBias: number; speedCap: number } {
  /*
   * Race intent: attack a slower rival whenever there is usable closing speed.
   * We only surrender speed when overlap risk is high; there is no catch-up
   * boost and no instruction to wait for the player.
   */
  let nearestAhead: OpponentState | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const other of states) {
    if (other === state) continue;

    const delta = signedTrackDelta(state.s, other.s, CL.length);
    if (delta <= 0 || delta >= nearestDistance) continue;

    nearestAhead = other;
    nearestDistance = delta;
  }

  if (!nearestAhead || nearestDistance > 30) {
    return { laneBias: 0, speedCap: Number.POSITIVE_INFINITY };
  }

  const closing = state.speed - nearestAhead.speed;
  const overtakeSide = state.id % 2 === 0 ? 1 : -1;
  const aggression = state.driver.overtake;

  if (nearestDistance < 6.5) {
    return {
      laneBias: overtakeSide * 1.5 * aggression,
      speedCap: Math.max(16, nearestAhead.speed - 2.2),
    };
  }

  if (nearestDistance < 17 && closing > 0.6) {
    return {
      laneBias: overtakeSide * 1.4 * aggression,
      speedCap: nearestAhead.speed + 2.4,
    };
  }

  if (nearestDistance < 25 && closing > 0.2) {
    return {
      laneBias: overtakeSide * 0.72 * aggression,
      speedCap: nearestAhead.speed + 4.2,
    };
  }

  return { laneBias: 0, speedCap: Number.POSITIVE_INFINITY };
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
    return clamp(deltaSpeed * 1.8, -12.5, -2.2);
  }

  if (deltaSpeed <= 0.25) {
    return 0;
  }

  const cornerZone =
    turn && turn.distance > -54 && turn.distance < 48;
  const exitZone =
    turn && turn.distance <= 6 && turn.distance > -62;

  if (exitZone && turn) {
    const exitProgress = clamp01(
      (-turn.distance + 6) / 68
    );
    const progressiveBase =
      2.15 + exitProgress * 3.0;
    const tractionScale =
      state.driver.traction *
      state.driver.exitAttack *
      (1 - state.exitPenalty * 0.72);

    return Math.min(
      progressiveBase *
        state.driver.launch *
        tractionScale,
      deltaSpeed * 1.05
    );
  }

  const base = cornerZone ? 2.9 : 5.1;
  return Math.min(
    base * state.driver.launch,
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

  const jerk =
    desired < state.acceleration ? 18 : 6.5;
  state.acceleration += clamp(
    desired - state.acceleration,
    -jerk * dt,
    jerk * dt
  );

  state.acceleration = clamp(state.acceleration, -12.5, 5.5);
  state.speed = Math.max(0, state.speed + state.acceleration * dt);

  if (state.speed > state.targetSpeed + 0.8) {
    state.speed = Math.max(
      state.targetSpeed,
      state.speed - 7.5 * dt
    );
  }
}

export function createCompetition({
  CL,
  TURNS,
  opponents,
  startLineS,
  gridOffset,
}: CompetitionDeps) {
  const states: OpponentState[] = opponents.map((visual, index) => {
    const driver = DRIVERS[index] ?? DRIVERS[DRIVERS.length - 1];
    const requestedSlot = DEFAULT_OPPONENT_GRID_SLOTS[index] ??
      Math.min(STARTING_GRID_SLOT_COUNT, index + 1);
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
      steer: 0,
      elapsed: 0,
      exitPenalty: 0,
      lap: 0,
      progress: raceProgress,
    };
  });

  function presentState(state: OpponentState): void {
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
  }

  function step(dt: number): void {
    for (const state of states) {
      state.elapsed += dt;

      const turn = nearestTurnContext(state, CL, TURNS);
      const raceLine = racingLineOffset(turn);
      const interaction = interactionFor(state, states, CL);

      state.laneTarget = clamp(
        state.driver.lineBias +
          state.baseLane * 0.08 +
          raceLine +
          interaction.laneBias,
        -2.25,
        2.25
      );

      const laneError = state.laneTarget - state.lane;
      const stiffness =
        interaction.laneBias === 0 ? 3.0 : 4.4;
      const damping =
        interaction.laneBias === 0 ? 3.7 : 4.2;

      state.laneVelocity +=
        (laneError * stiffness -
          state.laneVelocity * damping) *
        dt;
      state.laneVelocity = clamp(
        state.laneVelocity,
        -1.25,
        1.25
      );
      state.lane += state.laneVelocity * dt;

      state.targetSpeed = Math.min(
        targetSpeedFor(state, CL, TURNS),
        interaction.speedCap
      );

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
      if (crossedLine && state.speed > 0) state.lap += 1;
      state.s = nextS;
      state.progress = nextProgress;
      state.wheelSpin +=
        (state.speed / 0.375) * dt;
    }
  }

  function present(): void {
    for (const state of states) {
      presentState(state);
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
        label: `RIVAL ${state.id + 1}`,
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

  present();

  return {
    count: states.length,
    step,
    present,
    getClassification,
  };
}
