# Drawper

VS Code extension: canvas for `.dpr` files plus schema viewer (CodeLens on any file that defines tables).

- Build everything: `npm run compile` (tsc for `src/`, esbuild bundle of `src/webview` into `media/dist`)
- Typecheck webview: `npm run typecheck:webview`
- Parser tests: `npm run compile && node scripts/test-parsers.mjs`
- Run: press F5 (Extension Development Host)
- Webview facts learned the hard way: the canvas element converter needs `{ regenerateIds: false }` to keep ids; text element widths must be re-measured after fonts load (see `refreshDims` in `App.tsx`); the canvas asset path global must be an absolute URL.
- Brand assets live in `media/brand/` (`logo.svg` is the source for the in-app logo, command/language icons; `logo.png` is the marketplace icon). Palette: yellow `#FFD900`, ink `#2E2936`, coral `#EC5451`, mint `#87DAC7`, amber `#EAAA2A`.
