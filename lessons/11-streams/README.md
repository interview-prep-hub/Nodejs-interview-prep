# 11. Streams and Backpressure

> Level: Intermediate   Time: about 150 minutes   Node: 24 (notes where older versions differ)

[Previous: 10. Buffers and Binary Data](../10-buffers/README.md) | [All lessons](../../README.md) | [Next: 12. HTTP and Networking with Core Modules](../12-http-and-networking/README.md)

## What you will learn
- Why streams exist: memory use and "time to first byte", shown with a before/after test on a 64 MiB file
- The four stream types (Readable, Writable, Duplex, Transform) and where core modules use them
- Four ways to consume a Readable, and why `for await` is the one to prefer
- Why `pipe()` alone leaks resources and how `pipeline()` fixes error handling and cleanup
- Backpressure step by step: `write()` returning `false`, `'drain'`, `highWaterMark` and its exact defaults
- How to write your own Readable, Writable, Duplex and Transform (class form and simplified form), and object mode
- Real pipelines: `Readable.from`, generators as stages, `compose`, gzip, CSV lines, big HTTP responses, and Web Streams
- The stream utilities (`finished`, `addAbortSignal`, `end()` versus `destroy()`) and the classic bugs interviewers love to ask about

Every example runs from the repo root, for example `node lessons/11-streams/examples/02-four-types.js`. Example 01 needs one extra flag, shown in its section. All examples write only to a temporary folder and delete it at the end.

You need two earlier lessons: events (lesson 9, because every stream is an event emitter) and buffers (lesson 10, because a chunk of bytes is a Buffer).

## 1. The problem streams solve

Example file: `examples/01-why-streams.js`.

Imagine you must move water from a lake to a field. You can fill one huge bucket, carry it over, and pour it out. Or you can lay a **pipe** and let the water flow. The bucket needs a lot of room, and the field gets nothing until the bucket arrives. The pipe needs almost no room, and water reaches the field right away.

`fs.readFile` is the bucket. A **stream** is the pipe. A stream is an object that delivers data in small pieces, called **chunks**, one after the other, instead of all at once.

Streams solve two problems:

1. **Memory.** `readFile` puts the whole file in memory. A 64 MiB file costs 64 MiB, and ten users reading it at the same time cost 640 MiB. A file over 2 GiB is refused outright (see below). A stream holds only a few chunks at a time, so memory use stays small no matter how big the file is.
2. **Time to first byte** (the waiting time before the first data arrives, a kind of **latency**). With `readFile` you get nothing until the last byte is read. With a stream you get the first chunk after a few milliseconds, so you can start working (or start sending a response) immediately.

A third benefit is **composition**: you can connect small steps (read, decompress, parse, write) with pipes, and each step works on one chunk at a time.

Do not confuse a stream with an array. An array holds all its items at once. A stream gives you one chunk now, the next chunk later, and it may never hold the whole data at any moment.

The example builds a 64 MiB temporary file and reads it twice. Here is the heart of it:

```js
// A. the bucket: nothing is available until ALL bytes are read
const data = await fsp.readFile(file);

// B. the pipe: a chunk is available after a few milliseconds
for await (const chunk of fs.createReadStream(file)) {
  lines += countNewlines(chunk);
}
```

Run it. The `--expose-gc` flag makes the global function `gc()` available. The example calls it before each measurement to force a **garbage collection** (the automatic cleanup of memory that nothing uses any more), so that only memory still in use is counted:

```bash
node --expose-gc lessons/11-streams/examples/01-why-streams.js
```

Output from one run:

```text
test file: 64.0 MiB

--- A. fs.promises.readFile: the whole file at once ---
time until the data is available : 1438.6 ms
memory held while we work        : 64.0 MiB
lines counted                    : 1220160

--- B. fs.createReadStream: piece by piece ---
time until the first piece       : 64.7 ms
number of pieces                 : 1024 (about 64 KiB each)
most memory held at one moment   : 3.1 MiB
lines counted                    : 1220160
```

The timings and the small memory number change on every run and every machine. Even the order of magnitude moves: another run on a quiet machine gave about 80 ms for `readFile` and 6 ms for the first piece, and a busy machine gave more than a second. These things are stable:

- Both ways count the same lines.
- `readFile` holds the whole 64 MiB.
- The stream works in 1024 pieces of 64 KiB (64 MiB divided by 64 KiB).
- The 3 MiB or so is read-ahead (data the stream reads before you ask) plus the stream's own bookkeeping. It does not grow if the file grows.
- The first piece arrives long before `readFile` is done.

`readFile` also has a hard limit. A file bigger than 2 GiB is refused:

```text
ERR_FS_FILE_TOO_LARGE File size (2147483658) is greater than 2 GiB
```

And turning a big Buffer into one string fails too: a string cannot be longer than about 512 MiB (`buffer.constants.MAX_STRING_LENGTH` is 536870888 on Node 24).

> **Interview tip:** "Why use streams?" A weak answer is only "they save memory". A strong answer names three things: constant memory, lower latency (first byte early), and composition with backpressure (the fast side never drowns the slow side). Also say when NOT to use them: small data that you need as a whole.

### Words you will meet

Each of these is explained properly where it first matters. Use this table as a map.

| Word | Plain meaning | Section |
|---|---|---|
| chunk | one piece of data moving through a stream (a Buffer, or any value in object mode) | 2 |
| buffer (lowercase, the stream's internal one) | the waiting room inside a stream where chunks sit until someone takes them | 5 |
| flowing / paused | a Readable either pushes data to you by itself, or waits until you ask | 3 |
| `highWaterMark` | the size of that waiting room: the point where a stream starts saying "stop sending" | 5 |
| backpressure | the slow side telling the fast side to wait | 5 |
| `pipeline` | the safe way to connect streams: it passes errors on and cleans up | 4 |
| object mode | a stream whose chunks are JavaScript values (not bytes) | 7 |
| destroy | stop a stream at once and release its resources (a file handle, a socket) | 12 |

## 2. The four stream types

Example file: `examples/02-four-types.js`.

Node has four kinds of streams. All of them are `EventEmitter`s (lesson 9), so they emit events and you listen with `.on(...)`.

Two words from the table below: a **socket** is one end of a network connection between two programs (TCP is the common, reliable kind). `stdin` and `stdout` are the "standard input" and "standard output" of a program: by default the keyboard side and the screen side.

| Type | You can | Think of it as | Core examples |
|---|---|---|---|
| **Readable** | read from it | a tap | `fs.createReadStream`, the HTTP request on a server, the HTTP response on a client, `process.stdin` |
| **Writable** | write to it | a drain | `fs.createWriteStream`, the HTTP response on a server, `process.stdout`, `process.stderr` |
| **Duplex** | read AND write, two independent sides | a phone line | `net.Socket` (TCP), `tls.TLSSocket` |
| **Transform** | write in, read out, the output is computed from the input | a filter in a pipe | `zlib.createGzip()`, `crypto.createHash()`, `crypto.createCipheriv()`, `stream.PassThrough` |

A **Transform** is a special Duplex: what you read is made from what you wrote (gzip turns plain bytes into compressed bytes). In a plain Duplex, the two sides do not need to be related. A TCP socket reads what the other computer sent and writes what you send; those are different data.

What comes out of the example (the class of `process.stdin` and `process.stdout` is not printed, because it depends on what they are connected to):

```text
What you have              Class              Type
fs.createReadStream()      ReadStream         Readable
fs.createWriteStream()     WriteStream        Writable
process.stdin              (varies)           Readable
process.stdout             (varies)           Writable
zlib.createGzip()          Gzip               Transform
crypto.createHash()        Hash               Transform
http server: req           IncomingMessage    Readable
http server: res           ServerResponse     Writable-like (old Stream)
http client: request       ClientRequest      Writable-like (old Stream)
http client: response      IncomingMessage    Readable
net.connect()              Socket             Duplex
net server: socket         Socket             Duplex

--- how the types relate ---
Transform inherits from Duplex : true
Duplex inherits from Readable  : true
new Duplex() instanceof Writable: true (Duplex fakes it)
```

Things worth noticing:

- The HTTP **request on the server** (`IncomingMessage`) is a Readable: the body of an upload is a stream. The HTTP **response on the server** (`ServerResponse`) is used like a Writable (`write()`, `end()`, `'drain'`), and `pipeline` accepts it. But it is built on the old `Stream` class, so `res instanceof stream.Writable` is `false`. That is a good trivia question.
- `process.stdin` and `process.stdout` change class depending on where they point: a terminal, a file, or a pipe. When connected to a pipe they are `net.Socket` objects, which are Duplex. Code that treats `stdin` as Readable and `stdout` as Writable works in every case.
- Class relations: `Transform` extends `Duplex`, and `Duplex` extends `Readable`. Node adds a special `instanceof` rule so that a Duplex also counts as a Writable.

The simplest stream program in Node copies keyboard (or piped) input to the screen. It works the same in bash and PowerShell:

```bash
echo hello | node -e "process.stdin.pipe(process.stdout)"
```

```text
hello
```

**Chunks.** The piece of data that moves through a stream is a **chunk**. In a normal ("byte") stream a chunk is a `Buffer` (lesson 10), or a string if you set an encoding. In **object mode** (section 7) a chunk can be any JavaScript value.

> **Remember:** a Readable gives you chunks, a Writable takes chunks, a Transform changes chunks, a Duplex does both without changing anything. Chunk boundaries are decided by the stream, not by your data (see section 3 and section 6).

> **Interview tip:** "Name the four stream types and give a core example of each" is a warm-up question. The follow-up is "What is the difference between Duplex and Transform?" Strong answer: both are readable and writable; in a Duplex the two sides are independent (a socket), in a Transform the output is computed from the input (gzip). Bonus points: "an HTTP server response is not an instance of `stream.Writable`, but it behaves like one".

## 3. Consuming a Readable

Example file: `examples/03-consume-readable.js`.

The example makes a 26 byte file (`abcdefghijklmnopqrstuvwxyz`) and reads it with `highWaterMark: 10`, which means "read 10 bytes at a time". You will get chunks of 10, 10 and 6 bytes. There are four ways to consume the stream.

### 3.1 Events: `data`, `end`, `close`, `error`

```js
const stream = fs.createReadStream(file, { highWaterMark: 10 });
stream.on('data', (chunk) => console.log('data  :', chunk)); // a Buffer
stream.on('end', () => console.log('end   : no more data will come'));
stream.on('close', () => console.log('close : the file is closed, all done'));
stream.on('error', (err) => console.log('error :', err.message));
```

```text
readableFlowing at the start : null
readableFlowing after on(data): true
data  : <Buffer 61 62 63 64 65 66 67 68 69 6a>
data  : <Buffer 6b 6c 6d 6e 6f 70 71 72 73 74>
data  : <Buffer 75 76 77 78 79 7a>
end   : no more data will come
close : the file is closed, all done
```

| Event | When it fires |
|---|---|
| `data` | a chunk is ready (only in flowing mode) |
| `end` | all data was consumed, nothing more will come |
| `error` | something failed (the stream is destroyed after this) |
| `close` | the stream and its resources (the file handle) are released. Always the last event |
| `readable` | data can be pulled with `read()`, or the end was reached (section 3.3) |

For a healthy stream the order is `data`, `data`, ..., `end`, `close`. After an error the order is `error`, `close`.

### 3.2 Flowing and paused mode

A Readable is always in one of two modes:

- **Paused**: it holds data in its internal buffer and waits for you to ask.
- **Flowing**: it pushes data to you as fast as it can, through `data` events.

You can see the state in `stream.readableFlowing`:

| `readableFlowing` | Meaning |
|---|---|
| `null` | nobody is consuming yet (the starting state, no data is read) |
| `true` | flowing |
| `false` | explicitly paused (`pause()`), unpiped, or paused by backpressure |

A stream starts flowing when you add a `data` listener, call `resume()`, or call `pipe()`. `pause()` stops the `data` events and `resume()` starts them again:

```js
stream.setEncoding('utf8'); // chunks are strings now, and never cut a multi-byte character
stream.on('data', (text) => {
  count++;
  if (count === 1) {
    stream.pause();
    setTimeout(() => stream.resume(), 30);
  }
});
```

```text
data 1  : abcdefghij   flowing=true
paused  : flowing = false (no data for 30 ms)
resumed : flowing = true
data 2  : klmnopqrst   flowing=true
data 3  : uvwxyz   flowing=true
```

> **Common mistake:** `resume()` with no `data` listener throws the data away. And if you call `pause()` explicitly, adding a `data` listener afterwards does NOT switch the stream back to flowing (`readableFlowing` stays `false`, checked on Node 24). You must call `resume()`.

### 3.3 The `readable` event and `read()`

In the third style you pull data yourself. Node tells you with `'readable'` that something is waiting, and you call `read()`:

```js
stream.on('readable', () => {
  let chunk;
  // read() returns null when the internal buffer is empty. Keep calling it until then.
  while ((chunk = stream.read()) !== null) {
    console.log('read()  :', chunk.toString());
  }
});
```

```text
read()  : abcdefghij
read()  : klmnopqrst
read()  : uvwxyz
end
```

This is the original low-level API. It is rarely needed today. Two warnings:

- Always loop until `read()` returns `null`. If you read once and stop, no new `readable` event may come, and the stream stalls.
- If a `readable` listener exists and you never call `read()`, no `data` and no `end` event arrives. The `readable` listener takes precedence over `data`.

### 3.4 Async iteration with `for await` (preferred)

Every Readable is an async iterable. Each turn of the loop gives you one chunk:

```js
let total = '';
for await (const chunk of stream) {
  console.log('chunk   :', chunk.length, 'bytes');
  total += chunk.toString();
}
```

```text
chunk   : 10 bytes
chunk   : 10 bytes
chunk   : 6 bytes
total   : abcdefghijklmnopqrstuvwxyz
destroyed after the loop: true
first chunk only: abcdefghij
destroyed after break   : true
```

Why this is the best style:

- **Errors become exceptions.** If the stream fails, the `for await` loop throws, and you catch it with a normal `try/catch`. No separate `error` listener.
- **Backpressure is automatic.** The next chunk is requested only when your loop body is done. A slow `await` inside the loop slows the stream down instead of piling up work (compare bug 6 in section 13).
- **Cleanup is automatic.** When the loop ends, or you `break`, `return` or `throw` out of it, the stream is destroyed (`destroyed after break: true`). The file handle is released.

| Style | Use it when | Watch out for |
|---|---|---|
| `on('data')` | quick scripts, simple forwarding | no backpressure for async work, you must add `error` yourself |
| `on('readable')` + `read()` | you need to read an exact number of bytes (`read(n)`) | easy to stall, rarely needed |
| `for await` | almost always, in application code | one consumer only |
| `pipe()` / `pipeline()` | connecting stream to stream | use `pipeline` (section 4) |

> **Interview tip:** "How do you read a stream?" Mention `for await` first, then say that under the hood it uses the `readable` event and `read()`. Also say that chunk sizes are not under your control: a chunk is not a line and not a message. The example shows that the sizes follow `highWaterMark` (the last chunk is just what is left).

### 3.5 Reading only a slice of a file

`fs.createReadStream(file, { start, end })` reads a byte range. Both `start` and `end` are **included**, and counting starts at 0. This is how a server answers a "give me bytes 1000 to 1999" request (an HTTP range request) without reading the rest of the file.

```js
for await (const chunk of fs.createReadStream(file, { start: 2, end: 5, encoding: 'utf8' })) {
  text += chunk;
}
```

```text
bytes 2 to 5 : "cdef" (start and end are both included)
```

The file holds `abcdefghijklmnopqrstuvwxyz`, so the bytes at positions 2, 3, 4 and 5 are `c`, `d`, `e`, `f`. The `encoding: 'utf8'` option does the same as `setEncoding('utf8')`: you get strings, not Buffers.

## 4. `pipe()` versus `pipeline()`

Example file: `examples/04-pipe-vs-pipeline.js`.

**`readable.pipe(writable)`** connects two streams. It is easy to write and it handles backpressure. In simplified form it does this:

```js
readable.on('data', (chunk) => {
  const ok = writable.write(chunk);
  if (!ok) readable.pause(); // the writable is full: stop reading
});
writable.on('drain', () => readable.resume()); // there is room again: continue
readable.on('end', () => writable.end()); // pass the end along
```

What `pipe()` does NOT do:

- It does **not forward errors**. If the source fails, the destination is not told. If the destination fails, the source is not told.
- It does **not clean up**. After a failure, the other stream stays open. A file stream that stays open keeps a **file handle** (the operating system's record of an open file; a process can only have so many, and on Windows an open file cannot be deleted). A socket that stays open keeps a connection. A resource that is never released like this is a **leak**.
- If you forget the `error` listener on a stream, the error is thrown and can crash the process.

The example breaks both sides on purpose. First with `pipe()`:

```js
const source = failingSource();           // sends one chunk, then fails
const destination = openOutput('a.txt');  // a real file stream
source.on('error', (err) => console.log('source error        :', err.message));
source.pipe(destination);
```

Then with `pipeline()` from `node:stream/promises`:

```js
try {
  await pipelineAsync(failingSource(), destination);
} catch (err) {
  console.log('pipeline rejected   :', err.message);
}
console.log('destination destroyed:', destination.destroyed);
```

Output:

```text
--- A. pipe(): the SOURCE fails ---
source error        : source failed
destination destroyed: false <- still open, the file handle leaks

--- B. pipeline(): the SOURCE fails ---
pipeline rejected   : source failed
destination destroyed: true <- pipeline closed it for us

--- C. pipe(): the DESTINATION fails ---
destination error   : disk full
source destroyed     : false <- still open, nobody reads it, the file handle leaks

--- D. pipeline(): the DESTINATION fails ---
pipeline rejected   : disk full
source destroyed     : true <- pipeline closed it for us

--- E. the callback form, when everything works ---
callback error      : none, success
bytes written       : 26
```

**`stream.pipeline(...)`** fixes all of this:

- You pass the whole chain, `pipeline(a, b, c)`.
- If **any** stream fails or closes early, `pipeline` calls `destroy()` on **all** the others (except streams that already finished normally), so nothing leaks.
- You get **one** result for the whole chain: a rejected promise (or a callback with `err`) on failure, success when the last stream finishes.
- It accepts async generator functions as stages (section 8) and an `{ signal }` option for cancelling (section 12).

There are two forms. Prefer the promise form:

```js
const { pipeline } = require('node:stream/promises');

await pipeline(source, transform, destination); // throws if anything fails
```

```js
const { pipeline } = require('node:stream');

pipeline(source, transform, destination, (err) => {
  if (err) console.error('failed', err);
  else console.log('done');
});
```

| | `a.pipe(b)` | `pipeline(a, b)` |
|---|---|---|
| Backpressure | yes | yes |
| Forwards errors | no | yes, one error for the whole chain |
| Destroys other streams on failure | no | yes |
| Tells you when it is finished | no (you listen to `finish` on the last stream) | yes (promise or callback) |
| Chain of three or more | `a.pipe(b).pipe(c)`, errors are per stream | `pipeline(a, b, c)` |
| Generators and async functions as stages | no | yes |

> **Common mistake:** calling `pipeline(...)` without `await` or a callback. If it fails, the rejected promise is unhandled and, on Node 24, an unhandled rejection ends the process with exit code 1. Always `await` it (or pass a callback).

> **Interview tip:** "Why does `pipe()` alone leak?" Because it only wires the data path. It never links the lifetimes of the streams. When one dies, nothing destroys the other, so file handles and sockets stay open. `pipeline()` links the lifetimes.

## 5. Backpressure, step by step

Example file: `examples/05-backpressure.js`.

Picture a kitchen sink. The tap fills it fast. The drain empties it slowly. If you keep the tap open, the sink overflows. **Backpressure** is the rule "the slow side tells the fast side to slow down". In streams: a fast producer (read from a fast disk) must not flood a slow consumer (a slow network). Without it, the data you cannot yet send piles up in memory, and the process runs out of memory.

### 5.1 `highWaterMark`

Every stream has an internal buffer, a waiting room for chunks. A Readable keeps there the data it has read but you have not taken yet. A Writable keeps there the data you have written but the target (disk, network) has not accepted yet. The size limit of that waiting room is the **`highWaterMark`** (the "high water line", like the line on a harbour wall). It is a *threshold*, not a hard wall: Node does not refuse data above it; it only starts telling you to stop.

- In a normal (byte) stream it counts **bytes**.
- In **object mode** it counts **objects** (a 1 MB object counts as 1).

Exact defaults on Node 24:

| Stream | Default `highWaterMark` |
|---|---|
| `new Readable()`, `new Writable()`, `new Transform()`, `new Duplex()` (byte mode) | **16384** (16 KiB) on Windows, **65536** (64 KiB) on Linux and macOS |
| the same in `objectMode: true` | **16** (objects) |
| `fs.createReadStream()` | **65536** (64 KiB) on every platform |
| `fs.createWriteStream()`, `net.Socket`, zlib streams, piped `process.stdout` | the generic byte default: 16384 on Windows, 65536 on Linux and macOS (measured on Windows: these streams follow `getDefaultHighWaterMark(false)`) |
| `Readable.from(iterable)` | **1** (it is an object mode stream) |

The platform difference is real. Node 22.0.0 raised the default byte-stream value to 64 KiB (the docs list this as "bump default highWaterMark" in v22.0.0), but Windows kept 16 KiB. On Node 20 and older the default is 16 KiB on every platform. The numbers in this lesson were measured on Windows. For Linux and macOS the documentation says 64 KiB; that value was not measured here. So do not hard-code the number: ask for it.

```js
const stream = require('node:stream');
console.log(stream.getDefaultHighWaterMark(false)); // bytes: 16384 on Windows
console.log(stream.getDefaultHighWaterMark(true));  // objects: 16
```

You can change the default for all new streams with `stream.setDefaultHighWaterMark(objectMode, value)` (section 12), or per stream with the `highWaterMark` option.

### 5.2 The five steps

```text
 producer --write(chunk)--> [ internal buffer: writableLength ] --> slow consumer (disk, network)
     ^                                   |
     |   write() returns false           |
     |   when writableLength >= hwm      |
     +------------ 'drain' <-------------+  (buffer is empty again)
```

1. The producer calls `writable.write(chunk)`.
2. The Writable adds the chunk size to its internal count, `writableLength`, and hands the chunk to its slow consumer.
3. `write()` returns **`true`** if `writableLength` is **below** `highWaterMark`, and **`false`** once it has **reached or passed** it. (The stream accepts the chunk either way. Nothing is lost.)
4. On `false`, the producer must **stop writing**.
5. When the Writable has emptied its buffer, it emits **`'drain'`**. Now the producer may continue.

The example checks the numbers (with the default highWaterMark):

```text
--- 0. the numbers ---
default highWaterMark, bytes   : 16384 (16384 on Windows, 65536 on Linux and macOS)
default highWaterMark, objects : 16
fs.createReadStream highWaterMark: 65536
write(16383 bytes) returns   : true
write(16384 bytes) returns   : false (buffered bytes reached the limit)
writableNeedDrain              : true
```

One byte below the limit returns `true`; exactly the limit returns `false`, and `writableNeedDrain` becomes `true` until `'drain'` is emitted.

> **Under the hood:** `write()` looks at how many bytes are *waiting*. If your `_write` calls its callback immediately (synchronously), nothing waits, and `write()` keeps returning `true`, even for a chunk as big as the limit. In the example the slow writer finishes each chunk in the next loop turn (`setImmediate`), so the data really waits.

### 5.3 The problem: ignoring `write()`

The example writes 50,000 chunks of 1 KiB (about 49 MiB) to a slow consumer with a loop that never looks at the return value:

```js
for (let i = 0; i < CHUNKS; i++) {
  writer.write(Buffer.alloc(KiB)); // the loop never waits, so it finishes at once
}
```

```text
--- 1. the problem: ignore write() ---
chunks the consumer finished   : 0 of 50000
bytes waiting in memory        : 51200000 = 48.8 MiB
extra Buffer memory in use     : 48.8 MiB
write() returned false         : 49985 times (and we ignored it every time)
after finish, chunks done      : 50000
```

The loop ended before the consumer had finished even one chunk. All 48.8 MiB sat in memory. `write()` said `false` 49,985 times (the first 15 writes stayed below 16 KiB), and we ignored it every time. With a 10 GB source this is an out-of-memory crash. (The "extra Buffer memory" figure changes slightly from run to run.)

### 5.4 The fix: wait for `'drain'`

```js
for (let i = 0; i < CHUNKS; i++) {
  const ok = writer.write(Buffer.alloc(KiB));
  if (!ok) {
    await once(writer, 'drain'); // pause until the buffer is empty
    drains++;
  }
}
```

```text
--- 2. the fix: wait for drain ---
most bytes waiting in memory   : 16384 (the highWaterMark is 16384)
times we waited for drain      : 3125
chunks done                    : 50000
```

Now at most 16384 bytes wait at any moment (16 chunks of 1 KiB, and 50,000 / 16 = 3125 waits for `'drain'`). Memory is flat, no matter how much data goes through.

### 5.5 Let `pipeline` do it

Writing the `drain` loop by hand is easy to get wrong. `pipe()` and `pipeline()` contain exactly this logic (pause the readable when `write()` returns `false`, resume on `'drain'`):

```js
async function* source() {
  for (let i = 0; i < CHUNKS; i++) yield Buffer.alloc(KiB);
}
await pipeline(Readable.from(source()), writer);
```

```text
--- 3. pipeline does it for you ---
most bytes waiting in memory   : 16384
chunks done                    : 50000
```

Same result with no manual code.

### 5.6 The same rule on the reading side

A custom Readable has the mirror image. `this.push(chunk)` returns `false` when the Readable's own buffer has reached its `highWaterMark`. Node will not call your `_read()` again until the consumer has taken data. If your source can produce data on its own (a socket, a timer), stop producing when `push()` returns `false` and continue when `_read()` is called again.

### 5.7 How much memory does a whole pipeline use?

A Readable or a Writable has one buffer. A **Transform** sits in the middle and has **two**: one on its writable side (chunks waiting to be transformed) and one on its readable side (results waiting for the next stage). Each side has its own `highWaterMark`.

The example puts a Transform with `highWaterMark: 1024` between a source and a slow sink, and looks at both buffers every time the sink receives a chunk:

```text
--- 4. a Transform in the middle has two buffers ---
highWaterMark of the Transform : 1024
most bytes in its writable side: 1024
most bytes in its readable side: 1024
```

So one Transform can hold up to about **twice** its `highWaterMark`. A pipeline with N stages holds roughly "a few buffers per stage", a number that depends on the number of stages and their `highWaterMark`, and not on the size of the data. That is why a 10 GB file can pass through a four-stage pipeline using only a small, fixed amount of buffer memory.

> **Interview tip:** the question is "What is backpressure and how does Node handle it?" A strong answer: "A fast producer must not overrun a slow consumer. `write()` returns `false` when the buffered size reaches `highWaterMark`; the producer stops, waits for `'drain'`, then continues. `pipe` and `pipeline` do this automatically. If you ignore it, the data piles up in memory." Then add the number: 16 KiB on Windows, 64 KiB elsewhere for byte streams, 16 objects in object mode.

## 6. Writing your own streams

Example file: `examples/06-custom-streams.js`.

Why write your own? Because the built-in streams cover files, sockets and zlib, but your data may come from somewhere else (a database cursor, a message queue, a generator) or need your own processing (parse, filter, count). A custom stream plugs your code into `pipeline` and gets backpressure and error handling for free.

Each stream type has one method that you implement (the method name starts with an underscore). **Node calls that method for you.** You never call `_read()`, `_write()` or `_transform()` yourself. There are two ways to write a stream.

- **Class form**: `class X extends Readable { _read() {} }`. Good when the stream has state or will be reused.
- **Simplified form**: `new Readable({ read() {} })`. Good for small one-off streams. The same method, without the underscore, passed as an option.

### 6.1 Readable: `_read()` and `push()`

You implement `_read()`. Node calls it when the consumer wants more data. Inside it, call `this.push(chunk)` to hand over data and `this.push(null)` to say "the end".

```js
class Countdown extends Readable {
  constructor(start) {
    super();
    this.current = start;
  }

  _read() {
    if (this.current === 0) {
      this.push(null); // end of data
    } else {
      this.push(`${this.current}\n`); // strings are turned into Buffers
      this.current--;
    }
  }
}

// the simplified form
const letters = new Readable({
  read() {
    if (index >= text.length) this.push(null);
    else this.push(text[index++]);
  },
});
```

```text
countdown : [ '3', '2', '1' ]
letters   : abc
```

> **Common mistake:** assuming one `push()` equals one chunk on the reading side. In a byte stream the stream may glue small pushes together or split big ones. Reading `Countdown` with `for await`, the three pushes arrived as two chunks (`"3\n"` and `"2\n1\n"`) in one test; with a `data` listener they arrived as three. The grouping depends on how you consume the stream and on timing, so do not rely on it. That is why the example joins the text before printing. If you need message boundaries, use object mode (section 7) or put the length or a separator in the data.

### 6.2 Writable: `_write()`, `_final()` and `_destroy()`

You implement `_write(chunk, encoding, callback)`. Do your work with the chunk, then call `callback()` when you are done with it. The stream will not give you the next chunk until you do. Call `callback(err)` to report a failure.

Two optional hooks: `_final(callback)` runs once, after the last write and before `'finish'` (flush buffers there), and `_destroy(err, callback)` releases resources.

```js
class Collector extends Writable {
  constructor() {
    super();
    this.lines = [];
  }

  _write(chunk, encoding, callback) {
    // chunk is a Buffer, even when the caller wrote a string (decodeStrings is true by default)
    this.lines.push(chunk.toString());
    callback();
  }

  _final(callback) {
    console.log('  _final: all writes are done, last chance to flush');
    callback();
  }

  _destroy(err, callback) {
    console.log('  _destroy: release resources here');
    callback(err);
  }
}

collector.write('first');
collector.write('second');
collector.end('third'); // end(chunk) = write(chunk) + end()
```

```text
  _final: all writes are done, last chance to flush
  event finish
  _destroy: release resources here
  event close
collected : [ 'first', 'second', 'third' ]
```

The life of a Writable: `write()` ... `write()` ... `end()` -> `_final` -> **`finish`** (everything was written) -> `_destroy` -> **`close`**. `finish` means "all your data was handled". `close` means "the stream is fully shut down".

> **Common mistake:** mixing up `end` and `finish`. `end` is an event of a **Readable**: "no more data to read". `finish` is an event of a **Writable**: "all data was written". Also, the method `writable.end()` is not the event `end`: calling `end()` says "I will write no more", and `finish` comes later. (Stopping a stream early with `destroy()` is a different path, see section 12.3.)

The simplified form needs only the `write` option:

```js
const writer = new Writable({
  write(chunk, encoding, callback) {
    seen.push(chunk.toString().toUpperCase());
    callback();
  },
});
writer.end('hello');
```

```text
seen      : [ 'HELLO' ]
```

### 6.3 Duplex: two separate sides

A Duplex needs both `read()` and `write()`. The two sides do not talk to each other:

```js
const duplex = new Duplex({
  read() {
    // the readable side
    if (!sent) { sent = true; this.push('from the readable side'); }
    else this.push(null);
  },
  write(chunk, encoding, callback) {
    // the writable side
    console.log('writable side received:', chunk.toString());
    callback();
  },
});
duplex.end('hello');
for await (const chunk of duplex) console.log('readable side gave   :', chunk.toString());
```

```text
writable side received: hello
readable side gave   : from the readable side
```

### 6.4 Transform: `_transform()` and `_flush()`

A Transform is the most useful type to write. You implement `_transform(chunk, encoding, callback)`. Call `callback(null, output)` to send one output chunk, or call `this.push(...)` any number of times (zero, one or many) and then `callback()`. The optional `_flush(callback)` runs at the very end, and may push a last piece. To **flush** means "send out what you are still holding". You need `_flush` when your Transform keeps something between chunks, such as a line splitter that holds an unfinished line (section 9).

```js
class UpperCase extends Transform {
  _transform(chunk, encoding, callback) {
    callback(null, chunk.toString().toUpperCase());
  }

  _flush(callback) {
    this.push('\n(end of data)');
    callback();
  }
}

// simplified form: skip chunks that have no letters
const keepWithLetters = new Transform({
  transform(chunk, encoding, callback) {
    if (/[a-z]/i.test(chunk.toString())) this.push(chunk);
    callback(); // always call it, even when you pushed nothing
  },
});
```

```text
output    : "QUIET WORDS HERE\n(end of data)"
kept      : [ 'abc', 'def' ]
```

`stream.PassThrough` is a ready-made Transform that passes everything through unchanged. It is handy as a placeholder or to "tap" a pipeline.

> **Common mistake:** forgetting `callback()` in `_transform` or `_write`. The stream then waits forever for you. Nothing is printed, nothing fails, and the process may simply exit quietly. See bug 4 in section 13. Calling the callback twice is also a bug: it gives `ERR_MULTIPLE_CALLBACK`.

> **Remember:** to report a failure from inside a custom stream, call `callback(err)` (in `_write`, `_transform`) or `this.destroy(err)` (anywhere). Never `throw` from an asynchronous callback inside a stream.

> **Interview tip:** a favourite live-coding task is "write a Transform that upper-cases text" or "that counts lines". A strong answer: extend `Transform` (or use the simplified form), implement `_transform(chunk, encoding, callback)`, call `callback` exactly once per chunk, use `_flush` if you keep state between chunks, and run it inside `pipeline` rather than with bare `pipe`. Mention that a chunk can end in the middle of a word or a multi-byte character.

## 7. Object mode

Example file: `examples/06-custom-streams.js` (the last part).

Normally a stream moves bytes. With `objectMode: true`, every chunk is **one JavaScript value** (an object, a number, an array, a string). The only value you cannot send is `null`, because it means "the end".

Object mode changes `highWaterMark` to count **objects**, not bytes:

```js
const readerObj = new Readable({ objectMode: true, read() {} });
const writerObj = new Writable({ objectMode: true, write(chunk, encoding, callback) { setImmediate(callback); } });

for (let i = 1; i <= 20; i++) {
  const ok = writerObj.write({ id: i });
  if (!ok && falseAt === 0) falseAt = i;
}
```

```text
Readable highWaterMark (objects): 16
Writable highWaterMark (objects): 16
write() first returned false at object number: 16
```

Sixteen waiting objects fill the buffer, however big the objects are. That is why object mode with big objects can use a lot of memory.

A Transform can have different modes on its two sides: `readableObjectMode` and `writableObjectMode`. A CSV parser takes bytes in and gives objects out:

```js
const toObjects = new Transform({
  readableObjectMode: true, // what comes OUT is objects
  transform(chunk, encoding, callback) {
    callback(null, { length: chunk.length, text: chunk.toString() });
  },
});
```

```text
objects out of the Transform: [ { length: 2, text: 'hi' }, { length: 5, text: 'there' } ]
```

Use object mode when the unit of work is a thing (a row, a message, a record) and not a number of bytes.

> **Interview tip:** "What does `highWaterMark` count in object mode?" Objects, not bytes (default 16). The follow-up is the trap: a stream of 16 huge objects can hold far more memory than a byte stream, because the stream never looks inside an object. If objects are big, lower the `highWaterMark`.

## 8. `Readable.from`, generators, `compose` and operators

Example file: `examples/07-compose-generators.js`.

### 8.1 `Readable.from`

`Readable.from(iterable)` turns an array, a generator or an async generator into a Readable. It makes an **object mode** stream by default (that is why its `highWaterMark` is 1, not 16).

```js
const fromArray = Readable.from(['a', 'b', 'c']);
console.log(fromArray.readableObjectMode, fromArray.readableHighWaterMark);
console.log(await Readable.from('hello').toArray());   // a string is ONE chunk
console.log(await Readable.from([...'hello']).toArray()); // characters on purpose
```

```text
objectMode, highWaterMark : true 1
array        : [ 'a', 'b', 'c' ]
generator    : [ 1, 2, 3 ]
string       : [ 'hello' ]
chars on purpose: [ 'h', 'e', 'l', 'l', 'o' ]
```

A string (or a Buffer) is not split into characters. It becomes one chunk. `Readable.from` is the quickest way to make test input.

If you want a normal byte stream, pass the option `{ objectMode: false }`. The chunks then become Buffers (checked: `Readable.from(['ab', 'cd'], { objectMode: false })` gives two Buffers). The `highWaterMark` stays at 1 unless you also pass `highWaterMark`.

### 8.2 Generators as pipeline stages

A **generator** is a function that can pause in the middle with `yield` and give out values one at a time. An **async generator** (`async function*`) can also `await`. An **async iterable** is anything you can loop over with `for await`; every Readable is one.

In `pipeline`, an **async generator function** can be a stage. It receives the previous stage as an async iterable and `yield`s the next one. This is often shorter than a `Transform` class:

```js
async function* shout(source) {
  for await (const word of source) yield word.toUpperCase();
}
async function* onlyLongWords(source) {
  for await (const word of source) {
    if (word.length > 3) yield word; // yield nothing = drop the item
  }
}
async function* repeatTwice(source) {
  for await (const word of source) {
    yield word;
    yield word; // yield twice = one item in, two items out
  }
}

await pipeline(Readable.from(['a', 'stream', 'of', 'words']), shout, onlyLongWords, repeatTwice, collector(result));
```

```text
result       : [ 'STREAM', 'STREAM', 'WORDS', 'WORDS' ]
sum by last-stage function: 10
pipeline rejected with: bad item: 2
```

Rules for generator stages:

- `yield` nothing to drop an item, `yield` more than once to emit more items.
- The **last** stage may be a plain `async function (source) { ... }` that consumes the source and returns a promise (the example adds up numbers this way).
- If a generator throws, `pipeline` rejects and destroys all the streams (`pipeline rejected with: bad item: 2`).
- Backpressure still works: a generator only runs when the next stage asks for a value.
- A generator that is the **first** stage gets a `{ signal }` argument. It should respect it (for example by passing it to `timers/promises`), or a cancelled pipeline may never complete.

### 8.3 `stream.compose`

`compose(a, b, c)` glues several stages into **one** Duplex. You write into the first stage and read from the last. It is handy for building a reusable step:

```js
const bulletMaker = compose(trim, addBullet); // two generator stages, one stream
await pipeline(Readable.from(['  apples ', ' pears  ']), bulletMaker, collector(result));
```

```text
is a Duplex       : true
result       : [ '* apples', '* pears' ]
```

> **Remember:** `stream.compose` is marked **Experimental** (stability 1) in the Node 24 documentation. It works and prints no warning on 24.16, but the API may still change. Do not build a library on it without a plan to adapt.

### 8.4 Stream operators: `map`, `filter`, `toArray` and friends

Readable streams have array-like methods: `map`, `filter`, `toArray`, `forEach`, `some`, `find`, `every`, `flatMap`, `drop`, `take`, `reduce`. They work **lazily** (they only do work when the next item is asked for) and keep backpressure. The Node 24 docs mark every one of them **Experimental** (stability 1: the API may still change); on 24.16 they run with no warning. They are fine in scripts and tests; for long-lived library code, prefer a generator stage.

```js
const result = await Readable.from([1, 2, 3, 4, 5, 6])
  .filter((n) => n % 2 === 0)
  .map((n) => n * 10)
  .toArray();
```

```text
filter + map : [ 20, 40, 60 ]
take(2)      : [ 'a', 'b' ]
reduce       : 10
concurrency 3: [ 2, 4, 6, 8, 10, 12 ] (fast: calls overlapped)
```

`map` accepts an async function and a `{ concurrency }` option (default 1). **Concurrency** means how many calls run at the same time. With `concurrency: 3`, up to three calls run at once, and the output order still matches the input order. Six calls of 50 ms finished in far less than the 300 ms a sequential run needs. (Do not use `toArray()` on a stream that can be huge: it collects everything in memory, which is what streams are meant to avoid.)

> **Interview tip:** "Are `stream.compose` and `readable.map` stable?" No. Both are marked Experimental in the Node 24 docs, even though they print no warning. Say that, then say what you would use in production code: `pipeline` with generator stages, which is stable. Also be ready to explain why a generator stage keeps backpressure: it only runs when the next stage asks for a value.

## 9. Real pipelines: gzip and CSV

Example file: `examples/08-gzip-and-csv.js`.

A **CSV** file (comma-separated values) is plain text: one row per line, cells separated by commas, and the first line names the columns. **gzip** is a common compression format, and `zlib` is the core module that reads and writes it.

This example does five steps with a 20,000 row CSV file. Steps 1 to 4 are one `pipeline` each. The chain in step 4 looks like this:

```text
file.csv.gz --> createReadStream --> createGunzip --> LineSplitter --> parseRows --> sum up
                (bytes)              (bytes)          (one string      (one object   (last stage,
                                                       per line)        per row)      a function)
```

**Step 1: write the file.** A generator makes the lines, `Readable.from` turns it into a stream, and `pipeline` writes it. Because `pipeline` resolves when the destination has *finished*, the file is complete after the `await`:

```js
function* csvLines() {
  yield 'id,name,city,amount\n';
  for (let i = 1; i <= ROWS; i++) {
    yield `${i},user${i},${CITIES[i % 4]},${(i % 100) + 0.5}\n`;
  }
}
await pipeline(Readable.from(csvLines()), fs.createWriteStream(csvFile));
```

**Step 2: gzip it.** `zlib.createGzip()` is a Transform, so it sits between the reader and the writer:

```js
await pipeline(fs.createReadStream(csvFile), zlib.createGzip(), fs.createWriteStream(gzFile));
```

**Step 3: gunzip it and prove the bytes are the same** (compare a `sha256` of both files):

```js
await pipeline(fs.createReadStream(gzFile), zlib.createGunzip(), fs.createWriteStream(backFile));
```

**Step 4: read the `.gz`, split into lines, parse, add up.** Here are the two custom stages. A chunk can end in the middle of a line (or even in the middle of a multi-byte character), so the line splitter keeps the unfinished part for the next chunk:

```js
class LineSplitter extends Transform {
  constructor() {
    super({ readableObjectMode: true }); // bytes go in, one string per line comes out
    this.decoder = new StringDecoder('utf8'); // never cuts a character in half
    this.rest = ''; // text after the last newline we have seen
  }

  _transform(chunk, encoding, callback) {
    this.rest += this.decoder.write(chunk);
    const lines = this.rest.split('\n');
    this.rest = lines.pop(); // the last piece has no newline yet, keep it for later
    for (const line of lines) this.push(line.endsWith('\r') ? line.slice(0, -1) : line);
    callback();
  }

  _flush(callback) {
    this.rest += this.decoder.end();
    if (this.rest.length > 0) this.push(this.rest); // a last line without a newline
    callback();
  }
}

async function* parseRows(lines) {
  let header = null;
  for await (const line of lines) {
    if (line === '') continue;
    const cells = line.split(',');
    if (header === null) { header = cells; continue; }
    const row = {};
    header.forEach((name, i) => { row[name] = cells[i]; });
    yield row;
  }
}

await pipeline(
  fs.createReadStream(gzFile),
  zlib.createGunzip(),
  new LineSplitter(),
  parseRows,
  async function (source) {
    for await (const row of source) { rows++; total += Number(row.amount); /* ... */ }
  },
);
```

`StringDecoder` comes from lesson 10. Here is how `LineSplitter` handles a line that is cut between two chunks (the chunk sizes are made up for this trace):

```text
chunk 1 arrives : "id,name,ci"                    -> split gives one piece, it has no newline yet
                  rest = "id,name,ci"              -> nothing is pushed
chunk 2 arrives : "ty,amount\n1,us"
                  rest + chunk = "id,name,city,amount\n1,us"
                  split gives "id,name,city,amount" and "1,us"
                  pop() takes "1,us" back into rest -> push "id,name,city,amount"
at the end      : _flush pushes whatever is left in rest
```

Output:

```text
--- 1. write the CSV with a pipeline ---
csv bytes    : 505808

--- 2. gzip it ---
gzip bytes   : 102620
smaller by   : 80%

--- 3. gunzip it and check we got the same bytes back ---
same sha256  : true

--- 4. read the .gz, split lines, parse rows, add up a column ---
rows         : 20000
sum of amount: 1000000
rows per city: { Tokyo: 5000, Lima: 5000, Oslo: 5000, Paris: 5000 }

--- 5. the shortcut: readline turns any Readable into lines ---
lines        : 20001 (1 header + 20000 rows)
```

The compressed size depends on the zlib version bundled with your Node, so it may differ a little. The important parts: the whole file was never in memory (one 64 KiB or 16 KiB chunk at a time), and the CSV file decompressed on the fly.

The simple parser splits on commas and does not understand quoted fields such as `"Paris, France"`. For real CSV with quotes, use a proper parser library. The streaming idea stays the same.

Brotli works the same way: `zlib.createBrotliCompress()` and `zlib.createBrotliDecompress()`. A corrupt input makes the decompressing stream fail, and `pipeline` reports it (for example `Z_DATA_ERROR` for bad gzip data) and cleans up.

### The shortcut for plain lines: `readline`

If you only need lines (not a custom parser), the core module `node:readline` already contains a tested line splitter. Give it any Readable as `input` and loop over it with `for await`:

```js
const rl = readline.createInterface({
  input: fs.createReadStream(csvFile),
  crlfDelay: Infinity, // treat a Windows line end (CR LF) as ONE line break
});
for await (const line of rl) {
  if (line.length > 0) lineCount++;
}
```

The last line of the output above is its result: 20001 lines, the header plus 20000 rows. Use `readline` when a line is the unit of work. Write your own Transform (like `LineSplitter`) when the splitting rule is special or when you want the splitter to be one stage inside a `pipeline`.

> **Interview tip:** "How do you process a 5 GB log file line by line?" Strong answer: `fs.createReadStream` into `readline.createInterface` with `for await`, so memory stays flat. Explain the trap that makes a naive version wrong: a chunk is not a line, so splitting each chunk on `\n` breaks lines at chunk borders. You must keep the unfinished last piece for the next chunk (what `readline` and `LineSplitter` do), and use a `StringDecoder` so a multi-byte character is not cut in half.

## 10. Streaming a big HTTP response

Example file: `examples/09-http-streaming.js`.

On a Node HTTP server, the request is a Readable and the response is Writable-like. So serving a big file is a `pipeline` from a file stream to the response. The example serves a 32 MiB file in four ways (buffered, streamed, streamed and compressed, and streamed to a client that leaves), using a local server on a free port (port `0` lets the OS choose):

```js
if (req.url === '/buffered') {
  // Bad for big files: the whole file is in memory before the first byte is sent.
  const data = await fsp.readFile(file);
  res.writeHead(200, { 'Content-Length': size });
  res.end(data);
} else if (req.url === '/streamed') {
  // Good: bytes flow from disk to the socket in small chunks, with backpressure.
  res.writeHead(200, { 'Content-Length': size });
  pipeline(fs.createReadStream(file), res, (err) => {
    if (err) console.log('server: streamed pipeline error:', err.code);
  });
}
```

The client measures when the first bytes arrive:

```text
/buffered  first byte after 211 ms, received 32 MiB
/streamed  first byte after  95 ms, received 32 MiB
```

Both send the same bytes. The streamed route starts answering sooner (the exact timings differ on every run and machine, and a bigger file widens the gap), and it uses almost no memory while the buffered route holds the whole file per request. With ten users downloading at once, the buffered route holds ten copies.

**Compressing while streaming.** Put a `zlib.createGzip()` stage between the file and the response. The compressed size is not known before the last byte is compressed, so the server cannot send a `Content-Length`. Node then sends the body with `Transfer-Encoding: chunked`, which means "the body comes in pieces, each marked with its own length, and a final empty piece means the end".

```js
res.writeHead(200, { 'Content-Encoding': 'gzip' });
pipeline(fs.createReadStream(file), zlib.createGzip(), res, (err) => { /* ... */ });
```

```text
--- compress while streaming ---
Content-Encoding header : gzip
Transfer-Encoding header: chunked
Content-Length header   : none (size unknown in advance)
bytes after gunzip      : 32 MiB
```

The `Content-Encoding: gzip` header tells the client to unzip the body. (A real server first checks that the client sent `Accept-Encoding: gzip`. Browsers do.)

**What if the client leaves in the middle?** The last route answers that. The client closes the connection after the first chunk:

```text
--- the client leaves after the first chunk ---
client: got the first chunk, hanging up
server: pipeline ended with error code : ERR_STREAM_PREMATURE_CLOSE
server: file stream was closed         : true
```

`pipeline` sees that the response closed early (`ERR_STREAM_PREMATURE_CLOSE`) and destroys the file stream. With a hand-made `src.pipe(res)` the file stream would stay open for every user who closed a browser tab. That is a real file-handle leak in a busy server.

Practical rules for HTTP streaming:

- Do anything that can fail (`stat`, permission check, database lookup) **before** `res.writeHead()`. After the headers are sent you can no longer change the status code to 404 or 500; a failure then can only cut the connection.
- If you do not know the size, leave out `Content-Length`. Node then uses `Transfer-Encoding: chunked` for you.
- The Node docs warn that when `pipeline` fails with an HTTP request or response, it may destroy the socket before an error response can be sent. Validate first, stream second.
- Uploads are the other direction: `pipeline(req, fs.createWriteStream(target), callback)` stores a big upload without holding it in memory.
- To serve only part of a file (a video player asking for a byte range), use the `start` and `end` options of `createReadStream` (section 3.5).
- Web frameworks hand you the same `req` and `res` objects, so everything here applies to them too.

> **Interview tip:** "How would you serve a 5 GB file over HTTP?" Strong answer: check the file first (`stat`, permissions), send the headers, then `pipeline(fs.createReadStream(file), res, callback)`. Never `readFile`. Say what happens if the client leaves: `pipeline` ends with `ERR_STREAM_PREMATURE_CLOSE` and destroys the file stream, so no file handle leaks. Mention `Content-Length` (known size) versus chunked transfer (unknown size), and range requests for resuming downloads.

## 11. Web Streams

Example file: `examples/10-web-streams.js`.

Node streams are older than the web platform. Browsers have their own **Web Streams** API: `ReadableStream`, `WritableStream`, `TransformStream`. It is a standard, so the same code can run in a browser, in Deno or in Bun. Node 24 has these classes as **globals** (you can use them without `require`; the module `node:stream/web` is Stable), and they are what `fetch` uses: `response.body` is a web `ReadableStream`, and `Blob.stream()`, `CompressionStream` and `TextDecoderStream` are web streams too.

| | Node streams (`node:stream`) | Web Streams (globals) |
|---|---|---|
| Used by | `fs`, `http` server, `net`, `zlib`, `crypto` | `fetch` body, `Blob.stream()`, `CompressionStream`; also browsers, Deno, Bun |
| Chunk | Buffer or string (any value in object mode) | any value; bytes are `Uint8Array` |
| Read | `data` event, `read()`, `for await` | `reader.read()`, `for await` |
| Backpressure signal | `write()` returns `false`, `'drain'` | `desiredSize`, `pull()` |
| Pipe | `pipe()`, `pipeline()` | `pipeTo()`, `pipeThrough()` |
| Transform | `Transform` class | `TransformStream` |
| Locking | no | a reader locks the stream (only one reader at a time) |

The basics:

```js
const simple = new ReadableStream({
  start(controller) {
    controller.enqueue('a');
    controller.enqueue('b');
    controller.close();
  },
});
const reader = simple.getReader(); // while a reader exists, the stream is "locked"
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  console.log('read      :', value);
}
```

```text
read      : a
read      : b
```

`start()` runs once at the beginning. `pull()` is called whenever the internal queue has room, and that is how Web Streams do backpressure. The queue holds 1 chunk by default:

```text
pull() calls before anyone reads  : 1 (it filled its queue, then stopped)
pull() calls after reading 2 items: 3 (always one item ahead)
```

A web `ReadableStream` also works with `for await`, and `ReadableStream.from` (Node 20.6+) is a quick way to make one from an array or a generator:

```js
for await (const value of ReadableStream.from([10, 20])) console.log('got       :', value);
```

```text
got       : 10
got       : 20
```

A transform and a pipe:

```js
const upperCase = new TransformStream({
  transform(chunk, controller) {
    controller.enqueue(chunk.toUpperCase());
  },
});
await ReadableStream.from(['web', 'streams']).pipeThrough(upperCase).pipeTo(sink);
```

```text
sink got  : [ 'WEB', 'STREAMS' ]
```

### Converting between the two worlds

| From | To | Call |
|---|---|---|
| Node Readable | web `ReadableStream` | `Readable.toWeb(readable)` |
| web `ReadableStream` | Node Readable | `Readable.fromWeb(webStream)` |
| Node Writable | web `WritableStream` | `Writable.toWeb(writable)` and `Writable.fromWeb(webWritable)` |
| Node Duplex or Transform | `{ readable, writable }` pair | `Duplex.toWeb(duplex)` and `Duplex.fromWeb(pair)` |

The Node 24 docs list "Marking the API stable" in the v24.0.0 history of `toWeb` and `fromWeb` for Readable, Writable and Duplex. They were experimental before Node 24. (Newer 24.x releases also added a `type` or `readableType` option to `toWeb`, to get a byte stream. It is not needed for the basics.)

```js
const web = Readable.toWeb(fs.createReadStream(file));
for await (const chunk of web) bytes += chunk.length; // chunks are Uint8Array

const nodeReadable = Readable.fromWeb(ReadableStream.from(['one ', 'two ', 'three']));
await pipeline(nodeReadable, someNodeWritable);
```

```text
web stream delivered 17 bytes
Node side got: "one two three"
has pipe()?  : function (a Node stream now)
has getReader()? on the web stream: function
```

`fetch` gives a web stream body. A tiny local server sends three parts; the client turns the bytes into text with `TextDecoderStream`:

```js
const response = await fetch(url);
let text = '';
for await (const piece of response.body.pipeThrough(new TextDecoderStream())) text += piece;
```

```text
body is a ReadableStream: true
received text: "part 1\npart 2\npart 3\n"
```

Finally, compression has a web version too: `CompressionStream('gzip')` and `DecompressionStream('gzip')`:

```text
original bytes   : 8000
gzipped bytes    : 57
zlib can read it : true
round trip equal : true
```

(The 57 bytes depends on the zlib version.)

> **Interview tip:** "Node streams or Web Streams?" Say: for server code that touches files, sockets and `zlib`, Node streams are the native choice. Web Streams are the standard for `fetch`, for code that must also run in browsers or other runtimes, and for new libraries. Because `toWeb` and `fromWeb` exist, you can mix them. Both have backpressure, with a different API.

## 12. Stream utilities

Example file: `examples/11-utilities.js`.

### 12.1 `finished()`

`finished(stream)` (from `node:stream/promises`) resolves when a stream is **really done**: a Readable has ended, or a Writable has finished. It rejects if the stream fails or is closed too early. Use it when you did not create the pipeline yourself.

```js
const reader = Readable.from(['a', 'b']);
reader.resume();
await finished(reader);                                  // resolves

const early = new Readable({ read() {} });
setTimeout(() => early.destroy(), 10);
await finished(early).catch((err) => console.log(err.code)); // ERR_STREAM_PREMATURE_CLOSE
```

```text
Readable ended normally
Readable failed       : boom
Readable destroyed    : ERR_STREAM_PREMATURE_CLOSE
```

There is also a callback form, `stream.finished(stream, callback)`, which returns a cleanup function that removes its listeners.

A Readable only ends when somebody reads its data. That is why the example calls `reader.resume()` before it waits: with no consumer, `finished` would wait forever.

### 12.2 State properties

Streams show their state in properties. For a Writable:

```text
new                writableEnded=false writableFinished=false destroyed=false closed=false
after end()        writableEnded=true writableFinished=false destroyed=false closed=false
after finished     writableEnded=true writableFinished=true destroyed=true closed=true
```

`writableEnded` turns `true` as soon as you call `end()`. `writableFinished` turns `true` only after every chunk was handled. That gap is exactly what bug 2 in section 13 is about. After `finish` the stream destroys itself (the option `autoDestroy`, which is `true` by default), then `closed` becomes `true`. A Readable has the matching `readableEnded` and `readableFlowing`.

### 12.3 `end()` versus `destroy()`

These two look alike and are very different.

- `end()` is a **polite goodbye**: "I will write no more". Everything already written is still processed. Then `_final`, `finish` and `close` follow.
- `destroy()` is an **emergency stop**: the stream is shut down now, data still waiting is dropped, `_final` does not run, and `finish` never comes. Only `close` follows. `destroy(err)` also emits `error` first.

The example writes three chunks and then stops the stream in the three ways, and prints the events in order:

```text
end()         write:a > write:b > write:c > _final > finish > close
destroy()     write:a > close
destroy(err)  write:a > error:stop > close
```

With `end()` all three writes happen. With `destroy()` only the first write had already started; `b` and `c` were thrown away. That is the right behaviour when something went wrong or the consumer left, and the wrong one when you simply have nothing more to write. `pipeline` calls `destroy()` on the streams when one of them fails, and `end()` on the destination when the source ends normally.

> **Interview tip:** "What is the difference between `end()` and `destroy()`?" Strong answer: `end()` finishes gracefully (queued data is written, `finish` fires). `destroy()` aborts at once, drops queued data, skips `finish`, and releases resources (file handle, socket). Use `destroy(err)` to fail a stream with an error. After either one, `close` is the last event.

### 12.4 Batching small writes: `cork()` and `uncork()`

Sending many tiny writes can be slow, because each one may become a separate system call (a request to the operating system). `writable.cork()` tells the stream to hold the chunks back. `writable.uncork()` releases them together. A stream that implements `_writev` (the simplified option is `writev`) receives all the held chunks in one call.

```text
without cork(): write(2 bytes) write(2 bytes) write(2 bytes)
with cork()   : writev(3 chunks)
```

You rarely call `cork()` yourself. Know that it exists because it answers the question "how does Node write many small chunks efficiently?". Every `cork()` needs a matching `uncork()` (the example calls it in `process.nextTick`), or the held data stays held. Calling `end()` also releases it.

### 12.5 Cancelling with an `AbortSignal`

An **AbortSignal** (lesson 7) is the standard way to say "stop". Streams understand it in two ways:

```js
// 1. addAbortSignal: when the signal aborts, the stream is destroyed with an AbortError
const source = addAbortSignal(controller.signal, endlessSource());

// 2. pipeline takes { signal } as its last argument and destroys EVERY stream on abort
await pipeline(reader, writer, { signal: manual.signal });

// AbortSignal.timeout(ms) is a ready-made signal for a time limit
await pipeline(endlessSource(), nullSink(), { signal: AbortSignal.timeout(30) });
```

```text
stream error          : AbortError ABORT_ERR
pipeline rejected     : AbortError | reason: user clicked cancel
both streams destroyed: true
timeout               : AbortError | cause: TimeoutError
```

The error is an `AbortError`. For `pipeline`, the reason you passed to `abort(reason)` (or the `TimeoutError` of `AbortSignal.timeout`) is in `err.cause`, as the output shows.

### 12.6 Changing the default `highWaterMark`

```text
before                : 16384
after set to 64 KiB   : 65536 | new Writable(): 65536
restored              : 16384
```

`stream.getDefaultHighWaterMark(objectMode)` and `stream.setDefaultHighWaterMark(objectMode, value)` (Node 18.17+) change the default for streams created after the call. Streams that already exist keep their value. The setting is global for the process, so a library should not change it behind your back. Pass the `highWaterMark` option instead.

## 13. Common bugs

Example file: `examples/12-common-bugs.js`. It shows each bug safely and prints the fix next to it.

| # | Bug | What happens | Fix |
|---|---|---|---|
| 1 | No `'error'` listener | the `error` event is thrown, and the process can crash with exit code 1 | `on('error')`, or use `pipeline` / `for await` + `try/catch` |
| 2 | Using the result before the stream has finished | you read a half-written file, or a count that is still 0 | `await finished(stream)` or `await pipeline(...)` |
| 3 | Ignoring `write()` returning `false` | memory grows without limit | wait for `'drain'`, or use `pipeline` |
| 4 | Forgetting `callback()` in `_transform` or `_write` | the stream waits forever, nothing fails | always call it, once |
| 5 | Mixing `on('data')` with `for await` on the same stream | both consumers see the same chunks | choose one style |
| 6 | An `async` function as a `data` listener | the stream does not wait, so work runs all at once | `for await` with `await` inside |

```text
--- Bug 1: no error handler ---
BUG : uncaught exception, the process would have crashed: disk exploded
FIX : error handled: disk exploded

--- Bug 2: not waiting for the stream to finish ---
BUG : right after end(), chunks written: 0
FIX : after await finished(), chunks written: 3

--- Bug 3: writing in a loop without drain (the right way) ---
FIX : wrote 30 chunks, waited for drain 9 times
FIX : most bytes buffered at once: 26 (limit 20, plus the chunk that crossed it)

--- Bug 4: forgetting to call the callback ---
BUG : chunks passed: 1, ended: false
FIX : chunks passed: 3, ended: true
BUG : calling it twice  -> ERR_MULTIPLE_CALLBACK

--- Bug 5: mixing the data event and for await ---
BUG : data listener saw : [ 'abcdefghij', 'klmnopqrst', 'uvwxyz' ]
BUG : for await saw     : [ 'abcdefghij', 'klmnopqrst', 'uvwxyz' ] (every chunk handled twice)
FIX : pick ONE way to consume a stream

--- Bug 6: async work inside a data listener ---
BUG : handlers running at the same moment: 5
FIX : with for await, at the same moment : 1
```

Notes on each bug:

1. **No error handler.** A stream is an `EventEmitter`. An `'error'` event that has no listener is *thrown* (lesson 9). The example installs a `process.once('uncaughtException')` safety net only so that the demo can print the crash instead of dying. In real code, the stream that fails is often deep inside a library, so use `pipeline`, which listens for you.
2. **Not awaiting finish.** `end()` only means "I am done writing". The data may still be waiting in the buffer. `writableEnded` is `true` right away, `writableFinished` only later. Always `await` the end before you read the file, send the next request, or exit.
3. **Unhandled drain.** The correct loop is `if (!writable.write(chunk)) await once(writable, 'drain')`. `once` rejects if the stream emits `'error'` while you wait, so you do not hang on a broken stream. The full memory demo is in section 5.
4. **Forgetting the callback.** The first chunk goes through, the second is never processed, and `end` never fires (`chunks passed: 1, ended: false`). The process may exit with code 0 and no message, because a pending promise or a waiting stream keeps nothing alive. This is one of the hardest bugs to notice.
5. **Mixing styles.** The result depends on the order and timing: here each chunk reached both consumers, so the work is done twice; with other orderings one consumer can miss the first chunk. Pick one style per stream.
6. **Async `data` listener.** The `data` event does not wait for the promise your listener returns. All five handlers ran at the same time. With 5 million chunks you would open 5 million database calls. `for await` waits for each loop body, so the concurrency is 1 (use `readable.map(fn, { concurrency: n })` if you want a controlled number).

Other bugs worth knowing:

- Writing after `end()` fails with `ERR_STREAM_WRITE_AFTER_END` (an `error` event).
- `data += chunk` on text streams cuts multi-byte characters at chunk borders (lesson 10). Use `setEncoding('utf8')` or a `StringDecoder`.
- Calling `.pipe()` and trusting it to report errors (section 4).
- Calling `pipeline(...)` without `await` or a callback (section 4).
- Using `readFile` for a file that may be huge (section 14).

> **Interview tip:** "What are the most common stream bugs?" A quick strong list: no `error` handler (a crash), ignoring `write()` returning `false` (memory grows), forgetting the callback in a custom `_transform` (silent hang), using the result before the stream has finished, and using `pipe` instead of `pipeline` (leaks). For each, say the one-line fix. Interviewers like it when you give the symptom first ("the program exits quietly with half the data"), because that shows you have debugged it for real.

## 14. `readFile` or a stream?

| Situation | Choose | Why |
|---|---|---|
| Small file (config, a JSON under a few MB) that you need whole | `readFile` | simpler and faster; you need all of it anyway |
| You must call `JSON.parse` on the content | `readFile` | `JSON.parse` needs the full text |
| File size is unknown or can be large | stream | constant memory |
| A response that should start quickly (download, video) | stream | low time to first byte |
| Transforming while reading (gzip, hash, parse lines) | `pipeline` | each step handles one chunk at a time |
| Copying a file | `fs.copyFile` | the OS copies it, no need for streams |
| Thousands of tiny files | `readFile` | a stream has setup cost per file |
| Anything bigger than 2 GiB | stream | `readFile` refuses it |

Rule of thumb: **if you cannot say how big the data can get, use a stream.** If you know it is small, use the simpler call.

One more trap: a huge file that holds one big JSON array cannot be handled by `JSON.parse`, because it needs the whole text. If you control the format, store **JSON Lines** (one JSON value per line, as in Task 3 below). Then each line can be parsed on its own, and the line-by-line pattern of section 9 works.

> **Interview tip:** "When would you NOT use a stream?" Many candidates only say "always use streams". The strong answer is a rule: small data that you need whole (a config file, a JSON body under a few MB) is simpler and faster with `readFile`; use a stream when the size is unknown, large, or when you can start sending or processing early. Streams add code and failure modes (backpressure, cleanup), so they must earn their place.

## 15. Interview angle

| Question | A strong answer includes |
|---|---|
| What is a stream? | A way to process data in chunks over time instead of all at once. Constant memory, lower latency, composable. EventEmitter-based. |
| Name the four types | Readable, Writable, Duplex, Transform, with core examples (fs, http, net socket, zlib). Transform is a Duplex whose output depends on its input. |
| What is backpressure? | The slow side tells the fast side to wait. `write()` returns `false` at `highWaterMark`; wait for `'drain'`. `pipe` and `pipeline` do it for you. |
| What is `highWaterMark`? | The buffer threshold, not a hard limit. Bytes (16 KiB on Windows, 64 KiB elsewhere for plain streams, 64 KiB for `fs.createReadStream`) or objects (16) in object mode. |
| `pipe` versus `pipeline`? | `pipe` does not forward errors or destroy the other stream, so it leaks. `pipeline` does both and gives one promise or callback. |
| How do you read a 10 GB file? | `createReadStream` with `for await` or `pipeline`, never `readFile`. Process chunks as they come. |
| Flowing versus paused? | Flowing emits `data` events by itself; paused waits for `read()`. `data` listener, `resume()` or `pipe()` start flowing. |
| How do you handle errors in streams? | `pipeline` / `for await` with `try/catch`; otherwise an `error` listener on every stream. |
| What happens when the client disconnects during a download? | `pipeline` ends with `ERR_STREAM_PREMATURE_CLOSE` and destroys the file stream. |
| Why does my custom Transform hang? | A missing `callback()` call. |
| How do you process a huge file line by line? | `createReadStream` into `readline` with `for await`. A chunk is not a line, so unfinished lines must carry over to the next chunk. |
| `end()` versus `destroy()`? | `end()` finishes gracefully (queued data is written, `finish` fires). `destroy()` stops at once, drops queued data and skips `finish`. |
| How much memory does a pipeline use? | A few buffers per stage (a Transform has two), each limited by its `highWaterMark`. It does not depend on the data size. |
| Are `compose` and `readable.map` stable? | No, both are Experimental in the Node 24 docs. Use `pipeline` with generator stages in production code. |
| Node streams or Web Streams? | Node streams for fs, net, zlib; Web Streams for `fetch` and portable code; convert with `toWeb` / `fromWeb`. |

## Summary / Key takeaways
- A stream moves data in chunks. It gives constant memory, an early first byte, and pieces that connect with pipes.
- There are four types: Readable, Writable, Duplex (two independent sides) and Transform (output computed from input). Chunks are Buffers (or any value in object mode).
- Consume a Readable with `for await` in application code. It gives you exceptions for errors, automatic backpressure and automatic cleanup.
- Backpressure: `write()` returns `false` when buffered size reaches `highWaterMark`. Stop, wait for `'drain'`, continue. The default is 16 KiB on Windows and 64 KiB on Linux and macOS for byte streams, 64 KiB for `fs.createReadStream`, and 16 objects in object mode.
- Use `pipeline` (promise form) instead of `pipe`. It forwards errors, destroys every stream on failure and tells you when it is done. `end()` is a graceful stop (`finish` fires); `destroy()` is an emergency stop (queued data is dropped).
- To write a stream, implement `_read`, `_write` or `_transform` (class form) or pass `read`, `write`, `transform` options (simplified form). Always call the callback exactly once.
- Generators work as pipeline stages. `compose` and the operators (`map`, `filter`, `toArray`) are marked Experimental in the Node 24 docs. A chunk is not a line: split lines by carrying the unfinished piece over (or use `readline`).
- Web Streams are the browser-standard version, used by `fetch`; `Readable.toWeb` and `Readable.fromWeb` convert between the two worlds. Use `readFile` for small data you need whole, and a stream when the size is unknown or large.

## Quick check

1. Name three benefits of streams over `readFile`.
<details><summary>Answer</summary>

Constant memory (only a few chunks at a time), a lower time to first byte (you can use the first chunk right away), and composition: small steps connected with `pipeline`, each with backpressure. Streams also work for data bigger than memory, while `readFile` refuses files over 2 GiB.

</details>

2. Which stream type is each: `fs.createReadStream`, `net.Socket`, `zlib.createGzip()`, `process.stdout`?
<details><summary>Answer</summary>

`fs.createReadStream` is a Readable. `net.Socket` is a Duplex. `zlib.createGzip()` is a Transform. `process.stdout` is a Writable (when connected to a pipe it is a `net.Socket`, which is a Duplex, but you use it only as a Writable).

</details>

3. `writable.write(chunk)` returned `false`. What does it mean and what must you do?
<details><summary>Answer</summary>

The internal buffer has reached `highWaterMark`. The chunk was accepted (nothing is lost), but you should stop writing and wait for the `'drain'` event before you write more. If you ignore it, the data piles up in memory.

```js
if (!writable.write(chunk)) await once(writable, 'drain');
```

</details>

4. What are the default `highWaterMark` values for a plain `new Writable()` in byte mode, in object mode, and for `fs.createReadStream()` on Node 24?
<details><summary>Answer</summary>

A plain byte stream: 16384 (16 KiB) on Windows and 65536 (64 KiB) on Linux and macOS. Object mode: 16 objects. `fs.createReadStream()`: 65536 bytes on every platform. Use `stream.getDefaultHighWaterMark(false)` to see the value on your machine.

</details>

5. Why is `source.pipe(destination)` risky in production, and what do you use instead?
<details><summary>Answer</summary>

`pipe` does not forward errors and does not destroy the other stream when one fails. The other side stays open (a file handle or socket leak) and an unhandled `error` event can crash the process. Use `stream.pipeline` (or `require('node:stream/promises').pipeline`), which destroys all streams on failure and reports one error.

</details>

6. Why is `for await (const chunk of stream)` the preferred way to read a stream?
<details><summary>Answer</summary>

Errors become normal exceptions you can `try/catch`, the next chunk is requested only when the loop body is done (automatic backpressure, even with `await` inside), and leaving the loop early (`break`, `return`, `throw`) destroys the stream so resources are released.

</details>

7. A custom Transform processes the first chunk and then nothing more happens, with no error. What is the most likely cause?
<details><summary>Answer</summary>

`_transform` did not call its `callback()`. The stream waits for the callback before it gives the next chunk. Always call `callback()` exactly once per chunk, even if you pushed no output. Calling it twice gives `ERR_MULTIPLE_CALLBACK`.

</details>

8. What does `Readable.from('hello').toArray()` return, and why?
<details><summary>Answer</summary>

`['hello']`: one chunk. `Readable.from` does not split a string (or a Buffer) into characters. To get characters, pass an array: `Readable.from([...'hello'])`. Note also that `Readable.from` makes an object mode stream, so its `highWaterMark` is 1.

</details>

9. What does `highWaterMark` count in object mode, and why does it matter?
<details><summary>Answer</summary>

It counts objects, not bytes. A 1 MB object counts as 1, so 15 big objects (15 MB) can be waiting before `write()` returns `false` for the 16th. With big objects, object mode can use much more memory than the number suggests.

</details>

10. What is the difference between the `finish` and `close` events of a Writable, and between `end()` and `destroy()`?
<details><summary>Answer</summary>

`finish` means `end()` was called and all data has been handled. `close` comes later, after the stream is destroyed and its resources (for example the file handle) are released. For a healthy Writable the order is `_final`, `finish`, `_destroy`, `close`. `end()` is the graceful way (queued data is still written). `destroy()` is the emergency stop: queued data is dropped and `finish` never fires, only `close` (and `error` first if you passed an error).

</details>

## Try it yourself

Each task is self-contained. Save it as a file and run it with `node file.js` from any folder. Each task creates its files in a temporary folder and removes them at the end.

### Task 1 (easy): upper-case a file with a pipeline

Write a program that creates a small text file, then uses `pipeline` with a `Transform` to write an upper-case copy of it into a second file, and prints the content of the copy.

<details><summary>Hint</summary>

Use `fs.createReadStream(input)`, a `new Transform({ transform(chunk, encoding, callback) { ... } })` that calls `callback(null, chunk.toString().toUpperCase())`, and `fs.createWriteStream(output)`. Use the promise form of `pipeline` and `await` it before reading the output file.

</details>

<details><summary>Solution</summary>

```js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task1-'));
  try {
    const input = path.join(dir, 'in.txt');
    const output = path.join(dir, 'out.txt');
    fs.writeFileSync(input, 'hello streams\nsecond line\n');

    const upperCase = new Transform({
      transform(chunk, encoding, callback) {
        callback(null, chunk.toString().toUpperCase());
      },
    });

    await pipeline(fs.createReadStream(input), upperCase, fs.createWriteStream(output));
    console.log(JSON.stringify(fs.readFileSync(output, 'utf8')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main();
```

Output:

```text
"HELLO STREAMS\nSECOND LINE\n"
```

`await pipeline(...)` returns only after the output file is completely written, so reading it afterwards is safe. (For text with non-ASCII characters, a chunk could end inside a character. Use a `StringDecoder`, as in section 9, for such data.)

</details>

### Task 2 (medium): write `writeAll` that respects backpressure

Write `async function writeAll(writable, chunks)` that writes every chunk, waits for `'drain'` whenever `write()` returns `false`, ends the stream, and resolves only when the stream has finished. Test it with a slow Writable (`highWaterMark: 1024`) and 1000 chunks of 100 bytes. Show that all 100000 bytes arrived and that the buffer stayed small.

<details><summary>Hint</summary>

Loop over the chunks. `if (!writable.write(chunk)) await once(writable, 'drain');`. After the loop call `writable.end()` and `await finished(writable)` (from `node:stream/promises`). In the slow Writable, call `setImmediate(callback)` so that data really waits, and record `this.writableLength` inside `write()`.

</details>

<details><summary>Solution</summary>

```js
const { Writable } = require('node:stream');
const { once } = require('node:events');
const { finished } = require('node:stream/promises');

// Writes every chunk, waits for 'drain' whenever write() says "slow down", and resolves when done.
async function writeAll(writable, chunks) {
  for (const chunk of chunks) {
    if (!writable.write(chunk)) await once(writable, 'drain');
  }
  writable.end();
  await finished(writable);
}

async function main() {
  let received = 0;
  let mostBuffered = 0;
  const slow = new Writable({
    highWaterMark: 1024,
    write(chunk, encoding, callback) {
      mostBuffered = Math.max(mostBuffered, this.writableLength);
      received += chunk.length;
      setImmediate(callback);
    },
  });

  const chunks = Array.from({ length: 1000 }, () => Buffer.alloc(100, 'x'));
  await writeAll(slow, chunks);

  console.log('bytes received :', received);
  console.log('most buffered  :', mostBuffered, '(limit 1024, chunk 100)');
  console.log('stayed small   :', mostBuffered <= 1024 + 100);
}

main();
```

Output:

```text
bytes received : 100000
most buffered  : 1000 (limit 1024, chunk 100)
stayed small   : true
```

`once(writable, 'drain')` also rejects if the stream emits `'error'` while you wait, so the function cannot hang on a broken stream. The buffer never grows past the limit plus one chunk, because the loop pauses whenever `write()` returns `false`.

</details>

### Task 3 (harder): filter a gzip log file with generator stages

Create a gzip-compressed log file of JSON lines (`{"level":"info","msg":"..."}`). Build one `pipeline` that: reads the file in tiny 16 byte chunks, gunzips it, splits the bytes into lines (keeping the unfinished last line between chunks), parses each line, keeps only the entries with `level` equal to `"error"`, turns them into text lines like `ERROR: disk almost full`, gzips them, and writes a new `.gz` file. Print the decompressed result. Then feed the pipeline a file that is not gzip data and show that the pipeline rejects.

<details><summary>Hint</summary>

Write each step as an async generator function: `splitLines` (use a `StringDecoder('utf8')` and a `rest` string, `yield*` the complete lines), `onlyErrors` (`JSON.parse` each line, `yield` only the errors) and `format`. Pass them in order to `pipeline` between `zlib.createGunzip()` and `zlib.createGzip()`. For the failure test, put plain text in the input file and catch the error of `await pipeline(...)`.

</details>

<details><summary>Solution</summary>

```js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { StringDecoder } = require('node:string_decoder');
const { pipeline } = require('node:stream/promises');

// Stage 1: bytes in, one line (string) out. Keeps the unfinished last line for the next chunk.
async function* splitLines(source) {
  const decoder = new StringDecoder('utf8');
  let rest = '';
  for await (const chunk of source) {
    rest += decoder.write(chunk);
    const lines = rest.split('\n');
    rest = lines.pop();
    yield* lines;
  }
  rest += decoder.end();
  if (rest.length > 0) yield rest;
}

// Stage 2: keep only the error entries, as objects.
async function* onlyErrors(lines) {
  for await (const line of lines) {
    if (line.trim() === '') continue;
    const entry = JSON.parse(line);
    if (entry.level === 'error') yield entry;
  }
}

// Stage 3: objects to text lines.
async function* format(entries) {
  for await (const entry of entries) yield `ERROR: ${entry.msg}\n`;
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task3-'));
  try {
    const input = path.join(dir, 'app.log.gz');
    const output = path.join(dir, 'errors.txt.gz');

    const log = [
      { level: 'info', msg: 'server started' },
      { level: 'error', msg: 'disk almost full' },
      { level: 'info', msg: 'request ok' },
      { level: 'error', msg: 'café database timeout' },
    ].map((entry) => JSON.stringify(entry)).join('\n');
    fs.writeFileSync(input, zlib.gzipSync(log));

    await pipeline(
      fs.createReadStream(input, { highWaterMark: 16 }), // tiny chunks on purpose
      zlib.createGunzip(),
      splitLines,
      onlyErrors,
      format,
      zlib.createGzip(),
      fs.createWriteStream(output),
    );
    console.log(zlib.gunzipSync(fs.readFileSync(output)).toString().trimEnd());

    // A broken input rejects the pipeline, and nothing stays open.
    fs.writeFileSync(input, 'this is not gzip data');
    try {
      await pipeline(fs.createReadStream(input), zlib.createGunzip(), fs.createWriteStream(output));
    } catch (err) {
      console.log('pipeline failed as expected:', err.code);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main();
```

Output:

```text
ERROR: disk almost full
ERROR: café database timeout
pipeline failed as expected: Z_DATA_ERROR
```

The 16 byte chunks cut lines and the `é` into pieces. The `StringDecoder` repairs the character and `rest` repairs the line. If the pipeline fails, every stream is destroyed, so the temporary folder can be removed even on Windows (an open file handle would block the removal).

</details>

## Where to go next

- Next lesson: [12. HTTP and Networking with Core Modules](../12-http-and-networking/README.md). The HTTP request and response are streams, so you will use this lesson in every handler.
- Practise this topic in the interview rounds: [Round 1 - screening questions](../../rounds/round-1-screening/questions.md), [Round 2 - core questions](../../rounds/round-2-core/questions.md), [Round 3 - coding challenges](../../rounds/round-3-coding/questions.md) and [Round 4 - advanced questions](../../rounds/round-4-advanced/questions.md).
- Back to the [All lessons](../../README.md) page.
