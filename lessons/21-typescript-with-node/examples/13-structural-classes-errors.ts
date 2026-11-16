// Structural typing, branded types, type assertions, classes and typed Node errors
// Shows: why TypeScript compares shapes not names, how to fake "name based" types, and what private really means
// Run: node lessons/21-typescript-with-node/examples/13-structural-classes-errors.ts

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 1. Structural typing: a value fits a type when it has the right SHAPE. The type's name does not matter.
type Point = { x: number; y: number };
type Vector = { x: number; y: number }; // different name, same shape
const vector: Vector = { x: 1, y: 2 };
const point: Point = vector; // fine: a Vector is accepted wherever a Point is expected
console.log('1.', point);

// Extra properties are allowed when the value is NOT a fresh object literal...
const labelled = { x: 3, y: 4, label: 'origin' };
const fromVariable: Point = labelled; // fine
console.log('   extra property survives at runtime:', fromVariable);
// ...but a fresh object literal is checked for typos ("excess property check").
// @ts-expect-error 'lable' does not exist in type 'Point' (the check catches the typo)
const fromLiteral: Point = { x: 1, y: 2, lable: 'oops' };
console.log('   the typo still ran:', fromLiteral);

// 2. Branded types. Two ids that are both "number" are interchangeable for the compiler.
// A brand adds a fake property that exists only in the type, so the two ids stop matching.
type Brand<Base, Name extends string> = Base & { readonly __brand: Name };
type UserId = Brand<number, 'UserId'>;
type OrderId = Brand<number, 'OrderId'>;

function toUserId(value: number): UserId {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`bad user id: ${value}`);
  return value as UserId; // the one place where we vouch for the brand, after a real check
}
function toOrderId(value: number): OrderId {
  return value as OrderId;
}
function loadUser(id: UserId): string {
  return `user #${id}`;
}
const userId = toUserId(7);
const orderId = toOrderId(7);
console.log('2.', loadUser(userId), typeof userId, userId + 1);
// @ts-expect-error an OrderId is not a UserId, although both are numbers
console.log('   mixed up ids still ran:', loadUser(orderId));
// @ts-expect-error a plain number has no brand
console.log('   plain number still ran:', loadUser(7));

// 3. Type assertions ("as") tell the compiler what to believe. They convert nothing and check nothing.
const lie = '5' as unknown as number; // "as unknown as" is the double cast: the escape hatch of last resort
console.log('3.', typeof lie, lie + 1); // still a string at runtime, so + glues text together
const maybe: string | undefined = process.env.SURELY_NOT_SET;
console.log('   non-null assertion on a missing value:', maybe!); // "!" is erased and checks nothing

// 4. Classes. Only the "erasable" parts of TypeScript classes run under type stripping.
interface Shape {
  area(): number;
}
abstract class Base implements Shape {
  readonly name: string; // declare the field...
  constructor(name: string) {
    this.name = name; // ...and assign it yourself (no parameter property)
  }
  abstract area(): number; // subclasses must provide this
  describe(): string {
    return `${this.name} with area ${this.area().toFixed(2)}`;
  }
}
class Circle extends Base {
  #radius: number; // a real JavaScript private field: truly hidden at runtime
  private colour = 'red'; // TypeScript-only private: erased, so it is a normal property at runtime
  constructor(radius: number) {
    super('circle');
    this.#radius = radius;
  }
  override area(): number {
    return Math.PI * this.#radius ** 2;
  }
}
const circle = new Circle(2);
console.log('4.', circle.describe());
console.log('   own keys:', Object.keys(circle)); // "name" and "colour" show up, "#radius" does not
// @ts-expect-error 'colour' is private, but only the compiler enforces that
console.log('   compiler says private, runtime says:', circle.colour);
// @ts-expect-error cannot create an instance of an abstract class
console.log('   abstract class is a compile-time rule only:', typeof new Base('x'));

// 5. Errors. A custom error class with extra data, and the cause chain.
class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HttpError';
    this.status = status;
  }
}
const wrapped = new HttpError(502, 'upstream failed', { cause: new Error('connection reset') });
console.log('5.', wrapped.name, wrapped.status, wrapped.message, '| cause:', (wrapped.cause as Error).message);

// Node system errors carry a "code" such as ENOENT. @types/node names that shape NodeJS.ErrnoException.
// A type guard lets you check the code without any cast.
function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
const dir = mkdtempSync(join(tmpdir(), 'ts-lesson-13-'));
try {
  readFileSync(join(dir, 'missing.txt'), 'utf8');
} catch (error) {
  if (isErrnoException(error) && error.code === 'ENOENT') {
    console.log('   file not found, code:', error.code, '| syscall:', error.syscall);
  } else {
    throw error; // anything else is a real bug: do not swallow it
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
