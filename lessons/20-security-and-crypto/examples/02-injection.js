// Injection: SQL, NoSQL operator objects, template code and OS commands, each with the fix
// Run: node lessons/20-security-and-crypto/examples/02-injection.js
//
// Injection = data that reaches an interpreter (SQL engine, shell, template engine) and is read as CODE.
// Every payload below is harmless: it only prints text on your own machine.

const { DatabaseSync } = require('node:sqlite');
const { exec, execFile, spawnSync } = require('node:child_process');
const { promisify } = require('node:util');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

function lines(text) {
  return text.trim().split(/\r?\n/);
}

// ======================= 1. SQL injection (in-memory SQLite) =======================

function demoSql() {
  console.log('--- 1. SQL injection ---');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, password TEXT, is_admin INTEGER)');
  const insert = db.prepare('INSERT INTO users (name, password, is_admin) VALUES (?, ?, ?)');
  insert.run('alice', 'alice-pass', 0);
  insert.run('admin', 'a-long-secret', 1);

  const name = "admin' --"; // the attacker types this as the user name; "--" starts a SQL comment
  const password = 'wrong';

  // BAD: the input is glued into the SQL text.
  const badSql = `SELECT id, name, is_admin FROM users WHERE name = '${name}' AND password = '${password}'`;
  console.log('bad query :', badSql);
  const bad = db.prepare(badSql).all();
  console.log('bad result:', bad.length ? `logged in as ${bad[0].name} (is_admin=${bad[0].is_admin})` : 'no rows');

  // GOOD: a prepared statement sends the SQL and the values separately. "?" can only ever be a VALUE.
  const good = db.prepare('SELECT id, name, is_admin FROM users WHERE name = ? AND password = ?').all(name, password);
  console.log('good result:', good.length ? 'row found' : 'no rows');

  // Placeholders cannot be used for column or table names. Allow-list those instead.
  const SORTABLE = new Set(['name', 'id']);
  function listUsers(sortBy) {
    if (!SORTABLE.has(sortBy)) throw new Error(`cannot sort by ${sortBy}`);
    return db.prepare(`SELECT name FROM users ORDER BY ${sortBy}`).all().map((r) => r.name);
  }
  console.log('sort by name :', listUsers('name'));
  try {
    listUsers('name; DROP TABLE users');
  } catch (e) {
    console.log('sort by evil :', e.message);
  }

  // db.exec() runs several statements in one string, so it is the most dangerous call of all.
  db.exec(`DELETE FROM users WHERE name = 'nobody'; DROP TABLE users`);
  try {
    db.prepare('SELECT count(*) AS n FROM users').get();
  } catch (e) {
    console.log('after exec():', e.message);
  }
}

// ======================= 2. NoSQL operator injection (simulated) =======================

// A real MongoDB driver treats { $ne: null } inside a filter as the "not equal" OPERATOR.
// This tiny matcher imitates that, so you can see the bug without installing a database.
function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    if (cond !== null && typeof cond === 'object' && '$ne' in cond) return doc[key] !== cond.$ne;
    return doc[key] === cond;
  });
}

const accounts = [{ user: 'admin', pass: 'long-secret-value' }];

function findAccount(filter) {
  return accounts.find((doc) => matches(doc, filter));
}

function demoNoSql() {
  console.log('\n--- 2. NoSQL operator injection ---');
  // The body is JSON, so a client can send an OBJECT where you expected a string.
  const body = JSON.parse('{"user":"admin","pass":{"$ne":null}}');
  console.log('bad login (object passes through):', Boolean(findAccount({ user: body.user, pass: body.pass })));

  // Fix: insist on the type. A string can never be an operator.
  function login(user, pass) {
    if (typeof user !== 'string' || typeof pass !== 'string') return 'rejected: user and pass must be strings';
    return findAccount({ user, pass }) ? 'logged in' : 'wrong credentials';
  }
  console.log('good login with the same body    :', login(body.user, body.pass));
  console.log('good login with the real password:', login('admin', 'long-secret-value'));
}

// ======================= 3. Template injection =======================

// Anti-pattern: building a template string from user input and running it as code.
function renderUnsafe(template, data) {
  return new Function('data', `return \`${template}\``)(data);
}

// Safe: the template is fixed by the developer. User input is only ever DATA that fills the holes.
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function renderSafe(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(data[key] ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]));
}

function demoTemplate() {
  console.log('\n--- 3. template injection ---');
  console.log('intended use  :', renderUnsafe('Hello ${data.name}', { name: 'Ann' }));
  // The attacker controls the TEMPLATE text itself, so their code runs inside your process.
  const evil = 'Hello ${typeof process.env} / ${process.version.startsWith("v")}';
  console.log('attacker code :', renderUnsafe(evil, { name: 'x' }));
  // With the safe renderer the same text is only a name. It is printed, never run (and "<" is escaped).
  console.log('safe renderer :', renderSafe('Hello {{name}}', { name: '${typeof process.env} <b>' }));
}

// ======================= 4. OS command injection =======================

async function demoCommand() {
  console.log('\n--- 4. command injection ---');
  const name = 'Bob && echo INJECTED-COMMAND-RAN'; // "&&" means "and then run this too" in cmd.exe and in sh

  // BAD: exec() starts a SHELL and parses the whole string, so && becomes a second command.
  const bad = await execAsync(`echo Hello ${name}`);
  console.log('exec     :', lines(bad.stdout).map((l) => l.trimEnd()));

  // GOOD: execFile() starts the program directly. Arguments are an array and are never parsed by a shell.
  const script = 'console.log("Hello " + process.argv[1])';
  const good = await execFileAsync(process.execPath, ['-e', script, name]);
  console.log('execFile :', lines(good.stdout));

  // Quotes, spaces and shell characters are all plain text for execFile.
  const odd = await execFileAsync(process.execPath, ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', 'a b', "it's", '$(echo hi)']);
  console.log('odd args :', lines(odd.stdout)[0]);

  // spawn/execFile with { shell: true } and an args array goes back through the shell. Node warns about it (DEP0190).
  const code = "require('node:child_process').spawnSync('echo', ['hi'], { shell: true })";
  const child = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' });
  const warning = child.stderr.match(/\[DEP0190\] DeprecationWarning: [^.]*\./);
  console.log('shell:true:', warning ? warning[0] : '(no warning)');
}

async function main() {
  demoSql();
  demoNoSql();
  demoTemplate();
  await demoCommand();
}

main();
