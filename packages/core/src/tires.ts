/* =============================================================================
   TIRES — Chris-locked spec (2026-09-07). Soft / Medium / Hard with a
   grip-vs-wear tradeoff. Player-facing behavior:
     Soft:  cornering = current default grip, brake late, wears quick.
     Medium: brake a bit earlier, wears slower.
     Hard:  brake long, lasts longest.
   Implementation: each compound is a grip + brake multiplier over the car's
   base figures, plus a wear rate. Wear accumulates with corner load & slip
   distance; effective grip = base * (1 - wearFalloff(wear)). No mandatory pit
   stop yet — wear only clamps performance so Hards last the distance.
   ?tyre=soft|medium|hard. Persona tireCare (personas.ts) scales AI wear.
   ========================================================================== */

export type TireId = 'soft' | 'medium' | 'hard';

export interface TireSpec {
  id: TireId;
  name: string;
  short: string;
  /** Multiplier on lateral grip (drives cornering speed AND brake bite via
      the shared surf.grip path in stepVehicle). */
  grip: number;
  /** Direct multiplier on braking decel — shapes how late you can brake. */
  brake: number;
  /** Wear accumulated per second at full corner load. */
  wearRate: number;
  /** Wear fraction (0..1) at which the falloff becomes steep. */
  cliffStart: number;
  /** HUD ring color. */
  color: string;
}

export const TIRE_SPECS: Record<TireId, TireSpec> = {
  soft: {
    id: 'soft', name: 'Soft', short: 'S',
    grip: 1.06, brake: 1.05, wearRate: 0.0048, cliffStart: 0.55,
    color: '#e3352b',
  },
  medium: {
    id: 'medium', name: 'Medium', short: 'M',
    grip: 1.0, brake: 0.99, wearRate: 0.0038, cliffStart: 0.6,
    color: '#f0c33c',
  },
  hard: {
    id: 'hard', name: 'Hard', short: 'H',
    grip: 0.95, brake: 0.94, wearRate: 0.0024, cliffStart: 0.65,
    color: '#e8e8e8',
  },
};

export function getTire(raw: string | null | undefined): TireSpec {
  const value = (raw ?? 'soft').trim().toLowerCase();
  return TIRE_SPECS[(value as TireId) in TIRE_SPECS ? (value as TireId) : 'soft'];
}

/**
 * Wear falloff: linear mild loss up to the cliff, then a steep drop.
 * At wear=1 the compound retains ~55% grip on Softs, ~70% on Hards.
 */
export function tireGripFactor(spec: TireSpec, wear: number): number {
  const w = Math.min(Math.max(wear, 0), 1);
  const base = 1 - 0.1 * (w / spec.cliffStart) * 0.45;
  if (w <= spec.cliffStart) return base;
  const past = (w - spec.cliffStart) / (1 - spec.cliffStart);
  return base - 0.28 * past * past;
}

/** Hard cap so performance never falls off a physical cliff mid-corner. */
export const TIRE_WEAR_MAX = 0.97;

/**
 * Advance wear: distance term + corner-load term + slip term.
 * cornerLoad01: |lateral accel| normalized to ~1.0 at hard cornering.
 */
export function advanceWear(
  spec: TireSpec,
  wear: number,
  dt: number,
  speed: number,
  cornerLoad01: number,
  slipping: boolean,
  careMultiplier = 1,
): number {
  const distanceTerm = 0.00016 * (speed / 40) * dt;
  const cornerTerm = spec.wearRate * cornerLoad01 * dt;
  const slipTerm = slipping ? 0.0025 * dt : 0;
  return Math.min(
    TIRE_WEAR_MAX,
    wear + (distanceTerm + cornerTerm + slipTerm) * careMultiplier,
  );
}
