// npm scripts for real: pre/post hooks, passing arguments with "--", local binaries and platform traps
// Run: node lessons/04-npm-and-package-json/examples/06-npm-scripts.js
// Uses the npm that ships next to node, offline, in a throwaway folder. Takes a few seconds.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createNpm, guard, removeTemp } = require('./_npm.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-scripts-'));
const write = (file, content, options) => {
  const full = path.join(tmp, 'project', file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, options);
};

async function main() {
  const npm = createNpm(path.join(tmp, 'sandbox'));
  if (!npm) return console.log('Could not find the npm that ships with this node. Skipping.');
  const project = path.join(tmp, 'project');

  write('package.json', JSON.stringify({
    name: 'scripts-demo',
    version: '2.5.0',
    scripts: {
      prebuild: 'node scripts/say.js prebuild',
      build: 'node scripts/say.js build',
      postbuild: 'node scripts/say.js postbuild',
      args: 'node scripts/args.js',
      info: 'node scripts/info.js',
      'posix-only': 'FOO=bar node scripts/say.js posix',
      who: 'node scripts/who.js',
    },
  }, null, 2));
  write('scripts/say.js', "console.log('  [' + process.argv[2] + ']');\n");
  write('scripts/args.js', "console.log('  the script received:', JSON.stringify(process.argv.slice(2)));\n");
  write('scripts/who.js', `
console.log('  npm_lifecycle_event =', process.env.npm_lifecycle_event);
console.log('  NODE_RUN_SCRIPT_NAME =', process.env.NODE_RUN_SCRIPT_NAME);
`);
  write('scripts/info.js', `
const path = require('node:path');
const home = path.dirname(process.env.npm_package_json);
const first = process.env.PATH.split(path.delimiter)[0];
console.log('  npm_package_name    =', process.env.npm_package_name);
console.log('  npm_package_version =', process.env.npm_package_version);
console.log('  npm_lifecycle_event =', process.env.npm_lifecycle_event);
console.log('  first folder in PATH =', first.replace(home, '<project>').split(path.sep).join('/'));
`);
  // A fake local tool, laid out the way npm lays out a real one: node_modules/.bin/<name>
  write('node_modules/demo-cli/cli.js', "console.log('  demo-cli ran with', process.argv.slice(2));\n");
  write('node_modules/.bin/demo-cli.cmd', '@node "%~dp0\\..\\demo-cli\\cli.js" %*\r\n'); // Windows shim
  write('node_modules/.bin/demo-cli', '#!/bin/sh\nexec node "$(dirname "$0")/../demo-cli/cli.js" "$@"\n', { mode: 0o755 }); // POSIX shim

  const commands = [
    ['run', 'build'],
    ['run', 'args', '--', '--port', '3000', '--verbose'],
    ['run', 'args', '--port', '3000'],
    ['run', 'info'],
    ['exec', '--', 'demo-cli', '--hello'],
    ['run', 'posix-only'],
    ['run', 'build', '--ignore-scripts'],
  ];
  // Run them all at once to save time, then print in a fixed order.
  const results = await Promise.all(commands.map((args) => npm(args, project)));

  results.forEach((r, i) => {
    console.log(`\n$ npm ${commands[i].join(' ')}`);
    if (r.stdout) console.log(r.stdout);
    const warnings = r.stderr.split(/\r?\n/).filter((l) => l && !l.includes('complete log'));
    if (warnings.length) console.log(warnings.slice(0, 2).join('\n'));
    if (r.status !== 0) console.log(`(npm exited with code ${r.status} because the script failed)`);
  });

  // Node can run package.json scripts itself (Node 22+). It is simpler, and different.
  for (const script of ['build', 'who']) {
    console.log(`\n$ node --run ${script}`);
    const viaNode = spawnSync(process.execPath, ['--run', script], { cwd: project, encoding: 'utf8' });
    console.log(viaNode.stdout.trimEnd());
  }
  console.log('\nnode --run ran only the named script (no prebuild or postbuild) and set no npm_* variables.');
}

guard(main).finally(() => removeTemp(tmp));
