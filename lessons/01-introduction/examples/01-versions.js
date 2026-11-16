// Versions: which Node.js, V8 and libuv are you running, and is it an LTS release?
// Run: node lessons/01-introduction/examples/01-versions.js
// Your numbers will differ if your Node version differs. That is expected.

const major = Number(process.versions.node.split('.')[0]);

console.log('Node.js    :', process.version);
console.log('V8 engine  :', process.versions.v8);
console.log('libuv      :', process.versions.uv);
console.log('Platform   :', process.platform, process.arch);

// process.release.lts is a codename (like "Krypton") on LTS lines, and undefined otherwise.
console.log('LTS name   :', process.release.lts ?? '(not an LTS release)');

// Up to Node 26 the rule was: even major numbers become LTS, odd ones never do.
// From Node 27 on, every release becomes LTS, so do not rely on this check for new versions.
console.log('Major is   :', major, major % 2 === 0 ? '(even)' : '(odd)');

// Node is one program that bundles many C and C++ libraries. Here are a few of them.
const parts = ['v8', 'uv', 'openssl', 'zlib', 'llhttp', 'undici'];
for (const name of parts) {
  console.log(`bundled ${name}`.padEnd(16), process.versions[name]);
}

console.log('Course needs Node 24 or newer:', major >= 24);
