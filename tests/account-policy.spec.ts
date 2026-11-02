import {electron} from './fixtures/electron-launch.ts';
import { globalAuthFixture } from "./fixtures/global-auth.ts";
import { test, expect,  type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const origin = "http://127.0.0.1:48101";
async function launch() {
  const directory = await mkdtemp(join(tmpdir(), "annoy-accounts-test-"));
  const auth = await globalAuthFixture();
  const env = { ...process.env, ANNOY_GLOBAL_URL: auth.url, ANNOY_TEST_DATA: directory, ELECTRON_RENDERER_URL: "http://127.0.0.1:5178" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require("electron"), args: [resolve("tests/fixtures/electron.cjs")], env });
  const page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByRole("heading", { name: "Entre no Annoy" })).toBeVisible();
  return { app, page, auth, close: async () => { await app.close(); await auth.close(); await rm(directory, { recursive: true, force: true }); } };
}
function info(accountMode: "local" | "global") {
  return { name: "Policy test", version: "0.8.0", protocol: 1, registrationOpen: true, registration: "open", discordLogin: false, accountMode, globalServerId: accountMode === "global" ? "Stest" : null };
}
async function open(page: Page) {
  await page.evaluate(async () => {
    const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
    setState((s: any) => { s.modal = { kind: "addAccount" }; });
  });
  await page.getByLabel("Endereço", { exact: true }).fill(origin);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
}

test("global hosts offer global login/registration and no ordinary local login", async () => {
  const { page, close } = await launch();
  try {
    await page.route(`${origin}/api/info`, route => route.fulfill({ json: info("global") }));
    await open(page);
    await expect(page.getByRole("button", { name: "Entrar na conta Annoy" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Cadastrar conta Annoy" })).toHaveAttribute("href", /\/cadastro$/);
    await expect(page.getByLabel("Senha local", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Criar conta local" })).toHaveCount(0);
    await expect(page.getByText("Atualização de segurança:", { exact: false })).toBeVisible();
  } finally { await close(); }
});

test("local hosts offer local credentials without contacting Global", async () => {
  const { page, close } = await launch();
  let requestsToGlobal = 0;
  try {
    await page.route("https://global.geg.dev.br/**", route => { requestsToGlobal++; return route.abort(); });
    await page.route(`${origin}/api/info`, route => route.fulfill({ json: info("local") }));
    await open(page);
    await expect(page.getByLabel("Senha local", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Criar conta local" })).toBeVisible();
    await expect(page.getByRole("dialog").getByLabel("E-mail da conta Annoy")).toHaveCount(0);
    await expect(page.getByText("O administrador escolheu contas locais.", { exact: false })).toBeVisible();
    expect(requestsToGlobal).toBe(0);
  } finally { await close(); }
});

async function invalidateSaved(page: Page, mode: "global" | "local") {
  await page.route(`${origin}/api/info`, route => route.fulfill({ json: info(mode) }));
  await page.route(`${origin}/api/auth/migration/status`, route => route.fulfill({ json: { username: "original", pending: true, accountMode: mode } }));
  await page.routeWebSocket("ws://127.0.0.1:48101/gateway", socket => {
    socket.onMessage(() => { socket.send(JSON.stringify({ t: "INVALID_SESSION", d: { reason: "mode changed" } })); socket.close({ code: 4004, reason: "mode changed" }); });
  });
  await page.evaluate(async () => {
    const { addAccount } = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
    const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
    addAccount({ id: "saved", url: "http://127.0.0.1:48101", token: "previous-session", userId: "original-id", instanceName: "Policy test" });
    setState((s: any) => { s.instances.saved.user = { id: "original-id", username: "original", displayName: "Original" }; });
  });
}

test("servers from before account modes (no accountMode) keep the local sign-in", async () => {
  const { page, close } = await launch();
  try {
    const { accountMode: _omitted, ...legacy } = info("local");
    await page.route(`${origin}/api/info`, route => route.fulfill({ json: { ...legacy, globalServerId: "Slegacy" } }));
    await open(page);
    await expect(page.getByLabel("Senha local", { exact: true })).toBeVisible();
    await expect(page.getByText("este servidor exige uma conta Annoy", { exact: false })).toHaveCount(0);
  } finally { await close(); }
});

test("existing local users automatically receive the global migration popup", async () => {
  const { page, close } = await launch();
  try {
    await invalidateSaved(page, "global");
    await expect(page.getByRole("heading", { name: "Migrar sua conta" })).toBeVisible();
    await expect(page.getByText("Contas locais existentes devem cadastrar", { exact: false })).toBeVisible();
    await expect(page.getByRole("link", { name: "Cadastrar conta Annoy" })).toBeVisible();
  } finally { await close(); }
});

test("global-to-local migration uses the old session, sets a local password and makes no Global request", async () => {
  const { page, close } = await launch();
  let requestsToGlobal = 0;
  let migrated: { body: any; authorization?: string } | null = null;
  try {
    await page.route("https://global.geg.dev.br/**", route => { requestsToGlobal++; return route.abort(); });
    await page.route(`${origin}/api/auth/migrate/local`, route => {
      migrated = { body: route.request().postDataJSON(), authorization: route.request().headers().authorization };
      return route.fulfill({ json: { token: "local-session", user: { id: "original-id", username: "original", displayName: "Original", global: false } } });
    });
    await invalidateSaved(page, "local");
    await expect(page.getByRole("heading", { name: "Migrar sua conta" })).toBeVisible();
    await expect(page.getByLabel("Usuário anterior neste servidor")).toHaveValue("original");
    await page.getByLabel("Nova senha local").fill("new-local-password");
    await page.getByRole("button", { name: "Concluir migração" }).click();
    await expect.poll(() => migrated?.body.newPassword).toBe("new-local-password");
    expect(migrated?.authorization).toBe("Bearer previous-session");
    expect(requestsToGlobal).toBe(0);
  } finally { await close(); }
});


test("a signed-out client cannot open native browser views even through IPC or saved navigation", async () => {
  const { app, page, close } = await launch();
  try {
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      const service = { id: "guest-browser", kind: "web" as const, name: "Browser", url: "https://browser.test" };
      setState((s: any) => { s.services = [service]; s.view = { kind: "service", serviceId: service.id }; s.global = { id: "forged", name: "Cached", email: "cached@example.com" }; });
      window.distopic!.services.show(service);
      window.distopic!.theater.open("theater", "https://browser.test", "web");
      await window.distopic!.auth.get();
    });
    await expect(page.getByRole("heading", { name: "Entre no Annoy" })).toBeVisible();
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children.length)).toBe(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Entre no Annoy" })).toBeVisible();
  } finally { await close(); }
});

test("global logout closes an active browser and blocks reopening it immediately", async () => {
  const { app, page, auth, close } = await launch();
  try {
    await auth.authenticate(page);
    await expect(page.locator(".welcome")).toBeVisible();
    await app.context().route("https://browser.test/**", route => route.fulfill({ contentType: "text/html", body: "<h1>Authenticated browser</h1>" }));
    await page.evaluate(async () => {
      const { addService } = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
      addService({ id: "browser", kind: "web", name: "Browser", url: "https://browser.test" });
    });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children.length)).toBe(1);
    await page.getByRole("button", { name: "Mensagens diretas", exact: true }).click();
    // The Annoy account signs out from the settings of the Annoy account.
    await page.getByRole("button", { name: "Configurações", exact: true }).click();
    await page.getByRole("button", { name: "Sair da conta Annoy", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Entre no Annoy" })).toBeVisible();
    await page.evaluate(async () => {
      window.distopic!.services.show({ id: "browser", kind: "web", name: "Browser", url: "https://browser.test" });
      await window.distopic!.auth.get();
    });
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children.length)).toBe(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Entre no Annoy" })).toBeVisible();
    expect(await page.evaluate(() => window.distopic!.auth.get())).toEqual({ allowed: false, global: false, localAccounts: [] });
  } finally { await close(); }
});

test("the local exception requires the server flag and a validated local session", async () => {
  const { page, auth, close } = await launch();
  try {
    const credential = { id: "local-test", url: auth.url, token: auth.localToken, userId: "local-user" };
    auth.setMode("global");
    expect(await page.evaluate(async credential => { try { await window.distopic!.auth.local(credential); return true; } catch { return false; } }, credential)).toBe(false);
    expect((await page.evaluate(() => window.distopic!.auth.get())).allowed).toBe(false);
    auth.setMode("local");
    expect(await page.evaluate(async credential => { try { await window.distopic!.auth.local({ ...credential, token: "invalid" }); return true; } catch { return false; } }, credential)).toBe(false);
    await page.evaluate(credential => window.distopic!.auth.local(credential), credential);
    await expect(page.locator(".welcome")).toBeVisible();
    await page.evaluate(() => window.distopic!.auth.logoutLocal("local-test"));
    await expect(page.getByRole("heading", { name: "Entre no Annoy" })).toBeVisible();
  } finally { await close(); }
});

test("expected local authentication refusals and async secret operations produce no Electron handler/deprecation errors", async () => {
  const { app, page, auth, close } = await launch();
  let errors = "";
  app.process().stderr?.on("data", (chunk) => { errors += chunk.toString(); });
  try {
    auth.setMode("global");
    const result = await page.evaluate(async (credential) => {
      let message = "";
      try { await window.distopic!.auth.local(credential); } catch (error) { message = (error as Error).message; }
      const saved = await window.distopic!.secrets.set("global", "synthetic-secret-canary");
      const decrypted = await window.distopic!.secrets.get("global");
      await window.distopic!.secrets.set("global", null);
      await window.distopic!.crypto.unlock("synthetic-local-password-for-tests");
      return { message, saved, decrypted, access: await window.distopic!.auth.get() };
    }, { id: "local", url: auth.url, token: auth.localToken, userId: "local-user" });
    expect(result.message).toBe("Este servidor exige conta Annoy");
    expect(result.access.allowed).toBe(false);
    if (result.saved) expect(result.decrypted).toBe("synthetic-secret-canary");
    else expect(result.decrypted).toBeNull(); // Linux without a keychain uses the explicit vault password.
    expect(errors).not.toMatch(/safeStorage\.(?:isEncryptionAvailable|decryptString|encryptString).*deprecated/);
    expect(errors).not.toContain("Error occurred in handler for 'auth:local'");
  } finally { await close(); }
});

test("account metadata distinguishes local and Annoy sessions before connecting", async () => {
  const { page, close } = await launch();
  try {
    const kinds = await page.evaluate(async () => {
      const { toAccount } = await import(/* @vite-ignore */ `${location.origin}/src/global.ts`);
      const auth = { token: "synthetic", user: { id: "u", username: "u", displayName: "U", avatarUrl: null } };
      const info = { name: "Fixture", version: "1", protocol: 1, registrationOpen: true, registration: "open", discordLogin: false };
      return [toAccount("https://instance.test", { ...info, accountMode: "local" }, auth).annoy, toAccount("https://instance.test", { ...info, accountMode: "global" }, auth).annoy, toAccount("https://instance.test", info, { ...auth, user: { ...auth.user, global: true } }).annoy];
    });
    expect(kinds).toEqual([false, true, true]);
  } finally { await close(); }
});


test("reload locks native access without deleting saved server connections", async () => {
  const { app, page, auth, close } = await launch();
  try {
    await auth.authenticate(page);
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => { s.accounts = [{ id: "retained", url: "http://127.0.0.1:9", token: "saved-session", userId: "retained-user", instanceName: "Retained" }]; });
    });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Entre no Annoy" })).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("distopic.accounts") ?? "[]").map((a: any) => a.id))).toContain("retained");
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children.length)).toBe(0);
  } finally { await close(); }
});
