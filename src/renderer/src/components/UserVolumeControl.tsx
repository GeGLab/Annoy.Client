import {rich} from "../lib/localization.ts";
import {t as translate} from "../../../shared/localization/index.ts";
import { setUserVolume } from "../client.ts";
import { useStore } from "../store.ts";
import { MAX_USER_VOLUME, playbackVolume, type VolumeKind } from "../../../shared/user-volume.ts";
import { Slider } from "./ui/slider.tsx";
import { Icon } from "./ui.tsx";

/** `kind` "stream" is the sound of the person's screen share, kept apart from their voice. */
export function UserVolumeControl({ accountId, userId, name, kind = "voice" }: {
  accountId: string; userId: string; name: string; kind?: VolumeKind;
}) {
  const value = useStore((s) => playbackVolume(s.settings, kind, accountId, userId));
  const icon = <Icon name={value === 0 ? "volumeOff" : kind === "stream" ? "monitor" : "speaker"} size={15} />;
  return <div className="user-volume-control" onKeyDown={(event) => {
    // Let the slider use arrows/Home/End and native Tab without the surrounding menu handling them.
    if (event.key !== "Escape") event.stopPropagation();
  }}>
    <div className="user-volume-heading"><span>{kind === "stream" ? rich("voice.streamVolume", { p0: icon }) : rich("common.3b5906012111", { p0: icon })}</span><output>{value}%</output></div>
    <Slider aria-label={kind === "stream" ? translate("voice.streamVolumeOf", { p0: name }) : translate("common.695ed8139a63",{p0:(name)})} aria-valuetext={translate("common.d4bdf581de91",{p0:(value)})} min={0} max={MAX_USER_VOLUME} step={1} value={value}
      onChange={(event) => setUserVolume(accountId, userId, Number(event.target.value), kind)} />
  </div>;
}
