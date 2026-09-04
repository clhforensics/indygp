import * as THREE from 'three';

type AdaptiveQuality = {
  render: {
    maxPixelRatio: number;
  };
  adaptive: {
    enabled: boolean;
    window: number;
    slowMs: number;
    fastMs: number;
    minScale: number;
    step: number;
  };
};

export function createAdaptiveResolution(
  renderer: THREE.WebGLRenderer,
  quality: AdaptiveQuality
) {
  const basePixelRatio = Math.min(
    window.devicePixelRatio || 1,
    quality.render.maxPixelRatio
  );

  let resolutionScale = 1;
  let frameAccum = 0;
  let frameCount = 0;
  let lastStamp = 0;

  function apply(): void {
    renderer.setPixelRatio(basePixelRatio * resolutionScale);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  function step(): void {
    const adaptive = quality.adaptive;

    if (!adaptive.enabled) {
      return;
    }

    const now =
      typeof performance !== 'undefined'
        ? performance.now()
        : Date.now();

    if (lastStamp === 0) {
      lastStamp = now;
      return;
    }

    const dt = now - lastStamp;
    lastStamp = now;

    /* Ignore hitches: a GC pause or an alt-tab should not drag resolution
       down for the next minute. */
    if (dt > 100) {
      return;
    }

    frameAccum += dt;
    frameCount++;

    if (frameCount < adaptive.window) {
      return;
    }

    const averageFrameMs = frameAccum / frameCount;
    frameAccum = 0;
    frameCount = 0;

    let nextScale = resolutionScale;

    if (
      averageFrameMs > adaptive.slowMs &&
      resolutionScale > adaptive.minScale
    ) {
      nextScale = Math.max(
        adaptive.minScale,
        resolutionScale - adaptive.step
      );
    } else if (
      averageFrameMs < adaptive.fastMs &&
      resolutionScale < 1
    ) {
      nextScale = Math.min(
        1,
        resolutionScale + adaptive.step
      );
    }

    if (nextScale !== resolutionScale) {
      resolutionScale = nextScale;
      apply();
    }
  }

  function getScale(): number {
    return resolutionScale;
  }

  return {
    apply,
    step,
    getScale,
  };
}
