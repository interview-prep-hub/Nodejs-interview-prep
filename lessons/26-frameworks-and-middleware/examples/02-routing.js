// Mini-express stage 2: routing with a method, a path and :params
// Run: node lessons/26-frameworks-and-middleware/examples/02-routing.js

const { createApp, compile } = require('./_mini-express/02-routing');
const { start, line } = require('./_mini-express/testing');

async function main() {
  // What does a pattern turn into?
  console.log('--- how a pattern is compiled');
  for (const pattern of ['/users', '/users/:id', '/posts/:year/:slug', '/files/report.pdf']) {
    const { regex, keys } = compile(pattern);
    console.log(' ', pattern.padEnd(20), '->', String(regex).padEnd(34), 'keys:', JSON.stringify(keys));
  }

  const app = createApp();

  // A logger that runs for every request (no method, no path)
  const seen = [];
  app.use((req, res, next) => {
    seen.push(`${req.method} ${req.url}`);
    next();
  });

  app.get('/', (req, res) => res.end('home'));
  app.get('/users/:id', (req, res) => res.end(`user ${req.params.id}`));
  app.post('/users', (req, res) => {
    res.statusCode = 201;
    res.end('created');
  });
  app.get('/posts/:year/:slug', (req, res) => res.end(JSON.stringify(req.params)));
  app.get('/files/report.pdf', (req, res) => res.end('the pdf'));

  // Two handlers on one route: the first one is a guard, like auth would be.
  const onlyAdmin = (req, res, next) => {
    if (req.headers['x-role'] !== 'admin') {
      res.statusCode = 403;
      res.end('admins only');
      return;
    }
    next();
  };
  app.get('/admin', onlyAdmin, (req, res) => res.end('admin panel'));

  // The FIRST matching route wins, so the order of registration matters.
  app.get('/people/:name', (req, res) => res.end(`person ${req.params.name}`));
  app.get('/people/me', (req, res) => res.end('the current user')); // never reached: ':name' already matches 'me'

  // app.all matches every method
  app.all('/ping', (req, res) => res.end(`ping via ${req.method}`));

  const server = await start(app);
  const show = async (label, method, path, options) => {
    const res = await server.request(method, path, options);
    console.log(' ', label.padEnd(40), line(res));
  };

  console.log('--- matching');
  await show('GET /', 'GET', '/');
  await show('GET /users/42', 'GET', '/users/42');
  await show('GET /users/42/ (trailing slash)', 'GET', '/users/42/');
  await show('GET /users/ada%20lovelace', 'GET', '/users/ada%20lovelace');
  await show('GET /users/7?sort=asc', 'GET', '/users/7?sort=asc');
  await show('POST /users', 'POST', '/users');
  await show('GET /posts/2026/hello-world', 'GET', '/posts/2026/hello-world');
  await show('GET /files/report.pdf', 'GET', '/files/report.pdf');
  await show('GET /files/reportXpdf (dot is literal)', 'GET', '/files/reportXpdf');
  await show('GET /people/me (route order)', 'GET', '/people/me');
  await show('GET /admin (no role)', 'GET', '/admin');
  await show('GET /admin (admin)', 'GET', '/admin', { headers: { 'x-role': 'admin' } });
  await show('DELETE /ping (app.all)', 'DELETE', '/ping');

  console.log('--- no match');
  await show('GET /nothing', 'GET', '/nothing');
  await show('DELETE /users/1 (no such route)', 'DELETE', '/users/1');
  await show('GET /users (only POST exists)', 'GET', '/users');
  await show('GET /users/%E0%A4%A (bad encoding)', 'GET', '/users/%E0%A4%A');

  console.log('--- the logger ran for every request:', seen.length, 'times');
  await server.close();
}

main();
