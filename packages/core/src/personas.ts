/* =============================================================================
   PERSONAS — Chris-locked spec (2026-09-07). 12 driver personas, each a set
   of deltas layered over the base DriverProfile in createCompetition.ts.
   Assignment: random per driver per race (default), or forced via
   ?personas=random|none|<persona-id>. brakeBias is the brake-point trait:
   negative = brakes later (divebombs), positive = brakes earlier (smooth).
   tireCare/defense are dormant hooks for M2 tires and M3 defense.
   ========================================================================== */

export interface PersonaSpec {
  id: string;
  name: string;
  /** Short classification tag (3-4 chars). */
  tag: string;
  /** Multiplicative deltas over the base driver profile. */
  pace?: number;
  cornerSkill?: number;
  /** Multiplier on the profile's consistency (error magnitude). */
  consistencyMul?: number;
  overtake?: number;
  traction?: number;
  exitAttack?: number;
  launch?: number;
  /** Additive lane bias (metres from centreline). */
  lineBias?: number;
  /** Brake-point bias: -1 = very late, +1 = very early. */
  brakeBias?: number;
  /** Per-corner-entry mistake probability (0 = metronome). */
  mistake?: number;
  /** Tire-wear multiplier (M2 hook). */
  tireCare?: number;
  /** Defense weight (M3 step-4 hook). */
  defense?: number;
}

export const PERSONAS: PersonaSpec[] = [
  {
    id: 'wall-scaler', name: 'Wall Scalper', tag: 'WLS',
    cornerSkill: 1.045, lineBias: -0.55, brakeBias: -0.1,
    consistencyMul: 1.15, tireCare: 1.12,
  },
  {
    id: 'late-brake-assassin', name: 'Late-Brake Assassin', tag: 'LBA',
    brakeBias: -0.85, overtake: 1.22, cornerSkill: 1.01,
    mistake: 0.16, traction: 0.96,
  },
  {
    id: 'telemetry-surgeon', name: 'Telemetry Surgeon', tag: 'SUR',
    brakeBias: 0.55, cornerSkill: 1.02, exitAttack: 1.05,
    consistencyMul: 0.72, overtake: 0.9, mistake: 0.02, tireCare: 0.92,
  },
  {
    id: 'redline-brawler', name: 'Redline Brawler', tag: 'BWL',
    overtake: 1.1, defense: 1.5, consistencyMul: 1.3,
    brakeBias: -0.2, mistake: 0.1,
  },
  {
    id: 'rubber-whisperer', name: 'Rubber Whisperer', tag: 'RUB',
    tireCare: 0.7, brakeBias: 0.35, cornerSkill: 0.995,
    consistencyMul: 0.85, exitAttack: 1.02, mistake: 0.03,
  },
  {
    id: 'slipstream-stalker', name: 'Slipstream Stalker', tag: 'SLP',
    overtake: 1.15, pace: 0.995, brakeBias: 0.1,
    consistencyMul: 0.9, mistake: 0.04,
  },
  {
    id: 'torrent-prodigy', name: 'Torrent Prodigy', tag: 'TOR',
    /* Wet-weather master — dormant until weather exists; mild neutral deltas. */
    cornerSkill: 1.01, brakeBias: 0.2, consistencyMul: 0.95, mistake: 0.05,
  },
  {
    id: 'quali-gunner', name: 'Quali Gunner', tag: 'QLG',
    pace: 1.025, cornerSkill: 1.02, tireCare: 1.35,
    consistencyMul: 1.25, brakeBias: -0.15, mistake: 0.09,
  },
  {
    id: 'apex-cannibal', name: 'Apex Cannibal', tag: 'APX',
    cornerSkill: 1.03, lineBias: -0.3, traction: 1.02,
    brakeBias: -0.05, mistake: 0.08, tireCare: 1.08,
  },
  {
    id: 'ghost', name: 'Ghost', tag: 'GHO',
    cornerSkill: 1.02, lineBias: -0.15, traction: 0.93,
    exitAttack: 1.06, consistencyMul: 1.45, brakeBias: -0.25, mistake: 0.14,
  },
  {
    id: 'energy-tactician', name: 'Energy Tactician', tag: 'ENT',
    brakeBias: 0.4, exitAttack: 1.04, tireCare: 0.85,
    consistencyMul: 0.88, overtake: 0.95, mistake: 0.03,
  },
  {
    id: 'iron-sentinel', name: 'Iron Sentinel', tag: 'IRS',
    defense: 1.8, consistencyMul: 0.55, mistake: 0.0,
    brakeBias: 0.1, overtake: 0.85, cornerSkill: 0.99,
  },
];

export function getPersona(id: string | null | undefined): PersonaSpec | null {
  if (!id) return null;
  return PERSONAS.find((p) => p.id === id) ?? null;
}

export interface PersonaAssignmentMode {
  mode: 'random' | 'none' | 'single';
  persona: PersonaSpec | null;
}

export function parsePersonaParam(raw: string | null): PersonaAssignmentMode {
  const value = (raw ?? 'random').trim().toLowerCase();
  if (value === '' || value === 'random') return { mode: 'random', persona: null };
  if (value === 'none' || value === 'off') return { mode: 'none', persona: null };
  const persona = getPersona(value);
  if (persona) return { mode: 'single', persona };
  return { mode: 'random', persona: null };
}

/** Random per-driver assignment, no two adjacent cars share a persona. */
export function assignPersonasRandom(count: number, rngNext?: () => number): PersonaSpec[] {
  /* QA-AUDIT M-3: optional seeded rng — the harness passes one so persona
     assignment is reproducible; the game falls back to Math.random. */
  const rand = rngNext ?? Math.random;
  const out: PersonaSpec[] = [];
  let previous: PersonaSpec | null = null;
  for (let i = 0; i < count; i++) {
    let pick = PERSONAS[Math.floor(rand() * PERSONAS.length)];
    let guard = 0;
    while (previous && pick.id === previous.id && guard++ < 8) {
      pick = PERSONAS[Math.floor(rand() * PERSONAS.length)];
    }
    out.push(pick);
    previous = pick;
  }
  return out;
}
