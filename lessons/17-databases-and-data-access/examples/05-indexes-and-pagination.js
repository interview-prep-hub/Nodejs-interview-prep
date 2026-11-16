// Indexes, EXPLAIN QUERY PLAN, and pagination: OFFSET vs keyset (cursor)
// Run: node lessons/17-databases-and-data-access/examples/05-indexes-and-pagination.js

const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(':memory:');

// Print how SQLite plans to run a query. Only the "detail" column matters for us.
function plan(sql, ...params) {
  const rows = db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...params);
  console.log('  ', sql.replace(/\s+/g, ' ').trim());
  for (const r of rows) console.log('      ->', r.detail);
}

console.log('1. build a table with 20000 rows (many inserts inside ONE transaction are much faster)');
db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL, city TEXT NOT NULL, age INTEGER NOT NULL)');
const cities = ['Paris', 'Lagos', 'Lima', 'Oslo', 'Pune'];
const addUser = db.prepare('INSERT INTO users (email, city, age) VALUES (?, ?, ?)');
db.exec('BEGIN');
for (let i = 1; i <= 20000; i++) addUser.run(`user${i}@example.com`, cities[i % 5], 18 + (i % 60));
db.exec('COMMIT');
console.log('  rows:', db.prepare('SELECT count(*) AS n FROM users').get().n);

console.log('2. without an index SQLite must SCAN (read) every row');
plan('SELECT * FROM users WHERE email = ?', 'user777@example.com');

function timeLookups() {
  const stmt = db.prepare('SELECT id FROM users WHERE email = ?');
  const start = performance.now();
  for (let i = 1; i <= 200; i++) stmt.get(`user${i * 90}@example.com`);
  return performance.now() - start;
}
const slow = timeLookups();

console.log('3. add an index: now it can SEARCH like a book index');
db.exec('CREATE INDEX idx_users_email ON users(email)');
plan('SELECT * FROM users WHERE email = ?', 'user777@example.com');
const fast = timeLookups();
console.log('  200 lookups faster with the index?', fast < slow, '(exact times differ on every machine)');

console.log('4. an index is only used when the query matches it');
plan('SELECT * FROM users WHERE lower(email) = ?', 'user777@example.com'); // function on the column
db.exec('CREATE INDEX idx_users_city_age ON users(city, age)'); // composite: city first, then age
plan('SELECT * FROM users WHERE city = ? AND age > ?', 'Oslo', 30); // uses both parts
plan('SELECT * FROM users WHERE age > ?', 30); // age alone is not the first column
plan('SELECT * FROM users ORDER BY age'); // no index starts with age, so SQLite sorts
plan('SELECT * FROM users WHERE city = ? ORDER BY age', 'Oslo'); // the index already gives the order
plan('SELECT city, age FROM users WHERE city = ?', 'Oslo'); // covering: the index has all the columns needed

console.log('5. a UNIQUE index also protects the data');
db.exec('CREATE UNIQUE INDEX idx_users_email_unique ON users(email)');
try {
  addUser.run('user1@example.com', 'Oslo', 40);
} catch (err) {
  console.log('  duplicate email:', err.message);
}

console.log('6. pagination setup: a feed ordered newest first');
db.exec(`
  CREATE TABLE posts (id INTEGER PRIMARY KEY, created_at INTEGER NOT NULL, title TEXT NOT NULL);
  CREATE INDEX idx_posts_feed ON posts(created_at, id);
`);
const addPost = db.prepare('INSERT INTO posts (created_at, title) VALUES (?, ?)');
db.exec('BEGIN');
for (let i = 1; i <= 20000; i++) addPost.run(1700000000 + Math.floor(i / 3), `post ${i}`); // 3 posts share each second
db.exec('COMMIT');

// A counter the database calls for every row it examines (we put it in WHERE on purpose).
// The number of parameters of the JavaScript function becomes the number of SQL arguments.
let examined = 0;
db.function('examine', { deterministic: false }, (id) => {
  examined++;
  return 1;
});

const PAGE = 5;
const offsetPage = db.prepare(`
  SELECT id, title FROM posts WHERE examine(id)
  ORDER BY created_at DESC, id DESC LIMIT ${PAGE} OFFSET ?
`);

console.log('7. OFFSET pagination: the database must walk past every skipped row');
for (const pageNumber of [1, 2, 200, 4000]) {
  examined = 0;
  const rows = offsetPage.all((pageNumber - 1) * PAGE);
  console.log(`  page ${String(pageNumber).padStart(4)}: first id ${rows[0].id}, rows examined: ${examined}`);
}

console.log('8. OFFSET also breaks when data changes between two page loads');
const page1 = offsetPage.all(0).map((r) => r.id);
addPost.run(1800000000, 'a brand new post'); // appears at the top of the feed
const page2Offset = offsetPage.all(PAGE).map((r) => r.id);
console.log('  page 1 ids:', page1);
console.log('  page 2 ids (OFFSET):', page2Offset, '<- repeats id', page1[PAGE - 1]);

console.log('9. keyset (cursor) pagination: "give me the rows after the last one I saw"');
const encodeCursor = (row) => Buffer.from(JSON.stringify([row.created_at, row.id])).toString('base64url');
const decodeCursor = (text) => JSON.parse(Buffer.from(text, 'base64url').toString());

const keysetFirst = db.prepare(`
  SELECT id, created_at, title FROM posts WHERE examine(id)
  ORDER BY created_at DESC, id DESC LIMIT ${PAGE}
`);
const keysetNext = db.prepare(`
  SELECT id, created_at, title FROM posts
  WHERE (created_at, id) < (?, ?) AND examine(id)
  ORDER BY created_at DESC, id DESC LIMIT ${PAGE}
`);
function getPage(cursor) {
  const rows = cursor ? keysetNext.all(...decodeCursor(cursor)) : keysetFirst.all();
  const last = rows[rows.length - 1];
  return { ids: rows.map((r) => r.id), nextCursor: last ? encodeCursor(last) : null };
}

examined = 0;
const k1 = getPage(null);
console.log('  page 1 ids:', k1.ids, '(20001 is the post added in step 8)');
console.log('  cursor:', k1.nextCursor, 'which decodes to', JSON.stringify(decodeCursor(k1.nextCursor)));
examined = 0;
const k2 = getPage(k1.nextCursor);
console.log('  page 2 ids:', k2.ids, 'rows examined:', examined);
addPost.run(1900000000, 'another new post');
const k2again = getPage(k1.nextCursor);
console.log('  page 2 after another insert:', k2again.ids, '(same, nothing repeated)');

console.log('10. walk the whole feed with cursors: no row twice, no row missed');
const seen = new Set();
let cursor = null;
let pages = 0;
let worst = 0;
do {
  examined = 0;
  const result = getPage(cursor);
  worst = Math.max(worst, examined);
  for (const id of result.ids) seen.add(id);
  cursor = result.ids.length === PAGE ? result.nextCursor : null;
  pages++;
} while (cursor);
console.log('  pages:', pages, ' distinct ids:', seen.size, ' most rows examined on one page:', worst);
console.log('  the keyset query plan:');
plan('SELECT id FROM posts WHERE (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT 5', 1700006000, 18000);

db.close();
