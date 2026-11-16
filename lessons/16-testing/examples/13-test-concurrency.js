// --test-concurrency: how many test FILES the runner executes at the same time
// Run: node lessons/16-testing/examples/13-test-concurrency.js
//
// It builds a temp folder with two test files that each sleep 300 ms, then runs `node --test`
// twice: one file at a time, and both files at the same time. It also proves that every file ran in its
// own process by collecting the process ids. Plain script (not a test file).
// The seconds printed are real measurements, so they differ on every run and machine.

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FILES = ['a', 'b'];
const SLEEP_MS = 300;

// Every file records its own process id, then sleeps for SLEEP_MS.
const testSource = `
const { test } = require('node:test');
const fs = require('node:fs');
test('sleeps for ${SLEEP_MS} ms', async () => {
  fs.appendFileSync(process.env.PIDS_FILE, process.pid + '\\n');
  await new Promise((resolve) => setTimeout(resolve, ${SLEEP_MS}));
});
`;

function runTests(cwd, concurrency, pidsFile) {
  const started = performance.now();
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--test', `--test-concurrency=${concurrency}`],
      { cwd, encoding: 'utf8', env: { ...process.env, PIDS_FILE: pidsFile } },
      (error, stdout) => {
        const seconds = (performance.now() - started) / 1000;
        const passed = /ℹ pass (\d+)/.exec(stdout)?.[1];
        resolve({ seconds, passed: Number(passed), failed: Boolean(error) });
      },
    );
  });
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'concurrency-'));
  try {
    for (const name of FILES) fs.writeFileSync(path.join(tmp, `${name}.test.js`), testSource);

    console.log('The default is os.availableParallelism() - 1, which is', os.availableParallelism() - 1, 'on this machine.');
    console.log(`Running ${FILES.length} test files that each sleep ${SLEEP_MS} ms:\n`);

    for (const concurrency of [1, FILES.length]) {
      const pidsFile = path.join(tmp, `pids-${concurrency}.txt`);
      const result = await runTests(tmp, concurrency, pidsFile);
      const pids = new Set(fs.readFileSync(pidsFile, 'utf8').split('\n').filter(Boolean));
      console.log(
        `--test-concurrency=${concurrency}: ${result.passed} tests passed in about ${result.seconds.toFixed(1)} s,`,
        `${pids.size} different processes, exit ok: ${!result.failed}`,
      );
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main();
