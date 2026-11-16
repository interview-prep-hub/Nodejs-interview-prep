'use strict';
// The bug: JSON.parse('{"__proto__":{"x":1}}') creates an OWN property named "__proto__".
// The buggy code reads target["__proto__"], which is Object.prototype, and merges into it.
// The fix: skip the dangerous keys, only read own keys, and never merge into an inherited object.
// (Another option: use Object.create(null) for targets, or a Map.)

const BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (BLOCKED.has(key)) continue;
    const value = source[key];
    if (isPlainObject(value)) {
      if (!Object.hasOwn(target, key) || !isPlainObject(target[key])) target[key] = {};
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

module.exports = { deepMerge };
