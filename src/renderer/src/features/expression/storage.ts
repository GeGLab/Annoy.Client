import { t as translate } from "../../../../shared/localization/index.ts";
import { searchText, type MediaItem, type MediaKind, type MediaPack, type MediaPage, type PackMetadata } from "./types.ts";

let database: Promise<IDBDatabase> | null = null;
const metadata = (pack: MediaPack): PackMetadata => {
  const { items, ...fields } = pack;
  return { ...fields, itemCount: items.length, kinds: [...new Set(items.map((item) => item.kind))] };
};
function putPack(transaction: IDBTransaction, pack: MediaPack) {
  transaction.objectStore("pack-metadata").put(metadata(pack));
  for (const item of pack.items) {
    const { blob, ...fields } = item;
    transaction.objectStore("item-metadata").put({ ...fields, packId: pack.id, url: blob ? undefined : item.url });
    if (blob) transaction.objectStore("media-blobs").put({ packId: pack.id, id: item.id, blob });
  }
}
function db(): Promise<IDBDatabase> {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("annoy-expression", 2);
    let blocked = false;
    let upgradeError: DOMException | null = null;
    request.onupgradeneeded = () => {
      const connection = request.result, tx = request.transaction!;
      if (!connection.objectStoreNames.contains("packs")) connection.createObjectStore("packs", { keyPath: "id" });
      connection.createObjectStore("pack-metadata", { keyPath: "id" });
      const items = connection.createObjectStore("item-metadata", { keyPath: ["packId", "id"] });
      items.createIndex("packId", "packId");
      items.createIndex("kind", ["kind", "packId", "id"]);
      const blobs = connection.createObjectStore("media-blobs", { keyPath: ["packId", "id"] });
      blobs.createIndex("packId", "packId");
      connection.createObjectStore("catalog-cache", { keyPath: "key" });
      // The legacy store survives. Move each row inside the upgrade transaction:
      // an aborted upgrade restores both the original version and all old rows.
      const cursor = tx.objectStore("packs").openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        try {
          putPack(tx, row.value as MediaPack);
          row.delete();
          row.continue();
        } catch (error) {
          upgradeError = error instanceof DOMException ? error : null;
          try { tx.abort(); } catch { /* The failed write may already have aborted it. */ }
        }
      };
    };
    request.onsuccess = () => {
      const connection = request.result;
      if (blocked) { connection.close(); return; }
      connection.onversionchange = () => { connection.close(); database = null; };
      resolve(connection);
    };
    request.onblocked = () => { blocked = true; reject(new Error(translate("expression.catalog.83634558a688"))); };
    request.onerror = () => { database = null; reject(storageError(upgradeError ?? request.error)); };
  }).catch((error) => { database = null; throw error; });
}
export function storageError(error: DOMException | null): Error {
  return new Error(error?.name === "QuotaExceededError"
    ? translate("expression.catalog.6259cb8f49dd")
    : translate("expression.catalog.3301ac830808"));
}
async function transaction<T>(stores: string[], mode: IDBTransactionMode, action: (tx: IDBTransaction, result: (value: T) => void, fail: (error: unknown) => void) => void, signal?: AbortSignal): Promise<T> {
  const connection = await db();
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const tx = connection.transaction(stores, mode);
    let value: T;
    const cancel = () => tx.abort();
    const cleanup = () => signal?.removeEventListener("abort", cancel);
    signal?.addEventListener("abort", cancel, { once: true });
    tx.oncomplete = () => { cleanup(); resolve(value); };
    tx.onabort = () => { cleanup(); reject(signal?.aborted ? signal.reason : storageError(tx.error)); };
    tx.onerror = () => { /* onabort reports a single, actionable failure. */ };
    const fail = (error: unknown) => { cleanup(); tx.abort(); reject(error instanceof DOMException ? storageError(error) : error); };
    try { action(tx, (result) => { value = result; }, fail); }
    catch (error) { fail(error); }
  });
}
function deleteRows(store: IDBObjectStore, packId: string, done: () => void) {
  const request = store.index("packId").openCursor(IDBKeyRange.only(packId));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) { done(); return; }
    cursor.delete(); cursor.continue();
  };
}
export async function savePack(pack: MediaPack, signal?: AbortSignal): Promise<void> {
  await transaction<void>(["pack-metadata", "item-metadata", "media-blobs"], "readwrite", (tx, _result, fail) => {
    deleteRows(tx.objectStore("item-metadata"), pack.id, () => {
      deleteRows(tx.objectStore("media-blobs"), pack.id, () => {
        try { putPack(tx, pack); } catch (error) { fail(error); }
      });
    });
  }, signal);
}
export async function removePack(id: string): Promise<void> {
  await transaction<void>(["pack-metadata", "item-metadata", "media-blobs"], "readwrite", (tx) => {
    tx.objectStore("pack-metadata").delete(id);
    deleteRows(tx.objectStore("item-metadata"), id, () => {});
    deleteRows(tx.objectStore("media-blobs"), id, () => {});
  });
}
export function readPackPage({ after, query = "", limit = 12 }: { after?: string | null; query?: string; limit?: number } = {}): Promise<MediaPage<PackMetadata>> {
  const size = Math.max(1, Math.min(48, limit)), needle = searchText(query.trim());
  return transaction(["pack-metadata"], "readonly", (tx, result) => {
    const items: PackMetadata[] = [];
    const request = tx.objectStore("pack-metadata").openCursor(after ? IDBKeyRange.lowerBound(after, true) : undefined);
    request.onsuccess = () => {
      const row = request.result;
      if (!row) { result({ items, next: null }); return; }
      const pack = row.value as PackMetadata;
      if (searchText(`${pack.name} ${pack.author} ${pack.license}`).includes(needle)) {
        if (items.length === size) { result({ items, next: items.at(-1)!.id }); return; }
        items.push(pack);
      }
      row.continue();
    };
  });
}
export function readItemPage({ kind, query = "", after, limit = 48 }: { kind: MediaKind; query?: string; after?: string | null; limit?: number }): Promise<MediaPage<MediaItem>> {
  const size = Math.max(1, Math.min(48, limit)), needle = searchText(query.trim());
  return transaction(["item-metadata"], "readonly", (tx, result) => {
    const items: MediaItem[] = [];
    const start = after ? [kind, ...JSON.parse(after) as string[]] : [kind];
    const request = tx.objectStore("item-metadata").index("kind").openCursor(IDBKeyRange.bound(start, [kind, []], !!after));
    request.onsuccess = () => {
      const row = request.result;
      if (!row) { result({ items, next: null }); return; }
      const item = row.value as MediaItem;
      if (searchText(`${item.name} ${item.emoji ?? ""}`).includes(needle)) {
        if (items.length === size) { const last = items.at(-1)!; result({ items, next: JSON.stringify([last.packId, last.id]) }); return; }
        items.push(item);
      }
      row.continue();
    };
  });
}
export function readMediaBlob(packId: string, id: string): Promise<Blob | undefined> {
  return transaction(["media-blobs"], "readonly", (tx, result) => {
    const request = tx.objectStore("media-blobs").get([packId, id]);
    request.onsuccess = () => result(request.result?.blob);
  });
}
export function readPackMetadata(id: string): Promise<PackMetadata | undefined> {
  return transaction(["pack-metadata"], "readonly", (tx, result) => {
    const request = tx.objectStore("pack-metadata").get(id);
    request.onsuccess = () => result(request.result);
  });
}
export function readPack(id: string): Promise<MediaPack | undefined> {
  return transaction(["pack-metadata", "item-metadata", "media-blobs"], "readonly", (tx, result) => {
    const request = tx.objectStore("pack-metadata").get(id);
    request.onsuccess = () => {
      if (!request.result) { result(undefined); return; }
      const { itemCount: _count, kinds: _kinds, ...fields } = request.result as PackMetadata;
      const pack: MediaPack = { ...fields, items: [] };
      const cursor = tx.objectStore("item-metadata").index("packId").openCursor(IDBKeyRange.only(id));
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) { result(pack); return; }
        const item: MediaItem = { ...row.value };
        pack.items.push(item);
        const blob = tx.objectStore("media-blobs").get([id, item.id]);
        blob.onsuccess = () => { if (blob.result) item.blob = blob.result.blob; };
        row.continue();
      };
    };
  });
}
// Compatibility for explicit callers/export tools. UI lists use the paged APIs.
export async function readPacks(): Promise<MediaPack[]> {
  const packs: MediaPack[] = [];
  let after: string | null = null;
  do {
    const page = await readPackPage({ after });
    for (const metadata of page.items) { const pack = await readPack(metadata.id); if (pack) packs.push(pack); }
    after = page.next;
  } while (after);
  return packs;
}
/** Small cache for remote data (the Annoy emoji set and its images). Store name kept for existing databases. */
export function readCache<T>(key: string): Promise<T | undefined> {
  return transaction(["catalog-cache"], "readonly", (tx, result) => {
    const request = tx.objectStore("catalog-cache").get(key);
    request.onsuccess = () => result(request.result?.data);
  });
}
export async function writeCache(key: string, data: unknown): Promise<void> {
  await transaction<void>(["catalog-cache"], "readwrite", (tx) => { tx.objectStore("catalog-cache").put({ key, data }); });
}
/** Deletes every entry except the ones in keep (old catalog pages included). */
export async function pruneCache(keep: Set<string>): Promise<void> {
  await transaction<void>(["catalog-cache"], "readwrite", (tx) => {
    const store = tx.objectStore("catalog-cache");
    const keys = store.getAllKeys();
    keys.onsuccess = () => { for (const key of keys.result) if (!keep.has(String(key))) store.delete(key); };
  });
}
