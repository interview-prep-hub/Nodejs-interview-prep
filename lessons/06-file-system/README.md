# 06. The File System (fs)

> Level: Beginner   Time: about 150 minutes   Node: 24 (notes where older versions differ)

[Previous: 05. Core Modules Tour: path, os, util, url, readline and More](../05-core-modules-tour/README.md) | [All lessons](../../README.md) | [Next: 07. Asynchronous JavaScript: Callbacks, Promises and async/await](../07-async-javascript/README.md)

## What you will learn

- The three ways to call `fs` (sync, callback, promises) and when to use each one.
- How to read, write, append and truncate files, and what encodings and flags mean.
- How to work with folders: create, list, walk, copy, move and delete.
- How to ask about a file with `stat`, and how to check "does it exist?" without a race condition.
- Links, permissions, and what is different on Windows.
- File descriptors and `FileHandle`, and why you must always close them.
- Safe patterns: JSON config helpers, atomic writes, error handling and a path traversal guard.
- Watching files, finding files with glob, and what the thread pool does for `fs`.

All the code is in [examples/](examples/). Run every example from the repo root, for example `node lessons/06-file-system/examples/01-three-flavours.js`. Each one works inside a temporary folder (made with `mkdtemp` in the OS temp folder) and deletes it at the end, so nothing is left behind.

The outputs below were produced on Windows 11 with Node 24.16. Lines that depend on the operating system are marked. **POSIX** is the standard that Linux and macOS follow, so "on POSIX" below means "on Linux and macOS". Many snippets use `await`: in a CommonJS file they must sit inside an `async function`, as in the example files (in an `.mjs` file, top-level `await` works).

## 1. The fs module and its three flavours

`fs` is the built-in module that talks to the file system: it reads, writes, lists, copies and deletes files and folders. Nothing to install.

It has three flavours because it grew over time. The callback and sync versions are the oldest. The promise versions came later so that `async/await` works. You will see all three in real code, so you must know them. Two words first (lesson [07](../07-async-javascript/README.md) explains them fully):

- A **callback** is a function you hand to Node: "call this when the work is done".
- A **promise** is an object that stands for a result that has not arrived yet. `await` pauses *your function* (not the whole program) until the result is there.

| Flavour | Import | Example | How an error arrives | Blocks the program? |
|---|---|---|---|---|
| Sync | `require('node:fs')` | `fs.readFileSync(file, 'utf8')` | thrown, catch it with `try/catch` | Yes |
| Callback | `require('node:fs')` | `fs.readFile(file, 'utf8', (err, text) => {})` | first argument of the callback | No |
| Promises | `require('node:fs/promises')` | `await fsp.readFile(file, 'utf8')` | rejected promise, `try/catch` around `await` | No |

How to tell them apart: sync functions end with `Sync` (`readFileSync`). Callback and promise functions share the plain name (`readFile`); the callback one takes a callback as its last argument, and the promise one comes from `node:fs/promises`. The object `fs.promises` is the very same object.

```js
const fs = require('node:fs');
const fsp = require('node:fs/promises');

// 1. Synchronous: the program waits here until the disk is done.
fs.writeFileSync(file, 'written by the sync API');
console.log('sync     :', fs.readFileSync(file, 'utf8'));

// 2. Callback: the call returns at once, the callback runs later.
console.log('callback : before the call');
fs.readFile(file, 'utf8', (err, text) => {
  console.log('callback : inside the callback ->', text);
});
console.log('callback : after the call (the file is NOT read yet)');

// 3. Promises: same work, but you can use await.
await fsp.writeFile(file, 'written by the promise API');
console.log('promises :', await fsp.readFile(file, 'utf8'));
```

This is trimmed. The real file, [01-three-flavours.js](examples/01-three-flavours.js), wraps the callback in a `Promise` so the script can wait for it. Output (the thread pool lines at the end of the file come in section 18):

```text
sync     : written by the sync API
callback : before the call
callback : after the call (the file is NOT read yet)
callback : inside the callback -> written by the sync API
promises : written by the promise API
same object: true
promisify  : written by the promise API
cancelled  : AbortError
sync error     : ENOENT
callback error : ENOENT
promise error  : ENOENT
```

Why this output? The callback line "inside the callback" prints after "after the call". Node hands the read to the background and keeps running your code. When the file is ready, it calls your function. The last three lines show the same missing-file problem arriving as a thrown error, a callback argument and a rejected promise. `ENOENT` is the error code for "no such file or directory" (section 8).

Two extras from the same example:

- `util.promisify(fs.readFile)` turns any error-first callback function into a promise function (the `promisify` line). You rarely need it for `fs`, because `node:fs/promises` already exists, but it works for older libraries too.
- Several promise functions, such as `readFile` and `writeFile`, accept `{ signal }` from an `AbortController`. An aborted signal makes the promise reject with `AbortError` (the `cancelled` line; the example aborts before the call so the output is stable).

```js
const { promisify } = require('node:util');

const readFileAsync = promisify(fs.readFile); // callback function -> promise function
console.log('promisify  :', await readFileAsync(file, 'utf8'));

const ac = new AbortController();
ac.abort(); // cancel before we even start
try {
  await fsp.readFile(file, { signal: ac.signal });
} catch (err) {
  console.log('cancelled  :', err.name);
}
```

### Sync or async? A simple rule

Node runs your JavaScript on one thread. A scheduler called the **event loop** (lesson [08](../08-event-loop/README.md)) decides which piece of JavaScript runs next. While `readFileSync` waits for the disk, nothing else can run: no timers, no other requests.

| Situation | Use |
|---|---|
| A server handling requests, or any code that runs while other work is waiting | Promises (or callbacks). Never `Sync`. |
| Startup code that runs once before the server starts (read config, load a certificate) | `Sync` is fine and simpler |
| Small command line tools, build scripts, test setup | `Sync` is fine |
| Many files at the same time | Promises with `Promise.all`, with a limit (section 16) |
| Very big files | Streams (section 13) |

> **Interview tip:** "Why is `fs.readFileSync` bad inside a request handler?" A strong answer: it blocks the event loop. If the read takes 50 ms, every other request waits 50 ms too, so throughput drops and latency spikes under load. Then add when it is fine: before `listen()`, or in a script that does nothing else. Even `require()` reads files synchronously, which is why modules are loaded at startup.

## 2. Where is the file? Paths, cwd and `__dirname`

A path says where a file is. An absolute path starts at the root (`C:/data/a.txt` or `/home/me/a.txt`). A relative path (`a.txt`, `./data/a.txt`) is measured from the **current working directory** (cwd): the folder you were in when you started `node`. `process.cwd()` tells you which one.

That is a trap. Run `node src/app.js` from the project root, or `cd src` and run `node app.js`: the same relative path now points to two different places. The fix is to build paths from `__dirname`, the folder of the current file.

```js
const path = require('node:path');

const configPath = path.join(__dirname, 'config.json'); // always next to this file
```

Part of the output of [12-errors-and-safe-paths.js](examples/12-errors-and-safe-paths.js):

```text
relative path uses cwd : true
__dirname based path   : finds this very file
same as __filename     : true
```

Rules:

- Use `path.join` and `path.resolve` (lesson [05](../05-core-modules-tour/README.md)) instead of gluing strings with `/` or `\`.
- In ES modules `__dirname` does not exist. Use `import.meta.dirname` (Node 20.11+), or a file URL: `new URL('./data.txt', import.meta.url)`. `fs` functions accept a `URL` object that starts with `file:` wherever they take a path.
- In docs and code use forward slashes. Node on Windows accepts them.

> **Interview tip:** "What is the difference between `__dirname` and `process.cwd()`?" `__dirname` is the folder of the file being run: it never changes. `process.cwd()` is the folder the process was started from: it changes with how you launch it. `fs.readFile('./data.json')` works on your laptop and fails under a process manager or a cron job, because their cwd is different. Anchor on `__dirname`, or take the path from configuration.

## 3. Reading and writing whole files

Three functions cover most needs:

| Function | What it does |
|---|---|
| `readFile(path, encoding)` | Reads the whole file |
| `writeFile(path, data)` | Creates the file, or **replaces** it completely |
| `appendFile(path, data)` | Adds to the end, creates the file if needed |

Each has a sync twin (`readFileSync`, `writeFileSync`, `appendFileSync`) and a promise version. This section uses the promise version. Source: [02-read-write-append.js](examples/02-read-write-append.js).

```js
await fsp.writeFile(file, 'caf\u00e9'); // "cafe" with an accent: 4 characters
const asBuffer = await fsp.readFile(file); // no encoding -> Buffer
const asText = await fsp.readFile(file, 'utf8'); // with encoding -> string
console.log('Buffer :', asBuffer);
console.log('string :', asText.length, 'characters,', asBuffer.length, 'bytes');
console.log('hex    :', await fsp.readFile(file, 'hex'));
console.log('base64 :', await fsp.readFile(file, 'base64'));
```

```text
Buffer : <Buffer 63 61 66 c3 a9>
string : 4 characters, 5 bytes
hex    : 636166c3a9
base64 : Y2Fmw6k=
```

A file is just bytes. A `Buffer` is Node's container for raw bytes (lesson [10](../10-buffers/README.md)). If you pass an **encoding**, Node decodes the bytes into a string. If you do not, you get the Buffer. `utf8` is the usual choice for text. Other encodings: `hex`, `base64`, `latin1`, `utf16le`.

Why 4 characters but 5 bytes? UTF-8 is the standard way to store text as bytes, and in it the letter `é` needs two bytes (`c3 a9`). A string's `length` counts characters, a Buffer's `length` counts bytes.

Writing and appending:

```js
await fsp.writeFile(file, 'first');
await fsp.writeFile(file, 'second');          // replaces
console.log('after two writeFile calls:', await fsp.readFile(file, 'utf8'));

await fsp.appendFile(file, '\nthird');        // adds to the end
console.log('append  :', JSON.stringify(await fsp.readFile(file, 'utf8')));

await fsp.appendFile(logFile, 'line 1\n');    // creates the file the first time
await fsp.appendFile(logFile, 'line 2\n');
console.log('log.txt :', JSON.stringify(await fsp.readFile(logFile, 'utf8')));
```

```text
after two writeFile calls: second
append  : "second\nthird"
log.txt : "line 1\nline 2\n"
```

(`JSON.stringify` is only used here to show the `\n` characters.)

Things interviewers like to ask:

- **No encoding gives a Buffer, not a string.** `console.log(buffer)` prints `<Buffer ...>`, and `buffer.length` is a byte count. Pass `'utf8'` (or call `buffer.toString()`).
- **`writeFile` replaces the whole file.** For a log, use `appendFile`.
- **Do not start two `writeFile` calls on the same file at the same time.** The docs say it is unsafe. Await the first one, or use one write stream.
- **`readFile` puts the whole file in memory.** A file of 2 GiB or more is refused with `ERR_FS_FILE_TOO_LARGE` (checked on Node 24.16: 2 GiB minus 1 byte was read, 2 GiB was refused). With an encoding there is a second limit: a JavaScript string holds about 512 MiB (`buffer.constants.MAX_STRING_LENGTH` is 536870888), so a bigger file read as `'utf8'` fails with `Invalid string length`. Use streams for big files (section 13).
- Writing a `Buffer` (or `Uint8Array`) writes the raw bytes and ignores any encoding option.

> **Remember:** Reading text is always two steps in your head: bytes on disk, then decoding them with an encoding. Most "weird characters" bugs are a wrong or missing encoding.

## 4. Flags: how a file is opened (`r`, `w`, `a`, `wx`)

Every read or write opens the file in a **mode**, chosen by a *flag* string. `readFile` uses `r`, `writeFile` uses `w`, `appendFile` uses `a`. You can change it with the `flag` option.

| Flag | Meaning | File missing | File exists |
|---|---|---|---|
| `r` | read only | error `ENOENT` | opens it |
| `r+` | read and write | error `ENOENT` | opens it, content kept |
| `w` | write | created | **emptied first** |
| `w+` | read and write | created | emptied first |
| `wx` | write, only if new (`x` means exclusive) | created | error `EEXIST` |
| `a` | append: writes always go to the end | created | content kept |
| `a+` | read and append | created | content kept |
| `ax` | append, only if new | created | error `EEXIST` |

```js
await fsp.writeFile(file, 'with flag a', { flag: 'a' }); // same as appendFile

try {
  await fsp.writeFile(file, 'overwrite?', { flag: 'wx' });
} catch (err) {
  console.log("flag 'wx' on existing file ->", err.code);
}
```

```text
flag 'a': "second\nthirdwith flag a"
flag 'wx' on existing file -> EEXIST
flag 'wx' on a new file    -> ok
flag 'r+' on missing file -> ENOENT
```

`wx` is useful: it checks "does it exist?" and creates the file in **one step**, so there is no gap for another program to sneak in (section 7).

### truncate

`truncate(path, length)` cuts a file to `length` bytes. A bigger length stretches the file and fills the new part with zero bytes. No length means 0.

```js
await fsp.writeFile(file, '0123456789');
await fsp.truncate(file, 4);  // keep the first 4 bytes
await fsp.truncate(file, 6);  // stretch: two zero bytes are added
await fsp.truncate(file);     // no length means 0
```

```text
truncate to 4  : 0123
truncate to 6  : <Buffer 30 31 32 33 00 00>
truncate to 0  : size is 0
```

> **Common mistake:** Using `w` when you meant `a`. With `w` the old content is gone the moment the file is opened, even if your write fails later.

## 5. Directories

Source: [03-directories.js](examples/03-directories.js).

| Task | Function |
|---|---|
| Make a folder | `mkdir(path)` |
| Make a folder and all missing parents | `mkdir(path, { recursive: true })` |
| List names | `readdir(path)` |
| List names with type info | `readdir(path, { withFileTypes: true })` |
| List everything below, all levels | `readdir(path, { recursive: true })` |
| Make a unique temp folder | `mkdtemp(prefix)` |
| Delete an empty folder | `rmdir(path)` |
| Delete a folder and everything in it | `rm(path, { recursive: true, force: true })` |

```js
try {
  await fsp.mkdir(path.join(root, 'a', 'b', 'c')); // parents do not exist
} catch (err) {
  console.log('mkdir without recursive ->', err.code);
}
await fsp.mkdir(path.join(root, 'a', 'b', 'c'), { recursive: true }); // makes every missing parent
await fsp.mkdir(path.join(root, 'a', 'b', 'c'), { recursive: true }); // already there: no error
console.log('mkdir recursive twice -> ok');

try {
  await fsp.mkdir(path.join(root, 'a')); // already there, and no recursive
} catch (err) {
  console.log('mkdir existing folder ->', err.code);
}
```

```text
mkdir without recursive -> ENOENT
mkdir recursive twice -> ok
mkdir existing folder -> EEXIST
```

`recursive: true` does two things: it creates the missing parents, and it does **not** complain when the folder already exists. That makes it the safe way to say "make sure this folder is there". (It returns the first folder it created, or `undefined` if nothing was created.)

### Listing

```js
console.log('readdir            :', (await fsp.readdir(root)).sort());

const entries = await fsp.readdir(root, { withFileTypes: true });
for (const entry of entries.sort((x, y) => x.name.localeCompare(y.name))) {
  console.log('  entry', entry.name, '| folder:', entry.isDirectory(), '| file:', entry.isFile());
}

const all = await fsp.readdir(root, { recursive: true });
```

```text
readdir            : [ 'a', 'top.txt' ]
  entry a | folder: true | file: false
  entry top.txt | folder: false | file: true
readdir recursive  : [ 'a', 'a/b', 'a/b/c', 'a/b/two.txt', 'a/one.txt', 'top.txt' ]
only the files     : [ 'a/b/two.txt', 'a/one.txt', 'top.txt' ]
```

- `readdir` returns only names. With `withFileTypes: true` it returns **`Dirent`** objects (directory entries) that know their own type, so you do not need an extra `stat` call per file.
- The order is decided by the operating system. **Sort** when you need a stable order.
- With `recursive: true` the names are paths relative to the folder you listed, written with the OS separator (`\` on Windows, which the example converts to `/` for printing). Combined with `withFileTypes`, each `Dirent` has `name` and `parentPath` (the folder it lives in). The old `dirent.path` is gone on Node 24 (it is `undefined`), so use `parentPath`.
- For a huge folder, `fsp.opendir()` gives the entries one by one (you loop over them with `for await`) instead of one big array.

### Removing

```js
try {
  await fsp.rmdir(path.join(root, 'a')); // rmdir only removes EMPTY folders
} catch (err) {
  console.log('rmdir on a full folder ->', err.code);
}
await fsp.rm(path.join(root, 'a'), { recursive: true });              // the folder and everything inside
console.log('after rm recursive :', (await fsp.readdir(root)).sort());
await fsp.rm(path.join(root, 'a'), { recursive: true, force: true }); // already gone: no error
console.log('rm with force on a missing path -> ok');
```

```text
rmdir on a full folder -> ENOTEMPTY
after rm recursive : [ 'top.txt' ]
rm with force on a missing path -> ok
```

`rmdir` only removes **empty** folders. To remove a whole tree use `rm` with `recursive: true`. `force: true` means "no error if it is already gone". Together they replace the old `rimraf` package.

> **Common mistake:** `fs.rmdir(dir, { recursive: true })` still exists on Node 24 but prints a deprecation warning (DEP0147), and the option was removed in Node 25. Use `fs.rm`. On Windows, antivirus or an editor can hold a file open for a moment: `rm` accepts `maxRetries` and `retryDelay` to try again (they apply with `recursive: true`).

### Temporary folders

`mkdtemp(prefix)` creates a new folder whose name is your prefix plus 6 random characters, so it never clashes. Always create it inside `os.tmpdir()`. All examples in this course do this, and clean up in a `finally` block.

```js
const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'fs-dirs-'));
console.log('temp folder name has prefix + 6 chars:', path.basename(root).length === 'fs-dirs-'.length + 6);
```

```text
temp folder name has prefix + 6 chars: true
```

Node 24.4+ also has `fsp.mkdtempDisposable(prefix)`: with `await using tmp = ...` the folder is deleted automatically when the block ends.

> **Interview tip:** "What is the Node equivalent of `mkdir -p` and `rm -rf`?" `fsp.mkdir(dir, { recursive: true })` and `fsp.rm(dir, { recursive: true, force: true })`. Both are built in, so the old `mkdirp` and `rimraf` packages are not needed.

## 6. `stat` and `lstat`: asking about a file

`stat(path)` returns a **`Stats`** object with facts about a file or folder, without reading its content. Source: [04-stat-and-exists.js](examples/04-stat-and-exists.js).

| Field or method | Meaning |
|---|---|
| `isFile()`, `isDirectory()`, `isSymbolicLink()` | What kind of thing it is |
| `size` | Size in bytes |
| `mtime` / `mtimeMs` | Last time the **content** changed (a `Date` / milliseconds as a number) |
| `atime` | Last time it was accessed (often not updated, to save disk writes) |
| `ctime` | Last time the file's data **or metadata** (permissions, name) changed |
| `birthtime` | When it was created (not every file system stores it: the docs say the field may then hold `ctime` or the date 1970-01-01) |
| `mode` | File type bits plus permission bits (section 11) |
| `nlink` | Number of hard links (section 10) |
| `ino` | Inode number: the identity of the file data inside one disk |
| `uid`, `gid` | Owner and group (Linux and macOS) |

```js
const st = await fsp.stat(file);
console.log('isFile       :', st.isFile());
console.log('isDirectory  :', st.isDirectory());
console.log('size (bytes) :', st.size);
console.log('mtime is a Date :', st.mtime instanceof Date, '| mtimeMs is a number:', typeof st.mtimeMs === 'number');
console.log('mode (octal) :', st.mode.toString(8), '(file type bits + permission bits)');
console.log('nlink        :', st.nlink, '(number of hard links)');
console.log('stat on a folder -> isDirectory:', (await fsp.stat(dir)).isDirectory());

// The same facts are available on Dirent objects, without an extra stat call.
const [entry] = await fsp.readdir(dir, { withFileTypes: true });
console.log('Dirent says  :', entry.name, 'isFile =', entry.isFile());
```

```text
isFile       : true
isDirectory  : false
size (bytes) : 5
mtime is a Date : true | mtimeMs is a number: true
mode (octal) : 100666 (file type bits + permission bits)
nlink        : 1 (number of hard links)
stat on a folder -> isDirectory: true
Dirent says  : data.txt isFile = true
```

The `mode` value `100666` is what Windows reports. On Linux and macOS you will usually see `100644`.

- `stat` **follows** symbolic links. `lstat` looks at the link itself (section 10).
- Pass `{ bigint: true }` to get `size` and the time fields as `BigInt` when numbers could get too large.
- A missing path makes `stat` throw `ENOENT`. `statSync(path, { throwIfNoEntry: false })` returns `undefined` instead (sync version only).

> **Interview tip:** "`mtime` versus `ctime`?" `mtime` changes when the *content* is written. `ctime` also changes when only metadata changes (`chmod`, rename). Build tools compare `mtimeMs` to decide if a file is newer. Neither is the creation time: that is `birthtime`.

## 7. Does it exist? Why `fs.exists` is deprecated

The old function `fs.exists(path, callback)` is **deprecated** (documentation deprecation since Node 1.0). It has two problems:

1. Its callback gets only a boolean, with no `err` first argument. Every other Node callback is `(err, result)`. This breaks the normal pattern and hides real errors.
2. Checking first and using the file afterwards is a **race condition** (see below).

`fs.existsSync(path)` is not deprecated and is fine for a quick check at startup. The race condition still applies to it.

### The proper check: `access` or `stat`

```js
async function pathExists(p) {
  try {
    await fsp.access(p); // resolves if the path is there and reachable
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err; // EACCES and friends are real problems, do not hide them
  }
}
```

`access(path, mode)` checks if the path exists and, with a mode, whether you may read (`R_OK`), write (`W_OK`) or run (`X_OK`) it. It resolves with nothing, or rejects. Turning only `ENOENT` into `false` is important: other errors must stay visible.

```text
pathExists(file)    : true
pathExists(missing) : false
```

### The TOCTOU race

**TOCTOU** means *Time Of Check, Time Of Use*. You check, then you use, and between the two another program (or another request in your own server) changes things. The check was true, but the answer is already out of date.

```js
if (await pathExists(file)) {
  console.log('check says: the file exists');
  await fsp.rm(file); // pretend another program deletes it right now
  try {
    await fsp.readFile(file, 'utf8');
  } catch (err) {
    console.log('use fails anyway ->', err.code);
  }
}
```

```text
--- check, then use (WRONG) ---
check says: the file exists
use fails anyway -> ENOENT
--- just try it (RIGHT) ---
file is missing, so use the default value
'wx' refuses to overwrite -> EEXIST
```

The fix is to **do the real work and handle the error**:

```js
try {
  const text = await fsp.readFile(file, 'utf8');
  // use text
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
  // the file is missing: use a default
}
```

| You want to... | Do not | Do |
|---|---|---|
| Read a file if it is there | `exists` then `readFile` | `readFile` and catch `ENOENT` |
| Create a file only if it is new | `exists` then `writeFile` | `writeFile` with flag `wx`, catch `EEXIST` |
| Make sure a folder exists | `exists` then `mkdir` | `mkdir` with `recursive: true` |
| Delete a file that may be gone | `exists` then `unlink` | `rm` with `force: true` |

> **Interview tip:** "How do you check if a file exists in Node?" The best answer says: usually you should not. Open or read it and handle `ENOENT`, because a separate check is a race (TOCTOU). If you only need the answer (for example a marker file from another process), use `fs.promises.access` or `stat` and treat only `ENOENT` as "no". `fs.exists` is deprecated.

## 8. Errors: the codes you will meet

Every `fs` error is an `Error` with extra fields. Source: [12-errors-and-safe-paths.js](examples/12-errors-and-safe-paths.js).

```js
try {
  await fsp.readFile(p('nope.txt'));
} catch (err) {
  console.log('name    :', err.name);
  console.log('code    :', err.code);
  console.log('syscall :', err.syscall);
  console.log('errno   :', typeof err.errno, '(a number that depends on the OS)');
  console.log('path    :', path.basename(err.path));
}
```

```text
name    : Error
code    : ENOENT
syscall : open
errno   : number (a number that depends on the OS)
path    : nope.txt
```

Always branch on `err.code` (a stable string), never on the message text.

| Code | Meaning | Typical cause | What to do |
|---|---|---|---|
| `ENOENT` | No such file or directory | Wrong path, file not created yet, missing parent folder | Often expected: use a default, or `mkdir` the parent |
| `EEXIST` | Already exists | `mkdir` on an existing folder, `wx` flag, `COPYFILE_EXCL` | Often fine: ignore, or pick another name |
| `EACCES` | Permission denied | No right to read, write or enter | Report it; fix permissions; do not hide it |
| `EPERM` | Operation not permitted | Read-only file on Windows, protected file, or a file symlink without rights | Same as `EACCES` |
| `EISDIR` | Is a directory | `readFile` or `writeFile` on a folder | Check your path |
| `ENOTDIR` | Not a directory | `readdir` on a file (on POSIX systems also a file used as a folder inside a path) | Check your path |
| `ENOTEMPTY` | Directory not empty | `rmdir` on a folder that has content | Use `rm` with `recursive: true` |
| `EMFILE` | Too many open files | Leaked file descriptors, or opening thousands of files at once | Close handles; limit concurrency (below) |

Less common but good to know: `EBUSY` (resource busy, often a locked file on Windows), `EXDEV` (rename across two disks, section 9), `ENOSPC` (disk full), `ENFILE` (too many open files on the whole system), `EBADF` (using a descriptor that is closed).

The example causes five of them on purpose, plus a permission error:

```text
ENOENT    (no such file)     : ENOENT
EEXIST    (already exists)   : EEXIST
EISDIR    (is a folder)      : EISDIR
ENOTDIR   (not a folder)     : ENOTDIR
ENOTEMPTY (folder not empty) : ENOTEMPTY
EACCES/EPERM (not allowed)   : permission error
```

The last line is OS dependent: a write to a read-only file gives `EACCES` on Linux and macOS but `EPERM` on Windows, so the example prints "permission error" for both. Other codes differ too. For example, `rmdir` on a *file* gives `ENOENT` on Windows and `ENOTDIR` on POSIX (the docs say so; we saw `ENOENT` on Windows 11). Test the codes you depend on on the OS you deploy to. The table at the end of section 11 lists the differences in one place.

### A "missing is fine" helper

```js
async function readIfExists(file) {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err; // anything else is re-thrown
  }
}
```

```text
readIfExists(file)    : hello
readIfExists(missing) : null
readIfExists(folder)  : EISDIR
```

Handle only the codes you expect. A `catch {}` that swallows everything turns a permission problem into a silent bug.

### EMFILE: too many open files

Every open file uses a **file descriptor** (a small number the OS hands out, section 12), and a process may only have so many. You hit `EMFILE` when you forget to close handles, or when you start thousands of file operations at the same moment (for example `Promise.all(files.map(readFile))` over a huge list). Two fixes:

1. Close what you open (`try/finally`, or `await using`).
2. Limit how many run at once. Section 16 has a small `mapLimit` helper. The npm package `graceful-fs` is another common answer: it queues and retries after `EMFILE`.

> **Interview tip:** "You get `EMFILE` in production. What do you do?" Look for a leak or unbounded concurrency first, not a bigger limit. The limit depends on the OS and its settings (on Linux, `ulimit -n` shows it). Raising it is the last step, not the first.

## 9. Copy, move, rename and delete

Source: [05-copy-move-delete.js](examples/05-copy-move-delete.js).

| Task | Function | Notes |
|---|---|---|
| Copy one file | `copyFile(from, to)` | Overwrites the target unless you pass `COPYFILE_EXCL` |
| Copy a folder tree | `cp(from, to, { recursive: true })` | Added in 16.7, no longer experimental since 22.3 |
| Move or rename | `rename(from, to)` | Works for files and folders |
| Delete a file | `unlink(path)` | One file only |
| Delete anything | `rm(path, { recursive, force })` | Files and folders |

```js
await fsp.copyFile(p('a.txt'), p('b.txt'));              // copy (overwrites by default)
await fsp.copyFile(p('a.txt'), p('b.txt'), fsp.constants.COPYFILE_EXCL); // fail if the target exists
await fsp.cp(p('project'), p('backup'), { recursive: true });            // a folder needs recursive
await fsp.rename(p('a.txt'), p('renamed.txt'));          // rename and move are the same call

await fsp.unlink(p('y.txt'));                            // delete one file
await fsp.rm(p('y.txt'), { force: true });               // "make sure it is gone": no error if missing
await fsp.rm(p('backup'), { recursive: true, force: true }); // a folder and everything in it
```

This snippet is a list of the calls, not a script to run top to bottom: the `COPYFILE_EXCL` copy throws `EEXIST` because `b.txt` is already there, and the real example wraps the calls that fail on purpose in `try/catch`. Output of the whole example:

```text
copyFile       : content of a
copy overwrote : content of a
COPYFILE_EXCL  -> EEXIST
cp folder without recursive -> ERR_FS_EISDIR
cp recursive   : [ 'index.txt', 'src', 'src/main.txt' ]
after rename   : [ 'b.txt', 'backup', 'project', 'renamed.txt' ]
folder moved   : [ 'index.txt', 'src' ]
moveFile helper: [ 'index.txt', 'renamed.txt', 'src' ]
rename onto an existing file -> y.txt now holds: x
unlink         : done
unlink again   -> ENOENT
rm force on a missing file -> ok
rm folder without recursive -> ERR_FS_EISDIR
left over      : [ 'b.txt', 'moved-project' ]
```

Things to know:

- **There is no "move" function.** `rename` is the move. It is fast because it only changes the name in the directory, not the data.
- **`rename` silently replaces an existing file** at the target (see the `y.txt` line). Check first if that matters (with the race caveat from section 7).
- **`rename` cannot cross disks.** Moving from `C:` to `D:` fails with `EXDEV`. The example's `moveFile` helper falls back to copy plus delete. This branch cannot be triggered inside one temp folder, but it is the standard pattern.
- `cp` also accepts `filter` (a function that decides per path), `force` and `errorOnExist`.
- A folder needs `recursive: true` for both `cp` and `rm`, or you get `ERR_FS_EISDIR`.

> **Interview tip:** "How do you move a file in Node, and what can go wrong?" `fs.rename`. Then show depth: it silently replaces the target, it fails with `EXDEV` across disks (so you copy, then delete), and on one disk it is a single step, which is why the atomic write pattern in section 15 uses it.

## 10. Links: hard links and symbolic links

Source: [06-links-and-permissions.js](examples/06-links-and-permissions.js).

A file on disk has its data and one or more **names** that point to it.

- A **hard link** is a second name for the *same data*. Like one room with two doors: both lead to the same room.
- A **symbolic link** (symlink) is a tiny file that holds a *path*. Like a signpost saying "go to that other place".

| | Hard link | Symbolic link |
|---|---|---|
| Points to | The same file data (same inode) | A path (text) |
| Works for folders | No | Yes |
| Across disks | No | Yes |
| If the original name is deleted | The data survives under the other name | The link is left **dangling** (it points to nothing) |
| Create | `link(existing, newName)` | `symlink(target, path)` |

```js
await fsp.writeFile(p('original.txt'), 'shared data');
await fsp.link(p('original.txt'), p('hard.txt'));
const a = await fsp.stat(p('original.txt'));
const b = await fsp.stat(p('hard.txt'));
console.log('hard link: same inode?', a.ino === b.ino, '| nlink =', a.nlink);

await fsp.writeFile(p('hard.txt'), 'changed through the hard link');
console.log('hard link: original now reads:', await fsp.readFile(p('original.txt'), 'utf8'));

await fsp.unlink(p('original.txt')); // removes one name only
console.log('hard link: data survives under the other name:', await fsp.readFile(p('hard.txt'), 'utf8'));
```

```text
platform: win32
hard link: same inode? true | nlink = 2
hard link: original now reads: changed through the hard link
hard link: data survives under the other name: changed through the hard link
```

`unlink` does not "delete data". It removes one name. The data is freed when the last name is gone (and no program has it open).

### Symbolic links

```js
await fsp.symlink(p('real-folder'), p('folder-link'), 'junction');

const viaLstat = await fsp.lstat(p('folder-link')); // lstat looks at the link itself
const viaStat = await fsp.stat(p('folder-link'));   // stat follows the link
console.log('lstat says link? ', viaLstat.isSymbolicLink(), '| stat says link?', viaStat.isSymbolicLink());
console.log('stat says folder?', viaStat.isDirectory());
console.log('read through link:', await fsp.readFile(p('folder-link', 'file.txt'), 'utf8'));
```

```text
lstat says link?  true | stat says link? false
stat says folder? true
read through link: inside the real folder
readlink ends with: real-folder
realpath is the real folder: true
readdir kinds: [ 'folder-link:link', 'hard.txt:file', 'real-folder:dir' ]
file symlink: not allowed here -> EPERM
target still there: file.txt
```

- `lstat` describes the link; `stat` describes what it points to. `readlink` reads the stored path. `realpath` resolves a path through all links to the true location.
- `readdir` with `withFileTypes` reports links as links: `isSymbolicLink()` is true and `isDirectory()` is false. This is why a recursive walk that uses `Dirent` does not follow links and cannot loop forever.
- Removing a link never removes the target (the last line).

> **Under the hood (Windows):** The third argument of `symlink` (`'file'`, `'dir'` or `'junction'`) only matters on Windows. A *file* symlink there needs Developer Mode or an administrator shell, otherwise you get `EPERM`: that is the `file symlink` line above (produced on Windows 11 without Developer Mode). A *junction* is a folder link that needs no special rights. On Linux and macOS the type is ignored, and that line reads `created`.

> **Interview tip:** "Hard link versus symlink?" A hard link is a second name for the same data (same inode), a symlink is a small file holding a path. Delete the original: the hard link still works, the symlink dangles. Hard links cannot point at folders or cross disks. Symlinks can.

## 11. Permissions: `chmod` and mode bits

On Linux and macOS every file has three groups of permissions: for the **owner**, the **group** and **others**. Each group can have **r**ead (4), **w**rite (2) and e**x**ecute (1). Add the numbers for each group:

| Mode | Owner | Group | Others | Typical use |
|---|---|---|---|---|
| `0o644` | rw- (6) | r-- (4) | r-- (4) | normal file |
| `0o755` | rwx (7) | r-x (5) | r-x (5) | script or folder |
| `0o600` | rw- (6) | --- (0) | --- (0) | private key |
| `0o444` | r-- (4) | r-- (4) | r-- (4) | read-only |

```js
const modeOf = async (file) => ((await fsp.stat(file)).mode & 0o777).toString(8);

await fsp.chmod(secret, 0o444); // read-only for everybody
console.log('mode after chmod 444:', await modeOf(secret));

try {
  await fsp.writeFile(secret, 'new text');
} catch (err) {
  // Linux and macOS report EACCES, Windows reports EPERM.
  console.log('write to read-only file -> permission error:', err.code === 'EACCES' || err.code === 'EPERM');
}
```

```text
mode before chmod: 666
mode after chmod 444: 444
write to read-only file -> permission error: true
access read: yes
access write: no
mode after chmod 666: 666
```

- `mode & 0o777` keeps only the permission bits. `stat().mode` also holds the file type bits (the `100` at the start of `100666`).
- Write modes as octal literals: `0o644`. A plain `644` is the decimal number 644, which is a different, wrong mode.
- A new file is created with mode `0o666`, and on Linux and macOS the process **umask** (a setting that removes permission bits from every new file) takes some away; a common umask gives `0o644`. A new folder starts from `0o777`.
- `access(path, fs.constants.R_OK | fs.constants.W_OK)` asks the OS whether *this process* may read or write. Use `fs.constants.R_OK`. The old `fs.R_OK` style constants print a deprecation warning (DEP0176) on Node 24.
- If the process runs as root (Linux) or an administrator, permission checks may pass anyway.

> **Under the hood (Windows):** Windows does not use these mode bits. Node maps them onto one thing, the **read-only attribute**: `chmod` can only turn it on (write bits missing) or off. That is why the mode above prints `666` or `444` and nothing else. Real access control on Windows uses ACLs (access control lists), which `fs` does not expose.

### Windows versus Linux and macOS in one table

| Topic | Windows | Linux and macOS |
|---|---|---|
| Path separator | `\` (Node also accepts `/`) | `/` |
| Upper and lower case in names | Ignored by default (`A.TXT` finds `a.txt`) | Linux: matters. macOS: ignored by default |
| `chmod` and mode bits | Only the read-only flag (`666` or `444`) | Full read, write, execute bits for owner, group, others |
| `uid`, `gid` in `stat` | Always `0` | The real owner and group ids |
| Write to a read-only file | `EPERM` | `EACCES` |
| File symlink | Needs Developer Mode or an administrator, else `EPERM`. A folder junction needs no rights | No extra rights |
| `rename` over an existing file | Works, but can fail with `EPERM` or `EBUSY` while another program has the file open | Atomic replace |
| `rmdir` on a file | `ENOENT` | `ENOTDIR` |
| What `fs.watch` uses | `ReadDirectoryChangesW` | Linux: inotify. macOS: FSEvents and kqueue |

The Windows column was checked by running the examples on Windows 11. The Linux and macOS column comes from the Node documentation and normal POSIX behaviour and was not run here, so test it on your deployment OS.

> **Interview tip:** "What does `chmod 755` mean?" Owner can read, write and execute (7), group and others can read and execute (5). Say it as bits (4 read, 2 write, 1 execute). Then add: write it as `0o755` in JavaScript, and on Windows only the read-only flag has an effect.

## 12. File descriptors and `FileHandle`

When you open a file, the OS returns a **file descriptor** (fd): a small integer that stands for "this open file" in later calls. The OS allows only a limited number per process. So: **everything you open, you must close.**

The promise API wraps an fd in a **`FileHandle`** object. Source: [08-file-handles.js](examples/08-file-handles.js).

```js
const fh = await fsp.open(file, 'w+'); // read + write, create or empty the file
try {
  await fh.write('Hello, file handles!'); // writes at the current position
  const buf = Buffer.alloc(5);
  // read(buffer, offsetInBuffer, length, positionInFile)
  const { bytesRead } = await fh.read(buf, 0, 5, 7); // 5 bytes starting at file position 7
  console.log('read 5 bytes at position 7:', buf.toString('utf8', 0, bytesRead));

  await fh.write('J', 0); // overwrite the byte at position 0
  console.log('size from fh.stat():', (await fh.stat()).size);
  await fh.sync(); // ask the OS to flush to the disk (slow, use only when it matters)
} finally {
  await fh.close(); // ALWAYS close. Leaked descriptors cause EMFILE later.
}
```

```text
fd is an integer: true
stdout and stderr are descriptors too: 1 2
read 5 bytes at position 7: file 
size from fh.stat(): 20
after close, fd is: -1
file content now: Jello, file handles!
```

The second line shows that every process starts with three descriptors already open: 0 is stdin, 1 is stdout, 2 is stderr. Your files get the next free numbers.

Useful `FileHandle` methods: `read`, `write`, `readFile`, `writeFile`, `stat`, `truncate`, `sync`, `readLines`, `createReadStream`, `createWriteStream` and `close`. With a handle you can read or write at any *position* in the file, which `readFile` and `writeFile` cannot do. It is how databases and log readers work.

The example also reads the file in a loop with an 8-byte buffer: it keeps calling `read` with a growing position until `bytesRead` is 0, which means the end of the file. It prints `read 20 bytes in 3 chunks of up to 8 bytes`.

### Always close: three ways

1. `try/finally` with `await fh.close()` (above).
2. `await using` (Node 24, which has the newer JavaScript syntax for automatic cleanup): the handle closes when the block ends, even on errors.

   ```js
   {
     await using auto = await fsp.open(file, 'r');
     const { size } = await auto.stat();
     console.log('inside the block, size:', size);
   } // auto.close() is called here
   ```

   ```text
   inside the block, size: 20
   block finished, handle was closed for us
   ```

3. Use convenience functions (`readFile`, `writeFile`) when you do not need a handle: they open and close for you.

The classic API uses plain numbers: `fs.openSync`, `fs.readSync`, `fs.writeSync`, `fs.closeSync`. They do the same job without an object (`classic API read: Jello` in the example output).

Using a closed handle fails with `EBADF`:

```text
using a closed handle -> EBADF
```

> **Common mistake:** Forgetting to close a `FileHandle`. Node will close it for you when the object is garbage collected (cleaned up because nothing uses it any more), but it prints a warning (`Closing a FileHandle object on garbage collection is deprecated`, DEP0137), and a future version will throw instead. Do not rely on it.

> **Interview tip:** "What is a file descriptor?" A small integer the OS gives a process for each open file (also sockets and pipes). 0, 1 and 2 are stdin, stdout and stderr. The number per process is limited, so a leak ends in `EMFILE`.

## 13. Reading big files without eating memory

`readFile` loads the whole file into memory. For a 2 GB log that is a bad idea (and from 2 GiB up it is refused). Instead, read it **in pieces**. A *stream* gives you the file chunk by chunk. Source: [09-big-files.js](examples/09-big-files.js). Streams are the topic of lesson [11](../11-streams/README.md). Here are the three patterns you need now.

**Chunks** with `createReadStream`:

```js
let chunks = 0;
let bytes = 0;
for await (const chunk of fs.createReadStream(bigFile)) {
  chunks++;
  bytes += chunk.length; // chunk is a Buffer, 64 KiB at most by default
}
console.log(`read stream: ${chunks} chunks, ${bytes} bytes in total`);
```

**Lines** with `readline`:

```js
const rl = readline.createInterface({
  input: fs.createReadStream(bigFile),
  crlfDelay: Infinity, // treat \r\n as ONE line break
});
let lines = 0;
for await (const line of rl) lines++;
```

**A part of the file** with `start` and `end` (byte positions, both included):

```js
fs.createReadStream(bigFile, { start: 0, end: 19, encoding: 'utf8' });
```

```text
file size (bytes): 1288894
read stream: 20 chunks, 1288894 bytes in total
readline: lines = 50000 | last line = line 50000: some log text
first 20 bytes: "line 1: some log tex"
copy has the same size: true
readFile also finds 50000 lines, but needed the entire file in memory
```

The default chunk size of `createReadStream` is 64 KiB, so 1,288,894 bytes make 20 chunks (19 full ones and a smaller last one). Memory use stays small however large the file is.

To copy a big file, use `pipeline` from `node:stream/promises`. It connects the streams, handles errors and closes everything:

```js
await pipeline(fs.createReadStream(bigFile), fs.createWriteStream(copyPath));
```

`fh.readLines()` (on a `FileHandle`) is a shorter way to get lines when you already have a handle.

> **Interview tip:** "How do you process a 10 GB file in Node?" Streams (or `readline` over a stream), never `readFile`. Mention backpressure: when writing a lot, `write()` returns `false` when the buffer is full and you should wait for `drain` (the example does this while creating its file). `pipeline` does it for you.

## 14. JSON config helpers

Reading and writing JSON is the most common `fs` task. Wrap it in two small helpers so every caller handles the edge cases the same way. Source: [10-json-and-atomic-write.js](examples/10-json-and-atomic-write.js).

```js
// Read a JSON file. A missing file gives the fallback. A broken file gives a clear error.
async function readJson(file, fallback) {
  let text;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw err;
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, '')); // strip a BOM (byte order mark) if an editor added one
  } catch (err) {
    throw new Error(`Invalid JSON in ${path.basename(file)}: ${err.message}`);
  }
}

const writeJson = (file, value) => writeFileAtomic(file, JSON.stringify(value, null, 2) + '\n');
```

```text
missing file gives : { port: 3000, debug: false }
file on disk       : "{\n  \"port\": 8080,\n  \"debug\": true\n}\n"
after update       : { port: 8081, debug: true }
folder content     : [ 'config.json' ]
write into missing folder -> ENOENT
bad data -> ERR_INVALID_ARG_TYPE
config is still    : { port: 8081, debug: true }
folder content     : [ 'config.json' ]
broken JSON -> Invalid JSON in config.json
file with BOM      : { fromBom: true }
```

The two lines `write into missing folder` and `bad data` show failed writes (section 15).

Why each detail is there:

- A **missing file** is not an error for optional config: return defaults. Only `ENOENT` is handled; a permission error still throws.
- A **broken file** gets a message that names the file. A bare `Unexpected end of JSON input` does not tell you which of your ten files is wrong.
- A **BOM** is an invisible character (`U+FEFF`) that some Windows editors put at the start of a UTF-8 file. `JSON.parse` rejects it with `SyntaxError`, so strip it.
- `JSON.stringify(value, null, 2)` writes readable, indented JSON. The final `'\n'` keeps the file friendly to editors and diffs.
- `writeJson` uses the atomic write from the next section.

For configuration that never changes while the program runs, `require('./config.json')` also works. It reads the file once and **caches** it, so later edits are not seen.

### The lost update problem

Read-change-write is **not** safe when two things do it at the same moment. Both read the old value, both write, and one change disappears. In our test, three `readJson` / `count++` / `writeJson` sequences started together with `Promise.all` all read the old file, and the result was `count: 1`, not 3. On Windows the test can even fail with `EPERM`, because the three atomic writes (section 15) rename onto the same file at once.

Inside one process, run the updates one after another with a promise queue:

```js
let queue = Promise.resolve();

function updateJson(file, change) {
  const run = queue.then(async () => {
    const data = await readJson(file, {});
    change(data);
    await writeJson(file, data);
    return data;
  });
  queue = run.catch(() => {}); // one failure must not block the next update
  return run;
}

await Promise.all([1, 2, 3].map(() => updateJson(file, (d) => { d.count++; }))); // always 3
```

Between two processes you need a lock (for example a lock file created with `wx`) or, better, a real database (lesson [17](../17-databases-and-data-access/README.md)). Node has no built-in file lock function.

> **Interview tip:** "Two requests update the same JSON file at once. What happens?" A lost update. Fix it by queueing the updates inside one process, a lock file across processes, or a database. This is the same family of bug as the TOCTOU race in section 7.

## 15. Atomic writes: write a temp file, then rename

`writeFile` is **not atomic**. With flag `w` the file is emptied first and then filled. If the program crashes, is killed, or the power fails in between, you are left with an empty or half-written file. A reader at that moment also sees a partial file.

An **atomic** operation either happens completely or not at all. You can get that for writes with a classic pattern:

1. Write the new content to a **temporary file** in the same folder.
2. **Flush** it: make the OS really write its cached bytes to the disk now.
3. **Rename** the temporary file over the real one. A rename swaps the name in one step.

Readers see either the complete old file or the complete new file, never a mix.

```js
async function writeFileAtomic(file, data) {
  // The temp file must be in the SAME folder: rename is only atomic inside one file system.
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    const fh = await fsp.open(temp, 'wx'); // 'wx': never touch an existing file by accident
    try {
      await fh.writeFile(data);
      await fh.sync(); // push the bytes to the disk before the rename
    } finally {
      await fh.close();
    }
    await fsp.rename(temp, file); // swap in the new file in one step
  } catch (err) {
    await fsp.rm(temp, { force: true }); // do not leave temp files behind
    throw err;
  }
}
```

The example output in section 14 shows that failures are clean. The first failure (a missing folder) happens before any file exists. The second (`bad data`, an object that is not a string or Buffer) happens after the temp file was created: the `catch` removes it. In both cases the folder holds only `config.json`, and its content is unchanged.

Details that matter:

- **Same folder, same disk.** `rename` across disks fails with `EXDEV` (section 9) and is no longer a single step.
- **A unique temp name** (here a random UUID) so two writers do not collide. The `wx` flag makes a collision an error instead of silent damage.
- **Flush before rename.** Without `sync`, a power loss could leave a renamed but empty file. `writeFile` also accepts `{ flush: true }` (Node 20.10+) to do this for you. Programs that must survive a crash, such as databases, also flush the *folder* after the rename on Linux, so the rename itself is not lost. A config file rarely needs that.
- **POSIX versus Windows.** On POSIX, `rename` over an existing file is atomic. On Windows it works well in practice, but it can fail with `EPERM` or `EBUSY` if another program (antivirus, an editor) has the target open, or if two writers rename onto it at the same moment. Production code often retries a few times.
- **The new file is a different file.** Its owner and permissions are those of the new file, not a copy of the old ones. Use `chmod` if they matter.

> **Interview tip:** "How do you update a config file safely?" Say "write to a temp file in the same directory, flush it (fsync), then rename over the target". Add why plain `writeFile` is unsafe (it truncates first), and that `rename` is atomic on the same file system.

## 16. Finding files: recursive walk and `fs.glob`

Source: [11-glob-and-walk.js](examples/11-glob-and-walk.js). The example builds a small project in a temp folder with six files: `index.js`, `README.md`, `src/app.js`, `src/util/helpers.js`, `src/util/notes.txt` and `node_modules/lib/index.js`.

Three ways to find files:

| Way | Good for | Notes |
|---|---|---|
| `readdir(dir, { recursive: true })` | Quick lists | Returns files **and** folders, includes `node_modules`, no way to skip a folder |
| A hand-written walk | Full control | Skip folders, stop early, run logic per file |
| `fs.glob` / `fs.globSync` / `fsp.glob` | Patterns like `**/*.js` | Added in Node 22.0.0, stable since 24.0.0. Not in Node 20 or older. |

### fs.glob

```js
console.log(fs.globSync('**/*.js', { cwd: root }));   // sync: returns an array
console.log(fs.globSync('src/*', { cwd: root }));

const noModules = fs.globSync('**/*.js', { cwd: root, exclude: (name) => name === 'node_modules' });

for await (const match of fsp.glob('**/*.{md,txt}', { cwd: root })) console.log(match); // promises: async iterator
```

```text
glob **/*.js              index.js, node_modules/lib/index.js, src/app.js, src/util/helpers.js
glob src/*                src/app.js, src/util
glob without modules      index.js, src/app.js, src/util/helpers.js
glob (promises) md/txt    README.md, src/util/notes.txt
readdir recursive count   10 (files and folders)
```

Pattern basics:

- `*` matches any name part inside one folder, `**` matches any number of folders, `?` matches one character, `{a,b}` matches either.
- `exclude` is called with the name of each entry. Returning `true` for a folder stops glob going inside it. On Node 24 it can also be an array of glob patterns (`exclude: ['node_modules']`).
- Results are relative to `cwd` and use the OS separator (the example prints them with `/`).
- There is also `withFileTypes: true`, and a callback version, `fs.glob(pattern, options, callback)`. On Node 22 and 23 the whole feature was still marked experimental.

### A hand-written walk

```js
async function* walk(dir, { skip = [] } = {}) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (skip.includes(entry.name)) continue; // for example node_modules or .git
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full, { skip });
    } else if (entry.isFile()) {
      yield full;
    }
  }
}
```

An `async function*` is an *async generator*: it produces values one at a time and you consume them with `for await`. `yield*` hands over to the inner call for the sub-folder.

```text
walk, skip modules        README.md, index.js, src/app.js, src/util/helpers.js, src/util/notes.txt
```

Because `Dirent.isDirectory()` is `false` for a symlink, this walk never follows links, so a link loop cannot trap it.

> **Interview tip:** "List every `.js` file in a project, but skip `node_modules`." Use `fs.globSync` (Node 22+) with `exclude`, or a walk built on `readdir` with `withFileTypes`. Say why not plain `readdir({ recursive: true })`: it cannot skip a folder, so it walks all of `node_modules` first. The walk also shows you can write an async generator.

### Doing work on many files: a concurrency limit

`Promise.all(files.map(stat))` starts every call at once. With 100,000 files that can hit `EMFILE`. Run at most N at the same time:

```js
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
```

`limit` workers each take the next unprocessed item until the list is empty. `next++` is safe because JavaScript is single-threaded and there is no `await` between reading and incrementing it.

```text
total bytes               48
max stat calls at once    2 (never above the limit of 2)
```

## 17. Watching files: `fs.watch` (and `node --watch`)

`fs.watch(path, listener)` tells you when something in a file or folder changes. It asks the operating system for notifications, so it does not poll (ask again and again). Source: [07-watch.js](examples/07-watch.js).

```js
const watcher = fs.watch(dir, (eventType, filename) => {
  events.push({ eventType, filename });
  reload(); // a debounced function, see below
});
watcher.on('error', (err) => console.log('watcher error:', err.code));

// ... do some writes ...
watcher.close(); // always close a watcher, or it keeps the process alive
```

The listener gets an `eventType` that is either `'rename'` (a name appeared, disappeared or changed) or `'change'` (content changed), and the `filename`.

```text
file operations we did : 3
got at least one event : true
events for these names : [ 'watched.txt' ]
event types are only rename/change: true
debounced reloads      : 1 (one burst became one reload)
(the raw event count differs between operating systems, so we do not print it)
promise watch saw      : second.txt
```

The example does not print the raw event count because it is **not reliable**. This is the heart of the interview answer:

- **The API is not consistent across platforms** (the docs say so). Linux uses inotify, macOS uses FSEvents and kqueue, Windows uses `ReadDirectoryChangesW`.
- **One action can produce several events.** Creating and writing a file often gives a `rename` and one or more `change` events. Editors that save by "write temp file, rename" add more.
- **`filename` is not always provided** (it can be `null` on some platforms). Do not depend on it.
- **Events can be missed or may not arrive at all** on network file systems (NFS, SMB) and in virtual machines or containers with shared folders (Docker bind mounts, Vagrant).
- **Windows:** no event is sent if the watched folder is moved or renamed, and deleting it gives an `EPERM` error on the watcher.
- **`recursive: true`** watches all sub-folders. It is native on Windows and macOS. Linux support was added in Node 19.1.
- It does not tell you *what* changed inside a file. The docs also say the API gives no protection against malicious actions on the file system.

So: treat an event as a hint "something may have changed". Then **debounce** (wait for a quiet moment) and **look at the real state** (`stat` the file, re-read it).

```js
// Debounce: run fn only after `ms` of silence. One burst of events becomes one call.
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
```

The promise version, `fsp.watch(dir, { signal })`, is an async iterator that you stop with an `AbortController`:

```js
const ac = new AbortController();
for await (const event of fsp.watch(dir, { signal: ac.signal })) {
  if (event.filename === 'second.txt') break; // or call ac.abort() from somewhere else
}
```

Other details: `fs.watchFile` **polls** the file's `stat` (default every 5007 ms) and works where `watch` does not, but is slower and less efficient. Pass `persistent: false` to `fs.watch` if the watcher alone should not keep the process alive.

### `node --watch` is something else

```bash
node --watch app.js
```

`node --watch` (stable since Node 22.0.0 and 20.13.0) **restarts your whole program** when an imported file changes. It is a development tool that replaces `nodemon`. Use `--watch-path` to watch extra folders. It is not a way to react to file changes inside a running program: that is `fs.watch`. In production you do not use `--watch`.

> **Interview tip:** "How would you reload a config file when it changes?" Use `fs.watch` on it (or its folder, because editors replace files), debounce, re-read and validate the new content, and keep the old config if the new one is invalid. Mention the platform caveats, and that a periodic `stat` check of `mtimeMs` is the fallback. Libraries such as chokidar wrap these differences.

## 18. Under the hood: the thread pool

Your JavaScript runs on one thread, but the file system calls do not have to. Node uses a C library called **libuv**, which keeps a **thread pool**: a small group of worker threads, 4 by default. This is what happens when you call `fsp.readFile` or the callback `fs.readFile`:

```ascii
your JavaScript (main thread)          libuv thread pool (4 threads)
-----------------------------          ------------------------------
fsp.readFile(file)  ----------------->  a free thread does the blocking read
  returns a promise at once             (open, read, close)
  ... other code keeps running ...
                      <---------------  done: result queued for the event loop
promise resolves / callback runs
```

- **Async `fs` calls** (callbacks, promises, `FileHandle` methods) are done by a pool thread. Your main thread stays free.
- **Sync calls** (`readFileSync`) run on the main thread and block it.
- **`fs.watch`** does not use the pool. It waits for notifications from the operating system.
- The pool is **shared**. `dns.lookup`, `zlib`, and some `crypto` functions (`pbkdf2`, `scrypt`, `randomBytes`) use it too. If 4 slow jobs fill it, file operations wait in line.
- The size is `UV_THREADPOOL_SIZE` (default 4). Set it in the environment before starting `node`: `UV_THREADPOOL_SIZE=8 node app.js` in bash, `$env:UV_THREADPOOL_SIZE=8; node app.js` in PowerShell. Setting it inside the script is not guaranteed to work (the docs say so).

Part 4 of [01-three-flavours.js](examples/01-three-flavours.js) shows it. It keeps the pool busy with `crypto.pbkdf2` jobs and measures how long a plain `fsp.stat` takes:

```text
stat, idle pool           : fast -> true
stat, 4 of 4 threads busy : had to wait -> true
stat, 3 of 4 threads busy : fast -> true
```

When all 4 threads are busy, even a tiny `stat` waits for a job to finish (about the length of one job here). With one thread free, it is fast again. The program prints true/false comparisons against the length of one job, so it stays stable on different machines. It assumes the default pool size, and it can wobble on a very slow machine or one with only one or two CPU cores.

> **Interview tip:** "Is Node.js single-threaded?" Better answer: JavaScript runs on one thread, but Node has a thread pool for blocking work such as file system calls, DNS lookups, compression and some crypto, and the OS does network I/O without threads. Follow-up: "Why can a slow `pbkdf2` slow down file reads?" Because they share the same 4 threads. Lesson [08](../08-event-loop/README.md) (section 6) shows the pool in more detail.

## 19. Security: path traversal

If a path comes from a user (a URL, a form field, a query string, an uploaded name) you must not pass it straight to `fs`. Otherwise `../../` climbs out of your folder:

```js
// DANGEROUS: name comes from the user
const text = await fsp.readFile(path.join('/srv/public', name));
// name = '../../etc/passwd' reads a file outside /srv/public
```

This attack is called **path traversal** (or directory traversal). The defense is to resolve the final path and check that it still starts inside the base folder:

```js
function resolveInside(baseDir, userPath) {
  const base = path.resolve(baseDir);
  const full = path.resolve(base, userPath);
  const relative = path.relative(base, full);
  const escapes = relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative);
  if (escapes) {
    const err = new Error(`Path escapes the base folder: ${userPath}`);
    err.code = 'E_PATH_TRAVERSAL';
    throw err;
  }
  return full;
}
```

Run on five inputs (source: [12-errors-and-safe-paths.js](examples/12-errors-and-safe-paths.js)):

```text
inside.txt           -> allowed: inside.txt
sub/../inside.txt    -> allowed: inside.txt
../file.txt          -> refused: E_PATH_TRAVERSAL
../../etc/passwd     -> refused: E_PATH_TRAVERSAL
absolute path        -> refused: E_PATH_TRAVERSAL
safe read of inside.txt -> x
```

How it works: `path.resolve(base, userPath)` removes the `..` pieces and gives a clean absolute path. (An absolute `userPath` replaces the base completely, which is why that case is refused.) `path.relative(base, full)` then describes `full` as seen from `base`. If the answer starts with `..` the path left the folder.

Limits to know:

- This check is about the *text* of the path. A **symlink** inside the base folder can still point outside. For strong protection, `realpath` the final path and compare again, or do not allow links in upload folders.
- Check the *resolved* path. Looking for the string `../` in the input is easy to bypass (encoded forms, mixed separators).
- Also validate the input (allowed characters, extensions), and never put user input into shell commands.
- Node has a **permission model** (`node --permission --allow-fs-read=/srv/public`) that limits the folders the whole process can touch. It is a useful extra safety belt, not a replacement for checking input; the docs say it does not protect against malicious code.

> **Interview tip:** When asked about file upload or download endpoints, bring up path traversal before they do. Say: resolve, then check the result is inside the base folder; generate your own file names for uploads instead of trusting the client's; keep uploads outside the code folder. Lesson [20](../20-security-and-crypto/README.md) (section 6) covers the wider picture.

## Summary / Key takeaways

- `fs` has three flavours: sync (blocks), callback (error first) and promises (`node:fs/promises`, use `await`). Use promises in servers, `Sync` only at startup or in scripts.
- Without an encoding, `readFile` returns a Buffer. `writeFile` replaces, `appendFile` adds, the flag `wx` creates only if new. `mkdir` with `recursive: true` and `rm` with `recursive: true, force: true` are the safe "make sure it is there" and "make sure it is gone".
- Do not check existence first. Do the work and handle `ENOENT`, `EEXIST` and friends by `err.code`. That avoids the TOCTOU race. `fs.exists` is deprecated.
- Close what you open: use `try/finally` or `await using` with `FileHandle`. Limit concurrency to avoid `EMFILE`.
- Big files need streams or `readline`. Config files need helpers and atomic writes (temp file in the same folder, then rename).
- `fs.watch` is a hint, not a promise: expect duplicates, missing events and platform differences, so debounce and re-check. `node --watch` restarts the app and is for development.
- Async `fs` work runs in libuv's thread pool (4 threads by default), shared with DNS lookup, zlib and some crypto.
- Anchor paths on `__dirname`, and never pass user input to `fs` without a path traversal check. Windows differs: file symlinks need rights, permissions are only a read-only flag, error codes can differ.

## Quick check

1. Name the three flavours of the `fs` API, how errors arrive in each, and when `Sync` is acceptable.
<details><summary>Answer</summary>

Sync (errors are thrown), callback (error is the first argument) and promises from `node:fs/promises` (rejected promise). `Sync` blocks the event loop, so it is acceptable only where nothing else needs to run: startup code before the server listens, command line tools, build and test scripts. Never inside a request path.

</details>

2. What does `fsp.readFile(file)` return when you pass no encoding, and why can a string's `length` differ from the file size?
<details><summary>Answer</summary>

A `Buffer` of raw bytes. A string's `length` counts characters, the file size counts bytes. In UTF-8 many characters (like `é`) take more than one byte, so `'café'` has 4 characters but 5 bytes.

</details>

3. What is the difference between the flags `w`, `a` and `wx`?
<details><summary>Answer</summary>

`w` creates the file or empties it first. `a` creates it or keeps the content and writes at the end. `wx` creates the file only if it does not exist and fails with `EEXIST` otherwise, which makes "check and create" a single step.

</details>

4. Why is `fs.exists` deprecated, and what should you do instead of "check, then open"?
<details><summary>Answer</summary>

Its callback has no error argument, and a check followed by a use is a race condition (TOCTOU): the file can change between the two calls. Open or read the file directly and handle `ENOENT`. When you only need the answer, use `access` or `stat` and treat only `ENOENT` as "does not exist".

</details>

5. What is the difference between a hard link and a symbolic link, and what does `lstat` do?
<details><summary>Answer</summary>

A hard link is another name for the same file data, so the data survives while any name remains. A symlink is a small file holding a path, so it dangles if the target goes away. `stat` follows a symlink; `lstat` describes the link itself.

</details>

6. How do you write a file atomically, and why does the temp file go in the same folder?
<details><summary>Answer</summary>

Write the new content to a unique temp file, flush it, then `rename` it over the target. Readers see the old or the new file, never half of one. `rename` is only a one-step swap inside one file system. Across disks it fails with `EXDEV`.

</details>

7. What causes `EMFILE`, and how do you avoid it?
<details><summary>Answer</summary>

The process ran out of file descriptors. Causes: file handles that are never closed, or starting a huge number of file operations at once. Close handles (`try/finally`, `await using`) and limit concurrency (for example a `mapLimit` helper).

</details>

8. Which thread does `fsp.readFile` use for the actual reading, and how many such threads are there by default?
<details><summary>Answer</summary>

A worker thread from libuv's thread pool, not the main JavaScript thread. The pool has 4 threads by default (`UV_THREADPOOL_SIZE`) and is shared with DNS lookup, zlib and some crypto. Sync functions run on the main thread.

</details>

9. Give three reasons you cannot fully trust `fs.watch`.
<details><summary>Answer</summary>

Behaviour differs per platform; one action can produce several events (or `filename` can be missing); events can be lost on network file systems and in containers or virtual machines; on Windows, deleting the watched folder gives an `EPERM` error. Debounce events and re-read the real state.

</details>

10. A route does `fs.readFile(path.join(publicDir, req.query.name))`. What is wrong, and how do you fix it?
<details><summary>Answer</summary>

It allows path traversal: `name=../../secret.txt` leaves `publicDir`. Resolve the full path with `path.resolve`, use `path.relative` to check that the result stays inside `publicDir`, and reject it otherwise (plus validate the name and consider symlinks).

</details>

## Try it yourself

**Task 1 (easy): word counter.** Write a script that creates a temp folder, writes a file `story.txt` with three lines of text, reads it back, and prints the number of lines, words and bytes. Delete the folder at the end.

<details><summary>Hint</summary>

Use `mkdtemp` and `os.tmpdir()`. After `readFile(..., 'utf8')`, split on `'\n'` for lines and on whitespace (`/\s+/`) for words; filter out empty pieces. Bytes come from `stat().size` (or `Buffer.byteLength`). Put the cleanup in `finally`.

</details>

<details><summary>Solution</summary>

```js
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'task1-'));
  try {
    const file = path.join(dir, 'story.txt');
    await fsp.writeFile(file, 'Once upon a time\nthere was a small file\nthat liked to be read\n');

    const text = await fsp.readFile(file, 'utf8');
    const lines = text.split('\n').filter(Boolean).length; // ignore the empty piece after the last newline
    const words = text.split(/\s+/).filter(Boolean).length;
    const bytes = (await fsp.stat(file)).size;
    console.log({ lines, words, bytes });
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

main();
```

Output:

```text
{ lines: 3, words: 14, bytes: 62 }
```

</details>

**Task 2 (medium): print a folder tree.** Write `printTree(dir)` that prints a folder as an indented tree: folders first, then files, each group sorted by name, folder names followed by `/`. Build a small demo tree in a temp folder to test it.

<details><summary>Hint</summary>

Use `readdir(dir, { withFileTypes: true })`, sort the entries (folders before files, then `localeCompare` on the name), and recurse into each folder with a longer indent string. The `Dirent` already knows if it is a folder, so you need no `stat` calls.

</details>

<details><summary>Solution</summary>

```js
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Print a folder as a tree: folders first, then files, each group sorted by name.
async function printTree(dir, indent = '') {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      console.log(`${indent}${entry.name}/`);
      await printTree(path.join(dir, entry.name), indent + '  ');
    } else {
      console.log(`${indent}${entry.name}`);
    }
  }
}

async function main() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'task2-'));
  try {
    await fsp.mkdir(path.join(root, 'src', 'util'), { recursive: true });
    await fsp.mkdir(path.join(root, 'docs'));
    await fsp.writeFile(path.join(root, 'README.md'), '# demo');
    await fsp.writeFile(path.join(root, 'src', 'app.js'), '');
    await fsp.writeFile(path.join(root, 'src', 'util', 'helpers.js'), '');
    await fsp.writeFile(path.join(root, 'docs', 'guide.md'), '');

    console.log('demo/');
    await printTree(root, '  ');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

main();
```

Output:

```text
demo/
  docs/
    guide.md
  src/
    util/
      helpers.js
    app.js
  README.md
```

</details>

**Task 3 (harder): log rotation.** Write `appendLog(file, line, { maxBytes, keep })`. It appends `line` plus a newline. Before appending, if the file would grow past `maxBytes`, rotate: `app.log` becomes `app.log.1`, `app.log.1` becomes `app.log.2`, and so on. Keep at most `keep` old files (the oldest is deleted). Missing files must not cause errors. Test it by logging 12 short lines with `maxBytes: 30` and `keep: 2`.

<details><summary>Hint</summary>

Split the work: a `rotate(file, keep)` function and the main function. In `rotate`, first remove the oldest (`file.keep`, with `force: true`), then rename from the highest number down (`keep - 1` to `1`) so nothing is overwritten, then rename the current file to `.1`. Ignore `ENOENT` on each rename. Get the current size with `stat`, treating `ENOENT` as size 0. Use `Buffer.byteLength` for the new line, not `length`. Call `appendLog` one at a time (this simple version is not safe for concurrent callers).

</details>

<details><summary>Solution</summary>

```js
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ignoreMissing = (err) => {
  if (err.code !== 'ENOENT') throw err;
};

// app.log -> app.log.1 -> app.log.2 ... the oldest one is deleted.
async function rotate(file, keep) {
  await fsp.rm(`${file}.${keep}`, { force: true });
  for (let i = keep - 1; i >= 1; i--) {
    await fsp.rename(`${file}.${i}`, `${file}.${i + 1}`).catch(ignoreMissing);
  }
  await fsp.rename(file, `${file}.1`).catch(ignoreMissing);
}

async function appendLog(file, line, { maxBytes = 100, keep = 3 } = {}) {
  const data = line + '\n';
  let size = 0;
  try {
    size = (await fsp.stat(file)).size;
  } catch (err) {
    ignoreMissing(err); // no file yet: size stays 0
  }
  if (size > 0 && size + Buffer.byteLength(data) > maxBytes) await rotate(file, keep);
  await fsp.appendFile(file, data);
}

async function main() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'task3-'));
  try {
    const file = path.join(dir, 'app.log');
    for (let i = 1; i <= 12; i++) {
      await appendLog(file, `event ${i}`, { maxBytes: 30, keep: 2 });
    }
    for (const name of (await fsp.readdir(dir)).sort()) {
      const text = await fsp.readFile(path.join(dir, name), 'utf8');
      console.log(name.padEnd(10), JSON.stringify(text));
    }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

main();
```

Output:

```text
app.log    "event 10\nevent 11\nevent 12\n"
app.log.1  "event 7\nevent 8\nevent 9\n"
app.log.2  "event 4\nevent 5\nevent 6\n"
```

Events 1 to 3 were rotated out: with `keep: 2` only two old files exist. Because `appendLog` checks the size and then writes, two callers at the same time could race (the same TOCTOU idea as section 7). A real logger serialises writes with a queue or a write stream.

</details>

## Where to go next

- Next lesson: [07. Asynchronous JavaScript: Callbacks, Promises and async/await](../07-async-javascript/README.md). You have already used all three styles here, so it will go deeper into how they work.
- Related lessons: [08. Event loop](../08-event-loop/README.md) (what the thread pool and callbacks do), [10. Buffers](../10-buffers/README.md), [11. Streams](../11-streams/README.md) (big files and backpressure) and [20. Security and crypto](../20-security-and-crypto/README.md) (path traversal and more).
- Practise for interviews:
  - [Round 1: screening questions](../../rounds/round-1-screening/questions.md)
  - [Round 2: core questions](../../rounds/round-2-core/questions.md)
  - [Round 3: coding challenges](../../rounds/round-3-coding/questions.md)
  - [Round 4: advanced questions](../../rounds/round-4-advanced/questions.md)
