// Helper (not run by itself): reads ALL of stdin as one string, then reports the size.
// Used by 08-stdin-readline.js.
// Run: node lessons/15-processes-and-cli/examples/_helpers/stdin-all.js   (type text, finish with Ctrl+Z then Enter on Windows or Ctrl+D elsewhere)

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk); // chunks are Buffers
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const text = await readAll(process.stdin);
  const words = text.split(/\s+/).filter(Boolean);
  console.log(`read ${text.length} characters and ${words.length} words`);
}

main();
