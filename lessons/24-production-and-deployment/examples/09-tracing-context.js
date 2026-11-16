// Distributed tracing by hand: trace ids, span ids, the W3C traceparent header, and context propagation between two services
// Run: node lessons/24-production-and-deployment/examples/09-tracing-context.js
//
// This is the idea behind OpenTelemetry in about 100 lines. In a real project you install the OpenTelemetry SDK instead.
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');
const { inspect } = require('node:util');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------
// 1. Ids and the traceparent header (the W3C Trace Context standard)
//    traceparent: 00-<trace id: 32 hex>-<parent span id: 16 hex>-<flags: 2 hex, 01 = sampled>
// ---------------------------------------------------------------------------------------------
const newTraceId = () => crypto.randomBytes(16).toString('hex');
const newSpanId = () => crypto.randomBytes(8).toString('hex');

function formatTraceparent({ traceId, spanId, sampled }) {
  return `00-${traceId}-${spanId}-${sampled ? '01' : '00'}`;
}

function parseTraceparent(header) {
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(header ?? '');
  if (!match || /^0+$/.test(match[1]) || /^0+$/.test(match[2])) return null; // missing or invalid: start a new trace
  return { traceId: match[1], parentSpanId: match[2], sampled: (parseInt(match[3], 16) & 1) === 1 };
}

// ---------------------------------------------------------------------------------------------
// 2. A tiny tracer. The "current span" lives in AsyncLocalStorage, like the correlation id did.
// ---------------------------------------------------------------------------------------------
const exported = []; // a real exporter sends spans to a collector; we keep them in memory

function makeTracer(service) {
  const current = new AsyncLocalStorage();

  // Runs fn inside a new span. The parent is the span we are already in, or a remote parent from a header.
  async function withSpan(name, { kind = 'internal', remote = null, attributes = {} } = {}, fn) {
    const parent = current.getStore();
    const span = {
      service,
      name,
      kind,
      attributes,
      traceId: remote?.traceId ?? parent?.traceId ?? newTraceId(),
      parentSpanId: remote?.parentSpanId ?? parent?.spanId ?? null,
      sampled: remote?.sampled ?? parent?.sampled ?? true,
      spanId: newSpanId(),
      status: 'ok',
      start: performance.now(),
    };
    try {
      return await current.run(span, () => fn(span));
    } catch (err) {
      span.status = 'error';
      throw err;
    } finally {
      span.end = performance.now();
      if (span.sampled) exported.push(span); // a span that is not sampled costs almost nothing and is dropped
    }
  }

  // Adds the traceparent header for the span we are in. Call this right before every outgoing request.
  function inject(headers) {
    const span = current.getStore();
    if (span) headers.traceparent = formatTraceparent(span);
    return headers;
  }

  return { withSpan, inject };
}

// ---------------------------------------------------------------------------------------------
// 3. Two services. "shop" calls "catalog" over HTTP. Neither shares memory with the other.
// ---------------------------------------------------------------------------------------------
async function startCatalog() {
  const tracer = makeTracer('catalog');
  const server = http.createServer(async (req, res) => {
    const remote = parseTraceparent(req.headers.traceparent); // continue the caller's trace
    await tracer.withSpan('GET /products/:id', { kind: 'server', remote }, async (span) => {
      const id = req.url.split('/').pop();
      span.attributes['product.id'] = id;
      await tracer.withSpan('db.query', { attributes: { 'db.system': 'postgres' } }, () => sleep(15));
      res.statusCode = id === '0' ? 404 : 200;
      res.end(JSON.stringify({ id }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function startShop(catalogUrl) {
  const tracer = makeTracer('shop');

  function getProduct(id) {
    return tracer.withSpan('HTTP GET catalog', { kind: 'client', attributes: { 'product.id': id } }, async () => {
      const reply = await fetch(`${catalogUrl}/products/${id}`, { headers: tracer.inject({}) }); // the header carries THIS span's id
      if (!reply.ok) throw new Error(`catalog answered ${reply.status}`);
      return reply.json();
    });
  }

  const server = http.createServer(async (req, res) => {
    const remote = parseTraceparent(req.headers.traceparent);
    await tracer.withSpan('GET /checkout', { kind: 'server', remote }, async () => {
      await tracer.withSpan('validate cart', {}, () => sleep(3));
      await Promise.all([getProduct('1'), getProduct('2')]); // two calls at the same time
      await getProduct('0').catch(() => {}); // this one fails, the checkout survives
      res.end('done');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

// Prints the spans of one trace as a tree.
function printTree(traceId) {
  const spans = exported.filter((s) => s.traceId === traceId).sort((a, b) => a.start - b.start);
  const children = (parentId) => spans.filter((s) => s.parentSpanId === parentId);
  const known = new Set(spans.map((s) => s.spanId));
  const roots = spans.filter((s) => !known.has(s.parentSpanId));
  const walk = (span, depth) => {
    const attrs = Object.entries(span.attributes).map(([k, v]) => `${k}=${v}`).join(' ');
    console.log(`   ${'  '.repeat(depth)}${span.service}: ${span.name} [${span.kind}]${span.status === 'error' ? ' ERROR' : ''}${attrs ? '  ' + attrs : ''}`);
    children(span.spanId).forEach((child) => walk(child, depth + 1));
  };
  roots.forEach((root) => walk(root, 0));
}

async function main() {
  console.log('1. The header');
  const example = { traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7', sampled: true };
  const header = formatTraceparent(example);
  console.log('   traceparent:', header);
  console.log('   parsed     :', inspect(parseTraceparent(header), { breakLength: Infinity }));
  console.log('   garbage    :', parseTraceparent('hello'));

  const catalog = await startCatalog();
  const shop = await startShop(catalog.url);

  console.log('2. One checkout request. Eleven spans in two services, all in the same trace:');
  const reply = await fetch(shop.url + '/checkout');
  await reply.text();
  const traceId = exported[0].traceId;
  printTree(traceId);
  console.log('   spans in this trace   :', exported.length);
  console.log('   same trace id on all  :', exported.every((s) => s.traceId === traceId));
  console.log('   failed spans          :', exported.filter((s) => s.status === 'error').map((s) => `${s.service}: ${s.name}`));
  const dbSpan = exported.find((s) => s.name === 'db.query');
  console.log('   db.query lasted >= 14 ms:', dbSpan.end - dbSpan.start >= 14);

  console.log('3. A caller (a browser, another team\'s service) already started a trace: we continue it');
  exported.length = 0;
  const upstream = await fetch(shop.url + '/checkout', { headers: { traceparent: header } });
  await upstream.text();
  const root = exported.find((s) => s.name === 'GET /checkout');
  console.log('   our root span uses the caller\'s trace id:', root.traceId === example.traceId);
  console.log('   our root span\'s parent is the caller\'s span:', root.parentSpanId === example.spanId);

  console.log('4. Sampling: the first service decides, everybody else obeys the flag');
  exported.length = 0;
  const unsampled = await fetch(shop.url + '/checkout', { headers: { traceparent: formatTraceparent({ ...example, sampled: false }) } });
  await unsampled.text();
  console.log('   spans recorded when the flag is 00:', exported.length);

  shop.server.close();
  catalog.server.close();
  await Promise.all([once(shop.server, 'close'), once(catalog.server, 'close')]);
}

main();
