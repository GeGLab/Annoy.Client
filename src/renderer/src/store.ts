// Must run before this module reads storage: bundling can evaluate this chunk before main.tsx's own code.
import "./storage-migration.ts";
import {configureLocalization,defaultLocalization,normalizeLocalization,type LocalizationPreferences} from "../../shared/localization/index.ts";
import { normalizeAppIcon } from "../../shared/app-icon.ts";
import type {
  ChannelReadState,
  DmChannel,
  GatewayEvent,
  ImportJob,
  Message,
  PinnedMessage,
  Presence,
  Relationship,
  ServerState,
  ServerSummary,
  User,
} from "@annoy/protocol";
import { produce, type Draft } from "immer";
import { CATALOG, type Service, type TabDisplay, type TabPlacement } from "../../shared/services.ts";
import { LOCKED_ACCESS, type AppAccessState } from "../../shared/app-access.ts";
import type { UpdateState } from "../../shared/update.ts";
import type { NoiseFilter } from "./noise.ts";
import { DEFAULT_MIC_FILTERS, normalizeMicFilters } from "./audio/mic-filters.ts";
import { useSyncExternalStore } from "react";
import { emptySocial } from "./social/types.ts";
import { observeNetwork, unknownEndpoint, type EndpointObservation, type NetworkObservation, type TransportStatus } from "../../shared/connectivity.ts";

export interface Account {
  /** Local id: one account per (instance URL, user). */
  id: string;
  url: string;
  token: string;
  userId: string;
  instanceName: string;
  /** Signed in through the Annoy account (never true for a server's local account). */
  annoy?: boolean;
  /** A server of the Annoy account that this device could not sign in to yet (no token):
   * "offline" while it fails, "invalid" when the server needs a username first. */
  pending?: "offline" | "invalid";
  /** First observed connection failure; cleared as soon as the server responds. */
  offlineSince?: number;
}
export type RememberedAccount = Omit<Account, "token"> & { username: string; displayName: string; avatarUrl: string | null; /** Annoy accounts: the e-mail filled in for the next sign-in. */ annoyEmail?: string };

export interface ChannelMessages {
  lastAccessed?: number;
  items: Message[];
  hasMore: boolean;
  hasMoreAfter?: boolean;
  loading: boolean;
  error?: string | null;
  readState?: ChannelReadState | null;
  unreadBoundary?: string | null;
  initialPosition?: string | null;
  pins?: PinnedMessage[];
  pinsLoading?: boolean;
  pinsNextCursor?: string | null;
  pinsError?: string | null;
}

export interface InstanceState {
  status: TransportStatus | "outdated";
  connection: EndpointObservation;
  user: User | null;
  servers: ServerSummary[];
  serversObservedAt: number | null;
  serverLoadErrors: Record<string, string>;
  serverLoading: Record<string, boolean>;
  serverStates: Record<string, ServerState>;
  dms: DmChannel[];
  relationships: Relationship[];
  presences: Record<string, Presence>;
  activities: Record<string, import("@annoy/protocol").UserActivity[]>;
  profileRevision?: number;
  integrationRevision?: number;
  messages: Record<string, ChannelMessages>;
  /** channelId -> userId -> expiry timestamp */
  typing: Record<string, Record<string, number>>;
  unread: Record<string, { count: number; mention: boolean }>;
  imports: Record<string, ImportJob>;
  /** This account's role on the instance, from READY. */
  instance: Extract<GatewayEvent, { t: "READY" }>["d"]["instance"] | null;
}

export type View =
  | { kind: "news" }
  | { kind: "servers" }
  /** A browser service (Discord, WhatsApp…) or a TeamSpeak launcher. */
  | { kind: "service"; serviceId: string }
  | { kind: "marketplace"; accountId: string | null; serverId: string | null }
  | { kind: "home"; accountId: string | null; dmId: string | null }
  | { kind: "server"; accountId: string; serverId: string; channelId: string | null };

export type CreatableChannel = "text" | "voice" | "category" | "files" | "code" | "theater" | "song";

export type Modal =
  | { kind: "addAccount"; rememberedId?: string; accountId?: string; address?: string }
  | { kind: "switchAccount" }
  | { kind: "search"; accountId: string; serverId?: string; channelId?: string }
  | { kind: "createServer"; accountId?: string; initialMode?: "create" | "join" }
  | { kind: "serverSettings"; accountId: string; serverId: string }
  | { kind: "channelSettings"; accountId: string; serverId: string; channelId: string }
  | { kind: "createChannel"; accountId: string; serverId: string; parentId: string | null; type: CreatableChannel }
  | { kind: "invite"; accountId: string; serverId: string }
  | { kind: "importDiscord"; accountId: string; serverId: string | null }
  | { kind: "userSettings"; section?: "voice" | "expressions" | "security" | "updates"; accountId?: string }
  | { kind: "screenPicker" }
  | { kind: "deleteAccount"; accountId: string }
  | { kind: "addTab" }
  | { kind: "serviceSettings"; serviceId: string };

export interface VoiceUi {
  accountId: string;
  serverId: string;
  channelId: string;
  status: "connecting" | "connected";
  canStream: boolean;
  camera: boolean;
  screen: boolean;
  screenBusy?: boolean;
}

export interface Settings extends LocalizationPreferences {
  theme: "dark" | "light" | "system";
  themePreset: import("./lib/theme-presets.ts").ThemePreset;
  /** Annoy icon inside the app, on the window and in the tray. */
  appIcon: import("../../shared/app-icon.ts").AppIcon;
  accentColor: string | null;
  surfaceColor: string | null;
  channelsWidth: number;
  membersWidth: number;
  channelsOpen: boolean;
  membersOpen: boolean;
  inputMode: "vad" | "ptt";
  pttKey: string;
  vadThreshold: number;
  inputDeviceId: string;
  outputDeviceId: string;
  cameraDeviceId: string;
  /** Device names saved with the IDs above; IDs change, names find the same device again. */
  inputDeviceLabel: string;
  outputDeviceLabel: string;
  cameraDeviceLabel: string;
  selfMute: boolean;
  selfDeaf: boolean;
  notifications: boolean;
  messageSounds: boolean;
  mutedServers: string[];
  mutedChannels: string[];
  noiseFilter: NoiseFilter;
  /** OBS-style chain after the noise suppression model (see audio/mic-filters.ts). */
  micFilters: import("./audio/mic-filters.ts").MicFilters;
  /** Local playback percentages, scoped to [account ID, remote user ID]. */
  userVolumes: Record<string, number>;
  /** Same keys as userVolumes, for the sound of each person's screen share. */
  streamVolumes: Record<string, number>;
  dmProfileOpen: boolean;
  /** Defaults for service tabs; each tab can override them. */
  servicePlacement: TabPlacement;
  serviceDisplay: TabDisplay;
  /** Where the community bar sits: down the left side or across the top. */
  barPosition: "side" | "top";
  shareActivity: boolean;
  showVoiceBar: boolean;
  voiceBarMode: "external" | "always";
  awayMinutes: number;
  manualPresence: import("../../shared/presence.ts").ManualPresence;
  screenHeight: number;
  screenFps: number;
  screenAudio: boolean;
}

export interface AppState {
  access: AppAccessState;
  directCall: { accountId: string; call: import("@annoy/protocol").DirectCall } | null;
  rememberedAccounts: RememberedAccount[];
  recentMessages: Record<string, { own: boolean; at: number }>;
  accounts: Account[];
  instances: Record<string, InstanceState>;
  /** Live observations, deliberately excluded from local persistence. */
  connectivity: { network: NetworkObservation; global: EndpointObservation };
  /** Reading the Annoy account's server list (auth/servers.ts). null: not signed in to an Annoy account. */
  vaultSync: "syncing" | "retrying" | "done" | null;
  view: View;
  modal: Modal | null;
  voice: VoiceUi | null;
  settings: Settings;
  /** Browser services and launchers shown as tabs, in tab order. */
  services: Service[];
  serviceBadges: Record<string, string | null>;
  toast: { id: number; text: string } | null;
  /** Owned by the main process; null outside Electron. */
  update: UpdateState | null;
  /** Version whose banner the user dismissed this session. */
  updateDismissed: string | null;
  /** Explicit navigation, including clicking the currently open conversation. */
  chatNavigation: number;
  messageFocus: { accountId: string; channelId: string; messageId: string } | null;
  desktopActivity: import("../../shared/activity.ts").DesktopActivitySnapshot | null;
  /** The signed-in Annoy account, if any (keys stay in global.ts, never in the store). */
  global: GlobalAccount | null;
  /** Friends, DMs and status of the Annoy account, from the Annoy cloud (social/). Never persisted. */
  social: import("./social/types.ts").SocialState;
}

export interface GlobalAccount {
  cryptoMigrationRequired?: boolean;
  id: string;
  name: string;
  email: string;
}

const ACCOUNTS_KEY = "annoy.accounts";
export const EMPTY_ACTIVITIES: readonly import("@annoy/protocol").UserActivity[] = [];
const SETTINGS_KEY = "annoy.settings";
const VIEW_KEY = "annoy.view";
/** The identity in use survives views without an account (services, news) and restarts. */
const ACTIVE_KEY = "annoy.activeAccount";

/**
 * Accounts of the identity in use. Switching user switches servers: an identity never
 * shows another identity's servers or conversations. The Annoy account is one identity
 * with all the server accounts that sign in through it; every local account is its own.
 */
export function identityAccountIds(s: AppState): string[] {
  let id: string | null | undefined = "accountId" in s.view ? s.view.accountId : undefined;
  if (id === undefined) { try { id = JSON.parse(localStorage.getItem(ACTIVE_KEY) ?? "null"); } catch { id = null; } }
  const account = s.accounts.find((a) => a.id === id);
  if (account) return account.annoy && s.global ? s.accounts.filter((a) => a.annoy).map((a) => a.id) : [account.id];
  if (s.global) return s.accounts.filter((a) => a.annoy).map((a) => a.id);
  return s.accounts.slice(0, 1).map((a) => a.id);
}
const SERVICES_KEY = "annoy.services";

const DEFAULT_SETTINGS: Settings = {
  ...defaultLocalization(navigator.language),
  theme: "dark",
  themePreset: "classic",
  accentColor: null,
  surfaceColor: null,
  channelsWidth: 240,
  membersWidth: 248,
  channelsOpen: true,
  membersOpen: true,
  inputMode: "vad",
  pttKey: "Backquote",
  vadThreshold: 18,
  inputDeviceId: "default",
  outputDeviceId: "default",
  cameraDeviceId: "default",
  inputDeviceLabel: "",
  outputDeviceLabel: "",
  cameraDeviceLabel: "",
  selfMute: false,
  selfDeaf: false,
  notifications: true,
  messageSounds: true,
  mutedServers: [],
  mutedChannels: [],
  noiseFilter: "rnnoise",
  micFilters: DEFAULT_MIC_FILTERS,
  userVolumes: {},
  streamVolumes: {},
  dmProfileOpen: true,
  servicePlacement: "after",
  serviceDisplay: "full",
  barPosition: "side",
  appIcon: "white",
  shareActivity: true,
  showVoiceBar: true,
  voiceBarMode: "external",
  awayMinutes: 10,
  manualPresence: "online",
  screenHeight: 1080,
  screenFps: 30,
  screenAudio: true,
};

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const saved = JSON.parse(raw);
    if (key === "annoy.settings" && saved.screenFps === undefined && saved.screenQuality) {
      saved.screenFps = saved.screenQuality === "max" ? 0 : Number(saved.screenQuality);
      if (saved.screenQuality === "max") saved.screenHeight = 0;
    }
    return { ...fallback, ...saved, ...(key === SETTINGS_KEY ? { ...normalizeLocalization(saved,navigator.language), micFilters: normalizeMicFilters(saved.micFilters), appIcon: normalizeAppIcon(saved.appIcon) } : {}) } as T;
  } catch {
    return fallback;
  }
}

function loadArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export const emptyInstance = (): InstanceState => ({
  status: "connecting",
  connection: unknownEndpoint(),
  user: null,
  servers: [],
  serversObservedAt: null,
  serverLoadErrors: {},
  serverLoading: {},
  serverStates: {},
  dms: [],
  relationships: [],
  presences: {},
  activities: {},
  messages: {},
  typing: {},
  unread: {},
  imports: {},
  instance: null,
});

/**
 * Up to 0.3 Discord was a fixed tab. Existing installs keep it (and its login)
 * as a service; fresh installs start with no services.
 */
function initialServices(): Service[] {
  if (localStorage.getItem(SERVICES_KEY) !== null) return loadArray<Service>(SERVICES_KEY);
  const existingInstall = [ACCOUNTS_KEY, SETTINGS_KEY, VIEW_KEY].some((k) => localStorage.getItem(k) !== null);
  const discord = CATALOG.find((c) => c.kind === "discord")!;
  return existingInstall ? [{ id: "discord", kind: "discord", name: discord.name, url: discord.url }] : [];
}

function initialView(): View {
  const view = load<View | { kind: "discord" }>(VIEW_KEY, { kind: "home", accountId: null, dmId: null });
  if (view.kind === "marketplace") return { kind: "news" };
  return view.kind === "discord" ? { kind: "service", serviceId: "discord" } : view;
}

let state: AppState = {
  access: LOCKED_ACCESS,
  directCall: null,
  rememberedAccounts: loadArray<RememberedAccount>("annoy.rememberedAccounts"),
  recentMessages: {},
  accounts: loadArray<Account>(ACCOUNTS_KEY),
  instances: {},
  connectivity: { network: navigator.onLine ? { status: "unknown", observedAt: null } : observeNetwork(false, Date.now()), global: unknownEndpoint() },
  vaultSync: null,
  view: initialView(),
  modal: null,
  voice: null,
  settings: load(SETTINGS_KEY, DEFAULT_SETTINGS),
  services: initialServices(),
  serviceBadges: {},
  toast: null,
  update: null,
  updateDismissed: null,
  chatNavigation: 0,
  messageFocus: null,
  desktopActivity: null,
  global: null,
  social: emptySocial(),
};


let savedAccountWrite:Promise<unknown>=Promise.resolve();
function persistAccounts(accounts:Account[]):void {
  // Connection metadata may persist in localStorage; bearer credentials never do.
  localStorage.setItem(ACCOUNTS_KEY,JSON.stringify(accounts.map(a=>({...a,token:""}))));
  const value=JSON.stringify(accounts);
  savedAccountWrite=savedAccountWrite.catch(()=>{}).then(()=>window.annoy?.secrets.set('accounts',value)).catch(()=>false);
}
export async function restoreSavedAccounts():Promise<void>{
  const legacy=state.accounts;
  const saved=await window.annoy?.secrets.get('accounts').catch(()=>null);
  let restored=legacy;
  if(saved){try{const value=JSON.parse(saved);if(Array.isArray(value))restored=value;}catch{}}
  state=produce(state,s=>{s.accounts=restored;});
  persistAccounts(restored);
  for(const listener of listeners)listener();
}
const listeners = new Set<() => void>();

export const getState = () => state;
configureLocalization(state.settings);

export function setState(recipe: (draft: Draft<AppState>) => void): void {
  const prev = state;
  state = produce(state, recipe);
  if (state === prev) return;
  if (state.accounts !== prev.accounts) persistAccounts(state.accounts);
  if (state.rememberedAccounts !== prev.rememberedAccounts) localStorage.setItem("annoy.rememberedAccounts", JSON.stringify(state.rememberedAccounts));
  if (state.settings !== prev.settings) localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  if(JSON.stringify(normalizeLocalization(state.settings))!==JSON.stringify(normalizeLocalization(prev.settings)))configureLocalization(state.settings);
  if (state.view !== prev.view) {
    localStorage.setItem(VIEW_KEY, JSON.stringify(state.view));
    if ("accountId" in state.view) localStorage.setItem(ACTIVE_KEY, JSON.stringify(state.view.accountId));
  }
  if (state.services !== prev.services) localStorage.setItem(SERVICES_KEY, JSON.stringify(state.services));
  for (const l of listeners) l();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Selectors must return existing references (immer keeps them stable). */
export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => selector(state),
  );
}

let toastSeq = 0;
export function toast(text: string, durationMs = 4500): void {
  const id = ++toastSeq;
  setState((s) => {
    s.toast = { id, text };
  });
  setTimeout(() => {
    if (state.toast?.id === id) setState((s) => void (s.toast = null));
  }, durationMs);
}

export function instanceOf(s: AppState, accountId: string): InstanceState | undefined {
  return s.instances[accountId];
}
