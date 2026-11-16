# Cheatsheet: core APIs

Always use the `node:` prefix: `require('node:fs')`.

## Files and paths

```js
const fs = require('node:fs/promises');
const path = require('node:path');
const text = await fs.readFile(path.join(__dirname, 'a.txt'), 'utf8');
await fs.writeFile(file, data);           // overwrites
await fs.appendFile(file, more);
await fs.mkdir(dir, { recursive: true });
await fs.rm(dir, { recursive: true, force: true });
const names = await fs.readdir(dir, { withFileTypes: true });
```

Big files: `fs.createReadStream` / `pipeline`. Common error codes: `ENOENT` (missing), `EEXIST`, `EACCES`, `EISDIR`, `EMFILE` (too many open files).

## Modules

| | CommonJS | ES modules |
| --- | --- | --- |
| Import | `const x = require('./x')` | `import x from './x.js'` |
| Export | `module.exports = x` | `export default x` |
| Dir name | `__dirname` | `import.meta.dirname` |
| Top-level await | no | yes |

## Events, streams, buffers

```js
const EventEmitter = require('node:events');
const { pipeline } = require('node:stream/promises');
await pipeline(fs.createReadStream('in'), zlib.createGzip(), fs.createWriteStream('out.gz'));
const buf = Buffer.from('héllo', 'utf8'); buf.toString('hex');
```

- `write()` returning `false` means wait for `'drain'` (backpressure).
- Default `highWaterMark`: 16 KiB for byte streams (check `stream.getDefaultHighWaterMark(false)`), 16 objects in object mode.
- `Buffer.alloc` zero-fills, `allocUnsafe` does not.

## HTTP

```js
const http = require('node:http');
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}).listen(3000);
const r = await fetch('http://localhost:3000');   // built in
```

Server defaults: `keepAliveTimeout` 5 s, `headersTimeout` 60 s, `requestTimeout` 300 s.

## Processes and threads

| API | Use |
| --- | --- |
| `child_process.execFile` / `spawn` | run a program (no shell, safe) |
| `child_process.exec` | runs in a shell (injection risk) |
| `child_process.fork` | new Node process with IPC |
| `worker_threads` | CPU work in a thread, can share memory |
| `cluster` | many processes on one port |

## Process

`process.argv`, `process.env`, `process.exit(code)`, `process.on('SIGTERM', ...)`, `process.memoryUsage()`, `process.hrtime.bigint()`.

## Useful flags

`--watch`, `--env-file=.env`, `--test`, `--inspect`, `--cpu-prof`, `--max-old-space-size=MB`, `--permission` (with `--allow-fs-read`, `--allow-fs-write`).
