// Song rooms, end to end: two real Annoy apps on a local-mode annoy-server.
// A YouTube playlist pasted in the request field fills the queue (up to its limit);
// whoever manages the room shuffles the queue, puts the original order back and turns
// random mode on; a member pulls playlists too but doesn't see those controls.
// Needs a dev annoy-server in local mode (ANNOY_ACCOUNT_MODE=local, ANNOY_REGISTRATION=open)
// that can reach YouTube; set ANNOY_TEST_SONG_SERVER to its URL to run.
// Every app runs with --mute-audio.
import { electron } from "./fixtures/electron-launch.ts";
import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const SERVER = process.env.ANNOY_TEST_SONG_SERVER ?? "";
// A public YouTube playlist with more than 100 videos (its "load more" pages are read too).
const PLAYLIST = process.env.ANNOY_TEST_SONG_PLAYLIST ?? "https://music.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI";

test.skip(!SERVER, "needs a local-mode dev annoy-server (ANNOY_TEST_SONG_SERVER=http://127.0.0.1:port)");
test.setTimeout(150_000);

async function launch(label: string) {
  const directory = await mkdtemp(join(tmpdir(), `annoy-song-${label}-`));
  const env = { ...process.env, ANNOY_TEST_DATA: directory, ELECTRON_RENDERER_URL: "http://127.0.0.1:5178" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require("electron"), args: [resolve("tests/fixtures/electron.cjs")], env });
  const proc = app.process();
  const page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  return { page, close: async () => {
    await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 5000))]);
    try { proc.kill("SIGKILL"); } catch { /* already gone */ }
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } };
}

/** A local account on the test server; the owner creates a server with a song room, the member joins by invite. */
async function signUp(page: Page, username: string, invite?: string) {
  return page.evaluate(async ({ url, username, invite }) => {
    const origin = location.origin;
    const api = await import(/* @vite-ignore */ `${origin}/src/api.ts`);
    const g = await import(/* @vite-ignore */ `${origin}/src/auth/servers.ts`);
    const c = await import(/* @vite-ignore */ `${origin}/src/client.ts`);
    const { getState } = await import(/* @vite-ignore */ `${origin}/src/store.ts`);
    const info = await api.fetchInfo(url);
    const auth = await api.authenticate(url, "register", { username, password: `senha forte ${username} 2026`, displayName: username });
    const account = g.toAccount(url, info, auth);
    c.addAccount(account);
    for (let i = 0; i < 200 && getState().instances[account.id]?.status !== "ready"; i++) await new Promise((r) => setTimeout(r, 100));
    if (getState().instances[account.id]?.status !== "ready") throw new Error(`server connection: ${getState().instances[account.id]?.status}`);
    const serverId: string = invite
      ? (await c.apiFor(account.id).post(`/invites/${invite}`, {})).id ?? Object.keys(getState().instances[account.id].serverStates)[0]
      : (await c.apiFor(account.id).post("/servers", { name: "Servidor da rádio" })).id;
    if (!invite) await c.apiFor(account.id).post(`/servers/${serverId}/channels`, { name: "radio", type: "song" });
    for (let i = 0; i < 300 && !getState().instances[account.id].serverStates[serverId]?.channels.some((ch: any) => ch.type === "song"); i++) {
      c.navigate({ kind: "server", accountId: account.id, serverId, channelId: null });
      await new Promise((r) => setTimeout(r, 100));
    }
    const song = getState().instances[account.id].serverStates[serverId]?.channels.find((ch: any) => ch.type === "song");
    if (!song) throw new Error(`no song room for ${username} on ${serverId}`);
    c.navigate({ kind: "server", accountId: account.id, serverId, channelId: song.id });
    const code = invite ? null : (await c.apiFor(account.id).post(`/servers/${serverId}/invites`, {})).code;
    return { accountId: account.id, songId: song.id as string, code: code as string | null };
  }, { url: SERVER, username, invite });
}

const room = (page: Page, accountId: string, songId: string) => page.evaluate(async ({ accountId, songId }) => {
  const c = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
  return c.apiFor(accountId).get(`/channels/${songId}/playback`);
}, { accountId, songId }) as Promise<{ queue: { id: string; title: string }[]; currentId: string | null; shuffle?: boolean; upNextId?: string | null; originalOrder?: string[] | null }>;

const titles = (page: Page) => page.locator(".song-side .queue-list .queue-title").allTextContents();

test("a pasted playlist fills the song room's queue; managers shuffle it and turn random mode on", async () => {
  const stamp = Date.now().toString(36).slice(-5);
  const owner = await launch("owner");
  const member = await launch("member");
  try {
    const a = await signUp(owner.page, `dono${stamp}`);
    const b = await signUp(member.page, `membro${stamp}`, a.code!);

    // The same request field: a list= link is recognised as a playlist.
    await owner.page.getByRole("tab", { name: /Na fila/ }).click();
    const field = owner.page.locator(`#song-request-${a.songId}-queue`);
    await field.fill(PLAYLIST);
    await expect(owner.page.locator(".song-side .song-request-add")).toHaveText("Puxar playlist");
    await owner.page.locator(".song-side .song-request-add").click();
    await expect(owner.page.locator(".song-side .song-request-note.done")).toHaveText(/^\s*\d{3} músicas adicionadas\s*$/, { timeout: 30_000 });
    const pulled = (await room(owner.page, a.accountId, a.songId)).queue.length;
    expect(pulled).toBeGreaterThan(100);

    // The member joins the playing room and pulls it too, until the queue is full; the rest is counted.
    await member.page.locator(".song-invite-join").click();
    await member.page.getByRole("tab", { name: /Na fila/ }).click();
    await member.page.locator(`#song-request-${b.songId}-queue`).fill(PLAYLIST);
    await member.page.locator(".song-side .song-request-add").click();
    await expect(member.page.locator(".song-side .song-request-note.done")).toHaveText(new RegExp(`${200 - pulled} músicas adicionadas, ${pulled - (200 - pulled)} ficaram de fora: a fila tem limite de 200`), { timeout: 30_000 });
    expect((await room(owner.page, a.accountId, a.songId)).queue.length).toBe(200);
    // Members neither shuffle the queue nor switch random mode.
    await expect(member.page.getByRole("button", { name: "Embaralhar fila" })).toHaveCount(0);
    await member.page.getByRole("button", { name: "Mais opções" }).click();
    await expect(member.page.getByRole("menuitemcheckbox", { name: "Modo aleatório" })).toBeDisabled();
    await member.page.keyboard.press("Escape");

    // Embaralhar fila: a new order after the current track; Ordem original puts it back.
    const before = await titles(owner.page);
    await owner.page.getByRole("button", { name: "Embaralhar fila" }).click();
    await expect.poll(() => titles(owner.page)).not.toEqual(before);
    expect((await titles(owner.page))[0]).toBe(before[0]);
    expect([...(await titles(owner.page))].sort()).toEqual([...before].sort());
    await expect.poll(() => titles(member.page)).toEqual(await titles(owner.page));
    await owner.page.getByRole("button", { name: "Ordem original" }).click();
    await expect.poll(() => titles(owner.page)).toEqual(before);
    await expect(owner.page.getByRole("button", { name: "Ordem original" })).toHaveCount(0);

    // Modo aleatório: the queue keeps its order and the next track is drawn for everyone.
    await owner.page.getByRole("button", { name: "Mais opções" }).click();
    await owner.page.getByRole("menuitemcheckbox", { name: "Modo aleatório" }).click();
    await expect(owner.page.getByRole("menuitemcheckbox", { name: "Modo aleatório" })).toHaveAttribute("aria-checked", "true");
    await owner.page.keyboard.press("Escape");
    await expect.poll(async () => (await room(owner.page, a.accountId, a.songId)).upNextId ?? null).not.toBeNull();
    const state = await room(owner.page, a.accountId, a.songId);
    expect(state.shuffle).toBe(true);
    expect(await titles(owner.page)).toEqual(before);
    // "A seguir" shows the drawn track (its title, or the track name read from it).
    const drawn = state.queue.find((i) => i.id === state.upNextId)!;
    const shown = (await member.page.locator(".song-upnext-track strong").textContent())?.trim() ?? "";
    expect(shown.length).toBeGreaterThan(0);
    expect(drawn.title.toLowerCase()).toContain(shown.toLowerCase().split(/\s+/)[0]!);
  } finally {
    await owner.close();
    await member.close();
  }
});
