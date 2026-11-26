// Announcements ("Comunicados") end to end: cdnannoy publishes, the real app
// opens unseen ones once in tabs, polls vote with the Annoy account, the list
// stays in Settings → Updates, and a reopened one shows again. Needs the local
// cloud stack (authannoy with REGISTRATION=open, cdnannoy with POLL_PEPPER);
// set ANNOY_TEST_CLOUD=1 to run.
import { electron } from "./fixtures/electron-launch.ts";
import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as kdf from "../src/renderer/src/global-crypto.ts";

const require = createRequire(import.meta.url);
const AUTH = process.env.ANNOY_TEST_AUTH_URL ?? "http://127.0.0.1:16335";
const CDN = process.env.ANNOY_TEST_CDN_URL ?? "http://127.0.0.1:16334";
const INTERNAL = process.env.ANNOY_TEST_INTERNAL_TOKEN ?? "internal-local";
const CLOUD = { ANNOY_USERS_URL: process.env.ANNOY_TEST_USERS_URL ?? "http://127.0.0.1:16332", ANNOY_CHAT_URL: process.env.ANNOY_TEST_CHAT_URL ?? "http://127.0.0.1:16333", ANNOY_CDN_URL: CDN };

test.skip(!process.env.ANNOY_TEST_CLOUD, "needs the local Annoy cloud stack (ANNOY_TEST_CLOUD=1)");
test.setTimeout(180_000);

async function auth(path: string, body?: unknown) {
  const res = await fetch(AUTH + path, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return (await res.json()) as any;
}
async function account(name: string) {
  const email = `${name}@example.com`, password = `senha forte ${name} 2026`;
  const { iterations } = await auth("/v1/auth/prelogin", { email });
  const keys = kdf.newAccountKeys(), salt = kdf.newSalt();
  const pk = await kdf.derivePasswordKeys(password, salt, iterations);
  const terms = (await auth("/v1/terms")).version;
  await auth("/v1/auth/register", { acceptTerms: terms, ageConfirmed: true, email, name, salt, authKey: pk.authKey, wrappedKeys: await kdf.wrapKeys(pk.wrapKey, keys), recovery: { mode: "recoveryKey", wrapped: await kdf.wrapWithRecovery(kdf.newRecoveryKey(), keys) } });
  return { email, password };
}
async function internal(method: string, path: string, body: unknown = {}) {
  const res = await fetch(`${CDN}/internal/v1${path}`, { method, headers: { authorization: `Bearer ${INTERNAL}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as any;
}

async function launch(directory: string) {
  const env = { ...process.env, ...CLOUD, ANNOY_AUTH_URL: AUTH, ANNOY_TEST_DATA: directory, ELECTRON_RENDERER_URL: "http://127.0.0.1:5178" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require("electron"), args: [resolve("tests/fixtures/electron.cjs")], env });
  const page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  return { app, page };
}
async function signIn(page: Page, who: { email: string; password: string }) {
  await expect(page.getByRole("heading", { name: "Entre no Annoy" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Usuário ou e-mail").fill(who.email);
  await page.getByLabel("Senha", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}

test("announcements open once in tabs, polls vote per account, history in settings, reopen shows again", async () => {
  const stamp = Date.now().toString(36).slice(-5);
  const who = await account(`ann_${stamp}`);
  const release = await internal("POST", "/announcements", { content: {
    polls: [{ id: "poll0001", mode: "single", showResults: false, closesAt: null, options: ["tabs0001", "poll0002"] }],
    locales: {
      en: { title: `Release ${stamp}`, body: "New **things**.\n\n{{enquete:1}}", polls: { poll0001: { question: "Favourite?", options: { tabs0001: "Tabs", poll0002: "Polls" } } } },
      "pt-BR": { title: `Versão ${stamp}`, body: "Coisas **novas**.\n- abas\n- enquetes\n\n[[Ler as notas]](https://annoy.example/notas)\n\n{{enquete:1}}", polls: { poll0001: { question: "Qual a favorita?", options: { tabs0001: "Abas", poll0002: "Enquetes" } } } },
    },
  } });
  await internal("POST", `/announcements/${release.id}/publish`);
  const notice = await internal("POST", "/announcements", { content: {
    polls: [{ id: "days0001", mode: "multiple", showResults: true, closesAt: null, options: ["sat00001", "sun00001"] }],
    locales: { en: { title: `Maintenance ${stamp}`, body: "Only English here.\n\n{{enquete:1}}", polls: { days0001: { question: "Which days?", options: { sat00001: "Saturday", sun00001: "Sunday" } } } } },
  } });
  await internal("POST", `/announcements/${notice.id}/publish`);

  const directory = await mkdtemp(join(tmpdir(), "annoy-announcements-"));
  let run = await launch(directory);
  try {
    // Signed out: nothing opens.
    await expect(run.page.getByRole("heading", { name: "Entre no Annoy" })).toBeVisible({ timeout: 30_000 });
    await expect(run.page.getByRole("tab", { name: `Versão ${stamp}` })).toHaveCount(0);
    await signIn(run.page, who);
    const dialog = run.page.getByRole("dialog");
    await expect(dialog.getByRole("tab", { name: `Versão ${stamp}` })).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByRole("tab", { name: `Maintenance ${stamp}` })).toBeVisible();
    // Portuguese text, English fallback for the other one.
    await dialog.getByRole("tab", { name: `Versão ${stamp}` }).click();
    await expect(dialog.getByRole("heading", { name: `Versão ${stamp}` })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Ler as notas" })).toHaveAttribute("href", "https://annoy.example/notas");
    // Single choice: no results before the vote; they open after it.
    await expect(dialog.getByRole("button", { name: "Ver resultados" })).toHaveCount(0);
    await dialog.getByText("Abas", { exact: true }).click();
    await dialog.getByRole("button", { name: "Votar" }).click();
    await expect(dialog.getByText("1 voto")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Mudar voto" })).toBeVisible();
    await run.page.screenshot({ path: test.info().outputPath("announcement-voted.png") });
    // Multiple choice with "Ver resultados" before voting.
    await dialog.getByRole("tab", { name: `Maintenance ${stamp}` }).click();
    await expect(dialog.getByText("Only English here.")).toBeVisible();
    await dialog.getByRole("button", { name: "Ver resultados" }).click();
    await expect(dialog.getByText("0 votos")).toBeVisible();
    await dialog.getByRole("button", { name: "Votar" }).click();
    await dialog.getByText("Saturday", { exact: true }).click();
    await dialog.getByText("Sunday", { exact: true }).click();
    await dialog.getByRole("button", { name: "Votar" }).click();
    await expect(dialog.getByText("1 voto")).toBeVisible();
    await run.page.screenshot({ path: test.info().outputPath("announcement-multiple.png") });
    await dialog.getByRole("button", { name: "Fechar" }).click();
    await expect(run.page.getByRole("tab", { name: `Versão ${stamp}` })).toHaveCount(0);

    // Seen on this device: the next launch opens nothing.
    await run.app.close();
    run = await launch(directory);
    await expect.poll(() => run.page.evaluate(async () => !!(await import(/* @vite-ignore */ `${location.origin}/src/store.ts`)).getState().global), { timeout: 60_000 }).toBe(true);
    await run.page.waitForTimeout(3000);
    await expect(run.page.getByRole("tab", { name: `Versão ${stamp}` })).toHaveCount(0);

    // Settings → Updates → Announcements; the vote is still there.
    await run.page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/store.ts`)).setState((s: any) => { s.modal = { kind: "userSettings" }; }));
    await run.page.getByRole("button", { name: "Atualizações" }).first().click();
    await expect(run.page.getByRole("heading", { name: "Comunicados" })).toBeVisible();
    await run.page.screenshot({ path: test.info().outputPath("announcement-history.png") });
    await run.page.getByRole("button", { name: new RegExp(`Versão ${stamp}`) }).click();
    await expect(run.page.getByRole("button", { name: "Mudar voto" })).toBeVisible({ timeout: 15_000 });
    await run.page.getByRole("button", { name: "Fechar" }).last().click();

    // Reopened by the panel: shown again on the next launch.
    await run.app.close();
    const current = await (await fetch(`${CDN}/v1/announcements`)).json() as any;
    const content = current.items.find((i: any) => i.id === release.id);
    await internal("PUT", `/announcements/${release.id}`, { content: { polls: content.polls, locales: content.locales }, reopen: true });
    run = await launch(directory);
    await expect(run.page.getByRole("dialog").getByRole("tab", { name: `Versão ${stamp}` })).toBeVisible({ timeout: 60_000 });
    await expect(run.page.getByRole("dialog").getByRole("tab", { name: `Maintenance ${stamp}` })).toHaveCount(0);
  } finally {
    await run.app.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});
