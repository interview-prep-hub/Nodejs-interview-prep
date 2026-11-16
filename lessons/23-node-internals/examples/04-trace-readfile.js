// One call end to end: fs.readFile through JS, the binding, libuv's thread pool and back
// Shows: the JS half of readFile, the chain of libuv requests it creates, the callback with its microtasks, a proof the loop stays free, and where nextTick waits.
// Run: node lessons/23-node-internals/examples/04-trace-readfile.js

const asyncHooks = require('node:async_hooks');
const dns = require('node:dns');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-readfile-'));
const smallFile = path.join(tmp, 'small.txt');
fs.writeFileSync(smallFile, 'hello from a small file\n');

const active = () => process.getActiveResourcesInfo().filter((t) => t !== 'PipeWrap' && t !== 'TTYWrap').join(', ') || '(nothing)';

// ---- Part 1: the JavaScript half of readFile ------------------------------------------
// Only the lines that touch the C++ side are shown.
console.log('Part 1: lines of fs.readFile that cross into C++ (read from the real function)');
for (const line of fs.readFile.toString().split('\n')) {
  if (/FSReqCallback|oncomplete|binding\./.test(line)) console.log('  ' + line.trim());
}

// ---- Part 2: the chain of libuv requests behind ONE readFile call ---------------------
// async_hooks lets us see every "request object" Node creates. We only record, and print at the end,
// because printing from inside a hook would create more resources and more hook calls.
function part2() {
  return new Promise((resolve) => {
    const steps = ['open', 'fstat', 'read', 'close']; // the order used by lib/fs.js and lib/internal/fs/read/context.js
    const events = [];
    let requests = 0;
    const hook = asyncHooks
      .createHook({
        init(id, type) {
          if (type === 'FSREQCALLBACK') {
            events.push(`libuv request ${++requests} created (${steps[requests - 1] || 'more'}), runs on a thread pool thread`);
          }
        },
      })
      .enable();

    events.push('JS: fs.readFile() is called');
    fs.readFile(smallFile, 'utf8', (err, text) => {
      events.push(`JS: callback runs on the main thread with ${text.length} characters`);
      process.nextTick(() => events.push('JS: process.nextTick inside the callback'));
      Promise.resolve().then(() => events.push('JS: promise microtask inside the callback'));
      setImmediate(() => {
        hook.disable();
        console.log('\nPart 2: the timeline of one fs.readFile call');
        events.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
        resolve();
      });
    });
    events.push(`JS: fs.readFile() returned at once. Active resources: ${active()}`);
  });
}

// ---- Part 3: the loop is free while the pool works ----------------------------------------
// A 32 MiB file is read in 512 KiB pieces. A 1 ms interval counts how often the loop got a turn.
async function part3() {
  const bigFile = path.join(tmp, 'big.bin');
  fs.writeFileSync(bigFile, Buffer.alloc(32 * 1024 * 1024, 1));

  let requests = 0;
  const hook = asyncHooks.createHook({ init: (id, type) => type === 'FSREQCALLBACK' && requests++ }).enable();
  let ticks = 0;
  const interval = setInterval(() => ticks++, 1);
  await new Promise((resolve) => fs.readFile(bigFile, resolve));
  clearInterval(interval);
  hook.disable();
  const asyncTicks = ticks;

  ticks = 0;
  const interval2 = setInterval(() => ticks++, 1);
  fs.readFileSync(bigFile); // the main thread does all the work itself
  const syncTicks = ticks;
  clearInterval(interval2);

  console.log('\nPart 3: reading a 32 MiB file');
  console.log(`  libuv requests used by the async readFile: ${requests} (open, fstat, many reads, close)`);
  console.log(`  loop got turns while fs.readFile worked: ${asyncTicks > 0}`);
  console.log(`  loop got turns during fs.readFileSync   : ${syncTicks > 0}`);
}

// ---- Part 4: which APIs create which kind of request? -------------------------------------
async function part4() {
  const server = net.createServer((socket) => socket.destroy()).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  const clients = [];
  const rows = [];
  const probe = (label, start) => {
    const before = process.getActiveResourcesInfo();
    start();
    const added = process.getActiveResourcesInfo().filter((t) => {
      const i = before.indexOf(t);
      if (i >= 0) {
        before.splice(i, 1);
        return false;
      }
      return true;
    });
    rows.push([label, added.join(', ')]);
  };
  probe('fs.readFile', () => fs.readFile(smallFile, () => {}));
  probe('fs.promises.readFile', () => fs.promises.readFile(smallFile));
  probe('dns.lookup("localhost")', () => dns.lookup('localhost', () => {}));
  probe('net.connect(port, "127.0.0.1")', () => clients.push(net.connect(port, '127.0.0.1')));
  probe('net.connect(port, "localhost")', () => clients.push(net.connect(port, 'localhost')));
  probe('setTimeout', () => setTimeout(() => {}, 1));
  console.log('\nPart 4: resource types you see right after starting an operation');
  for (const [label, types] of rows) console.log(`  ${label.padEnd(34)} ${types}`);

  // Tidy up: let the pending work finish, then close everything.
  await new Promise((resolve) => setTimeout(resolve, 100));
  clients.forEach((c) => c.on('error', () => {}).destroy());
  server.close();
}

// ---- Part 5: where do process.nextTick and promise callbacks wait? ---------------------------
// process.nextTick is plain JavaScript inside Node: it pushes an object onto a queue that Node keeps.
// Promise callbacks wait in a different queue, which belongs to V8. This prints the lines of the real
// nextTick function that touch Node's queue (internal details, they can change between Node versions).
function part5() {
  console.log('\nPart 5: the real process.nextTick pushes onto a queue that Node owns');
  for (const line of process.nextTick.toString().split('\n')) {
    if (/queue|setHasTickScheduled|async_context_frame/.test(line)) console.log('  ' + line.trim());
  }
}

(async () => {
  await part2();
  await part3();
  await part4();
  part5();
  fs.rmSync(tmp, { recursive: true, force: true });
})();
