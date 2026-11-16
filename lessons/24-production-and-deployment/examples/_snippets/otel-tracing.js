// SNIPPET, not executed. Needs: npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http
// (package names and options change between releases: check the OpenTelemetry JavaScript documentation for the current ones)
//
// This file must run BEFORE your application code, because instrumentation works by patching modules
// such as http, express and pg at the moment they are loaded:
//
//   node --require ./otel-tracing.js dist/server.js
//
// In a container: ENV NODE_OPTIONS="--require /app/otel-tracing.js"
// (ES modules need a different hook, see the OpenTelemetry docs for your Node version.)
//
// The destination and the service name come from standard environment variables, so no code change per environment:
//   OTEL_SERVICE_NAME=orders-api
//   OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
//   OTEL_TRACES_SAMPLER=parentbased_traceidratio
//   OTEL_TRACES_SAMPLER_ARG=0.1          (keep 10 percent of new traces)
'use strict';
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(), // reads OTEL_EXPORTER_OTLP_ENDPOINT
  instrumentations: [getNodeAutoInstrumentations()], // http, express, pg, redis, fetch, ... without changing your code
});

sdk.start();

// Spans are sent in batches. Flush the last batch before the process ends, or the final seconds of traces are lost.
// 'beforeExit' fires when the event loop is empty, which is exactly how a graceful shutdown ends (example 05).
// It does NOT fire after process.exit(), another reason not to call process.exit() in a normal shutdown.
let flushed = false;
process.on('beforeExit', () => {
  if (flushed) return; // beforeExit fires again once the flush itself is done
  flushed = true;
  sdk.shutdown().catch(() => {});
});

// Your own spans, when the automatic ones are not enough:
//
//   const { trace, SpanStatusCode } = require('@opentelemetry/api');
//   const tracer = trace.getTracer('orders-api');
//   await tracer.startActiveSpan('charge card', async (span) => {
//     try {
//       await charge();
//     } catch (err) {
//       span.recordException(err);
//       span.setStatus({ code: SpanStatusCode.ERROR });
//       throw err;
//     } finally {
//       span.end();
//     }
//   });
