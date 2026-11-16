// Callbacks: the error-first convention, callback hell and inversion of control
// Shows how Node-style callbacks work, how nesting grows, and how a callback can be misused.
// Run: node lessons/07-async-javascript/examples/02-callbacks.js

// Fake "database" functions in the Node style: the callback is the LAST argument,
// and its FIRST argument is the error (null when everything went fine).
function getUser(id, callback) {
  setTimeout(() => {
    if (id <= 0) return callback(new Error('invalid user id: ' + id));
    callback(null, { id, name: 'user' + id });
  }, 5);
}

function getOrders(user, callback) {
  setTimeout(() => callback(null, [{ id: 100 + user.id, price: 20 }, { id: 200 + user.id, price: 30 }]), 5);
}

function getTotal(orders, callback) {
  setTimeout(() => callback(null, orders.reduce((sum, o) => sum + o.price, 0)), 5);
}

// Part A: using an error-first callback. Always check err first.
function partA(done) {
  console.log('--- A: error-first callback');
  getUser(1, (err, user) => {
    if (err) return console.log('A error:', err.message);
    console.log('A user:', user);

    getUser(-5, (err2, user2) => {
      if (err2) console.log('A error:', err2.message); // the failure path
      console.log('A user2:', user2); // undefined, because there was an error
      done();
    });
  });
}

// Part B: callback hell (the "pyramid of doom"). Each step is one level deeper.
function partB(done) {
  console.log('--- B: callback hell');
  getUser(2, (err, user) => {
    if (err) return console.log(err.message);
    getOrders(user, (err, orders) => {
      if (err) return console.log(err.message);
      getTotal(orders, (err, total) => {
        if (err) return console.log(err.message);
        console.log('B total for', user.name, '=', total);
        done();
      });
    });
  });
}

// Part C: the same flow, flattened with small named functions. Better, but still callbacks.
function partC(done) {
  console.log('--- C: flattened with named functions');
  function onUser(err, user) {
    if (err) return console.log(err.message);
    getOrders(user, (err2, orders) => onOrders(err2, user, orders));
  }
  function onOrders(err, user, orders) {
    if (err) return console.log(err.message);
    getTotal(orders, (err2, total) => onTotal(err2, user, total));
  }
  function onTotal(err, user, total) {
    if (err) return console.log(err.message);
    console.log('C total for', user.name, '=', total);
    done();
  }
  getUser(3, onUser);
}

// Part D: inversion of control. We hand our callback to code we do not control.
// A badly written function calls it twice. We would charge the customer twice.
function badChargeCard(amount, callback) {
  setTimeout(() => {
    callback(null, 'charged ' + amount);
    callback(null, 'charged ' + amount); // bug in code we do not own
  }, 5);
}

function once(fn) {
  let called = false;
  return (...args) => {
    if (called) return;
    called = true;
    return fn(...args);
  };
}

function partD(done) {
  console.log('--- D: inversion of control');
  let calls = 0;
  badChargeCard(10, () => calls++);
  setTimeout(() => {
    console.log('D callback was called', calls, 'times without protection');

    let safeCalls = 0;
    badChargeCard(10, once(() => safeCalls++));
    setTimeout(() => {
      console.log('D callback was called', safeCalls, 'time with the once() guard');
      done();
    }, 20);
  }, 20);
}

// Part E: try/catch cannot catch an error thrown inside a later callback.
function partE(done) {
  console.log('--- E: try/catch does not see async errors');
  process.once('uncaughtException', (err) => {
    console.log('E nobody could catch this one locally, it became uncaught:', err.message);
    done();
  });
  try {
    setTimeout(() => {
      throw new Error('boom inside a timer');
    }, 5);
    console.log('E try block finished without any error');
  } catch (err) {
    console.log('E never printed:', err.message);
  }
}

// Part F: a function that is SOMETIMES sync and SOMETIMES async is a trap (people call it "Zalgo").
// lookup() calls back at once when the answer is cached, and later when it is not.
const cache = new Map();

function slowLoad(key, callback) {
  setTimeout(() => {
    cache.set(key, key.toUpperCase());
    callback(null, cache.get(key));
  }, 5);
}

function lookup(key, callback) {
  if (cache.has(key)) return callback(null, cache.get(key)); // cached: the callback runs NOW
  slowLoad(key, callback); // not cached: the callback runs LATER
}

// The fix: be async every time. Even when the answer is ready, call back on a later turn.
function lookupFixed(key, callback) {
  if (cache.has(key)) return process.nextTick(callback, null, cache.get(key)); // always LATER
  slowLoad(key, callback);
}

// Has the code AFTER the call already run when the callback runs? It should not depend on the cache.
function observe(fn, label) {
  let afterCallHasRun = false;
  fn('a', () => console.log(`F ${label}: callback ran, code after the call had run = ${afterCallHasRun}`));
  afterCallHasRun = true;
}

function partF(done) {
  console.log('--- F: sometimes sync, sometimes async (Zalgo)');
  observe(lookup, 'lookup, first call (not cached)');
  setTimeout(() => {
    observe(lookup, 'lookup, second call (cached)');
    observe(lookupFixed, 'lookupFixed (cached)');
    setTimeout(done, 10);
  }, 20);
}

// Run the parts one after another (each one calls done() when it has finished).
const parts = [partA, partB, partC, partD, partE, partF];
function runNext() {
  const part = parts.shift();
  if (part) part(runNext);
}
runNext();
