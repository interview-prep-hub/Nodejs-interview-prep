// Code under test for lesson 16: functions that read and write files.

const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULTS = { port: 3000, debug: false };

// Read a JSON config file. A missing file is fine (use the defaults). Anything else is an error.
async function loadConfig(file) {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { ...DEFAULTS };
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid JSON in ${path.basename(file)}: ${error.message}`);
  }
  return { ...DEFAULTS, ...parsed };
}

// Write a config file, creating the folder first if needed.
async function saveConfig(file, config) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(config, null, 2));
}

module.exports = { loadConfig, saveConfig, DEFAULTS };
