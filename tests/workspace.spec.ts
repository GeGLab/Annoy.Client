import { test, expect, _electron as electron, type Page, type WebSocketRoute } from "@playwright/test";
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
      s.settings.voiceBarMode = "always";
      s.view = { kind: "server", accountId: "workspace", serverId: "server", channelId: "general" };
    });
  });
  await expect(page.locator(".chat-header h1")).toHaveText("geral");
}

test("M3 variable-height history keeps the DOM bounded and restores unloaded search context",async()=>{
  const {page,cleanup}=await launch();
  try{
    await seed(page);
    await page.evaluate(async()=>{
      const {setState}=await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s:any)=>{const entry=s.instances.workspace.messages.general,base=entry.items[0];entry.items=Array.from({length:500},(_,index)=>({...base,id:`bounded-${String(index).padStart(5,"0")}`,content:`Linha ${index}\n${"Conteúdo de altura variável. ".repeat(index%6+1)}`}));});
    });
    await page.locator(".channel-name",{hasText:/^geral$/}).click();
    await expect.poll(()=>page.locator(".messages [data-message-id]").count()).toBeLessThan(100);
    await expect(page.locator('[data-message-id="bounded-00499"]')).toBeVisible();
    await page.locator(".messages").evaluate(el=>{el.scrollTop=0;});
    await expect(page.locator('[data-message-id="bounded-00000"]')).toBeVisible();
    await page.evaluate(async()=>{
      const {setState}=await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s:any)=>{s.messageFocus={accountId:"workspace",channelId:"general",messageId:"bounded-00250"};});
    });
    await expect(page.locator('[data-message-id="bounded-00250"]')).toBeVisible();
    await expect(page.getByRole("button",{name:/mais recentes/i})).toBeVisible();
  }finally{await cleanup();}
});

test("M4 profile drafts validate and retain edits after failed save, then publish normalized contacts explicitly",async()=>{
  const {page,cleanup}=await launch();
  let saved:any={user:{id:"me",username:"teste",displayName:"Pessoa de teste",avatarUrl:null},fields:[],hasPrivateFields:false,history:{enabled:false,visibility:"disabled",entries:[]}};
  let fail=true,writeCount=0;
  try{
    await seed(page);
    await page.route(`${origin}/api/users/me/profile`,route=>route.fulfill({json:saved}));
    await page.route(`${origin}/api/users/@me/profile`,async route=>{writeCount++;if(fail)return route.fulfill({status:500,json:{message:"Falha de gravação simulada"}});const body=route.request().postDataJSON();saved={...saved,fields:body.fields,history:{...saved.history,enabled:body.historyEnabled}};return route.fulfill({json:saved});});
    await page.evaluate(async()=>{const {setState}=await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);setState((s:any)=>{s.instances.workspace.instance={profileDetails:true};});});
    await page.getByRole("button",{name:"Configurações",exact:true}).click();
    const github=page.getByRole("textbox",{name:"GitHub",exact:true});await expect(github).toBeVisible();
    await expect(page.getByRole("combobox",{name:"Quem pode ver GitHub",exact:true})).toHaveText("Somente eu");
    await github.fill("https://evil.test/me");await page.getByRole("button",{name:"Salvar alterações",exact:true}).click();await expect(page.getByText("O link não pertence à plataforma escolhida.").first()).toBeVisible();expect(writeCount).toBe(0);
    await github.fill("octocat");await page.getByRole("textbox",{name:"E-mail de contato",exact:true}).fill("Contact@EXAMPLE.COM");
    await page.getByRole("combobox",{name:"Quem pode ver E-mail de contato",exact:true}).click();await page.getByRole("option",{name:"Amigos",exact:true}).click();
    await page.getByRole("button",{name:"Salvar alterações",exact:true}).click();await expect(page.getByText("Falha de gravação simulada")).toBeVisible();await expect(github).toHaveValue("https://github.com/octocat");expect(saved.fields).toEqual([]);
    fail=false;await page.getByRole("button",{name:"Salvar alterações",exact:true}).click();await expect(page.getByRole("button",{name:"Salvar alterações",exact:true})).toHaveCount(0);
    expect(saved.fields.find((field:any)=>field.kind==="email")).toMatchObject({value:"Contact@example.com",audience:"friends"});expect(saved.history.enabled).toBe(false);
    await page.locator(".settings-content").evaluate(el=>{el.scrollTop=0;});
    await page.screenshot({path:join(screenshots,"m4-profile-editor-dark.png")});
    await page.setViewportSize({width:940,height:620});
    await expect.poll(()=>page.locator(".profile-editor").evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await page.getByRole("checkbox",{name:"Guardar sessões de atividades nesta instância"}).scrollIntoViewIfNeeded();
    await page.screenshot({path:join(screenshots,"m4-profile-editor-minimum.png")});
  }finally{await cleanup();}
});

test("M4 full profile clears authorized details on revocation and returns keyboard focus",async()=>{
  const {page,cleanup}=await launch();let privateView=false;
  try{
    await seed(page);
    await page.route(`${origin}/api/users/me/profile`,route=>route.fulfill({json:{user:{id:"me",username:"teste",displayName:"Pessoa de teste",avatarUrl:null},fields:privateView?[]:[{kind:"github",value:"https://github.com/octocat",audience:"friends"}],hasPrivateFields:privateView,history:{enabled:true,visibility:privateView?"private":"visible",entries:[]}}}));
    await page.evaluate(async()=>{const {setState}=await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);setState((s:any)=>{s.instances.workspace.instance={profileDetails:true};});});
    await page.locator(".messages").evaluate(el=>{el.scrollTop=0;});
    await page.locator(".message-author").first().click();await page.getByRole("button",{name:"Ver perfil completo",exact:true}).click();
    const modal=page.locator(".full-profile");await expect(modal.getByRole("link",{name:/github.com/})).toBeVisible();
    await page.screenshot({path:join(screenshots,"m4-full-profile-dark.png")});
    await page.setViewportSize({width:940,height:620});
    await page.evaluate(async()=>{const {setState}=await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);setState((s:any)=>{s.settings.theme="light";});});
    await expect.poll(()=>modal.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await page.screenshot({path:join(screenshots,"m4-full-profile-light-minimum.png")});
    privateView=true;await page.evaluate(async()=>{const {setState}=await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);setState((s:any)=>{s.instances.workspace.profileRevision=1;});});
    await expect(modal.getByText("Os contatos deste perfil são privados para você.")).toBeVisible();await expect(modal.getByRole("link")).toHaveCount(0);
    await page.keyboard.press("Escape");await expect(modal).toHaveCount(0);await expect(page.getByRole("button",{name:"Ver perfil completo",exact:true})).toBeFocused();
  }finally{await cleanup();}
});

test("M3 opens at persisted unread, advances only visible reading and loads pinned context outside the cache",async()=>{
  const {page,cleanup}=await launch();const reads:string[]=[];
  const me={id:"me",username:"teste",displayName:"Pessoa de teste",avatarUrl:null};
  const messages=Array.from({length:1000},(_,index)=>({id:String(index+1).padStart(12,"0"),channelId:"general",author:me,content:`Histórico ${index+1}`,createdAt:new Date(Date.UTC(2026,9,30,0,index)).toISOString(),editedAt:null,replyToId:null,attachments:[],mentionIds:[],mentionsEveryone:false}));
  try{
    await seed(page);
    await page.route(`${origin}/api/channels/general/read-state`,async route=>{
      const id=route.request().method()==="PUT"?route.request().postDataJSON().messageId:"000000000500";
      if(route.request().method()==="PUT")reads.push(id);
      return route.fulfill({json:{channelId:"general",messageId:id,updatedAt:new Date().toISOString(),unread:{count:1000-Number(id),mention:true}}});
    });
    await page.route(`${origin}/api/channels/general/messages/window?*`,route=>{
      const query=new URL(route.request().url()).searchParams;let page=messages.slice(-50);
      if(query.has("after"))page=messages.filter(item=>item.id>query.get("after")!).slice(0,50);
      if(query.has("before"))page=messages.filter(item=>item.id<query.get("before")!).slice(-50);
      if(query.has("around")){const index=messages.findIndex(item=>item.id===query.get("around"));page=messages.slice(Math.max(0,index-24),index+26);}
      return route.fulfill({json:{items:page,hasMoreBefore:page[0]?.id!==messages[0]!.id,hasMoreAfter:page.at(-1)?.id!==messages.at(-1)!.id}});
    });
    await page.route(`${origin}/api/channels/general/pins?*`,route=>route.fulfill({json:{items:[{message:messages[99],pinnedBy:me,pinnedAt:new Date().toISOString()}],nextCursor:null}}));
    await page.evaluate(async()=>{const {setState}=await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);const {clearChatAnchor}=await import(/* @vite-ignore */ `${location.origin}/src/chat-state.ts`);clearChatAnchor("workspace","general");setState((s:any)=>{s.instances.workspace.instance={historyWindow:true,messagePins:true};delete s.instances.workspace.messages.general;s.view={kind:"home",accountId:"workspace",dmId:null};});});
    await expect(page.locator(".messages")).toHaveCount(0);
    await page.evaluate(async()=>{const {navigate}=await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);navigate({kind:"server",accountId:"workspace",serverId:"server",channelId:"general"});});
    await expect(page.locator('[data-message-id="000000000501"]')).toBeInViewport();await expect(page.locator(".unread-divider")).toBeVisible();expect(reads).toEqual([]);
    await page.locator(".messages").click({position:{x:200,y:80}});await expect.poll(()=>reads.length).toBeGreaterThan(0);expect(Number(reads.at(-1))).toBeLessThan(1000);await expect(page.locator(".unread-divider")).toBeVisible();
    await page.getByRole("button",{name:"Mensagens fixadas",exact:true}).click();await page.locator(".pinned-message").click();await expect(page.locator('[data-message-id="000000000100"]')).toBeInViewport();
    await page.screenshot({path:join(screenshots,"m3-pinned-context.png")});
  }finally{await cleanup();}
});

test("latest messages, personal colors, saved panels, voice and scoped reconnect", async () => {
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

    await page.getByRole("button", { name: "Configurações", exact: true }).click();
    await page.getByRole("button", { name: "Aparência", exact: true }).click();
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
    await expect(page.locator(".voice-status-bar")).toContainText("Voz conectada");
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
    await page.route(`${origin}/api/servers/server**`, (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(ready.state) }),
    );
    await page.getByRole("textbox", { name: "Conversar em #geral", exact: true }).fill("Rascunho durante a indisponibilidade");
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(page.getByRole("heading", { name: "Reconectando ao seu espaço" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Reconectando ao seu espaço" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Tentar agora", exact: true })).toBeFocused();
    await expect(page.locator(".connection-content textarea")).toHaveValue("Rascunho durante a indisponibilidade");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Reconectando ao seu espaço" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Configurações", exact: true }).click({ trial: true, timeout: 300 })).rejects.toThrow();
    await page.getByRole("button", { name: "Nova aba", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Reconectando ao seu espaço" })).toBeVisible();
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
    await page.getByRole("region", { name: "Reconectando ao seu espaço" }).getByRole("button", { name: "Tentar agora", exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator(".connection-dialog")).toHaveCount(0);
    await expect(page.locator(".chat-header h1")).toHaveText("geral");
    expect(errors).toEqual([]);
  } finally {
    await cleanup();
  }
});

test("connectivity isolates two live gateways, scopes retry and keeps navigation usable", async () => {
  const { app, page, cleanup } = await launch();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let available = true;
  let active: WebSocketRoute | undefined;
  let aConnections = 0, bConnections = 0;
  const sent: string[] = [];
  try {
    await seed(page);
    const fixture = await page.evaluate(async () => {
      const { getState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      const inst = getState().instances.workspace;
      return { user: inst.user, state: inst.serverStates.server, servers: inst.servers };
    });
    const healthyServer = { ...fixture.servers[0], name: "Comunidade saudável" };
    const ready = (servers = fixture.servers) => JSON.stringify({ t: "READY", d: {
      user: fixture.user, servers, dms: [], relationships: [], presences: { me: "online" },
      instance: { isAdmin: false, registration: "open", voiceBackend: "builtin" },
    } });
    await page.routeWebSocket("ws://workspace.test/gateway", (ws) => {
      active = ws;
      aConnections++;
      ws.onMessage((raw) => {
        const message = JSON.parse(String(raw));
        if (message.op === "identify" && available) ws.send(ready());
        if (message.op === "heartbeat") ws.send(JSON.stringify({ t: "HEARTBEAT_ACK", d: null }));
      });
    });
    await page.routeWebSocket("ws://healthy.test/gateway", (ws) => {
      bConnections++;
      ws.onMessage((raw) => {
        const message = JSON.parse(String(raw));
        if (message.op === "identify") ws.send(ready([healthyServer]));
        if (message.op === "heartbeat") ws.send(JSON.stringify({ t: "HEARTBEAT_ACK", d: null }));
      });
    });
    await page.route(`${origin}/api/servers/server**`, (route) => route.fulfill({ json: fixture.state }));
    await page.route("http://healthy.test/api/**", async (route) => {
      if (route.request().method() === "POST" && route.request().url().endsWith("/messages")) {
        expect(route.request().headers().authorization).toBe("Bearer healthy-token");
        sent.push(route.request().postDataJSON().content);
      }
      await route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/servers/server") ? { ...fixture.state, server: healthyServer } : [] });
    });
    await page.evaluate(async () => {
      const { addAccount, reconnect } = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
      reconnect("workspace");
      addAccount({ id: "healthy", url: "http://healthy.test", token: "healthy-token", userId: "me", instanceName: "Instância saudável" });
    });
    await expect.poll(() => bConnections).toBe(1);
    await expect.poll(() => page.evaluate(async () => {
      const { getState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      return [getState().instances.workspace.connection.authentication, getState().instances.healthy.connection.authentication];
    })).toEqual(["valid", "valid"]);
    await page.getByRole("button", { name: "Comunidade saudável · Instância saudável", exact: true }).click();
    const composer = page.getByRole("textbox", { name: "Conversar em #geral", exact: true });
    await composer.fill("B continua utilizável");
    available = false;
    active!.close({ code: 1011, reason: "Synthetic instance outage" });
    await expect.poll(() => page.evaluate(async () => {
      const { getState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      return getState().instances.workspace.connection.availability;
    })).toBe("unavailable");
    await page.waitForTimeout(2200); // Longer than the recovery grace period.
    await expect(page.locator(".connection-recovery")).toHaveCount(0);
    await page.getByRole("button", { name: "Enviar mensagem", exact: true }).click();
    await expect.poll(() => sent).toEqual(["B continua utilizável"]);
    await expect(composer).toHaveValue("");

    await page.getByRole("button", { name: "Comunidade de teste · Instância de teste", exact: true }).click();
    await expect(page.getByRole("region", { name: "Reconectando ao seu espaço" })).toBeVisible();
    await expect(page.locator(".connection-account")).toContainText("Instância de teste");
    await expect(page.locator(".connection-account")).not.toContainText("Instância saudável");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const beforeRetry = aConnections;
    await page.getByRole("region", { name: "Reconectando ao seu espaço" }).getByRole("button", { name: "Tentar agora", exact: true }).click();
    await expect.poll(() => aConnections).toBeGreaterThan(beforeRetry);
    expect(bConnections).toBe(1);
    await page.screenshot({ path: join(screenshots, "connectivity-scoped-dark.png") });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(940, 620));
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => { s.settings.theme = "light"; });
    });
    await page.screenshot({ path: join(screenshots, "connectivity-scoped-light-minimum.png") });
    await page.getByRole("button", { name: "Comunidade saudável · Instância saudável", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".connection-recovery")).toHaveCount(0);
    await expect(composer).toBeEditable();

    await page.getByRole("button", { name: "Nova aba", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Novidades do Annoy", exact: true }).click();
    await expect(page.locator(".connection-recovery")).toHaveCount(0);
    await page.evaluate(async () => {
      const { addService } = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
      addService({ id: "independent", kind: "website", name: "Serviço independente", url: "https://independent.test" });
    });
    await expect(page.locator(".connection-recovery")).toHaveCount(0);
    await expect.poll(() => page.evaluate(async () => {
      const { getState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      return getState().view.kind;
    })).toBe("service");
    expect(errors).toEqual([]);
  } finally {
    await cleanup();
  }
});

test("server directory groups known communities, searches, filters and opens with its owning account", async () => {
  const { page, cleanup } = await launch();
  try {
    await seed(page);
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => {
        s.instances.workspace.status = "ready";
        s.instances.workspace.connection = { availability: "available", authentication: "valid", cause: null, observedAt: Date.now(), attempt: 0, nextRetryAt: null, recoveryDeadline: null, restartUntil: null };
        s.instances.workspace.serversObservedAt = Date.now();
      });
    });
    await page.getByRole("button", { name: "Servidores", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Servidores", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Instância de teste", exact: true })).toBeVisible();
    await expect(page.getByText(/Disponibilidade confirmada/)).toBeVisible();
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => {
        s.instances.workspace.status = "offline";
        s.instances.workspace.connection.availability = "unavailable";
        s.instances.workspace.connection.cause = "network";
      });
    });
    await expect(page.getByText(/Última informação conhecida/)).toBeVisible();
    await expect(page.getByText(/Disponibilidade não confirmada/)).toBeVisible();
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => { s.instances.workspace.status = "ready"; s.instances.workspace.connection.availability = "available"; });
    });
    await expect(page.getByText(/Disponibilidade confirmada/)).toBeVisible();
    await page.getByRole("searchbox", { name: "Buscar servidor ou instância" }).fill("Comunidade de teste");
    await expect(page.locator(".server-directory-card")).toHaveCount(1);
    await page.getByRole("combobox", { name: "Filtrar por instância" }).click();
    await page.getByRole("option", { name: "Instância de teste" }).click();
    await page.locator(".server-directory-card").click();
    await expect(page.locator(".chat-header h1")).toHaveText("geral");
  } finally {
    await cleanup();
  }
});

test("new tab prioritizes Annoy communities and requires an explicit account for create or invite", async () => {
  const { page, cleanup } = await launch();
  try {
    await seed(page);
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => { s.accounts.push({ id: "second", url: "http://second.test", token: "synthetic", userId: "me", instanceName: "Segunda instância" }); });
    });
    await page.getByRole("button", { name: "Nova aba", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Nova aba" });
    await expect(dialog.getByRole("heading", { name: "Suas comunidades" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Comunidade de teste" })).toBeVisible();
    await dialog.getByRole("button", { name: "Criar comunidade" }).click();
    const create = page.getByRole("dialog", { name: "Criar uma comunidade" });
    const target = create.getByLabel("Escolha a instância de destino");
    await expect(target).toContainText("Escolha uma instância");
    await expect(create.getByRole("button", { name: "Criar comunidade", exact: true })).toBeDisabled();
    await target.click();
    await page.getByRole("option", { name: /Segunda instância/ }).click();
    await expect(create.getByRole("button", { name: "Criar comunidade", exact: true })).toBeDisabled();
    await create.getByLabel("Nome do servidor").fill("Alvo escolhido");
    await expect(create.getByRole("button", { name: "Criar comunidade", exact: true })).toBeEnabled();
    await create.getByRole("tab", { name: "Entrar com convite" }).click();
    await expect(page.getByRole("dialog", { name: "Entrar com convite" })).toBeVisible();
    await expect(page.getByLabel("Escolha a instância de destino")).toContainText("Segunda instância");
  } finally {
    await cleanup();
  }
});

test("file channel searches and orders the full server result with explicit paging", async () => {
  const { page, cleanup } = await launch();
  const queries: URL[] = [];
  try {
    await seed(page);
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => { s.instances.workspace.serverStates.server.channels.push({ id: "file-channel", serverId: "server", type: "files", name: "arquivos", topic: "", parentId: null, position: 1, overwrites: [] }); });
    });
    await page.route(`${origin}/api/channels/file-channel/files**`, (route) => {
      const url = new URL(route.request().url());
      queries.push(url);
      const all = url.searchParams.get("q") ? [{ id: "report", name: "Relatório final.pdf" }] : [{ id: "video", name: "video.mp4" }, { id: "report", name: "Relatório final.pdf" }];
      const offset = Number(url.searchParams.get("offset"));
      const selected = all.slice(offset, offset + Number(url.searchParams.get("limit")));
      return route.fulfill({ json: { files: selected.map((item) => ({ attachment: { id: item.id, filename: item.name, contentType: "application/pdf", url: `/uploads/${item.id}`, size: 20 }, message: { id: `message-${item.id}`, channelId: "file-channel", author: { id: "me", username: "teste", displayName: "Pessoa de teste", avatarUrl: null }, content: "Documento compartilhado", createdAt: new Date().toISOString(), editedAt: null, replyToId: null, attachments: [{ id: item.id, filename: item.name, contentType: "application/pdf", url: `/uploads/${item.id}`, size: 20 }], mentionIds: [], mentionsEveryone: false } })), nextOffset: offset + selected.length < all.length ? offset + selected.length : null, total: all.length } });
    });
    await page.locator(".channel-name", { hasText: /^arquivos$/ }).click();
    await expect(page.getByRole("heading", { name: "arquivos" })).toBeVisible();
    await expect(page.getByText("video.mp4", { exact: true })).toBeVisible();
    await page.getByLabel("Buscar arquivos").fill("relatório");
    await expect(page.getByText("Relatório final.pdf", { exact: true })).toBeVisible();
    await expect.poll(() => queries.at(-1)?.searchParams.get("q")).toBe("relatório");
    await page.getByLabel("Ordenar").click();
    await page.getByRole("option", { name: "Nome" }).click();
    await expect.poll(() => queries.at(-1)?.searchParams.get("sort")).toBe("name");
  } finally {
    await cleanup();
  }
});

test("offline gateway pauses its retry clock and resumes when the system returns online", async () => {
  const { page, cleanup } = await launch();
  try {
    await seed(page);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect.poll(() => page.evaluate(async () => {
      const { getState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      const connection = getState().instances.workspace.connection;
      return [getState().instances.workspace.status, connection.cause, connection.nextRetryAt];
    })).toEqual(["offline", "system-offline", null]);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => page.evaluate(async () => {
      const { getState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      return getState().connectivity.network.status;
    })).toBe("unknown");
  } finally {
    await cleanup();
  }
});

test("recovery deadline opens server list only if the user remains in the affected account view", async () => {
  const { page, cleanup } = await launch();
  try {
    await seed(page);
    await page.evaluate(async () => {
      const { navigate } = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
      navigate({ kind: "news" });
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => {
        const connection = s.instances.workspace.connection;
        s.instances.workspace.status = "offline";
        connection.availability = "unavailable";
        connection.cause = "network";
        connection.observedAt = Date.now();
        connection.attempt = 4;
        connection.nextRetryAt = Date.now() + 1000;
        connection.recoveryDeadline = Date.now() + 250;
      });
    });
    await page.waitForTimeout(400);
    expect(await page.evaluate(async () => {
      const { getState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      return getState().view.kind;
    })).toBe("news");
    await page.evaluate(async () => {
      const { navigate } = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`);
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      navigate({ kind: "server", accountId: "workspace", serverId: "server", channelId: "general" });
      setState((s: any) => { s.instances.workspace.connection.recoveryDeadline = Date.now() + 250; });
    });
    await expect.poll(() => page.evaluate(async () => {
      const { getState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      return getState().view.kind;
    })).toBe("servers");
    await expect(page.getByRole("heading", { name: "Servidores", exact: true })).toBeVisible();
    await page.evaluate(async () => {
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => {
        s.instances.workspace.status = "ready";
        s.instances.workspace.connection.availability = "available";
        s.instances.workspace.connection.authentication = "valid";
      });
    });
    await page.getByRole("button", { name: "Voltar a Comunidade de teste", exact: true }).click();
    await expect(page.locator(".chat-header h1")).toHaveText("geral");
  } finally {
    await cleanup();
  }
});

test("chat draft, in-session attachment and message anchor survive directory navigation", async () => {
  const { page, cleanup } = await launch();
  try {
    await seed(page);
    const messages = await page.evaluate(async () => {
      const { getState, setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => { s.instances.workspace.status = "ready"; });
      return getState().instances.workspace.messages.general.items;
    });
    await page.route(`${origin}/api/channels/general/messages?*`, (route) => {
      const url = new URL(route.request().url());
      const around = url.searchParams.get("around");
      if (!around) return route.fulfill({ json: messages.slice(-50) });
      const index = messages.findIndex((message: any) => message.id === around);
      return route.fulfill({ json: index < 0 ? [] : messages.slice(Math.max(0, index - 25), Math.min(messages.length, index + 25)) });
    });
    const composer = page.getByRole("textbox", { name: "Conversar em #geral", exact: true });
    await composer.fill("Rascunho que deve voltar");
    await page.locator("input[type=file]").setInputFiles({ name: "anexo-da-sessao.txt", mimeType: "text/plain", buffer: Buffer.from("conteúdo temporário") });
    await expect(page.getByText("anexo-da-sessao.txt", { exact: true })).toBeVisible();
    await page.locator(".messages").evaluate((element: HTMLElement) => { element.scrollTop = 720; element.dispatchEvent(new Event("scroll")); });
    const before = await page.locator(".messages").evaluate((element: HTMLElement) => {
      const viewport = element.getBoundingClientRect();
      const row = [...element.querySelectorAll<HTMLElement>("[data-message-id]")].find((item) => item.getBoundingClientRect().bottom > viewport.top)!;
      return { id: row.dataset.messageId, offset: row.getBoundingClientRect().top - viewport.top };
    });
    await page.getByRole("button", { name: "Servidores", exact: true }).click();
    await page.getByRole("button", { name: "Comunidade de teste · Instância de teste", exact: true }).click();
    await expect(composer).toHaveValue("Rascunho que deve voltar");
    await expect(page.getByText("anexo-da-sessao.txt", { exact: true })).toBeVisible();
    await expect.poll(async()=>{
      const after=await page.locator(`.messages [data-message-id="${before.id}"]`).evaluate((element:HTMLElement)=>element.getBoundingClientRect().top-element.closest(".messages")!.getBoundingClientRect().top);
      return Math.abs(after-before.offset);
    }).toBeLessThan(5);
  } finally {
    await cleanup();
  }
});

test("connectivity observes Global failures independently and preserves expired-session recovery", async () => {
  const { page, cleanup } = await launch();
  let gateway: WebSocketRoute | undefined;
  let connections = 0;
  try {
    await seed(page);
    const globalUrl = await page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/global.ts`)).GLOBAL_URL);
    let status = 503;
    await page.route(`${globalUrl}/v1/auth/prelogin`, (route) => status === 0 ? route.abort() : route.fulfill({ status, json: { message: "Falha sintética" } }));
    for (const [response, cause, availability, authentication] of [
      [503, "service", "unavailable", "unknown"], [401, "unauthorized", "available", "invalid"],
      [403, "forbidden", "available", "forbidden"], [0, "network", "unavailable", "forbidden"],
    ] as const) {
      status = response;
      const state = await page.evaluate(async () => {
        const { signInGlobal } = await import(/* @vite-ignore */ `${location.origin}/src/global.ts`);
        const { getState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
        await signInGlobal("synthetic@example.test", "synthetic").catch(() => undefined);
        return { connectivity: getState().connectivity, instance: getState().instances.workspace.status };
      });
      expect(state.connectivity.global).toMatchObject({ cause, availability, authentication });
      expect(state.connectivity.network.status).toBe("unknown");
      expect(state.instance).toBe("ready");
      await expect(page.locator(".connection-recovery")).toHaveCount(0);
      await expect(page.getByRole("textbox", { name: "Conversar em #geral", exact: true })).toBeEditable();
    }
    // A real successful login response clears previous auth/network observations.
    const login = await page.evaluate(async () => {
      const kdf = await import(/* @vite-ignore */ `${location.origin}/src/global-crypto.ts`);
      const salt = kdf.newSalt();
      const { wrapKey } = await kdf.derivePasswordKeys("synthetic", salt, 1);
      return { salt, wrappedKeys: await kdf.wrapKeys(wrapKey, kdf.newAccountKeys()) };
    });
    await page.route(`${globalUrl}/v1/auth/prelogin`, (route) => route.fulfill({ json: { salt: login.salt, iterations: 1 } }));
    await page.route(`${globalUrl}/v1/auth/login`, (route) => route.fulfill({ json: {
      token: "synthetic-global-session", wrappedKeys: login.wrappedKeys,
      user: { id: "global-test", name: "Conta sintética", email: "synthetic@example.test" },
    } }));
    await page.route(`${globalUrl}/v1/vault`, (route) => route.fulfill({ json: { version: 0, data: null } }));
    await page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/global.ts`)).signInGlobal("synthetic@example.test", "synthetic"));
    await expect.poll(() => page.evaluate(async () => {
      const { getState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      return getState().connectivity.global;
    })).toMatchObject({ availability: "available", authentication: "valid", cause: null });
    await expect(page.locator(".connection-recovery")).toHaveCount(0);
    await page.routeWebSocket("ws://workspace.test/gateway", (ws) => { gateway = ws; connections++; });
    await page.evaluate(async () => (await import(/* @vite-ignore */ `${location.origin}/src/client.ts`)).reconnect("workspace"));
    await expect.poll(() => connections).toBe(1);
    gateway!.close({ code: 4004, reason: "Synthetic expired session" });
    await expect(page.getByRole("region", { name: "Sessão expirada" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Tentar agora", exact: true })).toHaveCount(0);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("online"));
    });
    await expect(page.getByRole("region", { name: "Sessão expirada" })).toBeVisible();
    expect(connections).toBe(1);
    await page.getByRole("button", { name: "Entrar novamente", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("region", { name: "Sessão expirada" })).toBeVisible();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("distopic.accounts")!));
    expect(saved[0]).not.toHaveProperty("connection");
    expect(saved[0]).not.toHaveProperty("connectivity");
    await page.getByRole("button", { name: "Novidades do Annoy", exact: true }).click();
    await expect(page.locator(".connection-recovery")).toHaveCount(0);
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
    description: "Bot sintético para testar o contrato das integrações. Não é um bot publicado.",
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
    await expect(page.getByRole("button", { name: "Integrações", exact: true })).toHaveCount(0);
    await page.evaluate(async () => { const { navigate } = await import(/* @vite-ignore */ `${location.origin}/src/client.ts`); navigate({ kind: "marketplace", accountId: "workspace", serverId: "server" }); });
    await expect(page.getByRole("heading", { name: "As integrações precisam do suporte da sua instância" })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: "Sua primeira integração começa aqui" })).toBeVisible();
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
