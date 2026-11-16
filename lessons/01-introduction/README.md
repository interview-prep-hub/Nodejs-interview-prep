# 01. Introduction: What Node.js Is and How to Start

> Level: Beginner   Time: about 2 hours   Node: 24 (notes where older versions differ)

[All lessons](../../README.md) | [Next: 02. JavaScript Essentials for Node Interviews](../02-javascript-essentials/README.md)

## What you will learn
- What Node.js really is (a runtime, not a language and not a framework), why it was made, and what V8 and libuv do inside it.
- How to install Node, switch between versions, and tell LTS releases from Current ones.
- Four ways to run code: a file, `node -e`, `node -p` and the REPL.
- What is different from the browser, and which objects you get for free (`process`, `console`, `Buffer`, `fetch`, ...).
- Why Node is called "single-threaded" and "non-blocking", in one simple picture, and when Node is a bad choice.
- Your first HTTP server in about 10 lines, and what really happens when you type `node app.js`.
- The beginner mistakes that waste the most time (port in use, wrong folder, forgetting to restart).

**How to use this lesson.** Every section names an example file in `examples/`. Run all commands from the repo root (the folder that contains `package.json`). The examples need no installs and no internet. Read the code, run it, then compare your output with the one shown. Sections end with an "Interview tip" when interviewers ask about that topic.

---

## 1. What Node.js is

**Node.js is a runtime for JavaScript.** A *runtime* is a program that runs code in some language and also gives that code tools to talk to the computer: files, network, timers.

The browser is also a JavaScript runtime. It gives your code `document` and `window`, so you can change a web page. Node.js gives your code the *machine* instead: files, folders, network connections, other programs. That is why you can write a web server, a command line tool or a build script in JavaScript.

**Why Node exists.** Node was created by Ryan Dahl and first released in 2009. Classic servers of that time often gave every visitor their own *thread* (an independent line of execution inside a program). A thread that only sits and waits for a database or a disk still costs memory, so thousands of waiting visitors were expensive. Node's idea: use **one thread and an event loop**, and never stand still waiting (section 11). A second reason: JavaScript was already known by every web developer, so one language could run in the browser and on the server. Today Node is maintained by an open source community under the OpenJS Foundation.

Interviewers like to check that you keep these words apart:

| Word | What it is | Example |
|---|---|---|
| Language | The rules for writing code | JavaScript (its standard is called ECMAScript) |
| Engine | A program that reads the language and runs it | V8 |
| Runtime | An engine plus the tools around it | Node.js (V8 + libuv + built-in modules such as `fs` and `http`) |
| Framework | A library that gives your app a ready-made structure | Express, Fastify, NestJS |
| Package manager | Downloads and installs libraries | npm (installed together with Node, but a separate program) |

A short picture: V8 is the *engine* of a car. Node.js is the whole car: the engine plus wheels (files and network), steering (the event loop) and a dashboard (`process`). A framework such as Express is not part of the car. It is something you add on top.

> **Interview tip:** "What is Node.js?" A strong answer is one breath long: "An open source, cross-platform JavaScript runtime built on Google's V8 engine. It adds an event loop with non-blocking I/O (through libuv) and a standard library for files, network and more." Weak answers say "a framework", "a language" or "a server". A common follow-up is "Is V8 the same as Node?" No. `setTimeout`, `console` and `fs` are not part of the JavaScript language at all. The runtime supplies them.

---

## 2. V8 and libuv in plain words

Node is built from several parts. Two matter most.

**V8** is the JavaScript engine made by Google (it also runs inside Chrome and Edge). It is written in C++ and does two big jobs:
- It turns your JavaScript into fast machine code *while the program runs*. This is called JIT compiling ("just in time"). V8 starts with a quick interpreter (named Ignition) and compiles the code that runs most often into optimized machine code (its top compiler is named TurboFan).
- It cleans up memory you no longer use (**garbage collection**).

**libuv** is a C library. It gives Node:
- the **event loop**: the loop that waits for things to finish and then runs your **callbacks** (functions you hand to Node to call later);
- one way to do asynchronous file, network and timer work. Every operating system has its own low-level tool for this (epoll on Linux, kqueue on macOS, IOCP on Windows). libuv hides the differences, so the same Node code works everywhere;
- a small **thread pool**: a group of helper threads that wait for jobs the OS cannot do without blocking, such as many file operations.

Here is the stack, from your code down to the machine:

```text
  Your JavaScript code
          |
  Node core modules (fs, http, path, ... mostly written in JavaScript)
          |
  Node C++ bindings (the glue between JavaScript and C/C++)
          |
  +-----------+   +-----------+   +---------------------------+
  |    V8     |   |   libuv   |   | OpenSSL, zlib, llhttp ... |
  | runs JS   |   | event loop|   | crypto, compression,      |
  |           |   | async I/O |   | HTTP parsing              |
  +-----------+   +-----------+   +---------------------------+
          |
  Operating system (Windows, macOS, Linux)
```

Example: `examples/01-versions.js` prints the versions of the parts that are bundled inside your `node` program.

```bash
node lessons/01-introduction/examples/01-versions.js
```

```text
Node.js    : v24.16.0
V8 engine  : 13.6.233.17-node.49
libuv      : 1.52.1
Platform   : win32 x64
LTS name   : Krypton
Major is   : 24 (even)
bundled v8       13.6.233.17-node.49
bundled uv       1.52.1
bundled openssl  3.5.6
bundled zlib     1.3.1-e00f703
bundled llhttp   9.4.1
bundled undici   7.25.0
Course needs Node 24 or newer: true
```

Your numbers will differ if your Node version differs, and `Platform` shows your own system (`darwin` is macOS, `linux` is Linux). The point: V8 and libuv really are inside the program you installed, next to OpenSSL (encryption), zlib (compression), llhttp (HTTP parsing) and undici (the engine behind `fetch`).

> **Under the hood:** Each Node release ships one fixed V8 version. That is why new JavaScript features arrive with a new Node major version: Node 24 has V8 13.6, Node 22 has V8 12.4. Read yours with `node -p "process.versions.v8"`.

> **Interview tip:** "What does libuv do?" Strong answer: "A C library that gives Node its event loop, cross-platform asynchronous I/O, timers and a thread pool for work the OS cannot do without blocking. V8 only runs JavaScript. It knows nothing about files or sockets."

---

## 3. Installing Node and managing versions

There are three common ways to install Node.

| Way | Good for | Notes |
|---|---|---|
| Official installer from nodejs.org | One project, first install | Windows `.msi`, macOS `.pkg`. Installs `node` and `npm` and puts them on your PATH (the list of folders your shell searches for programs) |
| Version manager: nvm, nvm-windows, fnm | Several projects, switching versions | Install many versions side by side and switch in seconds |
| Package manager of your system | Quick setup, scripts | `winget install OpenJS.NodeJS.LTS` on Windows, `brew install node@24` on macOS (plain `brew install node` gives the newest release line, which is not always an LTS one) |

**Why a version manager?** Project A may need Node 22 while project B needs Node 24. A version manager keeps both and switches with one command. It is also how you test your code on the next Node version before you upgrade.

Three tools are in common use. Two of them are both called "nvm", which confuses many people:
- **nvm** (nvm-sh/nvm) works on macOS, Linux and WSL (Windows Subsystem for Linux). It does not work in native Windows PowerShell.
- **nvm-windows** is a separate project made for native Windows.
- **fnm** (Fast Node Manager) is fast and works on Windows, macOS and Linux.

```bash
# nvm (macOS, Linux, WSL)
nvm install 24
nvm use 24
nvm ls
nvm alias default 24

# nvm-windows (native Windows). Use a full version number, it is the safest form.
nvm install 24.16.0
nvm use 24.16.0
nvm list

# fnm (Windows, macOS, Linux)
fnm install 24
fnm use 24
fnm default 24
fnm list
```

Notes on these tools:
- nvm-windows documents the words `latest` and `lts` as well as full versions (`nvm install lts`). Whether a bare major such as `24` works is not documented, so use the full number.
- nvm-windows normally needs an **Administrator** terminal for `nvm install` and `nvm use`, because it creates symbolic links.
- To pin a project's version, put a file named `.nvmrc` in the project root with just the version in it, for example `24`. Then `nvm use` (nvm-sh) reads it. fnm reads `.nvmrc` and `.node-version` files. nvm-windows does not document `.nvmrc` support, so do not rely on it there.

After installing, **close and reopen your terminal** so it picks up the new PATH. To see which `node` your shell will run:

```bash
node -v
npm -v
where node
```

`where node` is for Windows `cmd`. In PowerShell use `Get-Command node`. On macOS and Linux use `which node`.

> **Common mistake:** Installing with the official installer and with nvm-windows at the same time. Both want to control the `node` command, and the result is confusing. Uninstall one of them first.

---

## 4. LTS vs Current, and checking your version

Node uses **semantic versioning**: `24.16.0` means major 24, minor 16, patch 0. A new **major** version may contain breaking changes. Minor versions add features, patches fix bugs.

Every release line goes through stages:

| Stage | Length | What you get |
|---|---|---|
| Current | about 6 months | New features, fast changes. Library authors test against it |
| Active LTS | 12 months | Stable. Bug fixes and compatible improvements. This is the one to use |
| Maintenance LTS | 18 months | Only critical bug fixes and security patches |
| End of life (EOL) | after the end date | No fixes at all. Do not run it |

**LTS** means "long-term support": a total of 30 months of fixes. The first release that carries the LTS label is not `x.0.0`. For example Node 24 became LTS with `24.11.0`.

**The even/odd rule.** Up to and including Node 26, **even** major numbers (18, 20, 22, 24, 26) became LTS in October. **Odd** ones (19, 21, 23, 25) never did and died after about 6 months. Never run an odd version in production.

**The rule is ending.** Starting with Node 27 there is one major release a year and every release becomes LTS. New versions first appear in an "Alpha" channel (not for production). So "even means LTS" is true for the past, and you should not build a habit on it.

The state in November 2026:

| Line | Codename | Status | End of life |
|---|---|---|---|
| 27 | none yet | Alpha (not for production) | planned for 2030 |
| 26 | Lithium | Active LTS | 2029-04-30 |
| 25 | none | End of life (odd, never LTS) | 2026-06-01 |
| 24 | Krypton | Maintenance LTS | 2028-04-30 |
| 22 | Jod | Maintenance LTS | 2027-04-30 |
| 20 | Iron | End of life | 2026-04-30 |
| 18 | Hydrogen | End of life | 2025-04-30 |

Dates can be amended, so check the "Previous releases" page on nodejs.org before you quote them in a real decision. For this course install **Node 24 or newer**: the examples were all run on 24.16.0.

How to check what you have:

```bash
node -v
node -p "process.release.lts"
```

The first prints `v24.16.0`. The second prints the LTS codename, such as `Krypton`, and prints `undefined` on a release that is not LTS (example `01-versions.js` above does this check for you).

> **Interview tip:** "Which Node version do you use in production, and why?" Strong answer: "An Active or Maintenance LTS release, because it gets security fixes for years. I pin the version (for example in `.nvmrc` and in the Docker image) so every machine and the CI server, the machine that builds and tests every change, use the same one. I plan upgrades before the end-of-life date." Wrong answers: "whatever is newest" (that can be a Current or Alpha release) or "Node 18/20" (both are end of life now).

---

## 5. Running code: files, `-e`, `-p` and the REPL

Example: `examples/02-ways-to-run.js` starts other `node` processes with different options, so you can see every way side by side.

```bash
node lessons/01-introduction/examples/02-ways-to-run.js
```

```text
node -p "6 * 7"            prints: 42
node -e "6 * 7"            prints: ""
node -e "console.log(6*7)" prints: "42"
exit code after process.exitCode = 3: 3

REPL session output:
> 2
> 20
> 'object'
> node app.js
     ^^^

Uncaught SyntaxError: Unexpected identifier 'app'
>
```

### Run a file
```bash
node app.js
node app
```
The second form works too: Node adds `.js` for you when you start a CommonJS script (CommonJS is the classic Node module style that uses `require`; section 8 explains the two module styles). Pass arguments after the file name: `node app.js one two`.

### `node -e` and `node -p`
- `node -e "code"` (**e**valuate, long form `--eval`) runs a piece of code. It prints only what the code prints itself.
- `node -p "code"` (**p**rint, long form `--print`) runs the code and **prints the value of the last expression**. It is the quickest calculator: `node -p "2 ** 10"` prints `1024`.

In the output above, `-e "6 * 7"` printed nothing because nothing called `console.log`. `-p "6 * 7"` printed `42`.

Quoting on Windows: wrap the whole code in **double quotes** and use **single quotes** inside: `node -e "console.log('hi')"`. That form works in `cmd`, PowerShell and bash.

### Exit codes
When a program ends it returns a number to the shell. **0 means success. Anything else means failure.** The fourth line of the output shows `process.exitCode = 3` giving the code 3. Read it after a command with `echo $?` (bash), `$LASTEXITCODE` (PowerShell) or `echo %ERRORLEVEL%` (cmd). Build tools and CI use this number to decide whether a step failed.

### The REPL
Type `node` alone and press Enter. You get a **REPL** (Read, Evaluate, Print, Loop): you type a line, Node runs it and prints the result, then waits for the next line. It is the best place to try a small idea.

| You type | What happens |
|---|---|
| `_` | The result of the previous line. After `1 + 1` (which printed `2`), `_ * 10` prints `20` |
| Tab key | Auto-complete. Type `fs.` and press Tab twice to list the members of `fs`. Type `proc` and press Tab to get `process` (with only `pro` you get a list: `Promise`, `Proxy`, `process`, ...) |
| Up arrow | Previous lines you typed |
| `.help` | List all dot commands |
| `.editor` | Multi-line mode. Paste a function, then press Ctrl+D to run it or Ctrl+C to cancel |
| `.save file.js` / `.load file.js` | Save the session to a file, or load a file into the session |
| `.break` | Get out of a half-typed multi-line expression (Ctrl+C does the same) |
| `.clear` | Like `.break`, and also clears the local context |
| `.exit` | Leave. Ctrl+D works too |

Good to know:
- Built-in modules are already loaded in the REPL. `typeof fs` gave `'object'` above, with no `require`.
- `await` works directly at the prompt.
- A line like `const x = 1` prints `undefined`, because a declaration has no value. That is normal.
- **The classic beginner mistake:** typing `node app.js` *inside* the REPL (you are already in Node). It gives `SyntaxError: Unexpected identifier 'app'`, as in the output above. Leave with `.exit` and run it in the shell.

Two more things to know about running code:
- `node --watch app.js` restarts your script every time a file changes (stable since Node 22.0.0, and 20.13.0). No extra tool needed.
- Node 24 can also run `.ts` files directly by removing the type annotations (it does not check types). A later lesson covers this.

> **Interview tip:** "How do you run a quick test of a JavaScript idea without creating a file?" Say: "`node -p` for one expression, `node -e` for a snippet, or the REPL, where `_` holds the last result and `.editor` lets me paste several lines." Small tricks like this show daily Node experience.

---

## 6. Node vs the browser

Both run JavaScript (Chrome and Edge even use the same V8 engine as Node), but they live in different worlds.

| | Browser | Node.js |
|---|---|---|
| Global object | `window` (also `self`, `globalThis`) | `global` (also `globalThis`) |
| Page and DOM (`document`, `alert`) | Yes | **No** |
| Files, folders, OS (`fs`, `os`, `child_process`) | No | **Yes** |
| Create a server (`http`, `net`) | No | **Yes** |
| `fetch`, `URL`, `console`, timers | Yes | Yes (`fetch` is global since Node 18) |
| Modules | ES modules in `<script type="module">` | CommonJS (`require`) and ES modules (`import`) |
| Safety | Sandboxed: a web page cannot read your files freely | Not sandboxed: a script can do what your user account can do |
| Which version runs? | Whatever the visitor has | The one you choose |

Example: `examples/03-node-vs-browser.js`.

```bash
node lessons/01-introduction/examples/03-node-vs-browser.js
```

```text
Browser only (undefined in Node):
  window           undefined
  document         undefined
  alert            undefined
  location         undefined
  XMLHttpRequest   undefined

Shared (same in both):
  console          object
  setTimeout       function
  fetch            function
  URL              function
  structuredClone  function
  AbortController  function

Node only:
  process          object
  Buffer           function
  global           object

globalThis === global : true
window exists         : false

globalThis.insideThisFile: undefined
reallyGlobal is visible everywhere: true

typeof require            : function
typeof globalThis.require : undefined

First line of this very file: // Node vs the browser: what is missing, what is extra, and what is shared
os.EOL is a line break       : "\r\n"
```

How to read it:
- The test is `typeof name`. It never throws, even if the name does not exist, so it is the safe way to ask "is this here?".
- `globalThis` is the standard name for the global object and works in every JavaScript runtime. `global` is the old Node-only name and `window` is browser-only. Write `globalThis` in code that must run in both.
- A top-level `var` does not become a global in Node. In a classic browser script `var x = 1` makes `window.x`. In Node every CommonJS file is wrapped in a function (section 14), so `var` stays inside the file. An ES module has its own scope too.
- `require` looks global but is not on the global object. Every CommonJS file receives its own copy.
- The last line was produced on Windows. `os.EOL` (the line break of the system) is `"\r\n"` on Windows and `"\n"` on macOS and Linux. Differences like this are why Node code that touches the OS should not assume one platform.

> **Common mistake:** Copy-pasting browser code into Node. `window.alert('hi')` fails with `ReferenceError: window is not defined`, and `document.getElementById(...)` fails the same way. Node has no page. `localStorage` is also `undefined` on Node 24 unless you start Node with `--experimental-webstorage`. Node 25 and newer turn Web Storage on by default, so do not rely on it in code that must run everywhere.

> **Interview tip:** "Node vs browser JavaScript?" Strong answer: "Same language and the same V8 engine, different environment. The browser gives me the DOM and a sandbox. Node gives me the file system, network servers, processes and `process`, and no sandbox. Shared APIs such as `fetch`, `URL` and timers exist in both, and I use `globalThis` for the global object."

---

## 7. The globals you get for free

A *global* is a name you can use in any file without importing it. Node gives you these, and most of them match the browser versions:

| Name | What it is for |
|---|---|
| `globalThis` | The global object itself |
| `process` | Information about the running program, and control of it (section 9) |
| `console` | Printing (section 10) |
| `Buffer` | A block of raw bytes (binary data). Used for files, network data, encodings |
| `setTimeout`, `setInterval`, `setImmediate` and the `clear...` functions | Timers. `setImmediate` is Node-only |
| `queueMicrotask` | Run a small job right after the current code finishes |
| `URL`, `URLSearchParams` | Take a web address apart and build one |
| `fetch`, `Request`, `Response`, `Headers`, `FormData` | An HTTP client. Global since Node 18, stable since Node 21 |
| `structuredClone` | A real deep copy of an object |
| `AbortController`, `AbortSignal` | A way to cancel work (fetch, timers and streams understand it) |
| `TextEncoder`, `TextDecoder` | Convert between text and bytes |
| `crypto`, `performance`, `EventTarget`, `WebSocket`, `navigator` | Web Crypto (for example `crypto.randomUUID()`), timing, events, a WebSocket client (Node 22 and newer), and a tiny `navigator` (its `userAgent` is `Node.js/24`) |

Five more names behave like globals inside every CommonJS file: `require`, `module`, `exports`, `__filename` and `__dirname`. They are *not* on `globalThis`. Sections 8 and 14 explain why.

Example: `examples/04-globals-tour.js` uses a few of them.

```bash
node lessons/01-introduction/examples/04-globals-tour.js
```

```text
1. process.platform is a string: true
2. Buffer.from("hi") as hex: 6869
3. typeof setTimeout() result: object
4. URL parts: example.com 8080 /docs/intro 2 #top
5. original tags: [ 'a', 'b' ] | copy tags: [ 'a', 'b', 'c' ]
   Date survived the clone: true
6. abort event fired
   signal.aborted: true | reason: AbortError
7. TextEncoder bytes for "hé": Uint8Array(3) [ 104, 195, 169 ]
8. fetch, Request, Response, Headers exist: true
9. all on globalThis: true
10. timer callback ran (after all the sync code)
```

Why each result looks like this:
- `Buffer.from("hi")` holds two bytes, `0x68` and `0x69`, which is `6869` in hex.
- `setTimeout` returns an **object** in Node (a `Timeout`), not a number as in the browser. You pass it to `clearTimeout` the same way.
- `structuredClone` made a copy that does not share the inner array with the original, and it kept the `Date` as a real `Date`. `JSON.parse(JSON.stringify(x))` would have turned it into a string. Limits: functions cannot be cloned (it throws `DataCloneError`) and class instances come back as plain objects.
- `abort()` fires the `abort` event at once and the reason is an `AbortError`.
- `"hé"` is three bytes in UTF-8, because the letter `é` needs two bytes. So "the length of a string" and "the length of its bytes" can differ.
- The timer line is printed last even though it was scheduled early. Timers always wait until the current synchronous code is finished.

A tiny `fetch` call needs the internet, so it is not an example file. It uses top-level `await`, so save it as `fetch-demo.mjs`:

```js
const response = await fetch('https://example.com');
console.log(response.status);   // 200
console.log(await response.text());
```

`fetch` does **not** reject on an HTTP 404 or 500. It only rejects when the request itself fails (no connection). Check `response.ok` yourself. The server in section 13 uses `fetch` against localhost.

> **Interview tip:** "How do you make an HTTP request in Node without a library?" On Node 18 and newer: the global `fetch`. Older answers mention the `http` module or `axios`. Add two details: `fetch` does not reject on 404 or 500, and you need `AbortSignal.timeout(ms)` if you want a timeout.

---

## 8. `__dirname` and `__filename`

Inside a CommonJS file, two values are always ready:

- `__filename` is the **absolute path of the current file**.
- `__dirname` is the **absolute path of the folder that contains it**.

They are not the same as `process.cwd()`, the **current working directory**. The cwd is the folder where you *typed the command*. It changes when you run the same script from a different folder. `__dirname` never changes, because it describes where the file lives.

Why it matters: a relative path such as `'data.txt'` given to `fs` is resolved from the **cwd**, not from the script's folder. To read a file that sits next to your script, build the path from `__dirname`.

Example: `examples/05-dirname-filename.js` shows the three values, then proves the problem. It writes a small script into a temporary folder and starts it from a *different* folder.

```bash
node lessons/01-introduction/examples/05-dirname-filename.js
```

```text
__filename, last part                 : 05-dirname-filename.js
__dirname, last part                  : examples
both are absolute paths               : true
dirname(__filename) is __dirname      : true
cwd is the same as __dirname          : false
this file, seen from the cwd          : lessons/01-introduction/examples/05-dirname-filename.js

reader.js, started from another folder:
fs.readFileSync("intro-data.txt")     : ENOENT
fs.readFileSync(join(__dirname, ..))  : hello from intro-data.txt
require("./intro-config.json").ok     : true
```

Read the last three lines:
- `fs.readFileSync("intro-data.txt")` failed with **ENOENT** ("no such file or directory"), because the cwd was a different folder.
- `path.join(__dirname, 'intro-data.txt')` worked from anywhere.
- `require('./intro-config.json')` also worked. **`require` paths are relative to the file that calls `require`, not to the cwd.** Only `fs` and the other runtime functions use the cwd.

The code that fixes it is always the same:

```js
const path = require('node:path');
const file = path.join(__dirname, 'data.txt'); // works from any folder, on any OS
```

Use `path.join` (not string `+ '/'`) because Windows uses backslashes. The `node:` prefix says "this is a built-in module, not a package from npm".

### The ES module version
In an ES module (a `.mjs` file, or a `.js` file when the nearest `package.json` says `"type": "module"`), `__dirname`, `__filename` and `require` **do not exist**. Use `import.meta.dirname` and `import.meta.filename` (Node 20.11 and newer).

Example: `examples/06-esm-dirname.mjs`.

```bash
node lessons/01-introduction/examples/06-esm-dirname.mjs
```

```text
typeof __dirname : undefined
typeof __filename: undefined
typeof require   : undefined

import.meta.filename, last part: 06-esm-dirname.mjs
import.meta.dirname, last part : examples
old way gives the same folder  : true
top-level await result         : 42
```

The older recipe still works everywhere: `path.dirname(fileURLToPath(import.meta.url))`. ES modules also allow `await` at the top level, as the last line shows.

How does Node decide between CommonJS and ES modules?
- `.cjs` is CommonJS and `.mjs` is an ES module.
- For `.js` it reads the `"type"` field (`"commonjs"` or `"module"`) in the nearest `package.json`.
- With no `"type"`, the file is CommonJS, but Node switches to ES module if the code uses `import`, `export` or top-level `await`. This "syntax detection" is on by default in Node 22.7+ and 20.19+, so also in Node 24.

A later lesson goes deep into modules.

> **Interview tip:** "Difference between `__dirname` and `process.cwd()`?" `__dirname` is where the *file* is. `process.cwd()` is where the *command was started*. Add: "and in ES modules `__dirname` does not exist, I use `import.meta.dirname`".

---

## 9. The `process` object

`process` is a global object that represents **the running program itself**. It is one of the most asked-about objects in interviews.

| Member | What it gives you |
|---|---|
| `process.argv` | Array of command-line arguments. `[0]` is the `node` program, `[1]` is your script, your own arguments start at `[2]` |
| `process.env` | Environment variables, as an object. **Values are always strings** |
| `process.cwd()` | The current working directory |
| `process.platform`, `process.arch` | `'win32'`, `'darwin'` or `'linux'`, and the CPU type such as `'x64'` |
| `process.version`, `process.versions` | Node version, and versions of V8, libuv and others |
| `process.pid` | The id of this process |
| `process.uptime()` | Seconds since the process started |
| `process.memoryUsage()` | Memory numbers: `rss`, `heapTotal`, `heapUsed`, `external`, `arrayBuffers` |
| `process.stdin`, `process.stdout`, `process.stderr` | The three standard channels: input, normal output, error output. `console.log` writes to `stdout`, `console.error` to `stderr` |
| `process.exitCode`, `process.exit()` | Set the exit code, or end the program at once |
| `process.on('exit', fn)` | Run code when the program is ending |
| `process.on('SIGINT', fn)` | Run code when the user presses Ctrl+C (a later lesson uses this for a clean shutdown) |

Example: `examples/07-process-basics.js`. The header comment of the file has a line `@args alpha beta`, so the checker passes those arguments. Here we pass them by hand:

```bash
node lessons/01-introduction/examples/07-process-basics.js alpha beta
```

```text
argv[0] is the node program   : true
argv[1] is this script        : 07-process-basics.js
your own arguments (slice(2)) : [ 'alpha', 'beta' ]
Hello, friend! (set GREETING_NAME to change this)

process.env.PORT is now       : "3000" string
process.env.DEBUG is now      : "false" -> truthy? true
a variable nobody set         : undefined

platform                      : win32
cwd is an absolute path       : true
pid is a whole number         : true
uptime is small (seconds)     : true
memoryUsage() fields          : rss, heapTotal, heapUsed, external, arrayBuffers
written with stdout.write, no line break yet...

exitCode before we set it     : undefined
exit event, final code        : 0
```

`platform` shows your own system. To set an environment variable for one run, use the form for your shell:

```bash
GREETING_NAME=Sam node lessons/01-introduction/examples/07-process-basics.js
```

```powershell
$env:GREETING_NAME = "Sam"; node lessons/01-introduction/examples/07-process-basics.js
```

The first form is bash (macOS, Linux). The second is PowerShell. In `cmd` use `set GREETING_NAME=Sam` on its own line first.

### The gotchas interviewers like
1. **`process.env` only stores strings.** `process.env.DEBUG = false` stores the *text* `"false"`, and `Boolean("false")` is `true`. So `if (process.env.DEBUG)` is true even though you "set it to false". Compare to the string: `process.env.DEBUG === 'true'`. A missing variable is `undefined`, and `process.env.X = undefined` stores the text `"undefined"`.
2. **Ports from the environment are strings too.** Use `Number(process.env.PORT) || 3000`.
3. **`process.exit(1)` vs `process.exitCode = 1`.** `process.exit()` stops the program *right now*, even if work is pending, and output still being written can be lost. Setting `process.exitCode` lets the program finish normally and then exit with that code. Prefer `exitCode`; use `exit()` only when you must stop immediately.
4. The `'exit'` event handler can only run **synchronous** code. The event loop is already over.

Config tip: instead of typing variables by hand, put them in a `.env` file and start Node with `node --env-file=.env app.js` (Node 20.6 and newer, no library needed). A later lesson covers configuration.

> **Interview tip:** "What is `process.argv` and how do you read an option like `--port 8080`?" `argv` is the array of command-line words: index 0 is the `node` program, 1 is the script, your arguments start at 2. For anything beyond a word or two, say you would use the built-in `util.parseArgs` instead of parsing by hand.

---

## 10. Console methods

`console` is more than `console.log`. Example: `examples/08-console-methods.js`. Three lines of this example go to **stderr**, the error channel, so the output below shows only what goes to **stdout**.

```bash
node lessons/01-introduction/examples/08-console-methods.js
```

```text
1. values: 42 true [ 1, 2 ] { a: 1 }
2. Sam is 30 years old, data: {"ok":true}, done at 100%
3. info writes to stdout, just like log
6. table:
┌─────────┬─────────┬─────┐
│ (index) │ name    │ age │
├─────────┼─────────┼─────┤
│ 0       │ 'Ada'   │ 36  │
│ 1       │ 'Linus' │ 55  │
└─────────┴─────────┴─────┘
7. group:
Server
  starting
  Database
    connected
  ready
8. log : { level1: { level2: { level3: [Object] } } }
{
  level1: { level2: { level3: { level4: 'bottom' } } }
}
visits: 1
visits: 2
other: 1
loop: 5.889ms
sum is 499999500000
still running after a failed assert
```

The `loop: 5.889ms` line is a timer, so your number will be different. Your terminal also shows the stderr lines (4, 5 and the assert message) mixed in.

| Method | What it does |
|---|---|
| `console.log(...)`, `console.info(...)` | Print to stdout. Several values are joined with spaces |
| `console.error(...)`, `console.warn(...)` | Print to **stderr** |
| format codes | `%s` string, `%d` number, `%j` JSON, `%%` a percent sign (see line 2) |
| `console.table(array)` | Show an array of objects as a table |
| `console.group(label)` / `console.groupEnd()` | Indent the output in between |
| `console.dir(obj, { depth: null })` | Print an object with all its levels |
| `console.count(label)` | Count how many times that line ran |
| `console.time(label)` / `console.timeEnd(label)` | Measure how long something took |
| `console.assert(condition, message)` | Prints to stderr only if the condition is false. Does not stop the program |

Two lessons hide in the output:
- **`console.log` shows only 2 levels deep.** Line 8 prints `[Object]` instead of the deeper levels. Use `console.dir(obj, { depth: null })` or `JSON.stringify(obj, null, 2)` to see everything.
- **stdout and stderr are two separate channels.** A terminal shows both, but you can split them. This runs the example and sends stdout to a file, so only the stderr lines stay on the screen (works in bash, PowerShell and cmd):

```bash
node lessons/01-introduction/examples/08-console-methods.js > out.txt
```

```text
4. this line goes to stderr
5. so does this one
Assertion failed: 11. assert: math is broken
```

(Delete `out.txt` afterwards.) This is why logs go to stdout and errors go to stderr: tools can collect them separately.

> **Interview tip:** "What is the difference between `console.log` and `console.error`?" Both print text, but `log` uses stdout and `error` uses stderr. In production you use a real logger (for example pino) that writes structured JSON, but `console` is what you use while learning and debugging.

---

## 11. One thread and non-blocking I/O

This is the most important idea in the whole lesson. Take it slowly.

**The picture: one waiter in a restaurant.** The waiter takes an order, hands it to the kitchen, and **immediately goes to the next table**. When the kitchen rings the bell, the waiter brings the food. One waiter can serve many tables, because the waiter never *stands and waits* at the kitchen.

| In the restaurant | In Node |
|---|---|
| The waiter | The one JavaScript thread (the event loop) |
| The kitchen | The operating system and libuv's helper threads |
| Taking an order | Starting a file read, a network call, a timer |
| The bell | A callback / promise that is ready to run |
| A waiter who stands in the kitchen watching the pasta boil | **Blocking** code (`readFileSync`, a long loop) |
| A waiter who must chop 10 kg of onions personally | **CPU-heavy work**: every table waits |

Words to define:
- **I/O** (input/output) is any waiting-for-the-outside job: disk, network, database.
- **Synchronous** code runs one step at a time, and each step must finish before the next starts.
- **Asynchronous** code starts a job and lets the program carry on. The result arrives later, through a callback or a promise.
- **Non-blocking** means "start the job, give me my thread back, call me when it is done". Blocking is the opposite: the thread is stuck until the job is done.

**The event loop in four lines:**
1. Run your main script from the first line to the last.
2. Then keep looping: is there a finished job whose callback can run? Run it.
3. If nothing is finished yet, wait without using the CPU.
4. When there is nothing left to wait for, exit.

Example: `examples/10-non-blocking.js`.

```bash
node lessons/01-introduction/examples/10-non-blocking.js
```

```text
1. started together was faster than one by one: true
   one by one took at least 280 ms            : true
   together took under 70% of one by one      : true

2. asking the system to read this file...
3. readFile was called and we did NOT wait for it
4. the file is ready, it has more than 10 lines: true

5. now the blocking version...
6. readFileSync returned, and only then this line ran: true
```

What you see:
- Three timers of 100 ms started **together** finish in about 100 ms, not 300 ms. The waiting overlaps, because waiting costs no thread. (The example prints booleans, not times, so the output is the same on a slow machine.)
- With `fs.readFile`, line **3** appears *before* line **4**. Node asked the system to read the file and kept running. The callback came later.
- `fs.readFileSync` is the opposite: nothing else can run until it returns.

### So is Node single-threaded?
Half true, and the half matters in interviews.

- **True:** your JavaScript runs on **one thread**, with one call stack (the list of functions that are running right now). Two pieces of JavaScript in the same thread never run at the same moment, so you do not need locks around your variables.
- **Not true:** a Node *process* is not one thread. Behind the scenes it uses more:
  - the libuv **thread pool**, **4 threads by default**. It runs file system calls, `dns.lookup`, some crypto (`pbkdf2`, `scrypt`) and `zlib` compression. Change the size with the environment variable `UV_THREADPOOL_SIZE`, set *before* Node starts (setting it inside the script is not guaranteed to work);
  - helper threads of V8 for garbage collection and compiling;
  - **worker threads**, if you start them yourself (section 12).

  Network sockets do not use the pool: the OS tells libuv when data arrives. On the Windows machine used to write this course, a plain idle `node` process already had 12 operating system threads. The count differs between machines.

> **Interview tip:** The strong answer is "JavaScript runs on a single thread with an event loop. I/O is handed to the OS or to libuv's thread pool, so Node can handle thousands of waiting connections with one thread. CPU-heavy work is the exception, because it blocks that one thread." Avoid saying only "Node is single-threaded".

> **Common mistake:** Using `readFileSync`, `execSync` or other `...Sync` functions inside code that handles requests. They block *every* user while they run. Sync calls are fine at startup (reading a config file once) and in small scripts.

---

## 12. When Node is a good fit (and when it is not)

Because one thread serves everyone, Node is great when most of the time is spent **waiting**, and weak when most of the time is spent **calculating**.

**A good fit:**

| Use | Why |
|---|---|
| APIs and web services that call databases and other services | Almost all the time is waiting for I/O, so one thread serves many requests |
| Real-time apps: chat, live dashboards, notifications (WebSockets: a connection that stays open so both sides can send messages at any time) | Thousands of open, mostly idle connections are cheap |
| Developer tooling: build tools, linters, CLIs, scripts | Fast start, huge npm ecosystem |
| BFF (Backend For Frontend): a small server that gathers data from several services for one UI | Same language as the frontend team, and it is mostly I/O |
| Proxies, gateways, streaming | Streams move data without loading it all into memory |

**Not a good fit:** heavy CPU work, such as video encoding, large image processing, machine learning training, big number crunching. V8 is fast, so the problem is not slow JavaScript. The problem is that one long calculation blocks the single thread, so **every other request waits**. A blocked loop looks like this in production: one CPU core at 100% while all requests get slower together.

**What to do instead** (from simplest to biggest change):
1. **Use async built-ins**: the async versions of `crypto.pbkdf2` and `zlib` already run on the thread pool, so they do not block the main thread.
2. **Worker threads** (`node:worker_threads`): run the heavy function in another thread inside the same process.
3. **More processes**: the `cluster` module (it starts several copies of your app), a process manager, or several containers, to use all CPU cores.
4. **A job queue plus separate workers**: the web server only puts a job in a queue (a to-do list that workers pick from, for example BullMQ with Redis) and a worker process does it.
5. **Native code or another service**: a C++/Rust add-on, or a service written in Go, Rust or Python for the heavy part.

Example: `examples/11-cpu-vs-worker.js` counts prime numbers (pure CPU work) with a "heartbeat" timer that wants to tick every 10 ms. It runs the work twice: on the main thread, and in a worker thread.

```bash
node lessons/01-introduction/examples/11-cpu-vs-worker.js
```

```text
A. main thread counted 78498 primes
   heartbeat ticks while the main thread was busy: 0

B. worker thread counted 78498 primes
   heartbeat kept ticking (3 or more ticks): true
```

On the main thread the heartbeat got **0** ticks: the timer was due, but the thread was busy, so nothing else could run. With the work moved to a worker, the main thread stayed free and the heartbeat kept ticking. In a real server, the heartbeat would be your other users' requests.

The code that matters is small:

```js
const { Worker, isMainThread, parentPort } = require('node:worker_threads');

// countPrimes is the CPU-heavy function from the example file
if (isMainThread) {
  const worker = new Worker(__filename);          // start THIS file in a new thread
  worker.once('message', (count) => console.log(count));
} else {
  parentPort.postMessage(countPrimes(1_000_000)); // runs inside the worker
}
```

(See the full file for `countPrimes`. A later lesson explains worker threads properly.)

> **Interview tip:** "When would you not use Node?" Do not just say "for CPU work". Say *why* (one thread, a long calculation blocks every request) and *what you do about it* (worker threads, separate processes, a queue with workers, or another service for that part). A senior follow-up is "how would you notice a blocked event loop?" Answer: measure event loop delay (the built-in `perf_hooks.monitorEventLoopDelay`, covered in a later lesson).

---

## 13. Your first HTTP server

An **HTTP server** is a program that waits for requests from browsers or other programs and sends back responses. In Node it needs no library:

```js
const http = require('node:http');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Hello from Node!');
});

server.listen(3000, () => {
  console.log('Open http://localhost:3000 in your browser. Press Ctrl+C to stop.');
});
```

That is about 10 lines. Save it as `server.js`, run `node server.js`, and open `http://localhost:3000`. The program does not end: it keeps waiting for requests. Stop it with **Ctrl+C**. To test it from a second terminal without a browser:

```bash
node -e "fetch('http://localhost:3000').then((r) => r.text()).then(console.log)"
```

It prints `Hello from Node!`.

How it works, line by line:
- `http.createServer(callback)` makes a server. Your **callback runs once for every request**. It gets two objects: `req` (the incoming request: `req.method`, `req.url`, `req.headers`) and `res` (the response you build).
- `res.writeHead(200, headers)` sets the status code (200 means OK) and the headers. `Content-Type` tells the client what kind of data the body is.
- `res.end('...')` sends the body and **finishes** the response. If you forget `res.end()`, the client keeps waiting.
- `server.listen(3000)` starts waiting on port 3000. A **port** is a numbered door on your machine. Only one program can use a port at a time.

Notice there is no routing: every URL gets the same answer. Express and other frameworks add routing; Task 3 below does it by hand. Also, a browser asks for `/favicon.ico` after the page, so the callback may run twice for one page visit.

**Why does the process stay alive?** Our earlier scripts ended when the last line was done. A listening server is an *active handle* (an open resource) that can still produce events, so the event loop has more to wait for and Node does not exit. Close the server, and the process ends.

The example file `examples/12-first-server.js` is the same server, made to run by itself: it listens on port **0** (which means "the OS picks any free port"), calls itself with `fetch`, and closes. It also does the "port in use" mistake on purpose (section 15).

```bash
node lessons/01-introduction/examples/12-first-server.js
```

```text
listening on 127.0.0.1, port is above 0: true
server saw a request: GET /hello
client got status : 200
client got header : text/plain
client got body   : Hello from Node!

second server failed with: EADDRINUSE
first server closed, so the process can exit
```

The `'127.0.0.1'` in the example means "accept connections only from this computer". The shorter `server.listen(3000)` can accept connections from other computers too (a firewall may still block them). A real deployment often needs that, but for a learning example local-only is safer.

> **Interview tip:** "How does Node handle many requests with one thread?" The callback you pass to `createServer` is quick (it only builds a response). While a request waits for a database, Node is free to run the callback of the next request. If the callback does heavy synchronous work, requests queue up behind it.

---

## 14. What happens when you run `node app.js`

A high-level walk, from the Enter key to the end:

```text
  node app.js
      |
  1. the OS starts the node program (one executable: V8 + libuv + core modules)
      |
  2. Node starts up: creates V8, creates the event loop,
     sets up globals (process, console, ...), reads flags
      |
  3. Node finds app.js, turns it into an absolute path,
     decides: CommonJS or ES module?
      |
  4. Node compiles the file as the body of a function and calls it:
     your top-level code runs, line by line, synchronously
     (every require() loads another file right there, also synchronously)
      |
  5. the main script ends: nextTick callbacks and promise callbacks run
      |
  6. the event loop runs: timers, I/O callbacks, setImmediate ...
     it keeps going while something can still produce events
      |
  7. nothing is left: 'beforeExit' event, then 'exit' event, then the process ends
```

(In step 5 the order of the two kinds of callbacks depends on the module type: in CommonJS `nextTick` goes first, in an ES module promises go first. The event loop lesson explains this.)

Step 4 explains where `require`, `module`, `exports`, `__filename` and `__dirname` come from. In a CommonJS file Node does the equivalent of this:

```js
(function (exports, require, module, __filename, __dirname) {
  // ...your whole file goes here...
});
```

They are not magic globals: they are the **five parameters of a function** that wraps your file. That also explains why `var` at the top of a file is not global (section 6): it lives inside that function.

Example: `examples/09-what-happens.js` shows the wrapper and the order of events.

```bash
node lessons/01-introduction/examples/09-what-happens.js
```

```text
1. main script starts

The wrapper function received 5 arguments:
   exports    has type object
   require    has type function
   module     has type object
   __filename has type string
   __dirname  has type string
this === module.exports      : true
require.main === module      : true (true only for the entry file)
module.id of the entry file  : .

2. main script ends (all synchronous code is done)
3. promise callback (right after the main script)
4. timer callback (the event loop picks it up)
5. beforeExit (the loop has nothing left to do)
6. exit event, code 0
```

Read the numbers: all synchronous code first (1, then 2), then the promise callback (3), then the timer from the event loop (4), then the two "shutdown" events (5, 6). A timer with a delay of `0` still runs after the promise callback and after the whole main script.

Two more facts from the output: `this` at the top of a file is `module.exports`, and `require.main === module` is true only in the file you started with. That is how a file can say "run this code only when I am started directly":

```js
if (require.main === module) {
  main();
}
```

> **Under the hood:** Because the main script is plain synchronous code, an error thrown on its first line stops everything. And if the main script never ends (a `while (true) {}` loop), the event loop never starts, so no timer and no request is ever handled.

> **Interview tip:** "What happens when you run `node app.js`?" A strong short answer: "Node starts V8 and the event loop, wraps my file in a function and runs it from top to bottom. Then the event loop handles timers, I/O and callbacks until nothing is left that can produce events, and the process exits with a code." Mentioning the function wrapper and `require.main === module` shows you know the module system.

---

## 15. Common beginner mistakes

**1. `'node' is not recognized` / `command not found: node`.**
The shell cannot find Node. Close and reopen the terminal after installing (the PATH is read when the terminal starts). With a version manager, make sure you ran `nvm use` or `fnm use`.

**2. Typing `node app.js` inside the REPL.**
You get `SyntaxError: Unexpected identifier 'app'` (section 5). A `>` prompt means you are already inside Node. Type `.exit`.

**3. Wrong path or wrong folder for the script.** (This also covers relative file paths that depend on the cwd: `fs.readFileSync('data.txt')` fails with `ENOENT` from another folder. Fix it with `path.join(__dirname, 'data.txt')`, section 8.)
`node nope.js` prints:

```text
Error: Cannot find module '<full path>/nope.js'
    ... (stack lines) ... {
  code: 'MODULE_NOT_FOUND',
  requireStack: []
}
```

(The path and stack are shortened here.) Check where you are with `pwd` (bash) or `Get-Location` (PowerShell), and use `ls` / `dir` to see the file. Run from the repo root for this course. The same idea applies to npm: `npm install` and `npm run ...` need the folder that has `package.json`.

**4. Forgetting to restart after editing.**
Node reads and compiles your file **once**, at startup. Editing the file does not change the running program. Stop it (Ctrl+C) and start it again, or let Node do it:

```bash
node --watch app.js
```

**5. Port already in use (`EADDRINUSE`).**
Starting a second server on the same port fails. The example in section 13 shows `err.code === 'EADDRINUSE'`. When you run a real server twice you see the full error:

```text
Error: listen EADDRINUSE: address already in use :::3000
```

Usually the old copy is still running in another terminal. Stop it with Ctrl+C there, or find and stop it by process id (replace `12345` with the id you found):

| Shell | Find who uses port 3000 | Stop it |
|---|---|---|
| PowerShell | `Get-NetTCPConnection -LocalPort 3000 -State Listen \| Select-Object OwningProcess` | `Stop-Process -Id 12345` |
| Windows cmd | `netstat -ano \| findstr :3000` | `taskkill /PID 12345 /F` |
| macOS / Linux | `lsof -i :3000` | `kill 12345` |

A better habit: read the port from the environment, `Number(process.env.PORT) || 3000`, so you can pick another one.

**Smaller traps, same lessons:**

| What you see | Cause | Fix |
|---|---|---|
| `ReferenceError: window is not defined` | Browser object used in Node (also `document`, `alert`; `localStorage` is missing on Node 24) | Node has no page (section 6) |
| `ReferenceError: require is not defined in ES module scope, you can use import instead` | `require` inside a `.mjs` file or an ES module | Use `import fs from 'node:fs'` (section 8) |
| Browser spins forever on your server | A code path never calls `res.end()` | Every path in the handler must end the response |
| `if (process.env.DEBUG)` is true for `"false"` | Environment values are strings | Compare: `=== 'true'` (section 9) |
| Whole server freezes during one request | A `...Sync` call or a long loop in a handler | Use the async version or a worker (sections 11 and 12) |

---

## Summary / Key takeaways
- Node.js is a **runtime**: V8 (runs JavaScript) + libuv (event loop, async I/O) + built-in modules. A framework such as Express is a library on top.
- Production uses **Active or Maintenance LTS** versions. Even majors up to 26 became LTS; from Node 27 every release does. Never run an end-of-life version.
- Run code with `node file.js`, `node -p` (print a value), `node -e` (run a snippet) or the REPL. Exit code `0` means success.
- Node has no DOM and no `window`; it has `fs`, `http`, `os` and a `process` object. Use `globalThis` for the global object.
- `__dirname` is the folder of the file; `process.cwd()` is the folder where you started the command. Build file paths with `path.join(__dirname, ...)`.
- `process.env` values are strings. Prefer `process.exitCode = 1` over `process.exit(1)`.
- JavaScript runs on one thread with an event loop, but I/O is done by the OS and a thread pool (4 threads by default). That is why waiting is cheap and heavy CPU work is expensive. Use worker threads, more processes or queues for CPU work.
- A listening server keeps the process alive; a script exits when nothing is left in the event loop.

---

## Quick check

1. Is Node.js a language, a framework or a runtime? What is the difference between those three?
<details><summary>Answer</summary>

It is a runtime. JavaScript is the language, V8 is the engine that runs it, and Node.js is the engine plus the tools around it (libuv, `fs`, `http`, `process`). A framework such as Express is a library built on top of the runtime.

</details>

2. What do V8 and libuv each do?
<details><summary>Answer</summary>

V8 compiles and runs JavaScript and manages memory (garbage collection). libuv provides the event loop, asynchronous file and network I/O on every operating system, timers and a thread pool.

</details>

3. Is Node.js single-threaded?
<details><summary>Answer</summary>

Your JavaScript runs on one thread (one call stack), but the Node process uses more threads: the libuv thread pool (4 by default) for file system, `dns.lookup`, some crypto and zlib, V8 helper threads, and worker threads if you create them. A good answer says "single-threaded event loop for JavaScript, with a thread pool and the OS doing the I/O".

</details>

4. Which Node versions are right for production today, and what was the even/odd rule?
<details><summary>Answer</summary>

Active LTS or Maintenance LTS releases (in November 2026: 26 Active; 24 and 22 Maintenance). Up to Node 26, even major numbers became LTS and odd ones never did. From Node 27 on, there is one release a year and every release becomes LTS, so the even/odd rule ends. End-of-life versions (18, 20, and all odd ones) get no fixes.

</details>

5. What is the difference between `node -e "6 * 7"` and `node -p "6 * 7"`? In the REPL, what does `_` hold?
<details><summary>Answer</summary>

`-p` prints the value of the last expression, so it prints `42`. `-e` only runs the code and prints nothing unless the code itself calls `console.log`. In the REPL, `_` holds the result of the previous line.

</details>

6. What is the difference between `__dirname` and `process.cwd()`? Which one do you use to read a file that sits next to your script?
<details><summary>Answer</summary>

`__dirname` is the absolute folder of the current file and never changes. `process.cwd()` is the folder where the command was started and changes with where you run it. Use `path.join(__dirname, 'file.txt')`. In ES modules `__dirname` does not exist; use `import.meta.dirname`.

</details>

7. Name three things a browser has that Node does not, and two things Node has that a browser does not.
<details><summary>Answer</summary>

Browser only: `window`, `document` (the DOM), `alert`, `localStorage` (not available by default on Node 24). Node only: file system access (`fs`), creating servers (`http`), `process`, `Buffer`, `child_process`.

</details>

8. This script ends immediately: `console.log('a')`. This one does not: `http.createServer(...).listen(3000)`. Why?
<details><summary>Answer</summary>

Node exits when the main script is done and the event loop has nothing left that can produce events. A listening server is an open handle that can still receive requests, so the loop keeps waiting. Closing the server (`server.close()`) lets the process exit.

</details>

9. Why is Node a poor choice for heavy CPU work, and how do you cope?
<details><summary>Answer</summary>

A long calculation runs on the single JavaScript thread and blocks the event loop, so every other request waits. Cope by moving the work to worker threads, running more processes (`cluster`, containers), sending jobs to a queue handled by separate workers, or putting that part in a service written in another language.

</details>

10. What does this print, and why?
```js
process.env.DEBUG = false;
if (process.env.DEBUG) console.log('debug is on');
```
<details><summary>Answer</summary>

It prints `debug is on`. Assigning to `process.env` turns the value into a string, so `DEBUG` becomes the text `"false"`, and any non-empty string is truthy. Compare with a string instead: `process.env.DEBUG === 'true'`.

</details>

---

## Try it yourself

Run these from the repo root or from any scratch folder. Create the files wherever you like (for example in a temporary folder), not inside `examples/`.

### Task 1 (easy): a greeting script
Write `greet.js`. It reads a name from the first command-line argument and prints `Hello, <name>! You are running Node <version> on <platform>.` If no name is given, use `friend`. Check that `node greet.js "Ada Lovelace"` works with a name that has a space.

<details><summary>Hint</summary>

Your own arguments start at `process.argv[2]`. Use `??` (or `||`) for the default. The version is `process.version` and the system is `process.platform`.

</details>

<details><summary>Solution</summary>

```js
// greet.js
const name = process.argv[2] ?? 'friend';
console.log(`Hello, ${name}! You are running Node ${process.version} on ${process.platform}.`);
```

```bash
node greet.js
node greet.js Sam
node greet.js "Ada Lovelace"
```

```text
Hello, friend! You are running Node v24.16.0 on win32.
Hello, Sam! You are running Node v24.16.0 on win32.
Hello, Ada Lovelace! You are running Node v24.16.0 on win32.
```

The quotes are needed for the last call: without them the shell sends two arguments (`Ada` and `Lovelace`) and the script would only use `Ada`. Your version and platform will differ.

</details>

### Task 2 (medium): a line counter that works from any folder
Write `lines.js`. It prints how many lines a file has: `<count> lines in <file name>`. The file is the first argument; with no argument it counts the lines of **`lines.js` itself** (use `__filename`). If the file cannot be read, print `Cannot read <path>: <error code>` to **stderr** and make the program exit with code 1 (do not call `process.exit`). Then run it from two different folders to prove it works from both.

<details><summary>Hint</summary>

`fs.readFileSync(file, 'utf8')` throws if the file is missing. Catch it, print with `console.error(...)`, and set `process.exitCode = 1`. The error has a `code` property such as `ENOENT`. `path.basename(file)` gives only the file name.

</details>

<details><summary>Solution</summary>

```js
// lines.js
const fs = require('node:fs');
const path = require('node:path');

const file = process.argv[2] ?? __filename; // no argument: count the lines of this very script

try {
  const text = fs.readFileSync(file, 'utf8');
  console.log(`${text.trimEnd().split('\n').length} lines in ${path.basename(file)}`);
} catch (err) {
  console.error(`Cannot read ${file}: ${err.code}`);
  process.exitCode = 1; // 1 means "failed". We set exitCode (not process.exit) so Node can finish cleanly.
}
```

```bash
node lines.js
node lines.js greet.js
node lines.js missing.txt
```

```text
13 lines in lines.js
3 lines in greet.js
Cannot read missing.txt: ENOENT
```

The last command exits with code 1 (check it with `echo $?` in bash or `$LASTEXITCODE` in PowerShell). To run it from another folder, give the full path to the script, for example `node /path/to/lines.js`. It still prints `13 lines in lines.js`, because the default file comes from `__filename`, not from the cwd.

</details>

### Task 3 (harder): a tiny routing server that tests itself
Write `time-server.js` with an HTTP server on port 0 and these routes: `/` answers `Hello` as plain text; `/time` answers JSON like `{"now":"2026-01-01T00:00:00.000Z"}` (the current time, with the JSON content type); anything else answers `Not found` with status **404**. After the server starts, call the three routes `/`, `/time` and `/nope` with `fetch`, print the status code and `Content-Type` of each, then close the server so the program ends.

<details><summary>Hint</summary>

Branch on `req.url`. Use `new Date().toISOString()` and `JSON.stringify`. Get the port with `server.address().port`. Call `server.close()` after the last `fetch`. Remember `res.end()` in every branch.

</details>

<details><summary>Solution</summary>

```js
// time-server.js
const http = require('node:http');

const server = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Hello');
  } else if (req.url === '/time') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ now: new Date().toISOString() }));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/', '/time', '/nope']) {
    const response = await fetch(base + route);
    const body = await response.text();
    console.log(route.padEnd(6), response.status, response.headers.get('content-type'));
    if (route === '/time') console.log('       valid ISO date:', !Number.isNaN(Date.parse(JSON.parse(body).now)));
  }
  server.close();
});
```

```bash
node time-server.js
```

```text
/      200 text/plain
/time  200 application/json
       valid ISO date: true
/nope  404 text/plain
```

Every branch ends with `res.end(...)`. Note that `fetch` does not fail on the 404: it gives you the response with `status` 404. Stretch: add a route `/block` that runs a 2 second busy loop, and see how `/` becomes slow while it runs (section 12).

</details>

---

## Where to go next
- Next lesson: [02. JavaScript Essentials for Node Interviews](../02-javascript-essentials/README.md)
- Practise this topic with interview questions: [Round 1: Screening](../../rounds/round-1-screening/questions.md) and [Round 2: Core](../../rounds/round-2-core/questions.md)
- Go back to the [list of all lessons](../../README.md)
