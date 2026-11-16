// Helper, not run by itself: a serverless function module in the shape AWS Lambda expects.
// It is loaded by examples/12-lambda-shape.js, which pretends to be the Lambda runtime.
'use strict';

// ---------------------------------------------------------------------------------------------
// INIT PHASE. This code runs once per container, on a cold start, before the first request.
// Put expensive, reusable setup here: clients, connections, parsed config, big lookup tables.
// ---------------------------------------------------------------------------------------------
const state = { connectionsCreated: 0, invocations: 0 };

function connectToDatabase() {
  state.connectionsCreated++; // in real life: a TCP connection and a login, tens of milliseconds
  return { query: async (sql) => ({ rows: [{ sql }] }) };
}

const db = connectToDatabase(); // created once, shared by every invocation in this container

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

// ---------------------------------------------------------------------------------------------
// The HANDLER. It runs once per request. `event` describes the request, `context` describes the invocation.
// This event shape is the one API Gateway HTTP APIs send (payload format 2.0).
// ---------------------------------------------------------------------------------------------
exports.handler = async (event, context) => {
  state.invocations++;
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';

  if (path === '/slow') {
    await new Promise((resolve) => setTimeout(resolve, 500)); // longer than the timeout used in the demo
    return json(200, { done: true });
  }
  if (method === 'POST') {
    // Binary or odd bodies arrive base64 encoded and are marked with isBase64Encoded.
    const text = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    const data = JSON.parse(text); // a bad body throws, and the platform turns it into a 500
    const result = await db.query(`insert ${data.item}`);
    return json(201, { saved: data.item, rows: result.rows.length });
  }
  return json(200, { path, invocationInThisContainer: state.invocations, msLeft: context.getRemainingTimeInMillis() > 0 });
};

exports.stats = () => ({ ...state });
