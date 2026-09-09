/* =============================================================================
   SECTORS — F1-style 3-sector timing (Chris, 2026-09-08; crossing semantics
   REWRITTEN 2026-09-09 after his QA: wall-bounce backward motion was falsely
   closing gates, and lap-1 S1 was ~1.9 s short because the clock started at
   the green instead of the line).

   Rules now (mirroring the lap clock exactly):
   - Gates close on FORWARD crossings only: prev < boundary && now >= boundary.
     Backward motion NEVER closes anything (a wall bounce, a spin, a reverse).
   - The start/finish line closes S3 — but the CALLER signals it via
     lineCrossSectors() from the same crossedForward branch that increments
     the lap, so sector and lap clocks share one crossing event.
   - The caller only runs timing while the lap clock is live (lap > 0), so
     lap-1 S1 measures line -> gate, not green -> gate.
   ========================================================================== */

export interface SectorState {
  /** Metres past the line where each sector ends (S1, S2; S3 = the line). */
  boundaries: [number, number];
  /** Sector currently being timed: 0, 1, 2 (S1/S2/S3). */
  current: 0 | 1 | 2;
  /** Elapsed seconds in the current, incomplete sector. */
  liveS: number;
  /** Most recent split per sector, in seconds — persists across laps. */
  splits: [number | null, number | null, number | null];
  /** Personal bests across the whole session, per sector. */
  bests: [number | null, number | null, number | null];
  /** Index (0-2) of the sector closed THIS frame, or -1 — drives the flash. */
  justCompleted: number;
  /** True when the just-completed split set a session best (purple flash). */
  justWasBest: boolean;
  /** Internal: previous frame's progress for crossing detection. */
  _prevProgress?: number;
}

export function createSectors(lapLength: number): SectorState {
  return {
    boundaries: [lapLength / 3, (lapLength * 2) / 3],
    current: 0,
    liveS: 0,
    splits: [null, null, null],
    bests: [null, null, null],
    justCompleted: -1,
    justWasBest: false,
  };
}

/**
 * Advance sector timing for the frame. Progress is metres past the line
 * (0..lapLength, wrapped). Handles only the S1/S2 gates; the line is the
 * caller's lineCrossSectors() job.
 */
export function updateSectors(st: SectorState, progress: number, dtS: number): void {
  st.justCompleted = -1;
  st.justWasBest = false;
  st.liveS += dtS;

  const prev = st._prevProgress ?? progress;
  const forwardPast = (b: number): boolean => prev < b && progress >= b;

  if (st.current === 0 && forwardPast(st.boundaries[0])) {
    closeSector(st, 0, st.liveS);
    st.current = 1;
    st.liveS = 0;
  } else if (st.current === 1 && forwardPast(st.boundaries[1])) {
    closeSector(st, 1, st.liveS);
    st.current = 2;
    st.liveS = 0;
  }

  st._prevProgress = progress;
}

/**
 * The start/finish line was crossed FORWARD this frame (same event that
 * increments the lap). Closes S3 if it was running, restarts S1. Also
 * self-heals a derailed state (gate closed out of order) by resetting.
 */
export function lineCrossSectors(st: SectorState): void {
  if (st.current === 2) {
    closeSector(st, 2, st.liveS);
  } else {
    st.justCompleted = -1;
    st.justWasBest = false;
  }
  st.current = 0;
  st.liveS = 0;
}

function closeSector(st: SectorState, idx: 0 | 1 | 2, timeS: number): void {
  st.splits[idx] = timeS;
  const wasBest = st.bests[idx] == null || timeS < (st.bests[idx] as number);
  if (wasBest) st.bests[idx] = timeS;
  st.justCompleted = idx;
  st.justWasBest = wasBest;
}

export function resetSectors(st: SectorState): void {
  st.current = 0;
  st.liveS = 0;
  st.splits = [null, null, null];
  st.bests = [null, null, null];
  st.justCompleted = -1;
  st.justWasBest = false;
  st._prevProgress = undefined;
}
