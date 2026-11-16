#!/usr/bin/env node
// A small but complete CLI called "wcl": counts lines, words and characters of files or of standard input
// Run: node lessons/15-processes-and-cli/examples/09-mini-cli.js --help
// @args --help

const fs = require('node:fs');
const { parseArgs, styleText } = require('node:util');

const NAME = 'wcl';
const VERSION = '1.2.0'; // a real CLI reads this from its package.json

// Exit codes: keep them few and document them in --help.
const EXIT_OK = 0;
const EXIT_FAILURE = 1; // something went wrong while working (a file could not be read)
const EXIT_USAGE = 2; // the command line itself was wrong

const options = {
  lines: { type: 'boolean', short: 'l' },
  words: { type: 'boolean', short: 'w' },
  chars: { type: 'boolean', short: 'c' },
  json: { type: 'boolean', short: 'j' },
  verbose: { type: 'boolean' },
  color: { type: 'boolean' }, // allowNegative below also accepts --no-color
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

const HELP = `${NAME} ${VERSION} - count lines, words and characters

Usage:
  ${NAME} [options] [file...]
  some-command | ${NAME} [options]

Use "-" as a file name to read standard input.

Options:
  -l, --lines     show the number of lines
  -w, --words     show the number of words
  -c, --chars     show the number of characters
  -j, --json      print the result as JSON
      --verbose   print progress messages to stderr
      --color     force colors (default: only when writing to a terminal)
      --no-color  never use colors
  -h, --help      show this help and exit
  -v, --version   show the version and exit

Exit codes:
  0  success
  1  a file could not be read
  2  wrong usage (unknown option, or no input given)
`;

// Pure function: easy to test without starting a process.
function count(text) {
  const newlines = text.split('\n').length - 1;
  const endsWithNewline = text.endsWith('\n');
  return {
    lines: text === '' ? 0 : newlines + (endsWithNewline ? 0 : 1),
    words: text.split(/\s+/).filter(Boolean).length,
    chars: [...text].length,
  };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

// Returns a function paint(format, text). Colors are decided separately for each output stream.
function makePainter(colorOption, stream) {
  if (colorOption === false) return (format, text) => text; // --no-color
  // --color forces escape codes. Otherwise styleText decides: no colors if the stream is not a terminal,
  // and it also honours the NO_COLOR and FORCE_COLOR environment variables.
  return (format, text) => styleText(format, text, { stream, validateStream: colorOption !== true });
}

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: true, allowNegative: true });
  } catch (err) {
    // Bad command line: say what is wrong on stderr, point to --help, exit with the "usage" code.
    console.error(`${NAME}: ${err.message}`);
    console.error(`Try '${NAME} --help'.`);
    return EXIT_USAGE;
  }
  const { values, positionals } = parsed;

  if (values.help) {
    process.stdout.write(HELP); // HELP already ends with a newline
    return EXIT_OK;
  }
  if (values.version) {
    console.log(VERSION);
    return EXIT_OK;
  }

  const inputs = positionals.length > 0 ? positionals : ['-'];
  if (inputs.includes('-') && process.stdin.isTTY) {
    // Reading from a keyboard would just hang. Tell the person instead.
    console.error(`${NAME}: no input. Give a file name, or pipe text into ${NAME}.`);
    console.error(`Try '${NAME} --help'.`);
    return EXIT_USAGE;
  }

  const paintOut = makePainter(values.color, process.stdout);
  const paintErr = makePainter(values.color, process.stderr);
  const wanted = ['lines', 'words', 'chars'].filter((key) => values[key]);
  const columns = wanted.length > 0 ? wanted : ['lines', 'words', 'chars'];

  const results = [];
  let failures = 0;
  for (const [index, input] of inputs.entries()) {
    // Progress and messages go to stderr, so stdout only ever contains the result and can be piped.
    if (values.verbose) console.error(`[${index + 1}/${inputs.length}] reading ${input === '-' ? 'standard input' : input}`);
    try {
      const text = input === '-' ? await readStdin() : fs.readFileSync(input, 'utf8');
      results.push({ name: input === '-' ? 'stdin' : input, ...count(text) });
    } catch (err) {
      failures++;
      console.error(`${paintErr('red', `${NAME}: error:`)} cannot read ${input} (${err.code ?? err.message})`);
    }
  }

  if (values.json) {
    const rows = results.map((row) => ({ name: row.name, ...Object.fromEntries(columns.map((key) => [key, row[key]])) }));
    console.log(JSON.stringify(rows, null, 2));
  } else {
    for (const row of results) {
      const cells = columns.map((key) => `${key}=${paintOut('cyan', String(row[key]))}`);
      console.log(`${cells.join(' ')}  ${paintOut('bold', row.name)}`);
    }
  }
  return failures > 0 ? EXIT_FAILURE : EXIT_OK;
}

module.exports = { main, count };

// Run only when started as a program (node 09-mini-cli.js), not when another file require()s this one.
if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code; // not process.exit(code): let pending output finish first
    },
    (err) => {
      console.error(`${NAME}: unexpected error: ${err.stack}`);
      process.exitCode = EXIT_FAILURE;
    },
  );
}
