// path: join, resolve, basename, dirname, extname, parse, format, relative, normalize
// Run: node lessons/05-core-modules-tour/examples/02-path.js
// Output depends on your OS: Windows prints backslashes, Linux and macOS print slashes.
const path = require('node:path');

console.log('--- separator ---');
console.log('path.sep =', JSON.stringify(path.sep));
console.log('path.delimiter =', JSON.stringify(path.delimiter));

console.log('--- join: glue pieces, then clean up ---');
console.log(path.join('data', 'users', 'ada.json'));
console.log(path.join('data/users', '../logs', 'app.log')); // ".." climbs one folder
console.log(path.join('/srv/app', '/uploads', 'a.png')); // a leading slash does NOT restart the path

console.log('--- resolve: always returns an absolute path ---');
const resolved = path.resolve('notes.txt'); // starts from process.cwd()
console.log('absolute?', path.isAbsolute(resolved));
console.log('same as cwd + name?', resolved === path.join(process.cwd(), 'notes.txt'));
console.log('relative to cwd:', path.relative(process.cwd(), resolved));

console.log('--- take a path apart ---');
const file = '/home/ada/app/config.prod.json';
console.log('basename:', path.basename(file));
console.log('basename without ext:', path.basename(file, '.json'));
console.log('dirname:', path.dirname(file));
console.log('extname:', path.extname(file));
console.log('archive.tar.gz ->', path.extname('archive.tar.gz')); // only the last dot counts
console.log('.gitignore ->', JSON.stringify(path.extname('.gitignore'))); // dotfile: no extension
console.log('README ->', JSON.stringify(path.extname('README')));

console.log('--- parse and format ---');
const parts = path.parse(file);
console.log(parts);
console.log(path.format({ dir: 'reports', name: 'sales', ext: '.csv' }));
// Change only the extension: parse, then clear "base" and set a new "ext".
console.log(path.format({ ...path.parse('reports/sales.csv'), base: '', ext: '.json' }));

console.log('--- normalize and relative ---');
console.log(path.normalize('/a//b/./c/../d'));
console.log(path.relative('/data/app/src/utils', '/data/app/test/unit'));

console.log('--- guard against path traversal ---');
// A user sends "../../secret.txt". A plain join happily walks out of your folder.
function safeJoin(baseDir, userPath) {
  const full = path.resolve(baseDir, userPath);
  const rel = path.relative(baseDir, full);
  const escapes = rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel);
  if (escapes) throw new Error(`Blocked: ${userPath}`);
  return full;
}
const base = path.join(__dirname, 'uploads');
console.log('ok     ->', path.relative(base, safeJoin(base, 'photos/cat.png')));
for (const bad of ['../../secret.txt', '/etc/passwd']) {
  try {
    safeJoin(base, bad);
  } catch (err) {
    console.log(err.message);
  }
}
