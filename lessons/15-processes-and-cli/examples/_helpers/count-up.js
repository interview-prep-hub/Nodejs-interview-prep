// Helper (not run by itself): prints "tick 1", "tick 2", ... one line every N ms, then stops.
// Arguments: how many lines (default 3), delay in ms (default 30).
// Used by 06-spawn-stdio.js to show output arriving in pieces.
// Run: node lessons/15-processes-and-cli/examples/_helpers/count-up.js 3 30

const total = Number(process.argv[2] ?? 3);
const delay = Number(process.argv[3] ?? 30);
let i = 0;

const timer = setInterval(() => {
  i++;
  console.log(`tick ${i}`);
  if (i >= total) clearInterval(timer);
}, delay);
