// Small helper used by examples 04 and 10: build a folder tree from an object.
//   writeTree('/some/dir', { 'a/b.txt': 'hello' })  creates /some/dir/a/b.txt
const fs = require('node:fs');
const path = require('node:path');

function writeTree(root, files) {
  for (const [relative, text] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

module.exports = { writeTree };
