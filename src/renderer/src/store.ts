import type {
  DmChannel,
  ImportJob,
  Message,
  Presence,
  Relationship,
  ServerState,
  ServerSummary,
  User,
} from "@distopic/protocol";
import { produce, type Draft } from "immer";
import { CATALOG, type Service } from "../../shared/services.ts";
import type { UpdateState } from "../../shared/update.ts";
import { useSyncExternalStore } from "react";

export interface Account {
  /** Local id: one account per (instance URL, user). */
  id: string;
  url: string;
  token: string;
  userId: string;
  instanceName: string;
}

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
  messages: Record<string, ChannelMessages>;
  /** channelId -> userId -> expiry timestamp */
  typing: Record<string, Record<string, number>>;
  unread: Record<string, { count: number; mention: boolean }>;
  imports: Record<string, ImportJob>;
  /** This account's role on the instance, from READY. */
  instance: { isAdmin: boolean; registration: "open" | "invite" | "closed"; voiceBackend: "builtin" | "cloudflare" } | null;
}

export type View =
  /** A browser service (Discord, WhatsApp…) or a TeamSpeak launcher. */
  | { kind: "service"; serviceId: string }
  | { kind: "home"; accountId: string | null; dmId: string | null }
  | { kind: "server"; accountId: string; serverId: string; channelId: string | null };

export type Modal =
  | { kind: "addAccount" }
  | { kind: "createServer"; accountId: string }
  | { kind: "serverSettings"; accountId: string; serverId: string }
  | { kind: "channelSettings"; accountId: string; serverId: string; channelId: string }
  | { kind: "createChannel"; accountId: string; serverId: string; parentId: string | null; type: "text" | "voice" | "category" }
  | { kind: "invite"; accountId: string; serverId: string }
  | { kind: "importDiscord"; accountId: string; serverId: string | null }
  | { kind: "userSettings" }
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
  inputMode: "vad" | "ptt";
  pttKey: string;
  vadThreshold: number;
  inputDeviceId: string;
  outputDeviceId: string;
  cameraDeviceId: string;
  selfMute: boolean;
  selfDeaf: boolean;
  notifications: boolean;
}

export interface AppState {
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
}

const ACCOUNTS_KEY = "distopic.accounts";
const SETTINGS_KEY = "distopic.settings";
const VIEW_KEY = "distopic.view";
const SERVICES_KEY = "distopic.services";

const DEFAULT_SETTINGS: Settings = {
  inputMode: "vad",
  pttKey: "Backquote",
  vadThreshold: 18,
  inputDeviceId: "default",
  outputDeviceId: "default",
  cameraDeviceId: "default",
  selfMute: false,
  selfDeaf: false,
  notifications: true,
};

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
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
  return view.kind === "discord" ? { kind: "service", serviceId: "discord" } : view;
}

let state: AppState = {
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
};

const listeners = new Set<() => void>();

export const getState = () => state;

export function setState(recipe: (draft: Draft<AppState>) => void): void {
  const prev = state;
  state = produce(state, recipe);
  if (state === prev) return;
  if (state.accounts !== prev.accounts) localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(state.accounts));
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
