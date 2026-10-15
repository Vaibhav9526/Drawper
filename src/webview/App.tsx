import type * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CaptureUpdateAction, Excalidraw, MainMenu, getSceneVersion, restoreElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import './panel.css';
import { Logo } from './brand';
import { Panel } from './Panel';
import { buildSchemaScene } from './schemaScene';
import { insertSvgMarkup } from './svgInsert';
import { vscode } from './vscode';

declare global {
  interface Window { DRAWPER_MODE?: 'editor' | 'viewer'; DRAWPER_TITLE?: string; DRAWPER_DOC?: any }
}

const FONT_NAMES: Record<number, string> = { 1: 'Virgil', 2: 'Helvetica', 3: 'Cascadia', 5: 'Excalifont', 6: 'Nunito', 7: '"Lilita One"', 8: '"Comic Shanns"' };
const viewer = window.DRAWPER_MODE === 'viewer';
const theme = () => (document.body.classList.contains('vscode-light') ? 'light' : 'dark');
const PAPER = '#fbf6ee';
const NEVER = { captureUpdate: CaptureUpdateAction.NEVER };

const PANEL_MIN = 240;
const PANEL_MAX = 720;
const PANEL_KEY = 'drawper.panelWidth';
const savedWidth = () => {
  try { return Math.min(PANEL_MAX, Math.max(PANEL_MIN, Number(localStorage.getItem(PANEL_KEY)) || 316)); } catch { return 316; }
};
const initialDoc = () => {
  const d = window.DRAWPER_DOC;
  return d ? { ...d, elements: restoreElements(d.elements, null) } : null;
};

const serialize = (els: readonly any[], appState: any, files: Record<string, any>) => {
  const live = els.filter((e) => !e.isDeleted);
  const used = new Set(live.filter((e) => e.fileId).map((e) => e.fileId));
  return {
    type: 'drawper', version: 2, elements: live,
    appState: { viewBackgroundColor: appState.viewBackgroundColor },
    files: Object.fromEntries(Object.entries(files).filter(([id]) => used.has(id))),
  };
};

export function App() {
  const [doc, setDoc] = useState<any>(initialDoc);
  const [panelWidth, setPanelWidth] = useState(savedWidth);
  const [error, setError] = useState('');
  const [api, setApi] = useState<any>(null);
  const [, setTick] = useState(0);
  const [selection, setSelection] = useState('');
  const [panelOpen, setPanelOpen] = useState(!viewer);
  const [mode, setMode] = useState<'dark' | 'light'>(theme());
  const [meta, setMeta] = useState({ source: window.DRAWPER_TITLE ?? '', dialect: [] as string[], tables: 0 });
  const elements = useRef<readonly any[]>(doc?.elements ?? []);
  const lastVersion = useRef(doc ? getSceneVersion(doc.elements) : -1);
  const timer = useRef(0);
  const pending = useRef<any>(null);
  const apiRef = useRef<any>(null);
  const [scope, setScope] = useState<'related' | 'all'>('related');
  const scopeRef = useRef<'related' | 'all'>('related');
  const schemaMsg = useRef<any>(null);
  const shown = useRef('');
  apiRef.current = api;

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (pending.current) vscode.postMessage({ type: 'edit', doc: pending.current });
    pending.current = null;
  }, []);

  const dimsTimer = useRef(0);
  const refreshDims = useCallback(() => {
    clearTimeout(dimsTimer.current);
    dimsTimer.current = window.setTimeout(async () => {
      const a = apiRef.current;
      if (!a) return;
      if (a.getAppState().cursorButton === 'down') return refreshDims();
      await Promise.all([...document.fonts].filter((f) => ['Cascadia', 'Nunito'].includes(f.family.replace(/"/g, ''))).map((f) => f.load().catch(() => f)));
      const all: any[] = a.getSceneElementsIncludingDeleted();
      const ctx = document.createElement('canvas').getContext('2d')!;
      let changed = false;
      const fixed = all.map((e) => {
        const family = e.type === 'text' && !e.isDeleted ? FONT_NAMES[e.fontFamily] : undefined;
        if (!family) return e;
        ctx.font = `${e.fontSize}px ${family}`;
        const width = Math.ceil(Math.max(...e.text.split('\n').map((l: string) => ctx.measureText(l).width)));
        if (Math.abs(width - e.width) < 2) return e;
        changed = true;
        const shift = e.id.endsWith('-n') ? (e.width - width) / 2 : 0;
        return { ...e, width, x: e.x + shift, version: e.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31) };
      });
      if (changed && a.getAppState().cursorButton !== 'down') a.updateScene({ elements: fixed, ...NEVER });
    }, 800);
  }, []);

  const showSchema = useCallback((m: any, relayout = false) => {
    schemaMsg.current = m;
    const prev = new Map<string, { x: number; y: number }>();
    if (!relayout) for (const e of elements.current) if (!e.isDeleted && e.customData?.drawper === 'table') prev.set(e.customData.name, { x: e.x, y: e.y });
    const keep = new Set<string>(m.related);
    const tables = scopeRef.current === 'all' ? m.tables : m.tables.filter((t: any) => keep.has(t.name));
    const signature = JSON.stringify(tables);
    const unchanged = !relayout && signature === shown.current && !!apiRef.current;
    shown.current = signature;
    const els = unchanged ? elements.current : buildSchemaScene(tables, prev);
    if (!unchanged) {
      elements.current = els;
      lastVersion.current = getSceneVersion(els);
    }
    setMeta({ source: m.source, dialect: m.dialect, tables: tables.length });
    if (!unchanged) refreshDims();
    if (!apiRef.current) return setDoc({ elements: els, appState: {}, files: {} });
    if (!unchanged) apiRef.current.updateScene({ elements: els, ...NEVER });
    const focus = els.find((e) => e.customData?.drawper === 'table' && e.customData.name === m.focus);
    if (focus) {
      apiRef.current.updateScene({ appState: { selectedElementIds: { [focus.id]: true }, selectedGroupIds: { [focus.groupIds[0]]: true } }, ...NEVER });
      apiRef.current.scrollToContent([focus], { animate: true, fitToViewport: false });
    } else if (!prev.size) apiRef.current.scrollToContent(els, { fitToViewport: true, viewportZoomFactor: 0.9 });
    setTick((t) => t + 1);
  }, [refreshDims]);

  useEffect(() => {
    if (!viewer || !api) return;
    const host = document.querySelector('.drawper-canvas');
    if (!host) return;
    let t = 0;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = window.setTimeout(() => api.scrollToContent(api.getSceneElements(), { fitToViewport: true, viewportZoomFactor: 0.9 }), 250);
    });
    ro.observe(host);
    return () => { ro.disconnect(); clearTimeout(t); };
  }, [api]);

  const changeScope = (next: 'related' | 'all') => {
    scopeRef.current = next;
    setScope(next);
    if (schemaMsg.current) showSchema({ ...schemaMsg.current, focus: undefined }, true);
  };

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const m = ev.data;
      if (m.type === 'error') return setError(m.message);
      if (m.type === 'schema') return showSchema(m);
      if (m.type !== 'load') return;
      setError('');
      const restored = restoreElements(m.doc.elements, null);
      if (getSceneVersion(restored) === lastVersion.current) return;
      lastVersion.current = getSceneVersion(restored);
      elements.current = restored;
      setDoc((prev: any) => {
        if (prev) apiRef.current?.updateScene({ elements: restored, appState: { viewBackgroundColor: m.doc.appState?.viewBackgroundColor }, ...NEVER });
        return prev ?? { ...m.doc, elements: restored };
      });
      if (m.doc.files) apiRef.current?.addFiles(Object.values(m.doc.files));
      setTick((t) => t + 1);
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'ready' });
    const mo = new MutationObserver(() => setMode(theme()));
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => { window.removeEventListener('message', onMessage); mo.disconnect(); };
  }, [showSchema]);

  useEffect(() => { if (api) refreshDims(); }, [api, refreshDims]);

  useEffect(() => {
    const keepUndoInside = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y')) e.stopPropagation();
    };
    const pasteSvg = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text/plain')?.trim() ?? '';
      if (!apiRef.current || !/^(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text)) return;
      if (insertSvgMarkup(apiRef.current, 'pasted', text)) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener('keydown', keepUndoInside);
    document.addEventListener('paste', pasteSvg, true);
    return () => { document.removeEventListener('keydown', keepUndoInside); document.removeEventListener('paste', pasteSvg, true); };
  }, [doc !== null]);

  const onChange = (els: readonly any[], appState: any, files: Record<string, any>) => {
      elements.current = els;
    const ids = Object.keys(appState.selectedElementIds).join(',');
    setSelection((s) => (s === ids ? s : ids));
    const version = getSceneVersion(els);
    if (version === lastVersion.current) return;
    lastVersion.current = version;
    setTick((t) => t + 1);
    refreshDims();
    if (viewer) return;
    pending.current = serialize(els, appState, files);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 300);
  };

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    let width = panelWidth;
    const move = (ev: PointerEvent) => {
      width = Math.min(PANEL_MAX, Math.max(PANEL_MIN, window.innerWidth - ev.clientX));
      setPanelWidth(width);
    };
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
      try { localStorage.setItem(PANEL_KEY, String(width)); } catch { /* storage unavailable */ }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  };

  const selectedTable = viewer
    ? elements.current.find((e) => !e.isDeleted && e.customData?.drawper === 'table' && selection.split(',').includes(e.id))
    : undefined;

  if (error) return <div className="drawper-error">{error}</div>;
  if (!doc) return <div className="drawper-loading">{viewer ? 'Reading schema…' : 'Loading…'}</div>;

  return (
    <div className="drawper-root" style={{ '--panel-w': `${panelWidth}px` } as React.CSSProperties}>
      <div className="drawper-canvas">
        <Excalidraw
          excalidrawAPI={setApi}
          initialData={{
            elements: doc.elements,
            appState: {
              viewBackgroundColor: doc.appState?.viewBackgroundColor ?? PAPER,
              currentItemFontFamily: 6, currentItemRoughness: 0, currentItemRoundness: 'round', currentItemStrokeWidth: 2, gridModeEnabled: true, gridSize: 20,
            },
            files: doc.files as any,
            scrollToContent: true,
          }}
          onChange={onChange}
          theme={mode}
          handleKeyboardGlobally
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: { saveFileToDisk: false } } }}
        >
          <MainMenu>
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.Separator />
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
          </MainMenu>
        </Excalidraw>
        <div className="drawper-top">
          <span className="brand"><Logo size={18} /><span className="lbl">Drawper</span></span>
          {viewer && <span className="chip" title={`${meta.source} · ${meta.dialect.join(' + ')}`}>{meta.tables} tables</span>}
          {viewer && <button title="Fit all tables" onClick={() => apiRef.current?.scrollToContent(apiRef.current.getSceneElements(), { fitToViewport: true, viewportZoomFactor: 0.9, animate: true })}>Fit</button>}
          {viewer && (
            <span className="seg" role="group" aria-label="Schema scope">
              <button className={scope === 'related' ? 'on' : ''} onClick={() => changeScope('related')}>Related</button>
              <button className={scope === 'all' ? 'on' : ''} onClick={() => changeScope('all')}>Whole app</button>
            </span>
          )}
          {viewer && selectedTable && <button onClick={() => vscode.postMessage({ type: 'goto', table: selectedTable.customData.name })}><span className="lbl">Go to </span>{selectedTable.customData.name}<span className="lbl"> in source</span></button>}
          {viewer && <button onClick={() => apiRef.current && vscode.postMessage({ type: 'saveAs', doc: serialize(apiRef.current.getSceneElements(), apiRef.current.getAppState(), apiRef.current.getFiles()) })} title="Save as .dpr">Save<span className="lbl"> as .dpr</span></button>}
          {!viewer && <button onClick={() => setPanelOpen((o) => !o)}>{panelOpen ? 'Hide' : 'Show'} panels</button>}
        </div>
      </div>
      {panelOpen && !viewer && api && <div className="drawper-resizer" onPointerDown={startResize} role="separator" aria-orientation="vertical" />}
      {panelOpen && !viewer && api && <Panel api={api} elements={elements.current} selection={selection} flush={flush} />}
    </div>
  );
}
