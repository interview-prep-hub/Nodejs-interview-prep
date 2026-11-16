# 03. Modules: CommonJS and ES Modules

> Level: Beginner   Time: about 120 minutes   Node: 24 (notes where older versions differ)

[Previous: 02. JavaScript Essentials for Node Interviews](../02-javascript-essentials/README.md) | [All lessons](../../README.md) | [Next: 04. npm, package.json and Dependencies](../04-npm-and-package-json/README.md)

## What you will learn
- Why code is split into modules, and the two module systems Node has: CommonJS and ES modules.
- How `require`, `module.exports` and `exports` work, and why `exports = {...}` is a bug.
- What the module wrapper function is, and where `__dirname`, `__filename`, `require` and `module` come from.
- How module caching works, how `require()` finds a file (core modules, relative paths, `node_modules`, extensions, `index.js`, `main`), and what circular dependencies do in both systems.
- ES module syntax: named and default exports, live bindings, `import.meta`, top-level `await`, dynamic `import()`.
- How Node decides which system a file uses, and how the two systems talk to each other (`require(esm)`, `createRequire`).
- The `node:` prefix, the `exports` and `imports` fields of `package.json`, JSON imports, and three module patterns (singleton, barrel file, dependency injection).
- Advanced: how to debug module errors, and how module hooks change what gets loaded.

All examples are in [examples/](examples/). Run them from the repo root, for example `node lessons/03-modules/examples/03-cache.js`. Files that start with `_` (folders such as `_lib` and `_circular`) are helper files that the examples load. This course writes ES module examples with the `.mjs` extension, so Node never has to guess.

## 1. Why modules exist

A **module** is one file that keeps its own variables private and shares only what it chooses to share. Think of a toolbox with labelled drawers: you open only the drawer you need, and the tools in the other drawers cannot get mixed up with yours.

Early web pages loaded many `<script>` tags, and every top-level variable became a global. Two scripts that both declared `user` would overwrite each other. Modules fix this:

- **Private scope.** A variable in one file cannot clash with a variable in another file. (Scope means "the part of the code where a name is visible".)
- **Reuse.** You write `math.js` once and use it in ten places.
- **Explicit dependencies.** The top of a file shows what it needs.
- **Easier tests.** A small file with a clear surface is easy to test.

**Why two systems?** Node was created in 2009, when JavaScript had no module feature at all. Node copied a community design called CommonJS. Years later (ES2015) the language itself got an official module system, ES modules. Node had to keep the old one working for the millions of packages already written, so it now supports both, and both work in Node 24:

| Name | Short | You write | Where it comes from |
|---|---|---|---|
| CommonJS | CJS | `require()` and `module.exports` | Node's original system |
| ES modules | ESM | `import` and `export` | The official JavaScript standard (ES2015) |

You load three kinds of modules: **your own files** (`./math.js`), **core modules** that ship inside Node (`node:fs`), and **packages** you install with npm (`express`, stored in a `node_modules` folder).

> **Interview tip:** "What is the difference between CommonJS and ES modules?" is one of the most common Node questions. A strong answer covers syntax, loading (sync or async), bindings (copies or live), top-level `await`, strict mode, file extensions, and how they interoperate. This lesson builds that answer one piece at a time. Section 11 has the summary table.

## 2. Your first CommonJS module

A CommonJS module puts what it wants to share on `module.exports`. Another file gets it back from `require()`.

```js
// examples/_exports/replace-object.js
module.exports = {
  greet: (name) => `Hello, ${name}`,
  version: 1,
};
```

```js
// in another file
const tools = require('./_exports/replace-object.js');
console.log(tools.greet('Ada')); // Hello, Ada
```

What `require('./x.js')` does: it finds the file, runs it once, and returns whatever that file put on `module.exports`. A path that starts with `./` or `../` means "a file next to me". A bare name that does not start with `./`, `../` or `/`, like `express` or `node:fs`, means "a package or a core module" (section 6).

You can share anything: an object, a function, a class, a number. The usual shapes:

```js
const tools = require('./tools.js');            // keep the whole object
const { greet, version } = require('./tools.js'); // pick the parts you need
const greet = require('./greet.js');            // the module IS one function
```

> **Remember:** a module that is only loaded for its side effects (it starts something, or prints something) is loaded with a bare call: `require('./setup.js');`.

## 3. exports vs module.exports

Every CommonJS file starts with `module.exports` set to an empty object, and a second name, `exports`, that points to the **same** object. Picture two name tags stuck on one box:

```text
exports ---------+
                 v
              { empty object }
                 ^
module.exports --+       require() hands back whatever module.exports points to
```

There are two ways to share things.

```js
// Style 1: add properties to the existing object
exports.greet = (name) => `Hello, ${name}`;
exports.version = 1;

// Style 2: replace module.exports with a new value
module.exports = { greet: (name) => `Hello, ${name}`, version: 1 };
module.exports = function greet(name) { return `Hello, ${name}`; };
```

`require()` always returns `module.exports`. It never looks at `exports`. That is the whole secret, and it explains the classic bug:

```js
// examples/_exports/bug-reassign.js
exports = {
  greet: (name) => `Hello, ${name}`,
  version: 1,
};
```

`exports = {...}` makes the local name `exports` point at a new object. The real `module.exports` is still the original empty object, so the caller gets `{}`. Nothing throws, which is why this bug is annoying.

Run [examples/02-exports-bug.js](examples/02-exports-bug.js):

```bash
node lessons/03-modules/examples/02-exports-bug.js
```

```text
1. exports.x = ...        -> Hello, Ada | version 1
2. module.exports = {...} -> Hello, Ada | version 1
3. module.exports = fn    -> Hello, Ada
4. exports = {...} (bug)  -> {} | greet is undefined
5. mixed styles           -> { second: 2 }
6. the same bug by hand   -> {} (the new object is lost)
```

Line 5 comes from a file that does `exports.first = 1;`, then `module.exports = { second: 2 };`, then `exports.third = 3;`. The first and third lines write to the old object, which is thrown away when `module.exports` is replaced. Only `{ second: 2 }` survives.

Line 6 shows the same thing without modules. Node does roughly this for you:

```js
const module = { exports: {} };
let exports = module.exports; // two names, one object
exports = { a: 1 };           // the name moves, the object in module.exports does not
return module.exports;        // {}
```

> **Interview tip:** "What is the difference between `exports` and `module.exports`?" A strong answer: "`exports` is a shortcut variable that starts out pointing at `module.exports`. `require` returns `module.exports`. Adding properties to `exports` works, but assigning to `exports` only changes the local variable, so the export is lost. To export a function or class, assign to `module.exports`." If in doubt, always use `module.exports =`.

## 4. The module wrapper: where require, module and __dirname come from

`require`, `module`, `exports`, `__filename` and `__dirname` look like globals, but they are not. Node wraps every CommonJS file in a function and passes these five values in as parameters. Your file is the body of that function.

Run [examples/01-wrapper.js](examples/01-wrapper.js):

```bash
node lessons/03-modules/examples/01-wrapper.js
```

```text
arguments.length: 5
types: object function object string string
are they globals? false false false
(function (exports, require, module, __filename, __dirname) { /* your code */
});
basename(__filename): 01-wrapper.js
basename(__dirname):  examples
exports === module.exports: true
this === module.exports:    true
require.main === module: true
module.id: .
module.loaded now: false
sloppy mode (this is globalThis in a plain function): true
returning from the top level of a file
module.loaded later: true
```

What this tells you:

| Value | What it is |
|---|---|
| `exports` | Shortcut to `module.exports` (the same object at the start) |
| `require` | A function that loads other modules. It has helpers: `require.resolve`, `require.cache`, `require.main` |
| `module` | An object describing this file: `id`, `path`, `filename`, `exports`, `loaded`, `children`, `paths` |
| `__filename` | Absolute path of this file |
| `__dirname` | Absolute path of this file's folder |

Consequences you can use:

- **Top-level variables are private.** `var x = 1;` at the top of a file is a local of the wrapper function, not a global. That is how files avoid clashing.
- **Top-level `this` is `module.exports`.** Not `globalThis`.
- **A top-level `return` is legal** in CommonJS, because the file is a function body. The last lines of the example use it.
- **CommonJS is sloppy mode by default.** Sloppy mode is the old, forgiving way JavaScript runs unless you ask for `'use strict'` (for example, assigning to an undeclared variable quietly creates a global). Inside a plain function, `this` is `globalThis` (the output shows `true`). ES modules are always strict.
- **`require.main === module`** is true only for the file you started with `node file.js`. It is the classic "run this file directly" test:

```js
if (require.main === module) {
  main(); // runs for `node tool.js`, but not when another file requires tool.js
}
```

Older code may test `module.parent` for the same purpose. It is deprecated, so use `require.main`.

> **Common mistake:** mixing up `__dirname` and the current working directory. `require('./x')` and `path.join(__dirname, 'x')` are relative to the **file**. `fs.readFileSync('./x')` is relative to the folder where you ran `node` (the **cwd**, `process.cwd()`). Running the script from another folder breaks the second one. Build paths from `__dirname`.

> **Interview tip:** "Where do `__dirname` and `require` come from? They are not globals." A strong answer: "Node wraps each CommonJS file in a function and passes them in as the five parameters `exports`, `require`, `module`, `__filename`, `__dirname`. That is why top-level variables are private and why a top-level `return` works. ES modules are not wrapped, so those names do not exist there."

> **Under the hood:** `require('node:module').wrap('...')` prints the classic wrapper text, which is a good picture of the idea. In the normal case Node does not paste text together: it compiles your file directly as a function with those five parameters. Use `wrap` only to learn, never in real code.

## 5. Module caching

The first time a file is required, Node runs it and stores the result. Every later `require()` of the same file returns the stored `module.exports` and does **not** run the file again. The store is `require.cache`: an object whose keys are absolute file paths.

Run [examples/03-cache.js](examples/03-cache.js):

```bash
node lessons/03-modules/examples/03-cache.js
```

```text
--- 1. require the same file twice
  [loud-counter.js] the module code is running
same object? true
--- 2. another module requires it too: shared state
bumpTwice() returned 2
first.get() sees 2
--- 3. look inside require.cache
cached files: [ '03-cache.js', 'loud-counter.js', 'uses-loud-counter.js' ]
key is an absolute path? true
cache entry holds the same exports? true
cache entry loaded flag: true
--- 4. delete the cache entry, then require again
  [loud-counter.js] the module code is running
same object as before? false
fresh.get() starts again at 0 but the old one still says 2
```

Read it step by step:

1. Two `require` calls, one line of "running". The second call got the cached object.
2. A different file (`uses-loud-counter.js`) also requires the counter and bumps it twice. The first file sees the change, because both hold the **same object**. A module-level variable is shared state for the whole program.
3. `require.cache` lists the three files. The key is the resolved absolute path.
4. `delete require.cache[key]` removes the entry. The next `require` runs the file again and builds a new object. Old references keep the old object.

Good to know:

- The cache key is the **resolved file path**, not the string you typed. `require('./a')` and `require('./a.js')` share one entry.
- The same package installed twice in different `node_modules` folders is two files, so two cache entries and two copies of its state.
- On a case-insensitive file system, `require('./CNT.js')` and `require('./cnt.js')` can point at the same file but get **two** cache entries, so the file runs twice. This reproduces on Windows (checked on Node 24.16). The Node docs give the same warning for macOS, which is case-insensitive by default, but this lesson did not run it there. Keep the exact letter case in your paths.
- JSON files are cached too: `require('./data.json')` returns the same parsed object every time, so changing it in one place changes it everywhere.
- `module.loaded` is `false` while the file is running and becomes `true` when it finishes (the last line of the wrapper example shows both).
- `require()` is **synchronous**: the program waits until the file has been read from disk and run. That is fine at start-up. Avoid a first-time `require()` inside a busy request handler, because it blocks every other request while the disk is read (later calls are cheap because of the cache). Loading a rarely used module on first use, inside the function that needs it, is called **lazy loading**.
- Clearing the cache is a hack for tools like hot reload. It does not free old objects, and ES modules have no cache you can clear (section 10 shows a workaround).

> **Interview tip:** "Is a CommonJS module executed every time you `require` it?" No: once, then cached by resolved filename. "How would you get a fresh copy?" Delete the entry from `require.cache`, or export a factory function and call it each time. The factory is the cleaner answer.

## 6. How require() finds a file

When you call `require('x')`, Node follows these steps in this order and stops at the first match.

1. **Core module?** If `x` is a built-in name such as `fs` or `node:fs`, return it. Core modules win even if a package with the same name exists in `node_modules`.
2. **Starts with `./`, `../` or `/`?** It is a file path.
   - Try the exact file name.
   - Then try adding `.js`, then `.json`, then `.node` (a compiled addon).
   - If it is a folder: read its `package.json` `"main"` field and use that file. If there is no `main`, use `index.js`, then `index.json`, then `index.node`.
3. **Otherwise it is a package name.** Look for `node_modules/x` in the current file's folder, then in the parent folder, then its parent, all the way up to the root of the drive. In each `node_modules`, apply the file/folder rules above (a package uses its `"exports"` field first, section 15, then `"main"`, then `index.js`).
4. **Nothing found?** Throw an error with `code: 'MODULE_NOT_FOUND'`.

Names that start with `#` are package-internal aliases (section 15). As a last resort for old setups, Node also checks the `NODE_PATH` environment variable and a few global folders such as `~/.node_modules`. Do not rely on them. `require.extensions`, an old hook that let tools teach `require` new file types, is deprecated too (section 18 shows the modern hooks).

Run [examples/04-resolution.js](examples/04-resolution.js). It builds a small project in a temp folder (the layout is written as an object in the code) and asks `require.resolve()` where each request ends up. `require.resolve` does the lookup but does not run the file:

```bash
node lessons/03-modules/examples/04-resolution.js
```

```text
--- resolve results (paths are relative to the temp project)
core "fs"              -> fs
relative "./util"      -> app/src/deep/util.js
relative "./config"    -> app/src/deep/config.js
relative "./data"      -> app/src/deep/data.json
folder "../tools"      -> app/src/tools/index.js
package "greeter"      -> app/node_modules/greeter/lib/main.js
package "shared"       -> node_modules/shared/index.js
missing "./nope"       -> MODULE_NOT_FOUND
missing "ghost-pkg"    -> MODULE_NOT_FOUND
--- folders searched for a package name, in order
  app/src/deep/node_modules
  app/src/node_modules
  app/node_modules
  node_modules
--- the node: prefix
isBuiltin("fs"): true | isBuiltin("node:fs"): true
require("node:fs") === require("fs"): true
require("test"): MODULE_NOT_FOUND
require("node:test") is a function
require("node:nope"): ERR_UNKNOWN_BUILTIN_MODULE
```

Why each line looks the way it does:

- `core "fs"` came back as just `fs`. The project even has a fake `node_modules/fs/index.js`, and it lost.
- `./config` exists as both `config.js` and `config.json`. The `.js` file wins, because `.js` is tried first.
- `./data` has only `data.json`, so the `.json` extension was added.
- `../tools` is a folder, so its `index.js` was used.
- `greeter` exists in two `node_modules` folders. The **closest** one wins, and its `package.json` `"main"` (`lib/main.js`) decided the file. The outer copy is never reached.
- `shared` exists only in the outer folder, so Node walked up to find it.
- The list shows the exact folders searched, nearest first. They are in `module.paths`.

> **Common mistake:** `require('utils')` when you meant `require('./utils')`. Without `./`, Node looks for a package named `utils`, finds none, and throws `MODULE_NOT_FOUND`. Also, a failed require lists the "Require stack": the chain of files that led to it. Read that list first.

> **Interview tip:** be ready to say the resolution order out loud: core module, then file path (extensions, then folder with `main` or `index`), then `node_modules` walking up the tree. Mention that the nearest `node_modules` wins, which is why nested duplicate versions work.

## 7. Circular dependencies

A **circular dependency** is when `a.js` requires `b.js` and `b.js` requires `a.js` (directly or through other files). Node must not loop forever, so it breaks the cycle with one rule: when a module is required while it is still running, the caller gets its **partial exports**: whatever has been put on `module.exports` so far.

The helper files are in [examples/_circular/](examples/_circular/). `a.js` sets `exports.done = false`, requires `b.js`, then sets `exports.done = true`. `b.js` does the same in the opposite direction. Run [examples/05-circular.js](examples/05-circular.js):

```bash
node lessons/03-modules/examples/05-circular.js
```

```text
main: start
  a.js: start
  b.js: start
  b.js: a is unfinished, a.done = false
  b.js: end
  a.js: back in a.js, b.done = true
  a.js: end
main: a.done = true | b.done = true

--- the module.exports trap
  d.js: typeof c.name = undefined | own keys of c = 0
main: c = { name: 'c', fromD: 'd' }
```

Follow the order. `main` requires `a`. `a` starts, then requires `b`. `b` starts, then requires `a`, which is **already running**, so `b` receives a's partial exports (`done` is still `false`). `b` finishes, control returns to `a`, which finishes. Everything ends fine, but `b` saw an unfinished `a`.

The second half shows the trap. `c.js` requires `d.js` first and only later does `module.exports = { ... }`. When `d.js` requires `c.js` back, it gets the **old empty object**, and `c` replaces it afterwards, so `d` never sees the new one. Node warns on stderr when you read a missing property from such a partial module (the number in brackets is the process id and will differ):

```text
(node:12345) Warning: Accessing non-existent property 'name' of module exports inside circular dependency
```

Now the same shape with ES modules. Run [examples/05-circular.mjs](examples/05-circular.mjs):

```bash
node lessons/03-modules/examples/05-circular.mjs
```

```text
  b.mjs: start
  b.mjs: reading a -> ReferenceError: Cannot access 'a' before initialization
  b.mjs: hoisted() = hoisted function from a.mjs
  a.mjs: start (runs after b.mjs)
  a.mjs: b = value of b
  a.mjs: readA() = value of a
main: start (all imports have already run)
main: a.a = value of a
main: a.hoisted() = hoisted function from a.mjs
```

ES modules do not hand out partial copies. They hand out **live bindings** to variables that may not be set yet. (A binding is the link between a name and a variable. "Live" means the importer's name points at the exporter's own variable, not at a copy. Section 9 explains this fully.)

Follow the output. `main` imports `a.mjs`. `a.mjs` imports `b.mjs` first, so `b.mjs` runs first. When `b.mjs` reads `const a`, the variable exists but its line has not run yet, and reading it throws a `ReferenceError`. That window is called the **temporal dead zone**: a `let`, `const` or `class` name cannot be read before the line that creates it has run. A `function` declaration is ready before any code runs, so `hoisted()` works. By the time `readA()` is called later, `a` has its value.

How to avoid cycles:

- Move the shared code into a third file that both can import.
- Require lazily: call `require('./b.js')` inside the function that needs it, not at the top.
- Do not replace `module.exports` after requiring something that might loop back. Set it early, or use `exports.x = ...`.

> **Interview tip:** "What happens with circular `require`?" Answer: no infinite loop; the second module gets the partially filled `module.exports` of the first, so some values can be `undefined` at that moment. In ESM you get live bindings, and touching a `let`, `const` or `class` binding too early is a `ReferenceError` (the temporal dead zone), while function declarations already work. A strong answer ends with the fix: "I would remove the cycle by moving the shared code into a third module."

## 8. ES modules: import and export

ES modules (ESM) are the module system built into the JavaScript language. The syntax is the same in browsers and Node.

**Exporting**

```js
export const PI = 3.14159;            // named export
export function area(r) { return PI * r * r; }
export default function describe() {} // default export (at most one per file)
export { area as circleArea };        // export under another name
export * from './other.mjs';          // re-export every named export of another file
export * as other from './other.mjs'; // re-export the whole namespace under one name
export { default as thing } from './other.mjs'; // re-export a default under a name
```

**Importing**

```js
import describe from './shapes.mjs';            // default: no braces, any name you like
import { PI, area as circleArea } from './shapes.mjs'; // named: braces, `as` renames
import describe, { PI } from './shapes.mjs';    // both
import * as shapes from './shapes.mjs';         // namespace object: one object holding every export
import './setup.mjs';                           // run the file, import nothing
```

How CommonJS code maps to ES module code:

| CommonJS | ES module |
|---|---|
| `module.exports = fn` | `export default fn` |
| `exports.a = 1` | `export const a = 1` |
| `const x = require('./x.js')` | `import x from './x.mjs'` |
| `const { a } = require('./x.js')` | `import { a } from './x.mjs'` |
| `require('./setup.js')` | `import './setup.mjs'` |
| `__dirname` | `import.meta.dirname` |
| `require.main === module` | `import.meta.main` |

Rules to remember:

- A relative path must start with `./`, `../` or `/`, and must include the **file extension**: `'./shapes.mjs'`, not `'./shapes'`. ESM does not try extra extensions and does not look for `index.js` in a folder.
- A bare name such as `'express'` is still looked up in `node_modules` (walking up folders, using the package's `"exports"` field, section 15). `NODE_PATH` is not used. `'node:fs'` is a core module.
- Under the hood an import path is a **URL**, not a file path. That is why the file extension is needed, why Windows paths like `C:\app\x.mjs` fail, and why `x.mjs?v=2` counts as a different module (section 10).
- ES modules are always in **strict mode**.
- `import` lines run **before** the rest of the file, no matter where you write them. All imported files finish first.

Run [examples/06-esm-basics.mjs](examples/06-esm-basics.mjs) (it uses `_lib/shapes.mjs`, which has named exports plus a default):

```bash
node lessons/03-modules/examples/06-esm-basics.mjs
```

```text
  [shapes.mjs] the module code is running
1. first line of this file. The imports above already ran shapes.mjs.
2. a circle | PI = 3.14159 | area(2) = 12.56636
3. namespace keys: [ 'PI', 'circleArea', 'default', 'squareArea' ]
   shapes.default === describe: true
4. import inside a block -> SyntaxError
5. import.meta keys: [ 'dirname', 'filename', 'main', 'resolve', 'url' ]
   basename(import.meta.filename): 06-esm-basics.mjs
   basename(import.meta.dirname):  examples
   url is a file: URL: true
   import.meta.main: true
6. typeof __filename, __dirname, require, module, exports: undefined undefined undefined undefined undefined
   this at the top level: undefined
   strict mode -> ReferenceError
7. createRequire: { alpha: 1, beta: 2 }
8. JSON import: { name: 'demo-data', items: [ 1, 2, 3 ] }
```

Notice that the helper's "running" line comes **before** line 1 of the importing file. That is **import hoisting** (imports are lifted to the front and finished first). The namespace object lists names in alphabetical order, and the default export is just a name called `default`. Item 4 uses `await import()` to test the "imports must be at the top level" rule (section 9). Items 5 and 6 are explained in sections 10 and 13.

**Default or named?** A default export can be imported under any name, so two files may call the same thing by different names. Named exports keep one name everywhere, give better editor help, and let tools see which exports are unused. Many teams prefer named exports. In CommonJS terms, `export default` is closest to `module.exports = value`.

> **Interview tip:** "Default export or named exports?" There is no single right answer, so give a reason. "I prefer named exports: one stable name across the code base, better auto-complete and refactoring, and bundlers can drop the unused ones. I use a default export when a file is clearly one thing, like a React component or a single class." Also know that `import` is hoisted: you cannot make it run later by moving the line.

> **Under the hood:** `export default x` is the same as exporting a binding called `default`. That is why `shapes.default` shows up in the namespace and why `import { default as describe } from ...` is valid.

## 9. Live bindings and static structure

In CommonJS, `require` hands you a **copy of a value** (or a reference to the exports object). In ESM, an import is a **live, read-only view** of the variable inside the exporting module. If the exporter changes the variable, every importer sees the new value. The importer cannot assign to it.

Run [examples/07-live-bindings.mjs](examples/07-live-bindings.mjs):

```bash
node lessons/03-modules/examples/07-live-bindings.mjs
```

```text
--- 1. ES module: the import is a live view of the exporter variable
before increment(): 0
after increment():  1 | via namespace: 1
--- 2. the importer cannot assign to an import
count = 99          -> TypeError: Assignment to constant variable.
namespace.count = 99 -> TypeError
--- 3. CommonJS: the number was copied into the exports object
named import cjsCount:    0 (stale copy)
cjsCounter.count:         0 (stale copy)
cjsCounter.getCount():    1 (asks the module, always fresh)
--- 4. importing CommonJS: the default import is always module.exports
default import: { alpha: 1, beta: 2 }
--- 5. named imports from CommonJS only work when Node can detect the names
names found in cjs-counter.js:    [ 'count', 'default', 'getCount', 'increment', 'module.exports' ]
names found in literal-exports.js: [ 'default', 'module.exports' ]
import { alpha } -> SyntaxError: Named export 'alpha' not found. The requested module './literal-exports.js' is a CommonJS module, which may not support all module.exports as named exports.
```

Parts 1 to 3 are the point of this section. The ESM counter is `export let count = 0;` plus an `increment()` that does `count += 1`. After calling `increment()`, the importer's `count` reads `1`. The CommonJS counter wrote `module.exports = { count, increment, getCount }`, which copied the number `0` into the object at that moment. Later changes to the inner variable never reach the copy. The fix in CommonJS is to export a function (`getCount()`) or to keep the state on the exported object. Parts 4 and 5 are about importing CommonJS, which is covered in section 13.

The second idea is **static structure**. `import` and `export` must be at the top level of a file, and the path must be a plain string. You cannot write `if (x) { import ... }`, and you cannot build the path from a variable (`import x from name`). Example 06 proves the first rule: an `import` inside a block is a `SyntaxError`. That sounds limiting, but it means Node and tools can read all the imports **before running any code**. Node does it in three steps:

1. **Find and parse** every file in the import graph.
2. **Link**: create the variables for every export and connect the imports to them. This is when a missing name such as `{ alpha }` is reported, before any code runs.
3. **Evaluate**: run the files, dependencies first.

`require()` is the opposite: an ordinary function call that can sit in an `if`, take a computed string, and runs when reached. That is flexible, but tools cannot know the dependencies without running the code. In ESM, dynamic loading uses `import()` (section 10).

> **Interview tip:** "Why can bundlers tree-shake ES modules but not CommonJS?" (A bundler joins many files into one for the browser. Tree-shaking means it drops code that nobody uses.) Because ESM imports and exports are static: the tool can see exactly which names are used without running anything. CommonJS exports are built at run time.

## 10. import.meta, top-level await and dynamic import()

### import.meta

Inside an ES module, `import.meta` holds information about the current file (the output above prints its keys on Node 24.16):

| Property | What it is | Notes |
|---|---|---|
| `import.meta.url` | The file's URL, such as `file:///D:/app/x.mjs` on Windows or `file:///home/me/app/x.mjs` on Linux | Always available |
| `import.meta.filename` | Absolute file path (replaces `__filename`) | Node 20.11+ |
| `import.meta.dirname` | Absolute folder path (replaces `__dirname`) | Node 20.11+ |
| `import.meta.resolve('./x.mjs')` | The URL that an import would load | Returns a string |
| `import.meta.main` | `true` if this is the entry file (replaces `require.main === module`) | Node 24.2+, marked "early development" in the docs |

`filename` and `dirname` exist only for `file:` modules. On older Node versions, build them yourself:

```js
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

> **Common mistake (Windows):** passing a plain path to `import()`. `import('C:\\app\\x.mjs')` fails with `ERR_UNSUPPORTED_ESM_URL_SCHEME`, because ESM specifiers are URLs and `C:` looks like a URL scheme. Convert first with `pathToFileURL(path).href` (from `node:url`).

### Top-level await

In an ES module you can use `await` outside any function. The module simply waits.

```js
// config.mjs
export const config = await loadConfig(); // anyone importing config.mjs waits for this
```

Run [examples/08-await-and-dynamic-import.mjs](examples/08-await-and-dynamic-import.mjs):

```bash
node lessons/03-modules/examples/08-await-and-dynamic-import.mjs
```

```text
  [slow-config.mjs] start, pretending to load config for 50 ms
  [slow-config.mjs] finished
1. main: start, config = { region: 'eu', retries: 3 }
2. main: awaited at the top level -> 42
3. main: about to import shapes.mjs lazily
  [shapes.mjs] the module code is running
4. main: area of square 3 = 9 | default export: a square
  [square.mjs] loaded
5. computed specifier -> squareArea(2) = 4
6. same namespace object the second time: true
7. CommonJS through import(): { alpha: 1, beta: 2 }
8. JSON through import(): demo-data
9. missing file -> ERR_MODULE_NOT_FOUND
10. no extension -> ERR_MODULE_NOT_FOUND
11. query string makes a new copy -> true | counts: 1 0
12. folder import -> ERR_UNSUPPORTED_DIR_IMPORT
```

The first two lines come from `slow-config.mjs`, which uses top-level `await`. The importing file waited for it, so its own line 1 printed afterwards. Top-level `await` is allowed only in ES modules: in a CommonJS `.cjs` file it is a `SyntaxError`. A slow top-level `await` delays every file that imports it, so use it for startup work such as loading config, not for long jobs. If a top-level `await` waits on a promise that never settles, Node exits with code **13** and prints a warning about an unsettled top-level await.

### Dynamic import()

`import('./x.mjs')` looks like a function call and returns a **promise** for the module's namespace object. Its code does not run until you call it (lines 3 and 4 above).

- The specifier can be computed (line 5), so you can pick a plugin or a language file by name.
- It is **cached** like any other import (line 6): the file runs once.
- It works in **CommonJS files too**, and it can load both ES modules and CommonJS (line 7). This is how CommonJS code loaded ES-only packages for years.
- A failure is a rejected promise with a normal error `code`, so `try/catch` with `await` works (lines 9 and 10). A missing extension is `ERR_MODULE_NOT_FOUND` too, which is a good clue when you forget `.mjs`. A folder gives `ERR_UNSUPPORTED_DIR_IMPORT` (line 12).

**The ESM cache cannot be cleared, but it can be bypassed.** The cache key is the whole URL, so `./counter.mjs` and `./counter.mjs?copy=2` are two different modules. Line 11 shows the second one starting from `0` while the first has been incremented to `1`. Tools use this trick to "reload" a file (a changing query string such as `?t=1700000000`). Node has no way to unload an ES module, so every old copy stays in memory, and doing this in a long-running program leaks memory. In CommonJS you would delete the entry from `require.cache` instead (section 5).

> **Interview tip:** name three uses for `import()`: lazy loading rarely used code to speed up startup, loading a module chosen at run time, and loading an ES module from CommonJS. And know the limits: it returns a promise (so it cannot give you a value synchronously), and its result is the namespace object, so a CommonJS default export is on `.default`.

## 11. CommonJS and ES modules side by side

| Topic | CommonJS | ES modules |
|---|---|---|
| Syntax | `require()`, `module.exports`, `exports` | `import`, `export` |
| Loading | `require()` is synchronous: it blocks until the file has been read and run | Designed to load asynchronously; supports top-level `await` |
| Where allowed | `require()` anywhere, with computed strings | Static `import` only at the top level with a string; `import()` anywhere |
| When it runs | At the line where you wrote it | All `import` lines first (hoisted), dependencies before the importer |
| What you receive | `module.exports` (a value or an object you can copy from) | Live, read-only bindings |
| Top-level `this` | `module.exports` | `undefined` |
| Strict mode | Off by default (sloppy) | Always on |
| File extension in the path | Optional (`.js`, `.json`, `.node` tried) | Required; no folder `index.js` lookup |
| `__dirname`, `__filename` | Available | Not defined; use `import.meta.dirname` and `import.meta.filename` |
| `require`, `module`, `exports` | Available | Not defined; use `createRequire` if you need `require` |
| Top-level `await` | Not allowed | Allowed |
| JSON | `require('./x.json')` | `import x from './x.json' with { type: 'json' }` |
| Cache | `require.cache`, keyed by file path; you can change it | Internal, keyed by URL (a query string counts); you cannot clear it |
| Circular imports | Partial `module.exports` | Live bindings, early reads can hit the temporal dead zone |
| Typical file names | `.js` (default), `.cjs` | `.mjs`, or `.js` with `"type": "module"` |

Which should you use? Both are fully supported in Node 24. New projects usually choose ES modules because they are the language standard, support top-level `await`, and work with modern tools. Large older codebases stay on CommonJS. Since Node 22.12 the two can load each other in most cases (section 13), so the choice is much less painful than it was.

> **Remember:** the two systems differ in more than syntax. `import` is not "`require` with different spelling": bindings, timing and strictness all change.

> **Interview tip:** the classic question is "CommonJS vs ES modules?" A 30-second answer: "CommonJS is Node's original system: `require` is synchronous and returns `module.exports` (so a number on it is a plain copy, not live), it runs in sloppy mode, and it gets `__dirname` from a wrapper function. ES modules are the language standard: `import` is static, so tools can analyse it, bindings are live, strict mode is always on, top-level `await` works, file extensions are required, and there is no `__dirname` (use `import.meta.dirname`). Since Node 22.12 they can load each other, except that `require()` cannot load a module that uses top-level `await`."

## 12. How Node decides which system a file uses

Node must choose CommonJS or ESM **before** it runs a file. The rules, in order:

1. The extension **`.mjs`** is always an ES module. **`.cjs`** is always CommonJS. Nothing can override this.
2. A **`.js`** file follows the nearest `package.json` (Node searches the file's folder, then its parents) and its `"type"` field: `"module"` means ES module, `"commonjs"` means CommonJS. The search stops at the **first** `package.json` it finds. If that file has no `"type"`, Node does not keep looking upward: a typeless `package.json` inside a `"type": "module"` project makes its files ambiguous (rule 3), not ES modules.
3. If there is **no `"type"`** (or no `package.json` at all), the file is ambiguous. Node treats it as CommonJS first. If the code fails to parse because it uses ES-module-only syntax (`import` or `export` statements, `import.meta`, top-level `await`), Node runs it again as an ES module. This is called **syntax detection**. It is on by default since Node 22.7 (and 20.19), and the docs mark it as a release candidate. Redeclaring a wrapper name at the top level (for example `const require = ...;` or `const module = ...;`) also triggers it, because that would be an error in CommonJS. A plain dynamic `import()` does not count as ES module syntax.
4. For code given as text (`node -e` or standard input), `--input-type=module` or `--input-type=commonjs` picks the system.

Run [examples/10-package-json.js](examples/10-package-json.js). It writes small demo projects into a temp folder and runs one file at a time with a new `node` process. This is part 1 of its output:

```bash
node lessons/03-modules/examples/10-package-json.js
```

```text
--- 1. which system loads each file? (each file is run with a fresh node process)
file.mjs                                             -> ES module
file.cjs                                             -> CommonJS
file.js, package.json type "module"                  -> ES module
file.js, package.json type "commonjs"                -> CommonJS
file.js, no package.json at all                      -> CommonJS
import/export syntax, no package.json                -> ES module
import/export syntax, package.json without type      -> ES module (+ warning: set "type" in package.json)
import/export syntax, type "commonjs"                -> SyntaxError: Unexpected token 'export'
```

Read the last three lines carefully:

- With no `package.json`, a file with `export` is detected and works.
- With a `package.json` that has no `"type"`, it works too, but Node prints a warning (code `MODULE_TYPELESS_PACKAGE_JSON`) because it had to parse the file twice. The cure is to write `"type"` in your `package.json`.
- With `"type": "commonjs"` written down, nothing is guessed, so `export` is a `SyntaxError`.

The demo projects live in your temp folder (`os.tmpdir()`). The "no package.json at all" lines assume that no `package.json` exists in any parent folder of that temp folder. If you have one there (for example in your home folder), those lines would change.

The repo you are reading has a root `package.json` without `"type"`. That is why the ES module examples use `.mjs`.

Common errors and what they mean:

| Message | Cause | Fix |
|---|---|---|
| `Cannot use import statement outside a module` | A file that is explicitly CommonJS (`.cjs`, or `"type": "commonjs"`) contains `import`. A typeless `.js` file is detected as ESM instead | Rename to `.mjs`, or set `"type": "module"` |
| `ERR_UNSUPPORTED_DIR_IMPORT` | `import './folder'` in ESM: folders are not resolved to `index.js` | Write the full file path, such as `./folder/index.mjs` |
| `require is not defined` (ES module scope) | `require` used in an ES module | Use `import`, or `createRequire` |
| `__dirname is not defined` | `__dirname` used in an ES module | Use `import.meta.dirname` |
| `ERR_REQUIRE_ESM` | `require()` of an ES module where that is not supported (very old Node, or `--no-experimental-require-module`) | Upgrade, or use `import()` |
| `ERR_REQUIRE_ASYNC_MODULE` | `require()` of an ES module that uses top-level `await` | Use `import()` |

> **Interview tip:** "How does Node know a `.js` file is ESM?" Say: extension first (`.mjs`/`.cjs`), then `"type"` in the nearest `package.json`, and if neither decides, syntax detection (which costs a second parse, so set `"type"` anyway).

## 13. Mixing the two: interop

**Interop** means one system using code written in the other.

| From \ To | CommonJS file | ES module file |
|---|---|---|
| **CommonJS** | `require()` | `import()` always; `require()` if it has no top-level `await` (Node 22.12+, 20.19+, 24) |
| **ES module** | `import` (default always, named if detected) or `createRequire` | `import` |

### ESM importing CommonJS

This always works. The **default import is `module.exports`**. Named imports work only if Node can detect the names by scanning the file's text before running it (a static scan, not a real run). The docs say plainly that detection "does not always correctly detect named exports". The example in section 9 showed the results:

- `exports.one = 1`, `module.exports = { a, b }` (shorthand names), and similar patterns are detected.
- `module.exports = { alpha: 1, beta: 2 }` (literal values) is **not** detected, so `import { alpha }` fails. A computed assignment such as a loop is not detected either.
- The namespace of a CommonJS module also has a name `'module.exports'` (added in Node 22.12 and 23.0, so it is there in Node 24) that equals the default. You can see it in the output of example 07.

The safe habit that always works:

```js
import pkg from './legacy.js';
const { alpha } = pkg;
```

And remember from section 9: a named import from CommonJS is a copy at load time, not a live binding.

> **Common mistake:** the `__esModule` double default. Code compiled by TypeScript or Babel often looks like `exports.__esModule = true; exports.default = fn;`. Bundlers treat that marker as "the default export is `.default`". Node does **not**: the default import is always the whole `module.exports`. So `import lib from 'compiled-lib'` gives you `{ default: fn, ... }` and you must call `lib.default()`. Part 6 of example 07 prints this:
>
> ```text
> --- 6. compiled CommonJS with __esModule: Node ignores the marker
> typeof default import: object | typeof compiled.default: function
> call it: hello from compiled code
> ```

### CommonJS loading ES modules

There are two ways.

**`import()`** works in every Node version that supports ES modules. It returns a promise, so you use it inside an async function or with `.then`.

**`require(esm)`** lets plain `require()` load an ES module, and it returns the module namespace object. Which Node versions:

| Version | State |
|---|---|
| Node 22.0 and 20.17 | Behind the flag `--experimental-require-module` |
| Node 22.12 and 23.0 | On by default (no flag needed), but an experimental warning is printed |
| Node 20.19, 22.13 and 23.5 | On by default, no warning |
| Node 24.0 and later | Same: on by default, no warning |
| Node 24.15 and later | The docs no longer call it experimental |

On Node 24.16 (this course) it just works. Only Node 24.16 was run for this lesson, so the older rows in the table come from the Node documentation. Run [examples/09-require-esm.js](examples/09-require-esm.js):

```bash
node lessons/03-modules/examples/09-require-esm.js
```

```text
require(esm) supported: true
  [shapes.mjs] the module code is running
1. keys: [ 'PI', '__esModule', 'circleArea', 'default', 'squareArea' ]
   circleArea(1) = 3.14159 | describe = a shape
2. require() returned a function -> Hello, Ada
3. ERR_REQUIRE_ASYNC_MODULE
4. import() of the top-level await module -> loaded asynchronously
5. import() of a CommonJS file -> { alpha: 1, beta: 2 }
```

What to take from it:

- You get the namespace object. The default export is `.default`. Node also adds `__esModule: true` when the module has a default export, to help code that was compiled from ES modules. Do not depend on it in your own code.
- An ES module can decide what `require()` returns by exporting the name `'module.exports'` (line 2). Without that, `require()` gives the namespace object.
- The one hard limit: `require()` is synchronous, so it cannot wait for a **top-level `await`**. If the module (or anything it imports) uses one, you get `ERR_REQUIRE_ASYNC_MODULE` (line 3). Use `import()` then.
- `process.features.require_module` tells you whether the feature is on. `--no-experimental-require-module` turns it off, and then you get `ERR_REQUIRE_ESM`.

### createRequire: require inside ESM

An ES module has no `require`, but you can make one for that file:

```js
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const legacy = require('./legacy.js'); // works like require in a CommonJS file
```

Typical uses: loading a package that only works with `require`, reading a `.json` file the old way, and calling `require.resolve()`. (Example 06 names it `cjsRequire`, so that its earlier `typeof require` check can still show that the global does not exist.) A related helper, `process.getBuiltinModule('node:fs')` (Node 22.3+, 20.16+), loads a core module in either system without any import.

> **Interview tip:** "Can you `require` an ES module?" The old answer, "no, `ERR_REQUIRE_ESM`", is out of date. Today: yes on Node 22.12+, 20.19+ and 24, as long as the graph has no top-level `await`; otherwise use `import()`.

## 14. The node: prefix

Core modules can be loaded with a `node:` prefix, and this course always does:

```js
const fs = require('node:fs');
import { readFile } from 'node:fs/promises';
```

`require('fs')` and `require('node:fs')` return the same module (the example in section 6 printed `true`). The prefix is better because:

- **It is clear.** The reader sees at once that this is built in, not an npm package.
- **It cannot be shadowed.** Plain names go through lookup rules, and old npm packages exist with core names such as `punycode`. With `node:` you always get the built-in.
- **Some modules need it.** `node:test`, `node:sqlite`, `node:sea` and `node:test/reporters` exist **only** with the prefix. In the output of section 6, `require('test')` threw `MODULE_NOT_FOUND`, while `require('node:test')` worked.
- **A typo is a clear error.** `require('node:nope')` throws `ERR_UNKNOWN_BUILTIN_MODULE`.

The prefix works for both `require` and `import` on every Node version that is still supported. `require('node:module').isBuiltin('node:fs')` tells you if a name is a core module.

> **Interview tip:** "Why `node:fs` instead of `fs`?" Say: same module, but the prefix makes it explicit, avoids name clashes with packages, and is required for newer core modules like `node:test`.

## 15. package.json: "exports" and "imports"

### "exports": the front door of a package

Without an `"exports"` field, `require('pkg/any/file.js')` can reach **every** file inside a package, and `"main"` only picks the default entry. With `"exports"`, the author lists the **only** entry points. Anything else is blocked with `ERR_PACKAGE_PATH_NOT_EXPORTED`. If both `"exports"` and `"main"` are set, `"exports"` wins (keep `"main"` only for very old tools).

```json
{
  "name": "dual",
  "exports": {
    ".": {
      "import": "./esm/index.mjs",
      "require": "./cjs/index.cjs",
      "default": "./cjs/index.cjs"
    },
    "./feature": "./lib/feature.js",
    "./package.json": "./package.json"
  }
}
```

- `"."` is the main entry: `require('dual')` or `import 'dual'`. If the main entry is the only one, a plain string is allowed: `"exports": "./index.js"`.
- `"./feature"` is a subpath: `require('dual/feature')`.
- `"import"` and `"require"` are **conditions** (named switches). Node picks the key that matches how the package is being loaded. Other standard conditions: `"node"`, `"module-sync"` (matches `import` and `require` alike), `"node-addons"`, and `"default"` (always matches). `"module-sync"` is newer: it works on Node 24.16, but the docs give no "added in" version, so check the docs of an older Node before relying on it.
- **Order matters.** Node tries keys top to bottom and takes the first match. Put specific conditions first and `"default"` last.
- A subpath can use a pattern: `"./util/*": "./lib/*.js"`, where `*` is replaced as plain text. A value of `null` blocks a path.
- Targets must start with `./`.
- You can switch on extra conditions yourself with `node --conditions=development app.js` (short form `-C development`). Then a key named `"development"` matches. Tools also use the `"types"` condition (for TypeScript typings), which Node ignores unless you turn it on.

Part 2 of [examples/10-package-json.js](examples/10-package-json.js) builds this package and calls it:

```text
--- 2. "exports": conditions and encapsulation
require("dual") -> CommonJS build
require("dual/feature") -> public feature
require("dual/package.json").name -> dual
require("dual/lib/internal.js") -> ERR_PACKAGE_PATH_NOT_EXPORTED
no "exports" field, deep file allowed -> legacy secret
```

> **Common mistake:** `require('some-package/package.json')` suddenly fails after an upgrade. The package added `"exports"` and did not list `"./package.json"`. This really happens: `require('path-to-regexp/package.json')` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` in the version that Express 5.3.0 installs. The fix is for the package to list it, or for you to read the version another way.

### "imports": private aliases

The `"imports"` field gives a package its own short names. They **must start with `#`**, and they work only inside that package. This replaces ugly paths like `require('../../../src/config.js')`.

```json
{
  "name": "app",
  "imports": {
    "#config": "./src/config.js",
    "#utils/*": "./src/utils/*.js"
  }
}
```

```js
const config = require('#config');
const shout = require('#utils/shout');
```

```text
--- 3. "imports": private aliases that start with #
require("#config") -> { mode: 'test' }
require("#utils/shout")("hi") -> HI
```

Unlike `"exports"`, a target in `"imports"` may also be another package, with conditions. A package that has `"exports"` can also import itself by its own name.

### The dual package hazard

If a package ships **both** an ES build and a CommonJS build (as `dual` does), an app can end up loading **both copies**: one part of the app uses `import`, another uses `require`. Then two instances of the package exist, each with its own variables, so a counter, a cache or a connection pool is silently duplicated, and checks like `instanceof` can fail between the two copies. That is the dual package hazard. Parts 4 and 5 of the example show it and one fix. The fix package, `sync-dual`, ships one ES build and uses the `"module-sync"` condition:

```json
{ "name": "sync-dual", "exports": { "module-sync": "./index.mjs", "default": "./index.cjs" } }
```

```text
--- 4. the dual package hazard
import "dual"  -> ES build
require "dual" -> CommonJS build
next() through import: 1 | next() through require: 1 (two separate counters)
--- 5. "module-sync": one ES build for both
require("sync-dual") -> ES build
same module for import and require? true
next() through import: 1 | next() through require: 2 (one shared counter)
```

Safer designs: ship only an ES build and let `require(esm)` load it (the `"module-sync"` condition above, which both `import` and `require` use, and which must not use top-level `await`), or keep all the state in one CommonJS file and make the ES entry a thin file that imports it and re-exports its names.

> **Interview tip:** "What does the `exports` field do?" Strong answer: it defines the package's public entry points, supports conditions like `import` and `require`, blocks deep imports with `ERR_PACKAGE_PATH_NOT_EXPORTED`, and takes priority over `main`.

## 16. JSON modules and import attributes

In CommonJS, `require` loads `.json` files and returns the parsed object (cached, section 5):

```js
const data = require('./data.json');
```

In ES modules you must say that the file is JSON, using an **import attribute**:

```js
import data from './_lib/data.json' with { type: 'json' };
const again = await import('./_lib/data.json', { with: { type: 'json' } });
```

The examples in sections 8 and 10 used both forms (line 8 of each). Without the attribute you get `ERR_IMPORT_ATTRIBUTE_MISSING`. A JSON module has one export, `default`, which is the parsed value (so `import { name } from './x.json' with ...` does not work), and it is cached, so every importer shares one object. Import attributes stopped being experimental in Node 22.12 and 23.1. The older spelling `assert { type: 'json' }` was removed in Node 22.0, so use `with`. To read a JSON file fresh each time, use `fs.readFile` and `JSON.parse`.

> **Interview tip:** "How do you load a JSON file in ESM?" Say: `import data from './x.json' with { type: 'json' }`, and explain that the attribute is required so that Node never runs a data file as code. The other answers are `createRequire(import.meta.url)('./x.json')` or reading the file with `fs` and `JSON.parse` (the only way to get a fresh copy each time).

## 17. Module patterns

Run [examples/11-patterns.js](examples/11-patterns.js). Helper files are in `_patterns/`.

```bash
node lessons/03-modules/examples/11-patterns.js
```

```text
--- 1. singleton: the cache hands out one shared object
same object? true
second name sees: [ 'written through the first name' ]
--- 2. barrel file (CommonJS): a folder resolves to its index.js
  [circle.js] loaded
  [square.js] loaded
keys: [ 'circleArea', 'squareArea' ] | circleArea(2) = 13
--- 3. barrel file (ES module): export * from ...
  [circle.mjs] loaded
  [square.mjs] loaded
keys: [ 'circleArea', 'squareArea' ] | squareArea(4) = 16
--- 4. hard-wired dependency: the module reaches for the real database
hard-wired getName(1) failed: no real database available
--- 5. dependency injection: the caller supplies a fake database
getName(1): Ada
getName(2): unknown
logger now holds: [
  'written through the first name',
  'looked up user 1',
  'looked up user 2'
]
```

**Singleton through the cache.** A **singleton** is "exactly one instance in the program". Because a module runs once and is cached, exporting an instance gives you one for free:

```js
// logger.js
class Logger { /* ... */ }
module.exports = new Logger(); // every require gets this same object
```

In ESM, `export const logger = new Logger();` works the same way. Watch out: two copies of a package in different `node_modules` folders are two modules, so you get two singletons.

**Barrel file.** A **barrel** is an `index` file that gathers a folder's exports so callers write one short path. In CommonJS, `require('./shapes')` finds `shapes/index.js` (section 6). In ESM you need the full path `./shapes/index.mjs`. The cost shows in the output: loading the barrel loaded **both** files, even if you only wanted one. Big barrels slow startup, hide where things come from, and are a common cause of circular dependencies.

**Dependency injection (DI).** Instead of a module requiring its own helpers, the caller passes them in, usually through a factory function:

```js
module.exports = function makeUserService({ db, logger }) {
  return { async getName(id) { /* uses db and logger */ } };
};
```

The hard-wired version required the real database itself, so it could only run with a real database. The injected version ran with a tiny fake. That is why DI makes tests simple. Without it you would need tricks such as editing `require.cache`, or the (experimental) module mocking of `node:test`.

> **Interview tip:** if asked "how would you make this module testable?", answer "inject the dependencies", and mention that module-level singletons are shared global state that tests must reset.

## 18. Advanced: debugging module errors and module hooks

### A checklist for module errors

| Error | Usual cause | What to try |
|---|---|---|
| `MODULE_NOT_FOUND` (from `require`) | Typo, missing `./`, package not installed, wrong letter case (Linux cares, Windows does not) | Read the "Require stack" first. Then `require.resolve('x')` |
| `ERR_MODULE_NOT_FOUND` (from `import`) | Missing file extension, wrong path, or "Cannot find package" (not installed) | Add the extension, check `node_modules` |
| `ERR_PACKAGE_PATH_NOT_EXPORTED` | The file is not listed in the package's `"exports"` | Import a listed entry point (section 15) |
| Module state is duplicated, or code runs twice | The package is installed twice, a dual package (section 15), different letter case, or a `?query` on an ESM path | `Object.keys(require.cache)`, and `npm ls package-name` (lesson 04) |
| A value is `undefined` only at start-up | A circular dependency | Section 7: find the cycle, move shared code to a third file |

Two tools show what Node is really doing:

```bash
node -p "require.resolve.paths('express')"
```

That prints the folders Node searches for `express`, nearest first (the `module.paths` list, then the old global folders from section 6). The second tool is the `NODE_DEBUG=module` environment variable, which prints every lookup, every cache check and every file loaded. The output is long, so use it on a small reproduction:

```bash
NODE_DEBUG=module node app.js
```

On Windows PowerShell write `$env:NODE_DEBUG='module'; node app.js`.

### Module hooks: changing what gets loaded

Some tools must change what `require` and `import` return: a TypeScript runner turns `.ts` into JavaScript, a test tool swaps a module for a fake, a monitoring agent wraps a library. The old way was to patch private internals (`Module._load`, `require.extensions`, or `require.cache`), which breaks without warning. The official way is `module.registerHooks()` (added in Node 23.5 and 22.15, a release candidate since Node 24.13.1). You give it two optional functions:

- **`resolve(specifier, context, nextResolve)`** decides which file or URL a name means.
- **`load(url, context, nextLoad)`** decides the source text and the format (`module`, `commonjs`, `json`) of that URL.

Each hook either answers itself (add `shortCircuit: true`) or calls `nextResolve` / `nextLoad` to let Node continue. The hooks run in the same thread, are synchronous, and see both `require()` and `import`. The older `module.register()` ran hooks on a separate thread, and the docs now list it as deprecated in favour of `registerHooks()`.

Run [examples/12-module-hooks.js](examples/12-module-hooks.js). It spies on the names being resolved, then serves a module that has no file at all:

```bash
node lessons/03-modules/examples/12-module-hooks.js
```

```text
  [shapes.mjs] the module code is running
1. specifiers seen by the resolve hook: [ 'literal-exports.js', 'shapes.mjs' ]
2. virtual module -> hello from a module that has no file
3. after deregister() the hook is gone -> ERR_UNSUPPORTED_ESM_URL_SCHEME
```

Line 1 shows one `require` and one `import` going through the same hook. Line 2 answered `virtual:greeting` from a string. Line 3 shows that `deregister()` removes the hook, so the made-up name no longer works. Hooks affect everything loaded after them, so keep them tiny and remove them when you are done.

> **Interview tip:** "How can you replace a module in a test without changing the code under test?" Strong answers, from simplest to heaviest: pass a fake in (dependency injection, section 17); edit `require.cache` (CommonJS only, fragile); use the test runner's module mocking (`node:test`, still experimental and behind a flag); or install hooks with `registerHooks()`.

## Summary / Key takeaways
- A module is a file with private scope. Node has two systems: CommonJS (`require`, `module.exports`) and ES modules (`import`, `export`).
- `require()` returns `module.exports`. `exports` is only a shortcut to it, so `exports = {...}` loses the export. Every CommonJS file is wrapped in a function with five parameters (`exports`, `require`, `module`, `__filename`, `__dirname`), which do not exist in ES modules.
- A CommonJS module runs once and is cached by resolved file path in `require.cache`. `require()` looks for core modules, then file paths (extensions, `index.js`, `main`), then `node_modules` folders from the nearest one upward.
- Circular `require` gives you a partial `module.exports`. ES modules give live bindings, so reading too early hits the temporal dead zone.
- ESM imports are static, live and read-only, in strict mode, with required file extensions, `import.meta`, top-level `await`, and `import()` for loading later. The ESM cache is keyed by URL, so `?v=2` makes a second copy.
- `.mjs` and `.cjs` are fixed; `.js` follows `"type"` in `package.json`; with neither, Node detects ESM syntax. Always set `"type"`.
- On Node 24, `import` can load CommonJS (the default import is always `module.exports`, even with `__esModule`), and `require()` can load ES modules unless they use top-level `await`. `createRequire` gives an ES module a `require`.
- Use `node:` for core modules, `"exports"` for a package's public entry points (beware the dual package hazard), `with { type: 'json' }` for JSON in ESM, and dependency injection to keep modules testable. Debug with `require.resolve` and `NODE_DEBUG=module`.

## Quick check

1. What is the difference between `exports` and `module.exports`, and what does `exports = { a: 1 }` do?
<details><summary>Answer</summary>

`exports` starts as a second name for the same object as `module.exports`, and `require()` returns `module.exports`. Adding properties to `exports` works. Assigning a new value to `exports` only moves the local name, so the caller still gets the old empty object. To export a function, class or fresh object, assign to `module.exports`.

</details>

2. Name the five values Node passes into every CommonJS file, and explain why `__dirname` is undefined in an ES module.
<details><summary>Answer</summary>

`exports`, `require`, `module`, `__filename` and `__dirname`. They are the parameters of the function Node wraps around a CommonJS file. ES modules are not wrapped in that function, so those names do not exist. Use `import.meta.dirname` (Node 20.11+), `import.meta.filename`, and `createRequire` instead.

</details>

3. A file `counter.js` prints "loading" at the top and is required from three different files. How many times is "loading" printed, and how can you force a re-run?
<details><summary>Answer</summary>

Once. The result is cached in `require.cache` under the file's resolved path. To re-run it, delete that cache entry (`delete require.cache[require.resolve('./counter.js')]`) and require it again, or better, export a factory function and call it whenever you need a fresh instance.

</details>

4. In which order does `require('x')` look for a module, and why write `require('node:fs')` instead of `require('fs')`?
<details><summary>Answer</summary>

First core modules (`fs`, `node:fs`). Then, if `x` starts with `./`, `../` or `/`: the exact file, then `.js`, `.json`, `.node`, then a folder (its `package.json` `"main"`, then `index.js`). Otherwise it is a package name: look in `node_modules` of the current folder, then each parent folder up to the root, and use the nearest match (a package's `"exports"` field is read first). If nothing matches, it throws `MODULE_NOT_FOUND`. The `node:` prefix returns the same built-in module but says clearly "this is core", cannot be replaced by an npm package with the same name, and is required for newer modules such as `node:test` and `node:sqlite` (`require('test')` fails).

</details>

5. `a.js` and `b.js` require each other. What does `b.js` receive in CommonJS? What happens in ES modules?
<details><summary>Answer</summary>

In CommonJS, `b.js` receives the partial `module.exports` of `a.js`: only what `a.js` had set before it called `require('./b.js')`, so some properties are `undefined` at that time. In ES modules, imports are live bindings. Function declarations already work, but reading a `let`, `const` or `class` export before its module has run throws a `ReferenceError` (temporal dead zone).

</details>

6. What does this print, and what would it print if the first file used `module.exports = { n, inc }` and the second used `require`?
   ```js
   // counter.mjs
   export let n = 0;
   export function inc() { n++; }
   // main.mjs
   import { n, inc } from './counter.mjs';
   inc();
   console.log(n);
   ```
<details><summary>Answer</summary>

It prints `1`, because an ES module import is a live binding to the exporter's variable. With CommonJS (`module.exports = { n, inc }` and `const { n, inc } = require('./counter.js')`), `n` is a copy of `0` made when the exports object was built, so it prints `0`.

</details>

7. How does Node decide whether a `.js` file is CommonJS or an ES module?
<details><summary>Answer</summary>

`.mjs` is always ESM and `.cjs` is always CommonJS. For `.js`, the nearest `package.json` `"type"` decides (`"module"` or `"commonjs"`). If there is no `"type"`, Node tries CommonJS and, when it sees ES-only syntax (`import`/`export`, `import.meta`, top-level `await`), re-runs the file as ESM (syntax detection, on by default since Node 22.7 and 20.19). That costs an extra parse, so set `"type"` explicitly.

</details>

8. On Node 24, can CommonJS `require()` an ES module? Can an ES module import a CommonJS file with named imports?
<details><summary>Answer</summary>

Yes to the first: `require(esm)` works without a flag (Node 22.12+, 20.19+, 24) and returns the namespace object, but it throws `ERR_REQUIRE_ASYNC_MODULE` if the module graph uses top-level `await`, so use `import()` there. For the second: the default import is always `module.exports`; named imports only work if Node's static scan can detect the names (for example `exports.x = ...`, not literal values in `module.exports = { a: 1 }`). `const { a } = pkg` after a default import always works.

</details>

9. List five differences between CommonJS and ES modules.
<details><summary>Answer</summary>

(1) `require()` is a synchronous function call that can sit anywhere; `import` is static, so Node and tools can read it before running any code (and `import()` is the async, run-time version). (2) `require` returns `module.exports`, so a number on it is a copy; imports are live, read-only bindings. (3) ES modules are always strict mode; CommonJS is sloppy by default. (4) Only ES modules have top-level `await`. (5) ES modules need file extensions, have no folder `index.js` lookup, and have no `__dirname`, `__filename` or `require` (use `import.meta.dirname`, `import.meta.filename`, `createRequire`).

</details>

10. What does the `"exports"` field of `package.json` do, and what is the dual package hazard?
<details><summary>Answer</summary>

`"exports"` lists the package's public entry points (`"."`, subpaths) and can pick different files by condition (`import`, `require`, `default`, first match wins). Files that are not listed cannot be imported (`ERR_PACKAGE_PATH_NOT_EXPORTED`), and `"exports"` takes priority over `"main"`. The dual package hazard happens when a package ships both an ES and a CommonJS build and an app loads both: two separate instances with separate state, which can break `instanceof` checks and shared singletons.

</details>

## Try it yourself

Do these in a scratch folder outside this repo (for example `modules-practice/`). Run each with `node file.js` or `node file.mjs`.

**Task 1 (easy): fix the broken module.** Create `greeter.js` and `app.js`:

```js
// greeter.js
exports = function greet(name) {
  return `Hello, ${name}!`;
};
```

```js
// app.js
const greet = require('./greeter.js');
console.log(greet('Ada'));
```

Run `node app.js` and read the error. Fix the module so it prints `Hello, Ada!`. Then add a second function so that `greet.shout('Ada')` prints `HELLO, ADA!`.

<details><summary>Hint</summary>

The error is `TypeError: greet is not a function`. `require` returns `module.exports`, which is still `{}`. A function is an object, so you can attach a property to it.

</details>

<details><summary>Solution</summary>

```js
// greeter.js
function greet(name) {
  return `Hello, ${name}!`;
}

greet.shout = (name) => greet(name).toUpperCase();

module.exports = greet;
```

```js
// app.js
const greet = require('./greeter.js');
console.log(greet('Ada'));
console.log(greet.shout('Ada'));
```

```text
Hello, Ada!
HELLO, ADA!
```

</details>

**Task 2 (medium): convert CommonJS to an ES module.** Start from these three files. Create `temperature.mjs` and `app.mjs` that print the same two lines as `app.js`. `__dirname` does not exist in ESM, so find the replacement.

`names.json`:

```json
{ "c": "Celsius", "f": "Fahrenheit" }
```

`temperature.js`:

```js
// temperature.js
const fs = require('node:fs');
const path = require('node:path');

const names = JSON.parse(fs.readFileSync(path.join(__dirname, 'names.json'), 'utf8'));

function toF(c) {
  return (c * 9) / 5 + 32;
}

function toC(f) {
  return ((f - 32) * 5) / 9;
}

module.exports = { toF, toC, names };
```

`app.js`:

```js
// app.js
const { toF, toC, names } = require('./temperature.js');

console.log(`100 ${names.c} = ${toF(100)} ${names.f}`);
console.log(`212 ${names.f} = ${toC(212)} ${names.c}`);
```

<details><summary>Hint</summary>

Use `import` for `node:fs` and `node:path`, `export` for each name, and `import.meta.dirname` instead of `__dirname`. You must write the extension `.mjs` in the import path. Bonus: skip `fs` completely with `import names from './names.json' with { type: 'json' }`.

</details>

<details><summary>Solution</summary>

```js
// temperature.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const names = JSON.parse(readFileSync(path.join(import.meta.dirname, 'names.json'), 'utf8'));

export function toF(c) {
  return (c * 9) / 5 + 32;
}

export function toC(f) {
  return ((f - 32) * 5) / 9;
}
```

```js
// app.mjs
import { toF, toC, names } from './temperature.mjs';

console.log(`100 ${names.c} = ${toF(100)} ${names.f}`);
console.log(`212 ${names.f} = ${toC(212)} ${names.c}`);
```

```text
100 Celsius = 212 Fahrenheit
212 Fahrenheit = 100 Celsius
```

Bonus version of the top of `temperature.mjs`: `import names from './names.json' with { type: 'json' }; export { names };`

</details>

**Task 3 (harder): write a mini `require()`.** Write `mini-require.js` with a function `createLoader()` that returns `load(filename)`. It must: read the file, run it with the five wrapper values (`exports`, `require`, `module`, `__filename`, `__dirname`), support relative `require('./x')` (add `.js` when the exact file does not exist), cache modules so each file runs once, and survive a circular `require` by returning the partial exports. The solution below also builds its own demo files in a temp folder.

<details><summary>Hint</summary>

`vm.compileFunction(source, ['exports', 'require', 'module', '__filename', '__dirname'], { filename })` (from `node:vm`) turns file text into a function. Put the new module object in the cache **before** you call that function. That one line of order is what makes circular requires safe.

</details>

<details><summary>Solution</summary>

```js
// mini-require.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

function createLoader() {
  const cache = new Map(); // absolute filename -> module object

  function resolve(request, fromDir) {
    const full = path.resolve(fromDir, request);
    const isFile = fs.existsSync(full) && fs.statSync(full).isFile();
    return isFile ? full : full + '.js';
  }

  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports; // second require: reuse

    const module = { exports: {} };
    cache.set(filename, module); // store BEFORE running: a circular require then finds it

    const dirname = path.dirname(filename);
    const localRequire = (request) => load(resolve(request, dirname));
    const source = fs.readFileSync(filename, 'utf8');
    const run = vm.compileFunction(
      source,
      ['exports', 'require', 'module', '__filename', '__dirname'],
      { filename },
    );
    run.call(module.exports, module.exports, localRequire, module, filename, dirname);
    return module.exports;
  }

  return load;
}

// --- demo -------------------------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-require-'));
fs.writeFileSync(path.join(dir, 'a.js'), `
  exports.done = false;
  const b = require('./b');
  console.log('in a: b.done =', b.done);
  exports.done = true;
`);
fs.writeFileSync(path.join(dir, 'b.js'), `
  exports.done = false;
  const a = require('./a.js');
  console.log('in b: a.done =', a.done);
  exports.done = true;
`);
fs.writeFileSync(path.join(dir, 'counter.js'), `
  console.log('counter runs');
  let n = 0;
  module.exports = () => ++n;
`);

const load = createLoader();
const a = load(path.join(dir, 'a.js'));
const next1 = load(path.join(dir, 'counter.js'));
const next2 = load(path.join(dir, 'counter.js'));
console.log('a.done =', a.done);
console.log('same function?', next1 === next2, '|', next1(), next2());

fs.rmSync(dir, { recursive: true, force: true });
```

```text
in b: a.done = false
in a: b.done = true
counter runs
a.done = true
same function? true | 1 2
```

`b` sees `a.done = false` because `a` was still running: the same partial-exports behaviour as real Node. Real Node adds more (folders, `node_modules`, JSON, the `exports` field), but the core idea is this small.

</details>

## Where to go next
- Next lesson: [04. npm, package.json and Dependencies](../04-npm-and-package-json/README.md) goes deeper into `package.json`, installing packages, and how `node_modules` is built.
- Practise the interview questions for this topic: [Round 1: screening](../../rounds/round-1-screening/questions.md) and [Round 2: core](../../rounds/round-2-core/questions.md).
- Challenges that use module knowledge: [Round 3: coding](../../rounds/round-3-coding/questions.md) and [Round 4: advanced](../../rounds/round-4-advanced/questions.md).
