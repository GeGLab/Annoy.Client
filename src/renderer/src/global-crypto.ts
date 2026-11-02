import {t as translate} from "../../shared/localization/index.ts";
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
  if (bytes[0] !== 1) throw new Error(translate("common.7d12e7f43bcd"));
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
  if (normalized.length !== 25) throw new Error(translate("common.2eaea5eda99a"));
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

// --- RFC 9474 blind tokens through Cloudflare's maintained implementation ---
// RSA-PSS encoding, blinding and finalization are never implemented in Annoy.
import { RSABSSA } from '@cloudflare/blindrsa-ts';
const blindSuite = RSABSSA.SHA384.PSS.Randomized();
export interface IssuerKey {kid:string;n:string;e:string}
export interface PendingToken {kid:string;message:Bytes;blinded:string;inverse:Uint8Array;publicKey:CryptoKey}
export const tokenContext=(serverId:string,identityId:string):Bytes=>enc.encode(`annoy-token/v1|${serverId}|${identityId}`);
export async function blindToken(key:IssuerKey,context:Bytes):Promise<PendingToken>{
 const publicKey=await subtle.importKey('jwk',{kty:'RSA',n:key.n,e:key.e,alg:'PS384',ext:true},{name:'RSA-PSS',hash:'SHA-384'},true,['verify']);
 const message=new Uint8Array(blindSuite.prepare(context));
 const {blindedMsg,inv}=await blindSuite.blind(publicKey,message);
 return {kid:key.kid,message,blinded:b64url(blindedMsg),inverse:inv,publicKey};
}
export async function finalizeToken(pending:PendingToken,blindSignature:string):Promise<{kid:string;message:string;signature:string}>{
 try {
  const signature=await blindSuite.finalize(pending.publicKey,pending.message,fromB64url(blindSignature),pending.inverse);
  return {kid:pending.kid,message:b64url(pending.message),signature:b64url(signature)};
 } finally {pending.inverse.fill(0);}
}


