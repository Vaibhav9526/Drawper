import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { generate } = require('../out/codegen.js');
const { docFromTables, tableEdges } = require('../out/model.js');
const { parseSchema } = require('../out/schemaParsers.js');

const col = (name, type, extra = {}) => ({ name, type, ...extra });
const source = [
  { name: 'users', columns: [col('id', 'uuid', { pk: true }), col('email', 'varchar', { unique: true }), col('bio', 'text', { nullable: true })] },
  { name: 'posts', columns: [col('id', 'uuid', { pk: true }), col('author_id', 'uuid', { ref: 'users.id' }), col('title', 'text'), col('reviewer_id', 'uuid', { ref: 'users.id', nullable: true })] },
];
const doc = docFromTables(source);
const file = (target, path) => generate(doc, target).find((f) => f.path === path).content;
const shape = (schema) => schema.tables.map((t) => `${t.name}(${t.columns.map((c) => `${c.name}:${c.type}${c.pk ? ':pk' : ''}${c.ref ? '>' + c.ref : ''}`).join(',')})`);

// Round trip: generated code parses back to the same tables, keys and references.
for (const [target, path] of [['sql', 'schema.sql'], ['drizzle', 'schema.ts'], ['prisma', 'schema.prisma']]) {
  const back = parseSchema(file(target, path));
  assert.deepEqual(shape(back), shape({ tables: source }), `${target} round trip`);
}

// Two foreign keys to the same table get distinct relation names.
const drizzle = file('drizzle', 'schema.ts');
assert.match(drizzle, /relationName: 'posts_author_id'/);
assert.match(drizzle, /relationName: 'posts_reviewer_id'/);
assert.match(file('prisma', 'schema.prisma'), /@relation\("posts_author_id", fields: \[author_id\], references: \[id\]\)/);

// Relation queries cover both directions as joins.
const sql = file('queries', 'queries.sql');
assert.match(sql, /JOIN users ON posts\.author_id = users\.id/);
assert.match(sql, /LEFT JOIN posts ON posts\.author_id = users\.id/);
assert.match(file('queries', 'queries.drizzle.ts'), /db\.query\.posts\.findMany\(\{ with: \{ author: true \} \}\)/);

// An arrow between two tables becomes a foreign key in every generator.
const t = (id, name, x, columns) => ({ id, type: 'rectangle', x, y: 0, width: 100, height: 100, customData: { drawper: 'table', name, columns } });
const arrowDoc = {
  type: 'drawper', version: 2, appState: {}, files: {},
  elements: [
    t('a', 'orders', 0, [col('id', 'int', { pk: true })]), t('b', 'customers', 300, [col('id', 'int', { pk: true })]),
    { id: 'x', type: 'arrow', x: 100, y: 50, points: [[0, 0], [200, 0]], startBinding: { elementId: 'a' }, endBinding: { elementId: 'b' } },
  ],
};
assert.equal(tableEdges(arrowDoc).length, 1);
assert.match(generate(arrowDoc, 'sql')[0].content, /customer_id INTEGER/);
assert.match(generate(arrowDoc, 'sql')[0].content, /FOREIGN KEY \(customer_id\) REFERENCES customers \(id\)/);
assert.match(generate(arrowDoc, 'queries')[0].content, /JOIN customers ON orders\.customer_id = customers\.id/);
// An existing foreign key is not duplicated by the arrow.
arrowDoc.elements[0].customData.columns.push(col('buyer', 'int', { ref: 'customers.id' }));
assert.doesNotMatch(generate(arrowDoc, 'sql')[0].content, /customer_id/);
console.log('codegen ok');

// Prisma queries use the client delegate name (model name, lower camel), not the table name.
assert.match(generate(doc, 'queries').find((f) => f.path === 'queries.prisma.ts').content, /prisma\.post\.findMany\(\{ include: \{ author: true \} \}\)/);
console.log('codegen queries ok');

{
  const { addCodeCard } = await import('../out/codeCard.js');
  const { emptyDocument } = await import('../out/model.js');
  let doc = addCodeCard(emptyDocument(), { code: 'const a = 1;\nconst b = 2;\n', file: 'src/x.ts', startLine: 9 });
  const texts = doc.elements.filter((e) => e.type === 'text').map((e) => e.text);
  if (!texts.includes('src/x.ts:9-10') || !texts.includes('9\n10') || !texts.includes('const a = 1;\nconst b = 2;')) throw new Error('code card content wrong: ' + JSON.stringify(texts));
  const before = doc.elements.length;
  doc = addCodeCard(doc, { code: 'x', file: 'y.ts', startLine: 1 });
  const card = doc.elements.filter((e) => e.customData?.drawper === 'code');
  if (card.length !== 2 || card[1].y <= card[0].y + card[0].height) throw new Error('second card overlaps first');
  if (doc.elements.length !== before + 5) throw new Error('card should be 5 elements');
  console.log('codegen code card ok');
}
