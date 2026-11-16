// fs.watch: get told when files change, and why you must expect duplicate events
// Run: node lessons/06-file-system/examples/07-watch.js
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Wait until check() is true, or give up after timeoutMs.
async function waitFor(check, timeoutMs = 3000) {
  const start = Date.now();
  while (!check() && Date.now() - start < timeoutMs) await sleep(10);
  return check();
}

// Debounce: run fn only after `ms` of silence. One burst of events becomes one call.
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

async function main() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fs-watch-'));
  let watcher;

  try {
    // --- 1. The callback API ----------------------------------------------
    const events = [];
    let reloads = 0;
    const reload = debounce(() => reloads++, 150);

    watcher = fs.watch(dir, (eventType, filename) => {
      events.push({ eventType, filename });
      reload();
    });
    watcher.on('error', (err) => console.log('watcher error:', err.code));

    // Do three quick writes to the same file.
    const target = path.join(dir, 'watched.txt');
    await fsp.writeFile(target, 'one');
    await fsp.appendFile(target, ' two');
    await fsp.appendFile(target, ' three');

    // Events arrive a little later, so wait for them. Then wait for the debounce timer.
    await waitFor(() => events.some((e) => e.filename === 'watched.txt'));
    await sleep(400);
    watcher.close(); // always close a watcher, or it keeps the process alive

    const names = [...new Set(events.map((e) => e.filename))];
    console.log('file operations we did : 3');
    console.log('got at least one event :', events.length >= 1);
    console.log('events for these names :', names);
    console.log('event types are only rename/change:', events.every((e) => e.eventType === 'rename' || e.eventType === 'change'));
    console.log('debounced reloads      :', reloads, '(one burst became one reload)');
    console.log('(the raw event count differs between operating systems, so we do not print it)');

    // --- 2. The promise API: an async iterator, stopped with an AbortController
    const ac = new AbortController();
    const firstName = (async () => {
      try {
        for await (const event of fsp.watch(dir, { signal: ac.signal })) {
          if (event.filename === 'second.txt') return event.filename;
        }
      } catch (err) {
        if (err.name === 'AbortError') return 'stopped by abort';
        throw err;
      }
    })();

    const safetyNet = setTimeout(() => ac.abort(), 3000); // never wait forever
    await sleep(50); // give the watcher a moment to start
    await fsp.writeFile(path.join(dir, 'second.txt'), 'hello');
    console.log('promise watch saw      :', await firstName);
    clearTimeout(safetyNet);
    ac.abort(); // aborting ends the watch, the loop above has already returned
  } finally {
    if (watcher) watcher.close();
    await sleep(50);
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

main();
