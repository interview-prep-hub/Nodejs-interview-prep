// Helper (not run by itself): runs the npm that ships next to this node binary, in a sandbox.
// The sandbox means: your own ~/.npmrc, your npm cache and your global folder are never touched.
// Without a registry URL, npm runs with --offline. With one, it talks only to that URL
// (the pretend registry on localhost from _local-registry.js).
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// npm is a big program and starting it can take a few seconds on a slow or busy machine.
// All npm calls of one example share this time budget, so an example never hangs for long.
// When the budget runs out the example stops and exits with code 1 (its output would be incomplete).
// On a very slow machine you can raise it: NPM_EXAMPLE_BUDGET_MS=60000 (PowerShell: $env:NPM_EXAMPLE_BUDGET_MS=60000).
const BUDGET_MS = Number(process.env.NPM_EXAMPLE_BUDGET_MS) || 18000;

function findNpmCli() {
  const nodeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), // Windows layout
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), // macOS and Linux layout
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

// Returns null when npm cannot be found, so an example can print a friendly message and stop.
function createNpm(sandbox, registryUrl) {
  const cli = findNpmCli();
  if (!cli) return null;
  fs.mkdirSync(sandbox, { recursive: true });
  const userConfig = path.join(sandbox, 'user.npmrc');
  const globalConfig = path.join(sandbox, 'global.npmrc');
  fs.writeFileSync(userConfig, '');
  fs.writeFileSync(globalConfig, '');
  fs.mkdirSync(path.join(sandbox, 'global'), { recursive: true }); // npm link needs the global folder to exist
  const env = {
    ...process.env,
    npm_config_userconfig: userConfig,
    npm_config_globalconfig: globalConfig,
    npm_config_cache: path.join(sandbox, 'cache'),
    npm_config_prefix: path.join(sandbox, 'global'),
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    npm_config_loglevel: 'notice',
  };
  if (registryUrl) env.npm_config_registry = registryUrl;
  else env.npm_config_offline = 'true';

  const deadline = Date.now() + BUDGET_MS;
  const running = new Set();
  let allStopped = null; // set once the budget has ended: resolves when every npm process is gone

  const timeoutError = (args) => {
    const err = new Error(`"npm ${args.join(' ')}" was still running when the time budget ended`);
    err.code = 'NPM_TIMEOUT';
    return err;
  };

  // Stop every running npm process and wait until they are really gone,
  // so that the example can delete its temp folder afterwards.
  const stopEverything = () => {
    if (!allStopped) {
      allStopped = Promise.all([...running].map((child) => new Promise((done) => {
        child.once('close', done);
        child.kill();
      })));
    }
    return allStopped;
  };

  // Returns a promise of { status, stdout, stderr }. Several calls can run at the same time.
  return function npm(args, cwd, extraEnv = {}) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const child = spawn(process.execPath, [cli, ...args], {
        cwd,
        env: { ...env, ...extraEnv },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      running.add(child);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => (stdout += chunk));
      child.stderr.on('data', (chunk) => (stderr += chunk));
      const timer = setTimeout(() => {
        stopEverything().then(() => reject(timeoutError(args)));
      }, Math.max(500, deadline - Date.now()));
      child.on('close', (status) => {
        clearTimeout(timer);
        running.delete(child);
        // NPM_EXAMPLE_TRACE=1 prints how long every npm call took (on stderr), to find what is slow on your machine.
        if (process.env.NPM_EXAMPLE_TRACE) console.error(`[trace] npm ${args.join(' ')}: ${Date.now() - startedAt} ms`);
        if (allStopped) allStopped.then(() => reject(timeoutError(args))); // it was stopped by the budget
        else resolve({ status, stdout: stdout.trim(), stderr: stderr.trim() });
      });
    });
  };
}

// Run an example's main(). If npm was too slow, say so and FAIL (exit code 1): a run that was cut short
// must never look like a success, because its output is incomplete. Real errors fail too.
function guard(main) {
  return main().catch((err) => {
    if (err.code !== 'NPM_TIMEOUT') throw err;
    const script = path.relative(process.cwd(), process.argv[1]).split(path.sep).join('/');
    console.log(`\nStopped early: ${err.message}.`);
    console.log('npm is slow to start on a busy machine, so the result of this run is incomplete.');
    console.log('Run the example again when things are quiet, or give npm more time:');
    console.log(`  bash:       NPM_EXAMPLE_BUDGET_MS=60000 node ${script}`);
    console.log(`  PowerShell: $env:NPM_EXAMPLE_BUDGET_MS=60000; node ${script}`);
    process.exitCode = 1;
  });
}

// Delete a temp folder. Best effort: a busy Windows file must not make the example fail.
function removeTemp(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // it is only a temp folder
  }
}

module.exports = { createNpm, findNpmCli, guard, removeTemp };
