# Indianapolis Grand Prix - Phase 0

A pnpm + TypeScript workspace generated from `IndyGP_Phase1.html` by `scaffold.js`,
packaged for the desktop by Tauri.

## Layout

| Package | Layers | Contents |
| --- | --- | --- |
| `packages/core` | 1-4 | config, circuit data, centreline geometry, vehicle physics. No DOM, no renderer. Fully strict TypeScript. |
| `packages/render` | 5-6 | procedural CanvasTextures and the Three.js world. |
| `packages/platform` | 7-8 | normalised input, WebAudio engine, HUD, minimap, course map. |
| `packages/app` | 9 | fixed-timestep loop, camera rigs, session state, offline HTML shell. |
| `src-tauri` | - | native offline 1600x900 window. |

## Commands

```
pnpm install        # once
pnpm dev            # browser dev server on 127.0.0.1:5173
pnpm typecheck      # build all four project references
pnpm tauri:dev      # native window, hot reload
pnpm tauri:build    # MSI + NSIS installers
```

Before `tauri:build`, generate icons once: `pnpm tauri icon path\to\icon.png`.

## Offline guarantees

- Every Google Fonts `<link>` was stripped; `--display` and `--data` resolve to
  system faces only.
- Canvas font stacks in Layers 5 and 8b were rewritten to the same system faces.
- Vite runs with `assetsInlineLimit: 0` and a relative `base`.
- The Tauri CSP has no remote origins and the asset protocol is disabled.

## Known Phase 1 debt

Layers 5-9 are verbatim JavaScript ports, so `packages/render`, `packages/platform`
and `packages/app` run with `strict: false`. `packages/core` - the portable
contract that carries every math constant - is fully strict. Tightening the
presentation packages is the first Phase 1 task.
