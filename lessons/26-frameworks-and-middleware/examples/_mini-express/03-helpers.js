// Mini-express, stage 3: helpers on req and res (req.path, req.query, res.status, res.set, res.json, res.send).
// Helper module, not run by itself. Used by examples/03-helpers-and-query.js
//
// The trick (the same one Express uses): make two "prototype" objects that inherit from the
// Node classes, put the helper methods on them, and switch each request and response over to them
// with Object.setPrototypeOf. Nothing is copied per request, and all the normal Node methods
// (res.setHeader, res.end, req.on ...) keep working because the chain still ends in the Node classes.

const http = require('node:http');

// '/users/7?sort=asc' -> '/users/7'
function pathOf(url) {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
}

// '?a=1&d=3&d=4' -> { a: '1', d: ['3', '4'] }
// A null-prototype object is used on purpose: with a normal {} the key "toString" or
// "constructor" would already "exist" and break the "is this key repeated?" check.
function parseQuery(url) {
  const out = Object.create(null);
  const q = url.indexOf('?');
  if (q === -1) return out;
  for (const [key, value] of new URLSearchParams(url.slice(q + 1))) {
    out[key] = key in out ? [].concat(out[key], value) : value;
  }
  return out;
}

const request = Object.create(http.IncomingMessage.prototype);
Object.defineProperties(request, {
  path: {
    get() {
      return pathOf(this.url);
    },
  },
  query: {
    // A getter, so it is parsed on demand. Each read returns a fresh object.
    get() {
      return parseQuery(this.url);
    },
  },
});

const response = Object.create(http.ServerResponse.prototype);

response.status = function status(code) {
  if (!Number.isInteger(code) || code < 100 || code > 999) {
    throw new RangeError(`Invalid status code: ${code}`);
  }
  this.statusCode = code;
  return this; // so calls can be chained: res.status(404).json(...)
};

response.set = function set(name, value) {
  this.setHeader(name, value);
  return this;
};

response.json = function json(data) {
  const body = JSON.stringify(data) ?? ''; // JSON.stringify(undefined) is undefined
  if (!this.getHeader('Content-Type')) this.setHeader('Content-Type', 'application/json; charset=utf-8');
  this.setHeader('Content-Length', Buffer.byteLength(body)); // bytes, not characters
  this.end(body);
  return this;
};

response.send = function send(body) {
  if (body === undefined || body === null) {
    this.end();
    return this;
  }
  if (typeof body === 'string') {
    if (!this.getHeader('Content-Type')) this.setHeader('Content-Type', 'text/html; charset=utf-8');
  } else if (Buffer.isBuffer(body)) {
    if (!this.getHeader('Content-Type')) this.setHeader('Content-Type', 'application/octet-stream');
  } else {
    return this.json(body); // objects, arrays, numbers: send them as JSON
  }
  this.setHeader('Content-Length', Buffer.byteLength(body));
  this.end(body);
  return this;
};

// The middleware that installs the helpers. Put it first.
function init(req, res, next) {
  req.originalUrl = req.url; // later stages change req.url when a router is mounted, so remember the first one
  Object.setPrototypeOf(req, request);
  Object.setPrototypeOf(res, response);
  next();
}

module.exports = { init, request, response, parseQuery, pathOf };
