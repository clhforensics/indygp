/* =============================================================================
   LAYER 8b - HUD, MINIMAP AND COURSE MAP
   DOM readouts plus the two canvas maps. Bodies extracted verbatim from
   IndyGP_Phase1.html; canvas font stacks rewritten for offline use.
   ========================================================================== */

import { CFG, TAU, clamp01, fmtTime, gearFor, AVE, ST, CIRCLE } from '@indygp/core';
import type { Centreline, Locator, TurnInfo, Vehicle, VehicleInput } from '@indygp/core';

export interface HudDeps {
  DOM: Record<string, any>;
  CL: Centreline;
  locate: Locator;
  TURNS: TurnInfo[];
  /** Live references: the HUD reads these every frame. */
  car: Vehicle;
  INPUT: VehicleInput;
  SESSION: Record<string, any>;
  opponents?: Array<{
    livery?: string;
    team?: { id: string };
    carRoot: {
      position: { x: number; z: number };
      rotation: { y: number };
    };
  }>;
  /** RACE-V4: live sector timing state for the splits-row deltas. */
  sectors?: {
    splits: Array<number | null>;
    bests: Array<number | null>;
    current: number;
    liveS: number;
  };
}

export function createHud(deps: HudDeps) {
  const DOM = deps.DOM;
  const CL = deps.CL;
  /* M2-TIRES: tire badge + wear bar lives beside the pylon lap readout.
     Compound ring color (red/yellow/white like F1) + wear fill green→red. */
  const tireBadge = document.createElement('span');
  tireBadge.style.display = 'none';
  tireBadge.style.marginLeft = '8px';
  tireBadge.style.fontFamily = 'Consolas, "Courier New", monospace';
  tireBadge.style.fontSize = '11px';
  {
    const ring = document.createElement('span');
    ring.style.cssText = 'display:inline-block;width:14px;height:14px;' +
      'border-radius:50%;border:2px solid #111;margin-right:5px;' +
      'vertical-align:-2px;';
    ring.id = 'tyreRing';
    const bar = document.createElement('span');
    bar.style.cssText = 'display:inline-block;width:34px;height:6px;' +
      'background:rgba(0,0,0,.5);border-radius:2px;overflow:hidden;' +
      'vertical-align:0px;';
    const fill = document.createElement('span');
    fill.style.cssText = 'display:block;height:100%;width:0%;background:#3fca5a;';
    fill.id = 'tyreWearFill';
    bar.appendChild(fill);
    tireBadge.appendChild(ring);
    tireBadge.appendChild(bar);
  }
  const tireRing = tireBadge.querySelector('#tyreRing') as HTMLElement;
  const tireWearFill = tireBadge.querySelector('#tyreWearFill') as HTMLElement;
  const locate = deps.locate;
  const TURNS = deps.TURNS;
  const car = deps.car;
  const INPUT = deps.INPUT;
  const SESSION = deps.SESSION;
  const opponents = deps.opponents ?? [];
  /* RACE-V4: live sector state for delta coloring in the splits row. */
  const sectorsState = deps.sectors ?? null;

  /* INDYGP-H4-POSITION-HUD: compact live classification beside pylon lap. */
  const positionBadge = document.createElement('span');
  positionBadge.setAttribute('aria-live', 'polite');
  positionBadge.style.display = 'none';
  positionBadge.style.marginLeft = '8px';
  positionBadge.style.fontFamily = 'Consolas, "Courier New", monospace';
  positionBadge.style.fontSize = '11px';
  positionBadge.style.fontWeight = '800';
  positionBadge.style.letterSpacing = '0.08em';
  positionBadge.style.whiteSpace = 'nowrap';
  if (DOM.pylonLap) DOM.pylonLap.insertAdjacentElement('afterend', positionBadge);
  if (DOM.pylonLap) DOM.pylonLap.insertAdjacentElement('afterend', tireBadge);

  /* RACE-V1: race-info badges — lap counter, gaps, BOX NOW alert. */
  function makeBadge(color: string, weight: string): HTMLElement {
    const el = document.createElement('span');
    el.style.display = 'none';
    el.style.marginLeft = '8px';
    el.style.fontFamily = 'Consolas, "Courier New", monospace';
    el.style.fontSize = '11px';
    el.style.fontWeight = weight;
    el.style.letterSpacing = '0.08em';
    el.style.whiteSpace = 'nowrap';
    el.style.color = color;
    return el;
  }
  const raceInfoBadge = makeBadge('rgba(232,226,213,.85)', '700');
  const deltaBadge = makeBadge('rgba(232,226,213,.72)', '600');
  const boxNowBadge = makeBadge('#E3352B', '800');
  boxNowBadge.textContent = 'BOX NOW';
  boxNowBadge.style.padding = '1px 7px';
  boxNowBadge.style.border = '1px solid #E3352B';
  boxNowBadge.style.borderRadius = '3px';
  /* SECTORS: S1/S2/S3 splits row, inserted under the tower cap. */
  const sectorRowEl = document.createElement('div');
  sectorRowEl.style.cssText = 'display:none;gap:10px;padding:2px 0;order:10;' +
    'font-family:Consolas,"Courier New",monospace;font-size:11.5px;font-weight:700;' +
    'letter-spacing:.05em;';
  sectorRowEl.id = 'sectorRow';
  if (DOM.pylonLap) {
    const cap = DOM.pylonLap.parentElement;   // .cap row
    if (cap) cap.insertAdjacentElement('afterend', sectorRowEl);
    sectorRowEl.style.display = 'flex';
  }
  if (DOM.pylonLap) {
    const cap = DOM.pylonLap.parentElement;   // .cap row
    if (cap) cap.insertAdjacentElement('afterend', deltaBadge);
    deltaBadge.style.cssText += ';display:none;padding:1px 0 2px;order:9;';
    DOM.pylonLap.insertAdjacentElement('afterend', raceInfoBadge);
    DOM.pylonLap.insertAdjacentElement('afterend', boxNowBadge);
  }

  /* RACE-V3: race notes ticker — top-right broadcast feed of live events
     (pit stops, fastest laps, final lap, classification swings). Notes flash
     3x, then fade; the stack holds the 4 most recent. */
  const notesHost = document.createElement('div');
  notesHost.id = 'raceNotes';
  document.body.appendChild(notesHost);
  function raceNote(text: string, kind: '' | 'white' | 'fl' | 'pit' | 'win' = ''): void {
    if (!text) return;
    /* Skip exact duplicates of the newest note (event handlers fire per-frame). */
    const kids = notesHost.children;
    if (kids.length && (kids[kids.length - 1] as HTMLElement).textContent === text) return;
    const el = document.createElement('div');
    el.className = 'raceNote' + (kind ? ' ' + kind : '');
    el.textContent = text;
    notesHost.appendChild(el);
    while (notesHost.children.length > 4) notesHost.removeChild(notesHost.firstChild as Node);
    window.setTimeout(() => {
      el.style.transition = 'opacity .5s ease';
      el.style.opacity = '0';
      window.setTimeout(() => el.remove(), 520);
    }, 4600);
  }

  /* ---------- begin verbatim Layer 8b ---------- */

  function mapProjector(w, h, pad){
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < CL.count; i++){
      const x = CL.pts[i*2], z = CL.pts[i*2+1];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const sc = Math.min((w-pad*2)/(maxX-minX), (h-pad*2)/(maxZ-minZ));
    const ox = (w - (maxX-minX)*sc)/2, oz = (h - (maxZ-minZ)*sc)/2;
    return { to:(x,z) => [ (x-minX)*sc + ox, (z-minZ)*sc + oz ], sc };
  }
  function tracePath(g, proj){
    g.beginPath();
    for (let i = 0; i <= CL.count; i++){
      const k = i % CL.count;
      const p = proj.to(CL.pts[k*2], CL.pts[k*2+1]);
      if (i === 0) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]);
    }
    g.closePath();
  }

  // pre-render the static minimap layer once
  const miniCv = DOM.minimap;
  const miniG = miniCv.getContext('2d');
  if (!miniG) throw new Error('the minimap needs a 2D canvas context');
  const miniProj = mapProjector(miniCv.width, miniCv.height, 22);
  const miniBase = document.createElement('canvas');
  miniBase.width = miniCv.width; miniBase.height = miniCv.height;
  {
    const g = miniBase.getContext('2d');
    g.lineJoin = g.lineCap = 'round';
    tracePath(g, miniProj);
    g.strokeStyle = 'rgba(232,226,213,.16)'; g.lineWidth = 13; g.stroke();
    g.strokeStyle = '#5E646D'; g.lineWidth = 8; g.stroke();
    const l = locate(CFG.track.startFinish.x, CFG.track.startFinish.z, 0);
    const p = miniProj.to(l.px, l.pz);
    g.fillStyle = '#9E3B2A';
    g.beginPath(); g.arc(p[0], p[1], 7, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,177,20,.85)';
    for (const t of TURNS){
      const q = miniProj.to(t.x, t.z);
      g.beginPath(); g.arc(q[0], q[1], 3.4, 0, TAU); g.fill();
    }
  }
  function drawMinimap(car){
    miniG.clearRect(0,0,miniCv.width,miniCv.height);
    miniG.drawImage(miniBase, 0, 0);

    /* INDYGP-H3-RIVAL-MINIMAP: team-coded live rival indicators. */
    const rivalColors: Record<string, string> = {
      hogan: '#D9A441',
      keystone: '#C0C7D1',
      ironwood: '#B0653A',
      novalis: '#37C4BD',
      stclair: '#E6DDC8'
    };
    for (const opponent of opponents){
      const root = opponent.carRoot;
      const q = miniProj.to(root.position.x, root.position.z);
      const teamKey = opponent.team ? opponent.team.id : '';
      miniG.save();
      miniG.translate(q[0], q[1]);
      miniG.rotate(-root.rotation.y);
      miniG.fillStyle = rivalColors[teamKey] || rivalColors[opponent.livery] || '#E8E2D5';
      miniG.strokeStyle = 'rgba(11,13,16,.85)';
      miniG.lineWidth = 1.4;
      miniG.beginPath();
      miniG.moveTo(7.5,0); miniG.lineTo(-4.8,4.3); miniG.lineTo(-4.8,-4.3);
      miniG.closePath(); miniG.fill(); miniG.stroke();
      miniG.restore();
    }

    /* RACE-V3: rivals in the pit lane get a cyan ring + P glyph at their real
       position (AI freezes near the pit entry while serviced), so a leader
       can see at a glance that P2 is boxing rather than slowing on track. */
    for (const rp of (SESSION.rivalPits as Array<{ id: string; pitStops: number; inPit: boolean }>)) {
      if (!rp.inPit) continue;
      const opp = opponents.find((o: any) => `rival-${o.id + 1}` === rp.id) as any;
      if (!opp || !opp.carRoot) continue;
      const q = miniProj.to(opp.carRoot.position.x, opp.carRoot.position.z);
      miniG.save();
      miniG.translate(q[0], q[1]);
      miniG.strokeStyle = '#35E0FF';
      miniG.lineWidth = 2;
      miniG.beginPath();
      miniG.arc(0, 0, 10.5, 0, TAU);
      miniG.stroke();
      miniG.fillStyle = '#35E0FF';
      miniG.font = '800 10px Consolas, "Courier New", monospace';
      miniG.textAlign = 'center';
      miniG.fillText('P', 0, 3.5);
      miniG.restore();
    }

    const p = miniProj.to(car.x, car.z);
    miniG.save();
    miniG.translate(p[0], p[1]);
    miniG.rotate(car.yaw);
    miniG.fillStyle = '#FFB114';
    miniG.beginPath();
    miniG.moveTo(11,0); miniG.lineTo(-7,6.5); miniG.lineTo(-7,-6.5);
    miniG.closePath(); miniG.fill();
    miniG.restore();
  }

  // the full course map, drawn on demand
  let courseDrawn = false;
  function drawCourseMap(){
    const cv = DOM.coursemap, g = cv.getContext('2d');
    if (!g) throw new Error('the course map needs a 2D canvas context');
    const proj = mapProjector(cv.width, cv.height, 66);
    g.clearRect(0,0,cv.width,cv.height);
    g.lineJoin = g.lineCap = 'round';

    // street grid, so the shape reads as downtown and not as an abstract squiggle
    g.strokeStyle = 'rgba(232,226,213,.075)'; g.lineWidth = 1.5;
    for (const key in AVE){
      const a = proj.to(AVE[key], -760), b = proj.to(AVE[key], 700);
      g.beginPath(); g.moveTo(a[0],a[1]); g.lineTo(b[0],b[1]); g.stroke();
    }
    for (const key in ST){
      const a = proj.to(-860, ST[key]), b = proj.to(1240, ST[key]);
      g.beginPath(); g.moveTo(a[0],a[1]); g.lineTo(b[0],b[1]); g.stroke();
    }
    tracePath(g, proj);
    g.strokeStyle = 'rgba(232,226,213,.14)'; g.lineWidth = 26; g.stroke();
    g.strokeStyle = '#E8E2D5'; g.lineWidth = 15; g.stroke();
    g.strokeStyle = '#3A3F46'; g.lineWidth = 2; g.setLineDash([12,12]); g.stroke(); g.setLineDash([]);

    // Monument Circle
    const c0 = proj.to(CIRCLE.x, CIRCLE.z);
    g.strokeStyle = 'rgba(255,177,20,.34)'; g.lineWidth = 2;
    g.beginPath(); g.arc(c0[0], c0[1], (CIRCLE.r-14)*proj.sc, 0, TAU); g.stroke();
    g.fillStyle = 'rgba(255,177,20,.9)';
    g.font = '600 15px Consolas, "Courier New", monospace'; g.textAlign = 'center';
    g.fillText('MONUMENT', c0[0], c0[1]+5);

    // start / finish
    const l = locate(CFG.track.startFinish.x, CFG.track.startFinish.z, 0);
    const sp = proj.to(l.px, l.pz);
    g.save(); g.translate(sp[0], sp[1]); g.rotate(Math.atan2(l.tz, l.tx));
    g.fillStyle = '#9E3B2A'; g.fillRect(-4, -17, 8, 34);
    g.restore();
    g.fillStyle = '#9E3B2A'; g.textAlign = 'left';
    g.font = '700 15px "Arial Narrow", Arial, sans-serif';
    g.fillText('START / FINISH — ARTSGARDEN', sp[0]+13, sp[1]-20);

    // numbered corners
    for (const t of TURNS){
      const q = proj.to(t.x, t.z);
      const away = t.dir === 'R' ? -1 : 1;
      const i = t.index;
      const lx = q[0] - CL.nrm[i*2]*away*30, ly = q[1] - CL.nrm[i*2+1]*away*30;
      g.strokeStyle = 'rgba(255,177,20,.5)'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(q[0],q[1]); g.lineTo(lx,ly); g.stroke();
      g.fillStyle = '#0B0D10';
      g.beginPath(); g.arc(lx, ly, 15, 0, TAU); g.fill();
      g.strokeStyle = t.dir === 'R' ? '#FFB114' : '#4FBF67'; g.lineWidth = 2; g.stroke();
      g.fillStyle = t.dir === 'R' ? '#FFB114' : '#4FBF67';
      g.font = '700 16px Consolas, "Courier New", monospace'; g.textAlign = 'center';
      g.fillText(String(t.n), lx, ly+6);
    }

    // legend
    g.textAlign = 'left'; g.font = '600 13px Consolas, "Courier New", monospace';
    g.fillStyle = '#FFB114'; g.fillText('● RIGHT-HANDER', 20, cv.height-38);
    g.fillStyle = '#4FBF67'; g.fillText('● LEFT-HANDER',  20, cv.height-18);
    g.fillStyle = 'rgba(232,226,213,.45)';
    g.fillText('grid lines are the real Mile Square streets', 250, cv.height-18);

    // corner list beside the map
    DOM.turnlist.innerHTML = TURNS.map(t =>
      '<div class="t"><b>T' + t.n + '</b><span>' + t.name +
      '<br><i style="color:var(--limestone-dim);font-size:11px">' + t.note + '</i></span><i>' +
      (t.dir === 'R' ? 'RIGHT' : 'LEFT') + '<br>' + Math.round(t.lap) + 'm</i></div>'
    ).join('');
    courseDrawn = true;
  }

  /* ---------- end verbatim Layer 8b ---------- */

  /* ---------- begin verbatim Layer 9 HUD writer ---------- */

  let cribFaded = false;
  function paintHud(surfOff, next, gap){
    const kph = Math.abs(car.vLong)*3.6;
    const useMph = SESSION.speedUnit === 'mph';
    const speedVal = useMph ? (kph * 0.621371) : kph;
    if (DOM.kph && DOM.kph.firstChild) DOM.kph.firstChild.nodeValue = String(Math.round(speedVal));
    if (DOM.speedUnitLabel) DOM.speedUnitLabel.textContent = useMph ? 'MPH' : 'KM/H';
    const gb = gearFor(kph, CFG.car.gears);
    const rev = clamp01((kph - gb.lo) / Math.max(1, gb.hi - gb.lo));
    if (DOM.revs && DOM.revs.firstElementChild) DOM.revs.firstElementChild.style.width = (18 + rev*82) + '%';
    const fieldSize = Math.max(1, Number(SESSION.fieldSize) || 1);
    const position = Math.max(1, Math.min(fieldSize, Number(SESSION.position) || 1));
    drawDash(kph, speedVal, useMph ? 'MPH' : 'KM/H', gb.g, car.vLong < -0.4 ? 'R' : (kph < 1 ? 'N' : ''), rev, INPUT.throttle, INPUT.brake,
             position, fieldSize,
             (SESSION.ers as number) ?? 1,
             (SESSION.fuelLaps as number) ?? -1,
             (SESSION.temps as { oil:number; water:number }) ?? { oil: 90, water: 85 },
             SESSION.isPractice === true);
    DOM.pedals.children[0].firstElementChild.style.width = (INPUT.throttle*100) + '%';
    DOM.pedals.children[1].firstElementChild.style.width = (INPUT.brake*100) + '%';

    /* RACE-V2 tower: LAP X/TOTAL headline, delta colored green/red. */
    {
      const total = Number(SESSION.raceTotalLaps) || 0;
      DOM.pylonLap.textContent = SESSION.isPractice
        ? `LAP ${Math.max(1, SESSION.lap)} · PRACTICE`
        : (total > 0 ? `LAP ${Math.max(1, SESSION.lap)}/${total}` : `LAP ${Math.max(1, SESSION.lap)}`);
      /* SECTORS: S1/S2/S3 splits row — F1 timing-screen semantics.
         RAW SPLIT TIME is always the primary text (Chris: deltas replaced
         the times, leaving no idea what the split actually was). Color
         carries the verdict vs the fastest-lap reference: purple = session
         best (latched), green = faster, yellow = slower. The DELTA appears
         in the 2.2s flash at the gate, then the raw time holds. Live cell:
         raw elapsed, colored continuously once a reference exists. */
      if (sectorRowEl) {
        const flash = SESSION.sectorFlash as { idx: number; best: boolean; t: number };
        const ref = SESSION.sectorRef as Array<number> | null;
        const cells = [0, 1, 2].map((i) => {
          const split = sectorsState ? sectorsState.splits[i] : null;
          const running = i === Number(SESSION.sectorLiveIdx ?? -1) && SESSION.lap > 0;
          const hasRef = ref && ref[i] != null;
          let cls = '';
          let txt = '—';
          if (running) {
            const d = SESSION.sectorLiveDelta as number | null;
            txt = (Number(SESSION.sectorLiveS ?? 0)).toFixed(2);
            cls = d == null || !hasRef ? 'live' : d <= 0 ? 'ahead' : 'behind';
          } else if (split != null) {
            const isSessionBest = sectorsState?.bests?.[i] != null &&
              Math.abs(split - (sectorsState.bests[i] as number)) < 1e-6;
            txt = split.toFixed(2);
            cls = isSessionBest ? 'best' : hasRef
              ? (split - (ref[i] as number) <= 0 ? 'ahead' : 'behind')
              : 'done';
          }
          /* Gate flash: swap in the delta for the flash window — the
             "how much" moment — then the raw time holds for the lap. */
          if (flash.t > 0 && flash.idx === i && hasRef && split != null) {
            const d = split - (ref[i] as number);
            txt = (d <= 0 ? '−' : '+') + Math.abs(d).toFixed(2);
            if (flash.best) cls = 'best';
          }
          return `<span class="sec ${cls}">S${i + 1} ${txt}</span>`;
        });
        sectorRowEl.innerHTML = cells.join('');
      }
      const dEl = DOM.tDelta;
      if (SESSION.lap > 0 && SESSION.last != null && SESSION.best != null){
        const d = SESSION.last - SESSION.best;
        dEl.textContent = (d <= 0 ? '' : '+') + (d/1000).toFixed(3);
        dEl.parentElement.classList.toggle('down', d <= 0);
        dEl.parentElement.classList.toggle('up', d > 0);
      } else if (SESSION.lap > 0 && SESSION.best == null){
        /* RACE-V4: no reference lap yet — live delta vs sector-ref if any. */
        dEl.textContent = 'flying';
        dEl.parentElement.classList.remove('down','up');
      } else {
        dEl.textContent = SESSION.lap > 0 ? 'flying' : 'out lap';
        dEl.parentElement.classList.remove('down','up');
      }
      /* BOX NOW chip rides in the tower cap. */
      if (boxNowBadge) boxNowBadge.style.display = SESSION.boxNow ? 'inline-block' : 'none';
      /* Live position in the tower cap (the dash carries the big P# too). */
      if (DOM.towerPos) DOM.towerPos.textContent = SESSION.isPractice ? '—' : 'P' + position;
      /* Race delta badges (gap to ahead/behind) sit under the corner card. */
      if (deltaBadge) {
        const da = SESSION.deltaAhead, db = SESSION.deltaBehind;
        const fmt = (g: number | null) => g == null ? '—' : (g >= 0 ? '+' : '') + g.toFixed(1);
        deltaBadge.textContent = `ΔAHEAD ${fmt(da)} · ΔBEHIND ${db == null ? '—' : '-' + db.toFixed(1)}`;
        deltaBadge.style.display = fieldSize > 1 ? 'block' : 'none';
        deltaBadge.style.color = da != null && da < 1 ? '#3DFF8B' : 'rgba(232,226,213,.72)';
      }
    }
    positionBadge.textContent = `P${position} / ${fieldSize}`;
    positionBadge.style.display = 'none';   // position lives on the dash now

    /* RACE-V2: compound ring moved to the tire dock — hide the legacy badge
       entirely; per-corner health, compound and stint live in the dock. */
    tireBadge.style.display = 'none';
    /* RACE-V2: 4-corner tire dock + compound badge + stint age. */
    {
      const tw = (SESSION.tireWear4 as number[] | undefined) ?? [0, 0, 0, 0];
      const cornerIds = ['tireFL', 'tireFR', 'tireRL', 'tireRR'];
      const pctIds = ['tireFLpct', 'tireFRpct', 'tireRLpct', 'tireRRpct'];
      let sum = 0;
      for (let i = 0; i < 4; i++) {
        const healthPct = Math.round((1 - Math.min(1, Math.max(0, tw[i] ?? 0))) * 100);
        sum += healthPct;
        const el = document.getElementById(cornerIds[i]);
        const pct = document.getElementById(pctIds[i]);
        if (!el || !pct) continue;
        pct.textContent = String(healthPct);
        /* F1 color code: green >70%, yellow 40-70%, red <40%. */
        const col = healthPct > 70 ? '#3DFF8B' : healthPct >= 40 ? '#FFB114' : '#FF3B30';
        el.style.borderColor = col;
        el.style.background = col + '22';   // tinted glass fill
        pct.style.color = col;
      }
      const avg = document.getElementById('tireAvg');
      if (avg) {
        const mean = Math.round(sum / 4);
        avg.textContent = mean + '%';
        avg.style.color = mean > 70 ? '#3DFF8B' : mean >= 40 ? '#FFB114' : '#FF3B30';
      }
      const badge = document.getElementById('tireCompound');
      const tt = SESSION.tire as { short?: string; color?: string } | undefined;
      if (badge && tt && tt.short) {
        const name = tt.short === 'S' ? 'SOFT' : tt.short === 'M' ? 'MEDIUM' : 'HARD';
        badge.textContent = `[${tt.short}] ${name}`;
        badge.style.borderColor = tt.color || 'rgba(255,255,255,.12)';
      }
      const stint = document.getElementById('tireStint');
      if (stint) {
        const age = Math.max(0, Number(SESSION.stintLaps) || 0);
        stint.textContent = `${age} ${age === 1 ? 'LAP' : 'LAPS'}`;
      }
    }
    DOM.tCur.textContent  = SESSION.lap > 0 ? fmtTime(SESSION.clock) : '0:00.000';
    DOM.tLast.textContent = fmtTime(SESSION.last);
    DOM.tBest.textContent = fmtTime(SESSION.best);
    if (SESSION.best != null && SESSION.last != null){
      const d = SESSION.last - SESSION.best;
      DOM.tDelta.textContent = (d <= 0 ? '' : '+') + (d/1000).toFixed(3);
      DOM.tDelta.style.color = d <= 0 ? 'var(--flag-green)' : 'var(--brick)';
    } else {
      DOM.tDelta.textContent = SESSION.lap > 0 ? 'flying' : 'out lap';
    }

    if (next){
      DOM.cnNum.firstChild.nodeValue = 'T' + next.n;
      DOM.cnDir.textContent = next.dir === 'L' ? 'LEFT' : 'RIGHT';
      DOM.cnStreet.textContent = next.name;
      DOM.cnDist.textContent = gap < 12 ? 'APEX' : Math.round(gap) + ' m';
    }
    DOM.surface.classList.toggle('on', surfOff);
    if (surfOff) DOM.surface.textContent = car.slipping ? 'OFF COURSE · SLIDING' : 'OFF COURSE';

    if (!cribFaded && SESSION.lap >= 1){ cribFaded = true; DOM.crib.style.opacity = '0.25'; }
  }

  /* ---------- end verbatim Layer 9 HUD writer ---------- */

  /** Draw the course map once, on first open. */
  function ensureCourseMap() { if (!courseDrawn) drawCourseMap(); }

  /* ---- MODERN DASH: MoTeC-style digital multi-function cluster.
     NO analog dial. Layout (940x300 backing, scaled by CSS):
       - Top: RPM shift-light bar, graduated green->amber->red, flashing at limiter.
       - Center: massive gear numeral, "GEAR" label under it.
       - Right of gear: digital speed + unit; P-position; ERS + fuel bars;
         oil/water temps. Pure canvas 2D, one pass/frame. */
  const dashC = DOM.dash ? DOM.dash.getContext('2d') : null;
  /* shift-light flash phase at the limiter */
  let shiftFlashT = 0;
  const SHIFT_SEGMENTS = 15;   // graduated LED segments
  function drawDash(kph:number, speedVal:number, unit:string, gearNum:number,
                    gearOverride:string, rev01:number, thr:number, brk:number,
                    position:number, fieldSize:number, ers:number, fuelLaps:number,
                    temps:{ oil:number; water:number }, hidePosition = false){
    if(!dashC) return;
    const W=940,H=300;
    dashC.clearRect(0,0,W,H);

    /* ---------- RPM shift-light bar (top, full width) ---------- */
    shiftFlashT += 1/60;
    const limitZone = rev01 > 0.94;
    const flashOn = !limitZone || (Math.floor(shiftFlashT * 9) % 2 === 0);
    const segW = (W - 24) / SHIFT_SEGMENTS;
    for(let i=0;i<SHIFT_SEGMENTS;i++){
      const f = i/(SHIFT_SEGMENTS-1);
      const lit = f <= rev01 && flashOn;
      let col:string;
      if(f < 0.5) col = '#3DFF8B';          // green
      else if(f < 0.8) col = '#FFB114';     // amber
      else col = '#FF3B30';                 // red
      dashC.beginPath();
      dashC.roundRect ? dashC.roundRect(12+i*segW, 16, segW-5, 22, 3)
                      : dashC.rect(12+i*segW, 16, segW-5, 22);
      dashC.fillStyle = lit ? col : 'rgba(255,255,255,.07)';
      if(lit && f >= 0.8){ dashC.shadowColor = col; dashC.shadowBlur = 10; }
      dashC.fill();
      dashC.shadowColor = 'transparent'; dashC.shadowBlur = 0;
    }

    /* ---------- gear: massive center numeral ---------- */
    const g = gearOverride || String(gearNum);
    const gcx = 150, gcy = 168;
    dashC.textAlign='center'; dashC.textBaseline='middle';
    dashC.fillStyle = gearOverride==='R' ? '#FF3B30'
      : gearOverride==='N' ? 'rgba(232,226,213,.45)' : '#3DFF8B';
    dashC.font='700 150px ui-monospace,Consolas,monospace';
    if(gearOverride!=='N'){ dashC.shadowColor='rgba(61,255,139,.4)'; dashC.shadowBlur=18; }
    dashC.fillText(g, gcx, gcy);
    dashC.shadowColor='transparent'; dashC.shadowBlur=0;
    dashC.fillStyle='rgba(232,226,213,.5)';
    dashC.font='600 15px ui-monospace,monospace';
    dashC.fillText('G E A R', gcx, gcy+88);

    /* ---------- digital speed (right of gear) ---------- */
    const sx = 285;
    dashC.textAlign='left';
    dashC.fillStyle='#FFFFFF';
    dashC.font='700 84px ui-monospace,Consolas,monospace';
    dashC.fillText(String(Math.round(speedVal)), sx, 120);
    dashC.fillStyle='rgba(232,226,213,.55)';
    dashC.font='600 20px ui-monospace,monospace';
    dashC.fillText(unit, sx+6, 168);

    /* ---------- position (P#, bright green; hidden in practice) ---------- */
    if (!hidePosition) {
      dashC.fillStyle='#3DFF8B';
      dashC.font='800 46px ui-monospace,Consolas,monospace';
      dashC.fillText('P'+position, sx+6, 222);
      dashC.fillStyle='rgba(232,226,213,.45)';
      dashC.font='600 16px ui-monospace,monospace';
      dashC.fillText('/'+fieldSize, sx+118, 232);
    }

    /* ---------- right cluster: ERS, fuel, temps ---------- */
    const rx = 620, rw = 300;
    // ERS / battery bar (cyan)
    dashC.fillStyle='rgba(232,226,213,.45)';
    dashC.font='600 13px ui-monospace,monospace';
    dashC.fillText('ERS', rx, 40);
    dashC.fillStyle='rgba(255,255,255,.1)';
    dashC.fillRect(rx+50, 30, rw-50, 14);
    dashC.fillStyle='#35E0FF';
    dashC.fillRect(rx+50, 30, (rw-50)*Math.min(1,Math.max(0,ers)), 14);
    // Fuel laps (cyan, vertical segmented)
    dashC.fillStyle='rgba(232,226,213,.45)';
    dashC.fillText('FUEL', rx, 76);
    dashC.fillStyle='#35E0FF';
    dashC.font='700 30px ui-monospace,Consolas,monospace';
    dashC.fillText(fuelLaps>=0 ? fuelLaps.toFixed(1) : '—', rx+90, 82);
    dashC.fillStyle='rgba(232,226,213,.45)';
    dashC.font='600 13px ui-monospace,monospace';
    dashC.fillText('LAPS', rx+196, 82);
    // Oil / water temps
    const tempCol = (t:number) => t > 120 ? '#FF3B30' : t < 60 ? '#35E0FF' : '#3DFF8B';
    dashC.fillStyle='rgba(232,226,213,.45)';
    dashC.fillText('OIL', rx, 124);
    dashC.fillStyle=tempCol(temps.oil);
    dashC.font='700 24px ui-monospace,Consolas,monospace';
    dashC.fillText(Math.round(temps.oil)+'°', rx+90, 124);
    dashC.fillStyle='rgba(232,226,213,.45)';
    dashC.font='600 13px ui-monospace,monospace';
    dashC.fillText('H2O', rx, 160);
    dashC.fillStyle=tempCol(temps.water);
    dashC.font='700 24px ui-monospace,Consolas,monospace';
    dashC.fillText(Math.round(temps.water)+'°', rx+90, 160);

    /* ---------- throttle/brake pips (bottom, subtle) ---------- */
    dashC.fillStyle='rgba(255,255,255,.1)';dashC.fillRect(sx, 262, 180, 6);
    dashC.fillStyle='#4FBF67';dashC.fillRect(sx, 262, 180*thr, 6);
    dashC.fillStyle='rgba(255,255,255,.1)';dashC.fillRect(sx, 274, 180, 6);
    dashC.fillStyle='#FF3B30';dashC.fillRect(sx, 274, 180*brk, 6);
  }
  return { drawMinimap, drawCourseMap, ensureCourseMap, paintHud, raceNote };
}

export type Hud = ReturnType<typeof createHud>;
