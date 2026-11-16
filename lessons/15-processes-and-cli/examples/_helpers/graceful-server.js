// Helper (not run by itself): an HTTP server that shuts down cleanly when it is asked to stop.
// It is started with fork() by 04-signals.js. Argument 1: a file path where it writes a marker after cleanup.
// Run: node lessons/15-processes-and-cli/examples/_helpers/graceful-server.js out.txt   (stop it with Ctrl+C)

const http = require('node:http');
const fs = require('node:fs');

const markerFile = process.argv[2];
const server = http.createServer((req, res) => res.end('hello\n'));
let shuttingDown = false;

function shutdown(reason) {
  if (shuttingDown) return; // a second signal while we are already stopping is ignored
  shuttingDown = true;
  console.log(`shutdown requested by ${reason}`);

  // Safety net: if something hangs, give up after 3 seconds. unref() so this timer never keeps us alive.
  setTimeout(() => {
    console.log('forced exit');
    process.exit(1);
  }, 3000).unref();

  server.close(() => {
    // Cleanup goes here: flush logs, close database connections, remove temp files...
    if (markerFile) fs.writeFileSync(markerFile, 'cleanup done');
    console.log('server closed, cleanup done');
    if (process.connected) process.disconnect(); // nothing left to wait for, so Node exits by itself with 0
  });
  server.closeIdleConnections();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
// Windows cannot deliver SIGTERM to a handler, so a parent that uses fork() can ask with a message instead.
process.on('message', (message) => {
  if (message === 'shutdown') shutdown('message');
});

server.listen(0, '127.0.0.1', () => {
  console.log('server listening');
  if (process.send) process.send('ready'); // tell the parent we can be stopped now
});
