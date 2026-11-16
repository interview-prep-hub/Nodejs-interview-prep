// Helper (not run by itself): prints a greeting for the first argument.
// Used by 05-exec-execfile.js to show what a shell does to an argument.
// Run: node lessons/15-processes-and-cli/examples/_helpers/greet.js Ada

console.log(`hello ${process.argv[2]}`);
