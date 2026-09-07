/* =============================================================================
   TELEMETRY-V1 — Chris-driven reference laps for AI pace modeling.
   Records player speed vs track position (s) at fixed intervals while a lap
   timer runs, buckets them per ~10 m of centreline, and exports JSON the
   competition layer consumes as a pace baseline.
   Key: T (telemetry export). Status prints in the console + a HUD toast.
   ========================================================================== */

export interface TelemetrySample {
  /** Centreline index (CL.step metres apart). */
  i: number;
  /** Max speed seen in this bucket, m/s. */
  v: number;
}

export interface TelemetryLap {
  lapMs: number;
  buckets: TelemetrySample[];
}

export interface TelemetryExport {
  version: 1;
  team: string;
  lapCount: number;
  /** Speed profile: per-bucket mean of the best laps. */
  profile: TelemetrySample[];
  laps: TelemetryLap[];
}

const BUCKET_BYTES = 10; // metres per bucket
const TOAST_MS = 2600;

export interface TelemetryRecorderDeps {
  /** Centreline step size in metres (CFG.track.sampleStep). */
  step: number;
  /** Total centreline length in metres (CL.length). */
  length: number;
  /** Accessor for the current bucket-relative s, metres from the line. */
  progressS: () => number;
  /** Current long speed, m/s. */
  speed: () => number;
  /** True when the car is off-track (those samples are discarded). */
  offTrack: () => boolean;
  /** Player team id, recorded into the export. */
  team: string;
}

export function createTelemetryRecorder(deps: TelemetryRecorderDeps) {
  const bucketCount = Math.ceil(deps.length / BUCKET_BYTES);
  const sums = new Float64Array(bucketCount);
  const counts = new Float64Array(bucketCount);

  let recording = false;
  let armed = false;
  let lapStartMs = 0;
  const laps: TelemetryLap[] = [];
  let toast: HTMLDivElement | null = null;
  let toastTimer = 0;

  function showToast(msg: string): void {
    if (typeof document === 'undefined') return;
    if (!toast) {
      toast = document.createElement('div');
      toast.style.cssText =
        'position:fixed;left:50%;bottom:88px;transform:translateX(-50%);' +
        'background:rgba(10,12,16,.92);border:1px solid rgba(255,177,20,.5);' +
        'color:#E8E2D5;font:700 11px/1 Consolas,monospace;letter-spacing:.08em;' +
        'padding:9px 14px;border-radius:6px;z-index:60;pointer-events:none;';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.display = 'block';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      if (toast) toast.style.display = 'none';
    }, TOAST_MS);
  }

  /** Per-frame sample, called from the main loop while the session is active. */
  function sample(nowMs: number): void {
    if (!recording) return;
    if (deps.offTrack()) return; // dirty sample, drop
    const s = deps.progressS();
    const idx = Math.min(bucketCount - 1, Math.floor(s / BUCKET_BYTES));
    const v = deps.speed();
    if (v > 0.5) {
      sums[idx] += v;
      counts[idx] += 1;
    }
    void nowMs;
  }

  function beginLap(nowMs: number): void {
    lapStartMs = nowMs;
  }

  /** Called when the player crosses the line forward with a completed lap. */
  function completeLap(lapMs: number): void {
    if (!recording) return;
    const buckets: TelemetrySample[] = [];
    for (let i = 0; i < bucketCount; i++) {
      if (counts[i] > 0) {
        buckets.push({ i, v: sums[i] / counts[i] });
      }
    }
    laps.push({ lapMs, buckets });
    showToast(`TELEMETRY: lap ${laps.length} captured (${(lapMs / 1000).toFixed(2)}s)`);
    sums.fill(0);
    counts.fill(0);
  }

  function buildExport(): TelemetryExport {
    // Mean per bucket across laps (buckets missing in a lap are just absent).
    const acc = new Float64Array(bucketCount);
    const n = new Float64Array(bucketCount);
    for (const lap of laps) {
      for (const b of lap.buckets) {
        acc[b.i] += b.v;
        n[b.i] += 1;
      }
    }
    const profile: TelemetrySample[] = [];
    for (let i = 0; i < bucketCount; i++) {
      if (n[i] > 0) profile.push({ i, v: acc[i] / n[i] });
    }
    return {
      version: 1,
      team: deps.team,
      lapCount: laps.length,
      profile,
      laps: laps.map((l) => ({ lapMs: l.lapMs, buckets: [] })),
    };
  }

  function download(): void {
    const data = buildExport();
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `indygp-telemetry-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast(`TELEMETRY: ${data.lapCount} laps exported -> Downloads`);
  }

  /** Keyboard hook — call from the input layer each frame with the raw key. */
  function key(keyName: string): void {
    const k = keyName.toLowerCase();
    if (k === 't') {
      if (!recording) {
        recording = true;
        armed = true;
        showToast('TELEMETRY: recording — drive clean laps, T again to export');
      } else if (laps.length > 0) {
        download();
        recording = false;
        armed = false;
      } else {
        showToast('TELEMETRY: no complete laps yet — keep driving');
      }
    }
  }

  return {
    sample,
    beginLap,
    completeLap,
    key,
    showToast,
    get active() { return recording; },
    get lapCount() { return laps.length; },
    BUCKET_BYTES,
  };
}
