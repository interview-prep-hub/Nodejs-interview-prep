// Helper (not run by itself): waits N milliseconds (default 5000), then prints "woke up".
// Used by 05-exec-execfile.js and 06-spawn-stdio.js to show timeouts and kill().
// Run: node lessons/15-processes-and-cli/examples/_helpers/sleepy.js 100

const ms = Number(process.argv[2] ?? 5000);
setTimeout(() => console.log('woke up'), ms);
