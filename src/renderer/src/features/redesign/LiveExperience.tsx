import { useState } from "react";
import { has, Permission, type ServerState } from "@annoy/protocol";
import { t } from "../../../../shared/localization/index.ts";
import { joinVoice, navigate, openChannel, openDm } from "../../client.ts";
import { useStore, toast } from "../../store.ts";
import { cloudUser } from "../../social/profile.ts";
import { openDmWith } from "../../social/dms.ts";
import { channelPerms, displayNameOf } from "../../perms.ts";
import { Avatar, Icon, openModal } from "../../components/ui.tsx";
import { Scenery } from "./Scenery.tsx";

export function CommunityCover({ state }: { state: ServerState }) {
  return <>
    <Scenery className="live-cover-art" />
    <span className="live-cover-eyebrow"><Icon name="radio" size={12}/>{t("redesign.communityEyebrow")}</span>
    <span className="live-community-identity">
      <span className="live-community-mark">{state.server.iconUrl ? <img src={state.server.iconUrl} alt=""/> : <Icon name="radio" size={21}/>}</span>
      <strong className="truncate">{state.server.name}</strong>
      <Icon name="chevron" size={16}/>
    </span>
  </>;
}

export function CommunitySummary({ accountId, state }: { accountId: string; state: ServerState }) {
  const connected = useStore(s => s.instances[accountId]?.status === "ready");
  const online = state.members.filter(member => member.presence !== "offline").length;
  return <div className="live-community-summary">
    <span><i className={connected ? "live-dot" : "live-dot offline"}/>{t("redesign.onlineCount", { p0: connected ? online : 0 })}</span>
    <span>{t("redesign.memberCount", { p0: state.membersTotal ?? state.members.length })}</span>
    {has(state.permissions, Permission.CREATE_INVITE) && <button type="button" className="icon-btn tiny" aria-label={t("redesign.invite")} disabled={!connected} onClick={() => openModal({ kind: "invite", accountId, serverId: state.server.id })}><Icon name="plus" size={15}/></button>}
  </div>;
}

export function CommunityWelcome({ accountId, state }: { accountId: string; state: ServerState }) {
  const [dismissed, setDismissed] = useState(false);
  const connected = useStore(s => s.instances[accountId]?.status === "ready");
  if (dismissed) return null;
  return <section className="live-conversation-welcome" aria-label={t("redesign.welcomeLabel")}>
    <Scenery/>
    <div className="live-welcome-shade"/>
    <div className="live-welcome-copy"><span className="live-eyebrow"><Icon name="radio" size={12}/>{state.server.name}</span><h2>{t("redesign.welcomeTitle")}</h2><p>{t("redesign.welcomeBody")}</p>
      {has(state.permissions, Permission.CREATE_INVITE) && <button disabled={!connected} onClick={() => openModal({ kind: "invite", accountId, serverId: state.server.id })}>{t("redesign.invite")}<Icon name="external" size={12}/></button>}
    </div>
    <button className="icon-btn live-welcome-dismiss" aria-label={t("redesign.dismissWelcome")} onClick={() => setDismissed(true)}><Icon name="x" size={14}/></button>
  </section>;
}

export function CommunityPulse({ accountId, state, me }: { accountId: string; state: ServerState; me: string }) {
  const connected = useStore(s => s.instances[accountId]?.status === "ready");
  const currentVoice = useStore(s => s.voice);
  const rooms = state.channels.filter(channel => channel.type === "voice" && has(channelPerms(state, me, channel), Permission.CONNECT));
  const room = rooms.find(channel => state.voiceStates.some(member => member.channelId === channel.id)) ?? rooms[0];
  const participants = room ? state.voiceStates.filter(member => member.channelId === room.id) : [];
  const inRoom = currentVoice?.accountId === accountId && currentVoice.channelId === room?.id;
  const join = async () => {
    if (!room) return;
    if (!inRoom) await joinVoice(accountId, state.server.id, room.id);
    openChannel(accountId, state.server.id, room.id);
  };
  return <div className="live-community-pulse">
    <div className="live-pulse-heading"><span className="live-eyebrow">{t("redesign.communityPulse")}</span>{connected && <span><i className="live-dot"/>{t("redesign.live")}</span>}</div>
    {room ? <section className="live-room-card">
      <div className="live-room-symbol"><Icon name="speaker" size={22}/><span className="live-sound-bars"><i/><i/><i/></span></div>
      <h3>{participants.length ? t("redesign.roomActive") : t("redesign.roomReady")}</h3>
      <p>{room.name}<br/>{participants.length ? t("redesign.voiceCount", { p0: participants.length }) : t("redesign.roomEmpty")}</p>
      {participants.length > 0 && <div className="live-avatar-stack">{participants.slice(0, 4).map(member => { const user = state.members.find(item => item.user.id === member.userId)?.user; return user ? <Avatar key={user.id} user={user} size={25}/> : null; })}<span>{participants.slice(0, 2).map(member => state.members.find(item => item.user.id === member.userId)).filter(Boolean).map(member => displayNameOf(member!)).join(", ")}</span></div>}
      <button className="live-join-room" disabled={!connected} onClick={() => void join().catch(error => toast((error as Error).message))}><Icon name="headphones" size={15}/>{inRoom ? t("redesign.returnToRoom") : t("redesign.joinRoom")}<Icon name="right" size={13}/></button>
    </section> : <div className="live-members-intro"><Icon name="users" size={24}/><p>{t("redesign.membersIntro")}</p></div>}
    <div className="live-members-heading"><span className="live-eyebrow">{t("redesign.peopleHere")}</span><Icon name="users" size={13}/></div>
  </div>;
}

export function PersonalHeading() {
  return <div className="live-personal-heading"><span className="live-eyebrow">{t("redesign.personalEyebrow")}</span><strong>{t("redesign.personalTitle")}<span aria-hidden>✳</span></strong></div>;
}

/** The prototype's activity cards, populated only from this identity's real friends. */
export function FriendsDashboard({ accountId, onAddFriend }: { accountId?: string; onAddFriend?: () => void }) {
  const social = useStore(s => s.social);
  const instance = useStore(s => accountId ? s.instances[accountId] : undefined);
  const global = useStore(s => s.global);
  const me = instance?.user ?? (social.me ? cloudUser(social.me) : null);
  const friends = accountId ? (instance?.relationships ?? []).filter(rel => rel.status === "friend").map(rel => ({ user: rel.user, name: rel.nickname || rel.user.displayName, online: ["online", "idle", "dnd"].includes(instance?.presences[rel.user.id] ?? "offline"), activity: instance?.activities[rel.user.id]?.[0] }))
    : social.relationships.filter(rel => rel.status === "friend").map(rel => ({ user: cloudUser(rel.user), name: rel.nickname || rel.user.displayName || rel.user.username, online: !!social.presences[rel.user.id] && social.presences[rel.user.id]!.status !== "offline", activity: social.presences[rel.user.id]?.activities[0] }));
  const online = friends.filter(friend => friend.online);
  const playing = online.find(friend => friend.activity?.kind === "game");
  const listening = online.find(friend => friend.activity?.kind === "music");
  const talk = online.find(friend => friend !== playing && friend !== listening) ?? online[0];
  const conversation = async (friend: (typeof friends)[number] | undefined) => {
    if (!friend) return onAddFriend?.();
    if (accountId) await openDm(accountId, friend.user.id);
    else { const dm = await openDmWith(friend.user.id); navigate({ kind: "home", accountId: null, dmId: dm.id }); }
  };
  const name = me?.displayName || global?.name || t("redesign.friend");
  return <div className="live-friends-dashboard">
    <div className="live-friends-greeting"><div><span className="live-eyebrow">{t("redesign.friendsEyebrow")}</span><h2>{t("redesign.greeting", { p0: name })}<span aria-hidden>✳</span></h2><p>{t("redesign.friendsBody")}</p></div><span className="live-online-pill"><i className="live-dot"/>{t("redesign.onlineCount", { p0: online.length })}</span></div>
    <div className="live-activity-cards">
      {[{ friend: playing, icon: "monitor" as const, title: t("redesign.playTogether"), description: playing?.activity?.name || t("redesign.findGame"), kind: "game" }, { friend: listening, icon: "music" as const, title: t("redesign.sameRhythm"), description: listening?.activity?.name || t("redesign.sharePlaylist"), kind: "music" }, { friend: talk, icon: "message" as const, title: t("redesign.goodConversation"), description: talk ? talk.name : t("redesign.findPeople"), kind: "talk" }].map(card => <button key={card.kind} className={`live-activity-card live-activity-${card.kind}`} onClick={() => { if (card.friend || onAddFriend) void conversation(card.friend).catch(error => toast((error as Error).message)); else navigate({ kind: "servers" }); }}>
        {card.kind === "game" && <Scenery/>}<Icon className="live-activity-decoration" name={card.icon} size={86}/><span className="live-eyebrow"><Icon name={card.icon} size={13}/>{card.title}</span>
        <div className="live-activity-copy">{card.friend ? <Avatar user={card.friend.user} size={27}/> : <span className="live-card-symbol"><Icon name={card.icon} size={21}/></span>}<h3>{card.description}</h3><p>{card.friend ? card.friend.name : t("redesign.alwaysRoom")}</p></div><span className="live-activity-action">{card.friend ? t("redesign.startConversation") : t("redesign.explore")}<Icon name="external" size={12}/></span>
      </button>)}
    </div>
  </div>;
}

export function DirectoryWelcome() {
  return <div className="live-directory-welcome"><Scenery/><div className="live-welcome-shade"/><div><span className="live-eyebrow"><Icon name="globe" size={13}/>{t("redesign.directoryEyebrow")}</span><h2>{t("redesign.directoryTitle")}</h2><p>{t("redesign.directoryBody")}</p></div><Icon name="globe" size={98} className="live-directory-stamp"/></div>;
}
