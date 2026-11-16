# 10. Buffers and Binary Data

> Level: Intermediate   Time: about 120 minutes   Node: 24 (notes where older versions differ)

[Previous: 09. Events and EventEmitter](../09-events/README.md) | [All lessons](../../README.md) | [Next: 11. Streams and Backpressure](../11-streams/README.md)

## What you will learn
- What binary data is, where Buffers come from in real programs, and why a JavaScript string cannot hold bytes safely
- How to create Buffers with `Buffer.from`, `Buffer.alloc` and `Buffer.allocUnsafe`, and why `alloc` fills with zeros
- How a Buffer is related to `Uint8Array`, `ArrayBuffer` and `DataView`
- How to turn bytes into text and back (utf8, hex, base64, base64url, latin1, utf16le), why string length and byte length differ, and what breaks when binary data is read as utf8
- The sharing trap: `subarray` shares memory, `Buffer.from` and `copy` do not
- How to read and write numbers (endianness) and how to parse a tiny binary protocol header
- The shared Buffer pool (8 KiB on Node 24.16), off-heap memory, the `allocUnsafe` leak risk, and how to send a Buffer to a worker thread
- Characters split across chunks (`StringDecoder`, `TextDecoder`), Buffers in streams, `Buffer.toJSON`, `Blob`, data URLs and a hex dump helper

Every example runs from the repo root, for example `node lessons/10-buffers/examples/01-create-basics.js`. Example 09 needs one extra flag, shown in its section.

## 1. What is binary data?

A computer stores everything as **bytes**. A byte is a number from 0 to 255 (8 bits, each bit is a 0 or a 1). Text is only one way to read bytes: "the byte 72 means the letter H". A PNG image, a zip file, a network packet and a SHA-256 hash are also bytes, but they do not mean text.

JavaScript strings are made for text, and they are a poor fit for raw bytes:

- A string is a list of **characters**. Bytes that are not valid text get changed or thrown away when you force them into a string (you will see this in section 5).
- A string is **immutable**: every change makes a new string. A byte buffer must be changed in place, cheaply.
- A string cannot say "these four bytes are one 32-bit number". Binary formats are exactly that: numbers at fixed positions.

So Node has a type that holds bytes exactly. It is the **Buffer**. (JavaScript had no such type when Node was created. Later the language added typed arrays, and today `Buffer` is built on top of them, see section 3.)

Think of a Buffer as a fixed-size row of numbered boxes. Each box holds one number from 0 to 255. You can read a box, change a box and look at part of the row through a window, but you cannot make the row longer.

Where do Buffers appear in a real Node program? A **stream** is data that arrives in pieces over time (a big file, a network connection). Each piece is called a **chunk**, and by default a chunk is a Buffer.

| Place | What you get |
|---|---|
| `fs.readFile('photo.png')` (no encoding given) | a Buffer with the file bytes |
| `fs.readFile('notes.txt', 'utf8')` | a string (Node decoded the Buffer for you) |
| `data` events of a socket or an HTTP request body | Buffer chunks |
| `crypto.createHash('sha256').update(x).digest()` | a Buffer (32 bytes) |
| `crypto.randomBytes(16)` | a Buffer |
| `zlib.gzipSync(data)` | a Buffer |
| the chunks of any byte stream | Buffers |

The last part of `examples/01-create-basics.js` makes four of these, with no network and no extra files:

```js
fs.writeFileSync(file, 'caf\u00e9'); // 4 characters, 5 bytes on disk
console.log('readFileSync(file)         :', fs.readFileSync(file)); // no encoding given: a Buffer
console.log("readFileSync(file, 'utf8') :", fs.readFileSync(file, 'utf8')); // encoding given: a string

const digest = crypto.createHash('sha256').update('hello').digest(); // a Buffer
const token = crypto.randomBytes(16); // random, so only the size is predictable
const packed = zlib.gzipSync('hello '.repeat(20)); // compressed bytes
```

```text
--- where real Buffers come from ---
readFileSync(file)         : <Buffer 63 61 66 c3 a9> <- no encoding given: a Buffer
readFileSync(file, 'utf8') : café <- encoding given: a string
sha256 digest              : 32 bytes, hex starts 2cf24dba
randomBytes(16)            : 16 bytes = 32 hex characters
gzipSync(text)             : true | starts with 1f 8b: true | smaller: true
gunzipSync(packed) matches : true
```

The same five bytes are a Buffer or a string depending on one argument. The hash and the gzip output are bytes that were never text, so they must stay Buffers (or be shown with `hex` or `base64`, section 4).

> **Remember:** a Buffer holds bytes, not text. Text is one possible reading of those bytes, and you choose the reading (the "encoding") yourself.

> **Interview tip:** "What is a Buffer and why does Node need it?" A strong answer: a fixed-size sequence of bytes in memory outside the V8 heap, used for files, sockets, hashes and compression. JavaScript strings are for text, and converting arbitrary bytes to a string loses data. A Buffer is a `Uint8Array` subclass with helpers for encodings and numbers.

## 2. Creating a Buffer

Example file: `examples/01-create-basics.js` (parts 1 to 6).

Three everyday ways to make a Buffer:

- `Buffer.from(...)` makes a Buffer from data you already have (a string, an array, another Buffer).
- `Buffer.alloc(size)` makes a Buffer of `size` bytes, all zero.
- `Buffer.allocUnsafe(size)` makes a Buffer of `size` bytes that is **not cleared**. It is faster because it skips the zero-fill and takes small Buffers from a shared block of memory called the pool (section 11). The price: it may contain old data.

```js
// 1. Buffer.from(string): the string is turned into bytes (utf8 by default)
const fromString = Buffer.from('Hi!');
console.log('from string   :', fromString);

// 2. Buffer.from(array): every item becomes one byte (value modulo 256)
const fromArray = Buffer.from([72, 105, 33, 256, 257, -1]);
console.log('from array    :', fromArray);

// 3. Buffer.from(buffer): a COPY of the bytes
const original = Buffer.from([1, 2, 3]);
const copy = Buffer.from(original);
copy[0] = 99;
console.log('original      :', original, '(the copy was changed, this was not)');

// 4. Buffer.alloc(size): zero filled and safe
console.log('alloc(4)      :', Buffer.alloc(4));
console.log('alloc fill 7  :', Buffer.alloc(4, 7));
console.log('alloc fill str:', Buffer.alloc(5, 'ab'));

// 5. Buffer.allocUnsafe(size): NOT cleared. Fast, but you must fill every byte yourself.
const fast = Buffer.allocUnsafe(4);
fast.fill(0); // we overwrite all of it before we use it
console.log('allocUnsafe   :', fast, '(after fill(0))');

// 6. length is the number of BYTES. byteLength(string) tells you the size before you encode.
const text = 'Hi!';
console.log('length        :', fromString.length, '| byteLength(text):', Buffer.byteLength(text));
```

```text
from string   : <Buffer 48 69 21>
from array    : <Buffer 48 69 21 00 01 ff>
original      : <Buffer 01 02 03> (the copy was changed, this was not)
alloc(4)      : <Buffer 00 00 00 00>
alloc fill 7  : <Buffer 07 07 07 07>
alloc fill str: <Buffer 61 62 61 62 61>
allocUnsafe   : <Buffer 00 00 00 00> (after fill(0))
length        : 3 | byteLength(text): 3
```

- `Buffer.from('Hi!')` gives three bytes: 72, 105, 33. Buffers print in **hex** (base 16: two digits per byte, from `00` to `ff`), so that is `48 69 21`. The default encoding is utf8, the standard way to turn text into bytes (section 4).
- Array items are cut to one byte ("value modulo 256"): 256 becomes 0, 257 becomes 1, -1 becomes 255 (`ff`).
- `Buffer.from(buffer)` copies. Changing the copy did not change the original.
- `length` is the number of **bytes**, not characters. `Buffer.byteLength(string)` tells you how many bytes a string needs, without making the Buffer.

| Call | Where the bytes come from | Copies the data? | Cleared? |
|---|---|---|---|
| `Buffer.from(string, encoding)` | the string, encoded | yes (new bytes) | n/a |
| `Buffer.from(array)` | one byte per item | yes | n/a |
| `Buffer.from(buffer)` or `Buffer.from(typedArray)` | another Buffer or typed array | yes | n/a |
| `Buffer.from(arrayBuffer, offset, length)` | the same memory | **no, shared** | n/a |
| `Buffer.alloc(size, fill)` | new memory | n/a | yes (zeros or `fill`) |
| `Buffer.allocUnsafe(size)` | new memory, usually from the pool | n/a | **no** |
| `Buffer.allocUnsafeSlow(size)` | new memory, never from the pool | n/a | **no** |

`Buffer.from(5)` throws a `TypeError`: a number is a size, not data, so you want `Buffer.alloc(5)`. Asking for a size that is negative or above `buffer.constants.MAX_LENGTH` throws a `RangeError` (`ERR_OUT_OF_RANGE`). Asking for more memory than the machine can give throws a `RangeError` too ("Array buffer allocation failed").

> **Interview tip:** "Why was `new Buffer(size)` deprecated?" Strong answer: one function did different things depending on the argument type, and in old Node versions `new Buffer(number)` returned memory that was not cleared, which leaked old data. Since Node 8 it returns zeros, but it still prints the runtime warning DEP0005 on Node 24 (only for code outside `node_modules`). Use `Buffer.from`, `Buffer.alloc` or `Buffer.allocUnsafe`. The old `SlowBuffer` name (now `Buffer.allocUnsafeSlow`) prints DEP0030 on Node 24 and is gone in Node 25.

## 3. A Buffer is a Uint8Array

Example file: `examples/01-create-basics.js` (parts 7 to 9).

A `Uint8Array` is the standard JavaScript type for "a fixed-size list of bytes" (the "U" means unsigned, "8" means 8 bits per item). `Buffer` is a subclass of it. So everything you know about typed arrays works: indexing, `length`, `for...of`, `map`, `subarray`. `Buffer` adds Node helpers on top (`toString('hex')`, `readUInt16BE`, `equals`, `write` and more).

```js
console.log('is Uint8Array :', fromString instanceof Uint8Array);
console.log('is Buffer     :', Buffer.isBuffer(fromString), Buffer.isBuffer(new Uint8Array(3)));
console.log('class chain   :', Object.getPrototypeOf(Buffer).name, '<- Buffer extends this');

// Items are numbers from 0 to 255 and the size is fixed
const b = Buffer.from([1, 2, 3, 4]);
b[0] = 256 + 5; // wraps around: 261 % 256 = 5
b[1] = -1; // wraps around: 255
b[10] = 9; // outside the buffer: silently ignored
b.length = 2; // cannot resize: ignored here (in strict mode or an ES module this throws a TypeError)
console.log('wrap & fixed  :', b, '| b[10] =', b[10], '| length =', b.length);

let sum = 0;
for (const byte of Buffer.from('abc')) sum += byte; // iterate like any typed array
console.log('sum of bytes  :', sum, '(97 + 98 + 99)');
```

```text
is Uint8Array : true
is Buffer     : true false
class chain   : Uint8Array <- Buffer extends this
wrap & fixed  : <Buffer 05 ff 03 04> | b[10] = undefined | length = 4
sum of bytes  : 294 (97 + 98 + 99)
```

1. Every item is a number from 0 to 255. Writing 261 stores 5 (261 minus 256), writing -1 stores 255.
2. The size is fixed. Writing outside the buffer (`b[10] = 9`) is silently ignored and reading outside gives `undefined`. Assigning to `length` does nothing (in strict mode, for example in an ES module, it throws a `TypeError` because `length` has no setter).
3. `Buffer.isBuffer(new Uint8Array(3))` is `false`. Every Buffer is a Uint8Array, but not the other way round.

Where a Buffer differs from a plain `Uint8Array`:

| | `Uint8Array` | `Buffer` |
|---|---|---|
| `x.toString()` | `"104,105"` (numbers joined by commas) | decodes the bytes as text (utf8 by default), or `toString('hex')`, `toString('base64')` |
| `console.log(x)` | `Uint8Array(2) [ 104, 105 ]` | `<Buffer 68 69>` |
| `JSON.stringify(x)` | `{"0":104,"1":105}` | `{"type":"Buffer","data":[104,105]}` |
| `x.slice(a, b)` | **copies** the bytes | **shares** the bytes (like `subarray`) |
| Number helpers | none (use `DataView`) | `readUInt16BE`, `writeInt32LE`, `readDoubleBE`, ... |
| Search and compare | basic | `indexOf('text')`, `includes`, `equals`, `compare`, `fill('text')` |
| After `structuredClone` or `postMessage` | stays a `Uint8Array` | arrives as a plain `Uint8Array` (Buffer methods are gone) |

> **Common mistake:** building a string with `'Data: ' + buf` or `` `${buf}` ``. That quietly calls `buf.toString()`, which decodes as utf8. For binary data this destroys bytes (section 5).

> **Interview tip:** "Is a Buffer a Uint8Array?" Yes: `Buffer.from('a') instanceof Uint8Array` is `true`. A strong answer adds the differences: the extra methods, `toString` with encodings, `slice` that shares memory, and that Node APIs return Buffers while web-standard APIs use plain `Uint8Array`.

## 4. Encodings: turning bytes into text and back

Example file: `examples/02-encodings.js`.

An **encoding** is a rule between bytes and text. (ASCII, the oldest one, covers 128 characters: English letters, digits and punctuation, one byte each.) There are two kinds:

- **Text encodings** (utf8, utf16le, latin1, ascii) map text characters to bytes and back.
- **Binary-to-text encodings** (hex, base64, base64url) write any bytes as safe, printable characters, for logs, JSON, URLs and headers.

| Name | Kind | What it does | Typical use |
|---|---|---|---|
| `utf8` (default) | text | 1 to 4 bytes per character. ASCII letters are 1 byte | almost all text, JSON, HTTP |
| `utf16le` (also `ucs2`) | text | 2 bytes per character (4 for emoji), low byte first | some Windows APIs and file formats |
| `latin1` (also `binary`) | text | each byte value is the character with the same code point, U+0000 to U+00FF (1 byte = 1 character) | legacy data, lossless carrier for bytes |
| `ascii` | text | like `latin1`, but decoding drops the top bit of every byte | rarely a good idea, prefer `utf8` |
| `hex` | bytes to text | 2 hex digits per byte | debugging, hashes, keys |
| `base64` | bytes to text | 3 bytes become 4 characters, `=` padding | email, JSON, data URLs |
| `base64url` | bytes to text | like base64 with `-` and `_` and no padding | JWT, URLs, file names |

Take `const buf = Buffer.from('Héllo €')` (7 characters) and call `buf.toString(encoding)` with each encoding name:

```text
text     : Héllo € (7 characters)
bytes    : 10
utf8     : Héllo €
hex      : 48c3a96c6c6f20e282ac
base64   : SMOpbGxvIOKCrA==
base64url: SMOpbGxvIOKCrA
latin1   : 'HÃ©llo â\x82¬' (each byte shown as one character)
ascii    : 'HC)llo b\x02,' (top bit of every byte dropped)
utf16le  : 4800e9006c006c006f002000ac20 (2 bytes per character here)
```

The `latin1` and `ascii` lines read the same 10 bytes one at a time, so the 2 bytes of `é` and the 3 bytes of `€` turn into odd characters. Only `utf8` reads the bytes the way they were written.

Now round trips. Text encodings can lose characters, while hex and base64 never lose bytes:

```text
--- round trips (text -> bytes -> text) ---
utf8     lossless
utf16le  lossless
latin1   LOSSY, got 'Héllo ¬'
ascii    LOSSY, got 'Hillo ,'

--- hex and base64 are for BYTES, not for text ---
hex      : fbffbf0010 | back: true
base64   : +/+/ABA= | back: true

--- base64 vs base64url ---
base64   : +/+/ (uses + and /)
base64url: -_-_ (uses - and _, no = padding)
padding  : YQ== vs YQ
decoding accepts both alphabets: true
```

`latin1` and `ascii` are **lossy** for text outside their range: `€` is U+20AC and does not fit in one byte, so only its low byte (`0xAC`) is kept. `utf8` and `utf16le` can write every character.

Base64 turns every 3 bytes into 4 characters, so it is about 33 percent bigger (`Math.ceil(bytes / 3) * 4` characters). `base64url` swaps `+` and `/` for `-` and `_` so the result is safe in a URL, and drops the `=` padding. When decoding, Node accepts both alphabets and ignores spaces and new lines.

Decoding is forgiving. Bad input is cut or skipped, not rejected:

```text
--- decoding is forgiving: bad hex is cut, not rejected ---
'4a4b'   : <Buffer 4a 4b>
'4a4b5'  : <Buffer 4a 4b> (odd last digit dropped)
'4azz4b' : <Buffer 4a> (stops at the first bad pair)
```

Only a wrong encoding **name** is an error: `buf.toString('nope')` throws `ERR_UNKNOWN_ENCODING`. `Buffer.isEncoding(name)` checks a name without throwing (names are not case sensitive; `'utf-16'` is not valid, but `'utf-16le'` and `'ucs2'` are).

To change the text encoding of bytes you already have, use `buffer.transcode(buf, from, to)` (it works with utf8, utf16le, latin1 and ascii):

```js
const { transcode } = require('node:buffer');
const euro = Buffer.from('\u20ac'); // utf8: e2 82 ac
console.log('as utf16le     :', transcode(euro, 'utf8', 'utf16le'), '(U+20AC stored low byte first)');
```

```text
as utf16le     : <Buffer ac 20> (U+20AC stored low byte first)
```

> **Version note:** newer JavaScript engines add `Uint8Array.fromBase64()` and `.toHex()`. They arrive with Node 25 and are `undefined` on Node 24.16, so on Node 24 keep using `Buffer`.

> **Interview tip:** base64 is an encoding, not encryption. Anyone can decode it. It makes bytes printable, it does not hide them. Know the size rule too: base64 costs about 33 percent more space than the raw bytes.

## 5. Characters are not bytes

Example file: `examples/03-string-vs-bytes.js`.

Unicode gives every character a number called a **code point** (`é` is U+00E9, the grinning-face emoji is U+1F600). JavaScript stores strings as UTF-16, in 16-bit pieces called **code units**. Small code points take one unit, big ones such as emoji take two. A string's `length` counts code units. That is neither the number of visible characters nor the number of bytes.

```js
for (const s of ['hello', 'héllo', '€', 'こんにちは', '😀', '👨‍👩‍👧']) {
  const length = s.length; // UTF-16 code units
  const chars = [...s].length; // code points
  const bytes = Buffer.byteLength(s); // utf8 bytes
  const hex = bytes <= 8 ? Buffer.from(s).toString('hex') : '...';
  console.log(String(length).padStart(6), String(chars).padStart(5), String(bytes).padStart(5), hex.padEnd(12), s);
}
```

```text
--- characters are not bytes ---
length chars bytes utf8 hex       text
     5     5     5 68656c6c6f   hello
     5     5     6 68c3a96c6c6f héllo
     1     1     3 e282ac       €
     5     5    15 ...          こんにちは
     2     1     4 f09f9880     😀
     8     5    18 ...          👨‍👩‍👧
```

- `length` is the string's `.length` (UTF-16 code units).
- `chars` is the number of Unicode code points (`[...s].length`).
- `bytes` is the size written as utf8 (`Buffer.byteLength(s)`).

The grinning-face emoji counts 2 for `length`, 1 for `chars` and 4 for `bytes`. The last row is the "family" emoji: one symbol on screen, but five code points glued together, 18 bytes.

This matters in real code:

- `Content-Length`, the HTTP header that tells the receiver how many bytes the body has, is in **bytes**. `res.setHeader('Content-Length', text.length)` is wrong for non-ASCII text. Use `Buffer.byteLength(text)`.
- Database columns, protocol fields and file formats usually limit **bytes**, not characters.
- Cutting a Buffer in the middle of a character breaks the character:

```text
--- cutting a string by BYTES can cut a character in half ---
whole      : café
first 4 B  : 'caf�' (half of the e-acute)
```

### Binary data is not utf8 text

utf8 has rules about which byte sequences are valid. The byte `0x89` (the first byte of every PNG file) can never start a utf8 character. When `toString('utf8')` meets such bytes it does not throw. It writes the **replacement character** U+FFFD instead (stored as the three bytes `ef bf bd`). The original byte is gone for good.

```js
const asText = png.toString('utf8'); // lossy: 0x89 is not valid utf8
console.log('as utf8 text       :', inspect(asText));
const back = Buffer.from(asText, 'utf8');
console.log('text back to bytes :', back.toString('hex'));
```

```text
--- binary data is NOT utf8 text ---
original bytes     : 89504e470d0a1a0a
valid utf8?        : false
as utf8 text       : '�PNG\r\n\x1A\n'
text back to bytes : efbfbd504e470d0a1a0a
same bytes?        : false (8 bytes became 10)

--- safe ways to carry binary data inside a string ---
latin1 round trip  : true (1 byte <-> 1 char, but the text looks like garbage)
hex round trip     : true (2 chars per byte)
base64 round trip  : true (about 1.33 chars per byte)
```

The first conversion is a one-way trip: 8 bytes became 10 different bytes. To carry binary data inside a string, use an encoding that maps every byte value to a character and back. `latin1` does (256 byte values, 256 characters), but the text looks like garbage. `hex` and `base64` are the readable, standard choices. Node also has `buffer.isUtf8(buf)` to check whether bytes are valid utf8 before you decode them (and `buffer.isAscii(buf)` for plain ASCII).

### A hidden character: the byte order mark

Some Windows programs (older Notepad versions, some Excel exports) write the three bytes `ef bb bf` at the start of a utf8 file. They are the **byte order mark** (BOM), which is the valid utf8 form of the invisible character U+FEFF. `toString()` keeps it, so it ends up at the start of your string:

```js
const withBom = Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]); // BOM, then the text {}
const kept = withBom.toString('utf8');
JSON.parse(kept); // throws SyntaxError
```

```text
--- a hidden character: the byte order mark (BOM) ---
toString() length      : 3 (1 invisible BOM character + 2 visible ones)
first char code        : feff <- U+FEFF, not part of your data
JSON.parse             : SyntaxError <- the BOM breaks it
TextDecoder removes it : '{}'
or cut it off yourself : '{}'
```

`fs.readFileSync(file, 'utf8')` behaves the same way. A `TextDecoder` removes the BOM by default, or you can cut it off with `text.replace(/^\uFEFF/, '')`. This is the usual answer to "my JSON file parses fine in the editor but `JSON.parse` fails with an unexpected token at position 0".

> **Interview tip:** "What happens if you convert binary data with `toString('utf8')`?" Strong answer: invalid byte sequences are replaced with U+FFFD, so the conversion is lossy and cannot be reversed. Use `hex`, `base64`, or keep it as a Buffer. Never read an image, an archive or an encrypted blob as utf8.

## 6. Sharing versus copying

Example file: `examples/04-share-vs-copy.js`.

`subarray(start, end)` does not copy. It returns a new Buffer object that looks at the **same memory**, like a window. That is fast, but a change through one object shows up in the other.

```js
console.log('--- subarray: a window onto the same bytes ---');
const parent = Buffer.from('hello world');
const view = parent.subarray(0, 5); // no bytes are copied
view[0] = 0x4a; // 'J'
console.log('view   :', view.toString());
console.log('parent :', parent.toString(), '<- the parent changed too');
console.log('same memory?', view.buffer === parent.buffer);
```

```text
--- subarray: a window onto the same bytes ---
view   : Jello
parent : Jello world <- the parent changed too
same memory? true
```

`buf.slice()` on a Buffer shares as well, even though the `slice` of a plain typed array copies. The Node docs mark `buf.slice()` as deprecated in favor of `subarray`, so use `subarray`. To get a real copy, use `Buffer.from(buf)`, `buf.copy(target)` or `Buffer.concat([buf])` (the file shows all three):

```text
--- slice on a Buffer also shares (the name is misleading) ---
parent : Jello World

--- but slice on a plain Uint8Array COPIES ---
u8     : 1,2,3,4 <- unchanged

--- three ways to get a real copy ---
src    : abcdef <- never changed
copy1  : Xbc
copy2  : aYc (copy() returned 3)
copy3  : abZ
```

| Call | Copies the bytes? |
|---|---|
| `buf.subarray(a, b)` | no, shares |
| `buf.slice(a, b)` | no for a Buffer (deprecated name), yes for a plain `Uint8Array` |
| `Buffer.from(buf)` | yes |
| `buf.copy(target, targetStart, sourceStart, sourceEnd)` | yes, into a Buffer you already have; returns the number of bytes copied |
| `Buffer.concat([buf])` | yes (always makes a new Buffer) |
| `Buffer.from(arrayBuffer)` | no, shares |

`buf.copy` also works inside one buffer. Overlapping ranges are handled correctly: in the example file, `moving.copy(moving, 1, 0, 4)` turns `12345` into `11234`.

There is a second, quieter problem: a tiny view keeps the **whole parent** alive in memory.

```js
const big = Buffer.alloc(1024 * 1024); // 1 MiB
const tiny = big.subarray(0, 4);
console.log('tiny.length            :', tiny.length);
console.log('tiny keeps this alive  :', tiny.buffer.byteLength, 'bytes');
const exact = Buffer.alloc(4); // exact-size copy, then the big one can be freed
tiny.copy(exact);
console.log('exact copy owns        :', exact.buffer.byteLength, 'bytes');
```

```text
--- a tiny view keeps the whole parent alive ---
tiny.length            : 4
tiny keeps this alive  : 1048576 bytes
exact copy owns        : 4 bytes
```

If you keep 4 bytes of a 1 MiB buffer for a long time (say, in a cache), the **garbage collector** (the part of the engine that frees memory nothing refers to any more) cannot free the 1 MiB. Copy the part you need, then drop the big one.

> **Common mistake:** returning `big.subarray(0, 4)` from a function and thinking you returned 4 bytes. You returned a window onto the big buffer. If the caller changes it, the original changes. If the caller keeps it, the big buffer stays in memory.

> **Interview tip:** "What is the difference between `slice`, `subarray` and `copy` on a Buffer?" Strong answer: `subarray` and the deprecated Buffer `slice` return a view of the same memory (fast, but writes show up in both and the parent stays alive). `Buffer.from(buf)` and `buf.copy(target)` make independent bytes. A plain `Uint8Array.slice` copies, which is why the Buffer behaviour is a trap.

## 7. Everyday tools: concat, compare, search, fill, write

Example file: `examples/05-compare-search-write.js`.

**Joining.** `Buffer.concat(list, totalLength)` makes one new Buffer from many. `totalLength` is optional: it cuts the result or pads it with zeros.

**Comparing.** `===` compares object identity, not bytes. Use `equals`, or `compare` when you need an order (it returns -1, 0 or 1 and works as the callback of `sort`).

```text
--- concat ---
joined      : Hello World
totalLength : Hello (cut at 5 bytes)
padded      : <Buffer 61 62 00 00> (extra bytes are zeros)
empty list  : <Buffer >

--- equals and compare ---
a.equals(copy)   : true
a === copy       : false (=== compares objects, not bytes)
a.compare(b)     : -1 (-1: a sorts before b)
b.compare(a)     : 1 (1: b sorts after a)
a.compare(a)     : 0 (0: same bytes)
sorted           : apple, banana, cherry
```

When you compare secrets (tokens, MACs, API keys), `equals` can stop at the first different byte, so the time it takes leaks information. `crypto.timingSafeEqual(a, b)` always takes the same time, but both Buffers must have the same length or it throws:

```text
--- comparing secrets: use timingSafeEqual ---
same       : true
different  : false
other size : ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH
```

**Searching.** `indexOf`, `lastIndexOf` and `includes` accept a string, a number (one byte) or a Buffer. They return byte positions, and `-1` means not found.

```text
--- indexOf, lastIndexOf, includes ---
indexOf(',')      : 3
lastIndexOf(',')  : 7
indexOf(0x2c)     : 3 (a number searches for one byte)
indexOf('two')    : 4
indexOf(',', 4)   : 7 (start looking at byte 4)
indexOf('zzz')    : -1 (-1 means not found)
includes('three') : true
indexOf(Buffer)   : 4
```

**Filling and writing.** `fill(value, start, end)` repeats a value. `write(string, offset, length, encoding)` encodes a string into the Buffer and returns **how many bytes it wrote**.

```text
--- fill ---
fill('ab')    : ababa
fill(0xff)    : <Buffer ff ff ff>
fill range    : <Buffer 00 00 01 01 00 00> (only bytes 2 and 3)
fill('')      : <Buffer 00 00 00> (empty string fills with zeros)

--- write ---
wrote 2 then 4 bytes -> HiNode
euro x2 into 5 bytes wrote 3 bytes: <Buffer e2 82 ac 00 00> (a half character is never written)
write hex   : <Buffer ca fe ba be>
toString(enc, start, end): two
```

Two gotchas live here. `fill('')` fills with zeros (an empty string has no bytes to repeat). And `write` never writes half a character: two euro signs need 6 bytes, only 5 fit, so only the first sign (3 bytes) was written and the return value is 3.

> **Common mistake:** `result = Buffer.concat([result, chunk])` inside a loop copies all the old bytes every time, which gets slow for many chunks. Push chunks into an array and call `Buffer.concat(chunks)` once at the end. The exception is a small parser that must look at the data after every chunk (section 9). A Buffer cannot grow, so if you need one big output of unknown size, either collect chunks like this or allocate extra room and double it when full (like a dynamic array), then `subarray` the used part.

> **Interview tip:** "How do you compare two API tokens or signatures?" Not with `===` (compares objects, not bytes) and not with `equals` (stops at the first difference, so response time can leak how many leading bytes were right). Use `crypto.timingSafeEqual(a, b)` on two Buffers of the same length.

## 8. Numbers inside a Buffer: integers, floats and endianness

Example file: `examples/06-numbers-endianness.js`.

One byte holds 0 to 255. A bigger number needs several bytes, and then you must decide the **order** in which they are stored. That order is called **endianness**.

Think of writing the number 1234 on paper. Big endian writes the biggest digit first ("1 2 3 4"), little endian writes the smallest first ("4 3 2 1"). Computers do the same with bytes.

- **Big endian (BE):** the most significant byte comes first. Also called "network byte order". Most network protocols and many file formats use it.
- **Little endian (LE):** the least significant byte comes first. x86 CPUs, and almost all ARM systems in practice, use it internally.

```js
const n = 0x12345678; // 305419896 in decimal
const be = Buffer.alloc(4);
const le = Buffer.alloc(4);
be.writeUInt32BE(n); // big endian: biggest byte first (also called network order)
le.writeUInt32LE(n); // little endian: smallest byte first
```

```text
--- one number, two byte orders ---
BE bytes : <Buffer 12 34 56 78>
LE bytes : <Buffer 78 56 34 12>
read BE as BE: 305419896 | read BE as LE: 2018915346 (wrong order, wrong number)
this CPU is  : LE
```

Same bytes, read in the wrong order, give a completely different number. A protocol document says which order to use. If it does not, ask. (`os.endianness()` returns `'LE'` or `'BE'` for the CPU you run on; the last line above came from an x64 Windows machine. You almost never need it, because you pick the order from the format, not from the CPU.)

Method names follow one pattern: `read` or `write`, then the type, then the size, then the order.

| Type | Methods |
|---|---|
| unsigned integer | `readUInt8`, `readUInt16BE`, `readUInt16LE`, `readUInt32BE`, `readUInt32LE` |
| signed integer | `readInt8`, `readInt16BE`, `readInt16LE`, `readInt32BE`, `readInt32LE` |
| 1 to 6 byte integer | `readUIntBE(offset, byteLength)`, `readIntLE(offset, byteLength)`, and the `write` versions |
| 64-bit integer (BigInt) | `readBigUInt64BE`, `readBigInt64LE`, `writeBigUInt64BE`, ... |
| float (4 bytes), double (8 bytes) | `readFloatBE`, `readDoubleLE`, `writeFloatBE`, `writeDoubleBE`, ... |

The `write` methods use the same names. Spellings such as `readUint16BE` are aliases. `swap16()`, `swap32()` and `swap64()` flip the byte order of a whole buffer in place.

```text
--- signed vs unsigned: same byte, different meaning ---
readUInt8(0)   : 255 | readInt8(0)   : -1
readUInt16BE() : 65534 | readInt16BE() : -2
readUInt16LE() : 65279 | readInt16LE() : -257

--- odd sizes: readUIntBE(offset, byteLength) ---
24-bit value   : ff8000 (hex)
red, green, blue: 255 128 0

--- floats ---
float32 bytes  : <Buffer 3d cc cc cd> -> reads back as 0.10000000149011612
float64 bytes  : <Buffer 3f b9 99 99 99 99 99 9a> -> reads back as 0.1
1.5 as double  : <Buffer 3f f8 00 00 00 00 00 00>

--- 64-bit integers need BigInt ---
as BigInt      : 9007199254740993n
as Number      : 9007199254740992 (precision lost)

--- going out of range throws ---
writeUInt8(300)   RangeError ERR_OUT_OF_RANGE
writeUInt8(1, 4)  RangeError ERR_OUT_OF_RANGE
readUInt32BE(2)   RangeError ERR_OUT_OF_RANGE
writeInt8(-129)   RangeError ERR_OUT_OF_RANGE

--- typed arrays use the CPU order, DataView lets you choose ---
Uint16Array([1]) bytes: <Buffer 01 00> (depends on the CPU, little endian here)
DataView default     : <Buffer 00 01>
DataView littleEndian: <Buffer 01 00>
```

- **Signed or unsigned** decides how the same bits are read: the byte `0xff` is 255 unsigned and -1 signed (in "two's complement", the way computers store negative numbers, the top bit means negative).
- **Floats** keep limited precision: a 4-byte float cannot store 0.1 exactly, an 8-byte double (the normal JavaScript number) reads back as 0.1.
- **64-bit integers** do not fit in a normal JavaScript number (exact only up to 2^53), so Node uses `BigInt` for them (JavaScript's type for whole numbers of any size, written like `123n`).
- **Out of range** values and offsets throw a `RangeError` (`ERR_OUT_OF_RANGE`). They are never silently wrapped.
- Typed arrays such as `Uint16Array` always use the CPU's order (little endian on nearly every machine). `DataView` lets you choose, and defaults to big endian.

> **Interview tip:** "What is endianness?" The order in which the bytes of a multi-byte number are stored. Network byte order is big endian. x86 is little endian. When you read a binary format or protocol, use the order in its specification, not the order of your CPU.

## 9. Worked example: parsing a tiny binary protocol

Example file: `examples/07-protocol-header.js`.

Real binary protocols and file formats are described as a table of fields. Here is a small made-up one: a 10-byte header followed by a utf8 payload. All numbers are big endian.

| Offset | Size | Field | Meaning |
|---|---|---|---|
| 0 | 2 | magic | always `0xCAFE`, helps spot garbage |
| 2 | 1 | version | must be 1 |
| 3 | 1 | flags | bit 0 compressed, bit 1 encrypted, bit 2 urgent |
| 4 | 4 | id | message id |
| 8 | 2 | length | payload size in **bytes** |
| 10 | n | payload | utf8 text |

Writing the header is one `write` call per field (see `encode` in the file). Reading it mirrors that, plus checks. `decode` returns `null` when the bytes so far are not a whole message yet:

```js
// Returns { message, size } when a whole message is available, or null when we need more bytes.
function decode(buf) {
  if (buf.length < HEADER_SIZE) return null;
  const magic = buf.readUInt16BE(0);
  if (magic !== MAGIC) throw new Error(`bad magic 0x${magic.toString(16)}`);
  const version = buf.readUInt8(2);
  if (version !== 1) throw new Error(`unsupported version ${version}`);
  const flags = buf.readUInt8(3);
  const id = buf.readUInt32BE(4);
  const length = buf.readUInt16BE(8);
  const end = HEADER_SIZE + length;
  if (buf.length < end) return null; // header is here, payload is not complete yet
  const payload = buf.toString('utf8', HEADER_SIZE, end);
  return { message: { version, flags, id, payload }, size: end };
}
```

The key idea is the next part. TCP (the network protocol under HTTP and most servers) is a **stream of bytes**, not a stream of messages. One `data` event may hold half a message, or two and a half. A parser keeps the leftover bytes and tries again when more arrive:

```js
// TCP gives you a stream of bytes, not messages. A parser keeps the leftover bytes.
class Parser {
  constructor(onMessage) {
    this.pending = Buffer.alloc(0);
    this.onMessage = onMessage;
  }
  push(chunk) {
    this.pending = Buffer.concat([this.pending, chunk]);
    let result;
    while ((result = decode(this.pending)) !== null) {
      this.onMessage(result.message);
      this.pending = this.pending.subarray(result.size);
    }
  }
}
```

```text
--- encode one message ---
bytes   : cafe01050000010200026869
          cafe 01 05 00000102 0002 6869
          magic, version, flags, id=258, length=2, "hi"

--- decode it ---
{ version: 1, flags: 5, id: 258, payload: 'hi' } [ 'COMPRESSED', 'URGENT' ]

--- length counts bytes, not characters ---
"héllo" is 5 characters, header says length = 6

--- a stream: two messages glued together, delivered in 7 byte chunks ---
total bytes on the wire: 35
chunk at  0: 7 bytes
chunk at  7: 7 bytes
chunk at 14: 7 bytes
  message -> 1 first
chunk at 21: 7 bytes
chunk at 28: 7 bytes
  message -> 2 second one
bytes left over: 0

--- bad data is rejected ---
error: bad magic 0x7468
```

What to learn from this:

- Fixed offsets and the right method per field: `readUInt16BE`, `readUInt8`, `readUInt32BE`.
- Flags are bits. `flags & FLAGS.URGENT` tests one bit, `FLAGS.URGENT | FLAGS.COMPRESSED` sets two.
- `length` counts bytes (`"héllo"` is 5 characters but 6 bytes).
- Chunk borders are arbitrary. The parser produced the same two messages wherever the 7-byte chunks cut the data.
- Validate everything you read: magic, version and size. In a real server also set a maximum for `length`, so a hostile client cannot make you wait for or allocate gigabytes.

This is called **framing**: how the receiver finds where one message ends. There are three common ways:

| Framing | How it works | Used by |
|---|---|---|
| Fixed size | every message has the same number of bytes | simple sensor or game protocols |
| Delimiter | a special byte (or bytes) ends the message, such as `\n` | line-based text protocols, JSON lines, HTTP headers |
| Length prefix | a number at the start says how many bytes follow | this example, and many binary protocols |

> **Interview tip:** "A client sends messages over TCP and your `data` handler sometimes sees half a message or two at once. What do you do?" Strong answer: TCP has no message boundaries, so you must frame the data yourself. Keep a pending Buffer, append each chunk, and loop: if a whole message is there (check the length field), decode it and remove it, otherwise wait for more. Limit the maximum message size.

## 10. ArrayBuffer, TypedArray and DataView

Example file: `examples/08-arraybuffer-dataview.js`.

Four names, one idea: **one block of memory, several ways to look at it**. A **view** is an object that reads and writes memory it does not own.

```
ArrayBuffer (8 raw bytes, you cannot read it directly)
+----+----+----+----+----+----+----+----+
| 00 | 00 | 00 | 00 | 00 | 00 | 00 | 00 |
+----+----+----+----+----+----+----+----+
 Uint8Array(buffer)   8 items, 1 byte each
 Uint16Array(buffer)  4 items, 2 bytes each
 DataView(buffer)     any type at any offset, you choose the byte order
 Buffer.from(buffer)  a Uint8Array with Node's extra methods
```

| Name | What it is |
|---|---|
| `ArrayBuffer` | a fixed-size block of raw bytes. No reading or writing on its own |
| TypedArray (`Uint8Array`, `Int16Array`, `Float64Array`, ...) | a view that reads the block as a list of one number type |
| `DataView` | a view where you read or write any type at any byte offset, with a byte order you choose. It has a `get` and `set` method for each type (`getUint16`, `setInt32`, `getFloat64`, `getBigUint64`, ...), and a final `littleEndian` argument (default `false`, so big endian) |
| `Buffer` | a `Uint8Array` subclass with Node helpers |

```js
const memory = new ArrayBuffer(8); // 8 raw bytes, all zero. You cannot read it directly.
const bytes = new Uint8Array(memory); // 8 items of 1 byte
const words = new Uint16Array(memory); // 4 items of 2 bytes
const dv = new DataView(memory); // read/write any type at any offset, you pick the byte order
const buf = Buffer.from(memory); // Buffer.from(arrayBuffer) shares the memory, it does not copy

words[0] = 0x0102; // typed arrays use the CPU byte order (little endian on x86 and ARM)
console.log('Uint8Array :', bytes.join(' '));
dv.setUint16(2, 0x0304); // DataView: big endian unless you pass true
console.log('after DataView.setUint16(2):', bytes.join(' '));
buf[7] = 9;
console.log('after buf[7] = 9           :', bytes.join(' '));
```

```text
--- one ArrayBuffer, four views ---
Uint8Array : 2 1 0 0 0 0 0 0
after DataView.setUint16(2): 2 1 3 4 0 0 0 0
after buf[7] = 9           : 2 1 3 4 0 0 0 9
byteLength of each view    : 8 8 8 8
items in each view         : 8 4
same memory? true true
```

All four views see the same bytes. `words[0] = 0x0102` wrote bytes `2 1` (little endian), the `DataView` wrote `3 4` (big endian) and the Buffer wrote the 9.

Two traps follow. **`Buffer.from(typedArray)` copies the items, not the bytes**: each item is cut to one byte. To get the real bytes use the underlying `.buffer` (shared, no copy) or `Buffer.copyBytesFrom(typedArray)` (a copy of the real bytes; added in Node 19.8 and 18.16).

```js
const nums = new Uint16Array([1, 2, 300]);
const copied = Buffer.from(nums); // 3 items, each cut to one byte (300 % 256 = 44)
const viewed = Buffer.from(nums.buffer); // the raw 6 bytes
console.log('from typedArray   :', copied, '(values truncated to bytes)');
console.log('from its .buffer  :', viewed, '(the real bytes)');
console.log('copyBytesFrom     :', Buffer.copyBytesFrom(nums), '(copies the real bytes, new in Node 18.16 / 19.8)');
```

```text
--- Buffer.from(typedArray) COPIES the items; Buffer.from(arrayBuffer) shares ---
from typedArray   : <Buffer 01 02 2c> (values truncated to bytes)
from its .buffer  : <Buffer 01 00 02 00 2c 01> (the real bytes)
copyBytesFrom     : <Buffer 01 00 02 00 2c 01> (copies the real bytes, new in Node 18.16 / 19.8)
```

**The byteOffset trap.** A small Buffer usually lives inside Node's shared pool (8 KiB on Node 24.16, see section 11), so its `.buffer` is the **whole pool** and `byteOffset` says where the Buffer starts inside it. A typed array built from `buf.buffer` alone covers the whole pool, not your bytes:

```js
Buffer.from('padding'); // takes a few bytes of the pool, so the next small Buffer does not start at 0
const small = Buffer.from('abcd');
console.log('small.length        :', small.length);
console.log('small.buffer size   :', small.buffer.byteLength, '<- the whole pool, not just 4 bytes');
console.log('small.byteOffset > 0:', small.byteOffset > 0, '<- where our 4 bytes start inside the pool');

const wrong = new Uint16Array(small.buffer); // BUG: ignores byteOffset and length
const right = new Uint16Array(small.buffer, small.byteOffset, small.length / 2);
console.log('wrong view items    :', wrong.length, '(the whole pool)');
console.log('right view          :', right, '(2 items: "ab" and "cd" read little endian)');
```

```text
--- the byteOffset trap ---
small.length        : 4
small.buffer size   : 8192 <- the whole pool, not just 4 bytes
small.byteOffset > 0: true <- where our 4 bytes start inside the pool
wrong view items    : 4096 (the whole pool)
right view          : Uint16Array(2) [ 25185, 25699 ] (2 items: "ab" and "cd" read little endian)

--- alignment: a Uint16Array must start at an even byte ---
RangeError: start offset of Uint16Array should be a multiple of 2
after copying to a fresh buffer: 2 items

--- going the other way: TextEncoder gives Uint8Array, not Buffer ---
is Buffer? false | is Uint8Array? true | bytes: 195 169
as Buffer : <Buffer c3 a9> | hex: c3a9
```

The numbers `8192` and `4096` above come from Node 24.16, whose pool is 8 KiB. Newer releases have a bigger pool (section 11), so you will see larger numbers there, but the bug is the same. The fix is `new Uint16Array(buf.buffer, buf.byteOffset, buf.length / 2)`. Also note the alignment rule: a `Uint16Array` must start at an even byte offset (a `Uint32Array` at a multiple of 4), or the constructor throws a `RangeError`. And `TextEncoder().encode(text)` returns a plain `Uint8Array`, not a Buffer; wrap it without copying using `Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength)`.

> **Under the hood:** a Buffer does not own bytes by itself. It is a view (`buffer`, `byteOffset`, `length`) onto an `ArrayBuffer`, which is why sharing, offsets and alignment follow the typed array rules.

> **Interview tip:** "What is the difference between `ArrayBuffer`, a typed array and `DataView`?" Strong answer: the `ArrayBuffer` is the memory and cannot be read directly. A typed array is a view that reads it as a list of one number type, in the CPU's byte order. A `DataView` reads any type at any offset with a byte order you choose. `Buffer` is a `Uint8Array` (so a typed array) with Node helpers, and several views can share one `ArrayBuffer`.

## 11. The Buffer pool and the allocUnsafe risk

Example file: `examples/09-pool-unsafe-memory.js`. Run it with the garbage collector exposed so that the last memory part works:

```bash
node --expose-gc lessons/10-buffers/examples/09-pool-unsafe-memory.js
```

**The pool.** Asking the operating system for memory is slow when you do it for thousands of tiny Buffers. So Node allocates one block (`Buffer.poolSize`) and hands out slices of it. On Node 24.16 the pool is 8 KiB (8192 bytes). A request is pooled when its size is **less than half the pool (under 4096 bytes on 24.16)** and it comes from `Buffer.allocUnsafe`, from `Buffer.concat`, or from `Buffer.from` with a string, an array or another Buffer. `Buffer.alloc` and `Buffer.allocUnsafeSlow` never use the pool, and big requests get their own memory. When the pool is full, Node starts a new one.

> **Version note:** according to the Node docs, the default `Buffer.poolSize` was raised from 8192 to 65536 in v24.18.0 (and v26.3.0). This lesson was run on 24.16, so the outputs below show 8192. On a newer release the pool numbers are bigger (the rule "less than half the pool" is the same). Always print `Buffer.poolSize` instead of assuming it. Never write code that depends on the pool size.

```js
const a = Buffer.allocUnsafe(10);
const b = Buffer.from('hi');
const half = Buffer.poolSize >>> 1; // poolSize / 2 (4096 when poolSize is 8192)
const c = Buffer.allocUnsafe(half - 1); // below poolSize / 2: pooled
const d = Buffer.allocUnsafe(half); // poolSize / 2 or more: gets its own memory
const e = Buffer.allocUnsafeSlow(10); // never pooled, on purpose
const f = Buffer.alloc(10); // alloc never uses the pool
```

```text
--- the pool ---
Buffer.poolSize          : 8192 bytes
a, b, c share one pool   : true
pool size (a.buffer)     : 8192
d own memory (poolSize/2): 4096
e own memory (slow)      : 10
f own memory (alloc)     : 10
```

A pooled Buffer keeps the whole pool alive for as long as it is reachable. For a tiny Buffer that you will keep for a very long time, `allocUnsafeSlow` gives it private memory (use it only as a last resort, after you measured excessive memory use).

**The risk.** `allocUnsafe` skips the zero-fill, so the new Buffer shows whatever bytes were in that memory before. That memory may have held another user's data, a password or a token. If you send the buffer out half-filled, you leak it.

The demo simulates this safely: it first writes "old data" (the letter `X`) over the pool, then allocates. In a real program the old data is whatever lived in that memory before. You cannot predict it, and that is exactly the problem.

```js
const pool = new Uint8Array(a.buffer);
pool.fill(0x58);
const unsafe = Buffer.allocUnsafe(8); // comes from the same pool, so it still holds our 'X' bytes
const safe = Buffer.alloc(8);
console.log('same pool as before?     :', unsafe.buffer === a.buffer, '(the demo needs this to be true)');
console.log('allocUnsafe(8) contains  :', JSON.stringify(unsafe.toString()), '<- old data leaks through');
console.log('alloc(8) contains        :', safe.toString('hex'), '<- always zeros');

// A typical bug: reply with a buffer you only partly filled.
function badReply(text) {
  const out = Buffer.allocUnsafe(16);
  out.write(text); // the other bytes are never set
  return out;
}
```

```text
--- why allocUnsafe is risky ---
same pool as before?     : true (the demo needs this to be true)
allocUnsafe(8) contains  : "XXXXXXXX" <- old data leaks through
alloc(8) contains        : 0000000000000000 <- always zeros
badReply("ok")           : "okXXXXXXXXXXXXXX"
goodReply("ok") as hex   : 6f6b0000000000000000000000000000
key after fill(0)        : 0000000000000000
```

`badReply` wrote only 2 bytes of a 16-byte buffer, and the other 14 bytes went out with the old data. `goodReply` used `alloc`, so the rest is zeros. This class of bug is one of the reasons the old `new Buffer(size)` constructor was deprecated.

The last line shows a related habit. A string cannot be erased from memory, but a Buffer can. When a Buffer holds key material, `buf.fill(0)` overwrites it as soon as you are done:

```js
const key = require('node:crypto').randomBytes(8); // random bytes, e.g. a session key
key.fill(0);
```

**Rules of thumb:**

- Default to `Buffer.alloc`. It is a little slower, and always safe.
- Use `allocUnsafe` only when you overwrite **every** byte before anyone reads or sends the buffer (for example when you read from a file into it), and only in a hot path where you measured a gain.
- Wipe key material with `fill(0)` when you are done with it. This lowers the risk, it is not a guarantee (a string or a copy you made earlier still holds the secret).
- The command line flag `--zero-fill-buffers` tells Node to zero-fill the memory it allocates for unsafe buffers (checked on 24.16: 20000 small `allocUnsafe` Buffers were all zero with the flag, and many were not without it). This costs speed. It exists for security-sensitive deployments.

> **Interview tip:** "Why does `Buffer.alloc` fill with zeros, and why is `allocUnsafe` faster?" Strong answer: `alloc` guarantees the content (all zeros), so old memory can never leak and results are deterministic. `allocUnsafe` skips the fill and takes small buffers from a shared pool, so it is faster, but its content is unknown and may include sensitive leftovers. Use it only if you overwrite every byte.

## 12. Memory: off-heap, big buffers and limits

Example file: `examples/09-pool-unsafe-memory.js` (the second half and the last part).

JavaScript objects live on the V8 heap, which has a size limit. The bytes of a Buffer do **not** live there. They live **outside** the heap ("off-heap"), in memory Node asks the system for. The Buffer object on the heap is only a small handle. `process.memoryUsage()` shows it:

- `heapUsed`: JavaScript objects on the V8 heap.
- `arrayBuffers`: memory of all ArrayBuffers and Buffers.
- `external`: memory of C++ objects tied to JavaScript objects. It **includes** `arrayBuffers`.
- `rss`: everything the process holds in RAM.

```js
console.log('\n--- Buffer memory is outside the JS heap ---');
const before = process.memoryUsage();
let big = Buffer.alloc(100 * MiB);
const during = process.memoryUsage();
console.log('arrayBuffers grew by 100 MiB or more :', during.arrayBuffers - before.arrayBuffers >= 100 * MiB);
console.log('external grew by 100 MiB or more     :', during.external - before.external >= 100 * MiB);
console.log('heapUsed changed by less than 1 MiB  :', Math.abs(during.heapUsed - before.heapUsed) < MiB);
```

```text
--- Buffer memory is outside the JS heap ---
arrayBuffers grew by 100 MiB or more : true
external grew by 100 MiB or more     : true
heapUsed changed by less than 1 MiB  : true

--- memory comes back when the Buffer is garbage collected ---
arrayBuffers shrank by 90 MiB or more: true

--- limits ---
max Buffer length (bytes): 9007199254740991
max string length (chars): 536870888
```

Allocating 100 MiB grew `arrayBuffers` and `external` by that amount while `heapUsed` hardly moved. The memory came back when the Buffer object was garbage collected: `big = null` and `gc()` released it. (`gc()` exists only with `--expose-gc`. Normal programs let V8 decide when.)

Practical consequences:

- A program can use gigabytes of RAM while `heapUsed` looks small. When you hunt a leak, watch `arrayBuffers` and `rss`, not just the heap.
- `--max-old-space-size` limits the JavaScript heap, not Buffer memory. (On this lesson's test machine, `node --max-old-space-size=40` still allocated a 300 MiB Buffer without error.)
- `fs.readFile` puts the whole file in memory. For big data, process it in chunks with streams (section 14).
- Any reference keeps the memory: a cache full of Buffers, or small `subarray` views of big buffers (section 6).
- `MAX_LENGTH` is huge on 64-bit Node 24, so your machine's memory runs out first. `MAX_STRING_LENGTH` is real: V8 does not allow a string longer than 536870888 UTF-16 code units (about 2^29), so a Buffer that decodes to more characters than that cannot become one string with `toString()`.
- A big allocation is not always resident at once: allocating 200 MiB with `Buffer.alloc` left `rss` at 63 MiB on the Windows test machine, and writing to every byte then raised it to 263 MiB. The operating system often hands out pages only when they are first written. This depends on the OS.

### Sending a Buffer to a worker thread

A worker thread (lesson 18) runs JavaScript in another thread, and `postMessage` is how you send it data. By default `postMessage` **copies** the bytes (the receiver gets a plain `Uint8Array`, not a Buffer). For big data you have two cheaper options: **transfer** the underlying `ArrayBuffer` (the memory moves, the sender loses it) or use a `SharedArrayBuffer` (both sides see the same memory).

The last part of example 09 uses a `MessageChannel`, the same kind of channel a worker uses, with both ends in one thread so the output is predictable:

```js
const original = Buffer.alloc(4, 7);
channel.port1.postMessage(original); // default: the bytes are COPIED

const movable = Buffer.alloc(8); // alloc gives a Buffer its own ArrayBuffer
channel.port1.postMessage(movable, [movable.buffer]); // transfer list: MOVE the memory, no copy

const pooled = Buffer.from('small'); // lives inside the shared pool
channel.port1.postMessage(pooled, [pooled.buffer]); // throws DataCloneError
```

```text
--- sending a Buffer to another thread: copy, move or share ---
postMessage copies       : sender still has 7 | receiver got a Uint8Array
transfer alloc(8)        : sender length is now 0 (the memory moved)
transfer a pooled Buffer : DataCloneError (the pool is shared, so it cannot be moved)
SharedArrayBuffer        : sender sees 42 (same memory on both sides)
```

After a transfer the sender's Buffer has length 0 (the memory is "detached"). A small pooled Buffer cannot be transferred, because its `ArrayBuffer` is the whole pool shared with other Buffers. If you plan to transfer, create the Buffer with `Buffer.alloc` (or `allocUnsafeSlow`).

> **Interview tip:** "Your Node process uses 3 GB of RAM but the heap snapshot shows 100 MB. What could it be?" Strong answer: Buffers and ArrayBuffers live off the V8 heap, so look at `process.memoryUsage()` (`arrayBuffers`, `external`, `rss`), not only `heapUsed`. Typical causes are whole files read with `readFile`, caches of Buffers, tiny `subarray` views that keep big parents alive, and unbounded request bodies. Fix with streams, size limits and copying only what you need.

## 13. Characters split across chunks: StringDecoder and TextDecoder

Example file: `examples/10-string-decoder.js`.

This is a famous, real bug. Data arrives in chunks (from a file, a socket or an HTTP body), and a chunk border can fall **in the middle of a multi-byte character**. If you decode each chunk on its own, that character is destroyed.

```js
const whole = Buffer.from('\u20ac\u20ac'); // two euro signs, 3 bytes each: e2 82 ac e2 82 ac
const chunk1 = whole.subarray(0, 4); // e2 82 ac e2  <- cuts the second character in half
const chunk2 = whole.subarray(4); //    82 ac
console.log('bytes :', whole.toString('hex'));
console.log('chunk1:', chunk1.toString('hex'), '| chunk2:', chunk2.toString('hex'));

console.log('\n--- the bug: toString() on each chunk ---');
const buggy = chunk1.toString() + chunk2.toString();
console.log('result:', inspect(buggy), '<- the second euro sign is destroyed');
```

```text
bytes : e282ace282ac
chunk1: e282ace2 | chunk2: 82ac

--- the bug: toString() on each chunk ---
result: '€���' <- the second euro sign is destroyed
```

The euro sign is `e2 82 ac`. Chunk 1 ended after `e2` and chunk 2 starts with `82 ac`. Neither half is valid alone, so each became U+FFFD.

Three fixes:

1. **Collect the Buffers, decode once at the end** (`Buffer.concat(chunks).toString()`). Simple and correct when the data fits in memory.
2. **`StringDecoder`** (from `node:string_decoder`). It decodes chunk by chunk and **holds back** incomplete trailing bytes until the rest arrives.
3. **`TextDecoder` with `{ stream: true }`**. The web-standard version of the same idea.

```js
console.log('\n--- fix 2: StringDecoder remembers the half character ---');
const decoder = new StringDecoder('utf8');
const out1 = decoder.write(chunk1);
const out2 = decoder.write(chunk2);
console.log('after chunk1:', inspect(out1), '(the e2 byte is held back)');
console.log('after chunk2:', inspect(out2));
console.log('end()       :', inspect(decoder.end()), '(nothing left over)');
```

```text
--- fix 1: collect the Buffers, decode once at the end ---
result: '€€'

--- fix 2: StringDecoder remembers the half character ---
after chunk1: '€' (the e2 byte is held back)
after chunk2: '€'
end()       : '' (nothing left over)

--- fix 3: TextDecoder with { stream: true } (a web standard) ---
results: '€' '€' ''

--- a 4 byte emoji fed one byte at a time ---
pieces: [ '', '', '', '😀' ]

--- if the data stops in the middle of a character ---
end() gives the replacement character: '�'
TextDecoder fatal:true throws        : ERR_ENCODING_INVALID_ENCODED_DATA
```

`decoder.write(chunk1)` returned the first euro sign and kept the lone `e2` inside. `decoder.write(chunk2)` completed the second one. Call `end()` when the input is finished: it returns anything still held back, and if that is half a character you get U+FFFD. A 4-byte emoji fed one byte at a time shows the same effect. `TextDecoder` also has `fatal: true`, which throws instead of using U+FFFD (useful when invalid data must be an error).

> **Interview tip:** "Why does `let body = ''; req.on('data', (chunk) => { body += chunk; })` sometimes corrupt non-English text?" Strong answer: `+=` calls `chunk.toString()` on every chunk, and a chunk border can fall inside a multi-byte character, which is the bug above. Collect the Buffers and decode once with `Buffer.concat(chunks).toString()`, or call `req.setEncoding('utf8')` first so a `StringDecoder` does it for you. `StringDecoder` is the Node way; `TextDecoder` is the web-standard way and works in browsers too.

## 14. Buffers and streams

Example file: `examples/10-string-decoder.js` (the last part).

Streams are the next lesson, but the Buffer rules for them belong here:

1. **Chunks are Buffers.** A `data` event of a file stream, a socket or an HTTP request gives you a Buffer, unless you asked for strings.
2. **Chunk borders are arbitrary.** The OS, the stream's buffer size and timing decide them, not your data. A chunk can end in the middle of a character or of a message. Never rely on them. (A file read stream uses 64 KiB chunks by default.)
3. **Joining:** collect the chunks in an array and call `Buffer.concat` once. Or let `node:stream/consumers` do it.
4. **Decoding:** if a stream has an encoding (`setEncoding('utf8')` or the `encoding` option) it uses a `StringDecoder` inside and gives you strings that are safe across chunk borders.
5. **Writing:** `writable.write('text')` turns the string into a Buffer using utf8 (or the encoding you pass as second argument), so strings and Buffers can be mixed when you write.

```js
// inside an async function, with any readable stream
const chunks = [];
for await (const chunk of readable) chunks.push(chunk); // every chunk is a Buffer
const body = Buffer.concat(chunks); // one copy, at the end

// The shortcut (Node 16.7+): read a whole stream into one value
const { buffer, text } = require('node:stream/consumers');
const all = await buffer(readable); // a Buffer
const str = await text(readable); // a string, decoded safely
```

(You can read a stream only once, so use one of the two forms, not both on the same stream.)

The example reads a 9-byte file (three euro signs) with a deliberately tiny chunk size of 4 bytes:

```js
let proper = '';
const decoded = fs.createReadStream(file, { highWaterMark: 4, encoding: 'utf8' }); // uses a StringDecoder inside
for await (const text of decoded) proper += text;
console.log("{ encoding: 'utf8' }:", inspect(proper));
```

```text
--- the same bug inside a real stream ---
chunks are Buffers  : e282ace2 | 82ace282 | ac
naive string +=     : '€�����'
Buffer.concat first : '€€€'
{ encoding: 'utf8' }: '€€€'
consumers.buffer()  : e282ace282ace282ac
consumers.text()    : '€€€'
```

The chunks are Buffers (`e282ace2`, `82ace282`, `ac`) that cut the characters apart. Adding them up as strings gives `'€�����'`. Joining the Buffers first, asking the stream to decode, or using `consumers` gives the right text.

The size of a chunk is a memory choice too. `fs.readFile` holds the **whole** file as one Buffer, so a 1 GB file needs 1 GB of memory. A read stream holds one chunk at a time. The same applies to collecting: `Buffer.concat(chunks)` brings you back to 1 GB, so for big data process each chunk as it arrives (parse it, hash it, write it on) instead of collecting.

> **Interview tip:** "How do you read a very large file in Node?" Strong answer: not with `readFile`, which loads everything into one Buffer. Use `fs.createReadStream` (chunks of 64 KiB) and process each chunk, with `pipeline` and backpressure (next lesson). Decode text with `setEncoding` or a `StringDecoder`, because chunks can split characters.

## 15. JSON, Blob, base64 and data URLs

Example file: `examples/11-json-blob-datauri.js`.

**`Buffer.toJSON`.** `JSON.stringify` calls `buf.toJSON()`, which gives `{ type: 'Buffer', data: [bytes...] }`. It is verbose (a number and a comma for every byte). To read it back you must rebuild the Buffer yourself; `Buffer.from(object)` understands exactly that shape. For anything bigger than a few bytes, put a `base64` string in your JSON instead.

```js
console.log('toJSON()     :', buf.toJSON());
const json = JSON.stringify({ id: 7, data: buf });
console.log('stringify    :', json);
const plain = JSON.parse(json);
console.log('parse (plain):', plain.data, '<- just an object, not a Buffer');
const revived = JSON.parse(json, (key, value) => (value && value.type === 'Buffer' ? Buffer.from(value) : value));
console.log('parse reviver:', revived.data, '<- Buffer.from(object) understands the shape');
```

```text
--- Buffer.toJSON (called by JSON.stringify) ---
toJSON()     : { type: 'Buffer', data: [ 104, 105, 33 ] }
stringify    : {"id":7,"data":{"type":"Buffer","data":[104,105,33]}}
parse (plain): { type: 'Buffer', data: [ 104, 105, 33 ] } <- just an object, not a Buffer
parse reviver: <Buffer 68 69 21> <- Buffer.from(object) understands the shape
compact form : {"data":"aGkh"} <- much shorter for big data
```

**`Blob`.** A `Blob` ("binary large object") is an immutable chunk of bytes plus a **MIME type**, a label such as `text/plain` or `image/png` that says what kind of data the bytes are. It is a web standard and a global in Node. Reading it is asynchronous (`text()`, `arrayBuffer()`, `stream()`), and `size` counts bytes. `File` is a `Blob` with a file name.

```text
--- Blob: immutable binary data with a MIME type ---
size, type   : 12 text/plain (size counts BYTES)
text()       : hello wörld
slice(0, 5)  : hello
arrayBuffer  : 68656c6c6f2077c3b6726c64 -> Buffer
stream() total bytes: 12 (the piece sizes are an implementation detail)
globals      : function function (File extends Blob)
```

**Data URLs.** A data URL puts a small file inside a string: `data:<mime type>;base64,<base64 bytes>`. A browser can show it as an image. It is about 33 percent bigger than the file (base64), so use it only for small things. The header ends at the first comma, so split there and decode the rest with `Buffer.from(payload, 'base64')`.

**`btoa` and `atob`** are globals kept for browser compatibility. They work on "binary strings" where every character is below 256, so `btoa` throws `InvalidCharacterError` for `€`. In Node prefer `Buffer.from(text).toString('base64')` and `Buffer.from(b64, 'base64')`.

```text
--- data URLs: "data:<type>;base64,<bytes>" ---
make   : data:image/gif;base64,R0lGODlh
parse  : image/gif GIF89a

--- btoa and atob: old browser helpers, Latin-1 only ---
btoa('hello')   : aGVsbG8=
atob('aGVsbG8='): hello
btoa('euro')    : InvalidCharacterError
Buffer way      : 4oKs (works for any text, utf8 first)
```

> **Interview tip:** "What does `JSON.stringify(buffer)` give, and how do you send binary data in a JSON API?" Strong answer: `{"type":"Buffer","data":[...]}`, one number per byte, and `JSON.parse` gives back a plain object, not a Buffer. For real payloads put a base64 string in the JSON (and decode with `Buffer.from(str, 'base64')`), or skip JSON and send the bytes as the body or as multipart form data.

## 16. A hex dump helper

Example file: `examples/12-hexdump.js`.

When you debug a protocol or a file format you want to see the bytes. A **hex dump** shows the offset, the bytes in hex and the printable characters. It is the format of the `xxd` and `hexdump -C` tools on Linux and macOS (PowerShell has `Format-Hex`). The example builds one in about 20 lines (`hexdump(buffer)`), with `subarray` for each 16-byte row, `toString(16).padStart(2, '0')` for the hex and a dot for every byte outside printable ASCII.

```text
--- text ---
00000000  48 65 6c 6c 6f 2c 20 42  75 66 66 65 72 73 21 0a  |Hello, Buffers!.|

--- non-ASCII text: the accent and the emoji become several bytes ---
00000000  63 61 66 c3 a9 20 e2 82  ac 20 f0 9f 98 80        |caf.. ... ....|

--- the first bytes of a PNG file ---
00000000  89 50 4e 47 0d 0a 1a 0a  00 00 00 0d 49 48 44 52  |.PNG........IHDR|

--- 40 bytes: the last line is short ---
00000000  00 06 0c 12 18 1e 24 2a  30 36 3c 42 48 4e 54 5a  |......$*06<BHNTZ|
00000010  60 66 6c 72 78 7e 84 8a  90 96 9c a2 a8 ae b4 ba  |`flrx~..........|
00000020  c0 c6 cc d2 d8 de e4 ea                           |........|
```

- The left column is the offset of the first byte of the line, in hex (`00000010` is byte 16).
- Printable ASCII (0x20 to 0x7e) is shown as itself, everything else as a dot. That is why the accent and the emoji show as dots: they are not ASCII.
- The PNG signature starts with `89 50 4e 47`: the byte `0x89` followed by the letters `PNG`. Recognizing such "magic numbers" in a dump is how tools like `file` guess a file type.
- `console.log(buffer)` shows only the first 50 bytes (`require('node:buffer').INSPECT_MAX_BYTES`) and then `... N more bytes`, so a helper like this is better for big buffers. The function is exported: `const { hexdump } = require('./12-hexdump.js')`.

> **Interview tip:** a common warm-up is "convert a Buffer to a hex string without `toString('hex')`". The core is `byte.toString(16).padStart(2, '0')` for each byte (without `padStart`, the byte `5` becomes `5` instead of `05` and the result cannot be decoded). The reverse uses `parseInt(pair, 16)` on every two characters.

## 17. Interview questions and strong answers

| Question | Strong answer |
|---|---|
| What is a Buffer? | A fixed-size sequence of bytes. In Node it is a subclass of `Uint8Array` with extra helpers (encodings, number read/write, search). Its memory lives outside the V8 heap. |
| Buffer vs Uint8Array? | Buffer is a Uint8Array with Node extras: `toString(encoding)`, `readUInt16BE` and friends, `equals`/`compare`. `slice` shares memory (a plain `slice` copies), `JSON.stringify` gives `{type, data}`. Web APIs use plain `Uint8Array`, and `structuredClone` or `postMessage` turn a Buffer into one. |
| `alloc` vs `allocUnsafe`? | `alloc` zero-fills (safe, deterministic). `allocUnsafe` skips the fill and uses the shared pool (8 KiB on Node 24.16) for small sizes, so it is faster but may contain old data. Use it only when every byte is overwritten before use. |
| Why can reading binary data as utf8 lose it? | Invalid utf8 sequences become U+FFFD, which is irreversible. Use `hex`, `base64` or keep the Buffer. `latin1` also round-trips bytes losslessly. |
| `string.length` vs `Buffer.byteLength(string)`? | `length` counts UTF-16 code units, `byteLength` counts utf8 bytes. They differ for any non-ASCII text. Use byte length for `Content-Length` and size limits. |
| `slice` vs `subarray` vs `copy`? | `subarray` (and the deprecated Buffer `slice`) share memory. `Buffer.from(buf)`, `buf.copy()` and `Buffer.concat` copy. A tiny view keeps its big parent in memory. |
| How do you join stream chunks? | Push chunks into an array and call `Buffer.concat(chunks)` once. For text use `setEncoding('utf8')` or `StringDecoder`, never `data += chunk`. |
| What is endianness? | The byte order of multi-byte numbers. Network order is big endian, x86 is little endian. Use `readUInt32BE` or `readUInt32LE` to match the format spec. |
| Where is Buffer memory? | Off-heap (counted in `arrayBuffers` and `external`), freed by the GC when no reference is left. `--max-old-space-size` does not limit it. |
| hex vs base64 vs base64url? | hex: 2 chars per byte, easy to read. base64: 4 chars per 3 bytes (+33 percent), with `+`, `/` and `=`. base64url: URL-safe alphabet, no padding (used in JWT). None of them is encryption. |
| How do you handle a message split across TCP chunks? | TCP has no message boundaries. Frame the data (for example a length prefix), keep a pending Buffer, append each chunk and decode while a whole message is available. Limit the maximum size. |
| How do you compare two secrets? | `crypto.timingSafeEqual(a, b)` on same-length Buffers. `===` compares objects, and `equals` can stop at the first different byte. |
| Can you send a Buffer to a worker without copying it? | Transfer its `ArrayBuffer` (`postMessage(buf, [buf.buffer])`), which works for `Buffer.alloc` but not for pooled small Buffers, or share memory with a `SharedArrayBuffer`. A plain `postMessage` copies and delivers a `Uint8Array`. |
| `JSON.parse` of a file fails at position 0. Why? | Probably a utf8 BOM (`ef bb bf`), kept by `toString('utf8')` as U+FEFF. Strip it or decode with `TextDecoder`. |

## Summary / Key takeaways

- A Buffer is a fixed-size list of bytes (numbers 0 to 255). It is a `Uint8Array` subclass with Node helpers, and its memory is off the V8 heap.
- Create with `Buffer.from` (data you have), `Buffer.alloc` (zeros, safe) and, only when you overwrite everything, `Buffer.allocUnsafe` (fast, not cleared; wipe keys with `fill(0)`).
- An encoding is the rule between bytes and text. `utf8` is the default. Use `hex` and `base64` to show bytes as text, and never read binary data as utf8. String length, character count and byte length are three different numbers: use `Buffer.byteLength` for sizes on the wire.
- `subarray` shares memory. Use `Buffer.from(buf)` or `copy` for a real copy, and remember that a tiny view keeps a big parent alive.
- Multi-byte numbers need an order: `BE` or `LE`. Follow the format spec. Use the `BigInt` methods for 64-bit integers. TCP gives bytes, not messages, so frame them (for example a length prefix) and keep the leftover bytes.
- Chunk borders can cut a character in half. Use `StringDecoder`, `TextDecoder` with `stream: true`, or `setEncoding`, or join the Buffers before decoding.
- Collect chunks in an array and call `Buffer.concat` once. Use `crypto.timingSafeEqual` to compare secrets.
- Buffer memory is off the heap: watch `arrayBuffers` and `rss`. `postMessage` copies a Buffer, a transfer moves it (not possible for small pooled Buffers), and a `SharedArrayBuffer` shares it.

## Quick check

1. For the string `'é'`, what are `'é'.length` and `Buffer.from('é').length`? Why?
<details><summary>Answer</summary>

`'é'.length` is 1 (one UTF-16 code unit) and `Buffer.from('é').length` is 2, because utf8 stores `é` as the two bytes `c3 a9`. A string counts code units, a Buffer counts bytes.

</details>

2. Why is `Buffer.alloc(n)` safer than `Buffer.allocUnsafe(n)`?
<details><summary>Answer</summary>

`alloc` fills the memory with zeros, so it never shows old data. `allocUnsafe` skips the fill for speed, so the buffer may contain leftovers from earlier use of that memory, which can leak secrets if you send it out unfilled.

</details>

3. `const part = buf.subarray(0, 4); part[0] = 0;` Does `buf` change?
<details><summary>Answer</summary>

Yes. `subarray` returns a view of the same memory, so `buf[0]` is now 0 too. Use `Buffer.from(buf.subarray(0, 4))` for an independent copy.

</details>

4. Why is `buf.toString('utf8')` a bad way to store arbitrary bytes in a string, and what should you use?
<details><summary>Answer</summary>

Bytes that are not valid utf8 are replaced with U+FFFD, so the original bytes are lost for good. Use `hex` or `base64` (or `latin1`, which maps each byte to exactly one character) and decode with the same encoding.

</details>

5. The bytes are `00 00 01 00`. What do `readUInt32BE()` and `readUInt32LE()` return?
<details><summary>Answer</summary>

`readUInt32BE()` returns 256 (`0x00000100`) and `readUInt32LE()` returns 65536 (the bytes reversed give `0x00010000`). Same bytes, different order, different number.

</details>

6. Why can calling `chunk.toString()` on every chunk of a stream corrupt text, and how do you avoid it?
<details><summary>Answer</summary>

A chunk border can fall in the middle of a multi-byte character, and each half decodes to U+FFFD. Join all Buffers with `Buffer.concat` before decoding, or use a `StringDecoder` (or `TextDecoder` with `{ stream: true }`, or `setEncoding('utf8')` on the stream), which holds the incomplete bytes until the rest arrives.

</details>

7. Where does a Buffer's memory live, and which `process.memoryUsage()` fields show it?
<details><summary>Answer</summary>

Off the V8 heap, in memory allocated outside it. It shows up in `arrayBuffers` and in `external` (which includes `arrayBuffers`), not in `heapUsed`. The garbage collector frees it once nothing references the Buffer.

</details>

8. What is wrong with `new Uint16Array(buf.buffer)` for a small Buffer?
<details><summary>Answer</summary>

A small Buffer usually lives inside the shared pool, so `buf.buffer` is the whole pool. The view would cover the whole pool (4096 items with the 8 KiB pool of Node 24.16), not your bytes. Pass the offset and the length: `new Uint16Array(buf.buffer, buf.byteOffset, buf.length / 2)`.

</details>

9. How many base64 characters does a 10-byte buffer need, with and without padding?
<details><summary>Answer</summary>

`Math.ceil(10 / 3) * 4 = 16` characters with `=` padding (what `base64` gives). `base64url` leaves out the padding, so it gives 14.

</details>

10. You run `port.postMessage(buf, [buf.buffer])` with `buf = Buffer.from('hello')`. What happens, and what would work?
<details><summary>Answer</summary>

It throws a `DataCloneError`. A small Buffer lives inside the shared pool, so its `ArrayBuffer` belongs to many Buffers and cannot be moved. Create the Buffer with `Buffer.alloc(5)` (own `ArrayBuffer`) and transfer that, or send a copy by leaving out the transfer list.

</details>

## Try it yourself

### Task 1 (easy): sizes and base64

For the text `'Node '` plus a rocket emoji plus `' café'` (use the escape `\u{1F680}` for the rocket), print the string length, the number of characters (code points) and the utf8 byte length. Then convert the text to base64 and back, and check that you get the same text.

<details><summary>Hint</summary>

`text.length` counts UTF-16 units, `[...text].length` counts code points, `Buffer.byteLength(text)` counts bytes. For the round trip use `Buffer.from(text).toString('base64')` and `Buffer.from(b64, 'base64').toString()`.

</details>

<details><summary>Solution</summary>

Save as `task1.js` and run `node task1.js`.

```js
const text = 'Node \u{1F680} caf\u00e9';

console.log('text         :', text);
console.log('string length:', text.length); // UTF-16 code units
console.log('characters   :', [...text].length); // code points
console.log('bytes (utf8) :', Buffer.byteLength(text));

const b64 = Buffer.from(text).toString('base64');
console.log('base64       :', b64);
console.log('round trip ok:', Buffer.from(b64, 'base64').toString() === text);
```

Output:

```text
text         : Node 🚀 café
string length: 12
characters   : 11
bytes (utf8) : 15
base64       : Tm9kZSDwn5qAIGNhZsOp
round trip ok: true
```

The rocket is 2 UTF-16 units, 1 code point and 4 bytes, so the three numbers differ.

</details>

### Task 2 (medium): pack and unpack strings

Write `pack(strings)` that returns one Buffer: for every string, a 2-byte big-endian length followed by the utf8 bytes. Write `unpack(buffer)` that returns the array of strings again. Test with `['hi', 'héllo', '', '€']`. Make `unpack` throw a `RangeError` if the data is cut off.

<details><summary>Hint</summary>

In `pack`, make the body with `Buffer.from(s, 'utf8')`, a 2-byte Buffer with `writeUInt16BE(body.length)`, and join everything with `Buffer.concat`. In `unpack`, keep an `offset`: read the length with `readUInt16BE(offset)`, add 2, read that many bytes with `toString('utf8', offset, offset + length)`, then add the length.

</details>

<details><summary>Solution</summary>

```js
// Pack a list of strings into one Buffer: [2 byte length][utf8 bytes] for each string.
function pack(strings) {
  const parts = [];
  for (const s of strings) {
    const body = Buffer.from(s, 'utf8');
    const length = Buffer.alloc(2);
    length.writeUInt16BE(body.length); // throws if a string is longer than 65535 bytes
    parts.push(length, body);
  }
  return Buffer.concat(parts);
}

function unpack(buf) {
  const strings = [];
  let offset = 0;
  while (offset < buf.length) {
    const length = buf.readUInt16BE(offset); // throws if the length field itself is cut off
    offset += 2;
    if (offset + length > buf.length) throw new RangeError('truncated data');
    strings.push(buf.toString('utf8', offset, offset + length));
    offset += length;
  }
  return strings;
}

const input = ['hi', 'h\u00e9llo', '', '\u20ac'];
const packed = pack(input);
console.log('packed hex  :', packed.toString('hex'));
console.log('unpacked    :', unpack(packed));
console.log('same?       :', JSON.stringify(unpack(packed)) === JSON.stringify(input));

try {
  unpack(packed.subarray(0, packed.length - 1)); // cut the last byte off
} catch (err) {
  console.log('truncated   :', err.message);
}
```

Output:

```text
packed hex  : 00026869000668c3a96c6c6f00000003e282ac
unpacked    : [ 'hi', 'héllo', '', '€' ]
same?       : true
truncated   : truncated data
```

The empty string is stored as the two length bytes `00 00` and no body. Because the length is in bytes, `héllo` has a 6-byte body, not 5.

</details>

### Task 3 (harder): a line splitter that survives any chunk size

Write `createLineSplitter(onLine)` that returns an object with `push(chunk)` and `end()`. `push` receives Buffers of any size (they may cut a multi-byte character or a line in half). It must call `onLine(text)` once for every complete line (lines end with `\n` or `\r\n`, and the line ending is not part of the text). `end()` flushes the last line, which has no newline. Test it with 3-byte chunks of `'héllo\nwörld €\r\nlast line, no newline'`.

<details><summary>Hint</summary>

Use one `StringDecoder('utf8')` for the whole life of the splitter and keep a string `pending`. In `push`: `pending += decoder.write(chunk)`, then `pending.split('\n')`. The last piece of the split is a line that is not finished, so keep it in `pending` (`lines.pop()`). In `end`: add `decoder.end()` and emit what is left, if anything.

</details>

<details><summary>Solution</summary>

```js
const { StringDecoder } = require('node:string_decoder');

// Feed it Buffer chunks of any size. It calls onLine once for every complete line.
function createLineSplitter(onLine) {
  const decoder = new StringDecoder('utf8'); // keeps half characters between chunks
  let pending = ''; // text of a line that has no newline yet

  const emit = (line) => onLine(line.endsWith('\r') ? line.slice(0, -1) : line);

  return {
    push(chunk) {
      pending += decoder.write(chunk);
      const lines = pending.split('\n');
      pending = lines.pop(); // the last piece is not finished yet
      lines.forEach(emit);
    },
    end() {
      pending += decoder.end();
      if (pending.length > 0) emit(pending);
      pending = '';
    },
  };
}

const data = Buffer.from('h\u00e9llo\nw\u00f6rld \u20ac\r\nlast line, no newline');
const lines = [];
const splitter = createLineSplitter((line) => lines.push(line));

for (let i = 0; i < data.length; i += 3) {
  splitter.push(data.subarray(i, i + 3)); // 3 byte chunks cut some characters in half (the o-umlaut and the euro sign)
}
splitter.end();

console.log(lines);
```

Output:

```text
[ 'héllo', 'wörld €', 'last line, no newline' ]
```

The 3-byte chunks cut `ö` and `€` apart, and the `StringDecoder` put them back together. Line splitting like this is what `readline` does for you, with more features.

</details>

## Where to go next

- Next lesson: [11. Streams and Backpressure](../11-streams/README.md). Buffers are the chunks that streams move, so you now know what is inside every `data` event.
- Practise this topic in the interview rounds: [Round 1: screening questions](../../rounds/round-1-screening/questions.md), [Round 2: core questions](../../rounds/round-2-core/questions.md), [Round 3: coding challenges](../../rounds/round-3-coding/questions.md) and [Round 4: advanced questions](../../rounds/round-4-advanced/questions.md).
- Back to the [All lessons](../../README.md) page.
