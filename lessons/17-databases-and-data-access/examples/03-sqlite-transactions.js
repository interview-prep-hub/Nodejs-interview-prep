// Transactions: BEGIN / COMMIT / ROLLBACK, a reusable helper, isolation between connections, lost updates
// Run: node lessons/17-databases-and-data-access/examples/03-sqlite-transactions.js

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function freshBank(db) {
  db.exec(`
    DROP TABLE IF EXISTS accounts;
    CREATE TABLE accounts (
      id      INTEGER PRIMARY KEY,
      owner   TEXT NOT NULL,
      balance INTEGER NOT NULL CHECK (balance >= 0)
    );
    INSERT INTO accounts (owner, balance) VALUES ('Ann', 100), ('Ben', 50);
  `);
}
const total = (db) => db.prepare('SELECT sum(balance) AS t FROM accounts').get().t;
const balances = (db) => db.prepare('SELECT balance FROM accounts ORDER BY id').all().map((r) => r.balance);

// Move money from account 1 to account 2. "crashAfterDebit" simulates a failure in the middle.
function transfer(db, amount, { crashAfterDebit = false } = {}) {
  db.prepare('UPDATE accounts SET balance = balance - ? WHERE id = 1').run(amount);
  if (crashAfterDebit) throw new Error('process crashed between the two updates');
  db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = 2').run(amount);
}

// The helper every project writes: run fn inside a transaction, commit on success, roll back on any error.
function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

async function main() {
  const db = new DatabaseSync(':memory:');

  console.log('1. without a transaction a crash leaves half a transfer');
  freshBank(db);
  try {
    transfer(db, 30, { crashAfterDebit: true });
  } catch (err) {
    console.log('  error:', err.message);
  }
  console.log('  balances:', balances(db), 'total:', total(db), '(30 coins vanished)');

  console.log('2. with a transaction it is all or nothing');
  freshBank(db);
  try {
    transaction(db, () => transfer(db, 30, { crashAfterDebit: true }));
  } catch (err) {
    console.log('  error:', err.message);
  }
  console.log('  balances after rollback:', balances(db), 'total:', total(db));
  transaction(db, () => transfer(db, 30));
  console.log('  balances after a good transfer:', balances(db), 'total:', total(db));

  console.log('3. a CHECK constraint failure also rolls the whole transfer back');
  try {
    transaction(db, () => transfer(db, 500));
  } catch (err) {
    console.log('  error:', err.errstr, '|', err.message);
  }
  console.log('  balances:', balances(db), 'in a transaction now?', db.isTransaction);

  console.log('4. savepoints: roll back only a part of a transaction');
  db.exec('BEGIN');
  db.exec("UPDATE accounts SET balance = balance + 1 WHERE id = 1");
  db.exec('SAVEPOINT risky');
  db.exec("UPDATE accounts SET balance = balance + 1000 WHERE id = 1");
  db.exec('ROLLBACK TO risky');
  db.exec('COMMIT');
  console.log('  balances (only the +1 survived):', balances(db));
  db.close();

  console.log('5. two connections: uncommitted changes are invisible, and only one writer at a time');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-demo-'));
  const file = path.join(dir, 'bank.db');
  const writer = new DatabaseSync(file);
  const reader = new DatabaseSync(file); // a second connection to the same file
  try {
    freshBank(writer);
    writer.exec('BEGIN IMMEDIATE'); // take the write lock now
    writer.exec('UPDATE accounts SET balance = 999 WHERE id = 1');
    console.log('  writer sees:', balances(writer));
    console.log('  reader sees:', balances(reader), '(no dirty read)');
    try {
      reader.exec('UPDATE accounts SET balance = 1 WHERE id = 1');
    } catch (err) {
      console.log('  second writer:', err.errcode, err.errstr);
    }
    writer.exec('COMMIT');
    console.log('  reader after COMMIT sees:', balances(reader));
  } finally {
    // runs even if something above throws, so no temp folder is left behind
    writer.close();
    reader.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('6. lost update: two requests read, wait, then write');
  const shop = new DatabaseSync(':memory:');
  shop.exec('CREATE TABLE stock (item TEXT PRIMARY KEY, qty INTEGER NOT NULL)');
  shop.exec("INSERT INTO stock VALUES ('pen', 10)");
  const later = () => new Promise((resolve) => setImmediate(resolve)); // stands for any await (network, other query)
  async function buyBad(n) {
    const row = shop.prepare("SELECT qty FROM stock WHERE item = 'pen'").get(); // read
    await later(); // the other request runs here
    shop.prepare("UPDATE stock SET qty = ? WHERE item = 'pen'").run(row.qty - n); // write a stale number
  }
  await Promise.all([buyBad(1), buyBad(1)]);
  console.log('  read-modify-write: 10 - 1 - 1 =', shop.prepare("SELECT qty FROM stock WHERE item = 'pen'").get().qty, '(wrong, one sale lost)');
  shop.exec("UPDATE stock SET qty = 10 WHERE item = 'pen'");
  async function buyGood(n) {
    await later();
    // one atomic statement: the database does the read and the write together
    return shop.prepare("UPDATE stock SET qty = qty - ? WHERE item = 'pen' AND qty >= ?").run(n, n).changes === 1;
  }
  await Promise.all([buyGood(1), buyGood(1)]);
  console.log('  atomic UPDATE: 10 - 1 - 1 =', shop.prepare("SELECT qty FROM stock WHERE item = 'pen'").get().qty);
  shop.close();

  console.log('7. optimistic locking: a version column detects that someone else saved first');
  const wiki = new DatabaseSync(':memory:');
  wiki.exec('CREATE TABLE pages (id INTEGER PRIMARY KEY, body TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1)');
  wiki.exec("INSERT INTO pages (body) VALUES ('first draft')");
  const save = (body, expectedVersion) => {
    const sql = 'UPDATE pages SET body = ?, version = version + 1 WHERE id = 1 AND version = ?';
    return wiki.prepare(sql).run(body, expectedVersion).changes === 1 ? 'saved' : 'CONFLICT, reload the page and try again';
  };
  const aliceSees = wiki.prepare('SELECT version FROM pages WHERE id = 1').get().version; // both open version 1
  const bobSees = wiki.prepare('SELECT version FROM pages WHERE id = 1').get().version;
  console.log('  alice saves (expects version ' + aliceSees + '):', save('alice edit', aliceSees));
  console.log('  bob saves   (expects version ' + bobSees + '):', save('bob edit', bobSees));
  console.log('  stored:', JSON.stringify(wiki.prepare('SELECT body, version FROM pages').get()));
  wiki.close();
}

main();
