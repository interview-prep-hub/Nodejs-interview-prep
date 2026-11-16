# 26. Web Frameworks and the Middleware Pattern

> Level: Advanced   Time: about 240 minutes   Node: 24 (notes where older versions differ)

[Previous: 25. Architecture, Design Patterns and Resilience](../25-architecture-and-patterns/README.md) | [All lessons](../../README.md)

## What you will learn
- Why frameworks sit on top of `node:http`, and what exactly they add
- The middleware idea (a function with `req`, `res`, `next`; chain of responsibility; order matters) and how to build **a mini Express from scratch in seven runnable stages**
- A Koa-style "onion" built from scratch, shown beside the Express model, and why it allows timing and other after-response logic
- Express 5 in practice (clearly labelled snippets), what changed from Express 4, and how Express, Fastify, Koa, NestJS, Hono and raw `node:http` compare
- Middleware you should be able to write by hand: request id, logger, timing, CORS, rate limit, compression, auth guard, validation, 404 and error handlers
- Validation (Zod, Joi, Ajv), authentication middleware, file uploads, templating and SSR, API versioning, graceful error responses
- Serverless and edge runtimes (Lambda handler shape, cold starts, the Workers `fetch` handler) and how to test framework apps with real requests on port 0
- The three classic interview questions: how Express tells an error handler apart, what `next()` twice does, and what happens if you never call `next()` or end the response

All examples run from the repo root, for example `node lessons/26-frameworks-and-middleware/examples/01-middleware-chain.js`. Every example that needs a server starts it on **port 0** (the operating system picks a free port), listens only on `127.0.0.1`, talks to it with `fetch`, and closes it. They use only core modules, need no internet, and finish by themselves. Run all of them with `node scripts/check-examples.js 26-frameworks-and-middleware --verbose`.

The mini framework lives in `examples/_mini-express/`, one file per stage. Files and folders that start with an underscore are helpers: the checker does not run them on their own. Real Express, Fastify, Koa, Zod and the like appear **only** in snippets headed "Needs: npm install ...". This course does not run those. Where section 11 says "checked on Express 5.3.0", that behaviour was run against that version while this lesson was written.

This lesson builds on [lesson 12](../12-http-and-networking/README.md) (methods, status codes, headers, CORS, the hand-written router) and [lesson 14](../14-error-handling-and-debugging/README.md) (error handling). If a status code or header here is new to you, read lesson 12 first.

**How the lesson is organised.** It is long on purpose: the topic covers a whole interview area. You do not need to read it in one go.

| Part | Sections | What you do |
|---|---|---|
| A. Build it | 1 to 10 | Build a mini Express in seven runnable stages, then a Koa-style "onion". After this, middleware is no longer magic |
| B. Real frameworks | 11 to 12 | Express 5 in practice, and how Express, Fastify, Koa, NestJS, Hono and raw `node:http` compare |
| C. Everyday patterns | 13 to 20 | Middleware you write by hand, validation, auth, uploads, templates, error responses, serverless, testing |

Short on time? Read sections 2, 5, 9, 10, 11.6 and 12 first: they hold most of the questions interviewers ask.

## 1. Why frameworks exist on top of `node:http`

`node:http` gives you two objects per request: `req` (what the client sent) and `res` (what you send back). Nothing else. Here is a small API written without a framework. Save it as `raw.js`, run `node raw.js`, and open `http://localhost:3000/hello?name=Ada`:

```js
const http = require('node:http');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/hello') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ hello: url.searchParams.get('name') ?? 'world' }));
    } else if (req.method === 'POST' && url.pathname === '/echo') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk); // the body is a stream
      const body = JSON.parse(Buffer.concat(chunks).toString()); // throws on bad JSON: do it BEFORE writeHead
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    } else {
      res.writeHead(404).end('Not found');
    }
  } catch (err) {
    res.writeHead(500).end('Server error'); // bad JSON also lands here; telling 400 from 500 is more code you write
  }
});

server.listen(3000);
```

It works, and with two routes it is fine. Now picture 40 routes, login checks on 25 of them, request logging, CORS, rate limiting, JSON validation and a consistent error format. Every one of those would live inside this one function. The pain points:

| Problem | What you must write yourself with raw `node:http` |
|---|---|
| Routing | `if` chains, or a table of regular expressions (lesson 12, example 04) |
| Path parameters and query string | Regex groups, `new URL(...)` |
| Reading the body | Collect chunks, enforce a size limit, parse JSON, handle bad JSON |
| Shared steps (logging, auth, CORS) | Copy the same lines into every handler, or invent a pipeline |
| Errors | A `try/catch` in every handler, one shared way to turn errors into responses |
| Code organisation | Everything in one callback |

A **web framework** is a small engine plus conventions that solve these. The central idea is the **middleware pipeline**: a request flows through a list of small functions, each doing one job. Everything else (routing, body parsing, CORS, auth) is "just another middleware". The rest of this lesson builds that engine, so you know what happens when you call `app.use()`.

> **Interview tip:** "Why use Express instead of `http`?" is not about speed (a framework adds a little overhead, not a gain). A strong answer: productivity and shared conventions (routing, middleware, error handling), a huge ecosystem of ready-made middleware, and a hiring pool that already knows it. Then add that you know how it works inside, because you can build the core in about 100 lines, and that for a tiny service or a proxy plain `node:http` is a fine choice.

## 2. The middleware idea (stage 1: `use` and `next`)

A **middleware** is a function with three parameters:

```js
function middleware(req, res, next) {
  // look at req, change req or res, then ONE of these:
  //   next()                -> pass the request to the next function in the list
  //   res.end(...) / res.json(...)  -> answer now; the chain stops here
  //   next(err)             -> something went wrong (stage 4)
}
```

Think of airport security. You walk through the passport check, then the bag scanner, then the gate. Each station can wave you on (`next()`) or stop you (answer the request). That is the design pattern **chain of responsibility**: a request travels along a chain of handlers, and each one decides to handle it or pass it on. **Order matters**, because the chain runs in the order the functions were added.

Stage 1 of our framework is only this (`examples/_mini-express/01-chain.js`):

```js
function createApp() {
  const stack = []; // the middleware, in the order they were added

  function app(req, res) { // app is a normal request listener: http.createServer(app) works
    let index = 0; // one counter per request, shared by every call of next()
    function next() {
      const fn = stack[index++]; // take the next function and move the counter on
      if (!fn) { // ran out of middleware and nobody answered
        res.statusCode = 404;
        res.end(`Cannot ${req.method} ${req.url}`);
        return;
      }
      fn(req, res, next); // hand over: fn decides whether to call next()
    }
    next();
  }

  app.use = (fn) => { stack.push(fn); return app; };
  return app;
}
```

Using it looks like Express: `createApp().use(logger).use(handler)` and then `http.createServer(app).listen(3000)`. `examples/01-middleware-chain.js` runs five small experiments:

```text
Part 1: three middleware
  response : 200 hello from C
  trail    : A before > B before > C answers > B after > A after
Part 2: spy BEFORE the handler saw : ["/one"]
Part 2: spy AFTER the handler saw  : []
Part 3: a gate
  without token : 401 no token | handler reached: false
  with token    : 200 secret data | handler reached: true
Part 4: next() called twice
  response : 200 C was first
  log      : A > B > C answers > D runs > D failed with ERR_HTTP_HEADERS_SENT
Part 5: forgot next() and res.end()
  the client gave up: TimeoutError (the server never answered)
```

What each part shows:

- **Part 1.** Each middleware prints "before", calls `next()`, then prints "after". The "after" lines come back in reverse order: `B after`, then `A after`. This looks like a nested call, and for **synchronous** code it is exactly that. (With `async` handlers the "after" part runs too early. That is the problem Koa solves, section 10.)
- **Part 2.** The same two functions in two orders. A spy placed after the handler never runs, because the handler answered and did not call `next()`. **Order is part of the design.**
- **Part 3.** A gate: it answers `401` and does not call `next()`, so the handler is never reached. This is how auth middleware works.
- **Part 4.** `next()` called twice. See section 9 for the full explanation.
- **Part 5.** A middleware that neither calls `next()` nor ends the response. The client waits until it gives up.

> **Common mistake:** forgetting `return` after answering.
> ```js
> if (!req.headers.authorization) res.status(401).json({ error: 'no token' }); // answers...
> next();                                                                       // ...and continues!
> ```
> The handler then tries to answer a second time and Node throws `ERR_HTTP_HEADERS_SENT`. Write `return res.status(401).json(...)`, or `return next(err)`.

> **Under the hood:** `next` is **one function per request**, and `index` is shared by all calls. Calling `next` does not mean "run the next function after me"; it means "run whatever is at the counter, then move the counter". That explains the odd result of calling it twice.

> **Interview tip:** "What is middleware?" A strong short answer: "A function that receives `req`, `res` and `next`. It can change the request or the response, end the request, or call `next()` to pass control on. The framework runs the functions in the order they were registered, which is the chain of responsibility pattern. Routing, body parsing, CORS and auth are all just middleware."

## 3. Routing (stage 2: method, path and `:params`)

A **route** is a method, a path pattern and a handler. `app.get('/users/:id', handler)` means: "for GET requests whose path looks like `/users/<something>`, run `handler`, and put `<something>` in `req.params.id`". A route is just a middleware that checks the method and path before it does anything. In our mini version a pattern is compiled into a regular expression (`examples/_mini-express/02-routing.js`):

```js
function compile(pattern) {
  const keys = [];
  const source = pattern
    .replace(/\/+$/, '')                      // '/users/' and '/users' are the same route
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')   // a dot in the path means a dot, not "any character"
    .replace(/:(\w+)/g, (_, key) => {         // ':id' -> a capture group, remember the name
      keys.push(key);
      return '([^/]+)';
    });
  return { regex: new RegExp(`^${source}/?$`), keys };
}
```

In `next()`, a layer with a `method` is skipped unless the method and the path both match; then the captured groups become `req.params` (decoded with `decodeURIComponent`). `examples/02-routing.js` prints how patterns compile and then makes requests:

```text
--- how a pattern is compiled
  /users               -> /^\/users\/?$/                     keys: []
  /users/:id           -> /^\/users\/([^/]+)\/?$/            keys: ["id"]
  /posts/:year/:slug   -> /^\/posts\/([^/]+)\/([^/]+)\/?$/   keys: ["year","slug"]
  /files/report.pdf    -> /^\/files\/report\.pdf\/?$/        keys: []
--- matching
  GET /                                    200 home
  GET /users/42                            200 user 42
  GET /users/42/ (trailing slash)          200 user 42
  GET /users/ada%20lovelace                200 user ada lovelace
  GET /users/7?sort=asc                    200 user 7
  POST /users                              201 created
  GET /posts/2026/hello-world              200 {"year":"2026","slug":"hello-world"}
  GET /files/report.pdf                    200 the pdf
  GET /files/reportXpdf (dot is literal)   404 Cannot GET /files/reportXpdf
  GET /people/me (route order)             200 person me
  GET /admin (no role)                     403 admins only
  GET /admin (admin)                       200 admin panel
  DELETE /ping (app.all)                   200 ping via DELETE
--- no match
  GET /nothing                             404 Cannot GET /nothing
  DELETE /users/1 (no such route)          404 Cannot DELETE /users/1
  GET /users (only POST exists)            404 Cannot GET /users
  GET /users/%E0%A4%A (bad encoding)       400 Bad Request
--- the logger ran for every request: 17 times
```

Things to notice:

- `/users/ada%20lovelace` arrives decoded: `ada lovelace`. A malformed escape such as `%E0%A4%A` makes `decodeURIComponent` throw, and the framework answers `400` instead of crashing.
- The **first matching route wins**. `/people/:name` was registered before `/people/me`, so `me` was taken as a name. Put specific routes before general ones.
- `app.get('/admin', onlyAdmin, handler)` shows that a route can have **several handlers**. The first is a guard. This is the usual way to protect one route.
- A known path with the wrong method (`GET /users` when only `POST /users` exists) is a `404` here. Express does the same. Some frameworks answer `405 Method Not Allowed` with an `Allow` header; you can add that yourself (task 1 below).

> **Common mistake:** building the path with `new URL(req.url, 'http://localhost')`, as the raw example in section 1 did. It is fine for a demo, but a request line like `GET //evil.com/x HTTP/1.1` gives `req.url === '//evil.com/x'`, and the URL parser reads `//evil.com` as a host name: `new URL('//evil.com/x', 'http://localhost').pathname` is `/x`. That is why `pathOf` in the mini framework just cuts the string at `?`, like real frameworks do.

> **Interview tip:** be ready to explain how `:id` becomes a regular expression, and why routers are matched in registration order. Express 5 (through its `router` package) uses the `path-to-regexp` library, version 8, which also supports optional parts like `/files{.:ext}` and named wildcards like `/files/*splat`.

## 4. Query string and `req`/`res` helpers (stage 3)

Plain Node has no `res.json()`. Express adds helpers to the request and response objects. How? **Prototype switching.** A JavaScript object that lacks a property looks it up on its **prototype** (the object it inherits from, lesson 2). We create two objects that inherit from the Node classes, put the helpers on them, and point each incoming `req` and `res` at them:

```js
const request = Object.create(http.IncomingMessage.prototype);   // inherits all of Node's req methods
Object.defineProperty(request, 'query', { get() { return parseQuery(this.url); } });

const response = Object.create(http.ServerResponse.prototype);   // inherits res.setHeader, res.end ...
response.status = function (code) { this.statusCode = code; return this; };   // return this = chaining
response.json = function (data) {
  const body = JSON.stringify(data);
  this.setHeader('Content-Type', 'application/json; charset=utf-8');
  this.setHeader('Content-Length', Buffer.byteLength(body)); // bytes, not characters
  this.end(body);
  return this;
};

function init(req, res, next) {           // the first middleware of the app
  Object.setPrototypeOf(req, request);
  Object.setPrototypeOf(res, response);
  next();
}
```

Nothing is copied per request, and every normal Node method still works because the prototype chain ends in the Node classes. Express does the same: its `lib/request.js` starts with `Object.create(http.IncomingMessage.prototype)` and its `lib/response.js` with `Object.create(http.ServerResponse.prototype)`, and `app.handle` calls `Object.setPrototypeOf(req, app.request)` for each request (read in the installed Express 5.3.0 source). The query parser is the interesting part:

```js
function parseQuery(url) {
  const out = Object.create(null);                 // no prototype: see the gotcha below
  const q = url.indexOf('?');
  if (q === -1) return out;
  for (const [key, value] of new URLSearchParams(url.slice(q + 1))) {
    out[key] = key in out ? [].concat(out[key], value) : value;   // ?d=3&d=4 -> ['3', '4']
  }
  return out;
}
```

`examples/03-helpers-and-query.js` (it also has a small HTML template, see section 17):

```text
--- query string
GET /search?a=1&b[c]=2&d=3&d=4
  -> 200  content-type: application/json; charset=utf-8  length: 61
  -> body: {"path":"/search","query":{"a":"1","b[c]":"2","d":["3","4"]}}
GET /search?toString=x&name=Ada%20Lovelace&empty=
  -> 200  content-type: application/json; charset=utf-8  length: 76
  -> body: {"path":"/search","query":{"toString":"x","name":"Ada Lovelace","empty":""}}
GET /search
  -> 200  content-type: application/json; charset=utf-8  length: 29
  -> body: {"path":"/search","query":{}}
--- res helpers
GET /teapot
  -> 418  content-type: application/json; charset=utf-8  length: 24
  -> body: {"error":"I'm a teapot"}
```

Run the file to see the rest of the output. It shows `res.send` choosing the content type from the value (string to `text/html`, object to JSON, `Buffer` to `application/octet-stream`), `res.set(...)` chaining, and `res.status(99)` throwing a `RangeError` because valid codes are 100 to 999 (Express 5 has the same check).

> **Common mistake:** query values are **strings, or arrays of strings** when a key repeats. `?id=1&id=2` makes `req.query.id` the array `['1', '2']`. Code that does `req.query.id.toLowerCase()` crashes with a 500 when an attacker sends it twice. Validate query values (section 14). The `null` prototype matters too: with a normal `{}`, a request for `?toString=x` would find an existing key and break the "is it repeated?" check.

> **Remember:** in Express 5, `req.query` is a getter that returns a fresh object on every read, so `req.query.page = 2` changes nothing. Keep cleaned values somewhere else (`req.valid`, `res.locals`).

> **Interview tip:** "Where does `res.json()` come from?" Express does not wrap `res` in a new object. It switches the prototype of Node's own `ServerResponse` to an object that adds the helpers, so `res` is still a real `http.ServerResponse` and every Node method keeps working. Koa and Hono take the other route: they create a new context object (`ctx`, `c`) that wraps the request and the response.

## 5. Error-handling middleware (stage 4: the function with four parameters)

What happens when a handler throws, or when you call `next(err)`? The framework needs one place that turns errors into responses. The rule is simple and a little strange:

> While an error is travelling, **skip every normal middleware** and run only functions that declare **four parameters** `(err, req, res, next)`. While there is no error, skip those four-parameter functions.

The framework tells them apart with `fn.length`, the number of parameters a function declares. That count is called its **arity**, so this is the "arity trick". The dispatch loop gets two new lines and a `try/catch` (`examples/_mini-express/04-errors.js`):

```js
function next(err) {
  const layer = stack[index++];
  if (!layer) return finalHandler(err, req, res);        // nobody handled it: 404 or a plain 500

  const isErrorHandler = layer.fn.length === 4;
  if (err && !isErrorHandler) return next(err);          // an error is travelling: skip normal middleware
  if (!err && isErrorHandler) return next();             // no error: skip error handlers
  // ... route matching as before ...
  try {
    if (err) layer.fn(err, req, res, next); else layer.fn(req, res, next);
  } catch (thrown) {
    next(thrown);                                         // a throw becomes next(error)
  }
}
```

A picture of the flow for a route that throws:

```
request -> [init] -> [logger] -> [GET /throws: THROWS] -x-> [after-routes middleware: skipped]
                                                       -x-> [log-and-pass-on (4 params): runs, calls next(err)]
                                                       -x-> [send-JSON (4 params): runs, answers] -> response
```

`examples/04-error-middleware.js`, part 1: errors born in three ways end up in the same handler.

```text
--- Part 1: errors become JSON in one place
GET /ok              200 {"ok":true}
                     trail: logger
GET /throws          500 {"error":{"status":500,"message":"Internal Server Error"}}
                     trail: logger | log: sync throw
GET /next-err        500 {"error":{"status":500,"message":"Internal Server Error"}}
                     trail: logger | log: passed to next()
GET /not-found       404 {"error":{"status":404,"message":"User 7 does not exist"}}
                     trail: logger | log: User 7 does not exist
GET /boom            500 {"error":{"status":500,"message":"Internal Server Error"}}
                     trail: logger | log: database password is hunter2
GET /nothing-here    404 {"error":{"status":404,"message":"Cannot GET /nothing-here"}}
                     trail: logger | after-routes middleware | log: Cannot GET /nothing-here
```

Read the trail lines: for `/throws` the middleware placed after the routes did not run; for `/nothing-here` (no error at that moment) it did, and the 404 handler (a normal middleware that calls `next(httpError(404, ...))`) created the error. The error handler shows `err.message` only when `err.expose` is true (4xx), and the generic `Internal Server Error` otherwise. The text "database password is hunter2" stays in the server log and never reaches the client.

**The arity trap** (part 2):

```text
--- Part 2: function.length decides
(err, req, res, next) => 4 -> error handler
(err, req, res)       => 3 -> normal middleware (the bug)
(...args)             => 0 -> normal middleware
(err, req, res, next = null) => 3 -> normal middleware
GET /fail (an error), 3-parameter handler : 500 Internal Server Error
GET /other (no error), 3-parameter handler: 500 Internal Server Error
```

An "error handler" written with three parameters is just a normal middleware, so it never catches errors. Worse, for any request that reaches it, it is called as `(req, res, next)`: its `err` is really `req`, its `res` is really the `next` function, and `res.end` is not a function. That is how a harmless 404 turned into a 500 above.

- Real Express checks `fn.length` the same way. In its `router` package a function with length 4 is an error handler, and a normal handler that declares more than 3 parameters is skipped.
- Things that change `fn.length`: a default value (`next = null` stops the count at that parameter) and a rest parameter (`...args` counts as 0).
- Linters and refactoring tools that remove "unused" parameters will silently break your error handler. Keep all four.

**Errors after the response started** (part 3):

```text
--- Part 3: error after the response started
status the client already saw: 200
reading the rest of the body failed: TypeError - terminated
```

The status line `200` was already sent when the error happened. You cannot change a status that is on the wire, so the best option is to cut the connection and let the client see a failed download (`terminated`). The exact words `TypeError - terminated` are what the `fetch` built into Node 24 reports; other clients and other Node versions word it differently. The rule from the Express docs is the first line of every error handler: `if (res.headersSent) return next(err);`.

> **Interview tip:** "How does Express know a function is an error handler?" Answer: by its arity. `fn.length === 4`. Then add the three consequences: it must be registered after the routes it should protect; it is skipped when there is no error; and a three-parameter version silently fails.

## 6. A JSON body parser (stage 5)

The request body is a **stream** (lesson 11): chunks arrive over time. Reading and parsing it costs memory and time, and a `GET` has no body, so the framework does not do it for you. A **body-parser middleware** reads the stream, parses it, and stores the result in `req.body`. Rules of the real `express.json()` that our version follows (`examples/_mini-express/05-json.js`):

- Only run when `Content-Type` is `application/json`. Otherwise do nothing and leave `req.body` as `undefined`.
- Have a **size limit** (the default of `express.json()` is 100 kilobytes). Check the `Content-Length` header early, then also count real bytes, because the header can be missing or wrong.
- Broken JSON is a `400`. A too-big body is a `413`.
- "Strict" mode: only objects and arrays are accepted at the top level.

```js
function json({ limit = 100 * 1024 } = {}) {
  return function jsonParser(req, res, next) {
    const type = req.headers['content-type'] || '';
    if (!/^application\/json\b/i.test(type)) return next();                    // not for us
    if (Number(req.headers['content-length']) > limit) return next(httpError(413, 'Payload Too Large'));

    const chunks = []; let size = 0; let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;                                                       // keep draining, ignore the data
      size += chunk.length;
      if (size > limit) { failed = true; return next(httpError(413, 'Payload Too Large')); }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      try { req.body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return next(httpError(400, 'Invalid JSON')); }
      next();
    });
  };
}
```

(The file in `examples/` also handles an empty body, the strict check, and an earlier parser having run.) It is used per route: `app.post('/users', json(), handler)`. `examples/05-json-body-parser.js`:

```text
--- the happy path
valid JSON object                      201 {"received":{"name":"Ada","langs":["js","ts"]},"type":"object"}
valid JSON array                       201 {"received":[1,2,3],"type":"object"}
empty body                             201 {"received":{},"type":"object"}
--- it is picky on purpose
wrong Content-Type: parser skips       201 {"type":"undefined"}
an empty Content-Type header           201 {"type":"undefined"}
broken JSON -> 400                     400 {"error":"Invalid JSON"}
a bare string is not allowed (strict)  400 {"error":"JSON body must be an object or an array"}
too big (limit 200 bytes) -> 413       413 {"error":"Payload Too Large"}
--- the parser must be in the chain, and before the handler
route without the parser               200 {"body":"undefined"}
parser placed after the handler        200 {"sawBody":false}
```

`received` is missing from the "wrong Content-Type" line because `JSON.stringify` drops properties whose value is `undefined`. The last two lines show the order problem: a route without the parser, or with the parser placed **after** the handler, sees `req.body === undefined`.

> **Common mistake:** "my `req.body` is undefined" in Express 5. The usual causes, in order: you did not add `express.json()` (or added it after the route); the client did not send `Content-Type: application/json`; a middleware earlier in the chain already consumed the stream. In Express 5, `req.body` stays `undefined` when no body parser handled the request (the migration guide says Express 4 body parsers set it to `{}`).

> **Interview tip:** "What does `express.json()` do?" It runs only for `Content-Type: application/json`, reads the request stream with a size limit (100 kilobytes by default), parses it, and stores the result in `req.body`. Broken JSON gives `400`, a too-big body gives `413`. It is ordinary middleware, so it must be registered before the routes that read `req.body`.

## 7. Async handlers and error forwarding (stage 6)

An `async` function always returns a promise. If something inside it throws after an `await`, that promise becomes **rejected** (failed). The stage 4 framework ignores the value a middleware returns, so nobody handles the rejection: it is an **unhandled rejection**. On Node 24 the default for those is to print the error and exit with code 1, which would kill your server. In the example below we install a `process.on('unhandledRejection')` listener so the demo survives and can show the second symptom: the request never gets an answer.

Stage 6 changes one thing: look at what the middleware returned (`examples/_mini-express/06-async.js`).

```js
try {
  const result = err ? layer.fn(err, req, res, next) : layer.fn(req, res, next);
  if (result && typeof result.then === 'function') {                        // NEW: it is a promise
    result.then(undefined, (reason) => next(reason || new Error('Rejected promise')));
  }
} catch (thrown) {
  next(thrown);
}
```

This is what Express 5 does (its `router` package has the same code, including the fallback `Error('Rejected promise')` for a rejection with no reason). Express 4 did not, so Express 4 code is full of wrappers like the one in the example. Part 1 of `examples/06-async-and-router.js`:

```text
=== Part 1: async handlers (stage 6)
stage 4, async handler      : the client gave up (TimeoutError), the request hangs
stage 4, unhandled rejection: ["db is down"]
stage 4, with wrap()        : 500 {"error":"Internal Server Error"}
stage 6, async handler      : 500 {"error":"Internal Server Error"}
stage 6, reject with nothing: 500 {"error":"Internal Server Error"}
stage 6, async 404 error    : 404 {"error":"No such user"}
stage 6, async success      : 200 {"id":5}
```

- With the stage 4 framework an async handler that fails after an `await` leaves the client waiting, and the error is an unhandled rejection.
- `wrap(fn)` is the Express 4 workaround: `(req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)`.
- With stage 6 nothing special is needed: a thrown error, a rejected promise (even `Promise.reject()` with no reason) and `throw httpError(404, ...)` all reach the error handler.

> **Common mistake:** automatic forwarding only covers the promise **that your handler returns**. A promise you start and do not return or `await` (`saveAudit(req).then(...)` without `return`, or a callback inside `setTimeout`) is still outside the framework. A failure there is a plain unhandled rejection or uncaught exception.

> **Interview tip:** "How do you handle errors in async Express handlers?" Express 5: nothing special, it watches the promise the handler returns (so `return` or `await` your promises). Express 4: wrap every handler (`.catch(next)`), or use a package such as `express-async-errors`, or `try/catch` and `next(err)` by hand. Naming the Express 4 versus 5 difference is what the interviewer wants to hear.

## 8. Routers, mounting and API structure (stage 7)

A **router** is a mini application: its own middleware and routes, written as if it lived at `/`. You **mount** it at a prefix with `app.use('/v1/users', usersRouter)`. This splits a big app into files, and it is how API versioning works.

Two changes make this work (`examples/_mini-express/07-router.js`):

1. The chain logic moves into `Router()`. A router is itself a middleware `(req, res, out)`. When it runs out of layers it calls `out()`, the `next` of whoever called it, so a request that no route in the router matched **falls through** to the rest of the parent.
2. `use(prefix, ...)` matches whole path segments and **strips the prefix from `req.url`** while the inner layers run:

```js
// '/api' matches '/api' and '/api/x', but not '/apix'
const matchesPrefix = (pathname, prefix) =>
  prefix === '' || pathname === prefix || pathname.startsWith(`${prefix}/`);

// ... inside next(), for a use() layer that matches:
req.url = rest.startsWith('/') ? rest : `/${rest}`;   // '/api?x=1' -> '/?x=1'
req.baseUrl = entryBase + layer.prefix;               // remember what was removed
// (and at the start of every next(): req.url = entryUrl; req.baseUrl = entryBase; the previous strip is undone)
```

**`use` versus `get`.** `use('/api', fn)` matches **any method** and any path that **starts with** `/api` (whole segments), and strips the prefix. `get('/api', fn)` matches **only GET** and **only the exact path**. Use `use` for middleware and for mounting routers; use `get`, `post` and friends for endpoints. Checked on Express 5.3.0: `app.use('/u', fn)` ran for `GET /u/deep/path?q=1` (seeing `req.url` as `/deep/path?q=1`) and for `POST /u`, while `app.get('/g', fn)` gave `404` for `/g/deep` and for `POST /g`.

Part 2 of `examples/06-async-and-router.js` mounts a `users` router inside a `v1` router, and a different `usersV2` router at `/v2`:

```text
=== Part 2: routers mounted at a prefix (stage 7)
GET /v1/users              200 {"list":["ada","linus"]} [X-Api-Version: 1]
                           | app middleware: url=/v1/users
                           | users middleware: baseUrl=/v1/users url=/
GET /v1/users/7?full=1     200 {"id":"7","url":"/7?full=1","baseUrl":"/v1/users","originalUrl":"/v1/users/7?full=1","path":"/7"} [X-Api-Version: 1]
                           | app middleware: url=/v1/users/7?full=1
                           | users middleware: baseUrl=/v1/users url=/7?full=1
POST /v1/users             201 {"created":"Grace"} [X-Api-Version: 1]
                           | app middleware: url=/v1/users
                           | users middleware: baseUrl=/v1/users url=/
GET /v2/users/7            200 {"data":{"id":"7"},"meta":{"version":2}} [X-Api-Version: 2]
                           | app middleware: url=/v2/users/7
GET /health                200 {"ok":true}
                           | app middleware: url=/health
--- what does not match falls through to the next layer
GET /v1/usersX             404 {"error":"No route for GET /v1/usersX"} [X-Api-Version: 1]
                           | app middleware: url=/v1/usersX
GET /v3/users              404 {"error":"No route for GET /v3/users"}
                           | app middleware: url=/v3/users
GET /v1/users/7/boom       500 {"error":"Internal Server Error"} [X-Api-Version: 1]
                           | app middleware: url=/v1/users/7/boom
                           | users middleware: baseUrl=/v1/users url=/7/boom
```

Read it carefully, it contains most of the facts interviewers ask about:

- Inside the mounted router, `req.url` is `/7?full=1`, `req.path` is `/7`, `req.baseUrl` is `/v1/users`, and `req.originalUrl` still has the full URL. Handlers inside the router never need to know where they are mounted.
- The router's own middleware (`users middleware`) runs only for URLs under its prefix. The `app middleware` ran for everything.
- `/v1/usersX` did not match the `/users` prefix (whole segments only), so it fell out of the router and out of `v1` to the app's 404 handler. Note that the `X-Api-Version: 1` header was still set, because `/v1/usersX` is under `/v1`.
- The error in `/v1/users/7/boom` was thrown deep in a router and handled by the app's error handler.

**Project structure that works well** (any framework):

```
src/
  app.js              builds and returns the app, never calls listen (so tests can import it)
  server.js           imports app.js, calls listen, handles SIGTERM (graceful shutdown, lesson 12)
  routes/             one router per resource: users.routes.js mounts GET /, GET /:id, POST /
  controllers/        small functions: read the request, call a service, shape the response
  services/           business rules and database calls, no req or res in sight
  middleware/         auth.js, validate.js, error-handler.js, request-id.js
```

**API versioning** options:

| Style | Example | Notes |
|---|---|---|
| URL prefix | `/v1/users`, `/v2/users` | Most common. Easy to see, cache and route. What the example shows |
| Header | `Accept: application/vnd.shop.v2+json` or `X-Api-Version: 2` | Clean URLs, harder to test in a browser |
| Query parameter | `/users?version=2` | Simple, easy to forget, caches may mix versions |

Whatever you pick: never break `v1` silently, announce a retirement date (the `Deprecation` and `Sunset` response headers exist for this), keep shared logic in services so two versions do not copy the business rules, and change the version only for **breaking** changes (removing a field, changing a type). Adding an optional field is not breaking.

> **Interview tip:** if you are asked to "write a mini Express" at a whiteboard, five ideas are enough. (1) A `stack` array, and `use()` pushes onto it. (2) One `index` per request, and `next()` runs `stack[index++]`. (3) A route is a middleware that checks method and path and fills `req.params`. (4) `next(err)` skips layers until one has `fn.length === 4`, with a `try/catch` around every call. (5) If a layer returns a promise, attach a rejection handler that calls `next`. A router is the same loop with an `out` callback, and `use('/prefix', router)` strips the prefix from `req.url`.

## 9. Interview corner: three questions about `next()`

These three come up in almost every Express interview. The examples you already ran contain every answer below.

**Question 1: How does Express tell an error handler from a normal middleware?**
By arity: `fn.length === 4`. Error handlers are skipped when there is no error, normal middleware is skipped while an error travels, and a three-parameter "error handler" is just a normal middleware that never sees errors. Details in section 5.

**Question 2: What happens if `next()` is called twice?**
In Express (and in our mini version) `next` shares one counter per request. The second call does **not** repeat the layer that just ran; it carries on from wherever the counter is. Example 01, part 4 (stage 1 framework):

```text
Part 4: next() called twice
  response : 200 C was first
  log      : A > B > C answers > D runs > D failed with ERR_HTTP_HEADERS_SENT
```

Layer `A` called `next()` twice. `B` and `C` ran once; `C` answered; the second `next()` then ran `D`, which tried to set a header on a response that had already gone and got `ERR_HTTP_HEADERS_SENT`.

- The same shape against the real Express 5.3.0 router behaved the same way: the layer after the one that answered ran, and `res.json()` in it failed with `ERR_HTTP_HEADERS_SENT`, which Express then handed to the error handlers.
- If that late layer calls `res.end('text')` instead, Node emits an `error` event (`ERR_STREAM_WRITE_AFTER_END`) on the response, asynchronously. With no listener for it, that can crash the process.
- Express 5.3.0 does not detect a double `next()`. Koa does (section 10).

**Question 3: What happens if a middleware never calls `next()` and never ends the response?**
The request **hangs**: no answer and no error. Node's http server does not time it out by default: `server.timeout` is `0` (disabled) and `server.requestTimeout` (300000 ms by default) only limits how long the server waits to **receive** the request. The client waits until its own timeout fires (example 01, part 5 gave up after 300 ms with `TimeoutError`). Memory and the socket stay in use for as long as it hangs. Always set client-side timeouts (`AbortSignal.timeout(ms)`) and consider a server-side timeout middleware (task 2). In Koa, a middleware that forgets `await next()` gets a `404` instead of a hang (example 07, part 6), because the framework answers after the chain ends.

Other forms of `next` worth knowing (all checked on Express 5.3.0):

- `next()` goes on to the next layer.
- `next(err)` starts the error flow. Any truthy value other than the two strings below is treated as an error.
- `next('route')` skips the remaining handlers of the **current route** and continues with the next matching route.
- `next('router')` leaves the **current router** and continues in the parent. In a test, a router with `get('/x', (req, res, next) => next('router'), handler)` followed by a parent `app.use('/r', fallback)` ran `fallback`, not `handler`.

> **Interview tip:** a strong answer to any of the three also says what you would do about it: keep all four parameters, `return next()`/`return res.json()` so code never continues after answering, and put timeouts and tests around the failure cases.

## 10. The Koa-style onion (async `compose`)

Koa's middleware is `async (ctx, next)`. `ctx` (the context) is one object that wraps Node's `req` and `res`: you read `ctx.method`, `ctx.path`, `ctx.query`, and write `ctx.status`, `ctx.body` and `ctx.set(...)`. Your own data goes in `ctx.state`, for example `ctx.state.user`. The part that matters most is `next()`: it **returns a promise** for "everything below me". So code after `await next()` runs after all the later middleware have finished, even the asynchronous ones.

Picture an onion. The request goes in through layers A, B and C, and the response comes back out through C, B and A. Each layer can act on the way in (before `await next()`) and on the way out (after it). The whole engine is this function (`examples/07-koa-onion.js`):

```js
function compose(middleware) {
  return function run(ctx) {
    let last = -1; // the highest index that has started
    function dispatch(i) {
      if (i <= last) return Promise.reject(new Error('next() called multiple times'));
      last = i;
      const fn = middleware[i];
      if (!fn) return Promise.resolve(); // past the end: next() does nothing
      try {
        return Promise.resolve(fn(ctx, () => dispatch(i + 1))); // next = "run the rest of the list"
      } catch (err) {
        return Promise.reject(err); // a sync throw becomes a rejection
      }
    }
    return dispatch(0);
  };
}
```

Compare with stage 1: there the counter was shared and `next()` returned nothing. Here `dispatch(i)` is called with an explicit index, so each `next` knows its own position (that makes the double-call check possible), and each call returns the promise of the rest of the chain. The example then runs the **same three middleware** in both models. Part 1 is the onion, part 2 is Express with an `async` handler that waits 20 ms:

```text
=== Part 1: compose, the heart of Koa
order: A in > B in > C start > C done > B out > A out
=== Part 2: the same code in the Express model (next() returns nothing)
order: A in > B in > C start > B out > A out > C done
"A out" and "B out" ran BEFORE "C done": next() cannot wait for async work in Express.
```

In the Express model `A out` and `B out` ran **before** `C done`, because `next()` returned immediately and had no way to wait for the async work. In the onion they run after. That is the whole difference, and everything else follows from it.

**After-response logic: timing.** In Koa the middleware does not send the response. It sets `ctx.body`, and the framework writes the real response **after** the chain has unwound. So the first middleware can measure the whole request and still add a header (`examples/07-koa-onion.js`, part 3):

```js
async (ctx, next) => {
  const started = performance.now();
  await next();                                             // everything below finished, nothing sent yet
  ctx.set('X-Response-Time', `${Math.round(performance.now() - started)}ms`);   // still possible
}
```

```text
=== Part 3: a timing header
Koa model   : 200 {"hello":"koa"} | X-Response-Time is a number of ms: true | at least 20ms: true
Express way : 200 {"hello":"express"} | header present: false | error seen: ERR_HTTP_HEADERS_SENT
(Express fixes this by setting the header in a patched res.writeHead, see example 08.)
```

In Express the handler has already called `res.json()` when `next()` returns, so the headers are gone; the late `setHeader` throws `ERR_HTTP_HEADERS_SENT`. The Express answer is to hook into the response: patch `res.writeHead` (example 08, the idea behind the `on-headers` package), or listen to `res.on('finish')` when you only need to log.

The rest of the example:

```text
=== Part 4: errors in the onion
/ok        200 fine
/boom      500 {"error":"Internal Server Error"}
/missing   404 {"error":"No such page"}
=== Part 5: next() called twice
Koa model rejects : next() called multiple times
Express model     : no check, the shared counter runs whatever comes next (example 01, part 4).
=== Part 6: a middleware that never calls next()
Koa model   : 404 {"error":"Not Found"} (the chain ended, so the framework still answers)
Express way : the request hangs (example 01, part 5).
```

Errors in the onion are plain `try/catch` around `await next()` in one outer middleware, instead of a four-parameter function. A double `next()` is detected. A forgotten `next()` ends the chain and the framework answers `404`.

| | Express model | Koa model |
|---|---|---|
| `next()` returns | nothing useful | a promise for the rest of the chain |
| Code after `next()` | runs after the **synchronous** part of the rest, too early for async | runs after everything below is finished |
| Who sends the response | whoever calls `res.json()` / `res.end()` | the framework, after the chain, from `ctx` |
| Errors | `next(err)` and four-parameter handlers | `throw` and `try/catch` around `await next()` |
| `next()` twice | not detected | rejects with `next() called multiple times` |
| Forgot `next()` and did not answer | request hangs | `404` |
| Objects | Node `req` and `res` with helpers | one `ctx` that wraps them |

> **Interview tip:** "Why can Koa middleware measure request time and Express cannot?" Because in Koa `next()` returns a promise, so `await next()` pauses until the rest of the chain is done, and the response is sent last. Hono and Fastify's `onSend` hook give you similar "after" points in their own ways.

## 11. Express in practice

> Everything in this section needs `npm install express`. These are snippets, not examples you can run from this repo. Where a sentence says "checked on 5.3.0", it was run against **Express 5.3.0** (the `latest` tag on 2026-11-10; Express 4.22.3 is still maintained as `latest-4`). Package versions drift, so check `npm view express version`. A separate folder, `express-interview-prep`, sits next to this repository and goes much deeper than this section. Here we only connect Express to the engine you just built.

### 11.1 App, routes, built-in middleware

```js
// Needs: npm install express
const express = require('express');
const app = express();

app.use(express.json());                            // JSON bodies -> req.body
app.use(express.urlencoded({ extended: false }));   // HTML form bodies -> req.body
app.use(express.static('public'));                  // files from ./public, no route needed

app.get('/users/:id', (req, res) => {
  res.json({ id: req.params.id, sort: req.query.sort });    // GET /users/7?sort=asc -> {"id":"7","sort":"asc"}
});
app.post('/users', (req, res) => {
  res.status(201).json({ created: req.body?.name });   // Express 5: req.body is undefined if no parser ran
});

app.listen(3000, (err) => {                         // Express 5: errors such as EADDRINUSE arrive here
  if (err) throw err;
  console.log('listening on 3000');
});
```

Built-in middleware in Express 5:

| Middleware | Does |
|---|---|
| `express.json()` | Parses `application/json` into `req.body` (default limit 100kb) |
| `express.urlencoded({ extended })` | Parses what a plain HTML `<form method="post">` sends (`name=Ada&age=36`). In Express 5 `extended` defaults to `false` (the simple parser: `b[c]=2` stays a flat key `'b[c]'`) |
| `express.text()`, `express.raw()` | Body as a string or a `Buffer` (webhooks that need the raw bytes to check a signature) |
| `express.static(dir, options)` | Serves files with ETag and Last-Modified. Dotfiles are ignored by default in Express 5. The hand-written version, with the path traversal check, is in lesson 12, section 20 |
| `express.Router()` | Creates a router (section 8) |

Common third-party middleware you will meet: `cors`, `helmet` (security headers), `morgan` (access logs), `cookie-parser`, `express-session`, `multer` (uploads), `compression`, `express-rate-limit`. You can now write the idea of each by hand (section 13).

### 11.2 The `req` and `res` API you use daily

| You want | Express | Notes |
|---|---|---|
| Path parameter | `req.params.id` | Express 5: object without a prototype |
| Query string | `req.query.sort` | Strings or arrays of strings. Express 5 default parser is "simple" |
| Parsed body | `req.body` | Needs a parser. `undefined` without one |
| A header | `req.get('X-Token')` or `req.headers['x-token']` | `req.get` is case-insensitive |
| Matched URL parts | `req.path`, `req.baseUrl`, `req.originalUrl` | Section 8 |
| Client IP, scheme | `req.ip`, `req.protocol` | Behind a proxy or load balancer set `app.set('trust proxy', 1)` |
| Send JSON | `res.status(201).json(obj)` | Chainable |
| Send text, HTML, `Buffer` | `res.send(value)` | Picks the content type from the value |
| No body | `res.sendStatus(204)` or `res.status(204).end()` | |
| Redirect | `res.redirect(302, '/login')` | Express 5 order is `(status, url)` |
| Send a file | `res.sendFile(absolutePath)` | Use an absolute path; never build it from user input |
| Header, cookie | `res.set('Cache-Control', 'no-store')`, `res.cookie('sid', v, { httpOnly: true })` | |
| Share data between middleware | `req.user = ...`, `res.locals.theme = ...` | `res.locals` is meant for template data |

Two behaviours you get for free (checked on 5.3.0): a route registered with `app.get` also answers `HEAD` (same headers, no body), and a request with the `OPTIONS` method to a known path is answered automatically with an `Allow` header (`GET, HEAD` for a route that only has `app.get`). Unknown paths and unknown methods on a known path are plain `404`s with an HTML page; to return JSON instead, register your own 404 handler last.

`trust proxy` was checked on 5.3.0: without it, a request carrying `X-Forwarded-For: 203.0.113.9` and `X-Forwarded-Proto: https` gave `req.ip` `::ffff:127.0.0.1` and `req.protocol` `http`; after `app.set('trust proxy', 1)` they became `203.0.113.9` and `https`. Never trust those headers unless your own proxy sets them, otherwise a client can lie about its IP (and bypass an IP rate limit).

### 11.3 Middleware order pitfalls

Order is the number one source of Express bugs. All five of these are the same lesson you saw in stages 1 to 5:

| Pitfall | What happens | Fix |
|---|---|---|
| `express.json()` after the route | `req.body` is `undefined` in that route (checked on 5.3.0: `{"body":"undefined"}`) | Register parsers before the routes that need them |
| Error handler registered **before** the routes | It never sees their errors; they skip past it to a handler registered later, or to Express's default handler (checked) | Error handlers go **last** |
| A catch-all (`app.use('/shadow', ...)`, or a 404 handler) before real routes | The real route is never reached (checked: the catch-all answered) | 404 handler is the last normal middleware |
| Auth after the route it should protect | The route is open | Auth first, or on the route: `app.get('/x', auth, handler)` |
| CORS after rate limiting or auth | A `401` or `429` answer has no CORS headers, so the browser hides it and shows a vague CORS error | CORS early |

A safe default order: request id, logger, security headers (`helmet`), CORS, body parsers, rate limit, auth, routes, 404, error handler.

### 11.4 Errors and async handlers

```js
// Needs: npm install express   (Express 5)
app.get('/users/:id', async (req, res) => {
  const user = await db.findUser(req.params.id);   // a rejection here reaches the error handler. No try/catch, no next(err).
  if (!user) throw Object.assign(new Error('Not found'), { status: 404 });
  res.json(user);
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));          // normal middleware, 3 params, last
app.use((err, req, res, next) => {                                              // error handler, 4 params, after it
  if (res.headersSent) return next(err);
  res.status(err.status ?? 500).json({ error: err.status ? err.message : 'Internal Server Error' });
});
```

Checked on 5.3.0: an unknown id gave `404 {"error":"Not found"}`, a handler that threw after an `await` gave `500 {"error":"Internal Server Error"}`, and an unknown route gave the 404 JSON. In Express 4 the same async handler would leave the request hanging and produce an unhandled rejection, so Express 4 projects use a wrapper or the `express-async-errors` package.

If you register **no** error handler, Express answers with its built-in one: status `500` and an HTML page that contains the **stack trace**, unless `NODE_ENV` is `production`, in which case the page shows only `Internal Server Error` (checked on 5.3.0; the stack is also printed to stderr). That is one reason `NODE_ENV=production` matters, and why you register your own JSON handler anyway.

### 11.5 Router modularisation

```js
// routes/users.js            Needs: npm install express
const express = require('express');
const router = express.Router();

router.use(requireAuth);                                  // only for /api/v1/users/...
router.route('/').get(list).post(create);                 // router.route() groups methods for one path
router.route('/:id').get(one).put(replace).delete(remove);

module.exports = router;

// app.js
app.use('/api/v1/users', require('./routes/users'));
```

Checked on 5.3.0: `GET /api/v1/users/5?x=1` inside `one` gave `req.params.id === '5'`, `req.baseUrl === '/api/v1/users'`, `req.originalUrl === '/api/v1/users/5?x=1'`, the same fields as our mini router (section 8). `app.param('id', fn)` runs a function whenever a route has an `:id` parameter, handy for loading a record once.

**Gotcha: parameters in the mount path.** A router sees only its own route parameters. With `app.use('/users/:userId/posts', postsRouter)`, the handlers in `postsRouter` get `req.params.userId === undefined` unless the router is created with `express.Router({ mergeParams: true })`. Checked on 5.3.0 with `GET /a/42/posts`: the plain router saw no `userId`, and the `mergeParams` router saw `"42"`. (Our mini router mounts only fixed text prefixes, so it does not have this problem and does not support parameters in the prefix.)

### 11.6 What changed in Express 5

| Topic | Express 4 | Express 5 (5.3.0) |
|---|---|---|
| Node version | older versions | needs Node 18 or newer (docs) |
| Rejected promises in handlers | not handled | forwarded to error middleware (checked) |
| Wildcard | `app.get('/files/*', ...)` | must be named: `/files/*splat`; `req.params.splat` is an **array** (`['a','b','c']` for `/files/a/b/c`). It does not match `/files` itself; use `/files{/*splat}`. The old `'/files/*'` throws `PathError` when registered |
| Optional segment | `/user/:id?` | braces: `/user{/:id}`, `/file{.:ext}`. The old `?` form throws at registration |
| Regex characters in a path string | allowed | not supported (path-to-regexp 8) |
| `req.body` without a parser | `undefined`. After `express.json()` ran, requests it skipped got `{}` (migration guide, not run here) | stays `undefined` |
| `req.query` | extended parser (`qs`), property | "simple" parser, a getter. `?a=1&b[c]=2&d=3&d=4` gives `{ a: '1', 'b[c]': '2', d: ['3','4'] }`. Assigning to it does nothing |
| `express.urlencoded` default | `extended: true` | `extended: false` (docs) |
| `req.host` | hostname only | keeps the port |
| Removed | `app.del()`, `req.param()`, `res.sendfile()` | Checked: `app.del`, `req.param`, `res.sendfile`, `express.bodyParser` are all `undefined` |
| `res.json(obj, status)` | status as 2nd argument | not supported. On 5.3.0 the extra argument is **ignored**: status stays 200. Use `res.status(s).json(obj)` |
| `res.send(404)` (number) | sent a status | not supported. On 5.3.0 it sends the **body** `404` (as JSON, `Content-Type: application/json`) with status 200. Use `res.sendStatus(404)` |
| `res.redirect('back')` | back to the referrer | removed. On 5.3.0 it redirects to the literal URL `back` |
| `res.redirect(url, status)` | allowed | use `res.redirect(status, url)`. On 5.3.0 the old order throws a `TypeError` (so the client gets a 500); `res.redirect(301, '/x')` works |
| `res.status(99)` | allowed | throws `Invalid status code` (only integers 100 to 999) |
| `app.listen` callback | success only | also receives errors (docs) |

Rows marked "docs" come from the official migration guide and were not executed here; the rest were run on 5.3.0. If you maintain an Express 4 app, the migration guide on expressjs.com is the place to start; many changes can be found by running your tests.

> **Interview tip:** "What changed in Express 5?" Three headline points are enough. (1) Rejected promises from async handlers go to the error handler automatically. (2) Route paths use path-to-regexp 8: wildcards must be named (`/files/*splat`) and optional parts use braces (`/user{/:id}`). (3) Removed or tightened APIs: `req.body` is `undefined` without a parser, `req.query` uses the simple parser, `res.json(obj, status)`, `app.del()` and `req.param()` are gone, and `res.redirect` takes `(status, url)`. Add that it needs Node 18 or newer.

### 11.7 Production habits

`app.disable('x-powered-by')` (Express sends `X-Powered-By: Express` by default; `helmet` also removes it), `app.set('trust proxy', 1)` behind a proxy, `helmet()` for security headers, body limits on every parser, timeouts, graceful shutdown on `SIGTERM` (lesson 12, example 09), `NODE_ENV=production`, and logging errors with a request id (section 13).

## 12. Express, Fastify, Koa, NestJS, Hono and raw `node:http`

Versions are the `latest` tags on npm on 2026-11-10; they change often. The `engines` field on npm at that date asked for Node 18 or newer for Express 5 and Koa 3, and Node 20 or newer for Fastify 5 and NestJS 12. Check `engines` before you pick a framework version for an older Node.

| | Raw `node:http` | Express 5 | Koa 3 | Fastify 5 | NestJS 12 | Hono 4 |
|---|---|---|---|---|---|---|
| Version | built in | 5.3.0 | 3.3.0 | 5.12.8 | 12.4.2 | 4.13.17 |
| Idea | nothing added | minimal, unopinionated, a middleware chain | tiny core, async onion, bring your own router | fast, schema-first, plugins | full framework: modules, dependency injection, decorators | web-standard `Request`/`Response`, tiny, runs everywhere |
| Middleware model | you build it | `next()` chain, four-parameter error handlers | `async (ctx, next)` onion | **hooks** (`onRequest`, `preHandler`, `onSend` ...) and **plugins** | guards, pipes, interceptors, exception filters (plus Express/Fastify middleware) | `async (c, next)` onion, like Koa |
| Validation | by hand | none built in (add Zod, Joi, Ajv) | none built in | **built in**: JSON Schema (Ajv) for params, query, body, headers | pipes (`class-validator` or Zod) | validator helpers and add-on packages |
| Serialization | `JSON.stringify` | `JSON.stringify` | `JSON.stringify` | **response schema** (fast-json-stringify) drops unlisted fields | via the adapter | `c.json()` |
| Structure | yours | yours | yours | **plugins with encapsulation**: a plugin's hooks and decorators stay inside it | modules, controllers, providers (the DI container wires them) | yours (small) |
| Language | JS | JS | JS | JS, types included | TypeScript first | TypeScript first |
| Speed | baseline | not built around raw speed | lean core | designed for throughput | adds a layer on top of its adapter | designed to be fast and small |
| Runs on | Node | Node | Node | Node | Node (on Express or Fastify) | Node, Deno, Bun, Cloudflare Workers, Lambda and more |

On speed: published benchmarks usually put Fastify and Hono ahead of Express, but this course did not measure any of them, and for most services the database and network dominate. The structural reasons are easy to state. Express (like our mini framework) tests its routes one by one, in order, while Fastify looks routes up in a prefix tree (`find-my-way`). Fastify also compiles your schemas into functions, for validation (Ajv) and for fast JSON output (`fast-json-stringify`). Measure your own workload before you let speed decide.

Two words from the table. A **decorator** is the `@Something()` syntax in TypeScript that attaches information to a class or method: `@Get(':id')` means "this method handles `GET /:id`". **Dependency injection (DI)** means the framework creates the objects a class needs and passes them to its constructor, so you never call `new` on them yourself and a test can pass in fakes.

**Where the extra steps run.** Frameworks with more structure give every step its own named place. Interviewers like to ask for the order:

- **Fastify:** `onRequest`, `preParsing`, body parsing, `preValidation`, schema validation, `preHandler`, your handler, `preSerialization`, `onSend`, and after the response has gone out `onResponse` (`onError` runs when something throws). A hook added inside a plugin applies only inside that plugin. That is **encapsulation**. When a plugin must share a decorator or hook with its parent, it is wrapped with the `fastify-plugin` package.
- **NestJS:** middleware, guards (may this request go on?), interceptors (the "before" half), pipes (validate and transform the input), your controller method, interceptors (the "after" half), and exception filters when something throws.

**When to choose which**

- **Raw `node:http`**: a health-check server, a small proxy, a learning project, or when you want zero dependencies. You pay in code you must write and maintain.
- **Express**: the safe default. The ecosystem and the number of developers who know it are unmatched. Pick it for CRUD APIs, quick prototypes, and teams new to Node.
- **Fastify**: when you want built-in validation and fast serialization, a plugin architecture that scales to big codebases, and good logging (pino) out of the box. A very good default for new JSON APIs.
- **Koa**: when you like the onion model and prefer to assemble your own stack. Smaller community than Express.
- **NestJS**: large teams and long-lived products where enforced structure (modules, DI, decorators) beats freedom, especially with Angular-style experience. It is a layer **on top of** Express or Fastify, written in TypeScript. Note: Node's built-in type stripping (lesson 21) cannot run decorators or constructor parameter properties, so Nest projects need a real compile step.
- **Hono**: when code must run on several runtimes (Cloudflare Workers, Deno, Bun, Node), or when you want a very small framework built on web standards.

Illustrative snippets, not run by this course:

```js
// Needs: npm install fastify
const fastify = require('fastify')({ logger: true });

fastify.addHook('onRequest', async (request, reply) => { /* runs for every request in this scope */ });

fastify.get('/users/:id', {
  schema: {
    params: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    response: { 200: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } } },
  },
}, async (request) => {
  // the params schema checked the input and turned "7" into the number 7 BEFORE this runs
  return { id: request.params.id, name: 'Ada', passwordHash: 'removed by the response schema' };
});

fastify.register(async (instance) => {            // a plugin: its own scope ("encapsulation")
  instance.get('/ping', async () => 'pong');
}, { prefix: '/v1' });

fastify.listen({ port: 3000 });                   // Fastify 5: the options-object form
```

```js
// Needs: npm install koa
const Koa = require('koa');
const app = new Koa();
app.use(async (ctx, next) => {                    // the onion from section 10, for real
  const started = Date.now();
  await next();
  ctx.set('X-Response-Time', `${Date.now() - started}ms`);
});
app.use(async (ctx) => { ctx.body = { hello: 'world' }; });
app.listen(3000);
```

```js
// Needs: npm install hono @hono/node-server     (ES module syntax: save as .mjs)
import { Hono } from 'hono';
import { serve } from '@hono/node-server';

const app = new Hono();
app.use(async (c, next) => {                     // the onion again: code after next() runs on the way out
  const started = Date.now();
  await next();
  c.res.headers.set('X-Response-Time', `${Date.now() - started}ms`);
});
app.get('/users/:id', (c) => c.json({ id: c.req.param('id') }));
serve({ fetch: app.fetch, port: 3000 });         // on Cloudflare Workers you would `export default app` instead
```

```ts
// Needs: npm install @nestjs/core @nestjs/common @nestjs/platform-express  (TypeScript, compiled; not run by this course)
// Imports not shown: Injectable, Controller, Get, Param, Module from '@nestjs/common'; NestFactory from '@nestjs/core'.
@Injectable()
export class UsersService {
  findOne(id: string) { return { id, name: 'Ada' }; }
}

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}      // the DI container passes the service in
  @Get(':id')
  findOne(@Param('id') id: string) { return this.users.findOne(id); }
}

@Module({ controllers: [UsersController], providers: [UsersService] })
export class AppModule {}

// main.ts:  const app = await NestFactory.create(AppModule); await app.listen(3000);   // Express underneath
```

> **Interview tip:** when asked to compare frameworks, do not recite features. Say what is different in kind: Express and Koa give you a pipeline and you choose the rest; Fastify is schema-first and uses hooks plus encapsulated plugins; NestJS adds a structure and a dependency-injection container on top of Express or Fastify; Hono is built on the web-standard `Request`/`Response` so it moves between runtimes. Then say how you would decide for a concrete project (team size, TypeScript, runtime target, performance needs).

## 13. Middleware you should be able to write by hand

These are favourite live-coding tasks. `examples/08-handwritten-middleware.js` has all of them, plus an app that puts them in the right order. They all share one shape: do a little work, then either call `next()` or answer, and sometimes hook into the moment the response finishes. The key ones:

**Request id.** A label for each request that appears in the logs and in the response, so a user can quote it in a bug report.

```js
function requestId() {
  return (req, res, next) => {
    const incoming = req.headers['x-request-id'];
    // trust an id from the client only if it looks harmless (log injection!)
    req.id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  };
}
```

The id lives on `req`. If deeper code (a database helper, a logger) needs it without being handed `req`, store it in an `AsyncLocalStorage`: the middleware starts the store, and everything that runs later in that request, even after an `await`, can read it. Lesson 24, section 8 builds exactly that.

**Logger.** Use `res.on('finish')` so you log the real status code and duration after the response was sent (it is the Express counterpart of "code after `await next()`").

**Timing header.** In Express you cannot set a header "after `next()`" (the handler already answered, section 10), so wrap `res.writeHead` instead. This code goes inside a middleware `(req, res, next)`, before it calls `next()`. It sets the header just before the headers go out, and it catches every response because `res.end()` calls `writeHead` itself when you did not:

```js
const started = process.hrtime.bigint();
const writeHead = res.writeHead;
res.writeHead = function (...args) {
  if (!this.headersSent) {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    this.setHeader('X-Response-Time', `${ms.toFixed(1)}ms`);
  }
  return writeHead.apply(this, args);
};
```

**CORS.** If the request has an `Origin` that you allow, add `Access-Control-Allow-Origin` and `Vary: Origin`; for a **preflight** (`OPTIONS` with `Access-Control-Request-Method`) answer `204` with the allowed methods and headers, and stop the chain. Lesson 12 explains the browser side.

**Rate limit (token bucket).** Each client has a bucket with `capacity` tokens that refills at a steady rate. A request costs one token; an empty bucket gets `429` with `Retry-After`. The core of the check (the example defines `bucket`, `t`, `capacity` and `refillPerSecond` around it):

```js
bucket.tokens = Math.min(capacity, bucket.tokens + ((t - bucket.updated) / 1000) * refillPerSecond);
bucket.updated = t;
if (bucket.tokens < 1) {
  res.setHeader('Retry-After', String(Math.ceil((1 - bucket.tokens) / refillPerSecond)));
  return next(httpError(429, 'Too Many Requests'));
}
bucket.tokens -= 1;
```

**Compression (the idea).** If the client sends `Accept-Encoding: gzip` and the body is bigger than a threshold, replace `res.end` with a version that gzips the body, sets `Content-Encoding: gzip`, fixes `Content-Length`, and adds `Vary: Accept-Encoding`. The real `compression` package streams through `zlib.createGzip()`, skips already-compressed types (images, video), and respects `Cache-Control: no-transform`. The example uses `gzipSync`, which blocks the event loop and is only fine for a demo. In production the reverse proxy or CDN often compresses instead.

**404 and error handler.** The last two functions of the chain (sections 5 and 18).

The app in the example registers them like this, and the **order is part of the design**:

```js
app.use(requestId());   // first: everybody after it can use req.id
app.use(timing());
app.use(logger(lines)); // early, so it also sees short-circuited answers (preflight, 429)
app.use(cors({ origins: ['https://app.example.com'] })); // before the rate limit: a 429 needs CORS headers
app.use(rateLimit({ capacity: 3, refillPerSecond: 1, keyOf, now }));
app.use(compress({ threshold: 200 }));
// ... routes ...
app.use(notFound);      // after all routes
app.use(errorHandler(logs)); // last of all
```

```text
--- request id
client sent an id              client-id-0001 (kept)
client sent a bad id           replaced by a uuid: true
--- timing
X-Response-Time looks like     a number of ms
--- CORS
preflight, allowed origin      204 allow-origin=https://app.example.com allow-methods=GET,POST,PUT,PATCH,DELETE
preflight, unknown origin      404 allow-origin=null vary=Origin
normal call, allowed origin    200 allow-origin=https://app.example.com
--- rate limit (3 tokens, 1 token back per second, fake clock)
bob, 4 quick requests          200, 200, 200, 429 (Retry-After 1)
alice, her own bucket          200 remaining=2
bob, 1 second later            200
bob, again at once             429 {"error":{"message":"Too Many Requests","requestId":"client-id-0004"}}
--- compression
client says identity           content-encoding=null bytes=3511
client accepts gzip            content-encoding=gzip bytes=87 (decoded text is 3511 chars)
small body, gzip accepted      content-encoding=null (below the threshold)
origin AND gzip                vary=Origin, Accept-Encoding
--- 404 and 500
unknown route                  404 {"error":{"message":"No route for GET /nothing","requestId":"client-id-0002"}}
a bug in a handler             500 {"error":{"message":"Internal Server Error","requestId":"client-id-0003"}}
what the server logged         ["server error (client-id-0003): null pointer somewhere"]
--- the access log (one line per finished response)
  client-id-0001 GET /small -> 200
  client-id-0002 GET /nothing -> 404
  client-id-0003 GET /bug -> 500
  lines in total: 19 | all had a duration: true
```

Points worth saying out loud in an interview:

- **Preflight, unknown origin** got a `404`, not a CORS error from the server: the `cors` middleware simply adds no headers, the preflight falls through to the routes, and the **browser** blocks the real request because `Access-Control-Allow-Origin` is missing. CORS is enforced by browsers, not by servers; `curl` and server-to-server calls ignore it.
- `Vary: Origin` and `Vary: Accept-Encoding` tell caches that the answer depends on those request headers. The helper **appends** to `Vary` instead of overwriting it (the "origin AND gzip" line).
- The rate limiter keeps its buckets in memory, so the limit is **per process**: with 4 instances behind a load balancer a client really gets 4 times the limit, and a restart resets everything. Production limiters keep counters in Redis (atomic increments or a small Lua script). Key on the real client IP (`trust proxy`) or an API key, and delete idle buckets so the map does not grow forever. The fake clock (`now`) in the example is how you test time-based code without sleeping.
- Which algorithm? Fixed window is simplest but allows a burst of twice the limit around a boundary; sliding window is smoother; token bucket allows controlled bursts and is easy to explain.

## 14. Request validation

Never trust input. Check **every** part of the request that a client controls: body, query string, path parameters, headers. Validate at the edge (a middleware in front of the handler) so handlers only ever see clean data. A good validation step does four things: checks types and ranges, **removes unknown fields** (a whitelist), **converts** values (`"5"` to `5`, because query strings are always text), and collects **all** problems, not only the first.

`examples/09-validation-and-auth.js` writes a tiny version by hand. A rule is a function `input -> { value } | { error }`, and `validate(schema)` runs the rules for `params`, `query` and `body`:

```js
app.post('/products', auth, json(), validate({
  body: { name: str({ max: 40 }), price: int({ min: 0, max: 100000 }), stock: optional(int({ min: 0 }), 0) },
}), (req, res) => res.status(201).json({ created: req.valid.body }));
```

```text
--- validation
valid product                      201 {"created":{"name":"Keyboard","price":49,"stock":0}}
invalid product                    422 {"error":{"message":"Validation failed","issues":[{"in":"body","path":"name","message":"must be a string"},{"in":"body","path":"price","message":"must be at least 0"},{"in":"body","path":"stock","message":"must be a whole number"}]}}
no body at all                     422 {"error":{"message":"Validation failed","issues":[{"in":"body","path":"name","message":"must be a string"},{"in":"body","path":"price","message":"must be a whole number"}]}}
GET /products?page=2&limit=5       200 {"page":2,"limit":5,"types":["number","string"]}
GET /products (defaults)           200 {"page":1,"limit":10,"types":["number","undefined"]}
GET /products?page=zero&limit=500  422 {"error":{"message":"Validation failed","issues":[{"in":"query","path":"page","message":"must be a whole number"},{"in":"query","path":"limit","message":"must be at most 50"}]}}
```

Notice: `price: '49'` became the number `49`; `extra` was dropped; `name` was trimmed; the missing `stock` got its default; with no body at all (`req.body` is `undefined`) the rules still run and report errors; and `req.valid.query.page` is a number while `req.query.page` is still the string `'2'`. Failures become `422` with a list of issues. Use `400` for requests that are malformed (broken JSON) and `422` for well-formed requests with invalid content; either is acceptable if you are consistent and document it.

In real projects use a schema library. They all do the same job. With Zod the schema is wrapped in one reusable middleware, which is the shape of `validate()` in the example:

```js
// Needs: npm install express zod
const { z } = require('zod');
const CreateProduct = z.object({
  name: z.string().trim().min(1).max(40),
  price: z.coerce.number().int().min(0),
  stock: z.number().int().min(0).default(0),
});

const validateBody = (schema) => (req, res, next) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: { message: 'Validation failed', issues: parsed.error.issues } });
  }
  req.valid = { ...req.valid, body: parsed.data };  // typed, trimmed, defaults applied, unknown keys removed
  next();
};

app.post('/products', express.json(), validateBody(CreateProduct), (req, res) => {
  res.status(201).json({ created: req.valid.body });
});
```

Joi and Ajv are used the same way. Inside a handler or a middleware:

```js
// Needs: npm install joi
const Joi = require('joi');
const schema = Joi.object({ name: Joi.string().trim().min(1).max(40).required(), price: Joi.number().integer().min(0).required() });
const { value, error } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
if (error) return res.status(422).json({ issues: error.details.map((d) => ({ path: d.path.join('.'), message: d.message })) });
```

```js
// Needs: npm install ajv
const Ajv = require('ajv');
const ajv = new Ajv({ allErrors: true, removeAdditional: true, coerceTypes: true });
const validate = ajv.compile({
  type: 'object',
  properties: { name: { type: 'string', minLength: 1, maxLength: 40 }, price: { type: 'integer', minimum: 0 } },
  required: ['name', 'price'],
  additionalProperties: false,
});
if (!validate(req.body)) return res.status(422).json({ issues: validate.errors });
```

| Library | Style | Notes |
|---|---|---|
| Zod | TypeScript-first schemas in code | Infers TypeScript types from the schema. Most popular for TS projects |
| Joi | Fluent schemas in code | Long-standing, rich rules, no type inference |
| Ajv | JSON Schema documents | The standard; the schemas can be shared with OpenAPI; this is what Fastify uses under the hood |

> **Common mistake:** validating in the handler "when I remember", or only on the front end. Anything in the browser can be bypassed with `curl`. Another one: a client sending `?role=admin&role=user` and your code expecting a string.

> **Interview tip:** "How do you validate input in an API?" A strong short answer: "At the edge, in a middleware, with a schema library such as Zod, Joi or Ajv. It checks types and ranges, strips unknown fields, converts strings to numbers, and returns all the problems at once, as `422` (or `400`) with a consistent error shape. Handlers then only ever see clean data. Front-end validation is only a convenience."

## 15. Authentication middleware

**Authentication** answers "who are you?". **Authorization** answers "what may you do?". They are separate steps and separate failures: `401 Unauthorized` (really "unauthenticated": no valid credentials, send `WWW-Authenticate`) versus `403 Forbidden` (we know who you are, you may not do this).

The pattern is always the same, whatever the credential is:

1. A middleware reads the credential (the `Authorization: Bearer <token>` header, or a session cookie).
2. It **verifies** it (signature and expiry for a token, a lookup for a session id).
3. On success it **attaches the result to the request** (`req.user = {...}`) and calls `next()`.
4. On failure it calls `next(httpError(401, ...))`.
5. Later middleware and handlers read `req.user`. Role and ownership checks come after.

`examples/09-validation-and-auth.js` builds this with a signed token in the shape of a JWT (JSON Web Token): `header.payload.signature`, each part base64url-encoded. The signature is an HMAC-SHA256 of `header.payload`: a hash that also mixes in a secret key, so only someone who knows the secret can produce a matching one. Anyone can **read** the payload (it is only encoded, not encrypted), but nobody can change it without breaking the signature.

```js
function verifyToken(token, secret, { now = Date.now } = {}) {
  const [h, p, s] = String(token).split('.');
  if (JSON.parse(unb64url(h)).alg !== 'HS256') throw new Error('unsupported algorithm');  // the token must NOT choose the algorithm
  const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest();
  const given = Buffer.from(s, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new Error('bad signature');
  const payload = JSON.parse(unb64url(p));
  if (typeof payload.exp === 'number' && payload.exp <= Math.floor(now() / 1000)) throw new Error('token expired');
  return payload;
}

const authenticate = (secret) => (req, res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    res.setHeader('WWW-Authenticate', 'Bearer');
    return next(httpError(401, 'Authentication required'));
  }
  try { req.user = verifyToken(token, secret); }          // attach the identity for later middleware
  catch { return next(httpError(401, 'Invalid or expired token')); }   // same message for every failure
  next();
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(httpError(401, 'Authentication required'));
  if (!roles.includes(req.user.role)) return next(httpError(403, 'You are not allowed to do this')); // known user, not allowed
  next();
};
```

```text
--- login and the token
token has 3 parts                  true
header                             {"alg":"HS256","typ":"JWT"}
payload                            {"sub":"1","name":"ada","role":"user","iat":1767225600,"exp":1767229200}
wrong password                     401 {"error":{"message":"Wrong name or password"}}
missing fields                     422 {"error":{"message":"Validation failed","issues":[{"in":"body","path":"name","message":"must have at least 1 character"},{"in":"body","path":"password","message":"must be a string"}]}}
--- authentication: who are you?
GET /public (anonymous)            200 {"hello":"stranger"}
GET /public (logged in)            200 {"hello":"ada"}
GET /me without token              401 {"error":{"message":"Authentication required"}}
                                   WWW-Authenticate: Bearer
GET /me with token                 200 {"user":{"sub":"1","name":"ada","role":"user","iat":1767225600,"exp":1767229200}}
forged payload, old signature      401 {"error":{"message":"Invalid or expired token"}}
"alg":"none" token                 401 {"error":{"message":"Invalid or expired token"}}
garbage token                      401 {"error":{"message":"Invalid or expired token"}}
--- authorization: what may you do?
user -> /admin/stats               403 {"error":{"message":"You are not allowed to do this"}}
admin -> /admin/stats              200 {"users":2}
user 1 -> /users/1/profile         200 {"profileOf":"1"}
user 1 -> /users/2/profile         403 {"error":{"message":"Not your profile"}}
admin -> /users/1/profile          200 {"profileOf":"1"}
```

The last lines of the output show the token expiring after one hour (the example uses a fake clock) and a check of the hand-written HS256 code against the well-known example token from jwt.io, verified with its published secret:

```text
--- time passes: the token expires after 1 hour
GET /me two hours later            401 {"error":{"message":"Invalid or expired token"}}
--- sanity check against the well-known jwt.io example token
verified payload                   {"sub":"1234567890","name":"John Doe","iat":1516239022}
```

What to say in an interview:

- **Why `timingSafeEqual`?** A normal `===` on strings stops at the first different character, and the time it takes can leak how many characters matched. `crypto.timingSafeEqual` takes the same time (it needs equal lengths, hence the length check).
- **The `alg: none` attack.** Early JWT libraries trusted the `alg` field in the token and accepted `"none"` (no signature). The example refuses anything but `HS256`, so the forged token is rejected (`"alg":"none" token` line). Always pin the allowed algorithms.
- **Same error message for every failure**, so an attacker learns nothing about which check failed. Log the real reason on the server.
- **Tokens versus sessions.** A session id (a random string in a cookie) is looked up on the server, so you can revoke it instantly, but it needs shared storage when you run several instances. A signed token needs no lookup, but you cannot easily revoke it before it expires, so keep access tokens short (minutes) and use a refresh token to get new ones. Cookies with `HttpOnly` and `SameSite` protect against script access and cross-site requests; a token kept in `localStorage` can be stolen by any script on the page.
- HS256 is a **shared secret** (both sides need it); RS256 and ES256 use a private key to sign and a public key to verify, which suits several services that only verify.
- In production use `jose` or `jsonwebtoken` (never write your own crypto), hash passwords with `scrypt` or `argon2` (lesson 20), and read secrets from the environment. The example stores plain passwords only to stay short.
- Passport is the well-known Express library for many login strategies (password, OAuth, SAML). It is the same pattern: a middleware that sets `req.user`.

## 16. File uploads

Browsers send files in a request with `Content-Type: multipart/form-data; boundary=...`. The body is a list of **parts** separated by the boundary string. Each part has its own headers (the field name, an optional file name and content type) and then its data. `examples/10-file-upload.js` part 1 shows the real bytes:

```text
=== Part 1: what multipart/form-data looks like
| --<boundary>
| Content-Disposition: form-data; name="title"
|
| My notes
| --<boundary>
| Content-Disposition: form-data; name="doc"; filename="notes.txt"
| Content-Type: text/plain
|
| hello file
| --<boundary>--
|
```

A plain `express.json()` cannot read this; you need a **multipart parser**. There are three levels:

| Approach | How | Use it when |
|---|---|---|
| Parse in memory | Buffer the whole body, then parse it. In this example: `new Request(url, { body: stream, duplex: 'half' }).formData()` (the platform's own parser, a `FormData` with `File` objects) | Small forms and avatars. Memory grows with the upload size, so **limit the size** |
| Stream to disk or cloud | A streaming parser (`busboy`) emits each file as a stream; pipe it to a file or to object storage as it arrives | Large files. Constant memory |
| Skip multipart | The client uploads the file as the raw body of a `PUT`, often straight to storage with a pre-signed URL | Very large files, resumable uploads |

`multer` is the Express middleware built on `busboy`. It parses the form, applies limits, and either keeps files in memory or writes them to disk:

```js
// Needs: npm install express multer
const crypto = require('node:crypto');
const path = require('node:path');
const multer = require('multer');
const upload = multer({
  storage: multer.diskStorage({
    destination: '/var/app/uploads',
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname)}`), // OUR name
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },                     // 5 MiB, one file
  fileFilter: (req, file, cb) => cb(null, ['image/png', 'image/jpeg'].includes(file.mimetype)),
});
app.post('/avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Send a PNG or JPEG in the field "avatar"' }); // no file, or fileFilter said no
  res.status(201).json({ stored: req.file.filename, title: req.body.title });   // text fields land in req.body
});
```

Two details: when `fileFilter` rejects a file, `req.file` is simply `undefined`, so the handler must check it. And a broken limit (a file over `fileSize`) reaches your error handler as an error with `code === 'LIMIT_FILE_SIZE'`, which you should turn into a `413`.

```js
// Needs: npm install express busboy        (the streaming parser underneath)
// Assumes: const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
//          and a variable `dir` that holds an existing upload directory.
const busboy = require('busboy');
app.post('/upload', (req, res) => {
  const bb = busboy({ headers: req.headers, limits: { fileSize: 5 * 1024 * 1024 } });
  bb.on('file', (field, file, info) => {                      // info: { filename, encoding, mimeType }
    file.pipe(fs.createWriteStream(path.join(dir, crypto.randomUUID())));   // bytes go straight to disk
    file.on('limit', () => { /* too big: stop, delete the partial file, answer 413 */ });
  });
  bb.on('field', (name, value) => { /* a text field */ });
  bb.on('close', () => res.status(201).end());
  req.pipe(bb);
});
```

The example's part 3 shows the streaming idea without a library: `pipeline(limited(req, 10000), fs.createWriteStream(target))`. `limited` is an async generator that counts real bytes and throws a `413` when the limit is crossed. `pipeline` (lesson 11) handles backpressure and destroys the file stream on failure, and the handler deletes the half-written file. Output of parts 2 and 3:

```text
=== Part 2: parse in memory (Request.formData), store under our own name
upload  : 201 {"fields":{"name":"Ada"},"files":[{"field":"avatar","clientName":"../../evil.png","type":"image/png","size":16,"storedAs":"<uuid>.png"}]}
on disk : 1 file, named by us, inside the upload directory only
too big : 413 {"error":"Upload is larger than 2000 bytes"}
=== Part 3: streaming a raw body to disk, with a limit of 10000 bytes
8000 bytes  : 201 {"savedBytes":8000}
50000 bytes : 413 {"error":"Upload is larger than 10000 bytes"}
files left in the directory: 1 (the rejected upload was deleted)
```

> **Common mistake:** answering `413` while the client is still sending a large body. The example works on Windows with Node 24 (a 20 MB body behaved the same in a separate check of this pattern), because Node still delivers the response. On other systems or with other clients the client may see a connection reset (`ECONNRESET`) instead of the `413`, because many clients stop reading once the server closes. Real servers often send `Connection: close` with the `413`.

Security checklist, which interviewers love:

- **Never use the client's file name as a path.** The example uploaded `../../evil.png`; the stored name was our own UUID plus a harmless extension. A raw file name allows path traversal (`../../etc/...`) and overwrites.
- **Limit** file size, number of files, and field size. Count real bytes, not only `Content-Length`.
- **Do not trust `Content-Type`**: the client chooses it. For images, check the first bytes ("magic numbers") or re-encode the image. Allow-list types.
- Store uploads **outside the web root** (or in object storage) and serve them with a safe `Content-Type` and `Content-Disposition`, never executable. Consider virus scanning for public uploads.
- Clean up temp files when a request fails or the client disconnects.

## 17. Templating and server-side rendering at a glance

**Server-side rendering (SSR)** means the server builds the HTML page and sends it ready to display, instead of sending JSON for JavaScript in the browser to turn into HTML. A **template engine** fills an HTML template with data. In Express it looks like this:

```js
// Needs: npm install express ejs
app.set('view engine', 'ejs');                          // looks for views/home.ejs
app.get('/', (req, res) => res.render('home', { user: req.user, items }));   // res.render fills the template, then sends HTML
```

Common engines: EJS, Pug, Handlebars, Nunjucks. Frameworks such as Next.js do SSR with components, including streaming the page in pieces.

The one rule you must know: **escape every value you put into HTML**. Otherwise a name like `<script>alert(1)</script>` becomes real code in other users' browsers (XSS, cross-site scripting). Good template engines escape by default and make you opt out. `examples/03-helpers-and-query.js` has a 15-line version of the idea, a tagged template function named `html` that escapes the values you insert and trusts the text you wrote:

```text
--- server-side rendering: values are escaped
GET /users
  -> 200  content-type: text/html; charset=utf-8  length: 81
  -> body: <h1>Users</h1><ul><li>Ada</li><li>&lt;script&gt;alert(1)&lt;/script&gt;</li></ul>
```

| Approach | Where the HTML is built | Good for |
|---|---|---|
| SSR / templates | On the server, per request | Content sites, SEO, fast first paint, simple apps |
| Static generation (SSG) | At build time | Docs, blogs, marketing pages |
| Client rendering (SPA) | In the browser; the server sends JSON | Rich interactive apps; the common Node role is the JSON API |

For an API-only backend you rarely render HTML, but you should know what SSR is, why escaping matters, and that `res.send(htmlString)` already sets `Content-Type: text/html`.

## 18. Graceful error responses

An API is judged by how it fails. Rules that make errors pleasant to consume and safe to expose:

- **One error shape for the whole API**, for example `{ "error": { "message": "...", "requestId": "...", "issues": [...] } }`. The standard `application/problem+json` format (RFC 9457 "Problem Details for HTTP APIs") is a ready-made shape if you want to follow a standard.
- **Right status code.** `400` malformed, `401` not logged in, `403` not allowed, `404` missing, `405` wrong method (with `Allow`), `409` conflict, `413` too big, `422` invalid content, `429` slow down (with `Retry-After`), `500` our bug, `503` unavailable or timed out.
- **Expose 4xx messages, hide 5xx details.** A 4xx message is for the client ("title must not be empty"). A 5xx message can contain table names, file paths or a connection string. Send `Internal Server Error` and a request id, and keep the real error in your logs. In the examples, `httpError(status, message)` sets `expose` for statuses below 500.
- **Log with the request id** so a support ticket can be matched to a log line (section 13).
- **Mind `res.headersSent`** in the handler (section 5), otherwise you throw a second error while handling the first.
- **Unknown routes get the same JSON shape**, not an HTML page.
- **Process-level safety net.** Errors outside any request (a timer, an event emitter) are not caught by middleware. Handle `unhandledRejection` and `uncaughtException` by logging and shutting down cleanly (lesson 14).

The handler from example 08, which follows all of this in a few lines:

```js
function errorHandler(logs) {
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status ?? 500;
    if (status >= 500) logs.push(`server error (${req.id}): ${err.message}`);   // details stay in the log
    res.status(status).json({ error: { message: err.expose ? err.message : 'Internal Server Error', requestId: req.id } });
  };
}
```

## 19. Serverless and edge runtimes at a glance

So far there was a long-running server: `listen()` and handle requests for days. In **serverless** (for example AWS Lambda) you upload a function and the platform starts it on demand, runs it per request or event, and bills for the time used. At the **edge** (for example Cloudflare Workers) your code runs in many locations close to users. Neither has a `listen()`.

`examples/12-serverless-and-edge.js` shows the shapes without any cloud account.

**A Lambda handler** (Node.js runtime, behind an HTTP API) is `async (event, context) => response`. The event describes the request, and you **return** the response object (the body must be a string):

```js
exports.handler = async (event, context) => {
  const name = event.queryStringParameters?.name ?? 'world';
  return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: `hello ${name}` }) };
};
```

The event fields differ by trigger and payload format (the example uses the HTTP API format 2.0 with `rawPath`, `requestContext.http.method` and `queryStringParameters`; a REST API uses `httpMethod` and `path`). Check the current AWS documentation for the exact shape you receive. Bodies may arrive base64-encoded (`isBase64Encoded`).

**Cold starts.** Code **outside** the handler runs once when the platform creates a new execution environment. Later calls to the same environment are **warm** and reuse that state (database clients, caches). When traffic grows, the platform adds more environments, and each starts cold:

```text
=== Part 1: a Lambda handler
env 1, call 1 (cold)               200 {"message":"hello Ada","environment":1,"invocation":1,"cacheHit":false}
env 1, call 2 (warm, same name)    200 {"message":"hello Ada","environment":1,"invocation":2,"cacheHit":true}
POST /echo, plain body             200 {"youSent":{"n":1}}
POST /echo, base64 body            200 {"youSent":{"n":2}}
POST /echo, not JSON               400 {"error":"body is not JSON"}
unknown route                      404 {"error":"no route for GET /nothing","requestId":"req-0001"}
env 2, call 1 (cold again)         200 {"message":"hello Ada","environment":2,"invocation":1,"cacheHit":false}
```

`env 1, call 2` reused the cache (`cacheHit: true`); `env 2, call 1` is a new environment and starts cold again. Never keep per-user data in module variables, because environments are shared by many requests and are thrown away at any time.

> **Interview tip:** "What is a cold start and how do you reduce it?" The extra time the platform needs to create a new environment (fetch the code, start the runtime, run your top-level code) before the first request can be served. Reduce it with a small bundle, no heavy work at startup, rarely used modules loaded lazily, clients created once outside the handler, and the platform's pre-warming option if you need steady latency (AWS calls one such option provisioned concurrency).

**A Workers-style handler** is a plain function from web-standard `Request` to `Response`. On Cloudflare Workers the module ends with `export default { fetch }`, and the platform passes `env` (bindings and secrets) and `ctx` (`ctx.waitUntil(promise)` keeps work running after the response). Workers run in lightweight V8 isolates instead of full Node.js processes, so only part of the Node API is available (some through a compatibility setting, see the Cloudflare docs). That is why frameworks like Hono use only `Request` and `Response`:

```text
=== Part 2: a Workers-style fetch handler, called directly
GET /users/42        -> 200 {"id":"42","region":"edge-demo"}
GET /missing         -> 404 {"error":"Not Found"}
waitUntil work       -> ["analytics for /page"]
```

**The same handler on Node.** Because the handler is `Request -> Response`, a small adapter runs it on `node:http` (this is what `@hono/node-server` does). The adapter turns the Node request into a `Request`, calls the handler, and writes the `Response` back:

```text
=== Part 3: the same app on a Node server, through an adapter
GET /users/7         -> 200 {"id":"7","region":"node"}
POST /echo           -> 201 {"youSent":{"hello":"from node"}}
GET /missing         -> 404 {"error":"Not Found"}
```

| | Long-running server | Serverless function | Edge worker |
|---|---|---|---|
| Entry point | `listen()` and routes | `handler(event, context)` | `fetch(request, env, ctx)` |
| State between requests | In memory (careful when scaling) | Only while warm. Treat as none | Only while the isolate lives. Treat as none |
| Scaling | You run more instances | Automatic | Automatic, worldwide |
| Start time | Seconds, once | Cold start on new environments | Very short |
| Limits | Yours | Execution time and memory limits | Strict CPU time and API limits |
| Needs care | Graceful shutdown | Cold starts, connection counts to databases | Missing Node APIs, data location |

Express can also run on Lambda through a wrapper library (`serverless-http` is a well-known one) that converts the event into a request for your app. Connection-heavy code (a database pool per environment) needs thought, because a spike creates many environments at once, each with its own connections.

## 20. Testing framework apps with real requests

The most reliable test of a web app sends real HTTP requests to it. The recipe (`examples/11-testing-with-fetch.js`):

1. **Build the app with a function** (`buildApp()`), do not export one global app. Each test gets an app with its own empty data, and tests cannot affect each other. Keep `app.js` (builds the app) separate from `server.js` (calls `listen`).
2. **Listen on port 0.** The operating system picks a free port; read it with `server.address().port`. No port clashes, tests can run in parallel, and CI machines never have "port already in use".
3. **Call it with `fetch`** and assert on status, headers and body.
4. **Always close the server**, also when an assertion throws (`try/finally`, or `afterEach`). An open server keeps the test process alive.
5. Unit-test single middleware by calling them with fake `req`, `res` and `next`, no server needed.

```text
--- integration tests: real HTTP on port 0
ok      GET /todos starts empty
ok      POST /todos creates a todo and sets Location
ok      each test gets a fresh app (no leftover todos)
ok      POST with broken JSON is a 400
ok      POST with an empty title is a 422 with a readable message
ok      unknown todo and unknown route are 404 JSON
ok      a bug returns 500 and does NOT leak the message
ok      protected route: 401 without the key, 200 with it
ok      two servers at once do not collide (port 0)
--- unit tests: call the middleware directly with fake req, res and next
ok      apiKeyGuard calls next() with no argument for a good key
ok      apiKeyGuard calls next(error) with status 401 for a bad key

11 passed, 0 failed
```

The same ideas with the built-in test runner `node:test` (lesson 16) are in `examples/13-api.test.js`. Run it with `node --test lessons/26-frameworks-and-middleware/examples/13-api.test.js`. The runner prints one line per test with its duration and then a summary (`tests 7`, `pass 7`, `fail 0`). The durations change on every run, so the output is not pasted here. The core of the file:

```js
function buildApp() { /* returns a brand-new app with GET /ping, /todos and so on, and never calls listen() */ }

describe('the todo API', () => {
  let api;
  beforeEach(async () => { api = await start(buildApp()); });   // a fresh app and a fresh port for every test
  afterEach(async () => { await api.close(); });                // always close, or the test run never ends

  it('answers GET /ping', async () => {
    const res = await api.get('/ping');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { pong: true });
  });
});
```

With real Express you would use `supertest`, which does steps 2 and 3 for you:

```js
// Needs: npm install -D supertest
const request = require('supertest');
const app = require('./app');            // app.js exports the app and does NOT call listen

it('answers GET /ping', async () => {
  const res = await request(app).get('/ping').expect(200);   // supertest binds the app to port 0 for this call
  assert.deepEqual(res.body, { pong: true });
});
```

What to mock: the database and other outside services (use a test database or an in-memory fake behind a service function), the clock (pass `now` in, as the rate limiter and the token code do), and random ids. What not to mock: the framework itself. A test that fakes `req` and `res` for a whole route proves little.

> **Common mistake:** tests that rely on a fixed port (`listen(3000)`), shared global state, `setTimeout` sleeps to "wait for the server", or a server that is never closed so the test run never ends.

## Summary / Key takeaways
- A framework is a **middleware pipeline** plus helpers: `use()` stores functions, `next()` runs the next one, and the order you register them is the order they run.
- A middleware either **answers** or calls **`next()`**. After answering, `return`. Forgetting both makes the request hang; calling `next()` twice runs later layers again.
- Routes are middleware that check the method and a path pattern (`:id` becomes a regular expression). **First match wins.** `use` matches a path prefix and any method; `get` and friends match one method and the exact path. A `Router` is a middleware you mount at a prefix: the prefix is stripped from `req.url` inside it, while `req.baseUrl` and `req.originalUrl` keep the rest.
- Error handlers are found by **arity**: `fn.length === 4`. They are skipped without an error, must come last, and a three-parameter version silently fails.
- Express 5 forwards rejected promises from async handlers; Express 4 did not. Only the promise your handler **returns** is forwarded.
- Koa's `next()` returns a promise, so code after `await next()` runs after everything below it. That enables timing and one `try/catch` for errors. Express needs `res.on('finish')` or a patched `writeHead` for the same.
- Write validation, auth, rate limiting, CORS and error handling as small middleware: validate all input, verify credentials and attach `req.user`, use 401 versus 403 correctly, hide 5xx details.
- Test with real requests on **port 0**: build the app from a function, close the server every time, and unit-test single middleware with fake `req`, `res` and `next`.

## Quick check

1. How does Express know that a function is an error handler, and what goes wrong with a three-parameter version?
<details><summary>Answer</summary>

By its **arity**: `fn.length === 4`. A three-parameter function counts as a normal middleware. It is skipped while an error travels, so it never handles errors. For any request that reaches it, it is called as `(req, res, next)`, so its `err` is really `req` and `res.send` is not a function, which turns a normal request into a 500. Default parameters and rest parameters also change `fn.length`, so keep all four plain parameters.

</details>

2. What happens in Express if a middleware calls `next()` twice?
<details><summary>Answer</summary>

Nothing detects it. `next` shares one counter per request, so the second call does not repeat the layer that just ran; it continues from the counter and runs the next layer in line. If a handler already answered, that later layer usually fails with `ERR_HTTP_HEADERS_SENT` (or, with `res.end('text')`, an `ERR_STREAM_WRITE_AFTER_END` error event on the response). Koa's `compose` rejects with `next() called multiple times`.

</details>

3. A middleware neither calls `next()` nor ends the response. What does the client see, and what does the server do?
<details><summary>Answer</summary>

The request hangs. The client waits until its own timeout. Node's http server has no timeout for this by default (`server.timeout` is 0; `requestTimeout` only covers receiving the request), so the socket stays open. Fix it with client timeouts, a server-side timeout middleware, and tests. (In Koa the chain simply ends and the framework answers 404.)

</details>

4. Give two examples of middleware order mattering.
<details><summary>Answer</summary>

`express.json()` must come before the routes that read `req.body`, or `req.body` is `undefined`. The error handler and the 404 handler must come after the routes, or they never see those routes' errors or they shadow real routes. Others: auth before protected routes; CORS before rate limit and auth so that 401 and 429 answers carry CORS headers; request id first so everything can log it.

</details>

5. An `async` route handler throws after an `await`. What happens in Express 4 and in Express 5?
<details><summary>Answer</summary>

Express 4 ignores the returned promise: the rejection is unhandled (on Node 24 an unhandled rejection exits the process with code 1 unless you handle it) and the request is never answered, so you needed a wrapper or `express-async-errors`. Express 5 attaches a rejection handler to the returned promise and calls `next(error)`, so the error middleware answers.

</details>

6. A router is mounted with `app.use('/v1/users', router)`. For the request `GET /v1/users/7?full=1`, what are `req.url`, `req.baseUrl` and `req.originalUrl` inside a route of that router?
<details><summary>Answer</summary>

`req.url` is `/7?full=1` (the prefix is stripped), `req.baseUrl` is `/v1/users`, and `req.originalUrl` is `/v1/users/7?full=1`. `req.path` is `/7`.

</details>

7. Why can a Koa middleware measure the time of the whole request and set a header afterwards, while an Express middleware cannot?
<details><summary>Answer</summary>

In Koa `next()` returns a promise, so `await next()` waits for all later middleware. The middleware only sets `ctx.body`; the framework sends the response after the chain unwinds, so a header can still be added. In Express the handler sends the response itself, and `next()` returns before async work is done. Express code uses `res.on('finish')` for logging or patches `res.writeHead` (the `on-headers` idea) to add a header.

</details>

8. A POST handler in Express 5 sees `req.body === undefined`. Name three likely causes.
<details><summary>Answer</summary>

No `express.json()` in the app; `express.json()` registered after the route; the client sent a different `Content-Type` (or none), so the parser skipped the request. In Express 5 `req.body` stays `undefined` when no parser handled the request.

</details>

9. How do you test an HTTP app without a hard-coded port, and why build the app from a function?
<details><summary>Answer</summary>

Listen on port `0` so the operating system picks a free port, read `server.address().port`, call it with `fetch` (or `supertest`, which does it for you), and close the server in `finally`/`afterEach`. A `buildApp()` function gives every test a fresh app with empty state, so tests do not depend on each other and can run in parallel. Keep `app.js` (build) separate from `server.js` (listen).

</details>

10. Pick a framework for: (a) a small internal CRUD API, (b) a big team that wants enforced structure in TypeScript, (c) an API that must also run on Cloudflare Workers. Why?
<details><summary>Answer</summary>

(a) Express or Fastify: small, familiar; Fastify if you want built-in schema validation. (b) NestJS: modules, dependency injection and decorators give structure (it runs on Express or Fastify underneath). (c) Hono: built on web-standard `Request`/`Response`, so the same app runs on Workers, Node, Deno and Bun. Mention that the choice also depends on team experience and on what you must integrate with.

</details>

## Try it yourself

Save each solution as a file in the lesson folder `lessons/26-frameworks-and-middleware/` (next to this README, the name does not matter) and run it from the repo root with `node lessons/26-frameworks-and-middleware/<your-file>.js`. They load the finished mini framework with `require('./examples/_mini-express')`.

### Task 1 (easy): a method guard
Write `allowMethods(...methods)`, a middleware that lets only the listed HTTP methods through. For anything else it answers `405 Method Not Allowed` with an `Allow` header that lists the allowed methods. Use it on `app.all('/items', allowMethods('GET', 'POST'), handler)` and test GET, POST and DELETE.

<details><summary>Hint</summary>

Check `methods.includes(req.method)`. If the method is not allowed, set the header with `res.set('Allow', methods.join(', '))` and pass `httpError(405, ...)` to `next`. If it is allowed, call `next()`. Add an error handler at the end that turns `err.status` into the response.

</details>

<details><summary>Solution</summary>

```js
const { createApp, httpError } = require('./examples/_mini-express');
const { start, line } = require('./examples/_mini-express/testing');

// Let only the listed methods through. Anything else gets 405 and an Allow header.
function allowMethods(...allowed) {
  return (req, res, next) => {
    if (allowed.includes(req.method)) return next();
    res.set('Allow', allowed.join(', '));
    next(httpError(405, `Method ${req.method} is not allowed here`));
  };
}

async function main() {
  const app = createApp({ silent: true });
  app.all('/items', allowMethods('GET', 'POST'), (req, res) => res.json({ ok: req.method }));
  app.use((err, req, res, next) => {
    res.status(err.status ?? 500).json({ error: err.message });
  });

  const server = await start(app);
  for (const method of ['GET', 'POST', 'DELETE']) {
    const res = await server.request(method, '/items');
    const allow = res.headers.get('allow');
    console.log(method.padEnd(7), line(res) + (allow ? ` | Allow: ${allow}` : ''));
  }
  await server.close();
}

main();
```

Output:

```text
GET     200 {"ok":"GET"}
POST    200 {"ok":"POST"}
DELETE  405 {"error":"Method DELETE is not allowed here"} | Allow: GET, POST
```

`app.all` matches every method, so the guard decides. A middleware that is shared by many routes can be registered once with `app.use` instead.

</details>

### Task 2 (medium): a request timeout
Write `timeout(ms)`. If the handler has not answered after `ms` milliseconds, answer `503` with `{ "error": "Request timed out" }`. Clear the timer when the response finishes or the client disconnects. Test it with a fast route and a slow `async` route that sleeps 200 ms while the timeout is 50 ms. The slow handler must not crash when it wakes up late.

<details><summary>Hint</summary>

Start a `setTimeout` in the middleware, then call `next()`. In the timer callback answer only if `!res.headersSent`. Use `res.on('finish', stop)` and `res.on('close', stop)` with `clearTimeout`. In the slow handler check `res.writableEnded` before answering, because the timeout already did.

</details>

<details><summary>Solution</summary>

```js
const { createApp } = require('./examples/_mini-express');
const { start, line } = require('./examples/_mini-express/testing');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Answer 503 if the handler has not finished after "ms" milliseconds.
function timeout(ms) {
  return (req, res, next) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) res.status(503).json({ error: 'Request timed out' });
    }, ms);
    const stop = () => clearTimeout(timer); // the response finished, or the client left: no leaked timer
    res.on('finish', stop);
    res.on('close', stop);
    next();
  };
}

async function main() {
  const app = createApp({ silent: true });
  app.use(timeout(50));
  app.get('/fast', (req, res) => res.json({ speed: 'fast' }));
  app.get('/slow', async (req, res) => {
    await sleep(200);
    if (res.writableEnded) return; // the timeout already answered: do not answer twice
    res.json({ speed: 'slow' });
  });

  const server = await start(app);
  console.log('/fast', line(await server.get('/fast')));
  console.log('/slow', line(await server.get('/slow')));
  await sleep(250); // let the slow handler wake up and notice that it is too late
  console.log('/fast again', line(await server.get('/fast')));
  await server.close();
}

main();
```

Output:

```text
/fast 200 {"speed":"fast"}
/slow 503 {"error":"Request timed out"}
/fast again 200 {"speed":"fast"}
```

A timeout middleware cannot stop the handler (JavaScript cannot cancel a running `await`), it only stops the client from waiting. To really cancel work, pass an `AbortSignal` to your database or `fetch` calls and abort it in the timer.

</details>

### Task 3 (harder): idempotency keys
Mobile apps and payment clients retry requests, and a retried `POST` must not create a second order. The goal is to make it **idempotent**: doing it twice has the same effect as doing it once (lesson 12, section 9). Write `idempotency()` for `POST` routes: if the request has an `Idempotency-Key` header and the same key was already processed, **do not run the handler again**; replay the saved status and body and add `Idempotent-Replay: true`. If a request with the same key is still running, answer `409`. Requests without a key behave normally. If a request ends without a saved answer (an error), forget the key so a retry can work. Test with a handler that counts how many orders it created.

<details><summary>Hint</summary>

Keep a `Map` from key to `{ pending: true }` or `{ status, body }`. Wrap `res.json` (save the original, replace it with a function that stores `this.statusCode` and the body, then calls the original). Use `res.on('close')` to delete a key that is still pending. Put `idempotency()` before `json()` in the route's handler list; it only needs the header.

</details>

<details><summary>Solution</summary>

```js
const { createApp, json } = require('./examples/_mini-express');
const { start, line } = require('./examples/_mini-express/testing');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// POST requests that carry an Idempotency-Key are executed once. A repeat gets the saved answer.
function idempotency() {
  const saved = new Map(); // key -> { pending: true } | { status, body }
  return (req, res, next) => {
    const key = req.method === 'POST' ? req.headers['idempotency-key'] : undefined;
    if (!key) return next();

    const entry = saved.get(key);
    if (entry?.status) {
      res.set('Idempotent-Replay', 'true');
      return res.status(entry.status).json(entry.body); // replay, the handler does not run again
    }
    if (entry) return res.status(409).json({ error: 'A request with this key is still running' });

    saved.set(key, { pending: true });
    const originalJson = res.json;
    res.json = function capture(body) {
      saved.set(key, { status: this.statusCode, body }); // remember the first answer
      return originalJson.call(this, body);
    };
    // If the request ended without a saved answer (an error, or the client left), forget the key so a retry can work.
    res.on('close', () => {
      if (saved.get(key)?.pending) saved.delete(key);
    });
    next();
  };
}

async function main() {
  let created = 0;
  const app = createApp({ silent: true });
  app.post('/orders', idempotency(), json(), async (req, res) => {
    await sleep(50); // pretend to charge a card
    created++;
    res.status(201).json({ orderId: created, item: req.body.item });
  });

  const server = await start(app);
  const post = (key) => server.post('/orders', { json: { item: 'book' }, headers: key ? { 'idempotency-key': key } : {} });
  const show = (label, res) => console.log(label.padEnd(26), line(res) + (res.headers.get('idempotent-replay') ? ' | replay' : ''));

  show('first, key A', await post('A'));
  show('retry, key A', await post('A'));
  show('new key B', await post('B'));
  show('no key', await post());
  show('no key again', await post());
  // two requests with the same key at the same moment (sorted, because either one may arrive first)
  const both = (await Promise.all([post('C'), post('C')])).sort((a, b) => a.status - b.status);
  show('key C, the one that won', both[0]);
  show('key C, the one that lost', both[1]);
  console.log('orders really created:', created);
  await server.close();
}

main();
```

Output:

```text
first, key A               201 {"orderId":1,"item":"book"}
retry, key A               201 {"orderId":1,"item":"book"} | replay
new key B                  201 {"orderId":2,"item":"book"}
no key                     201 {"orderId":3,"item":"book"}
no key again               201 {"orderId":4,"item":"book"}
key C, the one that won    201 {"orderId":5,"item":"book"}
key C, the one that lost   409 {"error":"A request with this key is still running"}
orders really created: 5
```

Only one order was created for key `A` and for key `C`, although `A` was sent twice and `C` twice at the same moment. In a real system the store is shared (Redis or the database, with an expiry), the key is scoped to the user, and you compare the request body to detect a key reused for a different request.

</details>

## Where to go next
You have reached the end of the lessons. Now practise.
- **Interview rounds for this topic:**
  - [Round 1, screening](../../rounds/round-1-screening/questions.md): "what is middleware" and Express basics.
  - [Round 2, core](../../rounds/round-2-core/questions.md): error handlers, `next()` behaviour, Express 5 changes.
  - [Round 3, coding](../../rounds/round-3-coding/questions.md): write a router, a middleware chain, a rate limiter and `compose`.
  - [Round 4, advanced](../../rounds/round-4-advanced/questions.md): framework internals, validation and auth design.
  - [Round 5, system design](../../rounds/round-5-system-design/questions.md): API versioning, rate limiting at scale, idempotency, serverless trade-offs.
  - [Round 6, behavioral](../../rounds/round-6-behavioral/questions.md): how you choose and justify technology.
- **Port it to real Express.** Make a new folder, run `npm init -y` and `npm install express`, then rewrite your "Try it yourself" solutions: use `express()` instead of `createApp()`, `express.json()` instead of `json()`, and an error with a `status` property instead of `httpError(...)`. The Express 5 table in section 11.6 lists most of the differences you will hit.
- Read the mini framework in `examples/_mini-express/` once more, top to bottom (about 600 lines in total, including comments). If you can explain every line, you can answer most Express internals questions.
- Go back to the foundations behind this lesson: [12. HTTP and Networking](../12-http-and-networking/README.md), [14. Error Handling and Debugging](../14-error-handling-and-debugging/README.md), [16. Testing](../16-testing/README.md) and [20. Security and Crypto](../20-security-and-crypto/README.md).
- Run all the examples of this lesson at once: `node scripts/check-examples.js 26-frameworks-and-middleware --verbose`.
- For Express in depth, use the separate `express-interview-prep` folder next to this repository.
