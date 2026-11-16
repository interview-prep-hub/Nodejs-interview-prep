// Helper (not run by itself): writes N characters to stdout (default 5000) and nothing else.
// Used by 05-exec-execfile.js to show the maxBuffer limit.
// Run: node lessons/15-processes-and-cli/examples/_helpers/noisy.js 20

const count = Number(process.argv[2] ?? 5000);
process.stdout.write('x'.repeat(count));
