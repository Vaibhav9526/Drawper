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

{
  const { upsertLiveCard, hasLiveCard } = await import('../out/codeCard.js');
  const { buildOverlay } = await import('../out/overlay.js');
  const { emptyDocument } = await import('../out/model.js');
  const uri = 'file:///a.ts';
  let doc = upsertLiveCard(emptyDocument(), { code: 'one\ntwo\nthree', file: 'a.ts', startLine: 1, uri });
  if (!hasLiveCard(doc, uri) || !doc.elements.every((e) => e.locked)) throw new Error('live card should exist and be locked');
  const codeText = () => doc.elements.find((e) => String(e.id).startsWith('code_text'));
  const origin = { x: codeText().x, y: codeText().y };
  const stroke = { type: 'freedraw', id: 'd1', x: origin.x + 8.68 * 4, y: origin.y + 17.5 * 2, width: 20, height: 10, points: [[0, 0], [20, 10]], groupIds: [], strokeColor: '#1e1e1e', strokeWidth: 2, isDeleted: false };
  doc = { ...doc, elements: [...doc.elements, stroke] };
  const before = buildOverlay(doc, uri, { charWidth: 8.68, lineHeight: 17.5 });
  if (!before || before.line !== 1 || !before.svg.includes('#ffd900')) throw new Error('overlay wrong: ' + JSON.stringify(before));
  doc = upsertLiveCard(doc, { code: 'one\ntwo\nthree\nfour\nfive', file: 'a.ts', startLine: 1, uri });
  if (doc.elements.filter((e) => e.customData?.drawper === 'code').length !== 1) throw new Error('refresh duplicated the card');
  if (!doc.elements.some((e) => e.id === 'd1')) throw new Error('refresh dropped the drawing');
  if (!doc.elements.find((e) => e.type === 'text' && e.text === 'one\ntwo\nthree\nfour\nfive')) throw new Error('refresh did not update the code');
  const after = buildOverlay(doc, uri, { charWidth: 8.68, lineHeight: 17.5 });
  if (after.line !== before.line || after.left !== before.left) throw new Error('drawing moved after refresh');
  if (buildOverlay(emptyDocument(), uri, { charWidth: 8, lineHeight: 17 })) throw new Error('empty canvas should have no overlay');
  console.log('codegen live card + overlay ok');
}

{
  const { upsertLiveCard } = await import('../out/codeCard.js');
  const { addStroke, undoStroke, clearStrokes, buildOverlay } = await import('../out/overlay.js');
  const { emptyDocument } = await import('../out/model.js');
  const uri = 'file:///b.ts';
  const m = { charWidth: 8.4, lineHeight: 19 };
  let doc = upsertLiveCard(emptyDocument(), { code: 'a\nb\nc\nd\ne', file: 'b.ts', startLine: 1, uri });
  if (addStroke(doc, 'file:///other.ts', [[0, 0], [5, 5]], m) !== doc) throw new Error('stroke for another file should be ignored');
  doc = addStroke(doc, uri, [[84, 47.5], [92, 57], [100, 66.5]], m);
  const o = buildOverlay(doc, uri, m);
  if (!o || o.line !== 2) throw new Error('stroke should anchor near line 3, got ' + JSON.stringify(o));
  if (undoStroke(doc, uri).elements.some((e) => e.customData?.drawper === 'stroke')) throw new Error('undo failed');
  if (clearStrokes(doc, uri).elements.some((e) => e.customData?.drawper === 'stroke')) throw new Error('clear failed');
  console.log('codegen strokes ok');
}
