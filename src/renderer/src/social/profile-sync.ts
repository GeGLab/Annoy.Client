// One profile per person: the Annoy account profile (usersannoy) is the profile.
// Friends and DMs read it from the cloud; each server signed in with the Annoy
// account gets a copy (name, bio, photo), so members see the same profile.
//
// - Carry over: fields still empty on the Annoy profile are filled once from the
//   first linked server that has them (older accounts kept name/photo on the server).
// - Copy to servers: when the Annoy profile differs from a linked server's profile,
//   the app writes it to that server. No session is touched.
import type { User } from "@annoy/protocol";
import { apiFor, applyUserUpdate } from "../client.ts";
import { getState, subscribe } from "../store.ts";
import { imageUrl } from "./cloud.ts";
import { updateProfile, uploadProfileImage } from "./index.ts";

const BIO_MAX = 190;
/** Per account: the Annoy avatar id last copied to that server ("" = no photo). */
const pushedKey = (accountId: string) => `annoy.profile-sync.avatar.${accountId}`;
const readPushed = (accountId: string): string | null => { try { return localStorage.getItem(pushedKey(accountId)); } catch { return null; } };
const writePushed = (accountId: string, avatar: string) => { try { localStorage.setItem(pushedKey(accountId), avatar); } catch { /* ignore */ } };

/** Server accounts signed in with this Annoy account, connected now. */
function linkedAccounts(annoyId: string): { accountId: string; user: User }[] {
  const s = getState();
  return s.accounts.flatMap((account) => {
    const inst = s.instances[account.id];
    const user = inst?.user;
    if (!account.annoy || inst?.status !== "ready" || !user) return [];
    // Never copy to a server user that belongs to another Annoy account.
    if (user.annoyId && user.annoyId !== annoyId) return [];
    return [{ accountId: account.id, user }];
  });
}

async function fileFrom(url: string, name: string): Promise<File> {
  const response = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(String(response.status));
  const blob = await response.blob();
  return new File([blob], name, { type: blob.type });
}

let carried = false;
/** Fills empty Annoy profile fields from a linked server, once per app run. */
async function carryOver(): Promise<void> {
  const me = getState().social.me;
  if (carried || !me) return;
  const linked = linkedAccounts(me.id);
  if (!linked.length) return;
  carried = true;
  const patch: { displayName?: string; bio?: string; avatar?: string } = {};
  const name = linked.map((item) => item.user.displayName.trim()).find((value) => value && value !== me.username);
  if (!me.displayName && name) patch.displayName = name.slice(0, 32);
  const bio = linked.map((item) => item.user.bio?.trim() ?? "").find((value) => value && value.length <= BIO_MAX);
  if (!me.bio && bio) patch.bio = bio;
  const withPhoto = linked.find((item) => item.user.avatarUrl);
  if (!me.avatar && withPhoto) {
    try {
      patch.avatar = await uploadProfileImage(await fileFrom(withPhoto.user.avatarUrl!, "avatar.webp"), "avatar");
      // That server already has this photo.
      writePushed(withPhoto.accountId, patch.avatar);
    } catch { /* keep the rest */ }
  }
  if (Object.keys(patch).length) await updateProfile(patch);
}

const running = new Set<string>();
/** Writes the Annoy profile to one linked server where it differs. */
async function pushTo(accountId: string, user: User): Promise<void> {
  const me = getState().social.me;
  if (!me || running.has(accountId)) return;
  running.add(accountId);
  try {
    const api = apiFor(accountId);
    const name = (me.displayName ?? me.username).slice(0, 32);
    const bio = me.bio ?? "";
    if (user.displayName !== name || (user.bio ?? "") !== bio) applyUserUpdate(accountId, await api.patch<User>("/users/@me", { displayName: name, bio }));
    const avatar = me.avatar ?? "";
    const pushed = readPushed(accountId);
    if (pushed === avatar && (avatar ? !!user.avatarUrl : !user.avatarUrl)) return;
    if (avatar) applyUserUpdate(accountId, await api.uploadAvatar<User>(await fileFrom(imageUrl(avatar)!, "avatar.webp")));
    else if (user.avatarUrl) applyUserUpdate(accountId, await api.patch<User>("/users/@me", { avatarUrl: null }));
    writePushed(accountId, avatar);
  } catch { /* tried again on the next change */ }
  finally { running.delete(accountId); }
}

let busy = false, again = false;
async function sync(): Promise<void> {
  if (busy) { again = true; return; }
  const s = getState();
  if (s.social.status !== "ready" || !s.social.me) return;
  busy = true;
  try {
    await carryOver().catch(() => undefined);
    const me = getState().social.me;
    if (me) for (const { accountId, user } of linkedAccounts(me.id)) await pushTo(accountId, user);
  } finally {
    busy = false;
    if (again) { again = false; void sync(); }
  }
}

let started = false;
/** Runs when the Annoy profile changes or a linked server connects. */
export function startProfileSync(): void {
  if (started) return;
  started = true;
  let lastKey = "";
  subscribe(() => {
    const s = getState();
    const me = s.social.me;
    if (s.social.status !== "ready" || !me) return;
    const ready = s.accounts.filter((account) => account.annoy && s.instances[account.id]?.status === "ready").map((account) => account.id).join(",");
    const key = `${me.id}|${me.displayName}|${me.bio}|${me.avatar}|${ready}`;
    if (key === lastKey) return;
    lastKey = key;
    void sync();
  });
}
