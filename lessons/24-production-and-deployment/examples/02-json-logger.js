// Structured JSON logging: levels, child loggers, errors, secret redaction, and what a log aggregator does with the lines
// Run: node lessons/24-production-and-deployment/examples/02-json-logger.js
//
// The logger itself lives in _logger.js (about 90 lines, no dependencies). Read it after this file.
'use strict';
const { createLogger } = require('./_logger');

// A fixed clock so the output is the same on every run. Every call moves one second forward.
let seconds = 0;
const clock = () => new Date(Date.UTC(2026, 10, 10, 12, 0, seconds++));

const lines = []; // a real logger writes to stdout; here we keep the lines so we can inspect them
const log = createLogger({ level: 'info', base: { service: 'orders-api' }, write: (line) => lines.push(line), now: clock });
const show = (from) => lines.slice(from).forEach((line) => console.log('   ' + line));

console.log('1. The same event as text and as a JSON line');
console.log('   text: ', 'payment failed for order 42: card declined');
log.warn({ orderId: 42, reason: 'card_declined' }, 'payment failed');
show(0);

console.log('2. Levels: the logger is set to "info", so debug is dropped');
let mark = lines.length;
log.debug('cache lookup for key user:7'); // below the threshold: nothing is written
log.info('server started');
console.log('   lines written:', lines.length - mark, '| debug enabled:', log.isLevelEnabled('debug'), '| warn enabled:', log.isLevelEnabled('warn'));

console.log('3. Child loggers add fixed fields to every line');
mark = lines.length;
const orderLog = log.child({ module: 'checkout', orderId: 43 });
orderLog.info('cart validated');
orderLog.info({ items: 3 }, 'stock reserved');
show(mark);

console.log('4. Errors are turned into plain fields (type, message, stack, code, cause)');
mark = lines.length;
const dbError = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' });
const failure = new Error('could not load order', { cause: dbError });
orderLog.error(failure, 'request failed');
const parsed = JSON.parse(lines[mark]);
console.log('   err.type    :', parsed.err.type);
console.log('   err.message :', parsed.err.message);
console.log('   err.cause   :', parsed.err.cause.code, '-', parsed.err.cause.message);
console.log('   err.stack starts with:', JSON.stringify(parsed.err.stack.split('\n')[0]));

console.log('5. Secrets are redacted by key name, at any depth');
mark = lines.length;
log.info(
  {
    user: 'ada',
    password: 'hunter2',
    headers: { authorization: 'Bearer abc.def.ghi', accept: 'application/json' },
    payload: [{ token: 't-123', name: 'first' }],
  },
  'login attempt',
);
show(mark);
console.log('   Only KEYS are checked. A secret inside the message text is NOT found:');
mark = lines.length;
log.info('connecting to postgres://admin:hunter2@db:5432/app');
show(mark);

console.log('6. A circular object and a BigInt do not crash the logger');
mark = lines.length;
const a = { name: 'a' };
a.self = a;
log.info({ a, big: 12345678901234567890n }, 'odd values');
show(mark);

console.log('7. What a log aggregator does: parse every line, then filter and group by field');
log.info({ requestId: 'r-1', orderId: 44 }, 'order created');
log.error({ requestId: 'r-1', orderId: 44, reason: 'timeout' }, 'payment service timed out');
log.info({ requestId: 'r-2', orderId: 45 }, 'order created');
const records = lines.map((line) => JSON.parse(line)); // this works because every line is exactly one JSON document
const byLevel = {};
for (const record of records) byLevel[record.level] = (byLevel[record.level] ?? 0) + 1;
console.log('   count by level          :', byLevel);
console.log('   errors                  :', records.filter((r) => r.level === 'error').map((r) => r.msg));
console.log('   everything for r-1      :', records.filter((r) => r.requestId === 'r-1').map((r) => `${r.level}:${r.msg}`));
console.log('   plain text would need a regular expression for each of these questions');
