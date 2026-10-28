import type { DmChannel, GatewayEvent, ImportJob, Message, ServerState, ServerSummary, User } from "@distopic/protocol";
import { Api } from "./api.ts";
import { Gateway } from "./gateway.ts";
import { emptyInstance, getState, setState, toast, type Account, type InstanceState, type View } from "./store.ts";
import { VoiceSession } from "./voice.ts";

const PAGE = 50;
const TYPING_MS = 8000;

interface Live {
  api: Api;
  gateway: Gateway;
}

const live = new Map<string, Live>();
let voice: { accountId: string; session: VoiceSession } | null = null;
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function apiFor(accountId: string): Api {
  const entry = live.get(accountId);
  if (!entry) throw new Error("Conta desconectada");
  return entry.api;
}

export function gatewayFor(accountId: string): Gateway | undefined {
  return live.get(accountId)?.gateway;
}

function patchInstance(accountId: string, recipe: (inst: InstanceState) => void): void {
  setState((s) => {
    const inst = s.instances[accountId];
    if (inst) recipe(inst as InstanceState);
  });
}

// Accounts -------------------------------------------------------------------

export function connectAccount(account: Account): void {
  if (live.has(account.id)) return;
  const api = new Api(account.url, account.token);
  const gateway = new Gateway(
    account.url,
    account.token,
    (event) => onEvent(account.id, event),
    (status) =>
      patchInstance(account.id, (inst) => {
        inst.status = status;
      }),
  );
  live.set(account.id, { api, gateway });
  setState((s) => {
    s.instances[account.id] ??= emptyInstance();
  });
  gateway.connect();
}

export function addAccount(account: Account): void {
  setState((s) => {
    s.accounts = s.accounts.filter((a) => a.id !== account.id);
    s.accounts.push(account);
    s.modal = null;
    s.view = { kind: "home", accountId: account.id, dmId: null };
  });
  live.get(account.id)?.gateway.close();
  live.delete(account.id);
  connectAccount(account);
}

export function removeAccount(accountId: string): void {
  if (voice?.accountId === accountId) leaveVoice();
  const entry = live.get(accountId);
  entry?.gateway.close();
  void entry?.api.post("/auth/logout").catch(() => undefined);
  live.delete(accountId);
  setState((s) => {
    s.accounts = s.accounts.filter((a) => a.id !== accountId);
    delete s.instances[accountId];
    if ("accountId" in s.view && s.view.accountId === accountId) s.view = { kind: "home", accountId: null, dmId: null };
  });
}

export function connectAll(): void {
  for (const account of getState().accounts) connectAccount(account);
}

// Navigation -----------------------------------------------------------------

export function navigate(view: View): void {
  const bridge = window.distopic;
  if (view.kind === "discord") bridge?.showDiscord();
  else if (getState().view.kind === "discord") bridge?.hideDiscord();
  setState((s) => {
    s.view = view;
    const channelId = view.kind === "server" ? view.channelId : view.kind === "home" ? view.dmId : null;
    if (channelId && "accountId" in view && view.accountId) delete s.instances[view.accountId]?.unread[channelId];
  });
  if (view.kind === "server") void ensureServer(view.accountId, view.serverId);
}

/** Opens a server at its last-viewed (or first readable) text channel. */
export async function openServer(accountId: string, serverId: string): Promise<void> {
  navigate({ kind: "server", accountId, serverId, channelId: null });
  const state = await ensureServer(accountId, serverId);
  const current = getState().view;
  if (!state || current.kind !== "server" || current.serverId !== serverId || current.channelId) return;
  const remembered = localStorage.getItem(`distopic.lastChannel.${serverId}`);
  const text = state.channels.filter((c) => c.type === "text");
  const target = text.find((c) => c.id === remembered) ?? text[0];
  if (target) navigate({ kind: "server", accountId, serverId, channelId: target.id });
}

export function openChannel(accountId: string, serverId: string, channelId: string): void {
  localStorage.setItem(`distopic.lastChannel.${serverId}`, channelId);
  navigate({ kind: "server", accountId, serverId, channelId });
}

export async function openDm(accountId: string, userId: string): Promise<void> {
  try {
    const dm = await apiFor(accountId).post<DmChannel>("/dms", { userId });
    patchInstance(accountId, (inst) => {
      if (!inst.dms.some((d) => d.id === dm.id)) inst.dms.unshift(dm);
    });
    navigate({ kind: "home", accountId, dmId: dm.id });
  } catch (err) {
    toast((err as Error).message);
  }
}

// Server state -----------------------------------------------------------------

export async function ensureServer(accountId: string, serverId: string, force = false): Promise<ServerState | undefined> {
  const existing = getState().instances[accountId]?.serverStates[serverId];
  if (existing && !force) return existing;
  try {
    const fresh = await apiFor(accountId).get<ServerState>(`/servers/${serverId}`);
    patchInstance(accountId, (inst) => {
      inst.serverStates[serverId] = fresh;
      // The summary in the rail comes from READY; keep it in sync with renames.
      const idx = inst.servers.findIndex((sv) => sv.id === serverId);
      if (idx >= 0) inst.servers[idx] = fresh.server;
      for (const m of fresh.members) inst.presences[m.user.id] = m.presence;
    });
    return fresh;
  } catch (err) {
    toast((err as Error).message);
    return undefined;
  }
}

function scheduleRefresh(accountId: string, serverId: string): void {
  if (!getState().instances[accountId]?.serverStates[serverId]) return;
  const key = `${accountId}:${serverId}`;
  clearTimeout(refreshTimers.get(key));
  refreshTimers.set(
    key,
    setTimeout(() => {
      refreshTimers.delete(key);
      void ensureServer(accountId, serverId, true).then((state) => {
        // Leave a channel that just became invisible.
        const view = getState().view;
        if (state && view.kind === "server" && view.serverId === serverId && view.channelId && !state.channels.some((c) => c.id === view.channelId)) {
          navigate({ kind: "server", accountId, serverId, channelId: null });
        }
      });
    }, 150),
  );
}

// Messages -----------------------------------------------------------------

export async function loadMessages(accountId: string, channelId: string, older = false): Promise<void> {
  const inst = getState().instances[accountId];
  const current = inst?.messages[channelId];
  if (current?.loading || (older && !current?.hasMore) || (!older && current)) return;
  patchInstance(accountId, (i) => {
    i.messages[channelId] = { items: current?.items ?? [], hasMore: current?.hasMore ?? true, loading: true };
  });
  const before = older ? current?.items[0]?.id : undefined;
  try {
    const page = await apiFor(accountId).get<Message[]>(`/channels/${channelId}/messages?limit=${PAGE}${before ? `&before=${before}` : ""}`);
    patchInstance(accountId, (i) => {
      const prev = i.messages[channelId]?.items ?? [];
      const known = new Set(prev.map((m) => m.id));
      i.messages[channelId] = { items: [...page.filter((m) => !known.has(m.id)), ...prev], hasMore: page.length === PAGE, loading: false };
    });
  } catch (err) {
    patchInstance(accountId, (i) => {
      const entry = i.messages[channelId];
      if (entry) entry.loading = false;
    });
    toast((err as Error).message);
  }
}

function invalidateServerMessages(accountId: string, serverId: string): void {
  const channelIds = getState().instances[accountId]?.serverStates[serverId]?.channels.map((c) => c.id) ?? [];
  patchInstance(accountId, (inst) => {
    for (const id of channelIds) delete inst.messages[id];
  });
  const view = getState().view;
  if (view.kind === "server" && view.accountId === accountId && view.channelId && channelIds.includes(view.channelId)) {
    void loadMessages(accountId, view.channelId);
  }
}

let lastTypingSent = 0;
export function sendTyping(accountId: string, channelId: string): void {
  if (Date.now() - lastTypingSent < 5000) return;
  lastTypingSent = Date.now();
  gatewayFor(accountId)?.send({ op: "typing", channelId });
}

// Voice --------------------------------------------------------------------

export async function joinVoice(accountId: string, serverId: string, channelId: string): Promise<void> {
  if (voice?.accountId === accountId && voice.session.channelId === channelId) return;
  leaveVoice();
  const gateway = gatewayFor(accountId);
  if (!gateway) return;
  const session = new VoiceSession(gateway, channelId, getState().settings);
  voice = { accountId, session };
  setState((s) => {
    s.voice = { accountId, serverId, channelId, status: "connecting" };
  });
  try {
    await session.start();
    if (voice?.session !== session) return;
    setState((s) => {
      if (s.voice) s.voice.status = "connected";
    });
    if (!session.canSpeak) toast("Você está conectado sem permissão para falar");
  } catch (err) {
    if (voice?.session === session) leaveVoice();
    toast(`Voz: ${(err as Error).message}`);
  }
}

export function leaveVoice(notifyServer = true): void {
  voice?.session.close(notifyServer);
  voice = null;
  setState((s) => {
    s.voice = null;
  });
}

export function updateVoiceSettings(): void {
  const settings = getState().settings;
  voice?.session.updateSettings(settings);
  if (voice) gatewayFor(voice.accountId)?.send({ op: "voice_state", selfMute: settings.selfMute, selfDeaf: settings.selfDeaf });
}

export function setPushToTalk(down: boolean): void {
  voice?.session.setPushToTalk(down);
}

// Gateway events -------------------------------------------------------------

function notify(accountId: string, message: Message, isDm: boolean): void {
  const s = getState();
  if (!s.settings.notifications) return;
  const inst = s.instances[accountId];
  const me = inst?.user?.id;
  if (!me || message.author.id === me) return;
  const mentioned = message.mentionsEveryone || message.mentionIds.includes(me);
  if (!isDm && !mentioned) return;
  window.distopic?.flashWindow();
  if (!document.hasFocus() || s.view.kind === "discord") {
    const n = new Notification(message.author.displayName, { body: message.content || "Enviou um anexo", silent: false });
    n.onclick = () => window.focus();
  }
}

function replaceUser(inst: InstanceState, user: User): void {
  if (inst.user?.id === user.id) inst.user = user;
  for (const st of Object.values(inst.serverStates)) for (const m of st.members) if (m.user.id === user.id) m.user = user;
  for (const dm of inst.dms) dm.recipients = dm.recipients.map((r) => (r.id === user.id ? user : r));
  for (const r of inst.relationships) if (r.user.id === user.id) r.user = user;
}

function onEvent(accountId: string, event: GatewayEvent): void {
  if (voice?.accountId === accountId) voice.session.handleEvent(event);

  switch (event.t) {
    case "READY": {
      patchInstance(accountId, (inst) => {
        inst.user = event.d.user;
        inst.servers = event.d.servers;
        inst.dms = event.d.dms;
        inst.relationships = event.d.relationships;
        inst.presences = event.d.presences;
        // History may have gaps after a reconnect; reload lazily.
        inst.messages = {};
        inst.serverStates = {};
      });
      if (voice?.accountId === accountId) leaveVoice(false);
      // Instances are small (TeamSpeak scale): load every server so unread
      // badges and voice rosters work without opening each one.
      for (const server of event.d.servers) void ensureServer(accountId, server.id);
      // Imports keep running server-side across reconnects; resync their progress.
      void apiFor(accountId)
        .get<ImportJob[]>("/import/jobs")
        .then((jobs) =>
          patchInstance(accountId, (inst) => {
            for (const job of jobs) inst.imports[job.id] = job;
          }),
        )
        .catch(() => undefined);
      return;
    }
    case "SERVER_CREATE":
    case "SERVER_UPDATE":
      patchInstance(accountId, (inst) => {
        const idx = inst.servers.findIndex((s) => s.id === event.d.id);
        if (idx >= 0) inst.servers[idx] = event.d;
        else inst.servers.push(event.d as ServerSummary);
      });
      void ensureServer(accountId, event.d.id, true);
      return;
    case "SERVER_REMOVE": {
      const { serverId } = event.d;
      const s = getState();
      if (s.voice?.accountId === accountId && s.voice.serverId === serverId) leaveVoice(false);
      patchInstance(accountId, (inst) => {
        inst.servers = inst.servers.filter((sv) => sv.id !== serverId);
        delete inst.serverStates[serverId];
      });
      if (s.view.kind === "server" && s.view.accountId === accountId && s.view.serverId === serverId) {
        navigate({ kind: "home", accountId, dmId: null });
        toast("Você não faz mais parte deste servidor");
      }
      return;
    }
    case "SERVER_REFRESH":
      return scheduleRefresh(accountId, event.d.serverId);
    case "MESSAGE_CREATE": {
      const msg = event.d;
      const s = getState();
      const inst = s.instances[accountId];
      if (!inst) return;
      const viewing =
        (s.view.kind === "server" && s.view.accountId === accountId && s.view.channelId === msg.channelId) ||
        (s.view.kind === "home" && s.view.accountId === accountId && s.view.dmId === msg.channelId);
      const isDm = inst.dms.some((d) => d.id === msg.channelId);
      const me = inst.user?.id;
      patchInstance(accountId, (i) => {
        const list = i.messages[msg.channelId];
        if (list && !list.items.some((m) => m.id === msg.id)) list.items.push(msg);
        const typing = i.typing[msg.channelId];
        if (typing) delete typing[msg.author.id];
        const dm = i.dms.find((d) => d.id === msg.channelId);
        if (dm) {
          dm.lastMessageId = msg.id;
          i.dms.sort((a, b) => (b.lastMessageId ?? "").localeCompare(a.lastMessageId ?? ""));
        }
        if ((!viewing || !document.hasFocus()) && msg.author.id !== me) {
          const u = (i.unread[msg.channelId] ??= { count: 0, mention: false });
          u.count++;
          if (isDm || msg.mentionsEveryone || (me && msg.mentionIds.includes(me))) u.mention = true;
        }
      });
      notify(accountId, msg, isDm);
      return;
    }
    case "MESSAGE_UPDATE":
      return patchInstance(accountId, (inst) => {
        const list = inst.messages[event.d.channelId];
        const idx = list?.items.findIndex((m) => m.id === event.d.id) ?? -1;
        if (list && idx >= 0) list.items[idx] = event.d;
      });
    case "MESSAGE_DELETE":
      return patchInstance(accountId, (inst) => {
        const list = inst.messages[event.d.channelId];
        if (list) list.items = list.items.filter((m) => m.id !== event.d.messageId);
      });
    case "TYPING_START":
      return patchInstance(accountId, (inst) => {
        (inst.typing[event.d.channelId] ??= {})[event.d.userId] = Date.now() + TYPING_MS;
      });
    case "PRESENCE_UPDATE":
      return patchInstance(accountId, (inst) => {
        inst.presences[event.d.userId] = event.d.presence;
        for (const st of Object.values(inst.serverStates)) {
          const m = st.members.find((x) => x.user.id === event.d.userId);
          if (m) m.presence = event.d.presence;
        }
      });
    case "USER_UPDATE":
      return patchInstance(accountId, (inst) => replaceUser(inst, event.d));
    case "VOICE_STATE_UPDATE":
      return patchInstance(accountId, (inst) => {
        const st = inst.serverStates[event.d.serverId];
        if (!st) return;
        st.voiceStates = st.voiceStates.filter((v) => v.userId !== event.d.userId);
        if (event.d.state) st.voiceStates.push(event.d.state);
      });
    case "VOICE_KICKED":
      leaveVoice(false);
      toast(event.d.reason);
      return;
    case "DM_CREATE":
      return patchInstance(accountId, (inst) => {
        if (!inst.dms.some((d) => d.id === event.d.id)) inst.dms.unshift(event.d);
      });
    case "RELATIONSHIP_UPDATE":
      return patchInstance(accountId, (inst) => {
        inst.relationships = [...inst.relationships.filter((r) => r.user.id !== event.d.user.id), event.d];
      });
    case "RELATIONSHIP_REMOVE":
      return patchInstance(accountId, (inst) => {
        inst.relationships = inst.relationships.filter((r) => r.user.id !== event.d.userId);
      });
    case "IMPORT_PROGRESS": {
      const prev = getState().instances[accountId]?.imports[event.d.id];
      patchInstance(accountId, (inst) => {
        inst.imports[event.d.id] = event.d;
      });
      // History lands in channels the client may already have cached as empty.
      const advanced = !prev || prev.channelsDone !== event.d.channelsDone || prev.phase !== event.d.phase;
      if (event.d.serverId && advanced) invalidateServerMessages(accountId, event.d.serverId);
      return;
    }
    case "INVALID_SESSION":
      toast(`Sessão expirada em ${getState().accounts.find((a) => a.id === accountId)?.instanceName ?? "servidor"}; entre novamente`);
      return;
    case "HEARTBEAT_ACK":
    case "VOICE_NEW_PRODUCER":
    case "VOICE_PRODUCER_CLOSED":
    case "VOICE_REPLY":
      return;
  }
}
