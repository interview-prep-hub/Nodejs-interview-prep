// A tour of node:crypto: hash, HMAC, random, timingSafeEqual, AES-256-GCM, signatures, key agreement, WebCrypto, pbkdf2, hkdf
// Run: node lessons/20-security-and-crypto/examples/09-crypto-tour.js
//
// Rule of the whole tour: use these building blocks as documented. Never invent your own cipher or protocol.

const crypto = require('node:crypto');
const tls = require('node:tls');
const { promisify } = require('node:util');

// ---------- 1. Hashing: a fingerprint of data. Same input, same output. Cannot be reversed. ----------
console.log('--- 1. hashing ---');
console.log('sha256("hello")  =', crypto.createHash('sha256').update('hello').digest('hex'));
console.log('sha256("hellp")  =', crypto.createHash('sha256').update('hellp').digest('hex'), '(one letter changed)');
console.log('crypto.hash(...) =', crypto.hash('sha256', 'hello'), '(one-call version)');
console.log('sha512 base64    =', 'sha512-' + crypto.createHash('sha512').update('hello').digest('base64').slice(0, 24) + '...', '(npm lockfile "integrity" format)');

// ---------- 2. HMAC: a hash that needs a secret key. Proves who made the message and that it was not changed. ----------
console.log('\n--- 2. HMAC ---');
const secretKey = 'a-long-random-server-secret';
const mac = (message, key) => crypto.createHmac('sha256', key).update(message).digest('hex');
console.log('hmac(message, key)      =', mac('amount=10', secretKey).slice(0, 24) + '...');
console.log('hmac(changed, key)      =', mac('amount=99', secretKey).slice(0, 24) + '...');
console.log('hmac(message, other key)=', mac('amount=10', 'other-key').slice(0, 24) + '...');

// ---------- 3. Random: always crypto.random*, never Math.random, for anything secret ----------
console.log('\n--- 3. random ---');
console.log('randomBytes(16) hex length :', crypto.randomBytes(16).toString('hex').length, '(16 bytes = 128 bits)');
console.log('randomUUID() looks like    :', crypto.randomUUID().replace(/[0-9a-f]/g, 'x'));
const dice = Array.from({ length: 1000 }, () => crypto.randomInt(1, 7)); // 1 up to 6, no modulo bias
console.log('randomInt(1, 7) range      :', Math.min(...dice), 'to', Math.max(...dice));
console.log('token for a URL            :', crypto.randomBytes(32).toString('base64url').length, 'characters');

// ---------- 4. Comparing secrets: timingSafeEqual ----------
console.log('\n--- 4. timingSafeEqual ---');
// "===" stops at the first different byte, so response time can leak how many leading bytes were right.
// timingSafeEqual takes the same time wherever the difference is. It needs buffers of EQUAL length.
function safeEqual(a, b) {
  // Hash both sides first: the results always have the same length, so the length itself is not leaked.
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
console.log('safeEqual("token-1", "token-1")  =', safeEqual('token-1', 'token-1'));
console.log('safeEqual("token-1", "token-2")  =', safeEqual('token-1', 'token-2'));
console.log('safeEqual("token-1", "a longer")  =', safeEqual('token-1', 'a longer'));
try {
  crypto.timingSafeEqual(Buffer.from('abc'), Buffer.from('abcd'));
} catch (e) {
  console.log('raw call, different lengths     :', e.code);
}

// ---------- 5. AES-256-GCM: encryption that also detects tampering ----------
console.log('\n--- 5. AES-256-GCM ---');
const key = crypto.randomBytes(32); // 256-bit key. In real life this comes from a key store, not from the code.

function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(12); // a NEW random 12-byte IV (nonce) for EVERY message
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16-byte "seal" that proves the data was not changed
  return Buffer.concat([iv, tag, data]); // store the IV and tag next to the data; they are not secret
}

function decrypt(packed, key) {
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const data = packed.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'); // final() throws if the tag does not match
}

const sealed1 = encrypt('card=4111-1111-1111-1111', key);
const sealed2 = encrypt('card=4111-1111-1111-1111', key);
console.log('same text, two encryptions differ :', !sealed1.equals(sealed2));
console.log('decrypt                           :', decrypt(sealed1, key));
const tampered = Buffer.from(sealed1);
tampered[tampered.length - 1] ^= 1; // flip one bit of the ciphertext
try {
  decrypt(tampered, key);
} catch (e) {
  console.log('decrypt after flipping one bit    :', e.message);
}
try {
  decrypt(sealed1, crypto.randomBytes(32));
} catch (e) {
  console.log('decrypt with the wrong key        :', e.message);
}
console.log('typeof crypto.createCipher        :', typeof crypto.createCipher, '(the old no-IV API is gone)');

// ---------- 6. Key pairs and signatures ----------
console.log('\n--- 6. sign and verify (Ed25519) ---');
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const message = Buffer.from('release v1.2.3');
const signature = crypto.sign(null, message, privateKey); // Ed25519 picks its own hash, so the algorithm argument is null
console.log('signature length                 :', signature.length, 'bytes');
console.log('verify original                  :', crypto.verify(null, message, publicKey, signature));
console.log('verify changed message           :', crypto.verify(null, Buffer.from('release v9.9.9'), publicKey, signature));
console.log('public key PEM starts with       :', publicKey.export({ type: 'spki', format: 'pem' }).split('\n')[0]);

// ---------- 7. Key agreement: two sides build the SAME secret and never send it over the wire ----------
console.log('\n--- 7. key agreement (X25519) ---');
const alice = crypto.generateKeyPairSync('x25519');
const bob = crypto.generateKeyPairSync('x25519');
// Each side mixes ITS OWN private key with the OTHER side's public key. Only public keys cross the network.
const secretA = crypto.diffieHellman({ privateKey: alice.privateKey, publicKey: bob.publicKey });
const secretB = crypto.diffieHellman({ privateKey: bob.privateKey, publicKey: alice.publicKey });
console.log('shared secret length              :', secretA.length, 'bytes');
console.log('both sides computed the same bytes:', secretA.equals(secretB));

// ---------- 8. WebCrypto: the same ideas through the browser-style API ----------
async function webCryptoDemo() {
  console.log('\n--- 8. WebCrypto (crypto.subtle) ---');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('hello'));
  console.log('subtle sha256("hello") =', Buffer.from(digest).toString('hex').slice(0, 16) + '... (same as section 1)');

  const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); // false = key cannot be exported
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipherText = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode('secret note'));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, cipherText);
  console.log('subtle AES-GCM round trip =', new TextDecoder().decode(plain), '| key extractable:', aesKey.extractable);
}

// ---------- 9. Key derivation: turn one input into a key (pbkdf2) or one master key into many keys (hkdf) ----------
async function keyDerivationDemo() {
  console.log('\n--- 9. key derivation (pbkdf2 and hkdf) ---');
  const pbkdf2 = promisify(crypto.pbkdf2); // async: runs on the libuv thread pool, so the event loop stays free
  const ITERATIONS = 600_000; // OWASP's published figure for PBKDF2 with HMAC-SHA-256 (check the current cheat sheet)
  const salt = crypto.randomBytes(16);
  const key1 = await pbkdf2('correct horse', salt, ITERATIONS, 32, 'sha256');
  const key2 = await pbkdf2('correct horse', salt, ITERATIONS, 32, 'sha256');
  const key3 = await pbkdf2('correct horse', crypto.randomBytes(16), ITERATIONS, 32, 'sha256');
  console.log('pbkdf2 same inputs, same key      :', key1.equals(key2), '(it is deterministic, so store the salt)');
  console.log('pbkdf2 other salt, other key      :', !key1.equals(key3));
  console.log('pbkdf2 derived key length         :', key1.length, 'bytes');

  // hkdf is for keys that are ALREADY strong (a random master secret). It is fast and it is NOT for passwords.
  const master = crypto.randomBytes(32);
  const derive = (purpose) => Buffer.from(crypto.hkdfSync('sha256', master, '', purpose, 32)); // returns an ArrayBuffer
  console.log('hkdf same purpose, same key       :', derive('cookie-signing').equals(derive('cookie-signing')));
  console.log('hkdf other purpose, other key     :', !derive('cookie-signing').equals(derive('data-encryption')));
}

// ---------- 10. Defaults worth knowing ----------
webCryptoDemo()
  .then(keyDerivationDemo)
  .then(() => {
    console.log('\n--- 10. TLS defaults ---');
    console.log('minimum TLS version:', tls.DEFAULT_MIN_VERSION, '| maximum:', tls.DEFAULT_MAX_VERSION);
  });
