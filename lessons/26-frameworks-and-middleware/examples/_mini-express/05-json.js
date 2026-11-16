// Mini-express, stage 5: a JSON body parser, written as an ordinary middleware.
// Helper module, not run by itself. Used by examples/05-json-body-parser.js and later examples.
//
// Why this is a middleware and not part of the framework: many requests have no body (GET), and
// reading a body costs time and memory, so each route chain opts in: app.post('/x', json(), handler).
// It follows the rules of the real express.json():
//   - only runs for Content-Type: application/json (otherwise it does nothing and req.body stays undefined)
//   - has a size limit (default 100 kilobytes) and answers 413 when the body is bigger
//   - answers 400 for broken JSON
//   - "strict" mode: only objects and arrays are accepted at the top level

const { httpError } = require('./04-errors');

function json({ limit = 100 * 1024 } = {}) {
  return function jsonParser(req, res, next) {
    if (req.body !== undefined) return next(); // an earlier parser already did the work

    const type = req.headers['content-type'] || '';
    if (!/^application\/json\b/i.test(type)) return next(); // not for us

    // Cheap early check: the client announced a size that is already too big. Do not read anything.
    if (Number(req.headers['content-length']) > limit) {
      return next(httpError(413, 'Payload Too Large'));
    }

    const chunks = [];
    let size = 0;
    let failed = false;

    req.on('data', (chunk) => {
      if (failed) return; // keep draining the stream, but ignore the data
      size += chunk.length;
      if (size > limit) {
        failed = true; // the Content-Length header can lie or be missing (chunked upload): count real bytes
        next(httpError(413, 'Payload Too Large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (failed) return;
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.trim() === '') {
        req.body = {}; // an empty body counts as "no fields"
        return next();
      }
      if (!/^\s*[[{]/.test(text)) return next(httpError(400, 'JSON body must be an object or an array'));
      try {
        req.body = JSON.parse(text);
      } catch {
        return next(httpError(400, 'Invalid JSON'));
      }
      next();
    });

    req.on('error', next);
  };
}

module.exports = { json };
