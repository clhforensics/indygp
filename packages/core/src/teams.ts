/* =============================================================================
   TEAMS — Chris-locked spec (2026-09-07). 5 teams x 2 cars = 10 grid slots.
   Engines: Illyrian = +10% HP that fades over race distance; Chronos = flat;
   Vulcan = -2% power, zero fade.
   Chassis: Vanguard = extra straight speed; Keystone = all-around; Valenti =
   good in corners.
   ========================================================================== */

export type TeamId = 'hogan' | 'keystone' | 'ironwood' | 'novalis' | 'stclair';
export type EngineId = 'illyrian' | 'chronos' | 'vulcan';
export type ChassisId = 'vanguard' | 'keystone' | 'valenti';

export interface EngineSpec {
  id: EngineId;
  name: string;
  /** Multiplier on the car power figure at the start of the race. */
  power: number;
  /** Fraction of the initial bonus still available at the end of fadeSpan. */
  bonusRetention: number;
  /** Seconds of race time over which the engine bonus fades to retention. */
  fadeSpan: number;
}

export interface ChassisSpec {
  id: ChassisId;
  name: string;
  /** Multiplier on topSpeed. */
  topSpeed: number;
  /** Multiplier on lateral grip. */
  latGrip: number;
  /** Multiplier on braking deceleration. */
  brake: number;
}

export interface TeamSpec {
  id: TeamId;
  name: string;
  short: string;
  engine: EngineSpec;
  chassis: ChassisSpec;
  /** Livery colors (same fields the vehicle renderer consumes). */
  body: number;
  bodyHighlight: number;
  accentPrimary: number;
  accentSecondary: number;
  helmet: number;
  /** Seeds the DriverProfile pace spread for this team's AI drivers. */
  aiPaceBias: number;
}

const ILLYRIAN: EngineSpec = {
  id: 'illyrian', name: 'Illyrian Powertrain',
  power: 1.10, bonusRetention: 1.0, fadeSpan: 0, // fade resolved below
};
/* Illyrian starts at +10% and decays toward the 1.00 baseline over ~4 min. */
export const ENGINE_ILLYRIAN: EngineSpec = { ...ILLYRIAN, bonusRetention: 0.0, fadeSpan: 240 };
export const ENGINE_CHRONOS: EngineSpec = { id: 'chronos', name: 'Chronos Hybrid', power: 1.0, bonusRetention: 1.0, fadeSpan: 0 };
export const ENGINE_VULCAN: EngineSpec = { id: 'vulcan', name: 'Vulcan', power: 0.98, bonusRetention: 1.0, fadeSpan: 0 };

const CHASSIS_VANGUARD: ChassisSpec = { id: 'vanguard', name: 'Vanguard', topSpeed: 1.05, latGrip: 1.0, brake: 1.0 };
const CHASSIS_KEYSTONE: ChassisSpec = { id: 'keystone', name: 'Keystone', topSpeed: 1.02, latGrip: 1.02, brake: 1.02 };
const CHASSIS_VALENTI: ChassisSpec = { id: 'valenti', name: 'Valenti', topSpeed: 0.99, latGrip: 1.06, brake: 1.01 };

export const TEAMS: TeamSpec[] = [
  {
    id: 'hogan', name: 'Hogan Motorsports', short: 'HGN',
    engine: ENGINE_ILLYRIAN, chassis: CHASSIS_VANGUARD,
    body: 0x121216, bodyHighlight: 0x24242c,
    accentPrimary: 0xd9a441, accentSecondary: 0xf3d27a,
    helmet: 0xd9a441,
    aiPaceBias: +0.012,
  },
  {
    id: 'keystone', name: 'Keystone Racing', short: 'KSR',
    engine: ENGINE_ILLYRIAN, chassis: CHASSIS_KEYSTONE,
    body: 0x27415e, bodyHighlight: 0x3d5f88,
    accentPrimary: 0xc0c7d1, accentSecondary: 0xe8edf4,
    helmet: 0xc0c7d1,
    aiPaceBias: +0.010,
  },
  {
    id: 'ironwood', name: 'Ironwood Performance', short: 'IWD',
    engine: ENGINE_CHRONOS, chassis: CHASSIS_VALENTI,
    body: 0x1d3a2a, bodyHighlight: 0x2d5740,
    accentPrimary: 0xb0653a, accentSecondary: 0xd9a06a,
    helmet: 0xb0653a,
    aiPaceBias: 0.0,
  },
  {
    id: 'novalis', name: 'Novalis Engineering', short: 'NVL',
    engine: ENGINE_CHRONOS, chassis: CHASSIS_VALENTI,
    body: 0xe8ecef, bodyHighlight: 0xc6ccd2,
    accentPrimary: 0x0f8f8a, accentSecondary: 0x37c4bd,
    helmet: 0x0f8f8a,
    aiPaceBias: -0.002,
  },
  {
    id: 'stclair', name: 'St. Clair GC', short: 'STC',
    engine: ENGINE_VULCAN, chassis: CHASSIS_VALENTI,
    body: 0x4a1520, bodyHighlight: 0x66202e,
    accentPrimary: 0xe6ddc8, accentSecondary: 0x9a8a6a,
    helmet: 0xe6ddc8,
    aiPaceBias: -0.012,
  },
];

const TEAM_BY_ID = new Map(TEAMS.map((t) => [t.id, t]));

export function getTeam(id: string | null | undefined): TeamSpec {
  const key = (id ?? '').trim().toLowerCase() as TeamId;
  return TEAM_BY_ID.get(key) ?? TEAMS[0];
}

/**
 * Effective engine power multiplier at a point in the race.
 * Illyrian decays linearly from its full bonus to baseline over fadeSpan;
 * everything else holds flat.
 */
export function enginePowerAt(engine: EngineSpec, elapsed: number): number {
  if (engine.fadeSpan <= 0 || engine.power <= 1) return engine.power;
  const fade = Math.min(1, Math.max(0, elapsed / engine.fadeSpan));
  const bonus = engine.power - 1;
  return 1 + bonus * (1 + (engine.bonusRetention - 1) * fade);
}

/** Physics multipliers the player vehicle consumes. */
export interface TeamPhysics {
  power: number;      // engine (current, time-dependent)
  topSpeed: number;
  latGrip: number;
  brake: number;
}

export function teamPhysicsAt(team: TeamSpec, elapsed: number): TeamPhysics {
  return {
    power: enginePowerAt(team.engine, elapsed),
    topSpeed: team.chassis.topSpeed,
    latGrip: team.chassis.latGrip,
    brake: team.chassis.brake,
  };
}

/**
 * Grid team assignment: 5 teams x 2 cars, teammates adjacent-ish but not
 * back-to-back, interleaved so the field reads mixed. Index 0..9 = grid slots
 * excluding the player's slot 4 (handled by the caller).
 */
export const GRID_TEAM_ORDER: TeamId[] = [
  'hogan', 'keystone', 'ironwood', 'novalis', 'stclair',
  'keystone', 'hogan', 'stclair', 'novalis', 'ironwood',
];
