// Generics, constraints, utility types and function overloads
// Shows: how one function or class works for many types without losing type information
// Run: node lessons/21-typescript-with-node/examples/07-generics-utility.ts

// 1. A generic function. T is a placeholder that is filled in from the argument.
function first<T>(items: T[]): T | undefined {
  return items[0];
}
const firstNumber = first([10, 20, 30]); // type: number | undefined
const firstWord = first(['a', 'b']); // type: string | undefined
console.log('1.', firstNumber, firstWord, first([]));

// 2. A constraint limits what T may be. "T extends { length: number }" means "anything with a length".
function longest<T extends { length: number }>(a: T, b: T): T {
  return a.length >= b.length ? a : b;
}
console.log('2.', longest('abc', 'de'), longest([1, 2], [1, 2, 3]));
// @ts-expect-error a number has no length
longest(10, 20);

// keyof gives the property names of a type. K extends keyof T means "K must be a real key of T".
function getProp<T, K extends keyof T>(object: T, key: K): T[K] {
  return object[key];
}
const server = { host: 'localhost', port: 3000 };
const port = getProp(server, 'port'); // type: number
console.log('   getProp:', port, getProp(server, 'host'));
// @ts-expect-error "path" is not a key of server
getProp(server, 'path');

// 3. A generic class. The same cache works for any key and value types.
class TypedCache<K, V> {
  #items = new Map<K, V>(); // #name is a real JavaScript private field
  set(key: K, value: V): this {
    this.#items.set(key, value);
    return this;
  }
  get(key: K): V | undefined {
    return this.#items.get(key);
  }
  get size(): number {
    return this.#items.size;
  }
}
const userCache = new TypedCache<number, { name: string }>();
userCache.set(1, { name: 'Asha' }).set(2, { name: 'Ben' });
console.log('3.', userCache.get(1)?.name, userCache.get(99), userCache.size);

// A default type: Page<T> means Page<unknown> when you give no type.
type Page<T = unknown> = { items: T[]; next: string | null };
const page: Page<number> = { items: [1, 2], next: null };
const anyPage: Page = { items: ['x', 1, true], next: '/page/2' };
console.log('   pages:', page.items.length, anyPage.items.length);

// 4. Utility types build new types from old ones. They exist only at compile time.
type User = { id: number; name: string; email: string; admin?: boolean };

type UserPatch = Partial<User>; // every property optional
type FullUser = Required<User>; // every property required (admin too)
type UserPreview = Pick<User, 'id' | 'name'>; // keep only these keys
type PublicUser = Omit<User, 'email'>; // drop these keys
type Roles = Record<'admin' | 'viewer', string[]>; // an object with exactly these keys
type FrozenUser = Readonly<User>; // every property readonly

function updateUser(user: User, patch: UserPatch): User {
  return { ...user, ...patch };
}
const asha: User = { id: 1, name: 'Asha', email: 'asha@example.com' };
const preview: UserPreview = { id: asha.id, name: asha.name };
const publicUser: PublicUser = { id: 1, name: 'Asha' };
const roles: Roles = { admin: ['asha'], viewer: [] };
const full: FullUser = { ...asha, admin: false };
const frozenUser: FrozenUser = Object.freeze({ ...asha });
console.log('4.', updateUser(asha, { name: 'Asha K.' }));
console.log('   ', preview, publicUser, roles, full.admin, Object.isFrozen(frozenUser));

// ReturnType, Parameters and Awaited read types out of a function.
async function fetchUser(id: number, includeEmail = false): Promise<User> {
  return { id, name: 'Asha', email: includeEmail ? 'asha@example.com' : '' };
}
type FetchArgs = Parameters<typeof fetchUser>; // [id: number, includeEmail?: boolean]
type FetchResult = ReturnType<typeof fetchUser>; // Promise<User>
type Fetched = Awaited<FetchResult>; // User (the promise is unwrapped)

const args: FetchArgs = [7, true];
const fetched: Fetched = await fetchUser(...args);
console.log('   fetched:', fetched);

// A mapped type loops over keys. This one makes every property "string | null".
type Nullable<T> = { [Key in keyof T]: T[Key] | null };
const row: Nullable<PublicUser> = { id: 1, name: null };
console.log('   mapped:', row);

// 5. Function overloads: several call signatures, one implementation.
// Callers only see the overload lines. The implementation line is hidden from them.
function toNumbers(input: string): number;
function toNumbers(input: string[]): number[];
function toNumbers(input: string | string[]): number | number[] {
  return Array.isArray(input) ? input.map(Number) : Number(input);
}
const one = toNumbers('42'); // type: number
const many = toNumbers(['1', '2']); // type: number[]
console.log('5.', one + 1, many.map((n) => n * 2));
