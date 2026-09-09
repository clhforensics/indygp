# IndyGP — Product Roadmap

> Downtown Indianapolis street circuit. Browser-first, TypeScript + Three.js.
> This roadmap is the working agreement between Chris and the build process.
> Dates are commitments with scope guards, not wishes — see each milestone's
> CUT LINE for what slips first.

---

## M1 — Public Beta · September 2026 · OPEN SOURCE ✅ (current)

Ship the game as it drives today: full circuit, 9-driver AI field, three race
distances, pit lane + strategy, tire model (measured-anchor calibration),
broadcast HUD, results podium.

**Work items**
- [ ] GitHub repo creation + first push (`feature/v2-urban-architecture-realism` → `main`)
- [ ] README rewrite: what it is, controls, URL params, screenshots, quickstart
- [ ] LICENSE selection (Chris decision: MIT recommended for beta)
- [ ] CREDITS.md — **F60 engine loop requires CC BY-SA 3.0 attribution** (Wikimedia cand_2.ogg)
- [ ] .gitignore audit (dist-types/, qa/, one-off scripts)
- [ ] Optional: GitHub Actions CI (typecheck + build on push)
- [ ] Tag `v0.1.0-beta`

**Beta scope lock:** no new gameplay before push. Polish-only.

---

## M2 — Full Release 1.0 · Q4 2026 · CLOSED SOURCE

The finished "Phase 1" game. Development moves to a private repo; the beta
code remains public under its license (open-core model).

**Feature waves (each = one focused build block, drive-tested before merge)**
| Wave | Content | Window |
|---|---|---|
| W1 | Flashing brake lights · AI braking/cornering character (persona brake markers, bravery spread) · collision avoidance upgrade (player-aware, side-by-side lockouts) | Oct 2026 |
| W2 | Cockpit view (wheel, halo, mirrors, shake) · Spectator/director mode (auto battle-cams) | Nov 2026 |
| W3 | Collision system: car-car → object colliders (lamps, bollards, signage) → wall impact physics | Nov–Dec 2026 |

**Content blocks (interleaved with waves)**
- Lucas Oil Stadium build (prep notes exist; needs a dedicated block)
- Graphics infill: vacant lots, parking, greenery (background polish)
- Race weekend structure: quali → grid
- Audio polish pass

**CUT LINE (what slips to 1.1 first, in order):** spectator mode → cockpit
view → W3 object colliders. Car-car contact and AI character are 1.0 musts.

**Distribution decision (by Oct 2026):** web (GitHub Pages / itch.io) vs
Tauri desktop builds. Recommendation: web-first at 1.0, desktop when W3 lands.

---

## M3 — Open Source Demo · Q1 2027 · OPEN SOURCE

A small, clean, public showcase: **one or two track sectors, 3-car AI field,
chase cam, core racing loop.** Not the full game — a portfolio-grade engine
demo that stands alone.

**Purpose:** community visibility, engine credibility, recruiting asset.

**Constraints**
- Ships ONLY with fully-owned or permissively-licensed assets (audit menu art
  and audio provenance; the F60 sample likely gets replaced or re-licensed
  for closed distribution — see Risks)
- Repo separate from the 1.0 private repo; shares core where practical

---

## M4 — Photorealistic Engine · Closed Beta Q3 2027 · CLOSED SOURCE

The 2027 redeploy. Quality target: **the current menu/title screen art** —
if the game looked like its own key art in motion, that's the bar.

**Approach — the architecture is already built for this.** `core` (physics,
rules) and `platform` (HUD, audio) are render-agnostic; only `render/` gets
replaced or rebuilt. Two paths, decide by **Q1 2027**:
- **Path A — Three.js photoreal push:** PBR materials, baked GI/lightmaps,
  HDR sky + weather, new vehicle + building models. Lower cost, keeps the
  codebase, ceiling is real but high with disciplined art direction.
- **Path B — New engine (Unreal / Godot 4.x):** true photoreal ceiling, but
  re-platform cost on gameplay/physics, new toolchain, longer timeline.

**Scope:** new vehicle models, PBR texture sets, global illumination,
weather/time-of-day, track detail pass, photoreal menu-to-game continuity.

**Beta:** private cohort, NDA, structured feedback rounds through Q3 2027.

---

## Risks & standing decisions

1. **Bandwidth.** Solo builder with a day job. Q4 2026 is achievable only if
   the cut lines are respected. Waves are scoped to fit, not to dream.
2. **CC BY-SA audio in a closed release.** The F60 sample's ShareAlike terms
   are fine for the open beta but legally awkward inside closed-source 1.0.
   Plan: replace the sample (same cutting pipeline, freely-licensed source)
   during M2 audio polish. Decision owner: Chris, by Nov 2026.
3. **Open-core boundary.** Public beta code stays public forever. Everything
   after `v0.1.0-beta` tag happens in the private repo. Honest about this up
   front so the community story is clean.
4. **Photoreal engine choice** is a Q1 2027 decision gate, informed by how
   much of M2/M3 landed. Don't pre-commit.
