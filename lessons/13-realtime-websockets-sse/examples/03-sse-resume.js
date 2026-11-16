// SSE reliability: ids, Last-Event-ID resume, heartbeat and cleanup on close
// Run: node lessons/13-realtime-websockets-sse/examples/03-sse-resume.js
//
// A client reads 3 events and then "loses the network". While it is away the server
// publishes 2 more. The client reconnects with the Last-Event-ID header and gets the
// missed events replayed, then the live ones.

const http = require('node:http');
const { EventEmitter, once } = require('node:events');
const { readEvents } = require('./_sse-client');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- the server ----------------------------------------------------------

const history = []; // every event we published: { id, data } (real systems cap or expire this)
const clients = new Set(); // open response objects
const signal = new EventEmitter(); // only so the demo script can wait for server-side moments
let nextId = 1;

function write(res, { id, data }) {
  res.write(`id: ${id}\ndata: ${data}\n\n`);
}

function publish(data) {
  const event = { id: nextId++, data };
  history.push(event);
  for (const res of clients) write(res, event);
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  res.flushHeaders();

  // A reconnecting EventSource sends the id of the last event it saw in this header.
  const lastId = Number(req.headers['last-event-id'] || 0);
  console.log(`server: client connected (Last-Event-ID: ${req.headers['last-event-id'] ?? 'none'})`);
  for (const event of history) {
    if (event.id > lastId) write(res, event); // replay what the client missed
  }

  clients.add(res);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25);

  // Cleanup: without this the interval and the Set entry would leak for every visitor.
  res.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(res);
    console.log(`server: client left, ${clients.size} connected`);
    signal.emit('left');
  });
  signal.emit('joined');
});

// ---- the client ----------------------------------------------------------

// Read events until we have `count` data events, then drop the connection.
async function listen(url, headers, count) {
  const controller = new AbortController();
  const res = await fetch(url, { headers, signal: controller.signal });
  const seen = [];
  let heartbeats = 0;
  for await (const msg of readEvents(res)) {
    if (msg.comments.includes('heartbeat')) heartbeats++;
    if (msg.data === null) continue;
    seen.push(msg);
    console.log(`client: got id=${msg.id} data=${msg.data}`);
    if (seen.length === count) break; // leaving the loop cancels the stream
  }
  controller.abort(); // make sure the TCP connection is really closed
  return { lastId: seen.at(-1).id, heartbeats };
}

server.listen(0, '127.0.0.1', async () => {
  const url = `http://127.0.0.1:${server.address().port}/events`;

  // Round 1: first visit, no Last-Event-ID.
  const joined = once(signal, 'joined');
  const left = once(signal, 'left');
  const round1 = listen(url, {}, 3);
  await joined;
  publish('one');
  publish('two');
  await sleep(60); // long enough for at least one heartbeat
  publish('three');
  const { lastId, heartbeats } = await round1;
  console.log(`client: connection lost after id ${lastId}. heartbeats seen: ${heartbeats > 0 ? 'yes' : 'no'}`);
  await left;

  // While the client is away, the world goes on.
  publish('four');
  publish('five');
  console.log('server: published four and five while nobody was listening');

  // Round 2: reconnect, say where we stopped.
  const joined2 = once(signal, 'joined');
  const left2 = once(signal, 'left');
  const round2 = listen(url, { 'Last-Event-ID': String(lastId) }, 3);
  await joined2;
  await sleep(30);
  publish('six');
  await round2;
  await left2;
  server.close();
});
