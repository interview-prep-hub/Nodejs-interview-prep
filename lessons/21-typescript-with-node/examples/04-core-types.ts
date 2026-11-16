// Core types: primitives, arrays, tuples, object types, interface vs type, union, intersection
// Shows: the everyday annotations, using Node-flavoured values (ports, files, callbacks)
// Run: node lessons/21-typescript-with-node/examples/04-core-types.ts

// 1. Primitives. Annotations are optional when the value makes the type obvious (inference).
const port: number = 3000;
const host = 'localhost'; // inferred: the literal type "localhost"
let retries = 3; // inferred: number
const big: bigint = 9007199254740993n;
let maybeName: string | undefined; // not assigned yet
console.log('1.', typeof port, host, retries, typeof big, maybeName);

// 2. Arrays and tuples. A tuple has a fixed length and a type for each position.
const files: string[] = ['a.txt', 'b.txt'];
const sizes: Array<number> = [120, 80]; // same thing, other spelling
const entry: [name: string, bytes: number] = ['a.txt', 120];
const [fileName, bytes] = entry;
console.log('2.', files.length, sizes[0] + sizes[1], fileName, bytes);

// Object.entries gives an array of [string, number] tuples.
const sizeByFile: Record<string, number> = { 'a.txt': 120, 'b.txt': 80 };
for (const [name, size] of Object.entries(sizeByFile)) console.log('   entry:', name, size);

// 3. Object types. "?" means optional. "readonly" means no reassigning after creation.
type ServerOptions = {
  readonly host: string;
  port: number;
  tls?: boolean;
};
const options: ServerOptions = { host: 'localhost', port: 8080 };
options.port = 8081; // fine
// options.host = 'example.com'; // compile error: Cannot assign to 'host' because it is a read-only property
console.log('3.', options, 'tls is', options.tls);

// 4. interface versus type alias. For plain object shapes they are almost the same.
interface Animal {
  name: string;
}
interface Dog extends Animal {
  breed: string;
}
type Cat = Animal & { indoor: boolean }; // & combines two types (intersection)
const rex: Dog = { name: 'Rex', breed: 'Beagle' };
const tom: Cat = { name: 'Tom', indoor: true };
console.log('4.', rex, tom);

// Only an interface can be declared twice. The two halves merge into one type.
interface Settings {
  theme: string;
}
interface Settings {
  fontSize: number;
}
const settings: Settings = { theme: 'dark', fontSize: 14 }; // needs both fields
console.log('   merged interface:', settings);

// Only a type alias can name a union, a tuple, or a primitive.
type Id = string | number; // union: one or the other
type Pair = [string, number]; // tuple
type Seconds = number; // alias for a primitive
const id: Id = 'u-42';
const pair: Pair = ['x', 1];
const timeout: Seconds = 30;
console.log('   alias examples:', id, pair, timeout);

// 5. Union: the value is ONE of the types. You must check which one before using it.
function formatId(value: Id): string {
  return typeof value === 'number' ? String(value).padStart(4, '0') : value.toUpperCase();
}
console.log('5.', formatId(7), formatId('abc'));

// 6. Function types. Node's classic callback shape is (error, result) => void.
type Callback = (error: Error | null, data?: string) => void;
function readLater(fail: boolean, done: Callback): void {
  if (fail) done(new Error('disk on fire'));
  else done(null, 'file contents');
}
readLater(false, (error, data) => console.log('6.', error, data));
readLater(true, (error, data) => console.log('   ', error?.message, data));

// A function that never returns normally has the return type "never"; one with no result returns "void".
function fail(message: string): never {
  throw new Error(message);
}
try {
  fail('stop');
} catch (error) {
  console.log('   never-returning function threw:', (error as Error).message);
}
