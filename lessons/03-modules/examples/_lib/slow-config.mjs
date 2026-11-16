// A module that uses top-level await. Anyone who imports it waits until it finishes.
console.log('  [slow-config.mjs] start, pretending to load config for 50 ms');

async function loadConfig() {
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { region: 'eu', retries: 3 };
}

export const config = await loadConfig();

console.log('  [slow-config.mjs] finished');
