/* =============================================================================
   LAYER 9 - SESSION STATE AND MAIN LOOP
   Fixed-timestep accumulator, camera rigs, lap timing, pause and resize.
   Wires the portable core (Layers 1-4) to the presentation packages.
   All bodies extracted verbatim from IndyGP_Phase1.html.
   ========================================================================== */

import './styles.css';

import * as THREE from 'three';
import {
  CFG, TAU, clamp, clamp01, lerp, sgn, hash01,
  NODES, AVE, ST, CIRCLE,
  buildCentreline, makeLocator,
  createVehicle, stepVehicle, applyBarriers, gearFor, fmtTime,
  getTeam, teamPhysicsAt, TEAMS,
  parseRaceMode, createRaceSession, beginRacing, recordLapComplete,
  recordPitStop, updateRaceSession, buildSessionSummary, exportSessionJson,
  playerPosition, positionOf,
} from '@indygp/core';
import { canRequestPit, shouldEnterPit, isPitDrivable, advancePitRun, PLAYER_STARTING_GRID_SLOT, getStartingGridSlot, parsePersonaParam, getTire, tireGripFactor, advanceWear, TIRE_SPECS, TIRE_WEAR_MAX, getPitPath, projectOnPitPath, samplePitPath, PIT_SPEED_LIMIT, PIT_STOP_SECONDS } from '@indygp/core';
import { DOM, grab, fatal, createInput, createAudio, createHud } from '@indygp/platform';
import type { SessionActions } from '@indygp/platform';
import { createTextures, createWorld, QUALITY } from '@indygp/render';
import { createCompetition } from './competition/createCompetition';
import { createRaceStartSequence } from './competition/createRaceStartSequence';
import { createTelemetryRecorder } from './competition/telemetry';
import { createMenu } from './menu';

grab();

try {
  boot();
} catch (err: any) {
  fatal('The circuit could not be built',
    'Construction failed before the session started.<br><br><code>' +
    String((err && err.message) || err).replace(/</g, '&lt;') + '</code>');
  throw err;
}

function boot() {
  const RECORD_LAP_STORE_KEY = 'indygp.recordLapMs';
  const SPEED_UNIT_STORE_KEY = 'indygp.speedUnit';
  const OFFICIAL_RECORD_LAP_MS = 84876;
  const storedRecord = Number(window.localStorage.getItem(RECORD_LAP_STORE_KEY) || '');
  let recordLapMs = (Number.isFinite(storedRecord) && storedRecord > 0)
    ? storedRecord
    : OFFICIAL_RECORD_LAP_MS;
  const storedUnit = window.localStorage.getItem(SPEED_UNIT_STORE_KEY);
  const initialSpeedUnit: 'kph' | 'mph' = storedUnit === 'mph' ? 'mph' : 'kph';

  /* ---------- begin verbatim: boot progress reporter ---------- */

  const STAGES = ['Surveying the Mile Square', 'Milling asphalt and kerbstones',
                'Pouring the concrete barriers', 'Quarrying Indiana limestone',
                'Glazing the curtain walls', 'Lighting the Mile Square',
                'Laying asphalt, kerbs and concrete', 'Raising downtown',
                'Setting the Monument and Artsgarden',
                'Hanging signage and planting the street', 'Rolling out the car'];
  let stage = 0;
  function tick(msg){
    DOM.bootMsg.textContent = msg || STAGES[Math.min(stage, STAGES.length-1)];
    DOM.bootBar.style.width = Math.round((++stage / (STAGES.length+1))*100) + '%';
  }
  tick();

  /* ---------- end verbatim ---------- */

  /* ---------- begin verbatim: circuit construction ---------- */

  const CL = buildCentreline(NODES, CFG.track.sampleStep);
  const locate = makeLocator(CL);

  /* Where along the lap does each numbered corner sit, and where is the line? */
  function sAt(x, z){ return locate(x, z, 0).s; }
  const S_LINE = sAt(CFG.track.startFinish.x, CFG.track.startFinish.z);
  const TURNS = NODES.filter(n => n.turn).map(n => {
    const l = locate(n.x, n.z, 0);
    return { n:n.turn, dir:n.dir, name:n.name, note:n.note,
             x:n.x, z:n.z, s:l.s, index:l.index, radius:n.r,
             lap:((l.s - S_LINE) + CL.length) % CL.length };
  }).sort((a,b) => a.lap - b.lap);

  const LAP_KM = (CL.length/1000).toFixed(3);
  const RIGHTS = TURNS.filter(t => t.dir === 'R').length;
  DOM.fLen.textContent = LAP_KM + ' km';
  DOM.mapMeta.textContent = LAP_KM + ' km · ' + TURNS.length + ' turns · ' +
                            RIGHTS + ' right / ' + (TURNS.length - RIGHTS) + ' left';
  DOM.fCorners.textContent = String(TURNS.length);
  DOM.fWidth.textContent = (CFG.track.halfWidth * 2) + ' m';
  DOM.fRecord.textContent = fmtTime(recordLapMs);
  DOM.speedUnitLabel.textContent = initialSpeedUnit === 'mph' ? 'MPH' : 'KM/H';
  DOM.unitToggle.textContent = initialSpeedUnit === 'mph' ? 'MPH' : 'KM/H';

  /* ---------- end verbatim ---------- */

  // --- presentation layers ------------------------------------------------
  const textures = createTextures({ tick });
  const TEX = textures.TEX;
  const signTex = textures.signTex;
  const SF_BANNER = textures.SF_BANNER;

  /* INDYGP-H1-COMPETITION-V1: 0..9 rivals, defaulting to a five-team field. */
  const opponentParam = Number(new URLSearchParams(window.location.search).get('opponents') ?? '9');
  const opponentCount = Number.isFinite(opponentParam) ? Math.round(clamp(opponentParam, 0, 9)) : 9;

  /* TEAMS-V1: the player's team drives both paint and physics. */
  const playerTeam = getTeam(new URLSearchParams(window.location.search).get('team'));

  /* M2-TIRES: compound selection. ?tyre=soft|medium|hard (default soft).
     Soft = current baseline grip but wears fast; medium/hard trade grip for
     life and shape the brake point earlier via the brake multiplier. */
  const playerTire = getTire(new URLSearchParams(window.location.search).get('tyre'));
  const tireState = { spec: playerTire, wear: 0 };

  /* TEAMS-V1 team picker: buttons on the start card switch ?team= and reload. */
  {
    const row = document.getElementById('teamRow');
    if (row) {
      const params = new URLSearchParams(window.location.search);
      for (const team of TEAMS) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'teamBtn' +
          (team.id === playerTeam.id ? ' active' : '');
        btn.innerHTML =
          '<span class="chip" style="background:#' +
          team.body.toString(16).padStart(6, '0') + '"></span>' +
          team.name;
        btn.title = team.engine.name + ' · ' + team.chassis.name + ' chassis';
        btn.addEventListener('click', () => {
          if (team.id === playerTeam.id) return;
          params.set('team', team.id);
          window.location.search = params.toString();
        });
        row.appendChild(btn);
      }
    }
  }

  const world = createWorld({
    DOM, CL, locate, TURNS, TEX, signTex, SF_BANNER, tick, opponentCount,
    playerTeam,
    /* M4A: brake-marker board art. */
    brakeMarkerTex: (textures as any).brakeMarkerTex,
  });
  const renderer = world.renderer;
  const scene = world.scene;
  /* M4D-QA: expose for Safari do-JavaScript inspection. */
  (window as any).__SCENE__ = scene;
  const camera = world.camera;
  const carRoot = world.carRoot;
  const carBody = world.carBody;
  const frontAxle = world.frontAxle;
  const allWheels = world.allWheels;
  const opponents = world.opponents;
  const HW = CFG.track.halfWidth;

  /* ---------- begin verbatim Layer 9: session state ---------- */

  /* INDYGP-H3-FORMAL-GRID: player spawns in painted grid slot 4. */
  const startLoc = (() => {
    const slot = getStartingGridSlot(PLAYER_STARTING_GRID_SLOT, CFG.track.gridOffset);
    const back = ((S_LINE + slot.longitudinal) + CL.length) % CL.length;
    const i = Math.round(back / CL.step) % CL.count;
    return {
      x: CL.pts[i*2] + CL.nrm[i*2] * slot.lateral,
      z: CL.pts[i*2+1] + CL.nrm[i*2+1] * slot.lateral,
      yaw: Math.atan2(CL.tan[i*2+1], CL.tan[i*2])
    };
  })();

  const car = createVehicle(startLoc.x, startLoc.z, startLoc.yaw);
  /* RACE-V1: race mode — ?race=full|half|sprint (default half = 30 laps). */
  const raceMode = parseRaceMode(new URLSearchParams(window.location.search).get('race'));
  const competition = createCompetition({
    CL, TURNS, opponents, startLineS: S_LINE, gridOffset: CFG.track.gridOffset,
    /* PERSONAS-V1: ?personas=random (default) | none | <persona-id>. */
    personaMode: parsePersonaParam(
      new URLSearchParams(window.location.search).get('personas')
    ),
    /* M3-DIFFICULTY: ?difficulty=novice|pro|elite (default pro). Scales the
       field's pace ceiling — never a catch-up tied to the player. */
    difficulty: ((): 'novice' | 'pro' | 'elite' => {
      const raw = new URLSearchParams(window.location.search).get('difficulty');
      return raw === 'novice' || raw === 'elite' ? raw : 'pro';
    })(),
    /* RACE-V1: field size and strategy window come from the race mode. */
    totalLaps: raceMode.totalLaps,
    rosterRandom: ((): boolean => {
      const raw = new URLSearchParams(window.location.search).get('roster');
      return (raw ?? '').trim().toLowerCase() === 'random';
    })(),
  });
  /* INDYGP-H1.1-RACE-START: fair standing start for player and rivals. */
  const raceStart = createRaceStartSequence();
  const SESSION = {
    running:false, paused:false, mapOpen:false,
    hint:0, lapProg:0, prevProg:0, armed:false,
    lap:0, lapStart:0, clock:0, last:null, best:null,
    camMode:0, shake:0, offTrack:false,
    speedUnit: initialSpeedUnit,
    /* INDYGP-H4-CLASSIFICATION: current earned race order. */
    position: opponentCount > 0 ? 2 : 1,
    fieldSize: opponentCount + 1,
    /* RACE-V1: live race readouts (HUD + finish handling). */
    raceLapOf: 0,
    raceTotalLaps: raceMode.totalLaps,
    raceState: 'WARMUP' as 'WARMUP' | 'RACING' | 'FINISHED',
    deltaAhead: null as number | null,
    deltaBehind: null as number | null,
    boxNow: false,
    raceExported: false,
    rivalPits: [] as Array<{ id: string; pitStops: number; inPit: boolean }>,
    /* RACE-V2 dash bindings: ERS, fuel laps, temps, per-corner wear, stint. */
    ers: 1,
    fuelLaps: -1,
    temps: { oil: 90, water: 85 },
    tireWear4: [0, 0, 0, 0],
    stintLaps: 0,
    /* M2-TIRES: HUD badge reads live compound + wear from SESSION. */
    tire: { short: tireState.spec.short, color: tireState.spec.color, wear: 0 }
  };

  /* RACE-V1: the race session object — positions, laps, results, export. */
  const raceSession = createRaceSession(raceMode, [
    { id: 'player', name: 'YOU', isPlayer: true, gridPosition: 4 },
    ...competition.getRivalStats().map((r, i) => ({
      id: r.id,
      name: `#${r.number} ${r.name}`,
      isPlayer: false,
      gridPosition: i < 3 ? [3, 5, 6][i] ?? i + 1 : i + 2,
    })),
  ]);
  competition.setLapCompleteListener((state, lapSeconds) => {
    recordLapComplete(raceSession, `rival-${state.id + 1}`, lapSeconds * 1000);
  });
  const camState = { pos:new THREE.Vector3(), look:new THREE.Vector3(), ready:false };

  /* ---------- end verbatim ---------- */

  // --- audio, input and HUD ------------------------------------------------
  const Audio = createAudio();

  const actions: Partial<SessionActions> = {};
  const input = createInput({ DOM, actions });
  const INPUT = input.INPUT;
  const readInput = input.readInput;

  const hud = createHud({ DOM, CL, locate, TURNS, car, opponents, INPUT, SESSION });
  /* M2-TIRES: HUD badge reads live compound + wear from SESSION. */
  SESSION.tire = SESSION.tire ?? { short: tireState.spec.short, color: tireState.spec.color, wear: 0 };
  /* RACE-V1: count a player pit stop into race stats when serviced. */
  /* M4D PIT LANE — player state machine.
     B = request stop (only accepted inside the entry capture zone).
     Phases: none -> driving (on pit path, limiter) -> stopped (box) -> driving -> none.
     While ON the pit path the car is kinematically guided along it (the pit
     lane is narrow and the sim's street physics would fight the walls). */
  const pit = {
    phase: 'none' as 'none' | 'driving' | 'stopping' | 'stopped',
    s: 0,
    stopTimer: 0,
    boxIndex: -1,
    limiter: false,
    serviced: false,
  };
  const pitPath = getPitPath();
  const pitQA = new URLSearchParams(location.search).get('pitqa') === '1' ? document.createElement('div') : null;
  const pitEvents: string[] = [];
  if(pitQA){pitQA.style.cssText='position:fixed;top:80px;left:20px;z-index:9999;background:#071720ed;color:white;padding:12px;font:14px monospace;max-width:580px';pitQA.textContent='PIT QA — steer into marked entrance or press B';document.body.appendChild(pitQA);}

  const actions2: Partial<import('@indygp/platform').SessionActions> = actions;
  actions2.pitKey = () => {
    if (pit.phase !== 'none') return;
    if (canRequestPit(car.x,car.z)) {
      pit.phase = 'driving';
      pitEvents.push('ENTRY accepted from track');
      pit.s = projectOnPitPath(car.x, car.z).s;
      pit.serviced = false;
      pit.boxIndex = 4;   // last box = shortest stop run; could pick by wear
      DOM.pitBanner && (DOM.pitBanner.textContent = 'PIT LANe — LIMiter on');
    } else {
      DOM.pitBanner && (DOM.pitBanner.textContent = 'Not in the pit entry');
    }
  };

  const drawMinimap = hud.drawMinimap;
  const drawCourseMap = hud.drawCourseMap;
  const ensureCourseMap = hud.ensureCourseMap;
  const paintHud = hud.paintHud;

  /* TELEMETRY-V1: T-key recorder for Chris reference laps (AI pace baseline). */
  const telemetry = createTelemetryRecorder({
    step: CFG.track.sampleStep,
    length: CL.length,
    progressS: () => ((locate(car.x, car.z, SESSION.hint).s - S_LINE) + CL.length) % CL.length,
    speed: () => Math.abs(car.vLong),
    offTrack: () => SESSION.offTrack,
    team: playerTeam.id,
  });

  /* ---------- begin verbatim Layer 9: session actions ---------- */

  function resize(){
    const w = window.innerWidth, h = window.innerHeight;
    // Hard ceiling on the drawing buffer. Rendering a 4K panel at native ratio
    // is four times the fragment work of 1080p for no visible gain here.
    // The cap lives in the render quality tier, not in the portable core
    // config, so packages/core stays free of renderer concerns.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY.render.maxPixelRatio));
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  function rejoin(){
    const l = locate(car.x, car.z, SESSION.hint);
    car.x = l.px; car.z = l.pz;
    car.yaw = Math.atan2(l.tz, l.tx);
    car.vLong = 0; car.vLat = 0; car.steer = 0;
    SESSION.shake = 0;
    camState.ready = false;
  }
  function cycleCamera(){
    SESSION.camMode = (SESSION.camMode + 1) % CFG.cam.names.length;
    camState.ready = false;
    /* Defensive: audio must never be left dead by a stray V-press. If the
       session is live and unpaused, guarantee the engine is audible. */
    if (SESSION.running && !SESSION.paused) Audio.resume();
  }
  function toggleMap(){
    SESSION.mapOpen = !SESSION.mapOpen;
    if (SESSION.mapOpen){
      ensureCourseMap();
      DOM.mapsheet.classList.remove('hide');
      Audio.suspend();
    } else {
      DOM.mapsheet.classList.add('hide');
      if (SESSION.running && !SESSION.paused) Audio.resume();
    }
  }
  DOM.mapsheet.addEventListener('click', () => { if (SESSION.mapOpen) toggleMap(); });

  function togglePause(){
    if (!SESSION.running) return;
    SESSION.paused = !SESSION.paused;
    if (SESSION.paused){
      DOM.startSub.textContent = 'Session paused · ' + CFG.cam.names[SESSION.camMode] + ' camera';
      DOM.startLede.textContent = 'The clock is stopped. Best lap so far: ' +
        (SESSION.best ? fmtTime(SESSION.best) : 'no clean lap yet') + '.';
      DOM.goBtn.textContent = 'Back to the car';
      DOM.start.classList.remove('hide');
      Audio.suspend();
    } else {
      DOM.start.classList.add('hide');
      Audio.resume();
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && SESSION.running && !SESSION.paused) togglePause();
  });

  DOM.goBtn.addEventListener('click', () => {
    startSession();
  });

  /* Dev/QA hook: ?autostart=1 skips the start overlay (used for automated
     visual testing; identical code path as the button). */
  if (new URLSearchParams(window.location.search).get('autostart') === '1') {
    setTimeout(startSession, 300);
  }

  /* Dev/QA hook: ?tp=x,z warps the car to track coordinates (visual testing
     of world features without keyboard-driving there). Uses the same clamp
     and camera-reset path as rejoin(). */
  {
    const tp = new URLSearchParams(window.location.search).get('tp');
    if (tp) {
      const [tx, tz] = tp.split(',').map(Number);
      if (Number.isFinite(tx) && Number.isFinite(tz)) {
        const flip = new URLSearchParams(window.location.search).get('flip') === '1';
        setTimeout(() => {
          car.x = tx; car.z = tz;
          /* M4D: tpraw=1 skips the centreline snap so QA can park the car
             on the pit lane / other off-track surfaces. */
          const raw = new URLSearchParams(window.location.search).get('tpraw') === '1';
          if (!raw) rejoin();   // snap onto the centreline with correct heading
          else car.yaw = Math.PI * 0.5;
          if (flip) car.yaw += Math.PI;   // face the opposite way

        }, 400);
      }
    }
  }

  function startSession() {
    DOM.start.classList.add('hide');
    DOM.hud.classList.add('live');
    Audio.start(); Audio.resume();
    if (!SESSION.running){
      SESSION.running = true;
      SESSION.prevProg = ((locate(car.x, car.z, 0).s - S_LINE) + CL.length) % CL.length;
      if (opponentCount > 0) raceStart.start();
      setTimeout(() => { DOM.crib.style.opacity = '0.25'; }, 9000);
    }
    SESSION.paused = false;
  }
  DOM.unitToggle.addEventListener('click', () => {
    SESSION.speedUnit = SESSION.speedUnit === 'mph' ? 'kph' : 'mph';
    const txt = SESSION.speedUnit === 'mph' ? 'MPH' : 'KM/H';
    DOM.unitToggle.textContent = txt;
    DOM.speedUnitLabel.textContent = txt;
    window.localStorage.setItem(SPEED_UNIT_STORE_KEY, SESSION.speedUnit);
  });

  /* ---------- end verbatim ---------- */

  // hand the freshly defined actions to the input layer
  actions.cycleCamera = cycleCamera;
  actions.toggleMap = toggleMap;
  actions.rejoin = rejoin;
  actions.togglePause = togglePause;
  actions.toggleAudio = () => { Audio.toggle(); };
  actions.telemetryKey = (k: string) => telemetry.key(k);

  /* ---------- begin verbatim Layer 9: lap timing ---------- */

  function updateLap(prog, dtMs){
    if (SESSION.lap > 0) SESSION.clock += dtMs;
    const L = CL.length;
    const crossedForward = SESSION.prevProg > L*0.82 && prog < L*0.18;
    const crossedBack    = SESSION.prevProg < L*0.18 && prog > L*0.82;
    if (crossedForward && car.vLong > 0){
      if (SESSION.lap > 0 && SESSION.armed){
        SESSION.last = SESSION.clock;
        if (SESSION.best == null || SESSION.clock < SESSION.best) SESSION.best = SESSION.clock;
        telemetry.completeLap(SESSION.clock);
        if (SESSION.best < recordLapMs) {
          recordLapMs = SESSION.best;
          DOM.fRecord.textContent = fmtTime(recordLapMs);
          window.localStorage.setItem(RECORD_LAP_STORE_KEY, String(recordLapMs));
        }
      }
      SESSION.lap++; SESSION.clock = 0; SESSION.armed = false;
      /* RACE-V2: stint age for the tire dock. */
      (SESSION as any).stintLaps = (Number((SESSION as any).stintLaps) || 0) + 1;
    } else if (crossedBack){
      // driven backwards over the line: invalidate rather than gift a lap
      SESSION.armed = false;
    }
    if (prog > L*0.55) SESSION.armed = true;
    SESSION.prevProg = prog;
  }

  /* ---------- end verbatim ---------- */

  /* ---------- begin verbatim Layer 9: camera and main loop ---------- */

  const tmpV = new THREE.Vector3(), tmpLook = new THREE.Vector3();
  function updateCamera(dt){
    const m = CFG.cam.names[SESSION.camMode];
    const c = m === 'Bonnet' ? CFG.cam.bonnet : (m === 'Chase' ? CFG.cam.chase : CFG.cam.high);
    if (camera.fov !== c.fov){ camera.fov = c.fov; camera.updateProjectionMatrix(); }
    const fx = Math.cos(car.yaw), fz = Math.sin(car.yaw);
    const speedPull = clamp01(Math.abs(car.vLong)/70);
    /* PR5 Car G1C: keep the enlarged Formula body clear of Bonnet camera. */
    const bonnetSafe = m === 'Bonnet';
    const baseBack = bonnetSafe ? Math.max(c.back, 3.65) : c.back;
    const baseUp = bonnetSafe ? Math.max(c.up, 1.55) : c.up;
    const lookAhead = bonnetSafe ? Math.max(c.lookAhead, 3.4) : c.lookAhead;
    const lookY = bonnetSafe ? 0.72 : 1.1;
    const back = baseBack * (1 + speedPull*0.22);
    tmpV.set(car.x - fx*back, baseUp + speedPull*0.5, car.z - fz*back);
    tmpLook.set(car.x + fx*lookAhead, lookY, car.z + fz*lookAhead);
    if (!camState.ready){ camState.pos.copy(tmpV); camState.look.copy(tmpLook); camState.ready = true; }
    const k = 1 - Math.exp(-c.lag*dt);
    camState.pos.lerp(tmpV, k);
    camState.look.lerp(tmpLook, k);
    camera.position.copy(camState.pos);
    if (SESSION.shake > 0.001){
      const s = SESSION.shake;
      camera.position.x += (Math.random()-0.5)*s*1.9;
      camera.position.y += (Math.random()-0.5)*s*1.1;
      camera.position.z += (Math.random()-0.5)*s*1.9;
      SESSION.shake -= SESSION.shake * CFG.cam.shakeDecay * dt;
    }
    camera.lookAt(camState.look);
  }

  /* -- main loop ----------------------------------------------------------- */
  let acc = 0, prevT = 0;
  /* The physics layer takes one flat config object, so the two numbers it needs
     from outside CFG.car are folded in here rather than reached for globally. */
  /* TEAMS-V1: team engine/chassis multipliers scale the base numbers. The
     PHYS object is rebuilt each frame because the Illyrian engine fades over
     race distance (enginePowerAt is time-dependent). */
  const PHYS = Object.assign({}, CFG.car, {
    scrub: CFG.surface.wallScrub,
    wallOffset: CFG.track.wallOffset
  });
  function applyTeamPhysics(): void {
    const phys = teamPhysicsAt(playerTeam, SESSION.clock);
    /* M2-TIRES: compound grip/brake multipliers with wear falloff. Grip flows
       through surf.grip (which also scales brake bite in stepVehicle); the
       compound's brake multiplier shapes how late you can brake. */
    const tireGrip = tireGripFactor(tireState.spec, tireState.wear);
    PHYS.power = CFG.car.power * phys.power;
    PHYS.topSpeed = CFG.car.topSpeed * phys.topSpeed;
    PHYS.latGrip = CFG.car.latGrip * phys.latGrip * tireState.spec.grip * tireGrip;
    PHYS.brake = CFG.car.brake * phys.brake * tireState.spec.brake * (0.7 + 0.3 * tireGrip);
  }
  applyTeamPhysics();

  function frame(now){
    requestAnimationFrame(frame);
    if (!prevT) prevT = now;
    let dt = (now - prevT)/1000;
    prevT = now;
    if (dt > CFG.sim.maxFrame) dt = CFG.sim.maxFrame;   // never let a stall teleport the car

    raceStart.update(SESSION.paused || SESSION.mapOpen ? 0 : dt);
    const active = SESSION.running && !SESSION.paused && !SESSION.mapOpen && !raceStart.holding;
    if (active){
      applyTeamPhysics();
      readInput();
      acc += dt;
      let guard = 0;
      while (acc >= CFG.sim.step && guard++ < 24){
        const loc = locate(car.x, car.z, SESSION.hint);
        SESSION.hint = loc.index;
        const off = Math.abs(loc.lateral) > HW + 0.6 && !isPitDrivable(car.x,car.z);
        SESSION.offTrack = off;
        if (pit.phase === 'none') stepVehicle(car, INPUT, CFG.sim.step, off ? CFG.surface.offTrack : CFG.surface.onTrack, PHYS);
        /* M2-TIRES: wear advances with corner load and slip. cornerLoad01
           normalizes |latAccel| so ~1.0 ≈ hard cornering at the grip limit. */
        tireState.wear = advanceWear(
          tireState.spec, tireState.wear, CFG.sim.step,
          Math.abs(car.vLong),
          Math.min(1, Math.abs(car.latAccel) / 33),
          car.slipping && !off,
        );
        // Detect natural turn-in AFTER vehicle motion and BEFORE confinement.
        if(pit.phase==='none' && shouldEnterPit(car.x,car.z,car.yaw)){
          actions2.pitKey?.();
          if(pit.phase!=='none')pitEvents.push('NATURAL turn-in — no B');
        }
        const hit = pit.phase === 'none' ? applyBarriers(car, locate(car.x, car.z, SESSION.hint), CL, PHYS) : 0;
        if (hit > 0) SESSION.shake = Math.max(SESSION.shake, hit);
        competition.step(CFG.sim.step);
        acc -= CFG.sim.step;
      }
      const here = locate(car.x, car.z, SESSION.hint);
      SESSION.hint = here.index;
      const prog = ((here.s - S_LINE) + CL.length) % CL.length;
      updateLap(prog, dt*1000);
      telemetry.sample(performance.now());
      SESSION.tire.wear = tireState.wear;
      const classification = competition.getClassification(SESSION.lap, prog);
      SESSION.position = classification.playerPosition;
      SESSION.fieldSize = classification.fieldSize;

      /* RACE-V1: live race-session update — clock, standings, finish checks. */
      if (raceStart.holding === false && raceSession.state === 'WARMUP') beginRacing(raceSession);
      updateRaceSession(raceSession, dt * 1000, [
        { id: 'player', lap: Math.max(0, SESSION.lap), progress: prog, trackLength: CL.length },
        ...competition.getRivalStats().map((r) => ({ id: r.id, lap: r.lap, progress: 0, trackLength: CL.length })),
      ]);
        /* RACE-V1: deltas to the cars ahead/behind (gap in seconds, from the
           live classification's track distance and each car's lap). */
        {
          const L = CL.length;
          const myDist = Math.max(0, SESSION.lap) * L + prog;
        let aheadGap: number | null = null;
        let behindGap: number | null = null;
        for (const entry of classification.entries) {
          if (entry.id === 'player') continue;
          const d = entry.totalDistance - myDist;
          if (d > 0 && (aheadGap == null || d < aheadGap)) aheadGap = d;
          if (d < 0 && (behindGap == null || -d < behindGap)) behindGap = -d;
        }
        const aiLapS = 84;
        SESSION.deltaAhead = aheadGap != null ? aheadGap / aiLapS : null;
        SESSION.deltaBehind = behindGap != null ? behindGap / aiLapS : null;
        SESSION.raceLapOf = raceSession.lap;
        SESSION.raceTotalLaps = raceMode.totalLaps;
        SESSION.raceState = raceSession.state;
        /* RIVAL-PITS: BOX NOW if player tire health < 30%. */
        SESSION.boxNow = (1 - tireState.wear) < 0.30 && raceSession.state === 'RACING';
        /* RACE-V2 dash bindings: fuel estimate from player wear pace, ERS
           regen model (recharges under braking), thermal model. */
        SESSION.fuelLaps = Math.max(0, raceMode.totalLaps - Math.max(0, SESSION.lap));
        const brakingNow = INPUT.brake > 0.2;
        SESSION.ers = Math.max(0, Math.min(1,
          (SESSION.ers as number) + (brakingNow ? 0.09 : -Math.abs(car.vLong) > 30 ? 0.012 : 0.002) * CFG.sim.step));
        /* Thermal proxy: oil/water climb with sustained load, cool when slow. */
        const heatTarget = 84 + (1 - tireState.spec.grip) * 60 + Math.abs(car.latAccel) * 0.9;
        SESSION.temps = {
          oil: (SESSION.temps as { oil: number }).oil + (heatTarget + 8 - (SESSION.temps as { oil: number }).oil) * 0.02,
          water: (SESSION.temps as { water: number }).water + (heatTarget - (SESSION.temps as { water: number }).water) * 0.02,
        };
        /* Per-corner tire wear: load-weighted split — fronts carry braking +
           steering, rears carry traction; inside wheel extra. */
        {
          const w = tireState.wear;
          const steerBias = Math.min(1, Math.abs(car.steer) * 2);
          const brakeBias = INPUT.brake;
          const frontExtra = w * 0.06 * (0.5 + brakeBias);
          const rearExtra = w * 0.04 * (1 - brakeBias);
          SESSION.tireWear4 = [
            Math.min(1, w + frontExtra * (0.6 + steerBias * 0.8)),  // FL
            Math.min(1, w + frontExtra * (0.6 + (1 - steerBias) * 0.8)),  // FR
            Math.min(1, w + rearExtra * (0.6 + steerBias * 0.6)),   // RL
            Math.min(1, w + rearExtra * (0.6 + (1 - steerBias) * 0.6)),   // RR
          ];
        }
        /* Rival live stats for the HUD pit column. */
        const rivalStats = competition.getRivalStats();
        SESSION.rivalPits = rivalStats.map((r) => ({ id: r.id, pitStops: r.pitStops, inPit: r.inPit }));
        void positionOf;
      }

      /* RACE-V1: on FINISHED, export the structured session JSON once. */
      if (raceSession.state === 'FINISHED' && !SESSION.raceExported) {
        SESSION.raceExported = true;
        const summary = buildSessionSummary(raceSession);
        summary.results = summary.results.map((row) => {
          if (row.entrantId === 'player') {
            return { ...row, fastestLapMs: SESSION.best, totalTimeMs: raceSession.raceClockMs };
          }
          const fin = competition.rivalFinishState().find((r) => r.id === row.entrantId);
          return fin ? { ...row, fastestLapMs: fin.bestLapS != null ? fin.bestLapS * 1000 : null, pitStops: fin.pitStops } : row;
        });
        try {
          const blob = new Blob([exportSessionJson(raceSession)], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `indygp_session_${raceMode.id}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
          a.click();
          URL.revokeObjectURL(a.href);
        } catch { /* export is best-effort; the summary is still on screen */ }
        DOM.startSub.textContent = `Race complete — P${playerPosition(raceSession)} · summary exported`;
        DOM.startLede.textContent = `Fastest lap: ${summary.fastestLap ? `${summary.fastestLap.driver} ${fmtTime(summary.fastestLap.lapMs)}` : 'n/a'}`;
        DOM.goBtn.textContent = 'Back to the car';
        DOM.start.classList.remove('hide');
        Audio.suspend();
      }

      // next corner: first turn ahead on the lap, wrapping at the line
      let next = TURNS[0], gap = Infinity;
      for (const t of TURNS){
        const d = ((t.lap - prog) + CL.length) % CL.length;
        if (d < gap){ gap = d; next = t; }
      }
      paintHud(SESSION.offTrack, next, gap);
      drawMinimap(car);

      /* Pit traversal uses elapsed time, bypasses road confinement, and
         services exactly once. Vehicle yaw uses atan2(z,x), like physics. */
      if (pit.phase !== 'none') {
        const oldPhase=pit.phase;
        const result = advancePitRun(pit,dt);
        if(oldPhase!==pit.phase)pitEvents.push(pit.phase==='stopping'?'BOX stop':pit.s>=pitPath.length?'EXIT complete / control returned':'SERVICE complete');
        if(pitQA)pitQA.textContent=pitEvents.join(' → ')+' | s='+pit.s.toFixed(1)+'/'+pitPath.length.toFixed(1);

        const here = samplePitPath(pit.s);
        car.x=here.x; car.z=here.z; car.yaw=Math.atan2(here.tz,here.tx);
        car.vLong=result.speed;car.vLat=0;car.latAccel=0;car.slipping=false;
        if(result.fresh){tireState.wear=0;SESSION.tire.wear=0;recordPitStop(raceSession,'player');SESSION.stintLaps=0;SESSION.ers=1;SESSION.tireWear4=[0,0,0,0];}
        if(DOM.pitBanner){DOM.pitBanner.style.display=pit.s>=pitPath.length?'none':'block';DOM.pitBanner.textContent=pit.phase==='stopping'?'PIT STOP — CHANGING TIRES':pit.serviced?'PIT EXIT — FOLLOW LANE':'PIT LANE — LIMITER ON';}
      }

      const kph = Math.abs(car.vLong)*3.6;
      const gb = gearFor(kph, CFG.car.gears);
      /* Rev: linear 0->1 over the first 12 kph (start-up + rolling idle),
         then the gear-band curve above that. At a standstill rev = 0 ->
         engine silent; moving -> engine alive immediately. */
      const startRamp = clamp01(kph / 12);
      const bandRev = clamp01((kph - gb.lo)/Math.max(1, gb.hi-gb.lo));
      Audio.update(clamp01(startRamp * (0.18 + bandRev * 0.82)),
                   INPUT.throttle*0.8 + (car.slipping ? 0.2 : 0));
    }

    // present
    carRoot.position.set(car.x, 0, car.z);
    carRoot.rotation.y = -car.yaw;
    carBody.rotation.x = clamp(car.latAccel/70, -0.075, 0.075);
    carBody.rotation.z = clamp(-(INPUT.brake - INPUT.throttle)*0.014, -0.02, 0.02);
    for (const p of frontAxle) p.rotation.y = -car.steer;
    for (const w of allWheels) w.rotation.z = -car.wheelSpin;
    competition.present();
    updateCamera(Math.max(dt, 1/240));
    // Slide the shadow frustum along with the car: a 15 degree sun needs a
    // tight, moving orthographic box to stay sharp across the whole circuit.
    world.updateShadow(car.x, car.z);
    renderer.render(scene, camera);
  }

  /* -- hand over to the driver -------------------------------------------- */
  tick('Ready');
  DOM.boot.classList.add('hide');

  /* MENU-V1: title + main menu gate. The base URL (no query params) always
     shows the menu. Menu items reload with launch params (?race=full etc),
     and any launch with params (or ?autostart QA runs) goes straight to
     the classic start card. "Main Menu" from pause clears the params. */
  const urlParams0 = new URLSearchParams(window.location.search);
  const launchedFromMenu = urlParams0.toString().length > 0;
  if (!launchedFromMenu && urlParams0.get('autostart') !== '1') {
    DOM.start.classList.add('hide');
    const menu = createMenu({
      onLaunch(params: string) {
        window.location.href = window.location.pathname + params;
      },
    });
    (window as any).__indygpMenu = menu;
  } else {
    DOM.start.classList.remove('hide');
    DOM.goBtn.focus();
  }
  requestAnimationFrame(frame);

  /* ---------- end verbatim ---------- */
}
