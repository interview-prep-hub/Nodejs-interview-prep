// The finished mini-express: everything from stages 1 to 7 in one import.
// Helper module, not run by itself.
//
//   const { createApp, Router, json, httpError } = require('./_mini-express');
//
// It is stage 7 (routing, errors, async handlers, routers) with the req/res helpers from stage 3
// installed automatically and the JSON parser from stage 5 available as json().

const { createApp: createBaseApp, Router } = require('./07-router');
const { init } = require('./03-helpers');
const { json } = require('./05-json');
const { httpError } = require('./04-errors');

function createApp(options) {
  const app = createBaseApp(options);
  app.use(init); // req.query, res.json() and friends are available in every handler
  return app;
}

module.exports = { createApp, Router, json, httpError };
