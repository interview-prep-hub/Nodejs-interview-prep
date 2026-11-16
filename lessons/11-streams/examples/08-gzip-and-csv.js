// A real pipeline: write a CSV, gzip it, gunzip it, split lines, parse rows, add up a column (and the readline shortcut)
// Run: node lessons/11-streams/examples/08-gzip-and-csv.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { StringDecoder } = require('node:string_decoder');

const ROWS = 20000;
const CITIES = ['Paris', 'Tokyo', 'Lima', 'Oslo'];

// The data we write: a header line, then one line per row. A generator makes the lines one by one.
function* csvLines() {
  yield 'id,name,city,amount\n';
  for (let i = 1; i <= ROWS; i++) {
    yield `${i},user${i},${CITIES[i % 4]},${(i % 100) + 0.5}\n`;
  }
}

// Turns BYTES into LINES. Chunk borders fall anywhere, even in the middle of a line or of a
// multi-byte character, so we keep the unfinished part and add it to the next chunk.
class LineSplitter extends Transform {
  constructor() {
    super({ readableObjectMode: true }); // bytes go in, one string per line comes out
    this.decoder = new StringDecoder('utf8'); // never cuts a character in half
    this.rest = ''; // text after the last newline we have seen
  }

  _transform(chunk, encoding, callback) {
    this.rest += this.decoder.write(chunk);
    const lines = this.rest.split('\n');
    this.rest = lines.pop(); // the last piece has no newline yet, keep it for later
    for (const line of lines) this.push(line.endsWith('\r') ? line.slice(0, -1) : line);
    callback();
  }

  _flush(callback) {
    this.rest += this.decoder.end();
    if (this.rest.length > 0) this.push(this.rest); // a last line without a newline
    callback();
  }
}

// A generator stage: the first line is the header, every other line becomes an object.
// (This simple parser does not understand quoted fields like "Paris, France".)
async function* parseRows(lines) {
  let header = null;
  for await (const line of lines) {
    if (line === '') continue;
    const cells = line.split(',');
    if (header === null) {
      header = cells;
      continue;
    }
    const row = {};
    header.forEach((name, i) => {
      row[name] = cells[i];
    });
    yield row;
  }
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'streams-08-'));
  const csvFile = path.join(dir, 'people.csv');
  const gzFile = path.join(dir, 'people.csv.gz');
  const backFile = path.join(dir, 'people-restored.csv');

  try {
    console.log('--- 1. write the CSV with a pipeline ---');
    // pipeline resolves when the destination has finished writing, so the file is complete after await
    await pipeline(Readable.from(csvLines()), fs.createWriteStream(csvFile));
    console.log('csv bytes    :', fs.statSync(csvFile).size);

    console.log('\n--- 2. gzip it ---');
    await pipeline(fs.createReadStream(csvFile), zlib.createGzip(), fs.createWriteStream(gzFile));
    const gzSize = fs.statSync(gzFile).size;
    console.log('gzip bytes   :', gzSize);
    console.log('smaller by   :', Math.round((1 - gzSize / fs.statSync(csvFile).size) * 100) + '%');

    console.log('\n--- 3. gunzip it and check we got the same bytes back ---');
    await pipeline(fs.createReadStream(gzFile), zlib.createGunzip(), fs.createWriteStream(backFile));
    console.log('same sha256  :', (await sha256(csvFile)) === (await sha256(backFile)));

    console.log('\n--- 4. read the .gz, split lines, parse rows, add up a column ---');
    let rows = 0;
    let total = 0;
    const byCity = {};
    await pipeline(
      fs.createReadStream(gzFile),
      zlib.createGunzip(),
      new LineSplitter(),
      parseRows,
      async function (source) {
        for await (const row of source) {
          rows++;
          total += Number(row.amount);
          byCity[row.city] = (byCity[row.city] || 0) + 1;
        }
      },
    );
    console.log('rows         :', rows);
    console.log('sum of amount:', total);
    console.log('rows per city:', byCity);

    console.log('\n--- 5. the shortcut: readline turns any Readable into lines ---');
    const rl = readline.createInterface({
      input: fs.createReadStream(csvFile),
      crlfDelay: Infinity, // treat a Windows line end (CR LF) as ONE line break
    });
    let lineCount = 0;
    for await (const line of rl) {
      if (line.length > 0) lineCount++;
    }
    console.log('lines        :', lineCount, '(1 header + ' + ROWS + ' rows)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main();
