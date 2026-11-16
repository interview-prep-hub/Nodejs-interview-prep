// Values vs references, shallow vs deep copy, structuredClone, Object.freeze
// Run: node lessons/02-javascript-essentials/examples/07-copying-values.js

// 1. Primitives are copied by value. Objects are shared by reference.
let a = 5;
let b = a;
b = 6;
console.log('1a.', a, b);

const p = { n: 1 };
const q = p; // q points at the SAME object
q.n = 2;
console.log('1b.', p.n, p === q);
console.log('1c.', { n: 1 } === { n: 1 }); // equal-looking, but two different objects

// 2. Arguments: JavaScript passes a copy of the reference ("pass by sharing").
//    Changing the object through it is visible outside. Re-pointing the parameter is not.
function mutate(obj) {
  obj.changed = true;
}
function reassign(obj) {
  obj = { replaced: true };
  return obj;
}
const target = {};
mutate(target);
reassign(target);
console.log('2.  ', target);

// 3. Shallow copy: the top level is new, the nested objects are still shared.
const original = { name: 'x', tags: ['a'], meta: { v: 1 } };
const copy = { ...original }; // Object.assign({}, original) and arr.slice() behave the same
copy.name = 'changed';
copy.tags.push('b');
console.log('3.  ', original.name, original.tags, '| tags shared:', copy.tags === original.tags);

// 4. Deep copy with the built-in structuredClone.
const deep = structuredClone(original);
deep.meta.v = 99;
deep.tags.push('c');
console.log('4a. ', original.meta.v, deep.meta.v, original.tags, deep.tags);

// It understands Date, Map, Set and even circular references.
const rich = { when: new Date(0), tags: new Set(['x']), table: new Map([[1, 'one']]) };
const richCopy = structuredClone(rich);
console.log('4b. ', richCopy.when instanceof Date, richCopy.tags instanceof Set, richCopy.table.get(1));
const loop = { name: 'loop' };
loop.self = loop;
const loopCopy = structuredClone(loop);
console.log('4c. ', loopCopy.self === loopCopy, loopCopy !== loop);

// 5. What structuredClone cannot do.
try {
  structuredClone({ run() {} });
} catch (err) {
  console.log('5a. ', err.name + ':', err.message);
}
class Point {
  constructor(x) {
    this.x = x;
  }
  double() {
    return this.x * 2;
  }
}
const pointCopy = structuredClone(new Point(2));
console.log('5b. ', pointCopy instanceof Point, typeof pointCopy.double, pointCopy);

// 6. The old JSON trick loses data silently.
const viaJson = JSON.parse(JSON.stringify({ when: new Date(0), gone: undefined, run() {}, bad: NaN }));
console.log('6.  ', viaJson);

// 7. Object.freeze: no changes to the top level. It is SHALLOW.
const frozen = Object.freeze({ a: 1, nested: { b: 2 } });
frozen.a = 99; // silently ignored in sloppy mode
frozen.extra = true; // silently ignored too
frozen.nested.b = 3; // allowed: nested is not frozen
console.log('7a. ', frozen, Object.isFrozen(frozen), Object.isFrozen(frozen.nested));

(function strictMode() {
  'use strict';
  try {
    frozen.a = 5;
  } catch (err) {
    console.log('7b. ', err.name + ':', err.message);
  }
  try {
    frozen.extra = 5;
  } catch (err) {
    console.log('7c. ', err.name + ':', err.message);
  }
})();

// Methods like push always throw on a frozen array, even in sloppy mode.
try {
  Object.freeze([1, 2]).push(3);
} catch (err) {
  console.log('7d. ', err.name + ':', err.message);
}

// A deep freeze walks down and freezes every nested object too.
function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (typeof child === 'object' && child !== null) deepFreeze(child);
  }
  return Object.freeze(value);
}
const settings = deepFreeze({ db: { host: 'localhost', ports: [1, 2] } });
settings.db.host = 'evil';
console.log('7e. ', settings.db.host, Object.isFrozen(settings.db.ports));

// 8. const and freeze solve different problems.
const fixed = { v: 1 };
fixed.v = 2; // allowed: const only stops re-pointing the variable
console.log('8.  ', fixed);

// 9. Three levels of locking an object (all shallow).
//    preventExtensions: no new properties.  seal: also no delete.  freeze: also no changes.
const noNew = Object.preventExtensions({ a: 1, b: 1 });
noNew.c = 3; // ignored: cannot add
delete noNew.b; // allowed
noNew.a = 2; // allowed
console.log('9a. ', noNew, Object.isExtensible(noNew));

const sealed = Object.seal({ a: 1 });
sealed.a = 2; // allowed: sealing keeps values changeable
sealed.b = 3; // ignored: cannot add
delete sealed.a; // ignored: cannot delete
console.log('9b. ', sealed, Object.isSealed(sealed), Object.isFrozen(sealed));

// 10. Object.defineProperty sets the hidden switches of a single property.
//     writable: can the value change?  enumerable: does it show in loops, keys and JSON?
//     configurable: can it be deleted or redefined?  All three default to false here.
const profile = { owner: 'Sara' };
Object.defineProperty(profile, 'id', { value: 42, writable: false, enumerable: false });
profile.id = 99; // ignored in sloppy mode
console.log('10a.', profile.id, Object.keys(profile), JSON.stringify(profile));
console.log('10b.', Object.getOwnPropertyDescriptor(profile, 'id'));
