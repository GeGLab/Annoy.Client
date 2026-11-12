import { FriendsDashboard, PersonalHeading } from "../features/redesign/LiveExperience.tsx";
import { Scenery } from "../features/redesign/Scenery.tsx";
import {rich} from "../lib/localization.ts";
import {t as translate} from "../../../shared/localization/index.ts";
import { Input } from "./ui/input.tsx";
import { confirmAction } from "./ui/action-dialog.tsx";
import { Select } from "./ui/select.tsx";
import { ActivityStack } from "../features/activity/ActivityCard.tsx";
import type { Relationship } from "@annoy/protocol";
import { useState, type FormEvent } from "react";
import { apiFor, navigate, openDm } from "../client.ts";
import { EMPTY_ACTIVITIES, setState, useStore } from "../store.ts";
import { Chat } from "./Chat.tsx";
import { SocialHome } from "./social/SocialHome.tsx";
import { act, Avatar, Icon, openModal } from "./ui.tsx";
import { ResizablePanel } from "./layout/ResizablePanel.tsx";
import { Brand } from "./Brand.tsx";
import { UserPanel } from "./TopBar.tsx";
import { Button } from "./ui/button.tsx";
import { ConnectionNotice } from "./ConnectionOverlay.tsx";
import { DmProfile, UserProfile } from "./UserProfile.tsx";
import { startDirectCall } from "../features/direct-calls.ts";
import { notificationKey, toggleMessageMute } from "../lib/notification-preferences.ts";

type Tab = "online" | "all" | "pending" | "add";

function FriendRow({ accountId, rel, online }: { accountId: string; rel: Relationship; online: boolean }) {
  const connected = useStore((s) => s.instances[accountId]?.status === "ready");
  const presence = useStore((s) => s.instances[accountId]?.presences[rel.user.id] ?? "offline");
  const activities = useStore((s) => s.instances[accountId]?.activities?.[rel.user.id] ?? EMPTY_ACTIVITIES);
  const api = apiFor(accountId);
  return (
    <div className="friend">
      <Avatar user={rel.user} size={36} presence={presence} />
      <div className="friend-names">
        <UserProfile user={rel.user} accountId={accountId}><strong>{rel.nickname || rel.user.displayName}</strong></UserProfile>
        <span className="muted">
          {!connected ? translate("common.b13c69621e91") : rel.status === "incoming" ? translate("common.13954746d501") : rel.status === "outgoing" ? translate("common.5407d7530e44") : presence === "idle" ? translate("common.fd7f0836e8ad") : presence === "dnd" ? translate("common.976685dd88bf") : online ? translate("common.0d21bd52022c") : translate("common.a1794783aab7")}
        </span>
        {rel.status === "friend" && <ActivityStack activities={activities} compact />}
      </div>
      <span className="spacer" />
      {rel.status === "friend" && (
        <><button className="icon-btn" disabled={!connected || !online} aria-label={translate("common.2fbb31f3ee73",{p0:(rel.user.displayName)})} onClick={() => void startDirectCall(accountId, rel.user.id, false)}><Icon name="phone" /></button><button className="icon-btn" disabled={!connected || !online} aria-label={translate("common.87b78cdc3e7c",{p0:(rel.user.displayName)})} onClick={() => void startDirectCall(accountId, rel.user.id, true)}><Icon name="camera" /></button></>
      )}
      {rel.status === "friend" && (
        <button className="icon-btn" title={translate("common.322085898310")} onClick={() => void openDm(accountId, rel.user.id)}>
          <Icon name="message" />
        </button>
      )}
      {rel.status === "incoming" && (
        <button className="icon-btn ok" disabled={!connected} title={translate("common.aea17ec1a6c8")} onClick={() => void act(api.put(`/relationships/${rel.user.id}`))}>
          <Icon name="check" />
        </button>
      )}
      <button
        className="icon-btn danger"
        disabled={!connected}
        title={rel.status === "friend" ? translate("common.517ae8f44afa") : translate("common.b3a927e0711a")}
        onClick={async () =>
          (rel.status !== "friend" || (await confirmAction(translate("common.b51f90451a7a",{p0:(rel.user.displayName)})))) &&
          void act(api.del(`/relationships/${rel.user.id}`))
        }
      >
        <Icon name="x" />
      </button>
    </div>
  );
}

function Friends({ accountId }: { accountId: string }) {
  const inst = useStore((s) => s.instances[accountId]);
  const [tab, setTab] = useState<Tab>("online");
  const [username, setUsername] = useState("");
  const rels = inst?.relationships ?? [];
  const connected = inst?.status === "ready";
  const online = (id: string) => connected && ["online", "idle", "dnd"].includes(inst?.presences[id] ?? "offline");
  const pending = rels.filter((r) => r.status !== "friend");
  const list =
    tab === "online"
      ? rels.filter((r) => r.status === "friend" && online(r.user.id))
      : tab === "all"
        ? rels.filter((r) => r.status === "friend")
        : pending;

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (await act(apiFor(accountId).post("/relationships", { username: username.trim() }), translate("common.64b2715b87ba"))) setUsername("");
  };

  return (
    <section className="chat">
      <header className="chat-header">
        <Icon name="users" size={20} />
        <h1>{translate("common.bead8677698a")}</h1>

      </header>
      <ConnectionNotice accountId={accountId} />
      <div className="friends">
        <FriendsDashboard accountId={accountId} onAddFriend={() => setTab("add")}/>
        <div className="tabs inline live-friends-filters">
          {(["online", "all", "pending"] as const).map((t) => (
            <button key={t} className={tab === t ? "tab active" : "tab"} onClick={() => setTab(t)}>
              {t === "online" ? translate("common.0d21bd52022c") : t === "all" ? translate("common.bd02b9a7d71d") : translate("common.7c091a838d93")}
              {t === "pending" && pending.some((r) => r.status === "incoming") && (
                <span className="badge">{pending.filter((r) => r.status === "incoming").length}</span>
              )}
            </button>
          ))}
          <button className={tab === "add" ? "tab tab-add active" : "tab tab-add"} onClick={() => setTab("add")}>{translate("common.fcaaf1906cc6")}</button>
        </div>
        {tab === "add" ? (
          <form className="add-friend" onSubmit={add}>
            <h3>{translate("common.fcaaf1906cc6")}</h3>
            <p className="muted">{rich("common.d8fb0d17b12f",{p0:(inst?.user ? translate("common.430070640a70",{p0:(inst.user.username)}) : "")})}</p>
            <div className="add-friend-row">
              <Input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} placeholder={translate("common.b1d54957d065")} />
              <button className="btn" disabled={!connected || !username.trim()}>{translate("common.10b4a1190405")}</button>
            </div>
          </form>
        ) : list.length === 0 ? (
          <div className="friends-empty">
            <Icon name={tab === "pending" ? "check" : "users"} size={40} />
            <h2>
              {!connected && tab === "online" ? translate("common.a38eecf04315") : tab === "pending" ? translate("common.1c3301711470") : tab === "online" ? translate("common.5059c8b7a052") : translate("common.a671510c139f")}
            </h2>
            <p>
              {tab === "pending"
                ? translate("common.72090cda25e6")
                : tab === "online"
                  ? translate("common.d381efd71e93")
                  : translate("common.18f8c84ef96b")}
            </p>
            {tab !== "pending" && (
              <Button variant="secondary" onClick={() => setTab(tab === "online" ? "all" : "add")}>
                {tab === "online" ? translate("common.25a348d78e7c") : translate("common.fcaaf1906cc6")}
              </Button>
            )}
          </div>
        ) : (
          list.map((r) => <FriendRow key={r.user.id} accountId={accountId} rel={r} online={online(r.user.id)} />)
        )}
      </div>
    </section>
  );
}

/** First run: no server yet. Also the Annoy home before the first friend or conversation. */
export function WelcomeMain({ onAddFriend }: { onAddFriend?: () => void } = {}) {
  return (
      <div className="empty-main welcome">
        <header className="welcome-topline">
          <Icon name="home" size={18} />
          <span>{translate("common.325dfc37c9ba")}</span>
        </header>
        <Scenery className="live-first-run-art"/>
        <div className="welcome-content">
          <Brand size={72} />
          <h1>{translate("common.34bf61529596")}<br />
            <span>{translate("common.673020374935")}</span>
          </h1>
          <p>{translate("common.020ed05cc372")}<br className="desktop-break" />{translate("common.1e77d0e3ad33")}</p>
          <div className="welcome-actions">
            <Button onClick={() => openModal({ kind: "addAccount" })}>{rich("common.6e8f75b248c6",{p0:(<Icon name="plus" size={17} />)})}</Button>
            <Button variant="secondary" onClick={() => openModal({ kind: "addTab" })}>{rich("common.0de9ed8c15d7",{p0:(<Icon name="right" size={16} />)})}</Button>
          </div>
          <span className="welcome-hint">{translate("common.ec9153e20787")}</span>
        </div>
        <footer className="welcome-footer">
          <Brand size={20} wordmark />
          <span>{translate("common.86b60c356e3d")}</span>
        </footer>
      </div>
  );
}

export function Home({ accountId, dmId }: { accountId: string | null; dmId: string | null }) {
  const settings = useStore((s) => s.settings);
  const accounts = useStore((s) => s.accounts);
  const inst = useStore((s) => (accountId ? s.instances[accountId] : undefined));
  // The Annoy account's home lives in the Annoy cloud, with or without servers (TODO item 1).
  const annoyHome = useStore((s) => !!s.global && (accountId === null || !!s.accounts.find((a) => a.id === accountId)?.annoy));
  const unread = inst?.unread;
  if (annoyHome) return <SocialHome dmId={dmId} />;

  if (!accountId || !inst) {
    return (
      <div className="server-view">
        <ResizablePanel panel="channels">
          <header className="channels-header static">
            <span>{translate("common.0d6cbcd9b64d")}</span>
            <Icon name="message" size={18} />
          </header>
          <div className="channel-scroll first-run-sidebar">
            <button className="channel active" aria-current="page">
              <Icon name="home" />
              <span>{translate("common.325dfc37c9ba")}</span>
            </button>
            <div className="sidebar-section-heading">
              <span>{translate("common.53c413d8aae2")}</span>
              <button className="icon-btn tiny" aria-label={translate("common.a7c2a45641bd")} onClick={() => openModal({ kind: "addAccount" })}>
                <Icon name="plus" size={14} />
              </button>
            </div>
            <p className="sidebar-empty">{translate("common.8198b77811bb")}</p>
            <div className="sidebar-connect">
              <Icon name="message" size={22} />
              <strong>{translate("common.f531309c8728")}</strong>
              <p>{translate("common.bc8f421d3cee")}</p>
              <button onClick={() => openModal({ kind: "addAccount" })}>{rich("common.8acbd14c1e73",{p0:(<Icon name="right" size={14} />)})}</button>
            </div>
          </div>
          <UserPanel />
        </ResizablePanel>
        <WelcomeMain />
      </div>
    );
  }

  const dm = inst.dms.find((d) => d.id === dmId);
  const other = dm?.recipients[0];
  const me = inst.user;

  return (
    <div className="server-view">
      <ResizablePanel panel="channels" reservedWidth={dm && other && settings.dmProfileOpen ? 320 : 0}>
        <PersonalHeading/>
        <header className="channels-header static">
          {accounts.length > 1 ? (
            <Select
              className="account-select"
              value={accountId}
              onChange={(e) => navigate({ kind: "home", accountId: e.target.value, dmId: null })}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.instanceName}
                </option>
              ))}
            </Select>
          ) : (
            <span className="truncate">{accounts[0]?.instanceName}</span>
          )}
        </header>
        <ul className="channel-scroll">
          <li>
            <div className={`channel${!dmId ? " active" : ""}`} onClick={() => navigate({ kind: "home", accountId, dmId: null })}>
              <Icon name="users" size={18} />
              <span className="channel-name">{translate("common.bead8677698a")}</span>
            </div>
          </li>
          <li className="section-label padded">{translate("common.53c413d8aae2")}</li>
          {inst.dms.map((d) => {
            const r = d.recipients[0];
            if (!r) return null;
            const u = unread?.[d.id];
            return (
              <li key={d.id}>
                <div
                  className={`channel dm${dmId === d.id ? " active" : ""}${u ? " unread" : ""}`}
                  onClick={() => navigate({ kind: "home", accountId, dmId: d.id })}
                >
                  <Avatar user={r} size={28} presence={inst.presences[r.id] ?? "offline"} />
                  <span className="channel-name">{inst.relationships.find((relationship) => relationship.user.id === r.id)?.nickname || r.displayName}</span>
                  {u && <span className="badge">{u.count}</span>}
                </div>
              </li>
            );
          })}
          {inst.dms.length === 0 && <li className="muted padded small">{translate("common.e9f2e2e8bfda")}</li>}
        </ul>
        <UserPanel />
      </ResizablePanel>
      {dm && other && me ? (
        <div className="dm-conversation"><Chat
          key={JSON.stringify([accountId, dm.id])}
          accountId={accountId}
          channelId={dm.id}
          title={inst.relationships.find((relationship) => relationship.user.id === other.id)?.nickname || other.displayName}
          headerExtra={<><button className="icon-btn" aria-label={settings.dmProfileOpen ? translate("common.5319bf1ddaab") : translate("common.37ce919497c5")} aria-pressed={settings.dmProfileOpen} onClick={() => setState((s) => { s.settings.dmProfileOpen = !s.settings.dmProfileOpen; })}><Icon name="users" /></button><UserProfile user={other} accountId={accountId}><Avatar user={other} size={28} /></UserProfile><button className="icon-btn" disabled={inst.status !== "ready"} aria-label={translate("common.8db31db870ec")} onClick={() => void startDirectCall(accountId, other.id, false)}><Icon name="phone" /></button><button className="icon-btn" disabled={inst.status !== "ready"} aria-label={translate("common.eef68657b73c")} onClick={() => void startDirectCall(accountId, other.id, true)}><Icon name="camera" /></button><button className="icon-btn" aria-label={settings.mutedChannels.includes(notificationKey(accountId, dm.id)) ? translate("common.edc1c54b69d1") : translate("common.30278e825ac4")} onClick={() => toggleMessageMute("channel", accountId, dm.id)}><Icon name={settings.mutedChannels.includes(notificationKey(accountId, dm.id)) ? "bellOff" : "bell"} /></button></>}
          icon={null}
          canSend
          canAttach
          canModerate={false}
          canPin
          nameOf={(id) => (id === me.id ? me.displayName : inst.relationships.find((r) => r.user.id === id)?.nickname || dm.recipients.find((r) => r.id === id)?.displayName)}
          mentionables={dm.recipients.map((r) => ({ id: r.id, name: r.displayName, username: r.username }))}
        />{settings.dmProfileOpen && <DmProfile key={other.id} user={other} accountId={accountId} />}</div>
      ) : (
        <Friends accountId={accountId} />
      )}
    </div>
  );
}




