// Copy of Annoy-api-global src/dm-crypto.ts (tested there). Keep it identical.
// Client side of the DM encryption (TODO item 1.2 and 3.4). Runs in the Annoy
// app through WebCrypto; chatannoy only stores what comes out of here.
// Copy it as is: both people must derive the same key.
//
// Model, version 1:
// - Each Annoy account has one X25519 key pair, derived from the account's
//   identity key (client-kdf.ts). Any device that signs in derives the same
//   pair, so a formatted PC reads the stored history again.
// - Two people share one AES-256-GCM key: ECDH of their pairs, then HKDF over
//   both user IDs and both public keys. No server sees it.
// - Each message has a random 96-bit nonce. The AAD binds the ciphertext to
//   the conversation, the sender and the client message ID, so chatannoy
//   can't move a message to another conversation or change its sender.
// Known limits: no forward secrecy (a leaked identity key opens old messages);
// the public key comes from usersannoy, so a dishonest directory could swap
// it. Safety numbers (safetyNumber) let two people compare keys.

const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = globalThis.crypto.subtle;
type Bytes = Uint8Array<ArrayBuffer>;
const random = (n: number): Bytes => globalThis.crypto.getRandomValues(new Uint8Array(n));

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of view) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s: string): Bytes {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export const DM_KEY_VERSION = 1;

export interface DmKeyPair {
  /** Raw X25519 public key, base64url (43 characters). */
  publicKey: string;
  privateKey: CryptoKey;
}

/** The account's DM key pair, from its 32-byte identity key. */
export async function dmKeyPair(identity: Uint8Array): Promise<DmKeyPair> {
  const mac = await subtle.importKey("raw", new Uint8Array(identity), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const seed = new Uint8Array(await subtle.sign("HMAC", mac, enc.encode("annoy-dm/x25519/v1")));
  // PKCS#8 wrapper for a raw X25519 private key (RFC 8410, OID 1.3.101.110).
  const pkcs8 = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20, ...seed]);
  const privateKey = await subtle.importKey("pkcs8", pkcs8, { name: "X25519" }, true, ["deriveBits"]);
  const jwk = await subtle.exportKey("jwk", privateKey);
  return { publicKey: jwk.x!, privateKey: await subtle.importKey("pkcs8", pkcs8, { name: "X25519" }, false, ["deriveBits"]) };
}

export const isDmPublicKey = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);

/** The key two people share. The same on both sides, whoever calls it. */
export async function conversationKey(mine: DmKeyPair, myId: string, theirPublicKey: string, theirId: string): Promise<CryptoKey> {
  if (!isDmPublicKey(theirPublicKey)) throw new Error("invalid_dm_key");
  const theirs = await subtle.importKey("raw", fromB64url(theirPublicKey), { name: "X25519" }, false, []);
  const shared = await subtle.deriveBits({ name: "X25519", public: theirs }, mine.privateKey, 256);
  const pair = [[myId, mine.publicKey], [theirId, theirPublicKey]].sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
  const hkdf = await subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("annoy-dm/v1"), info: enc.encode(pair.map((p) => p.join(":")).join("|")) },
    hkdf,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface Sealed {
  nonce: string;
  ciphertext: string;
}

/** What a message's AAD binds: the conversation, the sender and the client message ID. */
export interface MessageContext {
  conversationId: string;
  senderId: string;
  clientId: string;
}
const aad = (c: MessageContext) => enc.encode(`annoy-dm/v1|${c.conversationId}|${c.senderId}|${c.clientId}`);

export async function sealMessage(key: CryptoKey, context: MessageContext, payload: unknown): Promise<Sealed> {
  const nonce = random(12);
  const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad(context) }, key, enc.encode(JSON.stringify(payload)));
  return { nonce: b64url(nonce), ciphertext: b64url(ciphertext) };
}

export async function openMessage<T>(key: CryptoKey, context: MessageContext, sealed: Sealed): Promise<T> {
  const plain = await subtle.decrypt({ name: "AES-GCM", iv: fromB64url(sealed.nonce), additionalData: aad(context) }, key, fromB64url(sealed.ciphertext));
  return JSON.parse(dec.decode(plain)) as T;
}

/** "Which server I'm in", readable only by one friend (TODO item 1, server visibility). */
export const sealForFriend = (key: CryptoKey, ownerId: string, friendId: string, value: unknown) =>
  sealMessage(key, { conversationId: "where", senderId: ownerId, clientId: friendId }, value);
export const openFromFriend = <T>(key: CryptoKey, ownerId: string, friendId: string, sealed: Sealed) =>
  openMessage<T>(key, { conversationId: "where", senderId: ownerId, clientId: friendId }, sealed);

/** A file for a DM: its own random key, which travels inside the encrypted message. */
export async function sealFile(bytes: Uint8Array): Promise<{ key: string; nonce: string; data: Bytes }> {
  const raw = random(32);
  const key = await subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const nonce = random(12);
  const data = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: enc.encode("annoy-dm-file/v1") }, key, new Uint8Array(bytes)));
  return { key: b64url(raw), nonce: b64url(nonce), data };
}

export async function openFile(keyB64: string, nonceB64: string, data: Uint8Array): Promise<Bytes> {
  const key = await subtle.importKey("raw", fromB64url(keyB64), "AES-GCM", false, ["decrypt"]);
  return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: fromB64url(nonceB64), additionalData: enc.encode("annoy-dm-file/v1") }, key, new Uint8Array(data)));
}

/** 60 digits both people can compare (in a call or in person) to check no one swapped a key. */
export async function safetyNumber(idA: string, keyA: string, idB: string, keyB: string): Promise<string> {
  const pair = [[idA, keyA], [idB, keyB]].sort((a, b) => (a[0]! < b[0]! ? -1 : 1));
  const digest = new Uint8Array(await subtle.digest("SHA-512", enc.encode(`annoy-safety/v1|${pair.map((p) => p.join(":")).join("|")}`)));
  const groups: string[] = [];
  for (let i = 0; i < 60; i += 5) {
    let n = 0;
    for (let j = 0; j < 5; j++) n = n * 256 + digest[i + j]!;
    groups.push((n % 100000).toString().padStart(5, "0"));
  }
  return groups.join(" ");
}
