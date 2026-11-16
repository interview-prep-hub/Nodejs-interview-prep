// Code under test for lesson 16: a small JSON API built on node:http.
//
//   GET  /health        -> 200 { status: 'ok' }
//   GET  /todos         -> 200 [ ...todos ]
//   POST /todos         -> 201 { id, title, done } (needs a JSON body with a "title")
//   GET  /todos/:id     -> 200 todo, or 404
//
// Design note for testing: createTodoServer() RETURNS the server but does not call listen().
// Whoever uses it picks the port. A test asks for port 0 and the operating system chooses a free one.

const http = require('node:http');

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

async function readJson(req) {
  let text = '';
  for await (const chunk of req) text += chunk;
  return JSON.parse(text); // throws SyntaxError for an empty or broken body
}

function createTodoServer({ todos = [] } = {}) {
  let nextId = todos.length + 1;

  return http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (pathname === '/health' && req.method === 'GET') {
        return sendJson(res, 200, { status: 'ok' });
      }

      if (pathname === '/todos') {
        if (req.method === 'GET') return sendJson(res, 200, todos);
        if (req.method === 'POST') {
          const body = await readJson(req);
          if (typeof body.title !== 'string' || body.title.trim() === '') {
            return sendJson(res, 400, { error: 'title is required' });
          }
          const todo = { id: nextId++, title: body.title.trim(), done: false };
          todos.push(todo);
          res.setHeader('location', `/todos/${todo.id}`);
          return sendJson(res, 201, todo);
        }
        res.setHeader('allow', 'GET, POST');
        return sendJson(res, 405, { error: 'method not allowed' });
      }

      const match = pathname.match(/^\/todos\/(\d+)$/);
      if (match && req.method === 'GET') {
        const todo = todos.find((item) => item.id === Number(match[1]));
        return todo ? sendJson(res, 200, todo) : sendJson(res, 404, { error: 'not found' });
      }

      return sendJson(res, 404, { error: 'not found' });
    } catch (error) {
      if (error instanceof SyntaxError) return sendJson(res, 400, { error: 'invalid JSON' });
      return sendJson(res, 500, { error: 'internal error' });
    }
  });
}

module.exports = { createTodoServer };
