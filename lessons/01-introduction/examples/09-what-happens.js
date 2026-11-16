// What happens when you run "node file.js": the wrapper function, the main script, then the event loop
// Run: node lessons/01-introduction/examples/09-what-happens.js

console.log('1. main script starts');

// Step A: Node runs your file as the body of a function with FIVE parameters.
// Inside a CommonJS file, "arguments" is the list the wrapper function received.
const names = ['exports', 'require', 'module', '__filename', '__dirname'];
console.log('\nThe wrapper function received', arguments.length, 'arguments:');
Array.from(arguments).forEach((value, i) => {
  console.log(`   ${names[i].padEnd(10)} has type ${typeof value}`);
});
console.log('this === module.exports      :', this === module.exports);
console.log('require.main === module      :', require.main === module, '(true only for the entry file)');
console.log('module.id of the entry file  :', module.id);
console.log();

// Step B: schedule work for later. Nothing below runs yet.
setTimeout(() => console.log('4. timer callback (the event loop picks it up)'), 0);
Promise.resolve().then(() => console.log('3. promise callback (right after the main script)'));
process.on('beforeExit', () => console.log('5. beforeExit (the loop has nothing left to do)'));
process.on('exit', (code) => console.log('6. exit event, code', code));

// Step C: the main script reaches its last line.
console.log('2. main script ends (all synchronous code is done)');
