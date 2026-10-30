import { useId } from "react";
import { Slider } from "./ui/slider.tsx";
import { useUserVolume, setUserVolume } from "../lib/user-volume.ts";
export function UserVolume({ accountId, userId }: { accountId: string; userId: string }) {
  const value = useUserVolume(accountId, userId);
  const id = useId();
  return <div className="user-volume"><label id={id}>Volume para você <output>{value}%</output></label><Slider aria-labelledby={id} aria-label="Volume da voz deste usuário" value={value} onChange={(event) => setUserVolume(accountId, userId, Number(event.target.value))} /><small>Salvo neste dispositivo. Só altera o que você ouve.</small></div>;
}
