// The process.exit() pitfall: it skips pending work and cuts requests in flight; process.exitCode lets Node finish properly
// Run: node lessons/24-production-and-deployment/examples/06-exit-pitfall.js
//
// Each demo starts small child programs with "node -e", so the parent can watch what happens to them.
'use strict';
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');

// ---------- demo 1: pending work ----------
function runCode(code) {
  const result = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' });
  return { stdout: result.stdout.trim(), status: result.status };
}

console.log('1. Work that is scheduled but not finished yet');
const withExit = runCode(`
  setTimeout(() => console.log('flushing the last buffered log lines'), 50);
  console.log('shutdown requested');
  process.exit(0);
`);
console.log('   with process.exit(0)      ->', JSON.stringify(withExit.stdout), '| code', withExit.status);
const withExitCode = runCode(`
  setTimeout(() => console.log('flushing the last buffered log lines'), 50);
  console.log('shutdown requested');
  process.exitCode = 0;
`);
console.log('   with process.exitCode = 0 ->', JSON.stringify(withExitCode.stdout), '| code', withExitCode.status);

// ---------- demo 2: a request in flight ----------
// The child is a server whose /work endpoint needs 400 ms. 100 ms after the request arrives, the child "shuts down".
const serverCode = (shutdownLine) => `
  const http = require('node:http');
  const server = http.createServer((req, res) => {
    setTimeout(() => {
      res.setHeader('Connection', 'close'); // hang up after answering, so no idle connection keeps the process alive
      res.end('work finished');
    }, 400);
    setTimeout(() => { ${shutdownLine} }, 100);
  });
  server.listen(0, '127.0.0.1', () => console.log(server.address().port));
`;

async function tryShutdown(title, shutdownLine) {
  const child = spawn(process.execPath, ['-e', serverCode(shutdownLine)], { stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = once(child, 'exit');
  child.stdout.setEncoding('utf8');
  const [firstLine] = await once(child.stdout, 'data');
  const port = Number(firstLine.trim());
  let outcome;
  try {
    const reply = await fetch(`http://127.0.0.1:${port}/work`);
    outcome = `status ${reply.status}, body "${await reply.text()}"`;
  } catch (err) {
    outcome = `FAILED (${err.message})`;
  }
  const [code] = await exited;
  console.log(`   ${title}`);
  console.log(`     client got : ${outcome}`);
  console.log(`     child exit : ${code}`);
}

async function main() {
  console.log('2. A request that is still being handled when the shutdown code runs');
  await tryShutdown('shutdown = process.exit(0)', 'process.exit(0);');
  await tryShutdown('shutdown = server.close() and process.exitCode = 0', 'server.close(); process.exitCode = 0;');
}

main();
