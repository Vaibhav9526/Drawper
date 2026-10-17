import * as vscode from 'vscode';
import { hasLiveCard, upsertLiveCard } from './codeCard';
import { emptyDocument } from './model';
import { addStroke, clearStrokes, undoStroke } from './overlay';
import { editorMetrics, exists, isSource, readCanvas, sidecarUri, wholeFile, writeCanvas } from './liveCode';

/** Makes sure the file has a sidecar canvas with a live code card, without opening the canvas. */
async function ensureCanvas(editor: vscode.TextEditor): Promise<vscode.Uri> {
  const side = sidecarUri(editor.document.uri);
  if (!(await exists(side))) await vscode.workspace.fs.writeFile(side, Buffer.from(JSON.stringify(emptyDocument(), null, 2)));
  const doc = await readCanvas(side);
  if (!doc || !hasLiveCard(doc, editor.document.uri.toString())) await writeCanvas(side, (cur) => upsertLiveCard(cur, wholeFile(editor.document)));
  return side;
}

const activeSource = () => {
  const editor = vscode.window.activeTextEditor;
  return editor && isSource(editor.document) ? editor : undefined;
};

/**
 * Draw mode. VS Code gives extensions no way to draw on its text editor, but dragging the mouse reports the cursor
 * position as it moves. Those positions are recorded as a stroke, saved on the file's canvas and shown back over the
 * editor by the overlay.
 */
export function registerDrawMode(): vscode.Disposable {
  let on = false;
  let trail: vscode.Position[] = [];
  let timer: NodeJS.Timeout | undefined;

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  status.command = 'drawper.toggleDrawMode';
  status.text = '$(pencil) Drawing, click to finish';
  status.tooltip = 'Drawper: hold the mouse button and drag over your code to draw';
  status.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  const undo = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
  undo.text = '$(discard) Undo';
  undo.command = 'drawper.undoStroke';
  undo.tooltip = 'Drawper: undo the last stroke';

  const setMode = async (value: boolean) => {
    on = value;
    await vscode.commands.executeCommand('setContext', 'drawper.drawing', on);
    if (on) { status.show(); undo.show(); } else { status.hide(); undo.hide(); trail = []; }
  };

  const commit = async (editor: vscode.TextEditor) => {
    const points = trail;
    trail = [];
    if (points.length < 2) return;
    const m = editorMetrics();
    const path = points.map((p) => [p.character * m.charWidth, (p.line + 0.5) * m.lineHeight] as [number, number]);
    const end = points[points.length - 1];
    editor.selection = new vscode.Selection(end, end);
    const side = await ensureCanvas(editor);
    await writeCanvas(side, (doc) => addStroke(doc, editor.document.uri.toString(), path, m));
  };

  return vscode.Disposable.from(
    status,
    undo,
    vscode.commands.registerCommand('drawper.toggleDrawMode', async () => {
      const editor = activeSource();
      if (!on && !editor) return void vscode.window.showWarningMessage('Drawper: open a source file to draw on.');
      if (!on && editor) {
        await ensureCanvas(editor);
        void vscode.window.showInformationMessage('Drawper: drawing is on. Hold the mouse button and drag over your code. Click Drawing in the status bar to finish.');
      }
      await setMode(!on);
    }),
    vscode.commands.registerCommand('drawper.undoStroke', async () => {
      const editor = activeSource();
      if (editor) await writeCanvas(await ensureCanvas(editor), (doc) => undoStroke(doc, editor.document.uri.toString()));
    }),
    vscode.commands.registerCommand('drawper.clearDrawings', async () => {
      const editor = activeSource();
      if (editor) await writeCanvas(await ensureCanvas(editor), (doc) => clearStrokes(doc, editor.document.uri.toString()));
    }),
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (!on || e.kind !== vscode.TextEditorSelectionChangeKind.Mouse || e.textEditor !== activeSource()) return;
      trail.push(e.selections[0].active);
      clearTimeout(timer);
      timer = setTimeout(() => void commit(e.textEditor), 350);
    }),
    { dispose: () => clearTimeout(timer) },
  );
}
