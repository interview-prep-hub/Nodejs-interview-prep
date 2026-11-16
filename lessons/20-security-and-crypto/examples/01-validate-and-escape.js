// Input validation (allow-lists, a tiny schema validator) and output escaping (escapeHtml, safe links, CSP)
// Run: node lessons/20-security-and-crypto/examples/01-validate-and-escape.js
//
// Rule 1: validate what comes IN (is this the shape I expect?).
// Rule 2: escape what goes OUT (turn data into text for the place it lands, here HTML).

// ---------- 1. Allow-list beats block-list ----------

// Allow-list: describe the ONLY thing that is accepted. Everything else is rejected.
function isValidUsername(value) {
  return typeof value === 'string' && /^[a-z0-9_]{3,20}$/.test(value);
}

console.log('--- 1. allow-list ---');
const usernames = ['alice_01', 'ab', '<script>', 'a'.repeat(50), { $ne: null }, ['alice'], 42, "bob'; DROP TABLE users;--"];
for (const u of usernames) {
  console.log(String(JSON.stringify(u)).slice(0, 34).padEnd(36), isValidUsername(u) ? 'accepted' : 'REJECTED');
}

// ---------- 2. A tiny schema validator (zod and Ajv do the same job with more features) ----------

const schema = {
  name: { type: 'string', min: 1, max: 50 },
  age: { type: 'integer', min: 0, max: 150 },
  role: { type: 'enum', values: ['user', 'editor'] },
  email: { type: 'string', max: 254, pattern: /^[^@\s]{1,64}@[^@\s]{1,189}$/ },
};

function validate(input, rules) {
  const errors = [];
  const value = {};
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['body must be an object'] };
  }
  // Unknown keys are an error: this blocks "mass assignment" (a client sending isAdmin: true).
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(rules, key)) errors.push(`${key}: not allowed`);
  }
  for (const [key, rule] of Object.entries(rules)) {
    const v = input[key];
    if (rule.type === 'string') {
      if (typeof v !== 'string') errors.push(`${key}: must be a string`);
      else if (v.length < (rule.min ?? 0) || v.length > rule.max) errors.push(`${key}: length must be ${rule.min ?? 0}-${rule.max}`);
      else if (rule.pattern && !rule.pattern.test(v)) errors.push(`${key}: wrong format`);
      else value[key] = v;
    } else if (rule.type === 'integer') {
      if (!Number.isInteger(v)) errors.push(`${key}: must be an integer`);
      else if (v < rule.min || v > rule.max) errors.push(`${key}: must be ${rule.min}-${rule.max}`);
      else value[key] = v;
    } else if (rule.type === 'enum') {
      if (!rule.values.includes(v)) errors.push(`${key}: must be one of ${rule.values.join(', ')}`);
      else value[key] = v;
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

console.log('\n--- 2. schema validation ---');
const good = { name: 'Ann', age: 31, role: 'user', email: 'ann@example.com' };
const bad = { name: '', age: '31', role: 'admin', email: 'nope', isAdmin: true };
console.log('good:', JSON.stringify(validate(good, schema)));
console.log('bad :', JSON.stringify(validate(bad, schema).errors));

// ---------- 3. Output escaping: XSS ----------

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

console.log('\n--- 3. escapeHtml ---');
const comment = '<img src=x onerror="alert(1)">';
console.log('unsafe page:', `<p>${comment}</p>`);
console.log('safe page  :', `<p>${escapeHtml(comment)}</p>`);

// Escaping for HTML text is not enough inside an attribute if you forget the quotes.
const attack = '" onmouseover="alert(1)';
console.log('attribute, escaped :', `<input value="${escapeHtml(attack)}">`);
console.log('attribute, NOT     :', `<input value="${attack}">`);

// ---------- 4. URLs are a different context: block javascript: links ----------

function safeHref(input) {
  try {
    const url = new URL(input, 'https://app.example.com/');
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : '#';
  } catch {
    return '#';
  }
}

console.log('\n--- 4. links ---');
for (const link of ['/profile', 'https://example.com/a?b=1', 'javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,<b>x</b>']) {
  console.log(JSON.stringify(link).padEnd(32), '->', safeHref(link));
}

// ---------- 5. Putting JSON inside a <script> tag ----------

function jsonForScript(value) {
  // "</script>" inside a string would end the script block early, so write every "<" as \u003c.
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

console.log('\n--- 5. JSON in a script tag ---');
const profile = { bio: '</script><script>alert(1)</script>' };
console.log('plain  :', `<script>const profile = ${JSON.stringify(profile)};</script>`);
console.log('escaped:', `<script>const profile = ${jsonForScript(profile)};</script>`);

// ---------- 6. Content-Security-Policy: the second wall ----------

const csp = [
  "default-src 'self'", // everything must come from our own origin by default
  "script-src 'self'", // no inline scripts, no other hosts: injected <script> tags do not run
  "object-src 'none'", // no plugins
  "base-uri 'self'", // an injected <base> tag cannot redirect relative URLs
  "frame-ancestors 'none'", // nobody may put this page in a frame (clickjacking)
  "form-action 'self'", // forms may only post back to us
].join('; ');

console.log('\n--- 6. CSP header ---');
console.log('Content-Security-Policy:', csp);
