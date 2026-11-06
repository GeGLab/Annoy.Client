// Profile contacts, activity history and the Steam link of the Annoy account
// (usersannoy). They are about the person, so no server holds them.
import type { ProfileField, ProfileDetails, SteamConnectionStatus, SteamLinkBegin, SteamLinkPoll, User } from "@annoy/protocol";
import { cloud } from "./cloud.ts";
import { setState } from "../store.ts";

export type CloudProfileDetails = Omit<ProfileDetails, "user">;

export const readCloudDetails = (annoyId: string, signal?: AbortSignal) =>
  cloud<CloudProfileDetails>("users", `/v1/users/${encodeURIComponent(annoyId)}/profile-details`, { signal });

/** Same shape the server used to answer, with the server user the view already has. */
export const withUser = (details: CloudProfileDetails, user: User): ProfileDetails => ({ ...details, user });

export async function saveCloudDetails(patch: { fields?: ProfileField[]; historyEnabled?: boolean }): Promise<CloudProfileDetails> {
  const details = await cloud<CloudProfileDetails>("users", "/v1/users/@me/profile-details", { method: "PATCH", body: patch });
  bumpDetails();
  return details;
}

export async function deleteCloudHistory(): Promise<void> {
  await cloud("users", "/v1/users/@me/activity-history", { method: "DELETE" });
  bumpDetails();
}

/** Views of profile details read them again. */
export function bumpDetails(): void {
  setState((s) => { s.social.detailsRevision++; });
}

export const cloudSteam = {
  status: (signal?: AbortSignal) => cloud<SteamConnectionStatus>("users", "/v1/users/@me/steam", { signal }),
  begin: (signal?: AbortSignal) => cloud<SteamLinkBegin>("users", "/v1/steam/begin", { method: "POST", body: {}, signal }),
  poll: (handoff: string, signal?: AbortSignal) => cloud<SteamLinkPoll>("users", "/v1/steam/poll", { method: "POST", body: { handoff }, signal }),
  disconnect: (signal?: AbortSignal) => cloud<SteamConnectionStatus>("users", "/v1/users/@me/steam", { method: "DELETE", signal }),
  activity: (signal?: AbortSignal) => cloud<{ activities: import("@annoy/protocol").UserActivity[] }>("users", "/v1/users/@me/steam/activity", { signal }),
};
