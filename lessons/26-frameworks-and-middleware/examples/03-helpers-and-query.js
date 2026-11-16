// Mini-express stage 3: req.query, req.path, res.status().json(), res.send(), and a safe HTML template
// Run: node lessons/26-frameworks-and-middleware/examples/03-helpers-and-query.js

const { createApp } = require('./_mini-express/02-routing'); // routing from stage 2 ...
const { init } = require('./_mini-express/03-helpers'); //      ... plus the helpers of stage 3
const { start } = require('./_mini-express/testing');

// ---------- a tiny HTML template: values are escaped, the text you wrote is trusted ----------
class Safe {
  constructor(text) {
    this.text = text;
  }
}
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

function html(strings, ...values) {
  const render = (v) => (v instanceof Safe ? v.text : Array.isArray(v) ? v.map(render).join('') : escapeHtml(v));
  let out = strings[0];
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1];
  });
  return new Safe(out);
}

async function main() {
  const app = createApp();
  app.use(init); // must be first: it switches req and res to the versions with helpers

  app.get('/search', (req, res) => res.json({ path: req.path, query: req.query }));
  app.get('/teapot', (req, res) => res.status(418).json({ error: "I'm a teapot" }));
  app.get('/text', (req, res) => res.send('plain <b>text</b>'));
  app.get('/object', (req, res) => res.send({ sent: 'as json' }));
  app.get('/bytes', (req, res) => res.send(Buffer.from('abc')));
  app.get('/headers', (req, res) => res.set('Cache-Control', 'no-store').set('X-Demo', 'yes').json({ ok: true }));
  app.get('/bad-status', (req, res) => {
    try {
      res.status(99);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get('/users', (req, res) => {
    const users = [{ name: 'Ada' }, { name: '<script>alert(1)</script>' }];
    const page = html`<h1>Users</h1><ul>${users.map((u) => html`<li>${u.name}</li>`)}</ul>`;
    res.send(page.text);
  });

  const server = await start(app);
  const show = async (path) => {
    const res = await server.get(path);
    const type = res.headers.get('content-type');
    console.log(`GET ${path}`);
    console.log(`  -> ${res.status}  content-type: ${type}  length: ${res.headers.get('content-length')}`);
    console.log(`  -> body: ${res.text}`);
    return res;
  };

  console.log('--- query string');
  await show('/search?a=1&b[c]=2&d=3&d=4');
  await show('/search?toString=x&name=Ada%20Lovelace&empty=');
  await show('/search');

  console.log('--- res helpers');
  await show('/teapot');
  await show('/text');
  await show('/object');
  await show('/bytes');
  const withHeaders = await show('/headers');
  console.log(`  -> cache-control: ${withHeaders.headers.get('cache-control')}, x-demo: ${withHeaders.headers.get('x-demo')}`);
  await show('/bad-status');

  console.log('--- server-side rendering: values are escaped');
  await show('/users');

  await server.close();
}

main();
