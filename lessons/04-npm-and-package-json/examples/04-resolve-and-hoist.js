// How npm decides versions and folders: pick the highest match, then hoist as high as possible
// Run: node lessons/04-npm-and-package-json/examples/04-resolve-and-hoist.js
'use strict';

const { registry, app } = require('./_demo-packages.js');
const { satisfies, maxSatisfying } = require('./03-semver-ranges.js');

// A "folder" stands for one node_modules entry: { name, version, parent, children }.
const folder = (name, version, parent) => ({ name, version, parent, children: new Map() });
const byName = (a, b) => (a[0] < b[0] ? -1 : 1);

function install(project, { omitDev = false } = {}) {
  const top = folder(project.name, project.version, null);
  const wanted = { ...(omitDev ? {} : project.devDependencies), ...project.dependencies };
  const queue = Object.entries(wanted).sort(byName).map(([name, range]) => ({ from: top, name, range }));
  const log = [];

  while (queue.length > 0) {
    const { from, name, range } = queue.shift();

    // 1. Node looks in the nearest node_modules first. Does a copy already visible from here fit?
    let visible = null;
    for (let dir = from; dir && !visible; dir = dir.parent) visible = dir.children.get(name) || null;
    if (visible && satisfies(visible.version, range)) {
      log.push(`${from.name} wants ${name}@${range}: reuse ${name}@${visible.version} (already installed)`);
      continue;
    }

    // 2. Pick the highest published version that matches the range.
    const version = maxSatisfying(Object.keys(registry[name]), range);
    if (!version) throw new Error(`No version of ${name} matches ${range}`);

    // 3. Hoist: use the folder closest to the root that does not already hold a different copy.
    const route = [];
    for (let dir = from; dir; dir = dir.parent) route.unshift(dir);
    const target = route.find((dir) => !dir.children.has(name));
    target.children.set(name, folder(name, version, target));
    const where = target === top ? 'at the top level' : `inside ${target.name}/node_modules`;
    log.push(`${from.name} wants ${name}@${range}: choose ${version}, put it ${where}`);

    // 4. This package's own dependencies are handled next (breadth first, alphabetical).
    const deps = registry[name][version].dependencies || {};
    for (const [depName, depRange] of Object.entries(deps).sort(byName)) {
      queue.push({ from: target.children.get(name), name: depName, range: depRange });
    }
  }
  return { top, log };
}

// Flatten the tree into the same paths that appear in package-lock.json.
function toPaths(top, prefix = 'node_modules', out = {}) {
  for (const [name, child] of [...top.children].sort(byName)) {
    out[`${prefix}/${name}`] = child.version;
    toPaths(child, `${prefix}/${name}/node_modules`, out);
  }
  return out;
}

function printTree(node, indent = '') {
  const entries = [...node.children].sort(byName);
  entries.forEach(([name, child], i) => {
    const last = i === entries.length - 1;
    console.log(`${indent}${last ? '`-- ' : '+-- '}${name}@${child.version}`);
    printTree(child, indent + (last ? '    ' : '|   '));
  });
}

module.exports = { install, toPaths, printTree };

if (require.main === module) {
  console.log('package.json of demo-app:');
  console.log('  dependencies   ', JSON.stringify(app.dependencies));
  console.log('  devDependencies', JSON.stringify(app.devDependencies));

  console.log('\n--- Install with a conflict (ui 1.x needs utils 1.x, log 2.x needs utils 2.x) ---');
  const { top, log } = install(app);
  log.forEach((line) => console.log('  ' + line));
  console.log('\nResulting node_modules:');
  console.log(app.name);
  printTree(top);
  console.log('\nAs lockfile paths:', toPaths(top));

  const phantom = [...top.children.keys()].filter((n) => !(n in app.dependencies) && !(n in app.devDependencies));
  console.log('\nTop-level folders your package.json never asked for:', phantom.join(', '));
  console.log('Your code can still require() them. That is a phantom dependency.');

  console.log('\n--- Same project, but demo-ui moves to ^2.0.0 (no more conflict) ---');
  const calm = install({ ...app, dependencies: { 'demo-ui': '^2.0.0', 'demo-log': '~2.0.0' } });
  console.log(app.name);
  printTree(calm.top);

  console.log('\n--- Production install (npm install --omit=dev) skips devDependencies ---');
  console.log(Object.keys(toPaths(install(app, { omitDev: true }).top)).join('\n'));
}
