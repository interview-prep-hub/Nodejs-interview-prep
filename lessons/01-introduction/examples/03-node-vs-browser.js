// Node vs the browser: what is missing, what is extra, and what is shared
// Run: node lessons/01-introduction/examples/03-node-vs-browser.js

// typeof never throws, even for a name that does not exist. That makes it a safe test.
function show(title, names) {
  console.log(title);
  for (const name of names) {
    console.log(`  ${name.padEnd(16)} ${typeof globalThis[name]}`);
  }
}

// 1. Browser only: Node has no page, so it has no DOM and no window.
show('Browser only (undefined in Node):', ['window', 'document', 'alert', 'location', 'XMLHttpRequest']);

// 2. Shared: the same name works in both places.
show('\nShared (same in both):', ['console', 'setTimeout', 'fetch', 'URL', 'structuredClone', 'AbortController']);

// 3. Node only: the machine itself.
show('\nNode only:', ['process', 'Buffer', 'global']);

// 4. The global object has a different name in each place.
//    globalThis is the standard name. It works in Node AND in browsers.
console.log('\nglobalThis === global :', globalThis === global);
console.log('window exists         :', typeof window !== 'undefined');

// 5. A top-level var does NOT become a global in Node, because every file is wrapped
//    in a function (more on that in section 14 of the lesson).
var insideThisFile = 1;
console.log('\nglobalThis.insideThisFile:', globalThis.insideThisFile);
globalThis.reallyGlobal = 2;
console.log('reallyGlobal is visible everywhere:', typeof reallyGlobal === 'number');

// 6. require, module and __dirname feel global, but they are NOT on the global object.
console.log('\ntypeof require            :', typeof require);
console.log('typeof globalThis.require :', typeof globalThis.require);

// 7. Node can touch the machine: files, folders, the operating system.
const fs = require('node:fs');
const os = require('node:os');
const firstLine = fs.readFileSync(__filename, 'utf8').split('\n')[0];
console.log('\nFirst line of this very file:', firstLine);
console.log('os.EOL is a line break       :', JSON.stringify(os.EOL));
