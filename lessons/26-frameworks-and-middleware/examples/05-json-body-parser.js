// Mini-express stage 5: a JSON body-parser middleware (content type, size limit, bad JSON, order)
// Run: node lessons/26-frameworks-and-middleware/examples/05-json-body-parser.js

const { createApp, httpError } = require('./_mini-express/04-errors');
const { init } = require('./_mini-express/03-helpers');
const { json } = require('./_mini-express/05-json');
const { start, line } = require('./_mini-express/testing');

function buildApp() {
  const app = createApp({ silent: true });
  app.use(init);

  // The parser is added only to the routes that need it.
  app.post('/users', json({ limit: 200 }), (req, res) => {
    res.status(201).json({ received: req.body, type: typeof req.body });
  });

  // A route WITHOUT the parser: req.body stays undefined, even if the client sends JSON.
  app.post('/no-parser', (req, res) => {
    res.json({ body: req.body === undefined ? 'undefined' : req.body });
  });

  // WRONG ORDER: the handler comes before the parser, so the parser is never reached.
  app.post('/wrong-order', (req, res, next) => {
    res.json({ sawBody: req.body !== undefined });
  }, json());

  app.use((req, res, next) => next(httpError(404, 'Not Found')));
  app.use((err, req, res, next) => {
    res.status(err.status ?? 500).json({ error: err.expose ? err.message : 'Internal Server Error' });
  });
  return app;
}

async function main() {
  const server = await start(buildApp());
  const send = async (label, path, options) => {
    const res = await server.post(path, options);
    console.log(label.padEnd(38), line(res));
  };
  const asJson = { 'content-type': 'application/json' };

  console.log('--- the happy path');
  await send('valid JSON object', '/users', { json: { name: 'Ada', langs: ['js', 'ts'] } });
  await send('valid JSON array', '/users', { body: '[1,2,3]', headers: asJson });
  await send('empty body', '/users', { body: '', headers: asJson });

  console.log('--- it is picky on purpose');
  await send('wrong Content-Type: parser skips', '/users', { body: '{"name":"Ada"}', headers: { 'content-type': 'text/plain' } });
  await send('an empty Content-Type header', '/users', { body: '{"name":"Ada"}', headers: { 'content-type': '' } });
  await send('broken JSON -> 400', '/users', { body: '{"name": "Ada",', headers: asJson });
  await send('a bare string is not allowed (strict)', '/users', { body: '"hello"', headers: asJson });
  await send('too big (limit 200 bytes) -> 413', '/users', { json: { name: 'x'.repeat(500) } });

  console.log('--- the parser must be in the chain, and before the handler');
  await send('route without the parser', '/no-parser', { json: { a: 1 } });
  await send('parser placed after the handler', '/wrong-order', { json: { a: 1 } });

  await server.close();
}

main();
