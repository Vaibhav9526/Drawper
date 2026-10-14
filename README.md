<p align="center">
  <img src="media/brand/logo.png" alt="Drawper logo" width="128" />
</p>

<h1 align="center">Drawper</h1>

<p align="center">
  A fast whiteboard canvas inside VS Code for sketching system architecture and database schemas,<br/>
  then turning them into real code.
</p>

<p align="center">
  <img alt="VS Code" src="https://img.shields.io/badge/VS%20Code-%5E1.85-2E2936?logo=visualstudiocode&logoColor=FFD900" />
  <img alt="File type" src="https://img.shields.io/badge/file-.dpr-FFD900?labelColor=2E2936" />
  <img alt="Status" src="https://img.shields.io/badge/status-0.0.1-EC5451?labelColor=2E2936" />
</p>

---

## Screenshots

**Architecture canvas.** Drop components, connect them with arrows, generate a runnable `docker-compose`.

![Architecture canvas](docs/images/architecture.png)

**Schema editor.** Design tables and columns visually and export them as SQL, Prisma, Drizzle or TypeScript.

![Schema editor](docs/images/schema-editor.png)

**Schema viewer.** Open any file that defines tables and see an ER diagram with foreign keys drawn for you.

![Schema viewer](docs/images/schema-viewer.png)

## Features

- **Opens fast.** Code-split webview (about 750 KB up front), the document is embedded in the page, and the extension only activates when you use it.
- **Architecture panel.** Client, API, worker, gateway, database, cache, queue and storage components. Arrows between them become dependencies.
- **Schema panel.** Visual table and column editor with primary keys, nullable, unique and foreign keys.
- **Code generation.** SQL, Prisma, **Drizzle**, TypeScript types and `docker-compose.yml` with a Node scaffold per service.
- **Schema viewer for existing code.** A CodeLens appears above schema definitions: **View in Drawper**.
- **Icons and SVG.** Built-in icon library, SVG import, and paste SVG markup straight onto the canvas.
- **Resizable side panel.** Drag its left edge; the width is remembered.
- **Plain JSON files.** Drawings are saved as `.dpr` and diff cleanly.

### Schema sources the viewer understands

| Source | Detected from |
| --- | --- |
| Prisma | `model X { ... }` |
| SQL | `CREATE TABLE` and `ALTER TABLE ... FOREIGN KEY` |
| Drizzle | `pgTable`, `mysqlTable`, `sqliteTable`, `singlestoreTable`, `mssqlTable`, `schema.table(...)`, composite `primaryKey` and `foreignKey` |
| TypeORM | `@Entity()` classes |
| SQLAlchemy | `__tablename__` models |
| Django | `models.Model` classes |
| Mongoose | `new Schema({ ... })` |

### Generate targets

| Target | Output |
| --- | --- |
| SQL | `schema.sql` |
| Prisma | `schema.prisma` |
| Drizzle | `schema.ts` (`drizzle-orm/pg-core`) |
| TS types | `types.ts` |
| docker-compose | `docker-compose.yml` and `services/<name>/` |

Files are written next to your drawing in `<name>-generated/`.

## Getting started

```bash
git clone https://github.com/Vaibhav9526/Drawper.git
cd Drawper
npm install
npm run compile
```

Then press **F5** in VS Code to launch the Extension Development Host.

To build an installable package:

```bash
npm run package   # produces drawper-<version>.vsix
code --install-extension drawper-0.0.1.vsix
```

## Usage

| Command | What it does |
| --- | --- |
| `Drawper: New Drawing` | Creates `sketch-N.dpr` in the workspace and opens it |
| `Drawper: Open Drawing Canvas` | Opens the current `.dpr`, or lets you pick one |
| `Drawper: View Schema in This File` | Shows an ER diagram for the schema in the active file |

1. Run **Drawper: New Drawing**.
2. Add components or tables from the side panel.
3. Draw arrows between components with the Arrow tool (`A`).
4. Click a generate button to write code.

## Development

```bash
npm run compile            # tsc for src/, esbuild bundle for src/webview into media/dist
npm run watch              # tsc --watch (extension host)
npm run watch:webview      # esbuild --watch (webview)
npm run typecheck:webview  # type-check the webview
node scripts/test-parsers.mjs   # schema parser tests (run compile first)
```

### Project structure

```
Drawper/
├── src/
│   ├── extension.ts       # activation, custom editor, schema CodeLens, webview host
│   ├── model.ts           # .dpr document model
│   ├── codegen.ts         # SQL / Prisma / Drizzle / TS / docker-compose generators
│   ├── schemaParsers.ts   # Prisma, SQL, Drizzle, TypeORM, SQLAlchemy, Django, Mongoose
│   └── webview/           # React UI: canvas, side panel, shapes, icons
├── media/
│   └── brand/             # logo.svg (source) and logo.png (marketplace icon)
├── docs/images/           # README screenshots
└── scripts/               # webview build and parser tests
```

## Brand

| | |
| --- | --- |
| Yellow | `#FFD900` |
| Ink | `#2E2936` |
| Coral | `#EC5451` |
| Mint | `#87DAC7` |
| Amber | `#EAAA2A` |
