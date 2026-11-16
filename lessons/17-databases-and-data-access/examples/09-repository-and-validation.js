// Repository pattern (SQL in one place), validation at the boundary, and swapping the repository in tests
// Run: node lessons/17-databases-and-data-access/examples/09-repository-and-validation.js

const { DatabaseSync } = require('node:sqlite');

// ---------- errors the rest of the app understands (no SQL words in them) ----------
class ValidationError extends Error {
  constructor(problems) {
    super('validation failed: ' + problems.join('; '));
    this.name = 'ValidationError';
    this.problems = problems;
  }
}
class EmailTakenError extends Error {
  constructor(email) {
    super(`email already registered: ${email}`);
    this.name = 'EmailTakenError';
  }
}

// ---------- validation at the boundary: untrusted input in, clean typed object out ----------
function parseNewUser(input) {
  const problems = [];
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError(['body must be an object']);
  }
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) problems.push('email must look like a@b.c');
  if (name.length < 2 || name.length > 50) problems.push('name must be 2 to 50 characters');
  if (problems.length > 0) throw new ValidationError(problems);
  // Build a NEW object with only the fields we allow. "role" from the client is dropped.
  return { email, name };
}

// ---------- repository 1: the SQL version. ALL SQL of the "users" table lives here ----------
function createSqliteUserRepository(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY,
      email      TEXT NOT NULL UNIQUE,
      name       TEXT NOT NULL,
      role       TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const insert = db.prepare('INSERT INTO users (email, name) VALUES (?, ?)');
  const byId = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?');
  const byEmail = db.prepare('SELECT id, email, name, role FROM users WHERE email = ?');
  const list = db.prepare('SELECT id, email, name, role FROM users ORDER BY id LIMIT ? OFFSET ?');

  // Rows from node:sqlite have a null prototype. Return plain objects shaped for the app.
  const toUser = (row) => (row ? { id: row.id, email: row.email, name: row.name, role: row.role } : null);

  return {
    create({ email, name }) {
      try {
        const { lastInsertRowid } = insert.run(email, name);
        return toUser(byId.get(lastInsertRowid));
      } catch (err) {
        // Translate a database error into an app error. The UNIQUE index is the real guard against duplicates.
        if (err.errstr === 'constraint failed' && /UNIQUE/.test(err.message)) throw new EmailTakenError(email);
        throw err;
      }
    },
    findById: (id) => toUser(byId.get(id)),
    findByEmail: (email) => toUser(byEmail.get(email)),
    list: ({ limit = 10, offset = 0 } = {}) => list.all(limit, offset).map(toUser),
  };
}

// ---------- repository 2: same interface, no database (fast tests, prototypes) ----------
function createMemoryUserRepository() {
  const users = [];
  const copy = (user) => (user ? { ...user } : null); // never hand out the stored object itself
  return {
    create({ email, name }) {
      if (users.some((u) => u.email === email)) throw new EmailTakenError(email);
      const user = { id: users.length + 1, email, name, role: 'user' };
      users.push(user);
      return copy(user);
    },
    findById: (id) => copy(users.find((u) => u.id === id)),
    findByEmail: (email) => copy(users.find((u) => u.email === email)),
    list: ({ limit = 10, offset = 0 } = {}) => users.slice(offset, offset + limit).map(copy),
  };
}

// ---------- service: business rules. It only knows the repository interface, never SQL ----------
function createUserService(repo) {
  return {
    register(input) {
      const data = parseNewUser(input); // 1. validate at the boundary
      return repo.create(data); // 2. let the repository and its UNIQUE index decide about duplicates
    },
    getByEmail(email) {
      return repo.findByEmail(String(email).trim().toLowerCase());
    },
  };
}

// ---------- the same checks run against BOTH repositories ----------
function exercise(label, repo) {
  const service = createUserService(repo);
  console.log(`--- ${label}`);

  console.log('1. valid input (note the messy email and the sneaky role field)');
  const created = service.register({ email: '  Ada@Example.COM ', name: 'Ada', role: 'admin' });
  console.log('  created:', JSON.stringify(created));

  console.log('2. invalid input is stopped before it reaches the database');
  for (const bad of [{ email: 'nope', name: 'X' }, null, { email: ['a@b.c'], name: 'Bob' }]) {
    try {
      service.register(bad);
    } catch (err) {
      console.log(`  ${err.name}: ${err.problems.join(', ')}`);
    }
  }

  console.log('3. duplicates become a clear app error');
  try {
    service.register({ email: 'ada@example.com', name: 'Another Ada' });
  } catch (err) {
    console.log(`  ${err.name}: ${err.message}`);
  }

  console.log('4. lookups');
  console.log('  by email:', JSON.stringify(service.getByEmail('ADA@example.com')));
  console.log('  unknown :', service.getByEmail('ghost@example.com'));
  service.register({ email: 'bob@example.com', name: 'Bob' });
  console.log('  list    :', repo.list({ limit: 10 }).map((u) => u.email));
}

const db = new DatabaseSync(':memory:');
exercise('repository on SQLite (node:sqlite)', createSqliteUserRepository(db));
exercise('repository in memory (no database)', createMemoryUserRepository());
db.close();
