// Helper used by example 06 (not run by itself): a small program with an obvious hot spot.
// Example 06 runs this file in a child process with the CPU profiler switched on.
function isPrime(n) {
  if (n < 2) return false;
  for (let i = 2; i * i <= n; i++) {
    if (n % i === 0) return false;
  }
  return true;
}

function countPrimes(limit) {
  let count = 0;
  for (let n = 0; n < limit; n++) {
    if (isPrime(n)) count++;
  }
  return count;
}

function makeIds(count) {
  const ids = [];
  for (let i = 0; i < count; i++) ids.push('id-' + i);
  return ids;
}

function checksum(list) {
  let hash = 0;
  for (const text of list) {
    for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return hash;
}

function main() {
  console.log('primes below 800000:', countPrimes(800_000));
  console.log('checksum of 150000 ids:', checksum(makeIds(150_000)));
}

main();
