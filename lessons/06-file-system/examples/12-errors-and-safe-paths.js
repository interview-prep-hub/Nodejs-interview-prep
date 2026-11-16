// Error codes, safe handling patterns, building paths from __dirname, and a path traversal guard
// Run: node lessons/06-file-system/examples/12-errors-and-safe-paths.js
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Run an fs call that must fail, and return a short description of the error.
async function codeOf(fn) {
  try {
    await fn();
    return 'no error';
  } catch (err) {
    return err.code;
  }
}

// Return the file content, or null if the file does not exist. Everything else is re-thrown.
async function readIfExists(file) {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// Join a base folder and a user supplied name, and refuse to leave the base folder.
function resolveInside(baseDir, userPath) {
  const base = path.resolve(baseDir);
  const full = path.resolve(base, userPath);
  const relative = path.relative(base, full);
  const escapes = relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative);
  if (escapes) {
    const err = new Error(`Path escapes the base folder: ${userPath}`);
    err.code = 'E_PATH_TRAVERSAL';
    throw err;
  }
  return full;
}

async function main() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fs-errors-'));
  const p = (...parts) => path.join(dir, ...parts);

  try {
    await fsp.writeFile(p('file.txt'), 'hello');
    await fsp.mkdir(p('folder'));
    await fsp.writeFile(p('folder', 'inside.txt'), 'x');

    // --- 1. The common error codes, each one caused on purpose -------------------
    console.log('ENOENT    (no such file)     :', await codeOf(() => fsp.readFile(p('nope.txt'))));
    console.log('EEXIST    (already exists)   :', await codeOf(() => fsp.mkdir(p('folder'))));
    console.log('EISDIR    (is a folder)      :', await codeOf(() => fsp.readFile(p('folder'))));
    console.log('ENOTDIR   (not a folder)     :', await codeOf(() => fsp.readdir(p('file.txt'))));
    console.log('ENOTEMPTY (folder not empty) :', await codeOf(() => fsp.rmdir(p('folder'))));

    // Permission problems: EACCES on Linux and macOS, EPERM on Windows.
    await fsp.chmod(p('file.txt'), 0o444);
    const denied = await codeOf(() => fsp.writeFile(p('file.txt'), 'new'));
    console.log('EACCES/EPERM (not allowed)   :', denied === 'EACCES' || denied === 'EPERM' ? 'permission error' : denied);
    await fsp.chmod(p('file.txt'), 0o666);

    // --- 2. What an error object contains -----------------------------------------
    try {
      await fsp.readFile(p('nope.txt'));
    } catch (err) {
      console.log('--- inside the error ---');
      console.log('name    :', err.name);
      console.log('code    :', err.code);
      console.log('syscall :', err.syscall);
      console.log('errno   :', typeof err.errno, '(a number that depends on the OS)');
      console.log('path    :', path.basename(err.path));
    }

    // --- 3. A "does not exist is fine" helper ---------------------------------------
    console.log('readIfExists(file)    :', await readIfExists(p('file.txt')));
    console.log('readIfExists(missing) :', await readIfExists(p('nope.txt')));
    console.log('readIfExists(folder)  :', await codeOf(() => readIfExists(p('folder')))); // not hidden

    // --- 4. Building paths: use __dirname, not the current folder -----------------------
    // A relative path is resolved against process.cwd(), which depends on where you started node.
    console.log('relative path uses cwd :', path.resolve('data.txt') === path.join(process.cwd(), 'data.txt'));
    // __dirname is the folder of THIS file, wherever node was started.
    const sibling = path.join(__dirname, path.basename(__filename));
    console.log('__dirname based path   :', (await fsp.stat(sibling)).isFile() ? 'finds this very file' : 'missing');
    console.log('same as __filename     :', sibling === __filename);

    // --- 5. Path traversal guard --------------------------------------------------------
    const publicDir = p('folder');
    const attempts = [
      ['inside.txt', 'inside.txt'],
      ['sub/../inside.txt', 'sub/../inside.txt'],
      ['../file.txt', '../file.txt'],
      ['../../etc/passwd', '../../etc/passwd'],
      ['absolute path', p('file.txt')], // an absolute path replaces the base folder, so it must be refused
    ];
    for (const [label, input] of attempts) {
      try {
        const safe = resolveInside(publicDir, input);
        console.log(label.padEnd(20), '-> allowed:', path.relative(publicDir, safe));
      } catch (err) {
        console.log(label.padEnd(20), '-> refused:', err.code);
      }
    }

    // The same helper in use: reading a "user requested" file safely.
    const requested = 'inside.txt';
    console.log('safe read of', requested, '->', await fsp.readFile(resolveInside(publicDir, requested), 'utf8'));
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

main();
