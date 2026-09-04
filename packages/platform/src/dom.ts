/* =============================================================================
   LAYER 0 - DOM SHELL AND FATAL ERROR SURFACE
   Extracted verbatim. Every failure path routes here; no silent catch blocks
   anywhere in the codebase.
   ========================================================================== */

/* ---------- begin verbatim Layer 0 ---------- */

export const DOM: Record<string, any> = {};
export function grab() {
  ['gl','hud','boot','bootBar','bootMsg','start','goBtn','startSub','startLede','startFoot',
   'fLen','fCorners','fWidth','fRecord','speedUnitLabel','unitToggle',
   'mapsheet','coursemap','turnlist','mapMeta','minimap','fatal','fatalTitle','fatalBody',
   'kph','gear','revs','pedals','pylonLap','tCur','tLast','tBest','tDelta','cnNum','cnDir','cnStreet',
   'cnDist','surface','crib','touch','tL','tR','tB','tT']
    .forEach(id => { DOM[id] = document.getElementById(id); });
}
export function fatal(title: string, body: string) {
  const b = document.getElementById('boot');            if (b) b.classList.add('hide');
  const s = document.getElementById('start');           if (s) s.classList.add('hide');
  const f = document.getElementById('fatal');
  if (!f) { window.alert(title + '\n\n' + body); return; }
  document.getElementById('fatalTitle').textContent = title;
  document.getElementById('fatalBody').innerHTML = body;
  f.classList.remove('hide');
}
window.addEventListener('error', e => {
  fatal('The circuit hit a wall',
        'Something in the game loop threw an error, so the session stopped.<br><br><code>' +
        String(e.message || e).replace(/</g,'&lt;') +
        '</code><br><br>Reload the page to start a fresh session.');
});

/* ---------- end verbatim Layer 0 ---------- */
