// Typing config and environment variables, and checking data at runtime
// Shows: process.env is always string | undefined, a typed loadConfig, a hand-written type guard, an assertion function
// Run: node lessons/21-typescript-with-node/examples/09-env-and-validation.ts

import { parseEnv } from 'node:util';

// 1. Environment variables are strings (or missing). TypeScript knows that.
const rawPort = process.env.SURELY_NOT_SET; // type: string | undefined
// @ts-expect-error Type 'string | undefined' is not assignable to type 'number'
const wishedPort: number = rawPort;
console.log('1. raw value:', rawPort, '| the "number" we wished for is:', typeof wishedPort);

// Teach TypeScript the names of YOUR variables. This is "declaration merging" on Node's own type.
// You get autocomplete in the editor. The values are still "string | undefined", because that is the truth.
// It is erased at runtime. (The file must be a module, which it is, because it has an import.)
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      DATABASE_URL?: string;
      PORT?: string;
    }
  }
}

// 2. Turn raw strings into a typed config in ONE place. The rest of the program never touches process.env.
const NODE_ENVS = ['development', 'production', 'test'] as const;
type NodeEnv = (typeof NODE_ENVS)[number];

type Config = {
  nodeEnv: NodeEnv;
  port: number;
  databaseUrl: string;
  debug: boolean;
};

function isNodeEnv(value: string): value is NodeEnv {
  return (NODE_ENVS as readonly string[]).includes(value);
}

class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

// It takes "env" as a parameter, so tests can pass a fake one instead of the real process.env.
function loadConfig(env: NodeJS.ProcessEnv): Config {
  const problems: string[] = [];

  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!isNodeEnv(nodeEnv)) problems.push(`NODE_ENV must be one of ${NODE_ENVS.join(', ')} (got "${nodeEnv}")`);

  const port = Number(env.PORT ?? '3000');
  if (!Number.isInteger(port) || port < 0 || port > 65535) problems.push(`PORT must be 0-65535 (got "${env.PORT}")`);

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) problems.push('DATABASE_URL is required');

  if (problems.length > 0 || !isNodeEnv(nodeEnv) || !databaseUrl) throw new ConfigError(problems);

  return { nodeEnv, port, databaseUrl, debug: env.DEBUG === '1' || env.DEBUG === 'true' };
}

// util.parseEnv turns the text of a .env file into an object (no file needed for this demo).
const goodText = 'NODE_ENV=production\nPORT=8080\nDATABASE_URL=postgres://localhost/app\nDEBUG=true';
console.log('2. good:', loadConfig(parseEnv(goodText)));

try {
  loadConfig(parseEnv('NODE_ENV=staging\nPORT=http'));
} catch (error) {
  if (error instanceof ConfigError) {
    console.log('   bad:', error.message);
    console.log(`   (${error.problems.length} problems)`);
  }
}

// 3. Compile-time types do NOT check data that arrives at runtime (files, network, JSON, user input).
// A type guard is a function that really checks, and tells the compiler what it found.
type ApiUser = { id: number; name: string; tags: string[] };

function isApiUser(value: unknown): value is ApiUser {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'number' &&
    typeof candidate.name === 'string' &&
    Array.isArray(candidate.tags) &&
    candidate.tags.every((tag) => typeof tag === 'string')
  );
}

function parseApiUser(text: string): ApiUser {
  const data: unknown = JSON.parse(text); // unknown on purpose, we have not checked it yet
  if (!isApiUser(data)) throw new TypeError('Response is not a valid user');
  return data; // now the compiler knows it is an ApiUser, and it really is
}

console.log('3. valid:', parseApiUser('{"id":1,"name":"Asha","tags":["admin"]}'));
for (const bad of ['{"id":"1","name":"Asha","tags":[]}', '{"id":1,"name":"Asha"}', 'null']) {
  try {
    parseApiUser(bad);
  } catch (error) {
    console.log('   rejected:', bad, '->', (error as Error).message);
  }
}

// 4. An assertion function: if it returns at all, the value has the stated type afterwards.
function assertIsString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string, got ${typeof value}`);
}
const header: unknown = 'text/plain';
assertIsString(header, 'content-type');
console.log('4.', header.toUpperCase()); // header is a string from here on
try {
  assertIsString(42, 'port');
} catch (error) {
  console.log('   ', (error as Error).message);
}
