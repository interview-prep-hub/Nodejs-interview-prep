// Code under test for the coverage demo. Some branches are never exercised by grade-suite.js on purpose.

function grade(score) {
  if (score < 0 || score > 100) {
    throw new RangeError('score out of range');
  }
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  return 'F';
}

function passed(score) {
  return grade(score) !== 'F';
}

module.exports = { grade, passed };
