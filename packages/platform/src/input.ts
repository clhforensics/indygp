/* =============================================================================
   LAYER 7 - INPUT
   Keyboard, gamepad and touch collapse into one normalised struct.
   Body extracted verbatim from IndyGP_Phase1.html.
   ========================================================================== */

import { clamp, clamp01 } from '@indygp/core';

export interface SessionActions {
  cycleCamera(): void;
  toggleMap(): void;
  rejoin(): void;
  togglePause(): void;
  toggleAudio(): void;
  /** TELEMETRY-V1: raw key name hook for the recorder (T = start/export). */
  telemetryKey?(key: string): void;
}

export interface InputDeps {
  DOM: Record<string, any>;
  /** Late-bound: the session actions are defined after the input system. */
  actions: Partial<SessionActions>;
}

export function createInput(deps: InputDeps) {
  const DOM = deps.DOM;

  // Late-bound trampolines so Layer 7 can reference the session actions by
  // name exactly as it did when everything shared one closure.
  const cycleCamera = () => { if (deps.actions.cycleCamera) deps.actions.cycleCamera(); };
  const toggleMap = () => { if (deps.actions.toggleMap) deps.actions.toggleMap(); };
  const rejoin = () => { if (deps.actions.rejoin) deps.actions.rejoin(); };
  const togglePause = () => { if (deps.actions.togglePause) deps.actions.togglePause(); };
  const Audio = { toggle: () => { if (deps.actions.toggleAudio) deps.actions.toggleAudio(); } };

  /* ---------- begin verbatim Layer 7 ---------- */

  const INPUT = { throttle:0, brake:0, steer:0, handbrake:false };
  const keys = Object.create(null);
  const HELD = { throttle:['w','arrowup'], brake:['s','arrowdown'],
                 left:['a','arrowleft'], right:['d','arrowright'] };
  const any = list => list.some(k => keys[k]);

  const ACTIONS = {
    c: () => cycleCamera(),
    m: () => toggleMap(),
    r: () => rejoin(),
    p: () => togglePause(),
    v: () => Audio.toggle(),
    t: () => { if (deps.actions.telemetryKey) deps.actions.telemetryKey('t'); },
    escape: () => { if (!DOM.mapsheet.classList.contains('hide')) toggleMap(); else togglePause(); }
  };
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'spacebar'){ keys.space = true; e.preventDefault(); return; }
    keys[k] = true;
    if (ACTIONS[k] && !e.repeat){ ACTIONS[k](); e.preventDefault(); }
    if (HELD.throttle.concat(HELD.brake, HELD.left, HELD.right).indexOf(k) >= 0) e.preventDefault();
  });
  window.addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'spacebar') keys.space = false; else keys[k] = false;
  });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  // touch: only mounted when the device actually has a touchscreen
  const TOUCH = { thr:false, brk:false, left:false, right:false };
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0){
    DOM.touch.classList.add('on');
    const bind = (el, prop) => {
      const on  = e => { TOUCH[prop] = true;  el.classList.add('down');    e.preventDefault(); };
      const off = e => { TOUCH[prop] = false; el.classList.remove('down'); e.preventDefault(); };
      el.addEventListener('touchstart', on, { passive:false });
      el.addEventListener('touchend', off);
      el.addEventListener('touchcancel', off);
    };
    bind(DOM.tT,'thr'); bind(DOM.tB,'brk'); bind(DOM.tL,'left'); bind(DOM.tR,'right');
    DOM.startFoot.textContent = 'Use the on-screen pedals, or pair a controller';
  }

  let padWarned = false;
  function readInput(){
    let thr = any(HELD.throttle) ? 1 : 0;
    let brk = any(HELD.brake) ? 1 : 0;
    let str = (any(HELD.right) ? 1 : 0) - (any(HELD.left) ? 1 : 0);
    let hnd = !!keys.space;

    if (TOUCH.thr) thr = 1;
    if (TOUCH.brk) brk = 1;
    if (TOUCH.right) str = 1; else if (TOUCH.left) str = -1;

    if (navigator.getGamepads){
      try {
        const pads = navigator.getGamepads();
        for (let i = 0; i < pads.length; i++){
          const p = pads[i];
          if (!p || !p.connected) continue;
          const ax = p.axes && p.axes.length > 0 ? p.axes[0] : 0;
          if (Math.abs(ax) > 0.14) str = clamp(ax, -1, 1);
          const rt = p.buttons && p.buttons[7] ? p.buttons[7].value : 0;
          const lt = p.buttons && p.buttons[6] ? p.buttons[6].value : 0;
          if (rt > 0.05) thr = Math.max(thr, rt);
          if (lt > 0.05) brk = Math.max(brk, lt);
          if (p.buttons && p.buttons[0] && p.buttons[0].pressed) hnd = true;
          break;
        }
      } catch (err){
        if (!padWarned){ padWarned = true; console.warn('Gamepad polling failed, keyboard still works:', err); }
      }
    }
    INPUT.throttle = clamp01(thr);
    INPUT.brake = clamp01(brk);
    INPUT.steer = clamp(str, -1, 1);
    INPUT.handbrake = hnd;
  }

  /* ---------- end verbatim Layer 7 ---------- */

  return { INPUT, readInput };
}

export type InputSystem = ReturnType<typeof createInput>;
