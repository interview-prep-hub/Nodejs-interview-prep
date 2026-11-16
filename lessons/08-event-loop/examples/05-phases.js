// A tour of the event loop phases
// Shows: where a timer, a setImmediate, an I/O callback and a close callback run, and where nextTick/promises fit in.
// Run: node lessons/08-event-loop/examples/05-phases.js

const fs = require('node:fs');
const net = require('node:net');

// Part 2 starts at the end of part 1. It shows the poll phase leading into the check phase.
function partTwo() {
  console.log('\n--- part 2: start from an I/O callback ---');
  fs.readFile(__filename, () => {
    console.log('[poll]    fs.readFile callback (I/O)');
    setTimeout(() => console.log('[timers]  setTimeout 0 made in the I/O callback (next turn)'), 0);
    setImmediate(() => console.log('[check]   setImmediate made in the I/O callback (same turn)'));
  });
}

// Part 1 starts from a timer callback, so we know we are in the timers phase.
function partOne(clientSocket, serverSocket, server) {
  console.log('[timers]  a timer callback is running');

  clientSocket.on('close', () => {
    console.log('[close]   socket close event (close callbacks phase)');
    serverSocket.destroy();
    server.close();
  });
  clientSocket.destroy(); // the handle is closed in the close callbacks phase of this turn

  setTimeout(() => {
    console.log('[timers]  setTimeout 0 made in the timer callback (next turn)');
    partTwo();
  }, 0);
  setImmediate(() => console.log('[check]   setImmediate made in the timer callback (same turn)'));
  process.nextTick(() => console.log('          nextTick: runs right after the timer callback'));
  Promise.resolve().then(() => console.log('          promise: runs right after the nextTick queue'));
}

console.log('--- part 1: start from a timer callback ---');
let serverSocket;
const server = net.createServer((socket) => {
  serverSocket = socket;
});
server.listen(0, '127.0.0.1', () => {
  const clientSocket = net.connect(server.address().port, '127.0.0.1');
  clientSocket.on('connect', () => {
    setTimeout(() => partOne(clientSocket, serverSocket, server), 5);
  });
});
