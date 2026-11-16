import { b, readA } from './b.mjs'; // b.mjs runs first, because a.mjs waits for its imports
console.log('  a.mjs: start (runs after b.mjs)');

export const a = 'value of a';
export function hoisted() {
  return 'hoisted function from a.mjs';
}

console.log('  a.mjs: b =', b);
console.log('  a.mjs: readA() =', readA());
