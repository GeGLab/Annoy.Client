import { test, expect, _electron as electron, type Page } from "@playwright/test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname, basename } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const origin = "http://workspace.test";
const screenshots = resolve(".impeccable/review");

async function launch() {
  const tempRoot = resolve(tmpdir());
  const userData = await mkdtemp(join(tempRoot, "distopic-workspace-"));
  const env = { ...process.env, DISTOPIC_TEST_DATA: userData, ELECTRON_RENDERER_URL: "http://127.0.0.1:5178" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require("electron"), args: [resolve("tests/fixtures/electron.cjs")], env });
  const page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".welcome")).toBeVisible();
  await mkdir(screenshots, { recursive: true });
  const cleanup = async () => {
    await app.close();
    if (dirname(resolve(userData)) !== tempRoot || !basename(userData).startsWith("distopic-workspace-"))
      throw new Error("Unexpected test profile path");
    await rm(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  return { app, page, cleanup };
}

async function seed(page: Page) {
  await page.routeWebSocket("ws://workspace.test/gateway", () => {});
  await page.route(`${origin}/api/**`, (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.evaluate(async () => {
    const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
    const { addAccount } = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
    const me = { id: "me", username: "teste", displayName: "Pessoa de teste", avatarUrl: null };
    const server = { id: "server", name: "Comunidade de teste", iconUrl: null, ownerId: "me" };
    const channel = (id: string, type = "text") => ({
      id,
      serverId: "server",
      type,
      name: id === "general" ? "geral" : "Sala de conversa",
      topic: "Conversa de teste",
      parentId: null,
      position: 0,
      overwrites: [],
    });
    const now = new Date().toISOString();
    addAccount({ id: "workspace", url: "http://workspace.test", token: "synthetic", userId: "me", instanceName: "Instância de teste" });
    setState((s: any) => {
      const inst = s.instances.workspace;
      inst.status = "ready";
      inst.user = me;
      inst.servers = [server];
      inst.serverStates.server = {
        server,
        channels: [channel("general"), channel("voice", "voice")],
        roles: [{ id: "server", serverId: "server", name: "Membros", color: null, permissions: 2147483647, position: 0 }],
        members: [{ user: me, nick: null, roleIds: ["server"], joinedAt: now, presence: "online" }],
        voiceStates: [],
        permissions: 2147483647,
      };
      inst.messages.general = {
        hasMore: false,
        loading: false,
        items: Array.from({ length: 90 }, (_, i) => ({
          id: `message-${i}`,
          channelId: "general",
          author: me,
          content: `Mensagem de teste ${i + 1}: uma conversa com histórico suficiente para verificar a rolagem.`,
          createdAt: now,
          editedAt: null,
          replyToId: null,
          attachments: [],
          mentionIds: [],
          mentionsEveryone: false,
        })),
      };
      s.view = { kind: "server", accountId: "workspace", serverId: "server", channelId: "general" };
    });
  });
  await expect(page.locator(".chat-header h1")).toHaveText("geral");
}

test("latest messages, personal colors, saved panels, voice and blocking reconnect", async () => {
  const { app, page, cleanup } = await launch();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await seed(page);
    const distance = () => page.locator(".messages").evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop);
    await expect.poll(distance).toBeLessThan(3);
    await page.locator(".messages").evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect.poll(() => page.locator(".messages").evaluate((el) => el.scrollTop)).toBeLessThan(3);
    // New messages must not drag a reader away from older content.
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => {
        const list = s.instances.workspace.messages.general.items;
        list.push({ ...list[0], id: "newest", content: "A mensagem mais recente" });
      });
    });
    await expect.poll(() => page.locator(".messages").evaluate((el) => el.scrollTop)).toBeLessThan(3);
    await page.locator(".channel-name", { hasText: /^geral$/ }).click();
    await expect.poll(distance).toBeLessThan(3);

    const channels = page.getByRole("separator", { name: "Largura do painel de canais" });
    await channels.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("distopic.settings")!).channelsWidth)).toBe(260);
    const members = page.getByRole("separator", { name: "Largura do painel de membros" });
    const handle = (await members.boundingBox())!;
    await page.mouse.move(handle.x + 3, handle.y + 90);
    await page.mouse.down();
    await page.mouse.move(handle.x - 37, handle.y + 90);
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("distopic.settings")!).membersWidth)).toBeGreaterThan(220);
    await expect(page.getByRole("button", { name: "Fechar painel de canais" })).toHaveCount(0);
    await page.getByRole("button", { name: "Alternar painel de membros" }).click();
    await expect(page.locator(".members")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Abrir painel de membros" })).toHaveCount(0);
    await page.getByRole("button", { name: "Alternar painel de membros" }).click();
    await expect(page.locator(".members")).toBeVisible();

    await page.locator(".rail-settings").click();
    await page.getByRole("button", { name: "Cor de destaque", exact: true }).click();
    await page.getByLabel("Código hexadecimal de Cor de destaque").fill("#3182ed");
    await page.getByRole("button", { name: "Usar cor", exact: true }).click();
    await page.getByRole("button", { name: "Tom dos painéis", exact: true }).click();
    await page.getByLabel("Código hexadecimal de Tom dos painéis").fill("#55408f");
    await page.getByRole("button", { name: "Usar cor", exact: true }).click();
    await page.getByRole("button", { name: "Salvar alterações", exact: true }).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("distopic.settings")!).accentColor)).toBe("#3182ed");
    await page.keyboard.press("Escape");
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => {
        s.voice = {
          accountId: "workspace",
          serverId: "server",
          channelId: "voice",
          status: "connected",
          canStream: false,
          camera: false,
          screen: false,
        };
        s.instances.workspace.serverStates.server.voiceStates = [
          {
            userId: "me",
            channelId: "voice",
            selfMute: false,
            selfDeaf: false,
            serverMute: false,
            speaking: false,
            video: false,
            screen: false,
          },
        ];
      });
    });
    await expect(page.getByText("Você está conectado à voz", { exact: true })).toBeVisible();
    await expect(page.getByText("Na sala", { exact: true })).toBeVisible();
    await page.screenshot({ path: join(screenshots, "workspace-personalized.png") });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(940, 620));
    const minimumHandle = (await channels.boundingBox())!;
    await page.mouse.move(minimumHandle.x + 3, minimumHandle.y + 90);
    await page.mouse.down();
    await page.mouse.move(minimumHandle.x + 130, minimumHandle.y + 90);
    expect((await page.locator(".chat").boundingBox())!.width).toBeGreaterThanOrEqual(359);
    await page.screenshot({ path: join(screenshots, "workspace-resizing.png") });
    await page.mouse.up();
    expect((await page.locator(".chat").boundingBox())!.width).toBeGreaterThanOrEqual(359);
    await page.screenshot({ path: join(screenshots, "workspace-minimum.png") });
    await page.getByRole("button", { name: "Sair da chamada de voz", exact: true }).click();
    await expect(page.locator(".voice-status-bar")).toHaveCount(0);

    const ready = await page.evaluate(async () => {
      const { getState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      const inst = getState().instances.workspace;
      return { state: inst.serverStates.server, user: inst.user, servers: inst.servers };
    });
    await page.route(`${origin}/api/servers/server`, (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(ready.state) }),
    );
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(page.getByRole("heading", { name: "Reconectando ao seu espaço" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Reconectando ao seu espaço" })).toBeVisible();
    await expect(page.locator(".rail-settings").click({ trial: true, timeout: 300 })).rejects.toThrow();
    await page.screenshot({ path: join(screenshots, "workspace-reconnecting.png") });
    await page.routeWebSocket("ws://workspace.test/gateway", (ws) =>
      ws.onMessage((raw) => {
        const message = JSON.parse(String(raw));
        if (message.op === "identify")
          ws.send(
            JSON.stringify({
              t: "READY",
              d: {
                user: ready.user,
                servers: ready.servers,
                dms: [],
                relationships: [],
                presences: { me: "online" },
                instance: { isAdmin: false, registration: "open", voiceBackend: "builtin" },
              },
            }),
          );
        if (message.op === "heartbeat") ws.send(JSON.stringify({ t: "HEARTBEAT_ACK", d: null }));
      }),
    );
    await page.getByRole("button", { name: "Tentar agora", exact: true }).click();
    await expect(page.locator(".connection-dialog")).toHaveCount(0);
    await expect(page.locator(".chat-header h1")).toHaveText("geral");
    expect(errors).toEqual([]);
  } finally {
    await cleanup();
  }
});

test("bot platform capability, consent, server-owned lifecycle and permission denial", async () => {
  const { page, cleanup } = await launch();
  let supported = false;
  let canManage = true;
  let loseResponse = false;
  let denyMutation = false;
  let installations: { id: string; botId: string; version: string; enabled: boolean; runtimeStatus: string }[] = [];
  const bot = {
    id: "greetings",
    name: "Boas-vindas de teste",
    description: "Bot sintético para testar o contrato da loja. Não é um bot publicado.",
    author: "Instância de teste",
    version: "1.0.0",
    runtime: "distopic-worker-v1",
    permissions: ["members.read", "messages.send"],
  };
  const writes: unknown[] = [];
  try {
    await seed(page);
    await page.route(`${origin}/api/bot-platform`, (route) =>
      route.fulfill({
        status: supported ? 200 : 404,
        contentType: "application/json",
        body: JSON.stringify(supported ? { apiVersion: 1 } : { message: "Not supported" }),
      }),
    );
    await page.route(`${origin}/api/bots/catalog`, (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ bots: [bot] }) }),
    );
    await page.route(`${origin}/api/servers/server/bot-installations**`, (route) => {
      const method = route.request().method();
      if (method !== "GET" && denyMutation)
        return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ message: "Permissão revogada" }) });
      if (method === "POST") {
        writes.push(route.request().postDataJSON());
        installations = [{ id: "install-1", botId: bot.id, version: bot.version, enabled: true, runtimeStatus: "running" }];
        if (loseResponse) {
          loseResponse = false;
          return route.abort("failed");
        }
      }
      if (method === "PATCH") {
        const body = route.request().postDataJSON();
        writes.push(body);
        installations = installations.map((i) => ({ ...i, enabled: body.enabled, runtimeStatus: body.enabled ? "running" : "stopped" }));
      }
      if (method === "DELETE") {
        writes.push("delete");
        installations = [];
      }
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(method === "GET" ? { installations, canManage } : {}) });
    });
    await page.getByRole("button", { name: "Loja de bots", exact: true }).click();
    await expect(page.getByRole("heading", { name: "A loja precisa do suporte da sua instância" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Revisar e instalar" })).toHaveCount(0);
    await page.screenshot({ path: join(screenshots, "bots-unsupported.png") });
    supported = true;
    await page.getByRole("button", { name: "Verificar novamente" }).click();
    await expect(page.getByRole("heading", { name: bot.name, exact: true })).toBeVisible();
    await page.screenshot({ path: join(screenshots, "bots-catalog.png") });
    await page.getByRole("button", { name: "Revisar e instalar" }).click();
    expect(writes).toEqual([]);
    await expect(page.getByText("Consultar membros do servidor", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Autorizar e instalar", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(writes[0]).toEqual({ botId: bot.id, version: "1.0.0", grantedPermissions: bot.permissions });
    await page.getByRole("tab", { name: /Instalados/ }).click();
    await expect(page.getByText("Em execução · v1.0.0", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Desativar", exact: true }).click();
    await expect(page.getByText("Desativado · v1.0.0", { exact: true })).toBeVisible();
    expect(installations).toHaveLength(1);
    await page.screenshot({ path: join(screenshots, "bots-installed.png") });
    await page.getByRole("button", { name: "Ativar", exact: true }).click();
    await expect(page.getByText("Em execução · v1.0.0", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: `Remover ${bot.name}`, exact: true }).click();
    await page.getByRole("button", { name: "Remover bot", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Seu primeiro bot começa na loja" })).toBeVisible();
    expect(writes).toEqual([
      { botId: bot.id, version: "1.0.0", grantedPermissions: bot.permissions },
      { enabled: false },
      { enabled: true },
      "delete",
    ]);
    // The server commits an installation but its response is lost. Lock all
    // further writes until an authoritative read, without installing twice.
    await page.getByRole("tab", { name: "Explorar", exact: true }).click();
    loseResponse = true;
    await page.getByRole("button", { name: "Revisar e instalar" }).click();
    await page.getByRole("button", { name: "Autorizar e instalar", exact: true }).click();
    await expect(page.getByRole("dialog").getByText(/Ela pode ter sido aplicada no servidor/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Autorizar e instalar", exact: true })).toBeDisabled();
    await page.screenshot({ path: join(screenshots, "bots-uncertain.png") });
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Revisar e instalar" })).toBeDisabled();
    await page.getByRole("button", { name: "Atualizar bots" }).click();
    await page.getByRole("tab", { name: /Instalados/ }).click();
    await expect(page.getByText("Em execução · v1.0.0", { exact: true })).toBeVisible();
    expect(installations).toHaveLength(1);
    // Permissions change after the last snapshot; the write is rejected.
    denyMutation = true;
    canManage = false;
    await page.getByRole("button", { name: "Desativar", exact: true }).click();
    await expect(page.getByText(/Suas permissões foram consultadas novamente/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Desativar", exact: true })).toBeDisabled();
    expect(installations[0]!.enabled).toBe(true);
    await page.getByRole("button", { name: "Atualizar bots" }).click();
    await page.getByRole("tab", { name: "Explorar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Instalado", exact: true })).toBeDisabled();
    await expect(page.getByText(/Para alterar bots, peça permissão/)).toBeVisible();
  } finally {
    await cleanup();
  }
});
