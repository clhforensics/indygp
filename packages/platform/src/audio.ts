/* =============================================================================
   LAYER 8a - AUDIO
   A two-oscillator engine note. Created only after the user clicks, which is
   what browser autoplay policy requires. Body extracted verbatim.
   ========================================================================== */

export function createAudio() {
  /* ---------- begin verbatim Layer 8a ---------- */

  const Audio = (() => {
    let ctx = null, saw = null, sqr = null, filt = null, gain = null;
    let enabled = true, failed = false;
    function start(){
      if (ctx || failed || !enabled) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC){ failed = true; console.warn('WebAudio unavailable, running silent'); return; }
      try {
        ctx = new AC();
        saw = ctx.createOscillator(); saw.type = 'sawtooth';
        sqr = ctx.createOscillator(); sqr.type = 'square';
        filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.Q.value = 3;
        gain = ctx.createGain(); gain.gain.value = 0;
        saw.connect(filt); sqr.connect(filt); filt.connect(gain); gain.connect(ctx.destination);
        saw.start(); sqr.start();
      } catch (err){
        failed = true; ctx = null;
        console.warn('Engine audio could not start, running silent:', err);
      }
    }
    function update(rev, load){
      if (!ctx || !enabled) return;
      const f = 46 + rev*212;
      const now = ctx.currentTime;
      saw.frequency.setTargetAtTime(f, now, 0.03);
      sqr.frequency.setTargetAtTime(f*1.995, now, 0.03);
      filt.frequency.setTargetAtTime(340 + rev*3400, now, 0.05);
      gain.gain.setTargetAtTime(0.028 + load*0.055, now, 0.06);
    }
    return {
      start, update,
      toggle(){
        enabled = !enabled;
        if (!enabled && ctx) gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        if (enabled) start();
        return enabled;
      },
      suspend(){
        if (ctx && ctx.state === 'running')
          ctx.suspend().catch(e => console.warn('audio suspend:', e));
      },
      resume(){ if (ctx && ctx.state === 'suspended') ctx.resume().catch(e => console.warn('audio resume:', e)); }
    };
  })();

  /* ---------- end verbatim Layer 8a ---------- */

  return Audio;
}

export type EngineAudio = ReturnType<typeof createAudio>;
