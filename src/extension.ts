import * as vscode from 'vscode';
import * as path from 'path';
import { generate, Target } from './codegen';
import { emptyDocument, parseDocument } from './model';
import { ParsedSchema, parseSchema } from './schemaParsers';

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
    panel.onDidDispose(() => sub.dispose());

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
    const files = generate(parseDocument(document.getText()), target);
    if (!files.some((f) => f.content.trim())) return void vscode.window.showWarningMessage('Drawper: nothing to generate. Add tables or services first.');
    const base = path.join(path.dirname(document.uri.fsPath), path.basename(document.uri.fsPath, '.dpr') + '-generated');
    const baseUri = vscode.Uri.file(base);
    await writeFiles(baseUri, files);
    await vscode.window.showTextDocument(vscode.Uri.joinPath(baseUri, ...files[0].path.split('/')), { viewColumn: vscode.ViewColumn.Beside, preview: false });
    vscode.window.showInformationMessage(`Drawper: wrote ${files.length} file(s) to ${path.basename(base)}/`);
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
    return tables.map((t, i) => {
      const line = Math.min(t.line, document.lineCount - 1);
      const title = i === 0 || tables.length === 1
        ? `$(graph) View ${tables.length} table${tables.length > 1 ? 's' : ''} in Drawper (${dialect.join(' + ')})`
        : `$(graph) View ${t.name} in Drawper`;
      return new vscode.CodeLens(new vscode.Range(line, 0, line, 0), { title, command: 'drawper.viewSchema', arguments: [document.uri, t.name] });
    });
  }
}

const viewers = new Map<string, vscode.WebviewPanel>();

async function viewSchema(ctx: vscode.ExtensionContext, target?: vscode.Uri, focus?: string) {
  const uri = target ?? vscode.window.activeTextEditor?.document.uri;
  if (!uri) return void vscode.window.showWarningMessage('Drawper: open a file that defines a schema.');
  const document = await vscode.workspace.openTextDocument(uri);
  if (!schemaOf(document).tables.length) return void vscode.window.showWarningMessage('Drawper: no tables found in this file.');
  const key = uri.toString();
  const existing = viewers.get(key);
  const send = (panel: vscode.WebviewPanel, focusTable?: string) => {
    const { tables, dialect } = schemaOf(document);
    panel.webview.postMessage({ type: 'schema', tables, dialect, focus: focusTable, source: path.basename(uri.fsPath) });
  };
  if (existing) { existing.reveal(vscode.ViewColumn.Beside, true); return send(existing, focus); }

  const panel = vscode.window.createWebviewPanel('drawper.schema', `Schema: ${path.basename(uri.fsPath)}`, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
    enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, 'media', 'dist')],
  });
  viewers.set(key, panel);
  panel.webview.html = webviewHtml(panel.webview, ctx, 'viewer', path.basename(uri.fsPath));

  let timer: NodeJS.Timeout | undefined;
  const sub = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document.uri.toString() !== key) return;
    clearTimeout(timer);
    timer = setTimeout(() => send(panel), 400);
  });
  panel.onDidDispose(() => { sub.dispose(); clearTimeout(timer); viewers.delete(key); });

  serial(panel.webview, async (msg) => {
    if (msg.type === 'ready') return send(panel, focus);
    if (msg.type === 'goto') {
      const t = schemaOf(document).tables.find((x) => x.name === msg.table);
      if (t) await vscode.window.showTextDocument(document, { viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(t.line, 0, t.line, 0) });
      return;
    }
    if (msg.type === 'saveAs') {
      const out = vscode.Uri.file(path.join(path.dirname(uri.fsPath), `${path.basename(uri.fsPath, path.extname(uri.fsPath))}.schema.dpr`));
      await vscode.workspace.fs.writeFile(out, Buffer.from(JSON.stringify(msg.doc, null, 2), 'utf8'));
      await vscode.commands.executeCommand('vscode.openWith', out, VIEW_TYPE);
      return;
    }
    await handleSvgMessages(panel.webview, msg);
  });
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
  ctx.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, new DrawperEditor(ctx), { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.languages.registerCodeLensProvider({ scheme: 'file', pattern: '**/*.{prisma,sql,ts,tsx,mts,cts,js,jsx,mjs,cjs,py}' }, new SchemaLenses()),
    vscode.workspace.onDidCloseTextDocument((d) => schemaCache.delete(d.uri.toString())),
    vscode.commands.registerCommand('drawper.open', openDrawing),
    vscode.commands.registerCommand('drawper.new', newDrawing),
    vscode.commands.registerCommand('drawper.viewSchema', (uri?: vscode.Uri, focus?: string) => viewSchema(ctx, uri, focus)),
  );
}

export function deactivate() {}
