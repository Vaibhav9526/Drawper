# Drawper Codebase Documentation

A complete map of how the extension is structured, how data flows, and where to change things.
For user-facing features see [`README.md`](../README.md); for build workarounds and webview gotchas see [`AGENTS.md`](../AGENTS.md).

*Last updated: 2026-10 — rotation feature (`rotation.ts`, `RotateHandle.tsx`) included.*

---

## 1. What Drawper does, in one paragraph

Drawper turns VS Code into a whiteboard. `.dpr` files are JSON-serialized Excalidraw scenes with Drawper-specific `customData` attached to some elements, rendered by a custom editor that runs an Excalidraw + React webview. Blocks (services/tables) and their arrows are re-interpreted as *architecture* and *database schema documents*, from which the extension generates code (SQL, Prisma, Drizzle, TypeScript, relation queries, docker-compose). Independently, any source file (Prisma, SQL, Drizzle, TypeORM, SQLAlchemy, Django, Mongoose) can be parsed for its tables and shown as an ER diagram in a read-only "viewer" webview, or converted to another format. All processing is local — the extension makes no network calls.

---

## 2. Repository layout

```
Drawper/
├── src/
│   ├── extension.ts        # Extension host: activation, editor, viewer, commands, caches (~300 LOC)
│   ├── model.ts            # .dpr document model + arrow→edge extraction (~100 LOC)
│   ├── relations.ts        # FK derivation from arrows, relation naming (~70 LOC)
│   ├── codegen.ts          # All generators: sql/prisma/drizzle/typescript/queries/compose (~250 LOC)
│   ├── schemaParsers.ts    # 7-dialect schema parser (~370 LOC)
│   └── webview/            # React app bundled by esbuild into media/dist
│       ├── index.tsx       # Entry point (renders <App/>)
│       ├── App.tsx         # Root: Excalidraw mount, host message handling, persistence (~290 LOC)
│       ├── Panel.tsx       # Side panel tabs: Architecture / Schema / Icons (~340 LOC)
│       ├── shapes.ts       # Service/table skeleton builder, createShape/updateShape (~120 LOC)
│       ├── rotation.ts     # NEW: pure rotation geometry — plans + rigid transforms (~115 LOC)
│       ├── RotateHandle.tsx# NEW: Figma-style rotation grip UI (~200 LOC)
│       ├── schemaScene.ts  # Layered DAG layout for viewer mode (~100 LOC)
│       ├── icons.ts        # Icon library, SVG sanitize/import (~100 LOC)
│       ├── svgInsert.ts    # Insert SVG/image elements at a free spot (~40 LOC)
│       ├── panel.css       # Side panel + canvas chrome + rotation grip styles
│       ├── brand.tsx       # <Logo/> component
│       └── vscode.ts       # acquireVsCodeApi shim
├── media/
│   ├── dist/               # esbuild output (index.js, index.css, font assets) — built, not edited
│   └── brand/              # logo.svg (source of the in-app logo), logo.png (marketplace icon)
├── scripts/
│   ├── build-webview.mjs   # esbuild bundling + font copy
│   ├── test-parsers.mjs    # unit-ish asserts over schemaParsers
│   └── test-codegen.mjs    # codegen round-trip tests (generated Prisma/Drizzle/SQL re-parsed)
├── docs/images/            # README screenshots
├── package.json            # VS Code manifest: commands, custom editor, menus, languages
└── AGENTS.md               # agent notes (build commands, webview gotchas, rotation facts)
```

Two TypeScript batches build these: `tsc -p ./` compiles the extension host into `out/extension.js`; esbuild bundles `src/webview/index.tsx` into `media/dist/index.js`.

---

## 3. The document model (`src/model.ts` + `package.json`)

A `.dpr` file is a **Drawper v2 document**:

```jsonc
{
  "type": "drawper",
  "version": 2,
  "elements": [ /* Excalidraw elements, verbatim */ ],
  "appState": { "viewBackgroundColor": "#fbf6ee" },
  "files": { /* image files, keyed by fileId */ }
}
```

Semantic meaning lives in **`customData`** on elements:

| customData | Carrier | Meaning |
|---|---|---|
| `{ drawper: 'service', kind, name, tech?, icon? }` | rectangle | Architecture node; `kind` ∈ client/api/worker/gateway/db/cache/queue/storage |
| `{ drawper: 'table', name, columns: Column[] }` | rectangle | Database table. `Column = { name, type, pk?, nullable?, unique?, ref? }`, `ref: "users.id"` |
| `{ drawper: 'part', of: <rectId> }` | any non-rect element | Marks icon/text/frame elements that belong to the rect (service/table) |

**Edges are read from arrows**, both because the arrow may be Excalidraw *bound* (`startBinding.elementId`) and because users may draw arrows that merely *touch* shapes (geometry fallback via `serviceEdges`/`tableEdges` in `model.ts`). For tables, `ownerOf` resolves a bound endpoint to the table rect through the part marker (`customData.of`), so an arrow landing on a table's name text still counts. Relation column (`ref`) is **not** stored in the arrow — it's derived by `relations.ts` so the same arrow works for every generator.

---

## 4. Extension host (`src/extension.ts`)

One file, four responsibilities:

### 4.1 Custom editor (`DrawperEditor`, `*.dpr`)
- Serializes webview messages with a promise queue (`serial()`) so overlapping async handlers can't race.
- **Sync protocol (editor):**
  - webview → host: `ready`, `edit {doc}` (debounced 300 ms in the webview), `generate {target}`, `listSvgs`, `readSvg {uri}`, `importSvg`.
  - host → webview: `load {doc}` (also pushed whenever the document changes on disk or by other editors; `applying` counter + `lastFromWebview` echo suppression prevent re-pushing what we just wrote), `error {message}`, `svgList {items}`, `svgFile {name, svg}`.
- `generate` → `emit()`: writes generated files to `<file>-generated/`, then opens the first file beside the editor.

### 4.2 Schema viewer (`viewSchema`, launched from CodeLenses/menus)
- Keyed per-source-file (`viewers` map) so repeated activations reveal the existing panel.
- On every document change (debounced 400 ms), save, and re-show, the host:
  1. gathers this file's schema plus **all workspace schemas** (`appSchema` → `findFiles` over `**/*.{prisma,sql,ts,tsx,mts,cts,js,jsx,mjs,cjs,py}`, skipping `node_modules/dist/out/build/.git/.next/.venv/venv/__pycache__`, max 800 files, max 200 KB each, `.d.ts` excluded),
  2. `mergeSchemas` combines them so cross-file FK references resolve,
  3. `relatedTo` filters to FK-related tables (the "Related/Whole app" toggle in the webview),
  4. posts a `schema` message: `{ tables, related, dialect, focus, source }`.
- **Sync protocol (viewer):** webview → host `ready`, `goto {table}` (opens the file that defines it and selects the line), `saveAs {doc}` (writes `<stem>.schema.dpr`, then opens it **in the canvas editor** — the only bridge from a parsed schema to an editable document); host → webview `schema`, plus the shared SVG messages.
- **Caching:** `schemaCache` (open documents: keyed by `document.version`) for editor-parsed files and `diskCache` (workspace files: keyed by `mtime`) — re-parsing a repo costs nothing until files actually change. There is a known trade-off: first `viewSchema` in a big repo reads up to 800 files once.

### 4.3 CodeLens provider (`SchemaLenses`)
One lens per parsed table ("View N tables in Drawper (Dialect)") plus a "Convert to Drizzle / Prisma / SQL…" lens on the first table. No lenses for `.dpr` files or non-`file`-scheme documents.

### 4.4 Commands (Manifest ↔ implementation)

| Command | Implementation | Notes |
|---|---|---|
| `drawper.open` | `openDrawing()` | Opens active `.dpr`, else quick-pick workspace `.dpr` files, else falls back to `newDrawing()` |
| `drawper.new` | `newDrawing()` | Writes `sketch-N.dpr` (first free N) at the workspace root, opens in canvas editor |
| `drawper.viewSchema` | `viewSchema(ctx, uri, focus)` |ER viewer beside the file; `focus` pre-selects a table (CodeLens passes it) |
| `drawper.convertSchema` | `convertSchema(uri)` | Quick-pick target → `docFromTables()` → `emit()` into `<stem>-converted/` |

`convertSchema` is the "no-canvas" path: parsed tables are wrapped in a minimal synthetic document (`docFromTables`) and reused through the same generators.

---

## 5. Schema parsing (`src/schemaParsers.ts`)

Seven dialects are recognized from one text buffer; results are `ParsedSchema { tables: [{name, columns, line, alias?}], dialect: string[] }`.

| Dialect | Detection |
|---|---|
| Prisma | `model X { … }` |
| SQL | `CREATE TABLE x (...)`, inline `FOREIGN KEY` references, `ALTER TABLE … ADD FOREIGN KEY` |
| Drizzle | any `*Table(` factory (`pgTable`, `mysqlTable`, …), composite PK/FK |
| TypeORM | `@Entity()` class bodies |
| SQLAlchemy | classes with `__tablename__` |
| Django | `models.Model` subclasses (indentation-aware class bodies) |
| Mongoose | `new Schema({ … })` |

Implementation details worth knowing before editing:
- `mapType()` normalizes wildly different native types into the 10-canonical `ColumnType`s (int/bigint/text/varchar/boolean/timestamp/date/uuid/json/float) by regex priority order. All generators then re-map to native types. Everything unknown degrades to `text`.
- `stripComments()` blanks `/* */`, `--`, `//` (and preserves `'`/`:`/`"` prefixes so TSQL-ish strings don't bleed).
- `balanced()` finds the matching close of `(`/`{`/`[` — quote-aware but not nesting-context aware, so pathological inputs (a brace inside a string) are safe but a `{` inside a template-free Python f-string could truncate a body.
- `splitTop()` splits on separators at bracket-depth 0.
- Every parser is regex + brace-scan, deliberately lightweight (no AST). **Silent failure is by design**: if a file's dialect isn't recognized, `tables: []` simply produces no CodeLens. There are no diagnostics surfaced to users — the cost of "no AST, no diagnostics".
- `mergeSchemas` merges per-file tables; duplicate names collapse to the first file seen; cross-file `ref`s rely on FK relationship heuristics (a `<table>_id` column name) resolved in `relatedTo`.

---

## 6. Relations (`src/relations.ts`)

Small but load-bearing:
- `relationsOf(elements)` turns each `Column.ref` into a `Relation { from: table, column, to: table }`.
- `fkColumnFor(fromName)` produces the FK name (`users_userId` style after `singular()`).
- `withArrowRelations(tables, edges)` is the bridge the generators and the webview panel both call: for each `from→to` edge (see §3) it **appends the missing FK column** to `from` (skipping duplicates). The Panel calls the same function when the user draws an arrow live, so keys flow into the tables visually and into codegen.

---

## 7. Code generators (`src/codegen.ts`)

One entry point: `generate(doc: DprDocument, target: Target): GeneratedFile[]`, with `Target = 'sql' | 'prisma' | 'drizzle' | 'typescript' | 'queries' | 'compose'`.

| Target | Output |
|---|---|
| `sql` | `schema.sql` — `CREATE TABLE`s + `ALTER TABLE … ADD CONSTRAINT fk_…` statements |
| `prisma` | `schema.prisma` — models, `@relation` with disambiguation (`relationLabel` for parallel from→to pairs), `@@unique`, `@@index` for FKs |
| `drizzle` | `schema.ts` — tables + `relations()` reusing Prisma-style unique relation names |
| `typescript` | `types.ts` — `interface` per table; FK relation isn't expressible in TS so only columns are emitted |
| `queries` | `queries.sql` (LEFT JOIN both directions), `queries.drizzle.ts`, `queries.prisma.ts` |
| `compose` | `docker-compose.yml` + `services/<name>/<name>.service.<ext>` scaffold per non-client node, dependencies grabbed from `serviceEdges` |

Reference resolution (`resolveRef`) accepts `"table.colId"`, plain `"table"` (defaulting to the PK), or an unknown value (ignored → no FK). All generators get the *arrow-augmented* table list (`withRelations`), so canvas arrows and manual FK columns produce identical output. Tests (§10) verify a **round trip**: generated SQL/Prisma/Drizzle re-parsed yields the same shape.

---

## 8. Webview (`src/webview/`)

Bundled to a single ESM module build (`scripts/build-webview.mjs`, split chunks, minified, excludes heavy Excalidraw fonts). HTML is generated in `webviewHtml()` with a strict CSP: fixed nonce for the bootstrap script, `window.EXCALIDRAW_ASSET_PATH` set to the absolute `media/dist` URI. `window.DRAWPER_MODE` switches both webview types (both load the same JS bundle):

### 8.1 `App.tsx` — root (editor + viewer)
- `doc` state initialized from `window.DRAWPER_DOC`; scene lives in `elements.current` ref, mirrored out to the panel through `onChange` version checks (`getSceneVersion`).
- **Persistence** — every scene change that raises the version schedules a `edit` post 300 ms; the host writes them as an editor document (§4.1), meaning **VS Code's own file sync/incognito/undo applies to drawings**.
- `refreshDims` re-measures text widths after fonts load (see AGENTS.md); it waits while Excalidraw's cursor is down or `rotationActive()` is true (§8.5), so it never touches the scene mid-gesture.
- Viewer mode: `showSchema` consumes `schema` messages; existing table positions are preserved across refreshes (matched by `customData.name`), otherwise `buildSchemaScene()` re-lays out the whole diagram. "Related / Whole app" scope is kept in a ref so the effect doesn't re-render on it.

### 8.2 `Panel.tsx` — the side panel
Tabs: **Architecture** (services, tech labels, compose generation), **Schema** (tables/columns editor, FK targets, rename stepping through `syncRefs` so every table holding that FK is rewritten), **Icons** (built-in lib, workspace `*.svg` files, paste-markup). Active-tab follows the selection (`currentKind` effect). Renames/canvas edits flow through `updateShape`/`createShape` (§8.3) with `IMMEDIATELY` capture (each edit = one undo step) except text typing (`EVENTUALLY`).

### 8.3 `shapes.ts` — shape lifecycle
- `shapeSkeleton(id, x, y, data)` builds the raw element list (rect + optional icon + texts) with **deterministic child ids** (`<id>-i`, `-t`, `-h`, `-n`) — that is what `convertToExcalidrawElements({ regenerateIds: false })` preserves across rebuilds, so Excalidraw keeps the element identity (bindings, bound arrows) while the shape is being edited.
- `createShape` = skeleton + `applyTags` (assigns `groupIds` + `customData`); `updateShape` rebuilds IN PLACE (matched by id) and **carries `rect.angle` through `rotateShapeParts`** — this is why a user rotation survives any later panel-driven rebuild (rename/icon/tech/column edit).
- `measure()` works out of a hidden offscreen context; width for non-mono fonts is Excalidraw's measured width × 1.08 heuristic, corrected later by `refreshDims` for text precision.

### 8.4 `schemaScene.ts` — viewer layout
Layered DAG layout: tables queued by FK dependencies and placed into columns/rows, FK arrows (dashed, bound to table rects) laid per affected column rows; produces the same `customData`-tagged shape set, so the *viewer* and *editor* speak the same element language (that's why "Save as .dpr" works).

### 8.5 Rotation (`rotation.ts` + `RotateHandle.tsx`) — NEW
- **`rotation.ts` is the geometry module, pure and UI-free:**
  - `pivotOf(e)` — rotation center; points-aware for linear elements (arrow `x,y` is the tail, not the bbox corner), matching Excalidraw's `getElementAbsoluteCoords`.
  - `planRotation(scene, selectedIds)` → `RotationPlan { ids, pivot (bounds center), topCenter (grip anchor), singletonAngle }`. Eligibility: no frames (Excalidraw can't rotate them), no elbow arrows (their points are binding-owned), plus **any bound arrow touching the selection** so glued arrows follow rigidly.
  - `rotateElement(e, delta, pivot)` — same transform as Excalidraw's internal `rotateMultipleElements`: each element pivots around its own center while that center orbits the gesture pivot; `angle` is normalized to `[0, 2π)`. Version bumped via exported `newElementWith`.
  - `rotateShapeParts(parts, angle, shape)` — used by `updateShape` to re-apply a user's rotation on rebuilt parts.
  - `rotationActive()` — mid-gesture flag (counter) consumed by `App.refreshDims`.
- **`RotateHandle.tsx` is the gesture UI:**
  - A `pointer-events: none` DOM anchor parked above the selection's top-center by a rAF loop (no-scene-scan fast path when nothing is selected); the grip and °-chip are the only interactive parts, so canvas clicks are never blocked.
  - Pointer events are **buffered and applied once per animation frame** — smooth at any mouse report rate.
  - Each apply computes the target angle from `pointerAngle - grabAngle` (self-correcting, no drift) around the pivot frozen at gesture start:
    - **Shift**: snap to the 15° grid (one visible step onto it, like Figma's).
    - **Release of Shift**: a continuity "plate" rebases the free angle so there is no jump.
    - **±3° magnets** on 0/90/180/270 when not deliberately snapping.
    - **`FREEZE_RADIUS` (24 px)**: inside this distance from the pivot the angle is mathematically ill-conditioned, so the pose is held instead of jittering.
  - Scene updates during the drag use `captureUpdate: NEVER`; a single `IMMEDIATELY` commit on pointer-up makes the entire gesture **one undo step**. Escape/`pointercancel` rollback to a pre-rotation snapshot (Escape handler is registered in capture phase so Excalidraw's own deselect-on-Escape can't defeat it).
  - Grip a11y: `role="button"` + `aria-label="Rotate selection"`, not `aria-hidden`.

### 8.6 Message protocol summary

| Mode | webview → host | host → webview |
|---|---|---|
| editor | `ready`, `edit {doc}`, `generate {target}`, `listSvgs`, `readSvg {uri}`, `importSvg` | `load {doc}`, `error {message}`, `svgList {items}`, `svgFile {name, svg}` |
| viewer | `ready`, `goto {table}`, `saveAs {doc}`, + SVG messages | `schema {tables, related, dialect, focus, source}`, + SVG messages |

---

## 9. Build & run

```bash
npm install
npm run compile          # tsc (host → out/) + esbuild (webview → media/dist)
npm run typecheck:webview  # tsc over src/webview (its own tsconfig; stricter)
npm run watch            # host rebuild on change
npm run watch:webview    # webview rebuild on change
npm test                 # compile → parser tests → codegen round-trips
npm run package          # vsce package → drawper-<version>.vsix
```

Run locally: **F5** in VS Code → Extension Development Host. `scripts/` are plain Node ESM (no test framework) using `node:assert`; adding tests is five lines of `t(...)` in the same file.

Webview build notes (from `scripts/build-webview.mjs`): ESM output with code splitting, minified, bundled CSS; Excalidraw font assets copied except the huge Xiaolai webfont; `.d.ts` not generated.

---

## 10. Testing

`npm test` (three stages, same script chain):
1. **Compile** both halves.
2. **`scripts/test-parsers.mjs`** — per-dialect parse assertions (Prisma/SQL/Drizzle/TypeORM/SQLAlchemy/Django/Mongoose), cross-file merge, loose-ref FK matching, type mapping.
3. **`scripts/test-codegen.mjs`** — **round trips**: generate SQL/Prisma/Drizzle → feed back through `parseSchema` → assert the re-parsed shape matches the original document's tables; plus `relation queries` and FK-naming properties.

There is no CI config, no lint step, and no component tests for the webview — the webview is only type-checked (`npm run typecheck:webview`).

---

## 11. Conventions & cross-cutting notes

- **Style**: dense, `const`-first, arrow-function-heavy, one guards (`??`/optional chaining), semicolons retained; webview children render conditionally before mount checks (`api` availability).
- **Typing**: the manifest-derived values and the document model are typed; Excalidraw glue and webview messages deliberately flow as `any` (message protocol types are informally documented in §8.6 instead). If you tighten types, do it there.
- **Rotation invariant**: `updateShape` **must** run its rebuilt parts through `rotateShapeParts(rect.angle)` — a rebuild that forgets this flattens rotated shapes (this exact bug existed before the rotation feature). AGENTS.md documents the same rule one line for agents.
- **Pane/Message discipline**: every host-side per-message async action is serialized by `serial()`; don't attach raw `onDidReceiveMessage` listeners in parallel.
- **Performance budgets**: webview first chunk ≈ 750 KB (~code-split), extension activation is `onStartupFinished`, workspace schema scans cap at 800 × 200 KB per scan, caches are version/mtime keyed.
- **Privacy**: all parsing/generating is local; SVG import strips `script`/`foreignObject`; CSP is nonce-restricted; no outbound network.
- **Known sharp edges** (worth an issue each if they bite): generated `*-generated/`/`*-converted/` folders overwrite silently; a very large repo's first schema view pays for 800 file reads once; unrecognized parser failures are silent; the stock Excalidraw rotate icon still appears next to Drawper's grip (Excalidraw has no `showRotationHandle` option; hiding it would require patching an internal module).
