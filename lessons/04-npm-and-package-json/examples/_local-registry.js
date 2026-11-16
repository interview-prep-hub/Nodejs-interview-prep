// Helper (not run by itself): a tiny npm registry on localhost, so real npm commands work offline.
// It answers the requests npm needs: "tell me about package X", "give me the tarball" and,
// if you pass advisories, "does any of these versions have a known vulnerability?" (npm audit).
'use strict';

const http = require('node:http');
const zlib = require('node:zlib');
const { makeTarball, integrityOf, shasumOf } = require('./_tarball.js');
const { compare } = require('./02-semver-versions.js');
const { satisfies } = require('./03-semver-ranges.js');

// packages:   { name: { version: { ...package.json fields, _files: { 'extra.js': '...' } } } }
// advisories: { name: [{ id, url, title, severity, vulnerable_versions }] }
function startRegistry(packages, advisories = {}) {
  const tarballs = new Map(); // "name@version" -> Buffer
  const packuments = new Map(); // name -> the JSON npm reads (called a "packument")
  const requests = [];
  let base = '';

  const build = () => {
    for (const [name, versions] of Object.entries(packages)) {
      const doc = { name, 'dist-tags': {}, versions: {}, time: {} };
      for (const [version, entry] of Object.entries(versions)) {
        // "_files" holds extra files for the tarball. Everything else is package.json content.
        const { _files = {}, ...fields } = entry;
        const manifest = { name, version, main: 'index.js', ...fields };
        const files = {
          'package.json': JSON.stringify(manifest, null, 2),
          'index.js': `module.exports = { name: '${name}', version: '${version}' };\n`,
          ..._files,
        };
        const modes = {};
        for (const file of Object.values(typeof fields.bin === 'string' ? { x: fields.bin } : fields.bin || {})) {
          modes[file.replace(/^\.\//, '')] = 0o755;
        }
        const tgz = makeTarball(files, modes);
        tarballs.set(`${name}@${version}`, tgz);
        doc.versions[version] = {
          ...manifest,
          dist: { tarball: `${base}/-/${name}-${version}.tgz`, integrity: integrityOf(tgz), shasum: shasumOf(tgz) },
        };
        doc.time[version] = '2024-01-01T00:00:00.000Z';
      }
      const stable = Object.keys(versions).filter((v) => !v.includes('-')).sort(compare);
      doc['dist-tags'].latest = stable[stable.length - 1];
      packuments.set(name, doc);
    }
  };

  // npm audit sends { "name": ["1.0.0", ...] } and expects { "name": [advisory, ...] } back.
  const audit = (body, res) => {
    const asked = JSON.parse(body || '{}');
    const found = {};
    for (const [name, versions] of Object.entries(asked)) {
      const hits = (advisories[name] || []).filter((a) => versions.some((v) => satisfies(v, a.vulnerable_versions)));
      if (hits.length) found[name] = hits;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(found));
  };

  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (req.method === 'POST' && url === '/-/npm/v1/security/advisories/bulk') {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      // The request body may be gzip-compressed.
      return req.on('end', () => {
        const raw = Buffer.concat(chunks);
        const text = req.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(raw).toString() : raw.toString();
        audit(text, res);
      });
    }
    const tarball = /^\/-\/(.+)-(\d[^/]*)\.tgz$/.exec(url);
    if (req.method === 'GET' && tarball) {
      const data = tarballs.get(`${tarball[1]}@${tarball[2]}`);
      if (data) {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': data.length });
        return res.end(data);
      }
    }
    const doc = req.method === 'GET' && packuments.get(url.slice(1));
    if (doc) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(doc));
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${server.address().port}`;
      build();
      resolve({
        url: base + '/',
        requests,
        tarballs,
        close: () => new Promise((done) => {
          server.close(done);
          server.closeAllConnections();
        }),
      });
    });
  });
}

module.exports = { startRegistry };
