import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

test("desktop navigation, themes, window controls and image attachments", async () => {
  const userData = await mkdtemp(join(tmpdir(), "distopic-ui-"));
  const env = { ...process.env, DISTOPIC_TEST_DATA: userData, ELECTRON_RENDERER_URL: "http://127.0.0.1:5178" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require("electron"), args: [resolve("tests/fixtures/electron.cjs")], env });
  const page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const screenshots = resolve(".impeccable/review");
  await mkdir(screenshots, { recursive: true });
  try {
    await expect(page.getByRole("heading", { name: "Suas comunidades. Num lugar só." })).toBeVisible();
    await page.screenshot({ path: join(screenshots, "desktop-dark.png") });
    await page.getByRole("button", { name: "Conectar a um servidor Annoy", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    // Radix traps focus and returns it to the invoking control on Escape.
    for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Conectar a um servidor Annoy", exact: true })).toBeFocused();

    await page.evaluate(() => {
      navigator.mediaDevices.enumerateDevices = async () => (["audioinput", "audiooutput", "videoinput"].map((kind, i) => ({ kind, deviceId: `test-device-${i}`, groupId: "test", label: `Dispositivo de teste com um nome muito longo para verificar o dimensionamento da coluna ${i}`, toJSON() { return this; } })) as MediaDeviceInfo[]);
    });
    await page.getByRole("button", { name: "Configurações", exact: true }).click();
    await page.getByRole("button", { name: "Aparência", exact: true }).click();
    await page.getByRole("button", { name: "Claro", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect.poll(() => page.locator(".modal-body").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: join(screenshots, "settings-light.png") });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(940, 620));
    await expect.poll(() => page.locator(".modal-body").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: join(screenshots, "settings-minimum.png") });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1320, 840));
    await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect(page.locator(".settings-savebar")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.screenshot({ path: join(screenshots, "desktop-light.png") });

    await page.getByRole("button", { name: "Maximizar", exact: true }).click();
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMaximized())).toBe(true);
    await page.getByRole("button", { name: "Restaurar janela", exact: true }).click();
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isMaximized())).toBe(false);

    // Synthetic state is injected only by this test, never by the shipped app.
    await page.routeWebSocket("ws://fixture.test/gateway", () => {});
    await page.route("http://fixture.test/**", async route => {
      if (route.request().url().endsWith(".png")) return route.fulfill({ contentType: "image/png", body: await readFile("build/icon.png") });
      return route.fulfill({ contentType: "application/json", body: "[]" });
    });
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      const { addAccount } = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
      const me = { id: "me", username: "gustavo", displayName: "Gustavo", avatarUrl: null };
      const friend = { id: "friend", username: "marina", displayName: "Marina", avatarUrl: null };
      const server = { id: "test", name: "Comunidade de teste", iconUrl: null, ownerId: "me" };
      const channel = (id: string, name: string, type = "text", parentId: string | null = "community") => ({ id, serverId: "test", type, name, topic: "Um lugar para colocar o papo em dia.", parentId, position: 0, overwrites: [] });
      const now = new Date().toISOString();
      const message = (id: string, author: typeof me, content: string, attachments: unknown[] = []) => ({ id, channelId: "general", author, content, createdAt: now, editedAt: null, replyToId: null, attachments, mentionIds: [], mentionsEveryone: false });
      addAccount({ id: "fixture", url: "http://fixture.test", token: "synthetic-test-token", userId: "me", instanceName: "Instância de teste" });
      setState((s: any) => {
        const inst = s.instances.fixture;
        inst.status = "ready"; inst.user = me; inst.servers = [server];
        inst.presences = { me: "online", friend: "online" };
        inst.serverStates.test = { server, channels: [channel("community", "Comunidade", "category", null), channel("general", "geral"), channel("ideas", "ideias"), channel("images", "imagens"), channel("voice", "Sala de conversa", "voice")], roles: [{ id: "test", serverId: "test", name: "Membros", color: null, permissions: 2147483647, position: 0 }], members: [me, friend].map(user => ({ user, nick: null, roleIds: ["test"], joinedAt: now, presence: "online" })), voiceStates: [], permissions: 2147483647 };
        inst.messages.general = { hasMore: false, loading: false, items: [message("1", me, "Bem-vindos ao nosso espaço de conversa!"), message("2", friend, "Trouxe a nova identidade para vocês verem. O que acharam?", ["a", "b"].map(id => ({ id, filename: `identidade-${id}.png`, size: 2048, contentType: "image/png", url: `http://fixture.test/${id}.png` }))), message("3", me, "Gostei! Dá para abrir as imagens aqui mesmo no Annoy.")] };
        s.settings.theme = "dark";
        s.view = { kind: "server", accountId: "fixture", serverId: "test", channelId: "general" };
      });
    });
    await expect(page.getByRole("heading", { name: "geral", exact: true })).toBeVisible();
    await page.screenshot({ path: join(screenshots, "chat-dark.png") });
    await page.getByRole("button", { name: "Visualizar identidade-a.png" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator(".viewer-file-info")).toContainText("512 × 512");
    await expect.poll(async () => (await page.locator(".viewer-canvas img").boundingBox())?.width ?? 0).toBeGreaterThan(100);
    await page.getByRole("button", { name: "Ampliar imagem", exact: true }).click();
    await expect(page.getByRole("button", { name: "Ajustar imagem à janela" })).toHaveText("150%");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".viewer-file-info")).toContainText("identidade-b.png");
    await expect.poll(async () => (await page.locator(".viewer-canvas img").boundingBox())?.width ?? 0).toBeGreaterThan(100);
    await expect(page.getByRole("button", { name: "Ajustar imagem à janela" })).toHaveText("100%");
    await expect(page.locator(".viewer-canvas")).toHaveCSS("opacity", "1");
    await page.screenshot({ path: join(screenshots, "image-viewer.png") });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Visualizar identidade-a.png" })).toBeFocused();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(940, 620));
    await page.screenshot({ path: join(screenshots, "desktop-minimum.png") });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Configurações", exact: true }).click();
    await page.getByRole("button", { name: "Aparência", exact: true }).click();
    await page.getByRole("button", { name: "Claro", exact: true }).click();
    await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await page.keyboard.press("Escape");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1320, 840));
    await page.screenshot({ path: join(screenshots, "chat-light.png") });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
