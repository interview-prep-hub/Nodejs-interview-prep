// A mini semver range checker: does version X satisfy range Y? (^ ~ x-ranges, hyphen, comparators, ||)
// Run: node lessons/04-npm-and-package-json/examples/03-semver-ranges.js
'use strict';

const { parse, compare } = require('./02-semver-versions.js');

// Every range is turned into plain comparators like {op: '>=', version: '1.2.3'}.
// A space between comparators means AND. "||" means OR. So a range = OR of AND-groups.

// "1", "1.2" or "1.2.x" -> { major: 1, minor: 2, patch: undefined }. x, X and * mean "any".
function partial(text) {
  const [core, prerelease] = text.split(/-(.+)/);
  const [major, minor, patch] = core.split('.').map((n) => (/^[xX*]?$/.test(n) ? undefined : Number(n)));
  return { major, minor, patch, prerelease: prerelease || '' };
}

const full = ({ major = 0, minor = 0, patch = 0, prerelease = '' }) =>
  `${major}.${minor}.${patch}${prerelease ? '-' + prerelease : ''}`;

const ge = (v) => ({ op: '>=', version: v });
const lt = (v) => ({ op: '<', version: v });

function caret(text) {
  const p = partial(text);
  const low = ge(full(p));
  if (p.major === undefined) return [ge('0.0.0')];
  if (p.major > 0) return [low, lt(`${p.major + 1}.0.0`)]; // ^1.2.3 -> <2.0.0
  if (p.minor === undefined) return [low, lt('1.0.0')]; // ^0 -> <1.0.0
  if (p.minor > 0 || p.patch === undefined) return [low, lt(`0.${p.minor + 1}.0`)]; // ^0.2.3 -> <0.3.0
  return [low, lt(`0.0.${p.patch + 1}`)]; // ^0.0.3 -> <0.0.4 (only that patch)
}

function tilde(text) {
  const p = partial(text);
  if (p.major === undefined) return [ge('0.0.0')];
  const upper = p.minor === undefined ? `${p.major + 1}.0.0` : `${p.major}.${p.minor + 1}.0`;
  return [ge(full(p)), lt(upper)]; // ~1.2.3 -> <1.3.0   ~1 -> <2.0.0
}

// "1.2.3" is exact. "1.2" and "1.2.x" and "1" and "*" are x-ranges.
function xRange(text) {
  const p = partial(text);
  if (p.major === undefined) return [ge('0.0.0')];
  if (p.minor === undefined) return [ge(full(p)), lt(`${p.major + 1}.0.0`)];
  if (p.patch === undefined) return [ge(full(p)), lt(`${p.major}.${p.minor + 1}.0`)];
  return [{ op: '=', version: full(p) }];
}

function hyphen(from, to) {
  const hi = partial(to);
  let upper;
  if (hi.major === undefined) upper = null;
  else if (hi.minor === undefined) upper = lt(`${hi.major + 1}.0.0`); // 1.2.3 - 2  ->  <3.0.0
  else if (hi.patch === undefined) upper = lt(`${hi.major}.${hi.minor + 1}.0`); // - 2.3  ->  <2.4.0
  else upper = { op: '<=', version: full(hi) };
  return upper ? [ge(full(partial(from))), upper] : [ge(full(partial(from)))];
}

function parseToken(token) {
  if (token.startsWith('^')) return caret(token.slice(1));
  if (token.startsWith('~')) return tilde(token.slice(1));
  const m = /^(>=|<=|>|<|=)(.+)$/.exec(token);
  if (m) {
    if (m[1] === '=') return xRange(m[2]); // "=1.2.3" is exact, "=1" means 1.x
    const p = partial(m[2]);
    // The real semver package accepts ">1" (meaning >=2.0.0) and "<=1" (meaning <2.0.0).
    // We leave those out and say so, instead of quietly giving a wrong answer.
    if (p.patch === undefined && (m[1] === '>' || m[1] === '<=')) {
      throw new Error(`This mini checker needs a full version after ${m[1]}: "${token}"`);
    }
    return [{ op: m[1], version: full(p) }];
  }
  return xRange(token);
}

function parseRange(range) {
  return range.split('||').map((group) => {
    const text = group.trim().replace(/([<>=~^])\s+/g, '$1'); // allow ">= 1.2.3"
    if (text === '') return [ge('0.0.0')]; // an empty range means "anything"
    const dash = /^(\S+)\s+-\s+(\S+)$/.exec(text);
    if (dash) return hyphen(dash[1], dash[2]);
    return text.split(/\s+/).flatMap(parseToken);
  });
}

const TESTS = {
  '>': (c) => c > 0,
  '>=': (c) => c >= 0,
  '<': (c) => c < 0,
  '<=': (c) => c <= 0,
  '=': (c) => c === 0,
};

function satisfies(version, range) {
  const v = parse(version);
  return parseRange(range).some((group) => {
    if (!group.every((c) => TESTS[c.op](compare(version, c.version)))) return false;
    // Prerelease rule: 2.0.0-beta.1 only matches if some comparator in the group
    // mentions a prerelease of the SAME major.minor.patch. This protects you from betas.
    if (v.prerelease.length === 0) return true;
    return group.some((c) => {
      const w = parse(c.version);
      return w.prerelease.length > 0 && w.major === v.major && w.minor === v.minor && w.patch === v.patch;
    });
  });
}

// What npm does when it has a list of published versions: take the highest match.
function maxSatisfying(versions, range) {
  const matches = versions.filter((v) => satisfies(v, range)).sort(compare);
  return matches.length ? matches[matches.length - 1] : null;
}

const show = (group) => group.map((c) => (c.op === '=' ? '' : c.op) + c.version).join(' ');
const expand = (range) => parseRange(range).map(show).join('  ||  ');

module.exports = { satisfies, maxSatisfying, expand };

if (require.main === module) {
  const published = ['0.2.9', '0.3.0', '1.2.2', '1.2.3', '1.2.9', '1.3.0', '1.9.9', '2.0.0-beta.1', '2.0.0', '2.1.0'];
  console.log('Published versions:', published.join(' '), '\n');

  const ranges = ['1.2.3', '^1.2.3', '~1.2.3', '1.x', '*', '>=1.2.3 <1.9.0', '1.2.3 - 1.3.0', '^0.2.9', '~2.0.0', '<1.2.3 || >=2.1.0'];
  for (const range of ranges) {
    const ok = published.filter((v) => satisfies(v, range));
    console.log(`${range.padEnd(18)} means ${expand(range)}`);
    console.log(`${''.padEnd(18)} matches: ${ok.join(' ') || '(nothing)'}  -> highest match: ${maxSatisfying(published, range)}\n`);
  }

  console.log('Prerelease rule (a beta is only chosen when you ask for that beta):');
  for (const [v, r] of [['2.0.0-beta.1', '^1.2.3'], ['2.0.0-beta.1', '>=1.0.0'], ['2.0.0-beta.1', '^2.0.0-beta.0'], ['2.0.0-beta.1', '2.x']]) {
    console.log(`  satisfies("${v}", "${r}") = ${satisfies(v, r)}`);
  }
}
