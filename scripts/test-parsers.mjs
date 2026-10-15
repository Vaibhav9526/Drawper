import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { parseSchema } = createRequire(import.meta.url)('../out/schemaParsers.js');
const names = (s) => s.tables.map((t) => t.name).join(',');
const col = (s, t, c) => s.tables.find((x) => x.name === t).columns.find((x) => x.name === c);

let s = parseSchema(`model User {\n  id Int @id @default(autoincrement())\n  email String @unique\n  posts Post[]\n}\nmodel Post {\n  id Int @id\n  authorId Int\n  author User @relation(fields: [authorId], references: [id])\n  title String?\n}`);
assert.equal(names(s), 'User,Post'); assert.equal(col(s, 'Post', 'authorId').ref, 'User.id'); assert.equal(col(s, 'Post', 'title').nullable, true); assert.equal(col(s, 'User', 'email').unique, true);

s = parseSchema(`-- c\nCREATE TABLE users (\n id SERIAL PRIMARY KEY,\n email VARCHAR(255) NOT NULL UNIQUE,\n created_at TIMESTAMP\n);\nCREATE TABLE "public"."posts" (\n id bigint,\n user_id int REFERENCES users(id),\n owner int,\n PRIMARY KEY (id),\n FOREIGN KEY (owner) REFERENCES users (id)\n);\nALTER TABLE posts ADD CONSTRAINT x FOREIGN KEY (user_id) REFERENCES users (id);`);
assert.equal(names(s), 'users,posts'); assert.equal(col(s, 'posts', 'user_id').ref, 'users.id'); assert.equal(col(s, 'posts', 'owner').ref, 'users.id'); assert.equal(col(s, 'posts', 'id').pk, true); assert.equal(col(s, 'users', 'id').pk, true);

s = parseSchema(`export const users = pgTable('users', {\n id: serial('id').primaryKey(),\n name: text('name').notNull(),\n});\nexport const posts = pgTable('posts', {\n id: serial('id').primaryKey(),\n authorId: integer('author_id').references(() => users.id),\n});`);
assert.equal(names(s), 'users,posts'); assert.equal(col(s, 'posts', 'author_id').ref, 'users.id'); assert.equal(col(s, 'users', 'name').nullable, undefined);

s = parseSchema(`import { pgTable, uuid, text, integer, primaryKey, foreignKey } from 'drizzle-orm/pg-core';
export const orgs = pgTable('orgs', { id: uuid('id').defaultRandom().primaryKey(), name: text() });
export const members = pgTable('members', {
 orgId: uuid('org_id').notNull().references(() => orgs.id, { onDelete: 'cascade' }),
 userId: integer('user_id').notNull(),
 owner: uuid('owner'),
}, (t) => [primaryKey({ columns: [t.orgId, t.userId] }), foreignKey({ columns: [t.owner], foreignColumns: [orgs.id] })]);
export const sq = sqliteTable<'x'>('sq', { id: integer('id').primaryKey({ autoIncrement: true }) });`);
assert.equal(names(s), 'orgs,members,sq'); assert.equal(col(s, 'members', 'org_id').pk, true); assert.equal(col(s, 'members', 'user_id').pk, true); assert.equal(col(s, 'members', 'owner').ref, 'orgs.id'); assert.equal(col(s, 'members', 'org_id').ref, 'orgs.id');

s = parseSchema(`@Entity('users')\nexport class User {\n @PrimaryGeneratedColumn('uuid')\n id: string;\n @Column({ type: 'varchar', unique: true })\n email: string;\n @OneToMany(() => Post, (p) => p.author)\n posts: Post[];\n}\n@Entity()\nexport class Post {\n @PrimaryGeneratedColumn()\n id: number;\n @ManyToOne(() => User, (u) => u.posts)\n @JoinColumn({ name: 'author_id' })\n author: User;\n}`);
assert.equal(names(s), 'users,Post'); assert.equal(col(s, 'Post', 'author_id').ref, 'users.id'); assert.equal(col(s, 'users', 'id').type, 'uuid'); assert.equal(col(s, 'users', 'email').unique, true);

s = parseSchema(`class User(Base):\n    __tablename__ = "users"\n    id = Column(Integer, primary_key=True)\n    name = Column(String(50), nullable=False)\n\nclass Post(Base):\n    __tablename__ = "posts"\n    id = Column(Integer, primary_key=True)\n    user_id = Column(Integer, ForeignKey('users.id'))\n`);
assert.equal(names(s), 'users,posts'); assert.equal(col(s, 'posts', 'user_id').ref, 'users.id');

s = parseSchema(`class Author(models.Model):\n    name = models.CharField(max_length=10)\n\nclass Book(models.Model):\n    title = models.CharField(max_length=10)\n    author = models.ForeignKey(Author, on_delete=models.CASCADE)\n`);
assert.equal(names(s), 'Author,Book'); assert.equal(col(s, 'Book', 'author_id').ref, 'Author.id');

s = parseSchema(`const userSchema = new mongoose.Schema({\n name: { type: String, required: true },\n email: String,\n});\nconst postSchema = new Schema({\n author: { type: Schema.Types.ObjectId, ref: 'User' },\n title: String\n});\nmodule.exports = [mongoose.model('User', userSchema), mongoose.model('Post', postSchema)];`);
assert.equal(names(s), 'User,Post'); assert.equal(col(s, 'Post', 'author').ref, 'User._id');
console.log('parsers ok');

{
  const { parseSchema, mergeSchemas, relatedTo } = await import('../out/schemaParsers.js');
  const users = parseSchema(`import { pgTable, uuid } from 'drizzle-orm/pg-core';\nexport const usersTable = pgTable("users", { id: uuid().primaryKey() });`);
  const url = parseSchema(`import { usersTable } from './schema.models.js';\nconst urlTable = pgTable("url", { id: uuid().primaryKey(), userId: uuid().references(() => usersTable.id) });`);
  const lone = parseSchema(`export const logTable = pgTable("log", { id: uuid().primaryKey() });`);
  const all = mergeSchemas([{ file: 'url', schema: url }, { file: 'users', schema: users }, { file: 'log', schema: lone }]);
  const fk = all.find((t) => t.name === 'url').columns.find((c) => c.name === 'userId').ref;
  if (fk !== 'users.id') throw new Error('cross-file ref not resolved: ' + fk);
  const names = relatedTo(all, 'url').map((t) => t.name).sort().join();
  if (names !== 'url,users') throw new Error('related wrong: ' + names);
  console.log('ok cross-file schema merge');
}
