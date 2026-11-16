# 17. Databases and Data Access

> Level: Intermediate   Time: about 200 minutes   Node: 24 (notes where older versions differ)

[Previous: 16. Testing Node.js Code](../16-testing/README.md) | [All lessons](../../README.md) | [Next: 18. worker_threads, cluster and Scaling on One Machine](../18-worker-threads-and-cluster/README.md)

## What you will learn
- How to choose between SQL, document, key-value and graph databases, and how to say it in an interview (plus the scaling words: replication, sharding, CAP)
- How Node talks to a database: the drivers `pg`, `mysql2`, `mongodb` and `ioredis` (as labelled snippets)
- Hands-on SQL with the built-in `node:sqlite` module: tables, CRUD, `NULL`, upsert, prepared statements, joins, `HAVING`, CTEs and window functions
- Transactions and ACID, isolation levels, deadlocks, lost updates, and how to avoid them
- SQL injection and NoSQL injection: how they work and the one habit that stops them
- Indexes and `EXPLAIN QUERY PLAN`, offset vs keyset pagination, the N+1 query problem, migrations
- Connection pools (you build a small one), ORMs vs query builders vs raw SQL, the repository pattern, validation at the boundary
- Errors, timeouts, retries and idempotency, caching with Redis (cache-aside, invalidation, stampede), config from the environment, graceful shutdown, and MongoDB basics

All 12 examples run from the repo root, for example `node lessons/17-databases-and-data-access/examples/01-sqlite-basics.js`. They use only core modules, need no database server and no internet, and finish by themselves. Real drivers (`pg`, `mongodb` and so on) appear only as clearly labelled snippets, because they need an npm package and a running server. Output blocks below are copied from real runs on Node 24.16.0 (Windows).

How to study: read a section, run its example, then change one thing in the example and run it again. Every section follows the same order: what the thing is, why it exists, the smallest example, what the output means, and the question an interviewer is likely to ask.

| Example file (in `examples/`) | Section | Shows |
|---|---|---|
| `01-sqlite-basics.js` | 3 | create, insert, select, update, delete, prepared statements, `NULL`, upsert, `RETURNING`, JSON in SQL |
| `02-sqlite-joins.js` | 4 | relationships, INNER and LEFT JOIN, GROUP BY, `HAVING`, subqueries, CTE, window function, foreign keys |
| `03-sqlite-transactions.js` | 5 | BEGIN, COMMIT, ROLLBACK, isolation, lost updates, optimistic locking |
| `04-injection.js` | 6 | SQL injection and NoSQL operator injection, and the fixes |
| `05-indexes-and-pagination.js` | 7, 8 | indexes, `EXPLAIN QUERY PLAN`, offset vs keyset pagination |
| `06-n-plus-one.js` | 9 | a query counter, JOIN, `IN` batch, a mini DataLoader |
| `07-connection-pool.js` | 10 | a hand-written async connection pool, leaks, shutdown |
| `08-migrations.js` | 11 | a mini migration runner with history and checksums |
| `09-repository-and-validation.js` | 13 | repository pattern, validation, swapping repositories |
| `10-retries-and-idempotency.js` | 14 | transient errors, backoff and jitter, timeouts, idempotency keys |
| `11-cache-aside.js` | 15 | cache-aside with TTL, invalidation, stampede |
| `12-config-and-shutdown.js` | 16 | config from the environment, graceful shutdown |

## 1. SQL or NoSQL? How to choose

A **database** keeps data after your program stops, lets many programs share it, and answers questions about it quickly. Different databases store data in different shapes and are good at different jobs.

**SQL** (Structured Query Language) is the language of relational databases. **NoSQL** is a loose label for "everything else".

| Family | Examples | How the data looks | Shines at | Typical use |
|---|---|---|---|---|
| Relational (SQL) | PostgreSQL, MySQL, SQLite, SQL Server | tables of rows with fixed columns, linked by keys | relationships, joins, transactions, flexible queries | users, orders, payments, most business apps |
| Document | MongoDB, Firestore, CouchDB | JSON-like documents, each may have its own shape | reading one whole "thing" in one go, changing shapes, spreading data over many servers (see 1.1) | product catalogs, content, profiles |
| Key-value | Redis, Memcached, DynamoDB | one key points to one value | very fast lookups by key, built-in expiry (TTL) | cache, sessions, rate limits, counters, queues |
| Graph | Neo4j | nodes and the edges (links) between them | questions about connections: "friends of friends" | recommendations, fraud rings, social graphs |
| Other | Cassandra (wide column), Elasticsearch (search), TimescaleDB (time series) | specialised layouts | huge write volumes, full-text search, metrics over time | logs, search boxes, monitoring |

How to choose, as short rules:

1. **Start from the data and how it is used, not from a brand.** What are the main things (entities)? How are they connected? Which reads and writes happen most? How bad is a stale or wrong answer? How big will it get?
2. **When unsure, start relational.** PostgreSQL is a safe default. It handles relationships, transactions and ad hoc queries, and it can also store JSON in a column for the flexible parts.
3. **Choose a document database** when each record is a self-contained bundle that you read and write whole (a product page with all its options) and its shape changes often.
4. **Choose key-value** for simple, fast, short-lived data: a cache, a session, a counter.
5. **Choose a graph database** only when the connections are the question (many hops).
6. **Real systems often mix them.** PostgreSQL as the source of truth, Redis as a cache, a search engine for the search box. Every extra database is one more thing to run, back up, monitor and keep in sync, so add one only for a clear reason.

| Scenario | Good fit | Why |
|---|---|---|
| Shop orders and payments | PostgreSQL or MySQL | money needs transactions and constraints |
| Login sessions, rate limiting | Redis | tiny values, very fast, expire by themselves |
| Catalog where every category has different attributes | MongoDB, or PostgreSQL with a JSON column | flexible shape, read as a whole |
| "People you may know" | graph database (small scale: SQL with recursive queries) | many-hop connections |
| Billions of sensor readings | wide-column or time-series database | write throughput, append-only |

> **Interview tip:** Never say "NoSQL is faster" or "SQL does not scale". A strong answer names the criteria: "I look at the data shape, the access patterns, the consistency I need and the team's skills. For orders and payments I'd use PostgreSQL for its transactions, and add Redis for caching and sessions. I'd only add a document store if the data really is document-shaped." Always name the trade-off you accept.

> **Common mistake:** "NoSQL has no schema, so no work." The schema does not disappear, it moves into your code. Your app still expects certain fields. Without validation (section 13) you end up with messy data. Also, NoSQL does not mean "no transactions": MongoDB supports multi-document transactions when it runs as a replica set or sharded cluster (both explained next), but not on a single standalone server. The line between SQL and NoSQL is blurry, so argue from the requirements.

### 1.1 Scaling and consistency words

A common follow-up to "which database?" is "and what happens when it gets big?". These are the words to know:

| Word | Plain meaning | What to say about it |
|---|---|---|
| Vertical scaling | give one server more CPU, memory and disk | simplest, but there is a ceiling and a single point of failure |
| Replication | keep copies of the data on other servers. One **primary** takes the writes, **replicas** copy them. MongoDB calls such a group a **replica set** | survives the loss of a server, and replicas can answer reads |
| Replication lag | a replica is a little behind the primary | a user saves a change, reads from a replica and does not see it yet. A fix: read from the primary right after a write |
| Sharding | split the data over several servers by a key, for example the user id | scales writes and size beyond one server. The cost: queries and transactions across shards are hard, and a bad key creates a hot shard |
| Eventual consistency | after a write, all copies agree after a short time, not instantly | many distributed databases choose it to stay fast and available |
| CAP theorem | when the network between servers breaks (a partition), a system must choose: stay **consistent** (refuse some requests) or stay **available** (answer, maybe with old data) | a way to talk about trade-offs. It does not mean "SQL is consistent and NoSQL is not" |

Order of work for a slow, busy read-heavy app: fix slow queries and indexes first (section 7), remove N+1 queries (section 9), add a cache (section 15), then add read replicas, and shard last because it is the most expensive to build and to undo.

## 2. How Node talks to a database: drivers

A **driver** is a library that speaks one database's network protocol for you. You give it a **connection string** (one text with user, password, host, port and database name) and it gives you functions that return promises.

| Database | Package | Placeholder style | Things to know |
|---|---|---|---|
| SQLite | built in: `node:sqlite` | `?` or `:name` | no server, synchronous (section 3) |
| PostgreSQL | `pg` | `$1`, `$2`, ... | has a `Pool`; bigint and `numeric` columns come back as strings |
| MySQL / MariaDB | `mysql2` (use `mysql2/promise`) | `?` | `execute()` uses real prepared statements, `query()` does not |
| MongoDB | `mongodb` | none, you pass filter objects | one `MongoClient` per process, it has its own pool |
| Redis | `ioredis` or `redis` | none, you send commands | one connection handles many commands at once |

These snippets are **illustrative only**. They need packages and servers that this repo does not install, so none of them is an example file. They show the usual shape of each driver.

**Needs: `npm install pg`** and a running PostgreSQL server.

```js
// Illustrative snippet, not runnable here
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const { rows } = await pool.query('SELECT id, email FROM users WHERE id = $1', [42]); // $1 is the placeholder
  console.log(rows[0]); // rows is an array of plain objects

  const { rows: [{ n }] } = await pool.query('SELECT count(*) AS n FROM users');
  console.log(typeof n); // 'string': count(*) is a 64-bit integer and pg returns those as strings by default

  await pool.end(); // close every connection when the program is done
}
main();
```

**Needs: `npm install mysql2`** and a running MySQL or MariaDB server.

```js
// Illustrative snippet, not runnable here
const mysql = require('mysql2/promise');

const pool = mysql.createPool(process.env.DATABASE_URL); // for example mysql://user:pass@host:3306/appdb

async function main() {
  const [rows] = await pool.execute('SELECT id, email FROM users WHERE id = ?', [42]); // returns [rows, fields]
  console.log(rows[0]);
  await pool.end();
}
main();
```

**Needs: `npm install mongodb`** and a running MongoDB server.

```js
// Illustrative snippet, not runnable here
const { MongoClient } = require('mongodb');

const client = new MongoClient(process.env.MONGODB_URI); // create ONE client per process and reuse it

async function main() {
  await client.connect();
  const users = client.db('app').collection('users');
  await users.insertOne({ email: 'ada@example.com', name: 'Ada' });
  const ada = await users.findOne({ email: 'ada@example.com' });
  console.log(ada._id, ada.name); // MongoDB adds a unique _id to every document
  await client.close();
}
main();
```

**Needs: `npm install ioredis`** and a running Redis server.

```js
// Illustrative snippet, not runnable here
const { Redis } = require('ioredis'); // named export. Older code uses the default export: const Redis = require('ioredis')

const redis = new Redis(process.env.REDIS_URL); // for example redis://localhost:6379

async function main() {
  await redis.set('greeting', 'hello', 'EX', 60); // the key expires after 60 seconds
  console.log(await redis.get('greeting')); // 'hello', or null once it has expired
  await redis.quit(); // close politely
}
main();
```

Three things are the same in every driver: the calls are asynchronous (they return promises), values travel separately from the command text, and you create the pool or client **once** when the app starts and share it.

> **Common mistake:** opening a new connection inside every request handler. Connecting is slow (section 10) and the database allows only a limited number of connections. Create the pool or client at startup, export it, and close it on shutdown (section 16).

> **Interview tip:** "How does your Node app talk to PostgreSQL?" A strong short answer: "Through a driver, `pg`. I create one `Pool` at startup from `DATABASE_URL`, run parameterised queries, borrow a client with `pool.connect()` for transactions and release it in `finally`, and call `pool.end()` on shutdown." Every part of that sentence is a section of this lesson.

## 3. Hands-on SQL with node:sqlite

**SQLite** is a complete SQL database packaged as a library. The data lives in one file, or in memory. There is no server to install. That makes it ideal for learning, tests, scripts and small apps, and the SQL you learn here is the same SQL you will write for PostgreSQL or MySQL (with small differences).

Node has SQLite built in:

| Question | Answer |
|---|---|
| How do I load it? | `require('node:sqlite')`. The `node:` prefix is required |
| Is a flag needed? | No on Node 24.16. It was added in Node 22.5.0 behind `--experimental-sqlite`, and the flag was removed in 22.13.0 and 23.4.0 |
| Is it stable? | The docs mark it **1.2 Release candidate**, so small API changes are still possible. On 24.16 it prints no warning |
| Which SQLite? | Version 3.53.0 is bundled with Node 24.16.0 (check with `SELECT sqlite_version()`) |
| Sync or async? | **Synchronous**: `DatabaseSync` and `StatementSync` block the event loop while a query runs |
| Older Node? | Use Node 24 for these examples. They were written and run on 24.16. Per the Node docs, `db.function()` needs 22.13+, `isOpen` needs 22.15+, and `isTransaction` and the `timeout` option need 22.16+ (or 24.0+) |
| Newer Node? | In Node 26.11 the class was renamed `Database` and `DatabaseSync` became a documentation-only deprecated alias (DEP0210). `DatabaseSync` still works, and it is the only name on 24.16 (`require('node:sqlite')` exports `DatabaseSync`, not `Database`) |

Most examples in this lesson use it. The first one, `examples/01-sqlite-basics.js`, walks through the basics. Each block below is a part of that file.

### 3.1 Open a database and create a table

`new DatabaseSync(':memory:')` opens a database in RAM. Pass a file path instead to keep the data on disk. `db.exec(sql)` runs SQL text and returns nothing.

```js
const { DatabaseSync } = require('node:sqlite');

// ':memory:' is a database that lives in RAM and disappears when the process ends.
const db = new DatabaseSync(':memory:');

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
```

```text
1. create a table (exec runs SQL text and returns nothing)
  tables: [ 'books' ]
```

A **table** has named columns with types. `PRIMARY KEY` marks the column that identifies each row. `NOT NULL` forbids empty values. `DEFAULT` fills in a value when you give none.

### 3.2 Insert with placeholders

`db.prepare(sql)` compiles a SQL text into a **prepared statement**. The `?` marks are **placeholders**: the values are sent separately and are never mixed into the SQL text (section 6 shows why that matters).

```js
const insert = db.prepare('INSERT INTO books (title, author, year, stock) VALUES (?, ?, ?, ?)');
const first = insert.run('Dune', 'Frank Herbert', 1965, 3);
console.log('  run() returned:', first);
insert.run('Emma', 'Jane Austen', 1815, 0);
insert.run('Neuromancer', 'William Gibson', 1984, 7);
```

```text
2. insert with ? placeholders (the values travel separately from the SQL)
  run() returned: { changes: 1, lastInsertRowid: 1 }
```

`run()` is for statements that do not return rows. It returns `{ changes, lastInsertRowid }`: how many rows changed, and the id of the row that was just inserted.

### 3.3 Select: get, all, iterate

```js
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
```

```text
3. select: get() = one row, all() = array, iterate() = one at a time
  get(1): [Object: null prototype] { id: 1, title: 'Dune' }
  has a prototype? false
  JSON: {"id":1,"title":"Dune"}
  get(99): undefined
  all(): [ 'Emma (1815)', 'Dune (1965)', 'Neuromancer (1984)' ]
  iterate: Dune
  iterate: Emma
  iterate: Neuromancer
```

- `get()` returns the first row, or `undefined` when there is none (not `null`, not an error).
- `all()` returns an array of every row. For a huge result use `iterate()`, which yields one row at a time.
- Rows are objects with a **null prototype**: they have no `toString` and no other inherited methods. `JSON.stringify` and property access work fine. If you need a normal object, copy it with `{ ...row }`.

A `SELECT` statement is built from clauses that always come in this order:

| Clause | Question it answers | Example |
|---|---|---|
| `SELECT` | which columns? | `SELECT title, year` |
| `FROM` | which table? | `FROM books` |
| `WHERE` | which rows? | `WHERE year > 1900 AND stock > 0` |
| `GROUP BY` | collapse rows into groups (section 4) | `GROUP BY author` |
| `HAVING` | which groups? (section 4) | `HAVING count(*) > 1` |
| `ORDER BY` | in what order? | `ORDER BY year DESC` |
| `LIMIT` / `OFFSET` | how many rows, starting where? | `LIMIT 10 OFFSET 20` |

Handy tests inside `WHERE`: `=`, `<>` (not equal), `<`, `>`, `AND`, `OR`, `IN (1, 2, 3)`, `BETWEEN 1 AND 5`, `LIKE 'Du%'` (`%` matches any text, `_` one character) and `IS NULL`.

### 3.4 Named parameters

Instead of `?` you can write `:name` and pass an object.

```js
const byAuthor = db.prepare('SELECT title FROM books WHERE author = :author AND year > :after');
console.log('  named:', byAuthor.all({ author: 'William Gibson', after: 1980 }));
```

```text
4. named parameters
  named: [ [Object: null prototype] { title: 'Neuromancer' } ]
```

### 3.5 Prepared statements are parsed once

Compiling SQL (turning the text into a plan the database can run) costs time. If you run the same statement many times, call `prepare()` once and call `run()` or `all()` many times. Two ideas are often mixed up: a **prepared statement** is compiled once and reused, and a **parameterised query** sends the values separately from the text. Drivers usually give you both at once, and the second one is what stops injection (section 6).

```js
const addStock = db.prepare('UPDATE books SET stock = stock + ? WHERE id = ?');
console.log('  source SQL:', addStock.sourceSQL);
for (const id of [1, 2, 3]) addStock.run(10, id);
console.log('  stocks:', db.prepare('SELECT id, stock FROM books ORDER BY id').all().map((r) => r.stock));
```

```text
5. a prepared statement is parsed once and reused
  source SQL: UPDATE books SET stock = stock + ? WHERE id = ?
  stocks: [ 13, 10, 17 ]
```

### 3.6 Update and delete

```js
const upd = db.prepare('UPDATE books SET year = ? WHERE title = ?');
console.log('  update:', upd.run(1966, 'Dune').changes, 'row changed');
console.log('  update nothing:', upd.run(0, 'No such book').changes, 'rows changed');
console.log('  lastInsertRowid is only about INSERT, an update keeps the old value:', upd.run(1966, 'Dune').lastInsertRowid);
console.log('  delete:', db.prepare('DELETE FROM books WHERE stock > ?').run(15).changes, 'row deleted');
console.log('  rows left:', db.prepare('SELECT count(*) AS n FROM books').get().n);
```

```text
6. update and delete report how many rows they changed
  update: 1 row changed
  update nothing: 0 rows changed
  lastInsertRowid is only about INSERT, an update keeps the old value: 3
  delete: 1 row deleted
  rows left: 2
```

`changes` tells you whether anything matched. An `UPDATE` or `DELETE` with a `WHERE` that matches nothing is not an error, it just changes 0 rows. Check `changes` when "not found" matters.

> **Common mistake:** `lastInsertRowid` is only meaningful right after an `INSERT`. The output above shows it still says 3 after an `UPDATE`, because it simply keeps the last value.

### 3.7 NULL: the value that is not equal to anything

`NULL` means "no value" or "unknown". A book whose year nobody knows has `year = NULL`. Because "unknown" cannot be compared, **any comparison with `NULL` is neither true nor false**, and `WHERE` keeps only rows where the test is true. The example inserts one book without a year (the other two books have years 1966 and 1815):

```js
db.prepare('INSERT INTO books (title, author) VALUES (?, ?)').run('Untitled draft', 'Anon'); // year stays NULL
const countWhere = (condition) => db.prepare(`SELECT count(*) AS n FROM books WHERE ${condition}`).get().n;
console.log('  year = NULL                  ->', countWhere('year = NULL'), 'rows (never true)');
console.log('  year IS NULL                 ->', countWhere('year IS NULL'), 'row');
console.log('  year != 1815                 ->', countWhere('year != 1815'), 'row (the NULL row is skipped too)');
console.log('  year != 1815 OR year IS NULL ->', countWhere('year != 1815 OR year IS NULL'), 'rows');
console.log('  coalesce(year, 0):', db.prepare('SELECT coalesce(year, 0) AS y FROM books ORDER BY id').all().map((r) => r.y));
```

```text
7. NULL means "unknown": it is not equal to anything, not even to NULL
  year = NULL                  -> 0 rows (never true)
  year IS NULL                 -> 1 row
  year != 1815                 -> 1 row (the NULL row is skipped too)
  year != 1815 OR year IS NULL -> 2 rows
  coalesce(year, 0): [ 1966, 1815, 0 ]
```

(The `countWhere` helper pastes a condition into the SQL text only because the conditions here are constants written by us. Never do that with user input, section 6.)

- `= NULL` finds nothing. Use `IS NULL` and `IS NOT NULL`.
- `year != 1815` does **not** return the `NULL` row, which surprises many people. Add `OR year IS NULL` when you want it.
- `coalesce(a, b)` returns the first value that is not `NULL`, handy for defaults. `count(column)` skips `NULL`s, while `count(*)` counts rows.

### 3.8 Upsert and RETURNING

An **upsert** is "insert, or update if the row already exists". It does the check and the write in one atomic statement, so two requests cannot both decide "it does not exist yet" (a race, section 5.4). The `ON CONFLICT` part names the column that can clash, and `excluded` means "the row I tried to insert". `RETURNING` hands back the affected row, so you do not need a second `SELECT`:

```js
const upsert = db.prepare(`
  INSERT INTO books (id, title, author, stock) VALUES (?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET stock = stock + excluded.stock
  RETURNING id, title, stock
`);
console.log('  id 1 exists, so its stock grows:', { ...upsert.get(1, 'Dune', 'Frank Herbert', 5) });
console.log('  id 10 is new, so it is inserted :', { ...upsert.get(10, 'Solaris', 'Stanislaw Lem', 2) });
console.log('  DELETE ... RETURNING            :', { ...db.prepare('DELETE FROM books WHERE id = ? RETURNING title').get(10) });
```

```text
8. upsert (insert or update) and RETURNING (get the row back)
  id 1 exists, so its stock grows: { id: 1, title: 'Dune', stock: 18 }
  id 10 is new, so it is inserted : { id: 10, title: 'Solaris', stock: 2 }
  DELETE ... RETURNING            : { title: 'Solaris' }
```

Dune's stock was 13, plus 5 gives 18. Use `get()` or `all()` (not `run()`) with `RETURNING`, because you want the rows. PostgreSQL has the same `ON CONFLICT ... DO UPDATE` and `RETURNING`. MySQL spells the upsert `ON DUPLICATE KEY UPDATE` and does not support `RETURNING`.

### 3.9 JSON inside a SQL column

Relational does not mean "no flexible data". SQLite, PostgreSQL (the `jsonb` type) and MySQL can store a JSON document in a column and query inside it. This is the usual answer to "my data is mostly relational but one part has a changing shape".

```js
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
```

```text
9. JSON inside a SQL column (document-style data, still queryable)
   [ 'login by ada', 'purchase by bob' ]
  invalid JSON is refused: CHECK constraint failed: json_valid(payload)
```

`->>` and `json_extract` read a value by its path (`$.user.name`). The `CHECK` rule keeps garbage out. The two events have different fields (`amount` exists on one only), and both live in the same table. You can even put an index on `payload ->> '$.type'`. In PostgreSQL, use `jsonb` and a GIN index (a special index for searching inside documents).

### 3.10 Errors

The example inserts a row without the required `author` and compiles a statement with a typo (`SELEC`). Both throw:

```text
10. errors carry SQLite codes
  constraint: ERR_SQLITE_ERROR 1299 constraint failed | NOT NULL constraint failed: books.author
  syntax: ERR_SQLITE_ERROR 1 | near "SELEC": syntax error
```

Every SQLite error has `code: 'ERR_SQLITE_ERROR'` plus `errcode` (SQLite's own number: 1 is a general SQL error, 1299 is a NOT NULL violation) and `errstr`. In real code, check `err.message` or `errcode`, and translate it into an error your app understands (section 13).

### 3.11 Close the database

`db.close()` releases the file and memory. Using the database afterwards throws:

```text
11. close the database when you are done
  isOpen: false
  after close: ERR_INVALID_STATE | database is not open
```

### 3.12 Types and gotchas

- **Placeholders are for values only.** You cannot use `?` for a table name, a column name or `ASC`/`DESC`.
- **Strings use single quotes** in SQL. Double quotes mean "a name". Writing `VALUES ("q")` fails with `no such column: "q" - should this be a string literal in single-quotes?`.
- **Booleans and `undefined` cannot be bound.** `stmt.get(true)` throws `ERR_INVALID_ARG_TYPE`. Store booleans as `1` and `0`.
- **Dates:** store ISO text (`'2026-11-10T12:00:00Z'`) or a number of milliseconds. SQLite has no date type.
- **Money:** store whole cents as integers, never floats (`0.1 + 0.2` is not `0.3`).
- **Big integers:** a value above `Number.MAX_SAFE_INTEGER` makes `get()` throw `ERR_OUT_OF_RANGE`. Call `stmt.setReadBigInts(true)` to get `BigInt` values instead.
- **Several statements:** `db.exec()` runs all statements in the text, but `db.prepare()` compiles only the first one and silently ignores the rest. This matters for injection (section 6).
- **Foreign keys** are enforced by default in `node:sqlite` (`PRAGMA foreign_keys` returns 1). Some other SQLite tools leave them off, so check when you use a different one.

> **Under the hood:** because `node:sqlite` is synchronous, a slow query blocks the whole event loop, so no other request is served meanwhile. That is fine for scripts, tests and small tools. A busy web server should use a network database with an async driver, or run SQLite inside a worker thread (next lesson). With a server database (PostgreSQL, MySQL) the query runs in another process and your event loop stays free.

> **Interview tip:** "What is a prepared statement and why use one?" Strong answer: "The database compiles the SQL once, and I run it many times with different values. The values are bound separately from the text, so they can never change the query, which also protects against SQL injection."

## 4. Relations and joins

Real data has relationships. A blog has authors, and each author has many posts. Instead of copying the author's name into every post, you store the author once and give each post an `author_id`. That column is a **foreign key**: it must match the `id` of a row in the `authors` table.

| Relationship | How to model it | Example |
|---|---|---|
| one-to-many | foreign key on the "many" side | `posts.author_id` points to `authors.id` |
| many-to-many | a third "link" table with two foreign keys | `post_tags(post_id, tag_id)` |
| one-to-one | foreign key with a `UNIQUE` constraint | `profiles.user_id` |

### 4.1 Normalization and keys

**Normalization** means storing each fact exactly once. If every post row held the author's name, renaming Ada would mean updating all her posts, and one missed row leaves "Ada" and "Ada L." in the same database. The usual rules, called normal forms:

| Form | Rule in plain words | Typical fix |
|---|---|---|
| 1NF | one value per cell, no repeating groups (no `'sql,perf,node'` in a single `tags` column) | give each item its own row, or a link table |
| 2NF | every column depends on the whole key, not on a part of a composite key | split the table |
| 3NF | every column depends on the key and on nothing else (a post row should not hold the author's email) | move the column to the table it belongs to |

Aim for 3NF. **Denormalization** is the deliberate opposite: copying data to make reads faster or simpler (a `comment_count` column on posts, an author name embedded in a MongoDB document). The price is that you must keep every copy in sync. The rule: normalize first, denormalize only for a measured reason.

Choosing a primary key:

| Key | Good | Watch out |
|---|---|---|
| auto-increment integer | small, fast, sorted by creation | guessable (`/orders/1043`), hard to generate in several places at once |
| UUID (`crypto.randomUUID()` gives a random v4) | unique without asking the database, hard to guess | larger, and random values scatter inserts across the index, which is slower on big tables |

Example `examples/02-sqlite-joins.js` builds authors, posts, tags and the link table:

```js
db.exec(`
  CREATE TABLE authors (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );
  CREATE TABLE posts (
    id        INTEGER PRIMARY KEY,
    author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
    title     TEXT NOT NULL,
    views     INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE tags (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
  );
  -- many-to-many: a post has many tags, a tag has many posts
  CREATE TABLE post_tags (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
    PRIMARY KEY (post_id, tag_id)
  );
`);
```

A **JOIN** combines rows from two tables. The `ON` part says how they match.

**INNER JOIN** keeps only rows that match on both sides:

```js
show(db.prepare(`
  SELECT posts.title, authors.name AS author
  FROM posts
  INNER JOIN authors ON authors.id = posts.author_id
  ORDER BY posts.id
`).all());
```

```text
2. INNER JOIN: only rows that match on both sides
   {"title":"Intro to SQL","author":"Ada"}
   {"title":"Indexes explained","author":"Ada"}
   {"title":"Why pools matter","author":"Bob"}
```

**LEFT JOIN** keeps every row from the left table, even without a match (the missing side becomes `NULL`). Cy has no posts but still appears:

```js
show(db.prepare(`
  SELECT authors.name AS author, posts.title
  FROM authors
  LEFT JOIN posts ON posts.author_id = authors.id
  ORDER BY authors.id, posts.id
`).all());
```

```text
3. LEFT JOIN: keep every author, even without posts (missing side is NULL)
   {"author":"Ada","title":"Intro to SQL"}
   {"author":"Ada","title":"Indexes explained"}
   {"author":"Bob","title":"Why pools matter"}
   {"author":"Cy","title":null}
```

**GROUP BY** collapses rows into groups so you can use aggregates such as `count()` and `sum()`:

```js
show(db.prepare(`
  SELECT authors.name AS author, count(posts.id) AS posts, coalesce(sum(posts.views), 0) AS views
  FROM authors
  LEFT JOIN posts ON posts.author_id = authors.id
  GROUP BY authors.id
  ORDER BY views DESC
`).all());
```

```text
4. GROUP BY with aggregates: posts and views per author
   {"author":"Ada","posts":2,"views":200}
   {"author":"Bob","posts":1,"views":45}
   {"author":"Cy","posts":0,"views":0}
```

Many-to-many needs two joins through the link table:

```js
show(db.prepare(`
  SELECT posts.title, tags.name AS tag
  FROM posts
  JOIN post_tags ON post_tags.post_id = posts.id
  JOIN tags      ON tags.id = post_tags.tag_id
  ORDER BY posts.id, tags.name
`).all());
```

```text
5. many-to-many: two joins through the link table
   {"title":"Intro to SQL","tag":"sql"}
   {"title":"Indexes explained","tag":"performance"}
   {"title":"Indexes explained","tag":"sql"}
   {"title":"Why pools matter","tag":"performance"}
```

A join returns **flat rows**, so parent columns repeat. If you want nested objects (`{ name, posts: [...] }`), build them in JavaScript:

```js
const flat = db.prepare(`
  SELECT authors.id AS author_id, authors.name, posts.title
  FROM authors JOIN posts ON posts.author_id = authors.id
  ORDER BY authors.id, posts.id
`).all();
const nested = new Map();
for (const row of flat) {
  if (!nested.has(row.author_id)) nested.set(row.author_id, { name: row.name, posts: [] });
  nested.get(row.author_id).posts.push(row.title);
}
console.log('  ', JSON.stringify([...nested.values()]));
```

```text
6. a join repeats the parent columns, so shape the rows in JavaScript
   [{"name":"Ada","posts":["Intro to SQL","Indexes explained"]},{"name":"Bob","posts":["Why pools matter"]}]
```

### 4.2 More query tools: HAVING, subqueries, CTEs, window functions

The next four parts of the example use the same three authors (Ada has 2 posts, Bob has 1, Cy has none).

**WHERE vs HAVING.** `WHERE` filters rows **before** they are grouped. `HAVING` filters the **groups** afterwards, so only `HAVING` can use an aggregate such as `count(*)`:

```js
show(db.prepare(`
  SELECT authors.name AS author, count(*) AS posts
  FROM authors JOIN posts ON posts.author_id = authors.id
  GROUP BY authors.id
  HAVING count(*) > 1
`).all());
```

```text
7. WHERE filters rows before grouping, HAVING filters the groups: authors with more than 1 post
   {"author":"Ada","posts":2}
```

**Subqueries.** A query inside a query. The first one finds posts with more views than the average. `NOT EXISTS` finds authors who have **no** matching post (an "anti-join": rows with no match. The other way is `LEFT JOIN posts ... WHERE posts.id IS NULL`):

```js
show(db.prepare('SELECT title, views FROM posts WHERE views > (SELECT avg(views) FROM posts) ORDER BY views DESC').all());
show(db.prepare('SELECT name FROM authors WHERE NOT EXISTS (SELECT 1 FROM posts WHERE posts.author_id = authors.id)').all());
```

```text
8. subqueries: a query inside a query
   {"title":"Intro to SQL","views":120}
   authors who have written nothing (NOT EXISTS):
   {"name":"Cy"}
```

The average is (120 + 80 + 45) / 3, about 81.7, so only the 120-view post is above it.

**CTE (common table expression).** `WITH name AS (...)` gives a subquery a name, so a long query reads from top to bottom instead of inside out:

```js
show(db.prepare(`
  WITH totals AS (
    SELECT author_id, sum(views) AS views FROM posts GROUP BY author_id
  )
  SELECT authors.name AS author, totals.views
  FROM totals JOIN authors ON authors.id = totals.author_id
  ORDER BY totals.views DESC
`).all());
```

```text
9. a CTE (WITH) gives a subquery a name, so long queries read top to bottom
   {"author":"Ada","views":200}
   {"author":"Bob","views":45}
```

**Window function.** A normal `GROUP BY` collapses rows. A window function (`OVER (...)`) calculates something across a group of rows and **keeps every row**. This one numbers each author's posts from most to least viewed, and the outer query keeps number 1: "the top post per author", a classic interview question.

```js
show(db.prepare(`
  SELECT author, title, views FROM (
    SELECT authors.name AS author, posts.title, posts.views,
           row_number() OVER (PARTITION BY posts.author_id ORDER BY posts.views DESC) AS n
    FROM posts JOIN authors ON authors.id = posts.author_id
  )
  WHERE n = 1
  ORDER BY author
`).all());
```

```text
10. a window function numbers rows inside each group without collapsing them
   {"author":"Ada","title":"Intro to SQL","views":120}
   {"author":"Bob","title":"Why pools matter","views":45}
```

`PARTITION BY` restarts the numbering for each author. Other window functions: `rank()`, `lag()`, and `sum(...) OVER (...)` for running totals. SQLite, PostgreSQL and MySQL 8 all support CTEs and window functions.

### 4.3 Foreign keys protect you

The database refuses a post whose author does not exist, and `ON DELETE CASCADE` deletes the child rows when the parent goes. Part 11 of the example inserts a post for author 999, then deletes Ada:

```text
11. foreign keys protect you from orphans
  insert: constraint failed | FOREIGN KEY constraint failed
  after deleting Ada (ON DELETE CASCADE) posts left: 1
  her tag links went too: 1 link left
```

> **Interview tip:** be ready to explain INNER vs LEFT JOIN with a tiny example, and to say what happens to rows without a match. Other classics: "WHERE vs HAVING?" (rows before grouping vs groups after), "What is normalization?" (each fact stored once, aim for 3NF) and "How do you model a many-to-many relationship?" (one answer: a link table).

## 5. Transactions, ACID and isolation levels

A **transaction** groups several statements into one unit. Either all of them take effect, or none.

Why? Think of a bank transfer: subtract 30 from Ann, add 30 to Ben. If the program dies between the two statements, money vanishes. Example `examples/03-sqlite-transactions.js` has a `transfer` function with a switch that simulates a crash right after the debit:

```js
// Move money from account 1 to account 2. "crashAfterDebit" simulates a failure in the middle.
function transfer(db, amount, { crashAfterDebit = false } = {}) {
  db.prepare('UPDATE accounts SET balance = balance - ? WHERE id = 1').run(amount);
  if (crashAfterDebit) throw new Error('process crashed between the two updates');
  db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = 2').run(amount);
}
```

Calling `transfer(db, 30, { crashAfterDebit: true })` on its own leaves half a transfer:

```text
1. without a transaction a crash leaves half a transfer
  error: process crashed between the two updates
  balances: [ 70, 50 ] total: 120 (30 coins vanished)
```

Wrap the two statements in `BEGIN` ... `COMMIT`, and roll back on any error. This small helper is the shape every project ends up with:

```js
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
```

Now `transaction(db, () => transfer(db, 30, { crashAfterDebit: true }))` fails with the same crash, but the debit is undone. A normal `transaction(db, () => transfer(db, 30))` commits both updates:

```text
2. with a transaction it is all or nothing
  error: process crashed between the two updates
  balances after rollback: [ 100, 50 ] total: 150
  balances after a good transfer: [ 70, 80 ] total: 150
```

`BEGIN` starts the transaction. `COMMIT` makes every change permanent at once. `ROLLBACK` undoes everything since `BEGIN`. Other databases use the same three words. Constraint failures also roll the transfer back. Here `transfer(db, 500)` tries to take more than the balance, so the `CHECK (balance >= 0)` rule on the table rejects the first update:

```text
3. a CHECK constraint failure also rolls the whole transfer back
  error: constraint failed | CHECK constraint failed: balance >= 0
  balances: [ 70, 80 ] in a transaction now? false
```

A **savepoint** is a bookmark inside a transaction. `ROLLBACK TO name` undoes only what happened after the bookmark:

```js
db.exec('BEGIN');
db.exec("UPDATE accounts SET balance = balance + 1 WHERE id = 1");
db.exec('SAVEPOINT risky');
db.exec("UPDATE accounts SET balance = balance + 1000 WHERE id = 1");
db.exec('ROLLBACK TO risky');
db.exec('COMMIT');
console.log('  balances (only the +1 survived):', balances(db));
```

```text
4. savepoints: roll back only a part of a transaction
  balances (only the +1 survived): [ 71, 80 ]
```

### 5.1 ACID

| Letter | Name | Plain meaning | Example |
|---|---|---|---|
| A | Atomicity | all or nothing | the transfer happens fully or not at all |
| C | Consistency | rules (constraints) always hold after a commit | balance never below 0, foreign keys valid |
| I | Isolation | transactions running at the same time do not see each other's half-done work | a reader never sees Ann's balance after the debit but before the credit |
| D | Durability | after COMMIT succeeds, the data survives a crash | the database wrote it to disk |

### 5.2 Isolation levels

Isolation is a dial. More isolation means fewer surprises but more waiting or retrying. The SQL standard defines four levels by which surprises (**anomalies**) they allow:

- **Dirty read:** you read data another transaction has not committed yet (and it may roll back).
- **Non-repeatable read:** you read a row twice in one transaction and get different values, because someone committed a change in between.
- **Phantom read:** you run the same query twice and get extra rows, because someone committed an insert in between.

| Level | Dirty read | Non-repeatable read | Phantom read |
|---|---|---|---|
| READ UNCOMMITTED | possible | possible | possible |
| READ COMMITTED | no | possible | possible |
| REPEATABLE READ | no | no | possible (the standard allows it; PostgreSQL prevents it) |
| SERIALIZABLE | no | no | no |

Defaults you should know: PostgreSQL uses READ COMMITTED (and treats READ UNCOMMITTED as READ COMMITTED), MySQL with InnoDB uses REPEATABLE READ, SQL Server uses READ COMMITTED. SQLite allows one writer at a time, so its writes behave like SERIALIZABLE. In PostgreSQL you pick a level per transaction: `BEGIN ISOLATION LEVEL SERIALIZABLE`. At SERIALIZABLE the database may abort a transaction with a "could not serialize" error, and your code must **retry** it (section 14).

The next part of the example opens two connections to the same file. Uncommitted changes stay invisible to the other connection (no dirty read), and a second writer is turned away:

```js
const writer = new DatabaseSync(file);
const reader = new DatabaseSync(file); // a second connection to the same file
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
```

```text
5. two connections: uncommitted changes are invisible, and only one writer at a time
  writer sees: [ 999, 50 ]
  reader sees: [ 100, 50 ] (no dirty read)
  second writer: 5 database is locked
  reader after COMMIT sees: [ 999, 50 ]
```

Error code 5 is `SQLITE_BUSY`, "database is locked". By default the second writer fails immediately. You can make it wait up to some milliseconds with `new DatabaseSync(file, { timeout: 5000 })`. For apps with several connections, `PRAGMA journal_mode = WAL` is the usual setting. WAL means **write-ahead log**: changes are first appended to a separate log file, so readers keep reading the old data while the writer works, and the two no longer block each other. Do not read part 5 as "readers are never blocked": in the default mode a writer that is about to commit can briefly block readers.

> **Under the hood:** PostgreSQL and MySQL (InnoDB) get the same effect with **MVCC** (multi-version concurrency control). An update keeps the old version of the row available while it builds the new one (PostgreSQL stores a new row version, InnoDB keeps an undo log). Each transaction reads the versions that were current when its snapshot was taken, so readers do not wait for writers. The isolation level decides **when** the snapshot is taken: for every statement in READ COMMITTED, once per transaction in REPEATABLE READ.

> **Interview tip:** "Explain isolation levels." Name the three anomalies (dirty read, non-repeatable read, phantom read), give the table above in one breath, and add: "most apps run on the default, READ COMMITTED in PostgreSQL. I move up to SERIALIZABLE only for a few critical transactions and retry when the database aborts one."

### 5.3 Locks and deadlocks

A database uses **locks** to keep transactions apart. A **deadlock** happens when two transactions each hold a lock the other needs:

| Step | Transaction A | Transaction B |
|---|---|---|
| 1 | locks row 1 | locks row 2 |
| 2 | wants row 2, waits for B | wants row 1, waits for A |
| 3 | stuck forever, so the database picks a victim and aborts one of them | |

PostgreSQL reports error `40P01` (`deadlock_detected`), MySQL reports error 1213 (`ER_LOCK_DEADLOCK`). To reduce deadlocks: touch rows in the **same order** everywhere, keep transactions **short** (no network calls or user waits inside), and **retry** the aborted transaction. Deadlock errors are a normal event under load, not a bug to hide.

### 5.4 Lost updates

Even with transactions you can lose data if your Node code reads, waits, then writes a stale number. This is a **race condition** (a bug whose result depends on the timing of two things happening at once) in your code, not in the database. Two requests both read `qty = 10`, both write `9`:

```js
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
```

```text
6. lost update: two requests read, wait, then write
  read-modify-write: 10 - 1 - 1 = 9 (wrong, one sale lost)
  atomic UPDATE: 10 - 1 - 1 = 8
```

Three fixes:

1. **One atomic statement.** `UPDATE stock SET qty = qty - 1 WHERE qty >= 1` lets the database do the read and the write together. Check `changes` to see if it worked. This is the best answer for counters and stock.
2. **Optimistic locking.** Add a `version` column. Update only `WHERE version = <the version I read>`. If `changes` is 0, someone else saved first: reload and retry.
3. **Pessimistic locking.** `SELECT ... FOR UPDATE` (PostgreSQL, MySQL) locks the row until you commit. Safe, but others wait. Adding `SKIP LOCKED` makes other workers skip rows that are already locked instead of waiting, which is the standard way to build a job queue in SQL ("give each worker a different pending job").

Optimistic locking in the example:

```js
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
```

```text
7. optimistic locking: a version column detects that someone else saved first
  alice saves (expects version 1): saved
  bob saves   (expects version 1): CONFLICT, reload the page and try again
  stored: {"body":"alice edit","version":2}
```

> **Interview tip:** "How do you stop two buyers purchasing the last item?" Strong answer: an atomic `UPDATE ... WHERE stock >= n` inside a transaction (or optimistic locking with a version column), checking the affected row count. Weak answer: "read the stock in JavaScript, then update". One more thing for async drivers: with a connection pool, `BEGIN`, the statements and `COMMIT` must all run on the **same** connection (section 10 shows how).

## 6. SQL injection (and NoSQL injection)

**SQL injection** happens when user input becomes part of the SQL text, so the attacker's input is run as code. It is one of the oldest and still most common web vulnerabilities.

Example `examples/04-injection.js`, part A. Two login functions: one glues strings together, one uses placeholders.

```js
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
```

A normal login works with both. Now the attacks:

```text
A1. a normal login works with both versions
  SQL sent: SELECT name, role FROM users WHERE name = 'bob' AND password = 'bobpw'
  unsafe: [Object: null prototype] { name: 'bob', role: 'user' }
  safe  : [Object: null prototype] { name: 'bob', role: 'user' }
A2. attack: name = admin' --   (the -- starts a comment, so the password check disappears)
  SQL sent: SELECT name, role FROM users WHERE name = 'admin' --' AND password = 'anything'
  unsafe: [Object: null prototype] { name: 'admin', role: 'admin' }
  safe  : null
A3. attack: password = ' OR '1'='1   (the condition becomes always true)
  SQL sent: SELECT name, role FROM users WHERE name = 'nobody' AND password = '' OR '1'='1'
  unsafe: [Object: null prototype] { name: 'admin', role: 'admin' }
  safe  : null
```

Look at the SQL that was really sent. With `admin' --`, the quote ends the string early and `--` starts a comment, so the password check is **commented out**. With `' OR '1'='1`, the condition `OR '1'='1'` is always true. The safe version treats the whole input as one plain string value, so both attacks simply find no user.

`exec()` is even more dangerous because it runs **every** statement in the text:

```js
const evilName = "x'; DROP TABLE users; --";
db.exec(`SELECT * FROM users WHERE name = '${evilName}'`); // exec runs ALL statements in the string
const left = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'users'").get().n;
console.log('  users table still exists?', left === 1);
```

```text
A4. attack through exec(): a second statement rides along
  users table still exists? false
```

The attacker's `'; DROP TABLE users; --` ended the first statement and ran a second one. The table is gone.

### 6.1 The fix and its limits

- **Always use placeholders** (`?`, `$1`, `:name`) for every value. The database receives the SQL and the values separately, so a value can never change the structure of the query.
- **Placeholders cannot hold names.** For `ORDER BY` columns, table names or directions, check the input against an **allow list** (a fixed list of accepted values, everything else is rejected) and build the SQL from your own constants:

```js
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
```

```text
A5. placeholders cannot hold table or column names, so use an allow list
  sort by name: [ 'bob', 'admin' ]
  rejected: cannot sort by "name; DROP TABLE users"
```

- **`LIKE` wildcards:** with `WHERE name LIKE ?`, an input of `%` is still a wildcard. That is not an injection, but it can make a slow query. Escape `%` and `_` if you want a literal match (task 2 below does this).
- **ORMs are not magic.** Raw fragments are still concatenation: `sequelize.query` with a template string, Knex `.raw()` with `${}`, Prisma `$queryRawUnsafe`. Use their parameterised forms (`replacements`/`bind`, `?` bindings, the `$queryRaw` tagged template).
- **Defence in depth** means several layers, so one mistake is not fatal. Give the app's database user the **least privilege** it needs (it may read and write rows, but not `DROP` tables), never send raw database errors to clients, and store passwords as slow hashes (`crypto.scrypt`, lesson 20), never in plain text. The demo stores plain text only to stay short.

### 6.2 NoSQL injection

Document databases are not safe just because they have no SQL text. A MongoDB filter is an **object**, and a key that starts with `$` is an **operator** (`$ne` means "not equal", `$gt` "greater than"). If you pass `req.body` straight into a query, the client chooses the operators.

Part B of the example uses a tiny stand-in for a MongoDB-style filter matcher (about 15 lines in the file; it supports `$eq`, `$ne`, `$gt` and `$in`). Here is the login code that uses it:

```js
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

console.log('  unsafe:', loginNoSqlUnsafe(goodBody));
console.log('  unsafe:', loginNoSqlUnsafe(attackBody));
console.log('  safe  :', loginNoSqlSafe(attackBody));
console.log('  safe with normal body:', loginNoSqlSafe(goodBody));
```

```text
PART B: NoSQL operator injection (a tiny stand-in for a MongoDB-style find)
B1. normal body : {"user":"bob","pass":"bobpw"}
  unsafe: { user: 'bob', pass: 'bobpw', role: 'user' }
B2. attack body : {"user":"admin","pass":{"$ne":""}} (pass is an object, not a string)
  unsafe: { user: 'admin', pass: 's3cret!', role: 'admin' }
  safe  : rejected: user and pass must be strings
  safe with normal body: { user: 'bob', pass: 'bobpw', role: 'user' }
```

The attacker sent `{"pass":{"$ne":""}}` ("password is not empty"). `JSON.parse` (and `express.json()`) happily create the nested object, and the filter matches the admin without knowing the password.

Fixes: **validate types at the boundary** (section 13), so `pass` must be a string; never pass a request body object into a query; do not use server-side JavaScript operators such as `$where` with user input; and compare password hashes in your code, not in the query. Mongoose also has a `sanitizeFilter` option (off by default) that wraps any nested object with a `$` key in `$eq`, so it is treated as a plain value instead of an operator, but a schema validator is the more general defence.

> **Interview tip:** "How do you prevent SQL injection?" The one-line answer is "parameterised queries / prepared statements". A strong answer adds the three extras: allow lists for names, least-privilege database users, and validating input types (which also stops the NoSQL variant).

## 7. Indexes and EXPLAIN

Without an index, to find one row the database reads **every** row. That is called a **full scan**. With 20 rows it is instant. With 20 million it is a disaster.

An **index** is a separate, sorted structure (usually a **B-tree**, a balanced tree that finds a value in a few steps even among millions) that maps column values to rows. It works like the index at the back of a book: instead of reading every page, you look up the word and jump to the page.

To see what the database will do, ask it for the **query plan**. In SQLite that is `EXPLAIN QUERY PLAN`. In PostgreSQL use `EXPLAIN` (and `EXPLAIN ANALYZE` to really run it), in MySQL `EXPLAIN`, in MongoDB `.explain('executionStats')`.

Example `examples/05-indexes-and-pagination.js` builds a table with 20,000 users, then looks up one email.

```js
// Print how SQLite plans to run a query. Only the "detail" column matters for us.
function plan(sql, ...params) {
  const rows = db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...params);
  console.log('  ', sql.replace(/\s+/g, ' ').trim());
  for (const r of rows) console.log('      ->', r.detail);
}
```

```js
plan('SELECT * FROM users WHERE email = ?', 'user777@example.com');

function timeLookups() {
  const stmt = db.prepare('SELECT id FROM users WHERE email = ?');
  const start = performance.now();
  for (let i = 1; i <= 200; i++) stmt.get(`user${i * 90}@example.com`);
  return performance.now() - start;
}
const slow = timeLookups();

db.exec('CREATE INDEX idx_users_email ON users(email)');
plan('SELECT * FROM users WHERE email = ?', 'user777@example.com');
const fast = timeLookups();
console.log('  200 lookups faster with the index?', fast < slow, '(exact times differ on every machine)');
```

```text
2. without an index SQLite must SCAN (read) every row
   SELECT * FROM users WHERE email = ?
      -> SCAN users
3. add an index: now it can SEARCH like a book index
   SELECT * FROM users WHERE email = ?
      -> SEARCH users USING INDEX idx_users_email (email=?)
  200 lookups faster with the index? true (exact times differ on every machine)
```

`SCAN users` means "read every row". `SEARCH users USING INDEX` means "jump straight to the match". The timing line prints only `true` because exact times differ on every machine.

An index helps only when the query **fits** it:

```js
plan('SELECT * FROM users WHERE lower(email) = ?', 'user777@example.com'); // function on the column
db.exec('CREATE INDEX idx_users_city_age ON users(city, age)'); // composite: city first, then age
plan('SELECT * FROM users WHERE city = ? AND age > ?', 'Oslo', 30); // uses both parts
plan('SELECT * FROM users WHERE age > ?', 30); // age alone is not the first column
plan('SELECT * FROM users ORDER BY age'); // no index starts with age, so SQLite sorts
plan('SELECT * FROM users WHERE city = ? ORDER BY age', 'Oslo'); // the index already gives the order
plan('SELECT city, age FROM users WHERE city = ?', 'Oslo'); // covering: the index has all the columns needed
```

```text
4. an index is only used when the query matches it
   SELECT * FROM users WHERE lower(email) = ?
      -> SCAN users
   SELECT * FROM users WHERE city = ? AND age > ?
      -> SEARCH users USING INDEX idx_users_city_age (city=? AND age>?)
   SELECT * FROM users WHERE age > ?
      -> SCAN users
   SELECT * FROM users ORDER BY age
      -> SCAN users
      -> USE TEMP B-TREE FOR ORDER BY
   SELECT * FROM users WHERE city = ? ORDER BY age
      -> SEARCH users USING INDEX idx_users_city_age (city=?)
   SELECT city, age FROM users WHERE city = ?
      -> SEARCH users USING COVERING INDEX idx_users_city_age (city=?)
```

What the plans teach:

- **Wrap a column in a function and the index is lost.** `lower(email) = ?` cannot use an index on `email`. Store the value already lowercased, or create an index on the expression (PostgreSQL and SQLite support this).
- **Composite index `(city, age)`** works for `city`, and for `city` plus `age`. It does not work for `age` alone (the "leftmost prefix" rule). Column order matters.
- **Sorting:** `ORDER BY age` with no matching index needs a temporary sort (`USE TEMP B-TREE FOR ORDER BY`). With `WHERE city = ? ORDER BY age` the composite index returns rows already in order, so no sort is needed.
- **Covering index:** if the index holds every column the query needs, the table itself is not read (`COVERING INDEX`).
- A pattern that starts with a wildcard (`LIKE '%word'`) cannot use an ordinary index.

A `UNIQUE` index also guards your data. It is the safe way to enforce "one account per email", because two requests racing each other cannot both insert the same value:

```js
db.exec('CREATE UNIQUE INDEX idx_users_email_unique ON users(email)');
try {
  addUser.run('user1@example.com', 'Oslo', 40);
} catch (err) {
  console.log('  duplicate email:', err.message);
}
```

```text
5. a UNIQUE index also protects the data
  duplicate email: UNIQUE constraint failed: users.email
```

Costs and rules of thumb:

- Every index uses disk and memory, and makes every `INSERT`, `UPDATE` and `DELETE` slower, because the index must be updated too. Do not index everything.
- Index the columns you filter on (`WHERE`), join on (foreign keys) and sort on (`ORDER BY`), in big tables.
- PostgreSQL does **not** create an index on a foreign key column for you (MySQL InnoDB does), so add one yourself.
- A column with few distinct values (a yes/no flag) is a poor index on its own.
- Many inserts at once are much faster inside **one transaction** when the database is a file: every single autocommitted `INSERT` (one that commits by itself) waits for the disk to confirm the write, while a batch waits once. The example uses an in-memory database, where the gap is small, but it keeps the good habit. In PostgreSQL the fastest bulk load is `COPY`, and a multi-row `INSERT ... VALUES (...), (...), (...)` beats one statement per row.

Other kinds of index you will hear about:

| Kind | What it is | Use it for |
|---|---|---|
| Unique index | a B-tree that also rejects duplicates | emails, usernames, idempotency keys (section 14) |
| Composite index | an index on several columns, the order matters | `WHERE city = ? AND age > ?` |
| Partial index | indexes only the rows that match a `WHERE`, for example `... WHERE status = 'pending'` | a small index over the few rows you query often (SQLite and PostgreSQL) |
| Expression index | indexes the result of an expression, for example `lower(email)` | queries that apply that same function (SQLite and PostgreSQL) |
| GIN, GiST (PostgreSQL) | indexes for searching inside values | JSON documents, arrays, full-text search |

> **Interview tip:** "A query is slow, what do you do?" Strong answer: measure first, run `EXPLAIN` to see whether it scans the whole table, check that an index matches the `WHERE` and `ORDER BY`, look for N+1 patterns (next sections) and for deep `OFFSET` pagination, and only then think about caching or scaling out.

## 8. Pagination: offset vs keyset

Never return a million rows in one response. Return a **page**. There are two ways.

### 8.1 Offset pagination

`LIMIT 5 OFFSET 10` means "skip 10 rows, give me the next 5". It is simple, and the user can jump to page 40. But the database must still walk past all the skipped rows, so deep pages get slower and slower.

In the same file (`examples/05-indexes-and-pagination.js`) a counter function is called by SQLite for every row it looks at, so we can count the work instead of timing it.

```js
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

for (const pageNumber of [1, 2, 200, 4000]) {
  examined = 0;
  const rows = offsetPage.all((pageNumber - 1) * PAGE);
  console.log(`  page ${String(pageNumber).padStart(4)}: first id ${rows[0].id}, rows examined: ${examined}`);
}
```

```text
7. OFFSET pagination: the database must walk past every skipped row
  page    1: first id 20000, rows examined: 5
  page    2: first id 19995, rows examined: 10
  page  200: first id 19005, rows examined: 1000
  page 4000: first id 5, rows examined: 20000
```

Page 1 looks at 5 rows. Page 4000 looks at all 20,000. The cost grows with the page number. (These exact counts come from the SQLite 3.53.0 query planner that ships with Node 24.16. A different SQLite build may choose another plan and print other numbers, but deep pages still cost more than early ones.)

The second problem is **unstable pages**. If a new row arrives between two page loads, everything shifts by one:

```js
const page1 = offsetPage.all(0).map((r) => r.id);
addPost.run(1800000000, 'a brand new post'); // appears at the top of the feed
const page2Offset = offsetPage.all(PAGE).map((r) => r.id);
console.log('  page 1 ids:', page1);
console.log('  page 2 ids (OFFSET):', page2Offset, '<- repeats id', page1[PAGE - 1]);
```

```text
8. OFFSET also breaks when data changes between two page loads
  page 1 ids: [ 20000, 19999, 19998, 19997, 19996 ]
  page 2 ids (OFFSET): [ 19996, 19995, 19994, 19993, 19992 ] <- repeats id 19996
```

The user sees id 19996 twice. (When rows are deleted instead, a row is skipped.)

### 8.2 Keyset (cursor) pagination

Instead of "skip N rows" say "give me the rows after the last one I saw". The client sends back the last row's sort key as a **cursor**. The query uses `WHERE (created_at, id) < (?, ?)`, which an index can answer by jumping straight to that spot.

```js
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
```

```text
9. keyset (cursor) pagination: "give me the rows after the last one I saw"
  page 1 ids: [ 20001, 20000, 19999, 19998, 19997 ] (20001 is the post added in step 8)
  cursor: WzE3MDAwMDY2NjUsMTk5OTdd which decodes to [1700006665,19997]
  page 2 ids: [ 19996, 19995, 19994, 19993, 19992 ] rows examined: 5
  page 2 after another insert: [ 19996, 19995, 19994, 19993, 19992 ] (same, nothing repeated)
```

Every page examines 5 rows, and page 2 stays the same even after another insert. Walking the entire feed with cursors visits every row exactly once, and the plan uses the index:

```text
10. walk the whole feed with cursors: no row twice, no row missed
  pages: 4001  distinct ids: 20002  most rows examined on one page: 5
  the keyset query plan:
   SELECT id FROM posts WHERE (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT 5
      -> SEARCH posts USING COVERING INDEX idx_posts_feed (created_at<?)
```

| | OFFSET | Keyset (cursor) |
|---|---|---|
| Cost of page N | grows with N | the same for every page (with an index) |
| Stable when data changes | no (repeats or skips) | yes |
| Jump to page 50 | yes | no, only "next" and "previous" |
| Needs | nothing special | a unique, indexed sort order |
| Good for | small tables, admin screens | feeds, infinite scroll, public APIs, big tables |

Details interviewers like:

- The sort must be **total**: add the unique `id` as a tie-breaker, because `created_at` alone is not unique (three posts share each second in the example).
- Treat the cursor as an **opaque** token (here base64url of a JSON array). The client should not build or edit it.
- A total page count needs `count(*)`, which is slow on big tables. Many APIs skip it and return only `nextCursor`.
- MongoDB has the same split: `skip()` is offset-style, a range query on `_id` or another indexed field is keyset-style.

### 8.3 Very big results: stream them

Pagination is for clients. When your own code must walk a huge table (an export, a migration, a nightly job), do not call `all()` and hold a million rows in memory. Read them one at a time: `iterate()` in `node:sqlite`, a cursor in `pg` (the `pg-cursor` or `pg-query-stream` packages), or `for await (const doc of collection.find(filter))` in the MongoDB driver. This is the same backpressure idea as in lesson 11 (Streams): read only as fast as you can process.

> **Interview tip:** "Offset or cursor pagination?" Strong answer: "Offset is simple and lets users jump to a page, but deep pages get slower and rows can repeat or vanish when data changes. For feeds and big tables I use keyset pagination on an indexed, unique sort key, return an opaque cursor, and skip the total count unless it is really needed."

## 9. The N+1 query problem

**N+1** means: one query to get a list of N things, then one more query for each of them. That is N+1 queries when 1 or 2 would do. It is the most common performance bug with ORMs, because the extra queries are hidden inside a loop or inside a property access.

Every **round trip** (your app sends one query and waits for the answer) costs time: a fraction of a millisecond inside one data center, much more across regions. The database must also plan each query. 21 small queries are far worse than 2 bigger ones.

Example `examples/06-n-plus-one.js` routes every query through one function so it can count them.

```js
// Every query in this file goes through this function, so we can count the round trips.
let queries = 0;
function query(sql, ...params) {
  queries++;
  return db.prepare(sql).all(...params);
}
```

The bad version loads 20 posts, then asks for each author separately:

```js
const posts = query('SELECT id, author_id, title FROM posts');
const withAuthors = posts.map((post) => {
  const author = query('SELECT name FROM authors WHERE id = ?', post.author_id)[0]; // runs 20 times
  return { title: post.title, author: author.name };
});
console.log('  first row:', JSON.stringify(withAuthors[0]));
report('N+1 (20 posts)');
```

```text
1. N+1: one query for the list, then one more query per row
  first row: {"title":"Post 1","author":"Author 2"}
  N+1 (20 posts): 21 queries, about 21 ms of network time if each trip costs 1 ms
```

**Fix A: JOIN.** Let the database combine the tables in one query:

```js
const joined = query(`
  SELECT posts.title, authors.name AS author
  FROM posts JOIN authors ON authors.id = posts.author_id
`);
console.log('  first row:', JSON.stringify(joined[0]));
report('JOIN');
```

```text
2. fix A: let the database JOIN the two tables in ONE query
  first row: {"title":"Post 1","author":"Author 2"}
  JOIN: 1 query, about 1 ms of network time if each trip costs 1 ms
```

**Fix B: batch with `IN (...)`.** Collect the ids, fetch all parents at once, then connect them in JavaScript. This is better than a JOIN when the child rows would repeat big parent rows many times, or when the data comes from different services:

```js
const postRows = query('SELECT id, author_id, title FROM posts');
const authorIds = [...new Set(postRows.map((p) => p.author_id))];
const marks = authorIds.map(() => '?').join(', '); // "?, ?, ?, ?, ?"
const authorRows = query(`SELECT id, name FROM authors WHERE id IN (${marks})`, ...authorIds);
const authorById = new Map(authorRows.map((a) => [a.id, a]));
const stitched = postRows.map((p) => ({ title: p.title, author: authorById.get(p.author_id).name }));
console.log('  first row:', JSON.stringify(stitched[0]));
report('IN batch');
```

```text
3. fix B: collect the ids, then fetch all parents with IN (...) in ONE more query
  first row: {"title":"Post 1","author":"Author 2"}
  IN batch: 2 queries, about 2 ms of network time if each trip costs 1 ms
```

The same trap appears one level deeper (posts, then comments for each post) and is fixed the same way (part 4 of the file, same answer, 21 queries become 2):

```text
4. the same trap one level deeper (posts -> comments), fixed the same way
  N+1 for comments: 21 queries, about 21 ms of network time if each trip costs 1 ms
  IN batch for comments: 2 queries, about 2 ms of network time if each trip costs 1 ms
  same answer? true
```

**Fix C: a DataLoader.** In GraphQL, each field has a small function (a **resolver**) that fetches its own data, so the resolver of each post asks for its own author and nobody sees the whole list at once. A **loader** collects all the `load(id)` calls made in the same tick and runs one batched query. The library `dataloader` does this; the example shows the idea in 20 lines:

```js
function createLoader(batchFn) {
  const cache = new Map(); // id -> promise, so asking twice costs nothing
  let pending = []; // [{ id, resolve }] collected during this tick
  function flush() {
    const batch = pending;
    pending = [];
    const rows = batchFn(batch.map((item) => item.id)); // ONE call for the whole batch
    for (const item of batch) item.resolve(rows.get(item.id));
  }
  return {
    load(id) {
      if (!cache.has(id)) {
        cache.set(id, new Promise((resolve) => {
          if (pending.length === 0) queueMicrotask(flush); // schedule one flush for this tick
          pending.push({ id, resolve });
        }));
      }
      return cache.get(id);
    },
  };
}
const authorLoader = createLoader((idList) => {
  const rows = query(`SELECT id, name FROM authors WHERE id IN (${idList.map(() => '?').join(', ')})`, ...idList);
  return new Map(rows.map((r) => [r.id, r.name]));
});
```

```text
5. a tiny DataLoader: many load(id) calls in the same tick become ONE query
  first row: {"title":"Post 1","author":"Author 2"}  rows: 20
  DataLoader: 2 queries, about 2 ms of network time if each trip costs 1 ms
```

How each tool avoids N+1 (all are illustrative one-liners, not runnable here):

| Tool | Load the relation with the list |
|---|---|
| Prisma | `prisma.post.findMany({ include: { author: true } })` |
| Sequelize | `Post.findAll({ include: Author })` |
| TypeORM | `repo.find({ relations: { author: true } })` |
| Drizzle | `db.query.posts.findMany({ with: { author: true } })` |
| Mongoose | `Post.find().populate('author')` (one extra query for all ids, not one per post) |
| Knex / raw SQL | write the JOIN or the `IN (...)` query yourself |

> **Interview tip:** "How do you find and fix N+1?" Find it by logging queries per request (the count grows with the data size), or with a query counter in tests. Fix it with eager loading (JOIN or `include`), an `IN` batch, or a DataLoader. Do **not** fix it by caching each tiny query.

## 10. Connection pooling

Opening a database connection is slow: a TCP handshake, usually TLS (encryption setup), then a login. The server also pays: a PostgreSQL connection is a whole server process, and the server accepts only a limited number of them (`max_connections`, typically 100 by default in PostgreSQL). Opening one per request wastes time and can use up the database's connection limit under load.

A **connection pool** keeps a small set of connections open and lends them out. A request **acquires** a connection, uses it, and **releases** it. The next request reuses it.

How a pool decides, in order:

1. If an idle connection exists, hand it out.
2. Otherwise, if fewer than `max` connections exist, open a new one.
3. Otherwise, make the caller wait in a queue (with a timeout).
4. On release, give the connection to the first waiter, or park it as idle.

Example `examples/07-connection-pool.js` implements exactly that in about 80 lines. The connection is fake (it just sleeps), so the pool logic is easy to see. First the code of the pool:

```js
class Pool {
  #idle = []; // connections that are open and free
  #leased = new Set(); // connections handed out and not yet returned
  #waiters = []; // callers waiting in line: { resolve, reject, timer }
  #total = 0; // open connections + connections being opened
  #closed = false;
  #drained = null;

  constructor({ create, max = 3, acquireTimeoutMs = 1000 }) {
    this.create = create;
    this.max = max;
    this.acquireTimeoutMs = acquireTimeoutMs;
  }

  get stats() {
    return { total: this.#total, idle: this.#idle.length, busy: this.#total - this.#idle.length, waiting: this.#waiters.length };
  }

  async acquire() {
    if (this.#closed) throw new Error('pool is closed');
    let conn;
    if (this.#idle.length > 0) {
      conn = this.#idle.pop(); // 1. reuse a free connection
    } else if (this.#total < this.max) {
      this.#total++; // 2. open a new one (reserve the slot first, because creating takes time)
      try {
        conn = await this.create();
      } catch (err) {
        this.#total--;
        throw err;
      }
    } else {
      conn = await new Promise((resolve, reject) => {
        // 3. the pool is full: wait in line, but not forever
        const waiter = { resolve, reject, timer: null };
        waiter.timer = setTimeout(() => {
          this.#waiters.splice(this.#waiters.indexOf(waiter), 1);
          reject(new Error(`acquire timed out after ${this.acquireTimeoutMs} ms, the pool is exhausted`));
        }, this.acquireTimeoutMs);
        this.#waiters.push(waiter);
      });
    }
    this.#leased.add(conn);
    return conn;
  }

  release(conn) {
    if (!this.#leased.delete(conn)) throw new Error('release() called with a connection that is not leased');
    if (this.#closed) return void this.#closeOne(conn);
    const waiter = this.#waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(conn); // hand it straight to the next caller in line
    } else {
      this.#idle.push(conn);
    }
  }

  // The safe way: the connection ALWAYS goes back, even when fn throws.
  async use(fn) {
    const conn = await this.acquire();
    try {
      return await fn(conn);
    } finally {
      this.release(conn);
    }
  }

  async end() {
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('pool is closing'));
    }
    for (const conn of this.#idle.splice(0)) await this.#closeOne(conn);
    if (this.#total > 0) await new Promise((resolve) => (this.#drained = resolve)); // wait for leased ones
  }

  async #closeOne(conn) {
    await conn.close();
    this.#total--;
    if (this.#total === 0 && this.#drained) this.#drained();
  }
}
```

Part 1 opens a connection for each of 6 requests. Part 2 starts 6 requests on a pool with `max: 2`:

```js
const pool = new Pool({ create: connect, max: 2 });
let peakBusy = 0;
const jobs = [];
for (let i = 1; i <= 6; i++) {
  jobs.push(
    pool.use(async (conn) => {
      peakBusy = Math.max(peakBusy, pool.stats.busy);
      return conn.query(`SELECT ${i}`);
    }),
  );
}
console.log('  right after starting all 6:', pool.stats);
const results = await Promise.all(jobs);
console.log('  a result      :', results[0]);
const usedIds = [...new Set(results.map((text) => text.match(/#(\d+)/)[1]))].sort();
console.log('  connections that did the work:', usedIds);
console.log(`  connections opened: ${opened}, most in use at once: ${peakBusy}`);
console.log('  when idle again:', pool.stats);
await pool.end();
console.log(`  after end(): opened ${opened}, closed ${closed}`);
```

```text
1. no pool: every request opens its own connection
  6 requests, connections opened: 6
2. a pool of 2: 6 requests share 2 connections, the others wait in line
  right after starting all 6: { total: 2, idle: 0, busy: 2, waiting: 4 }
  a result      : result of "SELECT 1" from connection #1
  connections that did the work: [ '1', '2' ]
  connections opened: 2, most in use at once: 2
  when idle again: { total: 2, idle: 2, busy: 0, waiting: 0 }
  after end(): opened 2, closed 2
```

- Right after starting, the pool has reserved its 2 connections (they are still being opened, and `busy` counts them) and 4 requests are **waiting** in line.
- Only 2 connections were ever opened, and at most 2 were busy at once. The others reused them.
- `end()` closed both connections.

### 10.1 Leaks

A **leak** is a connection that was acquired and never released. The pool slowly runs dry, then every request waits until the acquire timeout. This is a classic production incident: the app "freezes" while the database is perfectly healthy.

```js
async function buggyHandler() {
  const conn = await leaky.acquire();
  await conn.query('SELECT 1');
  throw new Error('something failed'); // release() below is never reached
  // leaky.release(conn);
}
```

```text
3. a leak: code that forgets to release exhausts the pool
  after 2 failed requests: { total: 2, idle: 0, busy: 2, waiting: 0 }
  3rd request: acquire timed out after 50 ms, the pool is exhausted
```

The fix is to make release impossible to forget: use a helper that releases in `finally`. In the example, `pool.use(fn)` does that.

```text
4. the fix: use() releases in a finally block
  after 5 failed requests: { total: 1, idle: 1, busy: 0, waiting: 0 }
  releasing a stranger: release() called with a connection that is not leased
```

Five requests failed and no connection was lost: the pool still has 1 idle connection, reused every time.

On shutdown, `end()` closes the idle connections, waits for borrowed ones, and refuses new work:

```text
5. shutdown: end() closes idle connections and refuses new work
  acquire after end(): pool is closed
```

### 10.2 Sizing

- A connection runs **one query at a time**. A bigger pool does not make the database faster. Once the database is busy, more connections only add queueing and memory use.
- The total matters: `pool size x number of app instances` must stay below the database's connection limit, with room left for admin tools and migrations.
- Start small (for example 10 per instance) and measure. A common starting rule from pool-sizing guides is about `cores x 2` plus the number of disks of the **database server**.
- Many tiny instances (serverless functions, many pods) can exhaust the limit even with a small pool each. Put a connection pooler in front: a small program such as PgBouncer (or a managed proxy from your cloud) that keeps a few real connections to the database and shares them among thousands of app connections.
- Set an **acquire timeout** (as in the example) so a full pool fails fast instead of hanging forever.
- Watch the pool numbers (`total`, `idle`, `waiting`). A `waiting` count that stays above 0 means the pool is too small or queries are too slow.

**Needs: `npm install pg`** and a running PostgreSQL server. The real thing, with the settings that matter:

```js
// Illustrative snippet, not runnable here
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,                       // at most 10 connections in this process (the default is 10)
  idleTimeoutMillis: 30_000,     // close a connection that sat idle for 30 s (the default is 10 s)
  connectionTimeoutMillis: 2_000 // fail if no connection is available within 2 s (the default 0 = wait forever)
});

// An idle connection can break (database restarted). Without this handler the 'error' event crashes the process.
pool.on('error', (err) => console.error('idle client error', err.message));

// Simple queries: the pool borrows a connection and returns it for you.
pool.query('SELECT now()').then(({ rows }) => console.log(rows[0]));

// A transaction needs ONE connection for BEGIN ... COMMIT, so borrow it yourself.
async function transfer(from, to, amount) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [amount, from]);
    await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [amount, to]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release(); // ALWAYS give it back, or the pool leaks
  }
}

// On shutdown: await pool.end();
```

`pool.totalCount`, `pool.idleCount` and `pool.waitingCount` expose the same numbers as our `stats`.

> **Common mistake:** `await pool.query('BEGIN')` then `await pool.query('UPDATE ...')`. These can run on two different connections, so the `UPDATE` is not inside your transaction at all. Always use `pool.connect()` for transactions.

> **Interview tip:** "What is connection pooling and why do you need it?" Cover: connecting is expensive, the database limits connections, a pool reuses them, `max` and queue/timeout settings, leaks (release in `finally`), and the transaction-needs-one-connection rule.

## 11. Migrations

Your code changes all the time, and so does your database structure: new tables, new columns, new indexes. A **migration** is one small, ordered script that changes the schema from version N to N+1. You keep migrations in version control next to the code.

Why not just run SQL by hand or edit the schema in a tool?

- Every environment (your laptop, tests, staging, production, a new teammate's machine) must end up with the **same** structure.
- Changes are **reviewed** in pull requests like code.
- The database remembers which migrations have run, so a deploy applies **only the new ones**.
- You can build a fresh database from zero in one command.

Example `examples/08-migrations.js` is a mini migration tool. In a real project each migration is a file (`001_create_users.sql`, `002_create_posts.sql`); here they are objects in an array.

```js
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
// ...
];
```

The runner keeps a history table (`schema_migrations`). For each migration not yet applied it runs the SQL **and** records it inside one transaction. It also stores a checksum so edits to old migrations are detected:

```js
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
```

```text
1. day 1: deploy with migrations 1 and 2 only
  applied: [ 1, 2 ]
  tables : [ 'posts', 'schema_migrations', 'users' ]
2. day 2: deploy with all four. Only the new ones run, existing data is kept
  applied: [ 3, 4 ]
  users columns: [ 'id', 'email', 'display_name' ]
  data: [{"email":"ada@example.com","display_name":"ada"},{"email":"bob@example.com","display_name":"bob"}]
3. running again is safe: nothing is pending
  applied: []
```

Day 1 deployed migrations 1 and 2 and some users were created. Day 2 deployed all four: only 3 and 4 ran, and the existing rows were kept and even **backfilled** (old rows got a value for the new column). Running again does nothing.

A migration that fails halfway is rolled back completely, and an edited old migration is caught:

```text
4. a failing migration is rolled back completely (no half-made table)
  error : migration 5 failed and was rolled back: no such table: nope
  tables: [ 'posts', 'schema_migrations', 'users' ] (no "tags")
  history ids: [ 1, 2, 3, 4 ]
5. editing an applied migration is detected by its checksum
  error : migration 2 was changed after it was applied (stored 55ea273cf8, now 9a5cc289db)
```

Each migration also has a `down` step to undo it (many teams skip `down` and write a new "forward" migration instead, since data cannot always be restored):

```text
6. roll back the most recent migration with its "down" step
  rolled back id: 4
  data after down: [{"email":"ada@example.com","display_name":""},{"email":"bob@example.com","display_name":""}]
  history ids: [ 1, 2, 3 ]
```

Rules for safe migrations:

- **Never edit a migration that has already run** anywhere. Add a new one.
- **Expand, then contract.** To rename or tighten a column safely: (1) add the new column as nullable or with a default, (2) deploy code that writes both, (3) backfill old rows, (4) deploy code that reads the new column, (5) drop the old one later. Old and new code versions run side by side during a deploy, so each step must work with both.
- **Transactional DDL.** DDL (data definition language) is the SQL that changes structure: `CREATE`, `ALTER`, `DROP`. PostgreSQL and SQLite can roll such changes back inside a transaction. **MySQL cannot** (DDL commits immediately), so a failed MySQL migration can leave a half-applied state.
- On big tables, some changes lock the table. In PostgreSQL use `CREATE INDEX CONCURRENTLY`, and avoid rewriting the whole table in one go.
- Run migrations as **one step before** the new code starts, from a single runner (not from every app instance at the same time). Tools use a database lock for that.
- Tools: Knex migrations, Prisma Migrate, Sequelize (with `umzug`), TypeORM migrations, Drizzle Kit, `node-pg-migrate`, or standalone Flyway/Liquibase. Pick one per project.

> **Interview tip:** "How do you change a column in production without downtime?" Answer with expand and contract, and mention that the old code is still running during the deploy. Mention backfilling in batches for big tables.

## 12. ORMs, query builders and raw SQL

There are three levels of abstraction.

| Level | What it is | Example |
|---|---|---|
| Raw SQL | you write SQL strings and use a driver | `pg`, `mysql2`, `node:sqlite` |
| Query builder | you build SQL with JavaScript method calls; you still think in tables | Knex, Kysely, Drizzle |
| ORM | you work with objects (`user.posts`); the library writes the SQL (**O**bject-**R**elational **M**apper) | Prisma, Sequelize, TypeORM |
| ODM | like an ORM, for a document database (**O**bject-**D**ocument **M**apper) | Mongoose |

The same question, "10 users over 18 sorted by name", in each tool. These are **illustrative snippets** that need packages and a database, so none of them runs here. They use `await`, so imagine each one inside an `async` function.

**Needs: `npm install knex pg`**

```js
// Illustrative snippet, not runnable here
const knex = require('knex')({ client: 'pg', connection: process.env.DATABASE_URL });
const adults = await knex('users').where('age', '>', 18).orderBy('name').limit(10); // builds and runs the SQL
```

**Needs: `npm install prisma @prisma/client`** (the setup steps differ between Prisma versions, so follow the docs of the version you install)

```js
// Illustrative snippet, not runnable here. The model is declared in a schema.prisma file; a generator creates the typed client.
const adults = await prisma.user.findMany({
  where: { age: { gt: 18 } }, orderBy: { name: 'asc' }, take: 10, include: { posts: true },
});
```

**Needs: `npm install drizzle-orm pg`** (TypeScript)

```ts
// Illustrative snippet, not runnable here
import { gt } from 'drizzle-orm';
const adults = await db.select().from(users).where(gt(users.age, 18)).orderBy(users.name).limit(10);
```

**Needs: `npm install sequelize pg`**

```js
// Illustrative snippet, not runnable here
const { Op } = require('sequelize');
const adults = await User.findAll({ where: { age: { [Op.gt]: 18 } }, order: [['name', 'ASC']], limit: 10, include: Post });
```

**Needs: `npm install typeorm pg reflect-metadata`** (TypeScript, entities use decorators)

```ts
// Illustrative snippet, not runnable here
import { MoreThan } from 'typeorm';
const adults = await dataSource.getRepository(User).find({
  where: { age: MoreThan(18) }, order: { name: 'ASC' }, take: 10, relations: { posts: true },
});
```

**Needs: `npm install mongoose`** (MongoDB)

```js
// Illustrative snippet, not runnable here
const adults = await User.find({ age: { $gt: 18 } }).sort('name').limit(10).populate('posts').lean();
```

Honest trade-offs (package versions checked on npm on 2026-11-10, always check again):

| Tool | Good at | Watch out for |
|---|---|---|
| Raw SQL (`pg`, `mysql2`) | full power, you see exactly what runs, best for reports and tricky queries | repeated code, string building, no types, migrations are separate |
| Knex 3 | safe query building across databases, built-in migrations, mature | not an ORM (no models); typing results takes extra work |
| Sequelize 6 | mature ORM with models, associations and many tutorials | typing models takes boilerplate; easy to write N+1; the API is old-style |
| TypeORM | TypeScript-first, Active Record or Data Mapper styles | entity decorators need a compiler step (Node's built-in type stripping does not support decorators); read what SQL relations produce |
| Prisma | great developer experience, type-safe results, its own migration tool | a generate step and its own schema language; complex SQL needs raw queries; check what npm `latest` points to before you start (on 2026-11-10 it was an 8.0 release candidate) |
| Drizzle | thin and SQL-like, TypeScript types without code generation | still version 0.x (0.45.4 on that date), so the API can change; you think in SQL |
| Mongoose 9 | schemas, validation, hooks and `populate` for MongoDB | a schema layer on a schemaless database; `populate` is an app-level join (extra queries); use `.lean()` for plain objects and speed |

Two more words from the table: an **Active Record** ORM puts the save and find methods on the model object itself (`user.save()`, Sequelize and Mongoose work this way), while a **Data Mapper** ORM keeps plain objects and puts the database code in a separate repository (TypeORM supports both styles, section 13).

> **Interview tip:** "ORM or raw SQL?" Strong answer: there is no winner. An ORM or query builder is good for ordinary create/read/update/delete code, gives you migrations and type safety, and keeps injection risks low. Raw SQL is best for reports, bulk work and queries the ORM cannot express well. Whatever you choose: **log the SQL in development**, watch for N+1, use one migration tool, and know the SQL underneath. Mixing is normal: ORM for 90 percent, raw SQL for the hard 10 percent.

## 13. The repository pattern and validation at the boundary

If every route handler contains SQL, the code is hard to test, hard to change and hard to read: HTTP details, business rules and queries are tangled together. A common fix is to split the code into layers:

```text
route / controller   handles HTTP: read the request, validate it, call the service, send the response
        |
service              business rules ("an email may be registered only once")
        |
repository           the ONLY place that knows SQL or the database driver
        |
database
```

A **repository** is an object with methods named after what the app needs (`create`, `findByEmail`, `list`). All queries for one kind of data live inside it. Benefits:

- SQL is in one place, so a schema change touches one file.
- The service can be tested with a fake in-memory repository, with no database.
- The repository **translates** database details into app terms: a `UNIQUE constraint failed` error becomes `EmailTakenError`, and snake_case columns become the shape your app uses.

Do not overdo it: a repository should expose use-case methods (`findByEmail`), not a generic `query(sql)` that lets everyone write SQL again.

Example `examples/09-repository-and-validation.js`. First the **validation** function. (The file also defines two small error classes, `ValidationError` and `EmailTakenError`, whose messages contain no SQL words.)

```js
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
```

**Validation at the boundary** means: everything that comes from outside (HTTP body, query string, headers, environment, files, queue messages) is **untrusted**. Check it once, at the edge, and turn it into a clean object. After that the inner code can trust the types.

- Check type, shape, length, range, allowed values and format.
- **Build a new object with only the allowed fields.** The example drops the client's `role: 'admin'`. Copying the whole body into a database insert is called mass assignment, and it lets clients set fields they should not.
- Normalise (trim, lower-case the email) so `Ada@Example.COM` and `ada@example.com` are the same person.
- Real projects use a schema library (`zod`, `joi`, `ajv` with JSON Schema; Fastify validates with JSON Schema built in) instead of hand-written checks. The idea is identical.
- Validation in code does **not** replace database constraints. Keep `NOT NULL`, `UNIQUE`, `CHECK` and foreign keys too: the database is the last line of defence, and it is the only one that is race-free.

The file has two repositories with the same methods: one uses SQL, the other keeps users in an array (read it in the file). This is the heart of the SQL one. `toUser` turns the null-prototype row into a plain object shaped for the app, and `create` turns a database error into an app error:

```js
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
```

The service only knows the repository methods:

```js
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
```

The example runs the same checks against both repositories. These are the results for the SQLite one (the in-memory one prints exactly the same lines):

```text
--- repository on SQLite (node:sqlite)
1. valid input (note the messy email and the sneaky role field)
  created: {"id":1,"email":"ada@example.com","name":"Ada","role":"user"}
2. invalid input is stopped before it reaches the database
  ValidationError: email must look like a@b.c, name must be 2 to 50 characters
  ValidationError: body must be an object
  ValidationError: email must look like a@b.c
3. duplicates become a clear app error
  EmailTakenError: email already registered: ada@example.com
4. lookups
  by email: {"id":1,"email":"ada@example.com","name":"Ada","role":"user"}
  unknown : null
  list    : [ 'ada@example.com', 'bob@example.com' ]
```

Notice: the messy email was cleaned, `role` stayed `'user'`, bad input never reached the database, and the duplicate email became a clear `EmailTakenError`. There is no "check if it exists, then insert": two requests could both pass the check. The `UNIQUE` index decides, and the repository translates its error.

### 13.1 Repositories and transactions

A follow-up that catches many people: a service must change two repositories in one transaction (create an order and reduce the stock). The transaction lives on **one connection**, so the repository methods must run on that connection. The usual solution: every method takes the "executor" (a pool, or the client of the running transaction) as its first argument, and one helper owns `BEGIN` and `COMMIT`:

**Needs: `npm install pg`** and a running PostgreSQL server.

```js
// Illustrative snippet, not runnable here
async function withTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client); // work gets the ONE client and passes it to every repository call
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// repositories only use the executor they are given: the pool for a single query, a client inside a transaction
const orders = { create: (db, userId) => db.query('INSERT INTO orders (user_id) VALUES ($1) RETURNING id', [userId]) };
const stock = { take: (db, sku, qty) => db.query('UPDATE stock SET qty = qty - $2 WHERE sku = $1 AND qty >= $2', [sku, qty]) };

async function placeOrder(pool, userId, sku, qty) {
  return withTransaction(pool, async (tx) => {
    const taken = await stock.take(tx, sku, qty);
    if (taken.rowCount === 0) throw new Error('out of stock'); // the throw rolls everything back
    return orders.create(tx, userId);
  });
}
```

`withTransaction` is the `transaction` helper from section 5 (written there for SQLite), now async and borrowing its client from the pool. Because the service decides where a transaction starts and ends, the repositories stay small and reusable. To **test** repository code, use a real database when you can (an in-memory SQLite for quick tests, or a throwaway PostgreSQL container for the real thing), and use fakes only for the service layer (lesson 16).

> **Interview tip:** "Why a repository layer?" Say: one place for data access, testability with fakes, the ability to swap the database, and translating storage errors to domain errors. A good follow-up point: never return password hashes or internal columns, map rows to the shape the caller needs.

## 14. Errors, timeouts, retries and idempotency

Databases and networks fail in normal operation: a restart, a failover, a deadlock, a slow query. Production code must expect it. Example `examples/10-retries-and-idempotency.js` covers the whole story.

### 14.1 Transient or permanent?

| Kind | Examples | Retry? |
|---|---|---|
| **Transient** (may succeed later) | `ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`; SQLite "database is locked" (5); PostgreSQL `40001` (serialization failure) and `40P01` (deadlock); MySQL 1213 (deadlock) and 1205 (lock wait timeout); a failover in progress | yes, a few times, with a delay |
| **Permanent** (will fail again) | SQL syntax error; unique, foreign key or check violation (PostgreSQL `23505` is "unique violation"); bad input; permission denied | no, fix the cause or tell the caller |

Map them to HTTP at the edge: validation failure to 400 (or 422), "already exists" to 409, not found to 404, database unreachable to 503. Never send raw database messages to clients; log them with a request id instead.

### 14.2 Retry with exponential backoff and jitter

If a call fails for a transient reason, wait and try again. Three rules make this safe:

- **Exponential backoff:** wait longer after each failure (100 ms, 200 ms, 400 ms ...) with a maximum, so a struggling database gets room to recover.
- **Jitter:** pick a random wait below that ceiling. Without it, 1000 clients that failed together all retry together (a "thundering herd") and knock the database over again.
- **A limit:** a maximum number of attempts, then give up and report the error.

```js
// ---- 1. which errors are worth retrying? Only the ones that can go away by themselves ----
const SQLITE_BUSY = 5; // another connection holds the lock
const SQLITE_LOCKED = 6;
const NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE']);
function isTransient(err) {
  if (NETWORK_CODES.has(err.code)) return true;
  return err.errcode === SQLITE_BUSY || err.errcode === SQLITE_LOCKED;
}

// ---- 2. retry with exponential backoff + full jitter ----
// sleep and random are parameters so the demo below is deterministic.
async function retry(fn, { retries = 3, baseDelayMs = 100, maxDelayMs = 1000, shouldRetry = isTransient, wait = sleep, random = Math.random, onRetry } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt > retries || !shouldRetry(err)) throw err; // out of tries, or retrying cannot help
      const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delay = Math.floor(random() * ceiling); // jitter: a random wait between 0 and the ceiling
      if (onRetry) onRetry({ attempt, delay, err });
      await wait(delay);
    }
  }
}
```

```text
1. the waiting times: ceiling doubles each time, jitter picks a random point below it
  ceilings (ms): [ 100, 200, 400, 800, 1000 ]
  delays with random() = 0.5 (ms): [ 50, 100, 200, 400, 500 ]
```

The helper takes `wait` and `random` as parameters only so the example is predictable; in your code use the defaults.

Now a real transient error. One connection holds the write lock, so the second gets `SQLITE_BUSY`. The `onRetry` hook finishes the first transaction after the second failure:

```js
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retry-demo-'));
const file = path.join(dir, 'app.db');
const holder = new DatabaseSync(file);
const worker = new DatabaseSync(file);
try {
  holder.exec('CREATE TABLE jobs (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
  holder.exec('BEGIN IMMEDIATE'); // the holder owns the write lock
  const result = await retry(
    (attempt) => {
      console.log(`  attempt ${attempt}: INSERT`);
      return worker.prepare('INSERT INTO jobs (name) VALUES (?)').run('send email');
    },
    {
      wait: async () => {},
      random: () => 0.5,
      onRetry: ({ attempt, err }) => {
        console.log(`    failed (${err.errstr}), will retry`);
        if (attempt === 2) holder.exec('COMMIT'); // pretend the other transaction finished meanwhile
      },
    },
  );
  console.log('  inserted, changes =', result.changes);
} finally {
  // runs even if something above throws, so no temp folder is left behind
  holder.close();
  worker.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
```

```text
2. a REAL transient error: SQLITE_BUSY while another connection holds the write lock
  attempt 1: INSERT
    failed (database is locked), will retry
  attempt 2: INSERT
    failed (database is locked), will retry
  attempt 3: INSERT
  inserted, changes = 1
```

A permanent error must not be retried. Retrying a duplicate key a hundred times just wastes time. In the example the insert breaks a `UNIQUE` rule, `isTransient` answers no, and `retry` gives up after the first try:

```text
3. a permanent error is NOT retried (retrying cannot fix bad data)
  gave up after 1 try: UNIQUE constraint failed: t.name
```

### 14.3 Timeouts

Without a timeout, one stuck query can hold a request, a pool connection and the user's patience forever. Set timeouts at several layers: connecting, waiting for a pool connection (section 10), and running a query. Options: `connectionTimeoutMillis` and `query_timeout` in `pg`, `connectTimeout` in `mysql2`, `serverSelectionTimeoutMS` and `maxTimeMS` in MongoDB, `statement_timeout` as a PostgreSQL setting, and in your own code `AbortSignal.timeout(ms)` or `Promise.race`.

```js
// ---- 3. a timeout wrapper (note: it stops WAITING, it does not stop the work) ----
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`timed out after ${ms} ms`), { code: 'ETIMEDOUT' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
```

The example races a "query" that needs 60 ms against a 15 ms timeout:

```text
4. a timeout stops the waiting, but the work may still finish on the server
  caller saw: ETIMEDOUT | timed out after 15 ms | finished yet? false
  80 ms later the slow query finished anyway: true
```

The key point: a **client timeout only stops the waiting**. The query may still be running, or may even have succeeded, on the server. After a timeout you do not know the outcome. That is why retries need idempotency.

### 14.4 Idempotency

An operation is **idempotent** if doing it twice has the same effect as doing it once. `SET status = 'paid'` is idempotent. `INSERT` a payment, or `balance = balance - 50`, is not.

The dangerous case: the first attempt worked, but the response was lost (timeout, network drop). The client retries and the server charges again. The example simulates exactly that: the "server" writes the payment and then fails to answer once.

```js
// The "server": it writes the payment, and on the first call the response is lost on the way back.
function makeServer(useKey) {
  let calls = 0;
  return async function charge(amount, key) {
    calls++;
    let saved;
    if (useKey) {
      const r = insertPayment.run(key, amount);
      saved = r.changes === 1 ? { id: r.lastInsertRowid, replayed: false } : { ...findByKey.get(key), replayed: true };
    } else {
      saved = { id: mem.prepare('INSERT INTO payments (amount) VALUES (?)').run(amount).lastInsertRowid, replayed: false };
    }
    if (calls === 1) throw Object.assign(new Error('response lost'), { code: 'ECONNRESET' }); // work done, answer lost
    return saved;
  };
}

const naive = makeServer(false);
await retry(() => naive(50), { wait: async () => {} });
console.log('  without a key  :', countPayments(), '<- charged twice!');

mem.exec('DELETE FROM payments');
const safe = makeServer(true);
const key = 'order-1001-attempt'; // created ONCE by the client and sent again with every retry
const answer = await retry(() => safe(50, key), { wait: async () => {} });
console.log('  with a key     :', countPayments(), '<- charged once');
console.log('  retry answer   :', answer, '(the saved result is replayed)');
```

```text
5. why retries need idempotency: the first attempt worked but the answer was lost
  without a key  : 2 payment row(s), money taken: 100 <- charged twice!
  with a key     : 1 payment row(s), money taken: 50 <- charged once
  retry answer   : { id: 1, amount: 50, replayed: true } (the saved result is replayed)
```

Without a key, two payments were written. With an **idempotency key** the client creates one unique key per logical action (for example when the user clicks "Pay") and sends the same key on every retry. The server stores the key in a column with a `UNIQUE` index. `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` is atomic: if `changes` is 0 the action was already done, so the server returns the saved result ("replayed") instead of doing it again.

Other idempotent tools: `PUT` and `DELETE` by id, upserts (`ON CONFLICT DO UPDATE`; MySQL has `ON DUPLICATE KEY UPDATE`), and conditional updates like `UPDATE orders SET status = 'paid' WHERE id = ? AND status = 'pending'`.

**Two writes, one failure.** "Save the order, then publish an `order.created` message" is two steps in two systems, and the process can die between them: the order exists but nobody hears about it. A transaction cannot span a database and a message broker. The standard fix is the **outbox pattern**: insert the message into an `outbox` table in the **same transaction** as the order, and let a separate worker read that table and publish, retrying until it works. The consumers may see a message twice, so they must be idempotent too.

> **Interview tip:** "Why can't you blindly retry a failed POST /payments?" Because the failure may have happened after the payment was recorded. The answer is an idempotency key stored with a unique constraint, plus retrying only transient errors with backoff and jitter.

## 15. Caching with Redis

A **cache** keeps a copy of data in fast storage so you do not repeat slow work. **Redis** is an in-memory key-value store: very fast, shared by all your app instances, and it can expire keys by itself (**TTL**, time to live). Cache data that is read often, changes rarely, and may be a little stale.

### 15.1 The cache-aside pattern

In **cache-aside** (also called lazy loading) the application talks to both the cache and the database:

1. Ask the cache for the key.
2. **Hit:** return the cached value.
3. **Miss:** read the database, store the result in the cache **with a TTL**, return it.
4. On a write: update the database, then **delete** the cache key (invalidate).

The example `examples/11-cache-aside.js` does this in memory, so it runs anywhere. Redis does the same job over the network with `SET key value EX 60`, `GET key` and `DEL key`. The time is a parameter so the demo can jump forward without waiting.

```js
// A tiny cache with a time-to-live per entry. "now" is a parameter so the demo can move time by hand.
// Redis does the same job over the network: SET key value EX 60, GET key, DEL key.
class TtlCache {
  #entries = new Map(); // key -> { value, expiresAt }
  constructor({ now = Date.now, maxEntries = 1000 } = {}) {
    this.now = now;
    this.maxEntries = maxEntries;
  }
  get(key) {
    const entry = this.#entries.get(key);
    if (!entry) return undefined; // miss
    if (entry.expiresAt <= this.now()) {
      this.#entries.delete(key); // expired: behave like a miss
      return undefined;
    }
    return entry.value;
  }
  set(key, value, ttlMs) {
    this.#entries.delete(key); // re-insert so this key becomes the newest
    this.#entries.set(key, { value, expiresAt: this.now() + ttlMs });
    if (this.#entries.size > this.maxEntries) {
      const oldest = this.#entries.keys().next().value; // Map keeps insertion order
      this.#entries.delete(oldest);
    }
  }
  delete(key) {
    this.#entries.delete(key);
  }
  get size() {
    return this.#entries.size;
  }
}
```

```js
// ---- the cache-aside pattern: the APPLICATION talks to both cache and database ----
const NOT_FOUND = Symbol('not found'); // "we asked the database and there is no such row"
const TTL_MS = 60_000;
let clock = 0; // our fake time in ms
const cache = new TtlCache({ now: () => clock });

async function getProduct(id) {
  const key = `product:${id}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached === NOT_FOUND ? null : cached; // 1. hit
  const row = await readFromDb(id); // 2. miss: ask the database
  cache.set(key, row ?? NOT_FOUND, row ? TTL_MS : 5_000); // 3. remember it (missing rows only briefly)
  return row;
}

async function updatePrice(id, price) {
  db.prepare('UPDATE products SET price = ? WHERE id = ?').run(price, id);
  cache.delete(`product:${id}`); // invalidate: the next read reloads fresh data
}
```

First reads and the TTL:

```text
1. first read is a miss, the next ones are hits
  read 1: { id: 1, name: 'Pen', price: 200 } | db reads so far: 1
  read 2: { id: 1, name: 'Pen', price: 200 } | db reads so far: 1
  read 3: { id: 1, name: 'Pen', price: 200 } | db reads so far: 1
2. the TTL: after 60 seconds the entry expires
  at 59 s  -> db reads: 1 (still cached)
  at 61 s  -> db reads: 2 (expired, loaded again)
```

Stale data and invalidation. If someone changes the row without clearing the key, readers see old data until the TTL ends. The fix is to delete the key right after a successful write:

```text
3. stale data: change the row behind the cache and forget to invalidate
  cache says price: 200 (database says 250)
  after updatePrice + invalidate: 300
```

Negative caching and limits. Caching "this id does not exist" for a short time protects the database from repeated lookups of missing ids. And a cache needs a size limit, or it grows until memory runs out (Redis has `maxmemory` and an **eviction policy**, the rule for which keys to throw away when memory is full, for example the least recently used):

```text
4. negative caching: remember that an id does NOT exist (for a short time)
  5 reads of a missing id -> db reads: 1
5. a cache must have a size limit or it becomes a memory leak
  size: 3 | "a" still there? false | "d" there? true
```

The real thing with `ioredis`:

**Needs: `npm install ioredis`** and a running Redis server.

```js
// Illustrative snippet, not runnable here
const { Redis } = require('ioredis');
const redis = new Redis(process.env.REDIS_URL);

async function getProduct(id) {
  const key = `product:${id}`;
  const cached = await redis.get(key); // a miss returns null
  if (cached !== null) return JSON.parse(cached); // Redis stores strings, so we store JSON
  const product = await db.findProduct(id); // miss: ask the database
  if (product) await redis.set(key, JSON.stringify(product), 'EX', 60); // keep it for 60 seconds
  return product;
}

async function updatePrice(id, price) {
  await db.updatePrice(id, price); // 1. write to the database first
  await redis.del(`product:${id}`); // 2. then drop the cached copy
}
```

### 15.2 Cache invalidation

Deciding when a cached value is no longer true is the hard part of caching. Options, from simple to strict:

| Approach | How | Trade-off |
|---|---|---|
| TTL only | let entries expire | simplest; data can be stale for up to the TTL |
| Delete on write | `DEL key` after the database commit | most common; small race window if a reader re-caches old data between your steps |
| Versioned keys | `product:42:v7`, bump the version on change | no stale reads; old keys wait for their TTL |
| Event based | publish "product 42 changed" and every instance clears its copy | needed when many services cache the same data |

Delete **after** the database commit, and keep a TTL anyway as a safety net.

### 15.3 Stampede, penetration and avalanche

- **Stampede (thundering herd):** a hot key expires and many requests miss at the same moment, so all of them hit the database.
- **Penetration:** requests for ids that do not exist always miss. Fix: negative caching (shown above) and validation.
- **Avalanche:** many keys were created together with the same TTL, so they expire together. Fix: add **jitter** (a random +/- 10 percent) to every TTL.

The stampede in the example, and the fix. **Single flight** means: while one load for a key is running, other requests wait for that same promise instead of starting their own.

```js
clock += TTL_MS + 1; // everything expired
dbReads = 0;
await Promise.all(Array.from({ length: 10 }, () => getProduct(2)));
console.log('  10 concurrent requests -> db reads:', dbReads, '(all ten went to the database)');

const inFlight = new Map(); // key -> promise of the load that is already running
async function getProductSingleFlight(id) {
  const key = `product:${id}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached === NOT_FOUND ? null : cached;
  if (!inFlight.has(key)) {
    const load = readFromDb(id)
      .then((row) => {
        cache.set(key, row ?? NOT_FOUND, row ? TTL_MS : 5_000);
        return row;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, load);
  }
  return inFlight.get(key);
}
clock += TTL_MS + 1;
dbReads = 0;
const results = await Promise.all(Array.from({ length: 10 }, () => getProductSingleFlight(3)));
console.log('  10 concurrent requests -> db reads:', dbReads, '| all got the same product:', results.every((r) => r.name === 'Lamp'));
```

```text
6. cache stampede: a hot key expires and 10 requests miss at the same moment
  10 concurrent requests -> db reads: 10 (all ten went to the database)
7. the fix: single flight, concurrent misses share ONE database call
  10 concurrent requests -> db reads: 1 | all got the same product: true
```

For the avalanche, spread the expiry times with a random factor:

```js
const jittered = (ttl) => Math.round(ttl * (0.9 + Math.random() * 0.2)); // 90% to 110% of ttl
const samples = Array.from({ length: 1000 }, () => jittered(TTL_MS));
console.log('  1000 TTLs all within 54000..66000?', samples.every((t) => t >= 54_000 && t <= 66_000));
```

```text
8. spread the expiry: add random jitter to the TTL so keys do not all expire together
  1000 TTLs all within 54000..66000? true
```

Single flight inside one process only protects that process. With many app instances, use a short Redis lock (`SET lock:product:42 1 NX EX 10`, where `NX` means "only if it does not exist yet"), or serve slightly stale data while one request refreshes it in the background.

> **Interview tip:** "What happens when Redis is down?" The cache is an optimisation, not the source of truth: catch the error, fall back to the database, use short timeouts, and protect the database from the sudden load (a rate limit, or a **circuit breaker** that stops calling a failing service for a short while instead of waiting on it every time). Also say what you do **not** cache: money balances that must be exact, per-user private data without a user-specific key, or anything you cannot invalidate.

## 16. Config from the environment and graceful shutdown

### 16.1 Connection config

Never hard-code a database address or password in source code. Read it from **environment variables**: the same code runs on your laptop, in tests and in production, only the variables differ. Locally, a `.env` file (plain `KEY=value` lines) holds them. Commit a `.env.example` with fake values, never the real `.env`.

Node can read a `.env` file with no package (not experimental since Node 24.10.0):

```bash
node --env-file=.env app.js
```

- `node --env-file=.env app.js` loads the file before your code starts. It is **not allowed inside `NODE_OPTIONS`**.
- `process.loadEnvFile('.env')` loads a file from code. `util.parseEnv(text)` only parses text into an object.
- A variable that is **already set in the shell wins** over the file. If you pass two `--env-file` flags, the later file wins.
- To set a variable for one run, in bash: `DB_POOL_MAX=5 node app.js`. In PowerShell: `$env:DB_POOL_MAX=5; node app.js`.

A **connection string** has a fixed shape: `postgres://user:password@host:5432/dbname?sslmode=require`. `new URL(...)` can parse it. Special characters in the password must be percent-encoded (`p@ss/word` becomes `p%40ss%2Fword`; `encodeURIComponent` does it). A MongoDB string with several hosts (`mongodb://h1:27017,h2:27017/db`) is **not** a valid URL and `new URL` throws `ERR_INVALID_URL`, so pass that one to the driver as plain text.

Example `examples/12-config-and-shutdown.js` reads the settings once, converts them (environment values are always strings), checks all of them, reports every problem together, and freezes the result:

```js
// ---------- configuration: read once, validate everything, fail fast ----------
function loadConfig(env) {
  const problems = [];
  let url = null;
  if (!env.DATABASE_URL) {
    problems.push('DATABASE_URL is required');
  } else {
    try {
      url = new URL(env.DATABASE_URL); // note: a MongoDB URL with several hosts (h1,h2) is not a valid URL, pass it to the driver as text
    } catch {
      problems.push('DATABASE_URL is not a valid URL');
    }
  }
  const poolMax = Number(env.DB_POOL_MAX ?? 10); // env values are always strings, convert them
  if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 100) problems.push('DB_POOL_MAX must be a whole number from 1 to 100');
  const timeoutMs = Number(env.DB_TIMEOUT_MS ?? 5000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100) problems.push('DB_TIMEOUT_MS must be a whole number, at least 100');
  if (problems.length > 0) throw new Error('invalid configuration:\n    - ' + problems.join('\n    - '));
  return Object.freeze({
    db: Object.freeze({
      host: url.hostname,
      port: url.port ? Number(url.port) : 5432,
      database: url.pathname.slice(1),
      user: decodeURIComponent(url.username), // special characters in a password must be percent-encoded in the URL
      password: decodeURIComponent(url.password),
      ssl: url.searchParams.get('sslmode') === 'require',
      poolMax,
      timeoutMs,
    }),
  });
}

// Never write a password to a log. Show the URL with the secret replaced.
function redact(urlText) {
  const url = new URL(urlText);
  if (url.password) url.password = '***';
  return url.toString();
}
```

```text
1. a .env file is just text; util.parseEnv turns it into an object
  keys: [ 'DATABASE_URL', 'DB_POOL_MAX' ]
2. loadConfig converts and validates once, then the config is frozen
  host/db   : db.internal / appdb
  poolMax   : 20 (a number now, default timeout 5000 ms)
  password  : p@ss/word (decoded from p%40ss%2Fword)
  safe to log: postgres://app_user:***@db.internal:5432/appdb?sslmode=require
  frozen? true true
3. fail fast: report ALL problems at startup, not one crash per deploy
  invalid configuration:
    - DATABASE_URL is required
    - DB_POOL_MAX must be a whole number from 1 to 100
    - DB_TIMEOUT_MS must be a whole number, at least 100
4. process.loadEnvFile reads a real file, but variables already set in the shell win
  DB_POOL_MAX is 3 (shell wins), DATABASE_URL is postgres://localhost/fromfile
  poolMax in config: 3
```

Good habits: validate at startup so a bad deploy fails fast and loudly; **never log the password** (the example prints a redacted URL); keep different values per environment; in production, get secrets from a secrets manager or the platform's secret store.

### 16.2 Graceful shutdown

Deploys, scaling and restarts stop your process with a **signal**: `SIGTERM` (please stop) and, from a terminal, `SIGINT` (Ctrl+C). If you just die, running requests are cut off, open transactions are rolled back by the database, and buffered work is lost. A **graceful shutdown** does this, in order:

1. Stop accepting new work (stop the HTTP server, fail the health check).
2. Let work in progress finish, with a deadline.
3. Close resources in the reverse order you opened them: HTTP server, then queue consumers, then the database pool, then the cache.
4. Exit (and force a hard exit if the deadline passes).

```js
// ---------- graceful shutdown ----------
function createShutdown({ server, db, log, graceMs = 3000 }) {
  let running = null;
  const state = {
    shuttingDown: false,
    whenDone: () => running,
    start(reason) {
      if (running) {
        log(`shutdown already running, ignoring ${reason}`);
        return running; // a second signal must not start a second shutdown
      }
      running = (async () => {
        log(`shutdown requested (${reason})`);
        state.shuttingDown = true;
        const closed = new Promise((resolve) => server.close(resolve)); // 1. stop accepting NEW connections
        server.closeIdleConnections(); // drop keep-alive sockets that are waiting and idle right now
        const force = setTimeout(() => {
          log('grace period over, closing the remaining connections');
          server.closeAllConnections();
        }, graceMs);
        force.unref(); // this timer alone must not keep the process alive
        await closed; // resolves when every running request has finished
        clearTimeout(force);
        log('http server closed');
        db.close(); // 2. only now close the database: nobody is using it any more
        log('database closed');
      })();
      return running;
    },
  };
  return state;
}
```

The server handler and the wiring:

```js
const log = (text) => console.log('  ' + text);
let requestStarted;
const gotRequest = new Promise((resolve) => (requestStarted = resolve));
const server = http.createServer(async (req, res) => {
  log('request started (a slow one)');
  requestStarted();
  await sleep(50); // pretend the work takes a while
  db.exec('INSERT INTO visits DEFAULT VALUES');
  const { n } = db.prepare('SELECT count(*) AS n FROM visits').get();
  // While shutting down, tell the client not to reuse this connection. Otherwise the socket would sit idle
  // (keep-alive) after the answer and server.close() would wait for it to time out.
  if (shutdown.shuttingDown) res.setHeader('connection', 'close');
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ visits: n }));
  log('request finished');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

const shutdown = createShutdown({ server, db, log });
process.on('SIGTERM', () => shutdown.start('SIGTERM')); // what a container platform sends on a deploy
process.on('SIGINT', () => shutdown.start('SIGINT')); // Ctrl+C

const pending = fetch(`http://127.0.0.1:${port}/slow`).then((r) => r.json());
await gotRequest;
// process.emit runs the handlers like a real signal would. (On Windows a real SIGTERM kills the process without
// running handlers, so we trigger them by hand in this demo.)
process.emit('SIGTERM');
process.emit('SIGINT'); // the impatient second signal
await shutdown.whenDone();
log('the in-flight request still got its answer: ' + JSON.stringify(await pending));
```

```text
5. graceful shutdown: finish running requests, then close the database
  request started (a slow one)
  shutdown requested (SIGTERM)
  shutdown already running, ignoring SIGINT
  request finished
  http server closed
  database closed
  the in-flight request still got its answer: {"visits":3}
  a new request after shutdown fails: ECONNREFUSED
  nothing left running, so the process ends by itself (no process.exit needed)
```

What happened, line by line: a slow request started, then the shutdown began. A second signal was ignored (the shutdown is idempotent). The running request **still got its answer**. Only after the HTTP server was empty did we close the database. A new connection was refused. Nothing was left running, so the process ended by itself.

How each client is closed at the end of the shutdown (the real drivers are the snippets from section 2):

| Client | Close it with |
|---|---|
| `pg` Pool | `await pool.end()`, borrowed clients are closed when they are released |
| `mysql2` pool | `await pool.end()` |
| `MongoClient` | `await client.close()` |
| `ioredis` | `await redis.quit()` sends the pending commands first, `redis.disconnect()` closes at once |
| `node:sqlite` | `db.close()` |

Details that interviewers ask about:

- `server.close()` stops new connections, but it only closes connections that are **idle at that moment**. **Keep-alive** means the client keeps its TCP connection open to reuse it for the next request. A connection that becomes idle after `close()` was called stays open until the keep-alive timeout fires (the server default is 5 seconds, and the client may close sooner), so `close()` can seem to hang. The example avoids that: it sends `Connection: close` while shutting down and calls `closeIdleConnections()`. After the grace period `closeAllConnections()` cuts whatever is left.
- Register handlers with `process.on('SIGTERM', ...)`. On Linux and macOS (and so in containers) `SIGTERM` runs your handler. On Windows, `process.kill(process.pid, 'SIGTERM')` ends the process at once with exit code 1 and your handler does not run (checked on Node 24.16 for this lesson), which is why the demo uses `process.emit('SIGTERM')` to trigger the handler by hand. On Windows, Ctrl+C (`SIGINT`) does run your handler.
- Avoid calling `process.exit()` as the first step: it cuts pending work. Close things properly and let the event loop empty, or set `process.exitCode` and let the process end. Use `process.exit(1)` only in the "took too long" path.
- A timer that exists only to force an exit should be `unref()`-ed, so it does not keep the process alive by itself.
- Close the database **after** the HTTP server, otherwise running requests hit a closed database.

> **Interview tip:** "How do you shut down a Node service on deploy?" Handle `SIGTERM`; stop accepting connections; wait for in-flight requests with a deadline; close the pool, cache and queue clients; then exit. Mention Kubernetes sends `SIGTERM`, waits a grace period (30 seconds by default), then sends `SIGKILL`, which cannot be caught.

## 17. MongoDB at a glance

MongoDB is a document database. This section is concepts and labelled snippets: running MongoDB needs a server, which these examples avoid.

| SQL idea | MongoDB idea |
|---|---|
| database | database |
| table | **collection** |
| row | **document** (a JSON-like object stored as BSON, "binary JSON") |
| column | field |
| primary key | `_id` (added for you as an `ObjectId` if you do not give one) |
| JOIN | embed the data, or `$lookup` in an aggregation |
| index | index |
| `GROUP BY` | `$group` in an aggregation |

BSON has more types than JSON (`ObjectId`, `Date`, `Decimal128`, binary). A single document can be at most 16 MB. An operation on **one document is atomic**, even when it changes several fields or array items inside it. Changes across several documents need a multi-document transaction, which needs a replica set or a sharded cluster (section 1.1). A standalone server cannot do it.

**Needs: `npm install mongodb`** and a running MongoDB server. The four basic operations:

```js
// Illustrative snippet, not runnable here
const { MongoClient, ObjectId } = require('mongodb');
const client = new MongoClient(process.env.MONGODB_URI); // one client per process, it keeps its own connection pool
const users = client.db('app').collection('users');
const orders = client.db('app').collection('orders');
const sessions = client.db('app').collection('sessions');

async function main() {
  await client.connect();

  const { insertedId } = await users.insertOne({ email: 'ada@example.com', name: 'Ada', visits: 0 });
  const ada = await users.findOne({ _id: new ObjectId(insertedId) }, { projection: { name: 1 } }); // ids from requests are strings: convert
  await users.updateOne({ _id: insertedId }, { $set: { name: 'Ada L.' }, $inc: { visits: 1 } }); // update operators
  await users.deleteOne({ _id: insertedId });

  await client.close();
}
main();
```

### 17.1 Embed or reference?

The main design question in a document database is how to link data. **Embedding** puts the related data inside the document. **Referencing** stores the id of another document, like a foreign key.

```js
// Embedded: one read returns the post with its author name and comments
const embeddedPost = { _id: 1, title: 'Intro', author: { name: 'Ada' }, comments: [{ by: 'Bob', text: 'Nice' }] };

// Referenced: the post only holds the author's id; the author lives in its own collection
const post = { _id: 1, title: 'Intro', authorId: 7 };
const author = { _id: 7, name: 'Ada' };
```

| Embed when | Reference when |
|---|---|
| the data is read together (one query gets everything) | the data is used from many places (many-to-many) |
| it is one-to-few and the list stays small | the list can grow without limit (comments on a viral post) |
| the child has no life of its own | the child changes often and independently |
| you want one atomic write | the child is large and not always needed |

Embedded copies of shared data (the author's name inside every post) must be updated everywhere when it changes. An array that keeps growing is the classic mistake: it can hit the 16 MB limit and makes every rewrite slow.

### 17.2 Indexes

The rules are the same as in SQL (section 7). Without an index MongoDB does a collection scan (`COLLSCAN`); with one it does an index scan (`IXSCAN`). `_id` is always indexed.

```js
// Illustrative snippet, not runnable here
await users.createIndex({ email: 1 }, { unique: true }); // single field, 1 = ascending, must be unique
await users.createIndex({ city: 1, age: -1 }); // compound: same leftmost-prefix rule as SQL
await sessions.createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600 }); // TTL index: MongoDB deletes old documents for you
const plan = await users.find({ email: 'ada@example.com' }).explain('executionStats'); // look for IXSCAN, not COLLSCAN
```

### 17.3 The aggregation pipeline

An **aggregation pipeline** is an array of **stages**. Each stage receives the documents from the previous stage and passes its result on, like a factory line:

```text
documents -> $match -> $group -> $sort -> $limit -> result
```

Common stages: `$match` (filter), `$group` (group and sum), `$sort`, `$limit`, `$project` (choose fields), `$unwind` (one document per array item), `$lookup` (join another collection). Put `$match` first so MongoDB can use an index and process fewer documents.

"The three customers who spent the most on paid orders", in MongoDB and in SQL:

```js
// Illustrative snippet, not runnable here
const top = await orders.aggregate([
  { $match: { status: 'paid' } },                                                       // WHERE status = 'paid'
  { $group: { _id: '$customerId', total: { $sum: '$amount' }, orders: { $sum: 1 } } },   // GROUP BY customer_id
  { $sort: { total: -1 } },                                                             // ORDER BY total DESC
  { $limit: 3 },                                                                        // LIMIT 3
]).toArray();
```

```sql
SELECT customer_id, sum(amount) AS total, count(*) AS orders
FROM orders WHERE status = 'paid'
GROUP BY customer_id ORDER BY total DESC LIMIT 3;
```

The SQL version runs the same idea in `examples/02-sqlite-joins.js` (part 4, `GROUP BY` with `sum` and `count`).

### 17.4 Schemas, validation and consistency

MongoDB itself accepts any document, so the schema lives in your code. **Mongoose** is the usual tool: you declare the fields once and it validates, converts and adds defaults.

**Needs: `npm install mongoose`** and a running MongoDB server.

```js
// Illustrative snippet, not runnable here
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, minlength: 2, maxlength: 50 },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
}, { timestamps: true }); // adds createdAt and updatedAt
const User = mongoose.model('User', userSchema);

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const ada = await User.create({ email: 'ADA@example.com', name: 'Ada' }); // stored as ada@example.com, role 'user'
  const plain = await User.findById(ada._id).lean(); // lean() returns a plain object, faster than a full Mongoose document
  await mongoose.disconnect();
}
main();
```

Gotchas worth knowing: `unique: true` is **not a validator**, it creates a unique index (and a duplicate then fails with error code 11000 from the database). Mongoose validation runs in your app only, so writes that bypass Mongoose skip it. Keep the unique index anyway, the database is the only race-free guard (the same rule as section 13).

Consistency knobs, in one line each. A **write concern** says how many servers must confirm a write before it counts as done (`w=majority` means most of the replica set, so the write is not lost if the primary fails). A **read preference** says which server may answer a read: the primary (always current) or a secondary (may be a little behind, the replication lag of section 1.1). The typical connection string for a hosted cluster carries these as options: `mongodb+srv://user:pass@cluster.example.net/app?retryWrites=true&w=majority`.

> **Interview tip:** "When would you pick MongoDB?" When the data is naturally document-shaped (read and written as a whole), the shape changes often, and you do not need many multi-entity transactions or heavy joins. "When not?" Highly relational data with strict consistency needs, like payments and inventory. Mention that embedding versus referencing is the key modelling decision, and that you still need validation (Mongoose schemas or a schema library) and indexes.

## Summary / Key takeaways
- Choose a database from the data shape and access patterns: relational by default, document for self-contained records, key-value for cache and sessions, graph when connections are the question. Name the trade-off, and know the scaling words (replication and its lag, sharding, CAP).
- `node:sqlite` is built into Node 24 (no flag, release candidate status, synchronous). It is perfect for learning SQL, tests and small tools. Know the SQL essentials: `NULL` needs `IS NULL`, `WHERE` filters rows and `HAVING` filters groups, upsert with `ON CONFLICT`, CTEs and window functions.
- Always use placeholders for values, an allow list for names, and validate input types. That stops SQL injection and the NoSQL operator variant.
- Use a transaction when several statements must succeed together. Know ACID, the four isolation levels, deadlocks (retry), and fix lost updates with an atomic `UPDATE` or optimistic locking.
- Index what you filter, join and sort on; check with `EXPLAIN`. Prefer keyset (cursor) pagination for big or changing data.
- Avoid N+1 with a JOIN, an `IN (...)` batch or a DataLoader. Share one pool created at startup, and always release connections in `finally`. A transaction needs one connection.
- Normalize first (each fact once, aim for 3NF), denormalize only for a measured reason. Version your schema with migrations (never edit an applied one; expand and contract). Keep SQL in repositories and validate at the boundary.
- Retry only transient errors, with backoff and jitter, and make retried operations idempotent. Cache with cache-aside plus TTL, invalidate on write, protect against stampede, and shut down gracefully: stop traffic, drain, close the pool.

## Quick check

1. You need to store shop orders with payments, and also user login sessions. Which databases would you pick and why?
<details><summary>Answer</summary>

PostgreSQL (or MySQL) for orders and payments, because they need transactions, constraints and relationships. Redis for sessions, because they are small, read constantly, and should expire by themselves (TTL). The key is to justify each choice by data shape and requirements, not by brand.

</details>

2. Why do placeholders (`?`) stop SQL injection, and what can they NOT be used for?
<details><summary>Answer</summary>

The SQL text and the values are sent separately, so a value is never parsed as SQL. They cannot stand for table names, column names or keywords like `ASC`. For those, check the input against an allow list and build the text from your own constants.

</details>

3. What does ACID stand for, and which problem does the READ COMMITTED isolation level still allow?
<details><summary>Answer</summary>

Atomicity (all or nothing), Consistency (constraints always hold after a commit), Isolation (concurrent transactions do not see each other's half-done work) and Durability (a committed change survives a crash). READ COMMITTED prevents dirty reads, but a non-repeatable read (the same row read twice gives two values) and a phantom read (new rows appear) are still possible.

</details>

4. Why use a connection pool, what happens if a request forgets to release its connection, and why is `await pool.query('BEGIN')` followed by `await pool.query('INSERT ...')` a bug?
<details><summary>Answer</summary>

Opening a connection is slow and the database allows only a limited number, so a pool keeps some open and reuses them. A forgotten release is a leak: the pool runs out and new requests wait until the acquire timeout, while the database itself is fine. Release in `finally`. Each `pool.query` may use a different connection, so the `INSERT` may not be inside your transaction: borrow one client with `pool.connect()` and run `BEGIN`, the statements and `COMMIT` on it.

</details>

5. Two customers try to buy the last item at the same time. How do you make sure only one succeeds?
<details><summary>Answer</summary>

Do the check and the change in one atomic statement: `UPDATE stock SET qty = qty - 1 WHERE item = ? AND qty >= 1`, then look at `changes` (or `rowCount`): 1 means success, 0 means sold out. Optimistic locking (a `version` column in the `WHERE`) or `SELECT ... FOR UPDATE` also work. Reading the number in JavaScript and writing it back later loses updates.

</details>

6. What is the N+1 problem and how do you fix it?
<details><summary>Answer</summary>

One query loads a list, then one extra query runs for each item (N more). Fix it with a JOIN or eager loading (`include`), with one `IN (...)` query and stitching the results in JavaScript, or with a DataLoader that batches the calls. Find it by counting queries per request.

</details>

7. Why is offset pagination slow for deep pages and unreliable when data changes? What is the alternative?
<details><summary>Answer</summary>

`OFFSET n` makes the database walk past n rows before returning anything, so page 4000 costs far more than page 1. New or deleted rows shift the pages, so rows repeat or get skipped. Keyset (cursor) pagination uses `WHERE (created_at, id) < (?, ?) ORDER BY ... LIMIT n` with an index, so every page costs the same and stays stable. It cannot jump to an arbitrary page.

</details>

8. Describe cache-aside and name one way to prevent a stampede.
<details><summary>Answer</summary>

Read the cache; on a miss read the database, store the result with a TTL, and return it. On a write, update the database and delete the cache key. To prevent a stampede, use single flight (concurrent misses share one load), a short lock, or serve stale data while one request refreshes. Adding jitter to TTLs avoids many keys expiring together.

</details>

9. Why must a retried operation be idempotent, and how do you make a "create payment" call idempotent?
<details><summary>Answer</summary>

A timeout or lost response does not tell you whether the first attempt worked, so a retry may repeat the action. Have the client send an idempotency key for each logical action and store it in a column with a `UNIQUE` index. Insert with `ON CONFLICT DO NOTHING`; if nothing was inserted, return the saved result instead of charging again.

</details>

10. List the steps of a graceful shutdown for a Node service that uses an HTTP server and a database pool.
<details><summary>Answer</summary>

On `SIGTERM`/`SIGINT`: ignore repeated signals, stop accepting new connections (`server.close()`, close idle keep-alive sockets, send `Connection: close`), wait for in-flight requests with a deadline, then close the database pool, then let the process end (force-exit only after the deadline). Close resources in the reverse order of creation.

</details>

## Try it yourself

Run each solution with `node my-solution.js` from any folder. They use only `node:sqlite`.

### Task 1 (easy): a todo list in SQLite

Create an in-memory database with a `todos` table (`id`, `title`, `done` as 0 or 1, default 0). Insert three todos with placeholders, mark one done, print the titles of the todos that are not done, then delete the done ones and print how many rows were removed and how many are left.

<details><summary>Hint</summary>

Use `INSERT INTO todos (title) VALUES (?)` with `run()`. `run()` returns `lastInsertRowid`, which gives you the id to update. `DELETE ... WHERE done = 1` returns `changes`. Use `CHECK (done IN (0, 1))` if you want the database to guard the flag.

</details>

<details><summary>Solution</summary>

```js
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE todos (
    id    INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    done  INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1))
  )
`);

const add = db.prepare('INSERT INTO todos (title) VALUES (?)');
add.run('Buy milk');
add.run('Write lesson');
const laundryId = add.run('Do laundry').lastInsertRowid;

db.prepare('UPDATE todos SET done = 1 WHERE id = ?').run(laundryId);

const open = db.prepare('SELECT id, title FROM todos WHERE done = 0 ORDER BY id').all();
console.log('open:', open.map((t) => t.title));
console.log('done count:', db.prepare('SELECT count(*) AS n FROM todos WHERE done = 1').get().n);

const removed = db.prepare('DELETE FROM todos WHERE done = 1').run().changes;
console.log('removed:', removed, '| left:', db.prepare('SELECT count(*) AS n FROM todos').get().n);
db.close();
```

Output:

```text
open: [ 'Buy milk', 'Write lesson' ]
done count: 1
removed: 1 | left: 2
```

</details>

### Task 2 (medium): a safe product search

Write `searchProducts({ term, sortBy, order, limit })` for a `products` table. Requirements: `term` is matched with `LIKE` using a placeholder; `sortBy` may only be `name` or `price`; `order` only `asc` or `desc`; `limit` must be an integer from 1 to 100. A `%` typed by the user must match a literal percent sign. Prove that `x' OR 1=1 --` and `price; DROP TABLE products` do no harm.

<details><summary>Hint</summary>

Allow lists (`Set`) for `sortBy` and `order`, then put them into the SQL text. The value goes in as `?`. For the wildcards, choose an escape character, double it in the input (`replace(/[!%_]/g, '!$&')`) and write `LIKE ? ESCAPE '!'`.

</details>

<details><summary>Solution</summary>

```js
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price INTEGER NOT NULL);
  INSERT INTO products (name, price) VALUES ('Red pen', 150), ('Blue pen', 140), ('Notebook', 500), ('100% cotton bag', 900);
`);

const SORT_COLUMNS = new Set(['name', 'price']);
const SORT_ORDERS = new Set(['asc', 'desc']);

function searchProducts({ term = '', sortBy = 'name', order = 'asc', limit = 10 } = {}) {
  if (!SORT_COLUMNS.has(sortBy)) throw new Error('bad sortBy');
  if (!SORT_ORDERS.has(order)) throw new Error('bad order');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('bad limit');
  // In a LIKE pattern, % and _ are wildcards. Put "!" in front of them (and of "!" itself) so they match literally.
  const literal = term.replace(/[!%_]/g, '!$&');
  const sql = `SELECT name, price FROM products WHERE name LIKE ? ESCAPE '!' ORDER BY ${sortBy} ${order.toUpperCase()} LIMIT ?`;
  return db.prepare(sql).all(`%${literal}%`, limit).map((r) => `${r.name} (${r.price})`);
}

console.log(searchProducts({ term: 'pen' }));
console.log(searchProducts({ term: 'pen', sortBy: 'price', order: 'desc' }));
console.log(searchProducts({ term: "x' OR 1=1 --" })); // injection text is just text, so nothing matches
console.log(searchProducts({ term: '%' })); // only the product that really contains a % sign
for (const bad of [{ sortBy: 'price; DROP TABLE products' }, { order: 'sideways' }, { limit: '5' }]) {
  try {
    searchProducts(bad);
  } catch (err) {
    console.log('rejected:', err.message);
  }
}
console.log('table still there, rows:', db.prepare('SELECT count(*) AS n FROM products').get().n);
db.close();
```

Output:

```text
[ 'Blue pen (140)', 'Red pen (150)' ]
[ 'Red pen (150)', 'Blue pen (140)' ]
[]
[ '100% cotton bag (900)' ]
rejected: bad sortBy
rejected: bad order
rejected: bad limit
table still there, rows: 4
```

</details>

### Task 3 (harder): an idempotent order in one transaction

Create `orders` (with a `UNIQUE` idempotency key) and `order_lines` (`qty` must be greater than 0). Write `placeOrder({ key, customer, lines })` that inserts the order and all its lines in one transaction and returns `{ orderId, replayed }`. Calling it again with the same key must create nothing and return `replayed: true`. If one line is invalid, nothing from that order may remain.

<details><summary>Hint</summary>

First look up the key and return early when it exists. Then `BEGIN`, insert the order, insert each line, `COMMIT`; in `catch` do `ROLLBACK` and rethrow. A `CHECK (qty > 0)` constraint makes the database reject bad lines for you. For real concurrency, also rely on the `UNIQUE` index: if the insert fails with a unique violation, look the key up again.

</details>

<details><summary>Solution</summary>

```js
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE orders (
    id              INTEGER PRIMARY KEY,
    idempotency_key TEXT NOT NULL UNIQUE,
    customer        TEXT NOT NULL
  );
  CREATE TABLE order_lines (
    id       INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    sku      TEXT NOT NULL,
    qty      INTEGER NOT NULL CHECK (qty > 0)
  );
`);

function placeOrder({ key, customer, lines }) {
  const existing = db.prepare('SELECT id FROM orders WHERE idempotency_key = ?').get(key);
  if (existing) return { orderId: existing.id, replayed: true };

  db.exec('BEGIN');
  try {
    const orderId = db.prepare('INSERT INTO orders (idempotency_key, customer) VALUES (?, ?)').run(key, customer).lastInsertRowid;
    const addLine = db.prepare('INSERT INTO order_lines (order_id, sku, qty) VALUES (?, ?, ?)');
    for (const line of lines) addLine.run(orderId, line.sku, line.qty);
    db.exec('COMMIT');
    return { orderId, replayed: false };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const counts = () => ({
  orders: db.prepare('SELECT count(*) AS n FROM orders').get().n,
  lines: db.prepare('SELECT count(*) AS n FROM order_lines').get().n,
});

const first = placeOrder({ key: 'k-1', customer: 'ann', lines: [{ sku: 'PEN', qty: 2 }, { sku: 'INK', qty: 1 }] });
console.log('first call :', first, counts());
const retry = placeOrder({ key: 'k-1', customer: 'ann', lines: [{ sku: 'PEN', qty: 2 }, { sku: 'INK', qty: 1 }] });
console.log('same key   :', retry, counts());

try {
  placeOrder({ key: 'k-2', customer: 'bob', lines: [{ sku: 'PEN', qty: 1 }, { sku: 'INK', qty: 0 }] });
} catch (err) {
  console.log('bad line   :', err.message);
}
console.log('after fail :', counts(), '(nothing from k-2 was kept)');
db.close();
```

Output:

```text
first call : { orderId: 1, replayed: false } { orders: 1, lines: 2 }
same key   : { orderId: 1, replayed: true } { orders: 1, lines: 2 }
bad line   : CHECK constraint failed: qty > 0
after fail : { orders: 1, lines: 2 } (nothing from k-2 was kept)
```

</details>

## Where to go next

Next lesson: [18. worker_threads, cluster and Scaling on One Machine](../18-worker-threads-and-cluster/README.md). It shows how to use all CPU cores, which also helps when you must keep a synchronous database call off the main thread.

Practise this topic in the interview rounds:
- [Round 2: core questions](../../rounds/round-2-core/questions.md) for SQL vs NoSQL, ACID, injection and pooling
- [Round 3: coding](../../rounds/round-3-coding/questions.md) for caches, pools, retries and pagination
- [Round 4: advanced](../../rounds/round-4-advanced/questions.md) for transactions, idempotency and shutdown
- [Round 5: system design](../../rounds/round-5-system-design/questions.md) for choosing databases, caching and scaling reads

Related lessons: [14. Error Handling and Debugging](../14-error-handling-and-debugging/README.md) (turning database errors into app errors), [16. Testing Node.js Code](../16-testing/README.md) (testing repositories with an in-memory database), [20. Security and the crypto Module](../20-security-and-crypto/README.md) (password hashing, injection) and [24. Production, Deployment and Observability](../24-production-and-deployment/README.md) (graceful shutdown in containers).
