// Finding files: fs.glob (Node 22+), readdir recursive, a hand-written walk, and a concurrency limit
// Run: node lessons/06-file-system/examples/11-glob-and-walk.js
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const slash = (p) => p.split(path.sep).join('/');
const show = (label, list) => console.log(label.padEnd(25), list.join(', '));

// A recursive walk written as an async generator. It yields the full path of every FILE.
async function* walk(dir, { skip = [] } = {}) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (skip.includes(entry.name)) continue; // for example node_modules or .git
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full, { skip });
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

// Run fn on every item, but never more than `limit` at the same time.
// This keeps the number of open files low (too many at once gives EMFILE).
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'fs-walk-'));
  const p = (...parts) => path.join(root, ...parts);

  try {
    // Build a small project tree.
    const files = {
      'index.js': 'console.log(1)',
      'README.md': '# demo',
      'src/app.js': 'app',
      'src/util/helpers.js': 'helpers!',
      'src/util/notes.txt': 'notes',
      'node_modules/lib/index.js': 'library code',
    };
    for (const [name, text] of Object.entries(files)) {
      await fsp.mkdir(path.dirname(p(name)), { recursive: true });
      await fsp.writeFile(p(name), text);
    }

    // 1. fs.glob: patterns instead of loops. Results use the OS separator, so we print with "/".
    show('glob **/*.js', fs.globSync('**/*.js', { cwd: root }).map(slash).sort());
    show('glob src/*', fs.globSync('src/*', { cwd: root }).map(slash).sort());

    // exclude is called with the name of each entry; returning true for a folder stops glob going inside it
    const noModules = fs.globSync('**/*.js', { cwd: root, exclude: (name) => name === 'node_modules' });
    show('glob without modules', noModules.map(slash).sort());

    // 2. The promise version is an async iterator.
    const found = [];
    for await (const match of fsp.glob('**/*.{md,txt}', { cwd: root })) found.push(slash(match));
    show('glob (promises) md/txt', found.sort());

    // 3. readdir with recursive: true (everything, including folders and node_modules)
    const everything = await fsp.readdir(root, { recursive: true });
    console.log('readdir recursive count'.padEnd(25), everything.length, '(files and folders)');

    // 4. Our own walk: full control (skip folders, stop early, add logic)
    const walked = [];
    for await (const file of walk(root, { skip: ['node_modules'] })) walked.push(slash(path.relative(root, file)));
    show('walk, skip modules', walked.sort());

    // 5. Use the walk: total size of the files, reading at most 2 sizes at a time
    const list = [];
    for await (const file of walk(root)) list.push(file);
    let running = 0;
    let peak = 0;
    const sizes = await mapLimit(list, 2, async (file) => {
      running++;
      peak = Math.max(peak, running);
      const { size } = await fsp.stat(file);
      running--;
      return size;
    });
    console.log('total bytes'.padEnd(25), sizes.reduce((a, b) => a + b, 0));
    console.log('max stat calls at once'.padEnd(25), peak, '(never above the limit of 2)');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

main();
