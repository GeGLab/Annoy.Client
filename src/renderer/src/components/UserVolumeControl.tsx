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
    <div className="user-volume-heading"><span><Icon name={value === 0 ? "volumeOff" : "speaker"} size={15} />Volume do usuário</span><output>{value}%</output></div>
    <Slider aria-label={`Volume de ${name}`} aria-valuetext={`${value}%`} min={0} max={200} step={1} value={value}
      onChange={(event) => setUserVolume(accountId, userId, Number(event.target.value))} />
    <div className="user-volume-footer"><span>Só para você</span><button className="volume-reset" onClick={() => setUserVolume(accountId, userId, 100)} aria-label={`Restaurar volume de ${name} para 100%`}><Icon name="reset" size={12} />100%</button></div>
  </div>;
}
