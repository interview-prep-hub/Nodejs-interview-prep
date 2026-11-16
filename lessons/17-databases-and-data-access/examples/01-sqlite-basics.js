// SQL basics with the built-in node:sqlite: create, insert, select, update, delete, prepared statements, NULL, upsert, JSON
// Run: node lessons/17-databases-and-data-access/examples/01-sqlite-basics.js

const { DatabaseSync } = require('node:sqlite');

// ':memory:' is a database that lives in RAM and disappears when the process ends.
const db = new DatabaseSync(':memory:');

console.log('1. create a table (exec runs SQL text and returns nothing)');
db.exec(`
  CREATE TABLE books (
    id     INTEGER PRIMARY KEY,
    title  TEXT NOT NULL,
    author TEXT NOT NULL,
    year   INTEGER,
    stock  INTEGER NOT NULL DEFAULT 0
  )
`);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
console.log('  tables:', tables.map((t) => t.name));

console.log('2. insert with ? placeholders (the values travel separately from the SQL)');
const insert = db.prepare('INSERT INTO books (title, author, year, stock) VALUES (?, ?, ?, ?)');
const first = insert.run('Dune', 'Frank Herbert', 1965, 3);
console.log('  run() returned:', first);
insert.run('Emma', 'Jane Austen', 1815, 0);
insert.run('Neuromancer', 'William Gibson', 1984, 7);

console.log('3. select: get() = one row, all() = array, iterate() = one at a time');
const one = db.prepare('SELECT id, title FROM books WHERE id = ?').get(1);
console.log('  get(1):', one);
console.log('  has a prototype?', Object.getPrototypeOf(one) !== null);
console.log('  JSON:', JSON.stringify(one));
const missing = db.prepare('SELECT * FROM books WHERE id = ?').get(99);
console.log('  get(99):', missing);
const all = db.prepare('SELECT title, year FROM books ORDER BY year').all();
console.log('  all():', all.map((r) => `${r.title} (${r.year})`));
for (const row of db.prepare('SELECT title FROM books ORDER BY id').iterate()) {
  console.log('  iterate:', row.title);
}

console.log('4. named parameters');
const byAuthor = db.prepare('SELECT title FROM books WHERE author = :author AND year > :after');
console.log('  named:', byAuthor.all({ author: 'William Gibson', after: 1980 }));

console.log('5. a prepared statement is parsed once and reused');
const addStock = db.prepare('UPDATE books SET stock = stock + ? WHERE id = ?');
console.log('  source SQL:', addStock.sourceSQL);
for (const id of [1, 2, 3]) addStock.run(10, id);
console.log('  stocks:', db.prepare('SELECT id, stock FROM books ORDER BY id').all().map((r) => r.stock));

console.log('6. update and delete report how many rows they changed');
const upd = db.prepare('UPDATE books SET year = ? WHERE title = ?');
console.log('  update:', upd.run(1966, 'Dune').changes, 'row changed');
console.log('  update nothing:', upd.run(0, 'No such book').changes, 'rows changed');
console.log('  lastInsertRowid is only about INSERT, an update keeps the old value:', upd.run(1966, 'Dune').lastInsertRowid);
console.log('  delete:', db.prepare('DELETE FROM books WHERE stock > ?').run(15).changes, 'row deleted');
console.log('  rows left:', db.prepare('SELECT count(*) AS n FROM books').get().n);

console.log('7. NULL means "unknown": it is not equal to anything, not even to NULL');
db.prepare('INSERT INTO books (title, author) VALUES (?, ?)').run('Untitled draft', 'Anon'); // year stays NULL
const countWhere = (condition) => db.prepare(`SELECT count(*) AS n FROM books WHERE ${condition}`).get().n;
console.log('  year = NULL                  ->', countWhere('year = NULL'), 'rows (never true)');
console.log('  year IS NULL                 ->', countWhere('year IS NULL'), 'row');
console.log('  year != 1815                 ->', countWhere('year != 1815'), 'row (the NULL row is skipped too)');
console.log('  year != 1815 OR year IS NULL ->', countWhere('year != 1815 OR year IS NULL'), 'rows');
console.log('  coalesce(year, 0):', db.prepare('SELECT coalesce(year, 0) AS y FROM books ORDER BY id').all().map((r) => r.y));

console.log('8. upsert (insert or update) and RETURNING (get the row back)');
const upsert = db.prepare(`
  INSERT INTO books (id, title, author, stock) VALUES (?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET stock = stock + excluded.stock
  RETURNING id, title, stock
`);
console.log('  id 1 exists, so its stock grows:', { ...upsert.get(1, 'Dune', 'Frank Herbert', 5) });
console.log('  id 10 is new, so it is inserted :', { ...upsert.get(10, 'Solaris', 'Stanislaw Lem', 2) });
console.log('  DELETE ... RETURNING            :', { ...db.prepare('DELETE FROM books WHERE id = ? RETURNING title').get(10) });

console.log('9. JSON inside a SQL column (document-style data, still queryable)');
db.exec('CREATE TABLE events (id INTEGER PRIMARY KEY, payload TEXT NOT NULL CHECK (json_valid(payload)))');
const addEvent = db.prepare('INSERT INTO events (payload) VALUES (?)');
addEvent.run(JSON.stringify({ type: 'login', user: { name: 'ada' } }));
addEvent.run(JSON.stringify({ type: 'purchase', user: { name: 'bob' }, amount: 30 }));
const events = db.prepare("SELECT payload ->> '$.type' AS type, json_extract(payload, '$.user.name') AS who FROM events").all();
console.log('  ', events.map((e) => `${e.type} by ${e.who}`));
try {
  addEvent.run('this is not json');
} catch (err) {
  console.log('  invalid JSON is refused:', err.message);
}

console.log('10. errors carry SQLite codes');
try {
  db.prepare('INSERT INTO books (title) VALUES (?)').run('No author');
} catch (err) {
  console.log('  constraint:', err.code, err.errcode, err.errstr, '|', err.message);
}
try {
  db.prepare('SELEC * FROM books');
} catch (err) {
  console.log('  syntax:', err.code, err.errcode, '|', err.message);
}

console.log('11. close the database when you are done');
db.close();
console.log('  isOpen:', db.isOpen);
try {
  db.exec('SELECT 1');
} catch (err) {
  console.log('  after close:', err.code, '|', err.message);
}
