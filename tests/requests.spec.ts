import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const me = { id: "me", username: "tester", displayName: "Pessoa de teste", avatarUrl: null };
const summary = (name: string) => ({ id: "shared", name, ownerId: "me", iconUrl: null });
const state = (name: string) => ({
  server: summary(name), channels: [{ id: "chat", serverId: "shared", name: "geral", type: "text", topic: "", parentId: null, position: 0, overwrites: [] }],
  members: [{ user: me, roleIds: ["shared"], nick: null, joinedAt: "2026-01-01", presence: "online" }],
  roles: [{ id: "shared", serverId: "shared", name: "Membros", color: null, position: 0, permissions: 2147483647 }], voiceStates: [], permissions: 2147483647,
});
const message = { id: "target", channelId: "chat", author: me, content: "Contexto atrasado", attachments: [], replyToId: null, createdAt: "2026-01-01T12:00:00Z", editedAt: null, mentionIds: [], mentionsEveryone: false };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };

async function seed(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const id of ["a", "b"]) {
    await page.route(`http://requests-${id}.test/api/**`, (route) => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/servers/shared") ? state(id.toUpperCase()) : [] }));
    await page.routeWebSocket(`ws://requests-${id}.test/gateway`, (ws) => ws.onMessage((raw) => {
      const payload = JSON.parse(String(raw));
      if (payload.op === "identify") ws.send(JSON.stringify({ t: "READY", d: {
        user: me, servers: [summary(id.toUpperCase())], dms: [], relationships: [], presences: { me: "online" },
        instance: { isAdmin: false, registration: "open", voiceBackend: "builtin" },
      } }));
      if (payload.op === "heartbeat") ws.send(JSON.stringify({ t: "HEARTBEAT_ACK", d: null }));
    }));
  }
  await page.goto("http://127.0.0.1:5178");
  await page.evaluate(async () => {
    const { addAccount } = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
    for (const id of ["a", "b"]) addAccount({ id, url: `http://requests-${id}.test`, userId: "me", token: `synthetic-${id}`, instanceName: `Instância ${id}` });
  });
  await expect.poll(() => page.evaluate(async () => {
    const { getState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
    return [getState().instances.a?.status, getState().instances.b?.status];
  })).toEqual(["ready", "ready"]);
}

async function open(page: Page, account = "a") {
  await page.evaluate(async (id) => (await import(/* @vite-ignore */ `${location.origin}/src/client.ts`)).openServer(id, "shared"), account);
  await expect(page.getByRole("heading", { name: "geral", exact: true })).toBeVisible();
}

test("requests show history failures with retry and preserve the message draft after a failed write", async ({ page }) => {
  await seed(page);
  let historyReads = 0, writes = 0;
  let failHistory = true;
  const write = deferred();
  await page.route("http://requests-a.test/api/channels/chat/messages**", async (route) => {
    if (route.request().method() === "POST") {
      writes++;
      await write.promise;
      return route.fulfill({ status: 503, json: { message: "Envio indisponível. Tente novamente." } });
    }
    historyReads++;
    return route.fulfill({ status: failHistory ? 503 : 200, json: failHistory ? { message: "Histórico indisponível. Tente novamente." } : [message] });
  });
  await open(page);
  await expect(page.getByRole("alert")).toContainText("Histórico indisponível");
  await expect(page.locator(".channel-start")).toHaveCount(0);
  await mkdir(".impeccable/review", { recursive: true });
  await page.screenshot({ path: ".impeccable/review/requests-history-dark.png" });
  await page.setViewportSize({ width: 940, height: 620 });
  await page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/store.ts`)).setState((s: any) => { s.settings.theme = "light"; }));
  await page.screenshot({ path: ".impeccable/review/requests-history-light-minimum.png" });
  failHistory = false;
  await page.getByRole("button", { name: "Tentar carregar mensagens novamente" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".message-body")).toContainText("Contexto atrasado");
  expect(historyReads).toBe(2);
  const input = page.getByRole("textbox", { name: "Conversar em #geral" });
  await input.fill("Texto preservado após erro");
  await page.getByRole("button", { name: "Enviar mensagem", exact: true }).click();
  await expect.poll(() => writes).toBe(1);
  await input.press("Enter");
  write.resolve();
  await expect(page.locator(".toast")).toContainText("Envio indisponível");
  await expect(input).toHaveValue("Texto preservado após erro");
  await expect(page.getByRole("button", { name: "Enviar mensagem", exact: true })).toBeEnabled();
  expect(writes).toBe(1);
});

test("requests coalesce server reads and cannot navigate across accounts with identical server/channel IDs", async ({ page }) => {
  await seed(page);
  const late = deferred();
  let reads = 0;
  await page.route("http://requests-a.test/api/servers/shared**", async (route) => {
    reads++;
    await late.promise;
    await route.fulfill({ json: state("A atrasada") }).catch(() => {});
  });
  await page.evaluate(async () => {
    const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
    const client = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
    setState((s: any) => { delete s.instances.a.serverStates.shared; });
    (window as any).__opening = client.openServer("a", "shared");
  });
  await expect.poll(() => reads).toBe(1);
  await open(page, "b");
  late.resolve();
  await page.evaluate(() => (window as any).__opening);
  expect(reads).toBe(1);
  await expect.poll(() => page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/store.ts`)).getState().view)).toMatchObject({ kind: "server", accountId: "b", serverId: "shared", channelId: "chat" });
  await expect(page.locator(".connection-recovery")).toHaveCount(0);
});

test("requests cancel stale history/context and replaced-account responses cannot recreate old data", async ({ page }) => {
  await seed(page);
  await open(page);
  const late = deferred();
  let started = 0;
  await page.route("http://requests-a.test/api/channels/chat/messages?around=target", async (route) => {
    started++;
    await late.promise;
    await route.fulfill({ json: [message] }).catch(() => {});
  });
  await page.evaluate(async () => {
    const client = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
    (window as any).__jump = client.jumpToMessage("a", "chat", "target", "shared").catch((error: Error) => error.name);
  });
  await expect.poll(() => started).toBe(1);
  await open(page, "b");
  expect(await page.evaluate(() => (window as any).__jump)).toBe("AbortError");
  late.resolve();
  await expect.poll(() => page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/store.ts`)).getState().messageFocus)).toBe(null);

  const old = deferred();
  let oldStarted = false;
  await page.route("http://requests-a.test/api/obsolete", async (route) => { oldStarted = true; await old.promise; await route.fulfill({ json: { stale: true } }).catch(() => {}); });
  await page.evaluate(async () => {
    const client = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
    (window as any).__old = client.apiFor("a").get("/obsolete").catch((error: Error) => error.name);
  });
  await expect.poll(() => oldStarted).toBe(true);
  await page.evaluate(async () => {
    const client = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
    client.addAccount({ id: "a", url: "http://requests-a.test", userId: "me", token: "replacement-token", instanceName: "Substituta" });
  });
  expect(await page.evaluate(() => (window as any).__old)).toBe("AbortError");
  old.resolve();
  await expect.poll(() => page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/store.ts`)).getState().accounts.find((a: any) => a.id === "a")?.token)).toBe("replacement-token");
});

test("requests distinguish forbidden access from an expired session discovered over HTTP", async ({ page }) => {
  await seed(page);
  await open(page);
  let status = 403;
  await page.route("http://requests-a.test/api/private", (route) => route.fulfill({ status, contentType: "text/html", body: "<html>proxy</html>" }));
  const ask = () => page.evaluate(async () => {
    const client = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
    return client.apiFor("a").get("/private").catch((error: any) => ({ status: error.status, kind: error.kind }));
  });
  expect(await ask()).toEqual({ status: 403, kind: "forbidden" });
  await expect(page.locator(".connection-recovery")).toHaveCount(0);
  status = 401;
  expect(await ask()).toEqual({ status: 401, kind: "unauthorized" });
  await expect(page.getByRole("region", { name: "Sessão expirada" })).toBeVisible();
  await page.getByRole("button", { name: "B · Instância b", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Conversar em #geral" })).toBeEditable();
});

test("requests cancel authentication when its dialog is closed, without adding an account later", async ({ page }) => {
  const late = deferred();
  let started = false;
  await page.route("http://auth.test/api/info", (route) => route.fulfill({ json: { name: "Teste", registrationOpen: true, registration: "open", discordLogin: false } }));
  await page.route("http://auth.test/api/auth/login", async (route) => {
    started = true;
    await late.promise;
    await route.fulfill({ json: { user: me, token: "obsolete-login" } }).catch(() => {});
  });
  await page.goto("http://127.0.0.1:5178");
  await page.getByRole("button", { name: "Conectar a um servidor Annoy", exact: true }).click();
  await page.getByLabel("Endereço", { exact: true }).fill("http://auth.test");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByLabel("Usuário", { exact: true }).fill("tester");
  await page.getByLabel("Senha", { exact: true }).fill("synthetic");
  await page.locator('.auth-modal button[type="submit"]').click();
  await expect.poll(() => started).toBe(true);
  await page.keyboard.press("Escape");
  late.resolve();
  await expect(page.locator(".welcome")).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/store.ts`)).getState().accounts.length)).toBe(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("requests cannot restore a Global session after sign-out while login is pending", async ({ page }) => {
  await page.goto("http://127.0.0.1:5178");
  const fixture = await page.evaluate(async () => {
    const kdf = await import(/* @vite-ignore */ `${location.origin}/src/global-crypto.ts`);
    const salt = kdf.newSalt(), { wrapKey } = await kdf.derivePasswordKeys("synthetic", salt, 1);
    return { salt, wrappedKeys: await kdf.wrapKeys(wrapKey, kdf.newAccountKeys()) };
  });
  const globalUrl = await page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/global.ts`)).GLOBAL_URL);
  const late = deferred();
  let started = false;
  await page.route(`${globalUrl}/v1/auth/prelogin`, (route) => route.fulfill({ json: { salt: fixture.salt, iterations: 1 } }));
  await page.route(`${globalUrl}/v1/auth/login`, async (route) => {
    started = true;
    await late.promise;
    await route.fulfill({ json: { token: "obsolete", wrappedKeys: fixture.wrappedKeys, user: { id: "old", name: "Antiga", email: "old@example.test" } } }).catch(() => {});
  });
  await page.evaluate(async () => {
    const global = await import(/* @vite-ignore */ `${location.origin}/src/global.ts`);
    (window as any).__login = global.signInGlobal("old@example.test", "synthetic").catch((error: Error) => error.name);
  });
  await expect.poll(() => started).toBe(true);
  await page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/global.ts`)).signOutGlobal(false));
  expect(await page.evaluate(() => (window as any).__login)).toBe("AbortError");
  late.resolve();
  await expect.poll(() => page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/store.ts`)).getState().global)).toBe(null);
});
