/* =============================================================================
   MENU — title screen + main menu (IMAGINE RACING INDY GP)
   Flow: title.jpg "PRESS [START]" -> mainmenu.jpg with clickable items.
   Mode selection reloads with ?race=full|half|sprint (or none = practice).
   Settings changes persist via localStorage and rebuild the query string.
   ========================================================================== */

const MENU_IMG_VER = 1;              // bump to bust Safari-cached menu art
const SETTINGS_KEY = 'indygp.menuSettings';

export interface MenuSettings {
  opponents: number;      // 0..9
  difficulty: string;     // novice|pro|elite
  team: string;
  tyre: string;           // soft|medium|hard
  speedUnit: 'kph' | 'mph';
  audio: boolean;
}

const SETTINGS_DEFAULTS: MenuSettings = {
  opponents: 9,
  difficulty: 'pro',
  team: '',
  tyre: 'soft',
  speedUnit: 'kph',
  audio: true,
};

function loadSettings(): MenuSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...SETTINGS_DEFAULTS, ...JSON.parse(raw) };
  } catch { /* fall through to defaults */ }
  return { ...SETTINGS_DEFAULTS };
}

function saveSettings(s: MenuSettings) {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

/* Build the launch query from stored settings + chosen race mode. */
export function launchParams(mode: string | null, s: MenuSettings): string {
  const p = new URLSearchParams();
  if (mode) p.set('race', mode);
  if (s.opponents !== SETTINGS_DEFAULTS.opponents) p.set('opponents', String(s.opponents));
  if (s.difficulty !== 'pro') p.set('difficulty', s.difficulty);
  if (s.team) p.set('team', s.team);
  if (s.tyre !== 'soft') p.set('tyre', s.tyre);
  const q = p.toString();
  return q ? `?${q}` : '';
}

/* Parse any session-override params that the app was already launched with
   (?race= from the mode menu). Those win over stored settings. */
export function modeFromURL(): string | null {
  const r = new URLSearchParams(window.location.search).get('race');
  return r ? r.trim().toLowerCase() : null;
}

/* ---------- DOM construction ------------------------------------------------ */

export interface MenuHandles {
  root: HTMLDivElement;
  /** Hide the menu system entirely (game session started). */
  hide(): void;
  /** Show the main menu (used by pause -> Main Menu). */
  showMain(): void;
  /** True once the player has fired a session from the menu. */
  launched: boolean;
}

export function createMenu(opts: {
  onLaunch: (params: string) => void;
}): MenuHandles {
  const settings = loadSettings();
  const root = document.createElement('div');
  root.id = 'menu';
  document.body.appendChild(root);

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  let launched = false;

  /* ---- Title screen ------------------------------------------------------ */
  function showTitle() {
    root.innerHTML = `
      <div class="menu-screen" style="background-image:url('./assets/menu/title.jpg?v=${MENU_IMG_VER}')">
        <button class="title-catch" id="menuStart" aria-label="Start"></button>
      </div>`;
    document.getElementById('menuStart')?.addEventListener('click', showMain);
    // Any key also starts.
    const onKey = (e: KeyboardEvent) => {
      if (root.dataset.screen !== 'title') return;
      if (['Enter', 'Space', 'KeyS'].includes(e.code) || e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        showMain();
      }
    };
    window.addEventListener('keydown', onKey, true);
    root.dataset.screen = 'title';
  }

  /* ---- Main menu --------------------------------------------------------- */
  /* The background art already paints the six buttons. We overlay invisible
     hit-zones at the painted positions (% of the 16:9 art) that glow gold
     on hover/selection. Stage is a fixed 16:9 box so % maps to the art
     exactly at any window size (cover + centered). */
  function showMain() {
    root.dataset.screen = 'main';
    const zones = [
      { action: 'practice', label: 'Practice', top: 36.4 },
      { action: 'full',     label: 'Full Race', top: 46.2 },
      { action: 'half',     label: 'Half Race', top: 55.9 },
      { action: 'sprint',   label: 'Sprint', top: 65.7 },
      { action: 'settings', label: 'Settings', top: 75.5 },
      { action: 'exit',     label: 'Exit', top: 85.3 },
    ];
    root.innerHTML = `
      <div class="menu-stage">
        <div class="menu-screen" style="background-image:url('./assets/menu/mainmenu.jpg?v=${MENU_IMG_VER}')">
          <nav class="menu-list">
            ${zones.map(z => `
              <button class="menu-item" data-action="${z.action}" aria-label="${z.label}"
                      style="top:${z.top}%"></button>`).join('')}
          </nav>
        </div>
      </div>`;
    const items = Array.from(root.querySelectorAll<HTMLButtonElement>('.menu-item'));
    let idx = 0;
    items[0].classList.add('sel');
    root.querySelector('.menu-list')?.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest('.menu-item') as HTMLElement | null;
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'settings') { showSettings(); return; }
      if (action === 'exit') { showExit(); return; }
      launched = true;
      // Practice = no race param (default session). Races set ?race=.
      opts.onLaunch(launchParams(action === 'practice' ? null : action, settings));
    });
    // Arrow-key navigation between items.
    const onKey = (e: KeyboardEvent) => {
      if (root.dataset.screen !== 'main') return;
      if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        e.preventDefault();
        items[idx].classList.remove('sel');
        idx = (idx + (e.code === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        items[idx].classList.add('sel');
      } else if (e.code === 'Enter') {
        e.preventDefault();
        items[idx].click();
      }
    };
    window.addEventListener('keydown', onKey, true);
  }

  /* ---- Settings ---------------------------------------------------------- */
  function showSettings() {
    root.dataset.screen = 'settings';
    const rows: Array<[keyof MenuSettings, string, string[] | null]> = [
      ['opponents', 'Opponents', ['0', '3', '6', '9']],
      ['difficulty', 'AI difficulty', ['novice', 'pro', 'elite']],
      ['tyre', 'Starting tyre', ['soft', 'medium', 'hard']],
      ['speedUnit', 'Speed unit', ['kph', 'mph']],
      ['audio', 'Engine audio', ['on', 'off']],
    ];
    root.innerHTML = `
      <div class="menu-screen settings-bg">
        <div class="settings-panel">
          <h2>SETTINGS</h2>
          ${rows.map(([key, label, choices]) => `
            <div class="set-row" data-key="${key}">
              <span class="set-label">${label}</span>
              <span class="set-choices">
                ${(choices ?? []).map(c => `
                  <button class="chip" data-key="${key}" data-val="${c}">${c.toUpperCase()}</button>`).join('')}
              </span>
            </div>`).join('')}
          <div class="set-row">
            <span class="set-label">Team</span>
            <button class="chip team-note" id="teamCycle">${settings.team || 'default'}</button>
          </div>
          <div class="settings-actions">
            <button class="menu-item back" data-action="back">Back</button>
          </div>
        </div>
      </div>`;
    paintChips();

    root.addEventListener('click', settingsClick);
    function settingsClick(ev: MouseEvent) {
      const t = ev.target as HTMLElement;
      if (t.dataset.action === 'back') {
        root.removeEventListener('click', settingsClick);
        saveSettings(settings);
        showMain();
        return;
      }
      const chip = t.closest('.chip') as HTMLElement | null;
      if (!chip) return;
      const key = chip.dataset.key as keyof MenuSettings;
      const val = chip.dataset.val;
      if (key === 'opponents') settings.opponents = Number(val);
      else if (key === 'audio') settings.audio = val === 'on';
      else if (key === 'speedUnit') settings.speedUnit = val as 'kph' | 'mph';
      else (settings as any)[key] = val;
      saveSettings(settings);
      paintChips();
    }
    function paintChips() {
      for (const chip of Array.from(root.querySelectorAll<HTMLButtonElement>('.chip[data-key]'))) {
        const key = chip.dataset.key;
        const val = chip.dataset.val;
        const cur = key === 'opponents' ? String(settings.opponents)
          : key === 'audio' ? (settings.audio ? 'on' : 'off')
          : String((settings as any)[key]);
        chip.classList.toggle('on', cur === val);
      }
    }
  }

  /* ---- Exit -------------------------------------------------------------- */
  function showExit() {
    root.dataset.screen = 'exit';
    root.innerHTML = `
      <div class="menu-screen exit-bg">
        <div class="settings-panel">
          <h2>SEE YOU AT THE TRACK</h2>
          <p class="exit-note">The garage door is closed.</p>
          <div class="settings-actions">
            <button class="menu-item back" data-action="back">Back to menu</button>
          </div>
        </div>
      </div>`;
    root.querySelector('[data-action="back"]')?.addEventListener('click', showMain);
  }

  showTitle();

  return {
    root,
    get launched() { return launched; },
    hide() { root.classList.add('hide'); },
    showMain,
  };
}

/* ---------- styles ----------------------------------------------------------- */
const CSS = `
#menu{position:fixed;inset:0;z-index:60;background:#000;}
#menu.hide{display:none;}
/* Fixed 16:9 stage so percentage hit-zones always align with the painted art. */
#menu .menu-stage{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  background:#000;}
/* True 16:9 stage regardless of window shape, so % hit-zones track the art. */
#menu .menu-screen{position:relative;width:min(100%, 177.78vh);height:min(100vh, 56.25vw);
  background-size:100% 100%;background-position:center;font-family:var(--ui,-apple-system,sans-serif);}
#menu .title-catch{position:absolute;inset:0;background:transparent;border:0;cursor:pointer;}
#menu .menu-list{position:absolute;inset:0;}
#menu .menu-item{position:absolute;left:7.8%;width:21%;height:6.8%;transform:translateY(-50%);
  background:transparent;border:2px solid transparent;border-radius:10px;cursor:pointer;
  transition:border-color .1s ease, box-shadow .1s ease;}
#menu .menu-item:hover,#menu .menu-item.sel{border-color:rgba(255,215,94,.9);
  box-shadow:0 0 22px rgba(255,215,94,.35), inset 0 0 18px rgba(255,215,94,.12);}
#menu .settings-bg,#menu .exit-bg{display:flex;align-items:center;justify-content:center;
  background:linear-gradient(rgba(5,7,10,.82),rgba(5,7,10,.82)),url('./assets/menu/mainmenu.jpg') center/cover;}
#menu .settings-panel{width:clamp(340px,44vw,560px);background:rgba(15,18,24,.92);border:1px solid rgba(255,255,255,.14);
  border-radius:14px;padding:26px 30px;color:#e8ecf4;box-shadow:0 10px 40px rgba(0,0,0,.6);}
#menu .settings-panel h2{margin:0 0 18px;letter-spacing:.2em;font-size:20px;color:#ffd75e;}
#menu .set-row{display:flex;justify-content:space-between;align-items:center;padding:9px 0;
  border-bottom:1px solid rgba(255,255,255,.07);}
#menu .set-label{font-weight:700;font-size:14px;letter-spacing:.05em;}
#menu .set-choices{display:flex;gap:8px;}
#menu .chip{padding:6px 12px;font-size:12px;font-weight:700;letter-spacing:.06em;color:#cfd6e4;
  background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.2);border-radius:7px;cursor:pointer;}
#menu .chip:hover{border-color:#ffd75e;}
#menu .chip.on{background:#ffd75e;color:#141821;border-color:#ffd75e;}
#menu .settings-actions{margin-top:20px;display:flex;justify-content:flex-end;}
#menu .menu-item.back{width:auto;position:static;transform:none;height:auto;padding:10px 28px;
  font-size:14px;color:#e8ecf4;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.25);}
#menu .exit-note{color:#9aa3b5;font-size:14px;}
#menu .team-note{text-transform:uppercase;}
`;
