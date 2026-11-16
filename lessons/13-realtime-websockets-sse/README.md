# 13. Real-Time: WebSockets, Server-Sent Events and Polling

> Level: Intermediate   Time: about 150 minutes   Node: 24 (notes where older versions differ)

[Previous: 12. HTTP and Networking with Core Modules](../12-http-and-networking/README.md) | [All lessons](../../README.md) | [Next: 14. Error Handling and Debugging](../14-error-handling-and-debugging/README.md)

## What you will learn
- Why plain HTTP cannot push data, and the four ways around it: short polling, long polling, Server-Sent Events and WebSockets.
- How to build a Server-Sent Events (SSE) endpoint with `node:http` and read it with `fetch` streaming, including ids, `Last-Event-ID` resume and heartbeats.
- How the WebSocket protocol works: the Upgrade handshake, the accept key, frames, opcodes, masking, ping/pong and close codes.
- How to write a WebSocket server with core modules only, and test it with the built-in `WebSocket` client.
- Production patterns: heartbeats, rooms, authentication, reconnection with backoff, backpressure.
- What the `ws` library and Socket.IO add, and what they cost.
- How to scale WebSockets: sticky sessions, a pub/sub backplane, connection limits, proxy timeouts, graceful shutdown.
- How to choose the right technique and answer the usual interview questions, including the deep follow-ups.

All examples run from the repo root with plain `node` and need no npm packages. Examples 05 to 12 use the global `WebSocket` client, so they need Node 22 or newer (section 9 has the version history). Third-party code (`ws`, Socket.IO, Redis) appears only as labelled snippets.

## 1. The problem: HTTP only answers questions

HTTP is a question and answer protocol. The client asks, the server answers, and then the conversation is over. The server can never start talking by itself.

Analogy: HTTP is a mailbox. You send a letter and wait for a reply. A phone call is different: both sides can speak at any time.

Many features need the "phone call": chat, live scores, notifications, progress bars, stock prices, multiplayer games, collaborative editing. There are four common answers:

| Technique | Idea in one line |
|---|---|
| Short polling | The client asks "anything new?" every few seconds. |
| Long polling | The client asks, and the server waits to answer until it has news. |
| Server-Sent Events (SSE) | The client opens one request, and the server keeps writing to it. |
| WebSocket | The connection is upgraded to a two-way channel. Both sides send whenever they want. |

The rest of this lesson builds each one from the ground up. The full comparison table and a decision guide are in section 17.

Words used in this lesson:

| Word | Plain meaning |
|---|---|
| Connection | A link between two programs over TCP (the reliable, ordered stream of bytes that HTTP is built on). It stays open until one side closes it or the network breaks. |
| Socket | Your program's handle on a connection. In Node it is a `net.Socket`. |
| Push | The server sends data without the client asking first. |
| Message and frame | A message is what your app sends. A frame is the small packet that carries it on the wire (section 8). |
| Heartbeat | A tiny message sent on a timer to prove the connection is still alive (section 10). |
| Backplane | A shared channel that connects several server processes (section 16). |
| File descriptor | The number the operating system gives to every open file or socket. Each connection uses one. |

The example files live in `lessons/13-realtime-websockets-sse/examples/`. Files that start with `_` are helpers that other examples use:

| File | What it is |
|---|---|
| `_mini-ws.js` | A careful WebSocket server built with core modules (section 9). |
| `_test-client.js` | A wrapper around the global `WebSocket` so examples can say "send, then wait for the reply". |
| `_sse-client.js` | A parser for the SSE text format, used with `fetch` (section 4). |

## 2. Short polling

**What it is.** The client sends a normal request on a timer, over and over. Each answer comes back at once, with news or without.

**Why it exists.** It needs nothing new: any server, any proxy, any browser. It is the simplest thing that works.

Example: [01-polling.js](examples/01-polling.js). The client side (trimmed):

```js
async function shortPolling(base) {
  let requests = 0;
  while (true) {
    requests++;
    const { done } = await (await fetch(`${base}/status`)).json();
    console.log(`request ${requests}: done = ${done}`);
    if (done) break;
    await sleep(30);
  }
  console.log(`short polling used ${requests} requests, ${requests - 1} of them brought no news`);
}
```

The server pretends a background job finishes on the 4th check. Output of the first half of the example:

```text
--- short polling: ask every 30 ms ---
request 1: done = false
request 2: done = false
request 3: done = false
request 4: done = true
short polling used 4 requests, 3 of them brought no news
```

Three of four requests were wasted. That is the cost: with 10,000 users asking every 5 seconds, your server answers 2,000 requests per second, almost all of them with "nothing new". Also, news can be up to one full interval late.

> **Common mistake:** using `setInterval` for polling. If a request takes longer than the interval, requests pile up. Use a loop that waits for the answer, then sleeps (as above), so there is never more than one request in flight.

Short polling is still the right choice when updates are rare (a "your export is ready" check) or when you cannot use anything else.

## 3. Long polling

**What it is.** The client sends a request. If the server has no news, it does not answer. It keeps the request open ("parks" it) until news arrives or a timeout passes. Then the client immediately asks again.

**Why it exists.** News arrives almost instantly, and there are no empty answers. It still works with plain HTTP.

Same file, [01-polling.js](examples/01-polling.js). The server side (trimmed):

```js
if (url.pathname === '/poll') {
  // ?since=N means "I already have N messages".
  const since = Number(url.searchParams.get('since'));
  const parked = {
    answer() {
      clearTimeout(parked.timer);
      waiting.delete(parked);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(messages.slice(since)));
    },
  };
  if (messages.length > since) return parked.answer(); // news already waiting
  waiting.add(parked); // nothing yet: keep the request open
  parked.timer = setTimeout(() => {
    waiting.delete(parked);
    res.statusCode = 204; // "no content": nothing happened, ask again
    res.end();
  }, LONG_POLL_TIMEOUT_MS);
  res.on('close', () => { // the client went away (or we answered): clean up
    clearTimeout(parked.timer);
    waiting.delete(parked);
  });
  return;
}
```

When `publish()` is called, it runs `parked.answer()` for everybody who is waiting. The demo publishes the first message as soon as a request is parked, lets one request run into the 250 ms timeout, and then publishes the second message. Output of the second half:

```text
--- long polling: the server holds each request ---
request 1: 200 ["first news"]
request 2: 204 (nothing happened, ask again at once)
request 3: 200 ["second news"]
long polling used 3 requests for 2 messages
```

Things to get right:
- **A cursor** (`since=N`, or a last id). Between one answer and the next request there is a gap. Without a cursor, a message published in that gap is lost.
- **A timeout shorter than every proxy and load balancer timeout** in front of you (see section 16). 20 to 30 seconds is typical. On timeout, answer with `204` and let the client ask again.
- **Cleanup on `res.on('close')`.** Clients leave all the time.

The cost: one open request per user, and a full set of HTTP headers on every round trip. It is a fine fallback, and it is what Socket.IO uses first (section 15).

> **Interview tip:** "Long polling or SSE?" Long polling answers each request once, so every message costs a new request with full headers and a gap you must cover with a cursor. SSE keeps one response open for many messages and the browser reconnects for you. Choose long polling only when you cannot use anything else.

## 4. Server-Sent Events (SSE)

**What it is.** One HTTP request that never ends. The response has `Content-Type: text/event-stream`, and the server writes small text messages to it whenever it likes. Data flows in one direction only: server to client.

**Why it exists.** Most "real-time" features are really "the server needs to tell the page something" (notifications, feeds, progress, dashboards). SSE does exactly that over plain HTTP. Browsers have a built-in `EventSource` class that also reconnects by itself.

### The wire format

A message is a few lines of `field: value`, ended by a blank line.

| Line | Meaning |
|---|---|
| `data: text` | The payload. Several `data:` lines in one message are joined with `\n`. |
| `event: name` | The event name. Without it, the name is `message`. |
| `id: 42` | Sets the "last event id". On reconnect the browser sends it back (section 5). |
| `retry: 3000` | Tells the browser how many milliseconds to wait before reconnecting. |
| `: text` | A comment. Ignored by clients. Used as a heartbeat. |

Example: [02-sse-basic.js](examples/02-sse-basic.js). The server (trimmed):

```js
// Write one SSE message. A message is a few "field: value" lines ended by a blank line.
function sendEvent(res, { event, id, data }) {
  let text = '';
  if (event) text += `event: ${event}\n`;
  if (id !== undefined) text += `id: ${id}\n`;
  for (const line of String(data).split('\n')) text += `data: ${line}\n`; // one data: per line
  res.write(`${text}\n`); // the blank line ends the message
}

const server = http.createServer(async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', // this header makes it an event stream
    'Cache-Control': 'no-cache', // never cache a live stream
  });
  res.flushHeaders(); // send the headers now, do not wait for the first write

  res.write('retry: 3000\n\n');
  sendEvent(res, { event: 'welcome', id: 1, data: JSON.stringify({ hello: 'client' }) });
  sendEvent(res, { id: 2, data: 'a message with no event name' });
  // ... more events, a ': heartbeat' comment, then res.end()
});
```

"Keeping the connection open" simply means: write with `res.write()` and do not call `res.end()` until you are done.

The client reads the response body as a stream. [`_sse-client.js`](examples/_sse-client.js) turns the stream into messages. Its core is short:

```js
async function* readEvents(response) {
  const decoder = new TextDecoder(); // stream: true keeps half a character between chunks
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      yield parseBlock(block); // split the block into lines and read the fields
    }
  }
}
```

Network chunks do not match message boundaries, so we keep a buffer and cut it at every blank line. Output of the example (it first prints the raw bytes, then the parsed messages):

```text
status: 200
content-type: text/event-stream
cache-control: no-cache
transfer-encoding: chunked
--- raw stream ---
| retry: 3000
|
| event: welcome
| id: 1
| data: {"hello":"client"}
|
| id: 2
| data: a message with no event name
|
| id: 3
| data: line one
| data: line two
|
| : heartbeat
|
| event: bye
| id: 4
| data: closing the stream
--- parsed ---
no data. retry = 3000 comments = []
event=welcome id=1 data="{\"hello\":\"client\"}"
event=message id=2 data="a message with no event name"
event=message id=3 data="line one\nline two"
no data. retry = null comments = ["heartbeat"]
event=bye id=4 data="closing the stream"
stream ended
```

Why it works: HTTP/1.1 can send a response in chunks (`transfer-encoding: chunked`) without knowing the total size. The server simply never sends the final chunk until it is done.

### Browser side

In a browser you do not parse anything yourself:

```js
// Browser code, not run here. Node 24 has no global EventSource unless you pass
// --experimental-eventsource (it is still experimental)
const source = new EventSource('/events');
source.onmessage = (e) => console.log('message', e.data); // only events WITHOUT an event: name
source.addEventListener('welcome', (e) => console.log('welcome', e.data)); // named events need this
source.onerror = () => console.log('connection lost, the browser will retry by itself');
```

> **Under the hood:** `EventSource` can only send GET requests and cannot set headers. If you need a POST body or an `Authorization` header, use `fetch` streaming, as in our example, and do the reconnecting yourself.

Gotchas interviewers like:
- `data:` cannot contain a raw newline. `JSON.stringify` output has none, so JSON is the usual payload. SSE is text only (UTF-8). Binary data would have to be base64.
- `onmessage` only receives events that have no `event:` name. Named events need `addEventListener('name', ...)`.
- Over HTTP/1.1, browsers allow only about 6 connections per host. Six tabs with one SSE stream each can use them all up. HTTP/2 shares one connection and removes the problem.
- Per the HTML standard, a response with a status other than 200, or with the wrong `Content-Type`, makes `EventSource` give up for good (its `readyState` becomes `CLOSED`). That is also how a server says "stop reconnecting": answer with `204`. A dropped connection (a network error) is different: the browser retries. (Browser behaviour, not tested here: check the current MDN page before you rely on edge cases.)
- Node's own timeouts do not cut a healthy stream. `server.timeout` is `0` (off) by default, and `keepAliveTimeout` and `requestTimeout` cover idle sockets and the incoming request, not a response that is being written. (We checked on Node 24 with both set to 50 ms: a stream stayed open for 400 ms.) Proxies in front of Node are the real danger (section 16).

> **Interview tip:** "How would you stream a long text answer to the page, word by word?" SSE is a strong answer: the traffic is one-way, it works over normal HTTP (auth, logging, HTTP/2), and with `fetch` streaming you can use POST and an `Authorization` header. You only need WebSockets if the client must also send many messages on the same channel.

## 5. Making SSE reliable: ids, resume, heartbeat, cleanup

Real networks drop connections. Four small habits make an SSE endpoint safe. Example: [03-sse-resume.js](examples/03-sse-resume.js).

1. **Give every event an `id`.** When `EventSource` reconnects it sends the last id it saw in a `Last-Event-ID` request header.
2. **Replay what was missed.** The server keeps a short history and, on connect, first sends every event newer than `Last-Event-ID`.
3. **Send a heartbeat.** A comment line (`: heartbeat`) every 15 to 30 seconds keeps proxies from closing a silent connection and lets you notice dead clients (a write to a dead connection eventually fails).
4. **Clean up on `close`.** Remove the client from your list and clear its timer, or every visitor leaks memory.

The server (trimmed):

```js
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  res.flushHeaders();

  const lastId = Number(req.headers['last-event-id'] || 0);
  for (const event of history) {
    if (event.id > lastId) write(res, event); // replay what the client missed
  }

  clients.add(res);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25);

  res.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
});
```

The script reads three events, drops the connection, publishes two more, then reconnects with `Last-Event-ID: 3`:

```text
server: client connected (Last-Event-ID: none)
client: got id=1 data=one
client: got id=2 data=two
client: got id=3 data=three
client: connection lost after id 3. heartbeats seen: yes
server: client left, 0 connected
server: published four and five while nobody was listening
server: client connected (Last-Event-ID: 3)
client: got id=4 data=four
client: got id=5 data=five
client: got id=6 data=six
server: client left, 0 connected
```

Events four and five were published while nobody was connected. They are delivered because of the id and the history.

> **Interview tip:** the question "what if the client misses messages?" is really about ids. A strong answer: give each message a monotonically increasing id, keep a bounded history (or read it from a database or log), and let the client resume from its last id. The same idea works for WebSockets (section 13).

Proxy trap: some proxies buffer responses until they are "full", which delays your events forever. For nginx, set `proxy_buffering off;` or send the header `X-Accel-Buffering: no`. Also avoid response compression on event streams unless the compressor flushes after every message.

Always use `res.on('close')` to detect a client that left. The request's `'close'` event means "the request is finished", and for a POST whose body you read, it fired right after the body had been read, while the client was still connected (we measured this on Node 24). `res.on('close')` is the one that means "the connection is gone".

## 6. WebSockets: the idea

**What it is.** A WebSocket is a two-way channel over one long-lived TCP connection. It starts as a normal HTTP request, then both sides agree to "upgrade" to the WebSocket protocol. After that, either side can send a message at any time.

**Why it exists.** Polling and SSE are one-way or wasteful. Chat, games and collaborative editing need many small messages in both directions with low delay and low overhead (a small frame header instead of full HTTP headers).

Key facts:
- URLs start with `ws://` (plain) or `wss://` (over TLS). Use `wss://` in production, the same way you use `https://`.
- You send **messages** (text or binary), not requests. There is no status code and no URL per message. Message boundaries are kept: if you send two messages, the other side receives two messages (raw TCP would give you a stream of bytes).
- Within one connection, messages arrive in the order they were sent (it is TCP underneath).
- The browser API does **not** reconnect by itself, and does **not** tell you about lost connections quickly. You build both (sections 10 and 13).
- The browser API gives you no way to set headers on the handshake (section 12).

> **Interview tip:** "What is the difference between HTTP and WebSocket?" HTTP is request and response: every request carries full headers and the server cannot start a message. A WebSocket pays for one HTTP handshake, then keeps the TCP connection open and exchanges small frames in both directions, so the server can push at any time.

## 7. The handshake

**What it is.** The upgrade is a normal HTTP/1.1 `GET` request with special headers. If the server agrees, it answers `101 Switching Protocols`, and from that moment the same TCP connection carries WebSocket frames instead of HTTP.

```text
GET /chat HTTP/1.1
Host: example.test
Connection: Upgrade
Upgrade: websocket
Sec-WebSocket-Version: 13
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==

HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

**The accept key.** The client sends a random 16 byte value, base64 encoded, in `Sec-WebSocket-Key`. The server must answer with:

```text
Sec-WebSocket-Accept = base64( sha1( Sec-WebSocket-Key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11" ) )
```

The long string is a fixed value from the standard (RFC 6455), called the magic GUID. In Node:

```js
function acceptKey(clientKey) {
  return crypto.createHash('sha1').update(clientKey + GUID).digest('base64');
}
```

Example: [04-handshake-and-frames.js](examples/04-handshake-and-frames.js). Part 1 follows the calculation with the sample key from the RFC. Part 2 runs a real handshake with `node:http` only:

```text
=== Part 1: Sec-WebSocket-Accept ===
key + GUID  : dGhlIHNhbXBsZSBub25jZQ==258EAFA5-E914-47DA-95CA-C5AB0DC85B11
sha1 (hex)  : b37a4f2cc0624f1690f64606cf385945b2bec4ea
base64      : s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
matches RFC : true

=== Part 2: the handshake over raw HTTP ===
server saw: GET /chat HTTP/1.1
  connection: Upgrade
  upgrade: websocket
  sec-websocket-version: 13
  sec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==
client got: HTTP/1.1 101 Switching Protocols
  sec-websocket-accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
  accept value is correct: true
```

(A real client makes a new random key for each connection. The example uses the fixed RFC key so the output is the same every time.)

In Node, the `http.Server` emits an `'upgrade'` event with `(req, socket, head)`. `socket` is the raw TCP socket and `head` holds any bytes that arrived right after the headers. If you do not listen to `'upgrade'`, Node treats the request as a normal HTTP request: your `'request'` handler runs and the client gets an ordinary answer instead of `101`, so the WebSocket connection fails (we checked this on Node 24).

Other headers you will meet:

| Header | Who sends it | Meaning |
|---|---|---|
| `Origin` | Browsers (always) | The page that opened the socket. Check it on the server (section 12). Non-browser clients can send anything. |
| `Sec-WebSocket-Protocol` | Client asks, server picks one | An optional sub-protocol name, for example `chat.v2`, so both sides agree on the message format. |
| `Sec-WebSocket-Extensions` | Client offers, server accepts | For example `permessage-deflate` (compression). It costs CPU and memory per connection. |

If the server refuses the upgrade (answers `401`, `403`, `503` instead of `101`), a browser only reports a failed connection (close code 1006). It does not let the page read the status code. (Browser behaviour, not tested here.) Plan error reporting accordingly.

> **Interview tip:** why the accept key at all? It proves that the server really understands WebSocket. An old HTTP server or a cache cannot produce the right answer by accident. It is **not** a security feature and it does not authenticate anyone.

> **Common mistake:** forgetting to end your side of the socket. An `http.Server` allows half-open connections: when the client closes its side, your side stays open until you call `socket.end()`. The examples do `socket.on('end', () => socket.end())`. Without it, the socket's `'close'` event never fires and the callback of `server.close()` is never called.

## 8. Frames, opcodes, masking and close codes

After the handshake, data travels in **frames**. A message is one frame, or several frames when it is fragmented.

```text
byte 0:  F R R R O O O O     F      = FIN, 1 means "last frame of this message"
         I S S S P P P P     RSV    = reserved bits, must be 0 (unless an extension is negotiated)
         N V V V C C C C     OPCODE = the kind of frame (4 bits)
byte 1:  M L L L L L L L     M      = MASK, 1 means the payload is masked
                             L      = payload length, 7 bits: 0-125 is the length itself,
                                      126 means "the real length is in the next 2 bytes",
                                      127 means "the real length is in the next 8 bytes"
then:    extended length (0, 2 or 8 bytes)
then:    masking key (4 bytes, only when M = 1)
then:    payload
```

**Opcodes**

| Opcode | Name | Meaning |
|---|---|---|
| `0x0` | continuation | Next piece of a fragmented message |
| `0x1` | text | UTF-8 text message |
| `0x2` | binary | Binary message |
| `0x8` | close | Start or answer the closing handshake |
| `0x9` | ping | "Are you there?" |
| `0xA` | pong | Answer to ping (send back the same payload) |

Control frames (close, ping, pong) have a payload of at most 125 bytes and are never fragmented. A ping can arrive in the middle of a fragmented message, so a decoder must handle it.

**Masking.** Every frame sent by a **client** must be masked. Every frame sent by a **server** must not be. The client picks a random 4 byte key and XORs each payload byte with `key[i % 4]`. Doing the same XOR again gives the original bytes back, which is how the server decodes. A server must close the connection if it receives an unmasked client frame (it may send close code 1002 first).

Masking is **not encryption** (the key is sent right next to the data). Its job is to stop a buggy proxy from mistaking attacker-chosen frame bytes for an HTTP request (that would let an attacker poison a shared cache with a fake response). Encryption comes from `wss://`.

Part 3 of [04-handshake-and-frames.js](examples/04-handshake-and-frames.js) builds and reads real frames, including the masked "Hello" example from the RFC:

```text
=== Part 3: frames ===
server text "Hi" : 81 02 48 69
  byte 0 = 0x81 = 1000 0001 -> fin=1, opcode=1 (text)
  byte 1 = 0x02 = 0000 0010 -> mask=0, length=2

client text "Hello": 81 85 37 fa 21 3d 7f 9f 4d 51 58
  decoded         : fin=1 opcode=TEXT masked=1 payload="Hello"
  rebuilt by us   : 81 85 37 fa 21 3d 7f 9f 4d 51 58 (identical)

masking "Hello" once : 7f 9f 4d 51 58
masking it again     : 48 65 6c 6c 6f = "Hello"

payload size -> header bytes (server) / (client, with the 4 byte mask key)
      5 -> 2 / 6
    125 -> 2 / 6
    126 -> 4 / 8
  65535 -> 4 / 8
  65536 -> 10 / 14

ping "x"          : 89 01 78
pong "x"          : 8a 01 78
close 1000 "bye"  : 88 05 03 e8 62 79 65 (03 e8 is 1000 in two bytes)

fragment 1: fin=0 opcode=TEXT masked=1 payload="Hel"
fragment 2: fin=1 opcode=CONTINUATION masked=1 payload="lo"

half a frame decodes to: null
```

Read the first line: `81 02 48 69`. `0x81` is FIN plus opcode 1 (text). `0x02` is "no mask, length 2". `48 69` is "Hi" in ASCII. The header costs 2 bytes, compared with hundreds of bytes for an HTTP request.

The last line matters: TCP is a stream of bytes, not a list of frames. A frame can arrive in pieces, or two frames can arrive in one chunk. A decoder must say "I need more bytes" (`null` here) and keep what it has.

**Close codes.** A close frame carries a 2 byte code and an optional reason (at most 123 bytes of UTF-8).

| Code | Meaning |
|---|---|
| 1000 | Normal closure |
| 1001 | Going away (server shutting down, page closed) |
| 1002 | Protocol error |
| 1003 | Unsupported data (for example binary when only text is accepted) |
| 1005 | No status code was given. Never sent on the wire, only reported locally |
| 1006 | Connection lost without a close frame. Never sent on the wire, only reported locally |
| 1007 | Invalid data (for example text that is not valid UTF-8) |
| 1008 | Policy violation |
| 1009 | Message too big |
| 1011 | Server error |
| 1012, 1013 | Service restart, try again later (registered later, useful for deploys and overload) |
| 3000-3999 | Reserved for libraries and frameworks |
| 4000-4999 | Free for your application (for example 4401 for "not logged in") |

> **Remember:** 1005 and 1006 are what you *see*, not what anybody *sends*. 1006 is the one you get when the network dies, the server crashes, or a proxy cuts the connection.

## 9. A WebSocket server with core modules only

**What it is.** A WebSocket server is an ordinary HTTP server plus three jobs: answer the Upgrade request, read frames from the socket, and write frames to it. Node 24 has a WebSocket **client** but no WebSocket **server**. Everything you need is in modules you already know: `http` for the handshake, `crypto` for the accept key, `Buffer` for frames.

**Why build one.** To know what `ws` and Socket.IO do for you. It is also a classic interview question: "could you write a WebSocket server without a library?"

The whole server is one short file: [05-ws-echo-broadcast.js](examples/05-ws-echo-broadcast.js). Here are its parts.

**1. Encode a frame to send.** Server frames are never masked. The length is 1 byte for small messages, or `126` plus 2 bytes. (This tiny server stops at 65535 bytes.)

```js
function encode(opcode, payload) {
  const length = payload.length;
  if (length > 65535) throw new Error('this tiny server sends at most 65535 bytes per message');
  const header = length < 126
    ? Buffer.from([0x80 | opcode, length]) // 0x80 = FIN: the whole message is in this one frame
    : Buffer.from([0x80 | opcode, 126, length >> 8, length & 0xff]); // 126 = "length is in the next 2 bytes"
  return Buffer.concat([header, payload]);
}
```

**2. Decode a frame that arrived.** Client frames are masked, so after the length comes a 4 byte key, and each payload byte is XORed with it. If the buffer holds only part of a frame, return `null` ("wait for more bytes").

```js
function decode(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  let length = buffer[1] & 0x7f; // the top bit of byte 1 is the mask bit (always 1 from a client)
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    throw new Error('this tiny server does not accept messages above 65535 bytes');
  }
  if (buffer.length < offset + 4 + length) return null; // 4 = the masking key
  const mask = buffer.subarray(offset, offset + 4);
  const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length));
  for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]; // unmask
  return { opcode, payload, size: offset + 4 + length };
}
```

**3. The handshake, on the `'upgrade'` event.** The event hands us the raw TCP socket. We write the `101` answer ourselves, and from then on that socket speaks WebSocket.

```js
server.on('upgrade', (req, socket, head) => {
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  clients.add(socket);
  // ... register the data, end, error and close handlers (below)
});
```

**4. Keep the bytes, cut frames off the front.** TCP may deliver half a frame, or three frames at once, so we keep a `pending` buffer and decode in a loop.

```js
let pending = Buffer.alloc(0);
socket.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  let frame;
  while ((frame = decode(pending))) { // null means "need more bytes"
    pending = pending.subarray(frame.size);
    onFrame(frame);
  }
}); // (the file also wraps the loop in try/catch, and feeds `head` through the same code)
```

**5. React to each frame.** Text is broadcast to everybody (a loop over `clients`), a ping is answered with a pong that has the same payload, and a close frame is answered with a close frame.

```js
function onFrame({ opcode, payload }) {
  if (opcode === OP.TEXT) {
    broadcast(`client ${id}: ${payload.toString()}`);
  } else if (opcode === OP.PING) {
    socket.write(encode(OP.PONG, payload)); // answer with the same bytes
  } else if (opcode === OP.CLOSE) {
    socket.end(encode(OP.CLOSE, payload)); // answer with a close frame, then finish our side
  }
  // ... the file also handles binary frames and pong, and logs what it sees
}

function broadcast(text) {
  const frame = encode(OP.TEXT, Buffer.from(text));
  for (const socket of clients) socket.write(frame);
}
```

### Testing it with the built-in client

The global `WebSocket` class needs no flag from Node 22.0.0 and is stable since 22.4.0. (Older versions had it behind `--experimental-websocket`.) On Node 24 you just use it. It follows the browser API: `new WebSocket(url)`, `onopen`/`onmessage`/`onclose`/`onerror` (or `addEventListener`), `send()`, `close(code, reason)`, `readyState`, `bufferedAmount`, `binaryType`. Disable it with `--no-experimental-websocket`.

Two things it cannot do, exactly like the browser version: it cannot send a ping (it only answers the server's pings by itself), and it cannot be a server.

The demo script connects two clients, sends a chat message, a 300 character message, a ping from the server and 4 binary bytes, then closes both clients:

```text
GET / -> plain HTTP still works on the same port
server: client 1 connected to /chat (1 connected)
server: client 2 connected to /chat (2 connected)
A readyState: 1 (WebSocket.OPEN is 1)
A got: welcome, you are client 1
B got: welcome, you are client 2
server: client 1 said "hello everyone"
A got: client 1: hello everyone
B got: client 1: hello everyone
server: client 1 said 300 characters
B got a long message: 310 characters
server: pinged everybody and got 2 pongs back
server: client 1 sent 4 binary bytes, echoing them
A got binary: ArrayBuffer Uint8Array(4) [ 1, 2, 3, 250 ]
A closes with: { code: 1000, reason: 'done', wasClean: true }
server: client 1 closed with code 1000 "done" (1 left)
B closes with: { code: 1005, reason: '', wasClean: true }
server: client 2 closed with code 1005 "" (0 left)
```

Notice:
- Plain HTTP and WebSocket share one port. The `'upgrade'` event takes the WebSocket requests, the normal `'request'` handler takes the rest.
- The built-in client answered the server's ping by itself. You never see a ping in the browser API.
- Text arrives as a string. Binary arrives as a `Blob` unless you set `ws.binaryType = 'arraybuffer'` (we did, so we got an `ArrayBuffer`).
- Client B called `close()` with no arguments, so the server saw code **1005** (no status given). Client A passed `1000, 'done'` and the server saw both.
- Broadcast is a loop that writes to every client. The sender is included here; many apps skip it.

### What the careful version adds

[`_mini-ws.js`](examples/_mini-ws.js) (about 260 lines, used by examples 06 to 12) is the same server with the shortcuts removed:
- It checks the handshake: GET, `Upgrade: websocket`, version 13, a key. Otherwise it answers `400`.
- It handles 8 byte lengths, **fragmented** messages (opcode 0 continuation), and rejects a text message that is not valid UTF-8 (close code 1007).
- It enforces `maxPayload` *before* reading the payload, because a client can claim a 10 GB length in a 10 byte header.
- It runs the proper closing handshake (with a 1 second safety timer) and exposes `send()`, `ping()`, `close()`, `terminate()` and `bufferedAmount`.
- It checks that client frames are masked (otherwise close code 1002).

What it still leaves out on purpose: extensions such as `permessage-deflate` (compression), sub-protocols, and rate limiting. For production use a maintained library (section 15).

> **Interview tip:** "Could you implement a WebSocket server without a library?" Yes, in five steps: answer the Upgrade request with `101` and the SHA-1 accept key; read bytes from the socket into a buffer; decode frames (FIN, opcode, length, mask key, unmask); handle control frames (ping gets pong, close gets close); encode unmasked frames to reply. Mention the traps: partial frames, fragmentation, a maximum size, and an `'error'` listener on the socket.

## 10. Heartbeats and dead connections

**The problem.** If a phone loses signal or a laptop lid closes, the server gets no "goodbye". TCP is silent when nobody sends data, so the server can believe a dead client is alive for minutes or hours. Dead clients waste memory and file descriptors, and messages sent to them are lost. Idle connections can also be closed by proxies (section 16).

**The fix.** Send a protocol-level **ping** on a timer. A live client's WebSocket library answers with a **pong** automatically. If no pong comes back before the next round, terminate the connection.

The usual pattern is one timer for all clients and an `isAlive` flag. Example: [06-ws-heartbeat.js](examples/06-ws-heartbeat.js):

```js
ws.isAlive = true;                    // when the client connects
ws.on('pong', () => { ws.isAlive = true; });

function sweep() {                    // in production: setInterval(sweep, 30_000)
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();                 // no closing handshake: the other side is not listening anyway
      continue;
    }
    ws.isAlive = false;               // it must answer before the next sweep
    ws.ping();
  }
}
```

The demo has one healthy client and one "zombie" (a raw TCP connection that completes the handshake and then says nothing). To keep the output free of timing luck, the script calls `sweep()` by hand and waits for the pong each time:

```text
server: good connected
server: zombie connected

sweep 1: both are asked to prove they are alive
sweep 2: the zombie never answered sweep 1
server: zombie missed a ping, terminating it
server: zombie is gone (close code 1006)
sweep 3: only the healthy client is left

connections the server still has: [ 'good' ]
pongs from the good client: 3
zombie TCP connection is closed: true
server: good is gone (close code 1005)
```

Choose the interval so that it is **shorter than the shortest idle timeout** on the path (often 60 seconds, section 16). 20 to 30 seconds is common. The ping also keeps the connection from looking idle.

Why not rely on TCP keepalive (`socket.setKeepAlive`)? The operating system sends those probes on its own schedule (two hours by default on Linux, per the Linux documentation), a proxy in the middle does not pass them on, and they say nothing about whether your *application* is still answering. A ping and pong travel through the whole path and prove that the other program is alive.

> **Interview tip:** browsers cannot send or even see protocol pings. The JavaScript `WebSocket` API has no `ping()`. So the server-side ping/pong above checks the *server's* view. For the client's view ("is my connection still alive?"), send small application messages (`{"type":"ping"}`, answered by `{"type":"pong"}`) and treat a missing answer as a dead connection. Socket.IO does this for you.

## 11. Rooms (channels) and broadcast

**What it is.** A room is a named group of connections. "Send to a room" means "send to the members of that group". Chat channels, a document being edited, one game match, and per-user notifications all work this way.

The data structure is small: a `Map` from room name to a `Set` of connections. Example: [07-ws-rooms.js](examples/07-ws-rooms.js):

```js
const rooms = new Map(); // room name -> Set of connections

function join(ws, room) {
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(ws);
  ws.rooms.add(room);
}

function leave(ws, room) {
  const members = rooms.get(room);
  if (!members) return;
  members.delete(ws);
  ws.rooms.delete(room);
  if (members.size === 0) rooms.delete(room); // do not keep empty rooms forever
}

function broadcast(room, message, except) {
  const text = JSON.stringify(message);
  for (const member of rooms.get(room) ?? []) {
    if (member !== except) member.send(text);
  }
}
```

Messages are JSON such as `{ "type": "say", "room": "js", "text": "hi" }`. Each connection also remembers its own rooms (`ws.rooms`), so closing a connection can remove it from every room:

```js
ws.on('close', () => {
  for (const room of [...ws.rooms]) leave(ws, room); // cleanup, or rooms leak dead sockets
});
```

Alice and Bob join `js`, Carol joins `go`. Carol then tries to talk in a room she has not joined:

```text
joined js, members now: alice
joined js, members now: alice, bob
joined go, members now: carol
server rooms -> js: [alice, bob]  go: [carol]
bob received: { type: 'message', room: 'js', from: 'alice', text: 'hi js folks' }
carol received anything: false
alice received her own message: false
carol got: { type: 'error', message: 'join js first' }
bob received after leaving: false
server rooms -> js: [alice]  go: [carol]
after everyone closed, rooms left: 0
```

Checklist for a real server:
- **Check membership** before accepting `say` (Carol above). Otherwise anyone can write into any room.
- **Parse JSON inside `try/catch`.** Clients send garbage.
- **Clean up on close**, including deleting empty rooms.
- **Check `readyState`** (or catch the failure) before sending to a connection that may be closing.
- Large rooms: `JSON.stringify` once, as above, and send the same string to everyone.

> **Interview tip:** "How do you send a notification to one user?" A user can have several tabs and devices, so keep a `Map` from user id to a `Set` of connections (a room named after the user works too) and send to all of them. Never assume one user means one socket.

## 12. Authentication

**The problem.** The browser `WebSocket` constructor takes a URL and sub-protocols. It has no option for an `Authorization` header. (Node's built-in client, which comes from the undici library, accepts a non-standard `headers` option: we tested `new WebSocket(url, { headers })` on Node 24. Browsers do not, so do not design around it.) So how does the server know who is connecting?

| Method | How | Notes |
|---|---|---|
| Cookie | The browser sends cookies on the upgrade request automatically | Works for same-site apps. You **must** check the `Origin` header, or any website can open a WebSocket using the visitor's cookie (Cross-Site WebSocket Hijacking). |
| Ticket plus first message | A logged-in page asks a normal HTTP route for a short-lived, single-use ticket, opens the socket, and sends the ticket as the first message | Works everywhere. The ticket is useless if it leaks. **Recommended.** |
| Token in the first message | The client sends its JWT (a signed login token) or session token as the first message | Simple. The long-lived token never touches a URL. |
| Token in the `Sec-WebSocket-Protocol` header | The token is passed as a fake sub-protocol name | A workaround you will see in the wild. It avoids the URL, but it is a hack and the header may still be logged. |
| Token in the URL (`?token=...`) | The secret is part of the address | **Avoid for secrets.** URLs are written to access logs, proxy logs and browser history. |

Example: [08-ws-auth.js](examples/08-ws-auth.js) implements the ticket flow. The pieces:

```js
// 1. normal HTTP route, protected by the normal login
const ticket = crypto.randomUUID();
tickets.set(ticket, { user, expires: Date.now() + TICKET_TTL_MS });

// 2. the socket is accepted, but the user is unknown; a timer closes silent clients
ws.user = null;
const timer = setTimeout(() => ws.close(4401, 'auth timeout'), settings.authTimeoutMs);

// 3. the first message must be { type: 'auth', ticket }
const entry = msg?.type === 'auth' ? tickets.get(msg.ticket) : undefined;
if (msg?.type === 'auth') tickets.delete(msg.ticket); // single use, valid or not
if (!entry || entry.expires < Date.now()) {
  ws.close(4401, 'unauthorized'); // 4000-4999 are free for applications to use
  return;
}
```

The `verifyClient` hook also checks `Origin` during the upgrade and answers `403` for pages from other sites. The script tries seven cases:

```text
1. ticket without a session: null

2. the good path
got a ticket, length 36
server: new connection GET /
server says: { type: 'welcome', user: 'alice' }
server says: { type: 'echo', user: 'alice', text: 'hello' }

3. reuse the same ticket
server: new connection GET /
closed with: { code: 4401, reason: 'unauthorized', wasClean: true }

4. talk before logging in
server: new connection GET /
closed with: { code: 4401, reason: 'unauthorized', wasClean: true }

5. connect and stay silent
server: new connection GET /
closed with: { code: 4401, reason: 'auth timeout', wasClean: true }

6. a page from another site (bad Origin)
upgrade refused with HTTP status 403

7. why not put the secret in the URL
server: new connection GET /?token=session-abc
```

Look at the last line. That is exactly what a server log (or a proxy log) records when the secret is in the URL.

Rules to remember:
- Authenticate **before** you trust anything, and refuse every other message until then.
- Authorize **per action** too (section 11: check room membership). Being logged in does not mean being allowed.
- Tokens expire, connections do not. Re-check expiry on a timer or close with 4401 and let the client reconnect with a fresh ticket.
- The `Origin` check protects against *browsers* used by other sites. Non-browser clients can send any `Origin` they like, so it is not authentication.
- Use `wss://`, or the ticket travels in clear text.

> **Interview tip:** "How do you authenticate a WebSocket from a browser?" Strong answer: browsers cannot set headers on the handshake. Use a cookie plus an `Origin` check, or a short-lived single-use ticket obtained over normal HTTP and sent as the first message. Never put a long-lived secret in the URL, close unauthenticated sockets after a few seconds, and authorize every action.

## 13. Reconnecting with exponential backoff

A browser `WebSocket` never reconnects. When it closes, it stays closed (`EventSource` and Socket.IO do reconnect, plain WebSocket does not). Your client code must do it, and must do it politely.

**Exponential backoff:** wait a short time before the first retry, and double the wait after every failure, up to a maximum. **Jitter:** pick a random time between zero and that limit. Why? If a server restarts and 50,000 clients all retry at 1 s, 2 s, 4 s exactly, the server is hit by 50,000 connections in the same millisecond, again and again (a "thundering herd"). Random waits spread them out.

Example: [09-ws-reconnect.js](examples/09-ws-reconnect.js):

```js
// Delay before retry number `attempt` (0, 1, 2, ...): baseMs * 2^attempt, but never more than maxMs.
function backoffDelay(attempt, { baseMs, maxMs, jitter }) {
  const ceiling = Math.min(maxMs, baseMs * 2 ** attempt);
  return jitter ? Math.random() * ceiling : ceiling; // "full jitter"
}
```

The class `ReconnectingSocket` calls it in the `close` handler and resets the counter in the `open` handler:

```js
ws.addEventListener('open', () => {
  this.attempt = 0; // success: the next failure starts the backoff from the beginning
  this.emit('open');
});
ws.addEventListener('close', (event) => {
  if (this.stopped) return this.emit('stopped');
  const delay = backoffDelay(this.attempt, this.options);
  this.attempt++;
  this.timer = setTimeout(() => this.open(), delay);
});
```

The demo server refuses the first three handshakes with `503`, accepts the fourth, drops that connection after 30 ms (simulated network loss), and then accepts again. Jitter is off so you can read the delays:

```text
delays for base 500 ms, max 15000 ms:
  500, 1000, 2000, 4000, 8000, 15000, 15000
client: connection closed (code 1006), retry 1 in 20 ms
client: connection closed (code 1006), retry 2 in 40 ms
client: connection closed (code 1006), retry 3 in 80 ms
client: connected (open number 1)
server: dropping the connection (simulated network loss)
client: connection closed (code 1006), retry 1 in 20 ms
client: connected (open number 2)
client: stopped for good
```

Notice that after the successful connection the next retry starts again at 20 ms. The counter was reset.

A good reconnecting client also:
- **Does not retry forever on permanent errors.** A close code of 4401 (not logged in) or 1008 (policy) needs a new login, not a retry. Retry on 1001 (server going away), 1006 (connection lost) and 1011 (server error).
- **Resyncs its state.** Messages sent while disconnected are gone. Send the last message id you saw (`{ "type": "resume", "lastId": 41 }`) and let the server replay, exactly like `Last-Event-ID` in SSE.
- **Decides what to do with messages typed while offline:** queue them (with a size limit), or show "offline".
- **Stops when the user leaves** (`stop()` above), or the timer keeps the process alive.

**What a WebSocket guarantees.** Order, within one connection. Nothing across a reconnect, and no delivery receipt: if the connection drops right after `send()`, you do not know whether the message arrived. If a message must not be lost, give it an id, let the receiver acknowledge it, resend unacknowledged messages after reconnecting, and make the receiver ignore ids it has already seen (the handler must be idempotent, which means "doing it twice has the same effect as doing it once").

> **Interview tip:** "Why add jitter?" Without it, clients that lost the server together retry together, and the recovering server is hit by a reconnect storm. Random delays spread the load. Also say that the delay resets after a successful connection and has a maximum.

## 14. Backpressure

**The problem.** A slow client reads slower than you send. Where do the extra bytes go? Into memory, in a buffer, and it grows without a limit. 10,000 slow clients and a fast producer can crash your server.

The same idea you met in the streams lesson applies: when the buffer is full, stop writing.

- **Browser or Node client:** `ws.bufferedAmount` is the number of bytes you queued with `send()` that have not been handed to the network yet.
- **Server (our helper):** `ws.send()` returns what `socket.write()` returns. `false` means "the buffer is above its high water mark (the size at which Node says slow down)". `ws.bufferedAmount` is the socket's `writableLength`.

Example: [10-ws-backpressure.js](examples/10-ws-backpressure.js). Part 1 paces a sender:

```js
async function sendPaced(ws, chunks, highWater) {
  for (const chunk of chunks) {
    while (ws.bufferedAmount > highWater) await sleep(1); // wait for the buffer to drain
    ws.send(chunk);
  }
}
```

Part 2 gives the server a client that completes the handshake and then never reads. The server pushes 64 KiB messages and watches its own buffer:

```js
const accepted = ws.send(message); // false means: Node's write buffer is above its limit
if (!accepted) results.falseReturns++;
if (ws.bufferedAmount > MAX_BUFFERED) {
  ws.terminate(); // a close frame would never be read by this client, so just drop it
  break;
}
```

```text
=== Part 1: client side, bufferedAmount ===
right after 50 sends, bufferedAmount > 0: true
a moment later it is back to: 0
paced sending stayed under the limit plus one chunk: true
server received 10240000 bytes in total

=== Part 2: server side, a client that never reads ===
send() returned false at least once: true
the slow client was cut off: true
buffer stayed under the limit plus one message: true
```

The exact number of messages sent before the cut-off depends on how big the operating system's socket buffers are, so the example prints only facts that are always true.

What to do with a slow client, in order of preference: (1) **drop old updates** if only the latest value matters (cursor positions, prices), (2) **slow down** the producer, (3) **disconnect** the client when the buffer passes a limit. Never buffer without a limit.

> **Under the hood:** `socket.write()` returns `false` when the stream's buffered bytes reach its `highWaterMark`. For a socket that is 16 KiB on Windows (what we measured) and 64 KiB on other platforms (documented, not measured here). Returning `false` is advice, not an error: the data is still queued. The `'drain'` event on the socket says when it is safe to continue.

> **Interview tip:** the "slow consumer problem". Say what grows (the per-connection write buffer, in your process memory), how you see it (`bufferedAmount`, the return value of `write`), and the three options: drop stale updates, slow the producer, disconnect.

## 15. The `ws` library and Socket.IO

You can write the server yourself to learn how it works (section 9). In production use a maintained library. The two common ones:

### `ws`

`ws` is a fast, small and well-tested WebSocket implementation. It follows the protocol closely and adds almost nothing on top. As of 2026-11-10 the latest version on npm is 8.22.2 (check before you install). Its `maxPayload` option defaults to 100 MiB (we confirmed this with `ws` 8.21.1), which is far too much for most chat messages, so always set your own.

```js
// Needs: npm install ws
const { WebSocketServer, WebSocket } = require('ws');

const wss = new WebSocketServer({ port: 8080, maxPayload: 64 * 1024 }); // limit the message size!

wss.on('connection', (ws, req) => {
  ws.on('error', console.error); // required: see the warning below
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data, isBinary) => {
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
    }
  });
});

const sweep = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);
wss.on('close', () => clearInterval(sweep));
```

This snippet was run against `ws` 8.21.1 (broadcast, ping sweep and the size limit all behaved as described). It looks almost the same as our helper on purpose: the API in this lesson was modelled on it.

> **Common mistake:** no `'error'` listener on each socket. With `maxPayload` set, a client that sends a bigger message makes `ws` emit an `'error'` event (code `WS_ERR_UNSUPPORTED_MESSAGE_LENGTH`) and close the connection with 1009. An `EventEmitter` throws when it emits `'error'` and nobody listens, so without `ws.on('error', ...)` one bad client kills the whole server process. This crashed our first test run of the snippet, before the line was added.

To share a port with an existing HTTP server, create the server with `{ noServer: true }` and call `wss.handleUpgrade(req, socket, head, callback)` inside your own `'upgrade'` handler. The `ws` documentation discourages its `verifyClient` option (the one our helper copies for teaching). Do the checks (`Origin`, cookies, tickets) in your own `'upgrade'` handler, before `handleUpgrade`, and answer with a plain HTTP error when a check fails:

```js
// Needs: npm install ws   (the same pattern was run against ws 8.21.1)
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
wss.on('connection', (ws) => ws.on('error', console.error));

server.on('upgrade', (req, socket, head) => {
  if (!isAllowed(req)) {                       // your own check: Origin, cookie, ticket...
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
```

### Socket.IO

Socket.IO is **not** a WebSocket implementation. It is its own protocol that uses WebSocket (or HTTP long polling) underneath. A plain WebSocket client cannot talk to a Socket.IO server, and the other way around. As of 2026-11-10 the latest version on npm is 4.8.4.

The two snippets below are illustrative: they are not run by this lesson.

```js
// Needs: npm install socket.io
const { Server } = require('socket.io');
const io = new Server(3000, { cors: { origin: 'https://app.example.test' } });

io.on('connection', (socket) => {
  socket.join('room1');
  socket.on('chat', (text, ack) => {
    io.to('room1').emit('chat', text);   // rooms are built in
    if (typeof ack === 'function') ack({ ok: true }); // acknowledgement to the sender, if it asked
  });
  socket.on('disconnect', (reason) => console.log('left:', reason));
});
```

```js
// Needs: npm install socket.io-client
const { io } = require('socket.io-client');
const socket = io('http://localhost:3000');          // reconnects by itself
socket.on('connect', () => {
  socket.timeout(5000).emit('chat', 'hello', (err, response) => {
    console.log(err ? 'no answer in 5 s' : response); // acknowledgement with a timeout
  });
});
```

| Socket.IO adds | What it means |
|---|---|
| Rooms and namespaces | `socket.join()`, `io.to(room).emit()`. You do not write the Map of section 11. (A namespace splits one connection into separate channels such as `/admin`.) |
| Automatic reconnection | Backoff with jitter built in on the client. |
| Heartbeat | The server pings and the client answers, so both sides notice when the other one stops. |
| Acknowledgements | `emit('event', data, callback)`: request and response style over the socket. |
| HTTP long-polling fallback | Works behind networks that block WebSocket, then upgrades. |
| Event names and JSON by default | `socket.emit('chat', obj)` instead of one big `onmessage` with a `type` field. |
| Redis adapter | Official `@socket.io/redis-adapter` for the backplane of section 16. |

| What it costs | Detail |
|---|---|
| Lock-in | Both ends must use Socket.IO. No plain `new WebSocket()` clients, no other tools. |
| Bigger messages | Every message has extra framing, for example a text message looks like `42["chat","hi"]` on the wire. |
| Sticky sessions | With the long-polling fallback, several HTTP requests of one session must reach the same server. You need sticky sessions, or `transports: ['websocket']` only. |
| More code in the browser | A client library to download. |
| Complexity | More features means more behaviour to learn and debug. |

> **Interview tip:** a balanced answer is "Raw WebSocket (with `ws`) when I control both ends and want a thin, standard channel or must talk to other clients. Socket.IO when I want rooms, reconnection and acknowledgements out of the box and accept the lock-in."

## 16. Scaling WebSockets horizontally

### The state problem

A connection lives in the memory of **one** process. Normal HTTP requests are stateless, so any server can answer them. A WebSocket server holds a list of sockets, so a load balancer in front of two servers creates a new problem: Ann is connected to server A and Ben to server B. When Ann sends a message, A cannot write to Ben's socket.

Two tools solve the two halves of this.

**Sticky sessions** (session affinity). The load balancer sends all requests of one client to the same server, using a cookie or the client IP. It is needed when a protocol makes several HTTP requests that must meet the same server (Socket.IO's long polling, or an upgrade that follows an earlier request). It does **not** solve Ann-and-Ben. Pure WebSocket does not need it, because the connection itself is one long-lived TCP connection to one server.

**A pub/sub backplane.** Pub/sub means publish and subscribe: senders publish to a named channel, and everybody subscribed to that channel receives the message. Every server publishes what its clients send and subscribes to the same channel. Each server delivers what it hears to its own local clients. Redis (a fast in-memory data store with a pub/sub feature) is the common choice. Example: [11-ws-backplane.js](examples/11-ws-backplane.js) uses an in-process class as a stand-in for Redis, so you can see the effect without installing anything:

```js
if (redis) redis.subscribe('chat', deliverToMyClients); // hear everything, from every instance

wss.on('connection', (ws) => {
  ws.on('message', (text) => {
    const line = `[from server ${name}] ${text}`;
    if (redis) redis.publish('chat', line); // one code path: the subscription delivers it, even to us
    else deliverToMyClients(line);
  });
});
```

```text
=== Without a backplane ===
server A has 1 client, server B has 1 client
Ann received: [from server A] hello from Ann
Ben received: nothing

=== With a backplane (pub/sub channel) ===
server A has 1 client, server B has 1 client
Ann received: [from server A] hello from Ann
Ben received: [from server A] hello from Ann
```

The real version with Redis looks like this (illustrative, not run here):

```js
// Needs: npm install ws ioredis   (and a running Redis server)
const Redis = require('ioredis'); // check the ioredis README for the import style of your version
const pub = new Redis();
const sub = new Redis(); // a connection in subscriber mode cannot publish, so use two

sub.subscribe('chat');
sub.on('message', (channel, message) => {
  for (const client of wss.clients) client.send(message);
});
// in the 'message' handler of each socket:
pub.publish('chat', text);
```

With Socket.IO you do not write this yourself: install `@socket.io/redis-adapter` and call `io.adapter(createAdapter(pubClient, subClient))` (see its documentation for the exact setup).

> **Remember:** Redis pub/sub is "fire and forget". If a server is disconnected for a moment it misses those messages, and nothing is stored. For messages that must not be lost, store them (a database, Redis Streams, Kafka) and let clients resume from an id, as in sections 5 and 13.

### One process uses one CPU core

Your JavaScript runs on one thread per process. A slow handler, a huge `JSON.stringify`, or a broadcast to 50,000 sockets delays *every* connection on that process, including its heartbeats. To use all cores of a machine, run several processes (the `cluster` module, or one process per container). They are separate servers as far as memory is concerned, so they need the backplane too. Keep each message handler short, and move heavy work to a worker or another service.

### Limits

Run [12-ws-limits-and-shutdown.js](examples/12-ws-limits-and-shutdown.js) to see two of them:

```text
=== A: maxConnections ===
connected clients: 2
server: dropped a connection, limit is 2
third client failed, close code 1006

=== B: maxPayload ===
500 bytes: connection still open: true
2000 bytes: closed with { code: 1009, reason: 'message too big', wasClean: true }
```

- **Connections and file descriptors.** Each open connection is a socket, and each socket uses a file descriptor (an operating system handle). Linux limits them per process (`ulimit -n`), often to 1024 by default. That would cap you at roughly a thousand clients, so raise it for a real deployment. (Documented behaviour, not measured on this Windows machine.) `server.maxConnections` makes Node refuse extra sockets and emit `'drop'`.
- **Ports.** One client IP can open at most about 64,000 connections to one server address and port, because the TCP port number has 16 bits (in practice fewer, because only part of the range is used for outgoing connections). This matters for load tests and for proxies that connect to your servers from a single IP.
- **Memory.** Each connection costs memory for its buffers, its state and any compression. Measure with your own message sizes, and turn compression (`permessage-deflate`) off or tune it if memory is tight.
- **Message size.** Set `maxPayload` (B above). A client can otherwise ask you to buffer an enormous message.
- **CPU.** Broadcasting to a room of N members costs N writes per message. Keep rooms small or batch updates.

Hardening checklist for a public WebSocket server (the section numbers show where each idea appears):
1. `wss://` only, and an `Origin` check on the upgrade (section 12).
2. Close sockets that do not authenticate within a few seconds (section 12).
3. A `maxPayload`, a cap on connections per process and per user (above).
4. A rate limit per connection: count messages per second in the `'message'` handler and close with 1008 when the count is too high (not built in this lesson).
5. Validate every message: JSON parse in `try/catch`, then check the fields (section 11).
6. Heartbeats so dead sockets are removed (section 10).
7. A buffer limit per client, so a slow reader cannot eat your memory (section 14).
8. An `'error'` listener on every socket (section 15).

### Load balancer and proxy timeouts

Reverse proxies and load balancers close connections that look idle. Common defaults are around 60 seconds (nginx `proxy_read_timeout` is 60 s, and an AWS Application Load Balancer idle timeout is 60 s by default). If your connection is silent for longer, it is cut, and the client sees code 1006. The fixes:

1. **Send heartbeats** more often than the timeout (section 10, and the `: heartbeat` comment for SSE).
2. **Raise the proxy timeout** for WebSocket routes.
3. **Make sure the proxy passes the upgrade.** For nginx:

```text
# Needs: nginx (illustrative configuration)
location /ws/ {
    proxy_pass http://app_servers;
    proxy_http_version 1.1;                    # WebSocket needs HTTP/1.1
    proxy_set_header Upgrade $http_upgrade;    # pass the Upgrade header on
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 120s;                   # longer than your heartbeat interval
}
```

Without the `Upgrade` and `Connection` headers, the handshake fails because the proxy removes them (they are "hop-by-hop" headers, meant for one connection only).

Long-lived connections also make the load uneven. After a restart, a freshly started server holds no connections while the older ones keep theirs, and plain round robin only shares out the *new* connections. A "least connections" balancing rule, and draining servers one at a time (next part), even it out.

### Deploys and graceful shutdown

Connections last hours, so every deploy or scale-in cuts them. Do it politely: stop accepting new connections, send a close frame with **1001 (going away)** to every client, then exit. Clients then reconnect to another server. Example C in the same file:

```js
// What a SIGTERM handler would do (on Windows test with Ctrl+C / SIGINT, see the note below):
const fullyClosed = new Promise((resolve) => server.close(resolve)); // stop accepting new connections
for (const ws of wss.clients) ws.close(1001, 'server restarting'); // 1001 = going away
```

```text
=== C: graceful shutdown ===
clients connected: 3
every client saw: { code: 1001, reason: 'server restarting', wasClean: true }
all three got the same code: true
server: fully closed, the process can exit
```

> **Common mistake:** testing shutdown with SIGTERM on Windows. Windows does not deliver SIGTERM the way Linux does (the Node docs say it can be listened for but is not sent by the system), so a SIGTERM handler may never run there. Use Ctrl+C (SIGINT) locally and SIGTERM in Linux containers.

If all clients get cut at once and retry together, the other servers are hit by a reconnect storm. That is why client backoff needs **jitter** (section 13), and why you drain servers one at a time.

> **Interview tip:** "How would you scale a chat to 1 million users?" A connection is stateful, so: many server processes behind a load balancer, a pub/sub backplane between them, raised file descriptor limits, `maxPayload` and backpressure limits, heartbeats below the proxy timeout, graceful 1001 drains with jittered client reconnects, and storage with resume ids for messages that must not be lost. Sticky sessions only if you use a long-polling fallback.

## 17. Choosing a technique

| | Short polling | Long polling | SSE | WebSocket |
|---|---|---|---|---|
| Direction | Client asks, server answers | Client asks, server answers late | Server to client only | Both ways, any time |
| Protocol | HTTP request/response | HTTP request/response | HTTP, one streaming response (`text/event-stream`) | Own protocol (RFC 6455) after an HTTP Upgrade |
| Data format | Anything | Anything | UTF-8 text | Text and binary |
| Delay of news | Up to one interval | Almost none | Almost none | Almost none |
| Reconnection | Not needed (every request is new) | Client loops | Built into `EventSource`, with `Last-Event-ID` resume | You write it (or a library does) |
| Proxies and firewalls | No problems | Mostly fine, watch timeouts | Fine, but buffering and idle timeouts need care | Needs Upgrade support and long idle timeouts |
| Scaling | Stateless, easy, but many requests | One open request per client | One open connection per client, plus a backplane | One open connection per client, plus a backplane, plus limits |
| Browser support | Everywhere | Everywhere | All modern browsers (`EventSource`) | All modern browsers |
| Typical use | Job status, rare updates | Fallback | Feeds, notifications, progress, dashboards, streamed text | Chat, games, collaboration, trading UIs |

**Decision guide**

```text
Does the CLIENT also send frequent messages, with low delay (chat, game, shared editing)?
  yes -> WebSocket
  no  -> Does the server push updates often (feed, notifications, progress, live numbers)?
           yes -> SSE (plus normal POST requests for anything the client sends)
           no  -> Are updates rare, or are you stuck with the simplest tools?
                    -> short polling (or long polling if you need news within a second)
```

Start with the simplest option that meets the need. SSE plus normal requests covers a large share of "real-time" features with much less machinery than WebSockets, and it works with the HTTP tools you already have (logging, auth middleware, HTTP/2). Reach for WebSockets when you truly need two-way, low-delay traffic or binary data.

Newer options you may hear about, not covered here: WebSocket over HTTP/2 (RFC 8441, rarely used) and WebTransport (a newer browser API on top of HTTP/3).

## 18. Interview questions you should be ready for

The "strong answer" column is the short version. The section number shows where the lesson explains it.

| Question | What a strong answer includes |
|---|---|
| WebSocket, SSE or polling: how do you choose? (17) | Direction of data, frequency, binary or text, infrastructure (proxies, HTTP/2), scale, reconnection needs. Give the decision guide, and say you would start with SSE if the client rarely sends data. |
| How does the WebSocket handshake work? (7) | HTTP/1.1 GET with `Upgrade: websocket`, `Sec-WebSocket-Key` and version 13. The server replies `101` with `Sec-WebSocket-Accept` = base64(sha1(key + GUID)). Then frames flow over the same TCP connection. The accept key is a protocol check, not security. |
| How do you detect a dead connection? (10) | Ping/pong heartbeat with an `isAlive` flag, terminate when a pong is missing. Browsers cannot ping, so use application-level pings for the client's view. Mention proxy idle timeouts. |
| How do you authenticate WebSockets? (12) | No custom headers in browsers. Use a cookie (plus an `Origin` check) or a short-lived single-use ticket sent as the first message. Never put long-lived secrets in the URL. Authorize per action, expire tokens. |
| How would you scale a chat to 1 million users? (16) | Many processes behind a load balancer, a pub/sub backplane, sticky sessions only for long-polling fallbacks, raised file descriptor limits, `maxPayload`, backpressure, graceful drains, client backoff with jitter, storage plus resume ids. |
| Does a WebSocket guarantee delivery? (13) | No. Order within one connection only. Add ids, acknowledgements, resend after reconnect, and idempotent handlers. |
| What happens to messages while a client is offline? (5, 13) | They are lost unless you store them. Give messages increasing ids, keep history, and let the client resume from its last id (`Last-Event-ID` for SSE, a resume message for WebSocket). |
| What is the slow consumer problem? (14) | A client that reads slower than you send makes server buffers grow. Check `socket.write()`/`bufferedAmount`, pace or drop updates, and disconnect clients over a limit. |
| My WebSocket or SSE works locally but breaks behind a proxy. Why? (16) | The proxy must pass `Upgrade` and `Connection` and use HTTP/1.1 to the backend; response buffering must be off for SSE; idle timeouts (often 60 s) need heartbeats or a higher limit. |
| What does the user see during a deploy, and how do you make it smooth? (16) | All sockets drop. Send close 1001, let clients reconnect with backoff and jitter, resume from the last id, and drain servers one at a time. |
| Socket.IO or `ws`? (15) | `ws` is a thin standard WebSocket. Socket.IO is its own protocol with rooms, acknowledgements, reconnection and fallbacks, at the cost of lock-in, overhead and sticky sessions for long polling. |

## Summary / Key takeaways
- HTTP cannot push. Real-time needs polling, long polling, SSE or WebSockets. Start with the simplest one that fits.
- SSE is one long HTTP response with `Content-Type: text/event-stream`. Use `id`, `Last-Event-ID`, heartbeats and cleanup on `res.on('close')`.
- A WebSocket starts as an HTTP Upgrade. The server answers `101` and `Sec-WebSocket-Accept` = base64(sha1(key + GUID)).
- Frames have an opcode and a length. Client frames are masked (not encrypted), server frames are not. Ping/pong and close codes are control frames. 1005 and 1006 are only reported locally.
- Node 24 has a global `WebSocket` client (flag-free since 22.0.0, stable since 22.4.0), but no server. `EventSource` is behind `--experimental-eventsource`.
- Production needs heartbeats, authentication that avoids secrets in URLs, client reconnection with backoff and jitter, backpressure handling, and an `'error'` listener on every socket.
- Scaling means a pub/sub backplane (Redis), several processes, raised connection limits, heartbeats below proxy timeouts, and graceful 1001 shutdowns.
- Use `ws` or Socket.IO in production. Know what Socket.IO adds (rooms, acks, fallbacks, reconnection) and what it costs (lock-in, overhead).

## Quick check

1. Which technique is a one-way stream over plain HTTP that the browser reconnects automatically?
<details><summary>Answer</summary>

Server-Sent Events, read in the browser with `EventSource`. The server sends `Content-Type: text/event-stream`, and on reconnect the browser sends the `Last-Event-ID` header.

</details>

2. What does the server put in `Sec-WebSocket-Accept`, and does it authenticate the client?
<details><summary>Answer</summary>

`base64(sha1(Sec-WebSocket-Key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))`. It only proves the server understands the WebSocket protocol. It does not authenticate anybody.

</details>

3. Why must client-to-server frames be masked? Is masking encryption?
<details><summary>Answer</summary>

Masking stops broken proxies from mistaking attacker-controlled bytes for HTTP (cache poisoning). It is not encryption: the 4 byte key is sent with the frame. Use `wss://` for encryption. A server must close with 1002 if it receives an unmasked client frame.

</details>

4. A client calls `ws.close()` with no arguments. What close code does the server see? What code do you see when the Wi-Fi drops?
<details><summary>Answer</summary>

1005 (no status given) for the first. 1006 (abnormal closure, no close frame) for the second. Neither is ever sent on the wire; they are reported locally.

</details>

5. How do you find out that a WebSocket client has silently disappeared?
<details><summary>Answer</summary>

Send pings on a timer and mark each connection `isAlive = false` before the ping, `true` when the pong arrives. A connection still `false` at the next sweep is terminated. Browsers cannot send pings, so for the client's own view use application-level ping messages.

</details>

6. Two servers sit behind a load balancer. Ann is on A, Ben on B. Why does a broadcast on A not reach Ben, and what fixes it?
<details><summary>Answer</summary>

Sockets live in the memory of one process, so A only knows its own clients. A pub/sub backplane (for example Redis) fixes it: every server publishes to a shared channel and delivers what it hears to its local clients. Sticky sessions do not fix this.

</details>

7. Why is `ws://host/chat?token=SECRET` a bad idea, and what do you do instead?
<details><summary>Answer</summary>

URLs end up in access logs, proxy logs and browser history, so the secret leaks. Use a short-lived single-use ticket (from a normal authenticated HTTP route) sent as the first message, or a cookie with an `Origin` check.

</details>

8. In which Node version can you use `new WebSocket(url)` without a flag, and can Node 24 act as a WebSocket server without a library?
<details><summary>Answer</summary>

Without a flag since v22.0.0 (stable since v22.4.0). The global class is a client only. A server needs the `'upgrade'` event plus your own frame code, or a library such as `ws`.

</details>

9. What is the difference between long polling and SSE?
<details><summary>Answer</summary>

Long polling answers each request once and the client must ask again, so every message costs a new request with full headers. SSE keeps one response open and writes many messages to it, with built-in reconnect and resume ids in the browser.

</details>

10. A client reads slower than the server sends. What grows on the server, and how do you notice and react?
<details><summary>Answer</summary>

The write buffer of that client's socket grows in the server's memory. You notice it through `socket.write()` returning `false` or a large `bufferedAmount`. React by dropping stale updates, slowing the producer, or disconnecting the client above a limit.

</details>

## Try it yourself

All three tasks run from the repo root. Tasks 2 and 3 use the helpers next to the examples, so save them as `lessons/13-realtime-websockets-sse/examples/_task2.js` and `_task3.js` (a leading `_` keeps the example checker from running them).

### Task 1 (easy): a countdown over SSE
Write a server with a `/countdown` route that sends the numbers 3, 2, 1 as SSE messages (30 ms apart), then an `event: done` message with the data `liftoff`, and ends the stream. Write a client that reads it with `fetch` and prints each message as `event data`.

<details><summary>Hint</summary>

Set `Content-Type: text/event-stream`. Write `data: 3\n\n`. Since the server ends the stream, the client can use `await res.text()` and split it on `\n\n`.

</details>

<details><summary>Solution</summary>

```js
const http = require('node:http');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = http.createServer(async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  for (const n of [3, 2, 1]) {
    res.write(`data: ${n}\n\n`);
    await sleep(30);
  }
  res.write('event: done\ndata: liftoff\n\n');
  res.end(); // ends the stream, so the client can read it to the end
});

server.listen(0, '127.0.0.1', async () => {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/countdown`);
  const text = await res.text();
  for (const block of text.trim().split('\n\n')) {
    const lines = block.split('\n');
    const event = lines.find((line) => line.startsWith('event: '))?.slice(7) ?? 'message';
    const data = lines.find((line) => line.startsWith('data: ')).slice(6);
    console.log(event, data);
  }
  server.close();
});
```

Output:

```text
message 3
message 2
message 1
done liftoff
```

</details>

### Task 2 (medium): chat commands
Build on the chat server of example 05, using the helper `_mini-ws.js` so you do not have to write frame code. Add two commands. `/nick name` renames the sender (reply `you are now name` to the sender only). `/who` replies to the sender only with a comma separated list of all nicknames. Anything else is broadcast to everyone as `nick: text`. New clients start as `guest1`, `guest2`, ...

<details><summary>Hint</summary>

Keep the nickname on the connection object (`ws.nick`). `wss.clients` is a `Set`, so `[...wss.clients].map((c) => c.nick)` gives the list. Text messages arrive as strings, binary ones as a `Buffer` with `isBinary` true: ignore binary.

</details>

<details><summary>Solution</summary>

```js
const http = require('node:http');
const { createWebSocketServer } = require('./_mini-ws');
const { connect } = require('./_test-client');

const server = http.createServer();
const wss = createWebSocketServer(server);

let guests = 0;
wss.on('connection', (ws) => {
  ws.nick = `guest${++guests}`;
  ws.on('message', (text, isBinary) => {
    if (isBinary) return; // this chat is text only
    if (text.startsWith('/nick ')) {
      ws.nick = text.slice(6).trim();
      ws.send(`you are now ${ws.nick}`);
    } else if (text === '/who') {
      ws.send([...wss.clients].map((client) => client.nick).join(', ')); // only to the sender
    } else {
      for (const client of wss.clients) client.send(`${ws.nick}: ${text}`);
    }
  });
});

server.listen(0, '127.0.0.1', async () => {
  const url = `ws://127.0.0.1:${server.address().port}/`;
  const a = await connect(url);
  const b = await connect(url);

  a.send('/nick ann');
  console.log(await a.waitFor());
  b.send('/who');
  console.log(await b.waitFor());
  a.send('hello');
  console.log(await a.waitFor(), '|', await b.waitFor());

  await Promise.all([a.close(), b.close()]);
  server.close();
});
```

Output:

```text
you are now ann
ann, guest2
ann: hello | ann: hello
```

</details>

### Task 3 (harder): an SSE client that resumes
Write a server that sends events with ids 1 to 9, but drops the connection (`res.destroy()`) after every 3 events. It must honour the `Last-Event-ID` request header. Write a client with `fetch` that keeps reconnecting, with exponential backoff, until it has all 9 items exactly once and in order. (You may reuse `readEvents` from `_sse-client.js`.)

<details><summary>Hint</summary>

Server: start sending at `lastId + 1`, send at most 3 events, then `res.destroy()` (or `res.end()` when everything is sent). Client: remember the highest id seen, send it as `Last-Event-ID` on every new request, and put the whole read in `try/catch` because a destroyed connection makes the body stream throw. Reset the backoff when a connection brought new events.

</details>

<details><summary>Solution</summary>

```js
const http = require('node:http');
const { readEvents } = require('./_sse-client');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TOTAL = 9;

// A server that drops every connection after 3 events (the last connection ends normally).
const server = http.createServer(async (req, res) => {
  const lastId = Number(req.headers['last-event-id'] || 0);
  console.log(`server: connection, Last-Event-ID = ${lastId || 'none'}`);
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.flushHeaders();
  for (let id = lastId + 1; id <= Math.min(lastId + 3, TOTAL); id++) {
    res.write(`id: ${id}\ndata: item ${id}\n\n`);
    await sleep(10);
  }
  if (lastId + 3 >= TOTAL) res.end();
  else res.destroy(); // simulate a network failure
});

async function collect(url) {
  const got = [];
  let lastId = 0;
  let failures = 0; // reconnects in a row that brought no new event
  while (got.length < TOTAL) {
    const before = got.length;
    try {
      const res = await fetch(url, { headers: lastId ? { 'Last-Event-ID': String(lastId) } : {} });
      for await (const msg of readEvents(res)) {
        if (Number(msg.id) > lastId) { // ignore anything we have already seen
          got.push(msg.data);
          lastId = Number(msg.id);
        }
      }
    } catch {
      // the connection broke in the middle of the stream: reconnect below
    }
    failures = got.length > before ? 0 : failures + 1; // progress resets the backoff
    if (got.length < TOTAL) await sleep(Math.min(1000, 10 * 2 ** failures)); // exponential backoff
  }
  return got;
}

server.listen(0, '127.0.0.1', async () => {
  const items = await collect(`http://127.0.0.1:${server.address().port}/events`);
  console.log('client got:', items.join(', '));
  server.close();
});
```

Output:

```text
server: connection, Last-Event-ID = none
server: connection, Last-Event-ID = 3
server: connection, Last-Event-ID = 6
client got: item 1, item 2, item 3, item 4, item 5, item 6, item 7, item 8, item 9
```

</details>

## Where to go next
- Next lesson: [14. Error Handling and Debugging](../14-error-handling-and-debugging/README.md). Real-time servers live for days, so errors, crashes and leaks matter more than in short-lived scripts.
- Practise these topics in the interview rounds: [Round 2: Core](../../rounds/round-2-core/questions.md), [Round 4: Advanced](../../rounds/round-4-advanced/questions.md) and [Round 5: System design](../../rounds/round-5-system-design/questions.md) (a chat or notification system is a classic design question).
- Earlier background: [11. Streams](../11-streams/README.md) for backpressure, and [12. HTTP and Networking with Core Modules](../12-http-and-networking/README.md) for the `http` server basics used here.
