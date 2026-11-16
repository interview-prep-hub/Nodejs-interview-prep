// Test helper for the examples: start any request listener on a free port and call it with fetch.
// Helper module, not run by itself.
//
// This is the same idea that "supertest" uses: no fixed port, the operating system picks one (port 0).

const http = require('node:http');
const { once } = require('node:events');

async function start(listener) {
  const server = http.createServer(listener);
  server.listen(0, '127.0.0.1'); // port 0 = "any free port"
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  // One small function for every call. Returns { status, headers, text, json }.
  async function request(method, path, { json, body, headers = {}, signal } = {}) {
    const init = { method, headers: { ...headers }, signal };
    if (json !== undefined) {
      init.body = JSON.stringify(json);
      init.headers['content-type'] = 'application/json';
    } else if (body !== undefined) {
      init.body = body;
    }
    const res = await fetch(base + path, init);
    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined; // not JSON, that is fine
    }
    return { status: res.status, headers: res.headers, text, json: parsed };
  }

  async function close() {
    server.close();
    server.closeAllConnections(); // do not wait for idle keep-alive sockets
    await once(server, 'close');
  }

  return {
    base,
    server,
    request,
    get: (path, options) => request('GET', path, options),
    post: (path, options) => request('POST', path, options),
    close,
  };
}

// "200 {"ok":true}" : a one-line summary of a response, for readable demo output.
function line(res) {
  return `${res.status} ${res.text}`;
}

module.exports = { start, line };
