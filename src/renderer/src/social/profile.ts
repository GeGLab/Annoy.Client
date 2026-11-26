import { t as translate } from "../../../shared/localization/index.ts";
import { imageUrl } from "./cloud.ts";
import type { Person } from "./profiles.ts";
import type { CloudProfile } from "./types.ts";

/** The same public Annoy profile in conversations, settings and the own-user panel. */
export const cloudUser = (profile: CloudProfile | undefined, fallbackId = ""): Person => ({
  id: profile?.id ?? fallbackId,
  username: profile?.username ?? "",
  displayName: profile?.displayName || profile?.username || translate("social.unknownUser"),
  avatarUrl: imageUrl(profile?.avatar),
  bio: profile?.bio ?? "",
});

/** The own Annoy profile, read from usersannoy only; null until it arrives. */
export const ownCloudUser = (profile: CloudProfile | null): Person | null => (profile ? cloudUser(profile) : null);
