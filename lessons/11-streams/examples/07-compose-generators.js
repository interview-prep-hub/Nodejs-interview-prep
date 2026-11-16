// Readable.from, generators as pipeline stages, stream.compose, and the experimental map/filter/toArray
// Run: node lessons/11-streams/examples/07-compose-generators.js

const { Readable, Writable, Duplex, compose } = require('node:stream');
const { pipeline } = require('node:stream/promises');

// A tiny helper: a Writable that collects everything it receives into an array.
function collector(target) {
  return new Writable({
    objectMode: true,
    write(chunk, encoding, callback) {
      target.push(chunk);
      callback();
    },
  });
}

async function readableFromDemo() {
  console.log('--- Readable.from ---');
  // From an array (any iterable works). Readable.from makes an OBJECT MODE stream by default.
  const fromArray = Readable.from(['a', 'b', 'c']);
  console.log('objectMode, highWaterMark :', fromArray.readableObjectMode, fromArray.readableHighWaterMark);
  console.log('array        :', await fromArray.toArray());

  // From an async generator: the natural way to produce data over time.
  async function* numbers() {
    for (let i = 1; i <= 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5)); // pretend to wait for a database
      yield i;
    }
  }
  console.log('generator    :', await Readable.from(numbers()).toArray());

  // A string is NOT split into characters. It becomes ONE chunk.
  console.log('string       :', await Readable.from('hello').toArray());
  console.log('chars on purpose:', await Readable.from([...'hello']).toArray());
}

// A generator function can be a pipeline stage. It receives the previous stage as an
// async iterable and returns (yields) the next one.
async function generatorStagesDemo() {
  console.log('\n--- generators as pipeline stages ---');
  const result = [];

  async function* shout(source) {
    for await (const word of source) yield word.toUpperCase();
  }

  async function* onlyLongWords(source) {
    for await (const word of source) {
      if (word.length > 3) yield word; // yield nothing = drop the item
    }
  }

  async function* repeatTwice(source) {
    for await (const word of source) {
      yield word;
      yield word; // yield twice = one item in, two items out
    }
  }

  await pipeline(
    Readable.from(['a', 'stream', 'of', 'words']),
    shout,
    onlyLongWords,
    repeatTwice,
    collector(result),
  );
  console.log('result       :', result);

  // The LAST stage may also be an async function: it just consumes the source.
  let count = 0;
  await pipeline(Readable.from([1, 2, 3, 4]), async function (source) {
    for await (const item of source) count += item;
  });
  console.log('sum by last-stage function:', count);

  // Errors thrown inside a generator stage reject the pipeline and destroy all streams.
  async function* explode(source) {
    for await (const item of source) {
      if (item === 2) throw new Error('bad item: 2');
      yield item;
    }
  }
  try {
    await pipeline(Readable.from([1, 2, 3]), explode, collector([]));
  } catch (err) {
    console.log('pipeline rejected with:', err.message);
  }
}

// compose() glues several stages into ONE stream (a Duplex). You write into the first stage
// and read from the last one. Handy for building a reusable "processing step".
async function composeDemo() {
  console.log('\n--- stream.compose ---');
  async function* trim(source) {
    for await (const line of source) yield line.trim();
  }
  async function* addBullet(source) {
    for await (const line of source) yield `* ${line}`;
  }

  const bulletMaker = compose(trim, addBullet); // one stream made of two stages
  console.log('is a Duplex       :', bulletMaker instanceof Duplex);

  const result = [];
  await pipeline(Readable.from(['  apples ', ' pears  ']), bulletMaker, collector(result));
  console.log('result       :', result);
}

// Readable.prototype.map / filter / toArray (also take, drop, flatMap, reduce, forEach ...).
// They work like the array methods, but lazily and on streams. Docs: "Stability: 1 - Experimental".
// On Node 24.16 they print no warning, but the API may still change.
async function operatorsDemo() {
  console.log('\n--- stream operators (experimental) ---');
  const result = await Readable.from([1, 2, 3, 4, 5, 6])
    .filter((n) => n % 2 === 0)
    .map((n) => n * 10)
    .toArray();
  console.log('filter + map :', result);

  const firstTwo = await Readable.from(['a', 'b', 'c', 'd']).take(2).toArray();
  console.log('take(2)      :', firstTwo);

  const sum = await Readable.from([1, 2, 3, 4]).reduce((total, n) => total + n, 0);
  console.log('reduce       :', sum);

  // map accepts an async function. With { concurrency: 3 } up to three calls run at once.
  // The output order still matches the input order.
  const started = Date.now();
  const slow = await Readable.from([1, 2, 3, 4, 5, 6])
    .map(
      async (n) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return n * 2;
      },
      { concurrency: 3 },
    )
    .toArray();
  const took = Date.now() - started;
  console.log('concurrency 3:', slow, took < 290 ? '(fast: calls overlapped)' : '(slow?)');
}

async function main() {
  await readableFromDemo();
  await generatorStagesDemo();
  await composeDemo();
  await operatorsDemo();
}

main();
