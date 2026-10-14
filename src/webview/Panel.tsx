import { useEffect, useRef, useState } from 'react';
import { CaptureUpdateAction } from '@excalidraw/excalidraw';
import { Logo } from './brand';
import { CATEGORIES, IconFile, iconFile, iconSvg, importedSvgFile, toDataUrl } from './icons';
import { Column, KINDS, ServiceData, ShapeData, TYPES, TableData, createShape, kindIconFile, partsOf, updateShape } from './shapes';
import { freeSpot, insertImage, insertSvgMarkup } from './svgInsert';
import { vscode } from './vscode';
import { tableEdges } from '../model';
import { fkColumnFor } from '../relations';

type Props = { api: any; elements: readonly any[]; selection: string; flush: () => void };
type Tab = 'arch' | 'schema' | 'icons';

type Capture = { captureUpdate: (typeof CaptureUpdateAction)[keyof typeof CaptureUpdateAction] };
const NOW: Capture = { captureUpdate: CaptureUpdateAction.IMMEDIATELY };
const TYPING: Capture = { captureUpdate: CaptureUpdateAction.EVENTUALLY };
const SWATCHES = ['#ffd900', '#eaaa2a', '#ec5451', '#87dac7', '#5c940d', '#0b7285', '#a61e4d', '#2e2936'];
const live = (els: readonly any[], kind: string) => els.filter((e) => !e.isDeleted && e.customData?.drawper === kind);
const iconUrl = (name: string, color: string) => toDataUrl(iconSvg(name, color));

function Ico({ name, color = 'currentColor', size = 16 }: { name: string; color?: string; size?: number }) {
  return <img className="ico" width={size} height={size} src={iconUrl(name, color)} alt="" />;
}

/** Keeps foreign keys in other tables pointing at a table or column that was just renamed. */
function syncRefs(els: any[], before: TableData, after: TableData): any[] {
  const renames = new Map<string, string>();
  before.columns.forEach((c, i) => {
    const col = after.columns.length === before.columns.length ? after.columns[i].name : c.name;
    if (before.name !== after.name || c.name !== col) renames.set(`${before.name}.${c.name}`, `${after.name}.${col}`);
  });
  if (!renames.size) return els;
  let out = els;
  for (const rect of live(els, 'table')) {
    const data = rect.customData as TableData;
    if (!data.columns.some((c) => c.ref && renames.has(c.ref))) continue;
    out = updateShape(out, rect.id, { ...data, columns: data.columns.map((c) => (c.ref && renames.has(c.ref) ? { ...c, ref: renames.get(c.ref) } : c)) });
  }
  return out;
}

export function Panel({ api, elements, selection, flush }: Props) {
  const [tab, setTab] = useState<Tab>('arch');
  const selected = new Set(selection.split(',').filter(Boolean));
  const current = elements.find((e) => !e.isDeleted && selected.has(e.id) && ['service', 'table'].includes(e.customData?.drawper));
  const effectiveTab = tab;
  const currentId = current?.id;
  const currentKind = current?.customData.drawper;
  useEffect(() => {
    if (currentKind) setTab((t) => (t === 'icons' ? t : currentKind === 'table' ? 'schema' : 'arch'));
  }, [currentId, currentKind]);
  const services = live(elements, 'service');
  const tables = live(elements, 'table');
  const data = current?.customData;

  const focus = (rect: any) => {
    const ids = [rect.id, ...partsOf(api.getSceneElements(), rect.id).map((p: any) => p.id)];
    api.updateScene({ appState: { selectedElementIds: Object.fromEntries(ids.map((i) => [i, true])), selectedGroupIds: { [rect.groupIds[0]]: true } }, captureUpdate: CaptureUpdateAction.NEVER });
    api.scrollToContent([rect], { animate: true });
  };

  const add = (shape: ShapeData) => {
    const [x, y] = freeSpot(api);
    const made = createShape(shape, x, y);
    api.addFiles([shape.drawper === 'service' ? kindIconFile(shape.kind) : kindIconFile('db')]);
    api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...made], ...NOW });
    focus(made[0]);
  };

  const patch = (next: ShapeData, capture = TYPING) => {
    if (!current) return;
    if (next.drawper === 'service') api.addFiles([kindIconFile(next.kind)]);
    let els = updateShape(api.getSceneElementsIncludingDeleted(), current.id, next);
    if (next.drawper === 'table' && current.customData.drawper === 'table') els = syncRefs(els, current.customData, next);
    api.updateScene({ elements: els, ...capture });
  };

  // An arrow between two tables is a relation: add the foreign-key column on the table the arrow starts from.
  const missing = tableEdges({ elements: [...elements] }).filter(({ from, to }) => !from.columns.some((c) => c.ref?.split('.')[0] === to.name));
  const missingKey = missing.map(({ from, to }) => `${from.id}>${to.id}`).join();
  useEffect(() => {
    if (!missingKey) return;
    const pending = tableEdges({ elements: [...api.getSceneElementsIncludingDeleted()] });
    let els: any[] = api.getSceneElementsIncludingDeleted();
    const grown = new Map<string, any[]>();
    for (const { from, to } of pending) {
      const cols = grown.get(from.id) ?? [...from.columns];
      if (cols.some((c) => c.ref?.split('.')[0] === to.name)) continue;
      cols.push(fkColumnFor({ ...from, columns: cols }, to));
      grown.set(from.id, cols);
    }
    if (!grown.size) return;
    for (const [id, columns] of grown) {
      const rect = els.find((e) => e.id === id);
      els = updateShape(els, id, { ...(rect.customData as TableData), columns });
    }
    api.updateScene({ elements: els, ...NOW });
  }, [missingKey]);

  const remove = (rect: any) => {
    const gone = new Set([rect.id, ...partsOf(api.getSceneElements(), rect.id).map((p: any) => p.id)]);
    api.updateScene({
      elements: api.getSceneElementsIncludingDeleted().map((e: any) => (gone.has(e.id) ? { ...e, isDeleted: true, version: e.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31) } : e)),
      appState: { selectedElementIds: {} }, ...NOW,
    });
  };

  const useIcon = (file: IconFile, width = 64, height = 64) => {
    if (current?.customData.drawper === 'service') { api.addFiles([file]); return patch({ ...current.customData, icon: file.id }, NOW); }
    insertImage(api, file, width, height);
  };

  const generate = (target: string) => { flush(); vscode.postMessage({ type: 'generate', target }); };

  const connections = (rect: any) => {
    const byId = new Map(services.map((s) => [s.id, s.customData.name]));
    const out: string[] = [], inn: string[] = [];
    for (const a of elements) {
      if (a.isDeleted || a.type !== 'arrow') continue;
      const from = byId.get(a.startBinding?.elementId), to = byId.get(a.endBinding?.elementId);
      if (a.startBinding?.elementId === rect.id && to) out.push(to);
      if (a.endBinding?.elementId === rect.id && from) inn.push(from);
    }
    return { out, inn };
  };

  return (
    <aside className="drawper-panel">
      <header>
        <Logo size={26} />
        <div><strong>Drawper</strong><span>{services.length} {services.length === 1 ? 'component' : 'components'} · {tables.length} {tables.length === 1 ? 'table' : 'tables'}</span></div>
      </header>
      <nav className="tabs">
        {([['arch', 'layers', 'Architecture'], ['schema', 'table', 'Schema'], ['icons', 'image', 'Icons']] as const).map(([id, ic, label]) => (
          <button key={id} className={effectiveTab === id ? 'active' : ''} onClick={() => setTab(id)}><Ico name={ic} size={14} />{label}</button>
        ))}
      </nav>
      <div className="body">
        {effectiveTab === 'arch' && (
          <>
            <h4>Add component</h4>
            <div className="tiles">
              {Object.entries(KINDS).map(([kind, c]) => (
                <button key={kind} className="tile" style={{ ['--c' as string]: c.stroke }} onClick={() => add({ drawper: 'service', kind, name: kind, tech: '' })}>
                  <Ico name={kind} color={c.stroke} size={22} />{kind}
                </button>
              ))}
            </div>
            <p className="hint">Draw arrows between components with the Arrow tool (A). Arrows attached at both ends become dependencies in the generated docker-compose.</p>

            <h4>Components <em>{services.length}</em></h4>
            {services.map((s) => (
              <div key={s.id} className={`item ${current?.id === s.id ? 'sel' : ''}`} onClick={() => focus(s)}>
                <Ico name={KINDS[s.customData.kind] ? s.customData.kind : 'api'} color={KINDS[s.customData.kind]?.stroke} />
                <span className="grow">{s.customData.name}</span>
                <span className="chip">{s.customData.kind}</span>
                <button className="x" title="Delete" onClick={(e) => { e.stopPropagation(); remove(s); }}>✕</button>
              </div>
            ))}
            {!services.length && <p className="empty">No components yet. Pick one above to place it on the canvas.</p>}

            {data?.drawper === 'service' && (
              <div className="card">
                <h4>Component</h4>
                <label className="field">Name<input value={data.name} onChange={(e) => patch({ ...data, name: e.target.value })} /></label>
                <div className="two">
                  <label className="field">Kind<select value={data.kind} onChange={(e) => patch({ ...data, kind: e.target.value }, NOW)}>{Object.keys(KINDS).map((k) => <option key={k}>{k}</option>)}</select></label>
                  <label className="field">Technology<input value={data.tech ?? ''} placeholder="postgres, redis…" onChange={(e) => patch({ ...data, tech: e.target.value })} /></label>
                </div>
                <div className="row">
                  <button onClick={() => setTab('icons')}>Change icon…</button>
                  {data.icon && <button onClick={() => patch({ ...data, icon: undefined }, NOW)}>Reset icon</button>}
                </div>
                {(() => {
                  const { out, inn } = connections(current);
                  return (
                    <div className="links">
                      <div><b>Depends on</b>{out.length ? out.map((n) => <span className="chip" key={n}>{n}</span>) : <i>nothing</i>}</div>
                      <div><b>Used by</b>{inn.length ? inn.map((n) => <span className="chip" key={n}>{n}</span>) : <i>nothing</i>}</div>
                    </div>
                  );
                })()}
              </div>
            )}

            <div className="card">
              <h4>Generate</h4>
              <p className="hint">docker-compose.yml plus a runnable Node scaffold for every api, worker and gateway.</p>
              <button className="primary wide" onClick={() => generate('compose')}>Generate docker-compose</button>
            </div>
          </>
        )}

        {effectiveTab === 'schema' && (
          <>
            <button className="primary wide" onClick={() => add({ drawper: 'table', name: `table_${tables.length + 1}`, columns: [{ name: 'id', type: 'int', pk: true }] })}>+ New table</button>
            <h4>Tables <em>{tables.length}</em></h4>
            {tables.map((t) => (
              <div key={t.id} className={`item ${current?.id === t.id ? 'sel' : ''}`} onClick={() => focus(t)}>
                <Ico name="table" color="#c99a00" />
                <span className="grow">{t.customData.name}</span>
                <span className="chip">{t.customData.columns.length} {t.customData.columns.length === 1 ? 'col' : 'cols'}</span>
                <button className="x" title="Delete" onClick={(e) => { e.stopPropagation(); remove(t); }}>✕</button>
              </div>
            ))}
            {!tables.length && <p className="empty">No tables yet. Create one here, or open a file that defines a schema and use the “View in Drawper” lens above it.</p>}
            {tables.length > 1 && <p className="hint">Draw an arrow from one table to another (Arrow tool, A) to create a relation. The foreign key column is added to the table the arrow starts from.</p>}
            {data?.drawper === 'table' && <TableForm data={data} tables={tables.map((t) => t.customData as TableData)} patch={patch} />}
            <div className="card">
              <h4>Generate code</h4>
              <div className="row wrap">
                <button className="primary" onClick={() => generate('sql')}>SQL</button>
                <button className="primary" onClick={() => generate('prisma')}>Prisma</button>
                <button className="primary" onClick={() => generate('drizzle')}>Drizzle</button>
                <button className="primary" onClick={() => generate('typescript')}>TS types</button>
                <button className="primary" onClick={() => generate('queries')} title="SQL joins and Drizzle / Prisma relation queries">Relation queries</button>
              </div>
            </div>
          </>
        )}

        {effectiveTab === 'icons' && <IconsTab api={api} elements={elements} useIcon={useIcon} target={current?.customData.drawper === 'service' ? current.customData.name : undefined} />}
      </div>
    </aside>
  );
}

function IconsTab({ api, elements, useIcon, target }: { api: any; elements: readonly any[]; useIcon: (f: IconFile, w?: number, h?: number) => void; target?: string }) {
  const [color, setColor] = useState('#ffd900');
  const [query, setQuery] = useState('');
  const [markup, setMarkup] = useState('');
  const [files, setFiles] = useState<{ uri: string; label: string }[]>([]);
  const ref = useRef(useIcon);
  ref.current = useIcon;

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const m = ev.data;
      if (m.type === 'svgList') setFiles(m.items);
      if (m.type === 'svgFile') {
        const imported = importedSvgFile(m.name, m.svg);
        if (imported) ref.current(imported.file, imported.width, imported.height);
      }
    };
    window.addEventListener('message', onMessage);
    vscode.postMessage({ type: 'listSvgs' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const q = query.toLowerCase();
  const used = [...new Set(elements.filter((e) => !e.isDeleted && e.type === 'image' && e.fileId).map((e) => e.fileId as string))];
  const stored = api.getFiles();
  const svgs = files.filter((f) => f.label.toLowerCase().includes(q));

  return (
    <>
      <h4>{target ? `Icon for “${target}”` : 'Insert icon'}</h4>
      <input className="search" value={query} placeholder="Search 59 icons…" onChange={(e) => setQuery(e.target.value)} />
      <div className="swatches">
        {SWATCHES.map((c) => <button key={c} className={c === color ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} title={c} />)}
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title="Custom colour" />
      </div>
      {Object.entries(CATEGORIES).map(([cat, names]) => {
        const hits = names.filter((n) => n.includes(q) || cat.toLowerCase().includes(q));
        return hits.length ? (
          <section key={cat}>
            <h5>{cat}</h5>
            <div className="icon-grid">
              {hits.map((n) => <button key={n} title={n} onClick={() => useIcon(iconFile(n, color))}><img src={iconUrl(n, color)} alt={n} /></button>)}
            </div>
          </section>
        ) : null;
      })}

      <div className="card">
        <h4>Your SVGs</h4>
        <div className="row"><button className="primary" onClick={() => vscode.postMessage({ type: 'importSvg' })}>Import SVG files…</button></div>
        <textarea value={markup} rows={3} placeholder="…or paste SVG code here (you can also paste it straight onto the canvas)" onChange={(e) => setMarkup(e.target.value)} />
        <div className="row"><button disabled={!/<svg[\s>]/i.test(markup)} onClick={() => { if (insertSvgMarkup(api, 'pasted', markup)) setMarkup(''); }}>Insert pasted SVG</button></div>
        {svgs.map((f) => <div key={f.uri} className="item" onClick={() => vscode.postMessage({ type: 'readSvg', uri: f.uri })}><Ico name="file" /><span className="grow">{f.label}</span></div>)}
        {!svgs.length && <p className="hint">SVG files in your workspace show up here. Click one to use it.</p>}
      </div>

      {used.length > 0 && (
        <div className="card">
          <h4>In this diagram</h4>
          <div className="icon-grid">
            {used.map((id) => stored[id] && <button key={id} title={id} onClick={() => useIcon(stored[id])}><img src={stored[id].dataURL} alt="" /></button>)}
          </div>
        </div>
      )}
    </>
  );
}

function TableForm({ data, tables, patch }: { data: TableData; tables: TableData[]; patch: (d: TableData, c?: Capture) => void }) {
  const fkOptions = tables.flatMap((t) => t.columns.map((c) => `${t.name}.${c.name}`));
  const setCols = (columns: Column[], capture = TYPING) => patch({ ...data, columns: columns.map((c) => (c.ref ? c : { ...c, ref: undefined })) }, capture);
  const setCol = (i: number, c: Partial<Column>, capture = TYPING) => setCols(data.columns.map((x, j) => (j === i ? { ...x, ...c } : x)), capture);
  const move = (i: number, d: number) => {
    const next = [...data.columns];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setCols(next, NOW);
  };
  const addCols = (...c: Column[]) => setCols([...data.columns, ...c], NOW);
  return (
    <div className="card">
      <h4>Table</h4>
      <label className="field">Name<input value={data.name} onChange={(e) => patch({ ...data, name: e.target.value })} /></label>
      {data.columns.map((c, i) => (
        <div className="col" key={i}>
          <div className="two">
            <input value={c.name} placeholder="column" onChange={(e) => setCol(i, { name: e.target.value })} />
            <select value={c.type} onChange={(e) => setCol(i, { type: e.target.value }, NOW)}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          </div>
          <div className="flags">
            {([['pk', 'PK'], ['nullable', 'NULL'], ['unique', 'UQ']] as const).map(([k, label]) => (
              <button key={k} className={`flag ${c[k] ? 'on' : ''}`} onClick={() => setCol(i, { [k]: !c[k] }, NOW)}>{label}</button>
            ))}
            <select className="fk" value={c.ref ?? ''} onChange={(e) => setCol(i, { ref: e.target.value || undefined }, NOW)} title="Foreign key">
              <option value="">no FK</option>
              {c.ref && !fkOptions.includes(c.ref) && <option>{c.ref}</option>}
              {fkOptions.map((o) => <option key={o}>{o}</option>)}
            </select>
            <button className="x" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">↑</button>
            <button className="x" disabled={i === data.columns.length - 1} onClick={() => move(i, 1)} title="Move down">↓</button>
            <button className="x" onClick={() => setCols(data.columns.filter((_, j) => j !== i), NOW)} title="Delete column">✕</button>
          </div>
        </div>
      ))}
      <div className="row wrap">
        <button onClick={() => addCols({ name: `col_${data.columns.length + 1}`, type: 'text' })}>+ Column</button>
        <button onClick={() => addCols({ name: 'created_at', type: 'timestamp' }, { name: 'updated_at', type: 'timestamp' })}>+ Timestamps</button>
        {!data.columns.some((c) => c.pk) && <button onClick={() => setCols([{ name: 'id', type: 'int', pk: true }, ...data.columns], NOW)}>+ id</button>}
      </div>
    </div>
  );
}
