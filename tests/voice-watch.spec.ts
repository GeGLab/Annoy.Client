// TODO item 4, end to end: two real Annoy apps on a local-mode annoy-server.
// A screen share is only received after "Assistir"; the stream has its own
// volume (up to 300%); the OBS-style mic filters run on a live microphone.
// Needs a dev annoy-server in local mode (ANNOY_ACCOUNT_MODE=local,
// ANNOY_REGISTRATION=open); set ANNOY_TEST_VOICE_SERVER to its URL to run.
// Media is Chromium's fake camera/mic and every app runs with --mute-audio.
import { electron } from "./fixtures/electron-launch.ts";
import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const SERVER = process.env.ANNOY_TEST_VOICE_SERVER ?? "";

test.skip(!SERVER, "needs a local-mode dev annoy-server (ANNOY_TEST_VOICE_SERVER=http://127.0.0.1:port)");
test.setTimeout(120_000);

async function launch(label: string) {
  const directory = await mkdtemp(join(tmpdir(), `annoy-voice-${label}-`));
  const env = { ...process.env, ANNOY_TEST_DATA: directory, ELECTRON_RENDERER_URL: "http://127.0.0.1:5178" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require("electron"), args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", resolve("tests/fixtures/electron.cjs")], env });
  const proc = app.process();
  const page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  return { app, page, close: async () => {
    // An unsaved settings draft asks before closing; the test doesn't wait for that dialog.
    await Promise.race([app.close().catch(() => undefined), new Promise((r) => setTimeout(r, 5000))]);
    try { proc.kill("SIGKILL"); } catch { /* already gone */ }
    await rm(directory, { recursive: true, force: true }); } };
}

/** Registers a local account on the test server, the way "Conectar a outro servidor" does. */
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
    let serverId: string;
    if (invite) serverId = (await c.apiFor(account.id).post(`/invites/${invite}`, {})).id ?? Object.keys(getState().instances[account.id].serverStates)[0];
    else serverId = (await c.apiFor(account.id).post("/servers", { name: "Servidor do item 4" })).id;
    for (let i = 0; i < 100 && !getState().instances[account.id].serverStates[serverId]; i++) {
      c.navigate({ kind: "server", accountId: account.id, serverId, channelId: null });
      await new Promise((r) => setTimeout(r, 100));
    }
    const state = getState().instances[account.id].serverStates[serverId];
    const voice = state.channels.find((ch: any) => ch.type === "voice");
    if (!voice) throw new Error("no voice channel");
    const code = invite ? null : (await c.apiFor(account.id).post(`/servers/${serverId}/invites`, {})).code;
    return { accountId: account.id, serverId, voiceId: voice.id as string, userId: getState().instances[account.id].user.id as string, code: code as string | null };
  }, { url: SERVER, username, invite });
}

async function joinCall(page: Page, who: { accountId: string; serverId: string; voiceId: string }) {
  await page.evaluate(async ({ accountId, serverId, voiceId }) => {
    const c = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
    c.navigate({ kind: "server", accountId, serverId, channelId: voiceId });
    await c.joinVoice(accountId, serverId, voiceId);
  }, who);
  await expect(page.locator(".stage-controls")).toBeVisible({ timeout: 30_000 });
}

/** Remote tiles and offers as the stage keeps them. */
const media = (page: Page) => page.evaluate(async () => {
  const m = await import(/* @vite-ignore */ `${location.origin}/src/media.ts`);
  return { tiles: m.videoTiles().filter((t: any) => !t.local).map((t: any) => t.source) };
});

test("a screen share is received only after Assistir, has its own volume, and filters run on the mic", async () => {
  const stamp = Date.now().toString(36).slice(-5);
  const a = await launch("a"), b = await launch("b"), c = await launch("c");
  try {
    const ana = await signUp(a.page, `ana_${stamp}`);

    const beto = await signUp(b.page, `beto_${stamp}`, ana.code!);
    await joinCall(a.page, ana);
    await joinCall(b.page, beto);

    // Ana shares her "screen": the fake camera stands in for the capture.
    await a.page.evaluate(async () => {
      navigator.mediaDevices.getDisplayMedia = () => navigator.mediaDevices.getUserMedia({ video: true });
      const c = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
      await c.startScreenShare(null);
    });

    // Beto is told, but receives nothing until he asks.
    const offer = b.page.locator(".stream-offer");
    await expect(offer).toBeVisible({ timeout: 20_000 });
    await expect(offer).toContainText(`ana_${stamp}`);
    await b.page.waitForTimeout(1500);
    expect((await media(b.page)).tiles).toEqual([]);
    await b.page.screenshot({ path: test.info().outputPath("1-offer.png") });

    await offer.getByRole("button", { name: "Assistir" }).click();
    await expect(b.page.locator(".stage-card.video.screen video")).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => b.page.locator(".stage-card.video.screen video").evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 20_000 }).toBeGreaterThan(0);
    await expect(offer).toHaveCount(0);
    await b.page.screenshot({ path: test.info().outputPath("2-watching.png") });

    // The stream volume is separate from the voice volume, goes to 300% and lives in the stream's right-click menu.
    const card = b.page.locator(".stage-card.video.screen");
    await card.click({ button: "right" });
    const streamSlider = b.page.getByRole("menu").getByRole("slider", { name: `Volume da transmissão de ana_${stamp}` });
    await expect(streamSlider).toBeVisible();
    await expect(streamSlider).toHaveAttribute("aria-valuemax", "300");
    await b.page.keyboard.press("Escape");
    await b.page.evaluate(async ({ accountId, userId }) => {
      const c = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
      c.setUserVolume(accountId, userId, 250, "stream");
    }, { accountId: beto.accountId, userId: ana.userId });
    const volumes = await b.page.evaluate(async ({ accountId, userId }) => {
      const { getState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      const key = JSON.stringify([accountId, userId]);
      return { voice: getState().settings.userVolumes[key] ?? 100, stream: getState().settings.streamVolumes[key] ?? 100 };
    }, { accountId: beto.accountId, userId: ana.userId });
    expect({ voice: volumes.voice, stream: volumes.stream }).toEqual({ voice: 100, stream: 250 });

    // Stop watching: the picture goes away and the offer comes back.
    await card.hover();
    await card.getByRole("button", { name: "Parar de assistir" }).click();
    await expect(offer).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => (await media(b.page)).tiles).toEqual([]);

    // Watching again works, and when Ana stops sharing everything goes away.
    await offer.getByRole("button", { name: "Assistir" }).click();
    await expect(b.page.locator(".stage-card.video.screen video")).toBeVisible({ timeout: 20_000 });
    await a.page.evaluate(async () => {
      const c = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
      await c.toggleScreenShare();
    });
    await expect(b.page.locator(".stage-card.video.screen")).toHaveCount(0, { timeout: 15_000 });
    await expect(offer).toHaveCount(0);

    // A new share is opt-in again, also for someone who watched the last one.
    await a.page.evaluate(async () => {
      const c = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
      await c.startScreenShare(null);
    });
    await expect(offer).toBeVisible({ timeout: 20_000 });
    expect((await media(b.page)).tiles).toEqual([]);

    // Two shares at once: each one is watched and has its own volume.
    const carla = await signUp(c.page, `carla_${stamp}`, ana.code!);
    await joinCall(c.page, carla);
    await c.page.evaluate(async () => {
      navigator.mediaDevices.getDisplayMedia = () => navigator.mediaDevices.getUserMedia({ video: true });
      const m = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
      await m.startScreenShare(null);
    });
    await expect(offer).toHaveCount(2, { timeout: 20_000 });
    for (const name of [`ana_${stamp}`, `carla_${stamp}`]) await offer.filter({ hasText: name }).getByRole("button", { name: "Assistir" }).click();
    const screens = b.page.locator(".stage-card.video.screen");
    await expect(screens).toHaveCount(2, { timeout: 20_000 });
    await b.page.evaluate(async ({ accountId, mute, keep }) => {
      const m = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
      m.setUserVolume(accountId, mute, 0, "stream");
      m.setUserVolume(accountId, keep, 100, "stream");
    }, { accountId: beto.accountId, mute: ana.userId, keep: carla.userId });
    const sliders: (string | null)[][] = [];
    for (let i = 0; i < 2; i++) {
      await screens.nth(i).click({ button: "right" });
      const slider = b.page.getByRole("menu").getByRole("slider");
      sliders.push([await slider.getAttribute("aria-label"), await slider.getAttribute("aria-valuenow")]);
      await b.page.keyboard.press("Escape");
    }
    expect(sliders.sort()).toEqual([[`Volume da transmissão de ana_${stamp}`, "0"], [`Volume da transmissão de carla_${stamp}`, "100"]]);
    await b.page.screenshot({ path: test.info().outputPath("3-two-streams.png") });

    // OBS-style filters: every step on, on a live microphone, then changed live.
    const filters = await b.page.evaluate(async () => {
      const n = await import(/* @vite-ignore */ `${location.origin}/src/noise.ts`);
      const f = await import(/* @vite-ignore */ `${location.origin}/src/audio/mic-filters.ts`);
      const on = structuredClone(f.DEFAULT_MIC_FILTERS);
      for (const group of Object.values(on) as { enabled: boolean }[]) group.enabled = true;
      const results: Record<string, string> = {};
      for (const model of ["speex", "rnnoise", "gtcrn", "off"]) {
        const mic = await n.openMic("default", model, on);
        const analyser = mic.ctx.createAnalyser();
        mic.output.connect(analyser);
        // Chromium's fake microphone beeps once a second: listen for 1.5 s.
        const data = new Float32Array(analyser.fftSize);
        let heard = false;
        for (let t = 0; t < 30 && !heard; t++) {
          await new Promise((r) => setTimeout(r, 50));
          analyser.getFloatTimeDomainData(data);
          heard = data.some((x) => Math.abs(x) > 0.001);
        }
        mic.setFilters({ ...on, gain: { enabled: true, db: -12 } });
        results[model] = `${mic.track.readyState}:${mic.ctx.state}:${heard ? "signal" : "silence"}`;
        mic.stop();
      }
      return results;
    });
    expect(filters.speex).toMatch(/^live:running:/);
    expect(filters.rnnoise).toMatch(/^live:running:/);
    expect(filters.gtcrn).toMatch(/^live:running:/);
    expect(filters.off).toMatch(/^live:running:signal$/);

    // The settings page shows the chain and its controls.
    await b.page.evaluate(async () => {
      const { openModal } = await import(/* @vite-ignore */ `${location.origin}/src/components/ui.tsx`);
      openModal({ kind: "userSettings", section: "voice" });
    });
    await expect(b.page.getByText("Filtros do microfone")).toBeVisible({ timeout: 10_000 });
    await b.page.locator(".mic-filter").filter({ hasText: "Noise gate" }).getByRole("switch").click();
    await expect(b.page.getByRole("slider", { name: "Limite de abertura" })).toBeVisible();
    await b.page.locator(".mic-filters").screenshot({ path: test.info().outputPath("3-filters.png") });
  } finally {
    await a.close();
    await b.close();
    await c.close();
  }
});
