# OpenMLS provider security backport

The protocol core is the crates.io release **OpenMLS 0.9.2**, unmodified.
The RustCrypto provider and basic credential implementation are copied from
[official OpenMLS revision 28369d5b48608bef4ddf8371d91503b0f3852bb3](https://github.com/openmls/openmls/tree/28369d5b48608bef4ddf8371d91503b0f3852bb3).

That upstream revision updates HPKE to 0.8, elliptic-curve dependencies to 0.14,
and Ed25519 to dalek 3, removing the vulnerable crypto-bigint 0.5 and libcrux-kem
0.0.9 dependency lines in the released provider's lockfile. It also stops enabling
experimental post-quantum algorithms by default. Annoy accepts only the standard
X25519/AES-128-GCM/SHA-256/Ed25519 MLS suite, including on Welcome.

Local adaptations are recorded in `annoy-adaptation.patch`: workspace dependency
references become concrete registry versions, and the three basic-credential
storage helpers retain the synchronous interface required by the released
openmls_traits 0.6. Cryptographic implementation code is unchanged from that
upstream revision. No cryptographic algorithm was written for this backport.
`upstream-sha256.json` records the original files; `LICENSE-OpenMLS` preserves the
upstream license. Cargo.lock records resolved package checksums.

This is **not an independently audited Annoy integration**. The protocol audit
must not be represented as covering this newer provider revision, dependencies,
storage integration or application policy. Review the exact upstream delta and
local patch before release. Replace the backport with compatible upstream
published packages after their validation, without silently changing protocol or
stored state formats.

Validation is recorded in the repository security report: protocol regression
suite, dependency audit, old-provider snapshot/ciphertext interoperability,
HTTP/controller tests, and real Electron integration. Missing platforms or audit
coverage must remain explicit.
