# Track Geometry Reference

## Core files

- `packages/core/src/circuit.ts`
  - Defines the raw circuit node list `NODES`.
  - Each `CircuitNode` includes `x`, `z`, corner `r`, and optional `turn`, `dir`, `name`, `note`.
  - Exports `TurnInfo` metadata for numbered corners used by the HUD and world.

- `packages/core/src/config.ts`
  - Defines `CFG.track` values.
  - Key parameters:
    - `halfWidth`: 7.0 m road half-width.
    - `kerbWidth`: 1.4 m.
    - `kerbRadius`: 70 m threshold for placing kerbs.
    - `wallOffset`: 9.4 m from centreline.
    - `wallHeight`: 1.15 m.
    - `sampleStep`: 2.0 m for centreline resampling.
    - `startFinish`: start/finish coordinates.
    - `gridOffset`: start grid placement offset.

- `packages/core/src/geometry.ts`
  - `buildCentreline(nodes, step)` builds the track centreline.
  - Process:
    1. Read node positions from `NODES`.
    2. Compute segment directions and lengths.
    3. Compute corner angles, handedness, and fillet offsets based on radius.
    4. Clamp fillet offsets so adjacent arcs do not overlap.
    5. Generate a raw path with straight segments and arc segments at corners.
    6. Resample the path at uniform spacing (`step`), producing a constant arc-length centreline.
    7. Compute tangent, right-hand normal, cumulative length, and curvature arrays.
  - Returns `Centreline` with `pts`, `tan`, `nrm`, `cum`, `curv`, `count`, `length`, and `step`.

- `packages/core/src/geometry.ts` also exports `makeLocator(cl)`:
  - Nearest-point query from world coordinates to the track.
  - Performs a local window scan around a hint index, with a fallback full-loop scan.
  - Returns signed lateral offset, nearest point, track tangent, and track distance `s`.

## App startup and track usage

- `packages/app/src/main.ts`
  - Calls `buildCentreline(NODES, CFG.track.sampleStep)`.
  - Creates `locate = makeLocator(CL)`.
  - Builds `TURNS` by locating numbered corner nodes along the resampled centreline.
  - Passes `CL`, `locate`, and `TURNS` into `createWorld()`.

## Render path

- `packages/render/src/world.ts`
  - Contains the track ribbon builder that sweeps a quad strip along the centreline.
  - `ribbon(cl, opts)`:
    - Uses `CL.pts` and `CL.nrm`.
    - Sweeps between two lateral offsets (`offA`, `offB`).
    - Builds geometry for road surface, kerbs, and concrete walls.
    - Computes `tangent` attribute for normal mapping.
  - Track pieces built:
    - carriageway with `TEX.road`
    - inside/outside corner kerbs with `TEX.kerb`
    - concrete walls with `TEX.wall`
    - start/finish line in brick texture at `CFG.track.startFinish`
    - crosswalk decals near turns using `TURNS` and `CL.tan`

## Summary

The track is built from a data-driven node list in `packages/core/src/circuit.ts`, then converted into a smooth, uniformly sampled centreline in `packages/core/src/geometry.ts`. The renderer uses that centreline plus lateral offsets to construct the visible track ribbon, kerbs, and walls in `packages/render/src/world.ts`. `packages/app/src/main.ts` is the bootstrap entry that wires the core track data into the world.
