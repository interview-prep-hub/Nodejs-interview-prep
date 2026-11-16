// The layers of Node.js: your JS, core JS, C++ bindings, V8, libuv and the bundled C libraries
// Shows: process.versions lists the bundled parts, core functions are plain JS that call a binding, and require('node:http') pulls in native bindings.
// Run: node lessons/23-node-internals/examples/01-layers.js

// Take a snapshot of what Node has loaded so far, then load node:http. (We do this before the
// first console.log, because console.log itself loads the stream modules.)
const loadedAtStart = process.moduleLoadList.slice();
require('node:http');
const loadedAfterHttp = process.moduleLoadList.slice();

const fs = require('node:fs');

// ---- Part 1: the parts that are compiled into the node binary -------------
// Every key of process.versions is a library (or the Node version itself).
const parts = [
  ['node', 'Node.js itself (core JS library + C++ bindings)'],
  ['v8', 'JavaScript engine: parser, interpreter, JIT compilers, garbage collector'],
  ['uv', 'libuv: event loop, thread pool, sockets, files, timers'],
  ['openssl', 'TLS and crypto'],
  ['zlib', 'gzip and deflate (node:zlib)'],
  ['llhttp', 'HTTP/1 parser used by node:http'],
  ['ares', 'c-ares: asynchronous DNS queries (dns.resolve*)'],
  ['undici', 'HTTP client behind the global fetch()'],
  ['icu', 'Unicode, Intl, time zones'],
  ['nghttp2', 'HTTP/2 framing (node:http2)'],
];
console.log('Part 1: bundled parts (versions are from the node binary running this file)');
for (const [key, what] of parts) {
  console.log(`  ${key.padEnd(8)} ${String(process.versions[key]).padEnd(22)} ${what}`);
}

// ---- Part 2: a core function is ordinary JavaScript that calls a binding -----
// Function.prototype.toString() works on core functions too, so we can read their source.
console.log('\nPart 2: the source of fs.statSync, written in JavaScript inside Node:');
console.log(fs.statSync.toString());

// ---- Part 3: loading a module can load native bindings -------------------
// process.moduleLoadList is not a documented API, but it lists what Node has loaded so far.
const names = (list, prefix) => list.filter((x) => x.startsWith(prefix)).map((x) => x.slice(prefix.length));
const added = loadedAfterHttp.filter((x) => !loadedAtStart.includes(x));
console.log('\nPart 3: what require("node:http") loaded');
console.log('  native bindings added:', names(added, 'Internal Binding ').join(', '));
console.log('  core JS files added  :', names(added, 'NativeModule ').length);

// ---- Part 4: ABI numbers for native addons -----------------------------------
console.log('\nPart 4: numbers native addons care about');
console.log('  process.versions.modules (NODE_MODULE_VERSION):', process.versions.modules);
console.log('  process.versions.napi (highest Node-API version):', process.versions.napi);

// ---- Part 5: how this node binary was built ------------------------------------------------
// process.config holds the build settings. Most libraries are linked INTO the binary ("shared: false").
const vars = process.config.variables;
console.log('\nPart 5: build settings (process.config.variables)');
for (const key of ['node_use_node_snapshot', 'node_shared', 'node_shared_libuv', 'node_shared_openssl', 'v8_enable_maglev', 'v8_enable_webassembly']) {
  console.log(`  ${key.padEnd(24)} ${vars[key]}`);
}
