# Indianapolis Grand Prix — Project Handoff

**Read this before touching the code.** It exists so you don't re-derive decisions
that are already settled, and so you don't break the four things that are load-bearing.

---

## 0. What this is

A fictional 13-corner Formula-style street circuit through downtown Indianapolis,
built as a browser game. The owner grew up with the Indy 500 and always wanted to see
a road course run through the actual city streets. This is that.

**Current state: Phase 1 complete and verified.** A fully drivable skeleton — correct
course geometry, working vehicle physics, chase/bonnet/trackside cameras, lap timing,
HUD, minimap, annotated course map. Placeholder-grade visuals (procedural textures,
box-geometry buildings, box-geometry car). Nothing is stubbed; everything in the UI works.

**Deliverable:** one file, `IndyGP_Phase1.html`, about 669 KB. Runs by double-clicking.
No server, no build step, no dependencies, no network requests.

---

## 1. Hard constraints — do not violate these

These come from the owner's own standards document. Breaking any of them is a regression
even if the code is better.

1. **It must run by double-clicking one file.** No `npm install`, no build step, no
   dev server, no CLI. If a change requires a server, that is a Tier-2 escalation and
   must be raised explicitly, with a `run.bat` that does the setup in one click.
2. **Three.js r128 is embedded inline as a classic `<script>` block**, not loaded from a
   CDN and not an ES module. This is deliberate and was a bug fix, not an oversight.
   Reason: `<script type="module">` importing over the `file://` protocol fails, and a
   CDN makes the file useless offline. **Do not "modernise" this to import maps or ESM.**
   The library sits in script block 0; the game is script block 1.
3. **No placeholders.** No `// TODO`, no dead buttons, no silent `catch {}`. Every error
   path surfaces a real message in the UI.
4. **No `localStorage` / `sessionStorage`** in the artifact environment. Keep session
   state in memory. If persistence is needed, wrap it in a storage service object first
   so it can be swapped for mobile-native storage later.
5. **Layers 1–4 stay pure.** No DOM, no `THREE`, no globals. That is the mobile port path.

---

## 2. Architecture

The single file is divided into nine numbered, commented layers. Search for the numbers.

| Layer | Contents | Pure? |
|---|---|---|
| 1 `CFG` | Every tunable number. Nothing below invents a constant. | yes |
| 2 `CIRCUIT` | Street grid + 18 corner nodes as data. | yes |
| 3 `GEOMETRY` | `buildCentreline()` fillet + resample; `makeLocator()` nearest-point query. | yes |
| 4 `VEHICLE` | `stepVehicle()`, `applyBarriers()`, `gearFor()`, `fmtTime()`. | yes |
| 5 `TEXTURES` | Procedural `CanvasTexture` factory. All art is drawn at load. | no |
| 6 `WORLD` | THREE scene: road ribbon, kerbs, walls, city, Monument, Artsgarden, car. | no |
| 7 `INPUT` | Keyboard + gamepad + touch, normalised into one `INPUT` struct. | no |
| 8 `HUD/AUDIO` | DOM readouts, minimap, course map, WebAudio engine note. | no |
| 9 `LOOP` | Fixed-timestep accumulator, pause, resize, lap timing. | no |

**Layers 1–4 are roughly 380 lines and are the actual game.** They can be lifted verbatim
into React Native / react-three-fiber / Flutter and behave identically. Layers 5–9 are
replaceable presentation.

---

## 3. The circuit — the irreplaceable data

Coordinate frame: **x grows EAST, z grows SOUTH, y is up. Origin is West St & Washington St.
One unit = one metre.** Spacings follow the real Mile Square grid. Monument Circle is a
55 m radius carriageway about the Soldiers' & Sailors' Monument, which is where Meridian
and Market actually meet.

Handedness convention used throughout: `cross(inDir, outDir) > 0` is a **right-hander**.

```js
const AVE = { WHITE_RIVER:-600, WEST:0, MISSOURI:150, SENATE:280, CAPITOL:410,
              ILLINOIS:540, MERIDIAN:680, PENN:820, DELAWARE:960, ALABAMA:1090 };
const ST  = { NORTH:-540, NEW_YORK:-410, OHIO:-270, MARKET:-130, WASHINGTON:0,
              MARYLAND:130, GEORGIA:250, SOUTH:400, MCCARTY:530 };
const CIRCLE = { x:AVE.MERIDIAN, z:ST.MARKET, r:55 };
const CIRC_45 = { x: CIRCLE.x + CIRCLE.r*Math.SQRT1_2, z: CIRCLE.z + CIRCLE.r*Math.SQRT1_2 };

const NODES = [
  { x:AVE.WEST,          z:ST.WASHINGTON,      r:24, turn:13, dir:'L', name:'W Washington St' },
  { x:AVE.MERIDIAN,      z:ST.WASHINGTON,      r:22, turn:1,  dir:'L', name:'Meridian St' },
  { x:AVE.MERIDIAN,      z:CIRCLE.z+CIRCLE.r,  r:26, turn:2,  dir:'R', name:'Monument Circle' },
  { x:CIRC_45.x,         z:CIRC_45.z,          r:CIRCLE.r },
  { x:CIRCLE.x+CIRCLE.r, z:CIRCLE.z,           r:26, turn:3,  dir:'R', name:'Market St' },
  { x:AVE.PENN,          z:ST.MARKET,          r:22, turn:4,  dir:'R', name:'Pennsylvania St' },
  { x:AVE.PENN,          z:ST.SOUTH,           r:22, turn:5,  dir:'R', name:'South St' },
  { x:AVE.MISSOURI,      z:ST.SOUTH,           r:22, turn:6,  dir:'R', name:'Missouri St' },
  { x:AVE.MISSOURI,      z:320,                r:60 },
  { x:AVE.WEST,          z:220,                r:60 },
  { x:AVE.WEST,          z:ST.MARYLAND,        r:22, turn:7,  dir:'L', name:'Maryland St' },
  { x:-160,              z:90,                 r:70 },
  { x:-260,              z:20,                 r:70 },
  { x:AVE.WHITE_RIVER,   z:ST.WASHINGTON,      r:26, turn:8,  dir:'R', name:'White River Pkwy' },
  { x:AVE.WHITE_RIVER,   z:ST.NEW_YORK,        r:26, turn:9,  dir:'R', name:'New York St' },
  { x:AVE.CAPITOL,       z:ST.NEW_YORK,        r:22, turn:10, dir:'R', name:'Capitol Ave' },
  { x:AVE.CAPITOL,       z:ST.OHIO,            r:20, turn:11, dir:'R', name:'Ohio St' },
  { x:AVE.WEST,          z:ST.OHIO,            r:22, turn:12, dir:'L', name:'West St' }
];
```

The three unnumbered nodes are not decoration:
- `CIRC_45` keeps the car on the Monument Circle carriageway. Without it the corner fillet
  cuts a straight diagonal across the Monument plaza.
- `(150,320)` and `(0,220)` are the Missouri St merge into West St.
- `(-160,90)` and `(-260,20)` are the Maryland St sweep into West Washington St.

### The lap as designed

Start/finish is under the **Artsgarden**, at Washington & Illinois, `{x:540, z:0}`,
facing east. Car is gridded 45 m behind the line.

Out of the Artsgarden east on Washington → **T1** left onto Meridian → **T2** right onto
Monument Circle → a quarter turn round the Monument → **T3** right onto Market → **T4**
right onto Pennsylvania → long run south → **T5** right onto South St → **T6** right onto
Missouri past the stadium → Missouri merges into West St → **T7** left onto Maryland, which
sweeps into West Washington → **T8** right onto White River Parkway → **T9** right onto
New York St (longest straight) → **T10** right onto Capitol → **T11** right onto Ohio →
**T12** left onto West St → **T13** left back onto the front straight.

### Verified measurements

| Metric | Value |
|---|---|
| Lap length | 5,217.8 m (5.218 km) |
| Centreline samples | 2,609 at 1.9999 m |
| Corners | 13 — nine right, four left |
| Track width | 14 m (`halfWidth` 7) |
| Wall corridor | ±9.4 m from centreline |
| Tightest radius | 17.6 m |
| Closest non-adjacent approach | 49.9 m (no section of road overlaps another) |
| Reference lap (autopilot) | 1:41.78 |
| Top speed / slowest corner | 297 km/h / 78 km/h |

For scale, that lap sits between Singapore (4.9 km) and Baku (6.0 km).

---

## 4. Physics model — why it feels the way it does

Not a naive kinematic bicycle model; that feels like a slot car. Two things make it work:

1. **Yaw rate is capped by the lateral grip budget.** `yawCap = latGrip * grip / max(speed, 4)`.
   The bicycle model's requested yaw rate is clamped to that. This is what produces
   believable understeer instead of a car that pivots on the spot at 300 km/h.
2. **Lateral velocity is a separate tracked channel.** Yawing the body leaves the velocity
   vector behind (`vLat -= yawRate * vLong * dt`), and grip drags it back toward zero
   (`bite = latGrip * grip * dt`). That is the slide. The handbrake drops `grip` to 0.42.

Steering lock tapers from 0.52 rad at rest to 0.075 rad at 70 m/s. Without this the car
is undrivable on a keyboard at speed. **Don't remove it.**

Simulation runs a **fixed 1/120 s step** with an accumulator, `dt` clamped at 0.10 s so an
alt-tab stall cannot teleport the car through a barrier. Guard counter caps at 24 substeps.

`applyBarriers()` clamps lateral offset to `wallOffset`, zeroes `vLat`, and scales `vLong`
by 0.62. Note that `PHYS` is composed as
`Object.assign({}, CFG.car, { scrub: CFG.surface.wallScrub, wallOffset: CFG.track.wallOffset })`
— those last two live outside `CFG.car` and the physics layer needs both. Omitting
`wallOffset` makes position `NaN` on first wall contact. That bug was already found and fixed;
don't reintroduce it by refactoring the config.

---

## 5. Regression harness — run this after any change to layers 1–4

The pure layers can be tested headlessly in Node, no browser needed. This is how Phase 1
was validated and it catches nearly everything.

```bash
# extract the game script (block 1) from the HTML, then slice off the pure layers
python3 - <<'PY'
import re
src = open('IndyGP_Phase1.html').read()
js  = re.findall(r'<script(?:[^>]*)>(.*?)</script>', src, re.S)[1]   # [0] is three.js
cut = js.index('Everything from here down is presentation')
open('pure.js','w').write(js[:js.rindex('/*', 0, cut)])
PY
```

```js
// harness.js — stub the browser, eval the pure layers, then assert
global.window = { addEventListener(){}, alert(){} };
global.document = { getElementById(){ return null; } };
const fs = require('fs');
eval(fs.readFileSync('pure.js','utf8').replace(/^'use strict';/m,'') +
  '\nmodule.exports={buildCentreline,makeLocator,createVehicle,stepVehicle,' +
  'applyBarriers,NODES,CFG,clamp,clamp01,gearFor,fmtTime};');
```

Assertions that must hold:

1. **Corner order.** Sorting turns by arc-length distance from the start/finish line must
   yield exactly T1…T13 in sequence.
2. **Tightest radius > wall corridor × 1.3.** Otherwise the barrier ribbon folds through itself.
3. **Closest non-adjacent centreline approach > 2 × wallOffset.** Proves no two sections of
   road overlap. Any new corner risks this.
4. **Drivability.** A pure-pursuit autopilot (lookahead `clamp(9 + 0.75v, 12, 70)`,
   steer `err*2.2 - lateral*0.02`, brake toward `sqrt(latGrip*0.8/maxCurvatureAhead)`)
   must complete 3 laps with **zero** wall contacts.
5. **Input fuzzing.** 160,000 ticks of random simultaneous throttle + brake + handbrake +
   steering must never produce a non-finite `x`, `z`, `yaw`, `vLong` or `vLat`.
6. **Barrier containment.** 300 cars launched at the wall at 90 m/s must all end up inside
   `wallOffset`. No tunnelling at 342 km/h.

Also worth re-running after any HTML edit: every `DOM.*` reference must appear in the
`grab()` id list, and every id in `grab()` must exist in the markup. A missing entry throws
on frame one and is invisible on reading. That is exactly how the `DOM.pedals` bug was caught.

---

## 6. Source material available

The owner has **63 street-level photographs** covering the whole route — Google Street View
captures, 952 × 1260 JPEG, one per waypoint, delivered in a ZIP container that is misnamed
`IndyRoadCourse.pdf`. Open it with a zip reader, not a PDF reader. It contains `1.jpeg` …
`63.jpeg`, a `manifest.json`, and 63 empty `.txt` files (no OCR text — the images are the data).

Content: Monument Circle, the Meridian/Market glass towers, mid-rise brick and limestone
blocks, parking garages, mast-arm traffic signals, street trees, wide asphalt with double
yellows. These informed the current building massing and are the raw material for Phase 3
facade work.

---

## 7. Roadmap

- **Phase 1 — done.** Geometry, physics, cameras, HUD, lap timing.
- **Phase 2 — visual realism.** PBR materials, image-based lighting, shadows that follow the
  car, post-processing, procedural normal/roughness maps, a facade kit, tyre smoke and sparks.
- **Phase 3 — the real Indianapolis.** Photo-derived facade atlas from the 63 images. Real
  landmarks: Lucas Oil at Missouri/South, Gainbridge at Penn/South, the Statehouse, Union
  Station, the canal along West St.
- **Phase 4 — race craft.** AI opponents on a racing-line spline, standing grid start, flags,
  a pit lane down West St, cut-track penalties.
- **Phase 5 — mobile.** Expo + react-three-fiber, touch or tilt steering, PWA offline install.

---

## 8. If you are an AI picking this up cold

- **Attach the HTML file *and* this document.** If your context can't hold 669 KB, you only
  need **script block 1** (about 63 KB, 1,435 lines). Block 0 is unmodified Three.js r128 —
  never read it, never edit it.
- **The owner's priorities, in order:** it must run instantly with zero setup; it must look
  and feel professional; it must be complete, with no stubs or lazy placeholders.
- **He asked for staged delivery and he means it.** Ship one working increment at a time.
  Don't attempt the whole game in one pass.
- **Change the circuit by editing the `NODES` table, not the geometry builder.** The builder
  is correct and was hard to get right; the proportional fillet clamping in particular exists
  because two corner arcs on a short block will otherwise overlap and fold the road back on
  itself. If a corner feels wrong, change its `r`, then re-run assertions 1–4 above.
