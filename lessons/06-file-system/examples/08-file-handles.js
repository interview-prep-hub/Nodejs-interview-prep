// File descriptors and FileHandle: open, read/write at a position, and always close
// Run: node lessons/06-file-system/examples/08-file-handles.js
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fs-handle-'));
  const file = path.join(dir, 'data.txt');

  try {
    // --- 1. A FileHandle from fs/promises ------------------------------------
    const fh = await fsp.open(file, 'w+'); // read + write, create or empty the file
    try {
      console.log('fd is an integer:', Number.isInteger(fh.fd));
      // A process starts with 3 descriptors already open: 0 = stdin, 1 = stdout, 2 = stderr.
      console.log('stdout and stderr are descriptors too:', process.stdout.fd, process.stderr.fd);

      await fh.write('Hello, file handles!'); // writes at the current position
      const buf = Buffer.alloc(5);
      // read(buffer, offsetInBuffer, length, positionInFile)
      const { bytesRead } = await fh.read(buf, 0, 5, 7); // 5 bytes starting at file position 7
      console.log('read 5 bytes at position 7:', buf.toString('utf8', 0, bytesRead));

      await fh.write('J', 0); // overwrite the byte at position 0
      console.log('size from fh.stat():', (await fh.stat()).size);
      await fh.sync(); // ask the OS to flush to the disk (slow, use only when it matters)
    } finally {
      await fh.close(); // ALWAYS close. Leaked descriptors cause EMFILE later.
    }
    console.log('after close, fd is:', fh.fd);
    console.log('file content now:', await fsp.readFile(file, 'utf8'));

    // --- 2. Reading a file in small chunks with a loop -----------------------
    const reader = await fsp.open(file, 'r');
    try {
      const chunk = Buffer.alloc(8);
      let position = 0;
      let chunks = 0;
      for (;;) {
        const { bytesRead } = await reader.read(chunk, 0, chunk.length, position);
        if (bytesRead === 0) break; // 0 bytes means end of file
        chunks++;
        position += bytesRead;
      }
      console.log(`read ${position} bytes in ${chunks} chunks of up to 8 bytes`);
    } finally {
      await reader.close();
    }

    // --- 3. await using: closes the handle for you when the block ends ---------
    {
      await using auto = await fsp.open(file, 'r');
      const { size } = await auto.stat();
      console.log('inside the block, size:', size);
    } // auto.close() is called here, even if an error was thrown
    console.log('block finished, handle was closed for us');

    // --- 4. Numbers instead of objects: the classic fd API ---------------------
    const fd = fs.openSync(file, 'r');
    try {
      const out = Buffer.alloc(5);
      fs.readSync(fd, out, 0, 5, 0);
      console.log('classic API read:', out.toString());
    } finally {
      fs.closeSync(fd);
    }

    // A wrong use is reported: reading from a handle that is already closed.
    try {
      await fh.read(Buffer.alloc(1), 0, 1, 0);
    } catch (err) {
      console.log('using a closed handle ->', err.code);
    }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

main();
