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
  getTeam, teamPhysicsAt, TEAMS
} from '@indygp/core';
import { PLAYER_STARTING_GRID_SLOT, getStartingGridSlot, parsePersonaParam, getTire, tireGripFactor, advanceWear, TIRE_SPECS, TIRE_WEAR_MAX } from '@indygp/core';
import { DOM, grab, fatal, createInput, createAudio, createHud } from '@indygp/platform';
import type { SessionActions } from '@indygp/platform';
import { createTextures, createWorld, QUALITY } from '@indygp/render';
import { createCompetition } from './competition/createCompetition';
import { createRaceStartSequence } from './competition/createRaceStartSequence';
import { createTelemetryRecorder } from './competition/telemetry';

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
    fieldSize: opponentCount + 1
  };
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
  SESSION.tire = { short: tireState.spec.short, color: tireState.spec.color, wear: 0 };

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
          rejoin();   // snap onto the centreline with correct heading
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
        const off = Math.abs(loc.lateral) > HW + 0.6;
        SESSION.offTrack = off;
        stepVehicle(car, INPUT, CFG.sim.step, off ? CFG.surface.offTrack : CFG.surface.onTrack, PHYS);
        /* M2-TIRES: wear advances with corner load and slip. cornerLoad01
           normalizes |latAccel| so ~1.0 ≈ hard cornering at the grip limit. */
        tireState.wear = advanceWear(
          tireState.spec, tireState.wear, CFG.sim.step,
          Math.abs(car.vLong),
          Math.min(1, Math.abs(car.latAccel) / 33),
          car.slipping && !off,
        );
        const hit = applyBarriers(car, locate(car.x, car.z, SESSION.hint), CL, PHYS);
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

      // next corner: first turn ahead on the lap, wrapping at the line
      let next = TURNS[0], gap = Infinity;
      for (const t of TURNS){
        const d = ((t.lap - prog) + CL.length) % CL.length;
        if (d < gap){ gap = d; next = t; }
      }
      paintHud(SESSION.offTrack, next, gap);
      drawMinimap(car);

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
  DOM.start.classList.remove('hide');
  DOM.goBtn.focus();
  requestAnimationFrame(frame);

  /* ---------- end verbatim ---------- */
}
