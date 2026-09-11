# IndyGP QA Harness & Gate

The regression contract for competition code. **No change to AI/collision/
pace behavior ships without a green gate.** (QA-AUDIT H-1, 2026-09-10.)

## Run it

```bash
node qa/gate.mjs            # full gate — exit 0 = green
node qa/gate.mjs --report   # + detailed race reports
```

A git `pre-commit` hook runs it automatically; bypass with `--no-verify`
(sparingly, and say why in the commit message).

## What it runs

Each scenario loads the REAL modules (`ssrLoadModule`) and drives the REAL
`createCompetition.step()` with a scripted player model. Fixed seed →
byte-identical runs (two consecutive runs of the gate produce identical
output; if they don't, determinism broke — fix that first).

| Scenario | What it proves |
|---|---|
| SC-P01 pace-band | 9 AI, pro: steady laps 70–92 s, spread < 11.5% |
| SC-C03 draft-no-contact | matched-speed drafting = zero contacts |
| SC-C01 blocker-contact | 75%-pace blocker: bounded, non-catastrophic contact |
| SC-P04 player-in-pack | profile player + 9 AI: field holds pace |
| SC-P04n novice | same at novice + random personas (Chris's QA config) |
| SC-L01 clean launch | ≤1 contact in the first 12 s after green |

## Player models (`player.mjs`)

- `profilePlayer({ paceMul })` — follows the reference speed profile at
  `paceMul` (1.0 = Chris's laps). **Use this, not a lane-0 robot** — the
  robot caused three rounds of false "verified" states.
- `blockerPlayer({ paceMul })` — slow car ON the racing line (honest
  slower-car-ahead tests).
- `stationaryPlayer({ atProgress })` — roadblock (filing-around tests).
- `weaverPlayer({ amp, periodS })` — lane wobble (contact-geometry stressor).

## Adding a scenario

1. Add the scenario to `SCENARIOS` in `qa/gate.mjs` with a `SC-xx` name.
2. Add its assertion(s) to `harness/asserts.mjs` (hard numbers, no vibes).
3. Confirm it passes on the CURRENT build; if it can't, that's a bug — fix
   the code before committing the new expectation.

## Reference pace bands (measured 2026-09-10, seed 42, pro)

- AI-only 9-car field: steady laps **78.9–80.8 s**, normalized spread < 11.5%
- Player (profile 1.03×) in pack, pro: AI steady laps 79.4–81.7 s
- Novice + random personas: AI steady laps ~82–84 s

If your change moves these bands, that's a pace change — call it out in the
commit message and re-baseline consciously, never silently.
