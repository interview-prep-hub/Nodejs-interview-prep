// SQL injection (string concatenation vs placeholders) and the same idea for NoSQL (operator injection)
// Run: node lessons/17-databases-and-data-access/examples/04-injection.js

const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE users (
    id       INTEGER PRIMARY KEY,
    name     TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,  -- plain text ONLY to keep this demo short, real apps store a slow hash
    role     TEXT NOT NULL
  );
  INSERT INTO users (name, password, role) VALUES ('admin', 's3cret!', 'admin'), ('bob', 'bobpw', 'user');
`);

console.log('PART A: SQL injection');

// BAD: the user input is glued into the SQL text. The database cannot tell data from code.
function loginUnsafe(name, password) {
  const sql = `SELECT name, role FROM users WHERE name = '${name}' AND password = '${password}'`;
  console.log('  SQL sent:', sql);
  try {
    return db.prepare(sql).get() ?? null;
  } catch (err) {
    return 'error: ' + err.message;
  }
}

// GOOD: the SQL text is fixed. Values are sent separately and are never parsed as SQL.
function loginSafe(name, password) {
  return db.prepare('SELECT name, role FROM users WHERE name = ? AND password = ?').get(name, password) ?? null;
}

console.log('A1. a normal login works with both versions');
console.log('  unsafe:', loginUnsafe('bob', 'bobpw'));
console.log('  safe  :', loginSafe('bob', 'bobpw'));

console.log("A2. attack: name = admin' --   (the -- starts a comment, so the password check disappears)");
console.log('  unsafe:', loginUnsafe("admin' --", 'anything'));
console.log('  safe  :', loginSafe("admin' --", 'anything'));

console.log("A3. attack: password = ' OR '1'='1   (the condition becomes always true)");
console.log('  unsafe:', loginUnsafe('nobody', "' OR '1'='1"));
console.log('  safe  :', loginSafe('nobody', "' OR '1'='1"));

console.log('A4. attack through exec(): a second statement rides along');
const evilName = "x'; DROP TABLE users; --";
db.exec(`SELECT * FROM users WHERE name = '${evilName}'`); // exec runs ALL statements in the string
const left = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'users'").get().n;
console.log('  users table still exists?', left === 1);

// Rebuild the table for the next parts.
db.exec(`
  CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, password TEXT NOT NULL, role TEXT NOT NULL);
  INSERT INTO users (name, password, role) VALUES ('admin', 's3cret!', 'admin'), ('bob', 'bobpw', 'user');
`);

console.log('A5. placeholders cannot hold table or column names, so use an allow list');
const SORTABLE = new Set(['name', 'role', 'id']);
function listUsers(sortBy) {
  if (!SORTABLE.has(sortBy)) throw new Error('cannot sort by ' + JSON.stringify(sortBy));
  return db.prepare(`SELECT name FROM users ORDER BY ${sortBy} DESC`).all().map((r) => r.name);
}
console.log('  sort by name:', listUsers('name'));
try {
  listUsers('name; DROP TABLE users');
} catch (err) {
  console.log('  rejected:', err.message);
}

console.log('');
console.log('PART B: NoSQL operator injection (a tiny stand-in for a MongoDB-style find)');

// A very small imitation of how a document database matches a filter object.
// Real MongoDB understands the same idea: a value that is an object with a $ key is an OPERATOR.
const operators = {
  $eq: (field, arg) => field === arg,
  $ne: (field, arg) => field !== arg,
  $gt: (field, arg) => field > arg,
  $in: (field, arg) => arg.includes(field),
};
function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    if (cond !== null && typeof cond === 'object') {
      return Object.entries(cond).every(([op, arg]) => operators[op](doc[key], arg));
    }
    return doc[key] === cond;
  });
}
const accounts = [
  { user: 'admin', pass: 's3cret!', role: 'admin' },
  { user: 'bob', pass: 'bobpw', role: 'user' },
];
const findOne = (filter) => accounts.find((doc) => matches(doc, filter)) ?? null;

// BAD: the request body goes straight into the query.
function loginNoSqlUnsafe(body) {
  return findOne({ user: body.user, pass: body.pass });
}

// GOOD: refuse anything that is not a plain string before it reaches the query.
function loginNoSqlSafe(body) {
  if (typeof body.user !== 'string' || typeof body.pass !== 'string') return 'rejected: user and pass must be strings';
  return findOne({ user: body.user, pass: body.pass });
}

// JSON.parse turns the text of a request body into real objects, exactly like express.json() does.
const goodBody = JSON.parse('{"user":"bob","pass":"bobpw"}');
const attackBody = JSON.parse('{"user":"admin","pass":{"$ne":""}}');

console.log('B1. normal body :', JSON.stringify(goodBody));
console.log('  unsafe:', loginNoSqlUnsafe(goodBody));
console.log('B2. attack body :', JSON.stringify(attackBody), '(pass is an object, not a string)');
console.log('  unsafe:', loginNoSqlUnsafe(attackBody));
console.log('  safe  :', loginNoSqlSafe(attackBody));
console.log('  safe with normal body:', loginNoSqlSafe(goodBody));

db.close();
