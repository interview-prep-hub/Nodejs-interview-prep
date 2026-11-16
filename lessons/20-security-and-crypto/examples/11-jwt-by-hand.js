// A JWT built and verified by hand (HS256), the classic attacks, refresh-token rotation, and PKCE
// Run: node lessons/20-security-and-crypto/examples/11-jwt-by-hand.js
//
// A JWT is three base64url parts joined by dots: header.payload.signature.
// It is SIGNED (tamper-evident) but NOT ENCRYPTED: anybody can read the payload.

const crypto = require('node:crypto');

const b64u = (input) => Buffer.from(input).toString('base64url');
const fromB64u = (text) => Buffer.from(text, 'base64url');
const encodeJson = (value) => b64u(JSON.stringify(value));
const decodeJson = (text) => JSON.parse(fromB64u(text).toString('utf8'));

const NOW = Date.UTC(2030, 0, 1, 12, 0, 0); // a fixed clock keeps the output the same on every run
const SECRET = 'demo-secret-only-for-this-example-0123456789'; // real secret: 32+ random bytes from a secret store

// ---------- 1. Sign ----------
function signHS256(claims, secret, { expiresInSec = 900, now = NOW } = {}) {
  const iat = Math.floor(now / 1000);
  const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
  const payload = encodeJson({ ...claims, iat, exp: iat + expiresInSec });
  const signature = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

// ---------- 2. Verify (the strict way) ----------
function verifyHS256(token, secret, { now = NOW, revoked = new Set() } = {}) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [h, p, s] = parts;
  let header;
  let claims;
  try {
    header = decodeJson(h);
    claims = decodeJson(p);
  } catch {
    throw new Error('malformed token');
  }
  if (header.alg !== 'HS256') throw new Error(`algorithm "${header.alg}" is not accepted`); // OUR code decides the algorithm
  const expected = crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest();
  const given = fromB64u(s);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new Error('bad signature');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) throw new Error('token expired'); // always check expiry
  if (revoked.has(claims.jti)) throw new Error('token revoked');
  return claims;
}

function tryIt(label, fn) {
  try {
    console.log(label.padEnd(34), '->', JSON.stringify(fn()));
  } catch (e) {
    console.log(label.padEnd(34), '-> REJECTED:', e.message);
  }
}

console.log('--- 1. sign and look inside ---');
const token = signHS256({ sub: 'ann', role: 'user', jti: 'tok-1' }, SECRET);
console.log('token:', token);
const [h, p] = token.split('.');
console.log('header :', JSON.stringify(decodeJson(h)));
console.log('payload:', JSON.stringify(decodeJson(p)), '<- readable by anyone, so never put secrets in it');

console.log('\n--- 2. verify ---');
tryIt('valid token', () => verifyHS256(token, SECRET));
tryIt('wrong secret', () => verifyHS256(token, 'another-secret'));
tryIt('15 minutes + 1 second later', () => verifyHS256(token, SECRET, { now: NOW + 901_000 }));
tryIt('revoked jti', () => verifyHS256(token, SECRET, { revoked: new Set(['tok-1']) }));

// ---------- 3. Attacks ----------
console.log('\n--- 3. attack: edit the payload ---');
const forgedPayload = encodeJson({ ...decodeJson(p), role: 'admin' });
tryIt('role changed, old signature', () => verifyHS256(`${h}.${forgedPayload}.${token.split('.')[2]}`, SECRET));

console.log('\n--- 4. attack: alg "none" ---');
// A naive library reads the algorithm from the TOKEN. The attacker says "no signature needed".
function naiveVerify(tokenText, secret) {
  const [hh, pp, ss] = tokenText.split('.');
  const header = decodeJson(hh);
  if (header.alg === 'none') return decodeJson(pp); // BUG
  const expected = crypto.createHmac('sha256', secret).update(`${hh}.${pp}`).digest('base64url');
  if (expected !== ss) throw new Error('bad signature');
  return decodeJson(pp);
}
const noneToken = `${encodeJson({ alg: 'none', typ: 'JWT' })}.${encodeJson({ sub: 'ann', role: 'admin' })}.`;
tryIt('naive verifier, alg none', () => naiveVerify(noneToken, SECRET));
tryIt('strict verifier, alg none', () => verifyHS256(noneToken, SECRET));

console.log('\n--- 5. attack: algorithm confusion (RS256 server, HS256 token) ---');
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }); // the public key is PUBLIC: the attacker has it

function signRS256(claims) {
  const header = encodeJson({ alg: 'RS256', typ: 'JWT' });
  const payload = encodeJson(claims);
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), privateKey).toString('base64url');
  return `${header}.${payload}.${sig}`;
}

function naiveVerifyRs(tokenText, keyPem) {
  const [hh, pp, ss] = tokenText.split('.');
  const { alg } = decodeJson(hh);
  const data = `${hh}.${pp}`;
  let ok = false;
  if (alg === 'RS256') ok = crypto.verify('sha256', Buffer.from(data), keyPem, fromB64u(ss));
  else if (alg === 'HS256') ok = crypto.createHmac('sha256', keyPem).update(data).digest('base64url') === ss; // BUG: same "key" variable
  if (!ok) throw new Error('bad signature');
  return decodeJson(pp);
}

function strictVerifyRs(tokenText, keyPem) {
  const [hh, pp, ss] = tokenText.split('.');
  if (decodeJson(hh).alg !== 'RS256') throw new Error('only RS256 is accepted');
  if (!crypto.verify('sha256', Buffer.from(`${hh}.${pp}`), keyPem, fromB64u(ss))) throw new Error('bad signature');
  return decodeJson(pp);
}

const goodRs = signRS256({ sub: 'ann', role: 'user' });
tryIt('honest RS256 token (naive)', () => naiveVerifyRs(goodRs, publicPem));
// The attacker has no private key, but HMAC-signs with the public PEM text as the "secret".
const confusedHeader = encodeJson({ alg: 'HS256', typ: 'JWT' });
const confusedPayload = encodeJson({ sub: 'ann', role: 'admin' });
const confusedSig = crypto.createHmac('sha256', publicPem).update(`${confusedHeader}.${confusedPayload}`).digest('base64url');
const confusedToken = `${confusedHeader}.${confusedPayload}.${confusedSig}`;
tryIt('confusion token (naive)', () => naiveVerifyRs(confusedToken, publicPem));
tryIt('confusion token (strict)', () => strictVerifyRs(confusedToken, publicPem));

console.log('\n--- 6. attack: guess a weak secret offline ---');
const weakToken = signHS256({ sub: 'ann' }, 'secret');
const wordlist = ['password', '123456', 'admin', 'changeme', 'secret', 'letmein'];
const cracked = wordlist.find((word) => {
  try {
    verifyHS256(weakToken, word);
    return true;
  } catch {
    return false;
  }
});
console.log('attacker with only the token found the secret:', JSON.stringify(cracked));

// ---------- 7. Refresh tokens with rotation ----------
console.log('\n--- 7. refresh token rotation ---');
const refreshStore = new Map(); // sha256(token) -> { user, used }
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

function issueRefresh(user) {
  const value = crypto.randomBytes(32).toString('base64url'); // opaque random value: not a JWT
  refreshStore.set(hashToken(value), { user, used: false }); // store only the HASH, like a password
  return value;
}

function useRefresh(value) {
  const record = refreshStore.get(hashToken(value));
  if (!record) throw new Error('unknown refresh token');
  if (record.used) {
    refreshStore.clear(); // a used token came back: someone copied it. Real systems revoke that user's whole token family.
    throw new Error('refresh token reuse detected, all sessions revoked');
  }
  record.used = true;
  return { accessToken: signHS256({ sub: record.user }, SECRET), refreshToken: issueRefresh(record.user) };
}

const r1 = issueRefresh('ann');
const second = useRefresh(r1);
console.log('first use  -> new access token:', second.accessToken.split('.').length === 3, '| new refresh token:', second.refreshToken !== r1);
tryIt('old refresh token used again', () => useRefresh(r1));
tryIt('the new one, after the alarm', () => useRefresh(second.refreshToken));

// ---------- 8. PKCE: proof that the app finishing the login is the app that started it ----------
console.log('\n--- 8. PKCE ---');
const verifier = crypto.randomBytes(32).toString('base64url'); // secret, stays in the app
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url'); // sent in the first request
console.log('code_verifier length :', verifier.length, '(allowed: 43 to 128)');
console.log('code_challenge       :', challenge.length, 'characters, method S256');
const serverCheck = (v) => crypto.createHash('sha256').update(v).digest('base64url') === challenge;
console.log('token request with the right verifier :', serverCheck(verifier));
console.log('token request from a code thief       :', serverCheck(crypto.randomBytes(32).toString('base64url')));
