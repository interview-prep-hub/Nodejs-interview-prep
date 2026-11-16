'use strict';
// Checks every rounds/<round>/questions.md against answers.md:
// every question ID must have an answer, every answer must have a question, and IDs must be unique.
//
// Usage: node scripts/check-qa.js

const fs = require('node:fs');
const path = require('node:path');

const roundsDir = path.resolve(__dirname, '..', 'rounds');
const ID = /^###\s+(R\d+-[A-Z0-9]+-\d+)\b/gm;
const ids = (text) => [...text.matchAll(ID)].map((m) => m[1]);
let problems = 0;

for (const round of fs.readdirSync(roundsDir, { withFileTypes: true })) {
  if (!round.isDirectory() || round.name.startsWith('_') || round.name === 'mock-interviews') continue;
  const qFile = path.join(roundsDir, round.name, 'questions.md');
  const aFile = path.join(roundsDir, round.name, 'answers.md');
  if (!fs.existsSync(qFile) || !fs.existsSync(aFile)) {
    console.log(`${round.name}: questions.md or answers.md is missing`);
    problems++;
    continue;
  }
  const q = ids(fs.readFileSync(qFile, 'utf8'));
  const a = ids(fs.readFileSync(aFile, 'utf8'));
  const noAnswer = q.filter((id) => !a.includes(id));
  const noQuestion = a.filter((id) => !q.includes(id));
  const dupes = q.filter((id, i) => q.indexOf(id) !== i);
  console.log(`${round.name}: ${q.length} questions, ${a.length} answers`);
  for (const id of noAnswer) console.log(`   no answer for ${id}`);
  for (const id of noQuestion) console.log(`   answer without question ${id}`);
  for (const id of dupes) console.log(`   duplicate question id ${id}`);
  problems += noAnswer.length + noQuestion.length + dupes.length;
}

process.exit(problems === 0 ? 0 : 1);
