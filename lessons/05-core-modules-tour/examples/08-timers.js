// timers: setTimeout, setInterval, setImmediate, clear*, unref/ref, timers/promises
// Run: node lessons/05-core-modules-tour/examples/08-timers.js
const { setTimeout: sleep, setInterval: every, setImmediate: nextTurn } = require('node:timers/promises');

async function main() {
  console.log('--- callbacks run later, in order of their delay ---');
  setTimeout(() => console.log('B: 60 ms'), 60); // scheduled first, but it is due later
  setTimeout(() => console.log('A: 20 ms'), 20);
  setTimeout((who, what) => console.log(`extra arguments: ${who} ${what}`), 30, 'hello', 'timer');
  setImmediate(() => console.log('setImmediate: right after the current work'));
  console.log('this line runs first (synchronous code)');

  const intervalDone = new Promise((resolve) => {
    let ticks = 0;
    const interval = setInterval(() => {
      ticks++;
      console.log(`interval tick ${ticks}`);
      if (ticks === 3) {
        clearInterval(interval); // stop it from inside its own callback
        resolve();
      }
    }, 45);
  });

  const cancelled = setTimeout(() => console.log('never printed'), 10);
  clearTimeout(cancelled);
  console.log('what setTimeout returns:', typeof cancelled, '(in a browser it is a number)');

  await intervalDone; // the interval is the last thing to finish

  console.log('--- unref: a timer that does not keep the program alive ---');
  const background = setInterval(() => console.log('never printed either'), 1000);
  background.unref();
  console.log('hasRef after unref:', background.hasRef());
  background.ref();
  console.log('hasRef after ref:', background.hasRef());
  background.unref(); // leave it unref'd, so the process can exit

  console.log('--- refresh: start the countdown again (the idea behind debounce) ---');
  const waitedMs = await new Promise((resolve) => {
    const began = Date.now();
    const idle = setTimeout(() => resolve(Date.now() - began), 50);
    setTimeout(() => idle.refresh(), 30); // 30 ms in, the 50 ms countdown starts over
  });
  console.log('fired after about 80 ms, not 50:', waitedMs >= 75);

  console.log('--- timers/promises: await instead of callbacks ---');
  console.log('sleep gives back its value:', await sleep(10, 'done'));

  const ac = new AbortController();
  const slow = sleep(1000, 'too slow', { signal: ac.signal });
  ac.abort();
  try {
    await slow;
  } catch (err) {
    console.log('cancelled sleep ->', err.name, err.code);
  }

  let rounds = 0;
  for await (const _ of every(20)) {
    rounds++;
    console.log(`async interval round ${rounds}`);
    if (rounds === 3) break; // break stops the interval
  }

  console.log('--- setImmediate as a polite pause in heavy work ---');
  let handled = 0;
  for (let i = 0; i < 3; i++) {
    handled += 1000; // pretend this was a big chunk of work
    await nextTurn(); // let the event loop breathe between chunks
  }
  console.log('chunks done, items handled:', handled);
}

main();
