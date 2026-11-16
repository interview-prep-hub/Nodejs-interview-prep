// Common runtime errors, each one reproduced for real: what you see, why it happens, how to fix it
// Shows: ECONNREFUSED, ECONNRESET, EADDRINUSE, ENOENT, EPIPE, "Cannot read properties", module errors, heap out of memory, EMFILE.
// Run: node lessons/14-error-handling-and-debugging/examples/12-common-runtime-errors.js

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'common14-'));
// Make messages the same on every machine: hide folders, ports and Windows backslashes.
const clean = (text) =>
  String(text)
    .split(tmp)
    .join('<tmp>')
    .split(os.tmpdir())
    .join('<tmpdir>')
    .split(__dirname)
    .join('<examples>')
    .replaceAll('\\', '/')
    .replace(/:(\d{4,5})\b/g, ':<port>');
const firstLine = (text) => clean(text).split('\n')[0];
const show = (label, value) => console.log(`  ${label.padEnd(9)}: ${value}`);
const row = (label, value) => console.log(`  ${label.padEnd(30)} ${value}`);

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const closed = (server) => new Promise((resolve) => server.close(resolve));

async function freePort() {
  const server = net.createServer();
  const port = await listen(server);
  await closed(server);
  return port; // nobody listens here now
}

async function main() {
  console.log('1. ECONNREFUSED: nothing is listening on that port');
  const port = await freePort();
  await new Promise((resolve) => {
    net.connect(port, '127.0.0.1').on('error', (e) => {
      show('error', `${e.code} (${e.syscall}) ${firstLine(e.message)}`);
      resolve();
    });
  });
  await fetch(`http://127.0.0.1:${port}/`).catch((e) => show('fetch', `${e.name}: ${e.message} | cause.code = ${e.cause.code}`));
  // "localhost" can mean both ::1 (IPv6) and 127.0.0.1 (IPv4). Node tries both, so you get an AggregateError.
  await new Promise((resolve) => {
    net.connect(port, 'localhost').on('error', (e) => {
      show('localhost', `${e.name} code=${e.code} message=${JSON.stringify(e.message)} inner errors=${e.errors?.length ?? 0}`);
      resolve();
    });
  });
  show('fix', 'start the server first, check the port and host, add a retry for start-up races');

  console.log('2. ECONNRESET: the other side slammed the connection shut');
  const rude = http.createServer((req) => req.socket.resetAndDestroy());
  const rudePort = await listen(rude);
  await fetch(`http://127.0.0.1:${rudePort}/`).catch((e) => show('fetch', `${e.message} | cause.code = ${e.cause.code}`));
  rude.close();
  show('fix', 'treat it as retryable for idempotent requests; check idle timeouts of proxies and load balancers');

  console.log('3. EADDRINUSE: the port is already taken');
  const first = net.createServer();
  const taken = await listen(first);
  await new Promise((resolve) => {
    net.createServer().on('error', (e) => {
      show('error', `${e.code} (${e.syscall}) port matches: ${e.port === taken} | ${clean(e.message)}`);
      resolve();
    }).listen(taken, '127.0.0.1');
  });
  await closed(first);
  show('fix', 'stop the old process, pick another port, or listen(0) in tests');

  console.log('4. ENOENT: no such file (or no such command)');
  const before = process.cwd();
  process.chdir(os.tmpdir());
  try {
    fs.readFileSync('config-14-demo.json'); // relative paths start from the CURRENT folder, not from this file
  } catch (e) {
    show('error', `${e.code} | ${clean(e.message)}`);
  }
  process.chdir(before);
  show('fix', "path.join(__dirname, 'config.json'), or import.meta.dirname in ES modules");
  await new Promise((resolve) => {
    spawn('no-such-command-14').on('error', (e) => {
      show('spawn', `${e.code} | syscall: ${e.syscall}`);
      resolve();
    });
  });

  console.log('5. EPIPE: writing to a pipe that the reader already closed');
  await new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', "setInterval(() => process.stdout.write('x'.repeat(100000)), 1)"]);
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.stdout.once('data', () => child.stdout.destroy()); // the reader goes away
    const guard = setTimeout(() => child.kill(), 5000);
    child.on('exit', (code) => {
      clearTimeout(guard);
      show('child', `exit code ${code}, stderr says: ${firstLine(stderr.split('\n').find((l) => l.includes('EPIPE')) ?? '(nothing)')}`);
      resolve();
    });
  });
  show('fix', 'listen for "error" on process.stdout and exit quietly on EPIPE (this is what happens with: node app.js | head)');

  console.log('6. "Cannot read properties of undefined" and its relatives');
  const cases = {
    'missing nested field': () => ({}).profile.name,
    'not a function': () => {
      const api = {};
      return api.run();
    },
    'forgot await': () => Promise.resolve({ name: 'Ada' }).name.toUpperCase(),
    'destructure undefined': () => {
      const [first] = undefined;
      return first;
    },
    'assign to undefined': () => {
      const settings = undefined;
      settings.theme = 'dark';
    },
    'reassign const': () => {
      const limit = 1;
      limit = 2; // eslint-disable-line no-const-assign
    },
  };
  for (const [label, run] of Object.entries(cases)) {
    try {
      run();
    } catch (e) {
      console.log(`  ${label.padEnd(22)} ${e.name}: ${e.message}`);
    }
  }
  show('fix', 'validate input at the edge, use ?. and ??, and ask WHY the value is undefined (that is the real bug)');

  console.log('7. Module errors');
  const attempt = (label, run) => {
    try {
      run();
    } catch (e) {
      row(label, `${e.code}: ${firstLine(e.message)}`);
    }
  };
  attempt('require("./nope")', () => require('./nope-14'));
  attempt('require("some-package")', () => require('no-such-package-14'));
  await import('./nope-14.mjs').catch((e) => row('import("./nope.mjs")', `${e.code}: ${firstLine(e.message)}`));
  await import('no-such-package-14').catch((e) => row('import("some-package")', `${e.code}: ${firstLine(e.message)}`));

  // An ES module has no require(), __dirname or __filename.
  const usesRequire = path.join(tmp, 'uses-require.mjs');
  fs.writeFileSync(usesRequire, "const fs = require('node:fs');\n");
  await import(pathToFileURL(usesRequire).href).catch((e) => row('require() inside .mjs', `${e.name}: ${firstLine(e.message)}`));

  // Node 24 can require() an ES module, unless the module (or one it imports) uses top-level await.
  const plain = path.join(tmp, 'plain.mjs');
  fs.writeFileSync(plain, 'export const x = 1;\n');
  row('require() of a plain .mjs', `works, x = ${require(plain).x}`);
  const tla = path.join(tmp, 'tla.mjs');
  fs.writeFileSync(tla, 'await Promise.resolve();\nexport const x = 1;\n');
  attempt('require() of top-level await', () => require(tla));

  // The classic ERR_REQUIRE_ESM: older Node versions (before 20.19 and 22.12), or the feature switched off.
  fs.writeFileSync(path.join(tmp, 'load-it.cjs'), "require('./plain.mjs');\n");
  const old = spawnSync(process.execPath, ['--no-experimental-require-module', path.join(tmp, 'load-it.cjs')], { encoding: 'utf8' });
  const esmLine = old.stderr.split('\n').find((l) => l.includes('ERR_REQUIRE_ESM')) ?? '(not found)';
  row('require() of ESM, feature off', firstLine(esmLine.trim()));
  show('fix', 'use import() or make the code ESM; check the "type" field in package.json and the file extension');

  console.log('8. FATAL ERROR: JavaScript heap out of memory (a child with a tiny 40 MB heap and a leak)');
  const leak = "const keep = []; for (;;) keep.push('x'.repeat(1000) + Math.random());";
  const oom = spawnSync(process.execPath, ['--max-old-space-size=40', '-e', leak], { encoding: 'utf8', timeout: 8000 });
  show('exit', `${oom.status} (the process aborted, nothing can catch this)`);
  show('stderr', (oom.stderr.split('\n').find((l) => l.includes('FATAL ERROR')) ?? '(none)').trim());
  show('fix', 'find the leak (heap snapshots), stream instead of buffering, or raise --max-old-space-size as a last resort');

  console.log('9. EMFILE: too many open files (every process has a limit)');
  const open = [];
  let emfile;
  try {
    for (let i = 0; i < 20000; i++) open.push(fs.openSync(os.devNull, 'r')); // never closed on purpose
  } catch (e) {
    emfile = e;
  }
  for (const fd of open) fs.closeSync(fd);
  show('error', emfile ? `${emfile.code} (${emfile.syscall}), the OS refused to open one more file` : 'limit not reached within 20000 files (your OS allows more)');
  // The fix is to limit how many run at the same time. A tiny pool: "limit" workers take items from one shared list.
  async function mapLimit(items, limit, fn) {
    const results = [];
    let next = 0;
    async function worker() {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }
  let running = 0;
  let busiest = 0;
  const doubled = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (n) => {
    running++;
    busiest = Math.max(busiest, running);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running--;
    return n * 2;
  });
  show('pool', `10 jobs, limit 3: at most ${busiest} ran at the same time, results ${JSON.stringify(doubled)}`);
  show('fix', 'limit concurrency, close what you open (finally, using, pipeline), only then raise the limit (ulimit -n)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(tmp, { recursive: true, force: true }));
