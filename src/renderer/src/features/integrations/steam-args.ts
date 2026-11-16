import { t as translate } from "../../../../shared/localization/index.ts";
import { cloudSteam, readCloudDetails } from "../../social/details.ts";

/** The Steam account linked to this Annoy account, if any. */
export const ownSteam = (): Promise<string | null> => cloudSteam.status().then((s) => s.connection?.steamId ?? null, () => null);

/** Own Steam or an explanation, for a mention of oneself. */
export const ownSteamOrFail = async (): Promise<string> => {
  const own = await ownSteam();
  if (!own) throw new Error(translate("integrations.steamArgs.linkFirst"));
  return own;
};

/**
 * Someone's Steam account for a command, if they show it to the sender. In a server channel
 * only an account shown to the communities in common goes, since everyone there reads it.
 */
export async function steamOfAnnoy(annoyId: string | null, name: string, place: "dm" | "channel"): Promise<string> {
  if (!annoyId) throw new Error(translate("integrations.steamArgs.noAnnoy", { p0: name }));
  const steam = (await readCloudDetails(annoyId)).steam;
  if (!steam || (place === "channel" && steam.audience !== "community")) throw new Error(translate("integrations.steamArgs.hidden", { p0: name }));
  return steam.steamId;
}
