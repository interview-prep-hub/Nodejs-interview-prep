// Built-ins that replace small packages: glob, mkdirp, rimraf, uuid, better-sqlite3, ts-node.
// Shows: fs.glob, recursive mkdir and rm, crypto.randomUUID, node:sqlite, and running a .ts file with no compiler.
// Run: node lessons/22-modern-node-features/examples/08-replacements.js

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-replace-'));
// fs.glob returns backslashes on Windows, so we normalise and sort to print the same text everywhere.
const slash = (list) => `[ ${list.map((p) => p.replaceAll('\\', '/')).sort().join(', ')} ]`;

async function main() {
  console.log('1. fs.glob replaces the glob package (Node 22+, stable since 24)');
  for (const name of ['a.js', 'b.test.js', 'readme.md', 'src/c.js', 'src/deep/d.js', 'node_modules/pkg/index.js']) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), '');
  }
  console.log('  **/*.js           ->', slash(fs.globSync('**/*.js', { cwd: dir })));
  console.log('  ... exclude       ->', slash(fs.globSync('**/*.js', { cwd: dir, exclude: ['node_modules/**'] })));
  console.log('  two patterns      ->', slash(fs.globSync(['*.md', 'src/*.js'], { cwd: dir })));
  console.log('  braces            ->', slash(fs.globSync('**/*.{md,test.js}', { cwd: dir })));
  const found = [];
  for await (const match of fs.promises.glob('src/**/*.js', { cwd: dir })) found.push(match); // async version
  console.log('  async iterator    ->', slash(found));

  console.log('2. mkdir and rm with { recursive: true } replace mkdirp and rimraf');
  const deep = path.join(dir, 'x', 'y', 'z');
  console.log('  mkdir -p returns the first folder it created:', path.basename(fs.mkdirSync(deep, { recursive: true })));
  console.log('  second time returns undefined (nothing to create):', fs.mkdirSync(deep, { recursive: true }));
  fs.rmSync(path.join(dir, 'x'), { recursive: true, force: true });
  console.log('  after rm -rf, folder exists:', fs.existsSync(path.join(dir, 'x')));
  fs.rmSync(path.join(dir, 'never-existed'), { recursive: true, force: true });
  console.log('  force: true ignores a path that is missing');
  try {
    fs.rmSync(path.join(dir, 'never-existed'), { recursive: true });
  } catch (err) {
    console.log('  without force a missing path throws:', err.code);
  }

  console.log('3. crypto.randomUUID replaces uuid for version 4');
  const id = crypto.randomUUID();
  console.log('  looks like a v4 UUID:', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id));
  console.log('  two calls differ:', id !== crypto.randomUUID());

  console.log('4. node:sqlite replaces better-sqlite3 for simple needs (release candidate in Node 24)');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
  const insert = db.prepare('INSERT INTO users (name) VALUES (?)');
  console.log('  insert ->', insert.run('Sam'));
  insert.run('Ada');
  console.log('  select one ->', { ...db.prepare('SELECT * FROM users WHERE name = ?').get('Ada') });
  console.log('  select all ->', db.prepare('SELECT name FROM users ORDER BY name').all().map((row) => row.name));
  db.close();

  console.log('5. Type stripping replaces ts-node for simple TypeScript (Node 22.18+ and 24)');
  const run = (source) => {
    fs.writeFileSync(path.join(dir, 'app.ts'), source);
    const result = spawnSync(process.execPath, [path.join(dir, 'app.ts')], { encoding: 'utf8' });
    return `${result.stdout}${result.stderr}`.split(/\r?\n/).filter(Boolean);
  };
  const ok = run("interface User { name: string }\nconst user: User = { name: 'Sam' };\nconsole.log('typescript ran:', user.name);\n");
  console.log(' ', ok[0]);
  const bad = run('enum Color { Red, Green }\nconsole.log(Color.Red);\n');
  console.log('  enum fails:', bad.find((line) => line.includes('ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX')));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(dir, { recursive: true, force: true }));
