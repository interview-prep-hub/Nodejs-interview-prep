// __dirname, __filename and the working directory (cwd): three different things
// Run: node lessons/01-introduction/examples/05-dirname-filename.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Windows prints backslashes. We turn them into forward slashes so the output looks the same everywhere.
const slashes = (p) => p.split(path.sep).join('/');
const say = (label, value) => console.log(label.padEnd(38) + ': ' + value);

say('__filename, last part', path.basename(__filename));
say('__dirname, last part', path.basename(__dirname));
say('both are absolute paths', path.isAbsolute(__filename) && path.isAbsolute(__dirname));
say('dirname(__filename) is __dirname', path.dirname(__filename) === __dirname);
say('cwd is the same as __dirname', process.cwd() === __dirname);
say('this file, seen from the cwd', slashes(path.relative(process.cwd(), __filename)));

// ---- The classic mistake: a relative path depends on the cwd, not on the file ----
// We build a temporary folder with a data file, a JSON file and a small script.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-intro-'));
fs.writeFileSync(path.join(dir, 'intro-data.txt'), 'hello from intro-data.txt');
fs.writeFileSync(path.join(dir, 'intro-config.json'), '{"ok": true}');
fs.writeFileSync(path.join(dir, 'reader.js'), `
const fs = require('node:fs');
const path = require('node:path');
const say = (label, value) => console.log(label.padEnd(38) + ': ' + value);

try {
  fs.readFileSync('intro-data.txt', 'utf8');
  say('fs.readFileSync("intro-data.txt")', 'worked');
} catch (err) {
  say('fs.readFileSync("intro-data.txt")', err.code);
}

const safe = path.join(__dirname, 'intro-data.txt');
say('fs.readFileSync(join(__dirname, ..))', fs.readFileSync(safe, 'utf8'));
say('require("./intro-config.json").ok', require('./intro-config.json').ok);
`);

// Start reader.js with its working directory set to a DIFFERENT folder (the parent of dir).
const result = spawnSync(process.execPath, [path.join(dir, 'reader.js')], {
  cwd: os.tmpdir(),
  encoding: 'utf8',
});
console.log('\nreader.js, started from another folder:');
console.log(result.stdout.trim());
if (result.stderr) console.log(result.stderr);

fs.rmSync(dir, { recursive: true, force: true });
