import { a, hoisted } from './a.mjs'; // circular: a.mjs imports b.mjs, b.mjs imports a.mjs
console.log('  b.mjs: start');

export const b = 'value of b';
export function readA() {
  return a;
}

// a.mjs has not run yet. Its `const a` exists but is not initialised (the "temporal dead zone").
try {
  console.log('  b.mjs: a =', a);
} catch (error) {
  console.log('  b.mjs: reading a ->', error.name + ':', error.message);
}

// Function declarations are set up before any code runs, so this works.
console.log('  b.mjs: hoisted() =', hoisted());
