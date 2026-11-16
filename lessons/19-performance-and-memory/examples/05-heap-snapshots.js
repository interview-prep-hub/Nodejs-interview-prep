// Heap snapshots: write them, read them, and use the "three snapshot" technique to find a leak
// Run: node lessons/19-performance-and-memory/examples/05-heap-snapshots.js
// Chrome DevTools does the same analysis with buttons; here we do it in code so you can see how it works.
const v8 = require('node:v8');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ---- The "application" with a leak ------------------------------------------------------
class Session {
  constructor(id) {
    this.id = id;
    this.history = new Array(50).fill(id);
  }
}
class Report {
  constructor(id) {
    this.id = id;
    this.rows = new Array(50).fill(id);
  }
}
// A global singleton: easy to find in a snapshot (global -> appState -> ...).
globalThis.appState = { sessions: new Map(), lastReports: [] };

function handleRequest(id) {
  appState.sessions.set(id, new Session(id)); // LEAK: nothing ever removes a session
}
function runRound(firstId, count) {
  appState.lastReports = []; // NOT a leak: every round replaces the old reports
  for (let id = firstId; id < firstId + count; id++) {
    handleRequest(id);
    appState.lastReports.push(new Report(id));
  }
}

// ---- Take three snapshots ----------------------------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heap-snapshots-'));
const take = (name) => v8.writeHeapSnapshot(path.join(dir, name + '.heapsnapshot'));

const started = Date.now();
runRound(0, 10); // warm-up, so lazy things are created before the baseline
const file1 = take('snapshot-1');
runRound(10, 100);
const file2 = take('snapshot-2');
runRound(110, 100);
const file3 = take('snapshot-3');
console.log('wrote 3 snapshots in', Date.now() - started, 'ms; size of one file:', (fs.statSync(file3).size / 1024 / 1024).toFixed(1), 'MB');

// ---- Read a snapshot (it is plain JSON with flat arrays) ---------------------------------
function readSnapshot(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const meta = raw.snapshot.meta;
  const nodeSize = meta.node_fields.length; // type, name, id, self_size, edge_count, detachedness
  const edgeSize = meta.edge_fields.length; // type, name_or_index, to_node
  const nodeTypes = meta.node_types[0];
  const edgeTypes = meta.edge_types[0];
  const byId = new Map(); // object id -> { type, name, size, offset }
  for (let offset = 0; offset < raw.nodes.length; offset += nodeSize) {
    byId.set(raw.nodes[offset + 2], {
      type: nodeTypes[raw.nodes[offset]],
      name: raw.strings[raw.nodes[offset + 1]],
      size: raw.nodes[offset + 3], // "shallow size": the object itself, not what it points to
      offset,
    });
  }
  return { raw, byId, nodeSize, edgeSize, nodeTypes, edgeTypes };
}
const snap1 = readSnapshot(file1);
const snap2 = readSnapshot(file2);
const snap3 = readSnapshot(file3);
console.log('nodes in snapshot 3:', snap3.byId.size, '| edges:', snap3.raw.edges.length / snap3.edgeSize);

// ---- Step 1: count instances of our classes in each snapshot -----------------------------
function countClass(snap, name) {
  let count = 0;
  for (const node of snap.byId.values()) if (node.type === 'object' && node.name === name) count++;
  return count;
}
console.log('\ninstances per snapshot (1, 2, 3):');
for (const name of ['Session', 'Report']) {
  console.log('  ' + name.padEnd(8), countClass(snap1, name), countClass(snap2, name), countClass(snap3, name));
}

// ---- Step 2: the three snapshot technique ------------------------------------------------
// Object ids are stable between snapshots of the same process. So we can ask:
// "which objects were created between snapshot 1 and 2 AND are still alive in snapshot 3?"
// Normal temporary data from round 2 is gone by snapshot 3. What is left is the suspect list.
const suspects = new Map();
for (const [id, node] of snap2.byId) {
  if (snap1.byId.has(id) || !snap3.byId.has(id)) continue;
  const key = node.type + ' ' + node.name;
  const entry = suspects.get(key) || { count: 0, bytes: 0 };
  entry.count++;
  entry.bytes += node.size;
  suspects.set(key, entry);
}
console.log('\nalive in snapshot 3 but created between snapshot 1 and 2 (the biggest groups):');
for (const [key, e] of [...suspects].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 3)) {
  console.log('  ' + String(e.count).padStart(4) + ' x ' + key.padEnd(28) + e.bytes + ' bytes (shallow)');
}

// ---- Step 3: who keeps one suspect alive? (the "Retainers" view in DevTools) ---------------
function retainerPath(snap, targetOffset) {
  const { raw, nodeSize, edgeSize, nodeTypes, edgeTypes } = snap;
  const nodeCount = raw.nodes.length / nodeSize;
  const firstEdge = new Array(nodeCount);
  let edgeIndex = 0;
  for (let n = 0; n < nodeCount; n++) {
    firstEdge[n] = edgeIndex;
    edgeIndex += raw.nodes[n * nodeSize + 4] * edgeSize;
  }
  const cameFrom = new Map([[0, null]]); // node 0 is the root of all roots
  const queue = [0];
  const target = targetOffset / nodeSize;
  while (queue.length > 0 && !cameFrom.has(target)) {
    const n = queue.shift();
    for (let k = 0; k < raw.nodes[n * nodeSize + 4]; k++) {
      const at = firstEdge[n] + k * edgeSize;
      if (edgeTypes[raw.edges[at]] === 'weak') continue; // weak edges do not keep objects alive
      const to = raw.edges[at + 2] / nodeSize;
      if (!cameFrom.has(to)) {
        cameFrom.set(to, { from: n, edgeAt: at });
        queue.push(to);
      }
    }
  }
  const steps = [];
  for (let n = target; cameFrom.get(n); n = cameFrom.get(n).from) {
    const { from, edgeAt } = cameFrom.get(n);
    const edgeType = edgeTypes[raw.edges[edgeAt]];
    const edgeName = edgeType === 'element' || edgeType === 'hidden' ? '[' + raw.edges[edgeAt + 1] + ']' : raw.strings[raw.edges[edgeAt + 1]];
    const nodeName = raw.strings[raw.nodes[n * nodeSize + 1]] || '(internal table)';
    steps.unshift(`${from === 0 ? '(a GC root)' : edgeName} -> ${nodeName}`);
    if (from === 0) break;
  }
  return steps;
}
let oneSession;
for (const [id, node] of snap3.byId) {
  if (node.type === 'object' && node.name === 'Session' && !snap1.byId.has(id)) {
    oneSession = node;
    break;
  }
}
console.log('\nshortest path from the roots to one leaked Session:');
for (const step of retainerPath(snap3, oneSession.offset)) console.log('  ' + step);

fs.rmSync(dir, { recursive: true, force: true });
