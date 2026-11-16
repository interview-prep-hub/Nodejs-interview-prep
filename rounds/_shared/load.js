'use strict';
// Used by the challenge tests to load the code under test.
//
//   Normal run : loads YOUR file from the challenge folder (starter code, or your own work).
//   SOLUTION=1 : loads the reference solution from the challenge's solution/ folder.
//
// You never need to edit this file.

const path = require('node:path');

function load(challengeDir, file) {
  const base = process.env.SOLUTION === '1' ? path.join(challengeDir, 'solution') : challengeDir;
  return require(path.join(base, file));
}

module.exports = { load };
