// Reading and writing files: text vs bytes, encodings, flags, append and truncate
// Run: node lessons/06-file-system/examples/02-read-write-append.js
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fs-rw-'));
  const file = path.join(dir, 'notes.txt');

  try {
    // --- Text vs Buffer ---------------------------------------------------
    await fsp.writeFile(file, 'caf\u00e9'); // "cafe" with an accent: 4 characters
    const asBuffer = await fsp.readFile(file); // no encoding -> Buffer
    const asText = await fsp.readFile(file, 'utf8'); // with encoding -> string
    console.log('Buffer :', asBuffer);
    console.log('string :', asText.length, 'characters,', asBuffer.length, 'bytes');
    console.log('hex    :', await fsp.readFile(file, 'hex'));
    console.log('base64 :', await fsp.readFile(file, 'base64'));

    // --- writeFile replaces the whole file --------------------------------
    await fsp.writeFile(file, 'first');
    await fsp.writeFile(file, 'second');
    console.log('after two writeFile calls:', await fsp.readFile(file, 'utf8'));

    // --- appendFile adds to the end, and creates the file if needed -------
    await fsp.appendFile(file, '\nthird');
    await fsp.appendFile(path.join(dir, 'log.txt'), 'line 1\n');
    await fsp.appendFile(path.join(dir, 'log.txt'), 'line 2\n');
    console.log('append  :', JSON.stringify(await fsp.readFile(file, 'utf8')));
    console.log('log.txt :', JSON.stringify(await fsp.readFile(path.join(dir, 'log.txt'), 'utf8')));

    // --- Flags ------------------------------------------------------------
    // 'w' (default for writeFile) truncates, 'a' appends, 'wx' fails if the file exists.
    await fsp.writeFile(file, 'with flag a', { flag: 'a' }); // same as appendFile
    console.log("flag 'a':", JSON.stringify(await fsp.readFile(file, 'utf8')));

    try {
      await fsp.writeFile(file, 'overwrite?', { flag: 'wx' });
    } catch (err) {
      console.log("flag 'wx' on existing file ->", err.code);
    }
    await fsp.writeFile(path.join(dir, 'fresh.txt'), 'created', { flag: 'wx' });
    console.log("flag 'wx' on a new file    -> ok");

    try {
      await fsp.open(path.join(dir, 'ghost.txt'), 'r+').then((fh) => fh.close());
    } catch (err) {
      console.log("flag 'r+' on missing file ->", err.code);
    }

    // --- truncate: cut the file to a length (or stretch it) ---------------
    await fsp.writeFile(file, '0123456789');
    await fsp.truncate(file, 4);
    console.log('truncate to 4  :', await fsp.readFile(file, 'utf8'));
    await fsp.truncate(file, 6);
    console.log('truncate to 6  :', await fsp.readFile(file)); // padded with zero bytes
    await fsp.truncate(file); // no length means 0
    console.log('truncate to 0  : size is', (await fsp.stat(file)).size);

    // --- Writing a Buffer writes the raw bytes ----------------------------
    await fsp.writeFile(file, Buffer.from([0x68, 0x69, 0x21]));
    console.log('from bytes     :', await fsp.readFile(file, 'utf8'));

    // --- The sync twin: the same names with Sync at the end ---------------
    fs.writeFileSync(file, 'sync twin');
    console.log('sync twin      :', fs.readFileSync(file, 'utf8'));
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

main();
