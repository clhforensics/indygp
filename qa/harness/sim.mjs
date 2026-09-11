/* =============================================================================
   HARNESS SIM ENGINE (QA-AUDIT H-1 remediation, 2026-09-10)
   The single way to run IndyGP competition code headlessly. Loads the REAL
   modules via vite ssrLoadModule, drives the REAL createCompetition.step()
   with a scripted player model, and returns a structured race report.

   Every gameplay change must pass qa/gate.mjs (which runs this harness
   across all scenarios) BEFORE reaching Chris's Safari. This is the lesson
   of the collision saga: "verified" without this file was fiction.
   =============================================================================
 */
import { createRequire } from 'module';

const vite = await import('vite');

/** Load once per process; reused across scenarios. */
export async function createSimLoader() {
  const server = await vite.createServer({
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
  });
  const core = await server.ssrLoadModule('/packages/core/src/index.ts');
  const appComp = await server.ssrLoadModule(
    '/packages/app/src/competition/createCompetition.ts',
  );

  const CFG = core.CFG;
  const CL = core.buildCentreline(core.NODES, CFG.track.sampleStep);
  const locate = core.makeLocator(CL);
  const S_LINE = locate(CFG.track.startFinish.x, CFG.track.startFinish.z, 0).s;
  const TURNS = core.NODES.filter((n) => n.turn).map((n) => {
    const l = locate(n.x, n.z, 0);
    return { n: n.turn, dir: n.dir, x: n.x, z: n.z, s: l.s, radius: n.r };
  });

  const stubVisual = () => ({
    carRoot: { position: { set() {} }, rotation: { y: 0 } },
    carBody: { rotation: {} },
    frontAxle: [],
    allWheels: [],
    brakeLight: { material: { color: { setHex() {}, setRGB() {} } } },
  });

  await server.close().catch(() => {});

  return { core, appComp, CFG, CL, TURNS, S_LINE, stubVisual };
}

/**
 * Run one scenario to completion.
 *
 * @param {object} loader        result of createSimLoader()
 * @param {object} opts
 * @param {number} opts.aiCount          number of AI cars (default 9)
 * @param {object} opts.player           player model fn (see player.mjs) or null
 * @param {number} opts.laps             laps to simulate (default 3)
 * @param {string} opts.difficulty       'novice' | 'pro' | 'elite'
 * @param {string} opts.personaMode      'none' | 'random'
 * @param {number} opts.seed             fixed seed for determinism (default 42)
 * @param {function} opts.onTick         optional (tickInfo) hook for probing
 * @returns {object} race report
 */
export async function runScenario(loader, opts = {}) {
  const {
    aiCount = 9,
    player = null,
    laps = 3,
    difficulty = 'pro',
    personaMode = 'none',
    seed = 42,
    onTick = null,
  } = opts;

  const { core, appComp, CFG, CL, TURNS, S_LINE, stubVisual } = loader;
  const STEP = CFG.sim.step;
  const L = CL.length;

  const comp = appComp.createCompetition({
    CL,
    TURNS,
    opponents: Array.from({ length: aiCount }, stubVisual),
    startLineS: S_LINE,
    gridOffset: CFG.track.gridOffset,
    personaMode: { mode: personaMode, persona: null },
    difficulty,
    totalLaps: Math.max(laps + 1, 4),
    rosterRandom: false,
    seed, // QA-AUDIT M-3: determinism
  });

  // Player model state container (see player.mjs — models are closures over prog/speed)
  const playerState = player
    ? player.init(core, CL, S_LINE, CFG)
    : null;

  let t = 0;
  const WARMUP = 8; // grid settle before the race clock starts (matches game)
  const totalTime = WARMUP + laps * 95; // laps * generous lap bound

  const prevByCar = new Map();
  const lapTimesByCar = new Map();
  const contacts = []; // { t, aId, bId, playerInvolved, severity, closing }
  const speedsByCar = new Map(); // id -> [speeds] sampled
  let playerContacts = 0;
  let maxSeverity = 0;

  while (t < totalTime) {
    const raceT = t - WARMUP;

    // Player model produces its feed for this tick
    let feed = null;
    if (player) {
      feed = player.tick({
        raceT,
        dt: STEP,
        CL,
        S_LINE,
        core,
        comp,
        seed,
      });
      if (feed === undefined) feed = null;
    }

    const evs = comp.step(STEP, feed);
    for (const ev of evs) {
      contacts.push({
        t: raceT,
        aId: ev.aId,
        bId: ev.bId,
        playerInvolved: ev.playerInvolved,
        severity: ev.severity,
        closing: ev.closing,
      });
      if (ev.playerInvolved) playerContacts++;
      if (ev.severity > maxSeverity) maxSeverity = ev.severity;
    }

    // Lap-time bookkeeping (same contract as shipped sims)
    const stats = comp.getRivalStats();
    for (const r of stats) {
      const pv = prevByCar.get(r.id);
      if (pv && r.lap > pv.lap && r.lastLapS != null) {
        if (!lapTimesByCar.has(r.id)) lapTimesByCar.set(r.id, []);
        lapTimesByCar.get(r.id).push(r.lastLapS);
      }
      prevByCar.set(r.id, { lap: r.lap, progress: r.progress });
    }

    // Speed sampling every 0.5 s of race time
    if (raceT > 0 && Math.abs(t - Math.round(t * 2) / 2) < STEP / 2) {
      const stats2 = comp.getRivalStats();
      for (const r of stats2) {
        const pv = prevByCar.get(r.id);
        if (pv && pv.progress != null) {
          let ds = r.progress - pv.progress;
          if (ds < -L / 2) ds += L;
          if (ds > L / 2) ds -= L;
          if (!speedsByCar.has(r.id)) speedsByCar.set(r.id, []);
          speedsByCar.get(r.id).push({ t: raceT, v: ds / STEP, progress: r.progress });
        }
      }
      if (player && feed) {
        if (!speedsByCar.has('player')) speedsByCar.set('player', []);
        speedsByCar.get('player').push({ t: raceT, v: playerState.speed, progress: playerState.progress });
      }
    }

    if (onTick) onTick({ t, raceT, comp, contacts });

    // Advance the player model's own kinematics (it is not stepped by comp)
    if (player) player.advance(STEP);

    t += STEP;
  }

  // Build the report
  const report = { scenario: opts.name ?? 'unnamed', seed, laps, aiCount, contacts, playerContacts, maxSeverity, lapTimes: {}, speeds: {} };
  for (const [id, arr] of lapTimesByCar) report.lapTimes[id] = arr;
  for (const [id, arr] of speedsByCar) report.speeds[id] = arr;

  // Steady lap = fastest of laps 2..N (lap 1 is the launch lap)
  report.steadyLaps = {};
  for (const [id, arr] of lapTimesByCar) {
    const steady = arr.length > 1 ? Math.min(...arr.slice(1)) : arr[0] ?? NaN;
    report.steadyLaps[id] = steady;
  }
  return report;
}
