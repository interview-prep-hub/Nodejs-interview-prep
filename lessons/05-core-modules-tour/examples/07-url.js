// url: WHATWG URL and URLSearchParams, the old url.parse, and file URLs
// Run: node lessons/05-core-modules-tour/examples/07-url.js
const path = require('node:path');
const url = require('node:url');

console.log('--- the parts of a URL ---');
const u = new URL('https://ada:secret@example.com:8080/shop/items?color=red&size=m#reviews');
console.log('protocol:', u.protocol);
console.log('username:', u.username, '| password:', u.password);
console.log('host:', u.host, '| hostname:', u.hostname, '| port:', u.port);
console.log('origin:', u.origin);
console.log('pathname:', u.pathname);
console.log('search:', u.search);
console.log('hash:', u.hash);
console.log('default port is an empty string:', JSON.stringify(new URL('https://example.com').port));

console.log('--- searchParams: read and change the query string ---');
console.log('color =', u.searchParams.get('color'));
console.log('missing =', u.searchParams.get('missing')); // null, not undefined
u.searchParams.append('size', 'l');
u.searchParams.set('color', 'blue');
u.searchParams.delete('size');
console.log('after changes:', u.href);
console.log('number of params:', u.searchParams.size);

console.log('--- build a URL safely ---');
const api = new URL('/search', 'https://api.example.com'); // path + base
api.searchParams.set('q', 'node & npm');
api.searchParams.set('page', 2); // numbers are converted to strings
console.log(api.href);
console.log(new URL('../up', 'https://example.com/a/b/c').href);

console.log('--- relative links: a trailing slash changes the answer ---');
console.log(new URL('d', 'https://x.dev/a/b').href); // "b" counts as a file name, so d replaces it
console.log(new URL('d', 'https://x.dev/a/b/').href); // "b/" is a folder, so d goes inside it
console.log(new URL('/d', 'https://x.dev/a/b').href); // a leading slash starts at the site root

console.log('--- never trust a URL with startsWith ---');
function isOurSite(text) {
  try {
    return new URL(text).hostname === 'example.com'; // compare the parsed hostname
  } catch {
    return false;
  }
}
for (const text of ['https://example.com/ok', 'https://example.com.evil.net/login', 'https://example.com@evil.net/']) {
  console.log(`startsWith: ${text.startsWith('https://example.com')} | isOurSite: ${isOurSite(text)} | ${text}`);
}

console.log('--- bad input throws; canParse checks first ---');
try {
  new URL('not a url');
} catch (err) {
  console.log(err.name, err.code, '| input:', err.input);
}
console.log('canParse("https://x.dev"):', URL.canParse('https://x.dev'));
console.log('canParse("not a url"):', URL.canParse('not a url'));

console.log('--- URLSearchParams on its own ---');
const params = new URLSearchParams('tag=a&tag=b&sort=asc');
console.log('getAll:', params.getAll('tag'));
console.log('Object.fromEntries loses duplicates:', Object.fromEntries(params));
console.log('from an object:', new URLSearchParams({ q: 'a b', n: 1 }).toString()); // space becomes +
console.log('encodeURIComponent uses %20:', encodeURIComponent('a b'));

console.log('--- legacy url.parse: avoid it ---');
process.on('warning', (w) => console.log(`warning event -> ${w.code}`));
const legacy = url.parse('https://example.com/a?x=1&y=2#top');
console.log('query is a plain string:', legacy.query);
console.log('it never throws, even for garbage:', url.parse('not a url').pathname);

console.log('--- file URLs and paths ---');
const fileUrl = url.pathToFileURL(__filename);
console.log('protocol:', fileUrl.protocol);
console.log('starts with file:///', fileUrl.href.startsWith('file:///'));
console.log('round trip works:', url.fileURLToPath(fileUrl) === __filename);
const spaced = url.pathToFileURL(path.join(__dirname, 'my file.txt'));
console.log('spaces are escaped:', spaced.pathname.split('/').pop());
