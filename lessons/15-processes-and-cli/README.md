# 15. Processes, Signals, child_process and Building CLIs

> Level: Intermediate   Time: about 150 minutes   Node: 24 (notes where older versions differ)

[Previous: 14. Error Handling and Debugging](../14-error-handling-and-debugging/README.md) | [All lessons](../../README.md) | [Next: 16. Testing Node.js Code](../16-testing/README.md)

## What you will learn
- What a process is, and what the `process` object tells you: arguments, environment variables, working directory, time, memory, CPU and the three standard streams
- How environment variables really work (they are all strings) and how to load `.env` files with `--env-file` and `process.loadEnvFile`
- Exit codes: the 0, 1, 2 and 128+N conventions, and why `process.exitCode` is safer than `process.exit()`
- Signals (`SIGINT`, `SIGTERM`, `SIGKILL`), how Ctrl+C works, graceful shutdown, and what is different on Windows
- `child_process`: `exec`, `execFile`, `spawn` and `fork`, plus the sync versions, and when to use which (including the command injection risk)
- Streaming a child's output, piping processes together, what happens when the reader of a pipe leaves early (`EPIPE`), and sending messages with `fork`
- Reading standard input, line by line with `readline`
- Building a real command line tool: shebang, `bin` in `package.json`, `util.parseArgs`, `--help`, `--version`, colors, prompts, exit codes, and tests with `spawnSync`

All examples run from the repo root, for example `node lessons/15-processes-and-cli/examples/01-process-object.js`. They use only core modules, finish by themselves, and start other programs with `process.execPath` (the full path of the running `node` binary), so they work on Windows, macOS and Linux. Helper scripts that the examples start live in `examples/_helpers/`.

The outputs in this lesson were captured on Windows 11 with Node 24.16.0. Where the result depends on the operating system, the text says so. Behavior on Linux and macOS that was not run for this lesson is marked as "documented". Starting a new process costs a few hundred milliseconds on this machine, so the examples that start many processes take 2 to 5 seconds (longer on a busy computer).

## 1. What is a process?

A **program** is a file on disk. A **process** is a running copy of a program. Think of a recipe (the program) and a cook working in a kitchen right now (the process). You can have many cooks following the same recipe.

Every time you type `node app.js`, the operating system creates one new process. The operating system gives each process:

| Thing | What it is |
|---|---|
| pid | a number that identifies the process (process id) |
| ppid | the pid of the parent, the process that started it |
| memory | its own private memory, which other processes cannot touch |
| working directory | the folder that relative paths start from |
| environment variables | named text values handed down from the parent |
| standard streams | stdin (input), stdout (output), stderr (error output) |
| exit code | a number it leaves behind when it ends, telling the parent how it went |

In Node, the global object **`process`** is your window into the process you are running in. You do not need `require` for it. It is also an `EventEmitter` (lesson 09), so you can write `process.on('exit', fn)`.

A **child process** is a second process that your Node program starts. It is a different program running next to yours with its own memory. You talk to it through its standard streams, through messages, or only through its exit code. This is different from `worker_threads`, where threads live inside one process and can share memory.

> **Remember:** `process` is a global, but `import process from 'node:process'` (or `require('node:process')`) gives the same object. Importing it makes the code's dependencies visible, which many teams prefer in ES modules.

> **Interview tip:** "What is the difference between a process and a thread?" A process has its own private memory and is isolated: if it crashes, other processes survive. Threads live inside one process and share its memory, so they are cheaper to start and to talk to, but one broken thread can take the whole process down. Your JavaScript runs on one main thread (Node also keeps a few helper threads of its own). `child_process` gives you more processes, `worker_threads` gives you more threads (lesson 18).

## 2. Who am I? Identity, platform and working directory

```js
console.log(process.platform, process.arch);        // 'win32' 'x64'
console.log(process.version);                       // 'v24.16.0'
console.log(process.versions.v8, process.versions.uv); // versions of V8, libuv and other parts
console.log(process.release.name);                  // 'node'
console.log(typeof process.pid, typeof process.ppid); // 'number' 'number'
```

| Property | Meaning |
|---|---|
| `process.pid`, `process.ppid` | id of this process and of its parent |
| `process.platform` | `'win32'`, `'linux'`, `'darwin'` (macOS), ... Note that `win32` is also used on 64-bit Windows |
| `process.arch` | CPU type, for example `'x64'` or `'arm64'` |
| `process.version` | the Node version with a leading `v`, for example `v24.16.0` |
| `process.versions` | an object with the versions of Node and everything inside it (V8, libuv, OpenSSL, ...) |
| `process.release` | `{ name: 'node', lts: 'Krypton', ... }`; `lts` only exists on LTS lines |
| `process.execPath` | full path of the `node` binary that is running |
| `process.cwd()` | the current working directory |
| `process.chdir(dir)` | change the working directory |

Here is part 1 and part 3 of `examples/01-process-object.js`:

```text
1. Who am I?
  pid is a number: true | ppid is a number: true
  platform: win32 | arch: x64
  version: v24.16.0 | same as versions.node: true
  versions has v8 and uv: true true
  release name: node
  execPath is the node binary: true
3. Working directory
  relative paths use cwd: true
  after chdir, cwd changed: true
  restored: true
  __dirname is where this file lives (not the cwd): examples
```

The example prints booleans instead of the real pid because the pid is different on every run.

### The working directory is not the folder of your file

The **current working directory** (cwd) is the folder the user was in when they typed the command. Relative paths such as `'data.txt'` are resolved against it:

```js
const path = require('node:path');
console.log(path.resolve('data.txt') === path.join(process.cwd(), 'data.txt')); // true
```

If the user runs `node lessons/15-processes-and-cli/examples/01-process-object.js` from the repo root, the cwd is the repo root, not the `examples` folder. `process.chdir(dir)` changes it for the whole process. `__dirname` (CommonJS) or `import.meta.dirname` (ES modules, Node 20.11+) is the folder of the file. For files that sit next to your code, always build the path from `__dirname`.

> **Common mistake:** `fs.readFileSync('./config.json')` works when you test from the project folder and breaks when the program is started from somewhere else (a scheduler, a shortcut, another script). Use `path.join(__dirname, 'config.json')`.

## 3. Command-line arguments

`process.argv` is an array of strings:

```text
node --no-warnings app.js a b --flag
      ^^^^^^^^^^^^^ node flags: process.execArgv
```

| Index | Content |
|---|---|
| `process.argv[0]` | path of the node binary (same as `process.execPath`) |
| `process.argv[1]` | path of the script |
| `process.argv[2]` and later | your arguments, always strings |

So your own arguments are `process.argv.slice(2)`. Flags meant for Node itself (`--watch`, `--env-file=.env`, `--no-warnings`, `--max-old-space-size=512`) come before the script name and are listed in `process.execArgv`, not in `argv`.

Running part 2 of the example as `node --no-warnings lessons/15-processes-and-cli/examples/01-process-object.js a b --flag`:

```text
2. Arguments
  argv[0] is execPath: true
  argv[1] is this script: 01-process-object.js
  script arguments (argv.slice(2)): [ 'a', 'b', '--flag' ]
  execArgv (flags for node itself): [ '--no-warnings' ]
```

Parsing `argv` by hand gets messy fast: `--port 8080`, `--port=8080`, `-p 8080`, `-vq` (two short flags), and `--` (end of flags) all need handling. Node has a built-in parser, **`util.parseArgs`** (added in Node 18.3, no longer experimental since Node 20):

```js
const { parseArgs } = require('node:util');

const demo = parseArgs({
  args: ['--port', '8080', '-v', 'a.txt', '--tag=x', '--tag=y', '--', '--not-a-flag'],
  options: {
    port: { type: 'string', short: 'p', default: '3000' },
    verbose: { type: 'boolean', short: 'v' },
    tag: { type: 'string', multiple: true },
  },
  allowPositionals: true,
});
console.log(demo.values);      // the options
console.log(demo.positionals); // the leftovers
```

```text
2b. util.parseArgs turns an argument list into values (shown here with a fixed list)
  values: { port: '8080', verbose: true, tag: [ 'x', 'y' ] }
  positionals: [ 'a.txt', '--not-a-flag' ]
  a typo throws: ERR_PARSE_ARGS_UNKNOWN_OPTION
```

- By default `args` is `process.argv.slice(2)`. The example passes a fixed array so the output never changes.
- `type` is `'string'` or `'boolean'`. `short` adds a one-letter form. `multiple: true` collects repeated options into an array. `default` fills in a missing option.
- A **positional** is an argument that is not an option (`a.txt`). Everything after a lone `--` is a positional, even if it starts with a dash.
- `strict` is `true` by default: an unknown option throws an error with the code `ERR_PARSE_ARGS_UNKNOWN_OPTION`. That catches typos like `--prot`.
- The returned `values` object has no prototype (it is a "null prototype" object), which is why the example copies it with `{ ...demo.values }` for a tidy print.
- `allowNegative: true` (Node 22.4+ and 20.16+) accepts `--no-color` for a boolean option called `color`. The CLI in section 21 uses it.

> **Interview tip:** "How do you read command-line arguments in Node?" Strong answer: `process.argv.slice(2)` for the raw strings, `util.parseArgs` for flags, and say that no npm package is needed for simple tools. Mention that `minimist` or `yargs` only become interesting for very large CLIs with sub-commands.

## 4. Time, memory and CPU

```js
const t0 = process.hrtime.bigint();   // nanoseconds, as a BigInt
// ... do work ...
const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
```

`process.hrtime.bigint()` is a high-resolution **monotonic** clock: it only moves forward, even if someone changes the system time. Use it to measure how long something takes. `Date.now()` is the wall clock (the real time of day) and can jump when the system time is adjusted. `process.uptime()` is the number of seconds since the process started.

| Function | What it returns |
|---|---|
| `process.memoryUsage()` | `{ rss, heapTotal, heapUsed, external, arrayBuffers }` in bytes |
| `process.memoryUsage.rss()` | only the rss, and cheaper to call |
| `process.cpuUsage([previous])` | `{ user, system }` CPU time in **microseconds**; pass an earlier result to get the difference |
| `process.resourceUsage()` | a longer list from the OS: CPU times, `maxRSS` (peak memory in KiB), page faults, context switches, ... |

What the memory fields mean:

- **rss** (resident set size): all RAM the OS has given this process. The number that Task Manager or `top` shows.
- **heapTotal / heapUsed**: the part of that memory managed by V8 for JavaScript objects, and how much of it is in use.
- **external**: memory used by C++ objects that JavaScript objects point to, for example Buffers.
- **arrayBuffers**: the part of `external` used by `ArrayBuffer` and `Buffer`.

```js
const before = process.memoryUsage();
const big = Buffer.alloc(10 * 1024 * 1024);          // 10 MiB, outside the JS heap
const after = process.memoryUsage();
console.log(after.arrayBuffers - before.arrayBuffers >= 10 * 1024 * 1024); // true

const start = process.cpuUsage();
// ... work ...
const used = process.cpuUsage(start);                // difference since start
console.log(used.user + used.system > 0);
```

```text
4. Time
  hrtime.bigint() returns a bigint: bigint
  busy wait took at least 25 ms: true
  uptime() is seconds since start: number true
5. Memory and CPU
  memoryUsage keys: rss, heapTotal, heapUsed, external, arrayBuffers
  arrayBuffers grew by about 10 MiB: true
  rss() is a fast number: true | big.length: 10485760
  cpuUsage(previous) gives user/system microseconds: user, system | used some CPU: true
  resourceUsage has maxRSS and context switches: number number
```

> **Remember:** CPU time is not wall-clock time. A process that sleeps for one second uses almost no CPU time. A process that spins in a loop for one second on one core uses about one second of `user` time.

> **Interview tip:** "How would you tell if a Node process is leaking memory?" Log `process.memoryUsage()` on a timer. If `heapUsed` keeps growing even after garbage collection (V8's automatic cleanup of objects nobody uses any more), JavaScript objects are being kept alive. If `rss` or `external` grows while `heapUsed` stays flat, look at Buffers and native memory.

## 5. stdin, stdout and stderr are streams

Every process starts with three **standard streams**. The operating system names each open file or stream with a small number, a **file descriptor** (fd), and these three always get 0, 1 and 2:

| Name | Number | In Node | Used for |
|---|---|---|---|
| stdin | 0 | `process.stdin`, a Readable stream | input, from the keyboard, a pipe or a file |
| stdout | 1 | `process.stdout`, a Writable stream | the normal output: the **data** your program produces |
| stderr | 2 | `process.stderr`, a Writable stream | errors, warnings and progress: messages **for a human** |

`console.log(x)` is `process.stdout.write(formatted + '\n')`. `console.error(x)` does the same on stderr. `process.stdout.write(text)` adds no newline and returns a boolean (the backpressure signal from lesson 11).

Why two output streams? So that data can be piped without mixing in messages. A **pipe** (the `|` character in a shell) connects the stdout of one program to the stdin of the next: what the first one writes, the second one reads.

```bash
node report.js > result.txt        # only stdout goes into the file; errors still show on screen
node report.js 2> errors.txt       # only stderr goes into the file
node report.js | node format.js    # only stdout is passed to the next program
```

```text
6. Standard streams
  stdin, stdout, stderr are streams: true
  file descriptors: 0 1 2
  written with stdout.write (no automatic newline)
  write() returned a boolean: true
```

The example also calls `console.error('  this line goes to stderr, not stdout')`. When you run it, you see that line in the terminal, but `node ... > out.txt` would not put it in the file.

### Where is the stream connected to?

`process.stdout` is not always the same kind of object. Node picks the class by what fd 1 points to: a terminal (`tty.WriteStream`), a file, or a pipe or socket (`net.Socket`).

A **terminal** (also called a **TTY**, short for teletype) is a window where a person types and reads. For a terminal, `process.stdout.isTTY` is `true` and `process.stdout.columns` is the width in characters. For a pipe or a file both are `undefined`. This is how a program knows if a person is looking at it, which decides things like colors (section 21).

The Node docs describe whether writes are synchronous (the call returns after the data is handed to the OS) or asynchronous (queued, written later):

| Connected to | Windows | Linux, macOS |
|---|---|---|
| Files | synchronous | synchronous |
| Terminals (TTY) | asynchronous | synchronous |
| Pipes and sockets | synchronous | **asynchronous** |

This table is why `process.exit()` can cut off output on Linux and macOS when the output goes into a pipe (section 10).

> **Interview tip:** "Is `console.log` synchronous?" Honest answer: it depends on where stdout points (table above). It usually behaves synchronously, but for pipes on Linux and macOS the write is asynchronous, so output can be lost if you call `process.exit()` right after it.

> **Under the hood:** `process.stdin` is a `net.Socket` unless fd 0 is a file, in which case it is a plain Readable stream. A stdin stream that nobody reads stays paused and does not keep the process alive, so touching `process.stdin` does not make Node wait for input. Adding a `'data'` listener or calling `resume()` starts the flow, and then an open stdin keeps the process running until it ends.

## 6. Warnings and nextTick

`process.emitWarning(message, options)` prints a warning on stderr and emits a `'warning'` event on `process`. It is how Node itself reports deprecations, and what libraries should use instead of `console.warn` for "you are using this wrong" messages.

```js
process.on('warning', (warning) => {
  console.log(`warning event: name=${warning.name} code=${warning.code} message="${warning.message}"`);
});
process.emitWarning('disk is almost full', { type: 'DiskWarning', code: 'DISK001', detail: 'Only 2 percent left.' });
process.nextTick(() => console.log('nextTick callback'));
Promise.resolve().then(() => console.log('promise callback'));
console.log('end of the script (synchronous part)');
```

```text
7. Warnings and nextTick
  end of the script (synchronous part)
  warning event: name=DiskWarning code=DISK001 message="disk is almost full"
  nextTick callback
  promise callback
```

On stderr the same warning looks like this (the number after `node:` is the pid):

```text
(node:19904) [DISK001] DiskWarning: disk is almost full
Only 2 percent left.
(Use `node --trace-warnings ...` to show where the warning was created)
```

- The warning is delivered on the next tick, so it appears after the synchronous code, and before the `nextTick` callback queued after it.
- `node --no-warnings` hides warnings, `--trace-warnings` prints a stack trace for each one, and `--throw-deprecation` turns deprecation warnings into thrown errors (useful in CI).
- `process.nextTick(fn)` runs `fn` right after the current operation finishes, before the event loop moves on. In CommonJS it runs before promise callbacks, as the output shows. Lesson 08 explains the whole order. The Node docs mark `nextTick` as "legacy" and recommend `queueMicrotask` for new code.

## 7. Environment variables

**Environment variables** are named text values that the parent hands to the child when it starts it. Think of sticky notes stuck on the process: `PORT=3000`, `NODE_ENV=production`, `HOME=...`. Programs read them to find out about their surroundings without changing the code. They are the standard place for configuration that differs between your laptop and a server.

`process.env` is an object that holds them. The child process inherits a copy of the parent's variables. A few variables you will meet again and again:

| Variable | Meaning |
|---|---|
| `PATH` | the list of folders the system searches when you type a program name |
| `HOME` (Linux, macOS), `USERPROFILE` (Windows) | the user's home folder |
| `NODE_ENV` | a convention, not a Node feature: Node itself ignores it, but libraries read it (Express, for example, switches to production behavior when it is `production`) |
| `NODE_OPTIONS` | Node flags that apply to every Node process that sees the variable, for example `--max-old-space-size=512`. Children inherit it like any other variable |

```js
process.env.APP_PORT = 3000;                       // we assign a number...
console.log(typeof process.env.APP_PORT);          // 'string'  ...and get a string back
process.env.APP_DEBUG = false;
console.log(JSON.stringify(process.env.APP_DEBUG), Boolean(process.env.APP_DEBUG)); // "false" true
process.env.APP_EMPTY = undefined;
console.log(JSON.stringify(process.env.APP_EMPTY)); // "undefined"  (the text, not the value)
console.log(process.env.APP_MISSING);              // undefined  (not set)
console.log('APP_MISSING' in process.env);         // false
delete process.env.APP_EMPTY;                      // the way to remove a variable
```

```text
1. Everything in process.env is a string
  typeof APP_PORT: string | value: "3000"
  APP_DEBUG: "false" | truthy: true
  assigning undefined stores the text: "undefined"
  a variable that is not set is undefined: undefined
  "in" tells set from unset: false true
  after delete: undefined
```

**Everything in `process.env` is a string.** The operating system only knows text. Node turns whatever you assign into text. This causes the classic bugs:

| Code | Result | Why |
|---|---|---|
| `if (process.env.DEBUG)` with `DEBUG=false` | takes the branch | `'false'` is a non-empty string, so it is truthy |
| `process.env.PORT + 1` with `PORT=3000` | `'30001'` | string plus number joins text |
| `Number('')` | `0` | an empty variable becomes 0, not "missing" |
| `Number('abc')` | `NaN` | a typo becomes `NaN`, and `NaN` often fails silently |
| `parseInt('80abc', 10)` | `80` | `parseInt` ignores the rest, so it hides typos |
| `process.env.X = undefined` | the text `'undefined'` | use `delete process.env.X` |

### Defaults and conversion

A variable can be **unset** (`undefined`) or **set to nothing** (an empty string). `||` and `??` treat them differently:

```js
process.env.APP_BLANK = '';
console.log(process.env.APP_BLANK || 'fallback'); // 'fallback'  (|| replaces every falsy value, including '')
console.log(process.env.APP_BLANK ?? 'fallback'); // ''          (?? replaces only undefined and null)
```

Small helper functions that validate early are better than sprinkling `Number(...)` everywhere:

```js
function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer, got "${raw}"`);
  return value;
}

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw.toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(raw.toLowerCase())) return false;
  throw new Error(`${name} must be true or false, got "${raw}"`);
}
```

```text
2. Defaults and conversion helpers
  BLANK || "fallback" gives: "fallback" (|| replaces every falsy value, including "")
  BLANK ?? "fallback" gives: "" (?? replaces only undefined and null)
  envInt("APP_PORT", 3000): 8080
  envInt("APP_MISSING", 3000): 3000
  envBool("APP_DEBUG", true): false
  envString("APP_BLANK", "fallback"): fallback
  bad value is rejected early: APP_PORT must be an integer, got "80abc"
  the traps: Number("")=0 Number("abc")=NaN Boolean("false")=true parseInt("80abc")=80
```

This is part 2 of `examples/02-env-and-env-files.js`. The rule: **read the environment once at startup, convert and validate it in one place, and fail fast with a clear message** if a value is bad. A server that crashes at startup with `PORT must be an integer` is much easier to fix than one that listens on port `NaN`.

### Setting a variable for one command

```bash
PORT=8080 node app.js            # bash, zsh (Linux, macOS, Git Bash)
```

```powershell
$env:PORT = 8080; node app.js    # PowerShell (the variable stays set in that window until you remove it)
Remove-Item Env:PORT
```

A child process gets your environment by default. To add a variable for the child, copy the current one: `spawn(cmd, args, { env: { ...process.env, EXTRA: '1' } })` (part 10 of `examples/06-spawn-stdio.js` does this).

If you pass an `env` object without copying `process.env`, the child gets only what you passed. On Linux and macOS that includes no `PATH`, so the child may not find other programs. Windows adds some basics itself (when we listed them, `PATH`, `SYSTEMROOT`, `TEMP` and `USERPROFILE` had appeared), but do not depend on that.

> **Common mistake:** on Windows, variable names are case-insensitive, so `process.env.path` and `process.env.PATH` are the same variable. On Linux and macOS they are different variables. Always use the exact same spelling everywhere.

```js
process.env.Mixed_Case = 'x';
console.log(process.env.MIXED_CASE === 'x');
```

```text
3. Env var names on Windows are case-insensitive
  platform: win32 | MIXED_CASE finds Mixed_Case: true (true on Windows, false on Linux and macOS)
```

> **Interview tip:** "What is the type of `process.env.PORT`?" Always a string, or `undefined` when not set. A strong answer also mentions the `Boolean('false')` trap and converting once at startup.

## 8. .env files, --env-file and secrets

Typing ten variables before every command is tiring. A **`.env` file** keeps them in a text file, one `KEY=value` per line. Node can load it natively, so the `dotenv` package is no longer needed for the basic job.

```text
# comments start with a hash
APP_NAME=demo
PORT=3000
GREETING="hello world"
NOTE='keeps # inside quotes'
EMPTY=
```

| Feature | Added in | Notes |
|---|---|---|
| `node --env-file=.env app.js` | 20.6.0 | no longer experimental in 24.10.0; can be repeated |
| `node --env-file-if-exists=.env app.js` | 22.9.0 | same, but a missing file is not an error |
| `process.loadEnvFile(path)` | 20.12.0 and 21.7.0 | loads a file from code; default path `./.env`; stable since 24.10.0 |
| `util.parseEnv(text)` | 20.12.0 and 21.7.0 | only parses text into an object; changes nothing; stable since 24.10.0 |

What the file syntax accepts (checked on Node 24.16): `#` comment lines, single or double quotes, `#` inside quotes is kept, `export KEY=value`, spaces around `=`, and multi-line quoted values. A trailing ` # comment` after an unquoted value is dropped.

Part 4 of `examples/02-env-and-env-files.js` writes a file in a temp folder and starts child processes with different flags:

```text
4. .env files
  util.parseEnv(text) only parses, it does not touch process.env:
    {"APP_NAME":"demo","EMPTY":"","GREETING":"hello world","NOTE":"keeps # inside quotes","PORT":"3000"}
  node --env-file=.env script.js:
    {"APP_NAME":"demo","PORT":"3000","GREETING":"hello world","NOTE":"keeps # inside quotes","NOT_IN_FILE":null}
  a variable already set in the shell WINS over the file:
    {"PORT":"9999","GREETING":"hello world"}
  two files: the LATER --env-file overrides the earlier one:
    {"PORT":"4000","EXTRA":"only in local file"}
  a missing file is an error (exit code 9), unless you use --env-file-if-exists:
    --env-file           exit code: 9 | stdout: ""
    --env-file-if-exists exit code: 0 | stdout: {"PORT":null}
5. process.loadEnvFile(path) loads a file from inside your code
  PORT stays: 1111 | APP_NAME was added: demo
  missing file throws: ENOENT
```

Look at the first result: `util.parseEnv` printed its keys sorted by name (`APP_NAME`, `EMPTY`, `GREETING`, ...), not in file order. That is what Node 24.16 did here; do not depend on the key order of the result.

The rules to remember:

1. **The real environment wins over the file.** If `PORT` is already set in the shell, `--env-file` does not replace it. `process.loadEnvFile` also never overrides an existing variable.
2. With several `--env-file` flags, **the later file wins** over the earlier one: `node --env-file=.env --env-file=.env.local app.js`.
3. A missing file with `--env-file` stops Node before your script runs, with exit code 9 (the code for an invalid argument).
4. `--env-file` is a flag for the `node` command, so it cannot be put inside the `NODE_OPTIONS` environment variable.
5. `--env-file` is applied before your code runs, so a `NODE_OPTIONS` line in the file takes effect. `process.loadEnvFile()` runs later, and the docs say a `NODE_OPTIONS` line loaded that way has no effect on Node.

### Secrets

A **secret** is a value that must stay private: a database password, an API key, a token.

- **Never commit `.env` to git.** Add `.env` (and `.env.*`) to `.gitignore`. Commit a `.env.example` with the variable names and fake values, so a new developer knows what to fill in.
- Do not print `process.env` or whole config objects in logs or error messages.
- Remember that children inherit everything. When you start a child process that does not need your secrets, pass a smaller `env`.
- On a server, set variables through the platform (container settings, a secrets manager) instead of copying a `.env` file onto the machine.

> **Interview tip:** "Where do you keep configuration and secrets?" Say: configuration in environment variables (one build, many environments), validated at startup, secrets never in git, `.env` only for local development.

## 9. Exit codes

When a process ends it leaves a number, the **exit code**. By convention **`0` means success** and **anything else means failure**. Shells, `make`, CI systems (continuous integration: servers that build and test your code automatically) and schedulers all use it: `a && b` runs `b` only if `a` exited with 0.

You can read the last exit code in the shell:

```bash
node app.js
echo $?                 # bash, zsh: the exit code of the last command
```

```powershell
node app.js
$LASTEXITCODE           # PowerShell (in cmd.exe it is %ERRORLEVEL%)
```

Conventions that most tools follow:

| Code | Meaning |
|---|---|
| `0` | success |
| `1` | general failure (this is what Node uses for an uncaught exception) |
| `2` | wrong usage: bad flags or arguments (used by many Unix tools; Bash reserves it for builtin misuse) |
| `64` to `78` | the older "sysexits" codes (`64` usage error, ...), rarely used in Node tools |
| `128 + N` | the process was killed by signal number N; `130` is Ctrl+C (SIGINT 2), `143` is SIGTERM (15), `137` is SIGKILL (9) |

Node's own special codes, from the docs:

- `1`: an uncaught exception.
- `9`: an invalid argument (an unknown Node flag, or an option without its value). A missing `--env-file` file also gave 9 when measured.
- `13`: an unsettled top-level `await` (the promise can never finish because nothing is left to run).
- `134` (`128 + 6`, `SIGABRT`): a fatal crash. A fatal out-of-memory crash gave 134 when measured on Node 24 (Windows).

Keep your own codes between 0 and 255. Linux and macOS keep only the low 8 bits, so 256 would read as 0 there (documented; Windows kept values such as 256 and 300 when we tried them). The code must be an integer: `process.exit(1.5)` throws `ERR_OUT_OF_RANGE`.

Part 1 of `examples/03-exit-codes.js` starts a helper script in different modes and prints the exit code that `spawnSync` sees:

```text
1. The exit code tells the caller what happened
  ok            exit code 0   script ends normally
  fail          exit code 1   process.exitCode = 1
  usage         exit code 2   process.exitCode = 2 (wrong usage)
  throw         exit code 1   uncaught exception
  reject        exit code 1   unhandled promise rejection
  signal-style  exit code 143 process.exit(143) = 128 + 15, "killed by SIGTERM"
  no-such-mode  exit code 64  helper rejects the mode
2. A crash prints the error on stderr and exits with 1
  stderr mentions the message: true
  stdout is empty: true
```

An uncaught exception and an unhandled promise rejection both end with code 1 on Node 24 (the default mode for rejections is `throw`). Lesson 14 covers how to handle them.

> **Interview tip:** "What exit code should a CLI return when the user passes a wrong flag?" `2`, with a message on stderr. And "when the work itself failed?" `1`. Say that CI depends on this and that you document the codes in `--help`.

## 10. process.exit() versus process.exitCode

There are two ways to choose the exit code:

```js
process.exitCode = 1;   // 1. set it, and let the program finish normally
process.exit(1);        // 2. stop right now, with this code
```

`process.exit(code)` runs the `'exit'` listeners and then ends the process **immediately**. Everything still waiting is thrown away: timers, pending file writes, open network connections, data still buffered in a stream. `process.exitCode = n` only records the number. The program keeps running until the event loop is empty (lesson 08), then exits with `n`.

The helper script starts a "save later" timer and then ends in the two different ways:

```js
// _helpers/exit-with.js (trimmed)
function saveLater() {
  setTimeout(() => {
    fs.writeFileSync(file, 'saved');
    console.log('timer fired, file saved');
  }, 20);
}
// mode "exit-cut":  saveLater(); process.exit(0);    // exits NOW
// mode "exit-code": saveLater(); process.exitCode = 0; // lets the timer run
```

```text
3. process.exit() stops at once, process.exitCode lets pending work finish
  exit-cut  exit code 0 | timer fired: false | file saved: false
  exit-code exit code 0 | timer fired: true | file saved: true
```

Both ended with code 0, but only the second one finished its work.

### Output can be cut off too

The table in section 5 matters here. On Linux and macOS, writes to a **pipe** are asynchronous. If your program prints a lot and then calls `process.exit()`, the end of the output can be lost. This is a famous source of "my output is truncated when piped but fine in the terminal" bugs (documented behavior, not reproduced here).

On Windows, pipes are synchronous, so the problem does not appear: a test on this Windows machine that wrote 5 MiB to a pipe and then called `process.exit(0)` delivered every byte. Do not let that fool you into thinking the code is safe.

Rules of thumb:

1. In normal code, **set `process.exitCode` and let the program end by itself**.
2. If you must stop right now (a fatal error, after you have logged it), `process.exit(code)` is fine. If you also just wrote output, wait for the write to finish: `process.stdout.write(text, () => process.exit(code))`.
3. **Libraries must never call `process.exit()`.** The application decides when to exit. A library that exits makes tests and servers impossible to control.
4. `process.exit()` with no argument uses `process.exitCode` if it was set, otherwise 0.

> **Interview tip:** "What is the difference between `process.exit()` and `process.exitCode`?" Strong answer: exit is immediate and abandons pending work and unflushed output; exitCode only sets the number and lets the event loop drain. Prefer exitCode.

## 11. The exit and beforeExit events

Two events let you run code at the end of a process.

| | `'beforeExit'` | `'exit'` |
|---|---|---|
| When | the event loop became empty and nothing is scheduled | right before the process really ends |
| After `process.exit()` | **not emitted** | emitted |
| After an uncaught exception | **not emitted** | emitted (with code 1) |
| Async work allowed? | yes. Scheduling new work keeps the process alive and `beforeExit` fires again later | **no**, only synchronous code. Timers and I/O started here are dropped |
| Receives | the exit code | the exit code |

```js
// _helpers/lifecycle.js (trimmed)
let rounds = 0;
process.on('beforeExit', (code) => {
  console.log(`beforeExit (code ${code}), round ${rounds}`);
  if (rounds < 2) {
    rounds++;
    setTimeout(() => console.log(`  extra work ${rounds}`), 10);   // new work: the process stays alive
  }
});
process.on('exit', (code) => console.log(`exit (code ${code})`));
```

```text
4. The beforeExit and exit events
  --- natural end (the event loop becomes empty) ---
  | main script done
  | beforeExit (code 0), round 0
  |   extra work 1
  | beforeExit (code 0), round 1
  |   extra work 2
  | beforeExit (code 0), round 2
  | exit (code 0)
  --- explicit process.exit(0) ---
  | main script done
  | exit (code 0)
```

The example file also registers an `'exit'` listener on itself (part 5):

```text
5. Setting process.exitCode inside this very script
  last line of the script
  [exit event] code is 0
```

The listener receives the code that the process is about to leave with. Change `process.exitCode = 0` in the file to `3` and re-run: the listener prints `3`, and `echo $?` (or `$LASTEXITCODE`) shows `3` too.

- `beforeExit` is rarely needed. A guard (`rounds < 2` above) is essential, or a handler that always schedules work would run forever.
- Use `'exit'` for last, synchronous cleanup: write a final log line with `fs.writeSync`, remove a temp file. You can even change `process.exitCode` inside it.
- Neither event runs if the process is killed by a signal that has no handler (including `SIGKILL`), if the machine loses power, or on a hard crash. Cleanup that must always happen cannot rely on these events alone.

> **Interview tip:** "What is the difference between `beforeExit` and `exit`?" `beforeExit` fires when the event loop has run dry, and it may start new asynchronous work, which makes the process keep going. It does not fire after `process.exit()` or an uncaught exception. `exit` always fires just before the process ends, but only synchronous code works in it.

## 12. Signals and Ctrl+C

A **signal** is a tiny message from the operating system (or another process) to a process. It has a number and a name, and it does not carry data. Think of someone tapping you on the shoulder: "stop", "please finish up", or "your terminal was closed".

| Signal | Number | Sent when | Can you catch it? |
|---|---|---|---|
| `SIGINT` | 2 | you press Ctrl+C in the terminal | yes |
| `SIGTERM` | 15 | `kill <pid>`; the normal "please stop" request (more below) | yes |
| `SIGHUP` | 1 | the terminal was closed | yes |
| `SIGKILL` | 9 | `kill -9 <pid>`; the "pull the plug" signal | **no** |
| `SIGSTOP` | 19 on Linux | pauses a process | **no** (not available on Windows) |
| `SIGBREAK` | 21 on Windows | Ctrl+Break on Windows | yes (Windows only) |
| `SIGUSR1` | 10 on Linux | reserved by Node: it starts the debugger | avoid |

The numbers for `SIGHUP`, `SIGINT`, `SIGKILL` and `SIGTERM` are the same on Windows, Linux and macOS. `os.constants.signals` lists all the signals the current platform knows.

In practice `SIGTERM` comes from Docker, Kubernetes and **process managers** (programs such as systemd or pm2 that start other programs and keep them running) when they want your program to stop. `SIGHUP` also has a second life: some background services (**daemons**, programs that run without a terminal) treat it as "reload your configuration". Node does not do that for you; you would write the handler.

```text
1. Signals are small numbers sent to a process
  SIGHUP 1 | SIGINT 2 | SIGKILL 9 | SIGTERM 15
  a shell reports "killed by SIGINT" as exit code 128 + 2 = 130
  a shell reports "killed by SIGTERM" as exit code 128 + 15 = 143
```

This is part 1 of `examples/04-signals.js`. That is where the `128 + N` exit codes in section 9 come from.

### Handling a signal

Without a handler, `SIGINT`, `SIGTERM` and `SIGHUP` end the process, and no `'exit'` event runs. (On Linux and macOS, Node installs default handlers for `SIGINT` and `SIGTERM` that reset the terminal mode and then exit, so a shell sees `128 + the signal number`.) With your own handler, the signal becomes an ordinary event:

```js
process.on('SIGINT', () => {
  console.log('Ctrl+C pressed, cleaning up...');
  // do the cleanup, then end the process yourself
});
```

Facts that interviewers like:

- **A handler replaces the default action.** If you install a `SIGINT` handler and do not exit, Ctrl+C no longer stops your program. Your handler must end it (or tell the rest of the program to).
- **A signal handler does not keep the process alive.** A program with only a signal handler and no other work ends normally (checked on Windows with a lone `SIGINT` handler: it printed its last line and exited with code 0). To keep a program alive while it waits for a signal, it needs something else that is alive, such as a server, a timer, or a resumed `process.stdin`.
- `SIGKILL` and `SIGSTOP` cannot be caught, blocked or ignored. That is by design: the operating system must always be able to stop a runaway process. A process that was killed with `SIGKILL` gets no chance to clean up.

### How Ctrl+C works

When you press Ctrl+C in a terminal, the **terminal** (not Node) turns the key press into a `SIGINT` signal and sends it to the program running in the foreground. In a pipeline or when a program has started children that share the terminal, they usually all receive it. Node turns it into the `'SIGINT'` event on `process`.

There is one exception: in **raw mode** (when a program asks the terminal to hand it every key press, as interactive menus and `readline` on a terminal do), Ctrl+C is not turned into a signal. The program receives the character as data and has to handle it, which is why interactive libraries have their own Ctrl+C handling. The Node docs say `SIGINT` is not generated when raw mode is enabled.

> **Interview tip:** "What is the difference between `SIGTERM` and `SIGKILL`?" `SIGTERM` is a polite request that a program can catch, to finish work and clean up. `SIGKILL` cannot be caught and ends the process at once. Process managers send `SIGTERM` first, wait a grace period, then send `SIGKILL`.

## 13. Graceful shutdown and the Windows differences

A **graceful shutdown** is a stop where the program finishes what it is doing and cleans up, instead of being cut off. For a web server it means: stop accepting new connections, let the running requests finish, close the database connections, then exit. This is what you do when `SIGTERM` arrives (for example when a new version is deployed).

The helper `examples/_helpers/graceful-server.js` is a small HTTP server with this pattern:

```js
let shuttingDown = false;

function shutdown(reason) {
  if (shuttingDown) return;                  // a second signal while stopping is ignored
  shuttingDown = true;
  console.log(`shutdown requested by ${reason}`);

  setTimeout(() => {                         // safety net: never hang forever
    console.log('forced exit');
    process.exit(1);
  }, 3000).unref();                          // unref: this timer alone does not keep Node alive

  server.close(() => {                       // called when all connections are finished
    fs.writeFileSync(markerFile, 'cleanup done');   // flush logs, close databases, ...
    console.log('server closed, cleanup done');
    if (process.connected) process.disconnect();    // nothing left to wait for: Node exits with 0
  });
  server.closeIdleConnections();             // do not wait for idle keep-alive connections (kept open for reuse)
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('message', (message) => {         // a fallback that also works on Windows
  if (message === 'shutdown') shutdown('message');
});
```

The checklist behind it: stop taking new work, finish the current work, release resources, set a **timeout** in case something hangs, and make the function safe to call twice.

### What is different on Windows

Windows has no real signals. Node pretends to have them, and only part of the pretending works. The docs say that on Windows, `process.kill()` and `child.kill()` with `SIGINT`, `SIGTERM` or `SIGKILL` **terminate the target at once**, without running its handlers.

| | Linux and macOS | Windows |
|---|---|---|
| `child.kill('SIGTERM')` | the child's handler runs, it can clean up | the child is terminated at once, **no handler runs** |
| `process.on('SIGTERM', fn)` | runs when another process sends `SIGTERM` | can be registered, but the docs say `SIGTERM` is not supported on Windows |
| `process.kill(process.pid, 'SIGTERM')` with a handler installed | the handler runs | the process is terminated, the handler does not run |
| Ctrl+C | `SIGINT` | `SIGINT` (works in a console) |
| Ctrl+Break | nothing | `SIGBREAK` |
| Closing the terminal window | `SIGHUP` | `SIGHUP`, then Windows ends the process about 10 seconds later |
| `process.kill(pid, 0)` | checks if the pid exists | works the same way |

Part 3 and 4 of `examples/04-signals.js` start the server helper with `fork`, stop it in two ways, and report what happened:

```text
3. Stop a child with child.kill("SIGTERM")
  platform: win32
  { stoppedWith: 'SIGTERM', wasRunning: true, exitCode: null, exitSignal: 'SIGTERM', handlerRan: false, cleanupRan: false, stillRunning: false }
  Windows: the child is terminated at once. No handler runs, exitSignal is SIGTERM, exitCode is null.
  Linux and macOS (documented): the SIGTERM handler runs, so handlerRan and cleanupRan are true and exitCode is 0.
4. Stop a child by sending it a message (works on every platform)
  { stoppedWith: 'message', wasRunning: true, exitCode: 0, exitSignal: null, handlerRan: true, cleanupRan: true, stillRunning: false }
```

Only the Windows results above were measured. The Linux and macOS line describes documented behavior, and the example's message path would print the same result there too.

`process.kill(pid, 0)` sends no signal at all. It only checks whether the process exists and throws `ESRCH` if it does not. It works on Windows too, and the example uses it as `isRunning(pid)` (part 2 of the example, and the `wasRunning` and `stillRunning` fields above):

```js
function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // it exists but belongs to someone else
  }
}
```

```text
2. process.kill(pid, 0) sends nothing, it only asks "does this process exist?"
  this process: true
```

Practical consequences:

- To test shutdown code on Windows, trigger it with a message, an HTTP call or Ctrl+C in a console. Do not rely on `child.kill('SIGTERM')` in tests that must run on Windows.
- In production on Linux (containers, process managers), `SIGTERM` is the normal stop request, so handle both `SIGTERM` and `SIGINT`.
- A forced exit still needs an exit code. After handling a signal, graceful programs usually exit with 0. If you want to follow the shell convention, use `128 + N`.

> **Common mistake:** "My Docker container takes 10 seconds to stop." That usually means `SIGTERM` never reached your handler, so Docker waited its default 10 seconds and then sent `SIGKILL`. Two typical causes:
>
> - The container starts Node through a shell or through `npm start`, which may not pass the signal on.
> - Node runs as process number 1 in the container, which Linux treats specially (the Node.js Docker best-practices guide warns that such a process may not react to `SIGINT` and similar signals as expected).
>
> The fixes: start Node directly (`CMD ["node", "server.js"]`, the list form), handle `SIGTERM` yourself, and consider `docker run --init`. This comes from the Docker and Node documentation and was not run here. [Lesson 24](../24-production-and-deployment/README.md) covers deployment.

> **Interview tip:** "How do you shut a Node server down gracefully?" A strong answer names: handle `SIGTERM` and `SIGINT`; `server.close()` plus closing idle connections; wait for in-flight work; close the database and other resources; a timeout that forces exit; idempotent handler; a non-zero code when the timeout fires; and, in Kubernetes, that the readiness probe (the check that decides whether a server may receive traffic) should fail first so no new traffic arrives.

## 14. Child processes: the four functions

Why start another program from Node?

- To use a tool that already exists: `git`, `ffmpeg`, `tar`, a compiler.
- To run a Node script in isolation, so that a crash or a memory leak there does not hurt the main program.
- To use more than one CPU core for heavy work (each process has its own V8 and its own event loop).
- To write a script, a build tool or a CLI that glues programs together.

Two words you need for the next table. A **shell** is the program that reads a command line and starts programs for you (`sh` or `bash` on Linux and macOS, `cmd.exe` or PowerShell on Windows). It understands `|`, `>`, `&&` and `*`. **Buffered** output is collected in memory and handed to you in one piece after the child has ended.

`node:child_process` has four main functions, and each has a different personality:

| Function | Uses a shell? | Output arrives | Command given as | Use it when |
|---|---|---|---|---|
| `exec(command, cb)` | **yes** | all at once, buffered, in the callback | one **string** | quick shell one-liners with fixed text you wrote yourself |
| `execFile(file, args, cb)` | no | all at once, buffered | file name + **array** of args | run a known program and read its small output |
| `spawn(file, args)` | no | **streamed** while it runs | file name + array of args | large or endless output, live progress, talking to the child's stdin |
| `fork(script, args)` | no | streams plus a **message channel** | path of a Node script | run another Node script and exchange JavaScript values |

There are sync versions too: `execSync`, `execFileSync`, `spawnSync`. They block the event loop until the child ends (section 18).

All the async functions return a `ChildProcess` object (an `EventEmitter`) with `pid`, `stdin`, `stdout`, `stderr`, `kill()` and events such as `'exit'`, `'close'` and `'error'`.

> **Under the hood:** `spawn` is the basic building block. `execFile` is `spawn` plus buffering the output. `exec` is `execFile` plus running the command inside a shell. `fork` is `spawn` of `node` with an extra communication channel.

Which to pick, as a short decision list:

1. Do you need a message channel to another Node script? `fork`.
2. Is the output big, or do you want it while it runs, or does the child need input? `spawn`.
3. Do you want a small result from a known program? `execFile`.
4. Do you really need shell features (pipes, `>`, wildcards) and the whole command is text you control? `exec`.

One more fact for the security-minded: under the permission model (`node --permission`), starting any child process is blocked unless you also pass `--allow-child-process`. The call then throws an error with the code `ERR_ACCESS_DENIED` (checked on Node 24.16).

> **Interview tip:** "`exec` vs `execFile` vs `spawn` vs `fork`?" Answer in one breath: exec runs a string in a shell and buffers; execFile runs a file with an args array, no shell, and buffers; spawn streams; fork is spawn for Node scripts with an IPC channel. Then add the injection risk of exec and the `maxBuffer` limit.

## 15. exec and execFile

Everything here is in `examples/05-exec-execfile.js`. The code wraps both functions with `util.promisify`, which makes them return a promise of `{ stdout, stderr }`. The snippets in this section use `await`, so they must run inside an `async` function (the example file wraps everything in `async function main()`); a plain CommonJS file cannot use `await` at the top level.

```js
const util = require('node:util');
const childProcess = require('node:child_process');
const exec = util.promisify(childProcess.exec);
const execFile = util.promisify(childProcess.execFile);

const node = process.execPath;
const q = (text) => `"${text}"`; // inside a command STRING you add the quotes yourself

// exec: a string, run by a shell
let result = await exec(`${q(node)} ${q(helper('greet.js'))} Ada`);

// execFile: a program and an array, no shell
result = await execFile(node, [helper('greet.js'), 'Grace']);
```

```text
1. exec runs a command STRING through a shell and gives you all the output at the end
  stdout: "hello Ada" | stderr: ""
2. execFile runs a program with an ARRAY of arguments and no shell
  stdout: "hello Grace"
```

- The shell is `/bin/sh` on Linux and macOS, and `cmd.exe` (the `ComSpec` variable) on Windows. On some Linux systems (Debian and Ubuntu) `/bin/sh` is a small shell called `dash`, not `bash`, so bash-only syntax in an `exec` string can fail there.
- Output is decoded as UTF-8 text by default. Use `encoding: 'buffer'` for binary data.
- Without a promise wrapper the callback is `(error, stdout, stderr)`.
- The node path is quoted because `C:\Program Files\nodejs\node.exe` contains a space. With `execFile` you never think about quoting: each array item is one argument, exactly.

### Command injection

A shell treats characters like `&`, `;`, `|`, `$()` and backticks as commands. If part of the command string comes from a user, the user can add their own commands. This is called **command injection**, and it is one of the most common serious security bugs.

```js
const userInput = 'bob & echo INJECTED';    // imagine this came from a web form
result = await exec(`${q(node)} ${q(helper('greet.js'))} ${userInput}`);        // shell sees "&"
result = await execFile(node, [helper('greet.js'), userInput]);                 // one plain argument
```

```text
3. Command injection: what the shell does with user input
  exec (shell):         ["hello bob","INJECTED"]
  second command ran: true
  execFile (no shell):  ["hello bob & echo INJECTED"]
  second command ran: false
```

With `exec`, the shell ran **two** commands, the second being whatever the attacker typed (here a harmless `echo`). With `execFile` the whole text arrived as one argument and was just printed.

The `&` character means "and then the next command" in `cmd.exe`, and "start the first command in the background and go on" in `sh`. Either way the second command runs. On Linux and macOS the two output lines can come out in either order, which is why the example checks for a line that is exactly `INJECTED` instead of comparing the whole output.

Rules:

- **Never put untrusted input into a command string.** Prefer `execFile` or `spawn` with an array.
- Setting `shell: true` on `spawn` or `execFile` brings the shell back. Passing an args array together with `shell: true` is deprecated (DEP0190) because the arguments are only joined, not escaped. Node 24 prints a `DeprecationWarning` for it.
- Escaping by hand is fragile and differs between `cmd.exe` and `sh`. Avoid it.

### Errors

```js
try {
  await execFile(node, [helper('exit-with.js'), 'usage']);
} catch (err) {
  console.log(err.code, err.killed, err.signal, err.stderr);
}
```

```text
4. A non-zero exit code makes the promise reject (the callback gets an error)
  err.code (the exit code): 2
  err.killed: false | err.signal: null
  err.stderr: "usage: tool <file>"
  err.message starts with "Command failed": true
5. A program that cannot be started rejects too (a string code this time)
  err.code: ENOENT | err.path: this-program-does-not-exist
```

- A child that exits with a non-zero code produces an error. `err.code` is the **exit code number**, and `err.stdout` and `err.stderr` still hold what was printed.
- A program that cannot start (not found, not allowed) also produces an error, but then `err.code` is a **string** like `'ENOENT'`.
- `err.signal` is set, and `err.code` is `null`, when the child was ended by a signal.

### maxBuffer and timeout

Because `exec` and `execFile` collect all the output in memory, they have a limit, **`maxBuffer`**, which defaults to **1 MiB (1024 * 1024 bytes)** for each of stdout and stderr. If the child writes more, Node ends the child and reports an error.

```js
await execFile(node, [helper('noisy.js'), '5000'], { maxBuffer: 1000 });    // rejects
await execFile(node, [helper('noisy.js'), '5000'], { maxBuffer: 10_000 });  // works
await execFile(node, [helper('sleepy.js'), '5000'], { timeout: 300 });      // killed after 300 ms
```

```text
6. maxBuffer: output bigger than the limit stops the child and rejects
  err.code: ERR_CHILD_PROCESS_STDIO_MAXBUFFER
  we still got the first part, stdout length: 1000
  with a bigger maxBuffer the same program works, length: 5000
7. timeout: the child is killed when it takes too long
  err.killed: true | err.signal: SIGTERM | err.code: null
  gave up long before 5 seconds: true
```

`timeout` (default 0, meaning none) kills the child with `killSignal` (default `'SIGTERM'`) when it runs too long. If the output can be large, do not raise `maxBuffer` forever: use `spawn` and process the stream.

> **Common mistake:** using `exec` to read a big file listing or a log, and getting `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` in production but not in tests. The limit applies to the child's output, not to your memory.

## 16. spawn: streaming and stdio

`spawn(file, args, options)` starts the program and returns **immediately**. You read its output as it is produced. It is the right tool for long-running or chatty programs. Everything here is in `examples/06-spawn-stdio.js`.

```js
const child = spawn(node, [helper('count-up.js'), '3', '40']);   // prints "tick 1".."tick 3", 40 ms apart
child.stdout.setEncoding('utf8');                                 // Buffers -> strings
child.stdout.on('data', (chunk) => console.log('data:', JSON.stringify(chunk)));
child.on('exit', (code, signal) => console.log(`exit event: code=${code} signal=${signal}`));
child.on('close', (code, signal) => console.log(`close event: code=${code} signal=${signal}`));
```

```text
1. spawn returns at once, and the output arrives in pieces
  child.pid is a number: true
  data: "tick 1\n"
  data: "tick 2\n"
  data: "tick 3\n"
  exit event: code=0 signal=null
  close event: code=0 signal=null (after all stdio is closed)
```

The chunks are separate here because the helper waits 40 ms between lines. Chunk boundaries are not guaranteed: a program that prints quickly can arrive in one chunk, and one line can be split across two. Never assume one `data` event is one line (that is what `readline` is for, section 20).

### The events

| Event | When | Arguments |
|---|---|---|
| `'spawn'` | the child was started | none |
| `'error'` | the child **could not be started**, could not be killed, could not receive a message, or was aborted by an `AbortSignal` | the error |
| `'exit'` | the child process ended | `(code, signal)` |
| `'close'` | the child ended **and** its stdio streams are closed | `(code, signal)` |

`'exit'` can fire while some output is still being read, so use **`'close'`** when you need all the output. Exactly one of `code` and `signal` is not `null`: `code` for a normal exit, `signal` when it was killed.

```js
child = spawn('this-program-does-not-exist', ['a']);
child.on('error', (err) => console.log(err.code));   // you MUST listen, or the 'error' event is thrown
```

```text
2. A program that cannot start emits "error" (and no "exit")
  child.pid: undefined
  error event: ENOENT
```

> **Common mistake:** forgetting the `'error'` listener. An `'error'` event without a listener is thrown, and a typo in a command name then crashes your whole program.

### Options worth knowing

The third argument of `spawn` (and of `exec`, `execFile`, `fork` and the sync versions) is an options object:

| Option | What it does |
|---|---|
| `cwd` | the folder the child starts in (default: your own working directory) |
| `env` | the child's environment variables (default: `process.env`) |
| `stdio` | what to connect to stdin, stdout and stderr (next table) |
| `shell` | `true` runs the command through a shell. This brings back the injection risk of section 15 |
| `timeout`, `killSignal`, `signal` | stop the child after some time, with which signal, or when an `AbortSignal` fires (see "Stopping a child") |
| `detached` | let the child outlive the parent (see the end of this section) |
| `windowsHide` | on Windows, do not show a console window for the child (default `false`) |

Part 10 of the example starts a child with its own `cwd` and `env`:

```text
10. cwd and env decide where the child runs and what it can see
  child ran in the folder we gave it: true
  child saw the variable we added: "hi from the parent"
```

### The stdio option

`stdio` says what to connect to the child's stdin, stdout and stderr.

| Value | Meaning |
|---|---|
| `'pipe'` (default) | connect a pipe; you get `child.stdin`, `child.stdout`, `child.stderr` as streams |
| `'inherit'` | share your own stdin, stdout or stderr; the child writes straight to your terminal. The matching `child.stdout` is `null` |
| `'ignore'` | connect nothing: the child is attached to the null device, a special file that swallows everything written to it |
| an array | one value per stream, for example `['ignore', 'pipe', 'inherit']` |

```text
3. stdio: "pipe" (default), "inherit" and "ignore"
  with "inherit" child.stdout is null (the child writes straight to our terminal)
printed by the child
  with "ignore" the output was thrown away
  [stdin, stdout, stderr] = ["ignore", "pipe", "ignore"] gives: null function null
```

`stdio: 'inherit'` is the shortest way to run a tool and show its output live, like a build script does. Notice that the line `printed by the child` is not indented: the child wrote it, not our `console.log`.

### Stopping a child

`child.kill([signal])` sends a signal (`SIGTERM` by default) and returns `true` if the signal could be sent. `child.killed` only means "a kill signal was sent successfully", not "the child is dead". After the child ends, `child.exitCode` and `child.signalCode` tell what happened. Sections 7 to 9 of the example show three ways to stop a child:

```js
child = spawn(node, [helper('sleepy.js'), '10000']);
child.kill();                                                // 1. kill() by hand

const controller = new AbortController();
child = spawn(node, [helper('sleepy.js'), '10000'], { signal: controller.signal });
controller.abort();                                          // 2. an AbortSignal (the child emits 'error' with AbortError)

child = spawn(node, [helper('sleepy.js'), '10000'], { timeout: 150, killSignal: 'SIGTERM' });  // 3. built-in timeout
```

```text
7. kill() asks a child to stop
  kill() returned: true
  close event: code=null signal=SIGTERM | child.killed=true
8. An AbortSignal can stop a child too (handy for timeouts)
  error event: AbortError
  child was stopped, signalCode: SIGTERM
9. spawn has built-in timeout and killSignal options
  close event: code=null signal=SIGTERM
```

On Windows `kill()` ends the child forcibly (section 13). And `kill()` signals **one** process only, which surprises people in two cases:

- **`shell: true`.** The child you started is the *shell*, and your program runs inside it. `child.kill()` can end the shell and leave the program running. Checked on Windows 11: after `kill()` the `cmd.exe` shell was gone and the real `node` program was still running. (On Linux the shell may replace itself with the program for a simple command, so the result can differ.) Start the program directly, without a shell, whenever you can.
- **Grandchildren** (the children of your child). On Linux and macOS they normally keep running when their parent is killed (documented Unix behavior, not run here). On Windows we saw the opposite for programs that Node itself started: the grandchild died together with its parent, most likely because Node's process library keeps the processes it starts in a Windows job object that is cleaned up when their parent ends. Do not rely on either behavior.

To stop a whole tree on Linux and macOS, start the child with `detached: true` (it becomes the leader of a new process group) and call `process.kill(-child.pid, 'SIGTERM')`, where the minus sign means "the whole group" (standard Unix technique, not run here). On Windows use `taskkill /pid <pid> /T /F` (checked: it ended a shell and the program inside it).

**Detached children.** With `detached: true` and `stdio: 'ignore'`, followed by `child.unref()`, the child can keep running after your program exits (a background service). On Windows a detached child gets its own console window. Without `unref()`, the parent waits for the child.

## 17. Piping streams between processes

The streams of a child are normal streams (lesson 11), so `pipe` works. This is the same idea as the `|` in a shell:

```js
const producer = spawn(node, ['-e', 'console.log("first line"); console.log("second line")']);
const filter = spawn(node, [helper('upper.js')]);
producer.stdout.pipe(filter.stdin);                 // like:  producer | filter
```

```text
4. Writing to the child's stdin and reading all its output
  child answered: "HELLO WORLD\n"
5. A pipeline like "a | b": connect one child's stdout to another child's stdin
  result: "FIRST LINE\nSECOND LINE\n"
6. child.stdout.pipe(process.stdout) shows the child's output as if it were ours
hello from a child, piped to our stdout
```

The program on the other side of such a pipe is a **filter**: it reads its own `process.stdin` and writes its own `process.stdout`. `_helpers/upper.js` is one, and the core of it is a single `pipeline` call (`process.stdin.pipe(process.stdout)` alone would be a minimal `cat`):

```js
// _helpers/upper.js (trimmed): toUpper is a Transform stream that upper-cases each chunk
pipeline(process.stdin, toUpper, process.stdout).catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
```

The ways to connect streams:

| Code | Meaning |
|---|---|
| `a.stdout.pipe(b.stdin)` | the output of `a` is the input of `b` |
| `child.stdout.pipe(process.stdout)` | show the child's output as ours (the same effect as `stdio: 'inherit'` for that stream) |
| `process.stdin.pipe(child.stdin)` | forward what the user types or pipes in to the child |
| `child.stdin.write(text)` then `child.stdin.end()` | feed the child by hand |
| `for await (const chunk of child.stdout)` | read the output as an async iterable |

Two traps:

- **End the child's stdin.** A program that reads until "end of input" (like `upper.js`) waits forever until you call `child.stdin.end()`, or until the stream you are piping from ends (`pipe` does that for you).
- **Read the output, or ignore it.** If you leave `child.stdout` as a pipe and never read it, the pipe fills up and the child blocks when it writes. Read it, call `child.stdout.resume()` to discard it, or use `'ignore'`.

For production pipelines prefer `stream.pipeline()` over `.pipe()`, because it forwards errors and cleans up (lesson 11).

### When the reader leaves early: EPIPE

Sometimes the program on the right of a pipe stops reading before the left one is done, for example `node big.js | head -n 2`. The left program keeps writing into a pipe that nobody reads, and the operating system answers with the error **EPIPE** ("broken pipe").

In C programs this arrives as the `SIGPIPE` signal, which kills them. Node ignores that signal (documented), so the error shows up as an `'error'` event on `process.stdout`. With no listener it is thrown, and the program crashes with exit code 1 and a long stack trace.

Part 11 of the example reads one chunk from a very chatty helper and then closes its end of the pipe. It does this twice: for a helper without a handler, and for one with this handler:

```js
// _helpers/chatty.js, the --quiet version (trimmed)
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0); // the reader is gone: nobody is left to print for
  throw err;                                  // any other error is still a real error
});
```

```text
11. The reader goes away early (like "program | head -n 1"): EPIPE
  without a handler:       exit code 1 | stderr mentions EPIPE: true
  with an "error" handler: exit code 0 | stderr mentions EPIPE: false
```

> **Interview tip:** "Why does `node app.js | head -n 1` sometimes print `Error: write EPIPE`?" Because `head` closed the pipe after one line while the program was still writing. Unix tools stay quiet in that case, so a well-behaved Node CLI that prints a lot handles `EPIPE` on `process.stdout` and exits quietly.

## 18. The sync versions: spawnSync, execFileSync, execSync

The sync functions block the whole event loop until the child ends. They are perfect for build scripts, installers, test helpers and startup code, where there is nothing else to do. They are wrong inside a web server's request handler, where one slow child would freeze every user.

```js
let result = spawnSync(node, ['-e', 'console.log("hi"); console.error("oops"); process.exit(4)'], { encoding: 'utf8' });
console.log(result.status, result.signal, result.error, result.stdout, result.stderr);

const out = execFileSync(node, ['-p', '40 + 2'], { encoding: 'utf8' });   // returns the output
try {
  execFileSync(node, [helper('exit-with.js'), 'usage'], { stdio: 'pipe' }); // throws: non-zero exit
} catch (err) {
  console.log(err.status, err.stderr.toString().includes('usage'));
}
```

```text
1. spawnSync blocks until the child ends and NEVER throws for a failing child
  status: 4 | signal: null | error: undefined
  stdout: "hi\n" | stderr: "oops\n"
  keys: status, signal, output, pid, stdout, stderr
2. spawnSync reports a program that cannot start in result.error
  status: null | error.code: ENOENT
3. spawnSync with a timeout
  status: null | signal: SIGTERM | error.code: ETIMEDOUT
4. spawnSync can send input to the child's stdin
  stdout: "TEXT FROM THE PARENT\n"
5. execFileSync returns the output, and THROWS if the child fails
  returned: "42\n"
  without an encoding you get a Buffer: true
  it threw, err.status: 2 | err.stderr has the text: true
6. execSync is the same with a shell string
  returned: "42\n"
```

| | `spawnSync` | `execFileSync` / `execSync` |
|---|---|---|
| Child exits non-zero | returns normally, check `result.status` | **throws** an error with `status`, `stdout`, `stderr` |
| Child cannot start | `result.error` is set, `status` is `null` | throws |
| Return value | `{ status, signal, error, stdout, stderr, pid, output }` | the stdout (string if you pass `encoding`, otherwise a Buffer) |
| Input for stdin | `input` option | `input` option |
| Time limit | `timeout` (then `error.code` is `ETIMEDOUT`) | `timeout` |

Notes: the `maxBuffer` default (1 MiB) applies to the sync functions too. Without the `stdio` option, `execSync` and `execFileSync` show the child's stderr on your own stderr. `execSync` uses a shell, so the injection rules of section 15 apply.

> **Interview tip:** "When is `execSync` or `spawnSync` acceptable?" In build scripts, installers, CLIs and startup code, where nothing else needs the event loop. Never in a request handler or anywhere that serves many users at once: the whole process freezes until the child ends.

## 19. fork and IPC messages

`fork(modulePath, args, options)` starts **another Node.js script** as a child and opens a **message channel** between the two processes. The channel is called **IPC** (inter-process communication). The parent uses `child.send(value)` and `child.on('message', fn)`. The child uses `process.send(value)` and `process.on('message', fn)`.

```js
// parent (inside an async function; `once` comes from node:events)
const child = fork(helper('worker.js'));
const [ready] = await once(child, 'message');          // { type: 'ready', hasChannel: true }
child.send({ type: 'add', a: 2, b: 3 });
const [answer] = await once(child, 'message');         // { type: 'result', value: 5 }
child.send({ type: 'bye' });

// child (worker.js, trimmed)
process.on('message', (message) => {
  if (message.type === 'add') process.send({ type: 'result', value: message.a + message.b });
  else if (message.type === 'bye') process.disconnect();   // close the channel; the child then exits by itself
});
process.send({ type: 'ready', hasChannel: process.connected });
```

```text
7. fork() starts another Node script and opens a message channel
  stdio has 4 entries (the 4th is the channel): 4
  child says: { type: 'ready', hasChannel: true }
  child answered: { type: 'result', value: 5 }
```

- `process.send` exists in the child only if the process was started by `fork` (or with an `'ipc'` entry in `stdio`). A script started in any other way gets `undefined`, and `worker.js` checks for this.
- `child.send(message, handle)` can also hand over an open TCP server or socket, not only data. That is how `cluster` lets several processes share one port (lesson 18).
- A process that has a `'message'` listener stays alive while the channel is open, because it is waiting for messages. That is why `worker.js` keeps running until it is told `bye`. (A forked child with no `'message'` listener and nothing else to do simply exits, and the channel closes with it; checked on Node 24.) Close the channel with `child.disconnect()` or `process.disconnect()`, or end the child with `child.kill()`. The `'disconnect'` event fires on both sides.
- `fork` also gives the child normal stdout and stderr. By default they are shared with the parent. `{ silent: true }` pipes them, so you can read `child.stdout` (section 13 used that).
- By default the child gets the same Node flags as the parent (`process.execArgv`). Change them with the `execArgv` option of `fork`.

### What can you send?

Messages are **serialized**, which means converted into bytes and rebuilt on the other side. The default format is JSON, so the limits of JSON apply:

```js
child.send({ type: 'inspect', map: new Map([['a', 1]]), date: new Date(0) });
// the child reports what it received
```

```text
8. What survives the trip? The default serializer is JSON
  { type: 'inspected', mapKept: false, dateKept: false, dateType: 'string', bigintType: 'undefined' }
  child exited by itself after process.disconnect(), exitCode: 0
9. serialization: "advanced" keeps Map, Date and BigInt
  { type: 'inspected', mapKept: true, dateKept: true, dateType: 'object', bigintType: 'bigint' }
10. A BigInt cannot be sent with the default JSON serializer
  send() threw: TypeError: Do not know how to serialize a BigInt
```

- With JSON: a `Map` arrives as `{}`, a `Date` as a string, functions and `undefined` properties disappear, and a `BigInt` makes `send()` throw.
- With `fork(script, args, { serialization: 'advanced' })` the messages use the structured clone format, which keeps `Map`, `Set`, `Date`, `BigInt`, typed arrays and more. Functions still cannot be sent. Both sides must use the same setting.
- `child.send(message, callback)` returns `false` if the channel is closed or too many unsent messages are waiting, a signal to slow down. The optional callback runs once the message was sent.

### fork, worker_threads or cluster?

| | `fork` (child process) | `worker_threads` | `cluster` |
|---|---|---|---|
| Memory | separate: each child has its own V8 heap | one process, can share memory with `SharedArrayBuffer` | separate processes |
| Crash in the child | the parent survives | an uncaught error in a worker is delivered as an error event | the primary survives |
| Startup cost | higher (a whole Node, a few hundred ms here) | lower | higher |
| Best for | isolation, untrusted code, different Node flags, a separate memory limit | CPU-heavy JavaScript inside one app | several copies of one server sharing a port |

`cluster` is built on top of `fork`. [Lesson 18](../18-worker-threads-and-cluster/README.md) covers worker threads and clustering in detail.

> **Interview tip:** "How do you use all the CPU cores in Node?" Strong answer: run several processes (cluster, or a process manager, or containers) for servers, and `worker_threads` for CPU-heavy functions; use `fork` or `spawn` when you need process isolation or another program.

## 20. Reading standard input

Standard input has two common shapes: a person typing in a terminal, or data piped in from a file or another program (`cat names.txt | node app.js`). Check which one you have with `process.stdin.isTTY`: `true` for a terminal, `undefined` for a pipe or a file.

```js
const result = spawnSync(node, ['-p', 'String(process.stdin.isTTY)'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] });
```

```text
1. Is stdin a terminal (a person typing) or a pipe/file?
  stdin.isTTY in a child that has piped stdio: undefined
  stdout.isTTY in a child that has piped stdio: undefined
```

Part 1 above, and the examples below, are in `examples/08-stdin-readline.js`. Three ways to read stdin:

**1. Line by line with `readline`** (best for line-based input and big files):

```js
// _helpers/stdin-lines.js (trimmed)
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let count = 0;
for await (const line of rl) {
  count++;
  console.log(`line ${count}: ${JSON.stringify(line)}`);
}
```

The parent feeds it text with mixed line endings and no final newline:

```js
spawnSync(node, [helper('stdin-lines.js')], { input: 'one\r\ntwo\n\nlast line without newline', encoding: 'utf8' });
```

```text
2. Line by line with readline (for await over the interface)
  | line 1: "one"
  | line 2: "two"
  | line 3: ""
  | line 4: "last line without newline"
  | total lines: 4, stdin is a terminal: false
```

`crlfDelay: Infinity` makes `\r\n` count as one line break always (otherwise a `\r` and `\n` that arrive in different chunks could count as two). The final line is delivered even without a newline.

**2. All at once**, when you need the whole text (for JSON, for counting):

```js
// _helpers/stdin-all.js (trimmed)
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);   // chunks are Buffers
const text = Buffer.concat(chunks).toString('utf8');           // decode once, at the end
```

```text
3. All at once: collect the chunks, then decode
   read 31 characters and 6 words
```

Collect Buffers and decode at the end. If you decode each chunk separately, a multi-byte character (like an emoji) that is split between two chunks would be damaged. (`process.stdin.setEncoding('utf8')` also handles this.)

**3. Events**: `process.stdin.on('data', fn)` and `on('end', fn)`. This works, but the `for await` form is shorter and reports errors.

Piping a file into a program, like `cat words.txt | node stdin-lines.js`, looks like this in code:

```js
const child = spawn(node, [helper('stdin-lines.js')]);
fs.createReadStream(file).pipe(child.stdin);    // when the file ends, pipe() closes the child's stdin
```

```text
4. Pipe a file into a program, like "cat words.txt | node stdin-lines.js"
  | line 1: "alpha"
  | line 2: "beta"
  | line 3: "gamma"
  | total lines: 3, stdin is a terminal: false
5. readline also reads a FILE line by line without loading it all into memory
   [ 'ALPHA', 'BETA', 'GAMMA' ]
6. The same with events: "line" for each line, "close" at the end
  lines counted: 3
```

Good to know:

- If stdin is a terminal and you read it to the end, the program waits until the user types the end-of-input key (Ctrl+Z then Enter on Windows, Ctrl+D elsewhere). CLIs should check `isTTY` and print a hint instead of hanging (section 21).
- `fs.readFileSync(0, 'utf8')` reads all of fd 0 synchronously. It is a quick way for small scripts that are always fed by a pipe or a file. It is not for interactive use, and in some setups (for example when stdin is a terminal) it can throw an error such as `EAGAIN` or `EOF` instead of waiting, so the `for await` form is the safer habit.
- `readline` works on any Readable stream, so the same loop reads files, sockets and stdin.

> **Interview tip:** "How do you process a 10 GB log file, or a huge piped input, without running out of memory?" Do not load it all (`readFileSync`, or collecting every chunk). Stream it: `readline` over `fs.createReadStream` or `process.stdin`, handle one line at a time, and keep only counters or results. Streams also give you backpressure (lesson 11).

## 21. Building a real CLI

A **CLI** (command line interface) is a program you run from a terminal and give arguments to. This section builds one, step by step, in `examples/09-mini-cli.js`: a small `wcl` tool that counts lines, words and characters, like the Unix `wc`. Run it:

```bash
node lessons/15-processes-and-cli/examples/09-mini-cli.js --help
```

### 21.1 Turning a script into a command: shebang and bin

The first line of a CLI file is a **shebang**:

```js
#!/usr/bin/env node
```

On Linux and macOS, when a file is executable and you run it, the system reads this line to find out which interpreter to use: "run this file with `node`, found through `env`". Windows has no shebang support, and Node simply treats the line as a comment on every platform (`examples/12-cross-platform.js` proves it).

To install the script as a command, add a **`bin`** entry to `package.json`:

```json
{
  "name": "wcl",
  "version": "1.2.0",
  "bin": { "wcl": "bin/wcl.js" },
  "files": ["bin"],
  "engines": { "node": ">=22" }
}
```

When someone runs `npm install -g wcl`, `npm link`, or installs the package as a dependency, npm creates the command for them. On Linux and macOS it makes a symlink (a small file that points to another file) and marks the script executable. On **Windows** it writes small wrapper files, called **shims**. This is what npm created in `node_modules/.bin` for a test package whose `bin` entry was `hello` (checked on Windows with npm 11):

```text
hello       a shell script wrapper (used by Git Bash)
hello.cmd   a batch file wrapper (used by cmd.exe)
hello.ps1   a PowerShell wrapper
```

The `.cmd` file runs `node` with the path of your script and passes on the arguments (`%*`). `npx hello x y` then printed `hello from the bin script [ 'x', 'y' ]`. That also explains the `.cmd` problem in section 24.

> **Common mistake:** a script with Windows line endings (`\r\n`) in a file that has a shebang. On Linux the system looks for an interpreter named `node\r` and fails with "not found". Keep CLI files on LF line endings (`.gitattributes` can enforce it).

### 21.2 Parsing the arguments

The options table of `wcl`, passed to `util.parseArgs` (section 3):

```js
const options = {
  lines: { type: 'boolean', short: 'l' },
  words: { type: 'boolean', short: 'w' },
  chars: { type: 'boolean', short: 'c' },
  json: { type: 'boolean', short: 'j' },
  verbose: { type: 'boolean' },
  color: { type: 'boolean' },            // allowNegative below also accepts --no-color
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

let parsed;
try {
  parsed = parseArgs({ args: argv, options, allowPositionals: true, allowNegative: true });
} catch (err) {
  console.error(`wcl: ${err.message}`);
  console.error("Try 'wcl --help'.");
  return EXIT_USAGE;                      // 2
}
const { values, positionals } = parsed;
```

`parseArgs` accepts `-lw` (two short flags together), `--lines`, `--no-color`, and `--` before names that start with a dash. A wrong command line throws, and the CLI turns that into a message on stderr and exit code 2.

**Flags, environment variables and defaults.** Many CLIs let one setting come from several places. The usual priority, strongest first: a command-line flag, then an environment variable, then a config file, then the built-in default. The flag wins because the user typed it just now, for this one run:

```js
const port = Number(values.port ?? process.env.PORT ?? 3000);  // flag, then env var, then default
```

Do not give that option a `default` inside `parseArgs`, or the chain never reaches the environment variable. Validate the final number once, as in section 7.

### 21.3 --help and --version

Every CLI needs both, and they have a standard behavior: print to **stdout**, exit with **0**.

```text
wcl 1.2.0 - count lines, words and characters

Usage:
  wcl [options] [file...]
  some-command | wcl [options]

Use "-" as a file name to read standard input.

Options:
  -l, --lines     show the number of lines
  -w, --words     show the number of words
  -c, --chars     show the number of characters
  -j, --json      print the result as JSON
      --verbose   print progress messages to stderr
      --color     force colors (default: only when writing to a terminal)
      --no-color  never use colors
  -h, --help      show this help and exit
  -v, --version   show the version and exit

Exit codes:
  0  success
  1  a file could not be read
  2  wrong usage (unknown option, or no input given)
```

A good help text has: the name and version, usage lines, every option, and the exit codes. In a real package the version is not typed twice: read it from `package.json` (`require('../package.json').version`).

### 21.4 stdout for results, stderr for everything else

The most important design rule of a CLI: **stdout carries the result; stderr carries messages for the human** (progress, warnings, errors). Then `wcl big.txt | sort` works, even when `wcl` also prints progress. (A CLI that prints a lot should also handle `EPIPE` when the reader leaves early, see section 17.)

```bash
node lessons/15-processes-and-cli/examples/09-mini-cli.js --verbose lessons/15-processes-and-cli/examples/_helpers/greet.js lessons/15-processes-and-cli/examples/_helpers/missing.js
```

```text
[1/2] reading lessons/15-processes-and-cli/examples/_helpers/greet.js
[2/2] reading lessons/15-processes-and-cli/examples/_helpers/missing.js
wcl: error: cannot read lessons/15-processes-and-cli/examples/_helpers/missing.js (ENOENT)
lines=5 words=33 chars=261  lessons/15-processes-and-cli/examples/_helpers/greet.js
```

The first three lines went to stderr, the last line to stdout. With `2>/dev/null` (bash) or `2>$null` (PowerShell) you would see only the last line. The exit code of this command is 1, because one file could not be read, even though the other one worked.

**Progress without a spinner.** Spinners need cursor control and look broken in logs. A plain line per step on stderr (`[1/2] reading ...`) is simple, readable in CI logs, and costs nothing. Only draw something fancier when `process.stderr.isTTY` is true.

For machines, offer `--json`. Keep the output shape the same whether there is one file or many (here it is always an array, even for a single file), which makes scripts easier to write:

```bash
node lessons/15-processes-and-cli/examples/09-mini-cli.js -j -l lessons/15-processes-and-cli/examples/_helpers/greet.js
```

```text
[
  {
    "name": "lessons/15-processes-and-cli/examples/_helpers/greet.js",
    "lines": 5
  }
]
```

### 21.5 Colors with util.styleText

`util.styleText(format, text)` wraps text in ANSI color codes (added in Node 20.12 and 21.7, stable since 22.13 and 23.5). **ANSI codes** are special character sequences that a terminal reads as "switch to red" or "switch to bold" instead of printing them. `format` is a name like `'red'`, `'bold'` or `'cyan'`, or an array of names.

```js
const { styleText } = require('node:util');
console.log(styleText('green', 'ok'));
console.log(styleText(['bold', 'red'], 'failed'));
```

The important part is that it **checks the stream** first: if the stream is not a terminal, or `NO_COLOR` is set, it returns plain text. `FORCE_COLOR=1` turns colors on even in a pipe. This protects a log file or a pipe from garbage characters like `\u001b[31m`. The CLI uses these rules:

```js
function makePainter(colorOption, stream) {
  if (colorOption === false) return (format, text) => text;          // --no-color
  // --color forces escape codes. Otherwise styleText decides, for this specific stream.
  return (format, text) => styleText(format, text, { stream, validateStream: colorOption !== true });
}
```

- `{ stream: process.stderr }` makes it check stderr instead of stdout. A common case is stdout piped to a file (no colors) while stderr is still a terminal (colors for errors).
- `{ validateStream: false }` skips the check and always adds the codes. The `--color` flag uses it.
- Honor the conventions: `NO_COLOR` turns colors off, `FORCE_COLOR` turns them on, and a flag overrides both. If both variables are set, Node prints a warning and `FORCE_COLOR` wins (measured on Node 24.16: `The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set`).
- Version note: the stream and environment checks were added to `styleText` in Node 22.8 and 20.18. Older versions always return the escape codes, so on those versions you must do the TTY check yourself.

### 21.6 Exit codes, and not calling process.exit

The CLI documents three codes: `0` success, `1` a file failed, `2` wrong usage. `main` is an `async` function that **returns** the code, and the bottom of the file sets `process.exitCode`:

```js
module.exports = { main, count };

// Run only when started as a program, not when another file require()s this one.
if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;          // not process.exit(code): let pending output finish first
    },
    (err) => {
      console.error(`wcl: unexpected error: ${err.stack}`);
      process.exitCode = 1;
    },
  );
}
```

Two good habits are in this snippet. `require.main === module` is true only when the file is the entry point, so tests can `require` the file and call `count()` without starting the program (in an ES module the equivalent is `import.meta.main`, available in Node 24.2 and later and still marked early development in the docs). And errors in `main` are caught and become exit code 1 with a message, not an ugly crash.

Another check protects the user from a hang:

```js
if (inputs.includes('-') && process.stdin.isTTY) {
  console.error('wcl: no input. Give a file name, or pipe text into wcl.');
  return EXIT_USAGE;
}
```

If someone runs `wcl` with no arguments in a terminal, reading stdin would wait for typing forever. Tell them instead.

To handle Ctrl+C in a CLI that does long work, listen for the signal, clean up, and exit with `130` (128 + 2):

```js
process.on('SIGINT', () => {
  cleanup();               // remove temp files, close handles
  process.exit(130);       // an explicit exit is fine here: we are leaving on purpose
});
```

> **Interview tip:** "How would you build a CLI in Node?" Walk through: shebang + `bin` in `package.json`; `util.parseArgs`; `--help` and `--version`; results on stdout and messages on stderr; documented exit codes; colors only on a TTY and honoring `NO_COLOR`; read stdin when piped; and tests that run the real program with `spawnSync`.

## 22. Interactive prompts

To ask the user a question, use `readline/promises`:

```js
// Put this inside an async function (or save the file as .mjs and use import instead of require).
const readline = require('node:readline/promises');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const name = await rl.question('Your name? ');
const answer = await rl.question(`Deploy for ${name} (y/N)? `);
rl.close();   // close it, or stdin keeps the process alive
```

`examples/_helpers/ask.js` is a complete script like this, and `examples/11-prompts.js` plays the user. A program that waits for a person is tested by answering **after** each question appears, exactly like a person would:

```js
child.stdout.on('data', (chunk) => {
  if (chunk.includes('?') && pending.length > 0) child.stdin.write(`${pending.shift()}\n`);
});
```

```text
1. A person answers one question at a time (we play the person)
  exit code: 0
  what the program printed: "Your name? Deploy for Ada (y/N)? Deploying for Ada...\n"
2. The answer "n" cancels
  what the program printed: "Your name? Deploy for Grace (y/N)? Cancelled.\n"
```

Two traps, both shown by the example:

```text
3. The trap: all answers arrive at the same moment (a pipe, not a person)
  exit code: 1
  stderr: "Input ended before all questions were answered."
4. The input ends before the questions are answered (like pressing Ctrl+D)
  exit code: 1
  stderr: "Input ended before all questions were answered."
5. Without the guard in ask.js the same situation is silent
  exit code: 0 (success, although nobody answered)
  stdout: "Name? " (the promise never settled, so "hello" never printed)
```

1. **Answers that arrive too early are lost.** When both lines `Ada` and `y` arrive in one chunk (a pipe, or a file redirected into stdin), `readline` emits both lines at once. The second line is emitted while no question is waiting, so nobody gets it. A person types one line at a time, so this only appears with piped or scripted input.
2. **If stdin ends while a question is waiting, the promise never settles.** There is nothing left to keep the event loop alive, so Node exits quietly with code **0**, and your script looks like it succeeded. `ask.js` fixes this by aborting the question when `readline` closes:

```js
const ended = new AbortController();
rl.on('close', () => ended.abort());
const ask = (question) => rl.question(question, { signal: ended.signal });
// ... in a catch block: if (err.name === 'AbortError') { console.error('Input ended ...'); process.exitCode = 1; }
```

Good CLI behavior around prompts:

- Offer flags for everything you ask (`--yes`, `--name Ada`), so the tool also works in scripts and CI.
- If `process.stdin.isTTY` is not true, do not prompt. Use the flags or fail with a clear message.
- On a real terminal, `readline` puts the terminal in raw mode and reads every key itself, so Ctrl+C is not turned into a signal. The interface reports it as its own `'SIGINT'` event (`rl.on('SIGINT', ...)`) instead of reaching `process.on('SIGINT')`. Per the docs, if `rl` has no `'SIGINT'` listener the interface emits `'pause'`, so Ctrl+C does not stop the program by itself. Listen on `rl` if you need cleanup there. (This part needs a real terminal, so it was not run for this lesson.)
- Hidden input (passwords) needs raw mode and is easier with a library.

## 23. Testing a CLI

A CLI is a process, so the most honest test is to **run it as a process** and look at what comes out: the exit code, stdout and stderr. `spawnSync` is ideal because it returns everything in one object and never throws for a failing child. `examples/10-test-the-cli.js` tests `wcl` this way:

```js
const cleanEnv = { ...process.env };
for (const name of ['FORCE_COLOR', 'NO_COLOR', 'NODE_DISABLE_COLORS']) delete cleanEnv[name];

function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: cleanEnv, ...options });
}

check('unknown option: exit 2, message on stderr, nothing on stdout', () => {
  const r = run(['--bogus']);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /Unknown option '--bogus'/);
});

check('reads standard input when there is no file', () => {
  const r = run([], { input: 'a b c' });
  assert.equal(r.stdout, 'lines=1 words=3 chars=5  stdin\n');
});
```

The full run prints 13 checks in five groups (help and version, counting, errors and exit codes, output streams and colors, a unit test). The start and the end of it:

```text
Help and version
  ok    --help prints usage and exits 0
  ok    -v prints only the version
Counting
  ok    counts a file
  (... ten more checks, all ok ...)

13 passed, 0 failed
```

What to remember when testing CLIs:

- **Check the exit code first**, then stdout and stderr separately. That is what other programs will do.
- **Control the environment.** Remove `FORCE_COLOR` and `NO_COLOR` from the child's `env` (as above), or a setting on your machine changes the results.
- **Feed stdin with the `input` option** and use temp folders for files (`fs.mkdtempSync(path.join(os.tmpdir(), '...'))`), cleaned up in a `finally` block.
- `result.status` is `null` when the child was killed by a signal or could not start. Check `result.error` and `result.signal` in that case.
- Each process start costs time (hundreds of milliseconds on Windows), so test the pure logic (`count()`) directly and keep the process-level tests for behavior that needs a real process. The next lesson shows the built-in test runner `node:test`, which can run files like this one.

## 24. Cross-platform tips

Everything in this lesson was run on Windows 11. These are the differences that bite when the same code runs on Linux or macOS (and the other way around). `examples/12-cross-platform.js` prints the first four.

| Topic | Windows | Linux, macOS | What to do |
|---|---|---|---|
| Path separator | `\` | `/` | build paths with `path.join` / `path.resolve`, never by joining strings with `/` or `\` |
| `PATH` entries separator | `;` | `:` | `path.delimiter` |
| Line ending in files | often `\r\n` | `\n` | split text with `/\r?\n/`; `os.EOL` is the native one; `console.log` always writes `\n` |
| Shebang | ignored | used | keep the line; npm creates `.cmd` shims on Windows |
| Programs that are `.cmd` or `.bat` files (npm, npx, yarn, ...) | cannot be started directly | normal executables | see below |
| Signals | `kill()` terminates forcibly | handlers can run | design shutdown with a message or an HTTP call too (section 13) |
| Environment variable names | case-insensitive | case-sensitive | always use the exact name |
| Temp and home folders | `C:\Users\...\AppData\Local\Temp` | `/tmp`, `/home/...` | `os.tmpdir()`, `os.homedir()`; never hard-code `/tmp` |
| Shell for `exec` | `cmd.exe` | `/bin/sh` | avoid shell syntax; use `execFile`/`spawn` |
| Exit code range | 32 bits | 0 to 255 | keep codes between 0 and 255 |

```text
1. Paths
  platform: win32
  path.sep: "\\" | path.delimiter (between PATH entries): ";"
  path.join("a", "b", "c.txt"): a\b\c.txt
  path.win32.join("a", "b", "c.txt"): a\b\c.txt
  path.posix.join("a", "b", "c.txt"): a/b/c.txt
  path.win32.basename("C:\\logs\\app.log"): app.log
  path.posix.basename("C:\\logs\\app.log"): C:\logs\app.log (a backslash is just a letter on Linux)
  forward slashes work on Windows too: true
2. Line endings
  os.EOL: "\r\n" | console.log always ends a line with "\n"
  split("\n"):     ["one\r","two","three"] <- the \r stays on "one"
  split(/\r?\n/):  ["one","two","three"]
3. A shebang line is only a comment for Node, on every platform
  node tool.js -> the shebang line was skipped | exit code 0
```

The lines for `path.sep`, `path.delimiter`, `path.join`, `os.EOL` and the `platform` line are the ones that change on Linux and macOS (`"/"`, `":"`, `a/b/c.txt`, `"\n"`, `linux` or `darwin`). Forward slashes work in paths on every platform, including Windows, so config files and docs should use `/`.

### Starting programs: the .cmd problem

On Windows, `npm` is really a batch file, `npm.cmd`. Batch files are not programs; only the command shell can run them. So:

```js
spawnSync('npm', ['--version']);                    // Windows: ENOENT (there is no file named exactly "npm.exe")
spawnSync('npm.cmd', ['--version']);                // Windows: EINVAL (Node refuses to run .cmd without a shell)
spawnSync('npm --version', { shell: true });        // works: the shell runs it
```

```text
4. Starting npm: a .cmd shim is not a program
  spawnSync("npm", ["--version"]):         status null | error ENOENT
  spawnSync("npm.cmd", ["--version"]):     status null | error EINVAL
  spawnSync("npm --version", {shell:true}): status 0 | output looks like a version: true
5. The portable way to run a Node script is process.execPath
  works everywhere: win32
```

On Linux and macOS the first line simply works, because `npm` is a normal executable there. The `EINVAL` behavior is a security measure: running batch files through a shell with user-controlled arguments had been a way to inject commands. It was added in the security releases of April 2024 (Node 18.20.2, 20.12.2 and 21.7.3, and in every later line), so on an older Node the second call may work, and that is the reason to upgrade rather than to rely on it.

The portable rules:

1. To run Node itself or a Node script, use **`process.execPath`** as the program (as every example in this lesson does). It does not depend on `PATH` and works the same everywhere.
2. For other tools, use `spawn(tool, args)` and handle `ENOENT`. If a tool is a `.cmd` file on Windows, use `{ shell: true }` with **one fixed command string** (no user input, no args array: passing an array together with `shell: true` triggers the DEP0190 warning).
3. Better still: avoid the shell commands that differ by platform. Use `fs.rm(path, { recursive: true, force: true })` instead of `rm -rf` or `rmdir /s`, `fs.cp` instead of `cp`, `fs.glob` instead of `ls *.js`.
4. In `package.json` scripts, `&&` works everywhere, but `$VAR`, `rm`, `cp` and single quotes do not work in `cmd.exe`. `node --run` uses the platform shell too.

> **Interview tip:** "What breaks when Node code moves between Windows and Linux?" Strong answer: hard-coded path separators and `/tmp`; `\r\n` line endings; case-sensitive environment variable names (and, on Linux, file names); the shebang and the executable bit; signals (a `SIGTERM` handler does not run on Windows); starting `.cmd` programs; shell commands such as `rm -rf`; and the exit code range. The fix is to use `path`, `os`, `process.execPath` and Node's own `fs` functions, and to run the tests on both systems in CI.

## Summary / Key takeaways
- `process` describes the running process: `argv` (your arguments from index 2), `env`, `cwd()`, `pid`, `platform`, `versions`, time (`hrtime.bigint`), memory (`memoryUsage`), CPU (`cpuUsage`) and the standard streams.
- Environment variables are always strings. Convert and validate once at startup. `--env-file` (20.6+) and `process.loadEnvFile` (20.12+) read `.env` files; a real environment variable wins over the file; never commit secrets.
- Exit code 0 is success, 1 a general failure, 2 a usage error, `128 + N` a signal. Prefer `process.exitCode` to `process.exit()`, because `exit` abandons pending work and can cut off output.
- `SIGTERM` and `SIGINT` can be handled for a graceful shutdown; `SIGKILL` cannot. On Windows, `child.kill()` terminates forcibly and no handler runs.
- `exec` runs a string in a shell (injection risk, 1 MiB `maxBuffer`), `execFile` runs a file with an args array, `spawn` streams, and `fork` adds a message channel for Node scripts. Use `'close'` to know all output was read, always listen for `'error'`, and remember that `kill()` stops one process only (with `shell: true` that is the shell).
- The sync versions block the event loop: fine for scripts and build tools, wrong in servers. `spawnSync` returns `status`, `signal` and `error`; the `exec*Sync` functions throw on failure.
- A good CLI has a shebang and a `bin` entry, uses `util.parseArgs`, supports `--help` and `--version`, puts results on stdout and messages on stderr (and exits quietly on `EPIPE`), uses colors only on a terminal, returns documented exit codes, and is tested by running it with `spawnSync`.
- Cross-platform code uses `path`, `os.tmpdir()`, `process.execPath` and `/\r?\n/`, and does not depend on signals or `.cmd` files behaving like on Linux.

## Quick check

1. What do `process.argv[0]` and `process.argv[1]` contain, and how do you get only your own arguments? Where do flags for Node itself go?
<details><summary>Answer</summary>

`argv[0]` is the path of the node binary (same as `process.execPath`) and `argv[1]` is the path of the script. Your own arguments, always strings, start at index 2: `process.argv.slice(2)`. Flags for Node itself (such as `--watch` or `--env-file=.env`) are not in `argv`; they are listed in `process.execArgv`.

</details>

2. After `process.env.DEBUG = false;`, does `if (process.env.DEBUG)` take the branch? What does `process.env.X = undefined` store?
<details><summary>Answer</summary>

Yes, it takes the branch. Assigning to `process.env` turns the value into a string, so `DEBUG` is the text `'false'`, which is truthy. `process.env.X = undefined` stores the text `'undefined'`; use `delete process.env.X` to remove a variable. Convert and compare explicitly, for example `process.env.DEBUG === 'true'`.

</details>

3. A variable `PORT=9999` is set in the shell and `PORT=3000` is in `.env`. What does `node --env-file=.env app.js` see? What if there are two `--env-file` flags, and what if the file is missing?
<details><summary>Answer</summary>

`9999`: a variable that is already in the environment wins over the file. With two `--env-file` flags, the later file overrides the earlier one. A missing file stops Node with exit code 9 and an error message, unless you use `--env-file-if-exists`.

</details>

4. What is the difference between `process.exit(1)` and `process.exitCode = 1`? Why is the second one preferred?
<details><summary>Answer</summary>

`process.exit(1)` ends the process immediately. Pending timers, file writes and unflushed stream data are thrown away, and output written to a pipe can be cut off on Linux and macOS. `process.exitCode = 1` only records the code; the program continues until the event loop is empty and then exits with 1, so all work finishes.

</details>

5. Which signals cannot be caught? What happens on Windows when you call `child.kill('SIGTERM')`? What does `kill()` stop when the child was started with `shell: true`?
<details><summary>Answer</summary>

`SIGKILL` and `SIGSTOP` cannot be caught, blocked or ignored. On Windows, `kill()` with `SIGINT`, `SIGTERM` or `SIGKILL` terminates the child forcibly and its handlers never run, so the child cannot clean up. To stop a child gracefully on Windows, send it a message (IPC), an HTTP request, or similar. With `shell: true` the child is the shell, so `kill()` can end the shell and leave the real program running.

</details>

6. Give two differences between `exec` and `execFile`. What is command injection?
<details><summary>Answer</summary>

`exec` takes one command string and runs it through a shell; `execFile` takes a file and an array of arguments and runs it directly, with no shell. Both buffer the output. Command injection is when untrusted text ends up inside a shell command (`'bob & rm ...'`), so the shell runs commands the attacker chose. Avoid it with `execFile` or `spawn` and an array.

</details>

7. What is `maxBuffer`, what is its default, and what happens when the output is larger?
<details><summary>Answer</summary>

It is the maximum size of stdout and of stderr that `exec`, `execFile` and the sync functions will collect. The default is 1 MiB (1024 * 1024 bytes). When the child writes more, Node ends the child and the call fails with the error code `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`. For large output use `spawn` and read the stream.

</details>

8. What is the difference between the `'exit'` and `'close'` events of a child process? When does `'error'` fire?
<details><summary>Answer</summary>

`'exit'` fires when the process has ended, but its stdio streams may still hold unread data. `'close'` fires after the process ended and all its stdio streams were closed, so all the output has been read. `'error'` fires when the child could not be started (for example `ENOENT`), could not be killed or sent a message, or was aborted with an `AbortSignal`. An `'error'` event with no listener is thrown.

</details>

9. What can you send with `child.send()` after `fork`? How do you send a `Map` or a `BigInt`?
<details><summary>Answer</summary>

With the default JSON serialization, plain data: objects, arrays, strings, numbers, booleans and `null`. A `Map` arrives as `{}`, a `Date` as a string, functions disappear, and a `BigInt` makes `send()` throw. Use `fork(script, args, { serialization: 'advanced' })` to send structured-clone types such as `Map`, `Set`, `Date` and `BigInt`. Functions still cannot be sent.

</details>

10. In a well-behaved CLI, where do results, errors and progress messages go, and what should it do on `EPIPE`? What do the exit codes 0, 1 and 2 mean? How does a `bin` entry work on Windows?
<details><summary>Answer</summary>

Results go to stdout; errors, warnings and progress go to stderr, so the output can be piped. `EPIPE` on stdout means the reader (for example `head`) left early, so the program should stop quietly. Exit code 0 is success, 1 is a failure while doing the work, 2 is wrong usage. The `bin` entry maps a command name to a file; npm links it on Linux and macOS, and on Windows (where the shebang is ignored) it creates `.cmd` and `.ps1` wrapper files (shims) that run `node` with your script.

</details>

## Try it yourself

### Task 1 (easy): a validated config
Write `loadConfig(env = process.env)` that returns `{ port, debug, name }` from the variables `PORT` (an integer from 0 to 65535, default 3000), `DEBUG` (`true`, `false`, `1` or `0`, case-insensitive, default `false`) and `APP_NAME` (default `'app'`). An empty variable counts as not set. Bad values must throw an error with a clear message. When the file is run, load the real environment and, on a bad value, print the message to stderr and set the exit code to 2.

<details><summary>Hint</summary>

Remember that `process.env` values are strings or `undefined`. Use `Number(...)` plus `Number.isInteger(...)` for the port, and a list of allowed spellings for the boolean. Taking the environment as a parameter makes the function easy to test with plain objects. End with `process.exitCode = 2`, not `process.exit(2)`.

</details>

<details><summary>Solution</summary>

Save as `task1.js` and run it with `node task1.js`:

```js
// Reads PORT, DEBUG and APP_NAME from an env object, with defaults and clear errors.
function loadConfig(env = process.env) {
  const rawPort = env.PORT === undefined || env.PORT === '' ? '3000' : env.PORT;
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new RangeError(`PORT must be an integer from 0 to 65535, got "${rawPort}"`);
  }

  const rawDebug = (env.DEBUG === undefined || env.DEBUG === '' ? 'false' : env.DEBUG).toLowerCase();
  if (!['true', 'false', '1', '0'].includes(rawDebug)) {
    throw new TypeError(`DEBUG must be true, false, 1 or 0, got "${env.DEBUG}"`);
  }

  return { port, debug: rawDebug === 'true' || rawDebug === '1', name: env.APP_NAME || 'app' };
}

// Passing an object instead of process.env makes the function easy to test.
console.log(loadConfig({}));
console.log(loadConfig({ PORT: '8080', DEBUG: 'TRUE', APP_NAME: 'shop' }));
for (const bad of [{ PORT: '80abc' }, { PORT: '70000' }, { DEBUG: 'yes' }]) {
  try {
    loadConfig(bad);
  } catch (err) {
    console.log(`${err.name}: ${err.message}`);
  }
}

// The real program: read the real environment, exit with code 2 on a bad value.
try {
  console.log('from the real environment:', loadConfig());
} catch (err) {
  console.error(`config error: ${err.message}`);
  process.exitCode = 2;
}
```

Output of `node task1.js` (exit code 0):

```text
{ port: 3000, debug: false, name: 'app' }
{ port: 8080, debug: true, name: 'shop' }
RangeError: PORT must be an integer from 0 to 65535, got "80abc"
RangeError: PORT must be an integer from 0 to 65535, got "70000"
TypeError: DEBUG must be true, false, 1 or 0, got "yes"
from the real environment: { port: 3000, debug: false, name: 'app' }
```

With a bad value in the real environment, the same five test lines print, and then stderr shows the message while the exit code is 2:

```bash
PORT=abc node task1.js
```

```powershell
$env:PORT = 'abc'; node task1.js; $LASTEXITCODE; Remove-Item Env:PORT
```

```text
config error: PORT must be an integer from 0 to 65535, got "abc"
```

</details>

### Task 2 (medium): run a script with a time limit
Write `runNode(args, { timeoutMs })` that starts `process.execPath` with `args`, collects stdout and stderr, and returns a promise of `{ code, signal, stdout, stderr, timedOut }`. A non-zero exit code must **not** reject the promise. If the child takes longer than `timeoutMs`, kill it and set `timedOut: true`. Reject only if the child cannot be started.

<details><summary>Hint</summary>

Use `spawn` with `stdio: ['ignore', 'pipe', 'pipe']`. Resolve in the `'close'` event (all output has been read by then). Start a `setTimeout` that sets `timedOut = true` and calls `child.kill()`, and clear it in both `'close'` and `'error'`. Test with a snippet that exits with code 3, one that sleeps for five seconds, and the invalid flag `--no-such-flag` (Node exits with code 9).

</details>

<details><summary>Solution</summary>

```js
const { spawn } = require('node:child_process');

// Runs a Node script or snippet in a new process. It never rejects because of the child's exit code,
// it only rejects when the child cannot be started at all.
function runNode(args, { timeoutMs = 2000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill(); // SIGTERM
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

async function main() {
  console.log(await runNode(['-p', '6 * 7']));
  const failed = await runNode(['-e', 'console.error("bad"); process.exit(3)']);
  console.log({ code: failed.code, stderr: failed.stderr.trim(), timedOut: failed.timedOut });
  const slow = await runNode(['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 200 });
  console.log({ code: slow.code, signal: slow.signal, timedOut: slow.timedOut });
  const badFlag = await runNode(['--no-such-flag']);
  console.log({ code: badFlag.code, mentionsBadOption: badFlag.stderr.includes('bad option') });
}

main();
```

Output:

```text
{ code: 0, signal: null, stdout: '42\n', stderr: '', timedOut: false }
{ code: 3, stderr: 'bad', timedOut: false }
{ code: null, signal: 'SIGTERM', timedOut: true }
{ code: 9, mentionsBadOption: true }
```

The third result shows the convention from section 16: the child was ended by a signal, so `code` is `null` and `signal` is set. The fourth shows Node's own exit code 9 for an invalid argument.

</details>

### Task 3 (harder): a tiny grep
Build a CLI `grepish [-i] [-n] <text> [file...]` that prints the lines containing `<text>`. `-i` ignores case, `-n` puts the line number in front (`3:the line`). With several files, put the file name in front too (`file:3:the line`). With no files it reads standard input. Exit codes like `grep`: 0 if at least one line matched, 1 if nothing matched, 2 for a usage error or an unreadable file. Errors go to stderr. Then write a second script that tests it with `spawnSync`.

<details><summary>Hint</summary>

Use `util.parseArgs` with `allowPositionals: true`. The first positional is the text, the rest are files. For each source create a `readline` interface (`process.stdin` or `fs.createReadStream(file)`), loop with `for await`, and wrap it in `try/catch`: an unreadable file makes the loop throw an error with `err.code === 'ENOENT'`. Return the exit code from `main` and set `process.exitCode` at the bottom.

</details>

<details><summary>Solution</summary>

Save as `grepish.js`:

```js
#!/usr/bin/env node
// grepish: print the lines that contain a text. Exit 0 = found, 1 = nothing found, 2 = usage error or unreadable file.
const fs = require('node:fs');
const readline = require('node:readline');
const { parseArgs } = require('node:util');

const USAGE = 'Usage: grepish [-i] [-n] <text> [file...]   (reads standard input when no file is given)';

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: { ignoreCase: { type: 'boolean', short: 'i' }, number: { type: 'boolean', short: 'n' } },
      allowPositionals: true,
    });
  } catch (err) {
    console.error(`grepish: ${err.message}`);
    console.error(USAGE);
    return 2;
  }

  const [text, ...files] = parsed.positionals;
  if (text === undefined) {
    console.error(USAGE);
    return 2;
  }
  const { ignoreCase, number } = parsed.values;
  const needle = ignoreCase ? text.toLowerCase() : text;
  const sources = files.length > 0 ? files : ['-'];

  let found = false;
  let unreadable = false;
  for (const source of sources) {
    try {
      const input = source === '-' ? process.stdin : fs.createReadStream(source);
      const rl = readline.createInterface({ input, crlfDelay: Infinity });
      let lineNumber = 0;
      for await (const line of rl) {
        lineNumber++;
        const haystack = ignoreCase ? line.toLowerCase() : line;
        if (!haystack.includes(needle)) continue;
        found = true;
        const prefix = [files.length > 1 ? source : null, number ? lineNumber : null].filter((p) => p !== null);
        console.log(prefix.length > 0 ? `${prefix.join(':')}:${line}` : line);
      }
    } catch (err) {
      unreadable = true;
      console.error(`grepish: ${source}: ${err.code ?? err.message}`);
    }
  }
  if (unreadable) return 2;
  return found ? 0 : 1;
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
```

Save as `try-grepish.js` in the same folder and run `node try-grepish.js`:

```js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grepish-'));
const file = path.join(dir, 'poem.txt');
fs.writeFileSync(file, 'Roses are red\nViolets are blue\nRED is a color\n');

function grepish(args, input) {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'grepish.js'), ...args], { encoding: 'utf8', input });
  // Hide the random temp folder name so the output is the same on every run.
  return JSON.stringify({ status: r.status, stdout: r.stdout, stderr: r.stderr.trim().replaceAll(dir, '<dir>') });
}

console.log('file, case-sensitive:', grepish(['red', file]));
console.log('file, -i -n:         ', grepish(['-i', '-n', 'red', file]));
console.log('stdin:               ', grepish(['blue'], 'one\nblue sky\n'));
console.log('no match:            ', grepish(['green', file]));
console.log('missing file:        ', grepish(['red', path.join(dir, 'nope.txt')]));
console.log('no arguments:        ', grepish([]));
console.log('unknown flag:        ', grepish(['-x', 'red']));

fs.rmSync(dir, { recursive: true, force: true });
```

Output:

```text
file, case-sensitive: {"status":0,"stdout":"Roses are red\n","stderr":""}
file, -i -n:          {"status":0,"stdout":"1:Roses are red\n3:RED is a color\n","stderr":""}
stdin:                {"status":0,"stdout":"blue sky\n","stderr":""}
no match:             {"status":1,"stdout":"","stderr":""}
missing file:         {"status":2,"stdout":"","stderr":"grepish: <dir>\\nope.txt: ENOENT"}
no arguments:         {"status":2,"stdout":"","stderr":"Usage: grepish [-i] [-n] <text> [file...]   (reads standard input when no file is given)"}
unknown flag:         {"status":2,"stdout":"","stderr":"grepish: Unknown option '-x'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- \"-x\"\nUsage: grepish [-i] [-n] <text> [file...]   (reads standard input when no file is given)"}
```

The stderr for a missing file shows `\\n` because the path is separated with a backslash on Windows and then JSON-escaped. On Linux and macOS it would read `<dir>/nope.txt`. The unknown-flag message is Node's own text from `util.parseArgs`; the unbalanced quote at the end of its first sentence is how Node 24.16 prints it, and the wording can change between Node versions, so tests should match a short part of it (like `Unknown option '-x'`).

</details>

## Where to go next
- Next lesson: [16. Testing Node.js Code](../16-testing/README.md). The `check()` function in `10-test-the-cli.js` is a tiny version of what `node:test` gives you.
- Practise this topic in the interview rounds: [round 1 screening](../../rounds/round-1-screening/questions.md) for `process.argv`, `process.env` and exit codes, [round 2 core](../../rounds/round-2-core/questions.md) for `exec` vs `spawn` vs `fork`, signals and graceful shutdown, [round 3 coding](../../rounds/round-3-coding/questions.md) for small CLIs and stdin processing, and [round 4 advanced](../../rounds/round-4-advanced/questions.md) for IPC, process versus thread trade-offs and cross-platform behavior.
- Related lessons: [18. worker_threads, cluster and Scaling on One Machine](../18-worker-threads-and-cluster/README.md) for threads versus processes, and [24. Production, Deployment and Observability](../24-production-and-deployment/README.md) for graceful shutdown in containers.
- Run all the examples of this lesson at once: `node scripts/check-examples.js 15-processes-and-cli --verbose`.
