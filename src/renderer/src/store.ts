import type {
  DmChannel,
  GatewayEvent,
  ImportJob,
  Message,
  Presence,
  Relationship,
  ServerState,
  ServerSummary,
  User,
} from "@distopic/protocol";
import { produce, type Draft } from "immer";
import { CATALOG, type Service, type TabDisplay, type TabPlacement } from "../../shared/services.ts";
import type { UpdateState } from "../../shared/update.ts";
import type { NoiseFilter } from "./noise.ts";
import { useSyncExternalStore } from "react";

export interface Account {
  /** Local id: one account per (instance URL, user). */
  id: string;
  url: string;
  token: string;
  userId: string;
  instanceName: string;
  /** First observed connection failure; cleared as soon as the server responds. */
  offlineSince?: number;
}
export type RememberedAccount = Omit<Account, "token"> & { username: string; displayName: string; avatarUrl: string | null };

export interface ChannelMessages {
  items: Message[];
  hasMore: boolean;
  loading: boolean;
}

export interface InstanceState {
  status: "connecting" | "ready" | "offline" | "invalid";
  user: User | null;
  servers: ServerSummary[];
  serverStates: Record<string, ServerState>;
  dms: DmChannel[];
  relationships: Relationship[];
  presences: Record<string, Presence>;
  activities: Record<string, import("@distopic/protocol").UserActivity[]>;
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
  /** A browser service (Discord, WhatsApp…) or a TeamSpeak launcher. */
  | { kind: "service"; serviceId: string }
  | { kind: "marketplace"; accountId: string | null; serverId: string | null }
  | { kind: "home"; accountId: string | null; dmId: string | null }
  | { kind: "server"; accountId: string; serverId: string; channelId: string | null };

export type CreatableChannel = "text" | "voice" | "category" | "files" | "code" | "theater" | "song";

export type Modal =
  | { kind: "addAccount"; rememberedId?: string }
  | { kind: "switchAccount" }
  | { kind: "search"; accountId: string; serverId?: string; channelId?: string }
  | { kind: "createServer"; accountId: string }
  | { kind: "serverSettings"; accountId: string; serverId: string }
  | { kind: "channelSettings"; accountId: string; serverId: string; channelId: string }
  | { kind: "createChannel"; accountId: string; serverId: string; parentId: string | null; type: CreatableChannel }
  | { kind: "invite"; accountId: string; serverId: string }
  | { kind: "importDiscord"; accountId: string; serverId: string | null }
  | { kind: "userSettings"; section?: "voice" | "expressions" }
  | { kind: "screenPicker" }
  | { kind: "instanceAdmin"; accountId: string }
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
}

export interface Settings {
  theme: "dark" | "light" | "system";
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
  selfMute: boolean;
  selfDeaf: boolean;
  notifications: boolean;
  messageSounds: boolean;
  mutedServers: string[];
  mutedChannels: string[];
  noiseFilter: NoiseFilter;
  /** Local playback percentages, scoped to [account ID, remote user ID]. */
  userVolumes: Record<string, number>;
  dmProfileOpen: boolean;
  /** Defaults for service tabs; each tab can override them. */
  servicePlacement: TabPlacement;
  serviceDisplay: TabDisplay;
  /** Where the community bar sits: down the left side or across the top. */
  barPosition: "side" | "top";
  /** "Usar como conta padrão" (Annoy Global): new servers sign in with it first. */
  globalDefault: boolean;
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
  directCall: { accountId: string; call: import("@distopic/protocol").DirectCall } | null;
  rememberedAccounts: RememberedAccount[];
  recentMessages: Record<string, { own: boolean; at: number }>;
  accounts: Account[];
  instances: Record<string, InstanceState>;
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
  /** The signed-in Annoy Global account, if any (keys stay in global.ts, never in the store). */
  global: GlobalAccount | null;
}

export interface GlobalAccount {
  id: string;
  name: string;
  email: string;
}

const ACCOUNTS_KEY = "distopic.accounts";
export const EMPTY_ACTIVITIES: readonly import("@distopic/protocol").UserActivity[] = [];
const SETTINGS_KEY = "distopic.settings";
const VIEW_KEY = "distopic.view";
const SERVICES_KEY = "distopic.services";

const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  accentColor: null,
  surfaceColor: null,
  channelsWidth: 252,
  membersWidth: 220,
  channelsOpen: true,
  membersOpen: true,
  inputMode: "vad",
  pttKey: "Backquote",
  vadThreshold: 18,
  inputDeviceId: "default",
  outputDeviceId: "default",
  cameraDeviceId: "default",
  selfMute: false,
  selfDeaf: false,
  notifications: true,
  messageSounds: true,
  mutedServers: [],
  mutedChannels: [],
  noiseFilter: "rnnoise",
  userVolumes: {},
  dmProfileOpen: true,
  servicePlacement: "before",
  serviceDisplay: "full",
  barPosition: "side",
  globalDefault: false,
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
    if (key === "distopic.settings" && saved.screenFps === undefined && saved.screenQuality) {
      saved.screenFps = saved.screenQuality === "max" ? 0 : Number(saved.screenQuality);
      if (saved.screenQuality === "max") saved.screenHeight = 0;
    }
    return { ...fallback, ...saved } as T;
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
  user: null,
  servers: [],
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
  directCall: null,
  rememberedAccounts: loadArray<RememberedAccount>("distopic.rememberedAccounts"),
  recentMessages: {},
  accounts: loadArray<Account>(ACCOUNTS_KEY),
  instances: {},
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
};

const listeners = new Set<() => void>();

export const getState = () => state;

export function setState(recipe: (draft: Draft<AppState>) => void): void {
  const prev = state;
  state = produce(state, recipe);
  if (state === prev) return;
  if (state.accounts !== prev.accounts) localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(state.accounts));
  if (state.rememberedAccounts !== prev.rememberedAccounts) localStorage.setItem("distopic.rememberedAccounts", JSON.stringify(state.rememberedAccounts));
  if (state.settings !== prev.settings) localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  if (state.view !== prev.view) localStorage.setItem(VIEW_KEY, JSON.stringify(state.view));
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
