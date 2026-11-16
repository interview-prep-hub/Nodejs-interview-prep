// The call stack and the callback queue
// Shows: a callback only runs when the call stack is empty, and waiting tasks do not add up.
// Run: node lessons/08-event-loop/examples/01-stack-and-queue.js

// Returns the names of the functions on the call stack right now
// (without the helper itself and without Node's internal frames).
function stackNames() {
  return new Error().stack
    .split('\n')
    .slice(2)
    .filter((line) => !line.includes('node:internal'))
    .map((line) => line.trim().replace(/^at /, '').split(' ')[0]);
}

function a() {
  b();
}
function b() {
  c();
}
function c() {
  console.log('stack inside c():', stackNames().join(' <- '));
}

// Part 1: normal function calls pile up on the call stack.
a();

// Part 2: a callback starts on a fresh stack, after the main script is done.
function partTwo() {
  const start = Date.now();

  setTimeout(() => {
    const waited = Date.now() - start;
    console.log('stack inside the timer callback:', stackNames().join(' <- '));
    console.log('timer asked for 0 ms, but waited at least 100 ms:', waited >= 100);
    partThree();
  }, 0);

  // Keep the call stack busy for 100 ms. The timer is "due" after about 1 ms,
  // but nothing can run until this loop and the whole main script are finished.
  while (Date.now() - start < 100) {
    // busy
  }
  console.log('main script ends');
}

// Part 3: three tasks that each "wait" 100 ms. Waiting costs no CPU, so they wait together.
function partThree() {
  const start = Date.now();
  let finished = 0;
  for (const name of ['task A', 'task B', 'task C']) {
    setTimeout(() => {
      console.log(`${name} finished`);
      finished++;
      if (finished === 3) {
        console.log('three 100 ms waits took less than 250 ms in total:', Date.now() - start < 250);
      }
    }, 100);
  }
}

partTwo();
