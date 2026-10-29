import type { UserActivity } from "@distopic/protocol";
import spotify from "../../assets/providers/spotify.svg";
import steam from "../../assets/providers/steam.svg";
import appleMusic from "../../assets/providers/apple-music.svg";
import { DevelopmentIcon } from "./DevelopmentIcon.tsx";

export function ProviderIcon({ provider, size = 16 }: { provider: UserActivity["provider"]; size?: number }) {
  if (!["steam", "spotify", "apple-music"].includes(provider)) return <DevelopmentIcon name={provider} size={size} />;
  return <img className={`provider-icon provider-${provider}`} src={provider === "spotify" ? spotify : provider === "apple-music" ? appleMusic : steam} width={size} height={size} alt="" aria-hidden />;
}
