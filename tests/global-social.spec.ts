// TODO item 1, end to end: two real Annoy apps, two Annoy accounts, no server
// at all. Friends, status, encrypted DMs and a direct call go through the
// Annoy cloud. Needs the local cloud stack (annoy-api-global: npm run
// cloud:dev, the services and a dev Global); set ANNOY_TEST_CLOUD=1 to run.
import { electron } from "./fixtures/electron-launch.ts";
import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as kdf from "../src/renderer/src/global-crypto.ts";

const require = createRequire(import.meta.url);
const GLOBAL = process.env.ANNOY_TEST_GLOBAL_URL ?? "http://127.0.0.1:16340";
const AUTH = process.env.ANNOY_TEST_AUTH_URL ?? "http://127.0.0.1:16335";
const CLOUD = {
  ANNOY_USERS_URL: process.env.ANNOY_TEST_USERS_URL ?? "http://127.0.0.1:16332",
  ANNOY_CHAT_URL: process.env.ANNOY_TEST_CHAT_URL ?? "http://127.0.0.1:16333",
  ANNOY_CDN_URL: process.env.ANNOY_TEST_CDN_URL ?? "http://127.0.0.1:16334",
};

test.skip(!process.env.ANNOY_TEST_CLOUD, "needs the local Annoy cloud stack (ANNOY_TEST_CLOUD=1)");
test.setTimeout(180_000);

let fakeIp = Math.floor(Math.random() * 200);
async function json(path: string, body?: unknown) {
  // The dev Global trusts cf-connecting-ip from 127.0.0.1, so its per-IP sign-up limit doesn't trip the test.
  const headers: Record<string, string> = { "x-forwarded-for": `10.9.${++fakeIp % 250}.${Math.floor(Math.random() * 250)}`, ...(body !== undefined && { "content-type": "application/json" }) };
  const res = await fetch(AUTH + path, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
}

/** A real Annoy account on the dev Global, made the way the website makes it. */
async function account(name: string) {
  const email = `${name}@example.com`, password = `senha forte ${name} 2026`;
  const { iterations } = (await json("/v1/auth/prelogin", { email })).body;
  const keys = kdf.newAccountKeys(), salt = kdf.newSalt();
  const pk = await kdf.derivePasswordKeys(password, salt, iterations);
  const terms = (await json("/v1/terms")).body.version;
  await json("/v1/auth/register", { acceptTerms: terms, email, name, salt, authKey: pk.authKey, wrappedKeys: await kdf.wrapKeys(pk.wrapKey, keys), recovery: { mode: "recoveryKey", wrapped: await kdf.wrapWithRecovery(kdf.newRecoveryKey(), keys) } });
  return { email, password, name };
}

async function launch(label: string, existing?: string) {
  const directory = existing ?? (await mkdtemp(join(tmpdir(), `annoy-social-${label}-`)));
  const env = { ...process.env, ...CLOUD, ANNOY_GLOBAL_URL: GLOBAL, ANNOY_AUTH_URL: AUTH, ANNOY_TEST_DATA: directory, ELECTRON_RENDERER_URL: "http://127.0.0.1:5178" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require("electron"), args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", resolve("tests/fixtures/electron.cjs")], env });
  const page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  return { app, page, directory, quit: () => app.close().catch(() => undefined), close: async () => { await app.close().catch(() => undefined); await rm(directory, { recursive: true, force: true }); } };
}

async function signIn(page: Page, who: { email: string; password: string }) {
  await expect(page.getByRole("heading", { name: "Entre no Annoy" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Usuário ou e-mail").fill(who.email);
  await page.getByLabel("Senha", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  // The Annoy account's home, with no server at all.
  try {
    await expect.poll(() => page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/store.ts`)).getState().social.status), { timeout: 60_000 }).toBe("ready");
    // A new account opens on the welcome; the friends list is one click away.
    await page.locator(".channel").filter({ hasText: "Amigos" }).first().click();
    await expect(page.getByRole("heading", { name: "Amigos" })).toBeVisible();
  } catch (error) {
    await page.screenshot({ path: test.info().outputPath(`signin-${who.email}.png`) });
    console.log("STATE", await page.evaluate(async () => { const { getState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`); const s = getState(); return JSON.stringify({ social: s.social.status, global: !!s.global, view: s.view, modal: s.modal, toast: s.toast }); }));
    throw error;
  }
}

test("two Annoy accounts become friends, see each other online, talk by encrypted DM and call, with no server", async () => {
  const stamp = Date.now().toString(36).slice(-5);
  const alice = await account(`alice_${stamp}`), bruno = await account(`bruno_${stamp}`);
  const a = await launch("a");
  let b = await launch("b");
  try {
    await signIn(a.page, alice);
    await signIn(b.page, bruno);

    // Friend request by username.
    await a.page.getByRole("button", { name: "Adicionar amigo" }).first().click();
    await a.page.getByPlaceholder("nome de usuário ou ID Annoy").fill(bruno.name);
    await a.page.getByRole("button", { name: "Enviar pedido" }).click();
    await b.page.getByRole("button", { name: /Pendentes/ }).click();
    await b.page.getByRole("button", { name: "Aceitar" }).click();

    // Status comes from chatannoy.
    await a.page.getByRole("button", { name: "Online", exact: true }).click();
    await expect(a.page.locator(".friend").filter({ hasText: bruno.name })).toContainText("Online", { timeout: 15_000 });

    // Friend nickname: private, only Alice (who gave it) sees it.
    await a.page.locator(".friend").filter({ hasText: bruno.name }).getByRole("button", { name: `Editar apelido de ${bruno.name}` }).click();
    await expect(a.page.getByText("Apelido para seu amigo. Só você vê.")).toBeVisible();
    await a.page.getByRole("textbox").last().fill("Bruninho");
    await a.page.getByRole("button", { name: "Confirmar" }).click();
    await expect(a.page.locator(".friend").filter({ hasText: "Bruninho" })).toBeVisible({ timeout: 15_000 });
    await a.page.screenshot({ path: test.info().outputPath("friend-nickname.png") });
    await b.page.getByRole("button", { name: "Online", exact: true }).click();
    await expect(b.page.locator(".friend").filter({ hasText: alice.name })).toBeVisible({ timeout: 15_000 });
    expect(await b.page.evaluate(async () => JSON.stringify((await import(/* @vite-ignore */ `${location.origin}/src/store.ts`)).getState().social))).not.toContain("Bruninho");

    // Encrypted DM, both ways.
    await a.page.locator(".friend").filter({ hasText: bruno.name }).getByRole("button", { name: "Mensagem" }).click();
    // Alice's side shows her private nickname for Bruno.
    const aBox = a.page.getByRole("textbox", { name: "Mensagem para Bruninho" });
    await aBox.fill("oi Bruno, mensagem criptografada");
    await aBox.press("Enter");
    await expect(a.page.locator(".message-content").filter({ hasText: "oi Bruno, mensagem criptografada" })).toBeVisible();
    const dmLink = b.page.locator(".channel.dm").filter({ hasText: alice.name });
    await expect(dmLink).toBeVisible({ timeout: 15_000 });
    await dmLink.click();
    await expect(b.page.locator(".message-content").filter({ hasText: "oi Bruno, mensagem criptografada" })).toBeVisible({ timeout: 15_000 });
    const bBox = b.page.getByRole("textbox", { name: `Mensagem para ${alice.name}` });
    await bBox.fill("oi Alice!");
    await bBox.press("Enter");
    await expect(a.page.locator(".message-content").filter({ hasText: "oi Alice!" })).toBeVisible({ timeout: 15_000 });

    // Direct call: ring, answer, connect PC to PC.
    await a.page.getByRole("button", { name: "Ligar para Bruninho" }).click();
    await expect(b.page.getByRole("heading", { name: "Chamada recebida" })).toBeVisible({ timeout: 15_000 });
    await b.page.getByRole("button", { name: "Atender" }).click();
    await expect(a.page.getByText("Chamada conectada")).toBeVisible({ timeout: 30_000 });
    await expect(b.page.getByText("Chamada conectada")).toBeVisible({ timeout: 30_000 });
    await a.page.getByRole("button", { name: "Encerrar" }).click();
    await expect(b.page.getByText("Chamada conectada")).toHaveCount(0, { timeout: 15_000 });

    // A message sent while Bruno is offline waits in chatannoy and arrives when he comes back.
    await b.quit();
    await expect(a.page.locator(".chat-header")).toContainText("Offline", { timeout: 30_000 });
    await aBox.fill("chegou depois?");
    await aBox.press("Enter");
    await expect(a.page.locator(".message-content").filter({ hasText: "chegou depois?" })).toBeVisible();
    b = await launch("b", b.directory);
    await expect.poll(() => b.page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/store.ts`)).getState().social.status), { timeout: 60_000 }).toBe("ready");
    const back = b.page.locator(".channel.dm").filter({ hasText: alice.name });
    // The app reopens on the conversation it showed last, so no unread badge is expected here.
    await back.click();
    await expect(b.page.locator(".message-content").filter({ hasText: "chegou depois?" })).toBeVisible({ timeout: 15_000 });
    // The older messages came from this device's local copy: the server deleted them once delivered.
    await expect(b.page.locator(".message-content").filter({ hasText: "oi Bruno, mensagem criptografada" })).toBeVisible();
  } finally {
    await a.close();
    await b.close();
  }
});

const SERVER = process.env.ANNOY_TEST_SERVER_URL ?? "http://127.0.0.1:8790";

/** Signs the app's Annoy account in to an Annoy-account server, the way the add-server flow does. */
async function joinServer(page: Page, username: string, invite?: string): Promise<{ accountId: string; serverId?: string }> {
  return page.evaluate(
    async ({ url, username, invite }) => {
      const origin = location.origin;
      const g = await import(/* @vite-ignore */ `${origin}/src/auth/servers.ts`);
      const c = await import(/* @vite-ignore */ `${origin}/src/client.ts`);
      const api = await import(/* @vite-ignore */ `${origin}/src/api.ts`);
      const info = await api.fetchInfo(url);
      const auth = await g.signInServer(url, info.globalServerId, { username, displayName: username });
      const account = g.toAccount(url, info, auth);
      c.addAccount(account);
      const { getState } = await import(/* @vite-ignore */ `${origin}/src/store.ts`);
      for (let i = 0; i < 200 && getState().instances[account.id]?.status !== "ready"; i++) await new Promise((r) => setTimeout(r, 100));
      if (getState().instances[account.id]?.status !== "ready") throw new Error(`server connection: ${getState().instances[account.id]?.status}`);
      if (invite) {
        await c.apiFor(account.id).post(`/invites/${invite}`, {});
        return { accountId: account.id };
      }
      const server = await c.apiFor(account.id).post("/servers", { name: "Servidor do teste" });
      return { accountId: account.id, serverId: server.id };
    },
    { url: SERVER, username, invite },
  );
}

test("on an Annoy-account server, member status comes from chatannoy and DMs open in the Annoy home", async () => {
  test.skip(!process.env.ANNOY_TEST_SERVER, "needs a dev annoy-server in Annoy-account mode (ANNOY_TEST_SERVER=1)");
  const stamp = Date.now().toString(36).slice(-5);
  const alice = await account(`carol_${stamp}`), bruno = await account(`davi_${stamp}`);
  const a = await launch("a"), b = await launch("b");
  try {
    await signIn(a.page, alice);
    await signIn(b.page, bruno);
    const owner = await joinServer(a.page, alice.name);
    const code = await a.page.evaluate(async ({ accountId, serverId }) => {
      const c = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
      return (await c.apiFor(accountId).post(`/servers/${serverId}/invites`, {})).code as string;
    }, owner as { accountId: string; serverId: string });
    await joinServer(b.page, bruno.name, code);

    // The server sends no friends, DMs or status for Annoy accounts.
    const ready = await a.page.evaluate(async (accountId) => {
      const { getState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      const inst = getState().instances[accountId];
      return { annoySocial: inst.instance?.annoySocial, rels: inst.relationships.length, dms: inst.dms.length };
    }, owner.accountId);
    expect(ready).toEqual({ annoySocial: true, rels: 0, dms: 0 });

    // Bruno goes "do not disturb": Alice sees it in the server's member list, from chatannoy.
    await a.page.evaluate(async ({ accountId, serverId }) => {
      const c = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
      c.navigate({ kind: "server", accountId, serverId, channelId: null });
    }, owner as { accountId: string; serverId: string });
    await b.page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => { s.settings.manualPresence = "dnd"; });
    });
    await a.page.getByText("geral", { exact: true }).click();
    const member = a.page.locator(".member").filter({ hasText: bruno.name });
    try {
      await expect(member.locator(".presence-dnd")).toBeVisible({ timeout: 20_000 });
    } catch (error) {
      console.log("DEBUG", await a.page.evaluate(async (accountId) => {
        const { getState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
        const s = getState(), inst = s.instances[accountId];
        return JSON.stringify({ view: s.view, members: Object.values(inst.serverStates).flatMap((st: any) => st.members.map((m: any) => [m.user.username, m.user.annoyId, m.presence])), presences: s.social.presences, social: s.social.status });
      }, owner.accountId));
      console.log("DEBUG-B", await b.page.evaluate(async () => { const { getState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`); const s = getState(); return JSON.stringify({ manual: s.settings.manualPresence, social: s.social.status, me: s.social.me?.id }); }));
      await a.page.screenshot({ path: test.info().outputPath("members.png") });
      throw error;
    }

    // "Mensagem" on the member card opens the DM in the Annoy home, after they become friends.
    await a.page.evaluate(async (name) => {
      const s = await import(/* @vite-ignore */ `${location.origin}/src/social/index.ts`);
      await s.addFriend(name);
    }, bruno.name);
    await b.page.evaluate(async () => {
      const { getState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      const s = await import(/* @vite-ignore */ `${location.origin}/src/social/index.ts`);
      for (let i = 0; i < 50 && !getState().social.relationships.length; i++) await new Promise((r) => setTimeout(r, 100));
      await s.acceptFriend(getState().social.relationships[0].user.id);
    });
    await member.click();
    await a.page.getByRole("button", { name: /Mensagem/ }).first().click();
    await expect(a.page.getByRole("textbox", { name: `Mensagem para ${bruno.name}` })).toBeVisible({ timeout: 15_000 });
  } finally {
    await a.close();
    await b.close();
  }
});

test("sign-in by username, the list of installs, and sign-out that keeps only the username", async () => {
  const stamp = Date.now().toString(36).slice(-5);
  const who = await account(`elis_${stamp}`);
  const a = await launch("a");
  try {
    await signIn(a.page, { email: who.name, password: who.password });
    const clients = await a.page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/auth/session.ts`)).listClients());
    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({ current: true, signedIn: true });
    await a.page.evaluate(() => localStorage.setItem("annoy.drafts.test", "rascunho"));
    await a.page.evaluate(async () => { const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`); setState((s: any) => { s.settings.theme = "light"; }); });
    // Sign out from the settings, like a person would.
    await a.page.evaluate(async () => { const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`); setState((s: any) => { s.modal = { kind: "userSettings" }; }); });
    await a.page.getByRole("button", { name: "Sair da conta Annoy", exact: true }).click();
    await expect(a.page.getByRole("heading", { name: "Entre no Annoy" })).toBeVisible({ timeout: 30_000 });
    await expect(a.page.getByLabel("Usuário ou e-mail")).toHaveValue(who.name);
    const left = await a.page.evaluate(async () => ({ keys: Object.keys(localStorage).sort(), dbs: ((await indexedDB.databases()) ?? []).map((d) => d.name), theme: JSON.parse(localStorage.getItem("annoy.settings") ?? "{}").theme }));
    expect(left.keys.every((k) => ["annoy.clientId", "annoy.cloudDevice", "annoy.lastUsername", "annoy.settings"].includes(k))).toBe(true);
    expect(left.dbs).toEqual([]);
    expect(left.theme).toBe("light");
    // authannoy ended this install's session: signing in again asks for the password.
    await signIn(a.page, { email: who.name, password: who.password });
  } finally {
    await a.close();
  }
});
