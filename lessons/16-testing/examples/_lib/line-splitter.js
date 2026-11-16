// Code under test for lesson 16: a Transform stream that turns chunks of text into whole lines.
// The hard part, and the reason to test it: a chunk can end in the middle of a line, or even in
// the middle of a multi-byte character, so the stream must remember what is left over.

const { Transform } = require('node:stream');
const { StringDecoder } = require('node:string_decoder');

function createLineSplitter({ maxLineLength = 1000 } = {}) {
  const decoder = new StringDecoder('utf8'); // keeps half-finished characters between chunks
  let rest = '';

  return new Transform({
    readableObjectMode: true, // we push strings (lines), one per read
    transform(chunk, _encoding, callback) {
      rest += decoder.write(chunk);
      const lines = rest.split('\n');
      rest = lines.pop(); // the last piece has no newline yet, keep it for the next chunk

      if (rest.length > maxLineLength) {
        const error = new Error(`line longer than ${maxLineLength} characters`);
        error.code = 'ERR_LINE_TOO_LONG';
        return callback(error);
      }
      for (const line of lines) this.push(line);
      callback();
    },
    flush(callback) {
      rest += decoder.end();
      if (rest) this.push(rest); // a final line without a trailing newline
      callback();
    },
  });
}

module.exports = { createLineSplitter };
