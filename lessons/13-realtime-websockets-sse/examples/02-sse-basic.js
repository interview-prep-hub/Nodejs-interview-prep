// Server-Sent Events with plain node:http, read with fetch streaming
// Run: node lessons/13-realtime-websockets-sse/examples/02-sse-basic.js
//
// Shows the text/event-stream wire format (event, id, data, retry, comment lines)
// and how a client parses it. The server sends 4 events and then ends the stream.

const http = require('node:http');
const { readEvents } = require('./_sse-client');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Write one SSE message. A message is a few "field: value" lines ended by a blank line.
function sendEvent(res, { event, id, data }) {
  let text = '';
  if (event) text += `event: ${event}\n`;
  if (id !== undefined) text += `id: ${id}\n`;
  for (const line of String(data).split('\n')) text += `data: ${line}\n`; // one data: per line
  res.write(`${text}\n`); // the blank line ends the message
}

const server = http.createServer(async (req, res) => {
  if (req.url !== '/events') {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', // this header makes it an event stream
    'Cache-Control': 'no-cache', // never cache a live stream
  });
  res.flushHeaders(); // send the headers now, do not wait for the first write

  res.write('retry: 3000\n\n'); // tell the browser to wait 3000 ms before it reconnects
  await sleep(20);
  sendEvent(res, { event: 'welcome', id: 1, data: JSON.stringify({ hello: 'client' }) });
  await sleep(20);
  sendEvent(res, { id: 2, data: 'a message with no event name' });
  await sleep(20);
  sendEvent(res, { id: 3, data: 'line one\nline two' }); // a multi-line message
  await sleep(20);
  res.write(': heartbeat\n\n'); // a comment: clients ignore it, proxies see traffic
  await sleep(20);
  sendEvent(res, { event: 'bye', id: 4, data: 'closing the stream' });
  res.end();
});

server.listen(0, '127.0.0.1', async () => {
  const url = `http://127.0.0.1:${server.address().port}/events`;

  // Part 1: the raw bytes on the wire.
  const raw = await fetch(url);
  console.log('status:', raw.status);
  console.log('content-type:', raw.headers.get('content-type'));
  console.log('cache-control:', raw.headers.get('cache-control'));
  console.log('transfer-encoding:', raw.headers.get('transfer-encoding'));
  console.log('--- raw stream ---');
  const rawText = await raw.text();
  for (const line of rawText.trimEnd().split('\n')) console.log(line ? `| ${line}` : '|');

  // Part 2: the same stream, parsed.
  console.log('--- parsed ---');
  const res = await fetch(url);
  for await (const msg of readEvents(res)) {
    if (msg.data === null) {
      console.log('no data. retry =', msg.retry, 'comments =', JSON.stringify(msg.comments));
      continue;
    }
    console.log(`event=${msg.event} id=${msg.id} data=${JSON.stringify(msg.data)}`);
  }
  console.log('stream ended');
  server.close();
});
