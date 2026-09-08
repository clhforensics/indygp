/* =============================================================================
   AI ROSTER — 9 named AI drivers (player = 10-car field).
   Each driver carries pace (0.95..1.05) and tireWearRate (0.9..1.1), which
   feed paceFactor (competition) and the wear model (tires.ts) respectively.
   Pure data + a small selection helper; no physics, no rendering.
   ========================================================================== */

export interface AiDriverEntry {
  /** Car number, also used as the grid identity. */
  number: number;
  name: string;
  short: string;          // 3-letter code for HUD/results
  team: string;
  /** Multiplier on the reference-lap pace (clamped 0.95..1.05). */
  pace: number;
  /** Multiplier on tire wear accumulation (clamped 0.9..1.1). */
  tireWearRate: number;
  /** Pit strategy flavor: laps a full fuel/energy "tank" would last. */
  fuelTankLaps: number;
  aggression: number;     // 0..1, shapes overtake/pit-under-cut choices
}

export const AI_ROSTER: AiDriverEntry[] = [
  { number: 7,  name: 'Marcus Vale',      short: 'VAL', team: 'Keystone',         pace: 1.048, tireWearRate: 1.08, fuelTankLaps: 24, aggression: 0.85 },
  { number: 11, name: 'Devin Cross',      short: 'CRO', team: 'Hogan',            pace: 1.032, tireWearRate: 1.02, fuelTankLaps: 22, aggression: 0.72 },
  { number: 23, name: 'Ilya Rennick',     short: 'REN', team: 'Ironwood',         pace: 1.015, tireWearRate: 0.94, fuelTankLaps: 25, aggression: 0.55 },
  { number: 31, name: 'Sofia Marchetti',  short: 'MAR', team: 'Novalis',          pace: 1.001, tireWearRate: 1.05, fuelTankLaps: 23, aggression: 0.63 },
  { number: 42, name: 'Owen Barrett',     short: 'BAR', team: 'St. Clair',        pace: 0.988, tireWearRate: 0.92, fuelTankLaps: 26, aggression: 0.4  },
  { number: 55, name: 'Kaito Mori',       short: 'MOR', team: 'Novalis',          pace: 0.975, tireWearRate: 1.10, fuelTankLaps: 21, aggression: 0.78 },
  { number: 64, name: 'Grant Halloway',   short: 'HAL', team: 'Hogan',            pace: 0.964, tireWearRate: 0.97, fuelTankLaps: 24, aggression: 0.5  },
  { number: 78, name: 'Nico Fauré',       short: 'FAU', team: 'Ironwood',         pace: 0.958, tireWearRate: 1.06, fuelTankLaps: 22, aggression: 0.68 },
  { number: 90, name: 'Elias Trent',      short: 'TRE', team: 'Keystone',         pace: 0.952, tireWearRate: 0.90, fuelTankLaps: 26, aggression: 0.35 },
];

export const PACE_MIN = 0.95;
export const PACE_MAX = 1.05;
export const WEAR_MIN = 0.9;
export const WEAR_MAX = 1.1;

export function clampPace(p: number): number {
  return Math.min(PACE_MAX, Math.max(PACE_MIN, p));
}

export function clampWearRate(w: number): number {
  return Math.min(WEAR_MAX, Math.max(WEAR_MIN, w));
}

/** ?roster=random shuffles; default keeps the tuned order. */
export function getRoster(randomize: boolean): AiDriverEntry[] {
  if (!randomize) return AI_ROSTER;
  const copy = [...AI_ROSTER];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function parseRosterParam(raw: string | null | undefined): boolean {
  return (raw ?? '').trim().toLowerCase() === 'random';
}
