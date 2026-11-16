// stat, and how to check "does this file exist?" the right way (and the TOCTOU trap)
// Run: node lessons/06-file-system/examples/04-stat-and-exists.js
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// A tiny helper for the rare case where existence itself is the answer.
async function pathExists(p) {
  try {
    await fsp.access(p); // resolves if the path is there and reachable
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err; // EACCES and friends are real problems, do not hide them
  }
}

async function main() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fs-stat-'));
  const file = path.join(dir, 'data.txt');

  try {
    await fsp.writeFile(file, '12345');

    // --- What does stat tell us? -----------------------------------------
    const st = await fsp.stat(file);
    console.log('isFile       :', st.isFile());
    console.log('isDirectory  :', st.isDirectory());
    console.log('size (bytes) :', st.size);
    console.log('mtime is a Date :', st.mtime instanceof Date, '| mtimeMs is a number:', typeof st.mtimeMs === 'number');
    console.log('mode (octal) :', st.mode.toString(8), '(file type bits + permission bits)');
    console.log('nlink        :', st.nlink, '(number of hard links)');
    console.log('stat on a folder -> isDirectory:', (await fsp.stat(dir)).isDirectory());

    // The same facts are available on Dirent objects, without an extra stat call.
    const [entry] = await fsp.readdir(dir, { withFileTypes: true });
    console.log('Dirent says  :', entry.name, 'isFile =', entry.isFile());

    // --- Missing path: stat throws ENOENT --------------------------------
    const missing = path.join(dir, 'nope.txt');
    try {
      await fsp.stat(missing);
    } catch (err) {
      console.log('stat missing ->', err.code);
    }
    // The sync version has an option to return undefined instead of throwing.
    console.log('statSync with throwIfNoEntry:false ->', fs.statSync(missing, { throwIfNoEntry: false }));

    // --- Existence checks ------------------------------------------------
    console.log('pathExists(file)    :', await pathExists(file));
    console.log('pathExists(missing) :', await pathExists(missing));

    // --- The TOCTOU trap -------------------------------------------------
    // Time Of Check, Time Of Use: the answer can be out of date one moment later.
    console.log('--- check, then use (WRONG) ---');
    if (await pathExists(file)) {
      console.log('check says: the file exists');
      await fsp.rm(file); // pretend another program deletes it right now
      try {
        await fsp.readFile(file, 'utf8');
      } catch (err) {
        console.log('use fails anyway ->', err.code);
      }
    }

    // The fix: do the real work and handle the error.
    console.log('--- just try it (RIGHT) ---');
    try {
      await fsp.readFile(file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      console.log('file is missing, so use the default value');
    }

    // Same idea for "create only if new": the 'wx' flag checks and creates in ONE step.
    await fsp.writeFile(file, 'first', { flag: 'wx' });
    try {
      await fsp.writeFile(file, 'second', { flag: 'wx' });
    } catch (err) {
      console.log("'wx' refuses to overwrite ->", err.code);
    }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

main();
