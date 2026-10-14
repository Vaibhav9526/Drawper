import { Column, ColumnType, DprDocument, ServiceElement, TableElement, serviceEdges, services, tables } from './model';

export type Target = 'sql' | 'prisma' | 'drizzle' | 'typescript' | 'compose';

export interface GeneratedFile {
  path: string;
  content: string;
}

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unnamed';
const ident = (s: string) => s.trim().replace(/[^A-Za-z0-9_]/g, '_') || '_';
const pascal = (s: string) => ident(s).replace(/(^|_)(\w)/g, (_, __, c: string) => c.toUpperCase());

const SQL_TYPES: Record<ColumnType, string> = {
  int: 'INTEGER', bigint: 'BIGINT', text: 'TEXT', varchar: 'VARCHAR(255)', boolean: 'BOOLEAN',
  timestamp: 'TIMESTAMP', date: 'DATE', uuid: 'UUID', json: 'JSONB', float: 'DOUBLE PRECISION',
};
const PRISMA_TYPES: Record<ColumnType, string> = {
  int: 'Int', bigint: 'BigInt', text: 'String', varchar: 'String', boolean: 'Boolean',
  timestamp: 'DateTime', date: 'DateTime', uuid: 'String', json: 'Json', float: 'Float',
};
const TS_TYPES: Record<ColumnType, string> = {
  int: 'number', bigint: 'bigint', text: 'string', varchar: 'string', boolean: 'boolean',
  timestamp: 'Date', date: 'Date', uuid: 'string', json: 'unknown', float: 'number',
};

interface ResolvedRef {
  table: TableElement;
  column: Column;
}

function resolveRef(all: TableElement[], ref?: string): ResolvedRef | undefined {
  if (!ref) return undefined;
  const [t, c] = ref.split('.').map((p) => p.trim());
  const table = all.find((x) => x.name === t);
  const column = table?.columns.find((x) => x.name === (c || table.columns.find((k) => k.pk)?.name));
  return table && column ? { table, column } : undefined;
}

export function generateSql(doc: DprDocument): string {
  const all = tables(doc);
  const create = all.map((t) => {
    const pks = t.columns.filter((c) => c.pk);
    const lines = t.columns.map((c) => {
      const parts = [`  ${ident(c.name)} ${SQL_TYPES[c.type]}`];
      if (!c.nullable && !c.pk) parts.push('NOT NULL');
      if (c.unique) parts.push('UNIQUE');
      return parts.join(' ');
    });
    if (pks.length) lines.push(`  PRIMARY KEY (${pks.map((c) => ident(c.name)).join(', ')})`);
    return `CREATE TABLE ${ident(t.name)} (\n${lines.join(',\n')}\n);`;
  });
  const fks = all.flatMap((t) =>
    t.columns.flatMap((c) => {
      const r = resolveRef(all, c.ref);
      return r
        ? [`ALTER TABLE ${ident(t.name)} ADD CONSTRAINT fk_${ident(t.name)}_${ident(c.name)} FOREIGN KEY (${ident(c.name)}) REFERENCES ${ident(r.table.name)} (${ident(r.column.name)});`]
        : [];
    }),
  );
  return [...create, ...fks].join('\n\n') + '\n';
}

export function generatePrisma(doc: DprDocument): string {
  const all = tables(doc);
  const back = new Map<string, string[]>();
  const models = all.map((t) => {
    const lines: string[] = [];
    for (const c of t.columns) {
      let attrs = '';
      if (c.pk) attrs += ' @id';
      if (c.unique) attrs += ' @unique';
      lines.push(`  ${ident(c.name)} ${PRISMA_TYPES[c.type]}${c.nullable && !c.pk ? '?' : ''}${attrs}`);
      const r = resolveRef(all, c.ref);
      if (r) {
        const field = ident(r.table.name).toLowerCase() + '_' + ident(c.name);
        lines.push(`  ${field} ${pascal(r.table.name)}${c.nullable ? '?' : ''} @relation(fields: [${ident(c.name)}], references: [${ident(r.column.name)}])`);
        const list = back.get(r.table.name) ?? [];
        list.push(`  ${ident(t.name).toLowerCase()}_${ident(c.name)}s ${pascal(t.name)}[]`);
        back.set(r.table.name, list);
      }
    }
    return { t, lines };
  });
  const body = models
    .map(({ t, lines }) => `model ${pascal(t.name)} {\n${[...lines, ...(back.get(t.name) ?? [])].join('\n')}\n}`)
    .join('\n\n');
  return `datasource db {\n  provider = "postgresql"\n  url      = env("DATABASE_URL")\n}\n\ngenerator client {\n  provider = "prisma-client-js"\n}\n\n${body}\n`;
}

const DRIZZLE_TYPES: Record<ColumnType, { fn: string; arg?: string }> = {
  int: { fn: 'integer' }, bigint: { fn: 'bigint', arg: "{ mode: 'number' }" }, text: { fn: 'text' }, varchar: { fn: 'varchar', arg: '{ length: 255 }' },
  boolean: { fn: 'boolean' }, timestamp: { fn: 'timestamp' }, date: { fn: 'date' }, uuid: { fn: 'uuid' }, json: { fn: 'jsonb' }, float: { fn: 'doublePrecision' },
};

export function generateDrizzle(doc: DprDocument): string {
  const all = tables(doc);
  const used = new Set<string>(['pgTable']);
  const varOf = new Map(all.map((t) => [t.name, ident(t.name).replace(/^(\d)/, '_$1')]));
  const defs = all.map((t) => {
    const lines = t.columns.map((c) => {
      const d = DRIZZLE_TYPES[c.type];
      used.add(d.fn);
      let expr = `${d.fn}(${[`'${ident(c.name)}'`, d.arg].filter(Boolean).join(', ')})`;
      if (c.pk) expr += '.primaryKey()';
      else if (!c.nullable) expr += '.notNull()';
      if (c.unique) expr += '.unique()';
      const r = resolveRef(all, c.ref);
      if (r) expr += `.references(() => ${varOf.get(r.table.name)}.${ident(r.column.name)})`;
      return `  ${ident(c.name)}: ${expr},`;
    });
    return `export const ${varOf.get(t.name)} = pgTable('${ident(t.name)}', {\n${lines.join('\n')}\n});`;
  });
  return `import { ${[...used].sort().join(', ')} } from 'drizzle-orm/pg-core';\n\n${defs.join('\n\n')}\n`;
}

export function generateTypescript(doc: DprDocument): string {
  return tables(doc)
    .map((t) => {
      const fields = t.columns.map((c) => `  ${ident(c.name)}${c.nullable && !c.pk ? '?' : ''}: ${TS_TYPES[c.type]};`);
      return `export interface ${pascal(t.name)} {\n${fields.join('\n')}\n}`;
    })
    .join('\n\n') + '\n';
}

const DB_IMAGE = (s: ServiceElement) => {
  const tech = (s.tech ?? '').toLowerCase();
  if (tech.includes('mysql')) return { image: 'mysql:8', port: 3306, env: ['MYSQL_ROOT_PASSWORD=postgres', `MYSQL_DATABASE=${slug(s.name)}`] };
  if (tech.includes('mongo')) return { image: 'mongo:7', port: 27017, env: [] };
  return { image: 'postgres:16', port: 5432, env: ['POSTGRES_PASSWORD=postgres', `POSTGRES_DB=${slug(s.name).replace(/-/g, '_')}`] };
};

const INFRA_IMAGE: Partial<Record<ServiceElement['kind'], (s: ServiceElement) => { image: string; port: number; env: string[] }>> = {
  db: DB_IMAGE,
  cache: () => ({ image: 'redis:7', port: 6379, env: [] }),
  queue: (s) => ((s.tech ?? '').toLowerCase().includes('kafka')
    ? { image: 'bitnami/kafka:3.7', port: 9092, env: [] }
    : { image: 'rabbitmq:3-management', port: 5672, env: [] }),
  storage: () => ({ image: 'minio/minio', port: 9000, env: ['MINIO_ROOT_USER=minio', 'MINIO_ROOT_PASSWORD=minio12345'] }),
};

export function generateCompose(doc: DprDocument): GeneratedFile[] {
  const nodes = services(doc);
  const edges = serviceEdges(doc);
  const files: GeneratedFile[] = [];
  const blocks: string[] = [];
  let port = 3000;

  for (const s of nodes) {
    const name = slug(s.name);
    const infra = INFRA_IMAGE[s.kind];
    const deps = edges.filter((e) => e.from.id === s.id).map((e) => e.to);
    const lines = [`  ${name}:`];
    if (infra) {
      const i = infra(s);
      lines.push(`    image: ${i.image}`, `    ports:\n      - "${i.port}:${i.port}"`);
      if (i.env.length) lines.push(`    environment:\n${i.env.map((e) => `      - ${e}`).join('\n')}`);
    } else if (s.kind === 'client') {
      continue;
    } else {
      const p = port++;
      lines.push(`    build: ./services/${name}`, `    ports:\n      - "${p}:${p}"`, `    environment:\n      - PORT=${p}`);
      for (const d of deps) lines.push(`      - ${slug(d.name).toUpperCase().replace(/-/g, '_')}_HOST=${slug(d.name)}`);
      files.push(
        { path: `services/${name}/package.json`, content: JSON.stringify({ name, version: '0.0.1', scripts: { start: 'node index.js' } }, null, 2) + '\n' },
        { path: `services/${name}/Dockerfile`, content: 'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nCMD ["npm", "start"]\n' },
        {
          path: `services/${name}/index.js`,
          content: `const http = require('http');\nconst port = process.env.PORT || 3000;\nhttp.createServer((req, res) => res.end('${s.name} (${s.kind}) up')).listen(port);\nconsole.log('${s.name} listening on', port);\n`,
        },
      );
    }
    const real = deps.filter((d) => d.kind !== 'client');
    if (real.length) lines.push(`    depends_on:\n${real.map((d) => `      - ${slug(d.name)}`).join('\n')}`);
    blocks.push(lines.join('\n'));
  }

  files.unshift({ path: 'docker-compose.yml', content: `services:\n${blocks.join('\n')}\n` });
  return files;
}

export function generate(doc: DprDocument, target: Target): GeneratedFile[] {
  switch (target) {
    case 'sql': return [{ path: 'schema.sql', content: generateSql(doc) }];
    case 'prisma': return [{ path: 'schema.prisma', content: generatePrisma(doc) }];
    case 'drizzle': return [{ path: 'schema.ts', content: generateDrizzle(doc) }];
    case 'typescript': return [{ path: 'types.ts', content: generateTypescript(doc) }];
    case 'compose': return generateCompose(doc);
  }
}
