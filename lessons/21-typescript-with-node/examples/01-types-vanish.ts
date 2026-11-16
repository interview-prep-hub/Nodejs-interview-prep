// Types vanish at runtime: Node removes them, so a wrong type still runs
// Shows: type annotations are erased, @ts-expect-error, and how JSON.parse fools the compiler
// Run: node lessons/21-typescript-with-node/examples/01-types-vanish.ts

type User = { name: string; age: number };

function describe(user: User): string {
  return `${user.name} is ${user.age}`;
}

console.log('1.', describe({ name: 'Asha', age: 31 }));

// 2. A compile-time error. tsc and your editor would flag the next call,
// because 'thirty' is not a number. The comment below tells tsc "I know".
// Node does not type check, so it simply runs the code.
// @ts-expect-error age must be a number
console.log('2.', describe({ name: 'Ben', age: 'thirty' }));

// 3. JSON.parse returns "any", so the compiler accepts any assignment.
// The data has no age, but the type says it does.
const text = '{"name":"Cara"}';
const parsed: User = JSON.parse(text);
console.log('3. compiler thinks age is a number, runtime says:', parsed.age);

try {
  parsed.age.toFixed(1);
} catch (error) {
  console.log('4. crash at runtime:', error instanceof Error ? error.message : error);
}

console.log('5. Node type stripping mode:', process.features.typescript);
