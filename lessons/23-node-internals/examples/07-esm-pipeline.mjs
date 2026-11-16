// The ES module pipeline: resolve, load, link, evaluate (watched with synchronous module hooks)
// Shows: every file is resolved and loaded before ANY code runs, then code runs dependencies first, imports are live bindings, and how a CommonJS file looks to import.
// Run: node lessons/23-node-internals/examples/07-esm-pipeline.mjs

import fs from 'node:fs';
import { registerHooks } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// ---- Fixture: a small graph of five modules ---------------------------------------------
//   main.mjs  imports  b.mjs, c.mjs, counter.mjs
//   b.mjs     imports  d.mjs
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esm-pipeline-'));
const files = {
  'main.mjs': `
    import { b } from './b.mjs';
    import { c } from './c.mjs';
    import { n, inc } from './counter.mjs';
    console.log('  EVALUATE main.mjs, b =', b, ', c =', c);
    console.log('  counter n before inc():', n);
    inc();
    console.log('  counter n after inc():', n, '(an import is a live view, not a copy)');
  `,
  'b.mjs': `
    import { d } from './d.mjs';
    console.log('  EVALUATE b.mjs');
    export const b = 'B+' + d;
  `,
  'c.mjs': `
    console.log('  EVALUATE c.mjs');
    export const c = 'C';
  `,
  'd.mjs': `
    console.log('  EVALUATE d.mjs');
    export const d = 'D';
  `,
  'counter.mjs': `
    console.log('  EVALUATE counter.mjs');
    export let n = 0;
    export function inc() { n++; }
  `,
};
for (const [name, source] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), source);

// ---- Hooks: they run on the thread that loads the modules, so console.log works inside them ----
const name = (url) => path.basename(new URL(url).pathname);
const hooks = registerHooks({
  // Phase 1: resolve. Turn the specifier (the text after "from") into a full URL.
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    console.log(`  resolve  ${specifier.startsWith('file:') ? name(specifier) : specifier} -> ${name(result.url)}`);
    return result;
  },
  // Phase 2: load. Turn the URL into source text and a format.
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    console.log(`  load     ${name(url)} (format: ${result.format})`);
    if (name(url) === 'c.mjs') {
      // A load hook may return different source. This is how transpilers and mocks plug in.
      return { ...result, source: "console.log('  EVALUATE c.mjs (source replaced by the load hook)'); export const c = 'C-patched';" };
    }
    return result;
  },
});

// ---- Run it -----------------------------------------------------------------------------------
console.log('Importing main.mjs. Lines starting with "resolve" and "load" come from the hooks.');
console.log('Phases 3 and 4 (link, evaluate) have no hooks; we see them through the EVALUATE lines.');
console.log();
await import(pathToFileURL(path.join(dir, 'main.mjs')).href);

hooks.deregister();

// ---- Part 2: importing CommonJS from ESM -------------------------------------------------------
// The load phase gives a CommonJS file the format "commonjs". Node runs it, then makes an ES module
// view of it: `default` is always module.exports. Named exports are guessed by READING the source
// text (a tool called cjs-module-lexer), not by running it, so only simple patterns are found.
const cjsFiles = [
  ['dots.cjs', 'exports.p = 1; module.exports.q = 2;', 'exports.p = 1;\nmodule.exports.q = 2;\n'],
  ['literal.cjs', 'module.exports = { a, b: 2 };', 'function a() {}\nmodule.exports = { a, b: 2 };\n'],
  ['dynamic.cjs', 'a loop that fills module.exports', "module.exports = {};\nfor (const key of ['x', 'y']) module.exports[key] = key;\n"],
];
console.log();
console.log('Part 2: importing CommonJS files (named exports are found by reading the source text)');
for (const [file, label, source] of cjsFiles) {
  fs.writeFileSync(path.join(dir, file), source);
  const ns = await import(pathToFileURL(path.join(dir, file)).href);
  const named = Object.keys(ns).filter((key) => key !== 'default' && key !== 'module.exports');
  console.log(`  ${label.padEnd(38)} named: ${(named.join(', ') || '(none)').padEnd(6)} default keys: ${Object.keys(ns.default).join(', ')}`);
}

fs.rmSync(dir, { recursive: true, force: true });
