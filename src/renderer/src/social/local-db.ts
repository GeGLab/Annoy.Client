/**
 * The DMs this device received, kept locally (IndexedDB), still encrypted.
 * Without "store", chatannoy deletes a message once every device got it, so
 * this copy is the history. Decryption happens only in memory, when shown.
 */
export interface StoredMessage {
  id: string;
  conversationId: string;
  senderId: string;
  clientId: string;
  nonce: string;
  ciphertext: string;
  createdAt: string;
  editedAt: string | null;
}

const VERSION = 1;
let opened: { userId: string; db: Promise<IDBDatabase> } | null = null;

const dbName = (userId: string) => `annoy-dm-${userId}`;

function open(userId: string): Promise<IDBDatabase> {
  if (opened?.userId === userId) return opened.db;
  opened?.db.then((db) => db.close()).catch(() => undefined);
  const db = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName(userId), VERSION);
    req.onupgradeneeded = () => {
      const messages = req.result.createObjectStore("messages", { keyPath: "id" });
      messages.createIndex("conversation", ["conversationId", "id"]);
      req.result.createObjectStore("files");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  opened = { userId, db };
  return db;
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
const result = <T,>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export async function putMessages(userId: string, messages: StoredMessage[]): Promise<void> {
  if (!messages.length) return;
  const tx = (await open(userId)).transaction("messages", "readwrite");
  for (const m of messages) tx.objectStore("messages").put(m);
  await done(tx);
}

export async function getMessage(userId: string, id: string): Promise<StoredMessage | undefined> {
  return result((await open(userId)).transaction("messages").objectStore("messages").get(id));
}

export async function deleteMessage(userId: string, id: string): Promise<void> {
  const tx = (await open(userId)).transaction("messages", "readwrite");
  tx.objectStore("messages").delete(id);
  await done(tx);
}

/** Newest first, up to `limit`, older than `before` when given. */
export async function recentMessages(userId: string, conversationId: string, limit = 50, before?: string): Promise<StoredMessage[]> {
  const index = (await open(userId)).transaction("messages").objectStore("messages").index("conversation");
  const range = IDBKeyRange.bound([conversationId, ""], [conversationId, before ?? "￿"], false, !!before);
  const out: StoredMessage[] = [];
  await new Promise<void>((resolve, reject) => {
    const req = index.openCursor(range, "prev");
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || out.length >= limit) return resolve();
      out.push(cursor.value as StoredMessage);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
  return out;
}

/** Encrypted file bytes as they came from cdnannoy, so they outlive the server copy. */
export async function putFile(userId: string, blobId: string, data: Uint8Array): Promise<void> {
  const tx = (await open(userId)).transaction("files", "readwrite");
  tx.objectStore("files").put(data, blobId);
  await done(tx);
}

export async function getFile(userId: string, blobId: string): Promise<Uint8Array | undefined> {
  return result((await open(userId)).transaction("files").objectStore("files").get(blobId)) as Promise<Uint8Array | undefined>;
}

/** Sign-out wipes the local DM history of that account (TODO item 2.3). */
export async function wipe(userId: string): Promise<void> {
  if (opened?.userId === userId) {
    (await opened.db.catch(() => null))?.close();
    opened = null;
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName(userId));
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
