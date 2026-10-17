import * as vscode from 'vscode';
import { CodeSnippet, hasLiveCard, upsertLiveCard } from './codeCard';
import { DprDocument, emptyDocument, parseDocument } from './model';
import { buildOverlay } from './overlay';

export const exists = (uri: vscode.Uri) => Promise.resolve(vscode.workspace.fs.stat(uri)).then(() => true, () => false);

export const sidecarUri = (source: vscode.Uri) => vscode.Uri.file(`${source.fsPath}.annotations.dpr`);

export const isSource = (doc: vscode.TextDocument) => doc.uri.scheme === 'file' && !doc.fileName.endsWith('.dpr');

export const wholeFile = (doc: vscode.TextDocument): CodeSnippet => ({
  code: doc.getText(), file: vscode.workspace.asRelativePath(doc.uri), startLine: 1, language: doc.languageId, uri: doc.uri.toString(),
});

/** Rewrites a canvas file through the document model, so an open canvas editor receives the change as a normal edit. */
export async function writeCanvas(target: vscode.Uri, change: (doc: DprDocument) => DprDocument): Promise<void> {
  const document = await vscode.workspace.openTextDocument(target);
  let doc: DprDocument;
  try { doc = parseDocument(document.getText()); } catch { doc = emptyDocument(); }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(target, new vscode.Range(0, 0, document.lineCount, 0), JSON.stringify(change(doc), null, 2));
  await vscode.workspace.applyEdit(edit);
  await document.save();
}

export async function readCanvas(side: vscode.Uri): Promise<DprDocument | undefined> {
  try {
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === side.toString());
    const text = open ? open.getText() : Buffer.from(await vscode.workspace.fs.readFile(side)).toString('utf8');
    return parseDocument(text);
  } catch { return undefined; }
}

/** Keeps the code card on a sidecar canvas in step with its source file while you edit it. */
function followSources(): vscode.Disposable {
  const timers = new Map<string, NodeJS.Timeout>();
  return vscode.workspace.onDidChangeTextDocument((e) => {
    const source = e.document;
    if (!isSource(source) || !e.contentChanges.length) return;
    const key = source.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(async () => {
      timers.delete(key);
      const side = sidecarUri(source.uri);
      if (!(await exists(side))) return;
      const doc = await readCanvas(side);
      if (doc && hasLiveCard(doc, key)) await writeCanvas(side, (cur) => upsertLiveCard(cur, wholeFile(source)));
    }, 600));
  });
}

const overlayEnabled = () => vscode.workspace.getConfiguration('drawper').get<boolean>('overlay.enabled', true);

export function editorMetrics() {
  const config = vscode.workspace.getConfiguration('editor');
  const fontSize = config.get<number>('fontSize', 14);
  const lineHeight = config.get<number>('lineHeight', 0);
  return {
    charWidth: fontSize * vscode.workspace.getConfiguration('drawper').get<number>('overlay.charWidthRatio', 0.6),
    lineHeight: lineHeight >= 8 ? lineHeight : lineHeight > 0 ? lineHeight * fontSize : Math.round(fontSize * 1.35),
  };
}

/**
 * Shows the strokes drawn on a code card over the real text editor. VS Code has no overlay API, so this injects
 * an absolutely positioned SVG through a decoration's CSS; it is display only and may need a tweak if VS Code changes.
 */
function overlayDrawings(): vscode.Disposable {
  const type = vscode.window.createTextEditorDecorationType({});
  let timer: NodeJS.Timeout | undefined;

  const paint = async (editor: vscode.TextEditor) => {
    if (!isSource(editor.document)) return;
    const none = () => editor.setDecorations(type, []);
    if (!overlayEnabled()) return none();
    const side = sidecarUri(editor.document.uri);
    const doc = (await exists(side)) ? await readCanvas(side) : undefined;
    const overlay = doc && buildOverlay(doc, editor.document.uri.toString(), editorMetrics());
    if (!overlay) return none();
    const line = Math.min(overlay.line, editor.document.lineCount - 1);
    const end = editor.document.lineAt(line).text.length;
    const css = `none; position: absolute; left: ${overlay.left}px; top: ${overlay.top}px; width: ${overlay.width}px; height: ${overlay.height}px; pointer-events: none; z-index: 5; background: url("data:image/svg+xml,${encodeURIComponent(overlay.svg)}") no-repeat`;
    editor.setDecorations(type, [{ range: new vscode.Range(line, end, line, end), renderOptions: { after: { contentText: '​', textDecoration: css } } }]);
  };

  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => vscode.window.visibleTextEditors.forEach((e) => void paint(e)), 300);
  };
  refresh();
  return vscode.Disposable.from(
    type,
    vscode.window.onDidChangeVisibleTextEditors(refresh),
    vscode.workspace.onDidChangeTextDocument((e) => { if (e.document.fileName.endsWith('.annotations.dpr') || isSource(e.document)) refresh(); }),
    vscode.workspace.onDidSaveTextDocument((d) => { if (d.fileName.endsWith('.annotations.dpr')) refresh(); }),
    vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('drawper.overlay') || e.affectsConfiguration('editor')) refresh(); }),
    vscode.commands.registerCommand('drawper.toggleOverlay', () => vscode.workspace.getConfiguration('drawper').update('overlay.enabled', !overlayEnabled(), vscode.ConfigurationTarget.Global)),
    { dispose: () => clearTimeout(timer) },
  );
}

export function registerLiveCode(): vscode.Disposable {
  return vscode.Disposable.from(followSources(), overlayDrawings());
}
