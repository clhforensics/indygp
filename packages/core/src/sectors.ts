/* =============================================================================
   SECTORS — F1-style 3-sector timing (Chris, 2026-09-08).
   Decoupled from vehicles and rendering: the caller feeds progress along the
   lap (metres past the start/finish line) each frame; the engine detects
   sector crossings and reports live/complete splits with personal-best
   coloring (green = your best, purple = session best — relevant once AI
   practice sessions exist).

   Sector boundaries sit at exactly 1/3 and 2/3 of the lap. Crossing the
   start/finish line closes S3 and reopens S1.
   ========================================================================== */

export interface SectorState {
  /** Metres past the line where each sector ends (S1, S2; S3 = the line). */
  boundaries: [number, number];
  /** Sector currently being timed: 0, 1, 2 (S1/S2/S3). */
  current: 0 | 1 | 2;
  /** Elapsed seconds in the current, incomplete sector. */
  liveS: number;
  /** Just-completed splits this lap, in seconds — index = sector. */
  splits: [number | null, number | null, number | null];
  /** Personal bests across the whole session, per sector. */
  bests: [number | null, number | null, number | null];
  /** Index (0-2) of the last completed sector, or -1 — drives the flash. */
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
 * Advance sector timing. Progress must be metres past the start/finish line
 * (0..lapLength, wrapped), monotonic-ish; a large backwards jump (spin, rejoin)
 * does NOT rewind the sector clock — same honesty rule as the lap clock.
 */
export function updateSectors(st: SectorState, progress: number, dtS: number): void {
  st.justCompleted = -1;
  st.justWasBest = false;
  st.liveS += dtS;

  const crossed = (boundary: number, prev: number, now: number): boolean =>
    (prev < boundary && now >= boundary) ||
    /* Wrapped past the line this frame: treat the crossing as at-the-line. */
    (now < prev && boundary > prev);

  const prev = st._prevProgress ?? progress;

  if (st.current === 0 && crossed(st.boundaries[0], prev, progress)) {
    closeSector(st, 0, st.liveS);
    st.current = 1;
    st.liveS = 0;
  } else if (st.current === 1 && crossed(st.boundaries[1], prev, progress)) {
    closeSector(st, 1, st.liveS);
    st.current = 2;
    st.liveS = 0;
  } else if (st.current === 2 && nowrapped(prev, progress, st.boundaries[1])) {
    /* Crossing the start/finish line closes S3. */
    closeSector(st, 2, st.liveS);
    st.current = 0;
    st.liveS = 0;
    st.splits = [null, null, null];
  }

  st._prevProgress = progress;
}

/* S3 closes when progress wraps (prev near lap end, now near zero). The
   caller supplies the lap length context via boundaries; here we detect the
   wrap from the previous progress value alone. */
function nowrapped(prev: number, now: number, s2: number): boolean {
  return prev > s2 && now < prev * 0.5;
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
