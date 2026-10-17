import * as vscode from 'vscode';
import * as path from 'path';
import { generate, Target } from './codegen';
import { CodeSnippet, addCodeCard, upsertLiveCard } from './codeCard';
import { registerDrawMode } from './drawMode';
import { registerLiveCode, sidecarUri, wholeFile, writeCanvas } from './liveCode';
import { DprDocument, docFromTables, emptyDocument, parseDocument } from './model';
import { ParsedSchema, WorkspaceTable, mergeSchemas, parseSchema, relatedTo } from './schemaParsers';

const VIEW_TYPE = 'drawper.editor';
const MAX_SCAN_BYTES = 200_000;

function webviewHtml(webview: vscode.Webview, ctx: vscode.ExtensionContext, mode: 'editor' | 'viewer', title = '', doc?: unknown): string {
  const media = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'dist');
  const uri = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(media, f));
  const nonce = Math.random().toString(36).slice(2);
  const src = webview.cspSource;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${src} 'unsafe-inline'; script-src 'nonce-${nonce}' ${src} 'wasm-unsafe-eval'; font-src ${src} data:; img-src ${src} data: blob:; connect-src ${src} data: blob:; worker-src blob:;">
<link rel="stylesheet" href="${uri('index.css')}"><link rel="modulepreload" href="${uri('index.js')}"></head>
<body><div id="root"></div>
<script nonce="${nonce}">window.EXCALIDRAW_ASSET_PATH = "${uri('').toString()}"; window.DRAWPER_MODE = "${mode}"; window.DRAWPER_TITLE = ${JSON.stringify(title)}; window.DRAWPER_DOC = ${doc ? JSON.stringify(doc).replace(/</g, '\u003c') : 'null'};</script>
<script type="module" nonce="${nonce}" src="${uri('index.js')}"></script></body></html>`;
}

const exists = (uri: vscode.Uri) => Promise.resolve(vscode.workspace.fs.stat(uri)).then(() => true, () => false);

async function emit(doc: DprDocument, target: Target, outDir: string) {
  const files = generate(doc, target);
  if (!files.some((f) => f.content.trim())) return void vscode.window.showWarningMessage('Drawper: nothing to generate. Add tables or services first.');
  const baseUri = vscode.Uri.file(outDir);
  await writeFiles(baseUri, files);
  await vscode.window.showTextDocument(vscode.Uri.joinPath(baseUri, ...files[0].path.split('/')), { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false, preview: false });
  vscode.window.showInformationMessage(`Drawper: wrote ${files.length} file(s) to ${path.basename(outDir)}/`);
}

async function writeFiles(baseUri: vscode.Uri, files: { path: string; content: string }[]) {
  for (const f of files) {
    const uri = vscode.Uri.joinPath(baseUri, ...f.path.split('/'));
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(f.content, 'utf8'));
  }
}

async function handleSvgMessages(webview: vscode.Webview, msg: any): Promise<boolean> {
  if (msg.type === 'listSvgs') {
    const found = await vscode.workspace.findFiles('**/*.svg', '**/{node_modules,.git,out,dist,.agents}/**', 300);
    webview.postMessage({ type: 'svgList', items: found.map((u) => ({ uri: u.toString(), label: vscode.workspace.asRelativePath(u) })) });
    return true;
  }
  if (msg.type === 'readSvg') {
    const uri = vscode.Uri.parse(msg.uri);
    if (!uri.path.toLowerCase().endsWith('.svg') || !vscode.workspace.getWorkspaceFolder(uri)) return true;
    const svg = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    webview.postMessage({ type: 'svgFile', name: path.basename(uri.fsPath, '.svg'), svg });
    return true;
  }
  if (msg.type === 'importSvg') {
    const picked = await vscode.window.showOpenDialog({ canSelectMany: true, filters: { SVG: ['svg'] }, openLabel: 'Import SVG' });
    for (const uri of picked ?? []) {
      const svg = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      webview.postMessage({ type: 'svgFile', name: path.basename(uri.fsPath, '.svg'), svg });
    }
    return true;
  }
  return false;
}

function serial(webview: vscode.Webview, fn: (msg: any) => Promise<void>) {
  let queue: Promise<unknown> = Promise.resolve();
  webview.onDidReceiveMessage((msg) => {
    queue = queue.then(() => fn(msg)).catch((err) => vscode.window.showErrorMessage(`Drawper: ${err}`));
  });
}

let activeCanvas: vscode.Uri | undefined;

class DrawperEditor implements vscode.CustomTextEditorProvider {
  constructor(private readonly ctx: vscode.ExtensionContext) {}

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'dist')] };
    let initial: ReturnType<typeof parseDocument> | undefined;
    try { initial = parseDocument(document.getText()); } catch { /* surfaced through the 'ready' push */ }
    panel.webview.html = webviewHtml(panel.webview, this.ctx, 'editor', '', initial);

    let lastFromWebview = '';
    let applying = 0;
    const push = () => {
      if (applying > 0 || document.getText() === lastFromWebview) return;
      try {
        panel.webview.postMessage({ type: 'load', doc: parseDocument(document.getText()) });
      } catch (err) {
        panel.webview.postMessage({ type: 'error', message: String(err) });
      }
    };

    const sub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) push();
    });
    activeCanvas = document.uri;
    const focus = panel.onDidChangeViewState((e) => { if (e.webviewPanel.active) activeCanvas = document.uri; });
    panel.onDidDispose(() => {
      sub.dispose();
      focus.dispose();
      if (activeCanvas?.toString() === document.uri.toString()) activeCanvas = undefined;
    });

    serial(panel.webview, async (msg) => {
      if (msg.type === 'ready') return push();
      if (msg.type === 'edit') {
        const text = JSON.stringify(msg.doc, null, 2);
        if (text === document.getText()) return;
        lastFromWebview = text;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
        applying++;
        try { await vscode.workspace.applyEdit(edit); } finally { applying--; }
        return;
      }
      if (msg.type === 'generate') return this.generate(document, msg.target as Target);
      await handleSvgMessages(panel.webview, msg);
    });
  }

  private async generate(document: vscode.TextDocument, target: Target) {
    await emit(parseDocument(document.getText()), target, path.join(path.dirname(document.uri.fsPath), path.basename(document.uri.fsPath, '.dpr') + '-generated'));
  }
}

const schemaCache = new Map<string, { version: number; schema: ParsedSchema }>();

function schemaOf(document: vscode.TextDocument): ParsedSchema {
  const key = document.uri.toString();
  const hit = schemaCache.get(key);
  if (hit?.version === document.version) return hit.schema;
  const schema = document.getText().length > MAX_SCAN_BYTES ? { tables: [], dialect: [] } : parseSchema(document.getText());
  schemaCache.set(key, { version: document.version, schema });
  return schema;
}

class SchemaLenses implements vscode.CodeLensProvider {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.uri.scheme !== 'file' || document.fileName.endsWith('.dpr')) return [];
    const { tables, dialect } = schemaOf(document);
    return tables.flatMap((t, i) => {
      const line = Math.min(t.line, document.lineCount - 1);
      const range = new vscode.Range(line, 0, line, 0);
      const title = i === 0 || tables.length === 1
        ? `$(graph) View ${tables.length} table${tables.length > 1 ? 's' : ''} in Drawper (${dialect.join(' + ')})`
        : `$(graph) View ${t.name} in Drawper`;
      const lenses = [new vscode.CodeLens(range, { title, command: 'drawper.viewSchema', arguments: [document.uri, t.name] })];
      if (i === 0) lenses.push(new vscode.CodeLens(range, { title: '$(arrow-swap) Convert to Drizzle / Prisma / SQL…', command: 'drawper.convertSchema', arguments: [document.uri] }));
      return lenses;
    });
  }
}

const SCAN_GLOB = '**/*.{prisma,sql,ts,tsx,mts,cts,js,jsx,mjs,cjs,py}';
const SCAN_SKIP = '**/{node_modules,dist,out,build,.git,.next,.venv,venv,__pycache__}/**';
const MAX_SCAN_FILES = 800;
const diskCache = new Map<string, { mtime: number; schema: ParsedSchema }>();

async function schemaOfUri(uri: vscode.Uri): Promise<ParsedSchema | undefined> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) return schemaOf(open);
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > MAX_SCAN_BYTES) return undefined;
    const key = uri.toString();
    const hit = diskCache.get(key);
    if (hit?.mtime === stat.mtime) return hit.schema;
    const schema = parseSchema(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'));
    diskCache.set(key, { mtime: stat.mtime, schema });
    return schema;
  } catch { return undefined; }
}

/** The file's own tables first, then every other schema in the workspace, merged into one app schema. */
async function appSchema(document: vscode.TextDocument): Promise<WorkspaceTable[]> {
  const self = document.uri.toString();
  const uris = (await vscode.workspace.findFiles(SCAN_GLOB, SCAN_SKIP, MAX_SCAN_FILES)).filter((u) => u.toString() !== self && !u.fsPath.endsWith('.d.ts'));
  const others = await Promise.all(uris.map(async (u) => ({ file: u.toString(), schema: await schemaOfUri(u) })));
  return mergeSchemas([{ file: self, schema: schemaOf(document) }, ...others.filter((o): o is { file: string; schema: ParsedSchema } => !!o.schema?.tables.length)]);
}

/** A lens right above the selection so the draw and copy actions are where the eye already is. */
class SelectionLenses implements vscode.CodeLensProvider {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;
  refresh() { this.changed.fire(); }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== document || document.fileName.endsWith('.dpr') || editor.selection.isEmpty) return [];
    const range = new vscode.Range(editor.selection.start.line, 0, editor.selection.start.line, 0);
    return [
      new vscode.CodeLens(range, { title: '$(pencil) Draw', command: 'drawper.toggleDrawMode', tooltip: 'Drawper: draw on this code, then drag the mouse over it' }),
      new vscode.CodeLens(range, { title: '$(window) Canvas', command: 'drawper.annotateCode', tooltip: 'Drawper: open a canvas beside this file to draw on its code' }),
      new vscode.CodeLens(range, { title: '$(add) Add to canvas', command: 'drawper.addToCanvas', tooltip: 'Drawper: add the selected code to a canvas' }),
    ];
  }
}

function statusButtons(): vscode.Disposable {
  const draw = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  draw.text = '$(pencil) Draw';
  draw.tooltip = 'Drawper: draw on this code, then drag the mouse over it';
  draw.command = 'drawper.toggleDrawMode';
  const canvas = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  canvas.text = '$(window) Canvas';
  canvas.tooltip = 'Drawper: open a canvas beside this file to draw on its code';
  canvas.command = 'drawper.annotateCode';
  const add = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  add.text = '$(add) Add to canvas';
  add.tooltip = 'Drawper: add the selected code to a canvas';
  add.command = 'drawper.addToCanvas';
  const update = () => {
    const editor = vscode.window.activeTextEditor;
    const source = !!editor && editor.document.uri.scheme === 'file' && !editor.document.fileName.endsWith('.dpr');
    if (source) { draw.show(); canvas.show(); } else { draw.hide(); canvas.hide(); }
    if (source && !editor.selection.isEmpty) add.show(); else add.hide();
  };
  update();
  return vscode.Disposable.from(draw, canvas, add, vscode.window.onDidChangeActiveTextEditor(update), vscode.window.onDidChangeTextEditorSelection(update));
}

const viewers = new Map<string, { panel: vscode.WebviewPanel; send: (focus?: string) => Promise<void> }>();

async function viewSchema(ctx: vscode.ExtensionContext, target?: vscode.Uri, focus?: string) {
  const uri = target ?? vscode.window.activeTextEditor?.document.uri;
  if (!uri) return void vscode.window.showWarningMessage('Drawper: open a file that defines a schema.');
  const document = await vscode.workspace.openTextDocument(uri);
  if (!schemaOf(document).tables.length) return void vscode.window.showWarningMessage('Drawper: no tables found in this file.');
  const key = uri.toString();
  const existing = viewers.get(key);
  const tableFiles = new Map<string, string>();
  const send = async (panel: vscode.WebviewPanel, focusTable?: string) => {
    if (!schemaOf(document).tables.length) return;
    const tables = await appSchema(document);
    tableFiles.clear();
    for (const t of tables) tableFiles.set(t.name, t.file);
    const related = relatedTo(tables, key).map((t) => t.name);
    panel.webview.postMessage({
      type: 'schema', tables: tables.map(({ name, columns }) => ({ name, columns })), related, dialect: schemaOf(document).dialect,
      focus: focusTable, source: path.basename(uri.fsPath),
    });
  };
  if (existing) { existing.panel.reveal(vscode.ViewColumn.Beside, true); return existing.send(focus); }

  const panel = vscode.window.createWebviewPanel('drawper.schema', `Schema: ${path.basename(uri.fsPath)}`, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
    enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'media', 'dist')],
  });
  viewers.set(key, { panel, send: (f) => send(panel, f) });
  panel.webview.html = webviewHtml(panel.webview, ctx, 'viewer', path.basename(uri.fsPath));

  let timer: NodeJS.Timeout | undefined;
  const sub = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.uri.scheme !== 'file' || !e.contentChanges.length) return;
    clearTimeout(timer);
    timer = setTimeout(() => send(panel), 400);
  });
  const saved = vscode.workspace.onDidSaveTextDocument(() => send(panel));
  const shownAgain = panel.onDidChangeViewState((e) => { if (e.webviewPanel.visible) void send(panel); });
  panel.onDidDispose(() => { sub.dispose(); saved.dispose(); shownAgain.dispose(); clearTimeout(timer); viewers.delete(key); });

  serial(panel.webview, async (msg) => {
    if (msg.type === 'ready') return send(panel, focus);
    if (msg.type === 'goto') {
      const file = tableFiles.get(msg.table);
      if (!file) return;
      const target = await vscode.workspace.openTextDocument(vscode.Uri.parse(file));
      const t = schemaOf(target).tables.find((x) => x.name === msg.table);
      if (t) await vscode.window.showTextDocument(target, { viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(t.line, 0, t.line, 0) });
      return;
    }
    if (msg.type === 'saveAs') {
      const stem = path.basename(uri.fsPath, path.extname(uri.fsPath));
      let out = vscode.Uri.file(path.join(path.dirname(uri.fsPath), `${stem}.schema.dpr`));
      for (let n = 2; await exists(out); n++) out = vscode.Uri.file(path.join(path.dirname(uri.fsPath), `${stem}.schema-${n}.dpr`));
      await vscode.workspace.fs.writeFile(out,Buffer.from(JSON.stringify(msg.doc, null, 2), 'utf8'));
      await vscode.commands.executeCommand('vscode.openWith', out, VIEW_TYPE);
      return;
    }
    await handleSvgMessages(panel.webview, msg);
  });
}

const CONVERT_TARGETS: { label: string; description: string; target: Target }[] = [
  { label: '$(symbol-class) Drizzle', description: 'schema.ts with tables and relations()', target: 'drizzle' },
  { label: '$(symbol-interface) Prisma', description: 'schema.prisma with relations', target: 'prisma' },
  { label: '$(database) SQL', description: 'schema.sql with CREATE TABLE and foreign keys', target: 'sql' },
  { label: '$(symbol-namespace) TypeScript types', description: 'types.ts interfaces', target: 'typescript' },
  { label: '$(references) Relation queries', description: 'SQL joins plus Drizzle and Prisma relation queries', target: 'queries' },
];

async function convertSchema(target?: vscode.Uri) {
  const uri = target ?? vscode.window.activeTextEditor?.document.uri;
  if (!uri) return void vscode.window.showWarningMessage('Drawper: open a file that defines a schema.');
  const document = await vscode.workspace.openTextDocument(uri);
  const { tables, dialect } = schemaOf(document);
  if (!tables.length) return void vscode.window.showWarningMessage('Drawper: no tables found in this file.');
  const pick = await vscode.window.showQuickPick(CONVERT_TARGETS, { placeHolder: `Convert ${tables.length} table${tables.length > 1 ? 's' : ''} from ${dialect.join(' + ')} to…` });
  if (!pick) return;
  const stem = path.basename(uri.fsPath, path.extname(uri.fsPath));
  await emit(docFromTables(tables), pick.target, path.join(path.dirname(uri.fsPath), `${stem}-converted`));
}

function snippetFromEditor(editor: vscode.TextEditor): CodeSnippet {
  const { document, selection } = editor;
  let range: vscode.Range = selection;
  if (selection.isEmpty) {
    const view = editor.visibleRanges[0] ?? new vscode.Range(0, 0, Math.min(document.lineCount - 1, 39), 0);
    range = new vscode.Range(view.start.line, 0, Math.min(view.end.line, view.start.line + 39), document.lineAt(Math.min(view.end.line, view.start.line + 39)).text.length);
  }
  const endLine = range.end.character === 0 && range.end.line > range.start.line ? range.end.line - 1 : range.end.line;
  const code = document.getText(new vscode.Range(range.start.line, 0, endLine, document.lineAt(endLine).text.length));
  return { code, file: vscode.workspace.asRelativePath(document.uri), startLine: range.start.line + 1, language: document.languageId };
}

async function showCanvas(target: vscode.Uri, change: (doc: DprDocument) => DprDocument) {
  await writeCanvas(target, change);
  await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE, vscode.ViewColumn.Beside);
}

async function pickCanvas(): Promise<vscode.Uri | undefined> {
  if (activeCanvas) return activeCanvas;
  const found = await vscode.workspace.findFiles('**/*.dpr', '**/node_modules/**', 50);
  const pick = await vscode.window.showQuickPick(
    [{ label: '$(add) New canvas', uri: undefined as vscode.Uri | undefined }, ...found.map((u) => ({ label: vscode.workspace.asRelativePath(u), uri: u as vscode.Uri | undefined }))],
    { placeHolder: 'Add this code to which Drawper canvas?' },
  );
  if (!pick) return undefined;
  if (pick.uri) return pick.uri;
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!folder) return void vscode.window.showErrorMessage('Drawper: open a folder first.');
  let n = 1;
  while (await exists(vscode.Uri.joinPath(folder, `sketch-${n}.dpr`))) n++;
  const uri = vscode.Uri.joinPath(folder, `sketch-${n}.dpr`);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(emptyDocument(), null, 2)));
  return uri;
}

async function addToCanvas() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.fileName.endsWith('.dpr')) return void vscode.window.showWarningMessage('Drawper: select some code in a file first.');
  const snippet = snippetFromEditor(editor);
  if (!snippet.code.trim()) return void vscode.window.showWarningMessage('Drawper: nothing to add, the selection is empty.');
  const target = await pickCanvas();
  if (target) await showCanvas(target, (doc) => addCodeCard(doc, snippet));
}

/**
 * Opens a canvas beside the file for drawing on its code. A selection becomes a one-off card; with no selection the
 * whole file becomes a live card that follows edits, and the drawings are also shown over the real editor.
 */
async function annotateCode() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file' || editor.document.fileName.endsWith('.dpr')) return void vscode.window.showWarningMessage('Drawper: open a source file first.');
  const side = sidecarUri(editor.document.uri);
  if (!(await exists(side))) await vscode.workspace.fs.writeFile(side, Buffer.from(JSON.stringify(emptyDocument(), null, 2)));
  if (editor.selection.isEmpty) {
    if (!editor.document.getText().trim()) return void vscode.window.showWarningMessage('Drawper: the file is empty.');
    return showCanvas(side, (doc) => upsertLiveCard(doc, wholeFile(editor.document)));
  }
  const snippet = snippetFromEditor(editor);
  await showCanvas(side, (doc) => addCodeCard(doc, snippet));
}

async function newDrawing() {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!folder) return void vscode.window.showErrorMessage('Drawper: open a folder first.');
  let n = 1;
  let uri: vscode.Uri;
  for (;;) {
    uri = vscode.Uri.joinPath(folder, `sketch-${n}.dpr`);
    try { await vscode.workspace.fs.stat(uri); n++; } catch { break; }
  }
  await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(emptyDocument(), null, 2)));
  await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
}

async function openDrawing() {
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active?.fsPath.endsWith('.dpr')) return void vscode.commands.executeCommand('vscode.openWith', active, VIEW_TYPE);
  const found = await vscode.workspace.findFiles('**/*.dpr', '**/node_modules/**', 50);
  if (!found.length) return newDrawing();
  const pick = await vscode.window.showQuickPick(
    [{ label: '$(add) New drawing', uri: undefined as vscode.Uri | undefined }, ...found.map((u) => ({ label: vscode.workspace.asRelativePath(u), uri: u as vscode.Uri | undefined }))],
    { placeHolder: 'Open a Drawper canvas' },
  );
  if (!pick) return;
  if (!pick.uri) return newDrawing();
  await vscode.commands.executeCommand('vscode.openWith', pick.uri, VIEW_TYPE);
}

export function activate(ctx: vscode.ExtensionContext) {
  const selectionLenses = new SelectionLenses();
  ctx.subscriptions.push(
    statusButtons(),
    registerLiveCode(),
    registerDrawMode(),
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, selectionLenses),
    vscode.window.onDidChangeTextEditorSelection(() => selectionLenses.refresh()),
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, new DrawperEditor(ctx), { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.languages.registerCodeLensProvider({ scheme: 'file', pattern: '**/*.{prisma,sql,ts,tsx,mts,cts,js,jsx,mjs,cjs,py}' }, new SchemaLenses()),
    vscode.workspace.onDidCloseTextDocument((d) => schemaCache.delete(d.uri.toString())),
    vscode.commands.registerCommand('drawper.open', openDrawing),
    vscode.commands.registerCommand('drawper.new', newDrawing),
    vscode.commands.registerCommand('drawper.addToCanvas', addToCanvas),
    vscode.commands.registerCommand('drawper.annotateCode', annotateCode),
    vscode.commands.registerCommand('drawper.convertSchema', (uri?: vscode.Uri) => convertSchema(uri)),
    vscode.commands.registerCommand('drawper.viewSchema', (uri?: vscode.Uri, focus?: string) => viewSchema(ctx, uri, focus)),
  );
}

export function deactivate() {}
