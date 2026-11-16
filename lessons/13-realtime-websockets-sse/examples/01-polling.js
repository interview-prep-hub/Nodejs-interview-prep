// Short polling vs long polling, side by side
// Run: node lessons/13-realtime-websockets-sse/examples/01-polling.js
//
// Short polling: the client asks again and again, the server answers at once.
// Long polling: the client asks once, the server holds the request until it has news.

const http = require('node:http');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- the server ----------------------------------------------------------

let statusChecks = 0; // how many times /status was asked
const messages = []; // news for the long-poll demo
const waiting = new Set(); // long-poll responses that are parked until news arrives
let timeouts = 0; // how many parked requests ended with a 204
const LONG_POLL_TIMEOUT_MS = 250; // real servers use 20-30 seconds

function publish(text) {
  messages.push(text);
  for (const parked of waiting) parked.answer(); // wake everybody who is waiting
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/status') {
    // Short polling endpoint: always answers immediately.
    // The fake job finishes on the 4th check (so the output does not depend on timing).
    statusChecks++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ done: statusChecks >= 4 }));
    return;
  }

  if (url.pathname === '/poll') {
    // Long polling endpoint: ?since=N means "I already have N messages".
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
      timeouts++;
      res.statusCode = 204; // "no content": nothing happened, ask again
      res.end();
    }, LONG_POLL_TIMEOUT_MS);
    res.on('close', () => { // the client went away (or we answered): clean up
      clearTimeout(parked.timer);
      waiting.delete(parked);
    });
    return;
  }

  res.statusCode = 404;
  res.end();
});

// ---- the clients ---------------------------------------------------------

async function shortPolling(base) {
  console.log('--- short polling: ask every 30 ms ---');
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

// Wait until test() is true. The demo uses it to publish news at well-defined moments.
async function until(test) {
  while (!test()) await sleep(5);
}

async function longPolling(base) {
  console.log('--- long polling: the server holds each request ---');

  // The client: ask, wait for the answer, ask again.
  const client = (async () => {
    let requests = 0;
    let received = 0;
    while (received < 2) {
      requests++;
      const res = await fetch(`${base}/poll?since=${received}`);
      if (res.status === 204) {
        console.log(`request ${requests}: 204 (nothing happened, ask again at once)`);
        continue;
      }
      const batch = await res.json();
      received += batch.length;
      console.log(`request ${requests}: 200 ${JSON.stringify(batch)}`);
    }
    console.log(`long polling used ${requests} requests for 2 messages`);
  })();

  // The "world": news appears once a request is parked, and again after one timeout.
  await until(() => waiting.size === 1);
  publish('first news');
  await until(() => timeouts === 1 && waiting.size === 1);
  publish('second news');
  await client;
}

server.listen(0, '127.0.0.1', async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  await shortPolling(base);
  await longPolling(base);
  server.close();
});
