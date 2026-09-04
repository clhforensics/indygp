export interface RaceStartSequence {
  readonly holding: boolean;
  start(): void;
  update(dt: number): void;
}

export function createRaceStartSequence(): RaceStartSequence {
  const overlay = document.createElement('div');
  overlay.setAttribute('aria-live', 'assertive');
  overlay.setAttribute('aria-atomic', 'true');
  overlay.setAttribute('role', 'status');

  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    zIndex: '9999',
    fontFamily: 'system-ui, sans-serif',
    fontSize: 'clamp(5rem, 16vw, 11rem)',
    fontWeight: '900',
    letterSpacing: '0.04em',
    color: '#ffffff',
    textShadow: '0 0 18px rgba(0,0,0,0.85), 0 4px 0 rgba(0,0,0,0.55)',
  });

  document.body.appendChild(overlay);

  let phase: 'idle' | 'countdown' | 'go' = 'idle';
  let elapsed = 0;
  let shown = '';

  const show = (text: string): void => {
    if (shown !== text) {
      shown = text;
      overlay.textContent = text;
    }
    overlay.style.display = 'flex';
  };

  const hide = (): void => {
    overlay.style.display = 'none';
    shown = '';
  };

  const start = (): void => {
    phase = 'countdown';
    elapsed = 0;
    show('3');
  };

  const update = (dt: number): void => {
    if (phase === 'idle') return;

    elapsed += Math.max(0, dt);

    if (phase === 'countdown') {
      if (elapsed < 1) {
        show('3');
      } else if (elapsed < 2) {
        show('2');
      } else if (elapsed < 3) {
        show('1');
      } else {
        phase = 'go';
        elapsed = 0;
        show('GO');
      }
      return;
    }

    if (phase === 'go' && elapsed >= 0.8) {
      phase = 'idle';
      hide();
    }
  };

  return {
    get holding() {
      return phase === 'countdown';
    },
    start,
    update,
  };
}
