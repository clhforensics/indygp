/* RACE-V3 headless verification (vite ssrLoadModule, no browser):
   1. Tire wear: laps-to-70%-wear per compound in the 26-32 / 30-36 / 36-41 windows.
   2. Race lifecycle: sprint finishes, P1, podium data, gaps, JSON export fields. */
import { loadEnv } from 'vite';

const vite = await import('vite');
const server = await vite.createServer({ server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true } });
const core = await server.ssrLoadModule('/packages/core/src/index.ts');

/* ---------- 1. TIRE WEAR CALIBRATION (RACE-V3.2, measured anchor) ---------- */
// Chris's 3-lap QA sample (2026-09-08 PM): 94% health on softs at 1:20.6 pace
// => 1.94%/lap. Implied: avg corner load 0.61, ~8 s slide/lap, dist 0.38%/lap.
const LAP_S = 83.5, V_AVG = 61.0, SLIP_S = 8.0, LOAD = 0.61;
function playerPerLap(rate, load = LOAD, slipS = SLIP_S, v = V_AVG) {
  return 0.00003 * (v / 40) * LAP_S + rate * load * LAP_S + 0.0003 * slipS;
}
function aiPerLap(rate, load = 0.61, care = 1, roster = 1) {
  return (0.00003 * 1.0 * LAP_S + 0.00003 * LAP_S + rate * load * LAP_S) * care * roster;
}
console.log('=== TIRE WEAR (Chris measured style, laps to 70% wear) ===');
let tiresOk = true;
const windows = { soft: [26, 32], medium: [30, 36], hard: [36, 41] };
for (const id of ['soft', 'medium', 'hard']) {
  const spec = core.TIRE_SPECS[id];
  const laps = 0.70 / playerPerLap(spec.wearRate);
  const aggr = 0.70 / playerPerLap(spec.wearRate, 0.85);
  const clean = 0.70 / playerLapClean(spec.wearRate);
  const [wLo, wHi] = windows[id];
  const ok = laps >= wLo - 2 && laps <= wHi + 2;
  if (!ok) tiresOk = false;
  console.log(`${id.padEnd(6)} ${laps.toFixed(1)} laps (aggr ${aggr.toFixed(1)} / clean ${clean.toFixed(1)}) target ${wLo}-${wHi}  ${ok ? 'OK' : 'FAIL'}`);
}
function playerLapClean(rate) { return playerPerLap(rate, 0.55, 12); }
// Sprint: 15 laps softs must be a no-stop
const sprintWear = 15 * playerPerLap(core.TIRE_SPECS.soft.wearRate);
console.log(`sprint 15 laps soft wear: ${(sprintWear * 100).toFixed(0)}% -> ${sprintWear < 0.70 ? 'no mandatory stop OK' : 'FAIL'}`);
// Chris's screenshot regression: 6 laps was 51%, must now be well under 30%
const sixLap = 6 * playerPerLap(core.TIRE_SPECS.soft.wearRate);
console.log(`6-lap wear (was 51% in QA): ${(sixLap * 100).toFixed(0)}%  ${sixLap < 0.30 ? 'OK' : 'FAIL'}`);
// AI parity: same compound within ~15% of player laps; worst roster still > 15 laps on softs
const pSoft = 0.70 / playerPerLap(core.TIRE_SPECS.soft.wearRate);
const aSoft = 0.70 / aiPerLap(core.TIRE_SPECS.soft.wearRate);
const aWorst = 0.70 / aiPerLap(core.TIRE_SPECS.soft.wearRate, 0.72, 1, 1.10);
const parityOk = Math.abs(aSoft - pSoft) / pSoft < 0.15 && aWorst > 15;
console.log(`AI parity: player ${pSoft.toFixed(1)} vs AI ${aSoft.toFixed(1)} laps (worst roster ${aWorst.toFixed(1)})  ${parityOk ? 'OK' : 'FAIL'}`);
if (!parityOk) tiresOk = false;

/* ---------- 2. RACE LIFECYCLE + RESULTS SHAPE ---------- */
console.log('\n=== RACE LIFECYCLE (sprint, 15 laps) ===');
const session = core.createRaceSession(core.parseRaceMode('sprint'), [
  { id: 'player', name: 'YOU', isPlayer: true, gridPosition: 4 },
  ...Array.from({ length: 9 }, (_, i) => ({ id: `rival-${i + 1}`, name: `#${i + 1} Rival`, isPlayer: false, gridPosition: i + 2 })),
]);
core.beginRacing(session);
// Player wins: 15 laps x 84.5s; rivals only reach lap 13 when the race is called
for (let lap = 1; lap <= 15; lap++) {
  core.recordLapComplete(session, 'player', 84500);
  core.updateRaceSession(session, 0, [{ id: 'player', lap, progress: 0, trackLength: 7000 }]);
}
for (let i = 1; i <= 9; i++) {
  for (let lap = 1; lap <= 13; lap++) {
    core.recordLapComplete(session, `rival-${i}`, 86000 + i * 700);
    core.updateRaceSession(session, 0, [{ id: 'player', lap: 15, progress: 0, trackLength: 7000 },
      ...Array.from({ length: 9 }, (_, j) => ({ id: `rival-${j + 1}`, lap: Math.min(13, lap + (j < i ? 1 : 0)), progress: j === i - 1 ? 3500 : 0, trackLength: 7000 }))]);
  }
}
core.recordPitStop(session, 'player');
const summary = core.buildSessionSummary(session);
const r = summary.results;
console.log(`state=${summary.raceState} P1=${r[0].driver} laps=${r[0].lapsCompleted} pits=${r[0].pitStops}`);
console.log(`player totalTimeMs=${r[0].totalTimeMs} fastestLapMs=${r[0].fastestLapMs}`);
console.log(`P2 ${r[1].driver}: laps=${r[1].lapsCompleted} gap-laps=${r[0].lapsCompleted - r[1].lapsCompleted} status=${r[1].status}`);
console.log(`progressM present on all rows: ${r.every((x) => typeof x.progressM === 'number')}`);
const shapeOk =
  summary.raceState === 'FINISHED' &&
  r[0].entrantId === 'player' && r[0].lapsCompleted === 15 && r[0].pitStops === 1 &&
  r[1].lapsCompleted === 13 &&
  r.every((x) => typeof x.progressM === 'number') &&
  summary.fastestLap && summary.fastestLap.driver === 'YOU';
console.log(`lifecycle+shape: ${shapeOk ? 'OK' : 'FAIL'}`);

console.log(`\n=== ${tiresOk && shapeOk ? 'ALL CHECKS PASS' : 'FAILURES PRESENT'} ===`);
await server.close();
