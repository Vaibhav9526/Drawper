declare const acquireVsCodeApi: () => { postMessage(m: unknown): void };
export const vscode = acquireVsCodeApi();
