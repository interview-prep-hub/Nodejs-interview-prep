// Literal types, as const, enum alternatives, satisfies and readonly
// Shows: how to get the safety of an enum without using the enum keyword (Node cannot strip enums)
// Run: node lessons/21-typescript-with-node/examples/05-literals-and-const.ts

// 1. A literal type is one exact value. A union of literals is a small "menu" of allowed values.
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

function request(method: HttpMethod, url: string): string {
  return `${method} ${url}`;
}
console.log('1.', request('GET', '/users'));
// @ts-expect-error 'get' (lower case) is not on the menu
console.log('   ', request('get', '/users'));

// 2. Widening: a plain object property is typed as "string", not as the literal 'GET'.
// "as const" freezes the TYPES to the exact literals and makes every property readonly.
const loose = { method: 'GET', url: '/a' }; // method: string
const exact = { method: 'GET', url: '/a' } as const; // method: 'GET'
// @ts-expect-error string is wider than HttpMethod
request(loose.method, loose.url);
console.log('2.', request(exact.method, exact.url));

// 3. Enum alternative: an "as const" object plus a type with the SAME name.
// This is plain JavaScript at runtime, so Node can run it with no flag.
const Level = { Debug: 'debug', Info: 'info', Warn: 'warn' } as const;
type Level = (typeof Level)[keyof typeof Level]; // 'debug' | 'info' | 'warn'

function log(level: Level, message: string): void {
  console.log(`   [${level}] ${message}`);
}
console.log('3. values at runtime:', Object.values(Level));
log(Level.Info, 'server started');
log('warn', 'a plain string works too, if it is on the menu');
// @ts-expect-error 'trace' is not one of the levels
log('trace', 'nope');

// The even simpler alternative is just the union type. It has zero runtime code.
type Mode = 'development' | 'production';
const mode: Mode = 'development';
console.log('   union only:', mode);

// 4. satisfies: check a value against a type WITHOUT widening the value's own type.
const defaults = { port: 3000, host: 'localhost' } satisfies Record<string, string | number>;
// The type of defaults.port is still number (not string | number), so number methods work:
console.log('4.', defaults.port.toFixed(1), defaults.host.toUpperCase());
// A typo in a key is still caught, because defaults keeps its exact keys:
// @ts-expect-error there is no "prot" key
console.log('   ', defaults.prot);

// Compare with an annotation: the annotation widens, so every property is "string | number".
const annotated: Record<string, string | number> = { port: 3000, host: 'localhost' };
// @ts-expect-error the compiler now only knows "string | number", and a string has no toFixed
console.log('   with annotation only:', annotated.port.toFixed(1));

// 5. readonly is a compile-time promise. Object.freeze is the runtime enforcement.
const allowed: readonly string[] = ['GET', 'POST'];
// @ts-expect-error readonly arrays have no push
allowed.push('PUT');
console.log('5. readonly array was mutated anyway:', allowed);

const frozen = Object.freeze(['GET', 'POST']);
try {
  (frozen as string[]).push('PUT');
} catch (error) {
  console.log('   frozen array refuses at runtime:', (error as Error).message);
}
