import * as vscode from 'vscode';
import { ChildProcess, spawn } from 'child_process';

/**
 * Freehand drawing over the real editor. VS Code cannot host a transparent layer, so on Windows a small helper script
 * opens a see-through, always-on-top ink window over the VS Code window (like a screen annotation tool).
 */
export function registerScreenDraw(ctx: vscode.ExtensionContext): vscode.Disposable {
  let child: ChildProcess | undefined;
  const stop = () => { child?.kill(); child = undefined; };

  const toggle = () => {
    if (child) return stop();
    if (process.platform !== 'win32') {
      return void vscode.window.showInformationMessage('Drawper: drawing over the editor currently works on Windows only. Use "Open Canvas for This Code" instead.');
    }
    const script = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'overlay', 'draw-overlay.ps1').fsPath;
    const started = Date.now();
    let errors = '';
    const proc = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script], { windowsHide: true });
    child = proc;
    proc.stderr?.on('data', (d) => { errors += String(d); });
    proc.on('exit', (code) => {
      if (child === proc) child = undefined;
      if (code && Date.now() - started < 15000) void vscode.window.showErrorMessage(`Drawper: could not start the drawing layer. ${errors.trim().split('\n')[0] ?? ''}`);
    });
    void vscode.window.showInformationMessage('Drawper: draw anywhere on the editor with the mouse. Use the toolbar at the top right (Scroll lets you use the editor, Copy copies a screenshot). Press Esc or Done to finish.');
  };

  return vscode.Disposable.from(vscode.commands.registerCommand('drawper.screenDraw', toggle), { dispose: stop });
}
