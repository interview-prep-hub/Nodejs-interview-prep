// Migrations: versioned, ordered, transactional schema changes with a tiny runner (up, down, checksum)
// Run: node lessons/17-databases-and-data-access/examples/08-migrations.js

const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');

// In a real project each of these is a file: migrations/001_create_users.sql, 002_create_posts.sql, ...
const migrations = [
  {
    id: 1,
    name: 'create users',
    up: 'CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE)',
    down: 'DROP TABLE users',
  },
  {
    id: 2,
    name: 'create posts',
    up: 'CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), title TEXT NOT NULL)',
    down: 'DROP TABLE posts',
  },
  {
    id: 3,
    name: 'add users.display_name (expand step: nullable or with a default, so old code keeps working)',
    up: "ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''",
    down: 'ALTER TABLE users DROP COLUMN display_name',
  },
  {
    id: 4,
    name: 'backfill users.display_name from the email',
    up: "UPDATE users SET display_name = substr(email, 1, instr(email, '@') - 1) WHERE display_name = ''",
    down: "UPDATE users SET display_name = ''",
  },
];

const checksum = (m) => crypto.createHash('sha256').update(m.up).digest('hex').slice(0, 10);

function ensureHistoryTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id       INTEGER PRIMARY KEY,
      name     TEXT NOT NULL,
      checksum TEXT NOT NULL
    )
  `);
}

function migrateUp(db, list) {
  ensureHistoryTable(db);
  const applied = new Map(db.prepare('SELECT id, checksum FROM schema_migrations').all().map((r) => [r.id, r.checksum]));
  const done = [];
  for (const m of [...list].sort((a, b) => a.id - b.id)) {
    if (applied.has(m.id)) {
      // Already applied: the file must not have been edited since.
      if (applied.get(m.id) !== checksum(m)) {
        throw new Error(`migration ${m.id} was changed after it was applied (stored ${applied.get(m.id)}, now ${checksum(m)})`);
      }
      continue;
    }
    db.exec('BEGIN'); // SQLite and PostgreSQL can roll back schema changes. MySQL cannot (DDL commits at once).
    try {
      db.exec(m.up);
      db.prepare('INSERT INTO schema_migrations (id, name, checksum) VALUES (?, ?, ?)').run(m.id, m.name, checksum(m));
      db.exec('COMMIT');
      done.push(m.id);
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${m.id} failed and was rolled back: ${err.message}`);
    }
  }
  return done;
}

function migrateDown(db, list) {
  const last = db.prepare('SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1').get();
  if (!last) return null;
  const m = list.find((item) => item.id === last.id);
  db.exec('BEGIN');
  try {
    db.exec(m.down);
    db.prepare('DELETE FROM schema_migrations WHERE id = ?').run(m.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return m.id;
}

const tables = (db) =>
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

const db = new DatabaseSync(':memory:');

console.log('1. day 1: deploy with migrations 1 and 2 only');
console.log('  applied:', migrateUp(db, migrations.slice(0, 2)));
console.log('  tables :', tables(db));
db.prepare('INSERT INTO users (email) VALUES (?)').run('ada@example.com');
db.prepare('INSERT INTO users (email) VALUES (?)').run('bob@example.com');

console.log('2. day 2: deploy with all four. Only the new ones run, existing data is kept');
console.log('  applied:', migrateUp(db, migrations));
console.log('  users columns:', columns(db, 'users'));
console.log('  data:', JSON.stringify(db.prepare('SELECT email, display_name FROM users ORDER BY id').all()));

console.log('3. running again is safe: nothing is pending');
console.log('  applied:', migrateUp(db, migrations));

console.log('4. a failing migration is rolled back completely (no half-made table)');
const broken = [
  ...migrations,
  { id: 5, name: 'create tags then fail', up: 'CREATE TABLE tags (id INTEGER PRIMARY KEY); INSERT INTO nope VALUES (1)', down: 'DROP TABLE tags' },
];
try {
  migrateUp(db, broken);
} catch (err) {
  console.log('  error :', err.message);
}
console.log('  tables:', tables(db), '(no "tags")');
console.log('  history ids:', db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map((r) => r.id));

console.log('5. editing an applied migration is detected by its checksum');
const edited = migrations.map((m) => (m.id === 2 ? { ...m, up: m.up.replace('title TEXT NOT NULL', 'title TEXT') } : m));
try {
  migrateUp(db, edited);
} catch (err) {
  console.log('  error :', err.message);
}

console.log('6. roll back the most recent migration with its "down" step');
console.log('  rolled back id:', migrateDown(db, migrations));
console.log('  data after down:', JSON.stringify(db.prepare('SELECT email, display_name FROM users ORDER BY id').all()));
console.log('  history ids:', db.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map((r) => r.id));

db.close();
