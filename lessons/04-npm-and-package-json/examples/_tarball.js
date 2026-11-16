// Helper (not run by itself): builds a real .tgz in memory and computes npm-style hashes.
// A package tarball is just a gzip-compressed tar archive. Every path inside starts with "package/".
'use strict';

const crypto = require('node:crypto');
const zlib = require('node:zlib');

// One tar entry = a 512-byte header + the file bytes padded up to a multiple of 512.
function tarEntry(name, data, mode) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write(mode.toString(8).padStart(7, '0') + '\0', 100); // file mode
  header.write('0000000\0', 108); // owner id
  header.write('0000000\0', 116); // group id
  header.write(data.length.toString(8).padStart(11, '0') + '\0', 124); // size, in octal text
  header.write('00000000000\0', 136); // modified time (fixed, so the tarball is reproducible)
  header.write('        ', 148); // checksum field counts as 8 spaces while we sum the header
  header.write('0', 156); // type "0" = regular file
  header.write('ustar\0', 257);
  header.write('00', 263);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([header, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}

// files: { 'package.json': '{...}', 'index.js': '...' }  ->  Buffer with the .tgz bytes
function makeTarball(files, modes = {}) {
  const parts = Object.entries(files).map(([name, content]) =>
    tarEntry(`package/${name}`, Buffer.from(content), modes[name] || 0o644));
  parts.push(Buffer.alloc(1024)); // two empty blocks mark the end of a tar archive
  return zlib.gzipSync(Buffer.concat(parts), { level: 9 });
}

// The "integrity" string stored in package-lock.json: algorithm, a dash, base64 of the hash.
function integrityOf(buffer) {
  return 'sha512-' + crypto.createHash('sha512').update(buffer).digest('base64');
}

// The older sha1 "shasum" npm still reports next to the integrity value.
function shasumOf(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

module.exports = { makeTarball, integrityOf, shasumOf };
