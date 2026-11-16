// Testing code that reads and writes files: use a real temp folder, and always clean it up
// Run: node --test lessons/16-testing/examples/09-temp-dir.test.js

const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig, saveConfig, DEFAULTS } = require('./_lib/config-loader.js');

const createdDirs = [];

// Make a brand-new empty folder inside the operating system's temp folder.
// t.after() deletes it when the test ends, even if the test failed.
async function makeTempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-test-'));
  createdDirs.push(dir);
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

describe('loadConfig()', () => {
  it('reads the file and fills in the defaults', async (t) => {
    const dir = await makeTempDir(t);
    const file = path.join(dir, 'app.json');
    await fs.writeFile(file, JSON.stringify({ port: 8080 }));

    assert.deepEqual(await loadConfig(file), { port: 8080, debug: false });
  });

  it('returns the defaults when the file does not exist', async (t) => {
    const dir = await makeTempDir(t);

    assert.deepEqual(await loadConfig(path.join(dir, 'missing.json')), DEFAULTS);
  });

  it('does not hand out the shared DEFAULTS object (a copy is returned)', async (t) => {
    const dir = await makeTempDir(t);

    const config = await loadConfig(path.join(dir, 'missing.json'));
    config.port = 1;

    assert.equal(DEFAULTS.port, 3000);
  });

  it('throws a clear error for broken JSON', async (t) => {
    const dir = await makeTempDir(t);
    const file = path.join(dir, 'broken.json');
    await fs.writeFile(file, '{ "port": ');

    await assert.rejects(loadConfig(file), /invalid JSON in broken\.json/);
  });

  it('rethrows errors that are not "file not found" (a folder is not a file)', async (t) => {
    const dir = await makeTempDir(t);

    await assert.rejects(loadConfig(dir), { code: 'EISDIR' });
  });

  it('rethrows a permission error (faked, because it is hard to create on purpose)', async (t) => {
    t.mock.method(fs, 'readFile', async () => {
      throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
    });

    await assert.rejects(loadConfig('/any/path.json'), { code: 'EACCES' });
  });
});

describe('saveConfig()', () => {
  it('creates missing folders and writes readable JSON', async (t) => {
    const dir = await makeTempDir(t);
    const file = path.join(dir, 'deep', 'er', 'app.json');

    await saveConfig(file, { port: 9000, debug: true });

    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { port: 9000, debug: true });
  });

  it('round trip: what you save is what you load', async (t) => {
    const dir = await makeTempDir(t);
    const file = path.join(dir, 'app.json');

    await saveConfig(file, { port: 1234, debug: true });

    assert.deepEqual(await loadConfig(file), { port: 1234, debug: true });
  });
});

// A hook at the top of the file (outside any describe) runs once, after every test in this file.
// All tests are finished, so every temp folder they made must be gone.
after(() => {
  for (const dir of createdDirs) assert.equal(existsSync(dir), false, `${dir} was not removed`);
});
