# Changelog

All notable changes to Drawper are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.1.0]

### Added
- Schema viewer follows foreign keys across files and has a Related / Whole app toggle.
- Relations by arrow, relation queries (SQL, Drizzle, Prisma) and Drizzle generation with `relations()`.
- Convert schema from the editor (CodeLens, context menu, Command Palette).
- Code on the canvas: Add selection to canvas, live Code Canvas for a whole file, and a display-only overlay of those drawings on the editor.
- Panel themes (Blue, Yellow, Mint, Coral, Violet) and a close button on the side panel.
- New logo and favicon, branded editor title bar icons.
- Husky pre-commit hook and GitHub Actions CI and publish workflows.

### Changed
- Faster load: code-split webview and an embedded document.
- Responsive canvas chrome: toolbar at the bottom, zoom and undo at the top, narrow-pane layout.
- Extension activates on startup so CodeLens appears when the window loads.

## [0.0.1]
- First preview.
