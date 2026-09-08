/* =============================================================================
   PIT STRATEGY — dynamic AI pit triggers + pit transit model.
   Decoupled from createCompetition: the competition step asks this module
   "should this car box?" and "what does the pit transit cost?", and reports
   stops back for race stats. The player's wear model (tires.ts) and pit path
   (pitlane.ts) are untouched.

   Triggers (Chris-locked):
     - tire health < 30% (tireWear > 0.70)
     - fuel/energy threshold reached (fuelLapsRemaining <= 2)
   Transit model:
     - approach/exit at the pit speed limiter (PIT_SPEED_LIMIT delta vs racing pace)
     - fixed PIT_LANE_TRANSIT_S for lane traversal + PIT_TIRE_SWAP_S (2.5) stationary
     - release back on track ordered by gap so cars never merge into each other
   ========================================================================== */

import { PIT_SPEED_LIMIT } from './pitlane';
import type { TireSpec } from './tires';

/** Seconds of lane traversal at the limiter (entry curl + straight + exit). */
export const PIT_LANE_TRANSIT_S = 18.5;
/** Stationary time for the tire swap (Chris-locked 2.5 s). */
export const PIT_TIRE_SWAP_S = 2.5;
/** Box when tire health (1 - wear) falls below this. */
export const TIRE_HEALTH_PIT_THRESHOLD = 0.30;
/** Box when fuel laps remaining falls to/below this. */
export const FUEL_PIT_THRESHOLD_LAPS = 2;
/** Minimum laps between stops (prevents double-stop thrash). */
export const MIN_LAPS_BETWEEN_STOPS = 5;

export interface PitDecisionInput {
  tireWear: number;          // 0..1 (health = 1 - wear)
  fuelLapsRemaining: number;
  lapsSinceLastStop: number;
  /** Compound the car is currently on. */
  compound: TireSpec;
  /** Ref-lap pace factor — slower cars can run one lap longer before boxing. */
  paceFactor: number;
  /** Rough lap length in seconds (laps ~ 84 s on this circuit). */
  lapSeconds: number;
}

export interface PitDecision {
  shouldBox: boolean;
  reason: 'tires' | 'fuel' | null;
  /** Recommended next compound (overcut/undercut flavor). */
  nextCompound: 'soft' | 'medium' | 'hard';
}

/**
 * Compound choice on a stop: aggressive drivers take softs late; long-runners
 * take hards early. Simple, deterministic, persona-flavored via paceFactor.
 */
function chooseNextCompound(
  raceLap: number,
  totalLaps: number,
  paceFactor: number,
  aggression: number,
): 'soft' | 'medium' | 'hard' {
  const lapsLeft = totalLaps - raceLap;
  if (lapsLeft <= 10) return aggression > 0.6 ? 'soft' : 'medium';
  if (lapsLeft <= 25) return paceFactor > 1.0 ? 'medium' : 'soft';
  return 'hard';
}

export function evaluatePitDecision(input: PitDecisionInput, totalLaps: number, raceLap: number, aggression = 0.5): PitDecision {
  const health = 1 - input.tireWear;
  const lapsSince = input.lapsSinceLastStop;

  if (lapsSince < MIN_LAPS_BETWEEN_STOPS) {
    return { shouldBox: false, reason: null, nextCompound: 'medium' };
  }
  if (health < TIRE_HEALTH_PIT_THRESHOLD) {
    return {
      shouldBox: true,
      reason: 'tires',
      nextCompound: chooseNextCompound(raceLap, totalLaps, input.paceFactor, aggression),
    };
  }
  if (input.fuelLapsRemaining <= FUEL_PIT_THRESHOLD_LAPS) {
    return {
      shouldBox: true,
      reason: 'fuel',
      nextCompound: chooseNextCompound(raceLap, totalLaps, input.paceFactor, aggression),
    };
  }
  return { shouldBox: false, reason: null, nextCompound: 'medium' };
}

/**
 * Total stationary+limiter pit loss vs a racing pass, in seconds. Used by the
 * competition step to subtract track position when a car boxes (the car is
 * held out of the racing line for this long), and by strategy sims.
 */
export function pitTransitSeconds(currentSpeed: number): number {
  const limiterDelta = Math.max(0, currentSpeed - PIT_SPEED_LIMIT);
  /* Extra time lost vs running at racing speed ≈ (average racing speed over
     the pit straight) minus limiter speed, spread over the transit. Approximate
     with the current speed as the racing reference. */
  const speedLossTime = (limiterDelta / Math.max(12, currentSpeed)) * PIT_LANE_TRANSIT_S * 0.5;
  return PIT_LANE_TRANSIT_S + PIT_TIRE_SWAP_S + speedLossTime;
}

/* ---- Gap-order release --------------------------------------------------- */

export interface PitReleaseState {
  /** Track-distance (metres) at which the car is released. Cars are released
      in the order they finished their stop; a releasing car is inserted into
      the first gap >= PIT_RELEASE_GAP_M behind the car ahead on track. */
  pendingRelease: boolean;
  releaseDelayS: number;
}

export const PIT_RELEASE_GAP_M = 12;

/**
 * Pick a release gap position: given the sorted list of gaps (metres of track
 * distance) to cars ahead on the merge straight, choose the gap that keeps at
 * least PIT_RELEASE_GAP_M from both neighbors. Returns a small holding delay
 * (seconds at limiter) if the car must wait for a gap, 0 if it can merge now.
 */
export function releaseDelayFor(gapsAheadM: number[]): number {
  const usable = gapsAheadM.filter((g) => g >= PIT_RELEASE_GAP_M * 2);
  if (usable.length > 0) return 0;
  /* Not enough room: hold at the limiter. One limiter-second ≈ 22 m of track. */
  const worst = gapsAheadM.length ? Math.max(0, ...gapsAheadM) : PIT_RELEASE_GAP_M * 2;
  const deficit = PIT_RELEASE_GAP_M * 2 - worst;
  return Math.max(0, deficit / PIT_SPEED_LIMIT);
}

/* ---- Fuel model (per-car, fed by the AI roster's fuelTankLaps) ----------- */

export interface FuelState {
  lapsRemaining: number;
  /** 0..1 fraction remaining. */
  fraction: number;
  tankLaps: number;
}

export function createFuelState(tankLaps: number, startFraction = 1): FuelState {
  return { lapsRemaining: tankLaps * startFraction, fraction: startFraction, tankLaps };
}

/** Burn fuel by elapsed lap fraction (call each lap-crossing or continuously). */
export function burnFuel(fuel: FuelState, lapFraction: number): void {
  fuel.lapsRemaining = Math.max(0, fuel.lapsRemaining - lapFraction);
  fuel.fraction = fuel.tankLaps > 0 ? fuel.lapsRemaining / fuel.tankLaps : 0;
}

export function refuelFull(fuel: FuelState, lapsForFuelWindow: number): void {
  /* A stop tops the tank for the expected remaining stint length, not more. */
  fuel.lapsRemaining = Math.min(fuel.tankLaps, Math.max(lapsForFuelWindow, FUEL_PIT_THRESHOLD_LAPS + 1));
  fuel.fraction = fuel.tankLaps > 0 ? fuel.lapsRemaining / fuel.tankLaps : 0;
}
