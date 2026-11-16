# 21. TypeScript with Node.js

> Level: Advanced   Time: about 210 minutes   Node: 24 (notes where older versions differ)

[Previous: 20. Security and the crypto Module](../20-security-and-crypto/README.md) | [All lessons](../../README.md) | [Next: 22. Modern Node.js: What Changed in Node 18, 20, 22 and 24](../22-modern-node-features/README.md)

## What you will learn
- What TypeScript gives you, and the one thing it never does (check data at runtime).
- How Node 24 runs `.ts` files by itself (type stripping), what it refuses to run, and the older routes (tsc, tsx, ts-node, esbuild, swc, bundlers).
- The `tsconfig.json` options that matter for Node, and why `@types/node` exists.
- The type system from scratch, with Node examples: structural typing, unions, literals, generics, utility types, narrowing, `unknown`, `satisfies`, overloads, classes, and a taste of advanced types (mapped, conditional, template literal).
- How to type async code, callbacks, errors, `EventEmitter`, environment variables and HTTP handlers.
- How to validate data at runtime (type guards, assertion functions, zod) and read `.d.ts` files and DefinitelyTyped.
- How to read common compile errors, lay out a project, choose between "ship compiled JS" and "run `.ts` directly", and migrate a JavaScript project step by step.

**How to use this lesson.** Every example runs with plain `node` on Node 24. The `.ts` files are ordinary TypeScript with no build step. Run them from the repo root, for example `node lessons/21-typescript-with-node/examples/01-types-vanish.ts`.

One important thing to understand first: **Node runs the files but never checks the types.** The examples contain lines marked `// @ts-expect-error`. Those lines are real type errors that the TypeScript compiler would report, and Node runs them anyway. This is on purpose, so you can see the difference between "the compiler objects" and "the program crashes".

The real TypeScript compiler is called `tsc`. It is not installed in this repo (the repo has no dependencies), so everything that needs it is shown as a labelled snippet:

| Part of the lesson | Runs with plain `node`? | Needs `tsc` or an editor? |
|---|---|---|
| The 14 example files | Yes | Only to see the type errors |
| `tsconfig.json` files in `examples/_helpers/` | Not read by Node | Yes, they configure `tsc` |
| Compile errors shown in tables | No | Yes, they are messages from `tsc` |
| Express, zod, `@types/express` snippets | No (third-party packages) | Yes, plus `npm install` |

You do not need to install anything to follow along. If you use VS Code, red underlines and hover types already work in `.ts` files, because VS Code bundles TypeScript. To run `tsc` yourself, create a scratch project and run `npm install --save-dev typescript @types/node`.

---

## 1. Why TypeScript, and what it does not do

TypeScript (TS) is JavaScript plus a type system. A **type** is a label that says what kind of value something holds: a number, a string, an object with a `name` and an `age`. You write the labels. A tool called the **type checker** reads them and warns you when the code does not match.

Why teams use it:

- **Catch bugs before runtime.** A typo in a property name, a missing argument or a forgotten `null` is a red underline in your editor, not a crash in production.
- **Editor help.** Autocomplete, hover documentation and "go to definition" all work because the editor knows the shapes.
- **Safe refactoring.** Rename a field and the compiler lists every place that breaks.
- **Documentation that cannot go stale.** A signature like `(id: number) => Promise<User>` says what goes in and what comes out. A comment can lie. A type is checked.

What TypeScript does **not** do: it adds no checks while the program runs. Types are **erased** (removed) before the code runs. What actually runs is plain JavaScript.

Example `examples/01-types-vanish.ts` (shortened):

```ts
type User = { name: string; age: number };

function describe(user: User): string {
  return `${user.name} is ${user.age}`;
}

// @ts-expect-error age must be a number
console.log('2.', describe({ name: 'Ben', age: 'thirty' }));

const parsed: User = JSON.parse('{"name":"Cara"}'); // JSON.parse returns "any"
console.log('3. compiler thinks age is a number, runtime says:', parsed.age);
```

Run it:

```bash
node lessons/21-typescript-with-node/examples/01-types-vanish.ts
```

```text
1. Asha is 31
2. Ben is thirty
3. compiler thinks age is a number, runtime says: undefined
4. crash at runtime: Cannot read properties of undefined (reading 'toFixed')
5. Node type stripping mode: strip
```

Why this output:

- Line 2 is a type error. The comment `// @ts-expect-error` tells the compiler "I know this is wrong, do not complain". Node does not type check at all, so the call simply runs and `age` is the string `'thirty'`.
- Line 3: `JSON.parse` returns the type `any`, which means "anything goes". The compiler accepts the assignment to `User`. The data has no `age`, so the type is a lie.
- Line 4 is the crash that the type was supposed to prevent.

Think of two separate jobs:

```text
 your .ts file
     |
     |-- job 1: CHECK the types  (tsc, or your editor)   -> a list of errors for you to fix
     |
     '-- job 2: RUN the program   (Node removes the types, then runs the JavaScript)
```

Node 24 does job 2 only. Job 1 needs `tsc` (the TypeScript compiler) or an editor with TypeScript support.

> **Interview tip:** "TypeScript is a compile-time tool. Types are erased before the program runs, so it cannot protect you from bad data that arrives at runtime (network, files, user input). You still validate at the boundary." Saying this clearly separates a strong answer from "TypeScript makes JavaScript safe".

---

## 2. Running TypeScript in Node 24 (type stripping)

**Type stripping** means Node reads your `.ts` file and removes the type annotations, then runs what is left as JavaScript. You do not install anything and you do not pass a flag.

```bash
node lessons/21-typescript-with-node/examples/01-types-vanish.ts
```

How it got here (the facts for this course):

| Node version | What changed |
|---|---|
| 22.6.0 | `--experimental-strip-types` flag added |
| 22.7.0 | `--experimental-transform-types` flag added (for enums and similar, see section 3) |
| 22.18.0 (and 23.6.0) | Type stripping is on by default |
| 24.3.0 (22.18.0 too) | The "experimental" warning is gone |
| 24.12.0 (25.2.0 too) | Marked stable |
| 26.0.0 | `--experimental-transform-types` removed |

On Node 24 `process.features.typescript` is `'strip'`. Use `--no-strip-types` to switch it off.

> **Version note:** on Node 22.6 to 22.17 you must pass `--experimental-strip-types` yourself (Node 23.0 to 23.5 too). Node 20 and older cannot run `.ts` files at all: use `tsx` or compile first. The examples in this lesson need Node 22.18+ or 24+ (they were run on 24.16.0).

The rules, in one list. Learn these, interviewers like them:

1. **Erasable syntax only.** Node can only delete types. If a feature needs generated JavaScript (enums, runtime namespaces, constructor parameter properties), it is refused. See section 3.
2. **Imports need the real file name.** Write `import { x } from './x.ts'`, with the `.ts` extension. Node does no guessing.
3. **Type-only imports need the word `type`.** Node strips one file at a time and never opens the imported file, so it cannot know that `Shape` is only a type. You tell it: `import type { Shape } from './shapes.ts'`.
4. **Node does not read `tsconfig.json`.** Settings like `paths`, `target` or `strict` have no effect at runtime.
5. **No type checking.** `const x: number = 'string'` runs.
6. **Not inside `node_modules`.** A `.ts` file in a package under `node_modules` is refused with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. Libraries must publish JavaScript (plus `.d.ts` files).

> **Interview tip:** "Can Node run TypeScript?" A strong answer: "Yes, since 22.18 and 24 with no flag. Node removes the type annotations and runs the rest. It supports only erasable syntax, so no enums, namespaces or parameter properties, it needs `.ts` in import paths, it ignores `tsconfig.json`, and it does not type check. I still run `tsc --noEmit` in CI." Naming the limits is what shows you have really used it.

### What Node actually does to the file

Node does not delete the types. It **overwrites them with spaces**. Example `examples/02-see-the-stripping.ts` uses `module.stripTypeScriptTypes()`, the function Node uses for this (it is experimental, so it prints a warning on stderr):

```ts
import { stripTypeScriptTypes } from 'node:module';

const after = stripTypeScriptTypes(before);
console.log('   length equal:', before.length === after.length);
```

```bash
node lessons/21-typescript-with-node/examples/02-see-the-stripping.ts
```

```text
1. Same length, same lines (so error positions stay correct):
   length equal: true
   line count equal: true

2. Line by line. The ^ marks every character that was blanked:
   interface Point { x: number; y: number }
   ^^^^^^^^^ ^^^^^ ^ ^^ ^^^^^^^ ^^ ^^^^^^ ^
   function length(p: Point): number {
                    ^ ^^^^^ ^ ^^^^^^
     return Math.hypot(p.x, p.y);
   }

3. What is left to run:
   (blank line)
   function length(p       )         {
     return Math.hypot(p.x, p.y);
   }

4. strip mode: ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX
   TypeScript enum is not supported in strip-only mode

5. transform mode output:
var Color = /*#__PURE__*/ function(Color) {
    Color[Color["Red"] = 0] = "Red";
    Color[Color["Green"] = 1] = "Green";
    return Color;
}(Color || {});
```

> **Under the hood:** because the text keeps the same length and the same lines, every line and column number in an error stack still points at your original `.ts` file. No source maps are needed. (Checked: a `throw` on line 4, column 9 of a `.ts` file reports `main.ts:4:9`.) Node does this with a library called Amaro (`process.versions.amaro` is `1.1.9` on Node 24.16.0), which is a wrapper around the swc TypeScript parser.

### Module system for `.ts` files

A `.ts` file follows the same rules as a `.js` file (see lesson 03 for ES modules, the `import`/`export` style, versus CommonJS, the `require`/`module.exports` style):

| File | Module system |
|---|---|
| `.ts` | decided by `"type"` in the nearest `package.json` (`"module"` = ES modules, otherwise CommonJS; with no `"type"`, Node detects `import`/`export` and treats the file as ES module) |
| `.mts` | always ES modules |
| `.cts` | always CommonJS (`require`, `__dirname`) |

Both `.mts` (no `require`, `import` works) and `.cts` (`require` and `__dirname` work) behave this way on Node 24. Details to know:

- If a `.ts` file uses `import` but the `package.json` has no `"type"`, Node still runs it, but prints a warning on stderr:

  ```text
  [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///.../02-see-the-stripping.ts is not specified and it doesn't parse as CommonJS.
  Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
  To eliminate this warning, add "type": "module" to ...package.json.
  ```

  That is why the folder `examples/` has a tiny `package.json` containing `{ "type": "module" }`. In a real project you put `"type": "module"` in your own `package.json`. (The warning needs a `package.json` that lacks `"type"`. A `.ts` file with `import` and no `package.json` anywhere above it printed no warning.)
- The other everyday Node tools work with `.ts` files too: `node --watch src/app.ts` (restarts on change), `node --test` (finds `*.test.ts` files by default), and `node --input-type=module-typescript -e "const x: number = 5; console.log(x * 2)"` (prints `10`).

---

## 3. What type stripping cannot run

Anything that must be **turned into** JavaScript, instead of just deleted, is refused. Example `examples/03-what-fails.ts` runs five small bad files in child processes and prints the first error line of each:

```bash
node lessons/21-typescript-with-node/examples/03-what-fails.ts
```

```text
enum
  exit code: 1
  SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript enum is not supported in strip-only mode
constructor(private owner: string)
  exit code: 1
  SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript parameter property is not supported in strip-only mode
namespace with a value inside
  exit code: 1
  SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript namespace declaration is not supported in strip-only mode
import from './greeting' (no .ts)
  exit code: 1
  Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../greeting'
import { Shape } where Shape is an interface
  exit code: 1
  SyntaxError: The requested module '.../shapes.ts' does not provide an export named 'Shape'

same enum file with --experimental-transform-types
  exit code: 0, printed: 1
  ExperimentalWarning: Transform Types is an experimental feature and might change at any time

any .ts file, with --no-strip-types
  TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts"
```

(The output above was captured on Windows. On Linux and macOS the file paths use `/`, which the example hides, so the printed lines should be the same. A `namespace` that holds only types, such as `namespace N { export type T = number }`, is erased and does run.)

The full list, checked on Node 24.16.0:

| Syntax | Runs? | What to do instead |
|---|---|---|
| `interface`, `type`, generics, `as`, `satisfies`, `x!`, optional `?` | Yes | nothing, they are erased |
| `abstract`, `override`, `private`/`public`/`readonly` on normal fields, `declare ...` | Yes | nothing |
| `import type`, `import { type X }` | Yes | this is the right way to import types |
| `enum`, `const enum` | No | an `as const` object or a union of strings (section 10) |
| `constructor(private x: number)` (parameter property) | No | declare the field, then assign it in the constructor |
| `namespace Foo { export const ... }` | No | a normal module, or a plain object |
| `import fs = require('fs')`, `export = x` | No | `import fs from 'node:fs'`, `export default x` |
| `<Type>value` (angle bracket cast) | No | `value as Type` |
| Decorators (`@Injectable()`), `accessor` fields | No | compile first (frameworks built on decorators, such as NestJS, need a build step) |
| JSX / `.tsx` | No | compile first |
| Importing `./x` without `.ts` | No | write `./x.ts` |
| `import { Shape }` where `Shape` is a type | No | `import type { Shape }` |

> **Remember:** one test predicts all of this. "If I blank out the type parts with spaces, is what is left valid JavaScript that does the same job?" If yes, it runs. A parameter property fails the test, because the hidden `this.owner = owner` assignment would have to be generated. An `enum` fails it, because the object has to be built. An `interface` passes, because nothing is left.

The escape hatch is `node --experimental-transform-types file.ts`. It makes enums, namespaces and parameter properties work (and prints an experimental warning). It was added in Node 22.7, is still there on Node 24, and **was removed in Node 26**, so do not build on it. If you need those features, use a real compiler.

Fix for the parameter property, in plain erasable TypeScript:

```ts
class Account {
  private owner: string;               // 1. declare the field
  constructor(owner: string) {         // 2. take a normal parameter
    this.owner = owner;                // 3. assign it yourself
  }
}
```

> **Common mistake:** writing `import { helper } from './helper.js'` inside a `.ts` file. `tsc` accepts it (it maps `.js` to the `.ts` file next to it, a habit from before TypeScript 5.7). But when Node runs the `.ts` directly, there is no `helper.js` on disk and you get `ERR_MODULE_NOT_FOUND`. Both behaviours were tested. When you run `.ts` directly, write `./helper.ts`.

---

## 4. The older routes: tsc, tsx, ts-node, esbuild, swc, bundlers

Before Node could strip types, you needed a tool in front of Node. They are still used, because they handle syntax that type stripping refuses, and because only `tsc` checks types.

Three words you will hear:

- **Compile** (or **transpile**): turn TypeScript source into JavaScript source. The files it writes are said to be **emitted**.
- **Bundle**: join many source files into one or a few files, often shrinking them as well.
- **Type check**: only look for type errors and write nothing. For `tsc` this is the flag `--noEmit`.

| Tool | Checks types? | Handles enum, decorators, JSX? | What it is |
|---|---|---|---|
| `node file.ts` (type stripping) | No | No | Built in. Nothing to install. |
| `tsc` | **Yes** | Yes (it emits JavaScript) | The official compiler. Also the reference type checker. |
| `tsx` | No | Yes | `npx tsx file.ts`. Runs TS on top of Node using esbuild. `tsx watch` restarts on change. |
| `ts-node` | Yes (unless `--transpile-only`) | Yes | Older runner. Its `latest` version on npm is still 10.9.2 and its ESM support was always awkward. Most new projects use `tsx` or native Node instead. |
| `esbuild`, `swc` | No | Yes | Very fast compilers (written in Go and Rust). They only remove or convert syntax. |
| Bundlers (Vite, webpack, Rollup, tsup) | Usually no | Yes | Combine many files into one or a few, often using esbuild or swc inside. |

How the runners work: `tsx` and `ts-node` hook into Node's module loading. When Node asks for a `.ts` file, they convert it to JavaScript in memory and hand the result to Node, and nothing is written to disk. `esbuild` and `swc` do the same kind of conversion very fast because they only remove or rewrite syntax and skip type checking. Native type stripping is the same idea, built into Node, limited to deleting types.

The route that uses `tsc` alone is "compile, then run". It was tested with TypeScript 5.9.3 and 6.0.3. The `tsc` command is not installed in this repo, so this is a snippet:

```bash
# Needs: npm install --save-dev typescript @types/node
npx tsc -p tsconfig.build.json    # reads src/*.ts, writes dist/*.js
node dist/index.js                # plain JavaScript, any Node version that supports the syntax
```

The compiled `dist/index.js` of a two-file test project looked like this. Notice the import ended in `.js` and the types are gone:

```js
import { greet } from "./greet.js";
const g = greet('Asha');
console.log(g.text, process.version);
//# sourceMappingURL=index.js.map
```

Bun and Deno also run TypeScript directly, but they are different runtimes, not Node.

`tsc --noEmit` is the type gate. Add `--watch` (`tsc --noEmit --watch`) to keep it running in a second terminal and see errors as you save.

> **Interview tip:** The key sentence is "only `tsc` checks types; every other tool just removes them". A good answer for "how would you set up TypeScript for a new Node service today?" is: run `.ts` directly with Node 24 (or `tsx` if you need enums or decorators), run `tsc --noEmit` in CI and in the editor as the type gate, and compile with `tsc` or a bundler only when you ship a library or need a build.

---

## 5. tsconfig.json essentials for Node

`tsconfig.json` is the settings file for `tsc` and for your editor. **Node does not read it.** (`npx tsc --init` writes a starter file. In TypeScript 6.0.3 it is about 45 lines, and it also turns on options this lesson leaves out, such as `jsx` and `exactOptionalPropertyTypes`. The shorter one below is easier to learn from.) The file `examples/_helpers/tsconfig.json` is a ready-to-copy config for the "Node runs `.ts` directly, `tsc` only checks" setup:

```jsonc
{
  "compilerOptions": {
    // What the code will run on
    "target": "es2024",
    "lib": ["es2024"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "types": ["node"],

    // Be strict. This is the setting that gives TypeScript its value.
    "strict": true,

    // Make tsc agree with what Node will really do with the files
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,

    // Quality of life
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

What each option does:

| Option | Meaning | Value for Node 24 |
|---|---|---|
| `target` | Which JavaScript version the compiler assumes and emits. | `es2024` (Node 24 runs it) |
| `lib` | Which built-in types exist (`Array`, `Promise`, `Map`...). | `["es2024"]`. If you leave it out, TypeScript 6.0.3 also loads the browser DOM types, so `document` compiles in a Node project (checked). |
| `module` | The module system rules. `nodenext` copies Node's real rules (ES modules vs CommonJS, file extensions, `exports`). | `nodenext` |
| `moduleResolution` | How `import` paths are found. `module: nodenext` already implies `nodenext`. The other popular value, `bundler`, is relaxed (no extensions needed) and is meant for code that Vite, esbuild or webpack will bundle, not for code Node loads itself. | `nodenext` |
| `types` | Which `@types/*` packages load automatically (see section 6). | `["node"]` |
| `strict` | Turns on a bundle of checks: `strictNullChecks`, `noImplicitAny`, `useUnknownInCatchVariables` and more. | `true` |
| `esModuleInterop` | Lets you write `import fs from 'node:fs'` for CommonJS-style modules. | `true` |
| `skipLibCheck` | Do not type check the `.d.ts` files of your dependencies. Faster, avoids errors in other people's typings. | `true` |
| `noEmit` | Write no output files. `tsc` only checks. | `true` when Node runs the `.ts` |
| `allowImportingTsExtensions` | Allows `import './x.ts'`. Needed when nothing is emitted. | `true` with `noEmit` |
| `verbatimModuleSyntax` | Keep imports exactly as written, so you must say `import type` for types. This matches how Node strips files. It also implies the `isolatedModules` rules (every file must make sense on its own). | `true` |
| `erasableSyntaxOnly` | Makes `tsc` report an error (TS1294) on syntax Node cannot strip: enums, runtime namespaces, parameter properties, `import = require`, `export =`, angle bracket casts. TypeScript 5.8+. | `true` |
| `outDir`, `rootDir` | Where compiled JavaScript goes, and the root of the sources. | `dist`, `src` (build config) |
| `rewriteRelativeImportExtensions` | When compiling, rewrite `./x.ts` to `./x.js` in the output. TypeScript 5.7+. | `true` (build config) |
| `include` / `exclude` | Which files `tsc` looks at. | `["src"]`, and exclude test files from the build config |

One optional extra: `noUncheckedIndexedAccess` makes `array[0]` and `record[key]` typed `T | undefined`. It is not part of `strict`, and it is left out of the snippet. Section 7 shows why it exists.

When you **compile** and ship `dist/`, use a second file, `examples/_helpers/tsconfig.build.json`, which extends the first and turns emitting on:

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src",
    "rewriteRelativeImportExtensions": true,
    "sourceMap": true,
    "declaration": true
  },
  "exclude": ["**/*.test.ts"]
}
```

Both files were tested with TypeScript 5.9.3 and 6.0.3 (with `@types/node` installed). The check config passed, the build config produced `dist/*.js`, `*.d.ts` and `*.js.map`, and `node dist/index.js` printed its output.

Two defaults changed between versions (both tested):

| Behaviour | TypeScript 5.9.3 | TypeScript 6.0.3 |
|---|---|---|
| `strict` when you do not set it | off | **on** |
| `@types/*` packages loaded automatically | all of them | **none**, you must list `"types": ["node"]` |

The lesson: **write `strict` and `types` explicitly** so your config does not depend on the compiler version.

> **Common mistake:** using this config with `import` statements in a project whose `package.json` has no `"type": "module"`. With `verbatimModuleSyntax` on, `tsc` then reports `error TS1295: ECMAScript imports and exports cannot be written in a CommonJS file under 'verbatimModuleSyntax'` (seen with TypeScript 6.0.3). Add `"type": "module"` to `package.json` (or name the files `.mts`).

> **Version note:** this lesson was verified with TypeScript 5.9.3 and 6.0.3. On 2026-11-10 the npm `latest` tag for `typescript` is 7.0.2, which was not run for this lesson. If something behaves differently, check `npx tsc --version` and the release notes.

Because Node ignores `tsconfig.json`, its `paths` option (import aliases like `@/utils`) does nothing at runtime. Use Node's own mechanism, **subpath imports**, which both Node and `tsc` understand:

```json
{ "type": "module", "imports": { "#lib/*": "./lib/*.ts" } }
```

```ts
import { greet } from '#lib/greet';   // Node resolves it to ./lib/greet.ts
```

This was run on Node 24.16 and type checked with `tsc` 5.9.3 and 6.0.3. Keys in `imports` must start with `#`.

> **Interview tip:** "Node ignores tsconfig. It is for `tsc` and the editor. With native type stripping, `erasableSyntaxOnly` and `verbatimModuleSyntax` make `tsc` complain about exactly the things Node would refuse, so you find out in the editor instead of at startup."

---

## 6. @types/node and DefinitelyTyped

Node's built-in modules (`fs`, `http`, `process`, `Buffer`) are written in JavaScript and C++. They carry no TypeScript types. To get types for them you install a package of **declaration files** called `@types/node`:

```bash
# Needs: npm install (typescript and @types/node are dev dependencies)
npm install --save-dev typescript @types/node@24
```

Match the `@types/node` major version to the Node major you run (here 24). On 2026-11-10 the `latest` tag of `@types/node` is 26.x, so a plain `npm install @types/node` would describe APIs that Node 24 may not have.

Without it, `tsc` says this (real message from TypeScript 6.0.3):

```text
src/index.ts(4,21): error TS2591: Cannot find name 'process'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.
```

**DefinitelyTyped** is a big community repository on GitHub. Every package published on npm under the `@types/` scope comes from it (`@types/node`, `@types/express`, `@types/pg`...). Rules of thumb:

- Many modern packages ship their own types (their `package.json` has a `types` field). Then you install nothing extra.
- Older JavaScript-only packages get `@types/<name>` from DefinitelyTyped.
- Types are only types. They do not add code. They go in `devDependencies`.

> **Interview tip:** "Why does `tsc` say it cannot find the name `process`?" Answer: "The compiler has no idea what Node provides. `@types/node` describes `process`, `Buffer`, `fs` and the other built-ins, and with TypeScript 6 it also has to be listed in `types` in `tsconfig.json`." Add that the version should match your Node major.

---

## 7. The core types

Example `examples/04-core-types.ts`. The main ideas, in order:

```ts
// Primitives: string, number, boolean, bigint, symbol, null, undefined
const port: number = 3000;
const host = 'localhost';        // inference: TypeScript works out the type for you
let maybeName: string | undefined;

// Arrays and tuples (a tuple has a fixed length and a type per position)
const files: string[] = ['a.txt', 'b.txt'];
const entry: [name: string, bytes: number] = ['a.txt', 120];

// Object types: "?" = optional, "readonly" = cannot be reassigned
type ServerOptions = {
  readonly host: string;
  port: number;
  tls?: boolean;
};

// Function types. Node's classic callback shape:
type Callback = (error: Error | null, data?: string) => void;
```

An **annotation** is a type you write yourself, like `: number`. **Inference** means the compiler works the type out for you, so you do not annotate everything. `const host = 'localhost'` is already known to be the string `'localhost'`. A good rule: annotate function parameters and public return types, let the compiler infer local variables.

```bash
node lessons/21-typescript-with-node/examples/04-core-types.ts
```

```text
1. number localhost 3 bigint undefined
2. 2 200 a.txt 120
   entry: a.txt 120
   entry: b.txt 80
3. { host: 'localhost', port: 8081 } tls is undefined
4. { name: 'Rex', breed: 'Beagle' } { name: 'Tom', indoor: true }
   merged interface: { theme: 'dark', fontSize: 14 }
   alias examples: u-42 [ 'x', 1 ] 30
5. 0007 ABC
6. null file contents
    disk on fire undefined
   never-returning function threw: stop
```

Reading the output: `typeof` is the ordinary JavaScript operator and still works (line 1). `maybeName` was declared but never assigned, so it prints `undefined`. The tuple `entry` is a normal array at runtime (line 2). Line 6 shows the error-first callback, called once with an error and once with data.

Two special return types: `void` (the function returns nothing useful) and `never` (the function never returns normally, because it throws or loops forever).

Two gotchas in these basics (both checked with `tsc` 6.0.3):

- **Indexing is optimistic.** `files[5]` is typed `string`, not `string | undefined`, even though it is `undefined` at runtime, because the compiler does not know how long the array is. The option `noUncheckedIndexedAccess` (section 5) fixes this, at the price of a few more `?.` and `!`.
- **A `void` callback may return a value.** `const cb: () => void = () => 42;` compiles. In a callback type, `void` means "the result will be ignored", not "it must return nothing". That is why `[1, 2].forEach((n) => n * 2)` is fine.

> **Interview tip:** "Do you annotate everything?" Strong answer: "No. I annotate function parameters and exported return types, because that is the contract other code relies on, and I let inference handle local variables. Over-annotating adds noise and can hide the exact type the compiler already knows."

---

## 8. Structural typing, and interface vs type alias

### Structural typing

TypeScript compares the **shape** of a value, not the name of its type. This is called **structural typing**. If a value has the properties a type asks for, it fits, whatever it was called when it was made. (Java and C# are different: they compare names. That is called nominal typing.) Example `examples/13-structural-classes-errors.ts`:

```ts
type Point = { x: number; y: number };
type Vector = { x: number; y: number };   // another name, the same shape

const vector: Vector = { x: 1, y: 2 };
const point: Point = vector;              // fine: the shapes match

const labelled = { x: 3, y: 4, label: 'origin' };
const fromVariable: Point = labelled;     // fine: extra properties are allowed here
const fromLiteral: Point = { x: 1, y: 2, lable: 'oops' };   // compile error (see below)
```

Why this design: JavaScript code passes plain objects around, and it never says what "class" they are. Shape checks fit that style.

There is one extra rule, the **excess property check**. When you write a fresh object literal straight into a typed place, extra properties are an error (`TS2353`), because a typo like `lable` is far more likely than a deliberate extra field. A value that already lives in a variable is not checked this way.

Run it (the example also covers branded types, assertions, classes and errors, so its output is shown piece by piece in sections 8, 11 and 17):

```bash
node lessons/21-typescript-with-node/examples/13-structural-classes-errors.ts
```

The first lines of output:

```text
1. { x: 1, y: 2 }
   extra property survives at runtime: { x: 3, y: 4, label: 'origin' }
   the typo still ran: { x: 1, y: 2, lable: 'oops' }
```

Types do not change values. The extra property is still there at runtime, and the typo ran, because Node does not check types. Section 11 shows how to make two types that have the same shape but still cannot be mixed up (branded types).

### interface vs type alias

The classic interview question. Both can describe an object shape:

```ts
interface Animal { name: string }
interface Dog extends Animal { breed: string }      // interface: extends

type Cat = Animal & { indoor: boolean };            // type: & (intersection)
```

The runnable version is section 4 of `examples/04-core-types.ts`; its output is the `4.` line shown in section 7. The real differences:

| | `interface` | `type` alias |
|---|---|---|
| Object shapes | Yes | Yes |
| Extend / combine | `extends` | `&` (intersection) |
| **Declaration merging** (declare the same name twice, the parts join) | **Yes** | No, it is an error |
| Name a union (`A \| B`), tuple, primitive or mapped type | No | **Yes** |
| Describe a function (`(x: number) => string`) | Yes, with a call signature (`{ (x: number): string }`), which is clumsier | Yes, and shorter |
| Can a class `implements` it? | Yes | Yes (if it is an object shape) |

Declaration merging in practice:

```ts
interface Settings { theme: string }
interface Settings { fontSize: number }
const settings: Settings = { theme: 'dark', fontSize: 14 };   // needs both fields
```

Declaring two `type` aliases with the same name (say `type A = ...` twice) gives `error TS2300: Duplicate identifier 'A'.`

> **Interview tip:** "For plain object shapes they are almost the same. I use `interface` for public shapes that others may extend or augment (declaration merging is how libraries let you add fields to their types), and `type` for unions, tuples, function types and anything computed." Either choice is a fine answer if you can name the merging and union differences. Weak answers are "type is newer" or "interface is faster" (there is a small compile-speed difference in very large codebases, but it is not the reason to choose). If asked "is TypeScript structural or nominal?", answer "structural": shape decides, not name.

---

## 9. Unions, intersections, literals and `as const`

A **union** (`A | B`) means "one of these". An **intersection** (`A & B`) means "all of these at once". A **literal type** is one exact value.

```ts
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';   // a union of literals: a small "menu"

function request(method: HttpMethod, url: string): string {
  return `${method} ${url}`;
}
request('GET', '/users');    // ok
request('get', '/users');    // compile error: Argument of type '"get"' is not assignable to parameter of type 'HttpMethod'
```

An intersection glues object types together into one type that needs everything:

```ts
type WithId = { id: number };
type WithTimestamps = { createdAt: Date; updatedAt: Date };
type Row = WithId & WithTimestamps;      // must have id AND createdAt AND updatedAt
```

You will see this in section 21, where `IncomingMessage & { params: Params }` means "Node's request, plus one field our router adds". Intersecting types that cannot both be true gives `never`: `string & number` has no possible value (checked with `tsc`).

The trap is **widening**. A plain object property is typed `string`, not the exact text. `as const` pins everything to the exact literals and makes it readonly (example `examples/05-literals-and-const.ts`):

```ts
const loose = { method: 'GET', url: '/a' };           // method: string
const exact = { method: 'GET', url: '/a' } as const;  // method: 'GET'
request(loose.method, loose.url);   // compile error: string is wider than HttpMethod
request(exact.method, exact.url);   // ok
```

```bash
node lessons/21-typescript-with-node/examples/05-literals-and-const.ts
```

```text
1. GET /users
    get /users
2. GET /a
3. values at runtime: [ 'debug', 'info', 'warn' ]
   [info] server started
   [warn] a plain string works too, if it is on the menu
   [trace] nope
   union only: development
4. 3000.0 LOCALHOST
    undefined
   with annotation only: 3000.0
5. readonly array was mutated anyway: [ 'GET', 'POST', 'PUT' ]
   frozen array refuses at runtime: Cannot add property 2, object is not extensible
```

Notice that every `@ts-expect-error` line still **ran**. `request('get', ...)` printed `get /users`. The compiler is the only guard, and Node is not the compiler. (That is why `tsc --noEmit` belongs in CI.)

> **Interview tip:** "Why does `request(loose.method, ...)` fail when `loose.method` is `'GET'`?" Answer: "A property in an object literal is widened to `string`, because it could be reassigned later. `as const` freezes it to the exact literal (and makes it readonly). A plain `const method = 'GET'` keeps the literal type because a `const` variable can never change." Knowing the word *widening* is the point.

---

## 10. Enums and their alternatives

A TypeScript `enum` creates a real JavaScript object at runtime. That is exactly why Node cannot strip it. The generated code for `enum Color { Red, Green }` (from `stripTypeScriptTypes` in transform mode, section 2):

```js
var Color = /*#__PURE__*/ function(Color) {
    Color[Color["Red"] = 0] = "Red";
    Color[Color["Green"] = 1] = "Green";
    return Color;
}(Color || {});
```

Notice the two-way mapping: `Color.Red` is `0`, and `Color[0]` is `'Red'`. That is the "reverse mapping" of numeric enums.

Two alternatives that need no special syntax. Both run on plain Node:

```ts
// 1. A union of strings. Zero runtime code.
type Mode = 'development' | 'production';

// 2. An "as const" object, plus a type with the SAME name.
const Level = { Debug: 'debug', Info: 'info', Warn: 'warn' } as const;
type Level = (typeof Level)[keyof typeof Level];   // 'debug' | 'info' | 'warn'

Level.Info                    // use it like an enum value
Object.values(Level)          // and you can loop over it
```

A value and a type can share a name because they live in different "namespaces" of the language. `typeof Level` reads the type of the value, and `keyof` lists its keys.

| | `enum` | union of strings | `as const` object |
|---|---|---|---|
| Runs with type stripping | **No** | Yes | Yes |
| Exists at runtime (can loop over it) | Yes | No | Yes |
| Dot access (`Level.Info`) | Yes | No | Yes |
| Works with `erasableSyntaxOnly` | No | Yes | Yes |

> **Interview tip:** "I avoid enums in new code. They add runtime code, numeric enums have the reverse-mapping surprise, and they are not erasable. A union of string literals, or an `as const` object when I need to loop over the values, gives the same safety." If the interviewer's team uses enums, say you are comfortable with both.

---

## 11. satisfies, readonly, type assertions and brands

### satisfies

`satisfies` (TypeScript 4.9+) checks a value against a type **without changing the value's own type**. An annotation widens the value; `satisfies` does not.

```ts
const defaults = { port: 3000, host: 'localhost' } satisfies Record<string, string | number>;
defaults.port.toFixed(1);     // ok: port is still known to be a number
defaults.prot;                // compile error: there is no "prot" key (a typo is caught)

const annotated: Record<string, string | number> = { port: 3000, host: 'localhost' };
annotated.port.toFixed(1);    // compile error: it is "string | number" now, and a string has no toFixed
```

Use `satisfies` for config objects and lookup tables: you get a check that the shape is right and you keep the exact keys and literal values.

> **Interview tip:** "What is the difference between `: Type`, `as Type` and `satisfies Type`?" Answer: "An annotation (`: Type`) sets the variable's type to `Type`, which can hide the exact value type. `as Type` overrides the compiler and checks little, so it can lie. `satisfies Type` only checks the value fits, and keeps the value's own, more exact type."

### readonly

`readonly` stops assignment, but **only at compile time**. The last two lines of the output in section 9 show the difference:

| Tool | When it protects | How |
|---|---|---|
| `readonly` property / `readonly string[]` / `Readonly<T>` | compile time only | the compiler rejects writes |
| `as const` | compile time only | literal types plus `readonly` |
| `Object.freeze(obj)` | **runtime** | writes throw (strict mode) or are ignored |

The line `readonly array was mutated anyway: [ 'GET', 'POST', 'PUT' ]` is the proof: `push` was refused by the compiler (we silenced it) but it still worked at runtime.

### Type assertions: `as` and `!`

An **assertion** tells the compiler "I know better, trust me". It converts nothing, checks nothing, and is erased before Node runs the file. Example `examples/13-structural-classes-errors.ts`:

```ts
const user = JSON.parse(text) as User;          // "trust me, this is a User"
const present = maybe!;                         // "trust me, this is not null or undefined"
const lie = '5' as unknown as number;           // the double cast: a last-resort escape hatch
```

`'5' as number` on its own is refused (`error TS2352: Conversion of type 'string' to type 'number' may be a mistake`), because the two types do not overlap. Going through `unknown` silences that check. The example prints:

```text
3. string 51
   non-null assertion on a missing value: undefined
```

`lie` is still the string `'5'`, so `lie + 1` glues text and gives `'51'`. The `!` on a missing value also did nothing: it changed only what the compiler believes.

Rule of thumb: prefer a real check (a narrowing `if`, a type guard, a schema) over `as`, because an assertion is a promise that nobody verifies. `as` is fine right after you validated something that the compiler cannot follow, or inside one small, tested helper.

### Branded types (a name-based type on top of shapes)

Structural typing (section 8) means two ids that are both `number` are interchangeable, so `loadUser(orderId)` compiles. A **brand** is a fake property that exists only in the type. It makes the two types differ, and it costs nothing at runtime:

```ts
type Brand<Base, Name extends string> = Base & { readonly __brand: Name };
type UserId = Brand<number, 'UserId'>;
type OrderId = Brand<number, 'OrderId'>;

function toUserId(value: number): UserId {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`bad user id: ${value}`);
  return value as UserId;   // the one place where we vouch for the brand, after a real check
}
function toOrderId(value: number): OrderId {
  return value as OrderId;
}
function loadUser(id: UserId): string {
  return `user #${id}`;
}
loadUser(toUserId(7));      // ok
loadUser(toOrderId(7));     // compile error: an OrderId is not a UserId
loadUser(7);                // compile error: a plain number has no brand
```

```text
2. user #7 number 8
   mixed up ids still ran: user #7
   plain number still ran: user #7
```

At runtime a `UserId` is a plain number: `typeof userId` is `'number'` and `userId + 1` is `8`. The two `@ts-expect-error` lines are real compile errors, and Node ran them anyway. The pattern: only one function (a "smart constructor") may create the branded type, and it validates first. Typical uses are ids, emails and already-sanitised strings.

> **Interview tip:** "How do you stop two ids of the same primitive type from being mixed up?" Answer: "TypeScript is structural, so I add a brand: `number & { __brand: 'UserId' }`, created only by a validating constructor."

---

## 12. Narrowing, and unknown vs any vs never

A value often has a wide type (`string | number`, `unknown`). **Narrowing** means proving a smaller type with a check. TypeScript follows your `if` statements and shrinks the type inside each branch (this is called **control flow analysis**). Example `examples/06-narrowing.ts`:

```ts
function toPort(value: string | number): number {
  if (typeof value === 'string') return Number.parseInt(value, 10); // value: string here
  return value;                                                      // value: number here
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'unknown error';
}

type Cat = { meow(): string };
type Dog = { bark(): string };
const speak = (pet: Cat | Dog) => ('meow' in pet ? pet.meow() : pet.bark());   // "in" narrows
```

The ways to narrow: `typeof`, `instanceof`, `in`, equality (`=== null`), truthiness, and the two below.

**Discriminated unions.** Give every member a "tag" property with a different literal value. Checking the tag narrows the whole object. This is the most useful pattern in real code (results, events, actions):

```ts
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const result = parseJson(input);
if (result.ok) console.log(result.value);   // result is the "ok: true" member
else console.log(result.error);             // result is the "ok: false" member
```

**Exhaustiveness with `never`.** `never` is the type with no values. If you handle every member of a union, nothing is left over, so the leftover has type `never`:

```ts
function assertNever(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
}
switch (shape.kind) {
  case 'circle': return Math.PI * shape.radius ** 2;
  case 'rect':   return shape.width * shape.height;
  default:       return assertNever(shape);   // compile error if a new kind is added and not handled
}
```

If someone adds `{ kind: 'triangle'; base: number; height: number }` to `Shape` and forgets the case, `shape` is no longer `never` and the compiler reports: `error TS2345: Argument of type '{ kind: "triangle"; base: number; height: number; }' is not assignable to parameter of type 'never'.` (a real message from `tsc`).

**User-defined type guards.** A function whose return type is `value is Point`. When it returns `true`, the compiler treats the argument as `Point`:

```ts
function isPoint(value: unknown): value is Point {
  return typeof value === 'object' && value !== null &&
    'x' in value && typeof value.x === 'number' &&
    'y' in value && typeof value.y === 'number';
}
```

The compiler **trusts** the guard. If you write a wrong guard (for example `return true`), you have a wrong type and no error. A guard is only as good as its checks.

```bash
node lessons/21-typescript-with-node/examples/06-narrowing.ts
```

```text
1. 8080 3000 HI (nothing)
2. Expected property name or '}' in JSON at position 2 (line 1 column 3)
    plain string | unknown error
3. meow! woof!
4. parsed: { a: 1 }
4. failed: Unexpected token 'o', "oops" is not valid JSON
5. 12 3.14
6. [ 'point(1,2)', 'not a point', 'not a point', 'not a point' ]
7. any crashed at runtime: Cannot read properties of undefined (reading 'theme')
    compiler refuses, Node prints: 1
    unknown, after narrowing: 1
```

(The JSON error texts come from V8 and can differ between Node versions.)

Reading the output: line 4 prints twice because the loop has two inputs, one valid and one broken. Line 6 shows the type guard accepting only the first of four inputs. Line 7 is the contrast that matters: the `any` version crashed at runtime, while the `unknown` version made us check first. The line the compiler refuses (`safe.count` before narrowing) still printed `1`, because Node does not type check.

### unknown vs any vs never

| | Meaning | Can you use it without a check? | Use it for |
|---|---|---|---|
| `any` | "Switch the type checker off for this value." | Yes, anything compiles (and may crash, see line 7 above) | Almost never. A last resort during migration. |
| `unknown` | "Could be anything, so check before use." | **No**, you must narrow first | Data from `JSON.parse`, `catch` variables, network input. |
| `never` | "No value can exist here." | Not applicable | Functions that always throw, exhausted unions, impossible branches. |

Under `strict`, the variable in `catch (error)` is `unknown` (the option is `useUnknownInCatchVariables`). That is why `error.message` fails to compile until you check `error instanceof Error`.

> **Interview tip:** "`any` opts out of the type system and spreads: one `any` can quietly make everything around it `any`. `unknown` is the safe version. It forces me to prove what a value is before I use it." Mention `JSON.parse` returning `any` as the example.

---

## 13. Generics and constraints

A **generic** is a function, type or class with a placeholder type, usually called `T`, that is filled in by the caller. It lets one piece of code work for many types **without losing type information** (using `any` would lose it). Example `examples/07-generics-utility.ts`:

```ts
function first<T>(items: T[]): T | undefined {
  return items[0];
}
const firstNumber = first([10, 20, 30]);   // type: number | undefined
const firstWord = first(['a', 'b']);       // type: string | undefined
```

A **constraint** (`extends`) limits what `T` may be:

```ts
function longest<T extends { length: number }>(a: T, b: T): T {
  return a.length >= b.length ? a : b;
}
longest('abc', 'de');          // ok, strings have a length
longest([1, 2], [1, 2, 3]);    // ok, arrays have a length
longest(10, 20);               // compile error: a number has no length

function getProp<T, K extends keyof T>(object: T, key: K): T[K] {
  return object[key];
}
getProp({ host: 'localhost', port: 3000 }, 'port');   // type: number
getProp({ host: 'localhost', port: 3000 }, 'path');   // compile error: not a key
```

`keyof T` is the union of the property names of `T`. `T[K]` is "the type of property `K` of `T`". Classes and types can be generic too: `class TypedCache<K, V>`, `type Page<T = unknown>` (`= unknown` is a default). In the example the class uses `#items`, a real JavaScript private field, which runs fine under type stripping.

> **Interview tip:** "Why a generic and not `any`?" Answer: "`any` throws the type away: a function `first(items: any[])` returns `any`. A generic keeps the link between what goes in and what comes out: `first<T>(items: T[]): T | undefined` returns the same `T` I passed. A constraint (`T extends ...`) limits what I accept, so I can safely use the properties I need." Mention that you rarely write the type argument yourself: the compiler infers `T` from the call.

---

## 14. Utility types

Utility types are built-in generics that make new types from old ones. They exist only at compile time.

```ts
type User = { id: number; name: string; email: string; admin?: boolean };

type UserPatch   = Partial<User>;                  // every property optional
type FullUser    = Required<User>;                 // every property required (admin too)
type UserPreview = Pick<User, 'id' | 'name'>;      // keep only these keys
type PublicUser  = Omit<User, 'email'>;            // drop these keys
type Roles       = Record<'admin' | 'viewer', string[]>;   // an object with exactly these keys
type FrozenUser  = Readonly<User>;                 // every property readonly
```

| Utility | What it makes | Typical Node use |
|---|---|---|
| `Partial<T>` | all properties optional | update/patch payloads |
| `Required<T>` | all properties required | after filling defaults |
| `Pick<T, K>` | only keys `K` | API response shapes |
| `Omit<T, K>` | everything except keys `K` | remove `password` before sending a user |
| `Record<K, V>` | object with keys `K`, values `V` | lookup tables, maps keyed by id |
| `ReturnType<F>` | what function `F` returns | reuse a function's result type |
| `Parameters<F>` | tuple of `F`'s parameter types | wrappers, retry helpers |
| `Awaited<P>` | what a promise resolves to | `Awaited<ReturnType<typeof fn>>` |

The last three read types out of a function:

```ts
async function fetchUser(id: number, includeEmail = false): Promise<User> { /* ... */ }

type FetchArgs   = Parameters<typeof fetchUser>;            // [id: number, includeEmail?: boolean]
type FetchResult = ReturnType<typeof fetchUser>;            // Promise<User>
type Fetched     = Awaited<FetchResult>;                    // User (the promise is unwrapped)

const args: FetchArgs = [7, true];
const fetched: Fetched = await fetchUser(...args);
```

Others you will meet: `NonNullable<T>`, `Exclude<U, X>`, `Extract<U, X>`, `InstanceType<C>`. A **mapped type** loops over keys, and `Partial` and `Pick` are written that way:

```ts
type Nullable<T> = { [Key in keyof T]: T[Key] | null };   // every property may also be null
```

```bash
node lessons/21-typescript-with-node/examples/07-generics-utility.ts
```

```text
1. 10 a undefined
2. abc [ 1, 2, 3 ]
   getProp: 3000 localhost
3. Asha undefined 2
   pages: 2 3
4. { id: 1, name: 'Asha K.', email: 'asha@example.com' }
    { id: 1, name: 'Asha' } { id: 1, name: 'Asha' } { admin: [ 'asha' ], viewer: [] } false true
   fetched: { id: 7, name: 'Asha', email: 'asha@example.com' }
   mapped: { id: 1, name: null }
5. 43 [ 2, 4 ]
```

(The line `longest(10, 20)` in the example is a compile error, but Node ran it anyway: numbers have no `length`, so it quietly returned `20`. Only the compiler objects.)

> **Interview tip:** A common live question is "implement `Pick` (or `Partial`) yourself". The answer is a mapped type: `type MyPick<T, K extends keyof T> = { [P in K]: T[P] }` and `type MyPartial<T> = { [P in keyof T]?: T[P] }`. Say it as "loop over the keys and rebuild the object type". Section 15 shows more of this.

---

## 15. A taste of advanced types

Once you know generics and `keyof`, four more tools let you **compute** types instead of writing them by hand. Interviewers use them to separate people who have read the handbook from people who have used the language. Example `examples/14-advanced-types.ts` runs all of them, and backs most of them with a compile-time test.

**A compile-time test** is a type that fails to compile when a claim is wrong. The example uses two small helpers that are erased before Node runs the file:

```ts
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

type Check = Expect<Equal<IsString<'a'>, 'yes'>>;   // compiles only if the claim is true
```

If the claim is false, `tsc` reports `error TS2344: Type 'false' does not satisfy the constraint 'true'`. Node never sees any of it.

**1. Indexed access and `keyof typeof`.** Read a type out of a value or out of another type:

```ts
const routes = { home: '/', users: '/users', orders: '/orders' } as const;
type RouteName = keyof typeof routes;               // 'home' | 'users' | 'orders'
type RoutePath = (typeof routes)[RouteName];        // '/' | '/users' | '/orders'
type ServerConfig = { http: { port: number; host: string }; debug: boolean };
type HttpPort = ServerConfig['http']['port'];       // number
```

`typeof routes` reads the type of a value. `keyof` lists its keys. `Type['key']` is "the type of that property". The value `routes` stays the single source of truth, and the types follow it.

**2. Mapped types.** Build an object type by looping over the keys of another one. The three below are the ones to remember:

```ts
type Flags<T> = { [K in keyof T]: boolean };                                     // same keys, boolean values
type Mutable<T> = { -readonly [K in keyof T]: T[K] };                            // "-readonly" removes readonly
type OnlyStrings<T> = { [K in keyof T as T[K] extends string ? K : never]: T[K] };   // "as" renames or drops keys
```

`Partial`, `Required`, `Pick` and `Readonly` from section 14 are mapped types. The modifiers `?` and `readonly` can be added or removed with `+` and `-`.

**3. Conditional types and `infer`.** A conditional type is a type-level `if`: `T extends U ? X : Y`. `infer` gives a name to a part you want to pull out:

```ts
type IsString<T> = T extends string ? 'yes' : 'no';
type ElementOf<T> = T extends readonly (infer Item)[] ? Item : never;   // string[] -> string
type Unwrap<T> = T extends Promise<infer Inner> ? Inner : T;            // Promise<User> -> User
```

This is how `ReturnType`, `Parameters` and `Awaited` are built. Applied to a union, a conditional type works on each member separately (it is **distributive**): `IsString<string | number>` is `'yes' | 'no'`.

**4. Template literal types.** Types made from string pieces, using the same backtick syntax as strings:

```ts
type HandlerName<Event extends string> = `on${Capitalize<Event>}`;           // 'click' -> 'onClick'
type ApiPath = `/api/v${1 | 2}/${'users' | 'orders'}`;                       // 4 exact strings
type AnyApiUrl = `/api/${string}`;                                           // any string starting with /api/
```

```bash
node lessons/21-typescript-with-node/examples/14-advanced-types.ts
```

```text
1. [ 'home', 'users', 'orders' ] /users
2. { name: 'Asha', email: 'asha@example.com' }
3. text number
4. /api/v2/orders /api/anything/goes /api/v3/users
5. 9090 (the write was refused by the compiler only, and it still ran)
    { id: 1, name: 'Asha' }
```

Line 4 shows `/api/v3/users`: it is not one of the four allowed paths, so the compiler would reject it, and Node printed it anyway. Line 5 is a `DeepReadonly` type (a recursive mapped type): the compiler refused `config.http.port = 9090`, but the write ran, because `readonly` is compile-time only (section 11).

> **Interview tip:** You will rarely be asked to write these from memory. You will be asked what they are for. A good one-line answer: "Mapped types transform every key of a type, conditional types choose a type based on another type, `infer` extracts a part of a type, and template literal types build string types. The built-in utility types are written with them." If asked to prove it, write `Unwrap<T>` or `MyPick<T, K>` on the whiteboard.

---

## 16. Function overloads

An **overload** lets one function have several call signatures, each with its own return type. You write the signatures, then one implementation that covers them all:

```ts
function toNumbers(input: string): number;
function toNumbers(input: string[]): number[];
function toNumbers(input: string | string[]): number | number[] {
  return Array.isArray(input) ? input.map(Number) : Number(input);
}
const one = toNumbers('42');          // type: number
const many = toNumbers(['1', '2']);   // type: number[]
```

Callers see only the first two lines. The implementation line is hidden from them. If no overload fits, `tsc` says `error TS2769: No overload matches this call.` and lists each overload it tried.

Node's own types use overloads. `fs.promises.readFile(path, 'utf8')` is typed as `Promise<string>`, while `readFile(path)` with no encoding is `Promise<Buffer>` (you will see this in example 08, section 18).

> **Interview tip:** If a function returns a different type depending on the argument, prefer overloads (or a generic) over a return type of `string | Buffer`. The caller then needs no cast.

---

## 17. Classes and typed errors

A TypeScript class is a JavaScript class plus types. Under type stripping you can use the **erasable** part of it. Example `examples/13-structural-classes-errors.ts`:

```ts
interface Shape {
  area(): number;
}
abstract class Base implements Shape {
  readonly name: string;           // declare the field...
  constructor(name: string) {
    this.name = name;              // ...and assign it yourself (no parameter property)
  }
  abstract area(): number;         // subclasses must provide this
  describe(): string {
    return `${this.name} with area ${this.area().toFixed(2)}`;
  }
}
class Circle extends Base {
  #radius: number;                 // a real JavaScript private field
  private colour = 'red';          // TypeScript-only private
  constructor(radius: number) {
    super('circle');
    this.#radius = radius;
  }
  override area(): number {
    return Math.PI * this.#radius ** 2;
  }
}
```

What each keyword does:

- `implements Shape`: the compiler checks that the class has the members of `Shape`. It copies nothing. (`extends` is different: it inherits real code.)
- `abstract`: the class cannot be instantiated, and abstract members must be filled in by subclasses. This is a compile-time rule only.
- `override`: the compiler checks that the parent really has that member, so a rename in the parent is caught.
- `readonly`, `private`, `protected`, `public`: compile-time rules, erased by Node.
- `#radius`: part of JavaScript itself, so it works under type stripping and is really hidden.

```text
4. circle with area 12.57
   own keys: [ 'name', 'colour' ]
   compiler says private, runtime says: red
   abstract class is a compile-time rule only: object
```

| | `private x` (TypeScript) | `#x` (JavaScript) |
|---|---|---|
| Who enforces it | the compiler only | the JavaScript engine |
| Visible at runtime (`Object.keys`, `obj.x`) | **Yes**, it is a normal property | No |
| Subclasses may use it | No (`protected` allows it) | No |
| Runs under type stripping | Yes | Yes |

The output shows it: `colour` is listed in the keys and can be read, while `#radius` is not. If the value must really be hidden, use `#`.

> **Interview tip:** "What is the difference between `private` and `#private`?" Answer: "`private` is a compile-time check that disappears, so anyone can still read the property at runtime. `#private` is real JavaScript privacy, enforced by the engine." Add that parameter properties (`constructor(private x: number)`) are not allowed under type stripping, so you declare the field and assign it by hand.

### Typed errors

An error class that carries extra data, and a **cause** chain (the lower-level error that triggered this one):

```ts
class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HttpError';
    this.status = status;
  }
}
const wrapped = new HttpError(502, 'upstream failed', { cause: new Error('connection reset') });
```

`cause` is typed `unknown`, because anything can be thrown, so you check it before use (the example casts it to `Error`, which is acceptable only because we built it two lines earlier). Under a very old compile target (ES5 or lower) `instanceof` breaks for classes that extend `Error`. With `target: es2024` and native Node it works.

Node's own system errors carry a `code` such as `ENOENT` (file not found). `@types/node` names that shape `NodeJS.ErrnoException`. Because a `catch` variable is `unknown` (section 12), a small type guard lets you read `code` safely:

```ts
function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
try {
  readFileSync(join(dir, 'missing.txt'), 'utf8');   // dir is a fresh temp folder, so the file is not there
} catch (error) {
  if (isErrnoException(error) && error.code === 'ENOENT') {
    console.log('file not found, code:', error.code, '| syscall:', error.syscall);
  } else {
    throw error;   // anything else is a real bug: do not swallow it
  }
}
```

```text
5. HttpError 502 upstream failed | cause: connection reset
   file not found, code: ENOENT | syscall: open
```

> **Interview tip:** "How do you handle `ENOENT` in TypeScript?" Answer: "The `catch` variable is `unknown`, so I narrow it with a guard for `NodeJS.ErrnoException` and compare `code`. If it is not the error I expect, I rethrow."

---

## 18. Typing async code, callbacks and events

Example `examples/08-async-and-events.ts`.

**Async functions.** An `async` function always returns a promise. You write the type of the value **inside** the promise:

```ts
async function loadUser(id: number): Promise<User> {
  await sleep(1);
  return { id, name: `user${id}` };      // a plain object, but callers get Promise<User>
}
const user = await loadUser(1);           // await unwraps it: user is a User
const [a, b, pause] = await Promise.all([loadUser(2), loadUser(3), sleep(1)]);  // [User, User, void]
```

`Promise.all` keeps one type per position (a tuple). `Promise.allSettled` returns a discriminated union: check `item.status` and the compiler knows if you have `.value` or `.reason`. If you forget `await`, you get `Type 'Promise<string>' is not assignable to type 'string'`.

**Callbacks.** Node's classic error-first callback has a simple type, and a generic helper can turn any such API into a promise:

```ts
type NodeCallback<T> = (error: Error | null, result?: T) => void;

function fromCallback<T>(start: (done: NodeCallback<T>) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    start((error, result) => {
      if (error) reject(error);
      else resolve(result as T);       // result is "T | undefined", so we assert it is there
    });
  });
}
```

**Typed EventEmitter.** With a recent `@types/node` (tested with 22.20.1), `EventEmitter` is generic. The type argument maps each event name to the **tuple of its arguments**:

```ts
import { EventEmitter } from 'node:events';

type JobEvents = {
  started: [id: number];
  progress: [id: number, percent: number];
  finished: [id: number, result: string];
  error: [error: Error];
};
const jobs = new EventEmitter<JobEvents>();

jobs.on('progress', (id, percent) => console.log(id, percent.toFixed(0)));  // id: number, percent: number
jobs.on('finishd', () => {});         // compile error: typo, no such event
jobs.emit('progress', 7);             // compile error: percent is missing
```

```bash
node lessons/21-typescript-with-node/examples/08-async-and-events.ts
```

```text
1. { id: 1, name: 'user1' }
   all: user2 user3 undefined
2. fulfilled: user4
2. rejected: bad id -1
3. string true
4. from callback: 42
5. job 7 started
   job 7 at 50%
   job 7 finished with ok
   job error: disk full
```

Line 3 shows the `readFile` overloads: with `'utf8'` you get a `string`, without it a `Buffer`. Line `all:` ends with `undefined` because `sleep(1)` resolves to `void`.

> **Common mistake:** the typed `EventEmitter<...>` only checks what **you** call on it. The runtime is the ordinary emitter. Emitting `'error'` with no listener still throws, no matter what the types say. With an older `@types/node` that lacks the generic, people wrote a small `TypedEmitter<Events>` wrapper interface. You will see that in older code.

> **Interview tip:** "What is the return type of an `async` function that returns a number?" Answer: "`Promise<number>`. Inside the function I return a plain `number`, and callers `await` it to get the `number` back. To get the resolved type of a promise-returning function I use `Awaited<ReturnType<typeof fn>>`." Interviewers also like "how would you type a callback API as a promise?" (the `fromCallback` helper above, or `util.promisify`).

---

## 19. Typing environment variables and config

`process.env` values are always `string | undefined`. Never a number, never guaranteed to exist. TypeScript knows that and stops you early (example `examples/09-env-and-validation.ts`):

```ts
const rawPort = process.env.SURELY_NOT_SET;      // type: string | undefined
const wishedPort: number = rawPort;              // compile error: 'string | undefined' is not assignable to 'number'
```

You can teach TypeScript the **names** of your variables by merging into Node's own type (this is "declaration merging", section 23). You get autocomplete, and the values stay honest:

```ts
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      DATABASE_URL?: string;
      PORT?: string;
    }
  }
}
```

`declare global { namespace ... }` is type-only, so it is erased and runs fine under type stripping. The file must be a module (have an `import` or `export`).

> **Common mistake:** declaring `NODE_ENV?: 'development' | 'production' | 'test'`. It looks tidy but it **lies**: anyone can start the process with `NODE_ENV=staging`. Keep the declared type `string` and validate in one place.

The right pattern: read and validate `process.env` **once**, at startup, and give the rest of the program a typed `Config` object. The loader takes `env` as a parameter, so tests can pass a fake one:

```ts
type Config = { nodeEnv: NodeEnv; port: number; databaseUrl: string; debug: boolean };

function loadConfig(env: NodeJS.ProcessEnv): Config { /* checks, collects problems, throws ConfigError */ }

console.log(loadConfig(parseEnv('NODE_ENV=production\nPORT=8080\nDATABASE_URL=postgres://localhost/app\nDEBUG=true')));
```

`util.parseEnv` (Node 20.12+) turns the text of a `.env` file into an object, so this example needs no file. In a real app you start Node with `node --env-file=.env src/server.ts`, which loads the file into `process.env` before your code runs.

```bash
node lessons/21-typescript-with-node/examples/09-env-and-validation.ts
```

```text
1. raw value: undefined | the "number" we wished for is: undefined
2. good: {
  nodeEnv: 'production',
  port: 8080,
  databaseUrl: 'postgres://localhost/app',
  debug: true
}
   bad: Invalid configuration:
  - NODE_ENV must be one of development, production, test (got "staging")
  - PORT must be 0-65535 (got "http")
  - DATABASE_URL is required
   (3 problems)
3. valid: { id: 1, name: 'Asha', tags: [ 'admin' ] }
   rejected: {"id":"1","name":"Asha","tags":[]} -> Response is not a valid user
   rejected: {"id":1,"name":"Asha"} -> Response is not a valid user
   rejected: null -> Response is not a valid user
4. TEXT/PLAIN
    port must be a string, got number
```

Reading the output: line 1 is the missing variable (a `number` was wished for, `undefined` is what exists). Line 2 shows `loadConfig` accepting good input and, for bad input, collecting all three problems before throwing, which is friendlier than stopping at the first. Lines 3 and 4 are the type guard (section 20) and an assertion function at work.

The `ConfigError` class in the example also shows how to write a class **without** a parameter property: `readonly problems: string[];` is declared on its own line, then assigned in the constructor.

---

## 20. Runtime validation vs compile-time types

The rule to remember: **types describe what you promise; validation checks what is true.** Data from outside your program (HTTP bodies, files, queues, environment variables, `JSON.parse`) has no type at runtime. Write `unknown` for it, validate it, and only then give it a type.

There are three tools. Example `examples/09-env-and-validation.ts` shows the first two:

**1. A type guard** (hand-written, no library): returns `boolean`, and the return type `value is ApiUser` tells the compiler what a `true` means.

```ts
function isApiUser(value: unknown): value is ApiUser {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'number' &&
    typeof candidate.name === 'string' &&
    Array.isArray(candidate.tags) && candidate.tags.every((tag) => typeof tag === 'string');
}

function parseApiUser(text: string): ApiUser {
  const data: unknown = JSON.parse(text);          // unknown on purpose
  if (!isApiUser(data)) throw new TypeError('Response is not a valid user');
  return data;                                      // now it really is an ApiUser
}
```

**2. An assertion function**: instead of returning a boolean, it throws, and the compiler then knows the value is checked for the rest of the scope.

```ts
function assertIsString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string, got ${typeof value}`);
}
const header: unknown = 'text/plain';
assertIsString(header, 'content-type');
header.toUpperCase();      // header is a string from here on
```

**3. A schema library such as zod.** You describe the shape once, as a runtime value, and the library gives you both the checker and the TypeScript type. This is an illustrative snippet (it needs `npm install zod`). It was verified with zod 4.4.3 on Node 24.16.0. The exact wording of the messages may change in later zod versions.

```ts
// Needs: npm install zod
import { z } from 'zod';

const UserSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

type User = z.infer<typeof UserSchema>;     // { id: number; name: string; tags: string[] }, derived, never out of date

const result = UserSchema.safeParse(JSON.parse('{"id":1,"name":"Asha"}'));
if (result.success) console.log(result.data);        // { id: 1, name: 'Asha', tags: [] }

const bad = UserSchema.safeParse({ id: 'one', name: '' });
if (!bad.success) console.log(bad.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
// [ 'id: Invalid input: expected number, received string',
//   'name: Too small: expected string to have >=1 characters' ]
```

| | Hand-written guard | Assertion function | Schema library (zod) |
|---|---|---|---|
| Dependencies | none | none | one package |
| Type and check can drift apart | **Yes** (you keep them in sync by hand) | Yes | No (the type is derived) |
| Good error messages | only what you write | only what you write | built in, with the path |
| Best for | one or two small shapes | "must be X, or stop" at an entry point | many or nested shapes, request bodies, config |

**Where untyped data hides in Node.** `JSON.parse` returns `any`. `await response.json()` from the global `fetch` returns `unknown` when only the `@types/node` typings are loaded (checked with `@types/node` 22.20.1, TypeScript 6.0.3, `lib` without DOM), but `any` if the browser DOM types are loaded. `req.body` in Express is typed by a generic you choose, so it is only a promise (section 21). Treat all of them as untrusted until validated.

> **Interview tip:** The strong answer to "how do you make sure the JSON from an API matches your types?" is: "I don't trust the cast. I parse into `unknown`, validate with a schema or a guard at the boundary, and only the validated value gets the type." Say the word *boundary*.

---

## 21. Typing HTTP handlers (Express-style)

A handler is a function from a request and a response to nothing (or a promise of nothing). Example `examples/10-typed-http-handler.ts` builds a small router with only `node:http`, so it runs without installing anything. The building blocks:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

type Params = Record<string, string>;
type Req = IncomingMessage & { params: Params };          // Node's request plus the field our router adds
type Res = ServerResponse;
type Handler = (req: Req, res: Res) => void | Promise<void>;   // may be sync or async

function sendJson<T>(res: Res, status: number, body: T): void { /* writes JSON */ }

async function readJson<T>(req: IncomingMessage, guard: (value: unknown) => value is T): Promise<T> { /* reads, parses, checks */ }

route('POST', '/users', async (req, res) => {
  const body = await readJson(req, isNewUser);            // body: NewUser, and it was really checked
  sendJson(res, 201, { id: 1, name: body.name });
});
```

`readJson` takes the type guard as an argument, so the `Promise<T>` you get back is honest. Another real-world detail from the example: `server.address()` returns `string | AddressInfo | null`, so you must narrow it before reading `.port`.

```bash
node lessons/21-typescript-with-node/examples/10-typed-http-handler.ts
```

```text
GET /users/42 -> 200 { id: 42, name: 'user42' }
GET /users/abc -> 400 { error: 'id must be a whole number' }
POST /users -> 201 { id: 1, name: 'Asha' }
POST /users -> 400 { error: 'Body has the wrong shape' }
POST /users -> 400 { error: 'Body is not valid JSON' }
GET /nope -> 404 { error: 'No route for GET /nope' }
server closed
```

Note `req.params.id` is a `string`: URLs only carry text. You convert and check it yourself.

**With Express.** This is an illustrative snippet. It needs packages from npm, which this repo does not install, so it is not one of the runnable examples and was not compiled here. The generic order shown, `RequestHandler<Params, ResBody, ReqBody, ReqQuery>`, is the one `@types/express` uses. Confirm it in your editor when you install the packages:

```ts
// Needs: npm install express && npm install --save-dev @types/express
import express from 'express';
import type { Request, Response, RequestHandler } from 'express';

type UserParams = { id: string };
type CreateUserBody = { name: string };
type UserResponse = { id: number; name: string } | { error: string };

// RequestHandler<Params, ResBody, ReqBody, ReqQuery>
const getUser: RequestHandler<UserParams, UserResponse> = async (req, res) => {
  res.json({ id: Number(req.params.id), name: 'Asha' });      // res.json is checked against UserResponse
};

const createUser = async (req: Request<Record<string, string>, UserResponse, CreateUserBody>, res: Response<UserResponse>) => {
  // req.body is typed as CreateUserBody, but that is only a promise. Nothing checked it at runtime.
  res.status(201).json({ id: 1, name: req.body.name });
};

const app = express();
app.use(express.json());
app.get('/users/:id', getUser);
app.post('/users', createUser);
```

> **Common mistake:** trusting the `ReqBody` generic. `Request<..., CreateUserBody>` does not validate anything. It only tells the compiler what to believe. (In Express 5, `req.body` is even `undefined` when no body parser ran, whatever the type says.) Validate `req.body` with a guard or a schema (section 20) before you use it. Express 5 also forwards errors from `async` handlers to the error middleware by itself, so no wrapper is needed.

---

## 22. Modules, import type and declaration files

### import type and export type

With type stripping, Node removes the `type` parts and keeps the rest. Example `examples/12-import-export-type.ts`:

```ts
// Mix values and types in one import. "type" marks the names that are erased.
import { area, UNIT, type Shape, type ShapeKind } from './_helpers/shapes.ts';

// Or mark the whole statement as type-only. The entire line disappears at runtime.
import type { Server } from 'node:http';

import * as shapes from './_helpers/shapes.ts';
console.log('3. runtime exports of shapes.ts:', Object.keys(shapes));
```

For re-exports use `export type { Shape } from './shapes.ts'` (see `examples/_helpers/shapes-barrel.ts`).

```bash
node lessons/21-typescript-with-node/examples/12-import-export-type.ts
```

```text
1. area of the square: 9 cm2 | a kind: circle
2. no server yet
3. runtime exports of shapes.ts: [ 'UNIT', 'area' ]
4. runtime exports of the barrel: [ 'UNIT', 'area' ]
5. { shape: { kind: 'square', size: 3 }, area: 9 }
```

Lines 3 and 4 are the proof that types do not exist at runtime: `Shape` and `ShapeKind` are in the source but not in the module.

`verbatimModuleSyntax` (section 5) makes `tsc` enforce this. Forget a `type` and you get `error TS1484: 'Thing' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.`

> **Interview tip:** "Why `import type`?" Answer: "It tells the tool the import is erased. With one-file-at-a-time tools such as Node's type stripper, esbuild or swc, the tool cannot open the other file to find out whether a name is a type, so `import type` removes the guesswork. It also avoids creating a runtime import (and a possible circular import) for something that exists only at compile time."

### Declaration files (.d.ts)

A **declaration file** ends in `.d.ts`. It holds types only, no code. It describes JavaScript that already exists, so TypeScript can check calls to it. Node never loads a `.d.ts` file. `examples/_helpers/legacy-greeter.d.ts`:

```ts
// Describes an old, untyped npm package called "legacy-greeter".
declare module 'legacy-greeter' {
  export function greet(name: string, loud?: boolean): string;
  export const version: string;
}
```

With that file in your project, `import { greet } from 'legacy-greeter'` is fully checked, and `greet(42)` is an error. This was compiled with `tsc` to confirm.

Where `.d.ts` files come from:

- **Your own build.** With `"declaration": true`, `tsc` writes a `.d.ts` next to each compiled `.js` (`greet.d.ts` appears next to `greet.js`). Libraries publish these.
- **The package itself.** Its `package.json` points to them with a `types` field, or with a `types` condition inside `exports`. Put that condition first, because TypeScript uses the first condition that matches:

  ```json
  { "name": "my-lib", "type": "module",
    "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } } }
  ```
- **DefinitelyTyped.** `npm install --save-dev @types/<name>` (section 6).
- **You.** A small hand-written `declare module '...'` like the one above, for a package with no types at all.

---

## 23. Declaration merging and augmentation

**Declaration merging** means TypeScript joins several declarations with the same name into one. Interfaces merge (section 8). That is how you **add** fields to a type you do not own, such as Node's `ProcessEnv` (section 19) or Express's `Request`:

```ts
// types/express.d.ts   (illustrative: needs @types/express)
import 'express';

declare global {
  namespace Express {
    interface Request {
      user?: { id: number; role: 'admin' | 'viewer' };   // now req.user exists in every handler
    }
  }
}
```

Two traps:

- The file must be a module (have an `import` or `export`), or `declare global` is an error.
- The augmentation is a **promise**, like every type. Some middleware (for example your auth middleware) must really set `req.user`, and the field is `user?` (optional) because routes before that middleware have no user.

The related word **ambient** means "declared, but defined somewhere else". `declare const x: number` says "a variable called `x` exists", and `declare` lines are erased by Node's stripper.

> **Interview tip:** "How do you add `req.user` to Express's `Request` type?" Answer: "I write a `.d.ts` file with `declare global { namespace Express { interface Request { user?: ... } } }`. That works because interfaces merge. I make `user` optional, and I still have to set it in real middleware and validate it, because the type is only a promise."

---

## 24. strictNullChecks and common compile errors

`strictNullChecks` (part of `strict`) is the single most valuable setting. With it **on**, `null` and `undefined` are their own types and are not allowed everywhere. With it **off**, `let name: string = null` is allowed and the famous "cannot read properties of undefined" bugs come back. Checked: with `strict: false`, TypeScript 6.0.3 accepted `let s: string = null`.

```ts
const found = [1, 2, 3].find((n) => n > 1);   // type: number | undefined
found.toFixed();       // error TS18048: 'found' is possibly 'undefined'.
found?.toFixed();      // ok, optional chaining
if (found !== undefined) found.toFixed();       // ok, narrowed
const must = found!;   // "!" says "trust me, not undefined". It is erased, so it checks nothing at runtime.
```

Common compile errors. Each of these was produced with `tsc` 6.0.3 under `strict`, and the wording is the same family you will see on other versions. The code (`TS2322`) is stable, so search for the code, not the full sentence:

| Message (shortened) | What it means | Usual fix |
|---|---|---|
| `TS2322: Type 'string' is not assignable to type 'number'.` | You put the wrong type in a place. Also appears as `Type '"c"' is not assignable to type 'Mode'`. | Fix the value or the type. |
| `TS2322: Type 'Promise<string>' is not assignable to type 'string'.` | You forgot `await`. | Add `await`. |
| `TS2345: Argument of type 'string \| undefined' is not assignable to parameter of type 'string'.` | The value might be missing. | Check for `undefined` first. |
| `TS2554: Expected 2 arguments, but got 1.` | Wrong number of arguments. | Pass them all, or make the parameter optional. |
| `TS2339: Property 'age' does not exist on type '{ name: string; }'.` | Typo, or the type does not have that field. | Fix the name or the type. For a union, narrow first. |
| `TS2353: Object literal may only specify known properties, and 'z' does not exist in type 'P'.` | Extra property in an object literal. | Remove it, or add it to the type. |
| `TS2741: Property 'y' is missing in type '{ x: number; }' but required in type 'P'.` | Missing required property. | Add it, or make it optional with `?`. |
| `TS7006: Parameter 'x' implicitly has an 'any' type.` | `noImplicitAny`: a parameter has no type. | Annotate it. |
| `TS7053: Element implicitly has an 'any' type because expression of type 'string' can't be used to index type '{ alice: number; bob: number; }'.` | Indexing an object with a plain `string`. | Use `Record<string, number>` or `keyof typeof obj`. |
| `TS18048: 'maybe' is possibly 'undefined'.` (`TS18047` for `null`) | `strictNullChecks`. | Narrow, use `?.`, or give a default with `??`. |
| `TS18046: 'error' is of type 'unknown'.` | You used an `unknown` value (often a `catch` variable). | `if (error instanceof Error)` first. |
| `TS2564: Property 'port' has no initializer and is not definitely assigned in the constructor.` | A class field is never set. | Assign it, give a default, or make it optional. |
| `TS2366: Function lacks ending return statement and return type does not include 'undefined'.` | Some path returns nothing. | Return on every path. |
| `TS2769: No overload matches this call.` | None of the overloads fits your arguments. | Read each listed overload. |
| `TS2307: Cannot find module './missing.ts' or its corresponding type declarations.` | Wrong path, or a package with no types. | Fix the path, or install `@types/...`. |
| `TS2835: Relative import paths need explicit file extensions in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'.` | You wrote `./other` with no extension. | Write `./other.ts`. |
| `TS2591: Cannot find name 'process'. Do you need to install type definitions for node?` | `@types/node` is missing or not in `types`. | Section 6. |
| `TS1484: 'Thing' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled.` | Missing `type` in an import. | `import type { Thing }`. |
| `TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled.` | You used an enum, namespace, parameter property and so on. | Section 3. |
| `TS2540: Cannot assign to 'a' because it is a read-only property.` | Writing to a `readonly` property. | Do not mutate, or remove `readonly`. |
| `TS2352: Conversion of type 'string' to type 'number' may be a mistake because neither type sufficiently overlaps with the other.` | An `as` assertion between unrelated types. | Fix the value, or validate it properly. `as unknown as T` silences it, but also hides the bug. |

> **Remember:** a compile error never stops Node. It only appears when you run `tsc` or look at the editor. If nobody runs `tsc --noEmit` in CI, the errors pile up unseen.

---

## 25. Project layout and build/deploy choices

A small service layout:

```text
my-service/
  package.json
  tsconfig.json            checking: noEmit (section 5)
  tsconfig.build.json      only if you compile (extends tsconfig.json)
  src/
    server.ts
    config.ts
    users.ts
    users.test.ts          found by "node --test"
  dist/                    only if you compile; do not commit it
```

Scripts for the two common styles (a snippet, not a runnable file):

```json
{
  "type": "module",
  "scripts": {
    "dev": "node --watch src/server.ts",
    "start": "node src/server.ts",
    "typecheck": "tsc --noEmit",
    "test": "node --test",
    "build": "tsc -p tsconfig.build.json",
    "start:dist": "node dist/server.js"
  }
}
```

`start` runs the source directly. `build` plus `start:dist` ships compiled JavaScript. You normally pick one of them for production.

| | Run `.ts` directly (Node 24) | Compile with `tsc` / a bundler, ship JS |
|---|---|---|
| Build step | None | Yes |
| Syntax allowed | Erasable only | Everything (enums, decorators, JSX, `paths`) |
| Error line numbers | Correct, no source maps needed | Need source maps (`sourceMap: true`, `node --enable-source-maps`) |
| Node version | 22.18+ or 24+ | Any version that runs the emitted syntax |
| Libraries you publish | Not possible: `.ts` under `node_modules` is refused | Required: ship `.js` and `.d.ts` |
| Bundle size, minify, one file | No | Yes (with a bundler) |
| Decorator frameworks (NestJS, TypeORM) | No | Yes |

Decision rule:

- **Application on Node 24, no decorators or JSX:** run `.ts` directly. Fewer moving parts.
- **Library, or older Node, or decorators, or you need one bundled file:** compile.
- **Either way:** run `tsc --noEmit` in CI as the type gate. The build and the checker are different jobs.

Deployment notes:

- **No TypeScript package at runtime.** Node's built-in stripper needs nothing installed, so `typescript` and the `@types/*` packages are `devDependencies` in both styles. A production install such as `npm ci --omit=dev` can leave them out.
- **Pin the Node version.** Running `.ts` directly needs Node 22.18+ or 24+. On older Node the same command fails with `ERR_UNKNOWN_FILE_EXTENSION` for `.ts` files. Set `"engines": { "node": ">=24" }` and use a matching base image.
- **Compiled style:** run `tsc` in the build stage of your pipeline (or Docker build), ship `dist/` and the production dependencies, and start with `node --enable-source-maps dist/server.js` so stack traces point at your `.ts` lines.
- **Big projects** use `tsc --build` with project references and `incremental` to type check only what changed. That is an advanced topic this lesson does not cover.

> **Interview tip:** "How do you deploy a TypeScript service?" Strong answer: "On Node 24 I can ship the `.ts` sources and start them with `node src/server.ts`, because the types are just erased. I run `tsc --noEmit` in CI as the gate. If I need enums, decorators, an older Node, or one bundled file, I compile in the build stage, ship `dist/`, and turn on source maps."

---

## 26. Migrating a JavaScript project gradually

You do not need a big-bang rewrite. TypeScript can check JavaScript files, so you can move one file at a time. Example `examples/11-jsdoc-checkjs.js` is a plain `.js` file that Node runs unchanged, with types written in **JSDoc comments** (the `/** ... */` comments you already know):

```js
// @ts-check

/**
 * @typedef {object} User
 * @property {number} id
 * @property {string} name
 * @property {string} [email] optional, like "email?: string"
 */

/**
 * @param {User} user
 * @returns {string}
 */
function label(user) {
  return `${user.name} <${user.email ?? 'no email'}>`;
}

label({ id: 2 });   // with // @ts-check: error, "name" is missing
```

```bash
node lessons/21-typescript-with-node/examples/11-jsdoc-checkjs.js
```

```text
1. Asha <no email>
    undefined <no email>
2. 8
3. file
4. 3001
```

(Line 2 of the output is the call `label({ id: 2 })` that the compiler objects to. Node runs it and prints `undefined`.) The file also shows `@template` for generics, `import('node:fs').Stats` to borrow a Node type, and `/** @type {...} */ (value)` for casts.

The steps, in a sensible order:

1. Install `typescript` and `@types/node`. Add a `tsconfig.json` with `"allowJs": true`, `"checkJs": false`, `"noEmit": true`. Nothing changes yet.
2. Turn checking on **per file** with `// @ts-check` at the top, or for everything with `"checkJs": true`. Add JSDoc types where the editor complains. (Use `// @ts-nocheck` to skip a hopeless file for now.)
3. Rename files from `.js` to `.ts`, a few at a time, starting with the leaves (files that import little). Update the imports to the new extension (`./x.ts`, see the `.js` trap in section 3).
4. Raise strictness in steps: start with `strict: false`, then turn on `noImplicitAny`, then `strictNullChecks`, then switch to `strict: true`.
5. When you must silence an error, use `// @ts-expect-error` with a reason, not `// @ts-ignore`. `@ts-expect-error` itself becomes an error once the problem is fixed (`error TS2578: Unused '@ts-expect-error' directive.`), so the silencers clean themselves up. The examples in this lesson rely on it: they were type checked with `tsc` (6.0.3), so every `@ts-expect-error` line there is a real compile error.
6. Add `tsc --noEmit` to CI so errors can never grow back.

> **Interview tip:** "How would you migrate a large JavaScript codebase to TypeScript?" Strong answer: "Gradually, never a big bang. Add `allowJs` and `checkJs` with JSDoc so the code is checked before any renaming. Convert files from the leaves inwards, raise `strict` one flag at a time, ban new `any` and `@ts-ignore` with lint rules, and put `tsc --noEmit` in CI so the error count can only go down."

---

## Summary / Key takeaways
- TypeScript checks types at compile time. The types are erased before the code runs, so it adds no runtime safety. Validate untrusted data at the boundary.
- Node 24 runs `.ts` files natively by overwriting types with spaces. It does not type check, does not read `tsconfig.json`, and only supports erasable syntax: no enums, runtime namespaces or parameter properties. Imports need the `.ts` extension, and type-only imports need the word `type`.
- Only `tsc` (and editors) check types. Use `tsc --noEmit` in CI, with `strict`, `erasableSyntaxOnly` and `verbatimModuleSyntax` turned on. Write `strict` and `types` explicitly because defaults differ between TypeScript versions. Install `@types/node` matching your Node major; `.d.ts` files describe JavaScript, and DefinitelyTyped is where `@types/*` come from.
- TypeScript is structural: the shape of a value decides if it fits, not its name. `interface` can merge, `type` can name unions. Use a brand when two values with the same shape must not be mixed up.
- Prefer `unknown` over `any`, narrow with `typeof`, `in`, `instanceof` and discriminated unions, and use `never` for exhaustive checks. An assertion (`as`, `!`) is a promise nobody checks.
- Use unions of string literals or `as const` objects instead of enums, `satisfies` for config tables, and generics with constraints for reusable code. Mapped, conditional and template literal types compute new types from old ones.
- In classes, `private` is compile-time only and `#private` is real. Narrow caught errors with a guard such as `NodeJS.ErrnoException`.
- Compile with `tsc` or a bundler for libraries, decorators and older Node. Migrate JavaScript gradually with `allowJs`, `checkJs` and JSDoc.

## Quick check

1. Does Node 24 type check your TypeScript when you run `node app.ts`?
<details><summary>Answer</summary>

No. It only removes the types (by replacing them with spaces) and runs the JavaScript. `const x: number = 'string'` runs fine. Type checking is done by `tsc` (for example `tsc --noEmit`) or your editor.

</details>

2. Name three pieces of TypeScript syntax that Node's type stripping refuses, and a replacement for each.
<details><summary>Answer</summary>

`enum` (use an `as const` object or a union of string literals), constructor parameter properties like `constructor(private x: number)` (declare the field and assign it in the constructor), and `namespace` with runtime values (use a module or a plain object). Others: `import x = require()`, `export =`, angle bracket casts, decorators, JSX.

</details>

3. Why must you write `import type { Shape } from './shapes.ts'` for an interface, and why the `.ts` extension?
<details><summary>Answer</summary>

Node strips one file at a time and never opens the imported file, so it cannot know `Shape` is only a type. A plain `import { Shape }` is kept, and at link time the module has no export named `Shape`, which fails. The `.ts` extension is needed because Node does no extension guessing: it loads exactly the path you wrote.

</details>

4. What is the difference between `interface` and `type`?
<details><summary>Answer</summary>

Both describe object shapes. Interfaces can be declared twice and merge (declaration merging), and they extend with `extends`. Type aliases cannot merge (duplicate is an error), but they can name unions, tuples, primitives and function types, and they combine with `&`.

</details>

5. What is wrong with `const user: User = JSON.parse(text)`?
<details><summary>Answer</summary>

`JSON.parse` returns `any`, so the compiler accepts the assignment without checking anything. If the data has the wrong shape, the type is a lie and you get a crash later. Parse into `unknown` and validate with a type guard or a schema library, then use the validated value.

</details>

6. What is the difference between `any`, `unknown` and `never`?
<details><summary>Answer</summary>

`any` turns type checking off for that value. `unknown` means "could be anything" but you must narrow it before use. `never` is the type with no values: the return type of a function that always throws, or what is left of a union after every case is handled.

</details>

7. What does `satisfies` do that a type annotation does not?
<details><summary>Answer</summary>

It checks that a value fits a type but keeps the value's own, more exact type. With `const d = { port: 3000 } satisfies Record<string, string | number>`, `d.port` is still a `number`. With `const d: Record<string, string | number> = ...`, `d.port` becomes `string | number`.

</details>

8. TypeScript compares shapes, not names. So how do you stop a `UserId` and an `OrderId` (both numbers) from being mixed up, and why is `@types/node` a separate package?
<details><summary>Answer</summary>

TypeScript is structural: two types with the same shape are interchangeable. To separate them, use a brand: `type UserId = number & { readonly __brand: 'UserId' }`, created only by a function that validates the number. Separately, Node's built-in modules carry no types, so `@types/node` (declaration files for `fs`, `process`, `Buffer`...) is a dev dependency whose major version should match your Node major (`@types/node@24`). With TypeScript 6 you also list it in `"types": ["node"]`.

</details>

9. Node ignores `tsconfig.json`. What happens to the `paths` option at runtime, and what do you use instead?
<details><summary>Answer</summary>

Nothing: `paths` only affects `tsc` and the editor, so aliased imports would fail at runtime. Use Node's subpath imports in `package.json` (for example `"imports": { "#lib/*": "./lib/*.ts" }`), which both Node and `tsc` understand, or compile with a bundler that rewrites the paths.

</details>

10. When would you still compile with `tsc` or a bundler instead of running `.ts` directly?
<details><summary>Answer</summary>

When you publish a library (consumers need `.js` and `.d.ts`; `.ts` under `node_modules` is refused), when you use enums, decorators (NestJS, TypeORM), JSX or `paths`, when you must support a Node version without type stripping, or when you want a single bundled and minified file.

</details>

## Try it yourself

Create a scratch file anywhere (for example `scratch.ts`) and run it with `node scratch.ts`. Each solution below was run on Node 24.16.0 and type checked with `tsc` 6.0.3.

**Task 1 (easy): a safe divide.** Write `divide(a, b)` that returns a discriminated union: `{ ok: true; value: number }` or `{ ok: false; error: string }` (error when `b` is `0`). Print the result of `divide(10, 4)` and `divide(1, 0)` by checking `ok`.

<details><summary>Hint</summary>

Declare `type Result<T> = { ok: true; value: T } | { ok: false; error: string }`. After `if (result.ok)`, TypeScript knows `result.value` exists. In the `else` branch it knows `result.error` exists.

</details>

<details><summary>Solution</summary>

```ts
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function divide(a: number, b: number): Result<number> {
  if (b === 0) return { ok: false, error: 'cannot divide by zero' };
  return { ok: true, value: a / b };
}

for (const [a, b] of [[10, 4], [1, 0]] as const) {
  const result = divide(a, b);
  if (result.ok) console.log(`${a} / ${b} =`, result.value);
  else console.log(`${a} / ${b} failed:`, result.error);
}
```

Output:

```text
10 / 4 = 2.5
1 / 0 failed: cannot divide by zero
```

</details>

**Task 2 (medium): a log level from the environment.** Define the levels `'debug' | 'info' | 'warn' | 'error'` from one `as const` array (no `enum`). Write a type guard `isLevel(value: unknown): value is Level` and `levelFromEnv(env, fallback = 'info')` that reads `env.LOG_LEVEL` (any letter case) and returns the fallback for unknown text. Add `shouldLog(current, message)`.

<details><summary>Hint</summary>

`const LEVELS = ['debug', 'info', 'warn', 'error'] as const;` then `type Level = (typeof LEVELS)[number];`. For the guard, `(LEVELS as readonly string[]).includes(value)`. For `shouldLog`, compare positions with `LEVELS.indexOf(...)`. Pass `env` as a parameter (`NodeJS.ProcessEnv`) so you can test it without touching the real environment.

</details>

<details><summary>Solution</summary>

```ts
const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type Level = (typeof LEVELS)[number];

function isLevel(value: unknown): value is Level {
  return typeof value === 'string' && (LEVELS as readonly string[]).includes(value);
}

function levelFromEnv(env: NodeJS.ProcessEnv, fallback: Level = 'info'): Level {
  const raw = env.LOG_LEVEL?.toLowerCase();
  return isLevel(raw) ? raw : fallback;
}

function shouldLog(current: Level, message: Level): boolean {
  return LEVELS.indexOf(message) >= LEVELS.indexOf(current);
}

console.log(levelFromEnv({ LOG_LEVEL: 'WARN' }));
console.log(levelFromEnv({ LOG_LEVEL: 'loud' }));
console.log(levelFromEnv({}));
console.log(shouldLog('warn', 'info'), shouldLog('warn', 'error'));
```

Output:

```text
warn
info
info
false true
```

</details>

**Task 3 (harder): a tiny schema library that infers types.** Build the idea behind zod in about 30 lines. A `Parser<T>` is a function `(value: unknown) => T` that throws on bad input. Write `string`, `number`, `array(parser)` and `object({ ... })` parsers, and a type `Infer<P>` that extracts `T` from a parser, so `type User = Infer<typeof parseUser>` is `{ id: number; name: string; tags: string[] }`. Error messages should include the failing key.

<details><summary>Hint</summary>

`type Infer<P> = P extends Parser<infer T> ? T : never;` (`infer` means "work out this part"). For `object`, make the function generic over the shape, `Shape extends Record<string, Parser<unknown>>`, return `Parser<{ [K in keyof Shape]: Infer<Shape[K]> }>`, loop over `Object.keys(shape)`, and wrap each key's error with the key name.

</details>

<details><summary>Solution</summary>

```ts
type Parser<T> = (value: unknown) => T;
type Infer<P> = P extends Parser<infer T> ? T : never;

const string: Parser<string> = (value) => {
  if (typeof value !== 'string') throw new TypeError('expected a string');
  return value;
};
const number: Parser<number> = (value) => {
  if (typeof value !== 'number') throw new TypeError('expected a number');
  return value;
};
function array<T>(item: Parser<T>): Parser<T[]> {
  return (value) => {
    if (!Array.isArray(value)) throw new TypeError('expected an array');
    return value.map(item);
  };
}
function object<Shape extends Record<string, Parser<unknown>>>(shape: Shape): Parser<{ [K in keyof Shape]: Infer<Shape[K]> }> {
  return (value) => {
    if (typeof value !== 'object' || value === null) throw new TypeError('expected an object');
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(shape)) {
      try {
        output[key] = shape[key](input[key]);
      } catch (error) {
        throw new TypeError(`${key}: ${(error as Error).message}`);
      }
    }
    return output as { [K in keyof Shape]: Infer<Shape[K]> };
  };
}

const parseUser = object({ id: number, name: string, tags: array(string) });
type User = Infer<typeof parseUser>; // { id: number; name: string; tags: string[] }

const user: User = parseUser(JSON.parse('{"id":1,"name":"Asha","tags":["a","b"]}'));
console.log(user.name.toUpperCase(), user.tags.length);
try {
  parseUser({ id: 1, name: 'Asha', tags: [1] });
} catch (error) {
  console.log((error as Error).message);
}
try {
  parseUser({ id: '1' });
} catch (error) {
  console.log((error as Error).message);
}
```

Output:

```text
ASHA 2
tags: expected a string
id: expected a number
```

Editor check: hover over `user` and you see the inferred type. Try `user.nope` and the compiler objects, even though `parseUser` is ordinary runtime code.

</details>

## Where to go next
- Next lesson: [22. Modern Node.js: What Changed in Node 18, 20, 22 and 24](../22-modern-node-features/README.md) (type stripping, `--env-file` and `--watch` in the bigger picture).
- Practise the interview questions for this topic: [Round 1: screening](../../rounds/round-1-screening/questions.md), [Round 2: core](../../rounds/round-2-core/questions.md), [Round 3: coding](../../rounds/round-3-coding/questions.md) and [Round 4: advanced](../../rounds/round-4-advanced/questions.md).
