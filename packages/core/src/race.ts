/* =============================================================================
   RACE — session/mode state (decoupled from vehicles and AI).
   Modes: full (61 laps) / half (30) / sprint (15). Tracks raceState
   WARMUP -> RACING -> FINISHED, lap times, live positions, and produces the
   post-race results object (driver, grid, finish, total time, fastest lap,
   pit stops) plus the exportable session summary JSON.
   ========================================================================== */

export type RaceModeId = 'full' | 'half' | 'sprint' | 'practice';

export interface RaceMode {
  id: RaceModeId;
  name: string;
  totalLaps: number;
}

export const RACE_MODES: Record<RaceModeId, RaceMode> = {
  full: { id: 'full', name: 'Full Race', totalLaps: 61 },
  half: { id: 'half', name: 'Half Race', totalLaps: 30 },
  sprint: { id: 'sprint', name: 'Sprint', totalLaps: 15 },
  /* PRACTICE (Chris, 2026-09-08): empty track, no opponents, no position
     tracking — timing only. totalLaps 0 = no finish, session never ends. */
  practice: { id: 'practice', name: 'Practice', totalLaps: 0 },
};

export function parseRaceMode(raw: string | null | undefined): RaceMode {
  const value = (raw ?? 'half').trim().toLowerCase();
  return RACE_MODES[(value as RaceModeId) in RACE_MODES ? (value as RaceModeId) : 'half'];
}

export type RaceState = 'WARMUP' | 'RACING' | 'FINISHED';

/** One entrant (player or AI) tracked by the race session. */
export interface RaceEntrant {
  id: string;            // 'player' | 'rival-<n>'
  name: string;          // display name
  isPlayer: boolean;
  gridPosition: number;  // 1-based grid slot
  lap: number;           // completed laps
  progress: number;      // metres past start/finish this lap
  finishTimeMs: number | null;
  finishPosition: number | null;
  pitStops: number;
  bestLapMs: number | null;
  lastLapMs: number | null;
  /** Live race clock at the last completed lap — used to order finishers. */
  _totalMs: number;
  retired: boolean;
}

export interface RaceResultRow {
  position: number;
  driver: string;
  entrantId: string;
  gridStart: number;
  finishPosition: number;
  totalTimeMs: number | null;
  fastestLapMs: number | null;
  pitStops: number;
  lapsCompleted: number;
  /** Metres past the line this lap — gap estimates for cars still running. */
  progressM: number;
  status: 'FINISHED' | 'RUNNING' | 'RETIRED';
}

export interface RaceSessionSummary {
  mode: RaceMode['name'];
  totalLaps: number;
  raceState: RaceState;
  startedAtIso: string;
  finishedAtIso: string | null;
  durationMs: number;
  results: RaceResultRow[];
  fastestLap: { driver: string; lapMs: number } | null;
}

export interface RaceSession {
  mode: RaceMode;
  state: RaceState;
  lap: number;            // current player lap (1-based once over the line)
  raceClockMs: number;
  startedAtIso: string;
  finishedAtIso: string | null;
  entrants: RaceEntrant[];
  /* Live position snapshot, refreshed each frame by updateStandings(). */
  positions: RaceEntrant[]; // index 0 = P1
  finishOrder: RaceEntrant[];
}

export function createRaceSession(
  mode: RaceMode,
  entrantSpecs: Array<{ id: string; name: string; isPlayer: boolean; gridPosition: number }>,
): RaceSession {
  return {
    mode,
    state: 'WARMUP',
    lap: 0,
    raceClockMs: 0,
    startedAtIso: new Date().toISOString(),
    finishedAtIso: null,
    positions: [],
    finishOrder: [],
    entrants: entrantSpecs.map((spec) => ({
      ...spec,
      lap: 0,
      progress: 0,
      finishTimeMs: null,
      finishPosition: null,
      pitStops: 0,
      bestLapMs: null,
      lastLapMs: null,
      _totalMs: 0,
      retired: false,
    })),
  };
}

export function beginRacing(session: RaceSession): void {
  if (session.state === 'WARMUP') session.state = 'RACING';
}

/** Record a completed lap for an entrant (called on start/finish crossing). */
export function recordLapComplete(
  session: RaceSession,
  entrantId: string,
  lapMs: number,
): void {
  const e = session.entrants.find((x) => x.id === entrantId);
  if (!e || session.state !== 'RACING') return;
  e.lastLapMs = lapMs;
  e._totalMs += lapMs;
  if (e.bestLapMs == null || lapMs < e.bestLapMs) e.bestLapMs = lapMs;
  if (session.mode.totalLaps > 0 && e.lap >= session.mode.totalLaps && e.finishTimeMs == null) {
    e.finishTimeMs = e._totalMs;
    e.finishPosition = session.finishOrder.length + 1;
    session.finishOrder.push(e);
  }
}

export function retireEntrant(session: RaceSession, entrantId: string): void {
  const e = session.entrants.find((x) => x.id === entrantId);
  if (e) e.retired = true;
}

export function recordPitStop(session: RaceSession, entrantId: string): void {
  const e = session.entrants.find((x) => x.id === entrantId);
  if (e) e.pitStops += 1;
}

/** Called once per frame: advances the clock and refreshes positions. */
export function updateRaceSession(
  session: RaceSession,
  dtMs: number,
  liveState: Array<{ id: string; lap: number; progress: number; trackLength: number }>,
): void {
  if (session.state === 'RACING') session.raceClockMs += dtMs;

  const byId = new Map(liveState.map((l) => [l.id, l]));
  for (const e of session.entrants) {
    const live = byId.get(e.id);
    if (live) {
      e.lap = live.lap;
      e.progress = live.progress;
    }
    /* Finalize finishers here (order-proof): the lap counter syncs each
       frame, so a driver can complete their last lap without recordLapComplete
       having seen the updated count yet. _totalMs is the honest sum of lap
       times; if a lap was never recorded (crash/short session) leave null. */
    if (
      session.state === 'RACING' && session.mode.totalLaps > 0 &&
      e.finishTimeMs == null && e.lap >= session.mode.totalLaps && e._totalMs > 0
    ) {
      e.finishTimeMs = e._totalMs;
      e.finishPosition = session.finishOrder.length + 1;
      session.finishOrder.push(e);
    }
  }

  /* Total distance = laps done * trackLength + progress; finishers ranked by
     finish order first, then by distance. */
  const L = liveState[0]?.trackLength ?? 1;
  session.positions = [...session.entrants].sort((a, b) => {
    const fa = a.finishPosition, fb = b.finishPosition;
    if (fa != null && fb != null) return fa - fb;
    if (fa != null) return -1;
    if (fb != null) return 1;
    if (a.retired !== b.retired) return a.retired ? 1 : -1;
    const da = a.lap * L + a.progress;
    const db = b.lap * L + b.progress;
    if (Math.abs(db - da) > 0.001) return db - da;
    return a.gridPosition - b.gridPosition;
  });
  session.positions.forEach((e, i) => { if (e.finishPosition == null) e.finishPosition = i + 1; });

  const player = session.entrants.find((e) => e.isPlayer);
  if (
    session.state === 'RACING' && player &&
    session.mode.totalLaps > 0 && player.lap >= session.mode.totalLaps
  ) {
    session.state = 'FINISHED';
    session.finishedAtIso = new Date().toISOString();
  }
}

export function playerPosition(session: RaceSession): number {
  const idx = session.positions.findIndex((e) => e.isPlayer);
  return idx >= 0 ? idx + 1 : 1;
}

export function positionOf(session: RaceSession, entrantId: string): number {
  const idx = session.positions.findIndex((e) => e.id === entrantId);
  return idx >= 0 ? idx + 1 : session.positions.length;
}

/** Post-race results table (also used live: RUNNING rows allowed). */
export function buildResults(session: RaceSession): RaceResultRow[] {
  return session.positions.map((e, i) => ({
    position: i + 1,
    driver: e.name,
    entrantId: e.id,
    gridStart: e.gridPosition,
    finishPosition: e.finishPosition ?? i + 1,
    totalTimeMs: e.finishTimeMs,
    fastestLapMs: e.bestLapMs,
    pitStops: e.pitStops,
    lapsCompleted: e.lap,
    progressM: Math.round(e.progress),
    status: e.retired ? 'RETIRED' : (e.finishTimeMs != null ? 'FINISHED' : 'RUNNING'),
  }));
}

export function buildSessionSummary(session: RaceSession): RaceSessionSummary {
  const results = buildResults(session);
  const fastest = results.reduce<{ driver: string; lapMs: number } | null>((acc, r) => {
    if (r.fastestLapMs == null) return acc;
    if (!acc || r.fastestLapMs < acc.lapMs) return { driver: r.driver, lapMs: r.fastestLapMs };
    return acc;
  }, null);
  return {
    mode: session.mode.name,
    totalLaps: session.mode.totalLaps,
    raceState: session.state,
    startedAtIso: session.startedAtIso,
    finishedAtIso: session.finishedAtIso,
    durationMs: session.raceClockMs,
    results,
    fastestLap: fastest,
  };
}

/** Structured JSON export of the whole session (download as .json). */
export function exportSessionJson(session: RaceSession): string {
  return JSON.stringify(buildSessionSummary(session), null, 2);
}
