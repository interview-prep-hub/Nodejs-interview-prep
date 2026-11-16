# 20. Security and the crypto Module

> Level: Advanced   Time: about 240 minutes   Node: 24 (notes where older versions differ)

[Previous: 19. Performance, Profiling and Memory](../19-performance-and-memory/README.md) | [All lessons](../../README.md) | [Next: 21. TypeScript with Node.js](../21-typescript-with-node/README.md)

## What you will learn
- How to think like an attacker (assets, entry points, trust boundaries) and how the OWASP Top 10 maps to a Node.js app.
- How to stop the classic bugs: bad input, XSS, SQL/NoSQL/command/template injection, path traversal, prototype pollution, ReDoS, SSRF and denial of service.
- What security headers, CORS, cookie flags and CSRF protection do, and what `helmet` sets for you.
- A full tour of `node:crypto`: hashes, HMAC, random values, AES-256-GCM, key pairs and signatures, key agreement, key derivation (`pbkdf2`, `hkdf`), WebCrypto, and why you never invent your own crypto.
- How to store passwords (salt, `scrypt`, argon2), compare secrets in constant time, and slow down brute force.
- Sessions versus JWT, a JWT built by hand, the JWT attacks interviewers love, OAuth 2.0 and OpenID Connect with PKCE, and RBAC versus ABAC.
- Secrets management, safe logging, supply chain safety for npm, the Node permission model, running as a non-root user.
- A security checklist you can reuse on every project.

All examples run from the repo root with plain `node` and need no npm packages. Every attack is local and harmless. Third-party libraries (`zod`, `ajv`, `helmet`, `bcrypt`, `jsonwebtoken` and so on) appear only as labelled snippets.

The example files live in `lessons/20-security-and-crypto/examples/`:

| File | What it shows | Section |
|---|---|---|
| [01-validate-and-escape.js](examples/01-validate-and-escape.js) | Allow-lists, a tiny schema validator, `escapeHtml`, safe links, CSP | 3, 4 |
| [02-injection.js](examples/02-injection.js) | SQL, NoSQL, template and command injection, each with the fix | 5 |
| [03-path-traversal.js](examples/03-path-traversal.js) | The `../` attack, a wrong fix, the right fix | 6 |
| [04-prototype-pollution.js](examples/04-prototype-pollution.js) | A naive merge attacked by JSON, six defences | 7 |
| [05-redos.js](examples/05-redos.js) | Catastrophic backtracking and four fixes | 8 |
| [06-ssrf-guard.js](examples/06-ssrf-guard.js) | URL checks, private IP blocking, safe redirects | 9 |
| [07-limits-and-rate-limit.js](examples/07-limits-and-rate-limit.js) | Body limits, slow-request timeouts, a rate limiter | 10 |
| [08-headers-cors-cookies-csrf.js](examples/08-headers-cors-cookies-csrf.js) | Security headers, CORS done wrong and right, cookie flags, CSRF token | 11 |
| [09-crypto-tour.js](examples/09-crypto-tour.js) | Hash, HMAC, random, `timingSafeEqual`, AES-GCM, signatures, key agreement, WebCrypto, `pbkdf2`, `hkdf` | 12, 13 |
| [10-passwords-and-access.js](examples/10-passwords-and-access.js) | `scrypt` passwords, login lock, IDOR, RBAC, ABAC | 14, 17 |
| [11-jwt-by-hand.js](examples/11-jwt-by-hand.js) | HS256 JWT, four attacks, refresh rotation, PKCE | 15, 16 |
| [12-secrets-and-permissions.js](examples/12-secrets-and-permissions.js) | Secret wrapper, log redaction, the permission model | 18, 20 |

## 1. Think like an attacker

**What it is.** Security means making it hard and costly for someone to use your app in a way you did not plan: to read data they should not see, change data they should not change, or stop your app from working.

**Why it matters.** A server on the internet is probed by bots within minutes. You must close every door. The attacker needs only one that is open.

Analogy: a castle. It has a wall, a gate with guards, locked rooms inside and a list of who may enter which room. One layer can fail, so you build several.

Before you code, answer four questions (this is a tiny **threat model**):

1. **Assets:** what is worth protecting? (user data, passwords, payment info, your servers, your uptime)
2. **Attackers:** who might attack? (a curious user, a malicious user, a bot, a stolen laptop, a bad npm package)
3. **Entry points:** where does data come in? (HTTP body, query string, headers, cookies, uploaded files, file names, queue messages, third-party API answers, environment variables, dependencies)
4. **Impact:** what happens if they succeed? (data leak, money lost, site down)

A **trust boundary** is a line between data you control and data you do not. Everything that crosses it is untrusted until you check it. For a web API that means the whole HTTP request, plus anything read from a database that a user once wrote into.

A handy checklist is **STRIDE**. For each part of your system ask whether one of these six things can happen:

| Letter | Threat | Plain meaning | Typical Node defence |
|---|---|---|---|
| S | Spoofing | Pretending to be someone else | Strong authentication, no guessable tokens |
| T | Tampering | Changing data in transit or at rest | HTTPS, HMAC or signatures (section 13), validation |
| R | Repudiation | "I never did that" | Audit logs of important actions |
| I | Information disclosure | Leaking data | Access control, encryption, no secrets in logs or errors |
| D | Denial of service | Making the app unusable | Limits, timeouts, rate limiting |
| E | Elevation of privilege | A user doing admin things | Authorization checks on every request, least privilege |

Six rules sit under everything in this lesson:

- **Never trust input.** Validate shape and size at the edge.
- **Defense in depth.** Stack independent layers (validation, escaping, CSP, least privilege) so one miss is not a breach.
- **Least privilege.** Every user, token, process and database account gets only what it needs.
- **Secure by default, fail closed.** If a check cannot run or throws, deny.
- **Keep secrets out of code, logs and URLs.**
- **Assume a breach will happen.** Limit the damage and keep logs so you can see it.

> **Interview tip:** "How do you secure a Node API?" is a favourite open question. Give a structured answer instead of a random list: input validation, authentication and authorization, transport (HTTPS), secrets, dependencies, limits and timeouts, logging, and running with least privilege. Then pick two items and go deep.

## 2. The OWASP Top 10 mapped to Node

**OWASP** (Open Worldwide Application Security Project) is a non-profit that publishes the **Top 10**, a ranked list of the most common web application risks. Interviewers use its names as a vocabulary. The newest edition on owasp.org is **2025**:

| # | Category (2025) | What it looks like in a Node app | Where in this lesson |
|---|---|---|---|
| A01 | Broken Access Control | Missing ownership check (IDOR), path traversal, open CORS, SSRF-style reach into internal systems | 6, 9, 11, 17 |
| A02 | Security Misconfiguration | No security headers, stack traces in responses, debug mode in production, running as root, default passwords | 11, 18, 20 |
| A03 | Software Supply Chain Failures | A malicious or hijacked npm package, install scripts, no lockfile, never updating | 19 |
| A04 | Cryptographic Failures | Plain-text or SHA-256 passwords, `Math.random()` tokens, hard-coded keys, plain HTTP | 12, 13, 14 |
| A05 | Injection | SQL, NoSQL, OS command, template injection, XSS | 3, 4, 5 |
| A06 | Insecure Design | No rate limit on password reset, business rules that can be skipped | 1, 10 |
| A07 | Authentication Failures | Weak passwords allowed, no brute-force protection, JWT mistakes, session fixation | 14, 15, 16 |
| A08 | Software or Data Integrity Failures | Trusting unsigned data or updates, unsafe deserialization, `eval` on input, prototype pollution | 7, 13 |
| A09 | Security Logging and Alerting Failures | No record of failed logins, secrets written to logs | 18 |
| A10 | Mishandling of Exceptional Conditions | Errors that leak details, `catch` blocks that allow the action, crashes on odd input | 8, 10, 18 |

The previous edition (2021) is still quoted in many interviews. There, A03 was Injection, A05 was Security Misconfiguration, A06 was Vulnerable and Outdated Components and A10 was Server Side Request Forgery (SSRF). In 2025 SSRF no longer has its own line (OWASP's A01 page lists it among the weaknesses it covers), and supply chain failures and mishandling of exceptional conditions each got one.

> **Interview tip:** the list changes every few years, so learn the ideas, not the numbers. If an interviewer says "A03", ask which edition they mean. A strong answer to "what are the top risks for a Node API?" is broken access control first (a missing ownership check), then injection, bad configuration, weak crypto and password storage, and vulnerable dependencies.

## 3. Validate input

Example: [01-validate-and-escape.js](examples/01-validate-and-escape.js).

**What it is.** **Validation** checks that input has the expected shape and rejects it if not. **Sanitisation** changes input to make it safe (strip characters, normalise, escape). Prefer validate-and-reject. Sanitise only when you must accept messy input.

**Why it exists.** Every injection bug in this lesson starts with data that was not what the code expected. If you only let the expected shape through, whole bug families disappear.

The key idea is **allow-list, not block-list**. A block-list says "reject these bad things". Attackers find the thing you forgot. An allow-list says "accept only this". Anything else is rejected.

```js
// Allow-list: describe the ONLY thing that is accepted.
function isValidUsername(value) {
  return typeof value === 'string' && /^[a-z0-9_]{3,20}$/.test(value);
}
```

Notice `typeof value === 'string'`. JSON bodies can contain objects and arrays, so `{ "$ne": null }` or `["alice"]` can arrive where you expected a string. This is **type confusion**. Query strings do it too: on Express 5 the default parser turns `?id=1&id=2` into `['1', '2']`, so `req.query.id` is a string or an array.

For real objects, use a schema. A schema lists every field, its type and its limits, and rejects unknown fields (this blocks **mass assignment**: a client adding `isAdmin: true` to a body that your code copies straight into the database). The example has a 40-line validator. Output:

```text
--- 1. allow-list ---
"alice_01"                           accepted
"ab"                                 REJECTED
"<script>"                           REJECTED
"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa   REJECTED
{"$ne":null}                         REJECTED
["alice"]                            REJECTED
42                                   REJECTED
"bob'; DROP TABLE users;--"          REJECTED

--- 2. schema validation ---
good: {"ok":true,"value":{"name":"Ann","age":31,"role":"user","email":"ann@example.com"}}
bad : ["isAdmin: not allowed","name: length must be 1-50","age: must be an integer","role: must be one of user, editor","email: wrong format"]
```

In real projects use a library. Illustrative snippets (not run here):

```js
// Needs: npm install zod   (illustrative, written for zod 4)
const { z } = require('zod');

const CreateUser = z.strictObject({ // strictObject rejects unknown keys
  name: z.string().min(1).max(50),
  age: z.number().int().min(0).max(150),
  role: z.enum(['user', 'editor']),
  email: z.email(),
});

const result = CreateUser.safeParse(req.body);
if (!result.success) return res.status(400).json({ errors: result.error.issues });
const data = result.data; // safe to use: only known keys, right types
```

```js
// Needs: npm install ajv   (illustrative)
const Ajv = require('ajv');
const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile({
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 50 },
    age: { type: 'integer', minimum: 0, maximum: 150 },
    role: { enum: ['user', 'editor'] },
  },
  required: ['name', 'age', 'role'],
  additionalProperties: false, // unknown keys are an error
});
if (!validate(req.body)) return res.status(400).json({ errors: validate.errors });
```

Rules that go with this:

- Validate on the **server**, always. Browser validation is only a convenience for honest users.
- Validate early, at the boundary. Inside the app you then work with a clean, typed object.
- Check length and size too: maximum string length, array length, body size, nesting depth.
- Check **after** decoding. Decode URL-encoding and normalise Unicode first, then validate, or `%2e%2e%2f` (which is `../` URL-encoded) slips through.
- Validation is not escaping. A valid name like `O'Brien` is still dangerous inside a SQL string or an HTML page. You still need the defences in the next sections.

> **Common mistake:** "sanitising" by deleting bad words, like `input.replace('<script>', '')`. The attacker sends `<scr<script>ipt>` and your own code assembles the attack. Reject or encode instead.

> **Interview tip:** "Validation or sanitisation?" Answer: validate with an allow-list and reject what does not fit, because it is simple and predictable. Sanitise only when you must accept messy input, and always escape or parameterise at the point of use, since a valid value can still be dangerous in the wrong place.

## 4. XSS, output encoding and CSP

Example: [01-validate-and-escape.js](examples/01-validate-and-escape.js) (parts 3 to 6).

**What it is.** **Cross-site scripting (XSS)** means an attacker's JavaScript runs in another user's browser, on your site's origin. There are three kinds:

- **Stored XSS:** the script is saved (a comment, a profile bio) and shown to everyone who views it.
- **Reflected XSS:** the script is in the URL or form, and your server echoes it straight into the page.
- **DOM-based XSS:** your own front-end JavaScript writes untrusted data into the page with `innerHTML` and similar.

**Why it is serious.** Script running on your **origin** (the scheme, host and port together, such as `https://app.example.com`) can read the page, call your API as the user, and steal any cookie that is not `HttpOnly`.

**The fix is output encoding.** At the moment you put data into a page, encode it for the place it lands. The characters that matter depend on the context:

| Context | Danger | Fix |
|---|---|---|
| HTML text | `<` starts a tag | Escape `& < > " '` |
| HTML attribute | `"` ends the attribute | Escape quotes, and always quote the attribute |
| URL (`href`, `src`) | `javascript:` scheme | Allow-list the scheme (`http`, `https`, `mailto`) |
| Inline `<script>` data | `</script>` ends the block | Write `<` as `\u003c` in the JSON |
| Anywhere in the browser | `innerHTML` parses HTML | Use `textContent` |

A hand-written escape function is only five replacements:

```js
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}
```

Output:

```text
--- 3. escapeHtml ---
unsafe page: <p><img src=x onerror="alert(1)"></p>
safe page  : <p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>
attribute, escaped : <input value="&quot; onmouseover=&quot;alert(1)">
attribute, NOT     : <input value="" onmouseover="alert(1)">

--- 4. links ---
"/profile"                       -> https://app.example.com/profile
"https://example.com/a?b=1"      -> https://example.com/a?b=1
"javascript:alert(1)"            -> #
" JaVaScRiPt:alert(1)"           -> #
"data:text/html,<b>x</b>"        -> #

--- 5. JSON in a script tag ---
plain  : <script>const profile = {"bio":"</script><script>alert(1)</script>"};</script>
escaped: <script>const profile = {"bio":"\u003c/script>\u003cscript>alert(1)\u003c/script>"};</script>
```

Why it works: the browser reads `<img ... onerror=...>` as HTML, so the unsafe page runs the attacker's code. After escaping, the browser sees plain text. The `safeHref` function uses the URL parser, so tricks like spaces and upper-case letters in `JaVaScRiPt:` are normalised before the scheme is checked.

Good news: template engines and front-end frameworks escape by default (React, Vue `{{ }}`, EJS `<%= %>`, Handlebars `{{ }}`). The dangers are the escape hatches: `dangerouslySetInnerHTML`, `v-html`, EJS `<%- %>`, Handlebars `{{{ }}}`, and `element.innerHTML = ...`. If you must show user-supplied HTML (a rich text editor), clean it with a maintained sanitiser library (DOMPurify is the usual choice) that uses an allow-list of tags. Do not write that yourself.

### Content-Security-Policy (CSP): the second wall

**What it is.** CSP is a response header that tells the browser where scripts, images, frames and forms may come from. If an attacker still injects a `<script>` tag, the browser refuses to run it.

```text
--- 6. CSP header ---
Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'
```

Each directive in plain words: load things only from my own origin by default, run scripts only from my own origin (so no inline scripts), allow no plugins, stop injected `<base>` tags, let nobody frame this page, and let forms post only to me. If you need an inline script, give it a one-time random **nonce** instead of using `'unsafe-inline'`:

```js
// Illustrative: a fresh nonce on every response
const nonce = crypto.randomBytes(16).toString('base64');
res.setHeader('Content-Security-Policy', `script-src 'nonce-${nonce}'; object-src 'none'; base-uri 'self'`);
res.end(`<script nonce="${nonce}">/* your inline script */</script>`);
```

Roll a new policy out with the `Content-Security-Policy-Report-Only` header first. The browser then reports what it would block without blocking it.

A related tool is **Subresource Integrity (SRI)**. When you load a script from a CDN (a third-party file host), add `integrity="sha384-..."` to the `<script>` tag. The browser hashes the file it received and refuses to run it if the hash differs, so a hacked CDN cannot swap the file.

> **Common mistake:** escaping at input time and storing the escaped text. Data is used in many places (HTML, JSON, email, CSV), and each needs different escaping. Store the raw (validated) value and encode at output, for the exact context.

> **Interview tip:** "How do you prevent XSS?" Strong answer, in layers: (1) encode output for its context, which template engines do by default, and never use the escape hatches like `innerHTML` with user data; (2) a strict CSP as a second wall; (3) `HttpOnly` cookies so a successful XSS still cannot read the session cookie; (4) a maintained sanitiser such as DOMPurify when you must show user HTML.

## 5. Injection

Example: [02-injection.js](examples/02-injection.js).

**What it is.** Injection happens when untrusted data is sent to an **interpreter** (a SQL engine, a shell, a template engine) and the interpreter reads it as code instead of as data.

**Why it exists.** Programs build commands by gluing strings together: `"... WHERE name = '" + name + "'"`. The interpreter cannot tell where your text ends and the attacker's begins.

The fix is always the same idea: **keep code and data separate.** Send the command and the values on different channels.

### 5.1 SQL injection

```js
// BAD: the input is glued into the SQL text.
const sql = `SELECT id, name, is_admin FROM users WHERE name = '${name}' AND password = '${password}'`;
```

If `name` is `admin' --`, the SQL becomes `... WHERE name = 'admin' --' AND password = 'wrong'`. In SQL, `--` starts a comment, so the password check is gone. The attacker logs in as admin.

The fix is a **prepared statement** (a parameterised query): the SQL has placeholders, and the values travel separately, so a value can never become SQL.

```js
// GOOD: "?" can only ever be a VALUE.
db.prepare('SELECT id, name, is_admin FROM users WHERE name = ? AND password = ?').all(name, password);
```

(The example uses `node:sqlite`, built into Node 24 as a release candidate, with an in-memory database.) With a server database the shape is the same:

```js
// Needs: npm install pg   (illustrative)
const { rows } = await pool.query('SELECT id, name FROM users WHERE email = $1', [email]);
```

Placeholders work for **values** only, not for table names, column names or `ORDER BY` direction. For those, check against an allow-list in code. ORMs parameterise for you, but their raw escape hatches do not (for example the "unsafe" raw-query variants and `sequelize.query` with a concatenated string). Keep the database account's rights small too: the web app's user should not be allowed to `DROP TABLE`.

### 5.2 NoSQL injection

MongoDB queries are objects, and an object with a key like `$ne` is an **operator**. If the body is JSON, the attacker can send an object where you expected a string:

```js
// body = { "user": "admin", "pass": { "$ne": null } }   ("pass is anything that is not null")
db.collection('accounts').findOne({ user: body.user, pass: body.pass }); // matches without the password
```

The example imitates this with a 6-line matcher so you can see it without a database. The fix is the type check from section 3: insist that `user` and `pass` are strings (or validate with a schema). In Mongoose you can also turn on `mongoose.set('sanitizeFilter', true)`, and in plain queries you can wrap values as `{ $eq: value }`.

### 5.3 Template injection

If user input becomes part of the template text itself (not just the data filling it), the attacker's text is run as code. The example renders with `new Function`:

```js
// BAD: the TEMPLATE comes from the user. new Function() runs it as JavaScript.
function renderUnsafe(template, data) {
  return new Function('data', `return \`${template}\``)(data);
}
```

Safe approach: templates are fixed files that you wrote. User input is only ever passed in as **data** to fill the holes (and is escaped, see section 4). Never compile a string from a user as a template (EJS, Pug, Handlebars and Nunjucks all have this risk).

### 5.4 OS command injection

`child_process.exec()` starts a **shell** and gives it one string, so shell characters like `&&`, `;`, `|` and `$( )` have meaning. `execFile()` and `spawn()` start the program directly and take the arguments as an **array**, so nothing is parsed.

```js
const name = 'Bob && echo INJECTED-COMMAND-RAN'; // harmless payload: it only prints text

// BAD: a shell parses the whole string, so "&&" starts a second command.
await execAsync(`echo Hello ${name}`);

// GOOD: no shell. The name is passed as a plain argument.
await execFileAsync(process.execPath, ['-e', 'console.log("Hello " + process.argv[1])', name]);
```

Output of all four parts:

```text
--- 1. SQL injection ---
bad query : SELECT id, name, is_admin FROM users WHERE name = 'admin' --' AND password = 'wrong'
bad result: logged in as admin (is_admin=1)
good result: no rows
sort by name : [ 'admin', 'alice' ]
sort by evil : cannot sort by name; DROP TABLE users
after exec(): no such table: users

--- 2. NoSQL operator injection ---
bad login (object passes through): true
good login with the same body    : rejected: user and pass must be strings
good login with the real password: logged in

--- 3. template injection ---
intended use  : Hello Ann
attacker code : Hello object / true
safe renderer : Hello ${typeof process.env} &lt;b&gt;

--- 4. command injection ---
exec     : [ 'Hello Bob', 'INJECTED-COMMAND-RAN' ]
execFile : [ 'Hello Bob && echo INJECTED-COMMAND-RAN' ]
odd args : ["a b","it's","$(echo hi)"]
shell:true: [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities, as the arguments are not escaped, only concatenated.
```

Reading it:

- `exec` printed two lines: the attacker's second command really ran. `execFile` printed the whole payload as one harmless name.
- `after exec(): no such table: users` shows why `db.exec()` with concatenated text is the worst case: it runs several statements, so `; DROP TABLE users` works. `db.prepare()` compiles only the first statement.
- `attacker code : Hello object / true` shows attacker-supplied template text reading `process.env`. A real attacker would read secrets or run commands.
- On Node 24, using `spawn` or `execFile` with `shell: true` **and** an args array prints warning DEP0190, because the arguments are only joined into a string and not escaped.

Rules for commands:

- Do not shell out at all if Node can do the job (`fs.cp`, `zlib`, `fetch`).
- If you must: `execFile` or `spawn` with an array, the program name fixed in code, and options picked from an allow-list.
- A value that starts with `-` can be read as an option (**argument injection**). Put `--` before user values when the program supports it, and validate them.
- On Windows, `.cmd` and `.bat` files cannot be spawned without a shell (`spawn` fails with `EINVAL` since a 2024 security fix). Run Node scripts with `process.execPath` instead.

> **Interview tip:** the one-line answer to "how do you prevent injection?" is "never build code from data: parameterised queries, `execFile` with array arguments, fixed templates, and validate types". Then name the specific tool for each interpreter.

## 6. Path traversal

Example: [03-path-traversal.js](examples/03-path-traversal.js).

**What it is.** Your server reads or writes a file whose name comes from the user. The attacker adds `../` (go up one folder) to escape the folder you meant.

**Why it matters.** `GET /files?name=../../../etc/passwd` or `..\..\config.json` can read source code, `.env` files and keys.

```js
// Version 1 (vulnerable): join and read
fs.readFileSync(path.join(publicDir, userPath), 'utf8');
```

`path.join` just glues and tidies: `public/../secret.txt` becomes `secret.txt` next to `public`. The file leaves the folder. The correct check has two steps: **resolve first** (turn the input into a final absolute path with every `..` removed), **then check** the result is still inside the base folder.

```js
function resolveInside(baseDir, userPath) {
  if (typeof userPath !== 'string' || userPath.includes('\0')) throw new Error('bad path');
  const base = path.resolve(baseDir);
  const full = path.resolve(base, userPath);       // removes every ".." and "."
  const rel = path.relative(base, full);           // how do we get from the base to the target?
  const outside = rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel);
  if (outside || rel === '') throw new Error('blocked: path escapes the base folder');
  return full;
}
```

If the target is inside `base`, `path.relative` gives something like `sub/file.txt`. If it is outside, the result starts with `..`. If it is on another drive (Windows) the result is absolute, which is why `isAbsolute` is checked too. Output:

```text
legend: v1 = join, v2 = startsWith(base), v3 = resolve + relative

--- v1 ---
v1 normal file                  -> "hello, anyone may read this"
v1 classic ../                  -> "TOP SECRET: database password"
v1 hidden in the middle         -> "TOP SECRET: database password"
v1 %2e%2e%2f after decoding     -> "TOP SECRET: database password"
v1 sibling folder               -> "TOP SECRET: sibling folder"
v1 absolute path                -> error ENOENT
v1 null byte                    -> error ERR_INVALID_ARG_VALUE

--- v2 ---
v2 normal file                  -> "hello, anyone may read this"
v2 classic ../                  -> error blocked
v2 hidden in the middle         -> error blocked
v2 %2e%2e%2f after decoding     -> error blocked
v2 sibling folder               -> "TOP SECRET: sibling folder"
v2 absolute path                -> error blocked
v2 null byte                    -> error ERR_INVALID_ARG_VALUE

--- v3 ---
v3 normal file                  -> "hello, anyone may read this"
v3 classic ../                  -> error blocked: path escapes the base folder
v3 hidden in the middle         -> error blocked: path escapes the base folder
v3 %2e%2e%2f after decoding     -> error blocked: path escapes the base folder
v3 sibling folder               -> error blocked: path escapes the base folder
v3 absolute path                -> error blocked: path escapes the base folder
v3 null byte                    -> error bad path

--- join vs resolve ---
path.join("/srv/public", "/etc/passwd")   = /srv/public/etc/passwd
path.resolve("/srv/public", "/etc/passwd") = /etc/passwd
```

The middle block is the trap: **v2** (`startsWith(base)`) looks right and blocks the classic attack, but `.../public-private/leak.txt` starts with the same text as `.../public`, so the sibling folder leaks. Always compare with `path.relative`, or add a path separator to the base before `startsWith`. Also note `path.join` keeps an absolute second argument inside the base (it just glues), while `path.resolve` lets it replace the base, which is why the relative check is needed after `resolve`.

More cases to remember:

- **Symlinks.** A symbolic link (symlink) is a file that is only a pointer to another path. `path.resolve` does not follow it, so a link inside the folder can point outside. If users can create links or upload archives, also call `fs.realpathSync()` on the result and run the same inside-check on the real path (resolve the base with `realpath` too).
- **Zip slip.** Extracting an archive whose entry is named `../../app.js` is the same bug. Run every entry name through the same check.
- **Uploads.** Do not use the client's file name. Generate your own (`crypto.randomUUID()`), store uploads outside the code and public folders, limit size, check the type from the content and not only the extension, and serve downloads with `X-Content-Type-Options: nosniff`.
- `express.static` refuses paths outside its root, and `res.sendFile` does too when you pass the `root` option. The danger is your own code that builds paths and then calls `fs`.

> **Interview tip:** bring up path traversal before the interviewer does when file endpoints come up. Say "resolve, then check the result is inside the base with `path.relative`", and mention symlinks and upload file names.

## 7. Prototype pollution

Example: [04-prototype-pollution.js](examples/04-prototype-pollution.js).

**What it is.** In JavaScript every plain object inherits from `Object.prototype`. If an attacker can write a property onto `Object.prototype`, **every object in the process** suddenly has it. That is prototype pollution.

**Why it happens.** Code that copies keys from user-controlled data into an object (deep merge, deep clone, "set value by path", query-string parsers) can be tricked into writing to the special key `__proto__`, or to `constructor.prototype`.

Here is the typical vulnerable merge:

```js
function naiveMerge(target, source) {
  for (const key in source) {
    if (isObject(source[key])) {
      if (!isObject(target[key])) target[key] = {};
      naiveMerge(target[key], source[key]);   // for key "__proto__", target[key] is Object.prototype!
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

naiveMerge({}, JSON.parse('{"__proto__": {"isAdmin": true}}'));
console.log(({}).isAdmin); // true, on a brand new object
```

Why `JSON.parse`? In a source-code literal, `{ "__proto__": ... }` sets the prototype. `JSON.parse` makes `__proto__` an ordinary own key, so a loop over the keys sees it. Then `target['__proto__']` is `Object.prototype`, and the merge writes `isAdmin` straight into it. Later code like `if (user.isAdmin)` is true for everyone: an authorization bypass. In some template or library code, pollution can even lead to running commands.

Output of part 1:

```text
--- 1. the attack ---
own keys of the parsed payload: [ '__proto__' ]
before merge: user.isAdmin = undefined
after merge : user.isAdmin = true (user never had this key!)
also true for every new object: ({}).isAdmin = true
Object.hasOwn(user, "isAdmin") = false
```

The six defences, from the example:

| Defence | How | Notes |
|---|---|---|
| Block dangerous keys | Skip `__proto__`, `constructor`, `prototype` when copying | Cheap and effective. Block all three: the `constructor.prototype` path works too |
| Target without a prototype | `Object.create(null)` | `target['__proto__'] = ...` is then an ordinary property |
| Use a `Map` | `new Map()` for data whose keys come from users | Keys are never properties, so nothing to pollute |
| Own-property checks when reading | `Object.hasOwn(obj, 'isAdmin')` | Protects **reads**, not writes. It is a good habit, not a full fix |
| `node --disable-proto=delete` | Removes `Object.prototype.__proto__` for the whole process (`=throw` makes any access throw an error with code `ERR_PROTO_ACCESS`) | Stops the `__proto__` path only. `constructor.prototype` still works |
| Freeze the prototype | `Object.freeze(Object.prototype)` at start-up | In strict mode writes throw. Can break libraries that assign to inherited properties, so test it |

Output of parts 2 to 6:

```text
--- 2. key blocklist ---
__proto__ payload    -> ({}).isAdmin = undefined
constructor payload  -> ({}).isAdmin = undefined

--- 3. Object.create(null) ---
({}).isAdmin = undefined | own keys of the target: [ '__proto__' ]

--- 4. Map ---
Map entries: [ [ '__proto__', 1 ], [ 'constructor', 1 ], [ 'hello', 2 ] ] | ({}).hello = undefined

--- 5. node --disable-proto ---
(no flag)                __proto__ payload: true | constructor payload: true
--disable-proto=delete   __proto__ payload: undefined | constructor payload: true
--disable-proto=throw    Error: Accessing Object.prototype.__proto__ has been disallowed with --disable-proto=throw

--- 6. Object.freeze(Object.prototype) ---
strict mode throws: TypeError - Cannot add property isAdmin, object is not extensible
({}).isAdmin after the attempt = undefined
```

Part 5 is the lesson inside the lesson: with `--disable-proto=delete` the `__proto__` attack is gone, but the `constructor` attack still pollutes. Use several layers. In sloppy (non-strict) mode, writing to a frozen object fails **silently**, which hides bugs, so use strict mode (ES modules are strict automatically).

Also keep dependencies updated. Many popular libraries (including well-known deep-merge and path-setting helpers) have had pollution bugs and fixed them in later versions. Node also has the experimental `--frozen-intrinsics` flag, which freezes the built-in objects, but it prints an experimental warning, so treat it as something to try rather than rely on.

Two more places where user-controlled keys hide: query-string parsers (`?a[__proto__][x]=1` in libraries that build nested objects) and "set a value by a dotted path" helpers (`set(obj, 'a.__proto__.x', 1)`). Treat any code that turns a string from the user into a property path as a pollution risk.

> **Interview tip:** be able to say it in three sentences. "JavaScript objects inherit from `Object.prototype`. A merge that follows `__proto__` or `constructor.prototype` lets user JSON add properties to every object. Fix: block those keys, use `Object.create(null)` or `Map`, validate with a schema, and keep libraries updated."

## 8. ReDoS: regular expressions that freeze Node

Example: [05-redos.js](examples/05-redos.js).

**What it is.** **ReDoS** (Regular expression Denial of Service). Some regex patterns, on some inputs, make the engine try an exponential number of ways to match before giving up. This is called **catastrophic backtracking**.

**Why it hurts Node so much.** A regex runs on the main thread. While it runs, the event loop is blocked: no other request is served. One 30-character request can freeze the whole server. (V8's engine **backtracks**: it tries one way to match, and when the rest fails it steps back and tries the next way.)

The classic bad pattern has a **quantifier inside a quantifier** over the same characters: `/^(a+)+$/`. Given `aaaa...a!`, the engine can split the run of `a` characters in a huge number of ways, and the final `!` makes every way fail.

```text
--- 1. /^(a+)+$/ on "aaa...a!" ---
(timings differ on every machine, the doubling pattern does not)
n = 14  match = false      2.8 ms
n = 16  match = false      1.1 ms
n = 18  match = false      4.4 ms
n = 20  match = false     18.7 ms
n = 22  match = false     90.9 ms
n = 24  match = false    351.2 ms
```

Each extra character doubles the time. Your numbers will differ, but 24 characters took a third of a second here, and 40 characters would take hours. The attack input is tiny, which is what makes it dangerous.

Fixes, from the example:

```text
--- 2. fix A: /^a+$/ (no nested quantifier) ---
100000 characters: match = false, under 50 ms: true

--- 3. fix B: length limit ---
short input: true
long input : false (rejected at once)

--- 4. fix C: worker + timeout ---
result: regex timed out after 200 ms
main thread kept running: true (at least 5 heartbeat ticks happened while the regex ran)
total wait close to the timeout: true

--- 5. fix D: V8 fallback engine ---
34 characters: match = false | fast: true
```

1. **Write patterns with one way to match.** `/^a+$/` does the same job as `/^(a+)+$/` in linear time. Avoid nested quantifiers like `(a+)+`, `(a*)*`, and overlapping alternatives like `(a|a)+`.
2. **Limit the input length first.** Most fields (names, emails) never need more than a few hundred characters.
3. **Do not use a regex when a simple check works.** For emails, check length and that there is one `@`, then confirm by sending a message.
4. **Run risky matching in a `worker_thread` with a timeout** and `terminate()` it. The example shows the main thread stays responsive while the worker is stuck. (Lesson 18 covers workers.)
5. **Use a linear-time engine** (one whose time grows in a straight line with the input length). The `re2` package (Google's RE2) has no catastrophic backtracking. Needs: `npm install re2`. V8 also has an experimental switch, `--enable-experimental-regexp-engine-on-excessive-backtracks`, that falls back to a linear engine after many backtracks. It is a V8 option that Node passes through, not a documented Node flag. It worked on Node 24.16 in the example, but treat it as a safety net only and do not build on it.
6. **Never build a regex from user input** without escaping it. `RegExp.escape(text)` exists on Node 24 (V8 13.6). Do not be surprised by its output: `RegExp.escape('a.b*c')` returns `\x61\.b\*c`, because a leading letter or digit is hex-escaped on purpose. A user-supplied pattern is itself a ReDoS and an injection risk.

> **Under the hood:** backtracking is fast for normal patterns and exponential for ambiguous ones. A linear engine (RE2) tracks all paths at once, which is why it is safe but supports fewer features (no back-references).

> **Interview tip:** "What is ReDoS and how do you stop it?" Answer: a regex with nested or overlapping quantifiers takes exponential time on a crafted input, and because it runs on the one JavaScript thread it blocks every request. Fix it by rewriting the pattern, capping the input length, avoiding user-built patterns, and using a worker with a timeout or RE2 for risky matching.

## 9. SSRF: Server-Side Request Forgery

Example: [06-ssrf-guard.js](examples/06-ssrf-guard.js).

**What it is.** Your server fetches a URL that a user supplies (a link preview, a webhook, an "import from URL" feature, an image proxy). The attacker supplies an address that only your server can reach.

**Why it matters.** From inside your network the server can reach things the internet cannot: `http://localhost:6379` (Redis), an internal admin panel, and the **cloud metadata service** at `http://169.254.169.254/` (on the major clouds), which can hand out the server's cloud credentials.

Defence in layers:

1. **Best: allow-list.** If you only ever need to call three partner hosts, accept only those hosts.
2. **Allow only `http:` and `https:`** (not `file:`, `ftp:`, `gopher:`), no credentials in the URL, and only the ports you expect.
3. **Block private and special IP ranges** after resolving the name (the table below). Check **every** address the name resolves to.
4. **Beware tricky spellings.** The WHATWG `URL` parser already turns `2130706433`, `0x7f.1` and `127.1` into `127.0.0.1`, so always check the parsed `hostname`, not the raw text. IPv6 hosts come wrapped in `[ ]`. An IPv4-mapped address like `::ffff:127.0.0.1` is the same as IPv4 `127.0.0.1`.
5. **Defeat DNS rebinding.** A name can answer "public IP" when you check and "10.0.0.5" a second later when you connect. Check the address at connect time (a custom `lookup`), or connect to the IP you vetted.
6. **Handle redirects yourself.** A public URL can answer `302` to an internal one. Use `redirect: 'manual'` and validate every hop.
7. **Limit the damage:** timeouts (`AbortSignal.timeout()`), a maximum response size, and never return raw error details or bodies to the user. Add **egress** rules (firewall rules for traffic leaving your server) so the server physically cannot reach internal systems. That is the strongest wall.
8. **Harden the cloud side.** On AWS, require the newer metadata service version (IMDSv2). It needs a `PUT` request to get a session token first, which a simple "fetch this URL" bug cannot make. Give the server's cloud role only the rights it needs, so even stolen credentials are weak.

Ranges to block (a starting list, the example has the full code with `net.BlockList`):

| Range | Meaning |
|---|---|
| `127.0.0.0/8`, `::1` | Loopback (localhost) |
| `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7` | Private networks |
| `169.254.0.0/16`, `fe80::/10` | Link-local (valid only on the local network link). Includes the cloud metadata address |
| `100.64.0.0/10` | Carrier-grade NAT (internal addresses used by internet providers) |
| `0.0.0.0/8`, `::` | "This host" |
| `224.0.0.0/4`, `240.0.0.0/4`, `ff00::/8` | Multicast and reserved |

`net.BlockList` is a core class: `addSubnet(address, prefix, 'ipv4')` and `check(ip, 'ipv4')`. It treats an IPv4-mapped IPv6 address as the IPv4 address inside it.

Output of the example (DNS answers for `cdn.example` and `attacker.example` are faked, so no internet is needed; the address printed for `localhost` can be `127.0.0.1` or `::1` depending on your machine):

```text
--- 1. URL checks (the URL parser already turns tricky spellings into plain IPs) ---
http://8.8.8.8/                              allowed
https://cdn.example/logo.png                 allowed
http://attacker.example/                     BLOCKED: attacker.example points at private address 10.0.0.5
http://169.254.169.254/latest/meta-data/     BLOCKED: 169.254.169.254 points at private address 169.254.169.254
http://127.0.0.1:8080/admin                  BLOCKED: 127.0.0.1 points at private address 127.0.0.1
http://localhost/                            BLOCKED: localhost points at private address ::1
http://[::1]/                                BLOCKED: ::1 points at private address ::1
http://2130706433/                           BLOCKED: 127.0.0.1 points at private address 127.0.0.1
http://0x7f.1/                               BLOCKED: 127.0.0.1 points at private address 127.0.0.1
http://[::ffff:127.0.0.1]/                   BLOCKED: ::ffff:7f00:1 points at private address ::ffff:7f00:1
file:///etc/passwd                           BLOCKED: scheme file: is not allowed
ftp://cdn.example/file                       BLOCKED: scheme ftp: is not allowed
https://user:pass@8.8.8.8/                   BLOCKED: credentials in the URL are not allowed
not a url                                    BLOCKED: not a valid URL

--- 2. guarded lookup at connect time ---
request failed: blocked: localhost resolved to ::1

--- 3. redirects ---
plain fetch follows redirect : "TOP SECRET internal data"
safeFetch, no redirect       : "public data"
safeFetch, evil redirect     : blocked at hop 1: /internal/secret is outside /public/
```

The last block is the redirect lesson. Plain `fetch` followed the `302` and returned the internal secret. `safeFetch` stopped at hop 1. Note that `attacker.example` is an innocent-looking name that points at `10.0.0.5`, which is why you check the **resolved address**, not just the text of the URL.

> **Interview tip:** a strong SSRF answer names three things: allow-list over block-list, checking the resolved IP at connect time (DNS rebinding), and re-checking every redirect. Mentioning the cloud metadata address shows real experience.

## 10. Denial of service: limits, timeouts and rate limiting

Example: [07-limits-and-rate-limit.js](examples/07-limits-and-rate-limit.js).

**What it is.** A **denial of service (DoS)** attack tries to make your app slow or unavailable. You cannot stop a huge distributed attack in Node code (that needs a CDN or load balancer), but you can stop the cheap ones: giant bodies, slow connections, request floods, expensive endpoints.

Node's built-in server timeouts (verified on Node 24; the example prints them):

```text
--- 1. Node default timeouts ---
headersTimeout=60000 requestTimeout=300000 timeout=0 keepAliveTimeout=5000 maxHeaderSize=16384
```

`headersTimeout` is how long a client has to send the whole header block (60 s). `requestTimeout` is how long the whole request may take (300 s). `timeout` of 0 means no socket idle timeout. `maxHeaderSize` of 16 KiB caps the header size. These defaults are generous, so lower them for a public API.

### 10.1 Limit the body size

If you read a request body into memory with no limit, one client can send gigabytes. Check the declared `Content-Length` first (cheap early exit), and count bytes as they arrive (uploads without a length, "chunked", have no declared size). Answer `413 Payload Too Large`.

```js
req.on('data', (chunk) => {
  size += chunk.length;
  if (size > limit) { reject(new TooLarge('body is over the limit')); req.removeAllListeners('data'); return; }
  chunks.push(chunk);
});
```

The example server allows 1024 bytes and is tested with three clients:

```text
--- 2. body size limit (1024 bytes) ---
100 byte body       : 200 got 100 bytes
5000 byte body      : 413 declared length is over the limit
chunked 4 x 512 B   : 413 body is over the limit
```

Frameworks have a setting: `express.json({ limit: '100kb' })` (100 kb is its default). Set limits for each content type, for file uploads (`multer` `limits.fileSize`), and for decompression (a small gzip body can expand to gigabytes, a "zip bomb"). Also cap the **shape**, not only the size: a 100 KB body of `[[[[[...` nests deeply, and an array with a million tiny items costs a lot of CPU to validate.

### 10.2 Slow clients

A **slowloris** attack opens many connections and sends a request very slowly, to keep your sockets busy. The answer is timeouts. The example sets `headersTimeout: 300` and sends half a header, then goes silent:

```text
--- 3. slow header attack ---
server answered     : HTTP/1.1 408 Request Timeout
connection cut off  : in under 2 seconds = true (not left open forever)
```

The server replied `408 Request Timeout` and closed the connection. Other settings to know: `server.maxConnections`, `server.maxRequestsPerSocket`, and for outgoing requests always pass `signal: AbortSignal.timeout(ms)`.

### 10.3 Rate limiting

**What it is.** Allow each client only N requests per time window. Over the limit, answer `429 Too Many Requests` with a `Retry-After` header.

The simplest design is a **fixed window**: a counter per key (IP address or user id) that resets every window.

```text
--- 4. rate limit (3 requests per 10 s per client) ---
request 1: 200 remaining=2 retry-after=-
request 2: 200 remaining=1 retry-after=-
request 3: 200 remaining=0 retry-after=-
request 4: 429 remaining=0 retry-after=10
request 5: 429 remaining=0 retry-after=10

--- 5. limiter with a fake clock (no waiting) ---
t=0 first        {"allowed":true,"remaining":1,"retryAfterSec":0}
t=0 second       {"allowed":true,"remaining":0,"retryAfterSec":0}
t=0 third        {"allowed":false,"remaining":0,"retryAfterSec":1}
t=1000 new window {"allowed":true,"remaining":1,"retryAfterSec":0}
```

The class takes its clock as a parameter (`now`), so the last block can move time forward without sleeping. That trick makes time-based code easy to test.

Things to know:

| Topic | Detail |
|---|---|
| Algorithms | **Fixed window**: one counter per time slot (simple, but a client can send a full quota at the end of one slot and again at the start of the next, a double burst). **Sliding window**: counts the last N seconds, so it is smoother. **Token bucket**: a bucket refills at a steady rate and each request takes one token, so short bursts are allowed but the average is capped. **Leaky bucket**: requests drain at a fixed rate, which smooths traffic |
| Clean up | Delete finished windows (`sweep()`), or an attacker using a new key per request grows your `Map` forever |
| Many servers | Memory counters are per process. Share the count in Redis, or use the proxy or API gateway |
| The client IP | Behind a proxy, `req.socket.remoteAddress` is the proxy. Read `X-Forwarded-For` only from proxies you trust (Express: the `trust proxy` setting) or users can fake their IP |
| Where | Strict limits on login, signup, password reset and anything that costs money or CPU |
| Library | `express-rate-limit` (Needs: `npm install express-rate-limit`) |

Other DoS sources in Node: a blocking CPU loop (section 8, or a `*Sync` call per request), unbounded queries (always paginate with a maximum page size), GraphQL queries with huge depth, and very expensive hashing (section 14: password hashing is intentionally slow, so rate-limit logins). The libuv thread pool has only 4 threads by default, so a flood of `crypto.scrypt` or `fs` calls can queue behind each other.

> **Common mistake:** a rate limit that keys on the IP only. Many real users share one IP (offices, mobile carriers), and attackers rotate IPs. Combine limits per IP, per account and per route, and add a lock or delay per account for logins (section 14).

> **Interview tip:** "How do you protect a Node API from DoS?" Cover four layers: limits (body size, JSON depth, page size), timeouts (headers, request, outgoing calls), rate limiting (per IP, per user, per route, shared in Redis across servers), and never blocking the event loop (no `*Sync` calls or heavy regex in handlers). Then say that volumetric attacks are stopped at the edge by a CDN or load balancer, not in Node.

## 11. Security headers, CORS, cookies, CSRF and clickjacking

Example: [08-headers-cors-cookies-csrf.js](examples/08-headers-cors-cookies-csrf.js).

Browsers enforce a lot of security rules, and the server controls them through response headers. Node's `fetch` does not enforce them, so the example shows what the **server sends and checks**, and this section says what a browser does with it.

### 11.1 Security headers

You can set these by hand. A small function called on every response is enough:

```js
function setSecurityHeaders(res) {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // ... Permissions-Policy, Cross-Origin-Opener-Policy, Cross-Origin-Resource-Policy
}
```

```text
--- 1. security headers on every response ---
content-security-policy: default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
cross-origin-opener-policy: same-origin
cross-origin-resource-policy: same-origin
permissions-policy: camera=(), microphone=(), geolocation=()
referrer-policy: no-referrer
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: DENY
```

| Header | What it does |
|---|---|
| `Strict-Transport-Security` (HSTS) | Tells the browser to use HTTPS only for this site for `max-age` seconds (31536000 is one year). Start with a small value, because a wrong HSTS setting is hard to undo. (A `preload` option puts your domain on a list built into browsers, which is even harder to undo, so add it only when you are sure) |
| `Content-Security-Policy` | Which sources may load scripts, images, frames (section 4). Includes `frame-ancestors` for clickjacking |
| `X-Content-Type-Options: nosniff` | The browser must trust your `Content-Type` and not guess. Stops an uploaded text file from being run as a script |
| `X-Frame-Options` | Older way to forbid framing (`DENY` or `SAMEORIGIN`). CSP `frame-ancestors` is the modern one. Sending both is common |
| `Referrer-Policy` | How much of the previous URL is sent to other sites. `no-referrer` sends none |
| `Permissions-Policy` | Switches off browser features you do not use (camera, microphone, location) |
| `Cross-Origin-Opener-Policy` / `Cross-Origin-Resource-Policy` | Isolate your pages and resources from other sites' windows and embeds |

**What `helmet` does.** `helmet` is an Express middleware that sets a good set of these headers for you. Its README for version 8.3.0 says the defaults cover 13 headers (twelve are set, and `X-Powered-By` is removed). The defaults include: a default `Content-Security-Policy`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`, `Origin-Agent-Cluster: ?1`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Content-Type-Options: nosniff`, `X-DNS-Prefetch-Control: off`, `X-Download-Options: noopen`, `X-Frame-Options: SAMEORIGIN`, `X-Permitted-Cross-Domain-Policies: none`, and `X-XSS-Protection: 0` (it switches off the old, buggy browser XSS filter). It also removes `X-Powered-By`. `Cross-Origin-Embedder-Policy` is not set by default. Defaults can change between versions, so check the README of the version you install.

```js
// Needs: npm install helmet   (illustrative)
const helmet = require('helmet');
app.use(helmet());                                       // sensible defaults
app.use(helmet({ contentSecurityPolicy: false }));       // or turn one header off while you tune it
```

Helmet's default CSP is strict and may block your own inline scripts or CDN files, so expect to tune it. Test the headers with browser dev tools or a scanner such as securityheaders.com.

### 11.2 CORS

**What it is.** Browsers apply the **same-origin policy**: a page from `https://a.com` may not read responses from `https://b.com` through JavaScript. **CORS** (Cross-Origin Resource Sharing) is the way `b.com` says "pages from `a.com` may read my responses", using headers like `Access-Control-Allow-Origin`.

Remember that an **origin** is scheme + host + port, so `http://a.com`, `https://a.com` and `https://a.com:8443` are three different origins.

Two things beginners miss:

- CORS is enforced by **browsers**. `curl`, Postman and other servers ignore it. It does not protect your API from them. It only decides which **web pages** can read responses.
- CORS **relaxes** a protection. Every extra allowed origin is extra trust.

**Preflight.** For a plain `GET`, or a `POST` of a normal HTML form, the browser sends the request and then checks the answer headers. For anything else (`PUT`, `DELETE`, a JSON `Content-Type`, a custom header such as `Authorization`) the browser first sends a **preflight**: an `OPTIONS` request that asks "may I do this?". The server answers with `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers` and `Access-Control-Max-Age` (how long the browser may remember the answer). Only if they fit does the browser send the real request. A preflight that is not answered is the most common reason for the "blocked by CORS policy" error in a browser console.

The example has a wrong version and a right one:

```js
function badCors(req, res) {
  // WRONG: copies whatever origin asks, and allows cookies.
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

function goodCors(req, res) {
  res.setHeader('Vary', 'Origin'); // the answer depends on Origin: caches must keep one copy per origin
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {   // exact match against OUR list
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
}
```

```text
--- 2. CORS ---
/api/bad-cors   from https://app.example.com  -> Allow-Origin: https://app.example.com, credentials: true
/api/bad-cors   from https://evil.example     -> Allow-Origin: https://evil.example, credentials: true
/api/good-cors  from https://app.example.com  -> Allow-Origin: https://app.example.com, credentials: true
/api/good-cors  from https://evil.example     -> Allow-Origin: (none), credentials: -
(a browser only gives the page the response when Allow-Origin matches its own origin)
```

With the bad version, a page on `evil.example` can call your API **with the visitor's cookies** and read the private answer. Common CORS mistakes:

- Reflecting any `Origin` and sending `Allow-Credentials: true` (shown above).
- Checking with `origin.endsWith('example.com')`: that also matches `evilexample.com`. Compare against exact strings.
- Allowing the `null` origin (sandboxed iframes and local files can send it).
- `Access-Control-Allow-Origin: *` on an API that returns private data. (Browsers refuse `*` together with credentials, but `*` still exposes anything that does not need cookies.)
- Forgetting `Vary: Origin`, so a cache serves one site's CORS headers to another.

### 11.3 Cookie flags

A cookie that identifies a session is a key to the account. Set every protective flag:

```text
--- 3. session cookie flags ---
__Host-sid=<43 random characters>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=3600
```

| Flag | Meaning |
|---|---|
| `HttpOnly` | JavaScript cannot read the cookie, so XSS cannot steal it |
| `Secure` | The browser sends it only over HTTPS |
| `SameSite=Lax` | Not sent on cross-site POSTs or sub-requests (see CSRF below). `Strict` is stricter (not even on links from other sites). `None` allows cross-site use and requires `Secure` |
| `Path`, `Domain` | Where the cookie is sent. Leave `Domain` off, so subdomains do not receive it |
| `Max-Age` / `Expires` | Lifetime. Use a short idle time, plus a maximum total lifetime |
| `__Host-` name prefix | The browser only accepts the cookie if it has `Secure`, `Path=/` and no `Domain`. This stops other subdomains from planting a cookie of the same name |

The session id itself must be unguessable: `crypto.randomBytes(32).toString('base64url')` (256 bits). That string is 43 characters, as the example shows. Create a **new** session id when a user logs in, to prevent **session fixation** (an attacker planting a known id before login).

### 11.4 CSRF

**What it is.** **Cross-Site Request Forgery**. You are logged in to `bank.com`. You open `evil.com`, which contains a hidden form that posts to `bank.com/transfer`. The browser attaches your `bank.com` cookie automatically, so the bank thinks you made the request.

**Why it works.** Cookies are sent automatically with every request to their site, whoever started the request. This is a problem for cookie-based login. A login that uses an `Authorization: Bearer` header set by your own JavaScript is not affected, because the browser does not add that header by itself.

Defences, strongest together:

1. **`SameSite=Lax` (or `Strict`) cookies.** The browser leaves the cookie out of cross-site POST requests. Chromium browsers treat a missing `SameSite` as `Lax`, but do not rely on defaults; set it explicitly.
2. **A CSRF token:** a random secret tied to the session (the "synchronizer token" pattern). The page gets it with a normal request and sends it back in a header (or hidden field). A forged form on `evil.com` cannot read it (same-origin policy), so it cannot send it. Compare in constant time. A stateless variant is the **double-submit cookie**: the server sets the token in a cookie and also requires it in a header, and checks that both match (sign the token with an HMAC so an attacker cannot plant their own).
3. **Check the `Origin` header** on state-changing requests: it must be your own origin.
4. **Never change state with GET.** Links and images send GET.
5. For JSON APIs, require a custom header or `Content-Type: application/json`; a plain HTML form cannot send those, and a script on another site would trigger a CORS preflight that your server refuses.

```text
--- 4. CSRF ---
no cookie                : 401 not logged in
cookie only (forged form): 403 missing or wrong CSRF token
cookie, evil Origin      : 403 bad origin
cookie + token + Origin  : 200 transfer done
```

"SameSite" means same **site** (the registrable domain such as `example.com`), not same origin. `app.example.com` and `evil.example.com` are the same site, so a hostile subdomain can still send same-site requests. Tokens close that gap.

### 11.5 Clickjacking

**What it is.** An attacker loads your page in an invisible `<iframe>` on their page and puts a tempting button under the user's mouse. The user thinks they click "win a prize" and really click your "Delete account" button.

**Fix.** Forbid framing: `Content-Security-Policy: frame-ancestors 'none'` (or `'self'`), and `X-Frame-Options: DENY` for old browsers. Both are in the example.

### 11.6 Open redirects and header injection

- An **open redirect** is `res.redirect(req.query.next)` with no check. Attackers use it to send victims from your trusted domain to a phishing page. Rebuild the target from the parsed parts, and ignore the raw text:

```js
function safeNext(next, ownOrigin = 'https://app.example.com') {
  try {
    const url = new URL(next, ownOrigin);
    return url.origin === ownOrigin ? url.pathname + url.search : '/'; // only a path on OUR site
  } catch {
    return '/';
  }
}
// '/orders?id=5' -> '/orders?id=5'      'https://evil.example/phish' -> '/'
// '//evil.example/phish' -> '/'         'javascript:alert(1)' -> '/'
```

- **Header injection:** putting `\r\n` in a header value can add extra headers or split the response. Node protects you: `res.setHeader('X', 'a\r\nSet-Cookie: x=1')` throws `ERR_INVALID_CHAR`. Do not bypass that with raw socket writes.

> **Interview tip:** CORS and CSRF are mixed up all the time. Say it this way: "CORS decides which sites may **read** responses from my API. CSRF is about a hostile site making the browser **send** a request with the user's cookies. CORS does not stop CSRF, since the request is still sent."

## 12. HTTPS and TLS

**What it is.** **TLS** (Transport Layer Security) encrypts a network connection and lets the client check who the server really is. **HTTPS** is HTTP running inside TLS.

**Why it exists.** Plain HTTP travels as readable text through every router on the way (Wi-Fi, ISP, company proxy). Anyone there can read passwords and session cookies, and change the page. TLS gives three things: **confidentiality** (nobody can read it), **integrity** (nobody can change it unnoticed) and **server authentication** (you are talking to the real site).

The handshake in plain words:

1. The client says which TLS versions and ciphers it supports.
2. The server sends its **certificate**: its public key plus a signature from a **certificate authority (CA)** that the client already trusts.
3. The client checks the signature chain, the expiry date and that the certificate matches the host name.
4. Both sides agree on a fresh secret key (a key exchange), then encrypt everything else with fast **symmetric** crypto such as AES-GCM.

So public-key (asymmetric) crypto is used for the introduction, and symmetric crypto does the heavy work.

Node 24 defaults (printed by the last part of the crypto tour example, section 13):

```text
--- 10. TLS defaults ---
minimum TLS version: TLSv1.2 | maximum: TLSv1.3
```

```js
// Illustrative: Node terminating TLS itself. Lesson 12 has a runnable local HTTPS example.
const https = require('node:https');
const fs = require('node:fs');

https.createServer(
  { key: fs.readFileSync('key.pem'), cert: fs.readFileSync('cert.pem'), minVersion: 'TLSv1.2' },
  handler,
).listen(443);
```

See [lesson 12, example 11](../12-http-and-networking/examples/11-https-and-http2.js) for a runnable HTTPS server with a throw-away local certificate.

Practical points:

- In production, TLS is often **terminated** (ended) by a reverse proxy or load balancer (a server such as nginx that sits in front of Node and forwards requests), which then talks plain HTTP to Node on a private network. Either way, users must only ever see HTTPS.
- Certificates are free and automatic with Let's Encrypt (the ACME protocol). Renew before expiry.
- Redirect HTTP to HTTPS, send the HSTS header (section 11), and mark cookies `Secure`.
- Node checks server certificates by default when it acts as a **client** (`fetch`, `https.request`). **Never** switch that off in production with `rejectUnauthorized: false` or `NODE_TLS_REJECT_UNAUTHORIZED=0`. Anyone on the path could then impersonate the server. If you use a private CA, give Node the CA with the `ca` option instead.
- Services inside your network can use **mutual TLS (mTLS)**: both sides present certificates, so the server also authenticates the client.

> **Interview tip:** "Is HTTPS enough to be secure?" No. It protects data **in transit** only. It does nothing against XSS, injection, broken access control or a stolen database.

## 13. The crypto module tour

Example: [09-crypto-tour.js](examples/09-crypto-tour.js).

`node:crypto` wraps OpenSSL (the widely used C crypto library; the Node 24.16.0 used for this lesson reports OpenSSL 3.5.6). First, which tool for which job:

| I need to... | Use | Node API |
|---|---|---|
| Fingerprint data, check a download | A hash (SHA-256) | `crypto.createHash`, `crypto.hash` |
| Prove a message came from someone who knows a secret, and was not changed | HMAC | `crypto.createHmac` |
| Make an unguessable token, id or key | Secure random bytes | `randomBytes`, `randomUUID`, `randomInt` |
| Store a password | A slow password hash | `scrypt`, `argon2` (section 14) |
| Turn a password into a key, or one master key into several keys | Key derivation | `pbkdf2`, `scrypt`, `hkdf` (section 13.8) |
| Agree on a shared secret over a public network | Key agreement (Diffie-Hellman) | `generateKeyPairSync('x25519')`, `diffieHellman` (section 13.6) |
| Keep data secret and detect tampering | Authenticated encryption (AES-256-GCM) | `createCipheriv`, `createDecipheriv` |
| Let anyone verify "this came from me" | A digital signature | `generateKeyPairSync`, `sign`, `verify` |
| Compare two secrets | A constant-time compare | `timingSafeEqual` |

### 13.1 Hashing

**What it is.** A hash function turns any input into a fixed-size fingerprint. The same input always gives the same output, you cannot go backwards, and a tiny change gives a completely different result.

```js
crypto.createHash('sha256').update('hello').digest('hex');
crypto.hash('sha256', 'hello'); // one-call version (exists on Node 24)
```

```text
--- 1. hashing ---
sha256("hello")  = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
sha256("hellp")  = fdd7585e08c4e2afd71dcabdb4636c89d557a3f42db9e2040c8bbd1708aa4ce7 (one letter changed)
crypto.hash(...) = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824 (one-call version)
sha512 base64    = sha512-m3HSJL1i83hdltRq0+o9czGb... (npm lockfile "integrity" format)
```

Use SHA-256 or SHA-512 (or SHA-3). **MD5 and SHA-1 are broken** for security use (attackers can make two inputs with the same hash). The `integrity` field in `package-lock.json` is exactly this `sha512-...` base64 string of the package file, so a swapped tarball is detected.

A plain hash does not prove who made the data (anyone can compute it) and it is **not** a way to store passwords (section 14).

### 13.2 HMAC

**What it is.** HMAC is a hash that mixes in a **secret key**. Only someone with the key can produce the right value, so it proves both origin and integrity.

```js
crypto.createHmac('sha256', secretKey).update('amount=10').digest('hex');
```

```text
--- 2. HMAC ---
hmac(message, key)      = ca8dd7e9b4db9b0750008709...
hmac(changed, key)      = cd99ffe1ac476c9f3e0bc828...
hmac(message, other key)= 12819d2b4ae1464ab0e7b875...
```

Where you meet it: webhook signatures (a provider signs the body, you recompute and compare), signed cookies, JWT `HS256` (section 15), API request signing. Do not invent `sha256(secret + message)`: plain hashes of that shape can be extended by an attacker (a "length extension" attack). HMAC is built to avoid that.

### 13.3 Random values

Use `crypto.random*`, never `Math.random()`, for anything an attacker must not guess. `Math.random()` is fast but predictable. The `crypto` functions use the operating system's secure random generator.

```text
--- 3. random ---
randomBytes(16) hex length : 32 (16 bytes = 128 bits)
randomUUID() looks like    : xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
randomInt(1, 7) range      : 1 to 6
token for a URL            : 43 characters
```

- `randomBytes(n)` returns `n` random bytes. Encode with `'hex'` or `'base64url'` for tokens. 16 bytes (128 bits) is enough for a session id or reset token, 32 bytes is comfortable.
- `randomUUID()` gives a version 4 UUID (122 random bits).
- `randomInt(min, max)` gives an integer from `min` up to but **not including** `max`, without the bias you get from `Math.floor(random * n)` or `x % n`.

### 13.4 Comparing secrets: `timingSafeEqual`

`a === b` on strings stops at the first different character. A tiny difference in response time can tell an attacker how many leading characters were right (a **timing attack**). `crypto.timingSafeEqual(bufferA, bufferB)` takes the same time wherever the difference is. It needs two buffers of **equal length** and throws otherwise:

```js
function safeEqual(a, b) {
  // Hash both sides first: the results always have the same length, so the length is not leaked either.
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
```

```text
--- 4. timingSafeEqual ---
safeEqual("token-1", "token-1")  = true
safeEqual("token-1", "token-2")  = false
safeEqual("token-1", "a longer")  = false
raw call, different lengths     : ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH
```

Use it for HMAC values, API keys, tokens, CSRF tokens and password hashes.

### 13.5 Encrypting data: AES-256-GCM

**What it is.** AES is the standard symmetric cipher: the same key encrypts and decrypts. **GCM** is a mode that adds an **authentication tag**: a 16-byte seal that proves the data was not changed. Together this is **authenticated encryption** (AEAD): if anyone flips one bit, decryption fails instead of returning garbage.

Three things you must get right:

- **Key:** 32 random bytes for AES-256, kept in a key store, not in the code.
- **IV (nonce):** 12 random bytes, **new for every message** with the same key. Reusing an IV with the same key destroys GCM's security. The IV is not secret: store it next to the data.
- **Tag:** save it and give it back before decrypting.

```js
function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(12); // a NEW random IV for EVERY message
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]); // pack: iv (12) + tag (16) + ciphertext
}

function decrypt(packed, key) {
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const data = packed.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'); // final() throws on a bad tag
}
```

```text
--- 5. AES-256-GCM ---
same text, two encryptions differ : true
decrypt                           : card=4111-1111-1111-1111
decrypt after flipping one bit    : Unsupported state or unable to authenticate data
decrypt with the wrong key        : Unsupported state or unable to authenticate data
typeof crypto.createCipher        : undefined (the old no-IV API is gone)
```

Reading it: encrypting the same text twice gives different bytes because the IV differs. A flipped bit or a wrong key is caught by the tag check, with the same error message on purpose.

More to know:

- You can bind extra context with **AAD** (additional authenticated data): `cipher.setAAD(Buffer.from('user:42'))`. It is not encrypted but it is authenticated, so a token made for user 42 cannot be replayed as user 43. (Practice task 3.)
- Random 96-bit IVs are safe for a very large number of messages, but NIST limits a single key to about 2^32 of them. Rotate keys long before that.
- Avoid **ECB** mode (identical blocks give identical output, so patterns leak) and **CBC without a MAC** (attackers can modify data and use padding errors to decrypt). That is why GCM or `chacha20-poly1305` are the modern choices. The old `crypto.createCipher` (key straight from a password, no IV) was removed from Node.
- Big picture: encryption is easy, **key management** is hard. Where is the key stored, who can read it, how is it rotated? Real systems keep keys in a KMS (cloud key management service) and use **envelope encryption**: a data key encrypts the data, and a master key in the KMS encrypts the data key.

### 13.6 Key pairs and signatures

**What it is.** An **asymmetric** key pair has a private key (kept secret) and a public key (shared with everyone). The private key **signs**, the public key **verifies**. Anyone can check "this came from the owner of that private key and was not changed", yet nobody can forge it. HMAC cannot do that because the verifier must hold the same secret.

```js
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const signature = crypto.sign(null, message, privateKey); // Ed25519 chooses its own hash, so the algorithm is null
crypto.verify(null, message, publicKey, signature);       // true
```

```text
--- 6. sign and verify (Ed25519) ---
signature length                 : 64 bytes
verify original                  : true
verify changed message           : false
public key PEM starts with       : -----BEGIN PUBLIC KEY-----
```

- Good choices: **Ed25519** (small, fast, simple), **ECDSA with P-256**, or **RSA with 2048 bits or more** (3072 is better for long-lived keys). RSA signing takes a hash name: `crypto.sign('sha256', data, rsaPrivateKey)`.
- Key generation, especially RSA, is slow. In a server use the async `crypto.generateKeyPair` so the event loop is not blocked.
- Uses: JWT `RS256`/`ES256`/`EdDSA` (so API servers need only the public key), signed releases, webhooks where the receiver must not be able to forge the sender.
- Encrypting with a public key (`publicEncrypt`) only works for tiny messages. Real systems use **hybrid encryption**: agree on or encrypt a random AES key with the key pair (RSA-OAEP or ECDH), then encrypt the data with AES-GCM. TLS works this way.

**Key agreement (Diffie-Hellman).** This is how two sides who have never met get the same secret key over a public network. Each side makes a key pair and sends only its **public** key. Each then combines its own **private** key with the other side's public key, and both land on the same bytes. An eavesdropper sees only the public keys and cannot compute the secret. That shared secret then becomes the AES key. This is the "key exchange" step of the TLS handshake in section 12. `X25519` is the modern curve for it. (A signature, on the other hand, proves who sent something. Key agreement alone does not prove who you are talking to, which is why TLS also uses certificates.)

```text
--- 7. key agreement (X25519) ---
shared secret length              : 32 bytes
both sides computed the same bytes: true
```

### 13.7 WebCrypto at a glance

`crypto.subtle` (global `crypto` in Node, the same API browsers have) is the standard promise-based interface. Use it when code must run in both a browser and Node. On Node 24 the global `crypto` is the same object as `require('node:crypto').webcrypto`.

```js
const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('hello'));
const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); // false: cannot be exported
const iv = crypto.getRandomValues(new Uint8Array(12));
const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('secret note'));
```

```text
--- 8. WebCrypto (crypto.subtle) ---
subtle sha256("hello") = 2cf24dba5fb0a30e... (same as section 1)
subtle AES-GCM round trip = secret note | key extractable: false
```

The SHA-256 matches `createHash`, so both APIs are the same algorithm underneath. WebCrypto's special feature is the **non-extractable key**: the key object can encrypt but the raw bytes can never be read back by your code. `node:crypto` has more features (`scrypt`, incremental hashing, streams), WebCrypto is more portable.

### 13.8 Deriving keys: `pbkdf2`, `scrypt` and `hkdf`

**What it is.** **Key derivation** produces a key from other input. There are two different jobs, and mixing them up is a classic mistake:

| Job | Input | Tool | Why |
|---|---|---|---|
| Key from a **human password** | A weak, guessable secret | `scrypt`, `argon2`, `pbkdf2` (slow on purpose, with a salt) | Makes each guess expensive |
| Many keys from one **strong random key** | A 32-byte random master key | `hkdf` (fast) | Gives each purpose its own key (**key separation**), so the cookie-signing key and the encryption key are different |

`pbkdf2` repeats HMAC many times. It is not memory-hard, so GPUs attack it better than they attack `scrypt` or argon2, but it is everywhere and FIPS-approved, so you still meet it. OWASP's Password Storage Cheat Sheet lists 600,000 iterations for PBKDF2 with HMAC-SHA-256 (check the current figure). Like `scrypt`, use the async version, which runs on the libuv thread pool. `hkdf` is **not** for passwords: it is fast and adds no cost for a guesser.

```js
const key = await promisify(crypto.pbkdf2)('correct horse', salt, 600_000, 32, 'sha256'); // password, salt, iterations, length, digest
const cookieKey = Buffer.from(crypto.hkdfSync('sha256', masterKey, '', 'cookie-signing', 32)); // returns an ArrayBuffer
```

```text
--- 9. key derivation (pbkdf2 and hkdf) ---
pbkdf2 same inputs, same key      : true (it is deterministic, so store the salt)
pbkdf2 other salt, other key      : true
pbkdf2 derived key length         : 32 bytes
hkdf same purpose, same key       : true
hkdf other purpose, other key     : true
```

Reading it: derivation is **deterministic**: the same password, salt and settings always give the same key. That is what lets you verify a password later. A different salt gives a completely different key, so equal passwords do not give equal results.

### 13.9 Never invent your own crypto

> **Remember:** designing a cipher, a token format or a protocol yourself is how serious breaches happen. Experts review algorithms for years. Use the standard pieces as documented.

In practice:

- Use authenticated encryption (AES-256-GCM, ChaCha20-Poly1305), never raw AES, never ECB.
- Never reuse an IV with the same key. Never use a fixed or counter-from-zero IV that restarts.
- Never use `Math.random()`, the current time, or a user id as a secret.
- Never hash passwords with a fast hash. Never build your own "hash(secret + data)" signature (use HMAC).
- Never put keys in source code. Never use MD5 or SHA-1 for security.
- Prefer a well-reviewed higher-level library or a managed service (KMS, an identity provider) over assembling primitives yourself.

> **Interview tip:** a good way to show depth: "Hash for fingerprints, HMAC for shared-secret integrity, AES-GCM for confidentiality plus integrity, signatures when the verifier must not be able to forge, and a slow salted hash for passwords. And never reuse an IV."

## 14. Passwords

Example: [10-passwords-and-access.js](examples/10-passwords-and-access.js) (parts A and B).

**What it is.** How to store and check a password so that a stolen database does not reveal the passwords.

**Why it matters.** Databases leak. People reuse passwords across sites, so your leak becomes an attack on other services. The goal is to make each guess as expensive as possible for the attacker.

The rules:

1. **Never store the password in plain text.** Never encrypt it either (encryption can be reversed, and the key is found with it).
2. **Store a slow, salted hash.**
3. **Compare in constant time.**
4. **Use a different random salt per password.**

Why not SHA-256? It is built to be fast. A fast hash lets an attacker try billions of guesses per second on a graphics card. A **password hash** is built to be slow and to need a lot of memory, which makes mass guessing expensive. And without a **salt** (random bytes stored with the hash), two users with the same password get the same hash, and attackers can use pre-computed tables. Output of part A1 (timings differ on your machine):

```text
--- A1. why a plain fast hash is the wrong tool ---
two users, same password, no salt : true (equal hashes reveal equal passwords)
two users, same password, salted  : false
SHA-256 : 20000 guesses took 80 ms
scrypt  : 1 guess took 90 ms
scrypt is more than 1000 times slower per guess: true
```

On this run one scrypt hash cost about as much as 20000 SHA-256 hashes. That is the point: one login is cheap, a billion guesses are not.

### 14.1 scrypt with the core module

`crypto.scrypt` is a memory-hard password hash built into Node. Its three cost settings: `N` (CPU and memory cost, a power of two), `r` (block size, 8) and `p` (parallelism, 1). Memory use is about `128 * N * r` bytes: 16 MiB for N = 16384. Node's default `maxmem` is 32 MiB, so raise `maxmem` when you raise `N`.

```js
const COST = { N: 2 ** 14, r: 8, p: 1 }; // production: raise N (and maxmem) as far as your servers can afford

async function hashPassword(password) {
  const salt = crypto.randomBytes(16); // unique per password, stored in the open
  const hash = await scrypt(password.normalize('NFKC'), salt, 64, COST);
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const [alg, N, r, p, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(actual, expected);
}
```

Design notes:

- The stored string is **self-describing**: algorithm, cost and salt travel with the hash. Later you can raise the cost, verify old records with their old settings, and **re-hash on the next successful login**.
- `normalize('NFKC')` makes the same typed password match even if a device composes accented characters differently.
- Always use the **async** version (`crypto.scrypt`, wrapped with `promisify`). It runs on the libuv thread pool (4 threads by default), so the event loop is not blocked. `scryptSync` in a request handler freezes every other request.
- Because hashing is slow on purpose, a flood of login attempts can use up the thread pool. Rate-limit logins (section 10).

```text
--- A2. scrypt with a salt ---
stored record  : scrypt$16384$8$1$zCyCGlM9...$kSz97dA5...
right password : true
wrong password : false
same password hashed twice gives different records: true
argon2id (19 MiB, 2 passes) tag length: 32 bytes
```

(The salt and hash change on every run; the example prints only the first eight characters of each.)

### 14.2 argon2 and bcrypt

| Algorithm | Notes |
|---|---|
| **argon2id** | The modern recommendation: memory-hard and resists GPU attacks. Node has `crypto.argon2` and `crypto.argon2Sync` since 24.7.0, marked release candidate (1.2) in the 24.16 docs. Parameters: `message` (the password), `nonce` (the salt, at least 8 bytes, 16 recommended), `parallelism`, `tagLength`, `memory` (in KiB) and `passes`. The last line of the output above ran it with 19456 KiB (19 MiB) and 2 passes |
| **scrypt** | Memory-hard, in core for a long time. A solid choice with no extra packages |
| **bcrypt** | Old and trusted. A cost factor (work factor) sets the speed. It only reads the first 72 bytes of the password. Needs `bcrypt` (native addon) or `bcryptjs` (pure JavaScript) |
| **PBKDF2** | Not memory-hard, so weaker against GPUs. Used when a standard such as FIPS requires it. Needs a very high iteration count |

OWASP's Password Storage Cheat Sheet prefers argon2id, then scrypt, with bcrypt for legacy systems and PBKDF2 when FIPS compliance is required. Its minimum settings at the time of writing: argon2id with 19 MiB of memory, 2 passes and 1 lane (the settings the example uses); scrypt with `N = 2^17`, `r = 8`, `p = 1` (128 MiB, much higher than the example's `N = 2^14`, which is kept small so the demo is fast); bcrypt with a work factor of at least 10; PBKDF2-HMAC-SHA-256 with 600,000 iterations. Check the current page, because the numbers move with hardware.

A **pepper** is an extra secret key, kept outside the database (in a secret manager), that is mixed into every hash. If only the database leaks, the attacker also lacks the pepper. It is optional defence in depth: it adds nothing if the pepper leaks with the database, and rotating it is awkward. `crypto.argon2` has a `secret` parameter for it.

```js
// Needs: npm install bcrypt   (illustrative)
const bcrypt = require('bcrypt');
const hash = await bcrypt.hash(password, 12);   // salt is generated and stored inside the hash string
const ok = await bcrypt.compare(password, hash); // constant-time compare inside
```

### 14.3 Login and brute-force protection

Part B of the example logs users in and locks an account after 3 failed attempts. A fake clock moves time forward, so there is no 15-minute wait.

```text
--- B. login with a lock after 3 failures ---
nobody / guess1                        -> invalid username or password
ann / guess1                           -> invalid username or password
ann / guess2                           -> invalid username or password
ann / guess3                           -> invalid username or password
ann / correct horse battery staple     -> too many attempts, try again later
ann / correct horse battery staple     -> logged in
```

The details that matter:

- **One message for both cases.** "Unknown user" and "wrong password" look the same. Otherwise attackers learn which accounts exist (**user enumeration**).
- **Same work for both cases.** For an unknown user the code still verifies against a dummy hash, so the response time does not give the user away either.
- **Lock or delay.** After repeated failures, refuse for a while, or add a growing delay. Trade-off: a hard lock lets an attacker deliberately lock a victim out. Combine it with a rate limit per IP, a CAPTCHA after a few failures, a notification to the owner, and **multi-factor authentication (MFA)** such as TOTP codes or passkeys.
- **Password rules.** Current guidance (NIST SP 800-63B-4) says: do not force symbol or mixed-case rules, do not force regular changes (force one only after a known leak), check new passwords against a list of common and breached passwords, accept at least 64 characters, and allow paste and password managers.
- **Reset flow.** Reset tokens are random (16 bytes or more), stored as a **hash** like passwords, single-use, short-lived, and the page never reveals whether an email exists. After a reset, end all other sessions.

> **Common mistake:** hashing the password with SHA-256 "and a salt" and calling it done, or comparing hashes with `===`. Use a slow password hash and `timingSafeEqual`.

> **Interview tip:** "How do you store passwords?" Strong answer: a unique random salt per user, a slow memory-hard hash (argon2id, or scrypt or bcrypt), settings stored with the hash so you can raise them and re-hash at the next login, a constant-time compare, the same error and the same work for unknown users, and rate limiting plus MFA on top. If they ask "why not encrypt them?", say encryption can be reversed and the key lives next to the data.

## 15. Sessions versus JWT

Example: [11-jwt-by-hand.js](examples/11-jwt-by-hand.js).

After login the server must recognise the user on later requests. There are two common designs.

**Session (stateful).** The server stores the login state (in memory, Redis or a database) under a random **session id**, and gives the browser a cookie that holds only the id. On each request the server looks the id up.

**JWT (stateless).** The server puts the **claims** (the facts about the login: user id, role, expiry) in a **signed token** and gives it to the client. On each request the server checks the signature and trusts the claims. No lookup. A JWT is a **bearer token**: whoever holds it can use it, like cash, so a stolen token is as good as the real login until it expires.

| | Session cookie | JWT |
|---|---|---|
| Where the data lives | On the server | Inside the token, on the client |
| Logout / revoke | Delete the server record: instant | Hard: the token stays valid until `exp` unless you keep a deny-list (which makes it stateful again) |
| Scaling | Needs a shared store (Redis) across servers | No store needed to verify |
| Size per request | Tiny id | A few hundred bytes to kilobytes |
| Change a user's role | Effective immediately | Old tokens keep the old role until they expire |
| Best for | Browser apps with their own backend | Short-lived tokens between services, APIs used by third parties, OAuth/OIDC |
| Main risk | CSRF (cookie sent automatically), session fixation | Stolen token is a bearer key, bad verification code, long lifetimes |

> **Interview tip:** the mature answer is "it depends, and JWT is not a session replacement". For a normal web app, server-side sessions with a secure cookie are simpler and safer, because you can revoke them. Use JWTs when you need stateless verification across services, with short lifetimes.

### 15.1 A JWT by hand

A JWT has three parts, joined by dots: `header.payload.signature`. Each part is **base64url** text (base64 using `-` and `_` instead of `+` and `/`, and no `=` padding). The signature of `HS256` is an HMAC-SHA256 over `header.payload`.

```js
function signHS256(claims, secret, { expiresInSec = 900, now = Date.now() } = {}) {
  const iat = Math.floor(now / 1000);
  const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeJson({ ...claims, iat, exp: iat + expiresInSec });
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}
```

And the strict check:

```js
function verifyHS256(token, secret, { now = Date.now(), revoked = new Set() } = {}) {
  const [h, p, s] = token.split('.');                    // (length and JSON errors are handled in the full example)
  const header = decodeJson(h);
  if (header.alg !== 'HS256') throw new Error('algorithm not accepted');   // OUR code decides the algorithm
  const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest();
  const given = Buffer.from(s, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new Error('bad signature');
  const claims = decodeJson(p);
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) throw new Error('token expired');
  if (revoked.has(claims.jti)) throw new Error('token revoked');
  return claims;
}
```

```text
--- 1. sign and look inside ---
token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhbm4iLCJyb2xlIjoidXNlciIsImp0aSI6InRvay0xIiwiaWF0IjoxODkzNDk5MjAwLCJleHAiOjE4OTM1MDAxMDB9.402X_31VH9zfi8FVCJOG_-hfGMqUwsh6yvVd3KJjZgM
header : {"alg":"HS256","typ":"JWT"}
payload: {"sub":"ann","role":"user","jti":"tok-1","iat":1893499200,"exp":1893500100} <- readable by anyone, so never put secrets in it

--- 2. verify ---
valid token                        -> {"sub":"ann","role":"user","jti":"tok-1","iat":1893499200,"exp":1893500100}
wrong secret                       -> REJECTED: bad signature
15 minutes + 1 second later        -> REJECTED: token expired
revoked jti                        -> REJECTED: token revoked
```

(The example uses a fixed clock, so the token is the same on every run.)

Reading it: the payload is only encoded, **not encrypted**. Anyone can paste a JWT into a decoder and read it. The signature protects against **changes**, not against reading. (There is a separate standard, JWE, for encrypted tokens.) The standard claims: `iss` (issuer), `sub` (subject, the user), `aud` (audience, who the token is for), `exp` (expiry), `nbf` (not before), `iat` (issued at), `jti` (token id).

### 15.2 The attacks interviewers ask about

**1. Edit the payload.** Change `role` to `admin` and keep the old signature. The HMAC no longer matches:

```text
--- 3. attack: edit the payload ---
role changed, old signature        -> REJECTED: bad signature
```

**2. The `alg: none` attack.** The JWT spec allows `"alg": "none"` (an unsigned token). A naive library that believes the token's own header will accept a forged token with no signature at all:

```text
--- 4. attack: alg "none" ---
naive verifier, alg none           -> {"sub":"ann","role":"admin"}
strict verifier, alg none          -> REJECTED: algorithm "none" is not accepted
```

**3. Algorithm confusion.** An API verifies `RS256` tokens with its **public** key. A naive verifier reads `alg` from the token and uses "the key" for whatever algorithm it says. The attacker, who knows the public key (it is public), makes an `HS256` token and uses the public key text as the HMAC secret. The server then verifies with HMAC using that same key, and the forged token passes:

```text
--- 5. attack: algorithm confusion (RS256 server, HS256 token) ---
honest RS256 token (naive)         -> {"sub":"ann","role":"user"}
confusion token (naive)            -> {"sub":"ann","role":"admin"}
confusion token (strict)           -> REJECTED: only RS256 is accepted
```

The fix for attacks 2 and 3 is the same: **the server decides which algorithm is allowed**, never the token. In `jsonwebtoken` that is the `algorithms` option.

**4. Weak secret.** An HS256 token can be attacked offline: take one token and try millions of guesses for the secret. No server is involved, so rate limits cannot help:

```text
--- 6. attack: guess a weak secret offline ---
attacker with only the token found the secret: "secret"
```

Use a random secret of at least 32 bytes (256 bits) from a secret store, never a word.

```js
// Needs: npm install jsonwebtoken   (illustrative)
const jwt = require('jsonwebtoken');
const token = jwt.sign({ sub: 'ann', role: 'user' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '15m', issuer: 'my-app', audience: 'my-api' });
const claims = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'], issuer: 'my-app', audience: 'my-api' });
// jwt.decode(token) only DECODES. It does NOT check the signature. Never use it to make decisions.
```

More pitfalls to list in an interview:

- **No expiry, or a very long one.** A stolen token works until it expires. Use 5 to 15 minutes for access tokens.
- **Not checking `exp`, `iss` and `aud`.** A token meant for another service, or an old token, must be rejected. Allow only a small clock-skew leeway.
- **Trusting `kid` blindly.** The `kid` header says which key to use. Use it only as a lookup key into your own key list, never as a file path or a SQL value.
- **Secrets in the payload.** It is readable.
- **Treating a JWT as a session.** You cannot log it out (below).

### 15.3 Where to store a token in the browser

| Storage | Read by JavaScript? | Sent automatically? | Main risk |
|---|---|---|---|
| `localStorage` / `sessionStorage` | Yes | No | **XSS** steals it. Any script on the page can read it |
| `HttpOnly` cookie | No | Yes | **CSRF** (fix with `SameSite` and tokens, section 11) |
| In memory (a JS variable) | Yes, but only from your code | No | Lost on page reload, so pair it with a refresh cookie |

The common safe pattern: keep the refresh token in an `HttpOnly; Secure; SameSite` cookie, and keep the short access token in memory.

### 15.4 Revocation and refresh tokens

A stateless token cannot be taken back. Options: keep tokens **short-lived**; keep a small **deny-list** of revoked `jti` values until they expire (shown above as "revoked jti"); or change the signing key (logs out everyone).

The standard pattern is two tokens:

- **Access token:** short (about 15 minutes), sent with each API call.
- **Refresh token:** long-lived, **opaque** (random bytes, not a JWT), stored on the server as a **hash**, used only to get a new access token. With **rotation**, every use returns a new refresh token and invalidates the old one. If an old one is presented again, someone copied it, so revoke the whole family.

```text
--- 7. refresh token rotation ---
first use  -> new access token: true | new refresh token: true
old refresh token used again       -> REJECTED: refresh token reuse detected, all sessions revoked
the new one, after the alarm       -> REJECTED: unknown refresh token
```

## 16. OAuth 2.0, OpenID Connect and PKCE

Example: [11-jwt-by-hand.js](examples/11-jwt-by-hand.js) (part 8).

**What it is.** **OAuth 2.0** is a standard for **delegated authorization**: it lets app X act for a user at service Y without ever seeing the user's password ("Sign in with Google" style flows, or "let this app read my calendar"). **OpenID Connect (OIDC)** is a thin layer on top that adds **identity**: it tells the app who just logged in. Short version: OAuth is about **access**, OIDC is about **login**.

The four roles:

- **Resource owner:** the user.
- **Client:** your app.
- **Authorization server:** where the user logs in and approves, and which issues tokens (Google, Auth0, Okta, Keycloak, Microsoft Entra ID).
- **Resource server:** the API that accepts access tokens.

The flow to know is the **authorization code flow with PKCE**. PKCE (Proof Key for Code Exchange, said "pixie") is now recommended for all clients, not only mobile and single-page apps.

```mermaid
sequenceDiagram
    participant U as User (browser)
    participant A as Your app (client)
    participant S as Authorization server
    participant R as Your API (resource server)
    A->>A: 1. create code_verifier (random) and code_challenge = SHA-256 of it
    A->>U: 2. redirect to /authorize with client_id, redirect_uri, scope, state, code_challenge
    U->>S: 3. browser opens /authorize
    S->>U: 4. login page and consent screen
    U->>S: 5. user signs in and approves
    S->>U: 6. redirect back to redirect_uri with code and state
    U->>A: 7. browser delivers code and state to your app
    A->>A: 8. check that state equals the saved value
    A->>S: 9. POST /token with code and code_verifier
    S->>S: 10. check SHA-256 of verifier equals the saved code_challenge
    S->>A: 11. access_token, id_token (OIDC) and refresh_token
    A->>R: 12. API call with Authorization Bearer access_token
```

Step by step:

1. The app invents a secret `code_verifier` and computes `code_challenge = base64url(SHA-256(code_verifier))`.
2. It sends the user to the authorization server with the challenge, a random `state` (a value the app saves and expects to get back, which ties the answer to this request) and a `scope` (the list of permissions it asks for, such as reading the profile). For OIDC the scope includes `openid`.
3. The user logs in **at the authorization server**. Your app never sees the password.
4. The server redirects back with a short-lived, single-use **authorization code**. The code travels through the browser, which is exposed, so it is worth nothing alone.
5. The app checks `state` (this blocks CSRF on the redirect), then exchanges the code for tokens at the `/token` endpoint, sending the original `code_verifier`.
6. The server hashes the verifier and compares it with the challenge from step 2. A thief who stole only the code cannot finish, because they do not have the verifier.

```text
--- 8. PKCE ---
code_verifier length : 43 (allowed: 43 to 128)
code_challenge       : 43 characters, method S256
token request with the right verifier : true
token request from a code thief       : false
```

The three tokens:

| Token | Purpose | Who reads it |
|---|---|---|
| **Access token** | Call the API on the user's behalf | The API (resource server). Short-lived |
| **ID token** (OIDC) | Tells the **client** who logged in. A JWT with `sub`, `iss`, `aud`, `exp` and a `nonce` | Your app. Never send it to an API as a credential |
| **Refresh token** | Get new access tokens | The authorization server only |

Checking an ID token means: verify the signature with the provider's public keys (published as a **JWKS**, a JSON Web Key Set, at a URL found through the discovery document `/.well-known/openid-configuration`), then check `iss`, `aud`, `exp` and the `nonce` (a random value your app sent at the start and must find inside the token, which stops an old token from being replayed).

Rules of thumb:

- Redirect URIs must match **exactly** (a loose match lets attackers steal codes).
- Do not use the old **implicit flow** (tokens straight in the URL) or the password grant. Current guidance (RFC 9700, "Best Current Practice for OAuth 2.0 Security", January 2025) tells you to use the code flow with PKCE.
- **Client credentials** is the flow for machine-to-machine calls with no user.
- Use a maintained library or a managed identity provider (for example Passport, `openid-client`, Auth.js). Do not write your own authorization server.
- Standards to look up: RFC 6749 (OAuth 2.0), RFC 7636 (PKCE), RFC 7519 (JWT), RFC 8725 (JWT best practices), RFC 9700 (OAuth security).

> **Interview tip:** "Why PKCE?" Answer: "the authorization code passes through the browser and can be intercepted. PKCE binds the code to the app instance that started the flow with a one-time secret, so a stolen code is useless."

## 17. Authorization: IDOR, RBAC and ABAC

Example: [10-passwords-and-access.js](examples/10-passwords-and-access.js) (part C).

**Authentication** asks "who are you?". **Authorization** asks "what are you allowed to do?". Broken access control is the number one risk in the OWASP Top 10, because the mistake is easy: the endpoint checks that you are logged in but not that this record is yours.

That mistake has a name: **IDOR** (Insecure Direct Object Reference). `GET /posts/2` returns post 2 to anyone logged in, so a user just changes the number in the URL.

```text
--- C. access control ---
IDOR, broken : ann reads post 2 -> "Bob secret draft"
IDOR, fixed  : ann reads post 2 -> null
IDOR, fixed  : ann reads post 1 -> "Ann draft"
RBAC         : editor may post:write = true | viewer may post:write = false
ABAC         : ann edits her draft at 10:00 = true
ABAC         : ann edits her draft at 22:00 = false
ABAC         : ann edits a sport draft      = false
```

Rules:

- Check authorization **on the server, on every request, for the specific object**. Hiding a button in the UI is not a check.
- **Deny by default.** Add a permission on purpose.
- Keep the rules in one policy function, not scattered across handlers, and write tests for the "must be denied" cases.
- Take the user's identity from the verified session or token, never from a field in the request body (`{"userId": 5}`).
- Returning `404` instead of `403` for other people's objects avoids confirming that an id exists.

Two common models:

| | RBAC (role-based) | ABAC (attribute-based) |
|---|---|---|
| Idea | Users have roles, roles have permissions | Rules use attributes of the user, the object and the situation |
| Example | `editor` may `post:write` | "the author, or an editor of the same department, may edit a draft during work hours" |
| Strength | Simple, easy to explain and audit | Fine-grained and context-aware |
| Weakness | **Role explosion** as exceptions grow; cannot say "only their own" | Harder to reason about and test; needs good tooling |

Real systems mix them: roles for the broad picture, attribute checks (like ownership) for the detail. A related model is relationship-based access control (who is related to what, as in file-sharing apps), and policy engines such as OPA or Cedar-style engines when the rules grow.

Also related: **mass assignment** (section 3) and trusting a `role` field that the client can edit. Vertical escalation means a user gaining admin powers, horizontal escalation means a user reaching another user's data.

> **Interview tip:** "What is the most common API security bug?" Say broken object-level authorization, also called IDOR: the endpoint checks that you are logged in but not that the record is yours. The fix is an ownership check on the server, using the identity from the verified token or session, on every request, with deny by default. For "RBAC or ABAC?", say start with RBAC for the broad picture and add attribute checks (ownership, department, time) where roles alone are too coarse.

## 18. Secrets management and safe logging

Example: [12-secrets-and-permissions.js](examples/12-secrets-and-permissions.js) (part 1).

A **secret** is anything that grants access: passwords, API keys, tokens, signing keys, private keys, encryption keys, and connection strings (they contain a password).

Rules:

- **Never put a secret in source code or in git.** Git history is forever and copied everywhere.
- Add `.env` and key files to `.gitignore`, and commit a `.env.example` with fake values so people know what to set:

```gitignore
# .gitignore
.env
.env.*
!.env.example
*.pem
*.key
```

- **If a secret leaks, rotate it immediately.** Deleting the commit is not enough, since clones and caches exist. Secret scanners (gitleaks, trufflehog, GitHub push protection) catch many leaks before they land.
- Load secrets from the environment or a secret manager, not from constants. Fail at start-up when one is missing. **Never fall back to a default secret** (`process.env.JWT_SECRET || 'dev'` ends up in production).

Node's own helpers (the flag is stable since 24.10.0):

```bash
node --env-file=.env server.js
```

```js
process.loadEnvFile('.env');                          // load a file from code (does not override variables already set)
const values = util.parseEnv('A=1\nB=2');             // parse KEY=value text: { A: '1', B: '2' }
```

A variable that is already set in the shell wins over the file, and `--env-file` is not allowed inside `NODE_OPTIONS`. Environment variables are convenient but leaky: child processes inherit them, they show up in crash reports and container inspection. For high-value secrets use a **secret manager** (HashiCorp Vault, AWS Secrets Manager, Google Secret Manager, Kubernetes secrets or mounted files) that gives access control, audit logs and rotation.

**Rotation** means replacing secrets regularly and after any incident. Design for it: support two valid keys at the same time (a key id, `kid`, tells you which one a token used), so you can add a new key, switch writing to it, and retire the old key later. Practice task 3 builds this.

### 18.1 Logging without leaking

Logs are a favourite place for secrets to leak: they are copied to many systems and kept for months. The example makes leaks hard in two ways.

**A wrapper that refuses to print.** `Secret` hides its value from `console.log`, `JSON.stringify` and template strings. You must call `.reveal()` on purpose.

**A redaction function** for objects you log (headers, bodies, error contexts) that masks sensitive keys and `Bearer` tokens.

```text
--- 1. secrets in config and logs ---
console.log(config)   : { DATABASE_URL: [REDACTED], API_KEY: [REDACTED], JWT_SECRET: [REDACTED], PORT: '3000' }
JSON.stringify(config): {"DATABASE_URL":"[REDACTED]","API_KEY":"[REDACTED]","JWT_SECRET":"[REDACTED]","PORT":"3000"}
template string       : key is [REDACTED]
on purpose, .reveal() : sk_live...
missing settings      : missing required setting DATABASE_URL
redacted request log  : {"method":"POST","url":"/login","headers":{"authorization":"[REDACTED]","cookie":"[REDACTED]","user-agent":"curl/8"},"body":{"user":"ann","password":"[REDACTED]","note":"sent Bearer [REDACTED] by mistake"}}
```

With a logging library the same idea is a setting:

```js
// Needs: npm install pino   (illustrative)
const logger = require('pino')({
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
});
```

What to log and what never to log:

| Log this | Never log this |
|---|---|
| Logins (success and failure) with user id, IP, time | Passwords, even wrong ones |
| Permission denied, password changes, role changes | Tokens, API keys, session ids, full cookies |
| A request id on every line, so one request can be followed | Full card numbers, national ids, other personal data |
| Rate limit hits, validation failures at the edge | Whole request bodies or all headers by default |

More logging rules:

- Use **structured (JSON) logs**. User text with newlines can forge fake log lines in plain-text logs (**log injection**). JSON escapes them.
- Keep secrets out of URLs and query strings. Proxies and browsers log URLs.
- Return a **generic error** to the client plus a request id, and keep the stack trace in the log only. Express shows stack traces unless `NODE_ENV` is `production`.
- Logging is only useful if someone looks: alert on spikes of failed logins and `403` responses. (This is OWASP "Logging and Alerting Failures".)

> **Interview tip:** "A key was committed to git. What now?" Strong answer: treat it as stolen, so **rotate it first** (issue a new one, deploy it, revoke the old one), then check logs for misuse, then clean the history and add a secret scanner or push protection so it cannot happen again. Removing the commit alone is not a fix, since clones and caches exist.

## 19. Supply chain security

**What it is.** Your app runs your code plus code from hundreds of npm packages (a typical project has many more indirect dependencies than direct ones). Each one runs with your app's privileges. A **supply chain attack** goes through them.

Typical attacks:

- **Typosquatting:** a malicious package named like a popular one (`expresss`).
- **Dependency confusion:** an internal package name is also published publicly with a higher version, and the build installs the public one.
- **Account takeover:** a maintainer's account is stolen and a bad version is published.
- **Install scripts:** `preinstall` and `postinstall` scripts run arbitrary code on every `npm install`.

Practices:

| Practice | Command or detail |
|---|---|
| Commit the lockfile and install from it | `npm ci` installs exactly what `package-lock.json` says and fails if it disagrees with `package.json`. Use it in CI and in Docker builds |
| Lockfile integrity | Each lockfile entry has a `sha512` hash of the package file (section 13.1), so a swapped file is detected |
| Check for known vulnerabilities | `npm audit` compares your tree with the advisory database. Read the result and fix by upgrading. Do not run `npm audit fix --force` blindly (it can jump major versions). It only knows **known** problems, not brand-new malware |
| Verify provenance | `npm audit signatures` verifies registry signatures and provenance attestations (signed proof of where and how a package was built) of installed packages |
| Stop install scripts | `npm ci --ignore-scripts`, or `npm config set ignore-scripts true`. A few packages (native addons) need their build script, so run those steps on purpose |
| Review before adding | Who maintains it? How old, how popular, when was the last release, how many dependencies does it bring? Does Node already do it (see below)? |
| Keep few dependencies | Every package is attack surface. Remove unused ones |
| Update steadily | Use Dependabot or Renovate to open small pull requests. Read the changelog. Do not stay years behind, because old versions collect unpatched bugs |
| Protect accounts | 2FA on npm and GitHub, scoped package names for private code, and a registry setting that sends your private scope only to your private registry |
| Protect CI | Give CI tokens minimal rights. Do not expose secrets to builds of pull requests from forks |
| Run a supported Node | Node 18 and 20 are end of life, Node 24 is in Maintenance LTS until its end of life on 2028-04-30, and Active LTS is Node 26. Install security patch releases |

Many old dependencies are now built in, which removes risk: `fetch` instead of `node-fetch` or `axios`, `crypto.randomUUID()` instead of `uuid`, `node --env-file` instead of `dotenv`, `node --watch` instead of `nodemon`, `node:test` for basic tests, `crypto.scrypt` for passwords.

> **Interview tip:** "How would you protect your project from a malicious package?" Strong answer: lockfile plus `npm ci`, `--ignore-scripts`, `npm audit` in CI, few dependencies, review new ones, update through small reviewed pull requests, and least-privilege CI and runtime so a bad package can do less damage.

## 20. The Node permission model, least privilege and non-root

Example: [12-secrets-and-permissions.js](examples/12-secrets-and-permissions.js) (parts 2 and 3).

### 20.1 The permission model

**What it is.** A way to start Node so that the whole process can only touch what you allow. It limits file access, child processes, workers, native addons, WASI and the inspector. The Node docs call it a **"seat belt"**: it stops trusted code from accidentally using resources it should not. It does **not** protect against malicious code.

**Status on Node 24.** The model is **stable** (stability 2) since 22.13.0 and 23.5.0, and it is enabled with `--permission`. The old flag name `--experimental-permission` is rejected on Node 24 (`bad option`).

| Flag | What it allows |
|---|---|
| `--permission` | Turns the model on. Everything below is denied until you allow it |
| `--allow-fs-read=<path>` | Reading under that path. Repeat the flag for several paths, `*` for everything. The entry script is readable without being listed |
| `--allow-fs-write=<path>` | Writing under that path (`*` for everything) |
| `--allow-child-process` | Starting child processes |
| `--allow-worker` | Creating worker threads |
| `--allow-addons` | Loading native addons (compiled C++ modules) |
| `--allow-wasi` | Using WASI (the WebAssembly System Interface) |
| `--allow-inspector` | The inspector (debugger) |

The sub-flags for child processes, workers, addons and WASI are marked 1.1 (active development), and the inspector flag 1.0. Each of `--allow-child-process`, `--allow-worker`, `--allow-addons` and `--allow-inspector` prints a `SecurityWarning` such as "The flag --allow-child-process must be used with extreme caution. It could invalidate the permission model."

**There is no network permission on Node 24.** `--allow-net` is a `bad option` here. It arrives in Node 25.0.0 and is marked 1.1 in the Node 26 docs. On Node 24, `--permission` does **not** stop `fetch` or sockets.

The example starts with the flags (in its `@flags` header line), so from the repo root:

```bash
node --permission --allow-fs-read=lessons/20-security-and-crypto/examples lessons/20-security-and-crypto/examples/12-secrets-and-permissions.js
```

If you run it without the flags it restarts itself with them. Output of the permission parts:

```text
--- 2. permission model ---
has fs.read  (examples dir)   : true
has fs.read  (repo root)      : false
has fs.write (examples dir)   : false
has child / worker            : false / false
read a sibling example file      -> // Input validation (allow-lists, a ...
read ../../../package.json       -> DENIED ERR_ACCESS_DENIED | permission: FileSystemRead
write a file in the temp folder  -> DENIED ERR_ACCESS_DENIED | permission: FileSystemWrite
run a child process              -> DENIED ERR_ACCESS_DENIED | permission: ChildProcess
start a worker thread            -> DENIED ERR_ACCESS_DENIED | permission: WorkerThreads

--- 3. what it does NOT cover on Node 24 ---
fetch under --permission      : network is still open
```

Reading it:

- `process.permission` exists only when the flag is on. `process.permission.has('fs.read', somePath)` (also `'fs.write'`, `'child'`, `'worker'`) tells you what is allowed.
- A denied call throws an error with `code: 'ERR_ACCESS_DENIED'` and a `permission` property (`FileSystemRead`, `FileSystemWrite`, `ChildProcess`, `WorkerThreads`).
- Reading a sibling example worked because its folder was allowed. The same code reading `package.json` outside that folder was denied.

Limits to state honestly:

- It checks the `node:fs` APIs. The docs say it does not guarantee file access cannot happen by other means, for example through the `node:sqlite` module, and that using a file descriptor that was already open bypasses it. Flags such as `--env-file` read their files before the model starts, so they are not checked either.
- If the folder you allow exists, Node treats it as `folder/*` (everything below it). To allow a folder that does not exist yet, write the `/*` yourself.
- Not a sandbox for hostile code. Malicious code can bypass it. For untrusted code use OS-level isolation (containers, separate low-privilege OS users). The `node:vm` module is not a security mechanism either (its docs say so).
- Symbolic links are followed even to places outside the allowed paths (the docs single out relative links), so make sure allowed folders contain no links that point elsewhere.
- No network control on Node 24 (above).

> **Interview tip:** "Does the Node permission model make it safe to run untrusted code?" No. Answer: it is a seat belt for code you trust but want to confine (a build tool, a script that should only read one folder), not a sandbox. For hostile code use OS-level isolation such as a container or a separate low-privilege user. Add that on Node 24 it has no network switch, so `fetch` still works.

### 20.2 Least privilege and non-root

**Least privilege** means every part gets only the rights it needs, so a bug or a stolen credential does limited damage.

- **Run as a non-root user.** If an attacker gets code execution in a root process, they own the machine. On Linux the official Docker image already includes a `node` user.
- **Do not listen on ports below 1024 as root.** Run on a high port and let a reverse proxy or the platform forward 80 and 443.
- **Read-only file system** where possible, only a small writable folder for temp files and uploads.
- **Database accounts** with only the tables and operations the app needs (no `DROP`, no superuser). Separate accounts for separate services.
- **Narrow tokens and scopes**: one API key per service, with minimal scope, easy to revoke.

```dockerfile
# Illustrative Dockerfile
FROM node:24-slim
WORKDIR /app
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=node:node . .
USER node
CMD ["node", "server.js"]
```

A start-up guard (on Windows `process.getuid` does not exist, so the check does nothing there):

```js
if (process.getuid?.() === 0) {
  console.error('Refusing to run as root');
  process.exit(1);
}
```

## 21. Node-specific traps and the final checklist

Traps that show up in reviews and interviews:

| Trap | Why it is a problem | Do this instead |
|---|---|---|
| `eval`, `new Function`, `vm` with user data | Runs attacker code. `vm` is not a security boundary | Data formats like JSON; a separate process or container for untrusted code |
| Deserialising untrusted data with a library that can build objects with behaviour (some old serialisers, unsafe YAML loaders) | The data itself can trigger code to run (**insecure deserialisation**, OWASP A08) | `JSON.parse` plus schema validation. It only produces plain data, never code |
| `Buffer.allocUnsafe(n)` returned to a client unfilled | Memory is not zeroed and may contain old data from earlier requests | `Buffer.alloc(n)` |
| `new Buffer(n)` | Deprecated (DEP0005, prints a warning) | `Buffer.alloc`, `Buffer.from` |
| `url.parse()` | Deprecated (DEP0169). The warning says it is "prone to errors that have security implications" | `new URL(...)` |
| `Math.random()` for tokens | Predictable | `crypto.randomBytes`, `randomUUID` |
| Passing all of `process.env` to child processes | Secrets are inherited by every tool you start | Pass a small `env` object |
| `rejectUnauthorized: false` | Turns off TLS checks | Fix the certificate or supply the CA |
| `cors()` with defaults, or reflecting `Origin` | Any site can call your API | Exact allow-list |
| Stack traces and internal messages in responses | Help attackers map your system | Generic message and a request id |
| Letting an unhandled error or rejection happen | On Node 24 an unhandled rejection ends the process with exit code 1 (lesson 14). Anyone who can trigger it can crash you | Handle errors, validate input, supervise and restart processes |

### Security checklist

Input and output
- [ ] Every input is validated with an allow-list or schema (type, length, range, unknown keys rejected)
- [ ] Output is encoded for its context; CSP is set; no user-supplied template text
- [ ] Parameterised queries everywhere; identifiers come from an allow-list
- [ ] No shell: `execFile` or `spawn` with array arguments
- [ ] File paths are resolved and checked inside a base folder; uploads get generated names
- [ ] Merges and clones of user JSON block `__proto__`, `constructor`, `prototype`
- [ ] Regexes reviewed for nested quantifiers; input length capped
- [ ] Outgoing requests to user-supplied URLs are allow-listed, IP-checked and redirect-checked

Limits and abuse
- [ ] Body size limits, server timeouts, request and connection limits
- [ ] Rate limits on login, signup, password reset and expensive routes
- [ ] Pagination with a maximum page size

Browser and transport
- [ ] HTTPS everywhere, HSTS, `Secure` cookies
- [ ] Security headers set (by hand or with `helmet`)
- [ ] CORS is an exact allow-list; CSRF protection on cookie-authenticated writes
- [ ] Cookies are `HttpOnly`, `Secure`, `SameSite`

Identity and access
- [ ] Passwords stored with argon2id or scrypt (or bcrypt), salted, compared in constant time
- [ ] Login does not reveal which users exist; brute force is slowed; MFA available
- [ ] Authorization checked on the server for each object, deny by default
- [ ] Tokens: short lifetime, algorithm pinned, `exp`/`iss`/`aud` checked, strong secret or key
- [ ] Sessions regenerated at login; logout and revocation work

Crypto and secrets
- [ ] Only standard algorithms (AES-256-GCM, SHA-256, Ed25519); fresh IV for every message
- [ ] No secrets in code, git, URLs or logs; `.env` ignored; rotation planned
- [ ] Logs are structured and redacted; auth events are logged and alerted on

Dependencies and runtime
- [ ] Lockfile committed; `npm ci`; `npm audit` in CI; `--ignore-scripts` where possible
- [ ] Supported Node release line with security patches
- [ ] Runs as non-root with minimal rights; permission model considered
- [ ] Generic error responses; `NODE_ENV=production`

### Platform and version notes

The outputs in this lesson were produced on Windows 11 with Node 24.16.0. A few things differ elsewhere:

| Topic | Note |
|---|---|
| Timing lines | The ReDoS timings (section 8), the SHA-256 versus `scrypt` timings (section 14) and the random `scrypt` record differ on every run and machine. Only the pattern matters (doubling, thousands of times slower) |
| `localhost` in the SSRF example | Prints `::1` on this machine and may print `127.0.0.1` on yours. The guard blocks both |
| Shell commands | `exec` uses `cmd.exe` on Windows and `sh` on Linux and macOS. The injected `&&` works in both. The example trims the line endings (`\r\n` on Windows) so the printed output looks the same |
| Paths | The path traversal checks use `path.sep`, so they work with `\` on Windows and `/` elsewhere. Different drives on Windows are why `path.isAbsolute` is part of the check |
| `process.getuid` | Does not exist on Windows (the non-root guard does nothing there) |
| Permission model | `--permission` needs Node 22.13 or newer (the old `--experimental-permission` name is rejected on 24). The docs say the entry script is on the read list by default, which was checked on 24.16 only. If an older release denies it, add it with `--allow-fs-read`. `--allow-net` exists only from Node 25 |
| `crypto.argon2` | Added in Node 24.7.0 and a release candidate on 24.16. On older Node, use `scrypt` |
| `RegExp.escape` | Needs V8 13.6 (Node 24+) |
| `node:sqlite` | Needs no flag since 22.13 and 23.4 and is a release candidate on 24. Examples that use it need Node 22.13 or newer |

## Summary / Key takeaways
- Treat every byte from outside as hostile. Validate with an allow-list at the edge, and encode or parameterise at the point of use.
- Injection (SQL, NoSQL, shell, template) is always data read as code. Keep them apart: prepared statements, `execFile` with arrays, fixed templates.
- Path traversal: `path.resolve` first, then `path.relative` and check; never a bare `startsWith`. SSRF: allow-list, check the resolved IP and every redirect. Prototype pollution: block the three keys, use `Object.create(null)` or `Map`.
- One regex can freeze the event loop (ReDoS), and one huge or slow request can tie up a server. Use limits, timeouts and rate limits.
- Cookies need `HttpOnly`, `Secure` and `SameSite`. CORS is an exact allow-list and is not a CSRF defence. Headers and CSP are cheap extra walls (`helmet` sets many).
- Hash for fingerprints, HMAC for shared-secret integrity, AES-256-GCM with a fresh IV for secrecy plus integrity, signatures for public verification, `scrypt` or argon2 for passwords. Compare secrets with `timingSafeEqual`. Never invent your own crypto.
- A JWT is signed, not encrypted. The server must choose the algorithm, check `exp`, and keep tokens short-lived; sessions are simpler to revoke. OAuth with PKCE protects the code exchange.
- Least privilege everywhere: non-root, narrow credentials, the permission model as a seat belt, few and reviewed dependencies, no secrets in code or logs.

## Quick check

1. Why is escaping data when you output it better than "cleaning" it when it comes in?
<details><summary>Answer</summary>

Because the right escaping depends on where the data lands (HTML text, an attribute, a URL, JSON in a script, SQL). Cleaning at input guesses one context and breaks the others, and deleting "bad" words is easy to bypass (`<scr<script>ipt>`). Store the validated raw value and encode at output for the exact context.

</details>

2. What is the difference between `exec` and `execFile` for command injection?
<details><summary>Answer</summary>

`exec` starts a shell and passes it one string, so characters like `&&`, `;`, `|` and `$( )` are interpreted and a second command can run. `execFile` (and `spawn`) start the program directly and take arguments as an array, so no shell parses them and the payload stays a plain argument.

</details>

3. Why is `if (!full.startsWith(baseDir))` a flawed path traversal check?
<details><summary>Answer</summary>

`/srv/public-private/file` starts with `/srv/public`, so a sibling folder passes. Resolve the path with `path.resolve`, then use `path.relative(base, full)` and reject results that are `..`, start with `..` plus a separator, or are absolute. Also consider symlinks (`fs.realpath`).

</details>

4. How does prototype pollution happen, and name three defences.
<details><summary>Answer</summary>

A merge, clone or "set by path" function follows the key `__proto__` (or `constructor.prototype`) from user JSON and writes onto `Object.prototype`, so every object gains the property. Defences: block those three keys, merge into `Object.create(null)` or use a `Map`, validate with a schema that rejects unknown keys, `node --disable-proto=delete`, freeze `Object.prototype`, keep libraries updated.

</details>

5. What makes `/^(a+)+$/` dangerous, and how do you fix it?
<details><summary>Answer</summary>

The nested quantifier lets the engine split a run of `a` characters in exponentially many ways. When the match fails (for example a trailing `!`), it tries them all, blocking the event loop. Use an unambiguous pattern (`/^a+$/`), cap the input length, run risky matching in a worker with a timeout, or use a linear-time engine such as RE2.

</details>

6. Why should you not store passwords as SHA-256 hashes, and what should you use?
<details><summary>Answer</summary>

SHA-256 is designed to be fast, so attackers can test enormous numbers of guesses per second, and without a salt equal passwords give equal hashes. Use a slow, memory-hard, salted password hash: argon2id, `crypto.scrypt` (or bcrypt), with a unique random salt per password, and compare with `crypto.timingSafeEqual`.

</details>

7. In AES-256-GCM, what does the auth tag do, and why must the IV be unique?
<details><summary>Answer</summary>

The tag authenticates the ciphertext (and any AAD): if one bit changes or the key is wrong, `decipher.final()` throws, so tampering is detected. The IV must never repeat for the same key, because reuse breaks GCM's confidentiality and lets attackers forge messages. Generate 12 random bytes per message and store them with the data.

</details>

8. What is wrong with a JWT verifier that reads the algorithm from the token header?
<details><summary>Answer</summary>

The attacker controls the header. They can set `alg: none` (no signature), or switch an `RS256` token to `HS256` and sign it with the public key as the HMAC secret (algorithm confusion). The server must choose the allowed algorithm itself (for example the `algorithms` option of `jsonwebtoken`) and also check `exp`, `iss` and `aud`.

</details>

9. If cookies use `SameSite=Lax`, do you still need CSRF tokens?
<details><summary>Answer</summary>

It is best to have both. `Lax` blocks most cross-site POSTs, but it is about the same *site*, so a hostile subdomain can still send same-site requests, older browsers behave differently, and a missing attribute should never be relied on. A CSRF token (plus an `Origin` check) adds a second, independent layer. GET requests must never change state.

</details>

10. Why must an SSRF guard check the resolved IP and every redirect, not just the URL text?
<details><summary>Answer</summary>

A harmless-looking name can resolve to a private address (`attacker.example` to `10.0.0.5`), the URL parser accepts many spellings of `127.0.0.1` (`2130706433`, `0x7f.1`, `[::ffff:127.0.0.1]`), a name can change its answer between check and connect (DNS rebinding), and a public URL can answer `302` to an internal one. Check the parsed host, all resolved addresses at connect time, and each redirect hop, ideally with a host allow-list and network egress rules.

</details>

## Try it yourself

**Task 1 (easy): signed cookie.** Write `sign(value, secret)` that returns `value.signature` (HMAC-SHA256 in base64url) and `unsign(signed, secret)` that returns the value, or `null` when the signature is wrong or the format is bad. Compare in constant time.

<details><summary>Hint</summary>

Use `crypto.createHmac('sha256', secret).update(value).digest('base64url')`. In `unsign`, split at the **last** dot (the value may contain dots), recompute the signature, check the two buffers have equal length, then call `crypto.timingSafeEqual`.

</details>

<details><summary>Solution</summary>

```js
const crypto = require('node:crypto');

function sign(value, secret) {
  const mac = crypto.createHmac('sha256', secret).update(value).digest('base64url');
  return `${value}.${mac}`;
}

function unsign(signed, secret) {
  const dot = signed.lastIndexOf('.');
  if (dot < 1) return null;
  const value = signed.slice(0, dot);
  const given = Buffer.from(signed.slice(dot + 1));
  const expected = Buffer.from(sign(value, secret).slice(dot + 1));
  if (given.length !== expected.length) return null;
  return crypto.timingSafeEqual(given, expected) ? value : null;
}

const secret = crypto.randomBytes(32);
const cookie = sign('user=ann', secret);
console.log(unsign(cookie, secret));                         // user=ann
console.log(unsign(cookie.replace('ann', 'bob'), secret));   // null
console.log(unsign('no-dot-here', secret));                  // null
console.log(unsign(cookie, crypto.randomBytes(32)));         // null
```

</details>

**Task 2 (medium): fix the merge.** This merge is vulnerable. Write `safeMerge(target, source)` that still merges normal nested objects but cannot be used to pollute `Object.prototype`. Prove it with `node:assert` tests for the `__proto__` payload, the `constructor.prototype` payload and a nested `__proto__`.

```js
function merge(target, source) {
  for (const key in source) {
    if (typeof source[key] === 'object' && source[key] !== null) {
      if (!target[key]) target[key] = {};
      merge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}
```

<details><summary>Hint</summary>

Loop with `Object.keys(source)`, skip `__proto__`, `constructor` and `prototype`, and only recurse into a target value that is an own property and a plain object. Test with `JSON.parse('{"__proto__":{"polluted":true}}')` (not an object literal), then check `({}).polluted === undefined`.

</details>

<details><summary>Solution</summary>

```js
const assert = require('node:assert/strict');

const BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function safeMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (BLOCKED.has(key)) continue;
    const value = source[key];
    if (isPlainObject(value)) {
      if (!isPlainObject(target[key]) || !Object.hasOwn(target, key)) target[key] = {};
      safeMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

assert.deepEqual(safeMerge({ a: 1, n: { x: 1 } }, { b: 2, n: { y: 2 } }), { a: 1, b: 2, n: { x: 1, y: 2 } });
safeMerge({}, JSON.parse('{"__proto__":{"polluted":true}}'));
assert.equal({}.polluted, undefined);
safeMerge({}, JSON.parse('{"constructor":{"prototype":{"polluted":true}}}'));
assert.equal({}.polluted, undefined);
safeMerge({}, JSON.parse('{"a":{"__proto__":{"polluted":true}}}'));
assert.equal({}.polluted, undefined);
console.log('all merge tests passed');
```

</details>

**Task 3 (harder): sealed tokens with key rotation.** Build `seal(plaintext, keyring, aad)` and `open(token, keyring, aad)` with AES-256-GCM. The keyring looks like `{ current: 'k1', keys: { k1: <32-byte Buffer> } }`. Requirements: a fresh IV per token; the token carries the key id so old tokens still open after you add a new current key; the `aad` string (for example `user:42`) is authenticated, so a token made for one user fails for another; any tampering throws.

<details><summary>Hint</summary>

Token format: `kid.iv.tag.ciphertext`, each part base64url. Call `cipher.setAAD(Buffer.from(aad))` before `update`, and `decipher.setAAD(...)` and `decipher.setAuthTag(...)` before `final`. To rotate, add `k2` to `keys` and set `current = 'k2'`; `open` looks the key up by the id inside the token.

</details>

<details><summary>Solution</summary>

```js
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

function seal(plaintext, keyring, aad) {
  const kid = keyring.current;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyring.keys[kid], iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [kid, iv.toString('base64url'), tag.toString('base64url'), data.toString('base64url')].join('.');
}

function open(token, keyring, aad) {
  const [kid, iv, tag, data] = token.split('.');
  const key = keyring.keys[kid];
  if (!key) throw new Error('unknown key id');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

const keyring = { current: 'k1', keys: { k1: crypto.randomBytes(32) } };
const token = seal('{"plan":"pro"}', keyring, 'user:42');
assert.equal(open(token, keyring, 'user:42'), '{"plan":"pro"}');
assert.throws(() => open(token, keyring, 'user:43'), /authenticate/); // wrong AAD
const parts = token.split('.');
parts[3] = Buffer.from('tampered').toString('base64url');
assert.throws(() => open(parts.join('.'), keyring, 'user:42'));       // tampered ciphertext

keyring.keys.k2 = crypto.randomBytes(32); // rotate: new key encrypts, old key still decrypts
keyring.current = 'k2';
assert.equal(open(token, keyring, 'user:42'), '{"plan":"pro"}');
assert.equal(seal('x', keyring, 'a').split('.')[0], 'k2');
console.log('all token tests passed');
```

</details>

## Where to go next
- Next lesson: [21. TypeScript with Node.js](../21-typescript-with-node/README.md).
- Related lessons: [06. The File System (fs)](../06-file-system/README.md) (path handling), [12. HTTP and Networking with Core Modules](../12-http-and-networking/README.md) (servers, HTTPS, cookies), [14. Error Handling and Debugging](../14-error-handling-and-debugging/README.md) (what happens on unhandled errors), [18. worker_threads, cluster and Scaling on One Machine](../18-worker-threads-and-cluster/README.md) (isolating risky work).
- Practise the interview questions for this topic in [Round 2: Core](../../rounds/round-2-core/questions.md), [Round 4: Advanced](../../rounds/round-4-advanced/questions.md) and the authentication design questions in [Round 5: System design](../../rounds/round-5-system-design/questions.md).
- Quick self-test before an interview: explain out loud, without notes, the one-sentence fix for each of XSS, CSRF, SQL injection, command injection, path traversal, SSRF, prototype pollution and ReDoS, then how you would store a password and why a JWT is not a session.
- Keep going on your own: the OWASP Cheat Sheet Series (Password Storage, Authentication, Session Management, Node.js Security) and the Node.js documentation pages for `crypto` and Permissions.
