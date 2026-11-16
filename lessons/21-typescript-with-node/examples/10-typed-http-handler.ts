// Typing HTTP handlers the way Express does, with only node:http
// Shows: a Handler type, a typed request, a generic sendJson, a body guard, and narrowing server.address()
// Run: node lessons/21-typescript-with-node/examples/10-typed-http-handler.ts

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';

// 1. The building blocks. A request is Node's IncomingMessage plus the fields our router adds.
type Method = 'GET' | 'POST';
type Params = Record<string, string>;
type Req = IncomingMessage & { params: Params };
type Res = ServerResponse;
type Handler = (req: Req, res: Res) => void | Promise<void>; // a handler may be sync or async
type Route = { method: Method; path: string; handler: Handler };

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const routes: Route[] = [];
function route(method: Method, path: string, handler: Handler): void {
  routes.push({ method, path, handler });
}

// Match "/users/:id" against "/users/42" and return { id: '42' } (or null for no match).
function match(pattern: string, pathname: string): Params | null {
  const want = pattern.split('/');
  const got = pathname.split('/');
  if (want.length !== got.length) return null;
  const params: Params = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(':')) params[want[i].slice(1)] = decodeURIComponent(got[i]);
    else if (want[i] !== got[i]) return null;
  }
  return params;
}

// 2. A generic helper: T is whatever body you send, so the call site is checked against your own type.
function sendJson<T>(res: Res, status: number, body: T): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

// 3. Read a JSON body and check it with a type guard. The Promise<T> you get back is honest.
async function readJson<T>(req: IncomingMessage, guard: (value: unknown) => value is T): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  let data: unknown;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Body is not valid JSON');
  }
  if (!guard(data)) throw new HttpError(400, 'Body has the wrong shape');
  return data;
}

type NewUser = { name: string };
function isNewUser(value: unknown): value is NewUser {
  return typeof value === 'object' && value !== null && 'name' in value && typeof value.name === 'string' && value.name !== '';
}

// 4. The routes. Notice that req.params.id is a string, because URLs only carry text.
route('GET', '/users/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new HttpError(400, 'id must be a whole number');
  sendJson(res, 200, { id, name: `user${id}` });
});

route('POST', '/users', async (req, res) => {
  const body = await readJson(req, isNewUser); // body: NewUser
  sendJson(res, 201, { id: 1, name: body.name });
});

// 5. The server: find a route, run the handler, turn any thrown error into a response.
const server = createServer(async (incoming, res) => {
  const url = new URL(incoming.url ?? '/', 'http://localhost');
  try {
    for (const r of routes) {
      const params = r.method === incoming.method ? match(r.path, url.pathname) : null;
      if (params) {
        await r.handler(Object.assign(incoming, { params }), res);
        return;
      }
    }
    throw new HttpError(404, `No route for ${incoming.method} ${url.pathname}`);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    sendJson(res, status, { error: error instanceof Error ? error.message : 'unknown error' });
  }
});

server.listen(0, '127.0.0.1');
await once(server, 'listening');

// server.address() is "string | AddressInfo | null", so narrow it before reading .port
const address = server.address();
if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
const base = `http://127.0.0.1:${address.port}`;

// 6. Call our own server and print what comes back.
async function call(method: Method, path: string, body?: string): Promise<void> {
  const response = await fetch(base + path, { method, body });
  console.log(`${method} ${path} ->`, response.status, await response.json());
}

await call('GET', '/users/42');
await call('GET', '/users/abc');
await call('POST', '/users', JSON.stringify({ name: 'Asha' }));
await call('POST', '/users', JSON.stringify({ nick: 'Asha' }));
await call('POST', '/users', '{ not json');
await call('GET', '/nope');

server.close();
await once(server, 'close');
console.log('server closed');
