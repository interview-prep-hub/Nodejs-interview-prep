// Flaky tests: the usual causes, each shown with the FIXED version of the test
// Run: node --test lessons/16-testing/examples/12-flaky-tests.test.js
// Prove the tests do not depend on order (Node 24.16+, early development):
//   node --test --test-randomize lessons/16-testing/examples/12-flaky-tests.test.js
//
// A flaky test passes and fails on the same code. The README explains each cause; the comments
// here say what the flaky version looked like.

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

// Cause 1: timing. The flaky version slept for a fixed time (await sleep(50)) and then checked.
// On a slow or busy machine 50 ms is not enough, so the test fails now and then.
describe('1. timing: wait for a condition, or fake the clock', () => {
  it('polls until the condition is true (with a generous timeout)', async (t) => {
    let ready = false;
    setTimeout(() => {
      ready = true;
    }, 30);

    // t.waitFor() retries the function until it stops throwing. Fast machine: done early. Slow machine: still passes.
    await t.waitFor(() => assert.equal(ready, true), { interval: 5, timeout: 2000 });
  });

  it('or removes real time from the test completely', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let ready = false;
    setTimeout(() => {
      ready = true;
    }, 30);

    t.mock.timers.tick(30);

    assert.equal(ready, true);
  });
});

// Cause 2: shared state. The flaky version kept one counter at the top of the file.
// Test B only passed if test A had already run, so a different order (or running B alone) failed.
describe('2. shared state: build fresh objects for every test', () => {
  function createCounter() {
    let value = 0;
    return {
      inc: () => ++value,
      get value() {
        return value;
      },
    };
  }

  let counter;
  beforeEach(() => {
    counter = createCounter(); // a new counter before EVERY test
  });

  it('starts at zero', () => {
    assert.equal(counter.value, 0);
  });

  it('counts up from zero', () => {
    counter.inc();
    counter.inc();
    assert.equal(counter.value, 2);
  });

  it('is not affected by the test before it', () => {
    assert.equal(counter.value, 0);
  });
});

// Cause 3: ordering. Some results have no guaranteed order. The Node docs promise no order for the names
// fs.readdir() returns (it looks alphabetical on Windows, which can hide the bug on another file system).
describe('3. ordering: sort what has no guaranteed order', () => {
  it('compares directory listings as a sorted list', async (t) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flaky-order-'));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    for (const name of ['b.txt', 'a.txt', 'c.txt']) await fs.writeFile(path.join(dir, name), name);

    const names = await fs.readdir(dir);

    assert.deepEqual(names.sort(), ['a.txt', 'b.txt', 'c.txt']);
  });
});

// Cause 4: ports. The flaky version did server.listen(3000). If anything else on the machine
// (another test file running in parallel, a dev server) already uses 3000, listen fails.
describe('4. ports: ask for port 0 and let the OS choose', () => {
  it('shows what a clash looks like', async (t) => {
    const first = http.createServer().listen(0, '127.0.0.1');
    t.after(() => first.close());
    await once(first, 'listening');
    const takenPort = first.address().port;

    const second = http.createServer().listen(takenPort, '127.0.0.1'); // the same port again

    const [error] = await once(second, 'error');
    assert.equal(error.code, 'EADDRINUSE');
  });

  it('port 0 never clashes: two servers get two different ports', async (t) => {
    const servers = [http.createServer(), http.createServer()];
    for (const server of servers) {
      server.listen(0, '127.0.0.1');
      t.after(() => server.close());
      await once(server, 'listening');
    }

    assert.notEqual(servers[0].address().port, servers[1].address().port);
  });
});

// Cause 5: clocks and time zones. The flaky version used new Date('2030-01-05T23:30:00Z').
// That instant is Saturday in London but already Sunday in Tokyo, so the test passed on one laptop
// and failed on another. new Date(year, monthIndex, day) uses the LOCAL time zone, so it is the same day everywhere.
describe('5. dates: build dates in a way that does not depend on the time zone', () => {
  const isWeekend = (date) => [0, 6].includes(date.getDay()); // getDay() uses the local time zone

  it('knows that 5 January 2030 is a Saturday, in any time zone', () => {
    assert.equal(isWeekend(new Date(2030, 0, 5)), true);
  });

  it('knows that 7 January 2030 is a Monday, in any time zone', () => {
    assert.equal(isWeekend(new Date(2030, 0, 7)), false);
  });
});

// Cause 6: shared files. The flaky version wrote to a fixed path like /tmp/test.json.
// Test files run in parallel processes, so two files could write the same path at the same time.
describe('6. shared files: every test gets its own folder', () => {
  it('mkdtemp() returns a new, unique folder each time', async (t) => {
    const prefix = path.join(os.tmpdir(), 'flaky-unique-');
    const a = await fs.mkdtemp(prefix);
    const b = await fs.mkdtemp(prefix);
    t.after(() => Promise.all([a, b].map((dir) => fs.rm(dir, { recursive: true, force: true }))));

    assert.notEqual(a, b);
  });
});
