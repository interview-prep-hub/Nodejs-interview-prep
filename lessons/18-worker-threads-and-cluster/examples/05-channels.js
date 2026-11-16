// MessageChannel and BroadcastChannel
// Shows: two workers talking to each other directly, one message reaching many threads, and reading a port synchronously.
// Run: node lessons/18-worker-threads-and-cluster/examples/05-channels.js

const {
  Worker,
  isMainThread,
  parentPort,
  workerData,
  threadId,
  MessageChannel,
  BroadcastChannel,
  receiveMessageOnPort,
} = require('node:worker_threads');

// ---- main thread side ----

// Collect `count` messages sent by workers to the main thread, then resolve with all of them.
function collect(workers, count) {
  return new Promise((resolve) => {
    const seen = [];
    for (const worker of workers) {
      worker.on('message', (msg) => {
        seen.push(msg);
        if (seen.length === count) resolve(seen);
      });
    }
  });
}

async function main() {
  console.log('--- Part 1: MessageChannel, worker talks to worker ---');
  // A channel has two ends. Whatever is posted on one end arrives on the other end.
  const { port1, port2 } = new MessageChannel();
  // A port can only travel inside a message if it is also in the transfer list.
  const a = new Worker(__filename, { workerData: { role: 'ping', port: port1 }, transferList: [port1] });
  const b = new Worker(__filename, { workerData: { role: 'pong', port: port2 }, transferList: [port2] });
  const talk = await collect([a, b], 2);
  console.log(talk.sort().join('\n'));
  await Promise.all([a, b].map((w) => new Promise((resolve) => w.once('exit', resolve))));

  console.log('\n--- Part 2: BroadcastChannel, one message to many threads ---');
  const channel = new BroadcastChannel('news'); // every thread that opens the name "news" is on the same channel
  let heardItself = false;
  channel.onmessage = () => (heardItself = true);
  const listeners = [1, 2, 3].map(() => new Worker(__filename, { workerData: { role: 'listener' } }));
  const heard = collect(listeners, 3 + 3); // each listener sends 'ready' and later 'heard ...'
  let ready = 0;
  for (const w of listeners) {
    w.on('message', (msg) => {
      if (msg === 'ready' && ++ready === 3) channel.postMessage('hello everyone');
    });
  }
  const all = await heard;
  console.log(all.filter((m) => m !== 'ready').sort().join('\n'));
  await new Promise((resolve) => setTimeout(resolve, 30)); // give a (wrong) echo to the sender time to show up
  console.log('did the sender hear its own post?', heardItself);
  channel.close(); // an open BroadcastChannel keeps the process alive, so always close it

  console.log('\n--- Part 3: receiveMessageOnPort reads synchronously ---');
  const pair = new MessageChannel();
  pair.port1.postMessage({ n: 1 });
  pair.port1.postMessage({ n: 2 });
  console.log(receiveMessageOnPort(pair.port2)); // { message: { n: 1 } }
  console.log(receiveMessageOnPort(pair.port2)); // { message: { n: 2 } }
  console.log(receiveMessageOnPort(pair.port2)); // undefined, the queue is empty
  pair.port1.close();
}

// ---- worker thread side ----

function workerMain() {
  const { role, port } = workerData;

  if (role === 'ping') {
    port.postMessage('ping from A'); // fine even if B is not listening yet: the message waits in the queue
    port.on('message', (msg) => {
      parentPort.postMessage(`A received: ${msg}`);
      port.close(); // closing one end closes the other end too, so both workers can finish
    });
  } else if (role === 'pong') {
    port.on('message', (msg) => {
      parentPort.postMessage(`B received: ${msg}`);
      port.postMessage('pong from B');
    });
  } else if (role === 'listener') {
    const channel = new BroadcastChannel('news');
    channel.onmessage = (event) => {
      parentPort.postMessage(`thread ${threadId} heard: ${event.data}`);
      channel.close();
    };
    parentPort.postMessage('ready'); // tell main we are subscribed, so it does not post too early
  }
}

if (isMainThread) {
  main();
} else {
  workerMain();
}
