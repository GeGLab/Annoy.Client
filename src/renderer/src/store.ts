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
}

export type View =
  | { kind: "discord" }
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
  | { kind: "userSettings" };

export interface VoiceUi {
  accountId: string;
  serverId: string;
  channelId: string;
  status: "connecting" | "connected";
}

export interface Settings {
  inputMode: "vad" | "ptt";
  pttKey: string;
  vadThreshold: number;
  inputDeviceId: string;
  outputDeviceId: string;
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
  discordBadge: string | null;
  toast: { id: number; text: string } | null;
}

const ACCOUNTS_KEY = "distopic.accounts";
const SETTINGS_KEY = "distopic.settings";
const VIEW_KEY = "distopic.view";

const DEFAULT_SETTINGS: Settings = {
  inputMode: "vad",
  pttKey: "Backquote",
  vadThreshold: 18,
  inputDeviceId: "default",
  outputDeviceId: "default",
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
});

let state: AppState = {
  accounts: loadArray<Account>(ACCOUNTS_KEY),
  instances: {},
  view: load<View>(VIEW_KEY, { kind: "home", accountId: null, dmId: null }),
  modal: null,
  voice: null,
  settings: load(SETTINGS_KEY, DEFAULT_SETTINGS),
  discordBadge: null,
  toast: null,
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
  for (const l of listeners) l();
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
export function toast(text: string): void {
  const id = ++toastSeq;
  setState((s) => {
    s.toast = { id, text };
  });
  setTimeout(() => {
    if (state.toast?.id === id) setState((s) => void (s.toast = null));
  }, 4500);
}

export function instanceOf(s: AppState, accountId: string): InstanceState | undefined {
  return s.instances[accountId];
}
