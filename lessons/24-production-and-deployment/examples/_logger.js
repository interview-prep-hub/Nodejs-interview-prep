// Helper, not run by itself: a tiny structured JSON logger used by several examples in this lesson.
// It is explained and demonstrated in examples/02-json-logger.js
'use strict';

// Same numbers that pino uses, so you can compare them later.
const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };

// Keys whose values must never reach a log file. Compared in lower case.
const DEFAULT_REDACT = ['password', 'passwd', 'secret', 'token', 'accesstoken', 'refreshtoken', 'apikey', 'authorization', 'cookie', 'set-cookie'];

const MAX_DEPTH = 8;

function serializeError(err, redactKeys, seen, depth) {
  const out = { type: err.name, message: err.message, stack: err.stack };
  if (err.code !== undefined) out.code = err.code;
  if (err.cause !== undefined) out.cause = sanitize(err.cause, redactKeys, seen, depth + 1);
  return out;
}

// Turns any value into something JSON.stringify can never choke on:
// errors become plain objects, circular references become '[Circular]', BigInt becomes text,
// and values stored under a secret-looking key become '[REDACTED]'.
function sanitize(value, redactKeys, seen = new Set(), depth = 0) {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return serializeError(value, redactKeys, seen, depth);
  if (typeof value.toJSON === 'function') return value.toJSON(); // Date, URL, Buffer, ...
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Too deep]';
  seen.add(value);
  let out;
  if (Array.isArray(value)) {
    out = value.map((item) => sanitize(item, redactKeys, seen, depth + 1));
  } else {
    out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = redactKeys.has(key.toLowerCase()) ? '[REDACTED]' : sanitize(item, redactKeys, seen, depth + 1);
    }
  }
  seen.delete(value); // only real cycles count, a value used twice side by side is fine
  return out;
}

function build(settings, bindings) {
  const log = {};
  for (const [name, number] of Object.entries(LEVELS)) {
    log[name] = (first, second) => {
      if (number < settings.threshold) return; // a disabled level costs one comparison
      // Supported calls: log.info('text'), log.info({ userId: 7 }, 'text'), log.error(err, 'text')
      let fields = {};
      let msg = '';
      if (typeof first === 'string') {
        msg = first;
      } else if (first instanceof Error) {
        fields = { err: first };
        msg = second ?? first.message;
      } else {
        fields = first ?? {};
        msg = second ?? '';
      }
      const fromContext = settings.context ? settings.context.getStore() : undefined;
      const record = { level: name, time: settings.now().toISOString(), ...bindings, ...fromContext, ...fields, msg };
      settings.write(JSON.stringify(sanitize(record, settings.redactKeys)));
    };
  }
  // A child logger adds fixed fields to every line it writes (module name, order id, ...).
  log.child = (extra) => build(settings, { ...bindings, ...extra });
  log.isLevelEnabled = (name) => LEVELS[name] >= settings.threshold;
  return log;
}

// options:
//   level    lowest level that is written (default 'info')
//   base     fields on every line, for example { service: 'orders-api' }
//   write    function that receives one finished JSON line (default: stdout)
//   now      function that returns a Date (tests pass a fixed clock)
//   redact   extra key names to hide
//   context  an AsyncLocalStorage; whatever object is in its store is added to every line
function createLogger(options = {}) {
  const { level = 'info', base = {}, write = (line) => process.stdout.write(line + '\n'), now = () => new Date(), redact = [], context = null } = options;
  if (!(level in LEVELS)) throw new RangeError(`unknown log level: ${level}`);
  const redactKeys = new Set([...DEFAULT_REDACT, ...redact].map((key) => key.toLowerCase()));
  return build({ threshold: LEVELS[level], write, now, redactKeys, context }, base);
}

module.exports = { createLogger, LEVELS };
