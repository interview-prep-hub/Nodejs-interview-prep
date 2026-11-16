// Helper used by examples 06 and 07 (not run by itself).
// Reads a V8 CPU profile (the JSON format of .cpuprofile files) and prints it in a readable way.
'use strict';
const path = require('node:path');

function label(node) {
  const frame = node.callFrame;
  const name = frame.functionName || '(anonymous)';
  const where = frame.url ? `${path.basename(frame.url)}:${frame.lineNumber + 1}` : '';
  return where ? `${name} ${where}` : name;
}

// Microseconds spent with each node on TOP of the stack ("self time").
// timeDeltas[i] is the gap before sample i, so the time of sample i is the gap after it.
function selfTimes(profile) {
  const self = new Map();
  profile.samples.forEach((id, i) => {
    const dt = profile.timeDeltas[i + 1] ?? profile.timeDeltas[i];
    self.set(id, (self.get(id) || 0) + dt);
  });
  return self;
}

// "Which functions were on top of the stack most often?" (what a bottom-up view shows)
function printTop(profile, count = 6) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const perFunction = new Map();
  let total = 0;
  for (const [id, us] of selfTimes(profile)) {
    const key = label(byId.get(id));
    perFunction.set(key, (perFunction.get(key) || 0) + us);
    total += us;
  }
  const rows = [...perFunction].sort((a, b) => b[1] - a[1]).slice(0, count);
  for (const [key, us] of rows) {
    const ms = (us / 1000).toFixed(0).padStart(6);
    const pct = String(Math.round((us / total) * 100)).padStart(3);
    console.log(`  ${ms} ms ${pct}%  ${key}`);
  }
}

// "Who called whom, and how much time did each branch take in total?"
// This is the same information as a flame graph, written as an indented tree.
function printTree(profile, rootName, minPercent = 3) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = selfTimes(profile);
  const inclusive = new Map();
  const compute = (id) => {
    const node = byId.get(id);
    let sum = self.get(id) || 0;
    for (const child of node.children || []) sum += compute(child);
    inclusive.set(id, sum);
    return sum;
  };
  const root = profile.nodes.find((n) => n.callFrame.functionName === rootName);
  if (!root) return;
  const rootTime = compute(root.id);
  const walk = (id, depth) => {
    const pct = (inclusive.get(id) / rootTime) * 100;
    if (pct < minPercent) return;
    const node = byId.get(id);
    const selfPct = ((self.get(id) || 0) / rootTime) * 100;
    console.log(`  ${pct.toFixed(0).padStart(3)}% total ${selfPct.toFixed(0).padStart(3)}% self  ${'  '.repeat(depth)}${label(node)}`);
    const kids = [...(node.children || [])].sort((a, b) => inclusive.get(b) - inclusive.get(a));
    for (const child of kids) walk(child, depth + 1);
  };
  walk(root.id, 0);
}

module.exports = { printTop, printTree, selfTimes, label };
