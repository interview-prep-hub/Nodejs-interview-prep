'use strict';
// Builds questions.md and answers.md for every round from rounds/<round>/_parts/*.
//
// Parts are named NN-topic.questions.md and NN-topic.answers.md. They are joined in file name order.
// Every question heading looks like:  ### R2-EV-01 [Easy] The question text
// This script also checks that every question ID has an answer and the other way round.
//
// Usage:
//   node scripts/merge-rounds.js                merge, check IDs, then delete the _parts folders
//   node scripts/merge-rounds.js --keep-parts   merge and check IDs, keep the _parts folders

const fs = require('node:fs');
const path = require('node:path');

const roundsDir = path.resolve(__dirname, '..', 'rounds');
const keep = process.argv.includes('--keep-parts');
const ID = /^###\s+(R\d+-[A-Z0-9]+-\d+)\b/gm;
let problems = 0;

function ids(text) {
  return [...text.matchAll(ID)].map((m) => m[1]);
}

for (const round of fs.readdirSync(roundsDir, { withFileTypes: true })) {
  if (!round.isDirectory() || round.name.startsWith('_')) continue;
  const roundDir = path.join(roundsDir, round.name);
  const parts = path.join(roundDir, '_parts');
  if (!fs.existsSync(parts)) continue;
  const files = fs.readdirSync(parts).sort();
  const built = {};
  for (const kind of ['questions', 'answers']) {
    const chunks = files
      .filter((f) => f.endsWith(`.${kind}.md`))
      .map((f) => fs.readFileSync(path.join(parts, f), 'utf8').trim());
    if (chunks.length === 0) continue;
    built[kind] = chunks.join('\n\n---\n\n') + '\n';
    fs.writeFileSync(path.join(roundDir, `${kind}.md`), built[kind]);
  }
  const q = ids(built.questions || '');
  const a = ids(built.answers || '');
  const missingAnswers = q.filter((id) => !a.includes(id));
  const missingQuestions = a.filter((id) => !q.includes(id));
  const dupes = q.filter((id, i) => q.indexOf(id) !== i);
  console.log(`${round.name}: ${q.length} questions, ${a.length} answers`);
  for (const id of missingAnswers) console.log(`   no answer for ${id}`);
  for (const id of missingQuestions) console.log(`   answer without question ${id}`);
  for (const id of dupes) console.log(`   duplicate question id ${id}`);
  problems += missingAnswers.length + missingQuestions.length + dupes.length;
  if (!keep) fs.rmSync(parts, { recursive: true, force: true });
}

process.exit(problems === 0 ? 0 : 1);
