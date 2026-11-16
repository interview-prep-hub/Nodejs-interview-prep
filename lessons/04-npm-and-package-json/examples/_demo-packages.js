// Helper data (not run by itself): a tiny pretend npm registry used by examples 04 and 08 to 12.
// registry shape: { packageName: { version: { dependencies, ...other package.json fields } } }
// demo-ui 1.x needs demo-utils 1.x, but demo-log 2.x needs demo-utils 2.x. That conflict
// is what makes node_modules interesting.
'use strict';

const registry = {
  'demo-ui': {
    '1.2.0': { dependencies: { 'demo-utils': '^1.0.0' } },
    '1.3.0': { dependencies: { 'demo-utils': '^1.0.0' } },
    '2.0.0': { dependencies: { 'demo-utils': '^2.0.0' } },
  },
  'demo-log': {
    '2.0.0': { dependencies: { 'demo-utils': '^2.0.0' } },
    '2.0.1': { dependencies: { 'demo-utils': '^2.0.0' } },
    '2.1.0': { dependencies: { 'demo-utils': '^2.0.0' } },
  },
  'demo-utils': {
    '1.0.0': {},
    '1.4.0': {},
    '1.5.0-beta.1': {},
    '2.0.0': {},
    '2.1.0': {},
  },
  'demo-lint': {
    '3.0.0': {},
    '3.2.0': {},
  },
};

// The project that installs from this registry (its package.json, as an object).
const app = {
  name: 'demo-app',
  version: '1.0.0',
  private: true,
  dependencies: { 'demo-ui': '^1.2.0', 'demo-log': '~2.0.0' },
  devDependencies: { 'demo-lint': '^3.0.0' },
};

// More packages for the examples that show other kinds of dependency and install scripts.
const extras = {
  // A plugin: it needs the host package demo-ui 2.x to be installed next to it.
  'demo-plugin': { '1.0.0': { peerDependencies: { 'demo-ui': '^2.0.0' } } },
  // An add-on whose install step fails, like a native module that cannot compile on your machine.
  'demo-fancy': { '1.0.0': { scripts: { install: 'node -e "process.exit(1)"' } } },
  // A package that claims to need a Node.js version that does not exist yet.
  'demo-future': { '1.0.0': { engines: { node: '>=99.0.0' } } },
  // A package with a postinstall script: code that runs on your machine during npm install.
  'demo-native': {
    '1.0.0': {
      scripts: { postinstall: 'node postinstall.js' },
      _files: {
        'postinstall.js': [
          "const fs = require('node:fs');",
          "const seen = Object.keys(process.env).filter((name) => name.startsWith('DEMO_SECRET'));",
          "console.log('demo-native postinstall is running. It can read:', seen.join(', '));",
          "fs.writeFileSync('postinstall-was-here.txt', 'ran during install; saw ' + seen.join(', '));",
        ].join('\n'),
      },
    },
  },
  // A command-line tool: "bin" tells npm to create a command called demo-cli.
  'demo-cli': {
    '1.0.0': {
      bin: { 'demo-cli': 'cli.js' },
      _files: { 'cli.js': '#!/usr/bin/env node\nconsole.log("hello from demo-cli");\n' },
    },
  },
  // A package with a known vulnerability (see the advisory below) and a fixed new major version.
  'demo-old': { '1.0.0': {}, '2.0.0': {} },
};

// What the pretend registry says when npm audit asks about demo-old.
const advisories = {
  'demo-old': [{
    id: 900001,
    url: 'https://example.test/advisories/DEMO-0001',
    title: 'Prototype pollution in demo-old',
    severity: 'high',
    vulnerable_versions: '<2.0.0',
    cwe: ['CWE-1321'],
    cvss: { score: 7.5, vectorString: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N' },
  }],
};

module.exports = { registry, app, extras, advisories };
