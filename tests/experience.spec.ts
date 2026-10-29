import { test, expect, _electron as electron, type Page } from "@playwright/test";
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
async function launch() {
  const root = resolve(tmpdir()),
    data = await mkdtemp(join(root, "distopic-experience-"));
  const env = { ...process.env, DISTOPIC_TEST_DATA: data, ELECTRON_RENDERER_URL: "http://127.0.0.1:5178" };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: require("electron"), args: [resolve("tests/fixtures/electron.cjs")], env });
  const page = await app.firstWindow();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".welcome")).toBeVisible();
  await mkdir(capture, { recursive: true });
  const close = async () => {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((window) => window.destroy())).catch(() => undefined);
    await app.close();
    if (dirname(data) !== root || !basename(data).startsWith("distopic-experience-")) throw new Error("Unsafe test directory");
    await rm(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  return { app, page, close };
}

async function seed(page: Page) {
  await page.routeWebSocket("ws://experience.test/gateway", () => {});
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
    await page.locator(".rail-settings").click();
    await page.getByRole("switch", { name: "Compartilhar jogos da Steam com amigos" }).check();
    await expect(page.locator(".settings-savebar")).toBeVisible();
    await page.screenshot({ path: join(capture, "activity-settings.png") });
    await page.getByRole("button", { name: "Redefinir", exact: true }).click();
    await expect(page.getByRole("switch", { name: "Compartilhar jogos da Steam com amigos" })).not.toBeChecked();
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
    await page.locator(".rail-settings").click();
    await page.getByRole("combobox", { name: "Microfone", exact: true }).click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.screenshot({ path: join(capture, "custom-select.png") });
    await page.getByRole("option", { name: /Microfone com um nome/ }).click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("distopic.settings") ?? "{}").inputDeviceId ?? "default")).toBe(
      "default",
    );
    await expect(page.getByRole("button", { name: "Salvar alterações", exact: true })).toBeVisible();
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
    await page.locator(".rail-settings").click();
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
