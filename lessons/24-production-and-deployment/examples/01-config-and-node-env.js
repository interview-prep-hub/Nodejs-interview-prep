// Config from the environment: a hand-written validator that fails fast, config per environment, secrets, and what NODE_ENV really does
// Run: node lessons/24-production-and-deployment/examples/01-config-and-node-env.js
'use strict';
const { spawnSync } = require('node:child_process');
const { inspect } = require('node:util');

// ---------------------------------------------------------------------------------------------
// Part 1: the config loader. Read process.env ONCE at startup, check everything, then freeze it.
// ---------------------------------------------------------------------------------------------

// Defaults per environment (the "profile"). Note: production has NO default for secrets or the database.
const PROFILES = {
  development: { LOG_LEVEL: 'debug', PORT: '3000', DATABASE_URL: 'postgres://dev:dev@localhost:5432/app_dev', SESSION_SECRET: 'dev-only-secret-never-use-in-prod' },
  test: { LOG_LEVEL: 'warn', PORT: '0', DATABASE_URL: 'postgres://test:test@localhost:5432/app_test', SESSION_SECRET: 'test-only-secret-value' },
  production: { LOG_LEVEL: 'info', PORT: '8080' },
};

// The schema: what each variable must look like. "secret" values are never printed.
const SCHEMA = {
  DEPLOY_ENV: { type: 'enum', values: ['local', 'staging', 'production'], fallback: 'local' },
  PORT: { type: 'int', min: 0, max: 65535 },
  LOG_LEVEL: { type: 'enum', values: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] },
  DATABASE_URL: { type: 'url', secret: true },
  SESSION_SECRET: { type: 'string', minLength: 16, secret: true },
  DB_POOL_MAX: { type: 'int', min: 1, max: 100, fallback: 10 },
  SHUTDOWN_TIMEOUT_MS: { type: 'int', min: 1000, max: 120000, fallback: 10000 },
  FEATURE_NEW_CHECKOUT: { type: 'bool', fallback: false },
};

class ConfigError extends Error {
  constructor(problems) {
    super(`Invalid configuration (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n` + problems.map((p) => `  - ${p}`).join('\n'));
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

// Turns one text value into the right type. Returns { value } or { error }.
// Error messages never contain the value itself, because it might be a secret.
function parse(name, text, rule) {
  switch (rule.type) {
    case 'int': {
      const n = Number(text);
      if (text.trim() === '' || !Number.isInteger(n)) return { error: `${name} must be a whole number` };
      if (n < rule.min || n > rule.max) return { error: `${name} must be between ${rule.min} and ${rule.max}` };
      return { value: n };
    }
    case 'enum':
      return rule.values.includes(text) ? { value: text } : { error: `${name} must be one of: ${rule.values.join(', ')}` };
    case 'bool':
      if (['true', '1'].includes(text.toLowerCase())) return { value: true };
      if (['false', '0'].includes(text.toLowerCase())) return { value: false };
      return { error: `${name} must be true, false, 1 or 0` };
    case 'url':
      return URL.canParse(text) ? { value: text } : { error: `${name} is not a valid URL` };
    case 'string':
      return text.length >= (rule.minLength ?? 0) ? { value: text } : { error: `${name} must be at least ${rule.minLength} characters long` };
    default:
      throw new Error(`unknown rule type ${rule.type}`);
  }
}

function loadConfig(env) {
  const problems = [];
  const nodeEnv = env.NODE_ENV || 'development'; // unset means "development" here: a choice, see trap 2 in the NODE_ENV section
  if (!PROFILES[nodeEnv]) {
    // Stop here: without a known profile every other message would just be noise.
    throw new ConfigError([`NODE_ENV must be one of: ${Object.keys(PROFILES).join(', ')} (got "${nodeEnv}")`]);
  }
  const profile = PROFILES[nodeEnv];

  const values = {};
  for (const [name, rule] of Object.entries(SCHEMA)) {
    // Order of precedence: real environment variable, then the profile default, then the schema fallback.
    const fromEnv = env[name] !== undefined && env[name] !== '' ? env[name] : undefined;
    const text = fromEnv ?? profile[name];
    if (text === undefined) {
      if ('fallback' in rule) values[name] = rule.fallback;
      else problems.push(`${name} is required`);
      continue;
    }
    const result = parse(name, text, rule);
    if (result.error) problems.push(result.error);
    else values[name] = result.value;
  }
  if (problems.length > 0) throw new ConfigError(problems); // ALL problems at once, not one per restart
  return Object.freeze({ NODE_ENV: nodeEnv, ...values });
}

// Safe to log: secret values are replaced.
function describe(config) {
  const out = {};
  for (const [name, value] of Object.entries(config)) out[name] = SCHEMA[name]?.secret ? '***' : value;
  return out;
}

function tryLoad(title, env) {
  console.log(`   ${title}`);
  try {
    const config = loadConfig(env);
    console.log('   ok ->', inspect(describe(config), { breakLength: Infinity }));
    return config;
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.log(err.message.replace(/^/gm, '   '));
    console.log('   (a real app prints this and exits with code 1 before it opens any port)');
    return null;
  }
}

console.log('1. Environment variables are always text');
process.env.DEMO_FLAG = false; // assigning a boolean stores the TEXT "false"
console.log('   typeof process.env.DEMO_FLAG :', typeof process.env.DEMO_FLAG);
console.log('   value                        :', JSON.stringify(process.env.DEMO_FLAG));
console.log('   Boolean("false")             :', Boolean(process.env.DEMO_FLAG), '(any non-empty text is truthy)');
delete process.env.DEMO_FLAG;

console.log('2. A validated config: development works with nothing set, production does not');
tryLoad('development, empty environment:', {});
tryLoad('production, nothing else set:', { NODE_ENV: 'production' });
tryLoad('production, wrong values:', { NODE_ENV: 'production', PORT: 'eighty', DB_POOL_MAX: '0', LOG_LEVEL: 'verbose', DATABASE_URL: 'not a url', SESSION_SECRET: 'short' });
tryLoad('typo in NODE_ENV:', { NODE_ENV: 'prod', DATABASE_URL: 'postgres://u:p@db/app', SESSION_SECRET: 'a-long-enough-secret-value' });

console.log('3. A good production config: real variables override the profile, secrets stay hidden');
const config = tryLoad('production, complete:', {
  NODE_ENV: 'production',
  DEPLOY_ENV: 'staging', // NODE_ENV is "production" on staging too; this variable says WHICH production
  PORT: '9000',
  DATABASE_URL: 'postgres://app:s3cr3t-pa55@db.internal:5432/app',
  SESSION_SECRET: 'a-long-random-value-from-the-secret-store',
  FEATURE_NEW_CHECKOUT: 'true',
});
try {
  config.PORT = 1; // the file is in strict mode, so changing a frozen object throws
} catch (err) {
  console.log('   changing the config later:', err.constructor.name);
}

// ---------------------------------------------------------------------------------------------
// Part 2: NODE_ENV. Node itself ignores it. Libraries and npm read it.
// ---------------------------------------------------------------------------------------------
console.log('4. What NODE_ENV changes in Node itself: nothing');
// Start two fresh processes that differ only in NODE_ENV and print a few facts about the runtime.
const probe = 'JSON.stringify({ version: process.version, heapLimit: require("node:v8").getHeapStatistics().heap_size_limit, features: process.features, execArgv: process.execArgv })';
function fingerprint(nodeEnv) {
  const env = { ...process.env, NODE_ENV: nodeEnv };
  const result = spawnSync(process.execPath, ['-p', probe], { env, encoding: 'utf8' });
  return result.stdout.trim();
}
const production = fingerprint('production');
const development = fingerprint('development');
console.log('   runtime facts identical with NODE_ENV=production and =development:', production === development);

console.log('5. What reads NODE_ENV: libraries (and your own code)');
// This is the pattern web frameworks use: the same code, different behaviour.
function errorBody(err, nodeEnv) {
  if (nodeEnv === 'production') return { error: 'Internal Server Error' }; // do not leak internals
  return { error: err.message, type: err.name }; // helpful while developing
}
const boom = new Error('relation "orders" does not exist');
console.log('   development:', errorBody(boom, 'development'));
console.log('   production :', errorBody(boom, 'production'));
console.log('   A typo is silent: "prod" === "production" is', 'prod' === 'production', '-> that is why loadConfig() rejects unknown values');
