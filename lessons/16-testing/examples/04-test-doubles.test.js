// Test doubles: dummy, stub, spy, mock, fake. Uses mock.fn() and mock.method() from node:test.
// Run: node --test lessons/16-testing/examples/04-test-doubles.test.js

const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');
const { createUserService, ValidationError } = require('./_lib/user-service.js');

// A FAKE is a real but simplified implementation: here, a database that lives in a Map.
function createFakeDb() {
  const rows = new Map();
  return {
    rows,
    async findByEmail(email) {
      return rows.get(email) ?? null;
    },
    async insert(user) {
      rows.set(user.email, user);
    },
  };
}

const fixedNow = () => new Date('2030-05-01T10:00:00Z');
const fixedId = () => 'user-1';

describe('register()', () => {
  it('stores and returns the new user (fake db + stub mailer)', async () => {
    const db = createFakeDb(); // fake
    const mailer = { send: async () => {} }; // stub: canned behaviour, we never look at it
    const service = createUserService({ db, mailer, now: fixedNow, makeId: fixedId });

    const user = await service.register('ann@example.com');

    assert.deepEqual(user, {
      id: 'user-1',
      email: 'ann@example.com',
      createdAt: '2030-05-01T10:00:00.000Z',
    });
    assert.equal(db.rows.size, 1);
  });

  it('sends one welcome email (spy)', async () => {
    const send = mock.fn(async () => {}); // a spy: records every call
    const service = createUserService({ db: createFakeDb(), mailer: { send } });

    await service.register('ann@example.com');

    assert.equal(send.mock.callCount(), 1);
    assert.deepEqual(send.mock.calls[0].arguments, ['ann@example.com', 'Welcome!']);
  });

  it('refuses a duplicate email (stub with a canned answer, spy proves nothing was saved)', async () => {
    const db = {
      findByEmail: mock.fn(async () => ({ id: 'old' })), // stub: "yes, it exists"
      insert: mock.fn(async () => {}),
    };
    const service = createUserService({ db, mailer: { send: async () => {} } });

    await assert.rejects(service.register('ann@example.com'), {
      name: 'ValidationError',
      message: 'email already registered',
    });
    assert.equal(db.insert.mock.callCount(), 0);
  });

  it('still registers when the mailer fails (stub that throws, spy on the logger)', async () => {
    const mailer = {
      send: mock.fn(async () => {
        throw new Error('smtp down');
      }),
    };
    const logger = { warn: mock.fn() };
    const service = createUserService({ db: createFakeDb(), mailer, logger });

    const user = await service.register('ann@example.com');

    assert.equal(user.email, 'ann@example.com');
    assert.equal(logger.warn.mock.callCount(), 1);
    assert.match(logger.warn.mock.calls[0].arguments[0], /smtp down/);
  });

  it('rejects a bad email before touching any dependency (dummies)', async () => {
    const service = createUserService({ db: {}, mailer: {} }); // dummies: passed in, never used

    await assert.rejects(service.register('not-an-email'), ValidationError);
  });
});

describe('mock.fn() details', () => {
  it('records arguments, results and errors of each call', () => {
    const add = mock.fn((a, b) => a + b);

    add(1, 2);
    add(10, 20);

    assert.equal(add.mock.callCount(), 2);
    assert.deepEqual(add.mock.calls[1].arguments, [10, 20]);
    assert.equal(add.mock.calls[1].result, 30);
  });

  it('can change its behaviour for one call', () => {
    const read = mock.fn(() => 'real value');
    read.mock.mockImplementationOnce(() => 'first call only', 0);

    assert.equal(read(), 'first call only');
    assert.equal(read(), 'real value');
  });

  it('records the error when the function throws', () => {
    const boom = mock.fn(() => {
      throw new Error('bang');
    });

    assert.throws(() => boom(), /bang/);
    assert.equal(boom.mock.calls[0].error.message, 'bang');
  });
});

describe('mock.method() on existing objects', () => {
  const originalRandom = Math.random;

  it('spies on a real method and still calls it', (t) => {
    const spy = t.mock.method(Math, 'max'); // no replacement given: calls through

    assert.equal(Math.max(1, 5, 3), 5);
    assert.equal(spy.mock.callCount(), 1);
  });

  it('replaces a method for the length of the test (a stub)', (t) => {
    t.mock.method(Math, 'random', () => 0.5);

    assert.equal(Math.random(), 0.5);
  });

  it('has the original method back, because t.mock restores after each test', () => {
    assert.equal(Math.random, originalRandom);
  });

  it('can restore by hand with mock.restore()', () => {
    const stub = mock.method(Math, 'random', () => 0.25);
    assert.equal(Math.random(), 0.25);

    stub.mock.restore(); // module-level mock.method needs a manual restore

    assert.equal(Math.random, originalRandom);
  });
});
