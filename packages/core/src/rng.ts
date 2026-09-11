/* =============================================================================
   DETERMINISTIC RNG — mulberry32 (QA AUDIT 2026-09-10, finding M-3)
   Anything inside competition.step() that needs randomness draws from a seeded
   instance created in createCompetition — NEVER Math.random — so headless
   harness runs are binary-reproducible (same seed = same race, byte-identical
   lap reports). Game-visual-only randomness (sparks, one-shot flourishes) may
   stay on Math.random: it cannot change race outcomes.
   Standard mulberry32: 32-bit state, good distribution, ~2^124 period,
   trivially portable — matches the reference implementation used across the
   industry for deterministic sims.
   ========================================================================== */

export type RngNext = () => number;

export function mulberry32(seed: number): RngNext {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  /** Next float in [0, 1). */
  next: RngNext;
  /** Next float in [lo, hi). */
  range: (lo: number, hi: number) => number;
  /** Random element of a non-empty array. */
  pick: <T>(arr: readonly T[]) => T;
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed);
  return {
    next,
    range: (lo: number, hi: number) => lo + next() * (hi - lo),
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length) % arr.length],
  };
}
