// The N+1 query problem with a query counter, and three fixes: JOIN, IN (...) batch, a tiny DataLoader
// Run: node lessons/17-databases-and-data-access/examples/06-n-plus-one.js

const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE authors  (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE posts    (id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL REFERENCES authors(id), title TEXT NOT NULL);
  CREATE TABLE comments (id INTEGER PRIMARY KEY, post_id INTEGER NOT NULL REFERENCES posts(id), body TEXT NOT NULL);
  CREATE INDEX idx_posts_author ON posts(author_id);
  CREATE INDEX idx_comments_post ON comments(post_id);
`);
db.exec('BEGIN');
for (let a = 1; a <= 5; a++) db.prepare('INSERT INTO authors (name) VALUES (?)').run(`Author ${a}`);
for (let p = 1; p <= 20; p++) db.prepare('INSERT INTO posts (author_id, title) VALUES (?, ?)').run((p % 5) + 1, `Post ${p}`);
for (let p = 1; p <= 20; p++) {
  for (let c = 1; c <= 2; c++) db.prepare('INSERT INTO comments (post_id, body) VALUES (?, ?)').run(p, `Comment ${c} on post ${p}`);
}
db.exec('COMMIT');

// Every query in this file goes through this function, so we can count the round trips.
let queries = 0;
function query(sql, ...params) {
  queries++;
  return db.prepare(sql).all(...params);
}
// Pretend each query costs 1 ms of network time (a real server on another machine does).
function report(label) {
  const word = queries === 1 ? 'query' : 'queries';
  console.log(`  ${label}: ${queries} ${word}, about ${queries} ms of network time if each trip costs 1 ms`);
  queries = 0;
}

console.log('1. N+1: one query for the list, then one more query per row');
const posts = query('SELECT id, author_id, title FROM posts');
const withAuthors = posts.map((post) => {
  const author = query('SELECT name FROM authors WHERE id = ?', post.author_id)[0]; // runs 20 times
  return { title: post.title, author: author.name };
});
console.log('  first row:', JSON.stringify(withAuthors[0]));
report('N+1 (20 posts)');

console.log('2. fix A: let the database JOIN the two tables in ONE query');
const joined = query(`
  SELECT posts.title, authors.name AS author
  FROM posts JOIN authors ON authors.id = posts.author_id
`);
console.log('  first row:', JSON.stringify(joined[0]));
report('JOIN');

console.log('3. fix B: collect the ids, then fetch all parents with IN (...) in ONE more query');
const postRows = query('SELECT id, author_id, title FROM posts');
const authorIds = [...new Set(postRows.map((p) => p.author_id))];
const marks = authorIds.map(() => '?').join(', '); // "?, ?, ?, ?, ?"
const authorRows = query(`SELECT id, name FROM authors WHERE id IN (${marks})`, ...authorIds);
const authorById = new Map(authorRows.map((a) => [a.id, a]));
const stitched = postRows.map((p) => ({ title: p.title, author: authorById.get(p.author_id).name }));
console.log('  first row:', JSON.stringify(stitched[0]));
report('IN batch');

console.log('4. the same trap one level deeper (posts -> comments), fixed the same way');
const slow = query('SELECT id, title FROM posts').map((p) => ({
  title: p.title,
  comments: query('SELECT body FROM comments WHERE post_id = ?', p.id).length, // 20 more queries
}));
report('N+1 for comments');
const ids = query('SELECT id, title FROM posts');
const allComments = query(`SELECT post_id, body FROM comments WHERE post_id IN (${ids.map(() => '?').join(', ')})`, ...ids.map((p) => p.id));
const byPost = Map.groupBy(allComments, (c) => c.post_id); // group in JavaScript
const fast = ids.map((p) => ({ title: p.title, comments: (byPost.get(p.id) ?? []).length }));
report('IN batch for comments');
console.log('  same answer?', JSON.stringify(slow) === JSON.stringify(fast));

console.log('5. a tiny DataLoader: many load(id) calls in the same tick become ONE query');
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

async function main() {
  const list = query('SELECT id, author_id, title FROM posts');
  // Each "resolver" asks for its own author, like a GraphQL field resolver would.
  const result = await Promise.all(list.map(async (p) => ({ title: p.title, author: await authorLoader.load(p.author_id) })));
  console.log('  first row:', JSON.stringify(result[0]), ' rows:', result.length);
  report('DataLoader');
  db.close();
}
main();
