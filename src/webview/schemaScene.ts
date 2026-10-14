import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import { Column, TableData, applyTags, shapeSkeleton } from './shapes';

export type SchemaTable = { name: string; columns: Column[] };

const GAP_X = 170;
const GAP_Y = 70;

const tableId = (name: string) => `tbl_${name}`;
const refTable = (ref?: string) => ref?.split('.')[0]?.trim();

function layers(tables: SchemaTable[]): Map<string, number> {
  const names = new Set(tables.map((t) => t.name));
  const deps = new Map(tables.map((t) => [t.name, new Set(t.columns.map((c) => refTable(c.ref)).filter((n): n is string => !!n && names.has(n) && n !== t.name))]));
  const depth = new Map<string, number>();
  const visit = (n: string, stack: Set<string>): number => {
    if (depth.has(n)) return depth.get(n)!;
    if (stack.has(n)) return 0;
    stack.add(n);
    const d = Math.max(-1, ...[...deps.get(n)!].map((m) => visit(m, stack))) + 1;
    stack.delete(n);
    depth.set(n, d);
    return d;
  };
  tables.forEach((t) => visit(t.name, new Set()));
  return depth;
}

export function buildSchemaScene(tables: SchemaTable[], prev: Map<string, { x: number; y: number }>): any[] {
  const data = (t: SchemaTable): TableData => ({ drawper: 'table', name: t.name, columns: t.columns });
  const sizes = new Map(tables.map((t) => {
    const s = shapeSkeleton(tableId(t.name), 0, 0, data(t));
    return [t.name, { width: s.width, height: s.height }] as const;
  }));
  const depth = layers(tables);
  const columns = new Map<number, SchemaTable[]>();
  tables.forEach((t) => columns.set(depth.get(t.name)!, [...(columns.get(depth.get(t.name)!) ?? []), t]));

  const pos = new Map<string, { x: number; y: number }>();
  const heights = [...columns.values()].map((ts) => ts.reduce((h, t) => h + sizes.get(t.name)!.height + GAP_Y, -GAP_Y));
  const tallest = Math.max(0, ...heights);
  let x = 0;
  [...columns.keys()].sort((a, b) => a - b).forEach((layer) => {
    const ts = columns.get(layer)!;
    let y = (tallest - ts.reduce((h, t) => h + sizes.get(t.name)!.height + GAP_Y, -GAP_Y)) / 2;
    for (const t of ts) { pos.set(t.name, { x, y }); y += sizes.get(t.name)!.height + GAP_Y; }
    x += Math.max(...ts.map((t) => sizes.get(t.name)!.width)) + GAP_X;
  });

  const skeletons: any[] = [];
  const tags: Record<string, unknown> = {};
  const groups = new Map<string, string>();
  for (const t of tables) {
    const p = prev.get(t.name) ?? pos.get(t.name)!;
    const s = shapeSkeleton(tableId(t.name), p.x, p.y, data(t));
    skeletons.push(...s.skeleton);
    Object.assign(tags, s.tags);
    for (const id of Object.keys(s.tags)) groups.set(id, `grp_${t.name}`);
  }

  const rects = new Map(tables.map((t) => [t.name, { ...(prev.get(t.name) ?? pos.get(t.name)!), ...sizes.get(t.name)!, table: t }]));
  const arrows: { id: string; from: string; to: string }[] = [];
  const ROW0 = 40 + 14;
  const topY = Math.min(...[...rects.values()].map((r) => r.y));
  for (const t of tables) t.columns.forEach((c, row) => {
    const target = refTable(c.ref);
    const a = rects.get(t.name)!, b = target && target !== t.name ? rects.get(target) : undefined;
    if (!b) return;
    const lh = (a.height - ROW0 - 14) / Math.max(1, t.columns.length);
    const col = c.ref!.split('.')[1];
    const trow = b.table.columns.findIndex((x) => x.name === col);
    const th = (b.height - ROW0 - 14) / Math.max(1, b.table.columns.length);
    const sy = a.y + ROW0 + row * lh + lh / 2;
    const ty = trow >= 0 ? b.y + ROW0 + trow * th + th / 2 : b.y + 20;
    const leftOf = b.x + b.width <= a.x + 1;
    const rightOf = a.x + a.width <= b.x + 1;
    const sx = leftOf ? a.x : a.x + a.width;
    const tx = leftOf ? b.x + b.width : rightOf ? b.x : b.x + b.width;
    const far = Math.abs(depth.get(t.name)! - depth.get(target!)!) > 1;
    const bow = far ? [[(tx - sx) / 2, topY - 56 - sy]] : [];
    const id = `fk_${t.name}_${c.name}`;
    arrows.push({ id, from: tableId(t.name), to: tableId(target!) });
    skeletons.push({
      type: 'arrow', id, x: sx, y: sy, points: [[0, 0], ...bow, [tx - sx, ty - sy]], strokeColor: '#2e2936', strokeWidth: 2, roughness: 0, strokeStyle: 'dashed',
      endArrowhead: 'arrow', startArrowhead: 'dot', roundness: { type: 2 },
    });
  });

  const converted = convertToExcalidrawElements(skeletons as any, { regenerateIds: false }) as any[];
  const bind = (id: string) => ({ elementId: id, focus: 0, gap: 4 });
  const links = new Map<string, { id: string; type: 'arrow' }[]>();
  for (const a of arrows) for (const r of [a.from, a.to]) links.set(r, [...(links.get(r) ?? []), { id: a.id, type: 'arrow' }]);
  return converted.map((e) => {
    const arrow = arrows.find((a) => a.id === e.id);
    if (arrow) return { ...e, customData: { drawper: 'fk' }, startBinding: bind(arrow.from), endBinding: bind(arrow.to) };
    const tagged = e.id in tags ? applyTags([e], tags, groups.get(e.id)!)[0] : e;
    return links.has(e.id) ? { ...tagged, boundElements: [...(tagged.boundElements ?? []), ...links.get(e.id)!] } : tagged;
  });
}
