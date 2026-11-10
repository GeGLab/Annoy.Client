import {rich} from "../lib/localization.ts";
import {t as translate} from "../../../shared/localization/index.ts";
import {FullProfileButton} from "./FullProfile.tsx";
import { canViewActivity } from "../features/activity/access.ts";
import * as Popover from "@radix-ui/react-popover";
import type { User } from "@annoy/protocol";
import { useRef, useState, type ReactNode } from "react";
import { apiFor, openDm } from "../client.ts";
import { useStore, EMPTY_ACTIVITIES } from "../store.ts";
import { startDirectCall } from "../features/direct-calls.ts";
import { ActivityStack } from "../features/activity/ActivityCard.tsx";
import { promptText } from "./ui/action-dialog.tsx";
import { act, Avatar, Icon } from "./ui.tsx";
import { UserVolume } from "./UserVolume.tsx";
import { Button } from "./ui/button.tsx";
import { setFriendNickname } from "../social/index.ts";

/**
 * The friendship with `user` as seen from `accountId`: from the server, or from
 * the Annoy cloud on Annoy-account servers (TODO item 1). `editNickname` asks for
 * the private friend nickname and saves it in the right place.
 */
function useFriend(accountId: string, user: User) {
  const serverRel = useStore((s) => s.instances[accountId]?.relationships.find((item) => item.user.id === user.id));
  const cloudRel = useStore((s) => (s.instances[accountId]?.instance?.annoySocial && user.annoyId ? s.social.relationships.find((item) => item.user.id === user.annoyId) : undefined));
  const rel = serverRel ?? (cloudRel && { user, status: cloudRel.status, nickname: cloudRel.nickname ?? undefined });
  const editNickname = async () => {
    const nickname = await promptText(translate("common.91e4e0317865"), rel?.nickname ?? "");
    if (nickname === null) return;
    void act(cloudRel ? setFriendNickname(cloudRel.user.id, nickname.slice(0, 64) || null) : apiFor(accountId).patch(`/relationships/${user.id}/nickname`, { nickname: nickname.slice(0, 64) }));
  };
  return { rel, editNickname };
}

export function UserProfile({ user: supplied, accountId, children }: { user: User; accountId: string; children: ReactNode }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const user = useStore((s) => {
    const instance = s.instances[accountId];
    return (instance?.user?.id === supplied.id ? instance.user : instance?.relationships.find((item) => item.user.id === supplied.id)?.user ?? Object.values(instance?.serverStates ?? {}).flatMap((state) => state.members).find((member) => member.user.id === supplied.id)?.user) ?? supplied;
  });
  const instance = useStore((s) => s.instances[accountId]);
  const { rel, editNickname } = useFriend(accountId, user);
  const activities = useStore((s) => s.instances[accountId]?.user?.id === user.id ? s.settings.shareActivity ? s.desktopActivity?.activities ?? EMPTY_ACTIVITIES : EMPTY_ACTIVITIES : s.instances[accountId]?.activities[user.id] ?? EMPTY_ACTIVITIES);
  const me = useStore((s) => s.instances[accountId]?.user?.id);
  return <Popover.Root open={open} onOpenChange={setOpen}><Popover.Trigger ref={trigger} className="profile-trigger" aria-label={translate("common.bb51fa235d84",{p0:(rel?.nickname || user.displayName)})}>{children}</Popover.Trigger><Popover.Portal container={trigger.current?.ownerDocument.body}><Popover.Content className="member-card member-profile" side="right" align="start" sideOffset={10} collisionPadding={12} role="dialog" aria-label={translate("common.bb51fa235d84",{p0:(user.displayName)})}>
    <div className="member-card-head"><Avatar user={user} size={56} /><div><strong>{rel?.nickname || user.displayName}</strong><div className="muted">@{user.username}</div></div></div>
    {user.bio && <p className="profile-bio" title={user.bio}>{user.bio}</p>}
    <FullProfileButton accountId={accountId} user={user}/>
    {canViewActivity(instance, user.id) && <ActivityStack activities={activities} />}
    {me !== user.id && <UserVolume accountId={accountId} userId={user.id} name={user.displayName} />}
    {me !== user.id && <div className="profile-contact-actions"><Button size="sm" variant="secondary" onClick={() => void openDm(accountId, user.id)}>{rich("common.6d036fbeb731",{p0:(<Icon name="message" />)})}</Button>{rel?.status === "friend" && <><Button size="sm" variant="secondary" onClick={() => void startDirectCall(accountId, user.id, false)}>{rich("common.31a3bb10b8b1",{p0:(<Icon name="phone" />)})}</Button><Button size="sm" variant="secondary" onClick={() => void startDirectCall(accountId, user.id, true)}>{rich("common.d9ab20219407",{p0:(<Icon name="camera" />)})}</Button><Button size="sm" variant="ghost" onClick={() => void editNickname()}>{rich("common.d7cbba741f05",{p0:(<Icon name="edit" />)})}</Button></>}</div>}
  </Popover.Content></Popover.Portal></Popover.Root>;
}


export function DmProfile({ user: supplied, accountId }: { user: User; accountId: string }) {
  const instance = useStore((s) => s.instances[accountId]);
  const user = instance?.relationships.find((item) => item.user.id === supplied.id)?.user ?? supplied;
  const { rel: relationship, editNickname } = useFriend(accountId, user);
  const activities = canViewActivity(instance, user.id) ? instance?.activities[user.id] ?? EMPTY_ACTIVITIES : EMPTY_ACTIVITIES;
  const presence = instance?.presences[user.id] ?? "offline";
  return <aside className="dm-profile" aria-label={translate("common.bb51fa235d84",{p0:(user.displayName)})}>
    <div className="dm-profile-banner" />
    <div className="dm-profile-content">
      <Avatar user={user} size={72} presence={presence} />
      <h2>{relationship?.nickname || user.displayName}</h2><p className="muted">@{user.username}</p>
      <span className="dm-profile-presence">{presence === "online" ? translate("common.0d21bd52022c") : presence === "idle" ? translate("common.fd7f0836e8ad") : presence === "dnd" ? translate("common.976685dd88bf") : translate("common.a1794783aab7")}</span>
      {user.bio && <section><h3>{translate("common.4cadb7f9efaa")}</h3><p className="dm-profile-bio">{user.bio}</p></section>}
      {activities.length > 0 && <section><h3>{translate("common.dff6624256ba")}</h3><ActivityStack activities={activities} /></section>}
      <FullProfileButton accountId={accountId} user={user}/>
      <UserVolume accountId={accountId} userId={user.id} name={user.displayName} />
      {relationship?.status === "friend" && <Button variant="secondary" onClick={() => void editNickname()}>{rich("common.d7cbba741f05",{p0:(<Icon name="edit" />)})}</Button>}
    </div>
  </aside>;
}




