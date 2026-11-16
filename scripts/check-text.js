'use strict';
// Checks the written content of the whole repo.
//
//   1. No em dashes (U+2014) anywhere. En dashes (U+2013) are reported as warnings.
//   2. No mentions of AI tools or their makers in any file.
//   3. Every relative link in every .md file points to a file or folder that exists.
//   4. Every lessons/NN-name folder has a README.md.
//
// Usage: node scripts/check-text.js

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const TEXT = /\.(md|js|mjs|cjs|ts|json|txt|yml|yaml|sh|cmd|dockerfile)$/i;
const EM_DASH = new RegExp(String.fromCharCode(0x2014));
const EN_DASH = new RegExp(String.fromCharCode(0x2013));
const FORBIDDEN = new RegExp(['\\b(cla' + 'ude|anthro' + 'pic)\\b', 'co-authored-by', 'generated with'].join('|'), 'i');

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const errors = [];
const warnings = [];
const rel = (p) => path.relative(root, p).split(path.sep).join('/');

for (const file of walk(root)) {
  const name = path.basename(file);
  if (file === __filename) continue;
  if (!TEXT.test(file) && name !== 'Dockerfile') continue;
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    if (EM_DASH.test(line)) errors.push(`${rel(file)}:${i + 1}: em dash`);
    if (EN_DASH.test(line)) warnings.push(`${rel(file)}:${i + 1}: en dash`);
    if (FORBIDDEN.test(line)) errors.push(`${rel(file)}:${i + 1}: forbidden mention`);
  });

  if (file.endsWith('.md')) {
    let inFence = false;
    lines.forEach((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return;
      }
      if (inFence) return;
      const stripped = line.replace(/`[^`]*`/g, '');
      for (const m of stripped.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        let target = m[1];
        if (/^(https?:|mailto:|#|data:)/i.test(target)) continue;
        target = decodeURIComponent(target.split('#')[0]);
        if (!target) continue;
        // Files in rounds/<round>/_parts/ are merged into the round folder later, so their links are written relative to that folder.
        const baseDir = path.basename(path.dirname(file)) === '_parts' ? path.dirname(path.dirname(file)) : path.dirname(file);
        const resolved = path.resolve(baseDir, target);
        if (!fs.existsSync(resolved)) errors.push(`${rel(file)}:${i + 1}: broken link -> ${m[1]}`);
      }
    });
  }
}

const lessonsDir = path.join(root, 'lessons');
if (fs.existsSync(lessonsDir)) {
  for (const d of fs.readdirSync(lessonsDir, { withFileTypes: true })) {
    if (d.isDirectory() && !fs.existsSync(path.join(lessonsDir, d.name, 'README.md'))) {
      errors.push(`lessons/${d.name}: missing README.md`);
    }
  }
}

for (const w of warnings.slice(0, 50)) console.log(`WARN  ${w}`);
if (warnings.length > 50) console.log(`WARN  ... and ${warnings.length - 50} more en dash warnings`);
for (const e of errors) console.log(`ERROR ${e}`);
console.log(`\n${errors.length} errors, ${warnings.length} warnings`);
process.exit(errors.length === 0 ? 0 : 1);
