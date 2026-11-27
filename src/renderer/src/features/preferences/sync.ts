import { normalizeAppIcon } from "../../../../shared/app-icon.ts";
import { unlockedKeys } from "../../auth/session.ts";
import { b64url, fromB64url } from "../../global-crypto.ts";
import { validColor } from "../../lib/appearance.ts";
import { THEME_PRESETS } from "../../lib/theme-presets.ts";
import { cloud, CloudError } from "../../social/cloud.ts";
import { getState, setState, subscribe, type Settings } from "../../store.ts";

/**
 * Aparência follows the Annoy account on every install (desktop, Android, web app).
 * usersannoy keeps bytes it can't open: the values are sealed here with a key
 * derived from the account's vault key, as the integrations are.
 * The first time an install meets the account, its own values win and go up;
 * from then on every change goes up and the other installs apply it at once.
 */
export const SYNCED_FIELDS = ["theme", "themePreset", "accentColor", "surfaceColor", "appIcon", "glassBlur", "glassTransparency", "displayMode"] as const;
export type SyncedPreferences = Pick<Settings, (typeof SYNCED_FIELDS)[number]>;

const LABEL = "annoy-preferences/account/v1";
const PAD = 512;
/** Accounts this install already synced with; kept on sign-out (auth/session.ts KEEP). */
export const SYNCED_KEY = "annoy.preferencesSynced";
const WRITE_DELAY = 800;
const enc = new TextEncoder();

let generation = 0;
let version = 0;
let account: string | null = null;
/** Last values the account holds, as JSON: a store change equal to it goes nowhere. */
let known: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;

export function pick(settings: Settings): SyncedPreferences {
  return Object.fromEntries(SYNCED_FIELDS.map((key) => [key, settings[key]])) as SyncedPreferences;
}

const number = (value: unknown, min: number, max: number, step = 1): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value / step) * step)) : undefined;

/** Only well-formed values from the account reach the settings; anything else keeps this install's value. */
export function normalizePreferences(raw: unknown): Partial<SyncedPreferences> {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Partial<SyncedPreferences> = {};
  if (r.theme === "dark" || r.theme === "light" || r.theme === "system") out.theme = r.theme;
  const preset = THEME_PRESETS.find((p) => p.id === r.themePreset);
  if (preset) out.themePreset = preset.id;
  if (r.accentColor === null || validColor(r.accentColor)) out.accentColor = r.accentColor as string | null;
  if (r.surfaceColor === null || validColor(r.surfaceColor)) out.surfaceColor = r.surfaceColor as string | null;
  if (typeof r.appIcon === "string") out.appIcon = normalizeAppIcon(r.appIcon);
  const blur = number(r.glassBlur, 0, 30);
  if (blur !== undefined) out.glassBlur = blur;
  const transparency = number(r.glassTransparency, 0, 90, 5);
  if (transparency !== undefined) out.glassTransparency = transparency;
  if (r.displayMode === "auto" || r.displayMode === "desktop" || r.displayMode === "mobile") out.displayMode = r.displayMode;
  return out;
}

async function dataKey(): Promise<CryptoKey> {
  const keys = unlockedKeys();
  if (!keys) throw new Error("locked");
  const material = await crypto.subtle.importKey("raw", keys.vault as BufferSource, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: enc.encode(LABEL) }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function seal(value: SyncedPreferences): Promise<string> {
  const json = enc.encode(JSON.stringify(value));
  const padded = new Uint8Array(Math.ceil((json.length + 4) / PAD) * PAD);
  new DataView(padded.buffer).setUint32(0, json.length);
  padded.set(json, 4);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(LABEL) }, await dataKey(), padded));
  const out = new Uint8Array(13 + body.length);
  out[0] = 1;
  out.set(iv, 1);
  out.set(body, 13);
  return b64url(out);
}

async function open(sealed: string): Promise<Partial<SyncedPreferences>> {
  const bytes = fromB64url(sealed);
  if (bytes[0] !== 1) throw new Error("format");
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(1, 13), additionalData: enc.encode(LABEL) }, await dataKey(), bytes.subarray(13)));
  const length = new DataView(plain.buffer, plain.byteOffset).getUint32(0);
  return normalizePreferences(JSON.parse(new TextDecoder().decode(plain.subarray(4, 4 + length))));
}

async function read(): Promise<Partial<SyncedPreferences> | null> {
  const data = await cloud<{ version: number; data: string | null }>("users", "/v1/users/@me/preferences");
  version = data.version;
  return data.data ? open(data.data) : null;
}

function syncedAccounts(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(SYNCED_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function markSynced(id: string): void {
  const list = syncedAccounts();
  if (list.includes(id)) return;
  try {
    localStorage.setItem(SYNCED_KEY, JSON.stringify([...list, id]));
  } catch {
    /* Next start counts as the first one again: this install's values go up again. */
  }
}

function apply(values: Partial<SyncedPreferences>): void {
  setState((s) => void Object.assign(s.settings, values));
  known = JSON.stringify(pick(getState().settings));
}

let writing: Promise<void> = Promise.resolve();
/** Sends this install's values; a newer copy from another install is read first and then overwritten (last change wins). */
function write(): Promise<void> {
  const run = async () => {
    const mine = generation;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (mine !== generation) return;
      const values = pick(getState().settings);
      const json = JSON.stringify(values);
      try {
        const saved = await cloud<{ version: number }>("users", "/v1/users/@me/preferences", { method: "PUT", body: { data: await seal(values), baseVersion: version } });
        if (mine !== generation) return;
        version = saved.version;
        known = json;
        return;
      } catch (error) {
        if (!(error instanceof CloudError) || error.status !== 409) throw error;
        await read().catch(() => undefined);
      }
    }
  };
  const result = writing.then(run);
  writing = result.catch(() => undefined);
  return result;
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void write().catch((error) => console.warn("preferences sync failed", (error as Error).message));
  }, WRITE_DELAY);
}

/** Signed in to the Annoy account (social/index.ts start). */
export async function startPreferences(me: string): Promise<void> {
  stopPreferences();
  const mine = ++generation;
  account = me;
  try {
    const remote = await read();
    if (mine !== generation) return;
    if (remote && syncedAccounts().includes(me)) apply(remote);
    else await write();
    if (mine !== generation) return;
    markSynced(me);
  } catch (error) {
    if (mine !== generation) return;
    console.warn("preferences sync unavailable", (error as Error).message);
  }
  if (mine !== generation) return;
  known ??= JSON.stringify(pick(getState().settings));
  unsubscribe = subscribe(() => {
    if (account !== me || JSON.stringify(pick(getState().settings)) === known) return;
    schedule();
  });
}

export function stopPreferences(): void {
  generation++;
  account = null;
  version = 0;
  known = null;
  if (timer) clearTimeout(timer);
  timer = null;
  unsubscribe?.();
  unsubscribe = null;
}

/** Another install of the account changed them (PREFERENCES_CHANGED). */
export async function preferencesChanged(eventVersion?: number): Promise<void> {
  const mine = generation;
  if (!account || (typeof eventVersion === "number" && eventVersion <= version)) return;
  try {
    const remote = await read();
    // A change typed here and not sent yet wins over the one that just arrived.
    if (mine === generation && remote && !timer) apply(remote);
  } catch {
    /* The next start reads them again. */
  }
}
