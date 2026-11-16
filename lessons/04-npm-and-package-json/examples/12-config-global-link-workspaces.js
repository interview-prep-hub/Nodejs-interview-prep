// .npmrc layers, global installs, workspaces and npm link, each in a sandbox (nothing global is touched)
// Run: node lessons/04-npm-and-package-json/examples/12-config-global-link-workspaces.js
// Real npm against a pretend registry on localhost (no internet). Takes several seconds.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { createNpm, guard, removeTemp } = require('./_npm.js');
const { startRegistry } = require('./_local-registry.js');
const { registry, extras } = require('./_demo-packages.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-tour-'));
const at = (...parts) => path.join(tmp, ...parts);
const rel = (p) => path.relative(fs.realpathSync(tmp), p).split(path.sep).join('/'); // p is a real path

function write(file, content) {
  fs.mkdirSync(path.dirname(at(file)), { recursive: true });
  fs.writeFileSync(at(file), typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

async function main() {
  const reg = await startRegistry({ ...registry, ...extras });
  try {
    const npm = createNpm(at('sandbox'), reg.url);
    if (!npm) return console.log('Could not find the npm that ships with this node. Skipping.');

    // --- Project files ---------------------------------------------------------------------
    write('config-project/package.json', { name: 'config-project', version: '1.0.0' });
    write('config-project/.npmrc', 'save-exact=true\n@acme:registry=https://npm.acme.example/\n');
    write('config-elsewhere/package.json', { name: 'config-elsewhere', version: '1.0.0' });

    write('mono/package.json', { name: 'mono', version: '1.0.0', private: true, workspaces: ['packages/*'] });
    write('mono/packages/lib-a/package.json', { name: 'lib-a', version: '1.2.0', main: 'index.js', scripts: { hello: 'node hello.js' } });
    write('mono/packages/lib-a/index.js', "exports.greet = () => 'hi from lib-a';\n");
    write('mono/packages/lib-a/hello.js', "console.log('hello from lib-a');\n");
    write('mono/packages/app-b/package.json', { name: 'app-b', version: '1.0.0', dependencies: { 'lib-a': '^1.0.0' }, scripts: { hello: 'node hello.js' } });
    write('mono/packages/app-b/index.js', "module.exports = require('lib-a').greet();\n");
    write('mono/packages/app-b/hello.js', "console.log('hello from app-b');\n");

    write('tinylib/package.json', { name: 'tinylib', version: '1.0.0', main: 'index.js' });
    write('tinylib/index.js', "exports.hi = () => 'tinylib version ONE';\n");
    write('consumer/package.json', { name: 'consumer', version: '1.0.0' });

    const linkPrefix = at('sandbox', 'link-global');
    fs.mkdirSync(linkPrefix, { recursive: true });

    // --- Run every npm command at the same time (they work in different folders) -------------
    const get = (cwd, key, extraEnv, extraArgs = []) => npm(['config', 'get', key, ...extraArgs], cwd, extraEnv);
    const [c1, c2, c3, c4, c5, globalInstall, workspaceInstall, workspaceRun, linkResult] = await Promise.all([
      get(at('config-project'), 'save-exact'),
      get(at('config-elsewhere'), 'save-exact'),
      get(at('config-project'), 'save-exact', { npm_config_save_exact: 'false' }),
      get(at('config-project'), 'save-exact', { npm_config_save_exact: 'false' }, ['--save-exact=true']),
      get(at('config-project'), '@acme:registry'),
      npm(['install', '--global', 'demo-cli'], at('config-elsewhere')),
      npm(['install'], at('mono')),
      npm(['run', 'hello', '--workspaces'], at('mono')),
      npm(['link', '../tinylib'], at('consumer'), { npm_config_prefix: linkPrefix }), // its own global folder, so it cannot collide with the install above
    ]);

    console.log('1. Config layers (npm config get save-exact)');
    console.log('   project has .npmrc with save-exact=true      ->', c1.stdout);
    console.log('   another folder, no .npmrc                    ->', c2.stdout);
    console.log('   project + environment npm_config_save_exact  ->', c3.stdout, '(environment beats the file)');
    console.log('   ...and also --save-exact=true on the command ->', c4.stdout, '(command line beats environment)');
    console.log('   scoped registry for @acme packages           ->', c5.stdout);

    console.log('\n2. Global install (npm install --global demo-cli) went to the sandbox, not to your real global folder:');
    const globalRoot = [at('sandbox', 'global', 'node_modules'), at('sandbox', 'global', 'lib', 'node_modules')].find(fs.existsSync);
    console.log('   global packages:', fs.readdirSync(globalRoot).filter((n) => !n.startsWith('.')).join(', '));
    const commandFiles = [at('sandbox', 'global'), at('sandbox', 'global', 'bin')].filter(fs.existsSync)
      .flatMap((dir) => fs.readdirSync(dir)).filter((n) => n.startsWith('demo-cli'));
    console.log('   command files  :', commandFiles.join(', '), '(these put demo-cli on your PATH)');

    console.log('\n3. Workspaces: one install at the root, local packages linked into node_modules');
    const linked = at('mono', 'node_modules', 'lib-a');
    console.log('   mono/node_modules/lib-a is a link?   ', fs.lstatSync(linked).isSymbolicLink());
    console.log('   ...and it points to                  ', rel(fs.realpathSync(linked)));
    console.log('   app-b requires lib-a and gets        ', JSON.stringify(createRequire(at('mono/packages/app-b/index.js'))('./index.js')));
    const hellos = workspaceRun.stdout.split(/\r?\n/).filter((l) => l.startsWith('hello')).sort();
    console.log('   npm run hello --workspaces printed   ', hellos.join(' | '));

    console.log('\n4. npm link: the consumer uses your working copy of tinylib');
    console.log('   consumer/node_modules/tinylib points to', rel(fs.realpathSync(at('consumer', 'node_modules', 'tinylib'))));
    const ask = () => spawnSync(process.execPath, ['-p', "require('tinylib').hi()"], { cwd: at('consumer'), encoding: 'utf8' }).stdout.trim();
    console.log('   before editing tinylib/index.js:', ask());
    write('tinylib/index.js', "exports.hi = () => 'tinylib version TWO';\n");
    console.log('   after editing tinylib/index.js :', ask(), '(no reinstall needed)');

    const failed = [globalInstall, workspaceInstall, workspaceRun, linkResult].filter((r) => r.status !== 0);
    if (failed.length) console.log('\nSome npm commands failed:', failed.map((r) => r.stderr.split(/\r?\n/)[0]).join(' | '));
  } finally {
    await reg.close();
  }
}

guard(main).finally(() => removeTemp(tmp));
