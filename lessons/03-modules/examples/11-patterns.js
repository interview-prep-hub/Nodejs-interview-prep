// Module patterns: singleton through the cache, barrel files, dependency injection
// Run: node lessons/03-modules/examples/11-patterns.js

const makeUserService = require('./_patterns/make-user-service.js');
const hardwired = require('./_patterns/hardwired-user-service.js');

async function main() {
  console.log('--- 1. singleton: the cache hands out one shared object');
  const logger = require('./_patterns/logger.js');
  const sameFileOtherPath = require('./_patterns/shapes/../logger.js'); // a different string, the same file
  logger.log('written through the first name');
  console.log('same object?', logger === sameFileOtherPath);
  console.log('second name sees:', sameFileOtherPath.lines);

  console.log('--- 2. barrel file (CommonJS): a folder resolves to its index.js');
  const shapes = require('./_patterns/shapes'); // loads circle.js AND square.js
  console.log('keys:', Object.keys(shapes), '| circleArea(2) =', shapes.circleArea(2));

  console.log('--- 3. barrel file (ES module): export * from ...');
  const esmShapes = await import('./_patterns/shapes/index.mjs');
  console.log('keys:', Object.keys(esmShapes), '| squareArea(4) =', esmShapes.squareArea(4));

  console.log('--- 4. hard-wired dependency: the module reaches for the real database');
  try {
    await hardwired.getName(1);
  } catch (error) {
    console.log('hard-wired getName(1) failed:', error.message);
  }

  console.log('--- 5. dependency injection: the caller supplies a fake database');
  const fakeDb = { findUser: async (id) => (id === 1 ? { name: 'Ada' } : null) };
  const service = makeUserService({ db: fakeDb, logger });
  console.log('getName(1):', await service.getName(1));
  console.log('getName(2):', await service.getName(2));
  console.log('logger now holds:', logger.lines);
}

main();
