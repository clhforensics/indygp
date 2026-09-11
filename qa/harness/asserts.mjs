/* =============================================================================
   GATE ASSERTIONS (QA-AUDIT H-1 remediation, 2026-09-10)
   The definition of "working". Every assertion is a hard pass/fail on the
   race report from harness/sim.mjs. Named SC-xx per the collision v2 plan.

   Pace bands reference the SHIPPED baseline measured 2026-09-10:
     AI-only pro field: steady laps 78.9-80.8 s, normalized spread < 11.5%
   ============================================================================= */

/** median helper (robust to one slow lap) */
function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function aiSteadyLaps(report) {
  return Object.entries(report.steadyLaps)
    .filter(([id]) => id.startsWith('rival-'))
    .map(([, v]) => v)
    .filter((v) => !isNaN(v));
}

export const ASSERTIONS = {
  /** SC-P01: pure AI field holds shipped race pace. */
  'SC-P01 pace-band': (report) => {
    const laps = aiSteadyLaps(report);
    if (laps.length === 0) return { pass: false, detail: 'no AI laps recorded' };
    const lo = Math.min(...laps);
    const hi = Math.max(...laps);
    const ok = lo > 70 && hi < 92;
    return { pass: ok, detail: `steady laps ${lo.toFixed(1)}-${hi.toFixed(1)}s (band 70-92)` };
  },

  /** SC-P01b: normalized spread within the shipped band. */
  'SC-P01b spread': (report) => {
    const laps = aiSteadyLaps(report);
    if (laps.length < 3) return { pass: false, detail: 'fewer than 3 AI laps' };
    const spread = ((Math.max(...laps) - Math.min(...laps)) / Math.min(...laps)) * 100;
    return { pass: spread < 11.5, detail: `spread ${spread.toFixed(1)}% (band <11.5%)` };
  },

  /** SC-C03: matched-speed drafting must never register contact. */
  'SC-C03 draft-no-contact': (report) => {
    return { pass: report.contacts.length === 0, detail: `${report.contacts.length} contacts (want 0)` };
  },

  /** SC-C01: contacts against a blocker are bounded and non-catastrophic. */
  'SC-C01 blocker-contact': (report) => {
    if (report.contacts.length > 12) return { pass: false, detail: `${report.contacts.length} contacts (cap 12)` };
    if (report.maxSeverity > 0.95) return { pass: false, detail: `max severity ${report.maxSeverity.toFixed(2)} (cap 0.95)` };
    return { pass: true, detail: `${report.contacts.length} contacts, max sev ${report.maxSeverity.toFixed(2)}` };
  },

  /** SC-P04: with a profile player in the pack, the field still runs race pace. */
  'SC-P04 player-in-pack pace': (report) => {
    const laps = aiSteadyLaps(report);
    if (laps.length === 0) return { pass: false, detail: 'no AI laps recorded' };
    const lo = Math.min(...laps);
    const hi = Math.max(...laps);
    const ok = lo > 70 && hi < 92;
    return { pass: ok, detail: `AI steady laps ${lo.toFixed(1)}-${hi.toFixed(1)}s with player in pack` };
  },

  /** SC-L01: launch is clean — no contacts in the first 12 s of race time. */
  'SC-L01 clean launch': (report) => {
    const launchContacts = report.contacts.filter((c) => c.t >= 0 && c.t < 12);
    return { pass: launchContacts.length <= 1, detail: `${launchContacts.length} launch contacts (cap 1)` };
  },
};
