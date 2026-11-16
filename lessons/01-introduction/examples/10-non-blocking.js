// One thread, non-blocking I/O: waiting is cheap because Node does not stand still and wait
// Run: node lessons/01-introduction/examples/10-non-blocking.js

const fs = require('node:fs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  // Part 1: three waits of 100 ms each.
  // One after the other they need about 300 ms. Started together they overlap.
  let start = Date.now();
  await sleep(100);
  await sleep(100);
  await sleep(100);
  const oneByOne = Date.now() - start;

  start = Date.now();
  await Promise.all([sleep(100), sleep(100), sleep(100)]);
  const together = Date.now() - start;

  console.log('1. started together was faster than one by one:', together < oneByOne);
  console.log('   one by one took at least 280 ms            :', oneByOne >= 280);
  console.log('   together took under 70% of one by one      :', together < oneByOne * 0.7);

  // Part 2: the non-blocking way to read a file. We hand over a callback and keep going.
  await new Promise((resolve) => {
    console.log('\n2. asking the system to read this file...');
    fs.readFile(__filename, 'utf8', (err, text) => {
      console.log('4. the file is ready, it has more than 10 lines:', text.split('\n').length > 10);
      resolve();
    });
    console.log('3. readFile was called and we did NOT wait for it');
  });

  // Part 3: the blocking way. Nothing else can run until readFileSync returns.
  console.log('\n5. now the blocking version...');
  const text = fs.readFileSync(__filename, 'utf8');
  console.log('6. readFileSync returned, and only then this line ran:', text.length > 0);
}

main();
