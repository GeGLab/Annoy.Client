import { electron } from "./fixtures/electron-launch.ts";
import { globalAuthFixture } from "./fixtures/global-auth.ts";
import { test as base, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const test = base.extend<{ libraryPage: Page }>({
  libraryPage: async ({}, use) => {
    const directory = await mkdtemp(join(tmpdir(), "annoy-catalog-test-"));
    const auth = await globalAuthFixture();
    const env = { ...process.env, ANNOY_GLOBAL_URL: auth.url, ANNOY_TEST_DATA: directory, ELECTRON_RENDERER_URL: "http://127.0.0.1:5178", ANNOY_CDN_URL: "http://127.0.0.1:5178" };
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await electron.launch({ executablePath: require("electron"), args: [resolve("tests/fixtures/electron.cjs")], env });
    try {
      const page = await app.firstWindow();
      await auth.keepAuthenticated(page);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await use(page);
    } finally {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.destroy())).catch(() => undefined);
      await app.close(); await auth.close();
      if (!directory.startsWith(join(tmpdir(), "annoy-catalog-test-"))) throw new Error("Unsafe test directory");
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  },
});

test("M7 upgrades legacy packs atomically and lists metadata without reading blobs", async ({ libraryPage: page }) => {
  const result = await page.evaluate(async () => {
    const legacy = { id: "legacy", name: "Pacote legado", author: "Pessoa", license: "Pessoal", source: "local", items: [{ id: "a", name: "Imagem", kind: "sticker", blob: new Blob(["legacy-image"], { type: "image/png" }) }] };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("annoy-expression", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("packs", { keyPath: "id" }).put(legacy);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { request.result.close(); resolve(); };
    });
    const storage = await import(/* @vite-ignore */ `${location.origin}/src/features/expression/storage.ts`);
    const original = IDBDatabase.prototype.transaction;
    const reads: string[] = [];
    IDBDatabase.prototype.transaction = function (names: string | string[], ...args: any[]) {
      reads.push(...(typeof names === "string" ? [names] : names));
      return original.call(this, names, ...args);
    } as typeof original;
    const packs = await storage.readPackPage();
    const items = await storage.readItemPage({ kind: "sticker" });
    IDBDatabase.prototype.transaction = original;
    const pack = await storage.readPack("legacy");
    const exported = await (await import(/* @vite-ignore */ `${location.origin}/src/features/expression/library.ts`)).exportPack(pack!);
    return { names: packs.items.map((p: any) => p.name), count: packs.items[0].itemCount, metadataOnly: !reads.includes("media-blobs") && !items.items[0].blob, bytes: await pack!.items[0].blob!.text(), exportHasImage: (await exported.text()).includes("data:image/png;base64,") };
  });
  expect(result).toEqual({ names: ["Pacote legado"], count: 1, metadataOnly: true, bytes: "legacy-image", exportHasImage: true });
});

test("M7 pages indexed metadata and searches beyond the first page", async ({ libraryPage: page }) => {
  const result = await page.evaluate(async () => {
    const s = await import(/* @vite-ignore */ `${location.origin}/src/features/expression/storage.ts`);
    for (let i = 0; i < 70; i++) await s.savePack({ id: `pack-${String(i).padStart(3, "0")}`, name: `Coleção ${i}`, author: "Pessoa", license: "Pessoal", source: "local", items: [{ id: "one", name: i === 69 ? "Último café" : "Imagem", kind: "sticker", blob: new Blob(["image"], { type: "image/png" }) }] });
    const first = await s.readPackPage();
    const second = await s.readPackPage({ after: first.next });
    const media = await s.readItemPage({ kind: "sticker" });
    const remaining = await s.readItemPage({ kind: "sticker", after: media.next });
    const search = await s.readItemPage({ kind: "sticker", query: "ultimo cafe" });
    return { first: first.items.length, second: second.items[0].id, itemCounts: [media.items.length, remaining.items.length], end: remaining.next, found: search.items[0].packId };
  });
  expect(result).toEqual({ first: 12, second: "pack-012", itemCounts: [48, 22], end: null, found: "pack-069" });
});

test("M7 interrupted downloads, cancellation, quota and integrity failures preserve installed packs", async ({ libraryPage: page }) => {
  const result = await page.evaluate(async () => {
    const lib = await import(/* @vite-ignore */ `${location.origin}/src/features/expression/library.ts`);
    const pack = { id: "atomic", name: "Original", author: "Pessoa", license: "Pessoal", source: "local", items: [{ id: "old", name: "Original", kind: "sticker", blob: new Blob(["original"], { type: "image/png" }) }] };
    await lib.installPack(pack);
    const originalFetch = window.fetch;
    let downloads = 0;
    window.fetch = async () => { if (++downloads === 2) throw new TypeError("Interrupted"); return new Response(new Blob(["new"], { type: "image/png" }), { headers: { "content-type": "image/png" } }); };
    let failures = 0;
    try { await lib.installPack({ ...pack, name: "Interrupted", items: [{ id: "a", name: "A", kind: "sticker", url: "https://assets.test/a.png" }, { id: "b", name: "B", kind: "sticker", url: "https://assets.test/b.png" }] }); } catch { failures++; }
    window.fetch = originalFetch;
    const controller = new AbortController();
    try { await lib.installPack({ ...pack, name: "Cancelled" }, { signal: controller.signal, onProgress: () => controller.abort() }); } catch { failures++; }
    try { await lib.installPack({ ...pack, items: [{ ...pack.items[0], sha256: "0".repeat(64) }] }); } catch { failures++; }
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: any[]) {
      if (this.name === "media-blobs") throw new DOMException("Quota", "QuotaExceededError");
      return put.apply(this, args as [any]);
    };
    let quotaMessage = "";
    try { await lib.installPack({ ...pack, name: "Quota" }); } catch (error) { failures++; quotaMessage = (error as Error).message; }
    IDBObjectStore.prototype.put = put;
    const saved = await lib.readPack("atomic");
    return { failures, name: saved!.name, items: saved!.items.length, data: await saved!.items[0].blob!.text(), quotaMessage };
  });
  expect(result.failures).toBe(4);
  expect(result).toMatchObject({ name: "Original", items: 1, data: "original" });
  expect(result.quotaMessage).toContain("espaço");
});

test("M7 failed legacy migration rolls back version and keeps the original bytes", async ({ libraryPage: page }) => {
  const result = await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("annoy-expression", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("packs", { keyPath: "id" }).put({ id: "legacy", name: "Original", author: "Pessoa", license: "Pessoal", source: "local", items: [{ id: "one", name: "Imagem", kind: "sticker", blob: new Blob(["unchanged"], { type: "image/png" }) }] });
      request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error);
    });
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: any[]) {
      if (this.name === "media-blobs") { this.transaction.abort(); throw new DOMException("Quota", "QuotaExceededError"); }
      return put.apply(this, args as [any]);
    };
    const lib = await import(/* @vite-ignore */ `${location.origin}/src/features/expression/storage.ts`);
    let rejected = false;
    try { await lib.readPackPage(); } catch { rejected = true; }
    IDBObjectStore.prototype.put = put;
    const before = await new Promise<{ version: number; bytes: string }>((resolve, reject) => {
      const request = indexedDB.open("annoy-expression", 1);
      request.onsuccess = () => {
        const db = request.result, row = db.transaction("packs").objectStore("packs").get("legacy");
        row.onsuccess = async () => { const bytes = await row.result.items[0].blob.text(); const version = db.version; db.close(); resolve({ version, bytes }); };
      };
      request.onerror = () => reject(request.error);
    });
    // Retry uses a fresh connection and completes the same migration.
    const retried = await lib.readPack("legacy");
    return { rejected, ...before, retried: await retried!.items[0].blob!.text() };
  });
  expect(result).toEqual({ rejected: true, version: 1, bytes: "unchanged", retried: "unchanged" });
});

test("the Annoy emoji set comes from the local cache and asks cdnannoy at most every 2 hours", async ({ libraryPage: page }) => {
  await page.evaluate(() => localStorage.setItem("annoy.cloudUrls", JSON.stringify({ cdn: "http://cdn.test" })));
  await page.reload();
  const result = await page.evaluate(async () => {
    const set = await import(/* @vite-ignore */ `${location.origin}/src/features/expression/annoy-set.ts`);
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const image = "http://cdn.test/i/" + "a".repeat(40) + ".png";
    const requests: string[] = [];
    let mode: "ok" | "same" | "down" = "ok";
    const original = window.fetch, realNow = Date.now;
    let offset = 0;
    Date.now = () => realNow() + offset;
    window.fetch = async (input, init) => {
      const url = String(input);
      requests.push(`${url} ${new Headers(init?.headers).get("if-none-match") ?? ""}`.trim());
      if (mode === "down") throw new TypeError("Offline");
      if (url === image) return new Response(png, { headers: { "content-type": "image/png" } });
      if (mode === "same") return new Response(null, { status: 304 });
      return Response.json({ version: "7", items: [{ id: "x1", name: "classic", kind: "sticker", url: image }] }, { headers: { etag: "\"emojis-7\"" } });
    };
    try {
      const first = await set.readAnnoyItems("sticker");
      const bytes = new Uint8Array(await (await set.annoyImage(first[0].url)).arrayBuffer());
      await set.annoyImage(first[0].url);
      await set.readAnnoyItems("sticker", "class");
      const cachedOnly = requests.length;
      offset = set.REFRESH_MS + 1000; mode = "same";
      const revalidated = await set.readAnnoyItems("sticker");
      offset = 2 * set.REFRESH_MS + 2000; mode = "down";
      const offline = await set.readAnnoyItems("sticker");
      await set.readAnnoyItems("sticker");
      return { names: first.map((item: any) => item.name), emoji: (await set.readAnnoyItems("emoji")).length, signature: Array.from(bytes.slice(0, 4)), cachedOnly, revalidated: revalidated.length, offline: offline.length, requests };
    } finally { window.fetch = original; Date.now = realNow; localStorage.removeItem("annoy.cloudUrls"); }
  });
  expect(result).toEqual({
    names: ["classic"], emoji: 0, signature: [137, 80, 78, 71], cachedOnly: 2, revalidated: 1, offline: 1,
    // One list, one image; then one revalidation with the ETag; one failed check and no retry right after.
    requests: ["http://cdn.test/v1/emojis", "http://cdn.test/i/" + "a".repeat(40) + ".png", 'http://cdn.test/v1/emojis "emojis-7"', 'http://cdn.test/v1/emojis "emojis-7"'],
  });
});


test("ZIP import previews selected images, retains names and types, and persists without setting display sizes", async ({ libraryPage: page }) => {
  const { mediaZip } = await import("./fixtures/media-zip.ts");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=", "base64");
  const zip = mediaZip([
    { name: "pasta/café.png", data: png, method: 0 },
    { name: "animado.gif", data: await readFile("tests/fixtures/profile-animation.gif") },
    { name: "outra/café.png", data: png },
    { name: "falso.png", data: Buffer.from("not an image") },
    { name: "__MACOSX/._café.png", data: png },
    { name: "leia.txt", data: Buffer.from("text") },
  ]);
  await page.getByRole("button", { name: "Configurações", exact: true }).click();
  await page.getByRole("button", { name: "Emojis e mídia", exact: true }).click();
  const input = page.getByLabel("Importar ZIP da biblioteca", { exact: true });
  await input.setInputFiles({ name: "Minha coleção.zip", mimeType: "application/zip", buffer: zip });
  const preview = page.getByRole("region", { name: "Prévia do ZIP", exact: true });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("4 imagens · 3 marcadas");
  await expect(preview.getByRole("checkbox", { name: "Importar falso.png", exact: true })).toBeDisabled();
  await expect(preview.locator("img")).toHaveCount(3);
  await expect(preview.getByRole("spinbutton")).toHaveCount(0);
  await preview.getByLabel("Nome do pacote", { exact: true }).fill("Meu pacote ZIP");
  await preview.getByLabel("Nome para pasta/café.png", { exact: true }).fill("Café especial");
  await preview.getByRole("combobox", { name: "Tipo de pasta/café.png", exact: true }).click();
  await page.getByRole("option", { name: "Emoji", exact: true }).click();
  await preview.getByRole("checkbox", { name: "Importar outra/café.png", exact: true }).uncheck();
  await page.screenshot({ path: ".impeccable/review/media-zip-preview.png" });
  await preview.getByRole("button", { name: "Importar marcados", exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(page.locator(".expression-installed")).toContainText("Meu pacote ZIP");
  await page.reload();
  const saved = await page.evaluate(async () => {
    const lib = await import(/* @vite-ignore */ `${location.origin}/src/features/expression/library.ts`);
    const meta = (await lib.readPackPage()).items.find((pack: any) => pack.name === "Meu pacote ZIP");
    const pack = await lib.readPack(meta!.id);
    return pack!.items.map((item: any) => ({ name: item.name, kind: item.kind, type: item.blob.type, size: item.size ?? null }));
  });
  expect(saved).toHaveLength(2);
  expect(saved).toEqual(expect.arrayContaining([{ name: "Café especial", kind: "emoji", type: "image/png", size: null }, { name: "animado", kind: "gif", type: "image/gif", size: null }]));
  await page.getByRole("button", { name: "Configurações", exact: true }).click();
  await page.getByRole("button", { name: "Emojis e mídia", exact: true }).click();
  await input.setInputFiles({ name: "Cancelar.zip", mimeType: "application/zip", buffer: zip });
  await preview.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(preview).toHaveCount(0);
  await input.setInputFiles({ name: "Inválido.zip", mimeType: "application/zip", buffer: zip.subarray(0, 20) });
  await expect(page.getByRole("alert")).toContainText("ZIP inválido");
  await expect(page.locator(".expression-installed")).toContainText("Meu pacote ZIP");
});

test("ZIP reader bounds decompression and rejects invalid archives, encryption and corrupt image data", async ({ libraryPage: page }) => {
  const { mediaZip } = await import("./fixtures/media-zip.ts");
  const data = Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "binary"), Buffer.alloc(1024)]);
  const zip = mediaZip([
    { name: "oversized.png", data, declaredSize: 1 },
    { name: "crc.png", data, badCrc: true },
    { name: "encrypted.png", data, flags: 1 },
    { name: "method.png", data, method: 99 },
    { name: "huge.png", data, declaredSize: 9 * 1024 * 1024 },
    { name: "valid.png", data },
  ]);
  const result = await page.evaluate(async ({ bytes, empty }) => {
    const { readImageZip } = await import(/* @vite-ignore */ `${location.origin}/src/features/expression/zip.ts`);
    const file = new Blob([Uint8Array.from(bytes)]);
    const rows = await readImageZip(file);
    const aborted = new AbortController(); aborted.abort();
    let cancelled = false, rejectedEmpty = false;
    try { await readImageZip(file, aborted.signal); } catch (error) { cancelled = (error as Error).name === "AbortError"; }
    try { await readImageZip(new Blob([Uint8Array.from(empty)])); } catch { rejectedEmpty = true; }
    return { valid: rows.filter((row: any) => row.blob).map((row: any) => row.path), errors: rows.filter((row: any) => row.problem).length, cancelled, rejectedEmpty };
  }, { bytes: [...zip], empty: [...mediaZip([{ name: "readme.txt", data: Buffer.from("text") }])] });
  expect(result).toEqual({ valid: ["valid.png"], errors: 5, cancelled: true, rejectedEmpty: true });
});
