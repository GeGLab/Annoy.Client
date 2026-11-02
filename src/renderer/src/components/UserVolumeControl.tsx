import {rich} from "../lib/localization.ts";
import {t as translate} from "../../../shared/localization/index.ts";
import { setUserVolume } from "../client.ts";
import { useStore } from "../store.ts";
import { userVolume } from "../../../shared/user-volume.ts";
import { Slider } from "./ui/slider.tsx";
import { Icon } from "./ui.tsx";

export function UserVolumeControl({ accountId, userId, name }: {
  accountId: string; userId: string; name: string;
}) {
  const value = useStore((s) => userVolume(s.settings.userVolumes, accountId, userId));
  return <div className="user-volume-control" onKeyDown={(event) => {
    // Let the slider use arrows/Home/End and native Tab without the surrounding menu handling them.
    if (event.key !== "Escape") event.stopPropagation();
  }}>
    <div className="user-volume-heading"><span>{rich("common.3b5906012111",{p0:(<Icon name={value === 0 ? "volumeOff" : "speaker"} size={15} />)})}</span><output>{value}%</output></div>
    <Slider aria-label={translate("common.695ed8139a63",{p0:(name)})} aria-valuetext={translate("common.d4bdf581de91",{p0:(value)})} min={0} max={200} step={1} value={value}
      onChange={(event) => setUserVolume(accountId, userId, Number(event.target.value))} />
  </div>;
}


