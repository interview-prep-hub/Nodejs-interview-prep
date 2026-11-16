// Directories: mkdir (recursive), readdir (withFileTypes, recursive), mkdtemp, rm
// Run: node lessons/06-file-system/examples/03-directories.js
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

// Paths from readdir use the OS separator. We print them with "/" so the output is the same everywhere.
const slash = (p) => p.split(path.sep).join('/');

async function main() {
  // mkdtemp adds 6 random characters to the prefix, so the name is always new.
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'fs-dirs-'));
  console.log('temp folder name has prefix + 6 chars:', path.basename(root).length === 'fs-dirs-'.length + 6);

  try {
    // --- mkdir ------------------------------------------------------------
    try {
      await fsp.mkdir(path.join(root, 'a', 'b', 'c')); // parents do not exist
    } catch (err) {
      console.log('mkdir without recursive ->', err.code);
    }

    await fsp.mkdir(path.join(root, 'a', 'b', 'c'), { recursive: true }); // makes every missing parent
    await fsp.mkdir(path.join(root, 'a', 'b', 'c'), { recursive: true }); // already there: no error
    console.log('mkdir recursive twice -> ok');

    try {
      await fsp.mkdir(path.join(root, 'a')); // already there, not recursive
    } catch (err) {
      console.log('mkdir existing folder ->', err.code);
    }

    // --- put some files in -----------------------------------------------
    await fsp.writeFile(path.join(root, 'top.txt'), 'top');
    await fsp.writeFile(path.join(root, 'a', 'one.txt'), '1');
    await fsp.writeFile(path.join(root, 'a', 'b', 'two.txt'), '22');

    // --- readdir: names only, one level ----------------------------------
    // The order is up to the OS, so sort when you need a stable order.
    console.log('readdir            :', (await fsp.readdir(root)).sort());

    // --- withFileTypes: Dirent objects tell you file or folder without a stat call
    const entries = await fsp.readdir(root, { withFileTypes: true });
    for (const entry of entries.sort((x, y) => x.name.localeCompare(y.name))) {
      console.log('  entry', entry.name, '| folder:', entry.isDirectory(), '| file:', entry.isFile());
    }

    // --- recursive: every file and folder below, as paths relative to root
    const all = await fsp.readdir(root, { recursive: true });
    console.log('readdir recursive  :', all.map(slash).sort());

    // recursive + withFileTypes: each Dirent has name and parentPath (the folder it lives in)
    const deep = await fsp.readdir(root, { recursive: true, withFileTypes: true });
    const files = deep.filter((d) => d.isFile()).map((d) => slash(path.relative(root, path.join(d.parentPath, d.name))));
    console.log('only the files     :', files.sort());

    // --- removing --------------------------------------------------------
    try {
      await fsp.rmdir(path.join(root, 'a')); // rmdir only removes EMPTY folders
    } catch (err) {
      console.log('rmdir on a full folder ->', err.code);
    }

    await fsp.rm(path.join(root, 'a'), { recursive: true }); // removes folder and everything inside
    console.log('after rm recursive :', (await fsp.readdir(root)).sort());

    // force: true means "no error if it is already gone"
    await fsp.rm(path.join(root, 'a'), { recursive: true, force: true });
    console.log('rm with force on a missing path -> ok');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

main();
