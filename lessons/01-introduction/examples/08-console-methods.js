// Console methods: log, format codes, table, group, dir, count, time and the stderr family
// Run: node lessons/01-introduction/examples/08-console-methods.js
// The lines written by console.error, console.warn and console.assert go to stderr,
// so a test run that only captures stdout does not see them.

// 1. log takes any number of values and puts a space between them.
console.log('1. values:', 42, true, [1, 2], { a: 1 });

// 2. Format codes: %s string, %d number, %j JSON, %% a literal percent sign.
console.log('2. %s is %d years old, data: %j, done at 100%%', 'Sam', 30, { ok: true });

// 3. info is another name for log. Both write to stdout.
console.info('3. info writes to stdout, just like log');

// 4. error and warn write to stderr (the second output channel, meant for problems).
console.error('4. this line goes to stderr');
console.warn('5. so does this one');

// 6. table shows an array of objects as a table.
console.log('6. table:');
console.table([
  { name: 'Ada', age: 36 },
  { name: 'Linus', age: 55 },
]);

// 7. group indents everything until the matching groupEnd.
console.log('7. group:');
console.group('Server');
console.log('starting');
console.group('Database');
console.log('connected');
console.groupEnd();
console.log('ready');
console.groupEnd();

// 8. log only prints 2 levels deep. dir lets you choose the depth.
const deep = { level1: { level2: { level3: { level4: 'bottom' } } } };
console.log('8. log :', deep);
console.dir(deep, { depth: null }); // null means "all levels"

// 9. count keeps a counter per label.
console.count('visits');
console.count('visits');
console.count('other');

// 10. time and timeEnd measure how long something took. The number differs on every run.
console.time('loop');
let sum = 0;
for (let i = 0; i < 1e6; i++) sum += i;
console.timeEnd('loop');
console.log('sum is', sum);

// 11. assert prints to stderr only when the condition is false (and does NOT stop the program).
console.assert(1 + 1 === 3, '11. assert: math is broken');
console.log('still running after a failed assert');
