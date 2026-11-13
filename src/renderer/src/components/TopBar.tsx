import {rich} from "../lib/localization.ts";
import {t as translate} from "../../../shared/localization/index.ts";
import type { ServerSummary } from "@annoy/protocol";
import * as Popover from "@radix-ui/react-popover";
import { leaveVoice, navigate, openServer, reconnect, toggleVoiceSetting } from "../client.ts";
import { initials } from "../format.tsx";
import { identityAccountIds, setState, useStore, type Account, type InstanceState } from "../store.ts";
import { Avatar, Icon, openModal } from "./ui.tsx";
import { ServiceTab, tabLayout } from "./Services.tsx";
import { Brand } from "./Brand.tsx";
import { Tooltip } from "./ui/tooltip.tsx";
import { VoicePanel, DeviceMenu } from "./VoicePanel.tsx";
import { ActivityStack } from "../features/activity/ActivityCard.tsx";
import { EMPTY_ACTIVITIES } from "../store.ts";
import { visibleUserActivities } from "../../../shared/activity.ts";
import { ServerTabMenu } from "./ServerTabMenu.tsx";
import { Select } from "./ui/select.tsx";
import { presenceLabel, type ManualPresence } from "../../../shared/presence.ts";
import { cloudUser, ownCloudUser } from "../social/profile.ts";
import { displayName } from "../social/runtime.ts";
import { useOwnActivities } from "../features/activity/use-activity.ts";

function unreadFor(inst: InstanceState | undefined, channelIds: readonly string[]): { count: number; mention: boolean } {
  let count = 0;
  let mention = false;
  for (const id of channelIds) {
    const u = inst?.unread[id];
    if (u) {
      count += u.count;
      mention ||= u.mention;
    }
  }
  return { count, mention };
}

function ServerTab({ account, server, inst }: { account: Account; server: ServerSummary; inst: InstanceState | undefined }) {
  const view = useStore((s) => s.view);
  const active = view.kind === "server" && view.accountId === account.id && view.serverId === server.id;
  const unread = unreadFor(inst, inst?.serverStates[server.id]?.channels.map((c) => c.id) ?? []);
  return (
    <ServerTabMenu account={account} server={server} inst={inst}>
      <button
        className={`tab-item${active ? " active" : ""}${unread.count ? " unread" : ""}${inst?.status === "ready" ? "" : " offline"}`}
        onClick={() => void openServer(account.id, server.id)}
        aria-label={translate("common.ae04d0e6f63d",{p0:(server.name),p1:(account.instanceName)})}
        aria-current={active ? "page" : undefined}
        title={translate("common.71b46ca526aa",{p0:(server.name),p1:(account.instanceName)})}
      >
        <span className="tab-tile">{server.iconUrl ? <img className="server-icon" src={server.iconUrl} alt="" /> : initials(server.name)}</span>
        <span className="rail-label">{server.name}</span>
        {unread.count > 0 && <span key={unread.count} className={`tab-badge${unread.mention ? " mention" : ""}`}>{unread.count > 99 ? "99+" : unread.count}</span>}
      </button>
    </ServerTabMenu>
  );
}

export function UserPanel() {
  const settings = useStore((s) => s.settings);
  const view = useStore((s) => s.view);
  const accounts = useStore((s) => s.accounts);
  const annoy = useStore((s) => s.global);
  const identityAccountId = useStore((s) => identityAccountIds(s)[0]);
  const accountId = "accountId" in view ? view.accountId ?? undefined : identityAccountId;
  const account = accounts.find((a) => a.id === accountId);
  const annoyMode = !!annoy && (!accountId || !!account?.annoy);
  const profile = useStore((s) => s.social.me);
  const serverUser = useStore((s) => (accountId ? s.instances[accountId]?.user : undefined));
  const user = annoyMode ? ownCloudUser(profile, annoy!) : serverUser;
  const cloudPresence = useStore((s) => s.social.me ? s.social.presences[s.social.me.id] : undefined);
  const cloudStatus = useStore((s) => s.social.status);
  const serverPresence = useStore((s) => accountId && serverUser ? s.instances[accountId]?.status === "ready" ? s.instances[accountId]?.presences[serverUser.id] ?? "online" : "offline" : undefined);
  const ownPresence = annoyMode ? cloudStatus === "ready" ? cloudPresence?.status ?? settings.manualPresence : "offline" : serverPresence;
  const manualSupported = useStore((s) => annoyMode || !!accountId && !!s.instances[accountId]?.instance?.manualPresence);
  const groupActivitySupported = useStore((s) => annoyMode || !!accountId && !!s.instances[accountId]?.instance?.groupActivity);
  const snapshot = useStore((s) => s.desktopActivity);
  const reported = useStore((s) => (annoyMode ? cloudPresence?.activities : accountId && serverUser ? s.instances[accountId]?.activities[serverUser.id] : undefined) ?? EMPTY_ACTIVITIES);
  const own = useOwnActivities();
  const activities = visibleUserActivities({ isSelf: true, sharing: settings.shareActivity, isFriend: false, local: own, reported });

  const openSettings = () =>
    setState((s) => {
      s.modal = { kind: "userSettings", ...(!annoyMode && accountId && { accountId }) };
    });

  return (
    <footer className="user-panel">
      <VoicePanel />
      <div className="user-panel-row">
        <Popover.Root>
          <Popover.Trigger asChild>
          <button className="user-identity" aria-label={translate("common.5c9cb6831931")}>
            {user ? <Avatar user={user} size={32} presence={ownPresence} /> : <Brand size={32} />}
            <span className="user-identity-text">
              <strong className="truncate">{user?.displayName ?? translate("common.0d6cbcd9b64d")}</strong>
              <span>{user ? `@${user.username}` : translate("common.423f69a38f8e")}</span>
            </span>
          </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className="member-card member-profile self-profile" side="top" align="start" sideOffset={12} collisionPadding={12} role="dialog" aria-label={translate("common.9edbcdb31d91")}>
              <div className="member-card-head">
                {user ? <Avatar user={user} size={56} presence={ownPresence} /> : <Brand size={48} />}
                <div><strong className="member-card-name">{user?.displayName ?? translate("common.0d6cbcd9b64d")}</strong>{user && <div className="muted">@{user.username}</div>}</div>
              </div>
              {user?.bio && <p className="profile-bio" title={user.bio}>{user.bio}</p>}
              <label className="profile-status-choice">{translate("common.87c9043c582f")}<Select aria-label={translate("common.87c9043c582f")} value={settings.manualPresence} onChange={(event) => setState((s) => { s.settings.manualPresence = event.target.value as ManualPresence; })}>
                  {(["online", "idle", "dnd", "offline"] as const).map((status) => <option key={status} value={status}>{presenceLabel(status)}</option>)}
                </Select>
              </label>
              <p className="muted small">{settings.manualPresence === "online" ? translate("common.6b422f6d024f") : settings.manualPresence === "idle" ? translate("common.905d1c0b9f78") : settings.manualPresence === "dnd" ? translate("common.84b97bf196c0") : translate("common.d78216f5ca21")}</p>
              {user && !manualSupported && settings.manualPresence !== "online" && <p className="muted small">{translate("common.41f9f802ad4b")}</p>}
              <div className="self-profile-activity">
                <h3>{translate("common.c539537cdd76")}</h3>
                <ActivityStack activities={activities} />
                {!activities.length && <p className="muted">{!settings.shareActivity ? translate("common.c9d1b9e3ba94") : snapshot?.error ?? translate("common.f557b5cdcc29")}</p>}
                {activities.length > 0 && <p className="muted">{settings.manualPresence === "offline" ? translate("common.eb909edd26f9") : groupActivitySupported ? translate("common.57415ffd7b3b") : translate("common.7bda91a1a79b")}</p>}
              </div>
              <Popover.Close asChild><button className="btn btn-ghost" onClick={openSettings}>{rich("common.fdea9c93093b",{p0:(<Icon name="edit" size={16} />)})}</button></Popover.Close>
              <Popover.Close asChild><button className="btn btn-ghost" onClick={() => openModal({ kind: "switchAccount" })}>{rich("common.facf0ad3761a",{p0:(<Icon name="users" size={16} />)})}</button></Popover.Close>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <div className="user-control-pair">
          <Tooltip content={settings.selfMute ? translate("common.2c42f42f33a1") : translate("common.d8cdc34ee6fe")} side="top">
            <button
              className={`icon-btn${settings.selfMute ? " danger" : ""}`}
              onClick={() => toggleVoiceSetting("selfMute")}
              aria-label={settings.selfMute ? translate("common.2c42f42f33a1") : translate("common.d8cdc34ee6fe")}
              aria-pressed={settings.selfMute}
            >
              <Icon name={settings.selfMute ? "micOff" : "mic"} size={17} />
            </button>
          </Tooltip>
          <DeviceMenu kind="input" />
        </div>
        <div className="user-control-pair">
          <Tooltip content={settings.selfDeaf ? translate("common.5cfebda5d336") : translate("common.3b97c043a1c1")} side="top">
            <button
              className={`icon-btn${settings.selfDeaf ? " danger" : ""}`}
              onClick={() => toggleVoiceSetting("selfDeaf")}
              aria-label={settings.selfDeaf ? translate("common.5cfebda5d336") : translate("common.3b97c043a1c1")}
              aria-pressed={settings.selfDeaf}
            >
              <Icon name={settings.selfDeaf ? "headphonesOff" : "headphones"} size={17} />
            </button>
          </Tooltip>
          <DeviceMenu kind="output" />
        </div>
        <Tooltip content={translate("common.76b0fb6ad189")} side="top">
          <button className="icon-btn" onClick={openSettings} aria-label={translate("common.76b0fb6ad189")}>
            <Icon name="gear" size={17} />
          </button>
        </Tooltip>
      </div>
    </footer>
  );
}

/** Community bar, down the side or across the top: home, browser services and every server of every connected instance. */
export function TopBar() {
  // Only the identity in use: another user's servers and conversations never show here.
  const identity = useStore((s) => identityAccountIds(s).join("\n"));
  const allAccounts = useStore((s) => s.accounts);
  const accounts = allAccounts.filter((account) => identity.split("\n").includes(account.id));
  const instances = useStore((s) => s.instances);
  const view = useStore((s) => s.view);
  const services = useStore((s) => s.services);
  const settings = useStore((s) => s.settings);
  const shown = services.filter((sv) => !sv.hidden);
  const before = shown.filter((sv) => tabLayout(sv, settings).placement === "before");
  const after = shown.filter((sv) => tabLayout(sv, settings).placement === "after");
  const directMessages = accounts.flatMap((account) => (instances[account.id]?.dms ?? []).filter((dm) => (instances[account.id]?.unread[dm.id]?.count ?? 0) > 0).map((dm) => ({ account, dm, unread: instances[account.id]?.unread[dm.id]?.count ?? 0 })));

  // Annoy account DMs: the sender's face stays on the rail with its count until read.
  const social = useStore((s) => s.social);
  const cloudDirectMessages = social.dms.filter((dm) => (social.unread[dm.id] ?? 0) > 0).map((dm) => ({ dm, unread: social.unread[dm.id] ?? 0 }));

  // Unread messages count on the sender's face only; home counts friend requests waiting (like Discord).
  let homeCount = social.relationships.filter((r) => r.status === "incoming").length;
  for (const a of accounts) homeCount += instances[a.id]?.relationships.filter((r) => r.status === "incoming").length ?? 0;

  const dmShortcuts = [
    ...cloudDirectMessages.map(({ dm, unread }) => {
      const profile = social.profiles[dm.recipientId];
      const name = social.relationships.find((r) => r.user.id === dm.recipientId)?.nickname || displayName(profile) || translate("social.unknownUser");
      const count = unread > 99 ? "99+" : String(unread);
      return <Tooltip key={`cloud-${dm.id}`} content={translate("common.6e8c81a18a65",{p0:(name),p1:(count)})}><button className="tab-item dm-shortcut" aria-label={translate("common.6d4b720de0ef",{p0:(name),p1:(count)})} onClick={() => navigate({ kind: "home", accountId: null, dmId: dm.id })}><Avatar user={cloudUser(profile, dm.recipientId)} size={40} /><span key={unread} className="tab-badge">{count}</span></button></Tooltip>;
    }),
    ...directMessages.map(({ account, dm, unread }) => {
      const user = dm.recipients[0];
      if (!user) return null;
      const nickname = instances[account.id]?.relationships.find((r) => r.user.id === user.id)?.nickname || user.displayName;
      const count = unread > 99 ? "99+" : String(unread);
      return <Tooltip key={`${account.id}-${dm.id}`} content={translate("common.6e8c81a18a65",{p0:(nickname),p1:(count)})}><button className="tab-item dm-shortcut" aria-label={translate("common.6d4b720de0ef",{p0:(nickname),p1:(count)})} onClick={() => navigate({ kind: "home", accountId: account.id, dmId: dm.id })}><Avatar user={user} size={40} /><span key={unread} className="tab-badge">{count}</span></button></Tooltip>;
    }),
  ].filter(Boolean);

  return (
    <header className="topbar clean-rail">
      <Tooltip content={translate("common.53c413d8aae2")}>
        <button className={`rail-brand rail-home tab-item${view.kind === "home" ? " active" : ""}`} aria-label={translate("common.53c413d8aae2")} aria-current={view.kind === "home" ? "page" : undefined} onClick={() => navigate({ kind: "home", accountId: "accountId" in view ? view.accountId ?? accounts[0]?.id ?? null : accounts[0]?.id ?? null, dmId: null })}>
          <Brand size={settings.barPosition === "top" ? 30 : 44} />
          {homeCount > 0 && <span className="tab-badge">{homeCount}</span>}
        </button>
      </Tooltip>
      {/* Who wrote to me sits right under home, each face with its own count, until read. */}
      {dmShortcuts.length > 0 && <div className="rail-dms" role="group">{dmShortcuts}</div>}
      <span className="rail-divider rail-home-divider" aria-hidden="true" />
      <nav className="tabs-strip" aria-label={translate("common.0beb691c8956")}>
        <Tooltip content={translate("common.1f43b76f4112")}><button className={`tab-item directory-tab${view.kind === "servers" ? " active" : ""}`} aria-label={translate("common.c1158df03518")} aria-current={view.kind === "servers" ? "page" : undefined} onClick={() => navigate({ kind: "servers" })}><span className="tab-tile"><Icon name="users" size={19} /></span><span className="rail-label">{translate("common.c1158df03518")}</span></button></Tooltip>
        <Tooltip content={translate("integrations.store")}><button className={`tab-item directory-tab store-tab${view.kind === "marketplace" ? " active" : ""}`} aria-label={translate("integrations.store")} aria-current={view.kind === "marketplace" ? "page" : undefined} onClick={() => navigate({ kind: "marketplace", accountId: null, serverId: null })}><span className="tab-tile"><Icon name="store" size={19} /></span><span className="rail-label">{translate("integrations.store")}</span></button></Tooltip>
        {before.map((service) => <ServiceTab key={service.id} service={service} />)}
        {before.length > 0 && accounts.some((account) => instances[account.id]?.servers.length) && <span className="rail-divider" aria-hidden="true" />}
        {accounts.map((account) => {
          const inst = instances[account.id];
          return <div key={account.id} className="tab-group">
            {inst?.status !== "ready" && <button className={`instance-status ${inst?.status ?? "connecting"}`} title={`${account.instanceName}: ${inst?.status === "outdated" ? "atualize o Annoy para conectar" : inst?.status === "invalid" ? translate("common.f2c87349e41f") : translate("common.e27be73b7089")}`} aria-label={`${account.instanceName}: ${inst?.status === "outdated" ? "atualizar o Annoy" : inst?.status === "invalid" ? translate("common.9200e693d8d3") : translate("common.63d538de9074")}`} onClick={() => inst?.status === "outdated" ? openModal({ kind: "userSettings", section: "updates" }) : inst?.status === "invalid" ? openModal({ kind: "addAccount", accountId: account.id }) : reconnect(account.id)} />}
            {inst?.servers.map((server) => <ServerTab key={server.id} account={account} server={server} inst={inst} />)}
          </div>;
        })}
        {after.length > 0 && accounts.some((account) => instances[account.id]?.servers.length) && <span className="rail-divider" aria-hidden="true" />}
        {after.map((service) => <ServiceTab key={service.id} service={service} />)}
        <Tooltip content={translate("common.66f065f8c2d3")}><button className="tabbar-add" title={translate("common.07281181367c")} aria-label={translate("common.32db25cd960a")} onClick={() => openModal({ kind: "addTab" })}><span className="tab-tile"><Icon name="plus" size={18} /></span><span className="rail-label">{translate("common.32db25cd960a")}</span></button></Tooltip>
      </nav>
      <div className="rail-footer">
        <Tooltip content={translate("common.e9e2484c356c")}><button className={`rail-news icon-btn${view.kind === "news" ? " active" : ""}`} aria-label={translate("common.e9e2484c356c")} aria-current={view.kind === "news" ? "page" : undefined} onClick={() => navigate({ kind: "news" })}><Icon name="info" size={19} /></button></Tooltip>
      </div>
    </header>
  );
}
