import * as Popover from "@radix-ui/react-popover";
import type { User } from "@distopic/protocol";
import type { ReactNode } from "react";
import { apiFor, openDm } from "../client.ts";
import { useStore, EMPTY_ACTIVITIES } from "../store.ts";
import { startDirectCall } from "../features/direct-calls.ts";
import { ActivityCard } from "../features/activity/ActivityCard.tsx";
import { promptText } from "./ui/action-dialog.tsx";
import { act, Avatar, Icon } from "./ui.tsx";
import { Button } from "./ui/button.tsx";

export function UserProfile({ user: supplied, accountId, children }: { user: User; accountId: string; children: ReactNode }) {
  const user = useStore((s) => {
    const instance = s.instances[accountId];
    return (instance?.user?.id === supplied.id ? instance.user : instance?.relationships.find((item) => item.user.id === supplied.id)?.user ?? Object.values(instance?.serverStates ?? {}).flatMap((state) => state.members).find((member) => member.user.id === supplied.id)?.user) ?? supplied;
  });
  const rel = useStore((s) => s.instances[accountId]?.relationships.find((item) => item.user.id === user.id));
  const activities = useStore((s) => s.instances[accountId]?.user?.id === user.id ? s.settings.shareActivity ? s.desktopActivity?.activities ?? EMPTY_ACTIVITIES : EMPTY_ACTIVITIES : s.instances[accountId]?.activities[user.id] ?? EMPTY_ACTIVITIES);
  const me = useStore((s) => s.instances[accountId]?.user?.id);
  return <Popover.Root><Popover.Trigger className="profile-trigger" aria-label={`Perfil de ${rel?.nickname || user.displayName}`}>{children}</Popover.Trigger><Popover.Portal><Popover.Content className="member-card member-profile" side="right" align="start" sideOffset={10} collisionPadding={12} role="dialog" aria-label={`Perfil de ${user.displayName}`}>
    <div className="member-card-head"><Avatar user={user} size={56} /><div><strong>{rel?.nickname || user.displayName}</strong><div className="muted">@{user.username}</div></div></div>
    {user.bio && <p className="profile-bio" title={user.bio}>{user.bio}</p>}
    {rel?.nicknameByOther && <p className="muted small">Te chama de <strong>{rel.nicknameByOther}</strong></p>}
    {(me === user.id || rel?.status === "friend") && activities.map((activity) => <ActivityCard key={activity.kind} activity={activity} />)}
    {me !== user.id && <div className="profile-contact-actions"><Button size="sm" variant="secondary" onClick={() => void openDm(accountId, user.id)}><Icon name="message" />Mensagem</Button>{rel?.status === "friend" && <><Button size="sm" variant="secondary" onClick={() => void startDirectCall(accountId, user.id, false)}><Icon name="phone" />Ligar</Button><Button size="sm" variant="secondary" onClick={() => void startDirectCall(accountId, user.id, true)}><Icon name="camera" />Vídeo</Button><Button size="sm" variant="ghost" onClick={async () => { const nickname = await promptText("Apelido para seu amigo (ele poderá ver)", rel.nickname ?? ""); if (nickname !== null) void act(apiFor(accountId).patch(`/relationships/${user.id}/nickname`, { nickname: nickname.slice(0, 64) })); }}><Icon name="edit" />Editar apelido</Button></>}</div>}
  </Popover.Content></Popover.Portal></Popover.Root>;
}
