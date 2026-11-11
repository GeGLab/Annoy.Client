import type { User } from "@annoy/protocol";
import { t as translate } from "../../../shared/localization/index.ts";
import { imageUrl } from "./cloud.ts";
import type { CloudProfile } from "./types.ts";

/** The same public Annoy profile in conversations, settings and the own-user panel. */
export const cloudUser = (profile: CloudProfile | undefined, fallbackId = ""): User => ({
  id: profile?.id ?? fallbackId,
  username: profile?.username ?? "",
  displayName: profile?.displayName || profile?.username || translate("social.unknownUser"),
  avatarUrl: imageUrl(profile?.avatar),
  bio: profile?.bio ?? "",
});

/** Login data is only a placeholder while usersannoy loads the public profile. */
export const ownCloudUser = (profile: CloudProfile | null, login: { id: string; name: string }): User =>
  profile ? cloudUser(profile) : { id: login.id, username: login.name, displayName: login.name, avatarUrl: null };
