// Helper (not run by itself): prints the environment variables named on the command line as one JSON line.
// Used by 02-env-and-env-files.js, which starts it with different --env-file flags.
// Run: node lessons/15-processes-and-cli/examples/_helpers/print-env.js PATH_OR_ANY_NAME

const names = process.argv.slice(2);
const result = {};
for (const name of names) {
  // A variable that is not set is reported as null (JSON has no "undefined").
  result[name] = process.env[name] ?? null;
}
console.log(JSON.stringify(result));
