# 12. HTTP and Networking with Core Modules

> Level: Intermediate   Time: about 150 minutes   Node: 24 (notes where older versions differ)

[Previous: 11. Streams and Backpressure](../11-streams/README.md) | [All lessons](../../README.md) | [Next: 13. Real-Time: WebSockets, Server-Sent Events and Polling](../13-realtime-websockets-sse/README.md)

## What you will learn
- What happens between "I type a URL" and "I see a page", in six steps, and which Node module does each step
- Raw TCP with `node:net`, so you see that HTTP is only text on top of a socket
- A complete HTTP server with no framework: URL and query parsing, safe JSON bodies with a size limit, a routing table, 404, 405 and 500 handling
- The HTTP basics every interviewer asks: methods and idempotency, the 15 status codes that matter, headers, caching with ETag, content negotiation, CORS with a preflight, cookies
- The client side: global `fetch`, `http.request`, keep-alive and `http.Agent`, and the real default values on Node 24
- Server timeouts, graceful shutdown, serving files with streams, `Range` requests
- HTTPS and TLS basics (certificates, why self-signed fails, TLS termination at a proxy), HTTP/2, and DNS (`lookup` versus `resolve`)

All examples run from the repo root, for example `node lessons/12-http-and-networking/examples/01-request-journey.js`. Every example starts its server on **port 0** (the operating system picks a free port), listens only on `127.0.0.1`, talks to it with `fetch` or a socket, and then closes it. They use only core modules, need no internet, and finish by themselves. Run all of them at once with `node scripts/check-examples.js 12-http-and-networking --verbose`.

## 1. How a web request works, end to end

When you open `https://shop.example.com/cart?id=7` in a browser, or call it with `fetch`, the same six steps happen:

| Step | What happens | Node module |
|---|---|---|
| 1. DNS | The name `shop.example.com` is turned into an IP address such as `93.184.216.34` | `node:dns` |
| 2. TCP | The client opens a connection to that IP and a port (80 for http, 443 for https). Three small messages (SYN, SYN-ACK, ACK) make a reliable, ordered pipe | `node:net` |
| 3. TLS | Only for `https`. Both sides agree on encryption keys, and the client checks the server's certificate | `node:tls` |
| 4. HTTP request | The client sends text: a request line, headers, an empty line, and maybe a body | `node:http`, `fetch` |
| 5. HTTP response | The server sends text back: a status line, headers, an empty line, and the body | `node:http` |
| 6. Close or reuse | The connection is closed, or kept open for the next request (this is called **keep-alive**) | `node:http` Agent |

```text
client                                              server
  |  1. DNS: "what is the IP of shop.example.com?"    |   (asks a DNS server, not this server)
  |  2. TCP: SYN ------------------------------->     |
  |          <------------------------- SYN-ACK       |
  |          ACK ------------------------------->     |
  |  3. TLS: hello, certificate, keys  <------->      |   (https only)
  |  4. GET /cart?id=7 HTTP/1.1 ----------------->    |
  |  5.      <---------------- HTTP/1.1 200 OK + body |
  |  6. close, or keep the connection for later       |
```

DNS, TCP and TLS each cost at least one **round trip** (a message travels to the other side and the answer travels back). Unless the answer is cached or the connection is reused, the first request to a new site is the slowest. That is why keep-alive (section 17) matters: the next request skips steps 1 to 3.

A URL has named parts, and you should know them:

```text
https://user@shop.example.com:8443/cart/items?id=7&sort=asc#top
```

| Part | Value in the example | Notes |
|---|---|---|
| scheme | `https` | Decides the protocol and the default port (80 for `http`, 443 for `https`) |
| user | `user` | Rarely used |
| host | `shop.example.com` | The name that DNS turns into an IP address |
| port | `8443` | Optional. Leave it out to get the default port |
| path | `/cart/items` | Which resource |
| query | `?id=7&sort=asc` | Extra `key=value` pairs, joined with `&` |
| fragment | `#top` | Stays in the browser and is **never sent** to the server |

`examples/01-request-journey.js` performs the steps by hand on localhost, using a plain socket instead of a library. The important part:

```js
const { address } = await dns.lookup('localhost', { family: 4 });      // step 1
const socket = net.connect({ host: address, port });                    // step 2
await once(socket, 'connect');
// step 3 (TLS) is skipped: this is plain http
socket.write(['GET /hello HTTP/1.1', 'Host: localhost:PORT', 'Connection: close', '', ''].join('\r\n')); // step 4 (PORT = the real port)
// step 5: collect the 'data' events, which are the response text
// step 6: the server closes the socket because we asked for "Connection: close"
```

```text
1. DNS      "localhost" -> 127.0.0.1
2. TCP      connected, the three-way handshake is done
3. TLS      skipped (plain http). See 11-https-and-http2.js
4. REQUEST  we sent this text:
              GET /hello HTTP/1.1
              Host: localhost:<port>
              Connection: close
              (empty line = end of headers)
5. RESPONSE we got this text:
              HTTP/1.1 200 OK
              Content-Type: text/plain
              Connection: close
              Content-Length: 21
              (empty line = end of headers)
              hello from the server
6. CLOSE    server ended the stream: true, socket destroyed: true
```

There is no magic here. A request is lines of text separated by `\r\n` (carriage return plus line feed), and an empty line ends the headers. Everything else in this lesson is built on that.

> **Interview tip:** "What happens when you type a URL and press Enter?" A strong answer names all six steps, says which ones are skipped on a repeat visit (DNS cache, keep-alive connection, TLS session resume, which is a shortcut for reconnecting to a server you talked to before), mentions that a full TLS 1.3 handshake needs one round trip and TLS 1.2 needs two, and ends with what the server does (routing, handler, response) and how the browser renders. HTTP/1.0 closed the connection after every response; HTTP/1.1 keeps it open by default (we saw `Connection: close` above only because we asked for it).

## 2. TCP sockets with `node:net`

**TCP** (Transmission Control Protocol) gives two programs a reliable, ordered, two-way stream of bytes. **HTTP, Redis, PostgreSQL, SMTP and WebSocket all run on top of TCP.** In Node, `node:net` is the TCP module, and a **socket** is a Duplex stream (lesson 11): you read from it and write to it.

The classic "hello world" of networking is an **echo server**: send it something, get the same thing back.

```js
const server = net.createServer((socket) => {
  socket.pipe(socket); // everything that arrives is written straight back
});
server.listen(0, '127.0.0.1');

// the client
const client = net.connect({ host: '127.0.0.1', port });
client.setEncoding('utf8');
client.write('hello ');
client.write('world');
client.end(); // "I am done sending" (a half-close)
let received = '';
for await (const chunk of client) received += chunk; // a socket is async iterable
```

```text
Part 1: echo server
  client sent "hello " and "world", got back: "hello world"
  server saw 1 client
```

(This is part 1 of `examples/02-tcp-echo.js`.) `pipe` copies in both directions with backpressure handled for you. When the client calls `end()`, the server's readable side ends, `pipe` ends the writable side, and both sockets close.

Useful events on a socket: `connect` (client side, the handshake finished), `data` (bytes arrived), `end` (the other side finished sending), `close` (fully closed), `error` (something broke; always add a listener, an unhandled `error` crashes the process).

> **Common mistake:** thinking one `write()` on one side becomes one `data` event on the other side. **TCP is a stream of bytes, not a stream of messages.** The network may split one write into pieces or glue several writes together. You must mark where a message ends yourself: a newline, a length prefix, or (as HTTP does) headers plus a `Content-Length`.

Part 2 of the example shows a tiny protocol with one rule: "one command per line". `readline` cuts the byte stream into lines, however the bytes arrived:

```js
const lines = readline.createInterface({ input: socket });
lines.on('line', (line) => {
  const [command, ...args] = line.trim().split(' ');
  if (command === 'PING') socket.write('PONG\n');
  else if (command === 'ADD') socket.write(`${Number(args[0]) + Number(args[1])}\n`);
  else socket.write(`ERR unknown command "${command}"\n`);
});

// the client sends three commands in ONE write
client.write('PING\nADD 2 3\nHELLO\n');
```

```text
Part 2: a tiny line protocol (PING, ADD a b, anything else is an error)
  replies: [ 'PONG', '5', 'ERR unknown command "HELLO"' ]
```

That is exactly how Redis or SMTP work: agree on a text format, parse it from the stream. HTTP is the same idea with a richer format.

Part 3 connects to a port where nobody listens:

```text
Part 3: connecting to a closed port
  error code: ECONNREFUSED
```

Error codes you will meet on sockets and HTTP calls:

| Code | Meaning |
|---|---|
| `ECONNREFUSED` | Nobody listens on that IP and port (server down, wrong port) |
| `ECONNRESET` | The other side closed the connection abruptly while you were using it |
| `ETIMEDOUT` | The other side did not answer in time (a firewall dropping packets, a dead host) |
| `EADDRINUSE` | You tried to `listen` on a port that another program already uses |
| `EPIPE` | You wrote to a connection the other side already closed |
| `ENOTFOUND` | DNS could not find the host name (section 23) |

> **Interview tip:** "TCP versus UDP?" TCP: connection, handshake, reliable, ordered, retransmits lost data, slower start. UDP (`node:dgram`): no connection, no guarantee, no order, very low overhead; used for DNS, live video, games and QUIC (HTTP/3). Node has both: `node:net` and `node:dgram`.

## 3. Your first HTTP server

The `node:http` module turns the byte stream into a request and a response object. With no framework at all:

```js
const http = require('node:http');

const server = http.createServer((req, res) => res.end('Hello from Node'));

server.listen(0, '127.0.0.1', async () => {
  const { port } = server.address();
  const reply = await fetch(`http://127.0.0.1:${port}/`);
  console.log(reply.status, await reply.text());
  server.close();
});
```

```text
200 Hello from Node
```

What each piece is:

- `http.createServer(handler)` makes the server. The `handler(req, res)` runs **once per request**. It is a shortcut for `server.on('request', handler)`.
- `req` is an `IncomingMessage`, a **Readable stream** (the request body). `res` is a `ServerResponse`, a **Writable stream** (the response body).
- `server.listen(0, '127.0.0.1')`: port `0` means "any free port", and the host `127.0.0.1` means "only this computer may connect". Without a host, Node listens on all network interfaces (`::` here), which means other machines can connect too. `server.address()` tells you the real port.
- All requests are handled on **one JavaScript thread** (lesson 08). The interview tip at the end of this section explains what that means.
- If the port is taken, the server emits an `'error'` event with `code: 'EADDRINUSE'`. Add `server.on('error', ...)`.
- If a client sends garbage that is not HTTP, Node answers `400 Bad Request` by itself and closes the connection (the `'clientError'` event).

The request object has what you need to know about the caller:

| Field | Meaning |
|---|---|
| `req.method` | `'GET'`, `'POST'`, and so on. Always upper case |
| `req.url` | **Path plus query string only**, like `/search?q=node`. Not the host |
| `req.headers` | An object. **Header names are lower-cased**: `req.headers['content-type']` |
| `req.rawHeaders` | A flat array with the original upper/lower case |
| `req.httpVersion` | `'1.1'` |
| `req.socket` | The TCP socket. `req.socket.remoteAddress` is the client IP (behind a **proxy**, a server that forwards requests to yours, it is the proxy's IP) |

`examples/03-http-server-basics.js` is a server that echoes what it sees. Here is the `/inspect` route and its output for `/inspect?tag=a&tag=b&limit=10&limit=20` with a header `X-Demo: yes`:

```text
inspect
  GET /inspect?tag=a&tag=b&limit=10&limit=20
  -> 200 content-length=240 transfer-encoding=null
  body (JSON):
    method: "GET"
    url: "/inspect?tag=a&tag=b&limit=10&limit=20"
    pathname: "/inspect"
    search: "?tag=a&tag=b&limit=10&limit=20"
    tags: ["a","b"]
    asObject: {"tag":"b","limit":"20"}
    httpVersion: "1.1"
    userAgent: "node"
    customHeader: "yes"
```

`userAgent: "node"` is what the global `fetch` sends on Node 24. The next section explains the `pathname`, `tags` and `asObject` lines.

> **Interview tip:** "How can Node serve thousands of clients with one thread?" Waiting for the network or the disk does not use the JavaScript thread: the operating system waits, and the event loop runs your callback only when data is ready. So a handler that mostly waits (for a database or another service) is cheap. A handler that computes for a long time (hashing, a huge `JSON.parse`, a loop over a million items) blocks every other client. The fixes are streaming, splitting the work into small steps, worker threads or more processes (lesson 18).

## 4. Parsing the URL and the query string

Do not cut `req.url` apart with `split('?')`. Use the standard `URL` class, which is global and works the same in browsers:

```js
const url = new URL(req.url, 'http://localhost'); // the base is a placeholder
url.pathname;                    // '/hello'
url.searchParams.get('name');    // 'Ada Lovelace' (already decoded from 'Ada%20Lovelace'), or null if missing
url.searchParams.getAll('tag');  // ['a', 'b'] for ?tag=a&tag=b
url.searchParams.has('done');    // true or false
Object.fromEntries(url.searchParams); // { tag: 'b', limit: '20' }: repeated keys collapse, the LAST one wins
```

(Parts of `examples/03-http-server-basics.js`.)

```text
hello with a name
  GET /hello?name=Ada%20Lovelace
  -> 200 content-length=20 transfer-encoding=null
  body: Hello, Ada Lovelace!
hello without a name
  GET /hello
  -> 200 content-length=16 transfer-encoding=null
  body: Hello, stranger!
```

Rules that save you from bugs:

- **Always parse before comparing.** `req.url === '/hello'` is false for `/hello?name=Ada`. Compare `url.pathname`.
- **Every query value is a string.** `?limit=10` gives `'10'`. Convert it (`Number(...)`) and check the result (`Number.isInteger`).
- A missing key gives `null`, an empty one (`?name=`) gives `''`. Treat both as "not provided" when it makes sense.
- Build query strings with `new URLSearchParams({ q: 'a b&c' }).toString()`, which gives `q=a+b%26c`. Never glue strings by hand: the `&` would end the value.
- The `Host` header is chosen by the client. If you build absolute links, use a base URL from your own config, not from `req.headers.host`.

> **Common mistake:** using the old `url.parse(req.url, true)`. It is **runtime-deprecated since Node 24.0.0** (code DEP0169) and prints a warning, because its behaviour is not standardized and had security problems. `new URL(...)` is the replacement.

## 5. Sending a response: status, headers, body

A response has three parts, and they must be sent **in this order**: status, then headers, then body.

```js
res.statusCode = 201;                          // 1. status (the default is 200)
res.setHeader('Content-Type', 'text/plain');   // 2. headers, one by one, any time before the first write
res.end('created');                            // 3. body, and "I am finished"
```

| Method | What it does |
|---|---|
| `res.statusCode = 404` | Sets the status code. `res.statusMessage` is the text; the default comes from `http.STATUS_CODES` |
| `res.setHeader(name, value)` | Sets one header. An array value sends the header several times (used for `Set-Cookie`) |
| `res.getHeader(name)`, `res.hasHeader(name)`, `res.removeHeader(name)` | Look at or change headers that are not sent yet |
| `res.writeHead(status, headers)` | Sets status and headers in one call, **and prepares the header block to be sent** |
| `res.write(chunk)` | Sends part of the body. The first `write` sends the headers |
| `res.end([chunk])` | Sends the last part and finishes. **You must always call it**, or the client waits forever |
| `res.headersSent` | `true` once the headers have gone out |

The `writeHead` plus `end` call chain works because `writeHead` returns `res`: `res.writeHead(204).end()`.

What happens if you change a header too late (the `/too-late` route of `examples/03-http-server-basics.js`):

```js
res.write('first part. ');
res.setHeader('X-Late', '1'); // throws ERR_HTTP_HEADERS_SENT
```

```text
Headers after the first write
too late
  GET /too-late
  -> 200 content-length=null transfer-encoding=chunked
  body: first part. setHeader failed with ERR_HTTP_HEADERS_SENT. done
```

Once the first byte of the body is sent, the status and headers are on the wire and cannot be changed. The error `ERR_HTTP_HEADERS_SENT` ("Cannot set headers after they are sent to the client") is one of the most common Node bugs. It usually means two code paths both tried to respond, for example a handler that forgot a `return` after `res.end()`.

### Content-Length versus chunked

The client must know where the body ends. HTTP/1.1 has two ways:

1. **`Content-Length: 21`**: the exact number of bytes. Used when you know the size in advance.
2. **`Transfer-Encoding: chunked`**: the body is sent in pieces, each with its own size, and a final empty piece means "the end". Used when the size is not known yet (streaming).

Node chooses for you, and there is a famous gotcha. These two handlers send the same text:

```js
// A: setHeader + end(data)  -> Node adds Content-Length (it sees the whole body in end(), with no write() before)
res.setHeader('Content-Type', 'text/plain');
res.end('created');

// B: writeHead + end(data)  -> the header block is already built, so Node falls back to chunked
res.writeHead(201, { 'Content-Type': 'text/plain' });
res.end('created');
```

```text
statusCode + setHeader + end
  GET /set-header-style
  -> 201 content-length=7 transfer-encoding=null
  body: created
writeHead + end
  GET /write-head-style
  -> 201 content-length=null transfer-encoding=chunked
  body: created
```

Both work for a client, but chunked is slightly less efficient and some tools cannot show a progress bar. If you use `writeHead` and you know the size, add the header yourself. Remember that **`Content-Length` counts bytes, not characters**:

```js
const body = JSON.stringify(data);
res.writeHead(200, {
  'Content-Type': 'application/json',
  'Content-Length': Buffer.byteLength(body), // 'héllo' is 5 characters but 6 bytes in UTF-8
});
res.end(body);
```

A wrong `Content-Length` (too small) makes the client cut the body; (too large) makes it wait for bytes that never come.

Two more rules: responses with status `204` and `304`, and responses to `HEAD` requests, have **no body**. (For `HEAD`, Node drops the body you pass to `end()`, so one handler can serve both `GET` and `HEAD`.) And `Content-Type: text/plain` without `charset` is fine for ASCII; for JSON `application/json` is enough (JSON is always UTF-8).

A request must not carry both `Content-Length` and `Transfer-Encoding`. A proxy and a server can disagree about where such a body ends, and an attacker uses that gap to hide a second request inside the first one (**request smuggling**). Node's parser refuses the combination: a Node 24 server answers `400 Bad Request` (the `'clientError'` code is `HPE_INVALID_TRANSFER_ENCODING`).

### If the client goes away

Clients close tabs and lose Wi-Fi. When the connection drops before you finished, the response emits `'close'` while `res.writableFinished` is still `false`. Use this to stop work that nobody will read (cancel a database query, stop a stream):

```js
res.on('close', () => {
  // 'close' also fires after a normal finish, but then writableFinished is true
  if (!res.writableFinished) console.log('the client left before the response was complete');
});
```

> **Interview tip:** "How do you send a big response without loading it in memory?" Stream it: `pipeline(fs.createReadStream(file), res)` (section 20). Node then uses chunked encoding or the `Content-Length` you set, and backpressure keeps memory flat.

## 6. Reading the request body safely

For `POST`, `PUT` and `PATCH`, the body arrives **as a stream**, because it can be large and arrives slowly. Reading it is the same as reading any Readable (lesson 11): iterate over the chunks.

The naive version is dangerous:

```js
let body = '';
for await (const chunk of req) body += chunk; // a client can send 5 GB and fill your memory
const data = JSON.parse(body);                // this throws on bad JSON and crashes the handler
```

A safe version does four things: checks the `Content-Type`, refuses big bodies early, **counts the real bytes** while reading, and turns bad JSON into a `400`. This is `readJson` from `examples/04-router-and-json.js`:

```js
class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

async function readJson(req, limit = 1024) {
  const type = req.headers['content-type'] || '';
  if (!type.startsWith('application/json')) {
    throw new HttpError(415, 'Content-Type must be application/json');
  }
  // Cheap early check: the client announced a size that is already too big.
  if (Number(req.headers['content-length']) > limit) {
    throw new HttpError(413, 'Body too large', { Connection: 'close' });
  }
  // The header can be missing (chunked upload) or a lie, so count the real bytes too.
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Body too large', { Connection: 'close' });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Body is not valid JSON');
  }
}
```

Which status code for which problem:

| Problem | Status | Why |
|---|---|---|
| Wrong or missing `Content-Type` | `415 Unsupported Media Type` | You only accept JSON |
| Body larger than your limit | `413 Payload Too Large` | Refuse before storing it. Add `Connection: close` so the unread bytes are not downloaded |
| Not parseable as JSON | `400 Bad Request` | The request is malformed |
| Valid JSON, but the data is wrong (empty title, `null`, a string where an object is needed) | `422 Unprocessable Entity` | The syntax is fine, the meaning is not |

Notes:

- `JSON.parse('null')` is valid and gives `null`; `JSON.parse('[1,2]')` gives an array. **Always check the shape** after parsing (`readObject` in the example does this and answers `422`).
- If the client disconnects while you are reading, the `for await` loop **throws** (`Error: aborted`, code `ECONNRESET`). That is why the whole handler needs a `try/catch` (next section).
- If a client uploads a very large body and you answer `413` early, a client may see a connection reset instead of your `413`. This is normal: you stopped listening before it stopped talking.
- A client that wants to upload a big body can first send the header `Expect: 100-continue` and wait for a green light. Node answers `100 Continue` by itself. If you add a `'checkContinue'` listener on the server, you decide: call `res.writeContinue()` to let the upload start, or answer `413` and never read the body.
- `application/x-www-form-urlencoded` bodies can be parsed with `new URLSearchParams(text)`. `multipart/form-data` (file uploads) is hard to parse correctly; use a streaming parser library (Needs: `npm install busboy`) instead of writing your own.
- Frameworks do exactly this with a limit option, for example `express.json({ limit: '100kb' })` (Needs: `npm install express`).

> **Common mistake:** no body limit. A server with `body += chunk` can be knocked over by one request. Interviewers like to ask "what happens if a client sends a 10 GB POST?".

## 7. A hand-rolled router, a JSON helper, 404, 405 and 500

Frameworks give you routing, JSON helpers and error handling. Building a small version once teaches you what they do. `examples/04-router-and-json.js` is a complete todo API in about 250 lines (with comments). Its parts:

**A JSON helper**, so every handler responds the same way:

```js
function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body), // bytes, not characters
    ...headers,
  });
  res.end(body);
}
```

**A routing table.** Each route is a method, a pattern with `:name` placeholders, and a handler. The pattern is compiled to a regular expression once:

```js
const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  // "/todos/:id" becomes ^/todos/([^/]+)/?$ and keys = ['id']
  const source = pattern.replace(/:(\w+)/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  });
  routes.push({ method, regex: new RegExp(`^${source}/?$`), keys, handler });
}

route('GET', '/todos', ({ res }) => sendJson(res, 200, [...todos.values()]));
route('GET', '/todos/:id', ({ res, params }) => sendJson(res, 200, findTodo(params)));
route('POST', '/todos', async ({ req, res }) => { /* readObject, validate, create, 201 + Location */ });
```

**The dispatcher**: find the route, run it, turn every error into a response.

```js
const server = http.createServer(async (req, res) => {
  // An async handler returns a promise that http ignores, so ALWAYS catch inside.
  try {
    const url = new URL(req.url, 'http://localhost');
    const methodsForThisPath = [];
    for (const r of routes) {
      const match = r.regex.exec(url.pathname);
      if (!match) continue;
      if (r.method !== req.method) {
        methodsForThisPath.push(r.method); // the path exists, but not for this method
        continue;
      }
      // (the real file wraps the next line in try/catch and answers 400 when decodeURIComponent throws)
      const params = Object.fromEntries(r.keys.map((key, i) => [key, decodeURIComponent(match[i + 1])]));
      await r.handler({ req, res, url, params });
      return;
    }
    if (methodsForThisPath.length > 0) {
      throw new HttpError(405, 'Method not allowed', { Allow: methodsForThisPath.join(', ') });
    }
    throw new HttpError(404, 'Route not found');
  } catch (err) {
    sendError(res, err);
  }
});

function sendError(res, err) {
  if (res.headersSent) { res.destroy(); return; } // too late to change the status
  if (err instanceof HttpError) {
    sendJson(res, err.status, { error: err.message }, err.headers);
  } else {
    console.log('  (server log) unexpected error:', err.message); // details go to the log ...
    sendJson(res, 500, { error: 'Internal Server Error' });      // ... and the client learns nothing useful to an attacker
  }
}
```

Here is the output of the error half of the example (the first half is in sections 8 and 9):

```text
--- errors
unknown path -> 404
  GET /nothing -> 404 {"error":"Route not found"}
known path, wrong method -> 405 + Allow
  DELETE /todos -> 405 [allow: GET, POST] {"error":"Method not allowed"}
not JSON -> 400
  POST /todos -> 400 {"error":"Body is not valid JSON"}
wrong Content-Type -> 415
  POST /todos -> 415 {"error":"Content-Type must be application/json"}
body over the limit -> 413
  POST /todos -> 413 {"error":"Body too large"}
valid JSON, invalid data -> 422
  POST /todos -> 422 {"error":"title must be a non-empty string"}
valid JSON but not an object -> 422
  PATCH /todos/1 -> 422 {"error":"Body must be a JSON object"}
bad percent-encoding -> 400
  GET /todos/%E0%A4%A -> 400 {"error":"Bad percent-encoding in the URL"}
a bug in a handler -> 500
  (server log) unexpected error: database is down
  GET /crash -> 500 {"error":"Internal Server Error"}
```

The design rules worth remembering:

- **One place turns errors into responses.** Handlers just `throw new HttpError(404, ...)`.
- **Known errors carry a status; unknown errors become `500`** with a generic message. Never send `err.stack` or database messages to the client.
- **`404` versus `405`**: the path is unknown (`404`), or the path is known but the method is not (`405` plus an `Allow` header listing the allowed methods).
- **`http.createServer(async (req, res) => ...)` does not catch rejected promises.** If you forget the `try/catch`, a thrown error becomes an unhandled rejection and, on Node 24, **crashes the process** (lessons 07 and 14). Frameworks wrap your handlers for you. Express 5 does this automatically for async handlers.
- Decode path parameters with `decodeURIComponent` and treat a failure as `400`; it throws on broken `%` sequences.

> **Remember:** this router tries every route in order, which is fine for 20 routes. Real routers use a tree (find-my-way in Fastify) to stay fast with thousands. The idea is the same.

## 8. REST design basics

**REST** is a style for HTTP APIs, not a standard. In practice, when interviewers say "REST API" they mean these habits:

1. **URLs name things (resources), methods name the action.** `GET /todos/7`, not `GET /getTodo?id=7`. Use plural nouns: `/todos`, `/users/3/orders`.
2. **Use the right method and status code** (next two sections). `POST /todos` answers `201 Created` with a `Location: /todos/1` header; `DELETE` answers `204 No Content`.
3. **Stateless**: every request carries everything the server needs (a token in `Authorization`). The server does not remember the previous request, so any server in a pool can answer it. This is what makes horizontal scaling easy.
4. **Representations**: the client says what it sends (`Content-Type`) and what it wants back (`Accept`). JSON is the norm.
5. **Collections support filtering, sorting, paging** through the query string: `GET /todos?done=true&sort=-createdAt&limit=20&cursor=abc`. Prefer a **cursor** over `page=500` for big data sets (offset paging gets slow and skips rows when data changes).
6. **One error format** for everything, for example `{ "error": "message" }` or `{ "error": { "code": "TODO_NOT_FOUND", "message": "..." } }`.
7. **Version it** when you must break clients: `/v1/todos` (simple and visible) or a header.
8. **Retries must be safe.** `GET`, `PUT`, `DELETE` can be repeated. For `POST`, accept an `Idempotency-Key` header and remember the result for that key (payment APIs do this).

The first half of the output of `examples/04-router-and-json.js` shows these habits in action:

```text
--- creating, reading, changing, deleting
create (POST)
  POST /todos -> 201 [location: /todos/1] {"id":1,"title":"learn http","done":false}
POST again: a second todo, so POST is not idempotent
  POST /todos -> 201 [location: /todos/2] {"id":2,"title":"learn http","done":false}
list
  GET /todos -> 200 [{"id":1,"title":"learn http","done":false},{"id":2,"title":"learn http","done":false}]
read one
  GET /todos/1 -> 200 {"id":1,"title":"learn http","done":false}
PUT (replace)
  PUT /todos/1 -> 200 {"id":1,"title":"learn http well","done":true}
PUT again: same request, same state, so PUT is idempotent
  PUT /todos/1 -> 200 {"id":1,"title":"learn http well","done":true}
PATCH (change one field)
  PATCH /todos/2 -> 200 {"id":2,"title":"learn http","done":true}
filter with a query string
  GET /todos?done=true -> 200 [{"id":1,"title":"learn http well","done":true},{"id":2,"title":"learn http","done":true}]
DELETE
  DELETE /todos/2 -> 204 
DELETE again: the state is the same (gone), the status differs
  DELETE /todos/2 -> 404 {"error":"Todo 2 not found"}
```

> **Interview tip:** "Is your API RESTful?" Be honest and precise: most "REST" APIs are really "JSON over HTTP with resource URLs". Full REST also has hypermedia links (HATEOAS), which few APIs use. Say which rules you follow and why.

## 9. Methods and idempotency

Two words interviewers love:

- **Safe**: the request does not change anything on the server. (Reading.)
- **Idempotent**: doing it **once or ten times leaves the server in the same state**. The *response* may differ.

| Method | Use it to | Safe | Idempotent | Usual body |
|---|---|---|---|---|
| `GET` | read a resource | yes | yes | no |
| `HEAD` | like GET, headers only (check size, existence) | yes | yes | no |
| `OPTIONS` | ask what is allowed; the CORS preflight | yes | yes | no |
| `POST` | create a resource (server picks the id) or run an action | no | **no** | yes |
| `PUT` | **replace** the whole resource at a URL you know | no | yes | yes |
| `PATCH` | change **part** of a resource | no | **not guaranteed** | yes |
| `DELETE` | remove a resource | no | yes | rarely |

Why it matters: networks fail. If a client sends a request and the connection dies before the answer comes back, it does not know whether the server did the work. For idempotent methods it can just **send it again**. Proxies, browsers and HTTP clients rely on this. Retrying a `POST` can charge a credit card twice.

`examples/04-router-and-json.js` proves it with the output above: `POST` twice created two todos; `PUT` twice left the same todo; the second `DELETE` returned `404` but the state ("todo 2 is gone") is identical, so `DELETE` is still idempotent.

Gotchas interviewers use:

- **"The second `DELETE` returns 404, so it is not idempotent."** Wrong. Idempotency is about the state of the server, not about the status code.
- **"Is `PATCH` idempotent?"** Not by definition. `PATCH {"done": true}` happens to be. `PATCH {"increment": 1}` is not.
- **`PUT` versus `POST` to create:** `PUT /todos/7` when the client chooses the id (repeatable). `POST /todos` when the server chooses it (not repeatable).
- **`PUT` versus `PATCH`:** `PUT` sends the whole object (missing fields are removed or reset); `PATCH` sends only what changes.
- A method is not a security rule. Nothing stops a `GET` handler from deleting data; it just breaks every cache and crawler that assumes `GET` is safe.

## 10. Status codes: the 15 that matter

A status code is three digits. The first digit is the class:

| Class | Meaning |
|---|---|
| `1xx` | Informational (`101 Switching Protocols` is used when a connection turns into a WebSocket) |
| `2xx` | Success |
| `3xx` | Redirect, or "use your cached copy" |
| `4xx` | **The client made a mistake** (fixing the request may help) |
| `5xx` | **The server failed** (the same request may work later) |

The 15 codes you should know cold:

| Code | Name | Use it when | Gotcha |
|---|---|---|---|
| `200` | OK | Normal success with a body | The default in Node |
| `201` | Created | A `POST` made a new resource | Add `Location: /todos/1` |
| `204` | No Content | Success with nothing to send (`DELETE`, `PUT`) | Must have no body |
| `301` | Moved Permanently | The URL changed for good | Browsers and search engines remember it |
| `302` | Found | Temporary redirect | Many clients change `POST` to `GET`. Use `307` (keep method, temporary) or `308` (keep method, permanent) when that matters |
| `304` | Not Modified | The client's cached copy is still good (section 12) | Must have no body |
| `400` | Bad Request | Malformed request: broken JSON, missing parameter | Not for "the data is invalid", see `422` |
| `401` | Unauthorized | **Not authenticated**: no or bad credentials | The name is misleading. Send `WWW-Authenticate` |
| `403` | Forbidden | **Authenticated but not allowed** | Logging in again will not help |
| `404` | Not Found | No such resource | Also used to hide that a private resource exists |
| `409` | Conflict | The request clashes with the current state: duplicate email, edit based on an old version | |
| `422` | Unprocessable Entity | Well-formed request, but the data fails validation | Many APIs use `400` for this too; pick one rule |
| `429` | Too Many Requests | Rate limit hit | Send `Retry-After: 30` (seconds) |
| `500` | Internal Server Error | A bug or unexpected failure | Never include the stack trace |
| `503` | Service Unavailable | Overloaded, in maintenance, shutting down | Send `Retry-After` |

You can see most of them in the examples: `04-router-and-json.js` answers 200, 201, 204, 400, 404, 405, 413, 415, 422 and 500; `06-caching-and-negotiation.js` answers 301, 304, 307 and 406; `10-file-streaming.js` answers 206 and 416.

Others that appear in interviews: `206 Partial Content` (Range, section 20), `405 Method Not Allowed`, `406 Not Acceptable`, `408 Request Timeout`, `413 Payload Too Large`, `415 Unsupported Media Type`, `416 Range Not Satisfiable`, `431 Request Header Fields Too Large`, `502 Bad Gateway` (a proxy got a bad answer from Node), `504 Gateway Timeout` (a proxy gave up waiting for Node).

Node keeps the standard texts in `http.STATUS_CODES` (for example `http.STATUS_CODES[404] === 'Not Found'`). In Node 24, `STATUS_CODES[422]` is `'Unprocessable Entity'` and `STATUS_CODES[413]` is `'Payload Too Large'`. The newer HTTP specification (RFC 9110) renamed them to `Unprocessable Content` and `Content Too Large`; the numbers did not change, and this lesson uses the names Node prints.

> **Interview tip:** "401 or 403?" `401` means "I do not know who you are" (log in). `403` means "I know who you are, and the answer is no". A very common wrong answer is to use `401` for a logged-in user who lacks a role.

## 11. Headers that matter, and content negotiation

Headers are `Name: value` lines, case-insensitive in names. These are the ones to know:

| Header | Direction | Meaning |
|---|---|---|
| `Host` | request | Which site the client wants. Required in HTTP/1.1 (Node answers `400` without it) |
| `User-Agent` | request | Who is calling (`node` for Node's `fetch`) |
| `Content-Type` | both | The format of the body: `application/json`, `text/html; charset=utf-8`, `application/x-www-form-urlencoded`, `multipart/form-data; boundary=...`, `application/octet-stream` |
| `Content-Length` | both | The body size in bytes |
| `Accept` | request | The formats the client can use, with preferences: `application/json, text/html;q=0.5` |
| `Accept-Encoding` / `Content-Encoding` | request / response | Compression the client understands (`gzip`, `br`) / compression used |
| `Authorization` | request | Credentials. `Bearer <token>` is the usual form. `Basic <base64(user:pass)>` is base64 text, **not encryption** |
| `Cookie` / `Set-Cookie` | request / response | Section 14 |
| `Cache-Control`, `ETag`, `If-None-Match` | both | Caching, section 12 |
| `Location` | response | Where to go next (`201` and `3xx`) |
| `Origin`, `Access-Control-*` | both | CORS, section 13 |
| `Retry-After` | response | Seconds to wait (`429`, `503`) |
| `Allow` | response | Methods the URL supports (`405`) |
| `Vary` | response | Which request headers changed this answer, so caches keep separate copies |
| `Range` / `Content-Range` | request / response | Partial downloads, section 20 |

Reading the `Authorization` header by hand (inside a request handler):

```js
const [scheme, token] = (req.headers.authorization ?? '').split(' '); // 'Bearer abc123' -> ['Bearer', 'abc123']
if (scheme !== 'Bearer' || !token) {
  res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end(); // a 401 should say how to log in
  return;
}
// Now check the token (a signature, a database row, ...): 401 if it is wrong, 403 if this user may not do the action.
```

**Content negotiation** means one URL can answer in different formats, and the client says what it prefers. The server reads `Accept` and picks. `examples/06-caching-and-negotiation.js` has a small `pickType` function that understands `q` values (quality, from 0 to 1) and wildcards:

```js
const type = pickType(req.headers.accept, ['application/json', 'text/html', 'text/plain']);
res.setHeader('Vary', 'Accept'); // the body depends on the Accept header
if (!type) {
  res.statusCode = 406; // Not Acceptable
  res.setHeader('Content-Type', 'text/plain');
  res.end('I can send application/json, text/html or text/plain');
  return;
}
```

```text
--- Accept
Accept: application/json                 -> 200 application/json {"report":"ok"}
Accept: text/html                        -> 200 text/html <h1>report: ok</h1>
Accept: text/*;q=0.5, application/json   -> 200 application/json {"report":"ok"}
Accept: image/png                        -> 406 text/plain I can send application/json, text/html or text/plain
Accept: (not set)                        -> 200 application/json {"report":"ok"}
```

The third line shows `q` values: the client prefers `application/json` (default `q=1`) over any `text/*` type (`q=0.5`). When you set no `Accept` at all, `fetch` sends `*/*`, which means "anything", so the server picks its first choice.

The same idea works for compression with `Accept-Encoding`. The client says which encodings it supports; the server compresses with `zlib` and says which one it used:

```js
if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
  res.setHeader('Content-Encoding', 'gzip');
  res.end(zlib.gzipSync(longText));
}
```

```text
--- Accept-Encoding
default fetch  -> [ 'content-encoding: gzip', 'content-length: 76' ] text length: 2160
identity       -> [ 'content-length: 2160' ] text length: 2160
```

`fetch` asks for `gzip, deflate` on its own and unpacks the body, so `text.length` is the same. `content-length` is the size on the wire (the exact compressed size depends on the zlib version). `identity` means "no compression". For real apps, let a **reverse proxy** compress (a server in front of your app that forwards requests to it, such as nginx) or a **CDN** (content delivery network: servers around the world that cache and serve your files close to users). Use `Vary: Accept-Encoding` so caches keep both versions. Compressing big bodies synchronously with `gzipSync` blocks the event loop; use a stream (`zlib.createGzip()`) for large data.

> **Common mistake:** returning different content for the same URL depending on a header, but forgetting `Vary`. A shared cache then serves the JSON version to a client that asked for HTML.

## 12. Caching: Cache-Control, ETag and 304

HTTP caching has two ideas:

1. **Freshness**: "you may reuse this answer without asking for N seconds." (`Cache-Control: max-age=N`)
2. **Validation**: "you have a copy; ask me if it is still good, and I will say yes cheaply." (`ETag` plus `If-None-Match`, answered with `304`)

Common `Cache-Control` values:

| Value | Meaning |
|---|---|
| `max-age=3600` | Fresh for one hour. No request is made during that time |
| `public` / `private` | Any cache may store it / only the user's own browser may |
| `no-cache` | **You may store it, but you must revalidate before reusing it.** It does NOT mean "do not cache" |
| `no-store` | Never store it anywhere (bank pages, personal data) |
| `immutable` | It will never change; skip revalidation (used with **fingerprinted** files, whose names contain a hash of their content, like `app.3f9a1c.js`) |

The ETag flow, as in `examples/06-caching-and-negotiation.js`: the server gives each answer a tag (a hash of the content). The client sends the tag back on the next request; if nothing changed, the server answers `304` with **no body**, which saves the bandwidth.

```js
const body = JSON.stringify(article);
const etag = `"${crypto.createHash('sha256').update(body).digest('hex').slice(0, 12)}"`; // the quotes are part of the format
res.setHeader('ETag', etag);
res.setHeader('Cache-Control', 'no-cache'); // store it, but always ask me first
if (req.headers['if-none-match'] === etag) {
  res.statusCode = 304; // Not Modified
  res.end();
  return;
}
res.setHeader('Content-Type', 'application/json');
res.end(body);
```

```text
--- ETag and 304
first request  -> 200 [ 'etag: "5d5477022813"', 'cache-control: no-cache' ] {"title":"HTTP caching","version":1}
same ETag sent -> 304 body length: 0 (client reuses its saved copy)
after a change -> 200 [ 'etag: "92ce8f7af24b"' ] {"title":"HTTP caching","version":2}
--- Cache-Control values
/logo.svg  [ 'cache-control: public, max-age=31536000, immutable' ]
/account   [ 'cache-control: private, no-store' ]
```

There is an older pair that works the same way: the server sends `Last-Modified: <date>`, the client sends back `If-Modified-Since: <date>`, and the server answers `304` if nothing changed. An ETag is more exact, because a date has only one-second precision and says nothing about *what* changed.

Browsers do the `If-None-Match` step by themselves. **Node's `fetch` has no HTTP cache at all**: two `fetch` calls for a cacheable URL make two requests, and the second one carries no `If-None-Match` (checked on Node 24). If you want conditional requests in a Node client, send the header yourself, as the example does.

> **Interview tip:** "How do you cache static files forever and still ship updates?" Put a content hash in the file name (`app.3f9a1c.js`), serve it with `Cache-Control: public, max-age=31536000, immutable`, and keep the HTML itself on `no-cache`. A new build means a new file name, so nothing stale is ever reused.

Redirects are another `3xx` job, in the same example. `res.writeHead(301, { Location: '/new' }).end()` sends the client to `/new`. `fetch` follows redirects by default (`redirect: 'follow'`); with `redirect: 'manual'` you get the `3xx` itself:

```text
--- redirects
/old manual    -> 301 [ 'location: /new' ]
/old followed  -> 200 redirected: true new page reached with GET
POST /temp     -> 200 new page reached with POST (307 keeps the method)
```

## 13. CORS by hand, with a preflight

**CORS** (Cross-Origin Resource Sharing) is a browser rule. An **origin** is scheme + host + port. A page from `https://app.example.com` that calls `https://api.example.com` is making a cross-origin request. By default the browser sends it, but **hides the response from the page's JavaScript** unless the server says it is allowed.

Three facts that interviewers test:

1. **CORS is enforced by browsers only.** `curl`, Postman and Node's `fetch` ignore it. It is not a security feature for your server (anyone can call your API from a script). It protects the *user* from other websites reading their data with their cookies.
2. The server allows an origin by sending `Access-Control-Allow-Origin`.
3. Some requests are "not simple" (a method other than `GET`/`HEAD`/`POST`, a header like `Authorization`, or `Content-Type: application/json`). Before those, the browser sends a **preflight**: an `OPTIONS` request that asks "may I do this?". Only if the answer allows it does the real request follow.

```text
browser                                     api.example.com
  | OPTIONS /api/data                           |
  |   Origin: https://app.example.com           |
  |   Access-Control-Request-Method: PUT        |
  |   Access-Control-Request-Headers: content-type
  |-------------------------------------------->|
  |            204 + Access-Control-Allow-Origin, -Allow-Methods, -Allow-Headers, -Max-Age
  |<--------------------------------------------|
  | PUT /api/data (the real request)            |
  |-------------------------------------------->|
  |            200 + Access-Control-Allow-Origin|
  |<--------------------------------------------|
```

The handler from `examples/05-cors-and-cookies.js`:

```js
const ALLOWED_ORIGINS = new Set(['https://app.example.com']);

function handleCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return false; // not a cross-origin browser call

  res.setHeader('Vary', 'Origin'); // the answer depends on Origin, so caches must keep copies per origin
  const isPreflight = req.method === 'OPTIONS' && req.headers['access-control-request-method'];

  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin); // echo ONE origin; "*" cannot be used with cookies
    res.setHeader('Access-Control-Allow-Credentials', 'true'); // let the page send and receive cookies
    if (isPreflight) {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Max-Age', '600'); // the browser may remember this answer for 10 minutes
    } else {
      res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id'); // response headers JavaScript may read
    }
  }
  if (isPreflight) {
    res.writeHead(204).end(); // a preflight never reaches your normal route code
    return true;
  }
  return false;
}
```

Since Node's `fetch` does not enforce CORS, the example just looks at the headers a browser would receive:

```text
--- CORS
no Origin header (server to server): 200
    (no CORS headers)
allowed origin: 200
    access-control-allow-credentials: true
    access-control-allow-origin: https://app.example.com
    access-control-expose-headers: X-Request-Id
    vary: Origin
other origin: status 200 but no Allow-Origin header, so a browser hides the body from JS
    vary: Origin
preflight from the allowed origin: 204
    access-control-allow-credentials: true
    access-control-allow-headers: Content-Type, Authorization
    access-control-allow-methods: GET, POST, PUT, PATCH, DELETE
    access-control-allow-origin: https://app.example.com
    access-control-max-age: 600
    vary: Origin
```

Details to remember:

- `Access-Control-Allow-Origin: *` allows any origin, but **cannot be combined with credentials** (cookies, `Authorization` sent by the browser). With credentials you must echo one specific origin, and add `Vary: Origin`.
- The "other origin" request still reached your server and ran your code. CORS only stopped the browser from *showing the result* to the page. Never rely on CORS to protect a state-changing endpoint. That needs authentication and protection against **CSRF** (cross-site request forgery: another website makes the user's browser send a request that carries the user's cookies; `SameSite` cookies, section 14, are the first defence).
- `Max-Age` lets the browser skip the preflight for a while.
- In real projects people use the `cors` package (Needs: `npm install cors`), which does the same thing as this function.

> **Common mistake:** "CORS error, so I set `*` everywhere." That turns off a protection and still breaks requests with cookies. Allow the origins you know, and answer the `OPTIONS` preflight.

> **Interview tip:** "It works in Postman but fails in the browser with a CORS error. Why?" Postman, `curl` and Node never enforce CORS; only browsers do. The server must send `Access-Control-Allow-Origin` for the page's origin, and must answer the `OPTIONS` preflight with `2xx` and the right `Allow-Methods` and `Allow-Headers`. Check the response headers in the browser's network tab, not the server code.

## 14. Cookies by hand

A **cookie** is a small piece of text the server asks the browser to store and send back with every later request to the same site. It is how a website remembers you between requests, because HTTP itself is stateless.

- The server sets it with a `Set-Cookie` response header: `Set-Cookie: sid=abc; Max-Age=3600; Path=/; HttpOnly; SameSite=Lax`
- The browser sends it back in one `Cookie` request header: `Cookie: sid=abc; theme=dark`. **Only `name=value` pairs come back; the attributes never do.**

| Attribute | Meaning |
|---|---|
| `Max-Age=3600` (or `Expires=date`) | How long it lives. `Max-Age=0` deletes it. Without both, it is a *session cookie* (until the browser closes) |
| `Path=/` | The URL prefix it is sent to |
| `HttpOnly` | JavaScript in the page **cannot read it** (`document.cookie`). Protects session ids from theft by injected scripts |
| `Secure` | Only sent over HTTPS |
| `SameSite=Lax` / `Strict` / `None` | Controls sending on cross-site requests. `Lax` is a good default and blocks most CSRF; `None` needs `Secure` |
| `Domain=example.com` | Share with subdomains (leave it out to keep the cookie on the exact host) |

`examples/05-cors-and-cookies.js` has a parser, a builder, and a **signed cookie**: the value plus an **HMAC** signature (a hash made with a secret key that only the server knows), so the browser can read the cookie but cannot change it without the server noticing:

```js
function parseCookies(header = '') {
  const jar = Object.create(null);
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    let value = part.slice(index + 1).trim();
    try { value = decodeURIComponent(value); } catch { /* keep the raw value */ }
    if (!(name in jar)) jar[name] = value; // the first one wins
  }
  return jar;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join('; ');
}

// Signed cookies: "value.signature". Anyone can read the value, nobody can change it.
const sign = (value) => crypto.createHmac('sha256', SECRET).update(value).digest('base64url');
const signed = (value) => `${value}.${sign(value)}`;
function unsign(text = '') {
  const dot = text.lastIndexOf('.');
  if (dot === -1) return null;
  const value = text.slice(0, dot);
  const given = Buffer.from(text.slice(dot + 1));
  const expected = Buffer.from(sign(value));
  const ok = given.length === expected.length && crypto.timingSafeEqual(given, expected); // constant-time compare
  return ok ? value : null;
}
```

Setting **two cookies** needs **two `Set-Cookie` headers**. Pass an array to `setHeader`; do not join them with commas, because cookie dates contain commas:

```js
res.setHeader('Set-Cookie', [
  serializeCookie('sid', signed(id), { maxAge: 3600, path: '/', httpOnly: true, sameSite: 'Lax' }),
  serializeCookie('theme', 'dark mode', { maxAge: 86400, path: '/settings', secure: true, sameSite: 'Strict' }),
]);
```

The client in the example is Node, which has **no cookie jar**, so it copies the cookie by hand:

```text
--- cookies
/me -> 401 {"error":"not logged in"}
/login?name=Ada -> 200 {"loggedIn":true}
    Set-Cookie: sid=<id>.<signature>; Max-Age=3600; Path=/; HttpOnly; SameSite=Lax
    Set-Cookie: theme=dark%20mode; Max-Age=86400; Path=/settings; Secure; SameSite=Strict
/me -> 200 {"name":"Ada","visits":1}
/me -> 200 {"name":"Ada","visits":2}
now sending a tampered cookie:
/me -> 401 {"error":"not logged in"}
/logout -> 200 {"loggedIn":false}
    Set-Cookie: sid=; Max-Age=0; Path=/
/me -> 401 {"error":"not logged in"}
--- the parser on its own
{ a: '1', b: 'hello world' }
```

(The session id is random on each run, so the example prints `<id>.<signature>` instead.) On the client, `res.headers.getSetCookie()` returns the array of `Set-Cookie` values; `res.headers.get('set-cookie')` would glue them with commas.

How sessions use this: the cookie holds only a random **session id**; the data (user name, cart) lives on the server in a store (memory here; Redis in production). The alternative is to put the data in the cookie itself, as a signed token such as a **JWT** (JSON Web Token: JSON data plus a signature). That needs no server store, but you cannot easily cancel a token before it expires.

> **Common mistake:** storing a session in a cookie without `HttpOnly` and `Secure`, or trusting a cookie value without verifying a signature. Anyone can edit a cookie with the browser's developer tools.

## 15. The client side: global `fetch`

`fetch` is global in Node (since 18, stable since 21; on Node 24 it runs on the **undici** library, version 7). It has the same API as the browser's. `examples/07-fetch-client.js` runs through every case below.

```js
const res = await fetch(url);         // a Response, as soon as the HEADERS arrive
res.status; res.ok; res.statusText;   // 200, true (status 200 to 299), 'OK'
res.headers.get('content-type');      // header names are case-insensitive
const data = await res.json();        // read the body: .json() .text() .arrayBuffer() .blob() .formData()
```

```text
1. GET and read the body
  status: 200 OK | ok: true
  content-type: application/json | x-rate-limit: 100
  json(): { id: 1, name: 'Ada' }
```

**Sending data.** You must set the `Content-Type` yourself for JSON:

```js
const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer my-token' },
  body: JSON.stringify({ hello: 'world' }),
});
```

```text
2. POST JSON (you must set the Content-Type yourself)
  server saw: {"method":"POST","contentType":"application/json","auth":"Bearer my-token","body":"{\"hello\":\"world\"}"}
3. A string body gets text/plain by default
  content-type the server saw: text/plain;charset=UTF-8
```

A `URLSearchParams` body is sent as `application/x-www-form-urlencoded`, and a `FormData` body as `multipart/form-data` (this is how you upload files). To upload a big file without loading it in memory, pass a stream as the body and add `duplex: 'half'` (without it, Node throws `TypeError: RequestInit: duplex option is required when sending a body`):

```js
const { Readable } = require('node:stream');
await fetch(url, { method: 'POST', body: Readable.toWeb(fs.createReadStream(file)), duplex: 'half' });
```

**The most asked fetch question: error handling.**

```js
res = await fetch(base + '/nothing');   // the server answers 404
// the promise RESOLVES. res.ok is false.
```

```text
4. fetch does NOT reject on 404 or 500
  404 -> resolved, ok = false , status = 404 , body = no such page
  fetchJson turns it into an error: HTTP 500 Internal Server Error | body: {"error":"database is down"}
```

**`fetch` rejects only when no HTTP response arrived at all**: connection refused, DNS failure, TLS error, timeout, abort. So you always check `res.ok`. The helper that most projects write:

```js
async function fetchJson(url, options = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(2000), ...options });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = await res.text();
    throw err;
  }
  return res.json();
}
```

When the promise does reject, the error is always `TypeError: fetch failed`, and **the real reason is in `err.cause`**:

```text
5. fetch DOES reject when there is no response at all
  error: TypeError: fetch failed
  the real reason is in err.cause.code: ECONNREFUSED
```

Other `cause.code` values you will see: `ENOTFOUND` (DNS), `ECONNRESET`, `UND_ERR_CONNECT_TIMEOUT`, and certificate errors such as `DEPTH_ZERO_SELF_SIGNED_CERT` (section 21). Ports like 1 and 9 are refused by `fetch` itself as "bad port" (a browser safety rule), so use a high port for tests.

**Timeouts and cancelling.** `fetch` has **no overall timeout of its own**. The undici library behind it has per-phase limits (according to the undici docs: 10 seconds to connect, then 5 minutes to receive the response headers and 5 minutes between body chunks), so a stalled server can still keep your code waiting for minutes. Always pass a signal:

```js
await fetch(url, { signal: AbortSignal.timeout(100) });  // rejects with name 'TimeoutError'
const controller = new AbortController();
setTimeout(() => controller.abort(), 50);
await fetch(url, { signal: controller.signal });         // rejects with name 'AbortError'
```

```text
6. Timeouts and cancelling
  AbortSignal.timeout -> TimeoutError | The operation was aborted due to timeout
  controller.abort()  -> AbortError | This operation was aborted
```

`AbortSignal.any([a, b])` combines signals (for example a user-cancel plus a timeout).

**Reading a body as a stream.** `res.body` is a web `ReadableStream`; it can be iterated with `for await`, so a huge download never sits in memory:

```js
for await (const chunk of res.body) {
  received += decoder.decode(chunk, { stream: true }); // chunk is a Uint8Array
}
// Node stream interop: Readable.fromWeb(res.body).pipe(fs.createWriteStream(file))
```

```text
7. Read a body as a stream, piece by piece
  lines received: [ 'one', 'two', 'three' ]
```

Where the chunk borders fall is decided by the network, so the example joins the text before printing. **A body can only be read once**; call `res.clone()` first if you need two reads:

```text
8. A body can be read only once
  second read: TypeError | Body is unusable: Body has already been read
  clone works: Ada + 21 characters
```

Last, a bad URL fails before any network call, with a `TypeError` whose `cause.code` is `ERR_INVALID_URL`.

Good to know:
- `fetch` follows redirects by default; `redirect: 'manual'` or `'error'` change that.
- `fetch` keeps its own connection pool inside undici. It does **not** use `http.globalAgent`, so `http.Agent` settings do not affect it.
- `fetch` has no retries, interceptors, base URL or cookie jar. Libraries such as axios or got add those; you can write a small retry helper (Try it yourself, task 2).

> **Interview tip:** "Why not use `node-fetch` or `axios`?" Since Node 18 `fetch` is built in, so for simple calls you need no dependency. A library is still reasonable for interceptors, automatic retries or progress events. Always mention the `res.ok` check and the timeout.

## 16. `http.request` and `https.request`: the low-level client

`fetch` is built on top of ideas you can see in `http.request`. It gives you the raw pieces: the request is a **Writable** stream, the response is a **Readable** stream. This is what many older libraries and SDKs still use, so you must be able to read it.

```js
function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      // res is a Readable stream of the response body
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);          // network errors arrive here, not in the callback
    if (body !== undefined) req.write(body); // req is a Writable stream of the request body
    req.end();                        // you MUST call end(), or the request is never finished
  });
}

await request({ host: '127.0.0.1', port, path: '/save', method: 'POST', headers: { 'Content-Type': 'text/plain' } }, 'some data');
```

```text
1. GET and POST with http.request
   { status: 200, text: 'GET /hello body=""' }
   { status: 200, text: 'POST /save body="some data"' }
```

(From `examples/08-request-and-agent.js`.) `https.request` takes the same arguments for `https://` URLs and adds TLS options (`ca`, `rejectUnauthorized`, ...). `http.get(...)` is `request` plus an automatic `req.end()`, for `GET`.

Differences from `fetch` that surprise people:

- A **non-2xx status does not call `'error'`** here either. You look at `res.statusCode`.
- The `'error'` event is mandatory. A request with no `'error'` listener crashes the process when the network fails.
- **A timeout only tells you.** The `timeout` option fires a `'timeout'` event but does **not** stop the request. You must call `req.destroy()` yourself. (`signal: AbortSignal.timeout(ms)` is simpler: it destroys the request for you.)

```text
2. Timeouts: the "timeout" event only TELLS you, you must destroy the request
   timeout event fired (the request is still alive: destroyed = false)
   error event: gave up after 100 ms
3. AbortSignal also works
   AbortError | The operation was aborted
```

> **Remember:** because `req` and `res` are streams, you can `pipeline(fs.createReadStream(file), req)` to upload a big file, or `pipeline(res, fs.createWriteStream(file))` to download one, with backpressure (lesson 11).

## 17. Keep-alive and `http.Agent`

Opening a connection costs DNS, TCP and TLS round trips (section 1). **Keep-alive** reuses one connection for many requests. On the client, an **`http.Agent`** manages a pool of sockets per host: it decides how many connections may be open and whether to keep them after a response.

The real defaults on Node 24 (printed by `examples/08-request-and-agent.js`):

```text
4. Agent defaults on this Node version
   http.globalAgent : { keepAlive: true, maxSockets: Infinity, maxFreeSockets: 256, keepAliveMsecs: 1000, scheduling: 'lifo' }
   new http.Agent() : { keepAlive: false, maxSockets: Infinity, maxFreeSockets: 256, keepAliveMsecs: 1000, scheduling: 'lifo' }
```

Read these two lines carefully, because this is a favourite trap:

- **`http.globalAgent`** (used when you pass no `agent` option) has `keepAlive: true` **since Node 19**. In Node 18 and earlier it was `false`. `https.globalAgent` is the same.
- **A new `new http.Agent()` still has `keepAlive: false`.** If you create your own agent, you must write `new http.Agent({ keepAlive: true })`.
- `maxSockets: Infinity`: no limit on parallel connections per host. `maxFreeSockets: 256` is how many idle sockets the agent leaves open for reuse.
- `scheduling: 'lifo'` means "reuse the idle socket that was used most recently", so a quiet service keeps a few sockets busy and lets the others time out. `'fifo'` rotates through all of them.

What it does in practice: five requests one after another.

```js
async function countConnections(label, agent) {
  connections = 0;
  for (let i = 0; i < 5; i++) await request({ ...target, path: `/n${i}`, agent });
  console.log(`   ${label} -> ${connections} connection(s)`);
  agent.destroy(); // close the idle sockets the agent keeps for reuse
}
```

```text
5. Keep-alive: how many TCP connections do 5 requests in a row use?
   Agent({ keepAlive: true })     -> 1 connection(s)
   Agent({ keepAlive: false })    -> 5 connection(s)
   no agent option (global agent) -> 1 connection(s)
```

`maxSockets` is a pool limit. Four requests at once, with the server counting how many it handles at the same time:

```text
6. maxSockets: a limit on parallel connections to one host
   maxSockets: Infinity       -> server saw at most 4 request(s) at the same time
   maxSockets: 2              -> server saw at most 2 request(s) at the same time
   maxSockets: 1              -> server saw at most 1 request(s) at the same time
```

The extra requests wait in the agent's queue. This is how you protect a backend from being flooded by your client.

How keep-alive looks on the wire: the response says `Connection: keep-alive` and `Keep-Alive: timeout=5`, which means "I will keep this idle connection for about 5 seconds". After that the server closes it (section 18).

> **Common mistake:** "my Node service is slow when calling another service". Often every call opens a new connection (a custom agent without `keepAlive`, or `agent: false`). Reusing connections removes the DNS, TCP and TLS cost from every call.

> **Under the hood:** the other side of keep-alive is a race. If the server closes an idle connection just as the client sends a new request on it, the client sees `ECONNRESET`. Keep the client's idle time shorter than the server's `keepAliveTimeout`. Node's agent reads the `Keep-Alive: timeout=N` hint for this reason: it closes its socket a little before the server would (the `agentKeepAliveTimeoutBuffer` agent option, added in Node 24.7.0, is how much earlier; the default is 1000 ms).

## 18. Server timeouts and limits

A server without timeouts can be held hostage by slow or silent clients (a **Slowloris** attack opens many connections and sends one byte at a time). Node's `http.Server` has several timeouts, and interviewers ask for the numbers.

`examples/09-timeouts-and-shutdown.js` prints the real defaults of Node 24:

```text
A. The defaults of http.createServer() on this Node version
   server.headersTimeout              = 60000
   server.requestTimeout              = 300000
   server.keepAliveTimeout            = 5000
   server.keepAliveTimeoutBuffer      = 1000
   server.timeout                     = 0
   server.maxRequestsPerSocket        = 0
   server.connectionsCheckingInterval = 30000
   http.maxHeaderSize                 = 16384 bytes
```

| Setting | Default | What it limits | What happens when it is exceeded |
|---|---|---|---|
| `headersTimeout` | 60 000 ms (60 s), or `requestTimeout` if that is smaller | Time for the client to send the complete request **headers** | Server answers `408 Request Timeout` (your handler never runs) and closes |
| `requestTimeout` | 300 000 ms (5 min) | Time for the client to send the **whole request** (headers and body) | `408` and close. `0` disables it |
| `keepAliveTimeout` | 5 000 ms (5 s) | How long an **idle** keep-alive connection is kept | Connection closed silently |
| `keepAliveTimeoutBuffer` | 1 000 ms | Extra grace time added on top of `keepAliveTimeout` before an idle socket is closed. **Added in Node 24.6.0**; on older 24.x releases the property does not exist | (see below) |
| `timeout` | 0 (disabled) | Socket inactivity: no bytes in either direction | The socket is destroyed, unless you listen to the `'timeout'` event |
| `maxRequestsPerSocket` | 0 (no limit) | Requests allowed on one keep-alive connection | The last allowed response carries `Connection: close`; a request that still arrives on that connection gets `503` |
| `maxConnections` | not set (no limit) | How many connections the server accepts at the same time | New connections above the limit are dropped |
| `connectionsCheckingInterval` | 30 000 ms | How often the server **checks** for expired header/request timeouts | n/a |
| `http.maxHeaderSize` | 16 384 bytes (16 KiB) | Size of all request headers | `431 Request Header Fields Too Large` |

Three details most people miss:

- **The header/request checks run only every `connectionsCheckingInterval` (30 s by default).** So a `headersTimeout` of 60 s can fire anywhere between 60 s and 90 s after the connection. The example sets the interval to 20 ms to see the timeouts quickly.
- **`server.timeout` is off by default** (it was 2 minutes in very old Node versions; since Node 13 it is `0`). Use `headersTimeout` and `requestTimeout` for protection, and `server.setTimeout(ms, callback)` or `res.setTimeout(...)` if you want a per-response limit.
- The idle socket stays open for `keepAliveTimeout + keepAliveTimeoutBuffer` (6 s by default). The `Keep-Alive: timeout=5` header the server advertises shows only the first part. On a Windows test machine, with `keepAliveTimeout = 150` and `keepAliveTimeoutBuffer = 50`, the idle connection closed after about 230 ms, not after 150 ms. The exact milliseconds vary by machine; the rule "timeout plus buffer" is what the docs state.

The example triggers each timeout with tiny values, using a raw socket as a misbehaving client:

```text
B. headersTimeout: the client sends only part of the headers
   server answered: HTTP/1.1 408 Request Timeout
C. requestTimeout: headers arrive, but the body stops halfway
   server answered: HTTP/1.1 408 Request Timeout
D. keepAliveTimeout: a client keeps a connection open and then says nothing
   first line of the answer: HTTP/1.1 200 OK
   then the server closed the idle connection by itself
E. server.timeout: no bytes at all for a while (a handler that never answers)
   server answered: (nothing, the server just closed the connection)
```

Set them when you create the server, or as properties:

```js
const server = http.createServer({ headersTimeout: 10_000, requestTimeout: 30_000 }, handler);
server.keepAliveTimeout = 65_000; // see the tip below
```

> **Interview tip:** "502 errors appear randomly behind a load balancer." (A **load balancer** is a server that spreads incoming requests over several copies of your app.) Classic cause: the load balancer (for example an AWS ALB, whose default idle timeout is 60 s) keeps connections longer than Node's `keepAliveTimeout` (5 s). Node closes an idle connection just as the balancer reuses it, and the balancer reports a `502`. The fix is to set Node's `keepAliveTimeout` **higher** than the balancer's idle timeout (for example 65 s).

> **Common mistake:** relying on a long `requestTimeout` for slow mobile uploads while another layer (nginx `client_body_timeout`) has its own, shorter limit. Know every timeout between the client and your handler.

## 19. Graceful shutdown

When you deploy, scale down, or press Ctrl+C, the process should stop **without dropping requests that are in progress**. Node gives you three methods:

| Method | What it does |
|---|---|
| `server.close([callback])` | Stops accepting new connections. Since **Node 19** it also closes **idle** keep-alive connections. The callback runs when **all** connections have ended |
| `server.closeIdleConnections()` | Closes connections that are not currently handling a request |
| `server.closeAllConnections()` | Closes everything, including connections with a request in progress (a last resort) |

The trap: after `server.close()`, a connection that was **busy** is not closed when its request finishes. It becomes idle and stays open until the keep-alive timer fires. A client that keeps connections open (a load balancer, a browser, an `http.Agent`) makes `close()` seem to hang:

```text
F. Plain server.close(): the idle keep-alive connection keeps it waiting
   the running request got: answer "done"
   close() waited for the idle timer (more than 700 ms): true
```

(The demo uses an 800 + 200 ms keep-alive timer so that it runs fast. With the defaults, `close()` can wait up to 6 seconds: about 6.3 s with an `http.Agent` client on a Windows test machine. The global `fetch` closes its own idle connections sooner, so the hang is shorter, but a browser or a proxy can keep them open.)

A production-grade shutdown does five things, shown in `gracefulShutdown` from the example:

```js
function gracefulShutdown(server, state, forceAfterMs) {
  state.shuttingDown = true; // 1. from now on, every response says "Connection: close"
  return new Promise((resolve) => {
    const forceTimer = setTimeout(() => {
      state.forced = true;
      server.closeAllConnections(); // 5. after a deadline, cut whatever is left
    }, forceAfterMs);
    server.close(() => {            // 2. stop accepting; the callback runs when everything has ended (4)
      clearTimeout(forceTimer);
      resolve();
    });
    server.closeIdleConnections();  // 3. drop connections that are waiting for nothing
  });
}

// in the request handler:
if (state.shuttingDown) res.setHeader('Connection', 'close'); // "do not reuse this connection"
```

```text
G. gracefulShutdown(): Connection: close + closeIdleConnections()
   the running request got: answer "done"
   shutdown was quick (less than 600 ms): true | forced: false
H. A request that never ends is cut after the deadline
   the stuck client got: no answer, the server cut the connection | forced: true
```

The running request finished normally (`"done"`), the shutdown did not wait for the idle timer, and a request that never ends was cut after the deadline.

In a real service you connect it to signals:

```js
// Snippet: wiring the shutdown to signals (server, state and gracefulShutdown are the ones from above)
let closing = false;
async function stop(signal) {
  if (closing) return;
  closing = true;
  console.log(`${signal} received, shutting down`);
  await gracefulShutdown(server, state, 10_000); // wait at most 10 s for running requests
  // then close the database pool, flush logs, ...
  process.exit(0);
}
process.on('SIGTERM', () => stop('SIGTERM')); // sent by Docker, Kubernetes, systemd
process.on('SIGINT', () => stop('SIGINT'));   // Ctrl+C
```

On Windows, Ctrl+C raises `SIGINT`, but `SIGTERM` is not supported there (you can add a listener, but Windows does not send it), so test your shutdown with Ctrl+C locally.

> **Interview tip:** list the order. (1) Stop taking new work (make the **readiness check**, the URL that the load balancer or Kubernetes polls to decide whether to send you traffic, start failing; stop listening). (2) Finish the work in progress. (3) Release resources (database connections). (4) Exit with a deadline so a stuck request cannot block the deploy.

## 20. Serving files with streams, Content-Length and Range requests

Never read a big file into memory to send it (`fs.readFile` then `res.end(data)`): 100 clients downloading a 500 MB file would need 50 GB. **Stream it.** `pipeline(fs.createReadStream(file), res)` reads in small chunks, waits when the client is slow (backpressure), and destroys both streams if either side fails.

`examples/10-file-streaming.js` serves a small folder. The core:

```js
const stat = await fs.promises.stat(filePath);
res.writeHead(200, {
  'Content-Type': 'application/octet-stream',
  'Accept-Ranges': 'bytes',        // "you may ask me for a part of the file"
  'Content-Length': stat.size,     // we know the size, so say it (writeHead + end would otherwise be chunked)
});
await pipeline(fs.createReadStream(filePath), res);
```

```text
--- whole files
small file, size known
  -> 200 content-length: 26 | body: "abcdefghijklmnopqrstuvwxyz"
big file, streamed
  -> 200 content-length: 200000 | body: 200000 characters
  the server read it from disk in 4 chunks (fs.createReadStream reads 64 KiB at a time)
generated, size unknown
  -> 200 transfer-encoding: chunked | body: "line 1\nline 2\nline 3\n"
```

- A 200 000 byte file is read as 65 536 + 65 536 + 65 536 + 3 392 bytes: 4 chunks. `fs.createReadStream` reads 64 KiB at a time on every platform.
- The generated response has **no `Content-Length`** because the size is unknown until the generator ends, so Node uses `Transfer-Encoding: chunked`. That is the right tool for live data and exports.
- The example sends every file as `application/octet-stream` ("some bytes") to stay short. A real file server picks the `Content-Type` from the file extension (`.html` is `text/html`, `.png` is `image/png`). To make a browser **download** a file instead of showing it, add `Content-Disposition: attachment; filename="report.csv"`.

**Range requests** let a client ask for part of a file: resume a broken download, or let a video player jump to minute 40. The client sends `Range: bytes=0-9`; the server answers `206 Partial Content` with `Content-Range: bytes 0-9/26` and only those bytes. Streams make it easy, because `fs.createReadStream(path, { start, end })` reads just that slice (both ends inclusive):

```text
--- Range requests (resume a download, seek in a video)
first 10 bytes
  -> 206 content-length: 10 | content-range: bytes 0-9/26 | body: "abcdefghij"
from byte 20 to the end
  -> 206 content-length: 6 | content-range: bytes 20-25/26 | body: "uvwxyz"
the last 5 bytes
  -> 206 content-length: 5 | content-range: bytes 21-25/26 | body: "vwxyz"
range past the end
  -> 416 content-length: 0 | content-range: bytes */26 | body: ""
```

The three forms are `bytes=0-9` (a slice), `bytes=20-` (from byte 20 to the end) and `bytes=-5` (the last 5 bytes). A range outside the file gets `416 Range Not Satisfiable` with `Content-Range: bytes */26` (the size). The example's `parseRange` handles a single range; real servers also handle several.

**Path traversal** is the security bug of file servers. A client asks for `/files/../secret.txt` and gets a file outside your folder. The example decodes the path, resolves it against the public folder, and checks that the result is still inside:

```js
const relative = decodeURIComponent(urlPath.slice('/files/'.length));
const filePath = path.resolve(publicDir, relative);
if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep)) {
  plain(res, 403, 'Forbidden');
  return;
}
```

```text
--- errors and attacks
missing file
  -> 404 content-length: 9 | body: "Not found"
path traversal (..%2f)
  -> 403 content-length: 9 | body: "Forbidden"
```

`fetch('/files/../secret.txt')` would not even reach the server with the dots, because the URL class collapses `..` first. The test uses `..%2f` (an encoded slash), which the URL class leaves alone and which `decodeURIComponent` turns back into `../` on the server. Attackers do exactly this.

> **Interview tip:** "How do you serve a 2 GB file with 200 MB of RAM?" Stream it with `pipeline`, set `Content-Length` from `fs.stat`, support `Range`, and put a CDN or nginx in front for static files. Also mention checking the path against traversal.

## 21. HTTPS and TLS basics

**TLS** (Transport Layer Security) encrypts the connection, proves the server is who it claims to be, and detects tampering. **HTTPS** is simply HTTP sent through a TLS connection (step 3 of section 1). Plain HTTP shows passwords, cookies and content to everyone on the path (Wi-Fi owner, ISP).

How a TLS handshake works, in short:

1. The client says hello: supported TLS versions and ciphers, the **host name** it wants (**SNI**, so one IP can host many sites), and the protocols it speaks (**ALPN**: `h2`, `http/1.1`).
2. The server sends its **certificate**.
3. The client checks the certificate: it is signed by a **certificate authority (CA)** the client trusts, the host name matches, and it has not expired.
4. Both sides agree on a shared secret key (with public-key cryptography), and from then on use fast symmetric encryption.

A **certificate** is a signed file that says "this public key belongs to `shop.example.com`". The signature comes from a CA. Operating systems and browsers ship a list of trusted CAs; Node ships its own list too (`tls.rootCertificates`). **Let's Encrypt** gives free certificates for real domains.

A **self-signed certificate** signs itself; no CA vouches for it, so by default nobody trusts it. It is fine for local development and tests, never for production. `examples/11-https-and-http2.js` uses a published test certificate for `localhost`, stored in `examples/_localhost-cert.js` (a test-only key, never use it for anything real).

The server is the HTTP server you already know, plus `key` and `cert`. This is a snippet (it needs the two PEM files next to the script):

```js
// Snippet: an HTTPS server (needs key.pem and cert.pem)
const https = require('node:https');
const fs = require('node:fs');

const server = https.createServer(
  {
    key: fs.readFileSync('key.pem'),   // the private key, keep it secret
    cert: fs.readFileSync('cert.pem'), // the certificate (public)
    minVersion: 'TLSv1.2',
  },
  (req, res) => res.end('secure hello'),
);
server.listen(8443);
```

Both files are in **PEM** format: plain text, with the key or certificate written in base64 between `BEGIN` and `END` lines. To make a throwaway pair for localhost you need `openssl` (it comes with Git for Windows, macOS and Linux):

```bash
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

(In Git Bash on Windows, write `-subj "//CN=localhost"` or set `MSYS_NO_PATHCONV=1`, otherwise the shell rewrites `/CN=localhost` as a file path.) The `subjectAltName` matters: modern clients check the host name against it, not against the CN.

Now what a client sees. Output of the example:

```text
1. TLS defaults on this Node version
   lowest version  : TLSv1.2
   highest version : TLSv1.3
2. An HTTPS server: the same handler as http, plus { key, cert }
3. A client that does NOT trust our certificate
   fetch rejected: fetch failed | reason: DEPTH_ZERO_SELF_SIGNED_CERT
   https.get rejected, code: DEPTH_ZERO_SELF_SIGNED_CERT
4. A client that trusts exactly this certificate (the ca option)
   response: 200 hello over TLS, encrypted=true
   protocol: TLSv1.3 | certificate accepted: true
   certificate subject CN: localhost | issuer CN: localhost (same = self-signed)
   names it is valid for: DNS:localhost, IP Address:127.0.0.1
5. Right certificate, wrong name
   rejected, code: ERR_TLS_CERT_ALTNAME_INVALID
6. Reading the certificate itself: it was issued by itself: true
```

- Without trust, the request fails with `DEPTH_ZERO_SELF_SIGNED_CERT` ("self-signed certificate"). On Node 24 the message even suggests `--use-system-ca`, which makes Node trust the operating system's certificate store as well.
- The right way to trust a private certificate is to **give that one certificate to the client**. In code (snippet, using the `cert.pem` made above):

  ```js
  https.get({ host: 'localhost', port: 8443, path: '/', ca: fs.readFileSync('cert.pem') }, (res) => res.resume());
  ```

  The `ca` option works the same way for `https.request`. For `fetch`, or for code you cannot change, start Node with the environment variable `NODE_EXTRA_CA_CERTS=path/to/cert.pem` (set it as `NODE_EXTRA_CA_CERTS=cert.pem node app.js` in bash, or `$env:NODE_EXTRA_CA_CERTS="cert.pem"; node app.js` in PowerShell).
- **Never** switch verification off to "make the error go away": `rejectUnauthorized: false` or `NODE_TLS_REJECT_UNAUTHORIZED=0`. It removes the whole point of TLS, because anyone can then pretend to be the server.
- A valid certificate for the wrong name is rejected too (`ERR_TLS_CERT_ALTNAME_INVALID`).
- On Node 24 the default accepted versions are `TLSv1.2` to `TLSv1.3` (`tls.DEFAULT_MIN_VERSION` and `tls.DEFAULT_MAX_VERSION`). SSL 3 and TLS 1.0 and 1.1 are off.
- `req.socket.encrypted` is `true` inside an HTTPS handler, and `socket.getProtocol()` tells the negotiated version.

> **Interview tip:** "How does HTTPS work, in one minute?" The server proves its identity with a certificate signed by a CA that the client trusts. The two sides then agree on a shared secret key using public-key cryptography, and all later data is encrypted with that fast shared key and checked for tampering. Follow-up: "Node says `self-signed certificate`. What do you do?" Give the client the right certificate (the `ca` option or `NODE_EXTRA_CA_CERTS`), or use a certificate from a real CA. Never switch verification off in production.

### TLS termination at a proxy

Most production Node apps do **not** run TLS themselves. A reverse proxy or load balancer (nginx, Caddy, an AWS load balancer, Cloudflare) holds the certificate, speaks HTTPS to the browser, and forwards plain HTTP to Node on a private network. This is called **TLS termination**.

```text
Browser --HTTPS--> [ nginx / load balancer / CDN ] --plain HTTP--> Node (port 3000)
       encrypted      TLS ends here: one place to           private network
                      manage certificates and renewals
```

Benefits: certificates and renewals in one place, the proxy also compresses, caches, rate-limits and serves static files, and Node does less work. Consequences you must handle:

- Inside Node, `req.socket.encrypted` is `undefined` and `req.socket.remoteAddress` is the **proxy's** address. The proxy passes the truth in headers such as `X-Forwarded-For` (client IP) and `X-Forwarded-Proto` (`https`).
- **Those headers can be forged by a client** that talks to Node directly. Trust them only when the request really came from your proxy. Frameworks have a setting for this (Express: `app.set('trust proxy', ...)`).
- Redirects and cookies need to know the original scheme. A `Secure` cookie set by an app that thinks it is on plain HTTP is a common bug.
- Also add the `Strict-Transport-Security` header (HSTS) at the proxy, so browsers always use HTTPS for your site.

## 22. HTTP/2 overview

HTTP/2 changes **how the bytes look on the wire**, not what a request means. Methods, status codes and headers are the same.

| | HTTP/1.1 | HTTP/2 | HTTP/3 |
|---|---|---|---|
| Format | Text | Binary frames | Binary frames |
| Requests per connection | One at a time (browsers typically open about 6 connections per host to work around it) | **Many at once on one connection** (multiplexing) | Many at once |
| Header compression | No | Yes (HPACK) | Yes (QPACK) |
| Transport | TCP | TCP | **QUIC over UDP** |
| Problem left | Head-of-line blocking per connection | One lost TCP packet stalls **all** streams | Largely solved: a lost packet stalls only its own stream |
| In browsers | Always possible | Only over TLS (negotiated with ALPN) | Only over TLS |

Two terms from the table. **Head-of-line blocking** means one slow item at the front of a queue holds up everything behind it. **QUIC** is a newer transport protocol built on UDP, with its own streams and built-in encryption, so one lost packet only stalls the stream it belongs to.

In HTTP/2 each request is a **stream** with an id, many streams share one TCP connection, and responses can arrive in any order. Pseudo headers (`:method`, `:path`, `:status`, `:authority`) replace the request line and status line. HTTP/2 also defined server push, but it is almost never used and most browsers dropped it.

Node has `node:http2`. A server created with `http2.createSecureServer({ key, cert }, handler)` gets the same `(req, res)` handler (the "compatibility API"), and the client is `http2.connect(url)`. The example sends three requests at the same time over one connection:

```js
const server = http2.createSecureServer({ key, cert }, (req, res) => {
  res.setHeader('content-type', 'text/plain');
  res.end(`${req.method} ${req.url} over HTTP/${req.httpVersion}`);
});
server.on('session', () => sessions++); // a session = one connection
server.on('stream', () => streams++);   // a stream = one request

const client = http2.connect(`https://localhost:${port}`, { ca: cert });
const stream = client.request({ ':method': 'GET', ':path': '/a' }); // pseudo headers
```

```text
7. HTTP/2: many requests, ONE connection
   protocol chosen by ALPN during the TLS handshake: h2
   answers: GET /a over HTTP/2.0 | GET /b over HTTP/2.0 | GET /c over HTTP/2.0
   the server saw 3 streams on 1 connection
8. Cleartext HTTP/2 ("h2c") also works in Node, but browsers only use HTTP/2 over TLS
   alpnProtocol: h2c | encrypted: false
```

`h2` is the protocol name chosen during the TLS handshake (ALPN). `h2c` is HTTP/2 without TLS; Node can do it, browsers cannot.

In practice, most Node services are behind a proxy or CDN that speaks HTTP/2 (and HTTP/3) to browsers and plain HTTP/1.1 to Node, so you rarely write `node:http2` code. Know the concepts: multiplexing, binary framing, header compression, one connection. Node 24 has no HTTP/3 server in core (the `node:quic` module does not exist on 24.16).

> **Interview tip:** "What does HTTP/2 fix, and what does it not?" It fixes the one-request-at-a-time limit of HTTP/1.1 (head-of-line blocking at the HTTP level) and the cost of many connections. It does not fix head-of-line blocking at the TCP level; that is the reason HTTP/3 moves to QUIC over UDP.

## 23. DNS: `dns.lookup` versus `dns.resolve`

**DNS** turns names into IP addresses (step 1 of section 1). Node has two families of functions in `node:dns`, and **they work in completely different ways**. This is a very common interview question.

| | `dns.lookup(name)` | `dns.resolve4(name)`, `resolve6`, `resolveMx`, `resolveTxt`, ... |
|---|---|---|
| Asks | **The operating system** (the C function `getaddrinfo`) | **DNS servers directly**, over the network (a library called c-ares) |
| Uses the hosts file and OS rules | Yes (`localhost`, `/etc/hosts`, `C:/Windows/System32/drivers/etc/hosts`, search domains) | No |
| Runs on | The **libuv thread pool** (4 threads by default), because `getaddrinfo` blocks | No thread pool: it is asynchronous network I/O |
| Used by `net`, `http`, `https`, `fetch` when you connect to a name | **Yes** | No |
| Returns | One address (or all with `{ all: true }`) | Records of one type (A, AAAA, MX, TXT, SRV, CNAME, NS, ...), with the TTL if you ask |
| Servers it asks | Whatever the OS is configured to use | `dns.getServers()`; change them with `dns.setServers()` or a `new dns.Resolver()` |

The record types: `A` is an IPv4 address, `AAAA` an IPv6 address, `CNAME` an alias for another name, `MX` the mail servers, `TXT` free text (often used to prove you own a domain), `NS` the servers in charge of the name, `SRV` the host and port of a service. **TTL** (time to live) is the number of seconds an answer may be cached.

The "used by" row was checked on Node 24: replacing `dns.lookup` with a spy showed that both `fetch(...)` and `http.get(...)` call it for the host name.

`examples/12-dns.js` works without internet. It starts a tiny **DNS server of its own** on a UDP port of localhost (about 25 lines that build the answer bytes). That server answers every name with the same made-up address and counts the questions it gets, so you can see which function really sends a query:

```js
const resolver = new dns.promises.Resolver({ timeout: 2000, tries: 1 });
resolver.setServers([`127.0.0.1:${udp.address().port}`]); // ask OUR server

await dns.promises.lookup('localhost', { family: 4 }); // the OS answers (hosts file); our server sees nothing
await resolver.resolve4('localhost');                  // a real DNS question goes to our server
```

```text
1. dns.lookup("localhost"): asks the operating system (getaddrinfo, on the thread pool)
   result: { address: '127.0.0.1', family: 4 }
   DNS queries our fake server received: 0 (lookup never touched it)
2. resolver.resolve4("localhost"): the SAME name, but the hosts file is ignored
   result: [ '203.0.113.7' ] (lookup said 127.0.0.1 a moment ago)
   DNS queries our fake server received: 1
3. resolver.resolve4("shop.test"): a name that only DNS knows (c-ares library, no thread pool)
   result: [ '203.0.113.7' ]
   DNS queries our fake server received: 2
4. resolve4 gives only A records, with extra data on request
   with ttl: [ { address: '203.0.113.7', ttl: 60 } ]
5. lookup with { all: true } returns every address the OS knows for the name
   all of them are loopback addresses: true
6. The default order of results from lookup: verbatim
```

Steps 1 and 2 are the point of the example: the same name `localhost` gets **two different answers**, because `lookup` reads the hosts file and `resolve4` asks a DNS server. (The address `203.0.113.7` is from a range reserved for examples.) The example does not call `dns.lookup('shop.test')` on purpose: that would ask your real system resolver, and how fast it fails depends on your network.

What to take from it:

- `lookup('localhost')` works because of the **hosts file**, and a name that only exists in the hosts file is invisible to `resolve*`. `lookup` does reach real DNS too, but only through the DNS servers the operating system is configured to use. Our fake server is not one of them, so `lookup('shop.test')` could not find it: on most networks it fails with `ENOTFOUND`, because the `.test` ending is reserved and never exists in real DNS. `resolve4('shop.test')` worked only because we pointed a `Resolver` at our own server.
- Because `lookup` uses the thread pool (shared with `fs`, `crypto.pbkdf2` and `zlib`), a burst of slow lookups can delay file reads and hashing. This is one reason `dns.resolve*` can be better for a service that does thousands of lookups, and why a DNS cache is common in high-traffic clients. **Node itself does not cache DNS results** (the OS or a local resolver may).
- The result order is `verbatim` by default: the addresses come in the order the resolver returned them, so `localhost` can give `::1` (IPv6) before `127.0.0.1`. If your server only listens on IPv4 and a client tries `::1` first, you get `ECONNREFUSED`. Node 24 helps: `net.autoSelectFamily` is on by default and tries the next address after 250 ms (a "Happy Eyeballs" fallback). You can also call `dns.setDefaultResultOrder('ipv4first')`.
- The callback style (`dns.lookup(name, cb)`) and the promise style (`require('node:dns/promises')` or `dns.promises`) exist for both families.

> **Interview tip:** "Why can a Node app freeze when DNS is slow?" Because `dns.lookup` runs on the 4-thread libuv pool: four slow lookups occupy all threads, and `fs` or `crypto` work queues behind them. Answers: raise `UV_THREADPOOL_SIZE` (set it in the environment before Node starts), cache lookups, or use `dns.resolve*`.

## Summary / Key takeaways
- A request is six steps: DNS, TCP, TLS, HTTP request, HTTP response, close or reuse. Keep-alive removes steps 1 to 3 from later requests. TCP is a stream of bytes with no message boundaries; HTTP is text rules on top of it.
- With `node:http` you build everything yourself: parse `req.url` with `new URL`, read the body as a stream with a size limit and a `try/catch`, send JSON with a correct `Content-Length`, turn all errors into `4xx` or `500` responses in one place, and stream files with `pipeline` (with `Range` support and a path traversal check).
- Know the verbs and codes: `PUT` and `DELETE` are idempotent, `POST` is not, `PATCH` is not guaranteed. `401` means "who are you", `403` means "not allowed". `400` is malformed, `422` is invalid data, `413` is too big, `415` is the wrong type.
- CORS is a browser rule, not server security; answer the `OPTIONS` preflight and echo one allowed origin. Cookies are `Set-Cookie` out and `Cookie` in; use `HttpOnly`, `Secure` and `SameSite`.
- `fetch` does not reject on `404` or `500`; check `res.ok`. It rejects with `TypeError: fetch failed` and the reason in `err.cause`. Always set a timeout with `AbortSignal.timeout`.
- `http.globalAgent` has keep-alive on since Node 19, but `new http.Agent()` does not. Server defaults: `headersTimeout` 60 s, `requestTimeout` 300 s, `keepAliveTimeout` 5 s, `server.timeout` 0. `server.close()` can wait for idle keep-alive connections: send `Connection: close`, call `closeIdleConnections()`, and end with `closeAllConnections()` after a deadline.
- TLS needs a trusted certificate; trust a private one by giving it to the client, never by disabling verification. Production usually terminates TLS at a proxy. HTTP/2 multiplexes requests on one connection.
- `dns.lookup` asks the OS (thread pool, hosts file, used by `http` and `fetch`); `dns.resolve*` asks DNS servers directly.

## Quick check

1. Name the six steps of a web request in order, and say which ones a keep-alive connection skips.
<details><summary>Answer</summary>

DNS lookup, TCP handshake, TLS handshake (https only), HTTP request, HTTP response, close or reuse. A keep-alive connection that is already open skips DNS, TCP and TLS for the next request (DNS may also be cached).

</details>

2. A client calls `socket.write('abc')` and then `socket.write('def')`. How many `'data'` events will the server see?
<details><summary>Answer</summary>

You cannot know: one (`abcdef`), two, or more. TCP is a byte stream with no message boundaries. A protocol must mark the boundaries itself (a newline, a length prefix, or HTTP's `Content-Length`).

</details>

3. In a handler, `req.url` is `/search?q=node&page=2`. How do you get `q` and `page` safely, and why does `req.url === '/search'` fail?
<details><summary>Answer</summary>

`req.url` contains the path **and** the query string. Parse it with `const url = new URL(req.url, 'http://localhost')`, compare `url.pathname === '/search'`, and read `url.searchParams.get('q')` (`'node'`) and `url.searchParams.get('page')` (the string `'2'`, so convert it with `Number`).

</details>

4. Which status code do you send for: (a) a body bigger than your limit, (b) a `Content-Type` you do not accept, (c) broken JSON, (d) valid JSON with an empty required field, (e) a request with no login, (f) a logged-in user without the right role?
<details><summary>Answer</summary>

(a) `413`, (b) `415`, (c) `400`, (d) `422` (or `400` if your API uses one code for all bad input), (e) `401`, (f) `403`.

</details>

5. Is `DELETE` idempotent if the second call returns `404`? What about `PATCH`?
<details><summary>Answer</summary>

Yes, `DELETE` is idempotent. Idempotency is about the **server state** after one or many calls (the item is gone either way), not about the response code. `PATCH` is not guaranteed to be idempotent: `{"done": true}` is, `{"increment": 1}` is not.

</details>

6. `await fetch(url)` resolves for a `500` response. How do you detect the failure, and how do you see why a `fetch` to a closed port failed?
<details><summary>Answer</summary>

Check `res.ok` (or `res.status`). `fetch` only rejects when there was no HTTP response. For a closed port it rejects with `TypeError: fetch failed`, and the real reason is `err.cause.code`, which is `'ECONNREFUSED'`. Also pass `signal: AbortSignal.timeout(ms)` because `fetch` has no short timeout of its own.

</details>

7. What are the keep-alive defaults of `http.globalAgent` and of `new http.Agent()` on Node 24, and what are the default server `headersTimeout`, `requestTimeout`, `keepAliveTimeout` and `timeout`?
<details><summary>Answer</summary>

`http.globalAgent.keepAlive` is `true` (since Node 19); `new http.Agent().keepAlive` is `false`. Server defaults: `headersTimeout` 60 000 ms, `requestTimeout` 300 000 ms, `keepAliveTimeout` 5 000 ms, `timeout` 0 (disabled).

</details>

8. You call `server.close()` during a deploy and the callback does not fire for several seconds although all requests are finished. Why, and what do you do?
<details><summary>Answer</summary>

Clients that use keep-alive leave connections open. A connection that was busy when `close()` ran becomes idle afterwards and stays open until the keep-alive timer (5 s plus 1 s buffer by default). Send `Connection: close` on responses once shutdown starts, call `server.closeIdleConnections()`, and after a deadline call `server.closeAllConnections()`.

</details>

9. Does CORS protect your API from other websites? What is a preflight?
<details><summary>Answer</summary>

No. CORS is enforced only by browsers, and only decides whether a page's JavaScript may **read** a cross-origin response; the request still reaches your server. A preflight is an `OPTIONS` request the browser sends before a "non-simple" request (for example `PUT`, or `Content-Type: application/json`, or an `Authorization` header) to ask which methods and headers are allowed. You answer it with `Access-Control-Allow-*` headers and a `204`.

</details>

10. What is the difference between `dns.lookup` and `dns.resolve4`? Which one does `http.get('http://example.com')` use?
<details><summary>Answer</summary>

`dns.lookup` calls the operating system's `getaddrinfo` on the libuv thread pool and honours the hosts file; `dns.resolve4` sends DNS queries straight to DNS servers with the c-ares library and ignores the hosts file. `http`, `https`, `net` and `fetch` use `dns.lookup`.

</details>

## Try it yourself

### Task 1 (easy): a greeting endpoint
Write an HTTP server with one route: `GET /greet?name=Ada` answers JSON `{ "greeting": "Hello, Ada!" }`. Missing or blank `name` must give `400` with a JSON error. Any other method on `/greet` must give `405` with an `Allow: GET` header. Any other path gives `404`. Start it on port 0 and test the five cases with `fetch`.

<details><summary>Hint</summary>

Parse with `new URL(req.url, 'http://localhost')` and compare `url.pathname`. Write a small `sendJson(res, status, data, headers)` helper first and use it for every response, including the errors. Check the path before the method, and the method before the query.

</details>

<details><summary>Solution</summary>

```js
const http = require('node:http');
const { once } = require('node:events');

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/greet') return sendJson(res, 404, { error: 'not found' });
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' }, { Allow: 'GET' });

  const name = (url.searchParams.get('name') ?? '').trim();
  if (name === '') return sendJson(res, 400, { error: 'query parameter "name" is required' });
  sendJson(res, 200, { greeting: `Hello, ${name}!` });
});

async function main() {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  const show = async (label, path, options) => {
    const res = await fetch(base + path, options);
    const allow = res.headers.get('allow');
    console.log(label.padEnd(24), res.status, allow ? `(Allow: ${allow})` : '', JSON.stringify(await res.json()));
  };
  await show('with a name', '/greet?name=Ada%20Lovelace');
  await show('missing name', '/greet');
  await show('blank name', '/greet?name=%20%20');
  await show('wrong method', '/greet?name=Ada', { method: 'POST' });
  await show('unknown path', '/other');

  server.close();
  server.closeAllConnections();
}

main();
```

Output:

```text
with a name              200  {"greeting":"Hello, Ada Lovelace!"}
missing name             400  {"error":"query parameter \"name\" is required"}
blank name               400  {"error":"query parameter \"name\" is required"}
wrong method             405 (Allow: GET) {"error":"method not allowed"}
unknown path             404  {"error":"not found"}
```

</details>

### Task 2 (medium): a `fetchJson` with timeout and safe retries
Write `fetchJson(url, { retries, timeoutMs, baseDelayMs, ...fetchOptions })`. It must: time out each attempt with `AbortSignal.timeout`; throw an error with `status` and `body` for a non-2xx answer; **retry only idempotent methods** (`GET`, `HEAD`, `PUT`, `DELETE`, `OPTIONS`), and only for a timeout, a network failure, or the statuses `429`, `502`, `503`, `504`; wait longer after each failure (exponential backoff). Test it against a server that answers `503` twice and then `200`.

<details><summary>Hint</summary>

Loop with an `attempt` counter. Inside `try`, call `fetch`; if `!res.ok`, throw a custom `HttpError`. In `catch`, decide with three questions: is the method safe to repeat, is the problem the kind that can go away (timeout name `TimeoutError`, or `TypeError` with a `cause` for network failures, or one of the four statuses), and are retries left? If not, rethrow. Otherwise sleep `baseDelayMs * 2 ** attempt` and continue.

</details>

<details><summary>Solution</summary>

```js
const http = require('node:http');
const { once } = require('node:events');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SAFE_TO_RETRY = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']); // idempotent methods

class HttpError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function fetchJson(url, { retries = 2, timeoutMs = 2000, baseDelayMs = 20, ...options } = {}) {
  const method = (options.method ?? 'GET').toUpperCase();
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new HttpError(res.status, await res.text());
      return await res.json();
    } catch (err) {
      const retryableStatus = err instanceof HttpError && [429, 502, 503, 504].includes(err.status);
      const networkProblem = err.name === 'TimeoutError' || (err.name === 'TypeError' && err.cause);
      const canRetry = SAFE_TO_RETRY.has(method) && (retryableStatus || networkProblem);
      if (!canRetry || attempt >= retries) throw err;
      await sleep(baseDelayMs * 2 ** attempt); // 20 ms, 40 ms, 80 ms ...
    }
  }
}

async function main() {
  let calls = 0;
  const server = http.createServer((req, res) => {
    calls++;
    const reply = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (req.url === '/flaky') return calls < 3 ? reply(503, { error: 'busy' }) : reply(200, { ok: true, calls });
    if (req.url === '/missing') return reply(404, { error: 'no such thing' });
    if (req.url === '/always-down') return reply(503, { error: 'down' });
    if (req.url === '/slow-once') {
      if (calls < 2) return; // the first call is never answered, so the client's timeout fires
      return reply(200, { ok: true, calls });
    }
    reply(200, { ok: true });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  const attempt = async (label, path, options) => {
    calls = 0;
    try {
      console.log(label.padEnd(36), 'result:', JSON.stringify(await fetchJson(base + path, options)), '| server calls:', calls);
    } catch (err) {
      console.log(label.padEnd(36), 'failed:', err.message, '| server calls:', calls);
    }
  };
  await attempt('503, 503, then 200 (GET)', '/flaky');
  await attempt('404 is not retried', '/missing');
  await attempt('always 503, gives up after 2 retries', '/always-down');
  await attempt('first attempt too slow', '/slow-once', { timeoutMs: 500 });
  await attempt('POST is never retried', '/flaky', { method: 'POST' });

  server.close();
  server.closeAllConnections();
  try {
    await fetchJson(base + '/anything', { retries: 1 }); // nobody listens any more
  } catch (err) {
    console.log('server gone'.padEnd(36), 'failed:', err.message, '| cause:', err.cause.code);
  }
}

main();
```

Output:

```text
503, 503, then 200 (GET)             result: {"ok":true,"calls":3} | server calls: 3
404 is not retried                   failed: HTTP 404 | server calls: 1
always 503, gives up after 2 retries failed: HTTP 503 | server calls: 3
first attempt too slow               result: {"ok":true,"calls":2} | server calls: 2
POST is never retried                failed: HTTP 503 | server calls: 1
server gone                          failed: fetch failed | cause: ECONNREFUSED
```

Three details. The server never answers the first `/slow-once` call, so the 500 ms timeout always fires and the retry gets the answer (this makes the output the same on every run). After `server.close()` the port refuses connections, so the last call fails with `ECONNREFUSED` after one retry. In production you would also add random jitter to the delay, honour the `Retry-After` header, and cap the total time.

</details>

### Task 3 (harder): a middleware chain with a rate limiter
Build a tiny framework in the style of Express/Koa: `createApp()` with `app.use(fn)`, where `fn(req, res, next)` may be `async`, and `await next()` runs the rest of the chain. Errors thrown by any middleware must become a `500` JSON response; if nobody answered, respond `404`. Then write three middleware: `requestId()` (sets an `X-Request-Id` header), `logger(lines)` (records `METHOD URL -> status` after the rest of the chain ran) and `rateLimit({ limit, windowMs, keyOf })` that answers `429` with `Retry-After` after `limit` requests per key per window, and does **not** call `next()` in that case. Test: 5 quick requests with a limit of 3, a second client that is not limited, and the same client again after the window.

<details><summary>Hint</summary>

Keep an array `stack` of functions. `dispatch(i)` runs `stack[i]` with a `next` that calls `dispatch(i + 1)`; wrap the call in `Promise.resolve().then(...)` so synchronous throws become rejections too. Reject if `next()` is called twice (compare `i` with the highest index already run). For the limiter, use a `Map` from key to `{ count, resetAt }`, start a new entry when `resetAt` has passed, and compute `Retry-After` as `Math.ceil((resetAt - now) / 1000)`.

</details>

<details><summary>Solution</summary>

```js
const http = require('node:http');
const crypto = require('node:crypto');
const { once } = require('node:events');

// ---- the tiny framework ----
function createApp() {
  const stack = [];

  const notFound = (res) => {
    if (!res.writableEnded) {
      res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'not found' }));
    }
  };

  async function handle(req, res) {
    let last = -1;
    function dispatch(i) {
      if (i <= last) return Promise.reject(new Error('next() called twice'));
      last = i;
      const middleware = stack[i];
      if (!middleware) return Promise.resolve().then(() => notFound(res)); // end of the chain: nobody answered
      return Promise.resolve().then(() => middleware(req, res, () => dispatch(i + 1))); // sync throws become rejections
    }
    try {
      await dispatch(0);
      notFound(res); // safety net: a middleware that neither answered nor called next()
    } catch (err) {
      console.log('  (log) error:', err.message);
      if (res.headersSent) res.destroy();
      else res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Internal Server Error' }));
    }
  }

  return {
    use(fn) {
      stack.push(fn);
      return this;
    },
    createServer: () => http.createServer(handle),
  };
}

// ---- middleware ----
function requestId() {
  return (req, res, next) => {
    res.setHeader('X-Request-Id', crypto.randomUUID());
    return next();
  };
}

function logger(lines) {
  return async (req, res, next) => {
    await next(); // run everything after us first ...
    lines.push(`${req.method} ${req.url} -> ${res.statusCode}`); // ... then log the final status
  };
}

function rateLimit({ limit, windowMs, keyOf = (req) => req.socket.remoteAddress }) {
  const hits = new Map(); // key -> { count, resetAt }
  return (req, res, next) => {
    const now = Date.now();
    const key = keyOf(req);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - entry.count));
    if (entry.count > limit) {
      res.setHeader('Retry-After', Math.max(1, Math.ceil((entry.resetAt - now) / 1000)));
      res.writeHead(429, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'too many requests' }));
      return; // do NOT call next(): the chain stops here
    }
    return next();
  };
}

// ---- try it ----
async function main() {
  const lines = [];
  const app = createApp()
    .use(logger(lines))
    .use(requestId())
    .use(rateLimit({ limit: 3, windowMs: 1000, keyOf: (req) => req.headers['x-client'] ?? 'anonymous' }))
    .use((req, res, next) => {
      if (req.url === '/boom') throw new Error('handler bug');
      if (req.url === '/hello') return res.writeHead(200, { 'Content-Type': 'text/plain' }).end('hello');
      return next(); // not ours: let the end of the chain answer 404
    });

  const server = app.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  const hit = async (path, client) => {
    const res = await fetch(base + path, { headers: client ? { 'X-Client': client } : {} });
    await res.text();
    return `${res.status}${res.headers.has('retry-after') ? ` (Retry-After: ${res.headers.get('retry-after')})` : ''}`;
  };

  const first = [];
  for (let i = 0; i < 5; i++) first.push(await hit('/hello', 'alice'));
  console.log('alice, 5 quick requests :', first.join(', '));
  console.log('bob, 1 request          :', await hit('/hello', 'bob'));
  await new Promise((resolve) => setTimeout(resolve, 1100)); // wait until the 1000 ms window is over
  console.log('alice after the window  :', await hit('/hello', 'alice'));
  console.log('a handler that throws   :', await hit('/boom', 'carol'));
  console.log('nobody answers          :', await hit('/nothing', 'dave'));
  const idRes = await fetch(base + '/hello', { headers: { 'X-Client': 'erin' } });
  console.log('has X-Request-Id        :', /^[0-9a-f-]{36}$/.test(idRes.headers.get('x-request-id')));
  await idRes.text();
  console.log('logger saw the 404      :', lines.includes('GET /nothing -> 404'));
  console.log('log lines               :', lines.length, '| last:', lines.at(-1));

  server.close();
  server.closeAllConnections();
}

main();
```

Output:

```text
alice, 5 quick requests : 200, 200, 200, 429 (Retry-After: 1), 429 (Retry-After: 1)
bob, 1 request          : 200
alice after the window  : 200
  (log) error: handler bug
a handler that throws   : 500
nobody answers          : 404
has X-Request-Id        : true
logger saw the 404      : true
log lines               : 9 | last: GET /hello -> 200
```

The log has 9 lines because the request that threw skipped the line after `await next()` (the exception passed through the logger). Use `try/finally` in the logger if you want those too. This "onion" structure (code before `next()`, then after it) is exactly how Koa and Express middleware work, and it is a favourite live-coding task.

</details>

## Where to go next
- Next lesson: [13. Real-Time: WebSockets, Server-Sent Events and Polling](../13-realtime-websockets-sse/README.md). It starts from a plain HTTP connection: a WebSocket begins as an HTTP request with an `Upgrade` header and a `101 Switching Protocols` answer, and Server-Sent Events are a long-lived chunked response, which you now know how to write.
- Practise this topic in the interview rounds: [round 1 screening questions](../../rounds/round-1-screening/questions.md) for methods, status codes and "what happens when you type a URL", [round 2 core questions](../../rounds/round-2-core/questions.md) for `fetch` errors, keep-alive, timeouts, CORS and cookies, [round 3 coding](../../rounds/round-3-coding/questions.md) for routers, middleware and rate limiters, [round 4 advanced](../../rounds/round-4-advanced/questions.md) for graceful shutdown, TLS termination and HTTP/2, and [round 5 system design](../../rounds/round-5-system-design/questions.md) for REST API design, retries and idempotency keys.
- Run all the examples of this lesson at once: `node scripts/check-examples.js 12-http-and-networking --verbose`.
