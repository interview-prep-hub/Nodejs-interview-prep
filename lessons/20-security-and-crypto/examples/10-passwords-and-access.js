// Passwords (salt, scrypt, argon2), login with brute-force protection, and access control (IDOR, RBAC, ABAC)
// Run: node lessons/20-security-and-crypto/examples/10-passwords-and-access.js
//
// Part A: how to STORE a password. Part B: how to LOG IN without helping an attacker.
// Part C: once you know WHO the user is, decide WHAT they may do.

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);

// ======================= Part A: storing passwords =======================

function timeMs(fn) {
  const start = process.hrtime.bigint();
  const result = fn();
  return { result, ms: Number(process.hrtime.bigint() - start) / 1e6 };
}

function demoWhyNotSha256() {
  console.log('--- A1. why a plain fast hash is the wrong tool ---');
  const sha = (pw) => crypto.createHash('sha256').update(pw).digest('hex');
  console.log('two users, same password, no salt :', sha('hunter2') === sha('hunter2'), '(equal hashes reveal equal passwords)');
  const salted = (pw) => {
    const salt = crypto.randomBytes(16);
    return crypto.createHash('sha256').update(Buffer.concat([salt, Buffer.from(pw)])).digest('hex');
  };
  console.log('two users, same password, salted  :', salted('hunter2') === salted('hunter2'));

  const guesses = 20000;
  const fast = timeMs(() => {
    for (let i = 0; i < guesses; i++) sha('guess-' + i);
  });
  const slow = timeMs(() => crypto.scryptSync('guess', crypto.randomBytes(16), 64, { N: 2 ** 14, r: 8, p: 1 }));
  const perGuessFast = fast.ms / guesses;
  console.log(`SHA-256 : ${guesses} guesses took ${Math.round(fast.ms)} ms`);
  console.log(`scrypt  : 1 guess took ${Math.round(slow.ms)} ms`);
  console.log('scrypt is more than 1000 times slower per guess:', slow.ms / perGuessFast > 1000);
}

// A self-describing record: algorithm$N$r$p$salt$hash. The cost settings travel WITH the hash,
// so you can raise them later and still verify old records.
const COST = { N: 2 ** 14, r: 8, p: 1 }; // production: raise N (and maxmem) as far as your servers can afford
const KEYLEN = 64;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16); // unique per password, stored in the open
  const hash = await scrypt(password.normalize('NFKC'), salt, KEYLEN, COST);
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  const [alg, N, r, p, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(actual, expected); // both are KEYLEN bytes, and the compare takes constant time
}

async function demoScrypt() {
  console.log('\n--- A2. scrypt with a salt ---');
  const stored = await hashPassword('correct horse battery staple');
  console.log('stored record  :', stored.replace(/\$([A-Za-z0-9+/=]{8})[A-Za-z0-9+/=]*/g, '$$$1...'));
  console.log('right password :', await verifyPassword('correct horse battery staple', stored));
  console.log('wrong password :', await verifyPassword('correct horse battery stapl', stored));
  console.log('same password hashed twice gives different records:', (await hashPassword('x')) !== (await hashPassword('x')));

  if (typeof crypto.argon2Sync === 'function') {
    // argon2id is the modern recommendation. It is a release candidate (stability 1.2) in Node 24.
    const tag = crypto.argon2Sync('argon2id', { message: 'correct horse battery staple', nonce: crypto.randomBytes(16), parallelism: 1, tagLength: 32, memory: 19456, passes: 2 });
    console.log('argon2id (19 MiB, 2 passes) tag length:', tag.length, 'bytes');
  }
}

// ======================= Part B: login with brute-force protection =======================

const users = new Map();
let DUMMY_HASH;

async function register(name, password, role) {
  users.set(name, { id: users.size + 1, name, role, passwordHash: await hashPassword(password), failed: 0, lockedUntil: 0 });
}

const MAX_FAILURES = 3;
const LOCK_MS = 15 * 60 * 1000;

async function login(name, password, now) {
  const user = users.get(name);
  if (user && user.lockedUntil > now) return { ok: false, error: 'too many attempts, try again later' };
  // Unknown user? Still do the expensive work, so response time does not reveal which names exist.
  const good = await verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !good) {
    if (user && ++user.failed >= MAX_FAILURES) user.lockedUntil = now + LOCK_MS;
    return { ok: false, error: 'invalid username or password' }; // one message for both cases
  }
  user.failed = 0;
  return { ok: true, user };
}

async function demoLogin() {
  console.log('\n--- B. login with a lock after 3 failures ---');
  DUMMY_HASH = await hashPassword('dummy-password-for-timing');
  await register('ann', 'correct horse battery staple', 'editor');
  let now = 1_000_000; // a fake clock so we do not wait 15 minutes
  const attempt = async (name, pw) => console.log(`${name} / ${pw}`.padEnd(38), '->', (await login(name, pw, now)).error ?? 'logged in');
  await attempt('nobody', 'guess1'); // unknown user: same message as a wrong password
  await attempt('ann', 'guess1');
  await attempt('ann', 'guess2');
  await attempt('ann', 'guess3'); // third failure: locked
  await attempt('ann', 'correct horse battery staple'); // even the right password is refused while locked
  now += LOCK_MS + 1; // 15 minutes later
  await attempt('ann', 'correct horse battery staple');
}

// ======================= Part C: access control =======================

const posts = new Map([
  [1, { id: 1, authorId: 1, dept: 'news', status: 'draft', body: 'Ann draft' }],
  [2, { id: 2, authorId: 2, dept: 'sport', status: 'draft', body: 'Bob secret draft' }],
]);

// BROKEN: only checks that the user is logged in. Any user can read any id (IDOR: insecure direct object reference).
function getPostBroken(user, id) {
  return posts.get(id);
}

// FIXED: the server checks the user against THIS object, on every request.
function getPost(user, id) {
  const post = posts.get(id);
  if (!post || (post.authorId !== user.id && user.role !== 'admin')) return null; // 404 for both, so ids do not leak
  return post;
}

// RBAC: the decision depends only on the user's ROLE.
const ROLE_PERMISSIONS = {
  viewer: ['post:read'],
  editor: ['post:read', 'post:write'],
  admin: ['post:read', 'post:write', 'post:delete'],
};
const can = (user, permission) => ROLE_PERMISSIONS[user.role]?.includes(permission) ?? false;

// ABAC: the decision uses ATTRIBUTES of the user, the object and the situation.
function canEditPost(user, post, context) {
  if (user.role === 'admin') return true;
  const sameDepartment = user.dept === post.dept;
  const isAuthor = user.id === post.authorId;
  const duringWorkHours = context.hour >= 8 && context.hour < 18;
  return (isAuthor || (user.role === 'editor' && sameDepartment)) && post.status === 'draft' && duringWorkHours;
}

function demoAccess() {
  console.log('\n--- C. access control ---');
  const ann = { id: 1, role: 'editor', dept: 'news' };
  const bob = { id: 2, role: 'viewer', dept: 'sport' };
  console.log('IDOR, broken : ann reads post 2 ->', JSON.stringify(getPostBroken(ann, 2)?.body));
  console.log('IDOR, fixed  : ann reads post 2 ->', JSON.stringify(getPost(ann, 2)?.body ?? null));
  console.log('IDOR, fixed  : ann reads post 1 ->', JSON.stringify(getPost(ann, 1)?.body ?? null));
  console.log('RBAC         : editor may post:write =', can(ann, 'post:write'), '| viewer may post:write =', can(bob, 'post:write'));
  console.log('ABAC         : ann edits her draft at 10:00 =', canEditPost(ann, posts.get(1), { hour: 10 }));
  console.log('ABAC         : ann edits her draft at 22:00 =', canEditPost(ann, posts.get(1), { hour: 22 }));
  console.log('ABAC         : ann edits a sport draft      =', canEditPost(ann, posts.get(2), { hour: 10 }));
}

async function main() {
  demoWhyNotSha256();
  await demoScrypt();
  await demoLogin();
  demoAccess();
}

main();
