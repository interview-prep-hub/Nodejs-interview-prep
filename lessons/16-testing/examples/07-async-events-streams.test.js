// Testing async code, event emitters, streams and error paths
// Run: node --test lessons/16-testing/examples/07-async-events-streams.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { BatchProcessor } = require('./_lib/batch.js');
const { createLineSplitter } = require('./_lib/line-splitter.js');

describe('async functions and promises', () => {
  const double = async (n) => n * 2;
  const failWith = async (message) => {
    throw new Error(message);
  };

  it('await the result, then assert', async () => {
    assert.equal(await double(21), 42);
  });

  it('assert.rejects accepts a promise, or a function that returns one', async () => {
    await assert.rejects(failWith('boom'), { message: 'boom' });
    await assert.rejects(() => failWith('boom'), Error);
  });

  it('assert.doesNotReject checks the happy path', async () => {
    await assert.doesNotReject(double(1));
  });

  it('returning the promise also works (no async keyword needed)', () => {
    return double(5).then((value) => {
      assert.equal(value, 10);
    });
  });

  it('Promise.all keeps the order of the inputs, not the order of finishing', async () => {
    const first = Promise.withResolvers(); // a promise we settle by hand: no timers, no waiting
    const second = Promise.withResolvers();

    const all = Promise.all([first.promise, second.promise]);
    second.resolve('b'); // the second one finishes first
    first.resolve('a');

    assert.deepEqual(await all, ['a', 'b']);
  });
});

describe('an EventEmitter (BatchProcessor)', () => {
  it('emits one item event per item, in order, then done', async () => {
    const processor = new BatchProcessor(async (n) => n * 2);
    const seen = [];
    processor.on('item', (item, result) => seen.push([item, result]));

    const done = once(processor, 'done'); // start listening BEFORE the work starts
    await processor.run([1, 2, 3]);
    const [summary] = await done; // once() resolves with the array of event arguments

    assert.deepEqual(seen, [[1, 2], [2, 4], [3, 6]]);
    assert.deepEqual(summary, { ok: 3, failed: 0 });
  });

  it('emits failed for a bad item and keeps going', async () => {
    const processor = new BatchProcessor(async (n) => {
      if (n === 2) throw new Error('two is bad');
      return n;
    });
    const failures = [];
    processor.on('failed', (item, error) => failures.push([item, error.message]));

    const ok = await processor.run([1, 2, 3]);

    assert.equal(ok, 2);
    assert.deepEqual(failures, [[2, 'two is bad']]);
  });

  it('error path: with no error listener, run() rejects', async () => {
    const processor = new BatchProcessor(async () => {});

    await assert.rejects(processor.run('not an array'), TypeError);
  });

  it('error path: with an error listener, the error is handed to it', async () => {
    const processor = new BatchProcessor(async () => {});
    const errors = [];
    processor.on('error', (error) => errors.push(error));

    assert.equal(await processor.run('not an array'), 0);
    assert.equal(errors[0].message, 'items must be an array');
  });

  it('a listener added AFTER the event never hears it (use a signal so the test cannot hang)', async () => {
    const processor = new BatchProcessor(async () => {});
    await processor.run([1]); // 'done' has already been emitted

    await assert.rejects(once(processor, 'done', { signal: AbortSignal.timeout(20) }), { name: 'AbortError' });
  });
});

describe('a Transform stream (createLineSplitter)', () => {
  // Push the chunks through the stream with pipeline() and collect every line it outputs.
  async function splitLines(chunks, options) {
    const lines = [];
    await pipeline(
      Readable.from(chunks, { objectMode: false }),
      createLineSplitter(options),
      async function collect(source) {
        for await (const line of source) lines.push(line);
      },
    );
    return lines;
  }

  it('splits one chunk into lines', async () => {
    assert.deepEqual(await splitLines([Buffer.from('a\nb\nc\n')]), ['a', 'b', 'c']);
  });

  it('joins a line that was cut in the middle by a chunk boundary', async () => {
    const chunks = ['he', 'llo\nwor', 'ld\n!'].map((text) => Buffer.from(text));
    assert.deepEqual(await splitLines(chunks), ['hello', 'world', '!']);
  });

  it('keeps a last line that has no trailing newline', async () => {
    assert.deepEqual(await splitLines([Buffer.from('one\ntwo')]), ['one', 'two']);
  });

  it('survives a multi-byte character split across two chunks', async () => {
    const bytes = Buffer.from('café\n'); // the letter e-acute is two bytes in UTF-8
    const chunks = [bytes.subarray(0, 4), bytes.subarray(4)]; // cut between those two bytes
    assert.deepEqual(await splitLines(chunks), ['café']);
  });

  it('gives no lines for empty input', async () => {
    assert.deepEqual(await splitLines([]), []);
  });

  it('error path: a line that is too long makes the pipeline reject', async () => {
    const chunks = [Buffer.from('x'.repeat(50))];
    await assert.rejects(splitLines(chunks, { maxLineLength: 10 }), { code: 'ERR_LINE_TOO_LONG' });
  });
});
