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
    drawDash(kph, speedVal, useMph ? 'MPH' : 'KM/H', gb.g, car.vLong < -0.4 ? 'R' : (kph < 1 ? 'N' : ''), rev, INPUT.throttle, INPUT.brake);
    DOM.pedals.children[0].firstElementChild.style.width = (INPUT.throttle*100) + '%';
    DOM.pedals.children[1].firstElementChild.style.width = (INPUT.brake*100) + '%';

    DOM.pylonLap.textContent = 'L' + Math.max(1, SESSION.lap);
    const fieldSize = Math.max(1, Number(SESSION.fieldSize) || 1);
    const position = Math.max(1, Math.min(fieldSize, Number(SESSION.position) || 1));
    positionBadge.textContent = `P${position} / ${fieldSize}`;
    positionBadge.style.color = position === 1 ? '#FFB114' : 'rgba(232,226,213,.82)';
    positionBadge.style.display = fieldSize > 1 ? 'inline-block' : 'none';

    /* M2-TIRES: compound ring + wear bar (SESSION.tire fed from main). */
    {
      const t = SESSION.tire as { short?: string; color?: string; wear?: number } | undefined;
      if (t && t.short) {
        tireBadge.style.display = 'inline-block';
        tireRing.style.borderColor = t.color || '#e8e8e8';
        tireRing.style.background = 'transparent';
        const wear = Math.max(0, Math.min(1, t.wear ?? 0));
        tireWearFill.style.width = (wear * 100).toFixed(1) + '%';
        tireWearFill.style.background = wear < 0.5 ? '#3fca5a'
          : wear < 0.8 ? '#f0c33c' : '#e3352b';
      } else {
        tireBadge.style.display = 'none';
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

  /* ---- MODERN DASH: round tachometer w/ needle, redline arc, digital
     speed, gear pill, throttle/brake pips. Pure canvas 2D, one pass/frame. */
  const dashC = DOM.dash ? DOM.dash.getContext('2d') : null;
  let dashSmooth = 0;   // needle inertia so it sweeps like a real tach
  function drawDash(kph:number, speedVal:number, unit:string, gearNum:number,
                    gearOverride:string, rev01:number, thr:number, brk:number){
    if(!dashC) return;
    const W=290,H=150,cx=118,cy=84,R=62;
    dashC.clearRect(0,0,W,H);
    // Bezel: dark dial with subtle ring.
    dashC.beginPath();dashC.arc(cx,cy,R+14,0,Math.PI*2);
    const bezel=dashC.createRadialGradient(cx,cy-R*.4,6,cx,cy,R+14);
    bezel.addColorStop(0,'#1B2027');bezel.addColorStop(1,'#0C0F13');
    dashC.fillStyle=bezel;dashC.fill();
    dashC.lineWidth=1;dashC.strokeStyle='rgba(232,226,213,.18)';dashC.stroke();
    // Sweep: 220 deg, from 160 deg to 20 deg (deg, 0 = +x, CCW negative).
    const A0=Math.PI*1.11, A1=-Math.PI*0.11;
    // Redline zone (last 18% of the sweep).
    dashC.beginPath();dashC.arc(cx,cy,R,A0+(A1-A0)*0.82,A1);
    dashC.lineWidth=9;dashC.strokeStyle='rgba(158,59,42,.9)';dashC.stroke();
    // Active rev arc: amber, red as it nears the limit.
    const a=A0+(A1-A0)*rev01;
    dashC.beginPath();dashC.arc(cx,cy,R,A0,a);
    dashC.lineWidth=9;dashC.lineCap='round';
    dashC.strokeStyle=rev01>0.82?'#E85B3F':'#FFB114';dashC.stroke();
    // Ticks + numerals x1000 (0..9).
    for(let i=0;i<=9;i++){
      const t=A0+(A1-A0)*(i/9),c=Math.cos(t),s=Math.sin(t);
      dashC.beginPath();
      dashC.moveTo(cx+c*(R-16),cy+s*(R-16));dashC.lineTo(cx+c*(R-9),cy+s*(R-9));
      dashC.lineWidth=i>=8?2.5:1.4;dashC.strokeStyle=i>=8?'#E85B3F':'rgba(232,226,213,.7)';dashC.stroke();
      dashC.fillStyle=i>=8?'#E85B3F':'rgba(232,226,213,.85)';
      dashC.font='600 11px ui-monospace,Consolas,monospace';
      dashC.textAlign='center';dashC.textBaseline='middle';
      dashC.fillText(String(i),cx+c*(R-26),cy+s*(R-26));
    }
    // Needle with inertia.
    dashSmooth += (rev01-dashSmooth)*0.35;
    const na=A0+(A1-A0)*dashSmooth;
    dashC.beginPath();dashC.moveTo(cx-Math.cos(na)*10,cy-Math.sin(na)*10);
    dashC.lineTo(cx+Math.cos(na)*(R-18),cy+Math.sin(na)*(R-18));
    dashC.lineWidth=3;dashC.lineCap='round';
    dashC.shadowColor='rgba(0,0,0,.55)';dashC.shadowBlur=4;dashC.shadowOffsetY=1;
    dashC.strokeStyle='#E8E2D5';dashC.stroke();
    dashC.shadowColor='transparent';dashC.shadowBlur=0;dashC.shadowOffsetY=0;
    dashC.beginPath();dashC.arc(cx,cy,5,0,Math.PI*2);dashC.fillStyle='#E8E2D5';dashC.fill();
    // Hub brand.
    dashC.fillStyle='rgba(141,137,127,.9)';
    dashC.font='600 8px ui-monospace,monospace';dashC.textAlign='center';
    dashC.fillText('RPM x1000',cx,cy-24);
    // Digital speed inside the dial.
    dashC.fillStyle='#E8E2D5';dashC.font='700 30px ui-monospace,Consolas,monospace';
    dashC.fillText(String(Math.round(speedVal)),cx,cy+16);
    dashC.fillStyle='rgba(141,137,127,.95)';dashC.font='600 9px Arial Narrow,Arial,sans-serif';
    dashC.fillText(unit,cx,cy+34);
    // Gear pill to the right.
    const g=gearOverride||String(gearNum);
    const gx=224,gy=74;
    dashC.beginPath();
    (dashC as any).roundRect?dashC.roundRect(gx,gy-34,46,68,12):dashC.rect(gx,gy-34,46,68);
    dashC.fillStyle='#14181E';dashC.fill();
    dashC.lineWidth=1;
    dashC.strokeStyle=gearOverride==='R'?'rgba(158,59,42,.9)':gearOverride==='N'?'rgba(232,226,213,.25)':'rgba(255,177,20,.55)';dashC.stroke();
    dashC.fillStyle=gearOverride==='N'?'rgba(141,137,127,.9)':'#FFB114';
    dashC.font='700 40px Arial Narrow,Arial,sans-serif';dashC.textAlign='center';dashC.textBaseline='middle';
    dashC.fillText(g,gx+23,gy+2);
    // Throttle/brake pips under the gear pill.
    dashC.fillStyle='rgba(232,226,213,.12)';dashC.fillRect(gx+4,gy+44,38,5);
    dashC.fillStyle='#4FBF67';dashC.fillRect(gx+4,gy+44,38*thr,5);
    dashC.fillStyle='rgba(232,226,213,.12)';dashC.fillRect(gx+4,gy+53,38,5);
    dashC.fillStyle='#9E3B2A';dashC.fillRect(gx+4,gy+53,38*brk,5);
  }
  return { drawMinimap, drawCourseMap, ensureCourseMap, paintHud };
}

export type Hud = ReturnType<typeof createHud>;
