import type { ChannelReadState, DmChannel, GatewayEvent, ImportJob, MemberPage, Message, MessageWindow, PinnedMessage, PinnedMessagePage, ServerState, ServerSummary, User } from "@distopic/protocol";
import { emitRoomEvent } from "./features/channels/events.ts";
import { Api } from "./api.ts";
import { previewText } from "./format.tsx";
import { Gateway, type RecoveryEvent } from "./gateway.ts";
import { displayNameOf } from "./perms.ts";
import { emptyInstance, getState, setState, subscribe, toast, type Account, type InstanceState, type View } from "./store.ts";
import type { Service } from "../../shared/services.ts";
import { VoiceSession } from "./voice.ts";
import { CloudflareVoiceSession } from "./voice-cloudflare.ts";
import { playStreamFeedback, playCallFeedback, playVoiceFeedback, playMessageFeedback } from "./lib/voice-feedback.ts";
import { isMessageMuted, notificationKey } from "./lib/notification-preferences.ts";
import { screenProfile } from "./lib/screen-profile.ts";
import { handleDirectCallEvent, updateDirectCallMute, disconnectDirectCall, callAction } from "./features/direct-calls.ts";
import { canRemoveServer, connectionOfflineSince } from "../../shared/server-removal.ts";
import { normalizeUserVolume, userVolumeKey } from "../../shared/user-volume.ts";
import { observeHttp, observeNetwork, observeReachable, observeRequestFailure, observeTransport } from "../../shared/connectivity.ts";
import { cancelled, isCancellation, RequestError } from "../../shared/requests.ts";
import { clearAccountChatState, clearChatAnchor, clearRecoveryReturn, flushChatState, readChatAnchor, readRecoveryReturn, type RecoveryReturn } from "./chat-state.ts";

import { mergeMessageWindow, reconcileMessageWindow, boundMessageCaches, type MessageMutation } from "../../shared/message-window.ts";

const PAGE = 50;
const TYPING_MS = 8000;

interface Live {
  api: Api;
  gateway: Gateway;
}

const live = new Map<string, Live>();
type AnyVoiceSession = VoiceSession | CloudflareVoiceSession;
let voice: { accountId: string; serverId: string; session: AnyVoiceSession } | null = null;
const refreshTimers = new Map<string, { accountId: string; timer: ReturnType<typeof setTimeout> }>();
const messageReads = new Map<string, AbortController>();
let messageEventSequence=0;
const messageMutations=new Map<string,MessageMutation & {accountId:string;channelId:string}>();
function recordMessageMutation(accountId:string,channelId:string,messageId:string,kind:MessageMutation["kind"],message:Message|null):void {
  const key=JSON.stringify([accountId,channelId,messageId]);messageMutations.delete(key);
  messageMutations.set(key,{sequence:++messageEventSequence,accountId,channelId,messageId,kind,message});
  if(messageMutations.size>2000)messageMutations.delete(messageMutations.keys().next().value!);
}
const pendingMutations=(accountId:string,channelId:string)=>[...messageMutations.values()].filter(change=>change.accountId===accountId&&change.channelId===channelId);
let navigationGeneration = 0;
let navigationAbort = new AbortController();
let observedView = getState().view;
const messageKey = (accountId: string, channelId: string) => JSON.stringify([accountId, channelId]);

function clearAccountWork(accountId: string): void {
  for(const [key,change]of messageMutations)if(change.accountId===accountId)messageMutations.delete(key);
  for (const [key, pending] of refreshTimers) if (pending.accountId === accountId) {
    clearTimeout(pending.timer);
    refreshTimers.delete(key);
  }
}

const currentApi = (accountId: string, api: Api, generation: number) => live.get(accountId)?.api === api && api.generation === generation;
const navigationSignal = (accountId: string, channelId: string) => {
  const view = getState().view;
  return "accountId" in view && view.accountId === accountId &&
    (view.kind === "server" ? view.channelId === channelId : view.kind === "home" && view.dmId === channelId) ? navigationAbort.signal : undefined;
};

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

function readCache(accountId: string): Pick<InstanceState, "servers" | "user" | "serversObservedAt"> | null {
  try {
    const raw = localStorage.getItem(cacheKey(accountId));
    if (!raw) return null;
    const cached = JSON.parse(raw) as Partial<Pick<InstanceState, "servers" | "user" | "serversObservedAt">>;
    return { servers: cached.servers ?? [], user: cached.user ?? null, serversObservedAt: cached.serversObservedAt ?? null };
  } catch {
    return null;
  }
}

function writeCache(accountId: string): void {
  const inst = getState().instances[accountId];
  if (!inst || inst.status !== "ready") return;
  try {
    localStorage.setItem(cacheKey(accountId), JSON.stringify({ servers: inst.servers, user: inst.user, serversObservedAt: inst.serversObservedAt }));
  } catch {
    // Storage full or unavailable: the cache is a convenience only.
  }
}

export function reconnect(accountId?: string): void {
  for (const [id, entry] of live) if (!accountId || id === accountId) entry.gateway.reconnectNow();
}

window.addEventListener("online", () => {
  setState((s) => { s.connectivity.network = observeNetwork(true, Date.now()); });
  reconnect();
});
window.addEventListener("offline", () => {
  setState((s) => { s.connectivity.network = observeNetwork(false, Date.now()); });
  for (const entry of live.values()) entry.gateway.pauseForOffline();
});

// Keep the cache in step with the server list, whatever changed it.
const lastServers = new Map<string, unknown>();
subscribe(() => {
  const view = getState().view;
  if (view !== observedView) {
    observedView = view;
    navigationGeneration++;
    navigationAbort.abort();
    navigationAbort = new AbortController();
  }
  for (const [id, inst] of Object.entries(getState().instances)) {
    if (inst.status === "ready" && lastServers.get(id) !== inst.servers) {
      lastServers.set(id, inst.servers);
      writeCache(id);
    }
  }
});

export function connectAccount(account: Account): void {
  if (live.has(account.id)) return;
  const api: Api = new Api(account.url, account.token, () => live.get(account.id)?.api === api && getState().instances[account.id]?.status === "ready", (result) => {
    if (live.get(account.id)?.api !== api) return;
    setState((s) => {
      const inst = s.instances[account.id];
      if (inst) inst.connection = typeof result === "number" || result.status > 0
        ? observeHttp(inst.connection, typeof result === "number" ? result : result.status, Date.now(), true)
        : observeRequestFailure(inst.connection, result, Date.now(), s.connectivity.network);
    });
    if (result instanceof RequestError && result.status === 401) gateway.invalidateSession();
  });
  const gateway = new Gateway(
    account.url,
    account.token,
    (event) => onEvent(account.id, event),
    (status) => {
      api.cancelPending();
      if (status !== "ready") clearAccountWork(account.id);
      if (status !== "ready") {
        disconnectDirectCall(account.id);
        if (voice?.accountId === account.id || getState().voice?.accountId === account.id) leaveVoice(false);
      }
      setState((s) => {
        const inst = s.instances[account.id];
        if (inst) {
          inst.status = status;
          inst.connection = observeTransport(inst.connection, status, Date.now(), s.connectivity.network);
          if (status === "ready") {
            const saved = s.accounts.find((a) => a.id === account.id);
            if (saved) delete saved.offlineSince;
          }
          for (const [id, entry] of Object.entries(inst.messages)) if (entry.loading) {
            if (!entry.items.length) delete inst.messages[id];
            else entry.loading = false;
          }
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
        const inst = s.instances[account.id];
        if (inst) inst.connection = observeReachable(inst.connection, Date.now());
      });
    },
    (recovery: RecoveryEvent) => {
      setState((s) => {
        const inst = s.instances[account.id];
        if (!inst) return;
        inst.connection = {
          ...inst.connection,
          cause: recovery.cause,
          observedAt: recovery.observedAt,
          attempt: recovery.attempt,
          nextRetryAt: recovery.nextRetryAt,
          recoveryDeadline: recovery.recoveryDeadline,
          restartUntil: recovery.restartUntil,
        };
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
    s.accounts = s.accounts.filter((a) => a.id !== account.id);
    s.accounts.push(account);
    s.modal = null;
    s.view = { kind: "home", accountId: account.id, dmId: null };
  });
  live.get(account.id)?.api.dispose();
  live.get(account.id)?.gateway.close();
  clearAccountWork(account.id);
  live.delete(account.id);
  connectAccount(account);
}

/** Adds a server account in the background (servers coming back from the global vault). */
export function addAccountQuietly(account: Account): void {
  if (getState().accounts.some((a) => a.url === account.url)) return;
  setState((s) => {
    s.accounts.push(account);
  });
  connectAccount(account);
}

export function removeAccount(accountId: string): void {
  clearAccountChatState(accountId);
  const account = getState().accounts.find((item) => item.id === accountId);
  const user = getState().instances[accountId]?.user;
  disconnectDirectCall(accountId);
  if (account && user) setState((s) => {
    const { token: _token, ...remembered } = account;
    s.rememberedAccounts = [...s.rememberedAccounts.filter((item) => item.id !== accountId), { ...remembered, username: user.username, displayName: user.displayName, avatarUrl: user.avatarUrl }];
  });
  // Leaving on purpose: the global vault forgets it too, so it doesn't come back.
  if (account && getState().global) void import("./global.ts").then((g) => g.forgetServer(account.url));
  if (voice?.accountId === accountId) leaveVoice();
  const entry = live.get(accountId);
  entry?.api.dispose();
  entry?.gateway.close();
  if (account) void new Api(account.url, account.token).post("/auth/logout").catch(() => undefined);
  clearAccountWork(accountId);
  lastServers.delete(accountId);
  live.delete(accountId);
  setState((s) => {
    s.accounts = s.accounts.filter((a) => a.id !== accountId);
    delete s.instances[accountId];
    if ("accountId" in s.view && s.view.accountId === accountId) s.view = { kind: "home", accountId: null, dmId: null };
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
  for (const account of getState().accounts) connectAccount(account);
}

// Navigation -----------------------------------------------------------------

/** Clear only this community's counters; unrelated servers and DMs keep their unread state. */
export function markServerRead(accountId: string, serverId: string): void {
  setState((s) => {
    const instance = s.instances[accountId];
    if (!instance) return;
    for (const channel of instance.serverStates[serverId]?.channels ?? []) {
      if(instance.instance?.historyWindow)void apiFor(accountId).get<MessageWindow>(`/channels/${encodeURIComponent(channel.id)}/messages/window?limit=1`).then(page=>{const id=page.items.at(-1)?.id;if(id)return markChannelRead(accountId,channel.id,id);}).catch(()=>undefined);
      else delete instance.unread[channel.id];
    }
  });
}

export function navigate(view: View): void {
  flushChatState();
  const destinationAccountId = view.kind === "server" || view.kind === "home" || view.kind === "marketplace" ? view.accountId : null;
  if (destinationAccountId) clearRecoveryReturn(destinationAccountId);
  const destinationChannelId = view.kind === "server" ? view.channelId : view.kind === "home" ? view.dmId : null;
  const currentView = getState().view;
  const currentChannelId = currentView.kind === "server" ? currentView.channelId : currentView.kind === "home" ? currentView.dmId : null;
  if (destinationChannelId && destinationAccountId && currentChannelId === destinationChannelId && "accountId" in currentView && currentView.accountId === destinationAccountId) {
    clearChatAnchor(destinationAccountId, destinationChannelId);
  }
  showServiceView(view);
  setState((s) => {
    s.view = view;
    if(s.messageFocus) { delete s.instances[s.messageFocus.accountId]?.messages[s.messageFocus.channelId]; s.messageFocus=null; }
    if (view.kind === "server" || (view.kind === "home" && view.dmId)) s.chatNavigation++;
    const channelId = view.kind === "server" ? view.channelId : view.kind === "home" ? view.dmId : null;
    if (channelId && destinationAccountId && !s.instances[destinationAccountId]?.instance?.historyWindow) delete s.instances[destinationAccountId]?.unread[channelId];
  });
  // `openServer` owns the initial details request while its destination has no channel.
  // Starting a second request here made the caller observe `serverLoading` and return early.
  if (view.kind === "server" && view.channelId) void ensureServer(view.accountId, view.serverId);
}

/** Reopen the account-local destination saved when recovery moved to the server directory. */
export async function resumeRecoveredView(accountId: string): Promise<void> {
  const destination: RecoveryReturn | null = readRecoveryReturn(accountId);
  if (!destination || getState().instances[accountId]?.status !== "ready") return;
  if (destination.kind === "home") {
    const dmId = destination.dmId && getState().instances[accountId]?.dms.some((dm) => dm.id === destination.dmId) ? destination.dmId : null;
    navigate({ kind: "home", accountId, dmId });
    return;
  }
  if (destination.kind === "marketplace") {
    navigate({ kind: "marketplace", accountId, serverId: destination.serverId });
    return;
  }
  const visit = navigationGeneration;
  const server = await ensureServer(accountId, destination.serverId);
  if (!server || visit !== navigationGeneration || getState().view.kind !== "servers") {
    if (!server && getState().view.kind === "servers") toast("Não foi possível reabrir a comunidade. Tente novamente pela lista.");
    return;
  }
  const channel = destination.channelId && server.channels.some((item) => item.id === destination.channelId)
    ? destination.channelId
    : server.channels.find((item) => item.type === "text")?.id ?? null;
  navigate({ kind: "server", accountId, serverId: destination.serverId, channelId: channel });
}

/** Shows the native view of a browser service, or hides it for anything else. */
export function showServiceView(view: View): void {
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
  const navigation = navigationGeneration;
  const state = await ensureServer(accountId, serverId, false, navigationAbort.signal);
  const current = getState().view;
  if (!state || navigation !== navigationGeneration || current.kind !== "server" || current.accountId !== accountId || current.serverId !== serverId || current.channelId) return;
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
  const navigation = navigationGeneration;
  try {
    const api = apiFor(accountId), generation = api.generation;
    const dm = await api.post<DmChannel>("/dms", { userId }, navigationAbort.signal);
    if (navigation !== navigationGeneration || !currentApi(accountId, api, generation)) return;
    patchInstance(accountId, (inst) => {
      if (!inst.dms.some((d) => d.id === dm.id)) inst.dms.unshift(dm);
    });
    navigate({ kind: "home", accountId, dmId: dm.id });
  } catch (err) {
    if (!isCancellation(err)) toast((err as Error).message);
  }
}

// Server state -----------------------------------------------------------------

export async function ensureServer(accountId: string, serverId: string, force = false, signal?: AbortSignal): Promise<ServerState | undefined> {
  const instance = getState().instances[accountId];
  const existing = instance?.serverStates[serverId];
  if (existing && !force) return existing;
  if (instance?.status !== "ready") return undefined;
  if (instance.serverLoading[serverId]) return undefined;
  patchInstance(accountId, (inst) => { inst.serverLoading[serverId] = true; delete inst.serverLoadErrors[serverId]; });
  try {
    const api = apiFor(accountId), generation = api.generation;
    const fresh = await api.get<ServerState>(`/servers/${serverId}?membersLimit=100`, signal);
    if (signal?.aborted || !currentApi(accountId, api, generation)) return;
    patchInstance(accountId, (inst) => {
      const allowed=new Set(fresh.channels.map(channel=>channel.id));
      for(const channel of inst.serverStates[serverId]?.channels??[])if(!allowed.has(channel.id)){delete inst.messages[channel.id];delete inst.unread[channel.id];}
      inst.serverStates[serverId] = fresh;
      // The summary in the rail comes from READY; keep it in sync with renames.
      const idx = inst.servers.findIndex((sv) => sv.id === serverId);
      if (idx >= 0) inst.servers[idx] = fresh.server;
      for (const m of fresh.members) inst.presences[m.user.id] = m.presence;
    });
    return fresh;
  } catch (err) {
    if (!isCancellation(err)) {
      const message = err instanceof RequestError && err.status === 403
        ? "Sua conta não tem mais acesso a esta comunidade. Atualize a lista de servidores."
        : (err as Error).message || "Não foi possível carregar esta comunidade.";
      patchInstance(accountId, (inst) => { inst.serverLoadErrors[serverId] = message; });
    }
    return undefined;
  } finally {
    patchInstance(accountId, (inst) => { delete inst.serverLoading[serverId]; });
  }
}

/** Loads a bounded server-side member search/page and merges its data into the active server cache. */
export async function loadServerMembers(accountId: string, serverId: string, options: { after?: string | null; query?: string; signal?: AbortSignal; merge?: boolean } = {}): Promise<MemberPage> {
  const query = new URLSearchParams({ limit: "100" });
  if (options.after) query.set("after", options.after);
  if (options.query?.trim()) query.set("q", options.query.trim());
  const page = await apiFor(accountId).get<MemberPage>(`/servers/${encodeURIComponent(serverId)}/members?${query}`, options.signal);
  if (options.merge !== false && !options.query?.trim()) patchInstance(accountId, (instance) => {
    const state = instance.serverStates[serverId];
    if (!state) return;
    const byId = new Map(state.members.map((member) => [member.user.id, member]));
    for (const member of page.members) byId.set(member.user.id, member);
    state.members = [...byId.values()];
    state.membersNextCursor = page.nextCursor;
    state.membersTotal = page.total;
  });
  return page;
}

function scheduleRefresh(accountId: string, serverId: string): void {
  if (!getState().instances[accountId]?.serverStates[serverId]) return;
  const key = `${accountId}:${serverId}`;
  clearTimeout(refreshTimers.get(key)?.timer);
  refreshTimers.set(
    key,
    { accountId, timer: setTimeout(() => {
      refreshTimers.delete(key);
      void ensureServer(accountId, serverId, true).then((state) => {
        // Leave a channel that just became invisible.
        const view = getState().view;
        if (state && view.kind === "server" && view.accountId === accountId && view.serverId === serverId && view.channelId && !state.channels.some((c) => c.id === view.channelId)) {
          navigate({ kind: "server", accountId, serverId, channelId: null });
        }
      });
    }, 150) },
  );
}

// Messages -----------------------------------------------------------------

async function fetchMessageWindow(accountId:string,channelId:string,query:string,signal?:AbortSignal):Promise<MessageWindow> {
  const path=`/channels/${encodeURIComponent(channelId)}/messages`;
  if(getState().instances[accountId]?.instance?.historyWindow) return apiFor(accountId).get<MessageWindow>(`${path}/window?limit=${PAGE}${query?`&${query}`:""}`,signal);
  const items=await apiFor(accountId).get<Message[]>(query.startsWith("around=")?`${path}?${query}`:`${path}?limit=${PAGE}${query?`&${query}`:""}`,signal);
  return {items,hasMoreBefore:items.length>=PAGE,hasMoreAfter:query.startsWith("around=")};
}
function boundMessages(inst:InstanceState,channelId:string,accountId:string):void {
  const view=getState().view;
  const active="accountId"in view&&view.accountId===accountId?(view.kind==="server"?view.channelId:view.kind==="home"?view.dmId:null):null;
  boundMessageCaches(inst.messages,active?[channelId,active]:[channelId]);
}

export async function loadMessages(accountId:string,channelId:string,direction:boolean|"newer"|"latest"=false):Promise<void> {
  const inst=getState().instances[accountId]; if(inst?.status!=="ready") return;
  const current=inst.messages[channelId];
  if(current&&!direction)patchInstance(accountId,i=>{i.messages[channelId]!.lastAccessed=Date.now();});
  if(!direction&&getState().messageFocus?.accountId===accountId&&getState().messageFocus?.channelId===channelId)return;
  if(direction==="newer"&&!inst.instance?.historyWindow){returnToLatest(accountId,channelId);return;}
  const paging=direction===true||direction==="newer";
  const anchor=!paging&&direction!=="latest"?readChatAnchor(accountId,channelId):null;
  if(current?.loading || direction===true&&!current?.hasMore || direction==="newer"&&!current?.hasMoreAfter || !direction&&current&&!current.error&&(!anchor||current.items.some(message=>message.id===anchor.messageId))) return;
  const sequence=messageEventSequence;
  const api=apiFor(accountId),generation=api.generation,key=messageKey(accountId,channelId),controller=new AbortController();
  messageReads.get(key)?.abort(); messageReads.set(key,controller);
  const viewSignal=navigationSignal(accountId,channelId),signal=viewSignal?AbortSignal.any([viewSignal,controller.signal]):controller.signal;
  const active=()=>currentApi(accountId,api,generation)&&messageReads.get(key)===controller&&!signal.aborted;
  patchInstance(accountId,i=>{i.messages[channelId]={...current,items:current?.items??[],hasMore:current?.hasMore??true,loading:true,error:null};});
  try {
    const read=!paging&&inst.instance?.historyWindow?await api.get<ChannelReadState>(`/channels/${encodeURIComponent(channelId)}/read-state`,signal):current?.readState;
    let query=direction===true?`before=${encodeURIComponent(current?.items[0]?.id??"")}`:direction==="newer"?`after=${encodeURIComponent(current?.items.at(-1)?.id??"")}`:anchor?`around=${encodeURIComponent(anchor.messageId)}`:direction!=="latest"&&read?.messageId&&read.unread?.count?`after=${encodeURIComponent(read.messageId)}`:"";
    let page:MessageWindow;
    try {page=await fetchMessageWindow(accountId,channelId,query,signal);}
    catch(error){if(!anchor||!(error instanceof RequestError)||error.status!==404) throw error;clearChatAnchor(accountId,channelId);query="";page=await fetchMessageWindow(accountId,channelId,"",signal);}
    if(!active()) return;
    patchInstance(accountId,i=>{
      const entry=i.messages[channelId]!;
      const merged=mergeMessageWindow(paging?entry.items:[],reconcileMessageWindow(page.items,pendingMutations(accountId,channelId),sequence,!page.hasMoreAfter),direction===true?"before":direction==="newer"?"after":"replace");
      i.messages[channelId]={...entry,lastAccessed:Date.now(),items:merged.items,hasMore:(direction==="newer"?entry.hasMore:page.hasMoreBefore)||merged.evictedBefore,hasMoreAfter:(direction===true?entry.hasMoreAfter:page.hasMoreAfter)||merged.evictedAfter,loading:false,error:null,readState:read??null,
        unreadBoundary:paging?entry.unreadBoundary:read?.unread?.count?read.messageId:null,
        initialPosition:paging?entry.initialPosition:query.startsWith("after=")?page.items[0]?.id:null};
      if(read?.unread) i.unread[channelId]=read.unread;
      boundMessages(i,channelId,accountId);
    });
    void loadPinnedMessages(accountId,channelId);
  } catch(error) {
    if(messageReads.get(key)!==controller) return;
    patchInstance(accountId,i=>{const entry=i.messages[channelId];if(!entry)return;entry.loading=false;if(!isCancellation(error))entry.error=(error as Error).message;});
  } finally {if(messageReads.get(key)===controller)messageReads.delete(key);}
}

export async function jumpToMessage(accountId:string,channelId:string,messageId:string,serverId:string|null, signal?: AbortSignal) {
  const sequence=messageEventSequence;
  const navigation = navigationGeneration, api = apiFor(accountId), generation = api.generation;
  const active = signal ? AbortSignal.any([navigationAbort.signal, signal]) : navigationAbort.signal;
  const window=await fetchMessageWindow(accountId,channelId,`around=${encodeURIComponent(messageId)}`,active);
  if (active.aborted || navigation !== navigationGeneration || !currentApi(accountId, api, generation)) throw cancelled();
  window.items=reconcileMessageWindow(window.items,pendingMutations(accountId,channelId),sequence,!window.hasMoreAfter);
  if(!window.items.some(message=>message.id===messageId))throw new RequestError(404,"A mensagem foi removida.","http");
  messageReads.get(messageKey(accountId, channelId))?.abort();
  messageReads.delete(messageKey(accountId, channelId));
  navigate(serverId?{kind:"server",accountId,serverId,channelId}:{kind:"home",accountId,dmId:channelId});
  setState(s=>{s.instances[accountId]!.messages[channelId]={lastAccessed:Date.now(),items:window.items,hasMore:window.hasMoreBefore,hasMoreAfter:window.hasMoreAfter,loading:false};boundMessages(s.instances[accountId]!,channelId,accountId);s.messageFocus={accountId,channelId,messageId};s.modal=null;});
}

export async function loadReadStates(accountId:string):Promise<void> {
  try { const states=await apiFor(accountId).get<Array<ChannelReadState & {unread:{count:number;mention:boolean}}>>("/users/@me/read-states");
    patchInstance(accountId,inst=>{ for(const value of states){inst.unread[value.channelId]=value.unread; const entry=inst.messages[value.channelId]; if(entry) entry.readState={channelId:value.channelId,messageId:value.messageId,updatedAt:value.updatedAt};} });
  } catch { /* Reconnect can retry without blocking READY. */ }
}
export async function markChannelRead(accountId:string,channelId:string,messageId:string):Promise<void> {
  const inst=getState().instances[accountId]; if(inst?.status!=="ready" || !inst.instance?.historyWindow || !messageId || (inst.messages[channelId]?.readState?.messageId??"")>=messageId) return;
  try { const state=await apiFor(accountId).put<ChannelReadState>(`/channels/${encodeURIComponent(channelId)}/read-state`,{messageId});
    patchInstance(accountId,i=>{ const entry=i.messages[channelId]; if(entry) entry.readState=state; if(state.unread) i.unread[channelId]=state.unread; });
  } catch { /* Read cursor sync retries when the channel becomes visible again. */ }
}
export async function loadPinnedMessages(accountId:string,channelId:string,more=false):Promise<void> {
  const inst=getState().instances[accountId];if(!inst?.instance?.messagePins || inst.messages[channelId]?.pinsLoading)return;
  const api=apiFor(accountId),generation=api.generation;
  patchInstance(accountId,i=>{const entry=i.messages[channelId];if(entry){entry.pinsLoading=true;entry.pinsError=null;}});
  try {const page=await api.get<PinnedMessagePage>(`/channels/${encodeURIComponent(channelId)}/pins?limit=50${more&&inst.messages[channelId]?.pinsNextCursor?`&before=${encodeURIComponent(inst.messages[channelId]!.pinsNextCursor!)}`:""}`);
    if(currentApi(accountId,api,generation))patchInstance(accountId,i=>{const entry=i.messages[channelId];if(entry){entry.pins=more?[...new Map([...(entry.pins??[]),...page.items].map(pin=>[pin.message.id,pin])).values()].slice(0,100):page.items;entry.pinsNextCursor=page.nextCursor;entry.pinsLoading=false;}});
  } catch(error){if(!isCancellation(error))patchInstance(accountId,i=>{const entry=i.messages[channelId];if(entry){entry.pinsLoading=false;entry.pinsError=(error as Error).message;if(error instanceof RequestError&&[403,404].includes(error.status))entry.pins=[];}});}
}

export function returnToLatest(accountId:string,channelId:string) {
  messageReads.get(messageKey(accountId, channelId))?.abort();
  clearChatAnchor(accountId, channelId);
  setState(s=>{delete s.instances[accountId]?.messages[channelId];s.messageFocus=null;s.chatNavigation++;});
  void loadMessages(accountId,channelId,"latest");
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
  if (getState().instances[accountId]?.status !== "ready") return void toast("Sem conexão com o servidor. Conecte novamente para entrar na voz.");
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
      }
    });
    playCallFeedback("join");
    if (!session.canSpeak) toast("Você está conectado sem permissão para falar");
  } catch (err) {
    if (voice?.session === session) leaveVoice();
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
    const body = previewText(message.content, nameOf, channelOf) || "Enviou um anexo";
    const n = new Notification(message.author.displayName, { body, silent: true });
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
    case "CALL_UPDATE":
    case "CALL_SIGNAL":
      void handleDirectCallEvent(accountId, event);
      return;
    case "READY": {
      patchInstance(accountId, (inst) => {
        inst.user = event.d.user;
        inst.servers = event.d.servers;
        inst.serversObservedAt = Date.now();
        inst.dms = event.d.dms;
        inst.relationships = event.d.relationships;
        inst.presences = event.d.presences;
        inst.activities = Object.fromEntries(Object.entries(event.d.activities ?? {}).filter(([id])=>event.d.instance?.groupActivity || id===event.d.user.id || event.d.relationships.some(r=>r.user.id===id && r.status==="friend")));
        inst.instance = event.d.instance;
        // History may have gaps after a reconnect; reload lazily.
        inst.messages = {};
        inst.serverStates = {};
        inst.serverLoadErrors = {};
        inst.serverLoading = {};
      });
      if(event.d.instance.historyWindow) void loadReadStates(accountId);
      // Server summaries arrive with READY; fetch channel/member details only
      // for the currently open community or when the user opens another one.
      const view = getState().view;
      if (view.kind === "server" && view.accountId === accountId) {
        const visit = navigationGeneration;
        void ensureServer(accountId, view.serverId).then((server) => {
          const current = getState().view;
          if (!server || visit !== navigationGeneration || current.kind !== "server" || current.accountId !== accountId || current.serverId !== view.serverId || current.channelId) return;
          const remembered = localStorage.getItem(`distopic.lastChannel.${view.serverId}`);
          const target = server.channels.find((channel) => channel.id === remembered && channel.type === "text") ?? server.channels.find((channel) => channel.type === "text");
          if (target) navigate({ kind: "server", accountId, serverId: view.serverId, channelId: target.id });
        });
      }
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
        inst.profileRevision=(inst.profileRevision??0)+1;
        inst.servers = inst.servers.filter((sv) => sv.id !== serverId);
        for(const channel of inst.serverStates[serverId]?.channels??[]){delete inst.messages[channel.id];delete inst.unread[channel.id];}
        delete inst.serverStates[serverId];
      });
      if (s.view.kind === "server" && s.view.accountId === accountId && s.view.serverId === serverId) {
        navigate({ kind: "home", accountId, dmId: null });
        toast("Você não faz mais parte deste servidor");
      }
      return;
    }
    case "SERVER_REFRESH":
      patchInstance(accountId,inst=>{inst.profileRevision=(inst.profileRevision??0)+1;});
      return scheduleRefresh(accountId, event.d.serverId);
    case "MESSAGE_CREATE": {
      const msg = event.d;
      emitRoomEvent(accountId, event);
      const s = getState();
      const inst = s.instances[accountId];
      if (!inst) return;
      const receipt = notificationKey(accountId, msg.id);
      if (receivedMessages.has(receipt)) return;
      receivedMessages.add(receipt);
      recordMessageMutation(accountId,msg.channelId,msg.id,"create",msg);
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
        if (list && !list.items.some(m=>m.id===msg.id) && (!list.hasMoreAfter || msg.id >= (list.items[0]?.id??"") && msg.id <= (list.items.at(-1)?.id??""))) {
          const merged=mergeMessageWindow(list.items,[msg],"after"); list.items=merged.items; list.hasMore ||= merged.evictedBefore; boundMessages(i,msg.channelId,accountId);
        }
        const typing = i.typing[msg.channelId];
        if (typing) delete typing[msg.author.id];
        const dm = i.dms.find((d) => d.id === msg.channelId);
        if (dm) {
          dm.lastMessageId = msg.id;
          i.dms.sort((a, b) => (b.lastMessageId ?? "").localeCompare(a.lastMessageId ?? ""));
        }
        if (msg.author.id !== me && (i.instance?.historyWindow || !viewing || !document.hasFocus())) {
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
      recordMessageMutation(accountId,event.d.channelId,event.d.id,"update",event.d);
      emitRoomEvent(accountId, event);
      return patchInstance(accountId, (inst) => {
        const list = inst.messages[event.d.channelId];
        const idx = list?.items.findIndex((m) => m.id === event.d.id) ?? -1;
        if (list && idx >= 0) list.items[idx] = event.d;
        const pinned=list?.pins?.find(pin=>pin.message.id===event.d.id);if(pinned)pinned.message=event.d;
      });
    case "MESSAGE_DELETE":
      recordMessageMutation(accountId,event.d.channelId,event.d.messageId,"delete",null);
      emitRoomEvent(accountId, event);
      return patchInstance(accountId, (inst) => {
        const list = inst.messages[event.d.channelId];
        if (list) list.items = list.items.filter((m) => m.id !== event.d.messageId);
        if (list?.pins) list.pins = list.pins.filter(pin => pin.message.id !== event.d.messageId);
      });
    case "CHANNEL_READ_STATE":
      return patchInstance(accountId,inst=>{
        if(event.d.userId!==inst.user?.id) return;
        const entry=inst.messages[event.d.state.channelId]; if(entry) entry.readState=event.d.state;
        if(event.d.state.unread) inst.unread[event.d.state.channelId]=event.d.state.unread;
      });
    case "CHANNEL_PIN_UPDATE":
      return patchInstance(accountId,inst=>{
        const entry=inst.messages[event.d.channelId]; if(!entry) return;
        entry.pins ??=[];
        entry.pins=entry.pins.filter(pin=>pin.message.id!==event.d.messageId);
        if(event.d.message) entry.pins.unshift(event.d.message);entry.pins=entry.pins.slice(0,100);
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
    case "PROFILE_INVALIDATE":
      return patchInstance(accountId,inst=>{inst.profileRevision=(inst.profileRevision??0)+1;});
    case "USER_UPDATE":
      return patchInstance(accountId,inst=>{replaceUser(inst,event.d);inst.profileRevision=(inst.profileRevision??0)+1;});
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
        inst.profileRevision=(inst.profileRevision??0)+1;
        inst.relationships = [...inst.relationships.filter((r) => r.user.id !== event.d.user.id), event.d];
      });
    case "RELATIONSHIP_REMOVE":
      return patchInstance(accountId, (inst) => {
        inst.profileRevision=(inst.profileRevision??0)+1;
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
