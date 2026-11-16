// TEST-ONLY certificate and private key for localhost, used by 11-https-and-http2.js
// Not a runnable example (the file name starts with an underscore). Never use this key for anything real:
// it is published in this repository, so everybody has it. (A secret scanner may report the key below: that is a
// false alarm, it is a deliberate, public, throwaway key that protects nothing.)
//
// It was made with this one command (shown on three lines):
//   openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout key.pem -out cert.pem
//     -not_before 20250101000000Z -not_after 20991231235959Z -subj "/CN=localhost/O=Node Interview Prep (test only)"
//     -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
// It is self-signed (the issuer is the certificate itself) and valid for the names "localhost" and 127.0.0.1.
// The validity dates are fixed on purpose, so the example does not depend on the date it was created.

const key = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgpg/27Y741S2Y5mp4
xc6vXP1z56j8UmiyZMas2vHvSo+hRANCAARGmbqAnflRN1k/gy5hsMifwTA3lY5r
XWkKsyMZz1KxQjSJpRrCugwkzfNumG4sT3dVLW4v68U2PhzRMC0hrt5K
-----END PRIVATE KEY-----
`;

const cert = `-----BEGIN CERTIFICATE-----
MIIB7jCCAZWgAwIBAgIUBRSEhuQTG04oVNXJBSqdbihoq9kwCgYIKoZIzj0EAwIw
PjESMBAGA1UEAwwJbG9jYWxob3N0MSgwJgYDVQQKDB9Ob2RlIEludGVydmlldyBQ
cmVwICh0ZXN0IG9ubHkpMCAXDTI1MDEwMTAwMDAwMFoYDzIwOTkxMjMxMjM1OTU5
WjA+MRIwEAYDVQQDDAlsb2NhbGhvc3QxKDAmBgNVBAoMH05vZGUgSW50ZXJ2aWV3
IFByZXAgKHRlc3Qgb25seSkwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARGmbqA
nflRN1k/gy5hsMifwTA3lY5rXWkKsyMZz1KxQjSJpRrCugwkzfNumG4sT3dVLW4v
68U2PhzRMC0hrt5Ko28wbTAdBgNVHQ4EFgQUYuAYrzAF744m7TVGlfY6EDwDTLgw
HwYDVR0jBBgwFoAUYuAYrzAF744m7TVGlfY6EDwDTLgwDwYDVR0TAQH/BAUwAwEB
/zAaBgNVHREEEzARgglsb2NhbGhvc3SHBH8AAAEwCgYIKoZIzj0EAwIDRwAwRAIg
Sqr62eswJef4n/bJZZuvAADqqTB4P3HI/wTcwpqVankCIG9Cc4WUPH1B/RxesBvj
/KcEKbwazf6EoaSgvOufeDLA
-----END CERTIFICATE-----
`;

module.exports = { key, cert };
