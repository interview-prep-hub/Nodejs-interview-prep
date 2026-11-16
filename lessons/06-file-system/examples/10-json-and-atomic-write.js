// JSON config helpers and the atomic write pattern (write a temp file, then rename)
// Run: node lessons/06-file-system/examples/10-json-and-atomic-write.js
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Read a JSON file. A missing file gives the fallback. A broken file gives a clear error.
async function readJson(file, fallback) {
  let text;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw err;
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, '')); // strip a BOM (byte order mark) if an editor added one
  } catch (err) {
    throw new Error(`Invalid JSON in ${path.basename(file)}: ${err.message}`);
  }
}

// Write a file so that readers see either the OLD content or the NEW content, never half of it.
async function writeFileAtomic(file, data) {
  // The temp file must be in the SAME folder: rename is only atomic inside one file system.
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    const fh = await fsp.open(temp, 'wx'); // 'wx': never touch an existing file by accident
    try {
      await fh.writeFile(data);
      await fh.sync(); // push the bytes to the disk before the rename
    } finally {
      await fh.close();
    }
    await fsp.rename(temp, file); // swap in the new file in one step
  } catch (err) {
    await fsp.rm(temp, { force: true }); // do not leave temp files behind
    throw err;
  }
}

const writeJson = (file, value) => writeFileAtomic(file, JSON.stringify(value, null, 2) + '\n');

async function main() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fs-json-'));
  const configFile = path.join(dir, 'config.json');

  try {
    // 1. Missing file -> defaults
    const defaults = { port: 3000, debug: false };
    console.log('missing file gives :', await readJson(configFile, defaults));

    // 2. Write, then read back
    await writeJson(configFile, { port: 8080, debug: true });
    console.log('file on disk       :', JSON.stringify(await fsp.readFile(configFile, 'utf8')));

    // 3. Read - change - write (fine for one writer; see the README for the lost update problem)
    const config = await readJson(configFile);
    config.port += 1;
    await writeJson(configFile, config);
    console.log('after update       :', await readJson(configFile));

    // 4. No temp files are left behind
    console.log('folder content     :', await fsp.readdir(dir));

    // 5. A failed atomic write keeps the old file intact
    try {
      await writeFileAtomic(path.join(dir, 'missing-folder', 'x.json'), '{}');
    } catch (err) {
      console.log('write into missing folder ->', err.code);
    }
    try {
      await writeFileAtomic(configFile, { not: 'a string or buffer' });
    } catch (err) {
      console.log('bad data ->', err.code);
    }
    console.log('config is still    :', await readJson(configFile));
    console.log('folder content     :', await fsp.readdir(dir));

    // 6. Broken JSON gives a helpful message
    await fsp.writeFile(configFile, '{ "port": ');
    try {
      await readJson(configFile);
    } catch (err) {
      console.log('broken JSON ->', err.message.split(':')[0]);
    }

    // 7. A file saved with a BOM still parses
    await fsp.writeFile(configFile, '\uFEFF{"fromBom":true}');
    console.log('file with BOM      :', await readJson(configFile));
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

main();
