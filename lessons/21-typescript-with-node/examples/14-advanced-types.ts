// Advanced types: indexed access, mapped types, conditional types with infer, template literal types
// Shows: how types can be computed from other types, and how to test a type at compile time
// Run: node lessons/21-typescript-with-node/examples/14-advanced-types.ts

// Two tiny helpers to TEST types. They are erased before Node runs the file, so they cost nothing.
// If a check below is wrong, `tsc --noEmit` reports an error on that line. Node never notices.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

// 1. keyof typeof and indexed access types: read a type out of a VALUE or out of another type.
const routes = { home: '/', users: '/users', orders: '/orders' } as const;
type RouteName = keyof typeof routes; // 'home' | 'users' | 'orders'
type RoutePath = (typeof routes)[RouteName]; // '/' | '/users' | '/orders'
type ServerConfig = { http: { port: number; host: string }; debug: boolean };
type HttpPort = ServerConfig['http']['port']; // number
type _Check1 = [Expect<Equal<RoutePath, '/' | '/users' | '/orders'>>, Expect<Equal<HttpPort, number>>];

function pathOf(name: RouteName): RoutePath {
  return routes[name];
}
console.log('1.', Object.keys(routes), pathOf('users'));

// 2. Mapped types: build an object type by looping over the keys of another type.
type Flags<T> = { [K in keyof T]: boolean }; // same keys, every value is a boolean
type Mutable<T> = { -readonly [K in keyof T]: T[K] }; // "-readonly" removes readonly
type OnlyStrings<T> = { [K in keyof T as T[K] extends string ? K : never]: T[K] }; // "as" filters keys

type Account = { readonly id: number; name: string; email: string; admin: boolean };
type _Check2 = [
  Expect<Equal<Flags<Account>, { readonly id: boolean; name: boolean; email: boolean; admin: boolean }>>,
  Expect<Equal<Mutable<Account>['id'], number>>,
  Expect<Equal<OnlyStrings<Account>, { name: string; email: string }>>,
];

function stringFieldsOf<T extends object>(value: T): OnlyStrings<T> {
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (typeof field === 'string') result[key] = field;
  }
  return result as OnlyStrings<T>; // the compiler cannot follow a loop, so we vouch for it
}
const account: Account = { id: 1, name: 'Asha', email: 'asha@example.com', admin: true };
console.log('2.', stringFieldsOf(account));

// 3. Conditional types: a type-level "if". "infer" gives a name to a part you want to extract.
type IsString<T> = T extends string ? 'yes' : 'no';
type ElementOf<T> = T extends readonly (infer Item)[] ? Item : never;
type Unwrap<T> = T extends Promise<infer Inner> ? Inner : T;
type FirstArg<F> = F extends (first: infer A, ...rest: never[]) => unknown ? A : never;

// A conditional type applied to a union is applied to each member separately ("distributive"):
type _Check3 = [
  Expect<Equal<IsString<'a'>, 'yes'>>,
  Expect<Equal<IsString<number>, 'no'>>,
  Expect<Equal<IsString<string | number>, 'yes' | 'no'>>,
  Expect<Equal<ElementOf<string[]>, string>>,
  Expect<Equal<Unwrap<Promise<Account>>, Account>>,
  Expect<Equal<Unwrap<number>, number>>,
  Expect<Equal<FirstArg<(id: number, verbose?: boolean) => void>, number>>,
];

// A conditional type as a return type: the answer depends on the argument's type.
function describe<T extends string | number>(value: T): T extends string ? 'text' : 'number' {
  return (typeof value === 'string' ? 'text' : 'number') as T extends string ? 'text' : 'number';
}
const kindOfText = describe('hi'); // type: 'text'
const kindOfNumber = describe(5); // type: 'number'
console.log('3.', kindOfText, kindOfNumber);

// 4. Template literal types: types made from string pieces. They can build and check names.
type Capitalised<S extends string> = Capitalize<S>;
type HandlerName<Event extends string> = `on${Capitalised<Event>}`;
type ApiPath = `/api/v${1 | 2}/${'users' | 'orders'}`; // a union of 4 exact strings
type AnyApiUrl = `/api/${string}`; // any string that starts with "/api/"

type _Check4 = [
  Expect<Equal<HandlerName<'click' | 'close'>, 'onClick' | 'onClose'>>,
  Expect<Equal<ApiPath, '/api/v1/users' | '/api/v1/orders' | '/api/v2/users' | '/api/v2/orders'>>,
];

const path: ApiPath = '/api/v2/orders';
const url: AnyApiUrl = '/api/anything/goes';
// @ts-expect-error '/api/v3/users' is not one of the four allowed paths
const badPath: ApiPath = '/api/v3/users';
console.log('4.', path, url, badPath);

// 5. Putting it together: a recursive mapped type, and a typed "pick" helper.
type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T // leave functions alone
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;
const config: DeepReadonly<ServerConfig> = { http: { port: 8080, host: 'localhost' }, debug: false };
// @ts-expect-error even the nested object is readonly now
config.http.port = 9090;
console.log('5.', config.http.port, '(the write was refused by the compiler only, and it still ran)');

function pick<T extends object, K extends keyof T>(value: T, ...keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) result[key] = value[key];
  return result;
}
console.log('   ', pick(account, 'id', 'name'));
