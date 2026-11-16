// Tactics that matter in Node: batching (N+1 and DataLoader), keep-alive, compression cost, streams, pagination
// Run: node lessons/19-performance-and-memory/examples/11-tactics-io.js
const http = require('node:http');
const zlib = require('node:zlib');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { setTimeout: sleep } = require('node:timers/promises');

const timeIt = async (fn) => {
  const start = performance.now();
  const value = await fn();
  return { ms: performance.now() - start, value };
};

// =============================================================================================
// Part 1: the N+1 problem, batching, and the DataLoader idea
// =============================================================================================
// A pretend database: every query takes about 10 ms, and only 5 queries may run at the same time (a pool).
class FakeDb {
  constructor(poolSize) {
    this.poolSize = poolSize;
    this.active = 0;
    this.waiting = [];
    this.queries = 0;
  }
  async query(work) {
    if (this.active >= this.poolSize) await new Promise((resolve) => this.waiting.push(resolve));
    this.active++;
    this.queries++;
    try {
      await sleep(10);
      return work();
    } finally {
      this.active--;
      const next = this.waiting.shift();
      if (next) next();
    }
  }
}
const USERS = new Map([[1, 'Ann'], [2, 'Bob'], [3, 'Cy'], [4, 'Di'], [5, 'Ed']]);
const posts = Array.from({ length: 50 }, (_, i) => ({ id: i, authorId: (i % 5) + 1 }));

// A DataLoader collects all load(key) calls of the same moment and asks for them in ONE query.
// (The real library is called "dataloader"; this is the idea in 25 lines.)
class MiniLoader {
  constructor(batchFn) {
    this.batchFn = batchFn;
    this.queue = [];
    this.cache = new Map();
  }
  load(key) {
    if (this.cache.has(key)) return this.cache.get(key); // the same key twice = one lookup
    const promise = new Promise((resolve, reject) => {
      this.queue.push({ key, resolve, reject });
      if (this.queue.length === 1) process.nextTick(() => this.flush()); // flush after the current code finished
    });
    this.cache.set(key, promise);
    return promise;
  }
  async flush() {
    const batch = this.queue;
    this.queue = [];
    try {
      const values = await this.batchFn(batch.map((item) => item.key));
      batch.forEach((item, i) => item.resolve(values[i]));
    } catch (err) {
      batch.forEach((item) => item.reject(err));
    }
  }
}

async function batchingDemo() {
  console.log('--- 1. 50 posts, each needs its author (5 different authors)');
  const strategies = {
    'N+1, one after the other': async (db) => {
      const out = [];
      for (const p of posts) out.push(await db.query(() => USERS.get(p.authorId)));
      return out;
    },
    'N+1, all at once (pool of 5)': (db) => Promise.all(posts.map((p) => db.query(() => USERS.get(p.authorId)))),
    'one query for all authors': async (db) => {
      const ids = [...new Set(posts.map((p) => p.authorId))];
      const found = await db.query(() => ids.map((id) => USERS.get(id)));
      const byId = new Map(ids.map((id, i) => [id, found[i]]));
      return posts.map((p) => byId.get(p.authorId));
    },
    'DataLoader idea (automatic)': async (db) => {
      const loader = new MiniLoader((ids) => db.query(() => ids.map((id) => USERS.get(id))));
      return Promise.all(posts.map((p) => loader.load(p.authorId)));
    },
  };
  for (const [name, run] of Object.entries(strategies)) {
    const db = new FakeDb(5);
    const { ms, value } = await timeIt(() => run(db));
    console.log(`  ${name.padEnd(30)} queries: ${String(db.queries).padStart(2)}   time: ${ms.toFixed(0).padStart(4)} ms   post 7 author: ${value[7]}`);
  }
}

// =============================================================================================
// Part 2: connection reuse (keep-alive)
// =============================================================================================
function get(agent, port) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/', agent }, (res) => {
      res.resume();
      res.on('end', resolve);
    }).on('error', reject);
  });
}

async function keepAliveDemo() {
  console.log('\n--- 2. 100 requests one after the other to a local server');
  const server = http.createServer((req, res) => res.end('ok'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let connections = 0;
  server.on('connection', () => connections++);
  const port = server.address().port;
  for (const [label, keepAlive] of [['new connection every time', false], ['connections reused', true]]) {
    const agent = new http.Agent({ keepAlive });
    connections = 0;
    const { ms } = await timeIt(async () => {
      for (let i = 0; i < 100; i++) await get(agent, port);
    });
    console.log(`  ${label.padEnd(28)} ${ms.toFixed(0).padStart(5)} ms   TCP connections opened: ${connections}`);
    agent.destroy();
  }
  server.close();
}

// =============================================================================================
// Part 3: compression costs CPU
// =============================================================================================
async function compressionDemo() {
  console.log('\n--- 3. compressing a 110 KB JSON response (time for ONE response, on the main thread)');
  const json = JSON.stringify(Array.from({ length: 1500 }, (_, i) => ({ id: i, name: 'user-' + i, email: `user${i}@example.com`, active: i % 2 === 0 })));
  const q = (n) => ({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: n } });
  const options = [
    ['gzip level 1', () => zlib.gzipSync(json, { level: 1 })],
    ['gzip level 6 (default)', () => zlib.gzipSync(json)],
    ['gzip level 9', () => zlib.gzipSync(json, { level: 9 })],
    ['brotli quality 4', () => zlib.brotliCompressSync(json, q(4))],
    ['brotli quality 11 (default)', () => zlib.brotliCompressSync(json)],
  ];
  console.log('  no compression'.padEnd(30), json.length, 'bytes');
  for (const [name, compress] of options) {
    if (!name.includes('quality 11')) compress(); // warm-up (not needed for the slow one)
    const { ms, value } = await timeIt(() => compress());
    console.log(`  ${name.padEnd(28)} ${String(value.length).padStart(6)} bytes   ${ms.toFixed(1).padStart(7)} ms`);
  }
}

// =============================================================================================
// Part 4: streams keep memory flat
// =============================================================================================
function streamsDemo() {
  console.log('\n--- 4. counting the lines of a 12 MB file: read it all, or stream it? (peak memory of a child process)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tactics-io-'));
  const file = path.join(dir, 'big.txt');
  fs.writeFileSync(file, 'line of text for the demo\n'.repeat(500_000));
  const wholeFile = `
    const fs = require('node:fs');
    fs.promises.readFile(process.argv[1], 'utf8').then((text) => {
      let lines = 0;
      for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
      console.log(lines, process.resourceUsage().maxRSS);
    });`;
  const streamed = `
    const fs = require('node:fs');
    (async () => {
      let lines = 0;
      for await (const chunk of fs.createReadStream(process.argv[1])) {
        for (let i = 0; i < chunk.length; i++) if (chunk[i] === 10) lines++;
      }
      console.log(lines, process.resourceUsage().maxRSS);
    })();`;
  const nothing = 'console.log(0, process.resourceUsage().maxRSS)';
  for (const [name, code] of [['an empty program (baseline)', nothing], ['readFile, whole file in memory', wholeFile], ['createReadStream, chunk by chunk', streamed]]) {
    const out = spawnSync(process.execPath, ['-e', code, file], { encoding: 'utf8' }).stdout.trim().split(' ');
    console.log(`  ${name.padEnd(34)} lines: ${out[0].padStart(7)}   peak memory: ${(out[1] / 1024).toFixed(0).padStart(4)} MB`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

// =============================================================================================
// Part 5: pagination: send a page, not the whole table
// =============================================================================================
function paginationDemo() {
  console.log('\n--- 5. pagination');
  const table = Array.from({ length: 100_000 }, (_, i) => ({ id: i + 1, name: 'user-' + (i + 1) }));
  const everything = JSON.stringify(table);
  const onePage = JSON.stringify(table.slice(0, 20));
  console.log(`  whole table as JSON: ${(everything.length / 1024).toFixed(0)} KB | one page of 20 rows: ${onePage.length} bytes`);

  // Newest first, like a feed. These two functions do what the SQL below them does.
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: i + 1 }));
  const newestFirst = () => [...rows].sort((a, b) => b.id - a.id);
  // SELECT id FROM items ORDER BY id DESC LIMIT 10 OFFSET :offset
  const byOffset = (offset, limit) => newestFirst().slice(offset, offset + limit);
  // SELECT id FROM items WHERE id < :lastSeenId ORDER BY id DESC LIMIT 10
  const byKeyset = (lastSeenId, limit) => newestFirst().filter((r) => r.id < lastSeenId).slice(0, limit);
  const ids = (list) => list.map((r) => r.id).join(' ');

  const page1 = byOffset(0, 10);
  console.log('  page 1 (both styles):          ', ids(page1));
  rows.push({ id: 51 }); // someone adds a new item while the user looks at page 1
  console.log('  page 2 with OFFSET 10:         ', ids(byOffset(10, 10)), ' <- 41 again: a duplicate');
  console.log('  page 2 with "id < 41" (keyset):', ids(byKeyset(41, 10)), ' <- no duplicate, no gap');
}

(async () => {
  await batchingDemo();
  await keepAliveDemo();
  await compressionDemo();
  streamsDemo();
  paginationDemo();
})();
