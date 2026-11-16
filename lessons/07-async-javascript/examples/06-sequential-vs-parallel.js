// Sequential vs parallel awaiting, and await inside loops
// Shows the most common beginner performance mistake and how to fix it.
// Run: node lessons/07-async-javascript/examples/06-sequential-vs-parallel.js
// Every fake call takes 200 ms. Real timings are a little longer, so the output shows them
// rounded DOWN to a multiple of 200 ms (this keeps the printed numbers stable between runs).

const delay = (ms, value) => new Promise((resolve) => setTimeout(resolve, ms, value));

// A fake network call that takes `ms` milliseconds.
async function fetchThing(name, ms = 200) {
  await delay(ms);
  return name;
}

// Timers fire a little late (often 10 to 70 ms in total), so round down, not to the nearest.
const about = (ms) => Math.floor((ms + 5) / 200) * 200;

// Print how long `fn` took.
async function timed(label, fn) {
  const start = performance.now();
  const result = await fn();
  const took = about(performance.now() - start);
  console.log(`${label.padEnd(34)} took about ${String(took).padStart(3)} ms ->`, result);
}

async function main() {
  // 1. SLOW: three independent calls, awaited one after another (3 x 200 = 600 ms).
  await timed('1. sequential awaits', async () => {
    const a = await fetchThing('a');
    const b = await fetchThing('b');
    const c = await fetchThing('c');
    return [a, b, c];
  });

  // 2. FAST: start all three at once, wait for all of them (200 ms).
  await timed('2. Promise.all', async () => {
    const [a, b, c] = await Promise.all([fetchThing('a'), fetchThing('b'), fetchThing('c')]);
    return [a, b, c];
  });

  // 3. Also fast: start now, await later. The work starts when the function is CALLED.
  await timed('3. start now, await later', async () => {
    const pa = fetchThing('a');
    const pb = fetchThing('b');
    const pc = fetchThing('c');
    // ... other work could happen here ...
    return [await pa, await pb, await pc];
  });

  // 4. Dependent steps MUST be sequential. Mix the two styles when only some steps depend.
  await timed('4. dependent + independent', async () => {
    const userPromise = fetchThing('user'); // independent: start early
    const settingsPromise = fetchThing('settings'); // independent: start early
    const user = await userPromise;
    const orders = await fetchThing('orders of ' + user); // depends on user (2 x 200 = 400 ms in total)
    return [orders, await settingsPromise];
  });

  const ids = [1, 2, 3];

  // 5. await inside a for...of loop: sequential (600 ms). Fine when order or dependency matters.
  await timed('5. for...of with await', async () => {
    const out = [];
    for (const id of ids) {
      out.push(await fetchThing('item' + id));
    }
    return out;
  });

  // 6. map + Promise.all: parallel (200 ms). The right default for independent items.
  await timed('6. Promise.all(ids.map(...))', async () => {
    return Promise.all(ids.map((id) => fetchThing('item' + id)));
  });

  // 7. Promise.all keeps the INPUT order, not the order in which tasks finish.
  const finishOrder = [];
  const results = await Promise.all([
    fetchThing('slow', 30).then((v) => (finishOrder.push(v), v)),
    fetchThing('fast', 5).then((v) => (finishOrder.push(v), v)),
    fetchThing('medium', 15).then((v) => (finishOrder.push(v), v)),
  ]);
  console.log('7. results (input order):', results);
  console.log('   finish order         :', finishOrder);
}

main();
