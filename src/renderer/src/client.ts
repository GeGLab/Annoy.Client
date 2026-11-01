import type { DmChannel, GatewayEvent, ImportJob, Message, ServerState, ServerSummary, User } from "@distopic/protocol";
import { emitRoomEvent } from "./features/channels/events.ts";
import { Api, fetchInfo } from "./api.ts";
import { previewText } from "./format.tsx";
import { Gateway } from "./gateway.ts";
import { displayNameOf } from "./perms.ts";
import { emptyInstance, getState, setState, subscribe, toast, type Account, type InstanceState, type View } from "./store.ts";
import type { Service } from "../../shared/services.ts";
import { VoiceSession } from "./voice.ts";
import { CloudflareVoiceSession } from "./voice-cloudflare.ts";
import { callEncryptionSupported } from "./media-e2ee/call-encryption.ts";
import { playStreamFeedback, playCallFeedback, playVoiceFeedback, playMessageFeedback } from "./lib/voice-feedback.ts";
import { isMessageMuted, notificationKey } from "./lib/notification-preferences.ts";
import { screenProfile } from "./lib/screen-profile.ts";
import { handleDirectCallEvent, handleDirectCallMedia, updateDirectCallMute, disconnectDirectCall, callAction } from "./features/direct-calls.ts";
import { canRemoveServer, connectionOfflineSince } from "../../shared/server-removal.ts";
import { normalizeUserVolume, userVolumeKey } from "../../shared/user-volume.ts";

const PAGE = 50;
const TYPING_MS = 8000;

interface Live {
  api: Api;
  gateway: Gateway;
}

const live = new Map<string, Live>();
type AnyVoiceSession = VoiceSession | CloudflareVoiceSession;
let voice: { accountId: string; serverId: string; session: AnyVoiceSession } | null = null;
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function apiFor(accountId: string): Api {
  const entry = live.get(accountId);
  if (!entry) throw new Error("Conta desconectada");
  return entry.api;
}

export function applyUserUpdate(accountId: string, user: User): void {
  patchInstance(accountId, inst => replaceUser(inst, user));
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

// Last-known servers and profile per account, so tabs survive restarts and outages.
const cacheKey = (accountId: string) => `distopic.cache.${accountId}`;

function readCache(accountId: string): Pick<InstanceState, "servers" | "user"> | null {
  try {
    const raw = localStorage.getItem(cacheKey(accountId));
    return raw ? (JSON.parse(raw) as Pick<InstanceState, "servers" | "user">) : null;
  } catch {
    return null;
  }
}

function writeCache(accountId: string): void {
  const inst = getState().instances[accountId];
  if (!inst || inst.status !== "ready") return;
  try {
    localStorage.setItem(cacheKey(accountId), JSON.stringify({ servers: inst.servers, user: inst.user }));
  } catch {
    // Storage full or unavailable: the cache is a convenience only.
  }
}

export function reconnect(accountId?: string): void {
  for (const [id, entry] of live) if (!accountId || id === accountId) entry.gateway.reconnectNow();
  // Servers of the Annoy account not signed in yet retry the Annoy sign-in instead.
  if (getState().accounts.some((a) => a.pending && (!accountId || a.id === accountId))) void import("./global.ts").then((g) => g.syncVault());
}

window.addEventListener("online", () => reconnect());
window.addEventListener("offline", () => { for (const entry of live.values()) entry.gateway.networkLost(); });

// Keep the cache in step with the server list, whatever changed it.
const lastServers = new Map<string, unknown>();
subscribe(() => {
  for (const [id, inst] of Object.entries(getState().instances)) {
    if (inst.status === "ready" && lastServers.get(id) !== inst.servers) {
      lastServers.set(id, inst.servers);
      writeCache(id);
    }
  }
});

export function connectAccount(account: Account): void {
  if (live.has(account.id)) return;
  if (account.pending) {
    // Listed and shown as disconnected (red dot) until the Annoy sign-in succeeds there.
    setState((s) => { s.instances[account.id] = { ...(s.instances[account.id] ?? emptyInstance()), status: account.pending! }; });
    return;
  }
  const api = new Api(account.url, account.token, () => getState().instances[account.id]?.status === "ready",account.userId);
  const gateway = new Gateway(
    account.url,
    account.token,
    (event) => onEvent(account.id, event),
    (status) => {
      if (status !== "ready") {
        void window.distopic?.auth.logoutLocal(account.id,status === "invalid");
        if (!window.distopic) setState(s => {
          s.access.localAccounts = s.access.localAccounts.filter(id => id !== account.id);
          s.access.allowed = s.access.global || s.access.localAccounts.length > 0;
        });
        disconnectDirectCall(account.id);
        if (voice?.accountId === account.id || getState().voice?.accountId === account.id) leaveVoice(false);
      }
      setState((s) => {
        const inst = s.instances[account.id];
        if (inst) {
          inst.status = status;
          if (status !== "ready") {
            const view = s.view;
            if (view.kind === "server" && view.accountId === account.id && view.channelId &&
                inst.serverStates[view.serverId]?.channels.some((channel) => channel.id === view.channelId && channel.type === "theater")) {
              view.channelId = null;
            }
            inst.presences = {};
            inst.activities = {};
            inst.typing = {};
            for (const server of Object.values(inst.serverStates)) {
              server.voiceStates = [];
              for (const member of server.members) member.presence = "offline";
            }
          }
        }
        if (status !== "ready" && s.modal && "accountId" in s.modal && s.modal.accountId === account.id) s.modal = null;
        const saved = s.accounts.find((a) => a.id === account.id);
        if (saved) saved.offlineSince = connectionOfflineSince(saved.offlineSince, status, Date.now(), navigator.onLine);
      });
    },
    () => {
      setState((s) => {
        const saved = s.accounts.find((a) => a.id === account.id);
        if (saved) delete saved.offlineSince;
      });
    },
  );
  live.set(account.id, { api, gateway });
  setState((s) => {
    if (!s.instances[account.id]) {
      const cached = readCache(account.id);
      s.instances[account.id] = { ...emptyInstance(), ...(cached && { servers: cached.servers, user: cached.user }) };
    }
  });
  gateway.connect();
}

export function addAccount(account: Account): void {
  setState((s) => {
    // A real sign-in replaces the disconnected placeholder of the same server.
    for (const stale of s.accounts.filter((a) => a.pending && a.url === account.url)) delete s.instances[stale.id];
    s.accounts = s.accounts.filter((a) => a.id !== account.id && !(a.pending && a.url === account.url));
    s.accounts.push(account);
    s.modal = null;
    s.view = { kind: "home", accountId: account.id, dmId: null };
  });
  live.get(account.id)?.gateway.close();
  live.delete(account.id);
  connectAccount(account);
}

/** Adds a server account in the background (servers coming back from the global vault).
 * A real sign-in replaces the disconnected placeholder of the same server. */
export function addAccountQuietly(account: Account): void {
  const placeholder = getState().accounts.find((a) => a.url === account.url && a.pending);
  if (getState().accounts.some((a) => a.url === account.url && !a.pending)) return;
  if (placeholder && account.pending) {
    if (placeholder.pending !== account.pending) setState((s) => {
      const saved = s.accounts.find((a) => a.id === placeholder.id);
      if (saved) saved.pending = account.pending;
      if (s.instances[placeholder.id]) s.instances[placeholder.id]!.status = account.pending!;
    });
    return;
  }
  setState((s) => {
    if (placeholder) { s.accounts = s.accounts.filter((a) => a.id !== placeholder.id); delete s.instances[placeholder.id]; }
    s.accounts.push(account);
  });
  connectAccount(account);
}

/** Signs out of one account: it stays among the saved accounts and in the Annoy account's server list. */
export function signOutAccount(accountId: string): void {
  removeAccount(accountId, true, true);
}

export function removeAccount(accountId: string, forget = true, keepInVault = false): void {
  void window.distopic?.auth.logoutLocal(accountId);
  if (!window.distopic) setState(s => { s.access.localAccounts = s.access.localAccounts.filter(id => id !== accountId); s.access.allowed = s.access.global || s.access.localAccounts.length > 0; });
  const account = getState().accounts.find((item) => item.id === accountId);
  const user = getState().instances[accountId]?.user;
  disconnectDirectCall(accountId);
  if (forget && account && user) setState((s) => {
    const { token: _token, ...remembered } = account;
    s.rememberedAccounts = [...s.rememberedAccounts.filter((item) => item.id !== accountId), { ...remembered, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl }];
  });
  // Leaving on purpose: the global vault forgets it too, so it doesn't come back.
  if (forget && !keepInVault && account && getState().global) void import("./global.ts").then((g) => g.forgetServer(account.url));
  if (voice?.accountId === accountId) leaveVoice();
  const entry = live.get(accountId);
  entry?.gateway.close();
  void entry?.api.post("/auth/logout").catch(() => undefined);
  live.delete(accountId);
  setState((s) => {
    s.accounts = s.accounts.filter((a) => a.id !== accountId);
    delete s.instances[accountId];
    // Removing the account in use moves to the next one, never to an empty identity.
    if ("accountId" in s.view && s.view.accountId === accountId) s.view = { kind: "home", accountId: s.accounts[0]?.id ?? null, dmId: null };
  });
}

/** Removing a saved connection affects every tab on it, so check every owned community. */
export function canRemoveServerConnection(accountId: string): boolean {
  const s = getState(), account = s.accounts.find((a) => a.id === accountId), inst = s.instances[accountId];
  if (!account || !inst) return false;
  return inst.servers.every((server) => canRemoveServer({
    ownerId: server.ownerId, userId: account.userId, status: inst.status,
    memberIds: inst.serverStates[server.id]?.members.map((m) => m.user.id), offlineSince: account.offlineSince,
  }));
}

export function removeServerConnection(accountId: string): void {
  if (!canRemoveServerConnection(accountId)) {
    toast("Transfira a propriedade ou esteja sozinho para remover. Se o servidor estiver offline, aguarde 7 dias.");
    return;
  }
  removeAccount(accountId);
}

export function connectAll(): void {
  for (const account of getState().accounts) if(account.token)connectAccount(account);
}

// Navigation -----------------------------------------------------------------

/** Clear only this community's counters; unrelated servers and DMs keep their unread state. */
export function markServerRead(accountId: string, serverId: string): void {
  setState((s) => {
    const instance = s.instances[accountId];
    if (!instance) return;
    for (const channel of instance.serverStates[serverId]?.channels ?? []) delete instance.unread[channel.id];
  });
}

export function navigate(view: View): void {
  showServiceView(view);
  setState((s) => {
    s.view = view;
    if(s.messageFocus) { delete s.instances[s.messageFocus.accountId]?.messages[s.messageFocus.channelId]; s.messageFocus=null; }
    if (view.kind === "server" || (view.kind === "home" && view.dmId)) s.chatNavigation++;
    const channelId = view.kind === "server" ? view.channelId : view.kind === "home" ? view.dmId : null;
    if (channelId && "accountId" in view && view.accountId) delete s.instances[view.accountId]?.unread[channelId];
  });
  if (view.kind === "server") void ensureServer(view.accountId, view.serverId);
}

/** Shows the native view of a browser service, or hides it for anything else. */
export function showServiceView(view: View): void {
  if (!getState().access.allowed) { window.distopic?.services.hide(); return; }
  const service = view.kind === "service" ? getState().services.find((sv) => sv.id === view.serviceId) : undefined;
  if (service && service.kind !== "teamspeak") window.distopic?.services.show(service);
  else window.distopic?.services.hide();
}

export function addService(service: Service): void {
  setState((s) => {
    s.services.push(service);
    s.modal = null;
  });
  navigate({ kind: "service", serviceId: service.id });
}

export async function removeService(id: string): Promise<void> {
  const next = getState().services.find((sv) => sv.id !== id);
  const view = getState().view;
  if (view.kind === "service" && view.serviceId === id) navigate(next ? { kind: "service", serviceId: next.id } : { kind: "home", accountId: getState().accounts[0]?.id ?? null, dmId: null });
  setState((s) => {
    s.services = s.services.filter((sv) => sv.id !== id);
    delete s.serviceBadges[id];
    s.modal = null;
  });
  await window.distopic?.services.remove(id);
}

/** Hides a tab from the bar without removing it (or its login). */
export function setServiceHidden(id: string, hidden: boolean): void {
  const view = getState().view;
  if (hidden && view.kind === "service" && view.serviceId === id) navigate({ kind: "home", accountId: getState().accounts[0]?.id ?? null, dmId: null });
  updateService(id, (sv) => void (sv.hidden = hidden || undefined));
}

export function updateService(id: string, recipe: (service: Service) => void): void {
  setState((s) => {
    const service = s.services.find((sv) => sv.id === id);
    if (service) recipe(service as Service);
  });
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
  const existing = getState().instances[accountId]?.dms.find((dm) => dm.recipients.some((user) => user.id === userId));
  if (existing) return navigate({ kind: "home", accountId, dmId: existing.id });
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
  if (inst?.status !== "ready") return;
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

export async function jumpToMessage(accountId:string,channelId:string,messageId:string,serverId:string|null) {
  const items=await apiFor(accountId).get<Message[]>(`/channels/${encodeURIComponent(channelId)}/messages?around=${encodeURIComponent(messageId)}`);
  navigate(serverId?{kind:"server",accountId,serverId,channelId}:{kind:"home",accountId,dmId:channelId});
  setState(s=>{s.instances[accountId]!.messages[channelId]={items,hasMore:items.length>=26,loading:false};s.messageFocus={accountId,channelId,messageId};s.modal=null;});
}
export function returnToLatest(accountId:string,channelId:string) {
  setState(s=>{delete s.instances[accountId]?.messages[channelId];s.messageFocus=null;s.chatNavigation++;});
  void loadMessages(accountId,channelId);
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

/** Server replies meaning this call cannot be end-to-end encrypted with this client. */
const NO_CALL_E2EE = /apenas a criptografia de transporte|SFrame ainda não foi implementado|não suportada neste servidor/;

export async function joinVoice(accountId: string, serverId: string, channelId: string, transportOnly = false): Promise<void> {
  if (getState().instances[accountId]?.status !== "ready") return void toast("Sem conexão com o servidor. Conecte novamente para entrar na voz.");
  const account = getState().accounts.find((a) => a.id === accountId);
  // Voice, camera and screen are sealed with SFrame by default; otherwise the call goes ahead with a visible "sem E2EE" notice.
  const e2ee = !transportOnly && account && callEncryptionSupported() ? { url: account.url, token: account.token, userId: account.userId } : null;
  if (!e2ee) toast("Esta chamada não terá criptografia de ponta a ponta neste servidor.", 6000);
  if (getState().directCall) callAction("end");
  if (voice?.accountId === accountId && voice.session.channelId === channelId) return;
  leaveVoice();
  const gateway = gatewayFor(accountId);
  if (!gateway) return;
  const selfId = getState().instances[accountId]?.user?.id ?? "";
  // The instance says where media flows; both sessions behave the same for the UI.
  const Session = getState().instances[accountId]?.instance?.voiceBackend === "cloudflare" ? CloudflareVoiceSession : VoiceSession;
  const session: AnyVoiceSession = new Session(gateway, channelId, selfId, getState().settings, () =>
    setState((s) => {
      if (s.voice && voice?.session === session) {
        s.voice.camera = session.isSharing("camera");
        s.voice.screen = session.isSharing("screen");
      }
    }),
    () =>
      toast(
        "Sem áudio: o app não alcançou a porta de voz do servidor. Quem hospeda deve conferir ANNOY_ANNOUNCED_IP e liberar a porta 40000 (UDP e TCP).",
        12000,
      ),
    accountId,
    e2ee,
  );
  voice = { accountId, serverId, session };
  setState((s) => {
    s.voice = { accountId, serverId, channelId, status: "connecting", canStream: false, camera: false, screen: false };
  });
  try {
    await session.start();
    if (voice?.session !== session) return;
    setState((s) => {
      if (s.voice) {
        s.voice.status = "connected";
        s.voice.canStream = session.canStream;
        s.voice.e2ee = session.encrypted;
      }
    });
    playCallFeedback("join");
    if (!session.canSpeak) toast("Você está conectado sem permissão para falar");
  } catch (err) {
    if (voice?.session === session) leaveVoice();
    if (e2ee && NO_CALL_E2EE.test((err as Error).message)) return joinVoice(accountId, serverId, channelId, true);
    toast(`Voz: ${(err as Error).message}`);
  }
}

export function leaveVoice(notifyServer = true): void {
  const connected = getState().voice?.status === "connected";
  voice?.session.close(notifyServer);
  voice = null;
  setState((s) => {
    s.voice = null;
    if (s.modal?.kind === "screenPicker") s.modal = null;
  });
  if (connected) playCallFeedback("leave");
}

export function updateVoiceSettings(): void {
  updateDirectCallMute();
  const settings = getState().settings;
  voice?.session.updateSettings(settings);
  if (voice) gatewayFor(voice.accountId)?.send({ op: "voice_state", selfMute: settings.selfMute, selfDeaf: settings.selfDeaf, ...(voice.session.isSharing("screen") && { screenQuality: screenProfile(settings).quality }) });
}

/** Only local playback changes: this never sends a voice state or moderation request. */
export function setUserVolume(accountId: string, userId: string, percent: number): void {
  const value = normalizeUserVolume(percent);
  setState((s) => {
    s.settings.userVolumes ??= {};
    const key = userVolumeKey(accountId, userId);
    if (value === 100) delete s.settings.userVolumes[key];
    else s.settings.userVolumes[key] = value;
  });
  if (voice?.accountId === accountId) voice.session.updateSettings(getState().settings);
}

/** Shared by the profile controls and the call stage. */
export function toggleVoiceSetting(key: "selfMute" | "selfDeaf"): void {
  setState((s) => {
    s.settings[key] = !s.settings[key];
    if (key === "selfDeaf") s.settings.selfMute = s.settings.selfDeaf;
    else if (!s.settings.selfMute) s.settings.selfDeaf = false;
  });
  updateVoiceSettings();
  playVoiceFeedback(getState().settings[key]);
}

export async function toggleCamera(): Promise<void> {
  const session = voice?.session;
  if (!session) return;
  try {
    if (session.isSharing("camera")) await session.stopVideo("camera");
    else await session.startVideo("camera", getState().settings.cameraDeviceId);
  } catch (err) {
    toast(`Câmera: ${(err as Error).message}`);
  }
}

/**
 * Stops an active share, or starts one. Where the app owns the picker, the
 * screen picker modal runs first and calls `startScreenShare` with a source.
 */
export async function toggleScreenShare(): Promise<void> {
  const session = voice?.session;
  if (!session) return;
  if (session.isSharing("screen")) return void (await session.stopVideo("screen"));
  {
    setState((s) => {
      s.modal = { kind: "screenPicker" };
    });
    return;
  }
}

export async function startScreenShare(sourceId: string | null): Promise<void> {
  const session = voice?.session;
  if (!session) return;
  if (sourceId) window.distopic?.screen.choose(sourceId);
  try {
    session.updateSettings(getState().settings);
    await session.startVideo("screen");
    updateVoiceSettings();
  } catch (err) {
    // Closing the system picker rejects with NotAllowedError; that's a cancel, not a failure.
    if ((err as DOMException).name !== "NotAllowedError") toast(`Tela: ${(err as Error).message}`);
  }
}

export function setPushToTalk(down: boolean): void {
  voice?.session.setPushToTalk(down);
}

// Gateway events -------------------------------------------------------------
const receivedMessages = new Set<string>();

function notify(accountId: string, message: Message, isDm: boolean): void {
  const s = getState();
  if (!s.settings.notifications) return;
  const inst = s.instances[accountId];
  const serverId = Object.values(inst?.serverStates ?? {}).find((st) => st.channels.some((c) => c.id === message.channelId))?.server.id;
  if (s.settings.manualPresence === "dnd" || isMessageMuted(s.settings, accountId, message.channelId, serverId)) return;
  const me = inst?.user?.id;
  if (!me || message.author.id === me) return;
  const mentioned = message.mentionsEveryone || message.mentionIds.includes(me);
  if (!isDm && !mentioned) return;
  window.distopic?.flashWindow();
  if (!document.hasFocus() || s.view.kind === "service") {
    const server = Object.values(inst.serverStates).find((st) => st.channels.some((c) => c.id === message.channelId));
    const dm = inst.dms.find((d) => d.id === message.channelId);
    const nameOf = (id: string) => {
      const member = server?.members.find((m) => m.user.id === id);
      return member ? displayNameOf(member) : (dm?.recipients.find((r) => r.id === id) ?? (id === me ? inst.user : null))?.displayName;
    };
    const channelOf = (id: string) => server?.channels.find((c) => c.id === id)?.name;
    const body = message.protection === "e2ee" ? "Nova mensagem protegida no Annoy" : previewText(message.content, nameOf, channelOf) || "Enviou um anexo";
    const n = new Notification(message.protection === "e2ee" ? "Annoy" : message.author.displayName, { body, silent: true });
    n.onclick = () => window.focus();
  }
}

function replaceUser(inst: InstanceState, user: User): void {
  if (inst.user?.id === user.id) inst.user = user;
  for (const st of Object.values(inst.serverStates)) for (const m of st.members) if (m.user.id === user.id) m.user = user;
  for (const dm of inst.dms) dm.recipients = dm.recipients.map((r) => (r.id === user.id ? user : r));
  for (const r of inst.relationships) if (r.user.id === user.id) r.user = user;
}

function onEvent(accountId: string, event: GatewayEvent,authenticatedCrypto=false): void {
  if(!authenticatedCrypto&&['MESSAGE_CREATE','MESSAGE_UPDATE','MESSAGE_DELETE'].includes(event.t)){
    void(async()=>{
      const account=getState().accounts.find(a=>a.id===accountId);if(!account)return;
      const channel=(event.d as {channelId:string}).channelId;
      try{
        if(window.distopic?.crypto&&await window.distopic.crypto.guard(account.url,account.token,channel,account.userId))return;
        try{const status=await apiFor(accountId).get<{channel:unknown}>(`/channels/${encodeURIComponent(channel)}/crypto`);if(status.channel)return;}
        catch(error){if((error as {status?:number}).status!==404)return;}
        if(event.t==='MESSAGE_CREATE'||event.t==='MESSAGE_UPDATE')onEvent(accountId,{...event,d:{...event.d,protection:'legacy_plaintext'}},true);
        else onEvent(accountId,event,true);
      }catch{/* Locked or unverifiable state cannot authorize plaintext gateway messages. */}
    })();return;
  }
  if(event.t==='CRYPTO_DELIVERY'){void pullCrypto(accountId,event.d.channelId);return;}
  if(event.t==='VOICE_MEDIA'&&event.d.channelId.startsWith('call:')){handleDirectCallMedia(accountId,event.d);return;}
  if (voice?.accountId === accountId) voice.session.handleEvent(event);

  switch (event.t) {
    case "CALL_UPDATE":
    case "CALL_SIGNAL":
      void handleDirectCallEvent(accountId, event);
      return;
    case "READY": {
      const account = getState().accounts.find(a => a.id === accountId);
      if (account) {
        // An Annoy account on this server: access comes from the Annoy sign-in, never from local credentials.
        const annoyUser = event.d.user.global === true;
        if (annoyUser && !account.annoy) setState((s) => { const saved = s.accounts.find((a) => a.id === accountId); if (saved) saved.annoy = true; });
        if (window.distopic?.auth) {
          const bind = () => window.distopic?.crypto?.bind(account.url, account.token, account.userId)?.catch((error: Error) => {
            // A new session lives only minutes until it is bound to this device's key (DPoP).
            // Servers without MLS (older versions) have no device-bound sessions to set up.
            if (!/MLS/.test(error.message)) toast(`Não foi possível vincular a sessão a este dispositivo: ${error.message}`, 10000);
          });
          if (annoyUser) void bind();
          else void window.distopic.auth.local(account).then(bind, () => undefined);
        }
        else void fetchInfo(account.url).then(async info => {
          if (info.accountMode === "global") return;
          const me = await apiFor(accountId).get<User>("/users/@me");
          if (getState().instances[accountId]?.status === "ready" && me.id === account.userId) setState(s => {
            s.access.localAccounts = [...new Set([...s.access.localAccounts, accountId])]; s.access.allowed = true;
          });
        }).catch(() => undefined);
      }
      patchInstance(accountId, (inst) => {
        inst.user = event.d.user;
        inst.servers = event.d.servers;
        inst.dms = event.d.dms;
        inst.relationships = event.d.relationships;
        inst.presences = event.d.presences;
        inst.activities = Object.fromEntries(Object.entries(event.d.activities ?? {}).filter(([id])=>event.d.instance?.groupActivity || id===event.d.user.id || event.d.relationships.some(r=>r.user.id===id && r.status==="friend")));
        inst.instance = event.d.instance;
        // History may have gaps after a reconnect; reload lazily.
        inst.messages = {};
        inst.serverStates = {};
      });
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
      const receipt = notificationKey(accountId, msg.id);
      if (receivedMessages.has(receipt)) return;
      receivedMessages.add(receipt);
      if (receivedMessages.size > 2000) receivedMessages.delete(receivedMessages.values().next().value!);
      const serverId = Object.values(inst.serverStates).find((st) => st.channels.some((c) => c.id === msg.channelId))?.server.id;
      if (msg.author.id !== inst.user?.id && s.settings.manualPresence !== "dnd" && s.settings.messageSounds && !isMessageMuted(s.settings, accountId, msg.channelId, serverId)) playMessageFeedback();
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
      setState((draft) => {
        draft.recentMessages[receipt] = { own: msg.author.id === me, at: Date.now() };
        if (Object.keys(draft.recentMessages).length > 200) delete draft.recentMessages[Object.keys(draft.recentMessages)[0]!];
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
    case "ACTIVITY_UPDATE":
      patchInstance(accountId, inst => {
        if(inst.instance?.groupActivity || event.d.userId===inst.user?.id || inst.relationships.some(r=>r.user.id===event.d.userId && r.status==="friend")) inst.activities[event.d.userId]=event.d.activities;
        else delete inst.activities[event.d.userId];
      });
      break;
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
    case "VOICE_STATE_UPDATE": {
      const current = getState();
      const instance = current.instances[accountId];
      const previous = instance?.serverStates[event.d.serverId]?.voiceStates.find((v) => v.userId === event.d.userId);
      const room = current.voice;
      const listening = room?.status === "connected" && room.accountId === accountId && room.serverId === event.d.serverId;
      if (listening && event.d.userId !== instance?.user?.id) {
        const wasHere = previous?.channelId === room.channelId;
        const isHere = event.d.state?.channelId === room.channelId;
        if (wasHere !== isHere) playCallFeedback(isHere ? "join" : "leave");
      }
      if (listening && event.d.state?.channelId === room.channelId && event.d.state.screen && !previous?.screen) playStreamFeedback();
      return patchInstance(accountId, (inst) => {
        const st = inst.serverStates[event.d.serverId];
        if (!st) return;
        const index = st.voiceStates.findIndex((v) => v.userId === event.d.userId);
        if (event.d.state) {
          if (index === -1) st.voiceStates.push(event.d.state);
          else st.voiceStates[index] = event.d.state;
        } else if (index !== -1) st.voiceStates.splice(index, 1);
      });
    }
    case "VOICE_KICKED":
      if (getState().voice?.accountId === accountId) leaveVoice(false);
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
        if (!Object.values(inst.serverStates).some((state) => state.members.some((member) => member.user.id === event.d.userId))) delete inst.activities[event.d.userId];
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
    case "PLAYBACK_UPDATE":
    case "CODE_UPDATE":
      emitRoomEvent(accountId, event);
      return;
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

// The cryptographic process emits plaintext only after authenticated local persistence.
const cryptoPulls=new Map<string,Promise<void>>(),cryptoPullsAgain=new Set<string>();
async function pullCrypto(accountId:string,channel:string):Promise<void>{
 const key=accountId+':'+channel;if(cryptoPulls.has(key)){cryptoPullsAgain.add(key);return cryptoPulls.get(key);}
 const task=(async()=>{
  const account=getState().accounts.find(a=>a.id===accountId);if(!account||!window.distopic?.crypto)return;
  try{
   await window.distopic.crypto.guard(account.url,account.token,channel,account.userId);
   const known=getState().instances[accountId]?.messages[channel]?.items.map(m=>m.id)??[];
   const result=await window.distopic.crypto.reconcile(account.url,account.token,channel,known);
   for(const message of result.items)if(result.newIds.includes(message.id))onEvent(accountId,{t:'MESSAGE_CREATE',d:message},true);
   patchInstance(accountId,i=>{const list=i.messages[channel];if(!list)return;const messages=new Map([...list.items,...result.items].map(m=>[m.id,m]));list.items=[...messages.values()].filter(m=>!result.deletedIds.includes(m.id));});
  }catch{/* Authorization, unlock or connectivity remains visible in the conversation banner. */}
 })().finally(()=>{cryptoPulls.delete(key);if(cryptoPullsAgain.delete(key))void pullCrypto(accountId,channel);});cryptoPulls.set(key,task);return task;
}
window.addEventListener('annoy:crypto-message',event=>{
 const {url,message}=(event as CustomEvent<{url:string;message:Message}>).detail;
 const account=getState().accounts.find(a=>a.url===url);if(account)onEvent(account.id,{t:'MESSAGE_CREATE',d:message},true);
});
window.addEventListener('annoy:crypto-begin',event=>{
 const marker=(event as CustomEvent<{url:string;channel:string;id:string;captured:boolean;previous:unknown}>).detail;
 const account=getState().accounts.find(a=>a.url===marker.url);if(!account)return;
 marker.previous=getState().instances[account.id]?.messages[marker.channel]?.items.find(m=>m.id===marker.id);marker.captured=true;
});
window.addEventListener('annoy:crypto-change',event=>{
 const {url,channel,id,message,captured,previous}=(event as CustomEvent<{url:string;channel:string;id:string;message:Message|null;captured?:boolean;previous?:unknown}>).detail;
 const account=getState().accounts.find(a=>a.url===url);if(!account)return;
 // A newer authenticated sync may have replaced or deleted this message while
 // the mutation awaited IPC/network. Its stale result must not replace it.
 if(captured&&getState().instances[account.id]?.messages[channel]?.items.find(m=>m.id===id)!==previous)return;
 onEvent(account.id,message?{t:'MESSAGE_UPDATE',d:message}:{t:'MESSAGE_DELETE',d:{channelId:channel,messageId:id}},true);
});
