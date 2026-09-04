import { LIGHTING_PROFILE } from '../environment/lightingProfile';

interface LightingDebugDeps {
  getResolutionScale: () => number;
  getCullableCount: () => number;
}

export interface LightingDebug {
  update: () => void;
  dispose: () => void;
}

/**
 * Lightweight opt-in lighting diagnostics.
 *
 * Enable with ?lightingDebug=1. The panel is deliberately dependency-free and
 * is never created during normal gameplay.
 */
export function createLightingDebug(deps: LightingDebugDeps): LightingDebug {
  const enabled = new URLSearchParams(window.location.search).get('lightingDebug') === '1';

  if (!enabled) {
    return {
      update: () => undefined,
      dispose: () => undefined,
    };
  }

  const panel = document.createElement('aside');
  panel.setAttribute('aria-label', 'Lighting diagnostics');
  Object.assign(panel.style, {
    position: 'fixed',
    top: '12px',
    right: '12px',
    zIndex: '9999',
    margin: '0',
    padding: '10px 12px',
    minWidth: '220px',
    border: '1px solid rgba(255,255,255,0.18)',
    borderRadius: '8px',
    background: 'rgba(10,14,18,0.82)',
    color: '#f3f6f8',
    font: '12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    whiteSpace: 'pre',
    pointerEvents: 'none',
    boxShadow: '0 8px 24px rgba(0,0,0,0.24)',
  });

  document.body.appendChild(panel);

  let lastScale = Number.NaN;
  let lastCullables = -1;

  function render(force = false): void {
    const scale = deps.getResolutionScale();
    const cullables = deps.getCullableCount();

    if (!force && scale === lastScale && cullables === lastCullables) return;

    lastScale = scale;
    lastCullables = cullables;

    panel.textContent = [
      'PR2 Lighting Debug',
      `Sun intensity   ${LIGHTING_PROFILE.sun.intensity.toFixed(2)}`,
      `Sun elevation   ${LIGHTING_PROFILE.sun.elevationDeg.toFixed(1)} deg`,
      `Sun azimuth     ${LIGHTING_PROFILE.sun.azimuthDeg.toFixed(1)} deg`,
      `Hemisphere      ${LIGHTING_PROFILE.hemi.intensity.toFixed(2)}`,
      `Bounce          ${LIGHTING_PROFILE.bounce.intensity.toFixed(2)}`,
      `Exposure        ${LIGHTING_PROFILE.tone.exposure.toFixed(2)}`,
      `Shadow span     ${LIGHTING_PROFILE.shadow.span.toFixed(0)}`,
      `Shadow bias     ${LIGHTING_PROFILE.shadow.bias.toFixed(4)}`,
      `Normal bias     ${LIGHTING_PROFILE.shadow.normalBias.toFixed(2)}`,
      `Resolution      ${scale.toFixed(2)}x`,
      `Cullables       ${cullables}`,
    ].join('\n');
  }

  render(true);

  return {
    update: () => render(false),
    dispose: () => panel.remove(),
  };
}
