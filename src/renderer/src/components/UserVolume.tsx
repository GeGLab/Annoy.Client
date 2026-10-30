import { UserVolumeControl } from "./UserVolumeControl.tsx";

export function UserVolume({ accountId, userId, name = "usuário" }: { accountId: string; userId: string; name?: string }) {
  return <div className="user-volume"><UserVolumeControl accountId={accountId} userId={userId} name={name} /></div>;
}
