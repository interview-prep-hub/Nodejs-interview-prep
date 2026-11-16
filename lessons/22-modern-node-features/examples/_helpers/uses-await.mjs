// Helper for 09-require-esm.js: an ES module with top-level await. require() cannot load this one.
await Promise.resolve();
export const ready = true;
