import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import { iconFile } from './icons';

export type Column = { name: string; type: string; pk?: boolean; nullable?: boolean; unique?: boolean; ref?: string };
export type ServiceData = { drawper: 'service'; kind: string; name: string; tech?: string; icon?: string };
export type TableData = { drawper: 'table'; name: string; columns: Column[] };
export type ShapeData = ServiceData | TableData;

export const KINDS: Record<string, { stroke: string; fill: string }> = {
  client: { stroke: '#0b7285', fill: '#e6f4f1' },
  api: { stroke: '#5c940d', fill: '#f0f5e1' },
  worker: { stroke: '#e67700', fill: '#fff3d6' },
  gateway: { stroke: '#a61e4d', fill: '#fbe9ef' },
  db: { stroke: '#c92a2a', fill: '#fdecea' },
  cache: { stroke: '#eaaa2a', fill: '#fff3d0' },
  queue: { stroke: '#8f3f71', fill: '#f6e8f1' },
  storage: { stroke: '#7f5539', fill: '#f3e9df' },
};
export const TABLE_STYLE = { stroke: '#2e2936', band: '#ffd900', fill: '#fffdf0' };
export const TYPES = ['int', 'bigint', 'text', 'varchar', 'boolean', 'timestamp', 'date', 'uuid', 'json', 'float'];

const FONT = 6;
const MONO = 3;
const uid = () => Math.random().toString(36).slice(2, 12);
const nonce = () => Math.floor(Math.random() * 2 ** 31);

export const kindIconFile = (kind: string) => iconFile(KINDS[kind] ? kind : 'api', (KINDS[kind] ?? KINDS.api).stroke);
export const serviceLabel = (d: ServiceData) => `${d.name}\n${d.kind.toUpperCase()}${d.tech ? ' · ' + d.tech : ''}`;

export function tableRows(d: TableData): string {
  const rows = d.columns.map((c) => [c.name, c.type, [c.pk && 'PK', c.ref && `FK→${c.ref}`, c.unique && 'UQ', c.nullable && 'NULL'].filter(Boolean).join(' ')]);
  if (!rows.length) return '(no columns)';
  const w0 = Math.max(...rows.map((r) => r[0].length));
  const w1 = Math.max(...rows.map((r) => r[1].length));
  return rows.map((r) => `${r[0].padEnd(w0)}  ${r[1].padEnd(w1)}  ${r[2]}`.trimEnd()).join('\n');
}

type Skel = NonNullable<Parameters<typeof convertToExcalidrawElements>[0]>[number];
type Tags = Record<string, unknown>;

const MONO_ADVANCE = 0.62;
const KEEP_IDS = { regenerateIds: false };

function measure(text: string, fontSize: number, fontFamily: number): { width: number; height: number } {
  const [t] = convertToExcalidrawElements([{ type: 'text', x: 0, y: 0, text, fontSize, fontFamily } as Skel]) as any[];
  if (fontFamily !== MONO) return { width: t.width * 1.08, height: t.height };
  const widest = Math.max(...text.split('\n').map((l) => l.length));
  return { width: Math.max(t.width, widest * fontSize * MONO_ADVANCE), height: t.height };
}

export function shapeSkeleton(id: string, x: number, y: number, data: ShapeData): { skeleton: Skel[]; width: number; height: number; tags: Tags } {
  const part = (suffix: string) => `${id}-${suffix}`;
  const tags: Tags = { [id]: data };
  const mark = (pid: string) => (tags[pid] = { drawper: 'part', of: id });

  if (data.drawper === 'service') {
    const style = KINDS[data.kind] ?? KINDS.api;
    const text = serviceLabel(data);
    const t = measure(text, 18, FONT);
    const width = Math.max(220, 76 + t.width + 20);
    const height = Math.max(88, t.height + 36);
    const iconId = data.icon ?? kindIconFile(data.kind).id;
    mark(part('i')); mark(part('t'));
    return {
      width, height, tags,
      skeleton: [
        { type: 'rectangle', id, x, y, width, height, strokeColor: style.stroke, backgroundColor: style.fill, fillStyle: 'solid', roughness: 0, strokeWidth: 2, roundness: { type: 3 } },
        { type: 'image', id: part('i'), fileId: iconId, x: x + 18, y: y + (height - 44) / 2, width: 44, height: 44, status: 'saved' },
        { type: 'text', id: part('t'), x: x + 76, y: y + (height - t.height) / 2, text, fontSize: 18, fontFamily: FONT, textAlign: 'left', strokeColor: '#2b2118' },
      ] as Skel[],
    };
  }

  const title = measure(data.name, 18, FONT);
  const rows = tableRows(data);
  const body = measure(rows, 15, MONO);
  const band = 40;
  const width = Math.max(220, title.width + 40, body.width + 36);
  const height = band + body.height + 28;
  mark(part('h')); mark(part('n')); mark(part('t'));
  return {
    width, height, tags,
    skeleton: [
      { type: 'rectangle', id, x, y, width, height, strokeColor: TABLE_STYLE.stroke, backgroundColor: TABLE_STYLE.fill, fillStyle: 'solid', roughness: 0, strokeWidth: 2, roundness: { type: 3 } },
      { type: 'rectangle', id: part('h'), x, y, width, height: band, strokeColor: TABLE_STYLE.stroke, backgroundColor: TABLE_STYLE.band, fillStyle: 'solid', roughness: 0, strokeWidth: 2, roundness: { type: 3 } },
      { type: 'text', id: part('n'), x: x + (width - title.width) / 2, y: y + (band - title.height) / 2, text: data.name, fontSize: 18, fontFamily: FONT, strokeColor: '#2e2936' },
      { type: 'text', id: part('t'), x: x + 18, y: y + band + 14, text: rows, fontSize: 15, fontFamily: MONO, textAlign: 'left', strokeColor: '#2b2118' },
    ] as Skel[],
  };
}

export function applyTags(elements: any[], tags: Tags, groupId: string): any[] {
  return elements.map((e) => (e.id in tags ? { ...e, groupIds: [groupId], customData: tags[e.id] } : e));
}

export function createShape(data: ShapeData, x: number, y: number): any[] {
  const id = uid();
  const { skeleton, tags } = shapeSkeleton(id, x, y, data);
  return applyTags(convertToExcalidrawElements(skeleton, KEEP_IDS) as any[], tags, uid());
}

export function updateShape(all: readonly any[], rectId: string, data: ShapeData): any[] {
  const rect = all.find((e) => e.id === rectId);
  if (!rect) return [...all];
  const { skeleton, tags } = shapeSkeleton(rectId, rect.x, rect.y, data);
  const groupId = rect.groupIds?.[0] ?? uid();
  const fresh = applyTags(convertToExcalidrawElements(skeleton, KEEP_IDS) as any[], tags, groupId).map((e) => {
    const old = all.find((o) => o.id === e.id);
    return { ...e, version: (old?.version ?? 0) + 1, versionNonce: nonce(), seed: old?.seed ?? e.seed, boundElements: e.id === rectId ? old?.boundElements ?? null : e.boundElements };
  });
  const isPart = (e: any) => e.customData?.of === rectId;
  const out: any[] = [];
  for (const e of all) {
    if (e.id === rectId) out.push(...fresh);
    else if (isPart(e) && !fresh.some((f) => f.id === e.id)) out.push({ ...e, isDeleted: true, version: e.version + 1, versionNonce: nonce() });
    else if (!fresh.some((f) => f.id === e.id)) out.push(e);
  }
  return out;
}

export const partsOf = (all: readonly any[], rectId: string) => all.filter((e) => !e.isDeleted && e.customData?.of === rectId);
