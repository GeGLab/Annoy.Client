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
    const env = { ...process.env, ANNOY_GLOBAL_URL: auth.url, ANNOY_TEST_DATA: directory, ELECTRON_RENDERER_URL: "http://127.0.0.1:5178" };
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

test("M7 catalog pages are incremental, searchable and cached for offline use", async ({ libraryPage: page }) => {
  const result = await page.evaluate(async () => {
    const catalog = await import(/* @vite-ignore */ `${location.origin}/src/features/expression/catalog.ts`);
    const original = window.fetch, requested: string[] = [];
    window.fetch = async (...args) => { requested.push(String(args[0])); return original(...args); };
    const first = await catalog.readCatalogPage();
    const second = await catalog.readCatalogPage({ after: first.next });
    const search = await catalog.readCatalogPage({ query: "cafe" });
    const category = await catalog.readCatalogPage({ category: "nature" });
    const lib = await import(/* @vite-ignore */ `${location.origin}/src/features/expression/library.ts`);
    await lib.installPack(first.items[0]);
    window.fetch = async () => { throw new TypeError("Offline"); };
    const offline = await lib.readPack(first.items[0].id);
    const cached = await catalog.readCatalogPage();
    window.fetch = original;
    return { counts: [first.items.length, second.items.length], different: first.items[0].id !== second.items[0].id, manifests: requested.filter((url) => url.endsWith(".json")).length, images: requested.filter((url) => url.endsWith(".png")).length, found: search.items[0].id, category: category.items[0].category, offline: offline!.items.every((item: any) => item.blob?.size > 0), cached: cached.items[0].id, credits: !!first.items[0].version && !!first.items[0].licenseUrl && !!first.items[0].credits };
  });
  expect(result).toMatchObject({ counts: [2, 2], different: true, manifests: 3, images: 6, found: "openmoji-food", category: "nature", offline: true, cached: "openmoji-animals", credits: true });
});

test("M7 catalog UI retries failed reads and filters without installing media", async ({ libraryPage: page }) => {
  let fail = true, images = 0;
  await page.route("**/expression/catalog/index.json", (route) => fail ? route.fulfill({ status: 503, body: "unavailable" }) : route.continue());
  page.on("request", (request) => { if (/expression\/openmoji\/.*\.png/.test(request.url())) images++; });
  await page.evaluate(async () => {
    const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
    setState((s: any) => { s.modal = { kind: "userSettings", section: "expressions" }; });
  });
  const catalog = page.getByRole("region", { name: "Catálogo licenciado" });
  await expect(catalog.getByRole("alert")).toBeVisible();
  fail = false;
  await catalog.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(catalog).toContainText("Bichos do OpenMoji");
  await catalog.getByLabel("Pesquisar catálogo").fill("cafe");
  await expect(catalog.locator(".expression-pack")).toHaveCount(1);
  await expect(catalog).toContainText("Sabores do OpenMoji");
  await catalog.locator("summary").click();
  await expect(catalog.getByRole("link", { name: "CC BY-SA 4.0" })).toHaveAttribute("href", "https://creativecommons.org/licenses/by-sa/4.0/");
  await catalog.getByLabel("Pesquisar catálogo").fill("inexistente-xyz");
  await expect(catalog).toContainText("Nenhum pacote encontrado");
  expect(images).toBeLessThan(36);
  expect(await page.evaluate(async () => (await (await import(/* @vite-ignore */ `${location.origin}/src/features/expression/storage.ts`)).readPackPage()).items.length)).toBe(0);
});

test("M7 cached manifests and installed images survive renderer restart offline", async ({ libraryPage: page }) => {
  await page.evaluate(async () => {
    const catalog = await import(/* @vite-ignore */ `${location.origin}/src/features/expression/catalog.ts`);
    const lib = await import(/* @vite-ignore */ `${location.origin}/src/features/expression/library.ts`);
    const first = await catalog.readCatalogPage();
    await lib.installPack(first.items[0]);
  });
  await expect.poll(() => page.evaluate(async () => {
    const { cachedCatalog } = await import(/* @vite-ignore */ `${location.origin}/src/features/expression/storage.ts`);
    return !!await cachedCatalog("catalog:index:1");
  })).toBe(true);
  await page.route("http://127.0.0.1:5178/expression/**", (route) => route.abort("internetdisconnected"));
  await page.reload();
  const result = await page.evaluate(async () => {
    const catalog = await import(/* @vite-ignore */ `${location.origin}/src/features/expression/catalog.ts`);
    const lib = await import(/* @vite-ignore */ `${location.origin}/src/features/expression/library.ts`);
    const cached = await catalog.readCatalogPage();
    const pack = await lib.readPack(cached.items[0].id);
    const original = pack!.items[0].blob!;
    const bytes = new Uint8Array(await original.arrayBuffer());
    return { id: cached.items[0].id, count: pack!.items.length, signature: Array.from(bytes.slice(0, 4)) };
  });
  expect(result).toEqual({ id: "openmoji-animals", count: 6, signature: [137, 80, 78, 71] });
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

test("M7 catalog follows all seven languages and keeps licensed metadata unchanged", async ({ libraryPage: page }) => {
  await page.evaluate(async () => {
    const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
    setState((s: any) => { s.modal = { kind: "userSettings", section: "expressions" }; });
  });
  const catalog = page.locator(".expression-catalog");
  await expect(catalog).toContainText("Bichos do OpenMoji");
  for (const language of ["pt-BR", "en", "es", "fr", "it", "ja", "zh-Hans", "en"]) {
    await page.evaluate(async (language) => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => { s.settings.language = language; });
    }, language);
    const expected = JSON.parse(await readFile(resolve(`src/shared/localization/catalogs/${language}.json`), "utf8"));
    await expect(catalog).toHaveAttribute("aria-label", expected["expression.catalog.ee63de14be85"]);
    await expect(catalog.getByRole("combobox")).toHaveText(expected["expression.catalog.9e753333692c"]);
    await expect(catalog.locator("summary").first()).toHaveText(expected["expression.catalog.225b1203a907"]);
    await expect(catalog).toContainText("Bichos do OpenMoji");
    await expect(catalog).toContainText("CC BY-SA 4.0");
  }
  await page.setViewportSize({ width: 940, height: 620 });
  await page.evaluate(async () => {
    const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
    setState((s: any) => { s.settings.fontSize = 24; s.settings.theme = "light"; });
  });
  expect(await page.locator(".settings-content").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: ".impeccable/review/m7-catalog-english-24px-minimum.png" });
});
