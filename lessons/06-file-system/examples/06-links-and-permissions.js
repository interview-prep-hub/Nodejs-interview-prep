// Hard links, symbolic links, and permissions (chmod, mode bits). Some results depend on the OS.
// Run: node lessons/06-file-system/examples/06-links-and-permissions.js
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fs-links-'));
  const p = (...parts) => path.join(dir, ...parts);
  console.log('platform:', process.platform);

  try {
    // ===== Hard link: a second NAME for the same file data ==================
    await fsp.writeFile(p('original.txt'), 'shared data');
    await fsp.link(p('original.txt'), p('hard.txt'));
    const a = await fsp.stat(p('original.txt'));
    const b = await fsp.stat(p('hard.txt'));
    console.log('hard link: same inode?', a.ino === b.ino, '| nlink =', a.nlink);

    await fsp.writeFile(p('hard.txt'), 'changed through the hard link');
    console.log('hard link: original now reads:', await fsp.readFile(p('original.txt'), 'utf8'));

    await fsp.unlink(p('original.txt')); // removes one name only
    console.log('hard link: data survives under the other name:', await fsp.readFile(p('hard.txt'), 'utf8'));

    // ===== Symbolic link: a small file that holds a PATH =====================
    await fsp.mkdir(p('real-folder'));
    await fsp.writeFile(p('real-folder', 'file.txt'), 'inside the real folder');

    // The third argument matters only on Windows. 'junction' makes a folder link that
    // does not need special rights, and on other systems it simply makes a normal symlink.
    await fsp.symlink(p('real-folder'), p('folder-link'), 'junction');

    const viaLstat = await fsp.lstat(p('folder-link')); // lstat looks at the link itself
    const viaStat = await fsp.stat(p('folder-link')); // stat follows the link
    console.log('lstat says link? ', viaLstat.isSymbolicLink(), '| stat says link?', viaStat.isSymbolicLink());
    console.log('stat says folder?', viaStat.isDirectory());
    console.log('read through link:', await fsp.readFile(p('folder-link', 'file.txt'), 'utf8'));
    console.log('readlink ends with:', path.basename(await fsp.readlink(p('folder-link'))));
    console.log('realpath is the real folder:', (await fsp.realpath(p('folder-link'))) === (await fsp.realpath(p('real-folder'))));

    // readdir with file types shows links as links
    const kinds = (await fsp.readdir(dir, { withFileTypes: true }))
      .map((d) => `${d.name}:${d.isSymbolicLink() ? 'link' : d.isDirectory() ? 'dir' : 'file'}`)
      .sort();
    console.log('readdir kinds:', kinds);

    // A symlink to a FILE: on Windows this needs Developer Mode or an admin shell.
    try {
      await fsp.symlink(p('hard.txt'), p('file-link.txt'), 'file');
      console.log('file symlink: created, reads', JSON.stringify(await fsp.readFile(p('file-link.txt'), 'utf8')));
    } catch (err) {
      console.log('file symlink: not allowed here ->', err.code);
    }

    // Removing a link never removes the target.
    await fsp.rm(p('folder-link'), { recursive: true });
    console.log('target still there:', (await fsp.readdir(p('real-folder'))).join(','));

    // ===== Permissions =======================================================
    const secret = p('secret.txt');
    await fsp.writeFile(secret, 'top secret');

    const modeOf = async (file) => ((await fsp.stat(file)).mode & 0o777).toString(8);
    console.log('mode before chmod:', await modeOf(secret));

    await fsp.chmod(secret, 0o444); // read-only for everybody
    console.log('mode after chmod 444:', await modeOf(secret));

    try {
      await fsp.writeFile(secret, 'new text');
      console.log('write to read-only file: worked (running as an admin/root user?)');
    } catch (err) {
      // Linux and macOS report EACCES, Windows reports EPERM.
      console.log('write to read-only file -> permission error:', err.code === 'EACCES' || err.code === 'EPERM');
    }

    // access() asks the OS: may I read / write / run this?
    const { R_OK, W_OK } = fsp.constants;
    for (const [name, flag] of [['read', R_OK], ['write', W_OK]]) {
      try {
        await fsp.access(secret, flag);
        console.log(`access ${name}: yes`);
      } catch {
        console.log(`access ${name}: no`);
      }
    }

    // On Windows the read-only flag is the only thing chmod can change.
    await fsp.chmod(secret, 0o666); // make it writable again so the cleanup works everywhere
    console.log('mode after chmod 666:', await modeOf(secret));
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

main();
