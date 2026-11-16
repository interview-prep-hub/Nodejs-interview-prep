// Narrowing: how TypeScript learns which type you really have after a check
// Shows: typeof, null checks, instanceof, in, discriminated unions, never, type guards, unknown vs any
// Run: node lessons/21-typescript-with-node/examples/06-narrowing.ts

// 1. typeof and null checks. Inside each branch the type is smaller.
function toPort(value: string | number): number {
  if (typeof value === 'string') return Number.parseInt(value, 10); // here value is a string
  return value; // here value is a number
}
function shout(text?: string | null): string {
  if (text == null) return '(nothing)'; // removes both null and undefined
  return text.toUpperCase(); // text is a string here
}
console.log('1.', toPort('8080'), toPort(3000), shout('hi'), shout(null));

// 2. instanceof. In strict mode a caught value has type "unknown", so you must check it.
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'unknown error';
}
try {
  JSON.parse('{ not json');
} catch (error) {
  console.log('2.', messageOf(error));
}
console.log('   ', messageOf('plain string'), '|', messageOf(42));

// 3. The "in" operator checks whether a property exists.
type Cat = { meow(): string };
type Dog = { bark(): string };
function speak(pet: Cat | Dog): string {
  return 'meow' in pet ? pet.meow() : pet.bark();
}
console.log('3.', speak({ meow: () => 'meow!' }), speak({ bark: () => 'woof!' }));

// 4. Discriminated union: every member has a "tag" property with a different literal value.
// Checking the tag narrows the whole object. This is the most useful pattern in real code.
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function parseJson(text: string): Result<unknown> {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}
for (const input of ['{"a":1}', 'oops']) {
  const result = parseJson(input);
  if (result.ok) console.log('4. parsed:', result.value);
  else console.log('4. failed:', result.error);
}

// 5. Exhaustiveness: "never" proves you handled every case.
type Shape = { kind: 'circle'; radius: number } | { kind: 'rect'; width: number; height: number };

function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
}
function area(shape: Shape): number {
  switch (shape.kind) {
    case 'circle':
      return Math.PI * shape.radius ** 2;
    case 'rect':
      return shape.width * shape.height;
    default:
      // If someone adds a third kind to Shape and forgets a case, THIS line becomes a compile error,
      // because the new kind is not "never".
      return assertNever(shape);
  }
}
console.log('5.', area({ kind: 'rect', width: 3, height: 4 }), area({ kind: 'circle', radius: 1 }).toFixed(2));

// 6. A user-defined type guard: a function whose return type is "value is Point".
// When it returns true, TypeScript treats the argument as Point.
type Point = { x: number; y: number };
function isPoint(value: unknown): value is Point {
  return (
    typeof value === 'object' &&
    value !== null &&
    'x' in value &&
    typeof value.x === 'number' &&
    'y' in value &&
    typeof value.y === 'number'
  );
}
const inputs: unknown[] = [{ x: 1, y: 2 }, { x: '1', y: 2 }, null, 'text'];
console.log('6.', inputs.map((item) => (isPoint(item) ? `point(${item.x},${item.y})` : 'not a point')));

// 7. any versus unknown.
// "any" switches the checker off for that value. "unknown" means "could be anything, check first".
const loose: any = JSON.parse('{"count": 1}');
try {
  console.log('7.', loose.settings.theme); // compiles, but there is no "settings"
} catch (error) {
  console.log('7. any crashed at runtime:', messageOf(error));
}

const safe: unknown = JSON.parse('{"count": 1}');
// @ts-expect-error cannot use an unknown value until you narrow it
console.log('    compiler refuses, Node prints:', safe.count);
if (typeof safe === 'object' && safe !== null && 'count' in safe) {
  console.log('    unknown, after narrowing:', safe.count);
}
