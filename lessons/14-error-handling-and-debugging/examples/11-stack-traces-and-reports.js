// Better stack traces: reading frames, stackTraceLimit, async stack traces, source maps, diagnostic reports, trace flags
// Shows: how to get more (and more useful) information out of an error after it happened.
// Run: node lessons/14-error-handling-and-debugging/examples/11-stack-traces-and-reports.js

const { execFile, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: sleep } = require('node:timers/promises');

// Split "at fn (file:line:col)" into pieces. Paths are shortened to the file name so the output is the same on every machine.
function parseFrames(stack) {
  return stack
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at '))
    .map((line) => {
      const m = line.match(/^at (?:(async )?(.+?) \()?(.+?):(\d+):(\d+)\)?$/);
      if (!m) return { fn: line.slice(3), file: '?', line: 0, col: 0, internal: false };
      const [, isAsync, fn = '(anonymous)', file, row, col] = m;
      return {
        fn: (isAsync ? 'async ' : '') + fn,
        file: file.startsWith('node:') ? file : path.basename(file),
        line: Number(row),
        col: Number(col),
        internal: file.startsWith('node:'),
      };
    });
}
const userFrames = (stack) => parseFrames(stack).filter((f) => !f.internal);

// ---------------------------------------------------------------------------
console.log('1. Reading a stack trace, top to bottom');
function parseUser(text) {
  const data = JSON.parse(text);
  return data.profile.name.toUpperCase(); // the bug: profile has no name
}
function loadUser(text) {
  return parseUser(text);
}
function handleRequest() {
  return loadUser('{"profile":{}}');
}
try {
  handleRequest();
} catch (e) {
  console.log('  line 1 is the message  :', e.stack.split('\n')[0]);
  console.log('  then one line per call, newest call first:');
  for (const f of userFrames(e.stack)) {
    console.log(`    ${f.fn.padEnd(20)} ${f.file} line ${f.line}, column ${f.col}`);
  }
  const inside = parseFrames(e.stack).length - userFrames(e.stack).length;
  console.log(`    ...plus ${inside} more frames from node:internal (Node's own module loader). Skip those.`);
  console.log('  read it like this: handleRequest called loadUser, which called parseUser, which failed at line', userFrames(e.stack)[0].line);
}

// ---------------------------------------------------------------------------
console.log('2. Error.stackTraceLimit decides how many frames are kept (default 10)');
function recurse(n) {
  return n === 0 ? new Error('bottom') : recurse(n - 1);
}
const countFrames = (e) => parseFrames(e.stack).length;
console.log('  default limit        :', Error.stackTraceLimit, '-> frames kept:', countFrames(recurse(50)));
Error.stackTraceLimit = 3;
console.log('  limit 3              ->', countFrames(recurse(50)), 'frames');
Error.stackTraceLimit = 0;
console.log('  limit 0              -> stack is only the header:', JSON.stringify(recurse(50).stack));
Error.stackTraceLimit = Infinity;
console.log('  limit Infinity       ->', countFrames(recurse(50)), 'frames (every call is kept)');
Error.stackTraceLimit = 10;
console.log('  from the command line: node --stack-trace-limit=50 app.js');

// ---------------------------------------------------------------------------
async function main() {
  console.log('3. Async stack traces: await keeps the chain, callbacks and .then do not');
  async function readRow() {
    await sleep(1);
    throw new Error('row is missing');
  }
  async function loadPage() {
    await readRow();
  }
  async function render() {
    await loadPage();
  }
  await render().catch((e) => console.log('  with await :', userFrames(e.stack).map((f) => f.fn).join(' <- ')));

  await new Promise((resolve) => {
    sleep(1)
      .then(function inThen() {
        throw new Error('inside then');
      })
      .catch((e) => {
        console.log('  with .then :', userFrames(e.stack).map((f) => f.fn).join(' <- '), '(who started the chain is not recorded)');
        resolve();
      });
  });

  await new Promise((resolve) => {
    setTimeout(function inTimer() {
      console.log('  in a timer :', userFrames(new Error('x').stack).map((f) => f.fn).join(' <- '), '(starts fresh)');
      resolve();
    }, 1);
  });

  // -------------------------------------------------------------------------
  console.log('4. Source maps: --enable-source-maps shows the ORIGINAL file and line');
  // A tool such as tsc or esbuild turns src/app.ts into out.js plus a map. We fake the tool's output by hand.
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'maps14-'));
  const map = { version: 3, file: 'out.js', sources: ['src/app.ts'], names: [], mappings: 'AASA;AACE;AACF;AAEA' };
  const generated = [
    'function boom() {',
    "  throw new Error('mapped');",
    '}',
    "try { boom(); } catch (e) { console.log(e.stack.split('\\n')[1].trim()); }",
    `//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}`,
  ].join('\n');
  const outFile = path.join(folder, 'out.js');
  fs.writeFileSync(outFile, generated);
  for (const flags of [[], ['--enable-source-maps']]) {
    const run = spawnSync(process.execPath, [...flags, outFile], { encoding: 'utf8' });
    const frame = run.stdout.trim().replace(folder, '<tmp>').replaceAll('\\', '/');
    console.log(`  ${(flags[0] ?? '(no flag)').padEnd(20)} ${frame}`);
  }
  fs.rmSync(folder, { recursive: true, force: true });

  // -------------------------------------------------------------------------
  console.log('5. Diagnostic report: a JSON snapshot of the process (stacks, memory, handles, versions)');
  const live = process.report.getReport();
  console.log('  sections        :', Object.keys(live).join(', '));
  console.log('  header.event    :', live.header.event, '| nodejsVersion:', live.header.nodejsVersion);
  console.log('  automatic reports are off by default:', {
    onFatalError: process.report.reportOnFatalError,
    onUncaughtException: process.report.reportOnUncaughtException,
    onSignal: process.report.reportOnSignal,
  });

  // Ask Node to write a report when an exception is not caught, then crash a child on purpose.
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'report14-'));
  const crashFile = path.join(work, 'crash-me.js');
  fs.writeFileSync(crashFile, "function fail() {\n  throw new TypeError('boom in child');\n}\nfail();\n");
  const child = spawnSync(
    process.execPath,
    ['--report-uncaught-exception', `--report-directory=${work}`, '--report-filename=crash.json', crashFile],
    { encoding: 'utf8' },
  );
  const report = JSON.parse(fs.readFileSync(path.join(work, 'crash.json'), 'utf8'));
  console.log('  child exit code :', child.status);
  console.log('  report event    :', report.header.event);
  console.log('  report message  :', report.javascriptStack.message);
  console.log('  report top frame:', report.javascriptStack.stack[0].replace(work, '<tmp>').replaceAll('\\', '/'));
  fs.rmSync(work, { recursive: true, force: true });
  console.log('  other switches  : --report-on-fatalerror (out of memory), --report-on-signal, process.report.writeReport()');

  // The next two parts start several child processes. They run at the same time, so the example stays fast.
  const runNode = (args) =>
    new Promise((resolve) => {
      execFile(process.execPath, args, { encoding: 'utf8' }, (error, stdout, stderr) => resolve({ stdout, stderr }));
    });

  const lab = fs.mkdtempSync(path.join(os.tmpdir(), 'trace14-'));
  const warnFile = path.join(lab, 'warn.js');
  fs.writeFileSync(
    warnFile,
    [
      "const { EventEmitter } = require('node:events');",
      'function addListeners() {',
      '  const emitter = new EventEmitter();',
      "  for (let i = 0; i < 11; i++) emitter.on('tick', () => {});", // the 11th listener triggers a warning
      '}',
      'addListeners();',
    ].join('\n'),
  );
  const throwFile = path.join(lab, 'throw.js');
  fs.writeFileSync(throwFile, "function fail() {\n  throw 'a plain string';\n}\nfail();\n");
  const stderrOf = async (flags, file) => (await runNode([...flags, file])).stderr.replaceAll(lab, '<tmp>').replaceAll('\\', '/');
  const pick = (text, pattern) => (text.split('\n').find((line) => pattern.test(line)) ?? '(not found)').trim();

  // Start every child now, read the answers below.
  const waitingChild = runNode(['-e', 'setTimeout(() => {}, 100); console.log(process.getActiveResourcesInfo().join(","))']);
  const started = [
    stderrOf([], warnFile),
    stderrOf(['--trace-warnings'], warnFile),
    stderrOf([], throwFile),
    stderrOf(['--trace-uncaught'], throwFile),
  ];

  // "Why does my process not exit?" Ask which resources still keep the event loop alive.
  console.log('  getActiveResourcesInfo() in a child that waits for one timer:', (await waitingChild).stdout.trim());

  // -------------------------------------------------------------------------
  console.log('6. Two flags that show WHERE a warning or a non-error throw came from');
  const [warnPlain, warnTraced, throwPlain, throwTraced] = await Promise.all(started);
  console.log('  warning, no flag               :', pick(warnPlain, /Use `node/));
  console.log('  warning, --trace-warnings      :', pick(warnTraced, /at addListeners/));
  console.log('  throw "text", no flag          :', pick(throwPlain, /Use `node/));
  console.log('  throw "text", --trace-uncaught :', pick(throwTraced, /at fail/));
  console.log('  also useful: --trace-deprecation, --throw-deprecation, --trace-exit, --trace-sync-io');
  fs.rmSync(lab, { recursive: true, force: true });
}

main();
