/* =============================================================================
   qa/gate.mjs — THE REGRESSION GATE (QA-AUDIT H-1 remediation)
   Runs every scenario through the harness and evaluates the assertions.
   Non-zero exit on any failure. This must be green before any competition
   change reaches Chris's Safari (the lesson of the collision saga).

   Usage:
     node qa/gate.mjs                 # full gate
     node qa/gate.mjs --report        # also print detailed race reports
   =============================================================================
 */
import { createSimLoader, runScenario } from './harness/sim.mjs';
import { profilePlayer, blockerPlayer, noPlayer } from './harness/player.mjs';
import { ASSERTIONS } from './harness/asserts.mjs';

const verbose = process.argv.includes('--report');

const loader = await createSimLoader();

const SCENARIOS = [
  {
    name: 'SC-P01 pace-band (9 AI, pro, no player)',
    opts: { aiCount: 9, player: noPlayer, laps: 3, difficulty: 'pro', personaMode: 'none', seed: 42 },
    asserts: ['SC-P01 pace-band', 'SC-P01b spread', 'SC-L01 clean launch'],
  },
  {
    name: 'SC-C03 draft-no-contact (profile ghost vs identical ghost)',
    opts: { aiCount: 1, player: profilePlayer({ paceMul: 1.0 }), laps: 2, difficulty: 'pro', personaMode: 'none', seed: 7 },
    asserts: ['SC-C03 draft-no-contact'],
  },
  {
    name: 'SC-C01 blocker-contact (75% blocker in pack)',
    opts: { aiCount: 4, player: blockerPlayer({ paceMul: 0.75 }), laps: 2, difficulty: 'pro', personaMode: 'none', seed: 11 },
    asserts: ['SC-C01 blocker-contact', 'SC-P01 pace-band'],
  },
  {
    name: 'SC-P04 player-in-pack (profile player + 9 AI, pro)',
    opts: { aiCount: 9, player: profilePlayer({ paceMul: 1.03 }), laps: 2, difficulty: 'pro', personaMode: 'none', seed: 42 },
    asserts: ['SC-P04 player-in-pack pace', 'SC-L01 clean launch'],
  },
  {
    name: 'SC-P04n novice variant (Chris QA config)',
    opts: { aiCount: 9, player: profilePlayer({ paceMul: 1.0 }), laps: 2, difficulty: 'novice', personaMode: 'random', seed: 99 },
    asserts: ['SC-P04 player-in-pack pace'],
  },
];

let pass = 0;
let fail = 0;
const failures = [];

for (const sc of SCENARIOS) {
  process.stdout.write(`\n=== ${sc.name} ===\n`);
  let report;
  try {
    report = await runScenario(loader, { ...sc.opts, name: sc.name });
  } catch (err) {
    fail++;
    failures.push(`${sc.name}: harness threw — ${err.message}`);
    console.log(`  FAIL  harness threw: ${err.message}`);
    continue;
  }

  for (const assertName of sc.asserts) {
    const fn = ASSERTIONS[assertName];
    if (!fn) {
      fail++;
      failures.push(`${sc.name}: unknown assertion '${assertName}'`);
      console.log(`  FAIL  unknown assertion '${assertName}'`);
      continue;
    }
    const result = fn(report);
    if (result.pass) {
      pass++;
      console.log(`  PASS  ${assertName}  — ${result.detail}`);
    } else {
      fail++;
      failures.push(`${sc.name} / ${assertName}: ${result.detail}`);
      console.log(`  FAIL  ${assertName}  — ${result.detail}`);
    }
  }

  if (verbose) {
    console.log('  report:', JSON.stringify({
      steadyLaps: report.steadyLaps,
      contacts: report.contacts.length,
      maxSeverity: +report.maxSeverity.toFixed(2),
    }, null, 1));
  }
}

console.log(`\n=== GATE: ${pass} passed, ${fail} failed ===`);
if (fail > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log('  - ' + f);
  console.log('\nDo NOT commit a build that fails the gate. Fix or explicitly waive with a comment.');
}
process.exit(fail > 0 ? 1 : 0);
