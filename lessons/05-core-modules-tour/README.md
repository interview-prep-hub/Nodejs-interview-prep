# 05. Core Modules Tour: path, os, util, url, readline and More

> Level: Beginner   Time: about 3 hours   Node: 24 (notes where older versions differ)

[Previous: 04. npm, package.json and Dependencies](../04-npm-and-package-json/README.md) | [All lessons](../../README.md) | [Next: 06. The File System (fs)](../06-file-system/README.md)

## What you will learn
- What a core module is, and why you write `node:` in front of its name (section 1)
- `path` and `os`: build file paths that work on Windows, Linux and macOS, and ask the machine about itself (sections 2 and 3)
- `process`: arguments, environment variables, the current folder, memory and timing (section 4)
- `url`: the modern `URL` and `URLSearchParams`, why `url.parse` is a trap, and how to check a URL safely (section 5)
- `util`: `promisify`, `inspect`, `format`, `parseArgs`, `styleText`, `deprecate` and more (sections 6 and 7)
- `timers`, `readline`, `assert`, `console` and `zlib`: the 20 percent that covers 80 percent of real use (sections 8 to 12)
- Which module to reach for when you have a job to do (the lookup table in section 14)

## 1. Core modules: what they are and how to load them

A **core module** (also called a built-in module) is code that ships inside Node itself. You never run `npm install` for it. Think of the small tool set that comes in the box with a new drill: you do not buy it separately.

You will meet three kinds of things in Node code:

| Kind | How you get it | Examples |
|---|---|---|
| Global | Nothing to load, just use it | `process`, `console`, `setTimeout`, `URL`, `TextEncoder`, `fetch`, `Buffer` |
| Core module | `require('node:name')` or `import ... from 'node:name'` | `path`, `os`, `util`, `fs`, `zlib` |
| npm package | `npm install`, then `require('name')` | `express`, `lodash` |

```js
const path = require('node:path'); // CommonJS
// import path from 'node:path';   // ES modules: the same module
```

The `node:` prefix says "this comes from Node, not from `node_modules`". Example: `examples/01-core-modules.js`.

```bash
node lessons/05-core-modules-tour/examples/01-core-modules.js
```

```text
path.join exists: function
same object: true
isBuiltin("fs") = true
isBuiltin("node:fs") = true
isBuiltin("test") = false
isBuiltin("node:test") = true
isBuiltin("express") = false
prefix-only modules: node:sea, node:sqlite, node:test, node:test/reporters
require("test") fails with MODULE_NOT_FOUND
require("node:nope") fails with ERR_UNKNOWN_BUILTIN_MODULE
globals: object object function function function function
getBuiltinModule gives the same object: true
public modules without the prefix: true
```

Why this output:
- `fs` and `node:fs` are the same object. The prefix changes nothing except clarity.
- A few modules exist **only** with the prefix: `node:test` (the test runner), `node:sqlite` and `node:sea`. Plain `require('test')` goes looking in `node_modules` and fails.
- `module.isBuiltin(name)` asks Node if a name is a core module.
- `process.getBuiltinModule('node:path')` loads a core module without `require` (Node 20.16+ and 22.3+). It is handy in ES modules and in code that must run in both module systems.
- The `prefix-only modules` line depends on the Node version: `module.builtinModules` lists names such as `node:test` only since Node 23.5. On older versions that line prints nothing (or fewer names), but `require('node:test')` still works.

> **Interview tip:** "Why write `node:fs` and not `fs`?" A strong answer: it makes it obvious to the reader that this is a core module, it can never be confused with an npm package of the same name, and some modules (`node:test`, `node:sqlite`) only work with the prefix. Core modules are part of the `node` executable, so loading one does not read a file from `node_modules`.

### How to use this lesson

- Every example runs from the repo root, for example `node lessons/05-core-modules-tour/examples/02-path.js`. Run it, read the output, change one thing, run it again. That is the fastest way to learn.
- The output shown here was captured on Windows 11 with Node 24.16. Lines that depend on your machine (folders, memory, timings) are marked, and yours will differ. Where Linux or macOS behave differently, the text says so. Those statements come from the Node docs and were not measured on those systems.
- Some examples use `await` and promises, for example `await sleep(100)` means "wait 100 ms, then carry on". Read `await` as "wait here until the result is ready". [Lesson 07](../07-async-javascript/README.md) explains it properly.

## 2. path: file paths that work on every OS

A **path** is a string that points to a file or folder. An **absolute** path starts at the very top of the disk (`C:\Users\ada\notes.txt`, `/home/ada/notes.txt`) and means the same thing wherever your program runs. A **relative** path (`data/notes.txt`) depends on the folder you are standing in.

The trap: Windows writes paths with backslashes (`C:\Users\ada\notes.txt`), Linux and macOS use forward slashes (`/home/ada/notes.txt`). If you glue strings by hand (`folder + '/' + file`) you get bugs that only show up on someone else's computer. The `path` module builds and takes apart paths using the rules of the OS you run on.

> **Remember:** `path` works on strings only. It never touches the disk. It will happily build a path to a file that does not exist. Reading and writing files is the job of `fs` ([lesson 06](../06-file-system/README.md)).

Example: `examples/02-path.js` (the output below is from Windows; Linux and macOS print `/` instead of `\`).

```bash
node lessons/05-core-modules-tour/examples/02-path.js
```

### join and resolve

```js
console.log(path.join('data', 'users', 'ada.json'));
console.log(path.join('data/users', '../logs', 'app.log')); // ".." climbs one folder
console.log(path.join('/srv/app', '/uploads', 'a.png'));    // a leading slash does NOT restart the path
const resolved = path.resolve('notes.txt');                 // starts from process.cwd()
```

```text
path.sep = "\\"
path.delimiter = ";"
--- join: glue pieces, then clean up ---
data\users\ada.json
data\logs\app.log
\srv\app\uploads\a.png
--- resolve: always returns an absolute path ---
absolute? true
same as cwd + name? true
relative to cwd: notes.txt
```

| Function | What it does |
|---|---|
| `path.join(a, b, ...)` | Glues the pieces with the OS separator, then cleans up `.`, `..` and double slashes. The result can be relative. |
| `path.resolve(a, b, ...)` | Works from right to left until it has an **absolute** path. If none of the pieces is absolute, it starts from `process.cwd()`. The result is always absolute. |

The difference is clearest on POSIX paths (POSIX is the rule book Linux and macOS follow, with `/` separators). The table was computed with `path.posix`, so the answers are the same on every OS:

| Call | `join` | `resolve` |
|---|---|---|
| `('/a', 'b')` | `/a/b` | `/a/b` |
| `('/a', '/b')` | `/a/b` | `/b` |
| `('a', 'b')` | `a/b` | `<cwd>/a/b` |
| `('a', '../b')` | `b` | `<cwd>/b` |

`join` is a glue. `resolve` is a "where does this really point?" question, and a later absolute piece wins.

> **Interview tip:** "What is the difference between `path.join` and `path.resolve`?" Say: `join` only concatenates and normalizes, the result may be relative. `resolve` always returns an absolute path, processes arguments right to left, and uses the current working directory if it needs a starting point.

### Take a path apart

```js
const file = '/home/ada/app/config.prod.json';
path.basename(file);             // 'config.prod.json'
path.basename(file, '.json');    // 'config.prod'
path.dirname(file);              // '/home/ada/app'
path.extname(file);              // '.json'
path.extname('archive.tar.gz');  // '.gz'  (only the last dot counts)
path.extname('.gitignore');      // ''     (a dotfile has no extension)
```

`path.parse(file)` returns all the parts at once, and `path.format()` does the reverse:

```text
{
  root: '/',
  dir: '/home/ada/app',
  base: 'config.prod.json',
  ext: '.json',
  name: 'config.prod'
}
reports\sales.csv
reports\sales.json
```

The last two lines come from `path.format({ dir: 'reports', name: 'sales', ext: '.csv' })` and from changing an extension: parse the path, then format it again with `base: ''` and a new `ext`. If `base` is set, `format` ignores `name` and `ext`, so you must clear it.

### normalize, relative, sep

`path.normalize('/a//b/./c/../d')` cleans a messy path (the example prints `\a\b\d` on Windows, `/a/b/d` elsewhere). `path.relative('/data/app/src/utils', '/data/app/test/unit')` answers "how do I walk from the first folder to the second?" (`..\..\test\unit` on Windows). `path.sep` is the separator (`\` on Windows, `/` elsewhere) and `path.delimiter` separates entries in lists such as `PATH` (`;` on Windows, `:` elsewhere).

Small facts that surprise people:
- `path.join('')` gives `'.'` (the current folder), and `path.resolve()` with no arguments is `process.cwd()`.
- `basename` and `dirname` ignore a trailing slash: `path.basename('/a/b/')` is `'b'`.
- With two Windows drives there is no relative way from one to the other, so `path.win32.relative('C:\\a', 'D:\\b')` returns the absolute target `D:\b`.
- Windows (and macOS with its default settings) treat `User.js` and `user.js` as the same file. Linux does not. `require('./user')` may work on your laptop and fail on the Linux server if the file is really called `User.js`. Always match the case exactly.

### Why posix vs win32 matters on Windows

The `path` module is really two modules with the same functions: `path.posix` (slashes, used on Linux and macOS) and `path.win32` (backslashes and drive letters). The plain `path` you import is one of them, chosen by the OS. Example: `examples/03-path-posix-win32.js`. Asking for each by name makes the output identical on every OS.

```bash
node lessons/05-core-modules-tour/examples/03-path-posix-win32.js
```

```text
plain path is win32? true
plain path is posix? false
--- join ---
posix: a/b/c.txt
win32: a\b\c.txt
--- a Windows path read with each rule book ---
win32 basename: notes.txt
posix basename: C:\Users\ada\notes.txt
win32 root: C:\
posix root: ""
--- absolute or not? ---
win32 says C:\Users\ada\notes.txt is absolute: true
posix says C:\Users\ada\notes.txt is absolute: false
win32 says /x is absolute: true
--- resolve: the last absolute path wins ---
/data/x
D:\data\x
--- the Windows reader accepts both slashes ---
C:\Users\ada\notes.txt
/Users/ada/notes.txt
--- URLs and archive entries must always use forward slashes ---
wrong on Windows: \api\users\42
right everywhere: /api/users/42
--- turn a native path into a slash path ---
src/lib/index.js
```

What to take from this:
- A POSIX reader does not understand `C:\Users\ada\notes.txt`. It sees one strange file name with backslashes in it.
- A Windows reader accepts both `/` and `\` as separators, and prints `\`.
- Anything that is **not** a file on your disk must use forward slashes on every OS: URL paths, `import` specifiers, archive entries. Building them with plain `path.join` gives `\api\users\42` on Windows. Use `path.posix.join` or `new URL(...)`.
- Only the first two lines of the output depend on your OS. Everything else is the same everywhere.

### Guard against path traversal

A user sends `../../secret.txt` as a file name. A plain `path.join(uploadFolder, name)` walks right out of your upload folder. This is called **path traversal**, and it is a classic security bug. The fix: resolve the full path, then check that it still lies inside the folder.

```js
function safeJoin(baseDir, userPath) {
  const full = path.resolve(baseDir, userPath);
  const rel = path.relative(baseDir, full);
  const escapes = rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel);
  if (escapes) throw new Error(`Blocked: ${userPath}`);
  return full;
}
```

```text
ok     -> photos\cat.png
Blocked: ../../secret.txt
Blocked: /etc/passwd
```

`safeJoin` only compares strings. It does not follow symbolic links (shortcuts to other places), so a link inside the upload folder can still point outside it. If that matters, check the result of `fs.realpath` too.

> **Common mistake:** Using `__dirname` with a hand-made string, like `__dirname + '/data.json'`. Write `path.join(__dirname, 'data.json')`. And remember: `__dirname` is the folder of the **file**, `process.cwd()` is the folder you **started node from**. They are often different. In an ES module `__dirname` does not exist. Use `import.meta.dirname` (Node 20.11+), or `path.dirname(fileURLToPath(import.meta.url))` on older versions.

## 3. os: facts about the machine

The `os` module answers "what computer am I running on?". It is read-only: it reports, it does not change anything.

| Function | Returns |
|---|---|
| `os.platform()` | `'win32'`, `'linux'`, `'darwin'` (same as `process.platform`) |
| `os.type()` | `'Windows_NT'`, `'Linux'`, `'Darwin'` |
| `os.arch()` | CPU type, for example `'x64'` or `'arm64'` |
| `os.cpus()` | One entry per logical CPU (an array, so use `.length`). A logical CPU is one thread of execution the OS can schedule: a 6-core chip with hyper-threading shows 12. |
| `os.availableParallelism()` | How many tasks you can sensibly run at once (use this to size a worker pool) |
| `os.totalmem()`, `os.freemem()` | Memory in **bytes** |
| `os.homedir()`, `os.tmpdir()` | The user's home folder, and the folder for temporary files |
| `os.EOL` | The line ending of this OS: `'\r\n'` on Windows, `'\n'` elsewhere |
| `os.hostname()`, `os.uptime()` | Computer name, seconds since boot |
| `os.release()`, `os.version()`, `os.machine()` | OS release strings, and the hardware type (for example `x86_64`) |
| `os.userInfo()` | Who is running the program: `username`, `homedir`, `shell`, `uid`, `gid` |

Example: `examples/04-os-and-process.js` (first half). The numbers are for my machine, yours will differ. The script replaces my home folder with `~` so no user name is printed.

```bash
node lessons/05-core-modules-tour/examples/04-os-and-process.js one two --flag=3
```

```text
=== os: the machine ===
platform: win32
type: Windows_NT
arch: x64
logical CPUs: 12 | availableParallelism: 12
total memory: 15.7 GiB
free memory is less than total: true
home folder: ~
temp folder: ~\AppData\Local\Temp
EOL: "\r\n"
hostname is a non-empty string: true
uptime is a number: true
```

Typical uses: put scratch files in `os.tmpdir()` (the examples in this course do this and clean up), store settings under `os.homedir()`, pick a worker count from `os.availableParallelism()`.

Gotchas:
- **Line endings.** Splitting a text file with `content.split(os.EOL)` breaks when the file was made on another OS. Split with `/\r?\n/` instead. `os.EOL` is for **writing** text for the current OS, not for reading text from anywhere.
- **Windows.** `os.loadavg()` always returns `[0, 0, 0]` (the idea does not exist there). `process.platform` is `'win32'` on 64-bit Windows too, so "is this Windows?" is `process.platform === 'win32'`.
- **Containers.** Inside Docker and similar tools, `os.totalmem()` and `os.cpus()` may describe the whole host, not the limit given to your container. `process.constrainedMemory()` reports the limit the OS imposes on the process (it returns `0` when there is no such limit, as it did on the Windows machine used here).

> **Interview tip:** "How do you use all the CPU cores in Node?" A strong answer: one Node process runs your JavaScript on one thread. To use more cores you run more processes (`cluster`, or several instances behind a load balancer) or hand CPU-heavy work to `worker_threads`. `os.availableParallelism()` tells you how many to start. Details are in [lesson 18](../18-worker-threads-and-cluster/README.md).

## 4. process: your program looking at itself

`process` is a global object, so you do not need to load it. It describes the program that is running right now: its arguments, its environment, its memory, and how it ends. (Signals, exit codes, standard input and child programs have their own lesson: [15. Processes and CLIs](../15-processes-and-cli/README.md).)

The second half of the same example shows the basics:

```text
=== process: arguments ===
argv length: 5
argv[0] is node: node
argv[1] is this file: 04-os-and-process.js
your arguments: [ 'one', 'two', '--flag=3' ]
--flag given? true

=== process: environment variables ===
APP_MODE: demo
typeof RETRIES: string | value: "3"
missing variable: undefined
port: 3000

=== process: where am I? ===
cwd is the folder you started node in; __dirname is where this file lives
cwd -> __dirname: lessons\05-core-modules-tour\examples
platform: win32 | arch: x64
Node major version: v24

=== process: memory and time ===
memory fields: rss, heapTotal, heapUsed, external, arrayBuffers
heapUsed <= heapTotal: true
rss (MB): 54
hrtime.bigint type: bigint
loop took (ms): 4.88
sum: 499999500000

exit event, code 0
```

The `rss (MB)` and `loop took` lines change on every run.

- **`process.argv`** is an array of strings. `argv[0]` is the path of the `node` program, `argv[1]` is your script, and your own arguments start at index 2. That is why you write `process.argv.slice(2)`. For real flag handling use `util.parseArgs` (section 7).
- **`process.env`** holds **environment variables**: named settings that the shell or the host (Docker, a cloud service) hands to your program, such as `PORT=8080`. Values are **always strings**: assigning `3` stores `"3"`. (Numbers and booleans are converted quietly. Assigning an object or `undefined` is documented as deprecated and may throw in a future Node, so convert to a string yourself.) Reading one that does not exist gives `undefined`. The usual pattern is `Number(process.env.PORT) || 3000`. Changing `process.env` affects only your running program, never your shell. On Windows, variable names are not case sensitive. To load a whole `.env` file, use `node --env-file=.env app.js` (details in lesson 15, section 8).
- **`process.cwd()`** is the folder you started `node` in. `__dirname` is the folder of the file. Use `__dirname` for files that live next to your code.
- **`process.platform`** and **`process.arch`** tell you the OS and CPU type. `process.version` is the Node version.
- **`process.memoryUsage()`** reports bytes. `rss` is all the RAM the process holds. `heapTotal` and `heapUsed` describe V8's heap (V8 is the engine that runs JavaScript; its heap is where your objects live): reserved and in use. `external` is memory for C++ objects tied to JavaScript values, and `arrayBuffers` (a part of `external`) is the memory of `ArrayBuffer`s and Buffers. It gathers several figures, so it is slower than `process.memoryUsage.rss()`, which returns only the first number.
- **`process.on('exit', fn)`** runs when the program is about to end (only synchronous code works inside it). The **exit code** is the number the program hands back to the shell: `0` means success, anything else means failure. Set `process.exitCode = 1` to fail on purpose. Prefer that over `process.exit(1)`, which stops at once and may cut off output that was still being written.

### Three clocks, three jobs

| Clock | Unit and starting point | Can it jump? | Use it for |
|---|---|---|---|
| `Date.now()` | milliseconds since 1970 (the wall clock) | Yes, when the system clock is changed | Timestamps, "what time is it?" |
| `performance.now()` | milliseconds with decimals, since the program started | No | Measuring how long something took |
| `process.hrtime.bigint()` | nanoseconds from an arbitrary starting point, as a `BigInt` | No | Measuring very short times precisely |

Convert `hrtime.bigint()` differences with `Number(end - start) / 1e6` to get milliseconds. (`BigInt` and `Number` do not mix in arithmetic: convert first.) `console.time` (section 11) is the quick version of the same idea.

Also handy: `process.pid` (the id the OS gave this program), `process.uptime()` (seconds since start), `process.cpuUsage()` (`{ user, system }` CPU time in microseconds), `process.execPath` (where the `node` program lives), `process.versions` (versions of Node's parts such as `v8` and `openssl`) and `process.stdout.isTTY` (`true` for a terminal, `undefined` when output is piped; see lesson 15).

> **Common mistake:** `process.env.DEBUG = false` stores the **string** `"false"`, which is truthy. `if (process.env.DEBUG)` is then true. Always compare strings: `process.env.DEBUG === 'true'`. Also, Node itself ignores `NODE_ENV`. It is only a convention that libraries such as Express read.

> **Interview tip:** "What is the difference between `process.cwd()` and `__dirname`?" `cwd` changes with where you launch the program. `__dirname` is fixed by where the file is. Reading `./config.json` is relative to `cwd`, which is why scripts break when started from another folder.

## 5. url: parse and build URLs

A **URL** is a web address such as `https://ada:secret@example.com:8080/shop/items?color=red&size=m#reviews`. Node has the same `URL` and `URLSearchParams` classes that browsers have, and both are globals. Do not split URLs with string tricks or regular expressions: use `URL`. The parts, and the property that gives each one:

| Part | In the address above | Property |
|---|---|---|
| scheme (protocol) | `https:` | `url.protocol` |
| user name and password (rare, avoid) | `ada`, `secret` | `url.username`, `url.password` |
| host name | `example.com` | `url.hostname` |
| port | `8080` | `url.port` |
| path | `/shop/items` | `url.pathname` |
| query string: `key=value` pairs after `?`, joined by `&` | `?color=red&size=m` | `url.search`, `url.searchParams` |
| fragment (never sent to the server) | `#reviews` | `url.hash` |

`url.host` is the host name plus the port, and `url.origin` is the scheme plus host (`https://example.com:8080`). Example: `examples/07-url.js`.

```bash
node lessons/05-core-modules-tour/examples/07-url.js
```

The example prints every part. The output below is shortened to the lines that teach something new.

```text
--- the parts of a URL ---
host: example.com:8080 | hostname: example.com | port: 8080
origin: https://example.com:8080
default port is an empty string: ""
--- searchParams: read and change the query string ---
color = red
missing = null
after changes: https://ada:secret@example.com:8080/shop/items?color=blue#reviews
number of params: 1
```

What to notice:
- `url.host` includes the port, `url.hostname` does not. `url.port` is a **string**, and it is `""` when the port is the default one for the protocol (80 for http, 443 for https).
- `url.searchParams` is **live**: changing it changes `url.href`. `get` returns `null` for a missing key, not `undefined`.
- Never log a whole URL that can contain a user name and password.

### Build a URL, resolve a link, check a host

```text
--- build a URL safely ---
https://api.example.com/search?q=node+%26+npm&page=2
https://example.com/a/up
--- relative links: a trailing slash changes the answer ---
https://x.dev/a/d
https://x.dev/a/b/d
https://x.dev/d
--- never trust a URL with startsWith ---
startsWith: true | isOurSite: true | https://example.com/ok
startsWith: true | isOurSite: false | https://example.com.evil.net/login
startsWith: true | isOurSite: false | https://example.com@evil.net/
--- bad input throws; canParse checks first ---
TypeError ERR_INVALID_URL | input: not a url
canParse("https://x.dev"): true
canParse("not a url"): false
```

- To build a URL, use `new URL(path, base)` and `searchParams.set(...)`. The encoding (`&` becomes `%26`, space becomes `+`) is done for you, so user input cannot break out of its value.
- `new URL(link, base)` resolves a link the way a browser does. In `new URL('d', 'https://x.dev/a/b')` the last piece `b` counts as a file name and is replaced (`/a/d`). With a trailing slash (`/a/b/`) it is a folder and `d` goes inside (`/a/b/d`). A leading slash (`/d`) starts at the site root.
- `new URL('not a url')` throws a `TypeError` with `code: 'ERR_INVALID_URL'`. A URL without a scheme (`example.com`) or a relative one without a base (`/path`) throws too. Use `URL.canParse(text)` when you only need a yes or no.
- **Check the parsed host, never the text.** Suppose your site redirects to a `?next=` address the user supplies. If you only check `next.startsWith('https://example.com')`, an attacker passes `https://example.com.evil.net/login` (a different site whose name begins the same) or `https://example.com@evil.net/` (the text before `@` is a user name, so the real host is `evil.net`). This is called an **open redirect**. Parse with `new URL(next)` and compare `hostname` (or `origin`) with your own value, as `isOurSite` does.

### URLSearchParams on its own

```text
--- URLSearchParams on its own ---
getAll: [ 'a', 'b' ]
Object.fromEntries loses duplicates: { tag: 'b', sort: 'asc' }
from an object: q=a+b&n=1
encodeURIComponent uses %20: a%20b
```

- Duplicate keys: `getAll('tag')` gives every value, but `Object.fromEntries(params)` keeps only the last one.
- `URLSearchParams` writes a space as `+`, while `encodeURIComponent` writes `%20`. Both are valid in a query string.
- Every value you read is a string. Convert numbers yourself: `Number(params.get('page'))`.

### The legacy url.parse, and why to avoid it

```text
--- legacy url.parse: avoid it ---
query is a plain string: x=1&y=2
it never throws, even for garbage: not%20a%20url
--- file URLs and paths ---
protocol: file:
starts with file:/// true
round trip works: true
spaces are escaped: my%20file.txt
warning event -> DEP0169
```

`url.parse()` is the old, pre-browser-standard parser. Its own docs say its behavior "is not standardized and prone to errors that have security implications". It accepts garbage without complaint (`url.parse('not a url')` works), returns `query` as a plain string, and on Node 24 it prints the `DEP0169` warning. Calling `url.resolve()` or `url.format()` with a string runs `url.parse()` inside, so they are covered by the same warning. The whole old API (`url.parse`, `url.format`, `url.resolve`) is marked **Legacy**. The old `querystring` module is legacy too: use `URLSearchParams`.

The last output line is printed by the script's own `process.on('warning', ...)` listener, which runs after the rest of the script. Node also prints this to **stderr** (the number after `node:` is the process id and changes on every run):

```text
(node:23828) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead. CVEs are not issued for `url.parse()` vulnerabilities.
(Use `node --trace-deprecation ...` to show where the warning was created)
```

> **Remember:** `DEP0169` is an "application" deprecation: the runtime warning is meant for your own code, not for code inside `node_modules`. And it started in Node 24. On Node 22 and older it is only written in the docs, so the `warning event -> DEP0169` line does not appear there (the script still works).

### File URLs

An ES module's `import.meta.url` is a **file URL** (`file:///D:/www/app/index.mjs`), not a path. Two helpers convert between the two worlds: `url.pathToFileURL(path)` and `url.fileURLToPath(url)`. They also escape and unescape spaces (`my file.txt` becomes `my%20file.txt`). You need them for dynamic `import()` of an absolute path on Windows: `import('C:\\x.mjs')` fails with `ERR_UNSUPPORTED_ESM_URL_SCHEME` because `C:` looks like a URL scheme. Write `import(pathToFileURL('C:\\x.mjs').href)`.

> **Interview tip:** "How do you parse a query string?" `new URL(text, base).searchParams` (or `new URLSearchParams(text)`). Mention that `url.parse` and `querystring` are legacy, that `searchParams.get` returns strings only, and (to stand out) that you validate a user-supplied URL by comparing the parsed `hostname`, not with `startsWith`.

## 6. util (part 1): promisify, inspect, types and friends

`util` is the junk drawer of Node, in the good sense: a handful of small helpers that you use all the time. Example: `examples/05-util.js`.

```bash
node lessons/05-core-modules-tour/examples/05-util.js
```

### promisify and callbackify

Old Node code uses **error-first callbacks**: the last argument is a function `(err, result) => {}`. Modern code uses promises and `async/await`. `util.promisify` turns the first style into the second.

```js
function addLater(a, b, callback) { /* calls callback(err) or callback(null, sum) */ }
const addAsync = util.promisify(addLater);
console.log(await addAsync(2, 3)); // 5
```

`util.callbackify` goes the other way: it wraps an `async` function so old callback code can call it.

```text
--- promisify: callback style -> promise style ---
2 + 3 = 5
rejected with: numbers only
sleep resolved with: woke up
--- callbackify: promise style -> callback style ---
callback got: null 42
```

Gotchas to know:
- The function must take an error-first callback as its **last** argument. If it does not, the promise never settles.
- Most core modules already ship promise versions (`fs/promises`, `timers/promises`, `readline/promises`, `dns/promises`, `stream/promises`). Reach for `promisify` for **old libraries and your own old code**.
- If a promise rejects with a falsy value (`null`), `callbackify` wraps it in an error with `code: 'ERR_FALSY_VALUE_REJECTION'`, so the callback still gets a real error.

### How promisify works (and how to answer "write your own")

`promisify` returns a new function. When you call it, it creates a promise, calls the original function with your arguments plus a callback it made itself, and settles the promise from inside that callback. That is all:

```js
function myPromisify(fn) {
  return function (...args) {
    return new Promise((resolve, reject) => {
      fn.call(this, ...args, (err, value) => (err ? reject(err) : resolve(value))); // `this` kept for methods
    });
  };
}
```

```text
--- promisify: several results, and util.promisify.custom ---
keeps only the first result: first
with util.promisify.custom: { a: 'first', b: 'second' }
--- promisify written by hand (a classic interview question) ---
myPromisify: 4 + 5 = 9
myPromisify rejected with: numbers only
```

- A callback can receive several results (`callback(null, a, b)`), but a promise holds one value, so `promisify` keeps only the first. A function can ask for different treatment by setting `fn[util.promisify.custom]` to its own promise-returning function. That is how `setTimeout` works with `promisify` (`await sleep(5, 'woke up')` above) and how `child_process.exec` resolves to `{ stdout, stderr }`.
- The real `util.promisify` also checks that you passed a function, which the short version above leaves out.

### format and inspect

`util.format` is `printf` for strings (`printf` is a classic function that fills `%s` and `%d` placeholders in a template). `console.log` uses it, so `console.log('%s is %d', 'Ada', 36)` works.

| Code | Meaning |
|---|---|
| `%s` | string (any value is converted) |
| `%d`, `%i`, `%f` | number, integer, float. `util.format('%d', '42abc')` is `NaN`, `'%i'` of `'42.9abc'` is `42` |
| `%j` | JSON |
| `%o`, `%O` | object, with (`%o`) or without (`%O`) hidden details |
| `%%` | a literal percent sign (when more arguments follow) |

Extra arguments with no matching code are appended with spaces.

`util.inspect(value, options)` turns any value into the readable text that `console.log` prints. This answers a very common question: **why does my object print as `[Object]`?** Because `console.log` shows only 2 levels of nesting.

```js
const deep = { level1: { level2: { level3: { level4: 'deep' } } }, list: [1, 2, 3] };
console.log(deep);                                // depth 2: level3 is shown as [Object]
console.log(util.inspect(deep, { depth: null })); // no limit
console.log(util.inspect(deep, { depth: 0 }));
```

```text
--- format: printf-style strings ---
Ada is 36 years old
42 and 3.5
{"id":1,"tags":["a","b"]}
extra values are appended 7
NaN
--- inspect: turn any value into a readable string ---
{ level1: { level2: { level3: [Object] } }, list: [ 1, 2, 3 ] }
{
  level1: { level2: { level3: { level4: 'deep' } } },
  list: [ 1, 2, 3 ]
}
{ level1: [Object], list: [Array] }
"{ n: \u001b[33m1\u001b[39m }"
{ a: 1, b: 2 }
Money<$19.99>
```

- `colors: true` adds terminal color codes. The line with `\u001b` is `JSON.stringify` of the result, so you can see the invisible codes.
- `sorted: true` sorts the keys, `compact` and `breakLength` control line breaking. Long arrays are cut after 100 items (`maxArrayLength`).
- A class can control how it prints by adding a method named `[util.inspect.custom]`. That is how `new Money(1999)` printed `Money<$19.99>`.
- `console.dir(obj, { depth: null })` is the shortcut for the same thing. Note that `console.dir` ignores `[util.inspect.custom]`.

> **Interview tip:** "Why does `console.log(obj)` show `[Object]`?" The default `depth` is 2. Fix it with `console.dir(obj, { depth: null })`, `util.inspect(obj, { depth: null })` or `JSON.stringify(obj, null, 2)`. `JSON.stringify` drops functions and fails on circular data, `inspect` does not.

### types and isDeepStrictEqual

`util.types` has precise checks that `typeof` and `instanceof` cannot do: `isAsyncFunction`, `isPromise`, `isMap`, `isTypedArray`, `isRegExp`, `isProxy`. For example `typeof async () => {}` is just `'function'`, but `util.types.isAsyncFunction(...)` is `true`.

`util.isDeepStrictEqual(a, b)` compares two values by **content**, the way `assert.deepStrictEqual` does:

```text
--- types: checks that typeof and instanceof cannot do ---
async function: true | typeof says function
promise: true
Map: true
typed array: true
regexp: true
proxy: true
--- isDeepStrictEqual ---
same shape: true
1 vs "1": false
NaN vs NaN: true
0 vs -0: false
Point vs plain object: false
{a:1} === {a:1}: false
```

It is strict: `1` and `"1"` differ, `0` and `-0` differ, `NaN` equals `NaN`, and an instance of a class is **not** equal to a plain object with the same fields because their prototypes differ. `===` on two objects only checks that they are the very same object.

### Old util functions you may still see

| Old code | Status on Node 24 | Use instead |
|---|---|---|
| `util.isArray(x)`, `util._extend(a, b)` | work, but print `DEP0044` and `DEP0060` | `Array.isArray(x)`, `Object.assign(a, b)` |
| `util.isBoolean`, `util.isString`, `util.print`... | removed (`TypeError: not a function`) | `typeof x === 'boolean'`, `console.log` |
| `util.inherits(Child, Parent)` | works, marked Legacy | `class Child extends Parent` |

## 7. util (part 2): TextEncoder, parseArgs, styleText, deprecate

Example: `examples/06-util-extras.js`.

```bash
node lessons/05-core-modules-tour/examples/06-util-extras.js
```

```text
--- TextEncoder and TextDecoder: text <-> bytes (both are globals) ---
characters: 7 | bytes: 10
bytes: Uint8Array 104 195 169 108 108 111 32 226 130 172
decoded: héllo €
lenient decode: "hi�"
fatal decode throws: ERR_ENCODING_INVALID_ENCODED_DATA
--- parseArgs: read command line flags without a library ---
values: { name: 'Ada', verbose: true, count: '3', color: 'blue' }
positionals: [ 'input.txt' ]
count as a number: 3
unknown flag -> ERR_PARSE_ARGS_UNKNOWN_OPTION
--- styleText: colors without a library ---
This is green in a terminal
Bold and red
"\u001b[31mhi\u001b[39m"
--- deprecate: warn once when someone uses an old function ---
result
result
warning event -> DeprecationWarning [APP001]: oldHelper() is deprecated, use newHelper() instead
```

### TextEncoder and TextDecoder

Computers store text as **bytes** (numbers from 0 to 255). **UTF-8** is the standard way to write text as bytes. `new TextEncoder().encode(text)` gives the UTF-8 bytes (a `Uint8Array`, which is an array of bytes), and `new TextDecoder().decode(bytes)` turns bytes back into text. Note `'héllo €'` has 7 characters but 10 bytes: `é` takes 2 bytes and `€` takes 3. That difference is why `string.length` is **not** a byte size. By default a decoder replaces bad bytes with the replacement character; `{ fatal: true }` throws instead. Node's `Buffer` ([lesson 10](../10-buffers/README.md)) does the same job and is a `Uint8Array` too, but `TextEncoder` and `TextDecoder` work the same in browsers.

### parseArgs

`util.parseArgs` reads command line flags with no library. You describe each option (`type`, optional `short`, optional `default`) and get back `values` and `positionals` (the arguments that are not flags, such as `input.txt`). By default it reads `process.argv.slice(2)`; the example passes `args` itself so the result is fixed.

- Option values are strings or booleans, so convert numbers yourself (`Number(values.count)`).
- An unknown option throws `ERR_PARSE_ARGS_UNKNOWN_OPTION` (this strict mode is the default).
- `values` has no prototype (`[Object: null prototype]`). Spread it (`{ ...values }`) to print it nicely, and do not call `values.hasOwnProperty(...)`.
- `--count=3`, `--count 3` and short forms like `-v` all work.

### styleText

`util.styleText(format, text)` adds terminal colors and styles: `'red'`, `'green'`, `'bold'`, `'underline'`, or an array such as `['bold', 'red']`. Node 24.16 also accepts hex colors like `'#ff5733'` (check the docs of your version before relying on that). **Gotcha:** if the output is not a terminal (piped to a file, or the `NO_COLOR` variable is set), it returns the plain text on purpose. That is why the two lines above print without color in this README. Set `FORCE_COLOR=1` or pass `{ validateStream: false }` to force the codes, as the last line does.

### deprecate

`util.deprecate(fn, message, code)` wraps a function. The first call prints a `DeprecationWarning` to stderr, and later calls stay quiet. This is how libraries tell users "stop using this". Node's own flags work on your warnings too: `--no-deprecation` hides them, `--trace-deprecation` shows where they come from, and `--throw-deprecation` turns them into errors (useful in tests).

```text
(node:9316) [APP001] DeprecationWarning: oldHelper() is deprecated, use newHelper() instead
(Use `node --trace-deprecation ...` to show where the warning was created)
```

That is what appears on stderr, with a different process id on your machine. The `warning event` line in the block above comes from `process.on('warning', ...)`, which is also how you can collect warnings in tests.

### debuglog

`util.debuglog('myapp')` returns a log function that prints only when the environment variable `NODE_DEBUG` contains `myapp`. It is the switchable debug output that Node's own modules offer, and it costs almost nothing when switched off.

```js
const debuglog = require('node:util').debuglog('myapp');
debuglog('cache has %d items', 12); // silent unless NODE_DEBUG=myapp
```

```bash
NODE_DEBUG=myapp node app.js           # bash
$env:NODE_DEBUG="myapp"; node app.js   # PowerShell
```

With the variable set it prints a line such as `MYAPP 23496: cache has 12 items` (the number is the process id).

> **Interview tip:** "How do you read command line flags without a library, and when would you add one?" Strong answer: `util.parseArgs` matches `process.argv.slice(2)` against a description of the options and returns `values` and `positionals`; it throws on unknown flags and gives strings, so you convert numbers. Add a library such as commander when you need sub-commands, automatic `--help` text or heavy validation.

## 8. timers: run code later

Timers schedule a function to run later. They are globals, so no `require` is needed. A reminder from [lesson 01](../01-introduction/README.md): the **event loop** is Node's single main loop, which runs your code and then picks up whatever is ready next (a timer that is due, a file that finished reading). Example: `examples/08-timers.js`.

| Function | What it does | Cancel it with |
|---|---|---|
| `setTimeout(fn, ms, ...args)` | Runs `fn` once, after at least `ms` milliseconds | `clearTimeout(t)` |
| `setInterval(fn, ms, ...args)` | Runs `fn` again and again every `ms` milliseconds | `clearInterval(t)` |
| `setImmediate(fn, ...args)` | Runs `fn` on the next trip around the event loop, after the current work | `clearImmediate(i)` |

```bash
node lessons/05-core-modules-tour/examples/08-timers.js
```

```text
--- callbacks run later, in order of their delay ---
this line runs first (synchronous code)
what setTimeout returns: object (in a browser it is a number)
setImmediate: right after the current work
A: 20 ms
extra arguments: hello timer
interval tick 1
B: 60 ms
interval tick 2
interval tick 3
--- unref: a timer that does not keep the program alive ---
hasRef after unref: false
hasRef after ref: true
--- refresh: start the countdown again (the idea behind debounce) ---
fired after about 80 ms, not 50: true
--- timers/promises: await instead of callbacks ---
sleep gives back its value: done
cancelled sleep -> AbortError ABORT_ERR
async interval round 1
async interval round 2
async interval round 3
--- setImmediate as a polite pause in heavy work ---
chunks done, items handled: 3000
```

What to notice:
- Your own code always finishes first. Timers run **later**, even `setTimeout(fn, 0)`. A delay of `0` is treated as `1`.
- The delay is a **minimum**, not a promise. If the event loop is busy, the callback runs late. Order follows the due time, so `A: 20 ms` runs before `B: 60 ms` although B was scheduled first.
- Extra arguments after the delay are passed to the callback (`'hello'`, `'timer'`).
- In Node, `setTimeout` returns a `Timeout` **object**, not a number as in browsers. `clearTimeout` on a timer that already fired, or on `undefined`, is harmless.
- A repeating interval must be stopped (`clearInterval`), here from inside its own callback. If your callback is `async` and takes longer than the interval, runs can overlap. Intervals can also drift: do not use them as an exact clock.
- Delays above 2147483647 ms (about 24.8 days) overflow: Node prints `TimeoutOverflowWarning` and uses 1 ms.

> **Under the hood:** Node does not run one real timer per `setTimeout`. It keeps timers with the same delay together in one list (in creation order) and only keeps a real timer running for the list that is due soonest. That is why thousands of timers with the same delay are cheap.

### ref and unref: what keeps Node alive

A pending timer normally keeps the program alive. `timer.unref()` says "do not wait for this one": if nothing else is left to do, the program exits and the timer never fires. `timer.ref()` reverses it and `timer.hasRef()` tells you. Use `unref` for housekeeping work such as a metrics heartbeat that must not block shutdown. In the example the 1-second interval is unref'd, so the script ends right after its last real work instead of looping forever.

This answers a favourite question, "what keeps a Node program running?". A program stays alive while something is registered with the event loop: a pending timer, an open server or socket, a running child program, an unfinished file or network request. A promise that is merely waiting does **not** count. A script whose only remaining work is a promise that nobody will ever settle simply exits (with code 0 in CommonJS).

### refresh

`timer.refresh()` restarts the countdown of a timer that has not fired yet, without creating a new one. In the example a 50 ms timer is refreshed at 30 ms, so it fires at about 80 ms. That is the heart of a **debounce**: "run this only after 50 ms of quiet", where every new event refreshes the timer.

### timers/promises

`require('node:timers/promises')` gives promise versions: `setTimeout(ms, value)` resolves after the delay (so `await sleep(100)` is a pause), `setImmediate(value)`, and `setInterval(ms)` which is an **async iterator**: something you loop over with `for await`, getting one value at a time and waiting between values. Leaving the loop with `break` stops the interval. The loop body always runs to its end before the next round starts, so your rounds cannot overlap the way async `setInterval` callbacks can.

To cancel a pending wait, pass `{ signal }` from an `AbortController`. An `AbortController` is a switch: you hand its `signal` to an operation, and calling `controller.abort()` tells that operation to stop. The cancelled wait rejects with `AbortError` (as in the output above). Pass `{ ref: false }` to make a promise timer unref'd.

`await setImmediate()` is also a way to give other work a turn between chunks of a long job, but real CPU-heavy work belongs in a worker thread ([lesson 18](../18-worker-threads-and-cluster/README.md)).

### Which one runs first? The short version

| Tool | Runs when |
|---|---|
| `process.nextTick(fn)` | Right after the current operation, before promise callbacks (in CommonJS code; at the top level of an ES module the order is reversed) |
| `promise.then(fn)`, `queueMicrotask(fn)` | Right after that, still before any timer or I/O callback |
| `setTimeout(fn, 0)` | In a later turn of the loop, after at least 1 ms |
| `setImmediate(fn)` | In a later turn, right after the input/output step |

The [event loop lesson](../08-event-loop/README.md) walks through the loop turn by turn.

> **Interview tip:** "`setTimeout(fn, 0)` or `setImmediate(fn)`: which runs first?" Strong answer: in the main script it is **not guaranteed** (on a Windows 11 machine with Node 24 `setImmediate` ran first in 273 of 300 runs of a script with just those two calls, while many tutorials show the timer first; do not rely on either). Inside an I/O callback `setImmediate` always runs first. And "what keeps Node alive?": things registered with the event loop (timers, sockets, servers, child programs), not a waiting promise.

## 9. readline: ask questions and read line by line

`readline` reads text one **line** at a time from any readable stream. A **stream** is data that arrives in small pieces over time, such as a file being read or keys being typed ([lesson 11](../11-streams/README.md)). Two common jobs: ask the user something in the terminal, and read a big file (or piped input) without loading it all into memory. Use the promise version, `require('node:readline/promises')`.

### Asking questions

Example: `examples/09-readline.js`. A real keyboard cannot be run by an automatic checker, so the first part uses a pretend keyboard (a `PassThrough` stream we write to) and a pretend screen. The code that talks to `readline` is exactly what you would write with `process.stdin` and `process.stdout`.

```js
// inside an async function
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const name = await rl.question('Your name? ');
rl.close(); // always close, or the program waits for more input
```

`rl.question(text, { signal })` also accepts an `AbortController` signal, so a question can give up (for example after a timeout) and reject with `AbortError`.

### Reading a file line by line

```js
// inside an async function
const rl = readline.createInterface({
  input: fs.createReadStream(file),
  crlfDelay: Infinity, // treat \r\n as ONE line break
});
for await (const line of rl) {
  // one line at a time, the whole file is never in memory
}
```

```bash
node lessons/05-core-modules-tour/examples/09-readline.js
```

```text
--- 1. prompting (the keyboard and screen are pretend) ---
[screen shows] "Your name? "
[screen shows] "Your age? "
Hello Ada, next year you will be 37.
--- 1b. a question that gives up (AbortController) ---
no answer -> AbortError
--- 2. reading a file line by line ---
1: first line
2: second line
4: last line without newline
total lines read: 4
```

Why this output:
- `question` writes the prompt to the output and resolves with what the user typed. **Answers are always strings**: convert with `Number(...)`.
- The test file has Windows line endings and a blank line (line 3, which the loop skips) and no newline after the last line. All four lines are still found.
- `crlfDelay: Infinity` matters for files with `\r\n`. By default (100 ms) a `\r` and `\n` that arrive far apart count as two breaks. Documented advice for reading files is to set `Infinity`.

For a human at a keyboard, run `examples/10-readline-prompt.js` yourself (it asks for your name, then adds up numbers until you press Enter). It is marked `@manual` so the automatic checker skips it.

```bash
node lessons/05-core-modules-tour/examples/10-readline-prompt.js
```

> **Common mistake:** Piping text into a script that calls `rl.question` in a loop (`echo a | node script.js`). Lines that arrive before `question` is called are lost, and the input ends. For piped input read every line with `for await (const line of rl)`. Also, create the interface and start the `for await` loop **without an `await` in between**, or lines can be missed (this is stated in the docs).

Other bits:
- The older callback form is `require('node:readline')` with `rl.on('line', fn)` and `rl.on('close', fn)`. Its `createInterface` also supports `for await`, which is what the Try-it task below uses. The main difference between the two modules is `rl.question`: it takes a callback in `readline` and returns a promise in `readline/promises`.
- Pressing Ctrl+C (when you did not register a `'SIGINT'` listener) closes the interface. Ctrl+D ("end of input") is the Linux and macOS habit and was not tested on Windows here, so use Ctrl+C there.
- If you leave a `for await` loop early with `break`, `readline` closes the interface for you. The `'close'` event is the place for cleanup.
- Other ways to read standard input, and how to tell a person from a pipe (`process.stdin.isTTY`), are in [lesson 15](../15-processes-and-cli/README.md).

> **Interview tip:** "How would you process a 5 GB log file?" Strong answer: stream it. `readline` over `fs.createReadStream` keeps only a small chunk and the current line in memory, so memory use stays flat. `readFile` plus `split('\n')` would load everything first, and Node cannot even hold a string longer than about 512 million characters (`buffer.constants.MAX_STRING_LENGTH` is 536870888 on Node 24).

## 10. assert: check that things are true

`assert` throws an `AssertionError` when a check fails. Use it for quick checks in scripts, for impossible situations ("this can never be null"), and in tests. Always import the **strict** version:

```js
const assert = require('node:assert/strict'); // same as require('node:assert').strict
```

The old default (`require('node:assert')`) is in **legacy mode**: `assert.equal(1, '1')` passes because it uses `==`. In strict mode `assert.equal` is the same as `assert.strictEqual`, and `assert.deepEqual` is the same as `assert.deepStrictEqual`.

Example: `examples/11-assert-and-console.js` (the assert half). The helper `attempt()` catches the error so the script can keep going.

```bash
node lessons/05-core-modules-tour/examples/11-assert-and-console.js
```

The example prints more checks than are shown here. The output below is shortened (the diff layout can also differ between Node versions):

```text
=== assert ===
legacy assert.equal(1, "1") passed (loose ==)
strict equal(1, "1"): AssertionError [ERR_ASSERTION]
message: "Expected values to be strictly equal:\n\n1 !== '1'\n"
actual: 1 | expected: 1 | operator: strictEqual

--- deepStrictEqual compares inside objects and arrays ---
same data: passed
different data: AssertionError [ERR_ASSERTION]
Expected values to be strictly deep-equal:
+ actual - expected

  {
    a: 1,
    list: [
      1,
+     2
-     3
    ]
  }

--- throws: check that code fails the way you expect ---
by class: passed
wrong class: AssertionError [ERR_ASSERTION]
nothing thrown: AssertionError [ERR_ASSERTION]
--- rejects: the same idea for promises (always await it) ---
rejects: passed
rejects (but it resolved): Missing expected rejection.
```

In the diff, a line starting with `+` comes from the actual value and a line starting with `-` from the expected one.

| Check | Use it for |
|---|---|
| `assert.ok(value)` / `assert(value)` | value is truthy |
| `assert.equal(a, b)` | strict equality, for primitives (strict mode) |
| `assert.deepStrictEqual(a, b)` | objects, arrays, Maps, Sets compared by content, with prototypes |
| `assert.throws(fn, expected)` | `fn` must throw. `expected` can be a class, a regex, an object of properties, or a function that returns `true` |
| `await assert.rejects(promise, expected)` | the promise must reject |
| `assert.match(text, regex)` | text must match |
| `assert.notEqual`, `assert.notDeepStrictEqual` | the opposite checks |

Gotchas:
- A failed assertion has `err.code === 'ERR_ASSERTION'`, plus `actual`, `expected` and `operator`. Uncaught, it ends the program with exit code 1.
- `assert.rejects(...)` returns a promise. If you forget `await`, a failure becomes an unhandled rejection instead of a clear error.
- The second argument of `assert.throws` is the **expected error**. If you pass a string it is treated as the failure **message** instead, and if that string equals the thrown message Node throws `ERR_AMBIGUOUS_ARGUMENT`. Use a regex or an object.
- `assert` is not removed in production builds as in some languages. Do not use it to validate user input: throw a proper error for that.

> **Interview tip:** "What is the difference between `assert.equal` and `assert.strictEqual`?" In legacy mode `equal` uses `==`. Say that you always use the strict module, where both are strict, and that for objects you need `deepStrictEqual` because `===` compares identity, not content. The test runner (`node:test`, [testing lesson](../16-testing/README.md)) uses this same module.

## 11. console: print things well

You already know `console.log`. The rest of `console` is worth five minutes. Example: `examples/11-assert-and-console.js` (the console half). A program has two output channels: **stdout** (standard output, for results) and **stderr** (standard error, for problems). `console.error`, `console.warn` and `console.assert` write to stderr, the others to stdout. A terminal shows both. The output below is shortened: the example also prints a second table with only the `name` column.

```text
=== console ===
cart has 3 items costing {"total":9.5}
--- table ---
┌─────────┬─────────┬─────┬────────────┐
│ (index) │ name    │ age │ city       │
├─────────┼─────────┼─────┼────────────┤
│ 0       │ 'Ada'   │ 36  │ 'London'   │
│ 1       │ 'Linus' │ 55  │ 'Helsinki' │
└─────────┴─────────┴─────┴────────────┘
--- group (indent) ---
Request 42
  validating
  Database
    query ok
  done
--- count ---
default: 1
default: 2
cache hit: 1
default: 1
--- dir: choose the depth ---
{ a: [Object] }
{
  a: { b: { c: { d: 'bottom' } } }
}
--- time (the numbers change on every run) ---
work: 4.791ms halfway, n = 499999500000
work: 5.045ms
--- stderr and assert ---
console.error writes to stderr
console.warn also writes to stderr
Assertion failed: math is broken
still running after a failed console.assert
```

| Function | Use |
|---|---|
| `console.table(rows, columns?)` | Array of objects (or an object) as a table. Great for quick looks at data. The second argument picks columns. |
| `console.group(label)` / `console.groupEnd()` | Indent everything in between by two spaces. Groups can nest. |
| `console.count(label?)` / `console.countReset(label?)` | Count how often a line runs. The default label is `default`. |
| `console.dir(obj, { depth })` | Like `log` for one object, with control over depth (`depth: null` is unlimited). |
| `console.time(label)`, `timeLog`, `timeEnd` | Stopwatch. `timeLog` prints without stopping, `timeEnd` prints and stops. |
| `console.error`, `console.warn` | Write to **stderr** instead of stdout. |
| `console.assert(condition, ...message)` | Prints `Assertion failed: ...` to stderr when the condition is false. **It does not throw.** |
| `console.trace(label?)` | Prints the label and the current call stack (the chain of function calls that led here) to stderr. |

The box-drawing table layout shown above is from Node 24; other Node versions may align the cell text differently, so do not compare table output in tests.

Why the two channels matter: a user can separate results from problems. `node script.js > out.txt 2> err.txt` works in bash, cmd and PowerShell 7 and sends the two streams to two files.

> **Common mistake:** Thinking `console.assert` stops the program like `assert.ok`. It only prints. Also, `console.log('Result: ' + obj)` prints `Result: [object Object]`. Pass the object as a separate argument: `console.log('Result:', obj)`.

> **Interview tip:** "Is `console.log` fine for production logging?" Strong answer: fine for scripts and quick debugging, but a service needs a logging library (for example pino or winston) for levels, timestamps and one JSON object per line that tools can search. Write logs to stdout or stderr and let the platform collect them, use `console.error`-style output for errors, and never log secrets such as passwords or full URLs with credentials.

## 12. zlib: compress and decompress

`zlib` squeezes data to make it smaller and expands it back. It supports **gzip** (the `.gz` format and the usual `Content-Encoding: gzip` in HTTP), **deflate** (the compression method gzip is built on, with a smaller wrapper around the data; `zlib.deflateRaw` has no wrapper at all) and **brotli** (often smaller for text, used as `Content-Encoding: br`). It does not read or write `.zip` archives. In HTTP the client lists what it understands in an `Accept-Encoding` header, and the server answers with the `Content-Encoding` it picked. Example: `examples/12-zlib.js` (it also round-trips deflate and brotli, which the shortened output below leaves out).

```bash
node lessons/05-core-modules-tour/examples/12-zlib.js
```

```text
--- gzip and gunzip a string (sync) ---
original bytes: 3000
gzip is smaller: true
gzip bytes (can differ between zlib versions): 75
first two bytes (gzip magic number): 1f8b
round trip equals the original: true
--- async version (does not block the event loop) ---
async result: hello hello hello hello
--- errors ---
bad input -> Z_DATA_ERROR | incorrect header check
--- limit the output when the input is untrusted ---
compressed is tiny: true
refused to expand -> ERR_BUFFER_TOO_LARGE
--- a file through a stream pipeline (gzip, then gunzip) ---
packed file is smaller: true
copy is identical: true
```

The core of it:

```js
const zipped = zlib.gzipSync('hello '.repeat(1000)); // string in, Buffer out
const text = zlib.gunzipSync(zipped).toString('utf8'); // Buffer in, then back to a string
```

- Every gzip file starts with the two bytes `1f 8b`. Repetitive text shrinks a lot (in the example output above, 3000 bytes became 75; the exact number can differ with the zlib version). Already compressed data (JPEG, MP4, `.zip`) will not shrink. Compress text-like data: JSON, HTML, CSS, JavaScript, logs.
- Every call comes in three styles: **sync** (`gzipSync`, simple but blocks the event loop), **callback** (`zlib.gzip(data, cb)`, runs on the libuv thread pool) and **stream** (`zlib.createGzip()`, for big data). Use sync only in scripts and small data. In a server use the callback form (wrapped with `util.promisify` if you like `await`, as the example does) or streams.
- Bad input throws with a code such as `Z_DATA_ERROR`.
- **Security:** a tiny compressed file can expand to gigabytes (a "zip bomb"). When the input comes from outside, set `maxOutputLength`. Above, one megabyte of zeros compresses to a few KB, and `{ maxOutputLength: 1000 }` makes the decompression fail with `ERR_BUFFER_TOO_LARGE` instead of eating memory.
- For files, connect streams with `pipeline` (from `stream/promises`): read stream, `createGzip()`, write stream. Streams get their own lesson. Zstandard (`zlib.zstdCompressSync`) also exists on Node 24 but is marked experimental.

> **Under the hood:** libuv is the C library behind Node's event loop. It keeps a **thread pool**: a small group of helper threads (4 by default) that do slow jobs so the main thread does not wait. The callback and stream forms of zlib run there, which is why they do not block the event loop. It is also why many compressions at once queue up: the same pool serves file system calls, `dns.lookup` and some `crypto` functions.

> **Interview tip:** "How would you compress an HTTP response or a 2 GB log file?" Streams: `pipeline(fs.createReadStream(file), zlib.createGzip(), fs.createWriteStream(file + '.gz'))`. Never `readFileSync` plus `gzipSync` for big data: it holds everything in memory and blocks the loop.

## 13. Modules that have their own lessons

These core modules are big enough to deserve a full lesson. Do not try to learn them from this page.

| Module | What it is for | Lesson |
|---|---|---|
| `fs`, `fs/promises` | Files and folders | [06. The File System](../06-file-system/README.md) |
| `timers`, `process.nextTick`, the event loop | The order in which things run | [08. The Event Loop](../08-event-loop/README.md) |
| `events` | `EventEmitter`, the base of much of Node | [09. Events](../09-events/README.md) |
| `buffer` | Raw bytes | [10. Buffers](../10-buffers/README.md) |
| `stream` | Data in small pieces, backpressure | [11. Streams](../11-streams/README.md) |
| `http`, `https`, `net`, `dns` | Servers and clients | [12. HTTP and Networking](../12-http-and-networking/README.md) |
| `process` signals, exit codes, `child_process` | Running other programs, shutting down cleanly | [15. Processes and CLI](../15-processes-and-cli/README.md) |
| `node:test` | The built-in test runner | [16. Testing](../16-testing/README.md) |
| `worker_threads`, `cluster` | Using more than one CPU core | [18. Worker Threads and Cluster](../18-worker-threads-and-cluster/README.md) |
| `perf_hooks` | Precise measuring | [19. Performance and Memory](../19-performance-and-memory/README.md) |
| `crypto` | Hashes, random values, encryption | [20. Security and Crypto](../20-security-and-crypto/README.md) |

## 14. Which module do I need for X?

| I want to... | Use | Note |
|---|---|---|
| Join, split or compare file paths | `path` | Never build paths with `+` |
| Know the OS, CPU count, memory, temp folder | `os` | `os.availableParallelism()` for pool sizes |
| Read command line arguments | `process.argv`, or `util.parseArgs` for flags | Everything is a string |
| Read settings from the environment | `process.env` | Values are strings, so convert |
| Load a `.env` file | `node --env-file=.env app.js` | [Lesson 15](../15-processes-and-cli/README.md), no library needed |
| Know where my script is | `__dirname` (CJS), `import.meta.dirname` (ESM) | Not `process.cwd()` |
| Measure how long something took | `performance.now()`, `process.hrtime.bigint()` or `console.time` | `Date.now()` is fine for coarse times |
| Turn a callback API into a promise | `util.promisify` | Error-first callbacks only |
| Print an object fully | `util.inspect(obj, { depth: null })` or `console.dir` | |
| Compare two objects by content | `util.isDeepStrictEqual`, `assert.deepStrictEqual` | |
| Colored terminal text | `util.styleText` | Auto-disables when piped |
| Warn users about an old function | `util.deprecate` | Warns once |
| Parse or build a URL or query string | `URL`, `URLSearchParams` | Not `url.parse` or `querystring` |
| Check that a URL points to my site | `new URL(text).hostname` | Not `startsWith` |
| Convert a path to a `file://` URL and back | `url.pathToFileURL`, `url.fileURLToPath` | Needed for `import()` on Windows |
| Run code later or repeatedly | `setTimeout`, `setInterval` | `unref()` if it must not keep Node alive |
| `await` a pause | `timers/promises` | Cancel with `AbortSignal` |
| Ask the user questions in the terminal | `readline/promises` | `rl.close()` when done |
| Read a big file or piped input by line | `readline` + `for await` | Use `crlfDelay: Infinity` |
| Quick checks in scripts and tests | `assert/strict` | Not for validating user input |
| Print tables, groups, timings, stderr | `console` | |
| Compress or decompress | `zlib` | Streams for big data, `maxOutputLength` for untrusted input |
| Text to bytes and back | `TextEncoder`, `TextDecoder`, or `Buffer` | |
| Copy an object deeply | `structuredClone` (global) | Not for functions or class instances |
| Make an HTTP request | global `fetch` | [Lesson 12](../12-http-and-networking/README.md) |
| Run another program | `child_process` | [Lesson 15](../15-processes-and-cli/README.md) |
| Hash, random IDs, encryption | `crypto` | [Lesson 20](../20-security-and-crypto/README.md) |
| Files and folders | `fs` | [Lesson 06](../06-file-system/README.md) |

## Summary / Key takeaways
- Core modules ship inside Node. Load them with the `node:` prefix (`require('node:path')`). Some, like `node:test`, only exist with it.
- Use `path` for every file path: `join` glues and cleans, `resolve` returns an absolute path. Use `path.posix` for URLs. Guard user-supplied paths against `../` traversal.
- `process.argv` starts at index 2 for your arguments; `process.env` values are always strings; `__dirname` is the file's folder while `process.cwd()` is where you launched. Measure time with `performance.now()` or `hrtime.bigint()`, not `Date.now()`.
- Use `new URL()` and `URLSearchParams`, never `url.parse` (it prints a deprecation warning on Node 24). Check a user-supplied URL by its parsed `hostname`, never with `startsWith`.
- `util.promisify` turns error-first callbacks into promises (and is easy to write by hand), `util.inspect` and `console.dir` fix the `[Object]` problem, `util.parseArgs` and `util.styleText` replace small libraries.
- Timers run later and the delay is a minimum. `unref()` stops a timer from keeping the program alive, and a waiting promise never keeps Node alive. `timers/promises` gives you `await sleep(ms)`.
- `readline` with `for await` reads big files line by line; set `crlfDelay: Infinity`. Use `rl.question` only for a human at a keyboard.
- Import `node:assert/strict`. `console.assert` only prints; `assert` throws. Use `zlib` streams for big data and `maxOutputLength` for untrusted input.

## Quick check

1. What do `path.join('/a', '/b')` and `path.resolve('/a', '/b')` return on Linux?
<details><summary>Answer</summary>

`join` returns `/a/b` because it only glues the pieces together and cleans the result. `resolve` returns `/b` because it works from right to left and stops as soon as it has an absolute path.

</details>

2. You set `DEBUG=false` in the environment. Why does `if (process.env.DEBUG)` still run the debug code?
<details><summary>Answer</summary>

Environment values are always strings, and `"false"` is a non-empty string, so it is truthy. Compare explicitly: `process.env.DEBUG === 'true'`.

</details>

3. What kind of function can `util.promisify` convert, and how would you write it yourself?
<details><summary>Answer</summary>

A function whose last argument is an error-first callback `(err, result) => {}`. Your own version returns a function that creates a `new Promise` and calls the original with your arguments plus a callback that runs `reject(err)` or `resolve(value)`. If the callback passes several results, only the first is kept unless the function has a custom form (`util.promisify.custom`).

</details>

4. `console.log(obj)` prints `{ a: { b: { c: [Object] } } }`. Name two ways to see the whole object.
<details><summary>Answer</summary>

The default `depth` is 2. Use `console.dir(obj, { depth: null })` or `util.inspect(obj, { depth: null })`. `JSON.stringify(obj, null, 2)` also works for plain data.

</details>

5. You are building the path part of an API URL, `/api/users/42`, on Windows. Why not use `path.join`?
<details><summary>Answer</summary>

On Windows `path.join` joins with backslashes and gives `\api\users\42`. URL paths always use forward slashes, so use `path.posix.join('/api', 'users', '42')` or build the address with `new URL(...)`.

</details>

6. What does `timer.unref()` do? And does a promise that is still pending keep a Node program alive?
<details><summary>Answer</summary>

`unref()` tells Node not to wait for that timer: if nothing else is keeping the program alive, the program exits and the callback never runs. It suits background housekeeping such as a heartbeat. `timer.ref()` undoes it. A pending promise does not keep Node alive: only things registered with the event loop do (timers, open sockets and servers, child programs, unfinished file requests).

</details>

7. Why is `url.parse()` avoided, and how do you safely check that a user-supplied address belongs to your own site?
<details><summary>Answer</summary>

`url.parse` is a legacy, non-standard parser that accepts garbage silently, and on Node 24 it prints deprecation warning `DEP0169`. For the check, parse with `new URL(text)` and compare `.hostname` (or `.origin`) with your own value. `text.startsWith('https://example.com')` is fooled by `https://example.com.evil.net` and by `https://example.com@evil.net/`.

</details>

8. How do you process a 5 GB log file line by line without running out of memory?
<details><summary>Answer</summary>

Create a read stream and give it to `readline`: `readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })`, then `for await (const line of rl)`. Only small chunks are in memory at any time. Do not put an `await` between creating the interface and starting the loop.

</details>

9. What is the difference between `assert.equal(1, '1')` in legacy mode and in strict mode? And how does `console.assert` differ from `assert.ok`?
<details><summary>Answer</summary>

In legacy mode `equal` uses `==` so it passes; in strict mode (`require('node:assert/strict')`) it uses strict equality and throws an `AssertionError`. `console.assert(false, 'msg')` only prints `Assertion failed: msg` to stderr and the program continues. `assert.ok(false)` throws.

</details>

10. Why is `zlib.gunzipSync(userUpload)` risky in a web server, and what are the safer choices?
<details><summary>Answer</summary>

It blocks the event loop while it works, and a small malicious file can expand to a huge size (a zip bomb) and use all memory. Use the callback version (wrapped with `util.promisify` if you like) or streams, which run on the thread pool, and pass `maxOutputLength` to cap the result.

</details>

## Try it yourself

### Task 1 (easy): path helpers
Write `swapExtension(file, newExt)` so `swapExtension('reports/jan.csv', '.json')` returns the same path with the new extension, and `describe(file)` so `describe('/srv/app/logs/server.log')` returns `{ folder: 'logs', name: 'server', ext: '.log' }`. Use only the `path` module for the logic.

<details><summary>Hint</summary>

`path.parse(file)` gives you `dir`, `name` and `ext`. For the folder name, take the `basename` of the `dir`. Build the new path with `path.join(dir, name + newExt)`.

</details>

<details><summary>Solution</summary>

```js
const path = require('node:path');
const assert = require('node:assert/strict');

function swapExtension(file, newExt) {
  const { dir, name } = path.parse(file);
  return path.join(dir, name + newExt);
}

function describe(file) {
  const { dir, name, ext } = path.parse(file);
  return { folder: path.basename(dir), name, ext };
}

assert.equal(swapExtension('reports/jan.csv', '.json'), path.join('reports', 'jan.json'));
assert.equal(swapExtension('notes.txt', '.md'), 'notes.md');
assert.deepStrictEqual(describe('/srv/app/logs/server.log'), { folder: 'logs', name: 'server', ext: '.log' });
console.log(swapExtension('reports/jan.csv', '.json'));
console.log(describe('/srv/app/logs/server.log'));
console.log('task 1 passed');
```

On Windows this prints `reports\jan.json`, on Linux and macOS `reports/jan.json`, then `{ folder: 'logs', name: 'server', ext: '.log' }` and `task 1 passed`.

</details>

### Task 2 (medium): a line statistics tool
Write `linestats.js`: `node linestats.js --file notes.txt` prints how many lines the file has, how many are blank, and the longest line with its line number. Read flags with `util.parseArgs` and the file with `readline`. If `--file` is missing or the file does not exist, print a message to stderr and end with exit code 1. Without any argument, your script may analyze its own file so it runs on its own.

<details><summary>Hint</summary>

`parseArgs({ args, options: { file: { type: 'string' } } })` gives `values.file`. Build the reader as in section 9, with `crlfDelay: Infinity`. Check the file first with `await fs.promises.access(file)` inside a `try/catch`. Return the exit code from `main` and set `process.exitCode`.

</details>

<details><summary>Solution</summary>

```js
// linestats.js: count lines in a file.   Usage: node linestats.js --file notes.txt
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { parseArgs } = require('node:util');

async function analyze(file) {
  const rl = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity, // count \r\n as one line break
  });
  let total = 0;
  let blank = 0;
  let longest = { number: 0, text: '' };
  for await (const line of rl) {
    total++;
    if (line.trim() === '') blank++;
    if (line.length > longest.text.length) longest = { number: total, text: line };
  }
  return { total, blank, longest };
}

// Returns the exit code the program should use.
async function main(args) {
  const { values } = parseArgs({ args, options: { file: { type: 'string', short: 'f' } } });
  if (!values.file) {
    console.error('Usage: node linestats.js --file <path>');
    return 1;
  }
  try {
    await fs.promises.access(values.file);
  } catch {
    console.error(`Cannot read ${values.file}`);
    return 1;
  }
  const stats = await analyze(values.file);
  console.log(`${path.basename(values.file)}: ${stats.total} lines, ${stats.blank} blank`);
  console.log(`longest is line ${stats.longest.number}: ${stats.longest.text.trim()}`);
  return 0;
}

// With no arguments, analyze this script itself so the file runs on its own.
const args = process.argv.slice(2);
main(args.length > 0 ? args : ['--file', __filename]).then((code) => {
  process.exitCode = code;
});
```

Run with no arguments it analyzes itself and prints two lines, the first like `linestats.js: 46 lines, 3 blank` (your counts depend on how you typed it). With `--file nope.txt` it prints `Cannot read nope.txt` to stderr and the exit code is 1.

</details>

### Task 3 (harder): retry a flaky callback function
You have an old callback-style function `flakyLookup(id, callback)` that fails twice and then works. Turn it into a promise function with `util.promisify`. Then write `retry(fn, { attempts, delayMs })` that calls `fn`, and if it throws waits `delayMs` (with `timers/promises`) and tries again, up to `attempts` times. After the last failure it throws the last error and does not wait again. Check your work with `assert`: success after 3 calls, and a rejection when the function always fails.

<details><summary>Hint</summary>

Use a `for` loop from 1 to `attempts`. Inside, `try { return await fn(attempt); } catch (err) { lastError = err; }`. Only `await sleep(delayMs)` if this was not the last attempt. After the loop, `throw lastError`. For the rejection test use `await assert.rejects(retry(...), /message/)`.

</details>

<details><summary>Solution</summary>

```js
const assert = require('node:assert/strict');
const { promisify } = require('node:util');
const { setTimeout: sleep } = require('node:timers/promises');

// A flaky callback-style function: it fails twice, then works.
let calls = 0;
function flakyLookup(id, callback) {
  setTimeout(() => {
    calls++;
    if (calls < 3) return callback(new Error(`temporary failure ${calls}`));
    callback(null, { id, name: 'Ada' });
  }, 5);
}
const lookup = promisify(flakyLookup);

async function retry(fn, { attempts = 3, delayMs = 10 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt < attempts) await sleep(delayMs); // no pause after the last failure
    }
  }
  throw lastError;
}

async function main() {
  const user = await retry(() => lookup(7), { attempts: 3, delayMs: 10 });
  assert.deepStrictEqual(user, { id: 7, name: 'Ada' });
  assert.equal(calls, 3);

  await assert.rejects(
    retry(() => Promise.reject(new Error('always broken')), { attempts: 2, delayMs: 1 }),
    /always broken/
  );
  console.log('all checks passed');
}

main();
```

It prints `all checks passed`. A real project would also add a growing delay (exponential backoff) and only retry errors that are worth retrying.

</details>

## Where to go next
- Next lesson: [06. The File System (fs)](../06-file-system/README.md). You now know `path`, `os` and `readline`, which is most of what you need around file work.
- Practise this topic in the interview rounds: [Round 1: Screening](../../rounds/round-1-screening/questions.md) for the quick questions (`join` vs `resolve`, `cwd` vs `__dirname`, `process.env`), [Round 2: Core](../../rounds/round-2-core/questions.md) for deeper ones, and [Round 3: Coding](../../rounds/round-3-coding/questions.md) for tasks like the three above.
- Come back to `timers` after the [event loop lesson](../08-event-loop/README.md), and to `zlib` after the [streams lesson](../11-streams/README.md). Standard input, exit codes and `.env` files are covered in [lesson 15](../15-processes-and-cli/README.md).
