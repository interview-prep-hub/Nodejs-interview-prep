// Log, clean up, exit: the pattern for errors you did not expect
// Shows: one fatal() function, a safety timer, server.close(), and exit code 1 so a supervisor can restart the process.
// Run: node lessons/14-error-handling-and-debugging/examples/07-crash-log-then-exit.js
// @expect-fail
// This example ends with exit code 1 ON PURPOSE. A supervisor (systemd, Docker, pm2, Kubernetes) would start a fresh process.

const http = require('node:http');

const server = http.createServer((req, res) => {
  res.end('ok');
});

let shuttingDown = false;

// One function handles every fatal error: log it, stop taking new work, set the exit code, let the process drain.
function fatal(err, origin) {
  if (shuttingDown) return; // a second error during shutdown must not start a second shutdown
  shuttingDown = true;

  // 1. Log first, as one structured line. This is the most valuable thing you will have after the crash.
  console.error(JSON.stringify({ level: 'fatal', origin, name: err.name, message: err.message }));

  // 2. Safety net: if cleanup hangs, force the exit after 2 seconds. unref() so this timer never keeps the process alive.
  setTimeout(() => process.exit(1), 2000).unref();

  // 3. Stop accepting new connections. Requests already running get a chance to finish.
  server.close(() => console.log('server closed, process will exit with code 1'));
  server.closeIdleConnections();

  // 4. Set the code and let the event loop empty by itself (no process.exit, so pending output is not cut off).
  process.exitCode = 1;
}

// The 'exit' event is the very last chance to run code. Only synchronous work is possible here: no timer or I/O will ever run.
process.on('exit', (code) => console.log(`exit event: the process ends now with code ${code}`));

process.on('uncaughtException', (err, origin) => fatal(err, origin));
process.on('unhandledRejection', (reason) => fatal(reason instanceof Error ? reason : new Error(String(reason)), 'unhandledRejection'));

server.listen(0, async () => {
  const { port } = server.address();
  console.log('server is up');

  const reply = await fetch(`http://localhost:${port}/`);
  console.log('request before the bug:', reply.status, await reply.text());

  // A bug in some background job: a rejected promise that nobody awaits.
  console.log('a background job fails now...');
  Promise.reject(new Error('background sync failed'));
});
