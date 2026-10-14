import { Column, ColumnType } from './model';

export interface ParsedTable {
  name: string;
  columns: Column[];
  line: number;
}

export interface ParsedSchema {
  tables: ParsedTable[];
  dialect: string[];
}

const lineAt = (text: string, index: number) => text.slice(0, index).split('\n').length - 1;
const unq = (s: string) => s.trim().replace(/["'`\[\]]/g, '');
const bare = (s: string) => unq(s).split('.').pop()!;

export function mapType(raw: string): ColumnType {
  const t = raw.toLowerCase();
  if (/bigint|bigserial|int8|biginteger/.test(t)) return 'bigint';
  if (/uuid|guid/.test(t)) return 'uuid';
  if (/bool|bit\b/.test(t)) return 'boolean';
  if (/json/.test(t)) return 'json';
  if (/timestamp|datetime|time/.test(t)) return 'timestamp';
  if (/date/.test(t)) return 'date';
  if (/float|double|real|decimal|numeric|money/.test(t)) return 'float';
  if (/int|serial|number/.test(t)) return 'int';
  if (/varchar|char|string|enum|slug|email|url/.test(t)) return 'varchar';
  return 'text';
}

function stripComments(text: string, line = true): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  let out = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (line) out = out.replace(/(^|[^:'"`])(--|\/\/)[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
  return out;
}

function balanced(text: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const o = text[open];
  const c = pairs[o];
  let depth = 0;
  let quote = '';
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === o) depth++;
    else if (ch === c && --depth === 0) return i;
  }
  return -1;
}

function splitTop(body: string, sep = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      cur += ch;
      if (ch === '\\') cur += body[++i] ?? '';
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function parsePrisma(raw: string): ParsedTable[] {
  const text = stripComments(raw);
  const models: { name: string; table: string; body: string; line: number }[] = [];
  for (const m of text.matchAll(/^\s*model\s+(\w+)\s*\{/gm)) {
    const open = m.index! + m[0].length - 1;
    const end = balanced(text, open);
    if (end > 0) models.push({ name: m[1], table: text.slice(open + 1, end).match(/@@map\(\s*["'](\w+)["']/)?.[1] ?? m[1], body: text.slice(open + 1, end), line: lineAt(text, m.index! + m[0].indexOf('model')) });
  }
  const names = new Set(models.map((m) => m.name));
  const tableOf = new Map(models.map((m) => [m.name, m.table]));
  return models.map(({ table: name, body, line }) => {
    const columns: Column[] = [];
    const relations: { fields: string[]; target: string; refs: string[] }[] = [];
    for (const l of body.split('\n')) {
      const f = l.trim().match(/^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/);
      if (!f || l.trim().startsWith('@@')) continue;
      const [, fname, ftype, list, opt, attrs] = f;
      if (names.has(ftype)) {
        const rel = attrs.match(/@relation\([^)]*fields:\s*\[([^\]]+)\][^)]*references:\s*\[([^\]]+)\]/);
        if (rel && !list) relations.push({ fields: rel[1].split(',').map((s) => s.trim()), target: tableOf.get(ftype) ?? ftype, refs: rel[2].split(',').map((s) => s.trim()) });
        continue;
      }
      columns.push({ name: fname, type: mapType(attrs.match(/@db\.(\w+)/)?.[1] ?? ftype), pk: /@id\b/.test(attrs) || undefined, unique: /@unique\b/.test(attrs) || undefined, nullable: !!opt || undefined });
    }
    for (const r of relations) r.fields.forEach((fld, i) => { const c = columns.find((x) => x.name === fld); if (c) c.ref = `${r.target}.${r.refs[i] ?? r.refs[0]}`; });
    const compound = body.match(/@@id\(\s*\[([^\]]+)\]/);
    if (compound) compound[1].split(',').forEach((n) => { const c = columns.find((x) => x.name === n.trim()); if (c) c.pk = true; });
    return { name, columns, line };
  });
}

function parseSql(raw: string): ParsedTable[] {
  const text = stripComments(raw);
  const tables: ParsedTable[] = [];
  const re = /create\s+(?:or\s+replace\s+)?(?:temp(?:orary)?\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w."`\[\]]+)\s*\(/gi;
  for (const m of text.matchAll(re)) {
    const open = m.index! + m[0].length - 1;
    const end = balanced(text, open);
    if (end < 0) continue;
    const columns: Column[] = [];
    const tablePk: string[] = [];
    for (const item of splitTop(text.slice(open + 1, end))) {
      const s = item.trim().replace(/\s+/g, ' ');
      const pk = s.match(/^(?:constraint \S+ )?primary key\s*\(([^)]+)\)/i);
      const fk = s.match(/^(?:constraint \S+ )?foreign key\s*\(([^)]+)\)\s*references\s+([\w."`\[\]]+)\s*(?:\(([^)]+)\))?/i);
      const uq = s.match(/^(?:constraint \S+ )?unique\s*(?:key\s+\S+\s*)?\(([^)]+)\)/i);
      if (pk) { tablePk.push(...pk[1].split(',').map(unq)); continue; }
      if (fk) { const c = columns.find((x) => x.name === unq(fk[1].split(',')[0])); if (c) c.ref = `${bare(fk[2])}.${fk[3] ? unq(fk[3].split(',')[0]) : 'id'}`; continue; }
      if (uq) { const c = columns.find((x) => x.name === unq(uq[1].split(',')[0])); if (c && !uq[1].includes(',')) c.unique = true; continue; }
      if (/^(constraint|key|index|check|fulltext|exclude)\b/i.test(s)) continue;
      const col = s.match(/^([\w"`\[\]]+)\s+([\w"`]+(?:\s*\([^)]*\))?(?:\s+(?:with|without) time zone)?)/i);
      if (!col) continue;
      const ref = s.match(/references\s+([\w."`\[\]]+)\s*(?:\(([^)]+)\))?/i);
      columns.push({
        name: unq(col[1]), type: mapType(col[2]), pk: /primary key/i.test(s) || undefined, unique: /\bunique\b/i.test(s) || undefined,
        nullable: !/not null|primary key/i.test(s) || undefined, ref: ref ? `${bare(ref[1])}.${ref[2] ? unq(ref[2]) : 'id'}` : undefined,
      });
    }
    tablePk.forEach((n) => { const c = columns.find((x) => x.name === n); if (c) { c.pk = true; c.nullable = undefined; } });
    tables.push({ name: bare(m[1]), columns, line: lineAt(text, m.index!) });
  }
  for (const m of text.matchAll(/alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?([\w."`\[\]]+)\s+add\s+(?:constraint\s+\S+\s+)?foreign\s+key\s*\(([^)]+)\)\s*references\s+([\w."`\[\]]+)\s*(?:\(([^)]+)\))?/gi)) {
    const c = tables.find((t) => t.name === bare(m[1]))?.columns.find((x) => x.name === unq(m[2].split(',')[0]));
    if (c) c.ref = `${bare(m[3])}.${m[4] ? unq(m[4].split(',')[0]) : 'id'}`;
  }
  return tables;
}

function parseDrizzle(raw: string): ParsedTable[] {
  const text = stripComments(raw);
  const vars = new Map<string, string>();
  const found: { name: string; body: string; extra: string; line: number }[] = [];
  for (const m of text.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:\w+\.table|(?:pg|mysql|sqlite|singlestore|mssql)Table)(?:<[^>(]*>)?\(\s*['"`]([\w.]+)['"`]\s*,\s*\{/g)) {
    const open = m.index! + m[0].length - 1;
    const end = balanced(text, open);
    if (end < 0) continue;
    vars.set(m[1], m[2]);
    const call = balanced(text, text.indexOf('(', m.index!));
    found.push({ name: m[2], body: text.slice(open + 1, end), extra: call > end ? text.slice(end + 1, call) : '', line: lineAt(text, m.index!) });
  }
  return found.map(({ name, body, extra, line }) => {
    const columns: Column[] = [];
    const keys = new Map<string, Column>();
    for (const item of splitTop(body)) {
      const m = item.trim().match(/^(\w+)\s*:\s*(\w+)\(\s*(?:['"`]([\w]+)['"`])?/);
      if (!m) continue;
      const chain = item.slice(item.indexOf(m[0]) + m[0].length);
      const ref = chain.match(/\.references\(\s*\(\)\s*=>\s*(\w+)\.(\w+)/);
      const pk = /\.primaryKey\(/.test(chain) || undefined;
      const column: Column = {
        name: m[3] ?? m[1], type: mapType(m[2]), pk, unique: /\.unique\(/.test(chain) || undefined,
        nullable: (!/\.notNull\(/.test(chain) && !pk) || undefined, ref: ref ? `${vars.get(ref[1]) ?? ref[1]}.${ref[2]}` : undefined,
      };
      keys.set(m[1], column);
      columns.push(column);
    }
    const keyOf = (list: string) => list.split(',').map((k) => keys.get(k.trim().replace(/^\w+\./, '')));
    for (const pk of extra.matchAll(/primaryKey\(\s*\{\s*columns:\s*\[([^\]]+)\]/g)) for (const c of keyOf(pk[1])) if (c) { c.pk = true; c.nullable = undefined; }
    for (const fk of extra.matchAll(/foreignKey\(\s*\{\s*columns:\s*\[([^\]]+)\]\s*,\s*foreignColumns:\s*\[\s*(\w+)\.(\w+)/g)) {
      const c = keyOf(fk[1])[0];
      if (c) c.ref = `${vars.get(fk[2]) ?? fk[2]}.${fk[3]}`;
    }
    return { name, columns, line };
  });
}

function parseTypeorm(raw: string): ParsedTable[] {
  const text = stripComments(raw);
  const classes: { cls: string; table: string; body: string; line: number }[] = [];
  for (const m of text.matchAll(/@Entity\(([^)]*)\)\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)[^{]*\{/g)) {
    const open = m.index! + m[0].length - 1;
    const end = balanced(text, open);
    if (end < 0) continue;
    const arg = m[1].match(/['"`](\w+)['"`]/);
    classes.push({ cls: m[2], table: arg?.[1] ?? m[2], body: text.slice(open + 1, end), line: lineAt(text, m.index!) });
  }
  const tableOf = new Map(classes.map((c) => [c.cls, c.table]));
  return classes.map(({ table, body, line }) => {
    const columns: Column[] = [];
    let pending: { name: string; args: string }[] = [];
    for (let i = 0; i < body.length; ) {
      if (body[i] === '@') {
        const d = /@(\w+)/y; d.lastIndex = i;
        const dm = d.exec(body)!;
        let j = i + dm[0].length;
        let args = '';
        if (body[j] === '(') { const e = balanced(body, j); args = body.slice(j + 1, e); j = e + 1; }
        pending.push({ name: dm[1], args });
        i = j;
        continue;
      }
      if (pending.length) {
        const p = /\s*(?:(?:public|private|protected|readonly)\s+)*(\w+)[!?]?\s*:\s*([^;=\n]+)/y; p.lastIndex = i;
        const pm = p.exec(body);
        if (pm) {
          const has = (n: string) => pending.find((x) => x.name === n);
          const col = has('Column'), pkc = pending.find((x) => /^Primary(Generated)?Column$/.test(x.name));
          const rel = pending.find((x) => /^(ManyToOne|OneToOne)$/.test(x.name)), join = has('JoinColumn');
          if (rel) {
            const target = rel.args.match(/=>\s*(\w+)/)?.[1];
            const jn = join?.args.match(/name:\s*['"`](\w+)['"`]/)?.[1];
            if (target && (join || rel.name === 'ManyToOne')) columns.push({ name: jn ?? `${pm[1]}Id`, type: 'int', nullable: /nullable:\s*true/.test(rel.args) || undefined, ref: `${tableOf.get(target) ?? target}.id` });
          } else if (pkc || col) {
            const a = (pkc ?? col)!.args;
            const t = a.match(/type:\s*['"`](\w+)['"`]/)?.[1] ?? a.match(/^\s*['"`](\w+)['"`]/)?.[1] ?? pm[2];
            const pkType = pkc?.name === 'PrimaryGeneratedColumn' && /uuid/.test(a) ? 'uuid' : t;
            columns.push({ name: a.match(/name:\s*['"`](\w+)['"`]/)?.[1] ?? pm[1], type: mapType(pkType), pk: !!pkc || undefined, unique: /unique:\s*true/.test(a) || undefined, nullable: /nullable:\s*true/.test(a) || undefined });
          }
          pending = [];
          i = p.lastIndex;
          continue;
        }
      }
      i++;
    }
    return { name: table, columns, line };
  });
}

function pyClasses(raw: string): { name: string; bases: string; body: string; line: number }[] {
  const text = stripComments(raw.replace(/#[^\n]*/g, (m) => ' '.repeat(m.length)), false);
  const lines = text.split('\n');
  const out: { name: string; bases: string; body: string; line: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^class\s+(\w+)\s*\(([^)]*)\)\s*:/);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && (!lines[j].trim() || /^\s/.test(lines[j]))) j++;
    out.push({ name: m[1], bases: m[2], body: lines.slice(i + 1, j).join('\n'), line: i });
  }
  return out;
}

function parseSqlalchemy(raw: string): ParsedTable[] {
  return pyClasses(raw).flatMap(({ name, body, line }) => {
    const tn = body.match(/__tablename__\s*=\s*['"](\w+)['"]/);
    if (!tn) return [];
    const columns: Column[] = [];
    for (const l of body.split('\n')) {
      const m = l.match(/^\s*(\w+)\s*(?::\s*Mapped\[([^\]]+)\]\s*)?=\s*(?:mapped_column|Column)\((.*)\)\s*$/);
      if (!m) continue;
      const args = m[3];
      const fk = args.match(/ForeignKey\(\s*['"]([\w.]+)['"]/);
      const type = args.match(/^\s*(?:['"]\w+['"]\s*,\s*)?([A-Za-z_]\w*)/)?.[1] ?? m[2] ?? 'text';
      const pk = /primary_key\s*=\s*True/.test(args) || undefined;
      const nl = args.match(/nullable\s*=\s*(True|False)/)?.[1];
      columns.push({ name: m[1], type: mapType(type === 'ForeignKey' ? (m[2] ?? 'int') : type), pk, unique: /unique\s*=\s*True/.test(args) || undefined, nullable: (nl ? nl === 'True' : !pk && /Optional|\|\s*None/.test(m[2] ?? '')) || undefined, ref: fk ? fk[1] : undefined });
    }
    return [{ name: tn[1], columns, line }];
  });
}

function parseDjango(raw: string): ParsedTable[] {
  return pyClasses(raw).filter((c) => /\bModel\b/.test(c.bases)).map(({ name, body, line }) => {
    const columns: Column[] = [];
    for (const l of body.split('\n')) {
      const m = l.match(/^\s*(\w+)\s*=\s*(?:models\.)?(\w+Field|ForeignKey|OneToOneField)\((.*)\)\s*$/);
      if (!m) continue;
      const [, fname, kind, args] = m;
      if (kind === 'ManyToManyField') continue;
      const pk = /primary_key\s*=\s*True/.test(args) || undefined;
      const rel = kind === 'ForeignKey' || kind === 'OneToOneField';
      const target = rel ? args.match(/^\s*['"]?([\w.]+)['"]?/)?.[1]?.split('.').pop() : undefined;
      columns.push({ name: rel ? `${fname}_id` : fname, type: rel ? 'int' : mapType(kind), pk, unique: (/unique\s*=\s*True/.test(args) || kind === 'OneToOneField') || undefined, nullable: /null\s*=\s*True/.test(args) || undefined, ref: target ? `${target}.id` : undefined });
    }
    if (!columns.some((c) => c.pk)) columns.unshift({ name: 'id', type: 'int', pk: true });
    return { name, columns, line };
  });
}

function parseMongoose(raw: string): ParsedTable[] {
  const text = stripComments(raw);
  const models = new Map<string, string>();
  for (const m of text.matchAll(/\.model\(\s*['"`](\w+)['"`]\s*,\s*(\w+)/g)) models.set(m[2], m[1]);
  const out: { varName: string; body: string; line: number }[] = [];
  for (const m of text.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*new\s+(?:mongoose\.)?Schema\(\s*\{/g)) {
    const open = m.index! + m[0].length - 1;
    const end = balanced(text, open);
    if (end > 0) out.push({ varName: m[1], body: text.slice(open + 1, end), line: lineAt(text, m.index!) });
  }
  return out.map(({ varName, body, line }) => {
    const columns: Column[] = [{ name: '_id', type: 'uuid', pk: true }];
    for (const item of splitTop(body)) {
      const m = item.trim().match(/^(\w+)\s*:\s*([\s\S]+)$/);
      if (!m) continue;
      const v = m[2].trim();
      const ref = v.match(/ref:\s*['"`](\w+)['"`]/)?.[1];
      const type = v.match(/type:\s*\[?\s*(?:[\w.]*\.)?(\w+)/)?.[1] ?? v.replace(/^\[\s*/, '').match(/^(?:[\w.]*\.)?(\w+)/)?.[1] ?? 'String';
      columns.push({ name: m[1], type: type === 'ObjectId' ? 'uuid' : mapType(type), unique: /unique:\s*true/.test(v) || undefined, nullable: !/required:\s*true/.test(v) || undefined, ref: ref ? `${ref}._id` : undefined });
    }
    return { name: models.get(varName) ?? varName.replace(/Schema$/i, ''), columns, line };
  });
}

const PARSERS: { dialect: string; hint: RegExp; run: (t: string) => ParsedTable[] }[] = [
  { dialect: 'Prisma', hint: /^\s*model\s+\w+\s*\{/m, run: parsePrisma },
  { dialect: 'SQL', hint: /create\s+(?:or\s+replace\s+)?(?:temp\w*\s+)?table/i, run: parseSql },
  { dialect: 'Drizzle', hint: /(?:pg|mysql|sqlite|singlestore|mssql)Table\b|drizzle-orm/, run: parseDrizzle },
  { dialect: 'TypeORM', hint: /@Entity\(/, run: parseTypeorm },
  { dialect: 'SQLAlchemy', hint: /__tablename__/, run: parseSqlalchemy },
  { dialect: 'Django', hint: /models\.Model|\(Model\)/, run: parseDjango },
  { dialect: 'Mongoose', hint: /new\s+(?:mongoose\.)?Schema\(/, run: parseMongoose },
];

export function parseSchema(text: string): ParsedSchema {
  const tables: ParsedTable[] = [];
  const dialect: string[] = [];
  for (const p of PARSERS) {
    if (!p.hint.test(text)) continue;
    try {
      const found = p.run(text).filter((t) => t.columns.length);
      if (found.length) { tables.push(...found); dialect.push(p.dialect); }
    } catch { /* malformed source: skip this dialect */ }
  }
  return { tables, dialect };
}
