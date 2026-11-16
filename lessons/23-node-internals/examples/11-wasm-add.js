// WebAssembly in Node: a hand-assembled module with an exported add(), and one that calls back into JavaScript
// Shows: the binary format section by section, validate/compile/instantiate, i32 wrap-around, and imports.
// Run: node lessons/23-node-internals/examples/11-wasm-add.js

// ---- Module 1: the same as this WebAssembly text -----------------------------------------------------
//   (module
//     (func (export "add") (param i32 i32) (result i32)
//       local.get 0
//       local.get 1
//       i32.add))
// A .wasm file is: 8 header bytes, then sections. Each section is: id, byte length, content.
const addBytes = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, // magic number: "\0asm"
  0x01, 0x00, 0x00, 0x00, // format version 1

  0x01, 0x07, // section 1 (types), 7 bytes long
  0x01, //   one type
  0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f, //   func type: 2 params (i32, i32), 1 result (i32)

  0x03, 0x02, // section 3 (functions), 2 bytes long
  0x01, 0x00, //   one function, and it uses type number 0

  0x07, 0x07, // section 7 (exports), 7 bytes long
  0x01, //   one export
  0x03, 0x61, 0x64, 0x64, //   its name: length 3, "add"
  0x00, 0x00, //   kind 0 = function, function number 0

  0x0a, 0x09, // section 10 (code), 9 bytes long
  0x01, //   one function body
  0x07, 0x00, //   body is 7 bytes, 0 local variable groups
  0x20, 0x00, //   local.get 0
  0x20, 0x01, //   local.get 1
  0x6a, //   i32.add
  0x0b, //   end
]);

console.log('Module 1: add');
console.log('  WebAssembly.validate(bytes):', WebAssembly.validate(addBytes));
const addModule = new WebAssembly.Module(addBytes); // compile (this module is tiny; real ones can take a while)
console.log('  exports:', JSON.stringify(WebAssembly.Module.exports(addModule)), ' imports:', JSON.stringify(WebAssembly.Module.imports(addModule)));
const { add } = new WebAssembly.Instance(addModule).exports; // instantiate: create memory, tables, link imports
console.log('  add(2, 3)              =', add(2, 3));
console.log('  add(2147483647, 1)     =', add(2147483647, 1), '(i32 wraps around, there is no overflow error)');
console.log('  add(2.9, 3.9)          =', add(2.9, 3.9), '(JS numbers are converted to i32 first)');

// ---- Module 2: wasm that calls a JavaScript function -------------------------------------------------
//   (module
//     (import "env" "log" (func $log (param i32)))
//     (func (export "run") (call $log (i32.const 42))))
const importBytes = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x08, 0x02, 0x60, 0x01, 0x7f, 0x00, 0x60, 0x00, 0x00, // types: (i32) -> () and () -> ()
  0x02, 0x0b, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x03, 0x6c, 0x6f, 0x67, 0x00, 0x00, // import env.log, a function of type 0
  0x03, 0x02, 0x01, 0x01, // one function of type 1
  0x07, 0x07, 0x01, 0x03, 0x72, 0x75, 0x6e, 0x00, 0x01, // export "run" = function number 1 (number 0 is the import)
  0x0a, 0x08, 0x01, 0x06, 0x00, 0x41, 0x2a, 0x10, 0x00, 0x0b, // body: i32.const 42, call 0, end
]);

(async () => {
  console.log('\nModule 2: calls back into JavaScript');
  const received = [];
  const imports = { env: { log: (n) => received.push(n) } };
  // The async form compiles in the background. It is the one to use for big modules.
  const { instance } = await WebAssembly.instantiate(importBytes, imports);
  instance.exports.run();
  console.log('  JavaScript received from wasm:', received);

  try {
    await WebAssembly.instantiate(importBytes, {}); // forgot to provide env.log
  } catch (err) {
    console.log('  missing import ->', err.name + ':', err.message);
  }

  console.log('\nWebAssembly.validate(three random bytes):', WebAssembly.validate(new Uint8Array([1, 2, 3])));
})();
