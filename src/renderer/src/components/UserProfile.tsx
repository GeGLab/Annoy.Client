import {FullProfileButton} from "./FullProfile.tsx";
import { canViewActivity } from "../features/activity/access.ts";
import * as Popover from "@radix-ui/react-popover";
import type { User } from "@distopic/protocol";
import type { ReactNode } from "react";
import { apiFor, openDm } from "../client.ts";
import { useStore, EMPTY_ACTIVITIES } from "../store.ts";
import { startDirectCall } from "../features/direct-calls.ts";
import { ActivityStack } from "../features/activity/ActivityCard.tsx";
import { promptText } from "./ui/action-dialog.tsx";
import { act, Avatar, Icon } from "./ui.tsx";
import { UserVolume } from "./UserVolume.tsx";
import { Button } from "./ui/button.tsx";

export function UserProfile({ user: supplied, accountId, children }: { user: User; accountId: string; children: ReactNode }) {
  const user = useStore((s) => {
    const instance = s.instances[accountId];
    return (instance?.user?.id === supplied.id ? instance.user : instance?.relationships.find((item) => item.user.id === supplied.id)?.user ?? Object.values(instance?.serverStates ?? {}).flatMap((state) => state.members).find((member) => member.user.id === supplied.id)?.user) ?? supplied;
  });
  const instance = useStore((s) => s.instances[accountId]);
  const rel = useStore((s) => s.instances[accountId]?.relationships.find((item) => item.user.id === user.id));
  const activities = useStore((s) => s.instances[accountId]?.user?.id === user.id ? s.settings.shareActivity ? s.desktopActivity?.activities ?? EMPTY_ACTIVITIES : EMPTY_ACTIVITIES : s.instances[accountId]?.activities[user.id] ?? EMPTY_ACTIVITIES);
  const me = useStore((s) => s.instances[accountId]?.user?.id);
  return <Popover.Root><Popover.Trigger className="profile-trigger" aria-label={`Perfil de ${rel?.nickname || user.displayName}`}>{children}</Popover.Trigger><Popover.Portal><Popover.Content className="member-card member-profile" side="right" align="start" sideOffset={10} collisionPadding={12} role="dialog" aria-label={`Perfil de ${user.displayName}`}>
    <div className="member-card-head"><Avatar user={user} size={56} /><div><strong>{rel?.nickname || user.displayName}</strong><div className="muted">@{user.username}</div></div></div>
    {user.bio && <p className="profile-bio" title={user.bio}>{user.bio}</p>}
    {rel?.nicknameByOther && <p className="muted small">Te chama de <strong>{rel.nicknameByOther}</strong></p>}
    <FullProfileButton accountId={accountId} user={user}/>
    {canViewActivity(instance, user.id) && <ActivityStack activities={activities} />}
    {me !== user.id && <UserVolume accountId={accountId} userId={user.id} name={user.displayName} />}
    {me !== user.id && <div className="profile-contact-actions"><Button size="sm" variant="secondary" onClick={() => void openDm(accountId, user.id)}><Icon name="message" />Mensagem</Button>{rel?.status === "friend" && <><Button size="sm" variant="secondary" onClick={() => void startDirectCall(accountId, user.id, false)}><Icon name="phone" />Ligar</Button><Button size="sm" variant="secondary" onClick={() => void startDirectCall(accountId, user.id, true)}><Icon name="camera" />Vídeo</Button><Button size="sm" variant="ghost" onClick={async () => { const nickname = await promptText("Apelido para seu amigo (ele poderá ver)", rel.nickname ?? ""); if (nickname !== null) void act(apiFor(accountId).patch(`/relationships/${user.id}/nickname`, { nickname: nickname.slice(0, 64) })); }}><Icon name="edit" />Editar apelido</Button></>}</div>}
  </Popover.Content></Popover.Portal></Popover.Root>;
}


export function DmProfile({ user: supplied, accountId }: { user: User; accountId: string }) {
  const instance = useStore((s) => s.instances[accountId]);
  const relationship = instance?.relationships.find((item) => item.user.id === supplied.id);
  const user = relationship?.user ?? supplied;
  const activities = canViewActivity(instance, user.id) ? instance?.activities[user.id] ?? EMPTY_ACTIVITIES : EMPTY_ACTIVITIES;
  const presence = instance?.presences[user.id] ?? "offline";
  return <aside className="dm-profile" aria-label={`Perfil de ${user.displayName}`}>
    <div className="dm-profile-banner" />
    <div className="dm-profile-content">
      <Avatar user={user} size={72} presence={presence} />
      <h2>{relationship?.nickname || user.displayName}</h2><p className="muted">@{user.username}</p>
      <span className="dm-profile-presence">{presence === "online" ? "Online" : presence === "idle" ? "Ausente" : presence === "dnd" ? "N\u00e3o incomodar" : "Offline"}</span>
      {user.bio && <section><h3>Sobre mim</h3><p className="dm-profile-bio">{user.bio}</p></section>}
      {relationship?.nicknameByOther && <p className="muted small">Te chama de <strong>{relationship.nicknameByOther}</strong></p>}
      {activities.length > 0 && <section><h3>Atividades</h3><ActivityStack activities={activities} /></section>}
      <FullProfileButton accountId={accountId} user={user}/>
      <UserVolume accountId={accountId} userId={user.id} name={user.displayName} />
      {relationship?.status === "friend" && <Button variant="secondary" onClick={async () => { const nickname = await promptText("Apelido para seu amigo (ele poderá ver)", relationship.nickname ?? ""); if (nickname !== null) void act(apiFor(accountId).patch(`/relationships/${user.id}/nickname`, { nickname: nickname.slice(0, 64) })); }}><Icon name="edit" />Editar apelido</Button>}
    </div>
  </aside>;
}
