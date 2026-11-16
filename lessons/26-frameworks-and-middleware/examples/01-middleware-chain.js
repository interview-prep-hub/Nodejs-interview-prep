// Mini-express stage 1: the middleware chain (app.use + next), order, and three ways to break it
// Run: node lessons/26-frameworks-and-middleware/examples/01-middleware-chain.js

const { createApp } = require('./_mini-express/01-chain');
const { start, line } = require('./_mini-express/testing');

async function main() {
  // ---------- Part 1: a chain runs in the order you wrote it
  const trail = [];
  const app1 = createApp();
  app1.use((req, res, next) => {
    trail.push('A before');
    next();
    trail.push('A after');
  });
  app1.use((req, res, next) => {
    trail.push('B before');
    next();
    trail.push('B after');
  });
  app1.use((req, res) => {
    trail.push('C answers');
    res.end('hello from C');
  });

  let server = await start(app1);
  console.log('Part 1: three middleware');
  console.log('  response :', line(await server.get('/')));
  console.log('  trail    :', trail.join(' > '));
  await server.close();

  // ---------- Part 2: order matters (the same two functions, swapped)
  const seen = [];
  const handler = (req, res) => res.end('handled');
  const spy = (req, res, next) => {
    seen.push(req.url);
    next();
  };

  const before = createApp().use(spy).use(handler);
  server = await start(before);
  await server.get('/one');
  await server.close();
  console.log('Part 2: spy BEFORE the handler saw :', JSON.stringify(seen));

  seen.length = 0;
  const after = createApp().use(handler).use(spy); // the handler answers first, spy is never reached
  server = await start(after);
  await server.get('/two');
  await server.close();
  console.log('Part 2: spy AFTER the handler saw  :', JSON.stringify(seen));

  // ---------- Part 3: a middleware that does NOT call next() stops the chain (a gate)
  const reached = [];
  const gate = createApp()
    .use((req, res, next) => {
      if (req.headers['x-token'] !== 'secret') {
        res.statusCode = 401;
        res.end('no token'); // answer here and return: next() is not called
        return;
      }
      next();
    })
    .use((req, res) => {
      reached.push('handler');
      res.end('secret data');
    });
  server = await start(gate);
  console.log('Part 3: a gate');
  console.log('  without token :', line(await server.get('/')), '| handler reached:', reached.length > 0);
  reached.length = 0;
  console.log('  with token    :', line(await server.get('/', { headers: { 'x-token': 'secret' } })), '| handler reached:', reached.length > 0);
  await server.close();

  // ---------- Part 4: calling next() TWICE
  // The counter "index" is shared, so the second call does not repeat B. It moves on to the next
  // function in line, even if the response was already sent.
  const log = [];
  const twice = createApp()
    .use((req, res, next) => {
      log.push('A');
      next();
      next(); // the bug
    })
    .use((req, res, next) => {
      log.push('B');
      next();
    })
    .use((req, res) => {
      log.push('C answers');
      res.end('C was first');
    })
    .use((req, res) => {
      log.push('D runs');
      try {
        res.setHeader('X-Late', '1'); // the response is already gone
      } catch (err) {
        log.push(`D failed with ${err.code}`);
      }
    });
  server = await start(twice);
  console.log('Part 4: next() called twice');
  console.log('  response :', line(await server.get('/')));
  console.log('  log      :', log.join(' > '));
  await server.close();

  // ---------- Part 5: never calling next() and never ending the response
  const hang = createApp().use(() => {
    // forgot both next() and res.end()
  });
  server = await start(hang);
  console.log('Part 5: forgot next() and res.end()');
  try {
    await server.get('/', { signal: AbortSignal.timeout(300) });
  } catch (err) {
    console.log('  the client gave up:', err.name, '(the server never answered)');
  }
  await server.close();
}

main();
