import { test, expect, _electron as electron, type Page, type WebSocketRoute } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, basename, resolve, join } from "node:path";

const require = createRequire(import.meta.url);
const capture = resolve(".impeccable/review");
async function fullyInside(page: Page, selector: string, top = 12) {
  await expect
    .poll(async () => {
      const box = await page.locator(selector).boundingBox(),
        viewport = page.viewportSize();
      return (
        !!box &&
        !!viewport &&
        box.x >= 12 &&
        box.y >= top &&
        box.x + box.width <= viewport.width - 12 &&
        box.y + box.height <= viewport.height - 12
      );
    })
    .toBe(true);
}
async function launch({ fakeMedia = false } = {}) {
  const root = resolve(tmpdir()),
    data = await mkdtemp(join(root, "distopic-experience-"));
  const env = { ...process.env, DISTOPIC_TEST_DATA: data, ELECTRON_RENDERER_URL: "http://127.0.0.1:5178" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require("electron"), args: [...(fakeMedia ? ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] : []), resolve("tests/fixtures/electron.cjs")], env });
  const page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".welcome")).toBeVisible();
  await page.evaluate(() => window.distopic?.activity.configure({ games: false, music: false, development: false }));
  await mkdir(capture, { recursive: true });
  const close = async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.destroy())).catch(() => undefined);
    await app.close();
    if (dirname(data) !== root || !basename(data).startsWith("distopic-experience-")) throw new Error("Unsafe test directory");
    await rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  return { app, page, close };
}

async function seed(page: Page, onSocket?: (socket: WebSocketRoute) => void) {
  await page.routeWebSocket("ws://experience.test/gateway", (socket) => onSocket?.(socket));
  await page.route("http://experience.test/api/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("http://experience.test/image.png", async (route) =>
    route.fulfill({ contentType: "image/png", body: await readFile("build/icon.png") }),
  );
  await page.evaluate(async () => {
    const { addAccount } = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
    const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
    const user = { id: "person", username: "tester", displayName: "Pessoa de teste", avatarUrl: null };
    const server = { id: "server", name: "Comunidade de teste", ownerId: "person", iconUrl: null };
    addAccount({ id: "test", url: "http://experience.test", userId: "person", token: "synthetic", instanceName: "Instância de teste" });
    setState((s: any) => {
      const inst = s.instances.test;
      inst.status = "ready";
      inst.user = user;
      inst.servers = [server];
      inst.serverStates.server = {
        server,
        channels: [
          {
            id: "general",
            serverId: "server",
            name: "geral",
            type: "text",
            topic: "Conversa de teste",
            position: 0,
            parentId: null,
            overwrites: [],
          },
          {
            id: "voice",
            serverId: "server",
            name: "Sala de conversa",
            type: "voice",
            topic: "",
            position: 1,
            parentId: null,
            overwrites: [],
          },
        ],
        members: [{ user, nick: null, presence: "online", roleIds: ["server"], joinedAt: new Date().toISOString() }],
        roles: [{ id: "server", serverId: "server", name: "Membros", permissions: 2147483647, position: 0, color: null }],
        voiceStates: [],
        permissions: 2147483647,
      };
      inst.messages.general = {
        hasMore: false,
        loading: false,
        items: [
          {
            id: "message",
            author: user,
            channelId: "general",
            content: "Arquivos sintéticos para testar o player do Annoy.",
            createdAt: new Date().toISOString(),
            editedAt: null,
            replyToId: null,
            mentionsEveryone: false,
            mentionIds: [],
            attachments: [
              { id: "image", filename: "imagem.png", contentType: "image/png", size: 1000, url: "http://experience.test/image.png" },
              { id: "audio", filename: "silencio.wav", contentType: "audio/wav", size: 96044, url: "http://experience.test/audio.wav" },
              {
                id: "video",
                filename: "video-teste.webm",
                contentType: "video/webm",
                size: 2000,
                url: "http://experience.test/video.webm",
              },
            ],
          },
        ],
      };
      s.settings.voiceBarMode = "always";
      s.view = { kind: "server", accountId: "test", serverId: "server", channelId: "general" };
    });
  });
  await expect(page.locator(".chat-header h1")).toHaveText("geral");
}

function silence() {
  const result = Buffer.alloc(96044);
  result.write("RIFF", 0);
  result.writeUInt32LE(result.length - 8, 4);
  result.write("WAVEfmt ", 8);
  result.writeUInt32LE(16, 16);
  result.writeUInt16LE(1, 20);
  result.writeUInt16LE(1, 22);
  result.writeUInt32LE(8000, 24);
  result.writeUInt32LE(16000, 28);
  result.writeUInt16LE(2, 32);
  result.writeUInt16LE(16, 34);
  result.write("data", 36);
  result.writeUInt32LE(result.length - 44, 40);
  return result;
}

test("attachment previews, compact call bar, profile activity and shared voice controls", async () => {
  const { page, app, close } = await launch();
  try {
    await seed(page);
    await page.locator('input[type="file"]').setInputFiles([
      { name: "Anexo com nome muito longo para verificar tamanho sem quebra.png", mimeType: "image/png", buffer: await readFile("build/icon.png") },
      { name: "video.webm", mimeType: "video/webm", buffer: await readFile("tests/fixtures/flower.webm") },
      { name: "audio.wav", mimeType: "audio/wav", buffer: silence() },
    ]);
    await expect(page.locator(".pending-preview img")).toBeVisible();
    await expect.poll(() => page.locator(".pending-preview img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect.poll(() => page.locator(".pending-preview video").evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThan(0);
    await expect(page.locator(".pending-preview audio")).toBeVisible();
    await expect(page.locator(".pending-file-size").first()).toHaveCSS("white-space", "nowrap");
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      const create = AudioContext.prototype.createOscillator;
      (window as any).cueCount = 0;
      AudioContext.prototype.createOscillator = function () { (window as any).cueCount++; return create.call(this); };
      setState((s: any) => {
        s.voice = { accountId: "test", serverId: "server", channelId: "voice", status: "connected", canStream: false, camera: false, screen: false };
        s.desktopActivity = { supported: true, error: null, activities: [{ kind: "music", provider: "spotify", name: "Faixa de teste", artist: "Artista" }] };
      });
    });
    await expect(page.locator(".voice-status-bar")).toHaveCSS("height", "36px");
    await expect(page.locator(".rail-settings")).toHaveCount(0);
    await page.getByRole("button", { name: "Desativar áudio", exact: true }).click();
    await expect(page.getByRole("button", { name: "Ativar microfone", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Ativar áudio", exact: true }).click();
    await expect(page.getByRole("button", { name: "Silenciar microfone", exact: true })).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "Silenciar microfone", exact: true }).click();
    await page.getByRole("button", { name: "Ativar microfone", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).cueCount)).toBe(8);
    await page.screenshot({ path: join(capture, "composer-previews-call-dark.png") });
    await page.getByRole("button", { name: "Abrir meu perfil", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Meu perfil", exact: true })).toContainText("Faixa de teste");
    const card = (await page.locator(".self-profile").boundingBox())!;
    const identity = (await page.locator(".user-identity").boundingBox())!;
    expect(card.y + card.height).toBeLessThan(identity.y);
    await page.screenshot({ path: join(capture, "self-profile-activity-dark.png") });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Configurações", exact: true }).click();
    await page.getByRole("button", { name: "Barra e abas", exact: true }).click();
    await page.getByRole("switch", { name: "Mostrar barra da chamada", exact: true }).uncheck();
    await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect(page.locator(".voice-status-bar")).toHaveCount(0);
    await page.getByRole("button", { name: "Voz e vídeo", exact: true }).click();
    await page.screenshot({ path: join(capture, "settings-voice-organized-dark.png") });
    await page.getByRole("button", { name: "Aparência", exact: true }).click();
    await page.getByRole("button", { name: "Claro", exact: true }).click();
    await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await page.getByRole("button", { name: "Voz e vídeo", exact: true }).click();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(940, 620));
    await expect.poll(() => page.locator(".settings-content").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: join(capture, "settings-voice-organized-light-minimum.png") });
    await page.getByRole("button", { name: "Fechar", exact: true }).click();
    await page.screenshot({ path: join(capture, "composer-previews-light-minimum.png") });
    await page.getByRole("button", { name: /^Remover Anexo/ }).click();
    await expect(page.locator(".pending-file")).toHaveCount(2);
  } finally { await close(); }
});

test("call membership sounds, stable participants, status icons and channel switching", async () => {
  const { page, close } = await launch();
  const methods: string[] = [];
  let socket: WebSocketRoute;
  let currentChannel: string | null = null;
  const state = (userId: string, channelId: string, extra = {}) => ({ userId, serverId: "server", channelId, selfMute: false, selfDeaf: false, serverMute: false, speaking: false, video: false, screen: false, ...extra });
  const update = (userId: string, value: unknown) => socket.send(JSON.stringify({ t: "VOICE_STATE_UPDATE", d: { userId, serverId: "server", state: value } }));
  try {
    await seed(page, (ws) => {
      socket = ws;
      ws.onMessage((raw) => {
        const message = JSON.parse(String(raw));
        if (message.op !== "voice") return;
        methods.push(message.method);
        if (message.method === "join") {
          currentChannel = message.data.channelId;
          update("person", state("person", currentChannel!));
        } else if (message.method === "leave") {
          currentChannel = null;
          update("person", null);
        }
        ws.send(JSON.stringify({ t: "VOICE_REPLY", d: { id: message.id, ok: true, data: {} } }));
      });
    });
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      const { VoiceSession } = await import(/* @vite-ignore */ `${location.origin}/src/voice.ts`);
      const { gatewayFor } = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
      // Keep real client/gateway lifecycle, replacing only hardware/SFU negotiation.
      VoiceSession.prototype.start = async function () { await gatewayFor("test")!.voice("join", { channelId: this.channelId }); };
      const create = AudioContext.prototype.createOscillator;
      (window as any).callTones = 0;
      AudioContext.prototype.createOscillator = function () { (window as any).callTones++; return create.call(this); };
      setState((s: any) => {
        const server = s.instances.test.serverStates.server;
        server.channels.push({ ...server.channels[1], id: "other-voice", name: "Outra chamada" });
        for (const id of ["friend", "visitor"]) server.members.push({ ...server.members[0], user: { id, username: id, displayName: id === "friend" ? "Amiga na chamada" : "Visitante", avatarUrl: null } });
        s.instances.test.relationships = [{ user: server.members[1].user, status: "friend" }];
        s.instances.test.activities.friend = [{ kind: "music", provider: "spotify", name: "Faixa de teste" }];
      });
    });
    const tones = () => page.evaluate(() => (window as any).callTones);
    const users = page.locator(".voice-user");
    await page.locator(".channel.voice").filter({ hasText: "Sala de conversa" }).click();
    await expect.poll(tones).toBe(3); // Local join, without a second cue for our gateway echo.
    update("friend", state("friend", "voice", { selfMute: true, selfDeaf: true, video: true, screen: true }));
    await expect.poll(tones).toBe(6);
    const friend = users.filter({ hasText: "Amiga na chamada" });
    await expect(friend.getByRole("img")).toHaveCount(5);
    await friend.hover();
    await friend.getByRole("button", { name: "Ações de voz de Amiga na chamada" }).click();
    await expect(page.getByRole("menuitem", { name: "Silenciar no servidor", exact: true })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Desconectar da voz", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    update("visitor", state("visitor", "voice"));
    await expect.poll(tones).toBe(9);
    await expect(users.locator(".voice-user-name")).toHaveText(["Pessoa de teste", "Amiga na chamada", "Visitante"]);
    update("person", state("person", "voice", { speaking: true }));
    update("friend", state("friend", "voice", { speaking: true }));
    await expect(users.locator(".voice-user-name")).toHaveText(["Pessoa de teste", "Amiga na chamada", "Visitante"]);
    await expect.poll(tones).toBe(9); // Speaking, mute and media updates never announce membership.
    await page.locator('.channel-name').filter({ hasText: /^geral$/ }).click();
    const avatar = (await friend.locator(".avatar").boundingBox())!;
    const channel = (await page.locator(".channel.voice").first().boundingBox())!;
    expect(avatar.x - channel.x).toBeGreaterThan(30);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    update("friend", state("friend", "voice", { selfMute: true, selfDeaf: true, video: true, screen: true }));
    await expect(friend.getByRole("img")).toHaveCount(5);
    await page.waitForTimeout(250); // Capture settled connection/theme transitions.
    await page.screenshot({ path: join(capture, "voice-roster-icons-dark.png") });
    await expect(page.locator(".voice-status-bar")).toHaveCSS("animation-name", "call-connected");
    await page.setViewportSize({ width: 940, height: 620 });
    await page.evaluate(async () => { const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`); setState((s: any) => { s.settings.theme = "light"; }); });
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(capture, "voice-roster-icons-light-minimum.png") });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator(".voice-status-bar")).toHaveCSS("animation-name", "none");
    update("visitor", state("visitor", "other-voice"));
    await expect.poll(tones).toBe(12); // Leaving our room for another channel.
    update("visitor", state("visitor", "other-voice", { speaking: true }));
    await expect.poll(tones).toBe(12);
    update("friend", null);
    await expect.poll(tones).toBe(15);
    await page.locator(".channel.voice").filter({ hasText: "Outra chamada" }).click();
    await expect.poll(tones).toBe(21); // Local leave + local join on channel switch.
    expect(methods).toEqual(["join", "leave", "join"]);
    await page.getByRole("button", { name: "Sair da chamada de voz", exact: true }).click();
    await expect.poll(tones).toBe(24);
    expect(methods).toEqual(["join", "leave", "join", "leave"]);
    await expect(page.locator(".voice-status-bar")).toHaveCount(0);
  } finally { await close(); }
});

test("voice names show local and online game activity, respecting sharing and friendship", async () => {
  const { page, app, close } = await launch();
  try {
    await seed(page);
    const icon = "https://shared.fastly.steamstatic.com/community_assets/images/apps/730/" + "a".repeat(40) + ".jpg";
    const iconJpeg = await app.evaluate(({ nativeImage }, path) => nativeImage.createFromPath(path).resize({ width: 32 }).toJPEG(75).toString("base64"), resolve("build/icon.png"));
    await page.route(icon, (route) => route.fulfill({ contentType: "image/jpeg", body: Buffer.from(iconJpeg, "base64") }));
    await app.evaluate(({ ipcMain }, icon) => {
      ipcMain.removeHandler("activity:game-icon");
      ipcMain.handle("activity:game-icon", (_event, appId) => appId === "730" ? icon : null);
    }, icon);
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => {
        const inst = s.instances.test, server = inst.serverStates.server;
        for (const id of ["friend", "visitor"]) server.members.push({ ...server.members[0], user: { id, username: id, displayName: id, avatarUrl: null } });
        server.voiceStates = ["person", "friend", "visitor"].map((userId) => ({ userId, channelId: "voice", selfMute: false, selfDeaf: false, serverMute: false, video: false, screen: false }));
        inst.relationships = [{ user: server.members[1].user, status: "friend" }];
        inst.activities.person = [{ kind: "game", provider: "steam", name: "Online game", appId: "480" }];
        inst.activities.friend = [{ kind: "game", provider: "steam", name: "Friend's game", appId: "480" }];
        inst.activities.visitor = [{ kind: "game", provider: "steam", name: "Private game", appId: "480" }];
        s.desktopActivity = { supported: true, error: null, activities: [
          { kind: "game", provider: "steam", name: "Local game", appId: "730" },
          { kind: "music", provider: "spotify", name: "Song" },
          { kind: "development", provider: "vscode", name: "Project" },
        ] };
      });
    });
    const self = page.locator('.voice-user[data-user-id="person"]');
    const friend = page.locator('.voice-user[data-user-id="friend"]');
    await expect(self.getByRole("img", { name: "Jogando Local game", exact: true })).toBeVisible();
    await expect(self.locator(".voice-activity-game .game-icon")).toHaveAttribute("src", icon);
    await expect.poll(() => self.locator(".game-icon").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(32);
    await expect(self.getByRole("img", { name: "Ouvindo Song", exact: true })).toBeVisible();
    await expect(self.getByRole("img", { name: "Programando · Project", exact: true })).toBeVisible();
    await expect(friend.getByRole("img", { name: "Jogando Friend's game", exact: true })).toBeVisible();
    await expect(page.locator('.voice-user[data-user-id="visitor"] .voice-activity')).toHaveCount(0);
    await self.getByRole("img", { name: "Jogando Local game", exact: true }).hover();
    await expect(page.getByRole("tooltip")).toHaveText("Jogando Local game");
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => { s.desktopActivity.activities = []; });
    });
    await expect(self.getByRole("img", { name: "Jogando Online game", exact: true })).toBeVisible();
    await expect(self.getByRole("img", { name: "Jogando Local game", exact: true })).toHaveCount(0);
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => { s.settings.shareActivity = false; });
    });
    await expect(self.locator(".voice-activity")).toHaveCount(0);
    await expect(friend.getByRole("img", { name: "Jogando Friend's game", exact: true })).toBeVisible();
  } finally { await close(); }
});

test("old server connections have a context menu and require a single named confirmation to remove", async () => {
  const { page, close } = await launch();
  const destructiveRequests: string[] = [];
  try {
    await seed(page);
    await page.route("https://old-server.test/api/**", (route) => {
      if (route.request().method() === "DELETE") destructiveRequests.push(route.request().url());
      return route.fulfill({ contentType: "application/json", body: "{}" });
    });
    await page.evaluate(async () => {
      const { setState, getState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      const old = structuredClone(getState().instances.test);
      old.status = "invalid";
      old.servers[0].name = "Servidor antigo";
      setState((s: any) => {
        s.accounts.push({ ...s.accounts[0], id: "old", url: "https://old-server.test", instanceName: "Conexão antiga" });
        s.instances.old = old;
      });
    });
    const oldTab = page.getByRole("button", { name: "Servidor antigo · Conexão antiga", exact: true });
    const currentTab = page.getByRole("button", { name: "Comunidade de teste · Instância de teste", exact: true });
    await oldTab.click({ button: "right" });
    const menu = page.getByRole("menu", { name: "Opções de Servidor antigo" });
    await expect(menu.getByRole("menuitem", { name: "Copiar endereço", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await menu.getByRole("menuitem", { name: "Remover da barra…", exact: true }).click();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation.getByRole("heading")).toHaveText('Remover "Servidor antigo"');
    await expect(confirmation.locator(".action-dialog-description")).toHaveText("Deseja mesmo remover Servidor antigo da barra lateral? Você poderá adicioná-lo novamente quando quiser.");
    await expect(confirmation).not.toContainText("https://");
    await expect(confirmation.getByRole("textbox")).toHaveCount(0);
    await expect(confirmation.getByRole("button")).toHaveCount(2);
    await confirmation.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(oldTab).toBeVisible();
    await expect(confirmation).toHaveCount(0);
    await oldTab.focus();
    await oldTab.press("Shift+F10");
    await menu.getByRole("menuitem", { name: "Remover da barra…", exact: true }).click();
    await confirmation.getByRole("button", { name: "Remover da barra", exact: true }).click();
    await expect(oldTab).toHaveCount(0);
    await expect(confirmation).toHaveCount(0);
    await expect(currentTab).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("distopic.accounts") ?? "[]").map((a: any) => a.id))).toEqual(["test"]);
    expect(destructiveRequests).toEqual([]);
  } finally { await close(); }
});

test("server context menu scopes unread and notifications and respects administrative permissions", async () => {
  const { page, close } = await launch();
  try {
    await seed(page);
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => {
        s.instances.test.unread = { general: { count: 3, mention: true }, other: { count: 2, mention: false }, dm: { count: 4, mention: false } };
      });
    });
    const tab = page.getByRole("button", { name: "Comunidade de teste · Instância de teste", exact: true });
    const menu = page.getByRole("menu", { name: "Opções de Comunidade de teste" });
    await tab.click({ button: "right" });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Convidar pessoas", exact: true })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Configurações do servidor", exact: true })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Criar canal", exact: true })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Sair do servidor…", exact: true })).toHaveCount(0);
    await menu.getByRole("menuitem", { name: "Marcar como lido", exact: true }).click();
    expect(await page.evaluate(async () => {
      const { getState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      return getState().instances.test.unread;
    })).toEqual({ other: { count: 2, mention: false }, dm: { count: 4, mention: false } });
    await tab.click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Silenciar servidor", exact: true }).click();
    await tab.focus();
    await tab.press("Shift+F10");
    await expect(menu.getByRole("menuitem", { name: "Ativar notificações do servidor", exact: true })).toBeVisible();
    await menu.press("Escape");
    await expect(tab).toBeFocused();
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => { s.instances.test.user.id = "other-user"; s.instances.test.serverStates.server.permissions = 0; });
    });
    await tab.click({ button: "right" });
    for (const name of ["Convidar pessoas", "Configurações do servidor", "Criar canal", "Criar categoria"])
      await expect(menu.getByRole("menuitem", { name, exact: true })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Sair do servidor…", exact: true })).toBeVisible();
  } finally { await close(); }
});

test("activity cards show platform marks and album/game artwork with fallback", async () => {
  const { page, app, close } = await launch();
  try {
    await seed(page);
    const jpeg = await app.evaluate(({ nativeImage }, path) => nativeImage.createFromPath(path).resize({ width: 128 }).toJPEG(75).toString("base64"), resolve("build/icon.png"));
    const cover = `data:image/jpeg;base64,${jpeg}`;
    await page.route("https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/730/header.jpg", (route) => route.fulfill({ contentType: "image/jpeg", body: Buffer.from(jpeg, "base64") }));
    await page.evaluate(async (cover) => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => { s.desktopActivity = { supported: true, error: null, activities: [
        { kind: "music", provider: "spotify", name: "NO FEAR", artist: "Artista de teste", album: "Álbum de teste", artwork: cover },
        { kind: "game", provider: "steam", name: "Jogo de teste", appId: "730", artwork: "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/730/header.jpg" },
      ] }; });
    }, cover);
    await page.getByRole("button", { name: "Abrir meu perfil", exact: true }).click();
    await expect(page.locator(".self-profile .provider-spotify")).toBeVisible();
    await expect(page.locator(".self-profile .activity-game .activity-provider")).toHaveText("Jogando");
    for (const img of await page.locator(".self-profile .activity-artwork img").all()) await expect.poll(() => img.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await expect(page.getByRole("link", { name: "Abrir NO FEAR no Spotify" })).toHaveAttribute("href", /open.spotify.com\/search\//);
    await page.screenshot({ path: join(capture, "activity-artwork-dark.png") });
    await page.setViewportSize({ width: 940, height: 620 });
    await page.evaluate(async () => { const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`); setState((s: any) => { s.settings.theme = "light"; }); });
    await page.screenshot({ path: join(capture, "activity-artwork-light-minimum.png") });
    await fullyInside(page, ".self-profile");
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => { s.desktopActivity.activities[0].artwork = "data:image/jpeg;base64,/9j/AA=="; });
    });
    await expect(page.locator(".self-profile .activity-music .no-artwork")).toBeVisible();
    await expect(page.locator(".self-profile .activity-music")).toContainText("NO FEAR");
  } finally { await close(); }
});

test("message sounds, channel/server mute, DM shortcuts, hover layout and settings cards", async () => {
  const { page, app, close } = await launch();
  let socket: WebSocketRoute;
  const friend = { id: "friend", username: "amiga", displayName: "Amiga", avatarUrl: null };
  const send = (id: string, channelId = "general", author = friend) => socket.send(JSON.stringify({ t: "MESSAGE_CREATE", d: { id, channelId, author, content: `Mensagem ${id}`, createdAt: new Date().toISOString(), editedAt: null, replyToId: null, attachments: [], mentionIds: [], mentionsEveryone: false } }));
  try {
    await seed(page, (ws) => { socket = ws; });
    await page.evaluate(async () => {
      const create = AudioContext.prototype.createOscillator; (window as any).messageTones = 0;
      AudioContext.prototype.createOscillator = function () { (window as any).messageTones++; return create.call(this); };
    });
    const tones = () => page.evaluate(() => (window as any).messageTones);
    send("sound-1"); await expect.poll(tones).toBe(2);
    send("sound-1"); await expect.poll(tones).toBe(2);
    await page.getByRole("button", { name: "Notificações de geral", exact: true }).click();
    await page.getByRole("menuitem", { name: "Silenciar canal", exact: true }).click();
    send("sound-2"); await expect(page.getByText("Mensagem sound-2", { exact: true })).toBeVisible(); expect(await tones()).toBe(2);
    await page.getByRole("button", { name: "Notificações de geral", exact: true }).click();
    await page.getByRole("menuitem", { name: "Ativar notificações do canal", exact: true }).click();
    send("sound-3"); await expect.poll(tones).toBe(4);
    await page.getByRole("button", { name: "Menu de Comunidade de teste", exact: true }).click();
    await page.getByRole("menuitem", { name: "Silenciar servidor", exact: true }).click();
    send("sound-4"); await expect(page.getByText("Mensagem sound-4", { exact: true })).toBeVisible(); expect(await tones()).toBe(4);
    await page.getByRole("button", { name: "Menu de Comunidade de teste", exact: true }).click();
    await page.getByRole("menuitem", { name: "Ativar notificações do servidor", exact: true }).click();
    socket!.send(JSON.stringify({ t: "DM_CREATE", d: { id: "private", recipients: [friend], lastMessageId: null } }));
    send("private-1", "private"); send("private-2", "private");
    await expect(page.getByRole("button", { name: "Conversa com Amiga, 2 mensagens não lidas", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Conversa com Amiga, 2 mensagens não lidas", exact: true }).click();
    await expect(page.locator(".chat-header h1")).toHaveText("Amiga");
    send("private-3", "private");
    await expect(page.locator('[data-message-id="private-3"]')).toHaveClass(/message-received/);
    send("private-own", "private", { id: "person", username: "tester", displayName: "Pessoa de teste", avatarUrl: null });
    await expect(page.locator('[data-message-id="private-own"]')).toHaveClass(/message-sent/);
    await expect(page.getByRole("button", { name: "Loja de bots", exact: true })).toHaveCount(0);
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => { s.view = { kind: "server", accountId: "test", serverId: "server", channelId: "general" }; s.voice = { accountId: "test", serverId: "server", channelId: "voice", status: "connected", canStream: true, camera: false, screen: false }; s.settings.voiceBarMode = "external"; });
    });
    await expect(page.locator(".voice-status-bar")).toHaveCount(0);
    await page.mouse.move(900, 500);
    const channel = page.locator(".channel.voice").first(), badge = channel.locator(".voice-here");
    const original = (await badge.boundingBox())!;
    const channelBox = (await channel.boundingBox())!;
    expect(channelBox.x + channelBox.width - original.x - original.width).toBeLessThan(12);
    await channel.hover();
    await expect.poll(async () => (await badge.boundingBox())!.x).toBeLessThan(original.x - 20);
    await page.mouse.move(900, 500);
    await expect.poll(async () => Math.abs((await badge.boundingBox())!.x - original.x)).toBeLessThan(2);
    await page.getByRole("button", { name: "Configurações", exact: true }).click();
    await page.getByRole("button", { name: "Voz e vídeo", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Dispositivos", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Entrada de voz", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Transmissão de tela", exact: true })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Transmitir o som do computador junto com a tela", exact: true })).toBeChecked();
    await page.screenshot({ path: join(capture, "preferences-cards-dark.png") });
    await page.getByRole("button", { name: "Notificações", exact: true }).click();
    await page.getByRole("switch", { name: "Sons de mensagens", exact: true }).uncheck();
    await page.getByRole("combobox", { name: "Tempo para ficar ausente", exact: true }).click();
    await page.getByRole("option", { name: "5 minutos", exact: true }).click();
    await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    const count = await tones(); send("silent-5"); await expect(page.getByText("Mensagem silent-5", { exact: true })).toBeAttached(); expect(await tones()).toBe(count);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(940, 620));
    await page.getByRole("button", { name: "Aparência", exact: true }).click();
    await page.getByRole("button", { name: "Claro", exact: true }).click();
    await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await page.getByRole("button", { name: "Notificações", exact: true }).click();
    await page.screenshot({ path: join(capture, "preferences-notifications-light-minimum.png") });
    await expect.poll(() => page.locator(".settings-content").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  } finally { await close(); }
});

test("private video calls ring, negotiate WebRTC media and release devices on hangup", async () => {
  const left = await launch({ fakeMedia: true }), right = await launch({ fakeMedia: true });
  const sockets = new Map<string, WebSocketRoute>();
  const users = { alice: { id: "alice", username: "alice", displayName: "Alice", avatarUrl: null }, bob: { id: "bob", username: "bob", displayName: "Bob", avatarUrl: null } };
  let call: any;
  const publish = () => { for (const socket of sockets.values()) socket.send(JSON.stringify({ t: "CALL_UPDATE", d: call })); };
  try {
    for (const [id, session] of [["alice", left], ["bob", right]] as const) {
      const other = id === "alice" ? "bob" : "alice";
      await session.page.route("http://private.test/api/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
      await session.page.route("http://private.test/api/calls", async (route) => {
        const body = route.request().postDataJSON();
        call = { id: "private-call", callerId: id, calleeId: other, video: body.video, status: "ringing", callerDeviceId: body.deviceId, iceServers: [] };
        publish(); await route.fulfill({ contentType: "application/json", body: JSON.stringify(call) });
      });
      await session.page.routeWebSocket("ws://private.test/gateway", (socket) => {
        sockets.set(id, socket);
        socket.onMessage((raw) => {
          const message = JSON.parse(String(raw));
          if (message.op === "identify") socket.send(JSON.stringify({ t: "READY", d: { user: users[id], servers: [], dms: [], relationships: [{ user: users[other], status: "friend" }], presences: { [other]: "online" }, activities: {}, instance: { isAdmin: false, registration: "open", voiceBackend: "builtin", directCalls: true } } }));
          if (message.op !== "call") return;
          if (message.action === "accept") { call.status = "active"; call.calleeDeviceId = message.deviceId; publish(); }
          if (message.action === "end" || message.action === "reject") { call.status = "ended"; publish(); }
          if (message.action === "signal") sockets.get(other)?.send(JSON.stringify({ t: "CALL_SIGNAL", d: { callId: call.id, signal: message.signal } }));
        });
      });
      await session.page.evaluate(async (id) => {
        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); (window as any).callStreams = [];
        navigator.mediaDevices.getUserMedia = async (constraints) => {
          const stream = await original({ audio: constraints?.audio, video: false });
          if (constraints?.video) {
            const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 180;
            const context = canvas.getContext("2d")!;
            const paint = () => { context.fillStyle = id === "alice" ? "#315c8c" : "#794d80"; context.fillRect(0, 0, 320, 180); context.fillStyle = "white"; context.font = "24px sans-serif"; context.fillText(id, 24, 90); context.fillRect(Date.now() % 280, 150, 20, 10); };
            paint();
            const video = canvas.captureStream(15).getVideoTracks()[0]!;
            const timer = setInterval(paint, 60), stop = video.stop.bind(video);
            video.stop = () => { clearInterval(timer); stop(); };
            stream.addTrack(video);
          }
          (window as any).callStreams.push(stream); return stream;
        };
        const { addAccount } = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
        addAccount({ id, url: "http://private.test", token: "synthetic", userId: id, instanceName: "Chamadas de teste" });
      }, id);
      await expect(session.page.getByRole("button", { name: `Chamada de vídeo com ${users[other].displayName}`, exact: true })).toBeVisible();
    }
    await left.page.getByRole("button", { name: "Chamada de vídeo com Bob", exact: true }).click();
    await expect(right.page.getByRole("dialog", { name: "Chamada recebida", exact: true })).toBeVisible();
    await right.page.screenshot({ path: join(capture, "private-call-incoming.png") });
    await right.page.getByRole("button", { name: "Atender", exact: true }).click();
    for (const session of [left, right]) {
      await expect(session.page.locator(".direct-call-panel")).toBeVisible();
      await expect(session.page.getByText("Chamada conectada", { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect.poll(() => session.page.locator(".direct-call-video video").first().evaluate((video: HTMLVideoElement) => video.videoWidth)).toBeGreaterThan(0);
    }
    await left.page.screenshot({ path: join(capture, "private-video-call-connected.png") });
    await left.page.getByRole("button", { name: "Encerrar", exact: true }).click();
    for (const session of [left, right]) {
      await expect(session.page.locator(".direct-call-panel")).toHaveCount(0);
      await expect.poll(() => session.page.evaluate(() => (window as any).callStreams.every((stream: MediaStream) => stream.getTracks().every((track) => track.readyState === "ended")))).toBe(true);
    }
  } finally { await left.close(); await right.close(); }
});

test("profile biography, screen quality, Annoy news and remembered sign-in", async () => {
  const { page, close } = await launch();
  try {
    await seed(page);
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => { s.instances.test.instance = { isAdmin: false, registration: "open", voiceBackend: "builtin", socialProfiles: true }; });
    });
    await page.route("http://experience.test/api/users/@me", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "person", username: "tester", displayName: "Pessoa de teste", avatarUrl: null, ...route.request().postDataJSON() }) }));
    await page.route("http://experience.test/api/info", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ name: "Instância de teste", registrationOpen: true, registration: "open", discordLogin: false }) }));
    await page.getByRole("button", { name: "Configurações", exact: true }).click();
    const bio = page.getByRole("textbox", { name: "Biografia de tester", exact: true });
    await bio.fill("Uma biografia de teste com conteúdo para conferir o limite e a apresentação. ".repeat(14).slice(0, 1000));
    await expect(bio).toHaveAttribute("maxlength", "1000");
    await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await page.getByRole("button", { name: "Fechar", exact: true }).click();
    await page.getByRole("button", { name: "Abrir meu perfil", exact: true }).click();
    await expect(page.locator(".self-profile .profile-bio")).toHaveCSS("-webkit-line-clamp", "3");
    await page.keyboard.press("Escape");
    await page.evaluate(async () => { const { openModal } = await import(/* @vite-ignore */ `${location.origin}/src/components/ui.tsx`); openModal({ kind: "screenPicker" }); });
    await page.getByRole("combobox", { name: "Resolução da transmissão", exact: true }).click();
    await page.getByRole("option", { name: "2K (2048 × 1080)", exact: true }).click();
    await page.getByRole("combobox", { name: "FPS da transmissão", exact: true }).click();
    await page.getByRole("option", { name: "60 FPS", exact: true }).click();
    expect(await page.evaluate(async () => { const { getState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`); const { screenProfile, screenQualityLabel } = await import(/* @vite-ignore */ `${location.origin}/src/lib/screen-profile.ts`); return screenQualityLabel(screenProfile(getState().settings).quality); })).toBe("2K 60 FPS");
    await page.screenshot({ path: join(capture, "screen-quality-picker.png") });
    await page.getByRole("button", { name: "Fechar", exact: true }).click();
    await page.getByRole("button", { name: "Novidades do Annoy", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Novidades do Annoy", exact: true })).toBeVisible();
    await page.screenshot({ path: join(capture, "annoy-news.png") });
    await page.evaluate(async () => { const { removeAccount } = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`); const { openModal } = await import(/* @vite-ignore */ `${location.origin}/src/components/ui.tsx`); removeAccount("test"); openModal({ kind: "switchAccount" }); });
    await expect(page.locator(".saved-account")).toHaveCount(1);
    expect(await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem("distopic.rememberedAccounts")!)))).not.toContain("token");
    await page.locator(".saved-account").click();
    await expect(page.getByRole("textbox", { name: "Usuário", exact: true })).toHaveValue("tester");
    await page.screenshot({ path: join(capture, "remembered-login.png") });
    await page.getByRole("button", { name: "Criar conta", exact: true }).click();
    await page.screenshot({ path: join(capture, "register-redesign.png") });
  } finally { await close(); }
});

test("Steam connection publishes online fallback, prefers local games and clears on unlink or disabled sharing", async () => {
  const { page, close } = await launch();
  const sent: any[] = [];
  let linked = false;
  let activityRequests = 0;
  try {
    await page.evaluate(() => { window.open = () => null; });
    await page.route("http://steam.test/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      const connection = linked ? { steamId: "76561198000000001", profileUrl: "https://steamcommunity.com/profiles/76561198000000001/" } : null;
      let body: unknown = [];
      if (path === "/api/users/@me/steam") {
        if (route.request().method() === "DELETE") linked = false;
        body = { connection: linked ? connection : null, onlineActivityAvailable: true };
      } else if (path === "/api/auth/steam/begin") body = { url: "https://steamcommunity.com/openid/login", handoff: "synthetic-secret-handoff" };
      else if (path === "/api/auth/steam/poll") { linked = true; body = { status: "done", connection: { steamId: "76561198000000001", profileUrl: "https://steamcommunity.com/profiles/76561198000000001/" } }; }
      else if (path === "/api/users/@me/steam/activity") {
        activityRequests++;
        body = { activities: linked ? [{ kind: "game", provider: "steam", name: "Steam online game", appId: "480" }] : [] };
      }
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.routeWebSocket("ws://steam.test/gateway", (socket) => socket.onMessage((message) => {
      const data = JSON.parse(String(message));
      if (data.op === "identify") socket.send(JSON.stringify({ t: "READY", d: {
        user: { id: "me", username: "me", displayName: "Pessoa", avatarUrl: null }, servers: [], dms: [], relationships: [], presences: {}, activities: {},
        instance: { name: "Steam test", activityArtwork: true, steamConnection: true, developmentActivity: true },
      } }));
      if (data.op === "activity") sent.push(data.activities);
    }));
    await page.evaluate(async () => {
      const { addAccount } = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
      addAccount({ id: "steam", url: "http://steam.test", token: "synthetic", userId: "me", instanceName: "Steam test" });
    });
    await page.getByRole("button", { name: "Configurações", exact: true }).click();
    await page.getByRole("button", { name: "Atividade", exact: true }).click();
    await page.getByRole("button", { name: "Conectar Steam", exact: true }).click();
    await expect(page.getByRole("link", { name: "Perfil Steam · 76561198000000001" })).toBeVisible();
    await expect.poll(() => sent.at(-1)?.[0]?.appId).toBe("480");
    expect(JSON.stringify(sent)).not.toContain("76561198000000001");
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => { s.desktopActivity = { supported: true, error: null, activities: [
        { kind: "game", provider: "steam", name: "Local Steam game", appId: "730" },
        { kind: "music", provider: "spotify", name: "Current song" },
      ] }; });
    });
    await expect.poll(() => sent.at(-1)?.map((a: any) => a.name)).toEqual(["Local Steam game", "Current song"]);
    await page.getByRole("switch", { name: "Compartilhar minha atividade", exact: true }).uncheck();
    await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect.poll(() => sent.at(-1)).toEqual([]);
    const before = activityRequests;
    await page.evaluate(() => window.dispatchEvent(new Event("steam-connection-changed")));
    await page.waitForTimeout(100);
    expect(activityRequests).toBe(before);
    await page.getByRole("switch", { name: "Compartilhar minha atividade", exact: true }).check();
    await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => { s.desktopActivity = { supported: true, error: null, activities: [] }; });
    });
    await expect.poll(() => sent.at(-1)?.[0]?.appId).toBe("480");
    await page.getByRole("button", { name: "Desconectar Steam", exact: true }).click();
    await expect(page.getByRole("button", { name: "Conectar Steam", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Perfil Steam · 76561198000000001" })).toHaveCount(0);
    await expect.poll(() => sent.at(-1)).toEqual([]);
  } finally { await close(); }
});

test("Spotify activity publishes on ready, clears when disabled and resumes after reconnect", async () => {
  const { page, close } = await launch();
  const sent: any[] = [];
  let socket: any;
  const ready = { t: "READY", d: { user: { id: "me", username: "me", displayName: "Pessoa", avatarUrl: null }, servers: [], dms: [], relationships: [], presences: {}, activities: {}, instance: { name: "Teste", activityArtwork: false } } };
  try {
    await page.route("http://sharing.test/api/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
    await page.routeWebSocket("ws://sharing.test/gateway", (ws) => {
      socket = ws;
      ws.onMessage((message) => {
        const data = JSON.parse(String(message));
        if (data.op === "identify") ws.send(JSON.stringify(ready));
        if (data.op === "activity") sent.push(data.activities);
      });
    });
    await page.evaluate(async () => {
      const { addAccount } = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
      const { setState, getState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      if (!getState().settings.shareActivity) throw new Error("Activity must default to enabled");
      setState((s: any) => { s.desktopActivity = { supported: true, error: null, activities: [{ kind: "music", provider: "spotify", name: "Faixa publicada", artist: "Artista", artwork: "data:image/jpeg;base64,/9j/AA==" }] }; });
      addAccount({ id: "sharing", url: "http://sharing.test", token: "synthetic", userId: "me", instanceName: "Teste" });
    });
    await expect.poll(() => sent.some((items) => items[0]?.name === "Faixa publicada")).toBe(true);
    expect(sent.find((items) => items[0]?.name === "Faixa publicada")[0].artwork).toBeUndefined();
    await page.getByRole("button", { name: "Configurações", exact: true }).click();
    await page.getByRole("button", { name: "Atividade", exact: true }).click();
    await expect(page.getByRole("switch")).toHaveCount(1);
    await page.getByRole("switch", { name: "Compartilhar minha atividade", exact: true }).uncheck();
    await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect.poll(() => sent.at(-1)).toEqual([]);
    await page.getByRole("switch", { name: "Compartilhar minha atividade", exact: true }).check();
    await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => { s.desktopActivity = { supported: true, error: null, activities: [{ kind: "music", provider: "spotify", name: "Faixa após reconexão", artist: "Artista", artwork: "data:image/jpeg;base64,/9j/AA==" }] }; });
    });
    sent.length = 0;
    ready.d.instance.activityArtwork = true;
    socket.close({ code: 1001 });
    await expect.poll(() => sent.some((items) => items[0]?.name === "Faixa após reconexão")).toBe(true);
    expect(sent.find((items) => items[0]?.name === "Faixa após reconexão")[0].artwork).toBe("data:image/jpeg;base64,/9j/AA==");
  } finally { await close(); }
});

test("searchable permission targets distinguish roles and people and guard changes", async () => {
  const { page, close } = await launch();
  try {
    await seed(page);
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => {
        const state = s.instances.test.serverStates.server;
        state.roles.push({ id: "moderators", serverId: "server", name: "Moderação", permissions: 0, position: 1, color: "#6dd7b2" });
        state.channels[0].overwrites = [{ targetId: "moderators", targetType: "role", allow: 1, deny: 0 }];
      });
    });
    await page
      .locator(".channel")
      .filter({ has: page.locator(".channel-name", { hasText: /^geral$/ }) })
      .hover();
    await page.getByTitle("Editar canal", { exact: true }).first().click();
    await page.getByRole("button", { name: "Permissões", exact: true }).click();
    await page.getByRole("combobox", { name: "Cargo ou membro" }).click();
    await expect(page.locator(".entity-popover")).toBeInViewport();
    await expect(page.locator(".entity-custom")).toHaveText("Personalizado");
    await page.screenshot({ path: join(capture, "permission-targets.png") });
    await page.getByPlaceholder("Buscar por nome ou usuário…").fill("modera");
    await page.getByRole("option", { name: /Moderação/ }).click();
    await expect(page.getByRole("combobox", { name: "Cargo ou membro" })).toContainText("Moderação");
    await page
      .getByRole("radiogroup", { name: "Enviar mensagens", exact: true })
      .getByRole("radio", { name: "Permitir", exact: true })
      .click();
    await expect(page.locator(".settings-savebar")).toBeVisible();
    await page.getByRole("combobox", { name: "Cargo ou membro" }).click();
    await page.getByPlaceholder("Buscar por nome ou usuário…").fill("tester");
    await page.getByRole("option", { name: /tester/ }).click();
    await expect(page.getByRole("heading", { name: "Salvar suas alterações?" })).toBeVisible();
    await page.getByRole("button", { name: "Descartar alterações", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Cargo ou membro" })).toContainText("Pessoa de teste");
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => {
        s.settings.theme = "light";
      });
    });
    await page.setViewportSize({ width: 940, height: 620 });
    await page.getByRole("combobox", { name: "Cargo ou membro" }).click();
    await page.screenshot({ path: join(capture, "permission-targets-light-minimum.png") });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  } finally {
    await close();
  }
});

test("message search filters, pagination, context jump and return to latest", async () => {
  const { page, close } = await launch();
  try {
    await seed(page);
    let queries: URLSearchParams[] = [];
    const message = {
      id: "found",
      channelId: "general",
      author: { id: "person", username: "tester", displayName: "Pessoa de teste", avatarUrl: null },
      content: "Uma conversa encontrada sobre planejamento",
      createdAt: "2026-10-01T12:00:00.000Z",
      editedAt: null,
      replyToId: null,
      attachments: [],
      mentionIds: [],
      mentionsEveryone: false,
    };
    await page.route("http://experience.test/api/search/messages?**", (route) => {
      const params = new URL(route.request().url()).searchParams;
      queries.push(params);
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          items: params.has("cursor") ? [] : [{ message, channelName: "geral", serverId: "server" }],
          nextCursor: params.has("cursor") ? null : "found",
        }),
      });
    });
    await page.route("http://experience.test/api/channels/general/messages?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(new URL(route.request().url()).searchParams.has("around") ? [message] : []),
      }),
    );
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("heading", { name: "Buscar em Comunidade de teste" })).toBeVisible();
    await page.getByRole("textbox", { name: "Buscar mensagens", exact: true }).fill("planejamento");
    await page.getByRole("button", { name: "Filtros", exact: true }).click();
    await page.getByRole("combobox", { name: "No canal", exact: true }).click();
    await page.getByRole("option", { name: "#geral", exact: true }).click();
    await page.getByRole("button", { name: "Buscar", exact: true }).click();
    await expect(page.locator(".search-result")).toHaveCount(1);
    expect(queries[0]!.get("channelId")).toBe("general");
    expect(queries[0]!.get("serverId")).toBe("server");
    await page.screenshot({ path: join(capture, "message-search.png") });
    await page.setViewportSize({ width: 940, height: 620 });
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => {
        s.settings.theme = "light";
      });
    });
    await page.screenshot({ path: join(capture, "message-search-light-minimum.png") });
    await page.getByRole("button", { name: "Depois de", exact: true }).click();
    await expect(page.locator(".calendar-popover")).toBeInViewport();
    await fullyInside(page, ".calendar-popover", 48);
    await page.screenshot({ path: join(capture, "search-calendar.png") });
    await page.getByRole("button", { name: "Limpar data", exact: true }).click();
    await page.getByRole("button", { name: "Antes de", exact: true }).click();
    await fullyInside(page, ".calendar-popover", 48);
    await page.screenshot({ path: join(capture, "search-calendar-before.png") });
    await page.getByRole("button", { name: "Limpar data", exact: true }).click();
    await page.setViewportSize({ width: 1320, height: 840 });
    await page.getByRole("button", { name: "Mais resultados", exact: true }).click();
    await expect.poll(() => queries.length).toBe(2);
    expect(queries[1]!.get("cursor")).toBe("found");
    await page.locator(".search-result").click();
    await expect(page.locator('[data-message-id="found"]')).toBeInViewport();
    await expect(page.locator(".search-highlight")).toHaveCount(1);
    await page.screenshot({ path: join(capture, "search-context.png") });
    await page.getByRole("button", { name: /Voltar às mais recentes/ }).click();
    await expect(page.locator(".return-latest")).toHaveCount(0);
  } finally {
    await close();
  }
});

test("friend activity is distinct from public membership and shared action dialogs work", async () => {
  const { page, close } = await launch();
  try {
    await seed(page);
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => {
        const i = s.instances.test;
        const friend = { id: "friend", username: "bruna", displayName: "Bruna", avatarUrl: null },
          stranger = { id: "stranger", username: "outro", displayName: "Outro membro", avatarUrl: null };
        i.relationships = [{ user: friend, status: "friend" }];
        i.serverStates.server.members.push(
          ...[friend, stranger].map((user) => ({
            user,
            nick: null,
            presence: "online",
            roleIds: ["server"],
            joinedAt: new Date().toISOString(),
          })),
        );
        i.activities = {
          friend: [
            { kind: "game", provider: "steam", name: "Jogo de teste", appId: "480" },
            { kind: "music", provider: "spotify", name: "Faixa de teste", artist: "Artista de teste" },
          ],
          stranger: [{ kind: "game", provider: "steam", name: "Atividade confidencial", appId: "123" }],
        };
      });
    });
    await expect(page.locator(".friend-activities")).toContainText("Jogo de teste");
    await expect(page.getByText("Atividade confidencial", { exact: true })).toHaveCount(0);
    await page.locator(".friend-activities > button").click();
    await expect(page.getByRole("dialog", { name: "Perfil de Bruna" })).toBeInViewport();
    await expect(page.getByRole("link", { name: "Ver Jogo de teste na Steam" })).toHaveAttribute(
      "href",
      "https://store.steampowered.com/app/480/",
    );
    await page.screenshot({ path: join(capture, "friend-activity.png") });
    await page.setViewportSize({ width: 940, height: 620 });
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => {
        s.settings.theme = "light";
      });
    });
    await expect(page.getByRole("dialog", { name: "Perfil de Bruna" })).toBeInViewport();
    await fullyInside(page, ".member-profile");
    await page.screenshot({ path: join(capture, "friend-activity-light-minimum.png") });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1320, height: 840 });
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => {
        s.instances.test.relationships = [];
      });
    });
    await expect(page.locator(".friend-activities")).toHaveCount(0);
    await page.evaluate(async () => {
      const { confirmAction, promptText } = await import(/* @vite-ignore */ `${location.origin}/src/components/ui/action-dialog.tsx`);
      (window as any).answers = [];
      void confirmAction("Excluir o item de teste?").then((value) => (window as any).answers.push(value));
      void promptText("Escreva o nome de teste").then((value) => (window as any).answers.push(value));
    });
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.getByRole("textbox", { name: "Sua resposta" }).fill("Annoy");
    await page.getByRole("button", { name: "Confirmar", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).answers)).toEqual([false, "Annoy"]);
    await page.getByRole("button", { name: "Configurações", exact: true }).click();
    await page.getByRole("button", { name: "Atividade", exact: true }).click();
    await expect(page.getByRole("switch", { name: /Compartilhar minha atividade/ })).toBeChecked();
    await page.getByRole("switch", { name: /Compartilhar minha atividade/ }).uncheck();
    await expect(page.locator(".settings-savebar")).toBeVisible();
    await page.screenshot({ path: join(capture, "activity-settings.png") });
    await page.getByRole("button", { name: "Redefinir", exact: true }).click();
    await expect(page.getByRole("switch", { name: /Compartilhar minha atividade/ })).toBeChecked();
  } finally {
    await close();
  }
});

test("wheel zoom and native in-app audio/video lifecycle", async () => {
  const { page, close } = await launch();
  try {
    await seed(page);
    await page.route("http://experience.test/image.png", async (route) =>
      route.fulfill({ contentType: "image/png", body: await readFile("build/icon.png") }),
    );
    await page.route("http://experience.test/audio.wav", (route) => route.fulfill({ contentType: "audio/wav", body: silence() }));
    const video = await readFile("tests/fixtures/flower.webm");
    await page.route("http://experience.test/video.webm", (route) =>
      route.fulfill({ contentType: "video/webm", body: Buffer.from(video) }),
    );
    await page.getByRole("button", { name: "Visualizar imagem.png" }).click();
    await expect(page.locator(".viewer-file-info")).toContainText("512 × 512");
    const viewport = (await page.locator(".viewer-viewport").boundingBox())!;
    await page.mouse.move(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2);
    await page.mouse.wheel(0, -280);
    await expect
      .poll(async () => Number((await page.getByRole("button", { name: "Ajustar imagem à janela" }).textContent())!.replace("%", "")))
      .toBeGreaterThan(100);
    await page.mouse.wheel(0, 2000);
    await expect(page.getByRole("button", { name: "Ajustar imagem à janela" })).toHaveText("100%");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Reproduzir silencio.wav" }).click();
    await expect.poll(() => page.locator(".media-stage audio").evaluate((el: HTMLAudioElement) => el.duration)).toBeGreaterThan(5);
    await page.getByRole("button", { name: "Reproduzir", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pausar", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Pausar", exact: true }).click();
    await page.getByRole("combobox", { name: "Velocidade de reprodução" }).click();
    await page.getByRole("option", { name: "1.5×", exact: true }).click();
    expect(await page.locator(".media-stage audio").evaluate((el: HTMLAudioElement) => el.playbackRate)).toBe(1.5);
    await page.getByRole("slider", { name: "Volume da mídia" }).focus();
    await page.keyboard.press("Home");
    for (let index = 0; index < 5; index++) await page.keyboard.press("ArrowRight");
    expect(await page.locator(".media-stage audio").evaluate((el: HTMLAudioElement) => el.volume)).toBe(0.25);
    await page.screenshot({ path: join(capture, "media-audio.png") });
    const audio = await page.locator(".media-stage audio").elementHandle();
    await page.keyboard.press("Escape");
    expect(await audio!.evaluate((el: HTMLAudioElement) => el.paused)).toBe(true);
    await page.getByRole("button", { name: "Reproduzir video-teste.webm" }).click();
    expect(video.length).toBeGreaterThan(200);
    await expect.poll(() => page.locator(".media-stage video").evaluate((el: HTMLVideoElement) => el.readyState)).toBeGreaterThanOrEqual(2);
    await page.getByRole("button", { name: "Reproduzir", exact: true }).click();
    await expect.poll(() => page.locator(".media-stage video").evaluate((el: HTMLVideoElement) => el.currentTime)).toBeGreaterThan(0);
    await page.screenshot({ path: join(capture, "media-video.png") });
    await page.getByRole("button", { name: "Vídeo em tela cheia" }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains("media-viewer"))).toBe(true);
    await page.getByRole("combobox", { name: "Velocidade de reprodução" }).click();
    await expect(page.getByRole("listbox")).toBeInViewport();
    await page.screenshot({ path: join(capture, "media-fullscreen.png") });
    await page.getByRole("option", { name: "2×", exact: true }).click();
    expect(await page.locator(".media-stage video").evaluate((el: HTMLVideoElement) => el.playbackRate)).toBe(2);
    await page.evaluate(() => document.exitFullscreen());
    await page.keyboard.press("Escape");
  } finally {
    await close();
  }
});

test("animated menus, custom selects, color history and unsaved settings", async () => {
  const { page, close } = await launch();
  try {
    await seed(page);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.getByRole("button", { name: "Menu de Comunidade de teste" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.getByRole("menu")).toHaveCSS("opacity", "1");
    await page.screenshot({ path: join(capture, "server-menu.png") });
    await page.getByRole("menu").evaluate((element) => {
      (window as any).menuExit = false;
      element.addEventListener("animationstart", (event) => {
        if ((event as AnimationEvent).animationName === "menu-out") (window as any).menuExit = true;
      });
    });
    await page.keyboard.press("Escape");
    await expect.poll(() => page.evaluate(() => (window as any).menuExit)).toBe(true);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => {
      navigator.mediaDevices.enumerateDevices = async () =>
        [
          {
            kind: "audioinput",
            deviceId: "test-mic",
            label: "Microfone com um nome de dispositivo muito longo para verificar a quebra de texto",
            groupId: "test",
            toJSON() {
              return this;
            },
          },
        ] as MediaDeviceInfo[];
    });
    await page.getByRole("button", { name: "Configurações", exact: true }).click();
    await page.getByRole("button", { name: "Voz e vídeo", exact: true }).click();
    await page.getByRole("combobox", { name: "Microfone", exact: true }).click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.screenshot({ path: join(capture, "custom-select.png") });
    await page.getByRole("option", { name: /Microfone com um nome/ }).click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("distopic.settings") ?? "{}").inputDeviceId ?? "default")).toBe(
      "default",
    );
    await expect(page.getByRole("button", { name: "Salvar alterações", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Aparência", exact: true }).click();
    await page.getByRole("button", { name: "Cor de destaque", exact: true }).click();
    await page.getByLabel("Código hexadecimal de Cor de destaque").fill("#d25cbb");
    await page.getByRole("button", { name: "Usar cor", exact: true }).click();
    await page.getByRole("button", { name: "Cor de destaque", exact: true }).click();
    await expect(page.getByRole("button", { name: "Cor recente #d25cbb" })).toBeVisible();
    const colorRect = (await page.locator(".color-popover").boundingBox())!;
    expect(colorRect.y).toBeGreaterThanOrEqual(0);
    expect(colorRect.y + colorRect.height).toBeLessThanOrEqual(840);
    await page.screenshot({ path: join(capture, "color-picker.png") });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Salvar suas alterações?" })).toBeVisible();
    await page.getByRole("button", { name: "Continuar editando" }).click();
    await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect(page.locator(".settings-savebar")).toHaveCount(0);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("distopic.settings")!).inputDeviceId)).toBe("test-mic");
    await page.getByRole("button", { name: "Claro", exact: true }).click();
    await page.getByRole("button", { name: "Fechar", exact: true }).click();
    await page.getByRole("button", { name: "Descartar alterações" }).click();
    await expect(page.locator(".user-settings-modal")).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  } finally {
    await close();
  }
});

test("profile crop, deferred upload, save and removal failure retain draft", async () => {
  const { page, close } = await launch();
  let uploads = 0,
    failRemoval = false;
  let user: { id: string; username: string; displayName: string; avatarUrl: string | null } = {
    id: "person",
    username: "tester",
    displayName: "Pessoa de teste",
    avatarUrl: null,
  };
  try {
    await seed(page);
    await page.route("http://experience.test/api/users/@me", (route) => {
      const body = route.request().postDataJSON();
      if (failRemoval && body.avatarUrl === null)
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "Falha de teste ao remover foto" }),
        });
      user = { ...user, ...body };
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(user) });
    });
    await page.route("http://experience.test/api/users/@me/avatar", (route) => {
      uploads++;
      expect(route.request().postDataBuffer()!.length).toBeGreaterThan(1000);
      user.avatarUrl = "http://experience.test/avatar.png";
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(user) });
    });
    await page.route("http://experience.test/avatar.png", async (route) =>
      route.fulfill({ contentType: "image/png", body: await readFile("build/icon.png") }),
    );
    await page.getByRole("button", { name: "Configurações", exact: true }).click();
    await page.getByLabel("Selecionar foto de tester").setInputFiles("build/icon.png");
    await expect(page.getByRole("heading", { name: "Encontre o melhor enquadramento" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Usar este recorte", exact: true })).toBeEnabled();
    await page.screenshot({ path: join(capture, "avatar-crop.png") });
    await page.getByRole("button", { name: "Usar este recorte", exact: true }).click();
    expect(uploads).toBe(0);
    await expect(page.locator(".profile-preview img").first()).toHaveAttribute("src", /^blob:/);
    await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect(page.locator(".settings-savebar")).toHaveCount(0);
    expect(uploads).toBe(1);
    await expect(page.locator(".profile-preview img").first()).toHaveAttribute("src", user.avatarUrl!);
    expect(
      await page
        .locator(".modal-body")
        .first()
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await page.screenshot({ path: join(capture, "profile-settings.png") });
    failRemoval = true;
    await page.getByRole("button", { name: "Remover foto", exact: true }).click();
    await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Falha de teste ao remover foto" })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Falha de teste ao remover foto" })).toBeInViewport();
    await page.screenshot({ path: join(capture, "profile-save-error.png") });
    await expect(page.locator(".settings-savebar")).toBeVisible();
    await page.getByRole("button", { name: "Redefinir", exact: true }).click();
    await expect(page.locator(".profile-preview img").first()).toHaveAttribute("src", user.avatarUrl!);
    await page.keyboard.press("Escape");
  } finally {
    await close();
  }
});

test("server, role and channel settings share pending-save and exit guards", async () => {
  const { page, close } = await launch();
  const writes: { url: string; body: unknown }[] = [];
  let failChannel = true;
  try {
    await seed(page);
    await page.route("http://experience.test/api/servers/server**", (route) => {
      if (route.request().method() === "PATCH") writes.push({ url: route.request().url(), body: route.request().postDataJSON() });
      return route.fulfill({ contentType: "application/json", body: "{}" });
    });
    await page.route("http://experience.test/api/channels/general", (route) => {
      if (failChannel)
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "Falha de teste ao salvar canal" }),
        });
      writes.push({ url: route.request().url(), body: route.request().postDataJSON() });
      return route.fulfill({ contentType: "application/json", body: "{}" });
    });
    const openServer = async () => {
      await page.getByRole("button", { name: "Menu de Comunidade de teste" }).click();
      await page.getByRole("menuitem", { name: "Configurações do servidor", exact: true }).click();
    };
    await openServer();
    await page.getByLabel("Nome do servidor", { exact: true }).fill("Nome pendente");
    await expect(page.locator(".settings-savebar")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Salvar suas alterações?" })).toBeVisible();
    await page.getByRole("button", { name: "Descartar alterações" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(writes).toHaveLength(0);
    await openServer();
    await page.getByRole("button", { name: "Cargos", exact: true }).click();
    await page.locator(".role-item").first().click();
    await page.locator(".perm").getByRole("checkbox").first().uncheck();
    await page.getByRole("button", { name: "Visão geral", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Salvar suas alterações?" })).toBeVisible();
    await page.getByRole("button", { name: "Continuar editando" }).click();
    await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect(page.locator(".settings-savebar")).toHaveCount(0);
    expect(writes[0]!.url).toContain("/roles/server");
    await page.keyboard.press("Escape");
    await page
      .locator(".channel")
      .filter({ has: page.locator(".channel-name", { hasText: /^geral$/ }) })
      .hover();
    await page.getByTitle("Editar canal", { exact: true }).first().click();
    await page.getByLabel("Nome", { exact: true }).fill("novo-canal");
    await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect(page.locator(".settings-savebar")).toBeVisible();
    await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("novo-canal");
    failChannel = false;
    await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect(page.locator(".settings-savebar")).toHaveCount(0);
    expect(writes[1]!.body).toMatchObject({ name: "novo-canal" });
    await page.keyboard.press("Escape");
  } finally {
    await close();
  }
});
