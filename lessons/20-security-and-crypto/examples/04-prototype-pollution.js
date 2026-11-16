// Prototype pollution: a naive merge lets JSON change Object.prototype. Then six ways to defend.
// Run: node lessons/20-security-and-crypto/examples/04-prototype-pollution.js
//
// The "pollution" lives only inside this one process and is cleaned up after each step.
// Strict mode is on, because it decides whether writes to a frozen object fail loudly (step 6).
'use strict';

const { spawnSync } = require('node:child_process');

const isObject = (v) => v !== null && (typeof v === 'object' || typeof v === 'function');

// A typical (vulnerable) deep merge, the kind found in many "merge settings" helpers.
function naiveMerge(target, source) {
  for (const key in source) {
    if (isObject(source[key])) {
      if (!isObject(target[key])) target[key] = {};
      naiveMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

const PROTO_PAYLOAD = '{"__proto__": {"isAdmin": true}}';
const CTOR_PAYLOAD = '{"constructor": {"prototype": {"isAdmin": true}}}';

function cleanup() {
  delete Object.prototype.isAdmin;
}

// ---------- 1. The attack ----------
console.log('--- 1. the attack ---');
const payload = JSON.parse(PROTO_PAYLOAD);
// JSON.parse makes "__proto__" an ordinary OWN key. (In a source-code literal it would set the prototype instead.)
console.log('own keys of the parsed payload:', Object.keys(payload));

const user = { name: 'ann' };
console.log('before merge: user.isAdmin =', user.isAdmin);
naiveMerge({}, payload); // the app only meant to merge some settings...
console.log('after merge : user.isAdmin =', user.isAdmin, '(user never had this key!)');
console.log('also true for every new object: ({}).isAdmin =', ({}).isAdmin);

// Defence 0 for READING: only trust own properties.
console.log('Object.hasOwn(user, "isAdmin") =', Object.hasOwn(user, 'isAdmin'));
cleanup();

// ---------- 2. Fix: block the dangerous keys ----------
const BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);
function safeMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (BLOCKED.has(key)) continue; // skip silently (or throw, if you prefer to reject the request)
    if (isObject(source[key])) {
      if (!isObject(target[key]) || !Object.hasOwn(target, key)) target[key] = {};
      safeMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

console.log('\n--- 2. key blocklist ---');
safeMerge({}, JSON.parse(PROTO_PAYLOAD));
console.log('__proto__ payload    -> ({}).isAdmin =', ({}).isAdmin);
safeMerge({}, JSON.parse(CTOR_PAYLOAD));
console.log('constructor payload  -> ({}).isAdmin =', ({}).isAdmin);
cleanup();

// ---------- 3. Fix: a target with no prototype ----------
console.log('\n--- 3. Object.create(null) ---');
const bare = Object.create(null);
naiveMerge(bare, JSON.parse(PROTO_PAYLOAD)); // the SAME vulnerable merge, but the target has no prototype to damage
console.log('({}).isAdmin =', ({}).isAdmin, '| own keys of the target:', Object.keys(bare));
cleanup();

// ---------- 4. Fix: a Map for data whose keys come from users ----------
console.log('\n--- 4. Map ---');
const counts = new Map();
for (const word of ['__proto__', 'constructor', 'hello', 'hello']) counts.set(word, (counts.get(word) ?? 0) + 1);
console.log('Map entries:', [...counts], '| ({}).hello =', ({}).hello);

// ---------- 5. Fix: node --disable-proto (a process-wide switch) ----------
console.log('\n--- 5. node --disable-proto ---');
const childCode = `
${naiveMerge.toString()}
const isObject = ${isObject.toString()};
naiveMerge({}, JSON.parse('${PROTO_PAYLOAD}'));
const viaProto = ({}).isAdmin;
delete Object.prototype.isAdmin;
naiveMerge({}, JSON.parse('${CTOR_PAYLOAD}'));
const viaCtor = ({}).isAdmin;
console.log('__proto__ payload:', viaProto, '| constructor payload:', viaCtor);
`;
for (const flag of [null, '--disable-proto=delete', '--disable-proto=throw']) {
  const args = [...(flag ? [flag] : []), '-e', childCode];
  const run = spawnSync(process.execPath, args, { encoding: 'utf8' });
  const text = (run.stdout.trim() || run.stderr.split(/\r?\n/).find((l) => l.includes('Error')) || '').trim();
  console.log((flag || '(no flag)').padEnd(24), text);
}

// ---------- 6. Fix: freeze Object.prototype at start-up ----------
console.log('\n--- 6. Object.freeze(Object.prototype) ---');
Object.freeze(Object.prototype);
try {
  naiveMerge({}, JSON.parse(PROTO_PAYLOAD));
} catch (e) {
  console.log('strict mode throws:', e.constructor.name, '-', e.message);
}
console.log('({}).isAdmin after the attempt =', ({}).isAdmin);
