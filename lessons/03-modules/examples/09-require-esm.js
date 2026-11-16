// CommonJS loading ES modules: require(esm), its limit (top-level await), and dynamic import()
// Run: node lessons/03-modules/examples/09-require-esm.js

console.log('require(esm) supported:', process.features.require_module);

// 1. require() can load an ES module (Node 22.12+ and 24, no flag, no warning).
//    You get the module namespace object: named exports plus `default`.
const shapes = require('./_lib/shapes.mjs');
console.log('1. keys:', Object.keys(shapes));
console.log('   circleArea(1) =', shapes.circleArea(1), '| describe =', shapes.default('shape'));

// 2. An ES module can choose what require() returns with the export name 'module.exports'.
const greet = require('./_lib/single-export.mjs');
console.log('2. require() returned a', typeof greet, '->', greet('Ada'));

// 3. The one thing that does not work: a graph that uses top-level await.
try {
  require('./_lib/tla.mjs');
} catch (error) {
  console.log('3.', error.code);
}

// 4. import() works from CommonJS for everything, including top-level await.
//    It returns a promise, so you use await inside an async function (or .then).
async function main() {
  const tla = await import('./_lib/tla.mjs');
  console.log('4. import() of the top-level await module ->', tla.value);

  const { default: cjsDefault } = await import('./_lib/literal-exports.js');
  console.log('5. import() of a CommonJS file ->', cjsDefault);
}

main();
