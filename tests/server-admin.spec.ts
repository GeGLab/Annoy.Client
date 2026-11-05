// TODO item 5, end to end: the app has no annoy-server admin panel; the host
// uses annoy-admin (invites, bans). A server nickname is set from the server
// menu and every member sees it.
// Needs a fresh local-mode annoy-server with ANNOY_REGISTRATION=invite:
// ANNOY_TEST_ADMIN_SERVER=<url> ANNOY_TEST_ADMIN_DATA=<its ANNOY_DATA_DIR>
// ANNOY_TEST_ADMIN_REPO=<annoy-server checkout>. Apps run with --mute-audio.
import { electron } from "./fixtures/electron-launch.ts";
import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const SERVER = process.env.ANNOY_TEST_ADMIN_SERVER ?? "";
const DATA = process.env.ANNOY_TEST_ADMIN_DATA ?? "";
const REPO = process.env.ANNOY_TEST_ADMIN_REPO ?? "";

test.skip(!SERVER || !DATA || !REPO, "needs ANNOY_TEST_ADMIN_SERVER, ANNOY_TEST_ADMIN_DATA and ANNOY_TEST_ADMIN_REPO");
test.setTimeout(120_000);

/** The host's command, as `npm run admin -- ...` runs it. */
const annoyAdmin = (...args: string[]) => execFileSync(process.execPath, ["--import", "tsx", "src/admin-cli.ts", ...args], {
  cwd: REPO, encoding: "utf8", env: { ...process.env, ANNOY_DATA_DIR: DATA, ANNOY_PORT: new URL(SERVER).port },
}).trim();

async function launch(label: string) {
  const directory = await mkdtemp(join(tmpdir(), `annoy-admin-${label}-`));
  const env = { ...process.env, ANNOY_TEST_DATA: directory, ELECTRON_RENDERER_URL: "http://127.0.0.1:5178" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require("electron"), args: [resolve("tests/fixtures/electron.cjs")], env });
  const proc = app.process();
  const page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  return { app, page, close: async () => {
    await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 5000))]);
    try { proc.kill("SIGKILL"); } catch { /* already gone */ }
    await rm(directory, { recursive: true, force: true });
  } };
}

async function signUp(page: Page, username: string, signupInvite?: string, serverInvite?: string) {
  return page.evaluate(async ({ url, username, signupInvite, serverInvite }) => {
    const origin = location.origin;
    const api = await import(/* @vite-ignore */ `${origin}/src/api.ts`);
    const g = await import(/* @vite-ignore */ `${origin}/src/auth/servers.ts`);
    const c = await import(/* @vite-ignore */ `${origin}/src/client.ts`);
    const { getState } = await import(/* @vite-ignore */ `${origin}/src/store.ts`);
    const info = await api.fetchInfo(url);
    const auth = await api.authenticate(url, "register", { username, password: `senha forte ${username} 2026`, displayName: username, ...(signupInvite && { inviteCode: signupInvite }) });
    const account = g.toAccount(url, info, auth);
    c.addAccount(account);
    for (let i = 0; i < 200 && getState().instances[account.id]?.status !== "ready"; i++) await new Promise((r) => setTimeout(r, 100));
    let serverId: string;
    if (serverInvite) { await c.apiFor(account.id).post(`/invites/${serverInvite}`, {}); serverId = getState().instances[account.id].servers[0]?.id; }
    else serverId = (await c.apiFor(account.id).post("/servers", { name: "Servidor do item 5" })).id;
    for (let i = 0; i < 100 && !getState().instances[account.id].serverStates[serverId]; i++) {
      c.navigate({ kind: "server", accountId: account.id, serverId, channelId: null });
      await new Promise((r) => setTimeout(r, 100));
    }
    const code = serverInvite ? null : (await c.apiFor(account.id).post(`/servers/${serverId}/invites`, {})).code as string;
    return { accountId: account.id, serverId, code };
  }, { url: SERVER, username, signupInvite, serverInvite });
}

test("no annoy-server admin in the app; annoy-admin invites and bans; the server nickname reaches every member", async () => {
  const stamp = Date.now().toString(36).slice(-5);
  const a = await launch("a"), b = await launch("b");
  try {
    // The first account bootstraps the annoy-server; the next one needs a sign-up invite from the host.
    const ana = await signUp(a.page, `ana_${stamp}`);
    const signup = annoyAdmin("invite", "create", "--uses", "1");
    expect(signup).toMatch(/^\w{6,}$/);
    expect(annoyAdmin("invite", "list")).toContain(signup);
    const beto = await signUp(b.page, `beto_${stamp}`, signup, ana.code!);
    expect(annoyAdmin("user", "list")).toContain(`beto_${stamp}`);

    // Ana administers the annoy-server (first account), yet the app offers no admin panel.
    await a.page.locator(".server-menu-trigger").click();
    await expect(a.page.getByRole("menuitem", { name: /Configurações do servidor/ })).toBeVisible();
    await a.page.getByRole("menuitem", { name: /Configurações do servidor/ }).click();
    await expect(a.page.getByRole("dialog")).toBeVisible();
    await expect(a.page.getByRole("button", { name: "Avançado" })).toHaveCount(0);
    await expect(a.page.getByText("Administrar instância")).toHaveCount(0);
    await a.page.screenshot({ path: test.info().outputPath("1-server-settings.png") });
    await a.page.keyboard.press("Escape");

    // Server nickname: from the server menu, seen by Beto in the member list.
    await a.page.locator(".server-menu-trigger").click();
    await a.page.getByRole("menuitem", { name: "Alterar apelido neste servidor" }).click();
    await a.page.getByRole("textbox").fill("Aninha");
    await a.page.getByRole("button", { name: "Salvar apelido" }).click();
    await expect(a.page.getByText("Apelido salvo.")).toBeVisible();
    await b.page.evaluate(async ({ accountId, serverId }) => {
      const c = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
      const { getState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      const text = getState().instances[accountId].serverStates[serverId].channels.find((ch: any) => ch.type === "text");
      c.navigate({ kind: "server", accountId, serverId, channelId: text.id });
    }, beto);
    await expect(b.page.locator(".member").filter({ hasText: "Aninha" })).toBeVisible({ timeout: 15_000 });
    await b.page.screenshot({ path: test.info().outputPath("2-nickname-seen.png") });

    // The host bans Beto: his app is disconnected at once.
    expect(annoyAdmin("user", "ban", `beto_${stamp}`, "teste")).toBe("Conta suspensa.");
    await expect.poll(() => b.page.evaluate(async (accountId) => {
      const { getState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      return getState().instances[accountId]?.status;
    }, beto.accountId), { timeout: 15_000 }).not.toBe("ready");
    expect(annoyAdmin("user", "unban", `beto_${stamp}`)).toBe("Conta reativada.");
  } finally {
    await a.close();
    await b.close();
  }
});
