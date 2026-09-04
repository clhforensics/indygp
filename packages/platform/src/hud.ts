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
    carRoot: {
      position: { x: number; z: number };
      rotation: { y: number };
    };
  }>;
}

export function createHud(deps: HudDeps) {
  const DOM = deps.DOM;
  const CL = deps.CL;
  const locate = deps.locate;
  const TURNS = deps.TURNS;
  const car = deps.car;
  const INPUT = deps.INPUT;
  const SESSION = deps.SESSION;
  const opponents = deps.opponents ?? [];

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

    /* INDYGP-H3-RIVAL-MINIMAP: livery-coded live rival indicators. */
    const rivalColors: Record<string, string> = {
      azure: '#4F9FE8',
      heritage: '#F0ECE3',
      midnight: '#F3C515'
    };
    for (const opponent of opponents){
      const root = opponent.carRoot;
      const q = miniProj.to(root.position.x, root.position.z);
      miniG.save();
      miniG.translate(q[0], q[1]);
      miniG.rotate(-root.rotation.y);
      miniG.fillStyle = rivalColors[opponent.livery] || '#E8E2D5';
      miniG.strokeStyle = 'rgba(11,13,16,.85)';
      miniG.lineWidth = 1.4;
      miniG.beginPath();
      miniG.moveTo(7.5,0); miniG.lineTo(-4.8,4.3); miniG.lineTo(-4.8,-4.3);
      miniG.closePath(); miniG.fill(); miniG.stroke();
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
    DOM.kph.firstChild.nodeValue = String(Math.round(speedVal));
    DOM.speedUnitLabel.textContent = useMph ? 'MPH' : 'KM/H';
    const gb = gearFor(kph, CFG.car.gears);
    DOM.gear.textContent = car.vLong < -0.4 ? 'R' : (kph < 1 ? 'N' : String(gb.g));
    const rev = clamp01((kph - gb.lo) / Math.max(1, gb.hi - gb.lo));
    DOM.revs.firstElementChild.style.width = (18 + rev*82) + '%';
    DOM.pedals.children[0].firstElementChild.style.width = (INPUT.throttle*100) + '%';
    DOM.pedals.children[1].firstElementChild.style.width = (INPUT.brake*100) + '%';

    DOM.pylonLap.textContent = 'L' + Math.max(1, SESSION.lap);
    const fieldSize = Math.max(1, Number(SESSION.fieldSize) || 1);
    const position = Math.max(1, Math.min(fieldSize, Number(SESSION.position) || 1));
    positionBadge.textContent = `P${position} / ${fieldSize}`;
    positionBadge.style.color = position === 1 ? '#FFB114' : 'rgba(232,226,213,.82)';
    positionBadge.style.display = fieldSize > 1 ? 'inline-block' : 'none';
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

  return { drawMinimap, drawCourseMap, ensureCourseMap, paintHud };
}

export type Hud = ReturnType<typeof createHud>;
