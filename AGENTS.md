# Drawper

VS Code extension: canvas for `.dpr` files plus schema viewer (CodeLens on any file that defines tables).

- Build everything: `npm run compile` (tsc for `src/`, esbuild bundle of `src/webview` into `media/dist`)
- Typecheck webview: `npm run typecheck:webview`
- Parser tests: `npm run compile && node scripts/test-parsers.mjs`
- Run: press F5 (Extension Development Host)
- Webview facts learned the hard way: `convertToExcalidrawElements` needs `{ regenerateIds: false }` to keep ids; text element widths must be re-measured after fonts load (see `refreshDims` in `App.tsx`); `EXCALIDRAW_ASSET_PATH` must be an absolute URL.
- Rotation: `rotation.ts` holds the pivot math (each element spins around its own bounds center while that center orbits the selection bounds center — the same convention Excalidraw's internal `rotateMultipleElements` uses, so stock tools/bindings stay coherent). The grip (`RotateHandle.tsx`) rotates via `updateScene` with `captureUpdate: NEVER` and commits one undo step with `IMMEDIATELY` on pointer-up. Motion is Figma-style: pointer events are buffered and applied once per animation frame, Shift snaps to a 15° grid (release rebases smoothly around `plate`), and within `FREEZE_RADIUS` of the pivot the pose is held instead of jittering. `rotationActive()` tells `refreshDims` to pause while a gesture runs. `updateShape` must run fresh parts through `rotateShapeParts` with the old `rect.angle`, otherwise any rebuild (rename/icon/tech edit) silently flattens rotated shapes.
- Brand assets live in `media/brand/` (`logo.svg` is the source for the in-app logo, command/language icons; `logo.png` is the marketplace icon). Palette: yellow `#FFD900`, ink `#2E2936`, coral `#EC5451`, mint `#87DAC7`, amber `#EAAA2A`.
