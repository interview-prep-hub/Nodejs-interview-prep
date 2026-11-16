// Globals tour: a tiny taste of the objects Node gives you without any require
// Run: node lessons/01-introduction/examples/04-globals-tour.js

// process: information about this running program
console.log('1. process.platform is a string:', typeof process.platform === 'string');

// Buffer: raw bytes. "hi" is two bytes: 0x68 and 0x69.
console.log('2. Buffer.from("hi") as hex:', Buffer.from('hi').toString('hex'));

// setTimeout: run something later. In Node it returns an OBJECT, in a browser a number.
const timer = setTimeout(() => console.log('10. timer callback ran (after all the sync code)'), 10);
console.log('3. typeof setTimeout() result:', typeof timer);

// URL: take a web address apart
const url = new URL('https://example.com:8080/docs/intro?lang=en&page=2#top');
console.log('4. URL parts:', url.hostname, url.port, url.pathname, url.searchParams.get('page'), url.hash);

// structuredClone: a real deep copy (functions cannot be cloned)
const original = { when: new Date(0), tags: ['a', 'b'] };
const copy = structuredClone(original);
copy.tags.push('c');
console.log('5. original tags:', original.tags, '| copy tags:', copy.tags);
console.log('   Date survived the clone:', copy.when instanceof Date);

// AbortController: a switch that can cancel work (fetch, timers, streams understand it)
const controller = new AbortController();
controller.signal.addEventListener('abort', () => console.log('6. abort event fired'));
controller.abort();
console.log('   signal.aborted:', controller.signal.aborted, '| reason:', controller.signal.reason.name);

// TextEncoder: text to bytes (UTF-8). The letter "é" needs two bytes, so "hé" is three bytes.
console.log('7. TextEncoder bytes for "hé":', new TextEncoder().encode('hé'));

// fetch exists as a global function. We only check it here, because this example needs no internet.
console.log('8. fetch, Request, Response, Headers exist:',
  [fetch, Request, Response, Headers].every((x) => typeof x === 'function'));

// globalThis: the object that holds all of these
const names = ['process', 'console', 'Buffer', 'setTimeout', 'URL', 'fetch', 'structuredClone', 'AbortController'];
console.log('9. all on globalThis:', names.every((n) => n in globalThis));
