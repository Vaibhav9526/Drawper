import { Column, TableElement } from './model';

export interface Relation {
  from: TableElement;
  column: Column;
  to: TableElement;
  target: Column;
  /** field on `from` that points at one `to` row */
  one: string;
  /** field on `to` that lists `from` rows */
  many: string;
}

const ident = (s: string) => s.trim().replace(/[^A-Za-z0-9_]/g, '_') || '_';

export function singular(name: string): string {
  const n = ident(name);
  if (/ies$/i.test(n)) return n.replace(/ies$/i, 'y');
  if (/(ss|us)$/i.test(n)) return n;
  return n.replace(/s$/i, '');
}

const pkOf = (t: TableElement) => t.columns.find((c) => c.pk) ?? t.columns[0];

export function fkColumnFor(from: TableElement, to: TableElement): Column {
  const target = pkOf(to);
  const taken = new Set(from.columns.map((c) => c.name));
  let name = `${singular(to.name)}_${target?.name ?? 'id'}`;
  for (let i = 2; taken.has(name); i++) name = `${singular(to.name)}_${target?.name ?? 'id'}_${i}`;
  return { name, type: target?.type ?? 'int', nullable: true, ref: `${to.name}.${target?.name ?? 'id'}` };
}

/** Adds a foreign-key column for every arrow edge that has no matching reference yet. */
export function withArrowRelations(all: TableElement[], edges: { from: TableElement; to: TableElement }[]): TableElement[] {
  const out = all.map((t) => ({ ...t, columns: [...t.columns] }));
  for (const e of edges) {
    const from = out.find((t) => t.id === e.from.id);
    const to = out.find((t) => t.id === e.to.id);
    if (!from || !to || from.columns.some((c) => c.ref?.split('.')[0] === to.name)) continue;
    from.columns.push(fkColumnFor(from, to));
  }
  return out;
}

export function relationsOf(all: TableElement[]): Relation[] {
  const used = new Map(all.map((t) => [t.name, new Set(t.columns.map((c) => c.name))]));
  const claim = (table: string, wanted: string) => {
    const set = used.get(table)!;
    let name = wanted;
    for (let i = 2; set.has(name); i++) name = `${wanted}_${i}`;
    set.add(name);
    return name;
  };
  const rels: Relation[] = [];
  for (const from of all) {
    for (const column of from.columns) {
      const [tn, cn] = (column.ref ?? '').split('.').map((p) => p.trim());
      const to = all.find((t) => t.name === tn);
      const target = to?.columns.find((c) => c.name === (cn || pkOf(to)?.name));
      if (!to || !target) continue;
      const base = ident(column.name).replace(/_?id$/i, '') || singular(to.name);
      const pairs = all.flatMap((t) => t.columns).filter((c) => c.ref?.split('.')[0] === to.name && from.columns.includes(c)).length;
      const one = claim(from.name, base === ident(column.name) ? `${base}_rel` : base);
      const many = claim(to.name, pairs > 1 ? `${ident(from.name)}_by_${ident(column.name)}` : ident(from.name));
      rels.push({ from, column, to, target, one, many });
    }
  }
  return rels;
}
