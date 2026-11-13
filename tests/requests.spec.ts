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
    await page.route(`https://requests-${id}.test/api/**`, (route) => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/servers/shared") ? state(id.toUpperCase()) : [] }));
    await page.routeWebSocket(`wss://requests-${id}.test/gateway`, (ws) => ws.onMessage((raw) => {
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
    // The app opens only for a validated session; tests start as signed in.
    // Let the startup session restore finish first: on a slow runner it can end after
    // this line and sign the forced test session out.
    await (await import(/* @vite-ignore */ `${location.origin}/src/auth/session.ts`)).restoreSession();
    const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
    setState((s: any) => { s.access = { allowed: true, global: true, localAccounts: [] }; s.global = { id: "global-test", name: "Test", email: "test@example.com" }; });
    const { addAccount } = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
    for (const id of ["a", "b"]) addAccount({ id, url: `https://requests-${id}.test`, userId: "me", token: `synthetic-${id}`, instanceName: `Instância ${id}` });
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
  await page.route("https://requests-a.test/api/channels/chat/messages**", async (route) => {
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
  // A failed send keeps the draft.
  await page.getByRole("button", { name: "Enviar mensagem", exact: true }).click();
  await expect.poll(() => writes).toBe(1);
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
  await page.route("https://requests-a.test/api/servers/shared**", async (route) => {
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
  await page.route("https://requests-a.test/api/channels/chat/messages?around=target", async (route) => {
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
  await page.route("https://requests-a.test/api/obsolete", async (route) => { oldStarted = true; await old.promise; await route.fulfill({ json: { stale: true } }).catch(() => {}); });
  await page.evaluate(async () => {
    const client = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
    (window as any).__old = client.apiFor("a").get("/obsolete").catch((error: Error) => error.name);
  });
  await expect.poll(() => oldStarted).toBe(true);
  await page.evaluate(async () => {
    const client = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
    client.addAccount({ id: "a", url: "https://requests-a.test", userId: "me", token: "replacement-token", instanceName: "Substituta" });
  });
  expect(await page.evaluate(() => (window as any).__old)).toBe("AbortError");
  old.resolve();
  await expect.poll(() => page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/store.ts`)).getState().accounts.find((a: any) => a.id === "a")?.token)).toBe("replacement-token");
});

test("requests distinguish forbidden access from an expired session discovered over HTTP", async ({ page }) => {
  await seed(page);
  await open(page);
  let status = 403;
  await page.route("https://requests-a.test/api/private", (route) => route.fulfill({ status, contentType: "text/html", body: "<html>proxy</html>" }));
  const ask = () => page.evaluate(async () => {
    const client = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
    return client.apiFor("a").get("/private").catch((error: any) => ({ status: error.status, kind: error.kind }));
  });
  expect(await ask()).toEqual({ status: 403, kind: "forbidden" });
  await expect(page.locator(".connection-recovery")).toHaveCount(0);
  status = 401;
  expect(await ask()).toEqual({ status: 401, kind: "unauthorized" });
  await expect(page.getByRole("region", { name: "Sessão expirada" })).toBeVisible();
  // Only the selected account is shown; the other one stays usable after switching to it.
  await open(page, "b");
  await expect(page.getByRole("textbox", { name: "Conversar em #geral" })).toBeEditable();
});

test("requests cancel authentication when its dialog is closed, without adding an account later", async ({ page }) => {
  const late = deferred();
  let started = false;
  await page.route("https://auth.test/api/info", (route) => route.fulfill({ json: { name: "Teste", registrationOpen: true, registration: "open", discordLogin: false } }));
  await page.route("https://auth.test/api/auth/login", async (route) => {
    started = true;
    await late.promise;
    await route.fulfill({ json: { user: me, token: "obsolete-login" } }).catch(() => {});
  });
  await page.goto("http://127.0.0.1:5178");
  await page.getByRole("button", { name: "Conectar a um servidor", exact: true }).click();
  await page.getByLabel("Endereço", { exact: true }).fill("https://auth.test");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByLabel("Usuário neste servidor", { exact: true }).fill("tester");
  await page.getByLabel("Senha local", { exact: true }).fill("synthetic");
  await page.locator('.auth-modal button[type="submit"]').click();
  await expect.poll(() => started).toBe(true);
  await page.keyboard.press("Escape");
  late.resolve();
  await expect(page.getByRole("heading", { name: "Entre no Annoy", exact: true })).toBeVisible();
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
  const globalUrl = await page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/auth/session.ts`)).authBaseUrl());
  const late = deferred();
  let started = false;
  await page.route(`${globalUrl}/v1/auth/prelogin`, (route) => route.fulfill({ json: { salt: fixture.salt, iterations: 1 } }));
  await page.route(`${globalUrl}/v1/auth/login`, async (route) => {
    started = true;
    await late.promise;
    await route.fulfill({ json: { token: "obsolete", wrappedKeys: fixture.wrappedKeys, user: { id: "old", name: "Antiga", email: "old@example.test" } } }).catch(() => {});
  });
  await page.evaluate(async () => {
    const auth = await import(/* @vite-ignore */ `${location.origin}/src/auth/session.ts`);
    (window as any).__login = auth.signIn("old@example.test", "synthetic").catch((error: Error) => error.name);
  });
  await expect.poll(() => started).toBe(true);
  await page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/auth/session.ts`)).cancelPending());
  expect(await page.evaluate(() => (window as any).__login)).toBe("AbortError");
  late.resolve();
  await expect.poll(() => page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/store.ts`)).getState().global)).toBe(null);
});

async function special(page: Page, id: string, type: "code" | "song") {
  await open(page);
  await page.evaluate(async ({ id, type }) => {
    const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
    const { openChannel } = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
    setState((s: any) => { s.instances.a.serverStates.shared.channels.push({ id, serverId: "shared", name: id, type, topic: "", parentId: null, position: 1, overwrites: [] }); });
    openChannel("a", "shared", id);
  }, { id, type });
}

test("code saves coalesce, preserve edits made during a request and guard navigation after a failure", async ({ page }) => {
  await seed(page);
  let writes = 0, fail = false;
  const held = deferred();
  await page.route("https://requests-a.test/api/channels/code/code**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/tree")) return route.fulfill({ json: [{ path: "main.ts", type: "file", size: 8 }] });
    if (path.endsWith("/status")) return route.fulfill({ json: { branch: "main", upstream: null, ahead: 0, behind: 0, files: [], branches: ["main"], log: [] } });
    if (path.endsWith("/file")) {
      if (route.request().method() === "PUT") {
        writes++; if (writes === 1) await held.promise;
        if (fail) return route.fulfill({ status: 503, json: { message: "Falha ao salvar código" } });
        return route.fulfill({ json: { path: "main.ts", content: route.request().postDataJSON().content, hash: `hash-${writes}`, binary: false } });
      }
      return route.fulfill({ json: { path: "main.ts", content: "initial", hash: "hash-0", binary: false } });
    }
    return route.fulfill({ json: { channelId: "code", status: "ready", url: "https://example.test/repo", branch: "main", head: "h", error: null } });
  });
  await special(page, "code", "code");
  await page.locator(".code-node").filter({ hasText: "main.ts" }).click();
  await expect(page.locator(".code-tab")).toContainText("main.ts");
  const edit = (value: string) => page.evaluate(async (value) => {
    const { monaco } = await import(/* @vite-ignore */ `${location.origin}/src/features/channels/monaco.ts`);
    monaco.editor.getModels().find((model: any) => model.uri.path === "/code/main.ts")!.setValue(value);
  }, value);
  await edit("first edit");
  await page.locator(".code-save").click();
  await expect.poll(() => writes).toBe(1);
  await expect(page.locator(".code-save")).toBeDisabled();
  await edit("edit while saving");
  held.resolve();
  await expect(page.locator(".code-save")).toBeEnabled();
  await expect(page.locator(".code-dirty")).toHaveCount(1);
  fail = true;
  await page.locator(".code-save").click();
  await expect(page.locator(".toast")).toContainText("Falha ao salvar código");
  await expect(page.locator(".code-dirty")).toHaveCount(1);
  await page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/client.ts`)).openChannel("a", "shared", "chat"));
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(page.locator(".code-tab")).toContainText("main.ts");
  expect(writes).toBe(2);
});

test("playback failures preserve the submitted URL and ignore stale responses after changing channels", async ({ page }) => {
  await seed(page);
  let writes = 0, fail = true;
  const late = deferred();
  const playback = { channelId: "music", queue: [], currentId: null, paused: true, position: 0, updatedAt: Date.now(), serverTime: Date.now(), autoplay: true };
  await page.route("https://requests-a.test/api/channels/music/playback", async (route) => {
    if (route.request().method() === "POST") {
      writes++;
      if (fail) return route.fulfill({ status: 503, json: { message: "Fila indisponível" } });
      await late.promise;
    }
    await route.fulfill({ json: playback }).catch(() => undefined);
  });
  await special(page, "music", "song");
  await page.getByRole("button", { name: "Pedir uma música", exact: true }).click();
  const input = page.getByRole("textbox", { name: "Link para adicionar à fila" });
  await input.fill("https://example.test/song.mp3");
  await page.locator(".queue-add button[type=submit], .queue-add .btn").first().click();
  await expect(page.locator(".toast")).toContainText("Fila indisponível");
  await expect(input).toHaveValue("https://example.test/song.mp3");
  fail = false;
  await page.locator(".queue-add .btn").first().click();
  await expect.poll(() => writes).toBe(2);
  await page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/client.ts`)).openChannel("a", "shared", "chat"));
  late.resolve();
  await expect(page.getByRole("heading", { name: "geral", exact: true })).toBeVisible();
  await expect(page.locator(".playback-feedback")).toHaveCount(0);
});
