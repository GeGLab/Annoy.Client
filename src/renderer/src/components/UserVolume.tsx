import {t as translate} from "../../../shared/localization/index.ts";
import { UserVolumeControl } from "./UserVolumeControl.tsx";

export function UserVolume({ accountId, userId, name = translate("common.c4197364c8d5") }: { accountId: string; userId: string; name?: string }) {
  return <div className="user-volume"><UserVolumeControl accountId={accountId} userId={userId} name={name} /></div>;
}


