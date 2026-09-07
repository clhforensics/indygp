/* =============================================================================
   LAYER 8a - AUDIO (v6: single-voice sample engine)
   One loop, one voice. playbackRate maps rev -> pitch continuously, exactly
   like the synth did — the gear-shift path was always clean there. No
   crossfades: crossfading different rev recordings was the "committee of
   engines" that made v5 sound broken.

   The loop is the steadiest 1.6 s slice of the Ferrari F60 warmup
   (F1-band ratio ~20, RMS-stable), cut by /tmp/f60_cut2.py-style analysis.
   ========================================================================== */

const ENGINE_BASE = 'assets/audio/engine/';
const LOOP_FILE = 'f60_micro.wav?v=7';

/* Pitch map: rev 0 -> rate 0.45 (deep), rev 1 -> rate 1.35 (urgent but not
   whiny). Bass/gruffness: a low-shelf boost at 150 Hz plus a soft-clip
   add harmonics below the loop's fundamentals. */
const RATE_MIN = 0.45, RATE_MAX = 1.35;

export function createAudio() {
  const Audio = (() => {
    let ctx: any = null, enabled = true, failed = false;
    let master: any = null;
    let loopSrc: any = null, loopGain: any = null;
    let bassShelf: any = null, gruff: any = null, warmth: any = null;
    let samplesReady = false, samplesFailed = false;

    /* synth underlay: silent unless samples fail (fallback voice) */
    let pulseOsc: any = null, amLFO: any = null, am: any = null, amDepth: any = null;
    let growl: any = null, f1: any = null, f2: any = null, synthBus: any = null;

    function makeShaperCurve(amount: number) {
      const n = 2048, curve = new Float32Array(n);
      const k = amount * 100;
      for (let i = 0; i < n; i++) {
        const x = (i * 2) / n - 1;
        curve[i] = x >= 0
          ? ((1 + k * 1.3) * x) / (1 + k * Math.abs(x))
          : ((1 + k * 0.7) * x) / (1 + k * Math.abs(x));
      }
      return curve;
    }

    function buildSynth(c: any) {
      synthBus = c.createGain();
      synthBus.gain.value = 0;
      synthBus.connect(master);

      growl = c.createWaveShaper();
      growl.curve = makeShaperCurve(0.9);
      growl.oversample = '2x';

      pulseOsc = c.createOscillator();
      pulseOsc.type = 'sawtooth';
      pulseOsc.frequency.value = 250;
      pulseOsc.connect(growl);

      am = c.createGain();
      am.gain.value = 0.55;
      amDepth = c.createGain();
      amDepth.gain.value = 0.45;
      amLFO = c.createOscillator();
      amLFO.type = 'triangle';
      amLFO.frequency.value = 250;
      amLFO.connect(amDepth);
      amDepth.connect(am.gain);
      amLFO.start();

      f1 = c.createBiquadFilter();
      f1.type = 'bandpass'; f1.frequency.value = 420; f1.Q.value = 1.6;
      f2 = c.createBiquadFilter();
      f2.type = 'bandpass'; f2.frequency.value = 1500; f2.Q.value = 2.2;

      growl.connect(am);
      am.connect(f1); am.connect(f2);
      const f1g = c.createGain(); f1g.gain.value = 1.0;
      const f2g = c.createGain(); f2g.gain.value = 0.55;
      f1.connect(f1g); f1g.connect(synthBus);
      f2.connect(f2g); f2g.connect(synthBus);
      pulseOsc.start();
    }

    function start() {
      if (ctx || failed || !enabled) return;
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) { failed = true; console.warn('WebAudio unavailable, running silent'); return; }
      try {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0;
        master.connect(ctx.destination);

        buildSynth(ctx);

        fetch(ENGINE_BASE + LOOP_FILE, { cache: 'no-store' })
          .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
          .then(ab => ctx.decodeAudioData(ab))
          .then(buf => {
            loopSrc = ctx.createBufferSource();
            loopSrc.buffer = buf;
            loopSrc.loop = true;

            /* Gruffness chain: soft-clip adds low-order harmonics (gruff),
               low-shelf boosts the fundamental region (bass), lowpass tames
               the whiny top end. */
            gruff = ctx.createWaveShaper();
            gruff.curve = makeShaperCurve(0.45);
            gruff.oversample = '2x';

            bassShelf = ctx.createBiquadFilter();
            bassShelf.type = 'lowshelf';
            bassShelf.frequency.value = 150;
            bassShelf.gain.value = 9;   // dB boost

            warmth = ctx.createBiquadFilter();
            warmth.type = 'lowpass';
            warmth.frequency.value = 4200;
            warmth.Q.value = 0.5;

            loopGain = ctx.createGain();
            loopGain.gain.value = 0.9;

            loopSrc.connect(gruff);
            gruff.connect(bassShelf);
            bassShelf.connect(warmth);
            warmth.connect(loopGain);
            loopGain.connect(master);
            loopSrc.playbackRate.value = RATE_MIN;
            loopSrc.start();
            samplesReady = true;
          })
          .catch(() => {
            samplesFailed = true;
            console.warn('Engine loop failed to load — synth fallback active');
          });
      } catch (err) {
        failed = true; ctx = null;
        console.warn('Engine audio could not start, running silent:', err);
      }
    }

    function update(rev: number, load: number) {
      if (!ctx || !enabled) return;
      const now = ctx.currentTime;

      if (samplesReady && loopSrc) {
        /* Single continuous pitch path: rev -> rate, exponential in rev so
           low-rev changes are audible and high-rev changes stay smooth. */
        const rate = RATE_MIN * Math.pow(RATE_MAX / RATE_MIN, rev);
        loopSrc.playbackRate.setTargetAtTime(rate, now, 0.045);
        /* Level: rises with revs and throttle load; silent at a complete
           stop (rev floor = 0). kph-derived rev starts at 0.18 in main.ts,
           which reads as a rolling idle — but at zero speed we want silence. */
        const stopped = rev <= 0.001;
        loopGain.gain.setTargetAtTime(stopped ? 0.0 : 0.75 + load * 0.2, now, stopped ? 0.12 : 0.08);
      }

      /* Synth: only speaks as fallback. */
      const firing = 250 + rev * 370;
      pulseOsc.frequency.setTargetAtTime(firing, now, 0.03);
      amLFO.frequency.setTargetAtTime(firing, now, 0.03);
      f1.frequency.setTargetAtTime(400 + rev * 140, now, 0.08);
      f2.frequency.setTargetAtTime(1400 + rev * 500, now, 0.08);
      amDepth.gain.setTargetAtTime(0.38 + load * 0.18, now, 0.07);
      synthBus.gain.setTargetAtTime(samplesFailed ? 0.55 : 0.0, now, 0.2);

      master.gain.setTargetAtTime(0.05 + load * 0.075, now, 0.06);
    }

    return {
      start, update,
      toggle() {
        enabled = !enabled;
        if (!enabled && ctx) master.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        if (enabled) start();
        return enabled;
      },
      suspend() {
        if (ctx && ctx.state === 'running')
          ctx.suspend().catch(e => console.warn('audio suspend:', e));
      },
      resume() { if (ctx && ctx.state === 'suspended') ctx.resume().catch(e => console.warn('audio resume:', e)); }
    };
  })();

  return Audio;
}

export type EngineAudio = ReturnType<typeof createAudio>;
