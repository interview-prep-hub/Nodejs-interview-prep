# 16. Testing Node.js Code

> Level: Intermediate   Time: about 150 minutes   Node: 24 (notes where older versions differ)

[Previous: 15. Processes, Signals, child_process and Building CLIs](../15-processes-and-cli/README.md) | [All lessons](../../README.md) | [Next: 17. Databases and Data Access](../17-databases-and-data-access/README.md)

## What you will learn
- What the test pyramid is (unit, integration, end-to-end) and what a good test looks like
- The built-in test runner `node:test`: `test`, `describe`, `it`, async tests, subtests, hooks, `skip`, `todo`, `only`, timeouts, reporters, watch mode and how test files are found
- Assertions with `node:assert/strict`, good failure messages, and the Arrange-Act-Assert pattern
- Test doubles (stubs, spies, mocks, fakes), `mock.fn`, `mock.method`, and fake time with `mock.timers`
- How to write code that is easy to test (pure functions, dependency injection, small modules)
- How to test async code, event emitters, streams, error paths, an HTTP server (port 0 plus `fetch`) and code that reads files (temp folders)
- Code coverage, snapshot testing, flaky tests (causes and fixes), and test-driven development with a worked example
- How `node:test` compares with Jest, Vitest, Mocha (+ Chai, Sinon) and supertest, how to run tests in CI, and which advanced ideas (mutation, property-based and contract testing) interviewers mention

How the examples are organised:
- All examples are in `examples/`. Test files end in `.test.js` and run with `node --test <file>`. Plain scripts run with `node <file>`. Run every command from the repo root.
- Files that start with `_` are not tests. `_lib/` holds the code being tested. `_fixtures/` holds small helper suites that the demos run on purpose (a **fixture** is a fixed input or helper file that a demo or test uses).
- Everything uses only core modules and works from any folder.
- Test output shows a time in parentheses after each test, for example `(2.3ms)`. Those numbers differ on every machine and every run.
- Snippets that need an npm package (Jest, Vitest, Mocha, supertest, Fastify) are labelled "Needs: npm install ..." and were not run for this lesson.

## 1. Why we test, and the test pyramid

An **automated test** is a small program that runs your code and checks the result. If the result is wrong, the test fails and says where. You write it once and run it thousands of times.

Why bother?
- You find a bug in seconds, not after a customer reports it.
- You can change code (**refactor**: improve the inside without changing the behaviour) without fear. If the tests still pass, the behaviour is the same.
- Tests show how the code is meant to be used.
- A CI server (continuous integration: a machine that runs your checks on every push, see section 19) can refuse to merge code that breaks a test.

Think of a car factory. You test one bolt (is it strong enough?), then the engine (do the parts work together?), then you drive the finished car around the track. Each check is slower and more expensive than the one before, and catches different problems.

That is the **test pyramid**:

```text
         /\
        /e2e\          few, slow, test the whole system from the outside
       /------\
      /integr. \       some, medium speed, test parts working together
     /----------\
    /    unit    \     many, very fast, test one small piece
   /--------------\
```

| Level | What it tests | Speed | How many | Example in this lesson |
|---|---|---|---|---|
| Unit | one function or class, with its neighbours faked | milliseconds | hundreds | `applyDiscount(10000, 10)` returns `9000` |
| Integration | several real parts together (your code plus a real HTTP server, a real file system, a real database) | tens to hundreds of ms | dozens | start the server on port 0 and call it with `fetch` |
| End-to-end (e2e) | the whole running system, from the outside, like a user | seconds | a handful | a script drives a real browser against a deployed copy |

Why a pyramid and not a rectangle? Unit tests are fast and tell you exactly which function broke. End-to-end tests are slow, break for unrelated reasons (network, timing) and only say "checkout failed". So you write many cheap tests at the bottom and a few expensive ones at the top.

Good tests are **FIRST**:

| Letter | Meaning |
|---|---|
| Fast | the whole suite runs in seconds, so people actually run it |
| Isolated | no test depends on another test, or on the order |
| Repeatable | same result every time, on every machine |
| Self-checking | pass or fail, with no human reading output |
| Timely | written together with the code, not months later |

> **Interview tip:** "Explain the test pyramid" is a common question. A strong answer names the three levels, says why the base is wide (speed, cheap, pinpoint failures), and adds a nuance: some teams write more integration tests (a shape sometimes called the "testing trophy") because wiring mistakes are the bugs that hurt most, and what counts as a "unit" differs between teams. Showing that you know the trade-off beats reciting the shape.

## 2. Your first test with `node:test`

Node has a test runner built in: the module `node:test`. It was added in Node 18 as experimental and is marked stable since Node 20.0.0. You need no install.

From `examples/01-first-tests.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cartTotal } = require('./_lib/cart.js');

test('cartTotal adds up every line', () => {
  const items = [
    { name: 'pen', priceCents: 150, qty: 2 },
    { name: 'book', priceCents: 1200, qty: 1 },
  ];

  const total = cartTotal(items);

  assert.equal(total, 1500);
});
```

Run the whole example file:

```bash
node --test lessons/16-testing/examples/01-first-tests.test.js
```

```text
✔ cartTotal adds up every line (2.3153ms)
▶ applyDiscount
  ✔ takes a percentage off (0.5362ms)
  ✔ rounds to a whole cent (0.2766ms)
  ✔ rejects a percent outside 0 to 100 (2.9615ms)
✔ applyDiscount (4.53ms)
▶ assertion tour
  ✔ equal is strict: no type conversion (0.4559ms)
  ✔ deepEqual compares content, not identity (1.2874ms)
  ✔ ok, match and a custom message (0.768ms)
  ✔ floats are not exact, so use cents or a tolerance (0.3839ms)
✔ assertion tour (3.4876ms)
▶ formatMoney
  ✔ 0 cents is $0.00 (0.3714ms)
  ✔ 5 cents is $0.05 (0.3588ms)
  ✔ 1999 cents is $19.99 (0.1483ms)
✔ formatMoney (2.0127ms)
▶ loadPrice (async)
  ✔ resolves with the price (13.1721ms)
  ✔ rejects for an unknown sku (1.8915ms)
✔ loadPrice (async) (15.5032ms)
ℹ tests 14
ℹ suites 3
ℹ pass 14
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 355.1536
```

How to read it:
- `test(name, fn)` registers a test. The test **passes** if `fn` finishes without throwing (or, for an async function, its promise resolves). It **fails** if `fn` throws or its promise rejects.
- `assert.equal(...)` throws an `AssertionError` when the check is false. That throw is what makes the test fail.
- `✔` passed, `✖` failed, `﹣` skipped, `⚠` a todo that threw. `▶` opens a group (a suite).
- The process exit code is `0` when everything passed and `1` when something failed. CI uses that code.
- `node --test` has used the `spec` reporter by default since Node 23, even when output is piped. Earlier versions printed TAP when piped.

> **Common mistake:** a test with no assertion always passes. `test('x', () => { cartTotal(items); })` proves only that the function does not throw. Every test needs at least one check, and the check must be able to fail.

### The same test as an ES module

Everything in this lesson uses CommonJS (`require`). If your project uses `import` (a `.mjs` file, or `"type": "module"` in `package.json`), only the first two lines change. `test` is the default export of `node:test`, and the named exports (`describe`, `it`, `before`, `mock` and so on) work the same:

```js
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';

test('adds', () => {
  assert.equal(1 + 2, 3);
});

describe('math', () => {
  it('adds again', () => {
    assert.equal(2 + 3, 5);
  });
});
```

Saved as `math.test.mjs`, this runs with `node --test` and passes on Node 24.16 with no warning.

### Where do test files go?

Two layouts are common, and `node --test` finds both:
- **Next to the code:** `src/cart.js` and `src/cart.test.js`. Easy to find, and they move together.
- **In a `test/` folder:** `src/cart.js` and `test/cart.test.js`. Keeps `src/` clean.

Pick one and stay consistent. Name the test file after the module it tests.

### How `node --test` finds files

With no arguments, `node --test` searches the current folder and all sub-folders (skipping `node_modules`) for these names:

| Pattern | Example |
|---|---|
| `*.test.js` (also `.mjs`, `.cjs`) | `cart.test.js` |
| `*-test.js`, `*_test.js` | `cart-test.js` |
| `test-*.js` | `test-cart.js` |
| `test.js` | `test.js` |
| any file inside a folder named `test` | `test/cart.js` |

The same patterns work for `.ts`, `.mts` and `.cts` files on Node 24, because Node strips types by default. `examples/03-run-flags.js` builds a folder with many file names and runs `node --test` inside it. This is its real output:

```text
=== 1. File discovery (a temp folder with many file names) ===
$ node --test        (run inside the temp folder)
  ran:         a.test.js  d-test.js  deep/er/i.test.mjs  deep/er/j.test.cjs  e_test.js  k.test.ts  test-c.js  test.js  test/f.js
  NOT ran:     b.spec.js  g.js  node_modules/pkg/h.test.js
```

Notice `b.spec.js` did **not** run. Jest finds `.spec.js` files by default, so many people expect it. With `node:test` you must pass the glob yourself.

To run specific files, give file paths or **globs** (patterns like `*.test.js`). Put globs in quotes so that Node, not your shell, expands them. This works the same in bash and PowerShell:

```bash
node --test "lessons/16-testing/examples/*.test.js"
```

> **Common mistake:** `node --test some-folder` does not work on Node 24. The arguments are file paths or globs, not folders, and a folder name fails with an error. Use a glob such as `"some-folder/**/*.test.js"`. Also note that a glob that matches no file is not an error: the run prints `tests 0` and exits with code `0`, so a typo in a CI script can go unnoticed.

> **Under the hood:** by default each test file runs in its own child process (a separate copy of Node, `--test-isolation=process`), and several files run at the same time. That is why one file cannot break another by changing a global. Section 7 proves it by printing the process ids. A test file is also a normal script, so `node cart.test.js` works and prints the same report, but you lose the file discovery and the parallel runs.

> **Interview tip:** "Does Node have a built-in test runner?" Strong short answer: "Yes, `node:test`, stable since Node 20. I run it with `node --test`. It finds test files by name, runs each file in its own process, and has `describe`/`it`, hooks, mocks, fake timers, snapshots, watch mode and reporters. Coverage and module mocking are still experimental, so for those I would check the current docs." Naming what is still experimental shows you know the tool, not just the headline.

## 3. `node:assert/strict` and good failure messages

`node:assert` has two modes. Always import the strict one:

```js
const assert = require('node:assert/strict');
```

| In `node:assert/strict` | It is really | What it checks |
|---|---|---|
| `assert.equal(a, b)` | `strictEqual` (uses `Object.is`) | same value and type |
| `assert.deepEqual(a, b)` | `deepStrictEqual` | same content, same types, same prototypes |
| `assert.partialDeepStrictEqual(a, b)` | | `a` has at least the properties of `b` (extra properties in `a` are ignored). Handy when an object also holds an id or timestamp you cannot predict. Stable since Node 24 |
| `assert.notEqual`, `assert.notDeepEqual` | | the opposite |
| `assert.ok(value)` | | value is truthy |
| `assert.throws(fn, expected)` | | `fn()` throws; `expected` is a class, regex, object or function |
| `assert.rejects(promiseOrFn, expected)` | | the promise rejects (you must `await` it) |
| `assert.doesNotThrow`, `assert.doesNotReject` | | no error |
| `assert.match(string, regex)`, `assert.doesNotMatch` | | string matches the pattern |
| `assert.fail(message)` | | always fails |

Differences you should know (all checked on Node 24.16):
- Loose `node:assert`: `assert.equal(1, '1')` passes (it uses `==`), and `assert.deepEqual([1], ['1'])` passes. Strict mode fails both. Strict is what you want.
- `assert.equal(NaN, NaN)` passes in strict mode (it uses `Object.is`), but `assert.equal(0, -0)` fails.
- `assert.deepEqual(new Point(1), { x: 1 })` fails when `Point` is a class, because prototypes are compared. Arrays are ordered: `[1, 2]` and `[2, 1]` are different. `Set` and `Map` are compared by content.
- Floats: `0.1 + 0.2` is not `0.3`. Keep money in whole cents (as `_lib/cart.js` does) or compare with a tolerance: `Math.abs(a - b) < 1e-9`.
- Pass a function to `throws`, not a call: `assert.throws(() => applyDiscount(1000, 150), RangeError)`. If you write `assert.throws(applyDiscount(1000, 150))`, the function runs before `assert.throws` can watch it. Either it throws on its own and the test fails with that error, or it returns a value and `assert.throws` complains that its first argument is not a function. Both messages are confusing.
- Older tutorials count calls with `assert.CallTracker`. It still exists on Node 24 but was removed in Node 25.0.0. Use `mock.fn()` (section 8).

### What a failure looks like

`examples/_fixtures/failing-suite.js` fails on purpose. This is its output (stack trace lines and a few detail lines were removed):

```text
✔ this one passes (Nms)
✖ this one fails on a number (Nms)
✖ this one fails on an object (Nms)
ℹ tests 3
ℹ pass 1
ℹ fail 2

✖ failing tests:

test at lessons/16-testing/examples/_fixtures/failing-suite.js:12:1
✖ this one fails on a number (Nms)
  AssertionError [ERR_ASSERTION]: two plus two should be four

  4 !== 5

test at lessons/16-testing/examples/_fixtures/failing-suite.js:16:1
✖ this one fails on an object (Nms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected

    {
      name: 'pen',
      tags: [
        'a',
  +     'b'
  -     'c'
      ]
    }
```

The custom message you pass as the last argument (`'two plus two should be four'`) comes first, and the diff still follows. The object diff points to the exact element that differs.

Rules for good messages:
1. Prefer the specific assertion. `assert.equal(res.status, 200)` reports `404 !== 200`. `assert.ok(res.status === 200)` only reports `The expression evaluated to a falsy value` plus the source line, without the values.
2. Put the story in the **test name**: `'rejects a percent outside 0 to 100'`, not `'test 3'`. The name is the first thing you read when it fails.
3. Add the third argument only when the values alone do not explain the failure, for example `assert.ok(list.length > 0, 'the search should return at least one result')`.

> **Interview tip:** "What is the difference between `assert.equal` and `assert.deepEqual`?" A strong answer: `equal` compares two single values (strict mode uses `Object.is`), so two different objects with the same content fail. `deepEqual` walks into objects and arrays and compares the content, and in strict mode it also compares types and prototypes. Then add that you import `node:assert/strict` because the loose mode uses `==` and lets wrong values pass, and that you check errors with `throws` or `rejects` and a specific matcher.

## 4. Structure: Arrange, Act, Assert, `describe`, `it` and subtests

Write every test in three steps. This is the **AAA** pattern:

```js
test('cartTotal adds up every line', () => {
  // Arrange: build the input
  const items = [{ name: 'pen', priceCents: 150, qty: 2 }, { name: 'book', priceCents: 1200, qty: 1 }];

  // Act: call the code under test (usually ONE call)
  const total = cartTotal(items);

  // Assert: check the result
  assert.equal(total, 1500);
});
```

If the Act part needs five calls, or the Assert part checks ten unrelated things, the test is doing too much. One test, one behaviour.

**`describe` and `it`** are another way to write the same thing. `describe(name, fn)` makes a group and `it(name, fn)` is the same function as `test` (it reads like a sentence: "describe applyDiscount, it takes a percentage off"):

```js
describe('applyDiscount', () => {
  it('takes a percentage off', () => {
    assert.equal(applyDiscount(10000, 10), 9000);
  });

  it('rejects a percent outside 0 to 100', () => {
    assert.throws(() => applyDiscount(1000, 150), RangeError);
  });
});
```

**Subtests** use the `t` argument that every test receives. `t` is the **test context**: an object with helpers for this one test (`t.test`, `t.after`, `t.mock`, `t.skip`, `t.plan` and more, all used later in this lesson). A subtest is a test inside a test. Subtests are good for a table of cases:

```js
test('formatMoney', async (t) => {
  const table = [[0, '$0.00'], [5, '$0.05'], [1999, '$19.99']];
  for (const [cents, expected] of table) {
    await t.test(`${cents} cents is ${expected}`, () => {
      assert.equal(formatMoney(cents), expected);
    });
  }
});
```

Since Node 24 the runner waits for subtests automatically. On Node 22 a subtest that you do not `await` can be cancelled when its parent test ends, so always write `await` (it is harmless on Node 24 and keeps your tests working on both lines). A plain `for` loop that calls `it(...)` once per row works too and is what `examples/10-tdd-duration.test.js` does.

> **Remember:** test names should read like documentation: `it('answers 405 and an Allow header for other methods')`. When someone sees only the list of names, they should understand the behaviour of the module.

> **Interview tip:** "What makes a good unit test?" Strong short answer: it checks one behaviour, follows Arrange-Act-Assert, has a name that says what happens and when, starts from fresh state so it does not depend on other tests, runs in milliseconds, and fails for exactly one reason. Add that you test behaviour (inputs and outputs) and not the private steps inside, so a refactor does not break the tests.

## 5. Async tests, and the forgotten `await`

A test function can be `async`, or it can return a promise. The runner waits for it:

```js
it('rejects for an unknown sku', async () => {
  await assert.rejects(loadPrice('car'), { message: 'unknown sku: car' });
});
```

Three ways to write async tests: an `async` function with `await`, or return the promise (both are in `examples/07-async-events-streams.test.js`), or (old style) take a `done` callback: `test('x', (t, done) => { ...; done(); })` (the last test of `examples/02-hooks-and-modes.test.js`).

The classic bug is a promise that nobody waits for. `examples/_fixtures/forgot-await-suite.js` does this:

```js
test('forgot to await assert.rejects', () => {
  assert.rejects(failsLater(), /something else/); // no await, no return
});
```

The test function returns right away, so the test is marked as passed before the check runs. Real output (the final `failing tests` section was removed):

```text
✔ forgot to await assert.rejects (Nms)
✔ a later test keeps the process alive for a moment (Nms)
ℹ Error: Test "forgot to await assert.rejects" at lessons/16-testing/examples/_fixtures/forgot-await-suite.js:12:1 generated asynchronous activity after the test ended. This activity created the error "AssertionError [ERR_ASSERTION]: The input did not match the regular expression /something else/. Input:

'Error: late failure'
" and would have caused the test to fail, but instead triggered an unhandledRejection event.
✖ lessons/16-testing/examples/_fixtures/forgot-await-suite.js (Nms)
ℹ tests 3
ℹ pass 2
ℹ fail 1
```

Look closely: both tests show `✔`. The runner noticed the late failure, but it blames the whole **file** (`✖ ...forgot-await-suite.js`), not the test that caused it. It only noticed because a pending timer kept the process alive until the failure arrived. Do not rely on that: with other tools, or with nothing left running, the broken test simply stays green. Rule: every `assert.rejects`, every `fetch` and every promise in a test gets an `await` (or a `return`).

> **Common mistake:** testing a rejection with `try/catch`:
> ```js
> try {
>   await mightFail();
>   assert.fail('should have thrown'); // this throw is caught by the catch below
> } catch (error) {
>   assert.ok(error instanceof Error); // passes even for the AssertionError
> }
> ```
> Use `await assert.rejects(mightFail(), { message: '...' })`. It cannot be fooled this way.

**Timeouts.** By default a test may run forever (`Infinity`), so one hung test hangs the whole run. Give slow things a limit with the `timeout` option on one test (milliseconds), or with the `--test-timeout` flag for every test (section 7):

```js
it('loads the page in time', { timeout: 1000 }, async () => {
  await loadPage();
});
```

A test that takes too long fails with a message like `test timed out after 1000ms`. On Node 24.16 the summary counts it as **cancelled** (not as `fail`), and the run still exits with code `1`. Section 7 shows the real output.

> **Interview tip:** "How do you test a function that returns a promise?" Strong short answer: make the test `async`, `await` the call and assert on the result, and for the failure case write `await assert.rejects(call, matcher)`. Then show that you know the trap: a promise that is neither awaited nor returned lets the test finish and pass before the check even runs.

## 6. Hooks, `skip`, `todo`, `only` and options

`examples/02-hooks-and-modes.test.js` covers this section.

**Hooks** are functions the runner calls for you around your tests:

| Hook | When it runs |
|---|---|
| `before(fn)` | once, before the first test of the suite |
| `after(fn)` | once, after the last test (it also runs when a test failed) |
| `beforeEach(fn)` | before every test |
| `afterEach(fn)` | after every test |

Use `beforeEach` to create **fresh** state, so tests cannot affect each other. Use `after`/`afterEach` for cleanup. A hook outside any `describe` applies to the whole file. This example records the order:

```js
describe('hooks', () => {
  const order = [];
  let cart;

  before(() => order.push('before'));
  after(() => {
    order.push('after');
    console.log('hook order:', order.join(' > '));
  });
  beforeEach(() => {
    cart = []; // a fresh cart for EVERY test
    order.push('beforeEach');
  });
  afterEach(() => order.push('afterEach'));

  it('test A starts with an empty cart', () => { order.push('test A'); cart.push('pen'); assert.equal(cart.length, 1); });
  it('test B also starts with an empty cart', () => { order.push('test B'); assert.equal(cart.length, 0); });
});
```

```text
hook order: before > beforeEach > test A > afterEach > beforeEach > test B > afterEach > after
```

With nested `describe` blocks, the outer `beforeEach` runs first, then the inner one. The `t` object has its own hooks too: `t.after(fn)` runs cleanup for **this one test** (we use it for servers and temp folders in sections 12 and 13), and `t.beforeEach`/`t.afterEach` apply to its subtests.

**Skip, todo, only:**

| Option | Effect |
|---|---|
| `{ skip: 'reason' }` or `{ skip: true }` | the test does not run; shown as `﹣` with the reason |
| `{ todo: 'reason' }` | the test runs, but a failure does **not** fail the run (use it for known bugs) |
| `it.todo('name')` | a reminder with no function |
| `it.skip(...)`, `test.skip(...)`, `it.only(...)`, `test.only(...)` | shorthands for the options above |
| `t.skip('reason')` inside a test | marks it skipped, but your code keeps running, so `return` right after |
| `{ only: true }` | focus: run only this test (needs `--test-only`) |

From the 02 example:

```text
▶ skip and todo
  ✔ runs normally (0.9621ms)
  ﹣ is skipped, with a reason (0.2273ms) # needs a real database
  ✔ is skipped only on some platforms (0.4176ms)
  ⚠ is a todo: it runs, but a failure does not fail the run (2.2681ms) # bug 123
  ✔ write a test for refunds (0.2398ms) # TODO
  ✔ can skip itself from inside (0.2777ms)
✔ skip and todo (5.7893ms)
```

A failing `todo` test still prints its error details at the end of the report, but the exit code stays `0`.

`only` is where people get surprised. `examples/_fixtures/only-suite.js` marks the middle test with `only: true`. Without the flag, everything runs and Node tells you why:

```text
$ node --test lessons/16-testing/examples/_fixtures/only-suite.js
  ✔ one (Nms)
  ✔ two (focused) (Nms)
  ℹ 'only' and 'runOnly' require the --test-only command-line option.
  ✔ three (Nms)
  ℹ tests 3
  ℹ pass 3
  ℹ fail 0
  (exit code 0)

$ node --test --test-only lessons/16-testing/examples/_fixtures/only-suite.js
  ✔ two (focused) (Nms)
  ℹ tests 1
  ℹ pass 1
  ℹ fail 0
  (exit code 0)
```

That is a safe design: a forgotten `only: true` in a commit does not silently disable the rest of your suite in CI, which does not pass `--test-only`.

Other context helpers used in the example: `t.plan(n)` (the test fails unless exactly `n` assertions run; use `t.assert`, not the imported `assert`, so it can count) and `t.diagnostic('note')` (adds a line to the report). One more, used in section 16: `t.waitFor(fn, { interval, timeout })` retries `fn` until it stops throwing (defaults: every 50 ms, give up after 1000 ms; added in Node 22.14 and 23.7).

> **Interview tip:** "What is the difference between `before` and `beforeEach`?" Strong short answer: `before` runs once for the whole group, `beforeEach` runs before every test. Use `before` for expensive read-only setup (starting a server you only read from) and `beforeEach` to rebuild any state that tests change, so tests stay independent. Add that cleanup belongs in `after`/`afterEach` or `t.after`, which also run when a test fails.

## 7. The command line: patterns, reporters, watch, concurrency, timeouts

`examples/03-run-flags.js` starts `node --test` many times with different flags and prints the results (durations are replaced by `Nms` so the output is stable, and some summary lines are left out to keep it short). Run it and read the whole output once:

```bash
node lessons/16-testing/examples/03-run-flags.js
```

| Flag | What it does |
|---|---|
| `--test-name-pattern=regex` | run only tests whose name matches (can be repeated) |
| `--test-skip-pattern=regex` | skip tests whose name matches (Node 22.1+) |
| `--test-only` | honour `only` options |
| `--test-timeout=ms` | default timeout for every test (default `Infinity`) |
| `--test-reporter=name` | `spec` (default), `dot`, `tap`, `junit`, `lcov`, or a path to your own reporter module |
| `--test-reporter-destination=path` | where a reporter writes: `stdout`, `stderr` or a file (one per reporter) |
| `--test-concurrency=n` | how many test **files** run at once (default `os.availableParallelism() - 1`; ignored with `--test-isolation=none`) |
| `--test-isolation=none` | run all files in one process instead of one process per file. Files then run one at a time (added in 22.8 as `--experimental-test-isolation`, renamed in 23.6) |
| `--test-shard=1/3` | run the first third of the files (split a suite over CI machines) |
| `--test-force-exit` | exit once all tests are done, even if something (an open server, a timer) would keep Node alive |
| `--test-rerun-failures=file` | remember results in `file` and run only the tests that failed last time (Node 24.7+) |
| `--watch` | rerun when a file changes |
| `--test-update-snapshots` | write snapshot files (section 15) |
| `--experimental-test-coverage` | print a coverage table (section 14) |
| `--test-randomize`, `--test-random-seed=n` | shuffle the order (Node 24.16+, early development; the seed is an integer from 0 to 4294967295; cannot be combined with `--watch`) |

**Name patterns** are regular expressions (text patterns, for example `slow|strings` means "slow or strings") matched against the test name (and its parents' names):

```text
$ node --test --test-name-pattern=adds lessons/16-testing/examples/_fixtures/sample-suite.js
  ✔ adds numbers (Nms)
  ✔ adds negative numbers (Nms)
  ℹ tests 2
  ℹ pass 2
  ℹ fail 0
  (exit code 0)

$ node --test --test-skip-pattern="slow|strings" lessons/16-testing/examples/_fixtures/sample-suite.js
  ✔ adds numbers (Nms)
  ✔ adds negative numbers (Nms)
  ﹣ skipped test (Nms) # not ready
  ✔ todo test (Nms) # fix later
  ℹ tests 4
  ℹ pass 2
  ℹ fail 0
  (exit code 0)
```

**Timeouts.** The fixture has a test that sleeps 300 ms. With `--test-timeout=100`:

```text
$ node --test --test-timeout=100 lessons/16-testing/examples/_fixtures/sample-suite.js
  ...
  ✖ slow test (Nms)
  ...
  ℹ tests 7
  ℹ pass 4
  ℹ fail 0
  ℹ cancelled 1

  ✖ failing tests:

  test at lessons/16-testing/examples/_fixtures/sample-suite.js:25:1
  ✖ slow test (Nms)
    'test timed out after 100ms'
  (exit code 1)
```

(Lines marked `...` were removed here to save space.) Note the count: `fail 0` and `cancelled 1`. A timeout is counted as "cancelled", but the exit code is still `1`.

**Reporters** print the same results in different formats:
- `spec` is for people (the default).
- `dot` is a compact progress bar: one character per test.
- `tap` ([Test Anything Protocol](https://testanything.org/), a plain-text format many tools read) is for machines.
- `junit` writes XML in the JUnit format, which CI dashboards understand.
- `lcov` writes coverage data in the lcov format, which coverage services read (it needs `--experimental-test-coverage`).

Here are `dot` and `tap` on small suites:

```text
$ node --test --test-reporter=dot lessons/16-testing/examples/_fixtures/failing-suite.js
  .XX
  (exit code 1)

$ node --test --test-reporter=tap --test-name-pattern=adds lessons/16-testing/examples/_fixtures/sample-suite.js
  TAP version 13
  # Subtest: adds numbers
  ok 1 - adds numbers
    ---
    duration_ms: N
    type: 'test'
    ...
  # Subtest: adds negative numbers
  ok 2 - adds negative numbers
    ---
    duration_ms: N
    type: 'test'
    ...
  1..2
  # tests 2
  # suites 0
  # pass 2
  # fail 0
  # cancelled 0
  # skipped 0
  # todo 0
  # duration_ms N
  (exit code 0)
```

You can use several reporters at once. Pair each `--test-reporter` with a `--test-reporter-destination`:

```bash
node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=test-results.xml
```

**Watch mode** (`node --test --watch`) reruns tests when a file the tests load changes, so you get feedback every time you save. This is real output from a run where `add.js` was broken on purpose and then fixed (shortened):

```text
✔ add (Nms)
ℹ tests 1
ℹ pass 1
ℹ fail 0

Restarted at 11/10/2026, 6:20:24 PM
✖ add (Nms)
ℹ tests 1
ℹ pass 0
ℹ fail 1
...
  -1 !== 3

Restarted at 11/10/2026, 6:20:26 PM
✔ add (Nms)
ℹ tests 1
ℹ pass 1
ℹ fail 0
```

**Concurrency has two levels.**

*Level 1: test files.* `--test-concurrency=n` sets how many test **files** run at the same time. Every file runs in its own process, so files cannot disturb each other's memory. `examples/13-test-concurrency.js` writes two test files that each sleep 300 ms, runs `node --test` once with `--test-concurrency=1` and once with `=2`, and collects the process id of each file:

```bash
node lessons/16-testing/examples/13-test-concurrency.js
```

```text
The default is os.availableParallelism() - 1, which is 11 on this machine.
Running 2 test files that each sleep 300 ms:

--test-concurrency=1: 2 tests passed in about 3.3 s, 2 different processes, exit ok: true
--test-concurrency=2: 2 tests passed in about 1.7 s, 2 different processes, exit ok: true
```

Read it like this: with 1, the files run one after another, so the time is roughly double. With 2, they overlap. Most of each time is the start-up of a new Node process, not the 300 ms sleep. In both runs the two files had two different process ids, which is the proof of "one process per file". The seconds (and the `11`) differ on every machine. If your test files share something that cannot be shared (one database, one fixed port), `--test-concurrency=1` is a quick stopgap, but the real fix is to stop sharing (section 16). With `--test-isolation=none` all files run in one process and this flag is ignored.

*Level 2: tests inside one file.* Tests run one after another unless you ask for more with the `concurrency` option on a `describe` or `test`. Three tests that each sleep 100 ms, first in a normal group and then in a group with `{ concurrency: true }` (`examples/_fixtures/concurrency-suite.js`):

```js
const sleep100 = () => new Promise((resolve) => setTimeout(resolve, 100));

describe('sequential (default)', () => {
  it('first', sleep100);
  it('second', sleep100);
  it('third', sleep100);
});

describe('concurrent', { concurrency: true }, () => {
  it('first', sleep100);
  it('second', sleep100);
  it('third', sleep100);
});
```

```bash
node --test lessons/16-testing/examples/_fixtures/concurrency-suite.js
```

```text
▶ sequential (default)
  ✔ first (117.7625ms)
  ✔ second (113.2881ms)
  ✔ third (100.9852ms)
✔ sequential (default) (334.9654ms)
▶ concurrent
  ✔ first (117.779ms)
  ✔ second (120.2029ms)
  ✔ third (120.9041ms)
✔ concurrent (121.4719ms)
```

(Your numbers will differ, but the concurrent group takes about one sleep instead of three.) Only use `concurrency` on tests that do not share state.

> **Interview tip:** "How do you run one test, or a few?" Answer: `--test-name-pattern` for names, a file path for a file, `only` plus `--test-only` while debugging. "How do you stop a hanging test from hanging CI?" Answer: `--test-timeout` as a safety net. "Tests pass alone but fail when the whole suite runs. Why?" Answer: either two files run in parallel and share a port, a file or a database (run with `--test-concurrency=1` to confirm), or tests inside one file depend on each other's state (run with `--test-randomize` to confirm). Then remove the sharing.

## 8. Test doubles: stubs, spies, mocks and fakes

A **test double** is a stand-in for a real dependency, like a stunt double in a film. You use one when the real thing is slow (a database), random (a clock), has side effects (sending email) or is not available in a test.

| Name | What it does | In `examples/04-test-doubles.test.js` |
|---|---|---|
| Dummy | fills a parameter, is never used | `createUserService({ db: {}, mailer: {} })` |
| Stub | returns canned answers, you do not check it | `mailer = { send: async () => {} }` |
| Spy | records how it was called; you check afterwards | `mock.fn()` then `callCount()` and `calls[0].arguments` |
| Mock | has pre-set expectations that it verifies itself. Many JS libraries (and people) say "mock" for any of the above | `mock.fn(...)` is called a mock in `node:test` |
| Fake | a real but simplified implementation | a database that is a `Map` in memory |

The code under test, `_lib/user-service.js`, takes everything it needs as arguments (`db`, `mailer`, `now`, `makeId`, `logger`). Here a stub, a spy and a fake work together:

```js
it('sends one welcome email (spy)', async () => {
  const send = mock.fn(async () => {}); // a spy: records every call
  const service = createUserService({ db: createFakeDb(), mailer: { send } });

  await service.register('ann@example.com');

  assert.equal(send.mock.callCount(), 1);
  assert.deepEqual(send.mock.calls[0].arguments, ['ann@example.com', 'Welcome!']);
});

it('still registers when the mailer fails (stub that throws, spy on the logger)', async () => {
  const mailer = { send: mock.fn(async () => { throw new Error('smtp down'); }) };
  const logger = { warn: mock.fn() };
  const service = createUserService({ db: createFakeDb(), mailer, logger });

  const user = await service.register('ann@example.com');

  assert.equal(user.email, 'ann@example.com');
  assert.equal(logger.warn.mock.callCount(), 1);
  assert.match(logger.warn.mock.calls[0].arguments[0], /smtp down/);
});
```

**What `mock.fn()` records.** `fn.mock.callCount()`, and `fn.mock.calls`, an array with one entry per call. Each entry has `arguments`, `result`, `error`, `this`, `stack` and `target`. Other helpers: `fn.mock.mockImplementation(f)`, `fn.mock.mockImplementationOnce(f, callNumber)` (change behaviour for one call; `callNumber` starts at 0), `fn.mock.resetCalls()` and `fn.mock.restore()`.

**`mock.method(object, 'name', replacement?)`** replaces a method on an existing object. With no replacement it wraps the real method and still calls it (a pure spy). With a replacement it is a stub:

```js
it('replaces a method for the length of the test (a stub)', (t) => {
  t.mock.method(Math, 'random', () => 0.5);
  assert.equal(Math.random(), 0.5);
});

it('has the original method back, because t.mock restores after each test', () => {
  assert.equal(Math.random, originalRandom);
});
```

**Restoring is the part people forget.** Use `t.mock` (from the test's `t` argument) and everything is restored automatically when that test ends. If you use the module-level `mock` from `node:test`, you must undo it yourself with `stub.mock.restore()`, `mock.restoreAll()` or `mock.reset()`. A stub that leaks into the next test is a classic source of flaky tests (section 16). There are also `mock.getter`, `mock.setter` and `mock.property` for accessors and plain properties.

> **Remember:** `mock.method(obj, 'name', ...)` swaps the property on that one object. Code that already copied the function keeps the real one. Checked on Node 24.16 with `node:fs/promises`: a module that calls `fsp.readFile(...)` through the module object is mocked, but a module that wrote `const { readFile } = require('node:fs/promises')` (or `import { readFile } from 'node:fs/promises'`) is not, because it copied the function when it loaded. A default import used as `fsp.readFile(...)` is mocked. That is why `_lib/config-loader.js` calls `fs.readFile(...)` through the module object.

**Mocking whole modules (experimental).** `mock.module()` replaces what `require`/`import` returns. It does not exist unless you pass `--experimental-test-module-mocks`, it prints an `ExperimentalWarning`, and the docs mark it Early development. Verified on Node 24.16 with three small files:

```js
// mailer.js
exports.send = async (to) => { throw new Error('real mailer must not run in tests: ' + to); };
// notify.js
const mailer = require('./mailer.js');
exports.notify = async (user) => mailer.send(user.email);
// mm.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
test('mock.module for a CommonJS file', async (t) => {
  const send = t.mock.fn(async () => 'sent');
  t.mock.module('./mailer.js', { exports: { send } });
  const { notify } = require('./notify.js'); // load the code AFTER the mock exists
  assert.equal(await notify({ email: 'a@b.c' }), 'sent');
  assert.equal(send.mock.callCount(), 1);
});
```

```bash
node --test --experimental-test-module-mocks mm.test.js
```

The option for the fake exports is `exports` (the older name `namedExports` prints a `DeprecationWarning` on 24.16). Prefer plain dependency injection (section 10) and keep `mock.module` as the last resort.

> **Common mistake:** over-mocking. If you mock every neighbour of a function, the test only proves that your mock behaves like your mock. Stub the slow or random **edges** (network, clock, disk), use a **fake** for stateful things (an in-memory database), and assert on results (`what` happened), not on every internal call (`how` it happened). Tests that check the internal calls break whenever you refactor.

> **Interview tip:** "What is the difference between a mock, a stub and a spy?" Strong short answer: "A stub gives canned answers so the code under test can run. A spy records how it was called so I can check afterwards. A mock is a spy with expectations built in. A fake is a small working version, like an in-memory database. In `node:test`, `mock.fn` can be a stub and a spy. I prefer fakes for state and I assert on results more than on calls." Many people use the word "mock" for all of them, so say which one you mean.

## 9. Fake time with `mock.timers`

A test that waits for a real `setTimeout` is slow, and tests that sleep and hope are flaky. `t.mock.timers` fakes the timers so a test can jump forward in time instantly. It was added in Node 20.4 (and 18.19) and is stable since Node 23.1.

```js
t.mock.timers.enable({ apis: ['setTimeout'] });  // choose what to fake
t.mock.timers.tick(300);                         // move the fake clock forward 300 ms
```

`apis` can include `'setTimeout'`, `'setInterval'`, `'setImmediate'` and `'Date'`. The option `now` sets the starting fake time (a number or a `Date`). Other helpers: `runAll()` (jump to the last pending timer), `setTime(ms)` (set the fake `Date` only), `reset()`. With `t.mock` the timers are restored automatically at the end of the test. Calling `tick()` before `enable()` throws `ERR_INVALID_STATE`.

Test a **debounce** (call a function only after 300 ms of quiet) in zero real time:

```js
it('calls the function once, after the quiet period', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fn = t.mock.fn();
  const search = debounce(fn, 300);

  search('a');
  t.mock.timers.tick(200); // the user types again after 200 ms
  search('ab');
  t.mock.timers.tick(299); // 299 ms after the last call: not yet
  assert.equal(fn.mock.callCount(), 0);

  t.mock.timers.tick(1);   // exactly 300 ms
  assert.equal(fn.mock.callCount(), 1);
  assert.deepEqual(fn.mock.calls[0].arguments, ['ab']);
});
```

Fake `Date` the same way. This cache entry lives for 5 seconds:

```js
it('forgets an entry once its time to live has passed', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const cache = createTtlCache(5000);

  cache.set('token', 'abc');
  t.mock.timers.tick(4999);
  assert.equal(cache.get('token'), 'abc');

  t.mock.timers.tick(1);
  assert.equal(cache.get('token'), undefined);
});
```

**The gotcha with promises.** `tick()` runs timer callbacks right away, but code that is waiting on a promise only continues after a turn of the event loop. When you test an `async` function that sleeps (like `retry`, which waits 100 ms, then 200 ms), let the real loop turn between ticks with a helper that uses the real `setImmediate`:

```js
const flush = () => new Promise((resolve) => setImmediate(resolve));

const result = retry(task, { retries: 3, delayMs: 100 });
await flush();
assert.equal(task.mock.callCount(), 1); // first try failed, now "sleeping" 100 ms
t.mock.timers.tick(100);
await flush();
assert.equal(task.mock.callCount(), 2);
```

Also: when you assert that a promise rejects while time is mocked, create the assertion first (`const check = assert.rejects(...)`), then `tick()`, then `await check`. Otherwise the rejection happens with no handler attached. The full file is `examples/05-mock-timers.test.js`.

> **Remember:** the mock replaces the functions on the global object and on the `node:timers/promises` module object. Code that saved a reference **before** you enabled the mock keeps the real function. Checked on Node 24.16: `const { setTimeout: wait } = require('node:timers/promises')` at the top of a file is **not** mocked, and neither is `const saved = setTimeout`. A call to the global `setTimeout(...)`, or to `require('node:timers/promises').setTimeout(...)` at call time, **is** mocked. `_lib/timing.js` uses the global `setTimeout` and `Date.now()` for this reason. It is the same rule as in section 8: a copy made earlier is not affected.

> **Interview tip:** "How do you test a debounce, a retry or a cache expiry without waiting?" Strong short answer: fake the clock (`mock.timers`), move time forward with `tick`, and assert at the boundary (299 ms: nothing, 300 ms: called). The test takes microseconds and cannot flake. Then mention the gotcha: promises need one turn of the real event loop between ticks.

## 10. Making code testable

Hard-to-test code is usually badly shaped code. Four habits fix most of it.

1. **Pure functions.** A pure function gives the same output for the same input and touches nothing else. It needs no setup and no cleanup. Put your real logic in pure functions.
2. **Dependency injection (DI).** "Pass things in, do not reach out." If a function needs the time, a random id, a database or a logger, take it as an argument (with a normal default), so a test can pass a fake.
3. **Small modules, thin edges.** Keep the decisions in small pure modules and keep the I/O (files, network, `console`) in a thin layer around them.
4. **No work at import time.** Do not call `server.listen()`, connect to a database or start timers when a module is loaded. Export a function or a factory (`createTodoServer()`), so the test chooses when and where.

Here is the same report function twice. The first version (`_lib/report-hard.js`) reads the clock, rolls a random number and prints, all inside one function:

```js
function dailyReport(orders) {
  const date = new Date().toISOString().slice(0, 10);   // changes every day
  const id = Math.random().toString(36).slice(2, 8);    // changes every call
  let total = 0;
  for (const order of orders) total += order.cents;
  console.log(`report ${id} for ${date}: ${total} cents`); // output you cannot capture
  return { id, date, count: orders.length, total };
}
```

To test it you must fake three globals (`examples/06-testable-code.test.js` does exactly that and it works, but notice the effort):

```js
t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-03-04T12:00:00Z') });
t.mock.method(Math, 'random', () => 0.123456789);
const log = t.mock.method(console, 'log', () => {});
```

The second version (`_lib/report.js`) has the same behaviour but is shaped for testing:

```js
function summarize(orders) {                       // 1. pure logic
  return { count: orders.length, total: orders.reduce((sum, o) => sum + o.cents, 0) };
}

function dailyReport(orders, {                     // 2. edges are arguments with defaults
  now = () => new Date(),
  makeId = () => Math.random().toString(36).slice(2, 8),
  log = console.log,
} = {}) {
  const date = now().toISOString().slice(0, 10);
  const id = makeId();
  const summary = summarize(orders);
  log(`report ${id} for ${date}: ${summary.total} cents`);
  return { id, date, ...summary };
}
```

```js
it('uses the clock, id generator and logger it is given', (t) => {
  const log = t.mock.fn();
  const report = easy.dailyReport(orders, { now: () => new Date('2030-03-04T12:00:00Z'), makeId: () => 'abc123', log });
  assert.deepEqual(report, { id: 'abc123', date: '2030-03-04', count: 2, total: 750 });
  assert.deepEqual(log.mock.calls[0].arguments, ['report abc123 for 2030-03-04: 750 cents']);
});
```

Production code still calls `dailyReport(orders)` and gets the real clock. The tests need no global mocking, and the pure `summarize` needs no setup at all.

Smaller rules:
- Avoid module-level mutable state (`let cache = {}` at the top of a file). It survives from one test to the next. Export a factory such as `createCache()` instead.
- Do not export a private function only so a test can call it. Test through the public function. If a private function is complicated enough to deserve its own tests, it probably deserves its own module.
- Environment variables are global state too. Best: take them as an argument with a default (`function readPort(env = process.env)`), and pass `{ APP_PORT: '8080' }` in the test. If you must change the real `process.env`, save the old value and restore it in `t.after()` (delete the key if it was not set before). Do not use `t.mock.property(process.env, 'APP_PORT', ...)` for a variable that is not set yet: it throws `ERR_INVALID_ARG_VALUE` because the property does not exist.

Real test output for this example:

```text
▶ hard version: global clock, global random, global console
  ✔ can only be tested by faking three globals (11.8436ms)
✔ hard version: global clock, global random, global console (14.9522ms)
▶ easy version, part 1: the pure function
  ✔ adds up the orders (2.7191ms)
  ✔ handles an empty list (0.832ms)
  ✔ does not change its input (0.7417ms)
✔ easy version, part 1: the pure function (5.4331ms)
▶ easy version, part 2: injected edges
  ✔ uses the clock, id generator and logger it is given (2.7206ms)
  ✔ still works with the real defaults (check the shape, not the values) (1.557ms)
✔ easy version, part 2: injected edges (5.1755ms)
```

> **Interview tip:** "How would you make this function testable?" is a design question in disguise. Say: find what is non-deterministic or has side effects (time, randomness, network, disk, globals), pull it out as an argument or a small wrapper, keep the logic pure, and test the logic without mocks. Then mention the trade-off: DI adds a parameter, but it is far simpler than mocking modules.

## 11. Testing async code, event emitters, streams and error paths

`examples/07-async-events-streams.test.js` has 16 tests for all of this.

### Event emitters

`emit()` is synchronous, and a listener only hears events emitted **after** it is added. To wait for an event in a test, start listening first with `events.once`, then trigger the work:

```js
it('emits one item event per item, in order, then done', async () => {
  const processor = new BatchProcessor(async (n) => n * 2);
  const seen = [];
  processor.on('item', (item, result) => seen.push([item, result]));

  const done = once(processor, 'done');   // start listening BEFORE the work starts
  await processor.run([1, 2, 3]);
  const [summary] = await done;           // once() resolves with the ARRAY of event arguments

  assert.deepEqual(seen, [[1, 2], [2, 4], [3, 6]]);
  assert.deepEqual(summary, { ok: 3, failed: 0 });
});
```

If you start listening **too late**, `once` waits forever and the test hangs. Give it a signal so the test fails fast instead:

```js
await assert.rejects(once(processor, 'done', { signal: AbortSignal.timeout(20) }), { name: 'AbortError' });
```

The special `'error'` event needs a test of its own. With no listener, `emit('error', err)` **throws** the error. Both paths are tested: without a listener `run()` rejects, and with a listener the error is handed over.

### Streams

(Streams are explained in lesson 11. A **chunk** is one piece of data that arrives through a stream.) Use `pipeline` from `node:stream/promises` with `Readable.from(chunks)` as input and an async function as the last step to collect the output. The most valuable stream test feeds chunks that are cut at awkward places. `_lib/line-splitter.js` turns chunks into lines:

```js
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

it('joins a line that was cut in the middle by a chunk boundary', async () => {
  const chunks = ['he', 'llo\nwor', 'ld\n!'].map((text) => Buffer.from(text));
  assert.deepEqual(await splitLines(chunks), ['hello', 'world', '!']);
});

it('survives a multi-byte character split across two chunks', async () => {
  const bytes = Buffer.from('café\n'); // the letter e-acute is two bytes in UTF-8
  const chunks = [bytes.subarray(0, 4), bytes.subarray(4)]; // cut between those two bytes
  assert.deepEqual(await splitLines(chunks), ['café']);
});
```

Does the test really protect the code? Check it by breaking the code on purpose (this is a hand-made version of mutation testing, section 20). In a copy of the splitter, changing `decoder.write(chunk)` to `chunk.toString()` made the multi-byte test fail, and removing the "keep the leftover" line made four tests fail. **A test you have never seen fail is a test you cannot trust.**

### Error paths

Every `throw`, every rejected promise and every `emit('error')` in your code is a branch that deserves a test. Real code spends most of its bugs there. The pattern is always the same: arrange the bad input, then `assert.throws` / `assert.rejects` with a specific matcher (a class, a `code`, a message regex), never just "it threw something":

```js
it('error path: a line that is too long makes the pipeline reject', async () => {
  const chunks = [Buffer.from('x'.repeat(50))];
  await assert.rejects(splitLines(chunks, { maxLineLength: 10 }), { code: 'ERR_LINE_TOO_LONG' });
});
```

> **Interview tip:** "How do you test an EventEmitter or a stream?" Strong short answer: for an emitter, start listening (`events.once`, or a recording listener) before triggering the work, and test the `'error'` path separately because an unhandled `'error'` event throws. For a stream, feed it with `Readable.from(chunks)`, collect the output with `pipeline`, and use awkward chunk boundaries (a line or a multi-byte character cut in half). For both, test the failure path, not just the happy path.

## 12. Testing an HTTP server for real

You can test a server by mocking `req` and `res`, but it is simpler and more honest to start the real server and call it with the real `fetch`. That exercises routing, headers, status codes and body parsing exactly as a client sees them.

The recipe (from `examples/08-http-server.test.js`):

1. **Listen on port 0.** The operating system picks a free port, so tests never fight over port 3000.
2. **Wait for the `listening` event**, then read the port from `server.address().port`.
3. **Call it with `fetch`** using that port.
4. **Close the server** at the end of the test, with `t.after()`.

```js
async function startServer(t, todos = []) {
  const server = createTodoServer({ todos });   // the module returns the server, it does not listen
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  t.after(() => {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections(); // safety net: an unread big response would keep a socket busy
    return closed;
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const signal = () => AbortSignal.timeout(2000); // a hung server fails the test instead of hanging it
  return {
    baseUrl,
    get: (path) => fetch(baseUrl + path, { signal: signal() }),
    send: (method, path, body) =>
      fetch(baseUrl + path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
        signal: signal(),
      }),
  };
}

it('creates a todo, answers 201 and a Location header', async (t) => {
  const api = await startServer(t);

  const res = await api.send('POST', '/todos', { title: '  buy milk  ' });

  assert.equal(res.status, 201);
  assert.equal(res.headers.get('location'), '/todos/1');
  assert.deepEqual(await res.json(), { id: 1, title: 'buy milk', done: false });
});
```

Real output (shortened, the lines marked `...` were removed):

```text
▶ GET routes
  ✔ GET /health answers 200 with a JSON body (274.6278ms)
  ...
✔ GET routes (361.3581ms)
▶ POST /todos
  ✔ creates a todo, answers 201 and a Location header (48.541ms)
  ✔ the new todo can be read back (a small integration test) (45.3665ms)
  ...
✔ POST /todos (178.6103ms)
▶ test setup
  ✔ every test gets its own server on its own port (12.6125ms)
  ✔ a closed server refuses connections (38.6638ms)
✔ test setup (51.8498ms)
ℹ tests 11
```

Things that matter here:
- **A fresh server per test** (it costs a few milliseconds) means no shared state and no ordering problems.
- **Bind to `127.0.0.1`** and call `127.0.0.1`. The name `localhost` can resolve to `::1` (the IPv6 address of your own machine) before `127.0.0.1` (the IPv4 one). On this Windows machine `server.listen(0, 'localhost')` bound to `::1`. A server on one address and a client that only tries the other do not meet. Node 24's `fetch` tries both addresses and still connected when tested, but it took noticeably longer, and older Node versions and other HTTP clients may simply fail. Using the literal IP removes the question.
- **Always read or cancel the response body** (`await res.json()`, `await res.arrayBuffer()`, or `res.body.cancel()`). A **keep-alive** connection is one the client keeps open to reuse for its next request. Since Node 19, `server.close()` closes idle keep-alive connections, but it waits for busy ones. In a test on Node 24.16, a tiny response that nobody reads did not block `close()`, but an unread 8 MB streamed response did (still waiting after 1.5 seconds). `closeAllConnections()`, as in the helper above, is the safety net.
- **Give `fetch` a timeout** with `AbortSignal.timeout(2000)`. A hung server then fails the test instead of hanging the run.
- **`fetch` does not reject on HTTP errors.** A `404` is a normal resolved response with `res.ok === false`. It only rejects when it cannot connect, with a generic `TypeError: fetch failed`. The real reason is in `error.cause` (`error.cause.code === 'ECONNREFUSED'` for a closed port). The last test in the file checks this.
- Do not hard-code a port. The same recipe works for Express 5 (`const server = app.listen(0)`) and any other framework that gives you the server.

Tools that make this shorter (illustrative, not run here):

```js
// Needs: npm install --save-dev supertest
// supertest takes your app or http.Server. If it is not listening, supertest binds it to a free port for you.
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createTodoServer } = require('./_lib/todo-api.js');

test('GET /health', async () => {
  const res = await request(createTodoServer())
    .get('/health')
    .expect(200)
    .expect('Content-Type', /json/);
  assert.deepEqual(res.body, { status: 'ok' });
});
```

```js
// Needs: npm install fastify   (Fastify has this built in, so you may not need supertest at all)
const res = await app.inject({ method: 'GET', url: '/health' }); // no port is opened
assert.equal(res.statusCode, 200);
```

> **Interview tip:** "How do you test an Express or HTTP API?" Strong short answer: keep the business logic in plain functions and unit-test those. Then write a few integration tests that start the real app on port 0 and call it with `fetch` (or supertest), asserting status code, headers and body, with a fresh server per test closed in `t.after()`. Fake slow dependencies such as email, and use a real or throwaway database for a small number of tests, because fakes can lie about how SQL behaves.

## 13. Testing code that reads and writes files

You could replace `fs` with a mock, but a real folder is more realistic and almost as fast. Create a **new temp folder** for each test, and delete it afterwards. Never write into your project folder, and never to a fixed path such as `/tmp/test.json`: test files run in parallel and would overwrite each other.

```js
async function makeTempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true })); // runs even if the test fails
  return dir;
}

it('reads the file and fills in the defaults', async (t) => {
  const dir = await makeTempDir(t);
  const file = path.join(dir, 'app.json');
  await fs.writeFile(file, JSON.stringify({ port: 8080 }));

  assert.deepEqual(await loadConfig(file), { port: 8080, debug: false });
});
```

`fs.mkdtemp(prefix)` creates a uniquely named folder (the prefix plus random characters) inside the OS temp folder (`os.tmpdir()`). `fs.rm(dir, { recursive: true, force: true })` deletes it with everything inside.

Other good file tests in `examples/09-temp-dir.test.js`:
- **Missing file**: the loader returns the defaults when the error code is `ENOENT`.
- **Broken content**: invalid JSON gives a clear error message.
- **Wrong kind of file**: passing a folder gives `EISDIR`, and the loader rethrows it instead of hiding it.
- **Errors you cannot easily create**, like a permission error: fake just that one call with `t.mock.method(fs, 'readFile', ...)` and assert the code rethrows `EACCES`.
- **Proof of cleanup**: a hook at the top of the file runs `after` all tests and asserts that every folder it created is gone.

```text
▶ loadConfig()
  ✔ reads the file and fills in the defaults (35.9801ms)
  ✔ returns the defaults when the file does not exist (7.9816ms)
  ✔ does not hand out the shared DEFAULTS object (a copy is returned) (6.924ms)
  ✔ throws a clear error for broken JSON (18.2167ms)
  ✔ rethrows errors that are not "file not found" (a folder is not a file) (10.2843ms)
  ✔ rethrows a permission error (faked, because it is hard to create on purpose) (2.0964ms)
✔ loadConfig() (85.8881ms)
▶ saveConfig()
  ✔ creates missing folders and writes readable JSON (23.1184ms)
  ✔ round trip: what you save is what you load (17.6988ms)
✔ saveConfig() (41.8891ms)
ℹ tests 8
```

> **Common mistake:** leaving a stream or file handle open and then deleting its folder. Deleting a folder that still has an open file can fail on some systems. A quick check on Windows 11 with Node 24.16 did not reproduce it (`fs.rm` succeeded with a file still open), but closing first costs nothing and keeps the test portable. Also remember that Windows paths use backslashes: build paths with `path.join`, never by gluing strings with `/`.

> **Interview tip:** "How do you test code that touches the file system?" Strong short answer: create a fresh folder per test with `fs.mkdtemp` in `os.tmpdir()`, write the input files, call the code, assert on what it returned or wrote, and delete the folder in `t.after()` so cleanup runs even when the test fails. Never use a fixed path, because test files run in parallel. Fake only the errors you cannot create on demand, such as a permission error.

## 14. Code coverage

**Coverage** measures how much of your code ran while the tests ran. Node can report it using V8 (the JavaScript engine) with no extra tool:

```bash
node --test --experimental-test-coverage lessons/16-testing/examples/_fixtures/grade-suite.js
```

The fixture tests only some of `grade.js`. Real output (the test result lines were removed):

```text
ℹ start of coverage report
ℹ -------------------------------------------------------------------
ℹ file               | line % | branch % | funcs % | uncovered lines
ℹ -------------------------------------------------------------------
ℹ lessons            |        |          |         | 
ℹ  16-testing        |        |          |         | 
ℹ   examples         |        |          |         | 
ℹ    _fixtures       |        |          |         | 
ℹ     grade-suite.js | 100.00 |   100.00 |  100.00 | 
ℹ     grade.js       |  70.59 |    75.00 |   50.00 | 5-6 13-15
ℹ -------------------------------------------------------------------
ℹ all files          |  85.71 |    83.33 |   80.00 | 
ℹ -------------------------------------------------------------------
ℹ end of coverage report
```

| Column | Meaning |
|---|---|
| line % | lines that ran at least once |
| branch % | both sides of every `if`, `?:`, `&&`, `||` that ran |
| funcs % | functions that were called at least once |
| uncovered lines | the line numbers that never ran |

Lines 5-6 are the `throw new RangeError` (no test sends a bad score) and lines 13-15 are the whole `passed()` function (never called). Look at line 9, `if (score >= 70) return 'C';`: the line counts as covered because the `if` ran, but the `return 'C'` side never did. That is why **branch** coverage is stricter than line coverage (75% here).

**Thresholds** turn coverage into a rule. If a number is below the minimum, Node prints an error and exits with code `1`:

```text
$ node --test --experimental-test-coverage --test-coverage-lines=90 --test-coverage-functions=100 lessons/16-testing/examples/_fixtures/grade-suite.js
  ℹ Error: 85.71% line coverage does not meet threshold of 90%.
  ℹ Error: 80.00% function coverage does not meet threshold of 100%.
  (exit code 1)
```

The threshold flags are `--test-coverage-lines`, `--test-coverage-branches` and `--test-coverage-functions` (added in Node 22.8). They only work together with `--experimental-test-coverage`. Without it they are silently ignored and the exit code is `0`. Use `--test-coverage-include` and `--test-coverage-exclude` (globs, Node 22.5+) to choose which files appear. By default the report leaves out files that match the test-file patterns of section 2, Node's own modules and `node_modules`. (That is why `grade-suite.js` above is listed: its name does not match any pattern. A file called `grade.test.js` would be left out.) The `lcov` reporter produces data in the lcov format, which most coverage services read. Send it to a file with `--test-reporter=lcov --test-reporter-destination=lcov.info`.

**Ignoring code on purpose.** Some lines are not worth testing, for example a "this should never happen" branch. Special comments tell the report to skip them:

```js
/* node:coverage ignore next 3 */   // skip the next 3 lines (write just "ignore next" for 1 line)
if (b === 0) {
  throw new RangeError('b must not be 0');
}

/* node:coverage disable */         // skip everything until the matching "enable"
function debugDump() { /* ... */ }
/* node:coverage enable */
```

In a small test with these comments, the report for one file went from 58.33% line coverage to 100%. That shows the danger: every ignored line is a decision not to test it, so use the comments rarely and give a reason in the code review.

Status on Node 24.16: the coverage feature and all its flags are marked **1 - Experimental** in the docs. The flag names and the table layout could change in a later release, so do not parse the table text in scripts.

> **Interview tip:** "Does 100% coverage mean no bugs?" No. Coverage tells you which code **ran**, not whether anything was **checked**. A test that calls a function and asserts nothing gives full coverage and zero protection. Coverage is useful in one direction: a low number or a red uncovered line shows where you have no tests. Do not chase 100% as a goal. A sensible team rule is a threshold on lines and branches (for example 80%) that must not go down.

## 15. Snapshot testing

A **snapshot test** saves the output of your code in a file the first time, and on later runs compares the new output with the saved copy. It is useful when the expected value is big and tedious to write by hand (a rendered receipt, a JSON response, a generated config).

Status: added in Node 22.3.0 as experimental, and **no longer experimental since Node 23.4.0** (the Node 24 docs say so), so it is stable on Node 24. On the 22 line the docs of 22.13.0 still call it "early development" and the docs of 22.22.0 do not, so use a recent 22.x if you rely on it there. It lives on the test context as `t.assert.snapshot(value)`.

From `examples/11-snapshots.test.js`:

```js
it('receipt text (a raw string serializer keeps the .snapshot file readable)', (t) => {
  t.assert.snapshot(renderReceipt(order), { serializers: [(value) => value] });
});

it('API object (the default serializer writes JSON)', (t) => {
  t.assert.snapshot(toApiShape(order));
});
```

The first run has no saved copy to compare with, so it **fails** on purpose and tells you what to do (path and message shortened):

```text
✖ receipt text (a raw string serializer keeps the .snapshot file readable)
  Error [ERR_INVALID_STATE]: Invalid state: Cannot read snapshot file '<folder>/11-snapshots.test.js.snapshot.' [the rest of the message tells you to rerun with the --test-update-snapshots flag]
```

So you create the file once:

```bash
node --test --test-update-snapshots lessons/16-testing/examples/11-snapshots.test.js
```

That writes `11-snapshots.test.js.snapshot` next to the test (this file is already in the repo, so the example passes right away). Open it (the real file has a third entry, `empty order`, which is left out here):

```text
exports[`snapshots > API object (the default serializer writes JSON) 1`] = `
{
  "id": 7,
  "itemCount": 2,
  "totalCents": 1500,
  "items": [
    {
      "name": "pen",
      "qty": 2,
      "lineCents": 300
    },
    {
      "name": "book",
      "qty": 1,
      "lineCents": 1200
    }
  ]
}
`;

exports[`snapshots > receipt text (a raw string serializer keeps the .snapshot file readable) 1`] = `
Receipt #7
------------------------
pen x2             $3.00
book x1           $12.00
------------------------
Total             $15.00
`;
```

Each saved value is stored under the test's full name plus a counter. A **serializer** turns a value into text for the file. The default one writes JSON (so a string is quoted, with `\n` escapes). A custom serializer such as `(value) => value` stores a string as it is, which is much easier to read in a review.

When the output changes, the test fails with a diff. Here the receipt code was changed (in a copy) to print one column wider:

```text
✖ receipt text (a raw string serializer keeps the .snapshot file readable) (12.7644ms)
...
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

    '\n' +
      'Receipt #7\n' +
      '------------------------\n' +
  +   'pen x2              $3.00\n' +
  +   'book x1            $12.00\n' +
  -   'pen x2             $3.00\n' +
  -   'book x1           $12.00\n' +
      '------------------------\n' +
  +   'Total              $15.00\n'
  -   'Total             $15.00\n'
```

If the change is intended, run again with `--test-update-snapshots` and review the diff of the `.snapshot` file like any other code change. There is also `t.assert.fileSnapshot(value, path)` (Node 22.14 and 23.7) that keeps each value in its own file.

Rules for snapshots:
- **Commit the `.snapshot` files** with your code, and read them in code review.
- **Never update blindly.** "Update all" turns a failing test into a passing test without anyone checking. That is how snapshot suites become useless.
- **Keep snapshots small and stable.** Do not snapshot timestamps, random ids, absolute paths or huge objects. Either remove those fields first or use a plain assertion.
- **Renaming a test** changes its snapshot key, so the old entry is orphaned and a new one is needed.
- For a small, important value, a plain `assert.equal(totalCents, 1500)` says what you mean. A snapshot says "this is whatever it was".

> **Interview tip:** "When would you use snapshot tests, and what is the risk?" Strong short answer: for large, structured output that is tedious to write by hand (a rendered report, a generated config, an API response shape), where I want to be told about any change. The risk is that people press "update" without reading the diff, so the test stops protecting anything. So I keep snapshots small, remove unstable fields such as ids and timestamps, commit them, and review the snapshot diff like code.

## 16. Flaky tests

A **flaky test** passes and fails on the same code. It is worse than a failing test, because people learn to ignore red builds, and then a real failure hides in the noise.

| Cause | What it looks like | Fix |
|---|---|---|
| Real timers and sleeps | passes on your laptop, fails on slow CI | fake the clock (`mock.timers`), or wait for a **condition** (`t.waitFor`, `events.once`), not for a fixed time |
| Shared state and test order | passes alone, fails with others (or the other way round) | create fresh objects in `beforeEach` or inside each test; no module-level state |
| Unordered results | `fs.readdir` (no order is promised), "first finished" order of parallel work, database queries without `ORDER BY` | sort before comparing, or compare as sets |
| Fixed ports | `EADDRINUSE` | listen on port `0` |
| Dates and time zones | fails near midnight, at month end, or on a laptop in another time zone | inject or fake the clock; build dates in a time-zone-proof way |
| Shared files or a shared database | two test files write the same path or the same table at the same time | `fs.mkdtemp` per test; a separate database or schema per test file; as a stopgap `--test-concurrency=1` |
| Real network or external services | slow, down, rate limited | run a local server, or use a fake |
| Work that leaks out of a test | a timer or promise from test A fires during test B | `await` everything, clear timers, clean up in `t.after()` |
| Random data | fails 1 time in 500 | inject the random generator, or log the seed |

`examples/12-flaky-tests.test.js` shows the **fixed** version of each cause, with a comment about what the flaky version looked like. Some of them in detail:

**Timing.** The flaky version slept for a fixed 50 ms and then checked. The fixed version polls, and passes as soon as the condition holds (up to a generous limit):

```js
let ready = false;
setTimeout(() => { ready = true; }, 30);
await t.waitFor(() => assert.equal(ready, true), { interval: 5, timeout: 2000 });
```

**Ports.** This test shows what a clash looks like and why port 0 avoids it:

```js
const first = http.createServer().listen(0, '127.0.0.1');
await once(first, 'listening');
const second = http.createServer().listen(first.address().port, '127.0.0.1'); // the same port
const [error] = await once(second, 'error');
assert.equal(error.code, 'EADDRINUSE');
```

**Time zones.** `new Date('2030-01-05T23:30:00Z')` is a Saturday in London but already Sunday in Tokyo. Run in three time zones (set with `process.env.TZ`), `getDay()` gave `6` in UTC, `0` (Sunday) in `Asia/Tokyo` and `6` in `America/Los_Angeles`. The constructor `new Date(2030, 0, 5)` uses the **local** time zone, so it is a Saturday everywhere.

**Ordering.** The Node docs do not promise any order for the names that `fs.readdir` returns. On this Windows machine they come back alphabetically, which can hide the bug until the test runs on another file system. (`Set` and `Map` are different: they always iterate in insertion order.) Sort first: `assert.deepEqual(names.sort(), [...])`.

**Hidden order dependence.** `examples/_fixtures/order-dependent-suite.js` has two tests where B only passes because A ran first. A normal run is green, which is exactly why this bug survives. Two ways to expose it, with real output (the first command is the normal run):

```text
$ node --test lessons/16-testing/examples/_fixtures/order-dependent-suite.js
  ✔ A puts a pen in the cart (Nms)
  ✔ B expects the pen from A (Nms)
  (exit code 0)

$ node --test --test-name-pattern="^B" lessons/16-testing/examples/_fixtures/order-dependent-suite.js
  ✖ B expects the pen from A (Nms)
    0 !== 1
  (exit code 1)

$ node --test --test-randomize --test-random-seed=1 lessons/16-testing/examples/_fixtures/order-dependent-suite.js
  ✖ B expects the pen from A (Nms)
  ✔ A puts a pen in the cart (Nms)
  ℹ Randomized test order seed: 1
  (exit code 1)
```

Run a test **alone** (name pattern) and **shuffled** (`--test-randomize`, new in Node 24.16 and still early development). When a shuffled run fails, rerun with the printed seed (`--test-random-seed=...`) to get the same order again. The fixed file passes under shuffling: `12-flaky-tests.test.js` passed with every seed from 1 to 8.

What **not** to do: do not add automatic retries to make a flaky test go green (you hide the bug), do not lengthen the sleep (you slow every run and it still fails sometimes), and do not delete the test. Mark it `{ todo: 'flaky: ticket 123' }` so it still runs and reports but cannot block the build, then fix the cause.

> **Interview tip:** "You have a flaky test. What do you do?" Strong short answer: first reproduce it (run it many times, alone, and in random order, and note the seed). Then find the cause, which is nearly always time, shared state, ordering, ports or the outside world, and fix that cause instead of adding a retry or a longer sleep. If it blocks the team meanwhile, quarantine it with `todo` and a ticket, so a red build keeps meaning "real problem".

## 17. Test-driven development: red, green, refactor

**TDD** means you write the test **before** the code. One cycle has three steps:

1. **Red.** Write one small failing test. Run it and watch it fail, for the right reason.
2. **Green.** Write the simplest code that makes it pass. Cheating is allowed (even returning a constant).
3. **Refactor.** Clean up the code (and the tests) while all tests stay green.

Then repeat with the next small test. The benefits: you only write code that a test asked for, the tests describe the behaviour, and you always have a safety net for the refactor step.

**Worked example: `parseDuration('1h30m')` returns milliseconds.** The final tests are in `examples/10-tdd-duration.test.js`, and the final code is in `examples/_lib/duration.js`. Here is how it grew. All outputs below are real runs of the intermediate files, trimmed to the lines that matter.

**Cycle 1, red.** The first test, and an empty function:

```js
// duration.js
function parseDuration(text) {
  // not written yet
}
module.exports = { parseDuration };

// duration.test.js
test('parses seconds', () => {
  assert.equal(parseDuration('5s'), 5000);
});
```

```text
✖ parses seconds (5.2814ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + undefined
  - 5000
```

It fails for the right reason: there is no answer yet.

**Cycle 1, green.** The simplest code that passes is a constant ("fake it"):

```js
function parseDuration(text) {
  return 5000;
}
```

```text
✔ parses seconds (3.0991ms)
ℹ tests 1
ℹ pass 1
```

That feels silly, but it is the point: the next test will force the real logic.

**Cycle 2, red.** Add `assert.equal(parseDuration('2m'), 120000)`:

```text
✔ parses seconds (3.0548ms)
✖ parses minutes (6.7418ms)
  5000 !== 120000
```

**Cycle 2, green.** Now a real (but still naive) implementation:

```js
function parseDuration(text) {
  const amount = parseInt(text);
  const unit = text.slice(String(amount).length);
  if (unit === 's') return amount * 1000;
  if (unit === 'm') return amount * 60000;
}
```

```text
✔ parses seconds (3.7121ms)
✔ parses minutes (0.6451ms)
```

**Cycle 3, red.** Add `assert.equal(parseDuration('1h30m'), 5400000)`. The naive code cannot do it (`undefined` instead of `5400000`).

**Cycle 3, green.** Parse every "number + unit" part with a regular expression and add them up:

```js
function parseDuration(text) {
  const unitMs = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  let total = 0;
  for (const [, amount, unit] of text.matchAll(/(\d+)(ms|s|m|h|d)/g)) {
    total += Number(amount) * unitMs[unit];
  }
  return total;
}
```

```text
✔ parses seconds (4.1595ms)
✔ parses minutes (0.9432ms)
✔ parses several parts at once (0.6061ms)
```

**Cycle 4, red.** Error handling. Add `assert.throws(() => parseDuration('soon'), RangeError)`:

```text
✖ rejects text that is not a duration (2.9616ms)
  AssertionError [ERR_ASSERTION]: Missing expected exception (RangeError).
```

The code returned `0` for `'soon'`. That is a real bug that the new test exposed. Add validation with a whole-string regex and a type check. Then a few more small cycles added tests for the units `ms`, `h`, `d`, for zero, and for the invalid inputs `''`, `'5'`, `'1h30'`, `'-5s'`, `'1.5h'`, `' 5s'` and `'5S'`. The unit tests were green the moment they were written, because the unit table already knew those units. A test that is green on its first run teaches you less than a red one, but it still guards against future breakage.

**Refactor.** Move the unit table and the two regular expressions to the top of the file, give them names, and keep the function body short. This is the final `_lib/duration.js`:

```js
const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const WHOLE_TEXT = /^(?:\d+(?:ms|s|m|h|d))+$/; // one or more "number + unit" parts and nothing else
const ONE_PART = /(\d+)(ms|s|m|h|d)/g;

function parseDuration(text) {
  if (typeof text !== 'string') throw new TypeError('duration must be a string');
  if (!WHOLE_TEXT.test(text)) throw new RangeError(`invalid duration: "${text}"`);

  let total = 0;
  for (const [, amount, unit] of text.matchAll(ONE_PART)) {
    total += Number(amount) * UNIT_MS[unit];
  }
  return total;
}
```

No test changed during the refactor, and they all stayed green. That is how you know the cleanup kept the behaviour. The final run has 17 tests, and coverage of `duration.js` is 100% (`node --test --experimental-test-coverage lessons/16-testing/examples/10-tdd-duration.test.js`):

```text
ℹ     duration.js | 100.00 |   100.00 |  100.00 | 
ℹ all files       | 100.00 |   100.00 |  100.00 | 
```

A subtle trap showed up on the way. When all the tests were added at once (to save time), the test "`parseDuration(42)` throws `TypeError`" **passed against the naive code**, before any type check existed: `text.slice` is not a function for a number, so the naive code threw by accident. A test that passes for the wrong reason is a trap. Write one test at a time and watch it fail first, and you will notice such cases.

When TDD helps: well-defined logic with clear inputs and outputs (parsers, validators, calculations, state machines) and bug fixes (write the test that reproduces the bug first). When it helps less: exploring an unknown API or a UI where you do not know yet what you want. Many developers write tests slightly after the code and still get most of the value. What matters is that tests exist and that you have seen them fail.

> **Interview tip:** "Explain TDD." Strong short answer: red (write one small failing test and check it fails for the right reason), green (write the simplest code that passes), refactor (clean up while the tests stay green), then repeat in tiny steps. Say what you get: only code that a test asked for, tests that document behaviour, and a safety net for refactoring. Then show balance: it shines for parsers, validators, calculations and bug fixes, and it is less useful when you are still exploring what to build.

## 18. Choosing a tool: node:test, Jest, Vitest, Mocha, Chai, Sinon, supertest

Latest versions on npm on 2026-11-10 (they change; always check): Jest 30.5.2, Vitest 5.1.0, Mocha 12.0.3, Chai 6.3.0, Sinon 22.1.0, supertest 7.3.2.

| | `node:test` | Jest | Vitest | Mocha (+ Chai, Sinon) | supertest |
|---|---|---|---|---|---|
| What it is | test runner built into Node | all-in-one framework | Jest-compatible runner built on Vite | runner only; Chai = assertions, Sinon = spies, stubs and fake timers | HTTP assertions library, not a runner |
| Install | none | `npm i -D jest` | `npm i -D vitest` | `npm i -D mocha chai sinon` | `npm i -D supertest` |
| Assertions | `node:assert` | `expect(x).toBe(...)` (rich matchers) | `expect(x).toBe(...)` | Chai `expect`, `should`, or `node:assert` | chained `.expect(200)` |
| Mocks and spies | `mock.fn`, `mock.method` | `jest.fn`, `jest.spyOn` | `vi.fn`, `vi.spyOn` | Sinon | not its job |
| Fake timers | `mock.timers` | `jest.useFakeTimers()` | `vi.useFakeTimers()` | Sinon `useFakeTimers` | not its job |
| Module mocking | experimental (`mock.module`, needs a flag) | mature (`jest.mock`) | mature (`vi.mock`) | via Sinon or other add-ons | not its job |
| Snapshots | built in, stable since Node 23.4 (section 15) | built in | built in | needs a plugin | no |
| Coverage | built in, experimental | built in | built in, needs a small extra package | add `c8` or `nyc` | no |
| TypeScript / ESM | runs `.ts` with type stripping (erasable syntax only); ESM native | needs a transform for TypeScript; ESM needs extra setup | TypeScript and ESM out of the box | needs setup for TypeScript | works with any |
| Dependencies you add | none | a large tree | a large tree (it includes Vite) | a few | a few |

**When to pick which**
- **New Node service, library or CLI** with no framework already chosen: start with `node:test`. No dependencies, nothing to upgrade, and it covers most everyday needs (mocks, fake timers, snapshots, watch, coverage).
- **Existing Jest project, or React/front-end work** (DOM tests, component snapshots, large ecosystem of matchers and docs): stay with Jest. Do not migrate for fashion.
- **Vite-based project, TypeScript-first or ESM-first monorepo**: Vitest. Its API looks like Jest, so Jest knowledge transfers.
- **Existing Mocha suite**: keep it. Mocha with Chai and Sinon is a flexible pick if you like to assemble your own tools.
- **Testing an HTTP API**: use a real server on port 0 with `fetch` (section 12). Add supertest if you like its fluent style or you already use it. It works with any runner.

> **Interview tip:** the honest answer to "which test framework do you use?" is "it depends on the project", followed by reasons. A good candidate can name what `node:test` still lacks (mature module mocking, a huge matcher library, front-end tooling) and what it gives (zero dependencies, built into Node, process isolation, one less thing to upgrade).

The same test in four styles. First `node:test` (this is what the lesson uses):

```js
test('sends a welcome email', async () => {
  const send = mock.fn(async () => {});
  await register('a@b.c', { send });
  assert.equal(send.mock.callCount(), 1);
  assert.deepEqual(send.mock.calls[0].arguments, ['a@b.c', 'Welcome!']);
});
```

Jest (illustrative, not run here):

```js
// Needs: npm install --save-dev jest      (run with: npx jest)
test('sends a welcome email', async () => {
  const send = jest.fn().mockResolvedValue(undefined);
  await register('a@b.c', { send });
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith('a@b.c', 'Welcome!');
});

// Fake time and a snapshot in Jest:
test('debounce waits for the quiet period', () => {
  jest.useFakeTimers();
  const fn = jest.fn();
  const search = debounce(fn, 300);
  search('a');
  jest.advanceTimersByTime(300);
  expect(fn).toHaveBeenCalledTimes(1);
  jest.useRealTimers();
});

test('api shape', () => {
  expect(toApiShape(order)).toMatchSnapshot();
});
```

Vitest (illustrative, not run here):

```js
// Needs: npm install --save-dev vitest    (run with: npx vitest run)
import { test, expect, vi } from 'vitest';

test('sends a welcome email', async () => {
  const send = vi.fn().mockResolvedValue(undefined);
  await register('a@b.c', { send });
  expect(send).toHaveBeenCalledWith('a@b.c', 'Welcome!');
});
```

Mocha with Chai and Sinon (illustrative, not run here):

```js
// Needs: npm install --save-dev mocha chai sinon      (run with: npx mocha)
// Chai is published as an ES module, so use import in a .mjs file.
import { expect } from 'chai';
import sinon from 'sinon';

describe('register', () => {
  it('sends a welcome email', async () => {
    const send = sinon.stub().resolves();
    await register('a@b.c', { send });
    expect(send.calledOnceWithExactly('a@b.c', 'Welcome!')).to.equal(true);
  });
});
```

## 19. Testing in CI

**CI** (continuous integration) means a server runs your checks on every push and every pull request. The tests are only useful if a failure blocks the merge. What you need:

1. **A command that exits non-zero on failure.** `node --test` does (`1` for any failure).
2. **A `package.json` script** so everyone, including CI, runs the same thing:

```json
{
  "scripts": {
    "test": "node --test",
    "test:ci": "node --test --experimental-test-coverage --test-coverage-lines=80 --test-timeout=30000 --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=test-results.xml"
  }
}
```

If a script in `package.json` needs a glob, write it with escaped **double** quotes (`"test": "node --test \"src/**/*.spec.js\""`). Single quotes work in bash but not on Windows: with `'src/**/*.spec.js'` in a script, both `npm run` and `node --run` on Windows passed the quotes to Node literally, so zero tests ran (`tests 0`) and the exit code was still `0`.

3. **Reporters CI can read.** `spec` for the log, `junit` for the test-report tab, `lcov` for coverage services (each flag pair as in section 7).
4. **A safety net for hangs.** `--test-timeout` stops one stuck test from freezing the build.
5. **Coverage thresholds** so the number cannot silently fall (section 14).
6. **A matrix of Node versions and operating systems.** Test on the Node lines you support. At the time of writing those are 22 and 24 (Maintenance LTS) and 26 (Active LTS). Check newer flags per version: for example `--test-randomize` only exists in 24.16 and later. Include Windows if developers use it. It finds path and line-ending bugs.
7. **Shards for big suites.** `node --test --test-shard=1/3` runs the first third of the files. Run shards 1/3, 2/3 and 3/3 as three parallel jobs.

An example workflow for GitHub Actions (illustrative, not run here). The `matrix` block means "run this job once for every combination of operating system and Node version", here 2 x 3 = 6 jobs. The action versions are the latest majors as of 2026-11-10; check them again before you copy this:

```yaml
# .github/workflows/test.yml
name: test
on: [push, pull_request]
jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]
        node: [22, 24, 26]
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: ${{ matrix.node }}
      - run: npm ci
      - run: npm run test:ci
```

CI problems come from the same list as flaky tests: fixed ports, shared files, real time and the network. A suite that passes on your laptop but fails in CI usually depends on the order of files, the time zone, a case-insensitive file system or `localhost`. Run `npm test` in a clean checkout before you push, and treat a flaky test as a bug with an owner.

This repository runs the same way: `npm run check:examples` starts every `*.test.js` file of every lesson with `node --test` and fails if one of them exits with a non-zero code.

> **Interview tip:** "How would you set up testing for a new Node service?" A complete answer: `node --test` (or the team's runner) in an npm script, unit tests with injected dependencies, a few integration tests with a real server on port 0 and a real or containerised database, coverage with a threshold, JUnit and coverage output in CI, a Node-version matrix, and a rule that flaky tests are fixed or quarantined within days.

## 20. Going further: ideas that come up in senior interviews

You do not need these to write good tests, but interviewers for senior roles like to ask whether you know them. Each one answers a question that plain unit tests cannot.

| Idea | What it is | Why it matters |
|---|---|---|
| Mutation testing | A tool changes your code in small ways (turns `>` into `>=`, deletes a line) and reruns the tests. A change that no test notices is a "surviving mutant" | It measures whether tests really **check** things, which coverage cannot. Section 11 shows a manual version of this. A well-known tool is Stryker (needs npm) |
| Property-based testing | You state a rule ("parse then format gives back the same text") and a library tries hundreds of random inputs, then shrinks a failing input to the smallest one | Finds edge cases you did not think of. A well-known library is fast-check (needs npm) |
| Contract testing | Two services agree on the shape of their requests and responses in a shared file, and each side tests against that file | Catches "the other team changed the API" without running every service together. A well-known tool is Pact (needs npm) |
| Test data builders | Small helpers that build a valid object with defaults, like `makeOrder({ shipped: true })` | Each test shows only the fields that matter for it |
| Real dependencies in a few tests | A throwaway database (for example in a container) for a handful of integration tests | Fakes can behave differently from the real thing, such as SQL ordering and constraints |
| Smoke tests | A few quick checks against a freshly deployed copy ("the home page answers 200") | Tells you the deploy itself worked |
| Load tests | A tool sends many requests and measures latency and errors | Checks capacity, not correctness, so it is a different kind of test |

> **Interview tip:** if you are asked "how do you know your tests are good?", do not stop at "we have 90% coverage". Say that coverage shows what ran, then add what shows what is **checked**: watching each test fail first (TDD), mutation testing, code review of the assertions, and how often a bug escapes to production anyway.

## Summary / Key takeaways
- The pyramid: many fast unit tests, some integration tests, a few end-to-end tests. Good tests are fast, isolated, repeatable and self-checking.
- `node:test` is built in and stable since Node 20. `node --test` finds `*.test.js`, `test-*.js` and more, but not `.spec.js`. Pass globs in quotes, and use `spec` for people and `junit`/`tap`/`lcov` for tools.
- Import `node:assert/strict`. Put `await` on every promise assertion, use `assert.rejects`/`assert.throws` with a specific matcher, and write tests as Arrange, Act, Assert with names that describe behaviour.
- Fresh state per test (`beforeEach`, factories) and cleanup with `t.after`. `only` needs `--test-only`. A timeout counts as cancelled and still fails the run.
- Test doubles: stub (canned answers), spy (records calls), mock (spy with expectations), fake (simple working version). Use `t.mock` so everything is restored. Stub the edges, do not over-mock. `mock.module` is experimental.
- Make code testable: pure functions, dependency injection with defaults, thin I/O edges, no work at import time. `mock.timers` removes real waiting, but let the event loop turn after `tick` when promises are involved.
- Test HTTP with a real server on port 0 and `fetch`, files with `fs.mkdtemp`, events with `events.once` (listen first), streams with awkward chunk boundaries. Test every error path.
- Coverage tells you what ran, not what was checked (and it is experimental). Snapshots are stable since Node 23.4 but must be reviewed, never blindly updated. Flaky tests come from time, shared state, ordering, ports and the outside world. TDD is red, green, refactor. Pick `node:test` for new Node code and keep Jest or Vitest where a project already uses them.

## Quick check

1. Name the three levels of the test pyramid. Which one should have the most tests, and why?
<details><summary>Answer</summary>

Unit, integration and end-to-end. Unit tests should be the most numerous because they are fast, cheap and point to the exact function that broke. End-to-end tests are slow and fail for unrelated reasons, so you keep only a few.

</details>

2. You run `node --test` in your project. A file called `cart.spec.js` is not run. Why, and how do you run it?
<details><summary>Answer</summary>

Default discovery looks for `*.test.js`, `*-test.js`, `*_test.js`, `test-*.js`, `test.js` and files in a `test` folder. `.spec.js` is not in the list. Pass the file or a quoted glob: `node --test "**/*.spec.js"`.

</details>

3. What is the difference between `assert.equal(1, '1')` in `node:assert` and in `node:assert/strict`?
<details><summary>Answer</summary>

In the old loose mode it passes, because it compares with `==`. In `node:assert/strict` it fails, because `equal` is `strictEqual` (it uses `Object.is`, so no type conversion). Always import the strict version.

</details>

4. What is wrong with this test, and how do you fix it?
```js
test('rejects bad input', () => {
  assert.rejects(parse('???'), /invalid/);
});
```
<details><summary>Answer</summary>

The promise is not awaited or returned, so the test ends before the check runs and is reported as passed. The runner may flag the leaked failure later, but the test itself proves nothing. Make the function `async` and write `await assert.rejects(parse('???'), /invalid/)`.

</details>

5. Explain the difference between a stub, a spy and a fake. Give one example of each from Node code.
<details><summary>Answer</summary>

A stub returns canned answers (`{ send: async () => {} }`). A spy records how it was called so you can check later (`mock.fn()` and `callCount()`). A fake is a working but simplified implementation (an in-memory `Map` instead of a database). `mock.fn` in `node:test` can play both the stub and the spy role.

</details>

6. Why do tests start servers with `listen(0)`, and how do you find the port?
<details><summary>Answer</summary>

Port 0 asks the operating system for any free port, so tests never clash with other programs or with each other when they run in parallel. After the `listening` event, read `server.address().port` and build the URL from it.

</details>

7. How do you test a function that waits 5 seconds with `setTimeout` without waiting 5 seconds?
<details><summary>Answer</summary>

Use fake timers: `t.mock.timers.enable({ apis: ['setTimeout'] })`, call the function, then `t.mock.timers.tick(5000)`. If the code awaits a promise, let the event loop turn (for example `await new Promise((r) => setImmediate(r))`) between ticks.

</details>

8. A test marked `{ only: true }` is committed by mistake. What happens in CI, and why is that a good design?
<details><summary>Answer</summary>

Nothing special: without the `--test-only` flag the `only` option is ignored (Node prints a note) and all tests run. A leftover `only` therefore cannot silently turn off the rest of your suite in CI.

</details>

9. A project has 100% line coverage and still ships a bug. How is that possible?
<details><summary>Answer</summary>

Coverage only measures which code ran, not whether the results were checked. A test can call a function and assert nothing. Lines can also be covered while one side of a branch never runs (line 9 of the `grade.js` example), and no test may send the input that triggers the bug.

</details>

10. Name four causes of flaky tests and the fix for each.
<details><summary>Answer</summary>

Real timers (fake the clock or wait for a condition), shared state or order dependence (fresh state per test, check with `--test-randomize`), fixed ports (listen on port 0), unordered results or time zones (sort before comparing, build dates in a time-zone-proof way). Others: shared files (`mkdtemp`), network calls (use a local fake), leaked async work (`await` and `t.after`).

</details>

## Try it yourself

Save each solution as a file in any folder and run it with `node --test file.test.js`. They only use core modules.

### Task 1 (easy): write the tests for `slugify`
Here is the function (copy it into your test file). Write five tests with `describe` and `it`: a normal title, extra spaces, punctuation, an empty string, and a non-string input.

```js
function slugify(title) {
  if (typeof title !== 'string') throw new TypeError('title must be a string');
  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
```

<details><summary>Hint</summary>

For the non-string case use `assert.throws(() => slugify(42), { name: 'TypeError', message: 'title must be a string' })`. Remember to pass a function, not a call. After it works, change the regular expression in `slugify` slightly and check that at least one of your tests fails.

</details>

<details><summary>Solution</summary>

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

function slugify(title) {
  if (typeof title !== 'string') throw new TypeError('title must be a string');
  return title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

describe('slugify()', () => {
  it('lowercases and joins words with a dash', () => {
    assert.equal(slugify('Hello World'), 'hello-world');
  });

  it('trims and collapses repeated spaces', () => {
    assert.equal(slugify('  Spaces   everywhere  '), 'spaces-everywhere');
  });

  it('drops punctuation without leaving dashes at the ends', () => {
    assert.equal(slugify('Rock & Roll!'), 'rock-roll');
  });

  it('returns an empty string for an empty title', () => {
    assert.equal(slugify(''), '');
  });

  it('throws a TypeError for a non-string', () => {
    assert.throws(() => slugify(42), { name: 'TypeError', message: 'title must be a string' });
  });
});
```

</details>

### Task 2 (medium): test a function with injected dependencies
`notifyIfLate` sends a message when an unshipped order is 24 hours old or older. Write four tests: a young order (nothing sent), an old unshipped order (one message with the right arguments), an old shipped order (nothing sent) and the exact 24 hour boundary. Use `t.mock.fn()` for `send` and a fixed `now`.

```js
function notifyIfLate(order, { now = () => Date.now(), send }) {
  const ageHours = (now() - order.createdAt) / 3_600_000;
  if (order.shipped || ageHours < 24) return false;
  send(order.email, `Order ${order.id} is late`);
  return true;
}
```

<details><summary>Hint</summary>

Pick a constant `NOW` and a constant `HOUR = 3_600_000`. An order created `30 * HOUR` before `NOW` is old. Pass `now: () => NOW` so the test never reads the real clock. Check `send.mock.callCount()` and `send.mock.calls[0].arguments`.

</details>

<details><summary>Solution</summary>

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

function notifyIfLate(order, { now = () => Date.now(), send }) {
  const ageHours = (now() - order.createdAt) / 3_600_000;
  if (order.shipped || ageHours < 24) return false;
  send(order.email, `Order ${order.id} is late`);
  return true;
}

describe('notifyIfLate()', () => {
  const HOUR = 3_600_000;
  const NOW = 1_000 * HOUR;
  const now = () => NOW;

  it('does nothing for a young order', (t) => {
    const send = t.mock.fn();
    const order = { id: 7, email: 'a@b.c', createdAt: NOW - 2 * HOUR, shipped: false };

    assert.equal(notifyIfLate(order, { now, send }), false);
    assert.equal(send.mock.callCount(), 0);
  });

  it('sends one message for an old, unshipped order', (t) => {
    const send = t.mock.fn();
    const order = { id: 7, email: 'a@b.c', createdAt: NOW - 30 * HOUR, shipped: false };

    assert.equal(notifyIfLate(order, { now, send }), true);
    assert.equal(send.mock.callCount(), 1);
    assert.deepEqual(send.mock.calls[0].arguments, ['a@b.c', 'Order 7 is late']);
  });

  it('does nothing when the old order has shipped', (t) => {
    const send = t.mock.fn();
    const order = { id: 7, email: 'a@b.c', createdAt: NOW - 30 * HOUR, shipped: true };

    assert.equal(notifyIfLate(order, { now, send }), false);
    assert.equal(send.mock.callCount(), 0);
  });

  it('treats exactly 24 hours as late (boundary)', (t) => {
    const send = t.mock.fn();
    const order = { id: 1, email: 'a@b.c', createdAt: NOW - 24 * HOUR, shipped: false };

    assert.equal(notifyIfLate(order, { now, send }), true);
  });
});
```

</details>

### Task 3 (harder): build a rate limiter with TDD and fake time
Build `createRateLimiter({ limit, windowMs })` with a method `allow(key)` that returns `true` for the first `limit` calls per key inside a sliding window of `windowMs` milliseconds and `false` after that. Work test-first: write one test, watch it fail, then write the code. Use `t.mock.timers.enable({ apis: ['Date'], now: 0 })` so the tests never wait.

Tests to write, in this order: calls up to the limit are allowed and the next is refused; calls are allowed again after the window has passed (check 999 ms and 1000 ms); each key is counted separately; old calls expire one by one (a sliding window).

<details><summary>Hint</summary>

Keep a `Map` from key to an array of timestamps. On every `allow`, drop timestamps older than `windowMs` (`Date.now() - time >= windowMs`), then compare the array length with `limit`. Only record the timestamp when the call is allowed. For the sliding window test: call at 0 ms, call at 500 ms, move to 999 ms (refused), then to 1000 ms (allowed, because the first call has expired).

</details>

<details><summary>Solution</summary>

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Written test-first. Each test below was red before the code that makes it green existed.
function createRateLimiter({ limit, windowMs }) {
  const hits = new Map(); // key -> timestamps of recent allowed calls
  return {
    allow(key) {
      const now = Date.now();
      const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
      const allowed = recent.length < limit;
      if (allowed) recent.push(now);
      hits.set(key, recent);
      return allowed;
    },
  };
}

describe('createRateLimiter()', () => {
  it('allows calls up to the limit, then refuses', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 0 });
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000 });

    assert.equal(limiter.allow('ann'), true);
    assert.equal(limiter.allow('ann'), true);
    assert.equal(limiter.allow('ann'), false);
  });

  it('allows calls again after the window has passed', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 0 });
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    limiter.allow('ann');

    t.mock.timers.tick(999);
    assert.equal(limiter.allow('ann'), false);
    t.mock.timers.tick(1);
    assert.equal(limiter.allow('ann'), true);
  });

  it('counts every key separately', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 0 });
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });

    assert.equal(limiter.allow('ann'), true);
    assert.equal(limiter.allow('bob'), true);
  });

  it('uses a sliding window: old calls expire one by one', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 0 });
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000 });
    limiter.allow('ann'); // at 0 ms
    t.mock.timers.tick(500);
    limiter.allow('ann'); // at 500 ms

    t.mock.timers.tick(499); // 999 ms: both calls still count
    assert.equal(limiter.allow('ann'), false);
    t.mock.timers.tick(1); // 1000 ms: the call from 0 ms has expired
    assert.equal(limiter.allow('ann'), true);
  });
});
```

</details>

## Where to go next
- Next lesson: [17. Databases and Data Access](../17-databases-and-data-access/README.md). The same ideas (fakes, temp resources, real integration tests) come back when you test code that talks to a database.
- Practise this topic in the interview rounds: [Round 1, screening questions](../../rounds/round-1-screening/questions.md), [Round 2, core questions](../../rounds/round-2-core/questions.md), [Round 3, coding challenges](../../rounds/round-3-coding/questions.md) and [Round 4, advanced questions](../../rounds/round-4-advanced/questions.md). When you practise, answer each question out loud first, then compare with the "strong short answer" callouts in this lesson.
- Related lessons: [11. Streams](../11-streams/README.md) (what you tested in section 11), [12. HTTP and Networking](../12-http-and-networking/README.md) (the server from section 12) and [09. Events and EventEmitter](../09-events/README.md).
