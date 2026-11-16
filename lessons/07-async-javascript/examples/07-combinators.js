// Promise combinators: all, allSettled, race, any
// Shows what each one returns, how each one fails, and what happens to the promises that lose.
// Run: node lessons/07-async-javascript/examples/07-combinators.js

const delay = (ms, value) => new Promise((resolve) => setTimeout(resolve, ms, value));

// ok(name, ms) fulfills with `name` after `ms`. fail(name, ms) rejects with an Error after `ms`.
const ok = (name, ms) => delay(ms).then(() => name);
const fail = (name, ms) =>
  delay(ms).then(() => {
    throw new Error(name + ' failed');
  });

// Run a promise and print what happened to it, in one short line.
async function show(label, promise) {
  try {
    console.log(label.padEnd(30), 'fulfilled ->', await promise);
  } catch (err) {
    if (err instanceof AggregateError) {
      console.log(label.padEnd(30), 'rejected  -> AggregateError', err.errors.map((e) => e.message));
    } else {
      console.log(label.padEnd(30), 'rejected  ->', err.message);
    }
  }
}

async function main() {
  console.log('--- Promise.all: all must succeed');
  await show('all, everyone succeeds', Promise.all([ok('a', 20), ok('b', 10), ok('c', 30)]));
  await show('all, one fails', Promise.all([ok('a', 20), fail('b', 10), ok('c', 30)]));

  // The loser is NOT cancelled. Promise.all only stops WAITING; the work keeps running.
  console.log('\n--- losers keep running');
  let cFinished = false;
  const slow = delay(40).then(() => {
    cFinished = true;
    return 'c';
  });
  await show('all rejects at 10 ms', Promise.all([fail('b', 10), slow]));
  console.log('slow task finished yet?'.padEnd(30), cFinished);
  await delay(60);
  console.log('slow task finished later?'.padEnd(30), cFinished);

  // Promise.all attaches a handler to EVERY input. So when a second input fails later, that
  // failure is silently dropped. It does not crash the process as an unhandled rejection.
  console.log('\n--- later failures are ignored, not unhandled');
  await show('all, two failures', Promise.all([fail('first', 10), fail('second', 20)]));
  await delay(30);
  console.log('still alive after the second failure');

  console.log('\n--- Promise.allSettled: wait for everyone, never rejects');
  const settled = await Promise.allSettled([ok('a', 10), fail('b', 5), ok('c', 20)]);
  console.log(
    JSON.stringify(
      settled.map((r) => (r.status === 'fulfilled' ? r : { status: r.status, reason: r.reason.message })),
    ),
  );

  console.log('\n--- Promise.race: the first to SETTLE wins (success or failure)');
  await show('race, fast success', Promise.race([ok('fast', 10), ok('slow', 30)]));
  await show('race, fast failure', Promise.race([fail('fast', 10), ok('slow', 30)]));

  console.log('\n--- Promise.any: the first to FULFILL wins (failures are ignored)');
  await show('any, fast failure ignored', Promise.any([fail('fast', 5), ok('slow', 20)]));
  await show('any, everyone fails', Promise.any([fail('x', 5), fail('y', 10)]));

  console.log('\n--- extras');
  await show('plain values are allowed', Promise.all([1, Promise.resolve(2), 3]));
  await show('all([])', Promise.all([]));
  await show('allSettled([])', Promise.allSettled([]));
  await show('any([])', Promise.any([]));
  // Promise.race([]) never settles, so we only describe it here:
  const forever = Promise.race([]);
  const marker = Symbol('still pending');
  console.log('race([]) still pending?'.padEnd(30), (await Promise.race([forever, delay(10, marker)])) === marker);
}

main();
