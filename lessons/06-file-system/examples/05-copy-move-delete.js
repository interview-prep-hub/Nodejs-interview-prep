// Copy, move (rename) and delete: copyFile, cp, rename, unlink, rm
// Run: node lessons/06-file-system/examples/05-copy-move-delete.js
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const slash = (p) => p.split(path.sep).join('/');

// rename() cannot move a file to another disk (error EXDEV). This helper falls back to copy + delete.
// The fallback branch cannot be triggered inside one temp folder, but this is the usual pattern.
async function moveFile(from, to) {
  try {
    await fsp.rename(from, to);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    await fsp.copyFile(from, to);
    await fsp.unlink(from);
  }
}

async function main() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fs-copy-'));
  const p = (...parts) => path.join(dir, ...parts);

  try {
    await fsp.writeFile(p('a.txt'), 'content of a');

    // --- copyFile --------------------------------------------------------
    await fsp.copyFile(p('a.txt'), p('b.txt'));
    console.log('copyFile       :', await fsp.readFile(p('b.txt'), 'utf8'));

    await fsp.writeFile(p('b.txt'), 'b was changed');
    await fsp.copyFile(p('a.txt'), p('b.txt')); // by default an existing target is overwritten
    console.log('copy overwrote :', await fsp.readFile(p('b.txt'), 'utf8'));

    try {
      // COPYFILE_EXCL: fail if the target exists
      await fsp.copyFile(p('a.txt'), p('b.txt'), fsp.constants.COPYFILE_EXCL);
    } catch (err) {
      console.log('COPYFILE_EXCL  ->', err.code);
    }

    // --- cp: copy a whole folder tree -------------------------------------
    await fsp.mkdir(p('project', 'src'), { recursive: true });
    await fsp.writeFile(p('project', 'index.txt'), 'index');
    await fsp.writeFile(p('project', 'src', 'main.txt'), 'main');

    try {
      await fsp.cp(p('project'), p('backup')); // a folder needs { recursive: true }
    } catch (err) {
      console.log('cp folder without recursive ->', err.code);
    }
    await fsp.cp(p('project'), p('backup'), { recursive: true });
    console.log('cp recursive   :', (await fsp.readdir(p('backup'), { recursive: true })).map(slash).sort());

    // --- rename = move (and also the way to rename) -----------------------
    await fsp.rename(p('a.txt'), p('renamed.txt'));
    console.log('after rename   :', (await fsp.readdir(dir)).sort());

    await fsp.rename(p('project'), p('moved-project')); // works for folders too
    console.log('folder moved   :', (await fsp.readdir(p('moved-project'))).sort());

    await moveFile(p('renamed.txt'), p('backup', 'renamed.txt'));
    console.log('moveFile helper:', (await fsp.readdir(p('backup'))).sort());

    // rename silently replaces an existing FILE at the target.
    await fsp.writeFile(p('x.txt'), 'x');
    await fsp.writeFile(p('y.txt'), 'y');
    await fsp.rename(p('x.txt'), p('y.txt'));
    console.log('rename onto an existing file -> y.txt now holds:', await fsp.readFile(p('y.txt'), 'utf8'));

    // --- delete ------------------------------------------------------------
    await fsp.unlink(p('y.txt')); // unlink removes one file
    console.log('unlink         : done');

    try {
      await fsp.unlink(p('y.txt')); // already gone
    } catch (err) {
      console.log('unlink again   ->', err.code);
    }

    await fsp.rm(p('y.txt'), { force: true }); // rm + force: "make sure it is gone"
    console.log('rm force on a missing file -> ok');

    try {
      await fsp.rm(p('backup')); // a folder needs { recursive: true }
    } catch (err) {
      console.log('rm folder without recursive ->', err.code);
    }
    await fsp.rm(p('backup'), { recursive: true, force: true });
    console.log('left over      :', (await fsp.readdir(dir)).sort());
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

main();
