// Client side of the account crypto (DESIGN.md). Runs in the Annoy app and on
// the account website through WebCrypto; this API never runs it, it only
// tests it. Copy it as is: every side must derive the same bytes.

const enc = new TextEncoder();
const subtle = globalThis.crypto.subtle;
/** Bytes backed by a plain ArrayBuffer: what WebCrypto's BufferSource accepts under strict typings. */
type Bytes = Uint8Array<ArrayBuffer>;
const random = (n: number): Bytes => globalThis.crypto.getRandomValues(new Uint8Array(n));

// btoa/atob instead of Buffer: the same file runs in the browser and in Node.
export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of view) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromB64url(s: string): Bytes {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// --- Password ---------------------------------------------------------------

export interface PasswordKeys {
  /** Sent to the API, which peppers and Argon2-hashes it. */
  authKey: string;
  /** Wraps the account keys; never leaves the device. */
  wrapKey: CryptoKey;
}

/** PBKDF2-SHA256 over the password, then HKDF into the auth key and the wrapping key. */
export async function derivePasswordKeys(password: string, saltB64: string, iterations: number): Promise<PasswordKeys> {
  const pwd = await subtle.importKey("raw", enc.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const master = await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromB64url(saltB64), iterations }, pwd, 256);
  return {
    authKey: b64url(await subtle.deriveBits(hkdfInfo("auth"), await hkdfKey(master), 256)),
    wrapKey: await subtle.deriveKey(hkdfInfo("wrap"), await hkdfKey(master), { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]),
  };
}

const hkdfKey = (material: ArrayBuffer | Bytes) => subtle.importKey("raw", material, "HKDF", false, ["deriveBits", "deriveKey"]);
const hkdfInfo = (label: string) => ({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: enc.encode(`annoy-global/${label}`) });

export const newSalt = () => b64url(random(16));

// --- Account keys ------------------------------------------------------------

/**
 * Random keys made once, at sign-up. They outlive password changes and
 * resets, so the server list and the per-server identities survive both.
 */
export interface AccountKeys {
  vault: Bytes;
  identity: Bytes;
}

export const newAccountKeys = (): AccountKeys => ({ vault: random(32), identity: random(32) });

const packKeys = (k: AccountKeys) => {
  const out = new Uint8Array(64);
  out.set(k.vault, 0);
  out.set(k.identity, 32);
  return out;
};
const unpackKeys = (b: Bytes): AccountKeys => ({ vault: b.slice(0, 32), identity: b.slice(32, 64) });

async function aesSeal(key: CryptoKey, plain: Bytes, label: string): Promise<string> {
  const iv = random(12);
  const body = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(label) }, key, plain));
  const out = new Uint8Array(13 + body.length);
  out[0] = 1;
  out.set(iv, 1);
  out.set(body, 13);
  return b64url(out);
}

async function aesOpen(key: CryptoKey, sealed: string, label: string): Promise<Bytes> {
  const bytes = fromB64url(sealed);
  if (bytes[0] !== 1) throw new Error("Unknown format version");
  return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(1, 13), additionalData: enc.encode(label) }, key, bytes.subarray(13)));
}

export const wrapKeys = (wrapKey: CryptoKey, keys: AccountKeys) => aesSeal(wrapKey, packKeys(keys), "annoy-global/keys/v1");
export const unwrapKeys = async (wrapKey: CryptoKey, wrapped: string) => unpackKeys(await aesOpen(wrapKey, wrapped, "annoy-global/keys/v1"));

/** Default recovery: the API keeps a copy, so "forgot password" loses nothing. */
export const escrowKeys = (keys: AccountKeys) => b64url(packKeys(keys));
export const fromEscrow = (escrow: string) => unpackKeys(fromB64url(escrow));

// --- Recovery key (opt-in: only the user can recover) -------------------------

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 25 characters in five groups (125 bits), e.g. 7KQ2M-9XHD3-A0B1C-... */
export function newRecoveryKey(): string {
  const chars = Array.from(random(25), (b) => CROCKFORD[b & 31]).join("");
  return chars.match(/.{5}/g)!.join("-");
}

async function recoveryWrapKey(recoveryKey: string): Promise<CryptoKey> {
  const normalized = recoveryKey.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (normalized.length !== 25) throw new Error("A chave de recuperação tem 25 caracteres");
  return subtle.deriveKey(hkdfInfo("recovery"), await hkdfKey(enc.encode(normalized)), { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export const wrapWithRecovery = async (recoveryKey: string, keys: AccountKeys) => wrapKeys(await recoveryWrapKey(recoveryKey), keys);
export const unwrapWithRecovery = async (recoveryKey: string, wrapped: string) => unwrapKeys(await recoveryWrapKey(recoveryKey), wrapped);

// --- Vault (the server list, DESIGN.md 1.11) ---------------------------------

/** Pads to 4 KiB steps so the vault size says little about how many servers it holds. */
const PAD = 4096;

const vaultKey = (keys: AccountKeys) => subtle.importKey("raw", keys.vault, "AES-GCM", false, ["encrypt", "decrypt"]);

export async function sealVault(keys: AccountKeys, value: unknown): Promise<string> {
  const json = enc.encode(JSON.stringify(value));
  const padded = new Uint8Array(Math.ceil((json.length + 4) / PAD) * PAD);
  new DataView(padded.buffer).setUint32(0, json.length);
  padded.set(json, 4);
  return aesSeal(await vaultKey(keys), padded, "annoy-global/vault/v1");
}

export async function openVault<T>(keys: AccountKeys, sealed: string): Promise<T> {
  const plain = await aesOpen(await vaultKey(keys), sealed, "annoy-global/vault/v1");
  const length = new DataView(plain.buffer, plain.byteOffset).getUint32(0);
  return JSON.parse(new TextDecoder().decode(plain.subarray(4, 4 + length))) as T;
}

// --- Per-server identity (item 1.8) ------------------------------------------

/**
 * An Ed25519 key pair made only for one server, from the identity key. Its
 * public key is the ID that server stores; the private key signs logins there.
 * Different on every server: no one without the account keys links two.
 */
export async function serverIdentity(keys: AccountKeys, serverId: string): Promise<{ id: string; privateKey: CryptoKey }> {
  const mac = await subtle.importKey("raw", keys.identity, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const seed = new Uint8Array(await subtle.sign("HMAC", mac, enc.encode(`server-key:${serverId}`)));
  // PKCS#8 wrapper for a raw Ed25519 seed (RFC 8410).
  const pkcs8 = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20, ...seed]);
  const privateKey = await subtle.importKey("pkcs8", pkcs8, "Ed25519", true, ["sign"]);
  const jwk = await subtle.exportKey("jwk", privateKey);
  return { id: jwk.x!, privateKey };
}

export async function signForServer(privateKey: CryptoKey, challenge: string): Promise<string> {
  return b64url(await subtle.sign("Ed25519", privateKey, enc.encode(`annoy-login:${challenge}`)));
}

// --- Blind tokens (RFC 9474, RSABSSA-SHA384-PSS-Randomized) --------------------
//
// Proof that "a valid, unsanctioned global account" is logging in, made so the
// Global API can't tell which server it's for: it signs a blinded message it
// can't read, and the server checks the signature offline.

const H_LEN = 48;

const os2ip = (b: Bytes) => b.reduce((n, byte) => (n << 8n) | BigInt(byte), 0n);
function i2osp(n: bigint, len: number): Bytes {
  const out = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i--, n >>= 8n) out[i] = Number(n & 0xffn);
  return out;
}
function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base %= mod;
  for (; exp > 0n; exp >>= 1n, base = (base * base) % mod) if (exp & 1n) result = (result * base) % mod;
  return result;
}
function modInverse(a: bigint, m: bigint): bigint {
  let [r0, r1, s0, s1] = [a % m, m, 1n, 0n];
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1, s0, s1] = [r1, r0 - q * r1, s1, s0 - q * s1];
  }
  if (r0 !== 1n) throw new Error("not invertible");
  return ((s0 % m) + m) % m;
}
const sha384 = async (data: Bytes) => new Uint8Array(await subtle.digest("SHA-384", data));

async function mgf1(seed: Bytes, length: number): Promise<Bytes> {
  const out = new Uint8Array(length);
  for (let counter = 0, offset = 0; offset < length; counter++) {
    const block = await sha384(new Uint8Array([...seed, ...i2osp(BigInt(counter), 4)]));
    out.set(block.subarray(0, Math.min(block.length, length - offset)), offset);
    offset += block.length;
  }
  return out;
}

/** EMSA-PSS-ENCODE (RFC 8017 9.1.1) with SHA-384, MGF1-SHA-384 and a 48-byte salt. */
async function emsaPss(message: Bytes, emBits: number): Promise<Bytes> {
  const emLen = Math.ceil(emBits / 8);
  const mHash = await sha384(message);
  const salt = random(H_LEN);
  const h = await sha384(new Uint8Array([...new Uint8Array(8), ...mHash, ...salt]));
  const db = new Uint8Array(emLen - H_LEN - 1);
  db[db.length - H_LEN - 1] = 0x01;
  db.set(salt, db.length - H_LEN);
  const mask = await mgf1(h, db.length);
  for (let i = 0; i < db.length; i++) db[i]! ^= mask[i]!;
  db[0]! &= 0xff >> (8 * emLen - emBits);
  return new Uint8Array([...db, ...h, 0xbc]);
}

export interface IssuerKey {
  kid: string;
  /** RSA modulus and exponent, base64url (from the JWK the API publishes). */
  n: string;
  e: string;
}

export interface PendingToken {
  kid: string;
  /** The message the server verifies: 32 random bytes, then the context. */
  message: Bytes;
  blinded: string;
  inverse: bigint;
  modulus: bigint;
  exponent: bigint;
}

/**
 * The context binds a token to one server and one per-server identity, so it
 * is worthless anywhere else. The Global API never sees it.
 */
export const tokenContext = (serverId: string, identityId: string): Bytes => enc.encode(`annoy-token/v1|${serverId}|${identityId}`) as Bytes;

export async function blindToken(key: IssuerKey, context: Bytes): Promise<PendingToken> {
  const n = os2ip(fromB64url(key.n));
  const e = os2ip(fromB64url(key.e));
  const modBits = n.toString(2).length;
  const k = Math.ceil(modBits / 8);
  const message = new Uint8Array([...random(32), ...context]);
  const m = os2ip(await emsaPss(message, modBits - 1));
  let r: bigint;
  do r = os2ip(random(k)) % n;
  while (r < 2n);
  const blinded = (m * modPow(r, e, n)) % n;
  return { kid: key.kid, message, blinded: b64url(i2osp(blinded, k)), inverse: modInverse(r, n), modulus: n, exponent: e };
}

/** Unblinds the API's answer into an ordinary RSA-PSS signature on `message`. */
export function finalizeToken(pending: PendingToken, blindSignature: string): { kid: string; message: string; signature: string } {
  const k = Math.ceil(pending.modulus.toString(2).length / 8);
  const s = (os2ip(fromB64url(blindSignature)) * pending.inverse) % pending.modulus;
  return { kid: pending.kid, message: b64url(pending.message), signature: b64url(i2osp(s, k)) };
}
