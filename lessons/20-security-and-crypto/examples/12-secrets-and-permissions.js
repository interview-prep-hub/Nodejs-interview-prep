// Secrets that cannot leak into logs by accident, and the Node permission model (--permission) in action
// Run: node --permission --allow-fs-read=lessons/20-security-and-crypto/examples lessons/20-security-and-crypto/examples/12-secrets-and-permissions.js
// @flags --permission --allow-fs-read=lessons/20-security-and-crypto/examples
//
// If you start it WITHOUT the flags, it restarts itself with them (so it works from any folder).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const util = require('node:util');
const { spawnSync } = require('node:child_process');

if (!process.permission) {
  // process.permission only exists when Node was started with --permission.
  const again = spawnSync(process.execPath, ['--permission', `--allow-fs-read=${__dirname}`, __filename], { stdio: 'inherit' });
  process.exit(again.status ?? 1);
}

// ======================= Part 1: secrets and logs =======================

// A wrapper that refuses to print its value. You must call .reveal() on purpose.
class Secret {
  #value;
  constructor(value) {
    this.#value = value;
  }
  reveal() {
    return this.#value;
  }
  toString() {
    return '[REDACTED]';
  }
  toJSON() {
    return '[REDACTED]';
  }
  [util.inspect.custom]() {
    return '[REDACTED]';
  }
}

const SECRET_NAME = /key|token|secret|password|passwd|credential|authorization|cookie|database_url|dsn/i; // a connection string holds a password too

// Fail fast at start-up if something is missing. Never fall back to a default secret.
function loadConfig(env) {
  const config = {};
  for (const name of ['DATABASE_URL', 'API_KEY', 'JWT_SECRET', 'PORT']) {
    if (!env[name]) throw new Error(`missing required setting ${name}`);
    config[name] = SECRET_NAME.test(name) ? new Secret(env[name]) : env[name];
  }
  return config;
}

// Redact an arbitrary object before logging it (headers, request bodies, error contexts).
function redact(value, depth = 0) {
  if (depth > 5 || value === null || typeof value !== 'object') {
    return typeof value === 'string' ? value.replace(/Bearer\s+[\w.~+/=-]+/g, 'Bearer [REDACTED]') : value;
  }
  const out = Array.isArray(value) ? [] : {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = SECRET_NAME.test(key) ? '[REDACTED]' : redact(inner, depth + 1);
  }
  return out;
}

function demoSecrets() {
  console.log('--- 1. secrets in config and logs ---');
  // util.parseEnv reads the same KEY=value text that a .env file or --env-file contains (no file needed here).
  const env = util.parseEnv('DATABASE_URL=postgres://app:pw@db.internal/app\nAPI_KEY=sk_live_abc123\nJWT_SECRET=0123456789abcdef\nPORT=3000');
  const config = loadConfig(env);
  console.log('console.log(config)   :', util.inspect(config, { breakLength: Infinity }));
  console.log('JSON.stringify(config):', JSON.stringify(config));
  console.log('template string       :', `key is ${config.API_KEY}`);
  console.log('on purpose, .reveal() :', config.API_KEY.reveal().slice(0, 7) + '...');

  try {
    loadConfig({ PORT: '3000' });
  } catch (e) {
    console.log('missing settings      :', e.message);
  }

  const requestLog = {
    method: 'POST',
    url: '/login',
    headers: { authorization: 'Bearer eyJhbGciOi.payload.sig', cookie: 'sid=abc', 'user-agent': 'curl/8' },
    body: { user: 'ann', password: 'hunter2', note: 'sent Bearer abc.def.ghi by mistake' },
  };
  console.log('redacted request log  :', JSON.stringify(redact(requestLog)));
}

// ======================= Part 2: the permission model =======================

function tryIt(label, fn) {
  try {
    const result = fn();
    console.log(label.padEnd(32), '->', result);
  } catch (e) {
    console.log(label.padEnd(32), '-> DENIED', e.code, '| permission:', e.permission);
  }
}

function demoPermissions() {
  console.log('\n--- 2. permission model ---');
  const p = process.permission;
  console.log('has fs.read  (examples dir)   :', p.has('fs.read', __dirname));
  console.log('has fs.read  (repo root)      :', p.has('fs.read', path.join(__dirname, '..', '..', '..')));
  console.log('has fs.write (examples dir)   :', p.has('fs.write', __dirname));
  console.log('has child / worker            :', p.has('child'), '/', p.has('worker'));

  const sibling = path.join(__dirname, '01-validate-and-escape.js');
  tryIt('read a sibling example file', () => fs.readFileSync(sibling, 'utf8').split(/\r?\n/)[0].slice(0, 36) + '...');
  tryIt('read ../../../package.json', () => fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8').length);
  const demoFile = path.join(os.tmpdir(), 'permission-demo.txt');
  try {
    tryIt('write a file in the temp folder', () => fs.writeFileSync(demoFile, 'x'));
  } finally {
    // Writing is denied, so nothing is created. If someone runs this with --allow-fs-write, do not leave a file behind.
    try {
      fs.rmSync(demoFile, { force: true });
    } catch {
      // removing is denied too under --permission, which is fine because nothing exists
    }
  }
  tryIt('run a child process', () => spawnSync(process.execPath, ['-v']));
  tryIt('start a worker thread', () => new (require('node:worker_threads').Worker)('1', { eval: true }));
}

// The permission model on Node 24 has NO network switch, so a local TCP connection still works.
async function demoNetworkGap() {
  console.log('\n--- 3. what it does NOT cover on Node 24 ---');
  const http = require('node:http');
  const server = http.createServer((req, res) => res.end('network is still open'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/`);
  console.log('fetch under --permission      :', await res.text());
  server.close();
  server.closeAllConnections();
}

demoSecrets();
demoPermissions();
demoNetworkGap();
