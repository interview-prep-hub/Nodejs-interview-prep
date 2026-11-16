// Relationships and JOINs: one-to-many, many-to-many, INNER vs LEFT JOIN, GROUP BY, HAVING, subqueries, CTE, window function, foreign keys
// Run: node lessons/17-databases-and-data-access/examples/02-sqlite-joins.js

const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(':memory:');

console.log('1. tables with foreign keys (a foreign key points at a row in another table)');
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
console.log('  foreign keys enforced by default:', db.prepare('PRAGMA foreign_keys').get().foreign_keys === 1);

const addAuthor = db.prepare('INSERT INTO authors (name) VALUES (?)');
const addPost = db.prepare('INSERT INTO posts (author_id, title, views) VALUES (?, ?, ?)');
const addTag = db.prepare('INSERT INTO tags (name) VALUES (?)');
const tagPost = db.prepare('INSERT INTO post_tags (post_id, tag_id) VALUES (?, ?)');

const ada = addAuthor.run('Ada').lastInsertRowid;
const bob = addAuthor.run('Bob').lastInsertRowid;
addAuthor.run('Cy'); // Cy has not written anything yet
const p1 = addPost.run(ada, 'Intro to SQL', 120).lastInsertRowid;
const p2 = addPost.run(ada, 'Indexes explained', 80).lastInsertRowid;
const p3 = addPost.run(bob, 'Why pools matter', 45).lastInsertRowid;
const sql = addTag.run('sql').lastInsertRowid;
const perf = addTag.run('performance').lastInsertRowid;
tagPost.run(p1, sql);
tagPost.run(p2, sql);
tagPost.run(p2, perf);
tagPost.run(p3, perf);

const show = (rows) => rows.forEach((r) => console.log('  ', JSON.stringify(r)));

console.log('2. INNER JOIN: only rows that match on both sides');
show(db.prepare(`
  SELECT posts.title, authors.name AS author
  FROM posts
  INNER JOIN authors ON authors.id = posts.author_id
  ORDER BY posts.id
`).all());

console.log('3. LEFT JOIN: keep every author, even without posts (missing side is NULL)');
show(db.prepare(`
  SELECT authors.name AS author, posts.title
  FROM authors
  LEFT JOIN posts ON posts.author_id = authors.id
  ORDER BY authors.id, posts.id
`).all());

console.log('4. GROUP BY with aggregates: posts and views per author');
show(db.prepare(`
  SELECT authors.name AS author, count(posts.id) AS posts, coalesce(sum(posts.views), 0) AS views
  FROM authors
  LEFT JOIN posts ON posts.author_id = authors.id
  GROUP BY authors.id
  ORDER BY views DESC
`).all());

console.log('5. many-to-many: two joins through the link table');
show(db.prepare(`
  SELECT posts.title, tags.name AS tag
  FROM posts
  JOIN post_tags ON post_tags.post_id = posts.id
  JOIN tags      ON tags.id = post_tags.tag_id
  ORDER BY posts.id, tags.name
`).all());

console.log('6. a join repeats the parent columns, so shape the rows in JavaScript');
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

console.log('7. WHERE filters rows before grouping, HAVING filters the groups: authors with more than 1 post');
show(db.prepare(`
  SELECT authors.name AS author, count(*) AS posts
  FROM authors JOIN posts ON posts.author_id = authors.id
  GROUP BY authors.id
  HAVING count(*) > 1
`).all());

console.log('8. subqueries: a query inside a query');
show(db.prepare('SELECT title, views FROM posts WHERE views > (SELECT avg(views) FROM posts) ORDER BY views DESC').all());
console.log('   authors who have written nothing (NOT EXISTS):');
show(db.prepare('SELECT name FROM authors WHERE NOT EXISTS (SELECT 1 FROM posts WHERE posts.author_id = authors.id)').all());

console.log('9. a CTE (WITH) gives a subquery a name, so long queries read top to bottom');
show(db.prepare(`
  WITH totals AS (
    SELECT author_id, sum(views) AS views FROM posts GROUP BY author_id
  )
  SELECT authors.name AS author, totals.views
  FROM totals JOIN authors ON authors.id = totals.author_id
  ORDER BY totals.views DESC
`).all());

console.log('10. a window function numbers rows inside each group without collapsing them');
show(db.prepare(`
  SELECT author, title, views FROM (
    SELECT authors.name AS author, posts.title, posts.views,
           row_number() OVER (PARTITION BY posts.author_id ORDER BY posts.views DESC) AS n
    FROM posts JOIN authors ON authors.id = posts.author_id
  )
  WHERE n = 1
  ORDER BY author
`).all());

console.log('11. foreign keys protect you from orphans');
try {
  addPost.run(999, 'Post by nobody', 0);
} catch (err) {
  console.log('  insert:', err.errstr, '|', err.message);
}
db.prepare('DELETE FROM authors WHERE id = ?').run(ada);
console.log('  after deleting Ada (ON DELETE CASCADE) posts left:', db.prepare('SELECT count(*) AS n FROM posts').get().n);
console.log('  her tag links went too:', db.prepare('SELECT count(*) AS n FROM post_tags').get().n, 'link left');

db.close();
