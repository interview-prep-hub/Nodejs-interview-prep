// Module hooks (advanced): watch every resolve and load, and serve a module that has no file
// Run: node lessons/03-modules/examples/12-module-hooks.js
// module.registerHooks() was added in Node 23.5 and 22.15 and is a release candidate since Node 24.13.1.

const path = require('node:path');
const { registerHooks } = require('node:module');

const seen = [];

// A hook is a function that Node calls on every resolve (find the file) or load (read the
// source). It can look, change the result, or answer by itself. `nextResolve` and `nextLoad`
// call the normal Node behaviour.
const registration = registerHooks({
  resolve(specifier, context, nextResolve) {
    // Answer by ourselves: "virtual:greeting" is not a file, it is a name we made up.
    if (specifier === 'virtual:greeting') {
      return { url: 'virtual:greeting', format: 'module', shortCircuit: true };
    }
    seen.push(specifier);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'virtual:greeting') {
      return {
        format: 'module',
        source: 'export default "hello from a module that has no file";',
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

// The same hooks see require() and import().
require('./_lib/literal-exports.js');

async function main() {
  await import('./_lib/shapes.mjs');
  console.log('1. specifiers seen by the resolve hook:', seen.map((s) => path.basename(s)));

  const virtual = await import('virtual:greeting');
  console.log('2. virtual module ->', virtual.default);

  // Always unhook when you are done: hooks affect every module loaded afterwards.
  registration.deregister();
  try {
    await import('virtual:other');
  } catch (error) {
    console.log('3. after deregister() the hook is gone ->', error.code);
  }
}

main();
