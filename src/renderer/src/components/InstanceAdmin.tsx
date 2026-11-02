import {rich} from "../lib/localization.ts";
import {localizationPreferences} from "../../../shared/localization/index.ts";
import {t as translate,onLocalizationChange} from "../../../shared/localization/index.ts";
import { Checkbox } from "./ui/checkbox.tsx";
import { Input } from "./ui/input.tsx";
import { promptText, confirmAction } from "./ui/action-dialog.tsx";
import { Select } from "./ui/select.tsx";
import { Switch } from "./ui/switch.tsx";
import type { AdminOverview, AdminServer, AdminUser, InstanceSettings, RegistrationMode, SignupInvite, UpdateStatus, VoiceUsage } from "@distopic/protocol";

import { useEffect, useState } from "react";
import { apiFor, removeAccount } from "../client.ts";
import { formatSize, formatTime } from "../format.tsx";
import { getState, toast, useStore } from "../store.ts";
import { act, Avatar, closeModal, Field, Icon, Modal } from "./ui.tsx";

type Tab = "settings" | "updates" | "invites" | "users" | "servers";

let MODE_TEXT: Record<RegistrationMode, string> = {
  open: translate("common.876622889345"),
  invite: translate("common.fc06912c2595"),
  closed: translate("common.fe6a1348f3ad"),
};

let LEVEL_TEXT: Record<VoiceUsage["level"], string> = {
  ok: translate("common.8b2c555f2b8b"),
  video_off: translate("common.ddfbc131053a"),
  off: translate("common.67ed9e96f10f"),
};

/** Cloudflare bills decimal gigabytes. */
const gb = (bytes: number) => `${(bytes / 1e9).toLocaleString(localizationPreferences().region, { maximumFractionDigits: bytes < 1e10 ? 2 : 0 })} GB`;

function VoiceUsageBar({ usage }: { usage: VoiceUsage }) {
  const pct = usage.limitBytes > 0 ? Math.min(100, (usage.bytes / usage.limitBytes) * 100) : 0;
  return (
    <Field
      label={translate("common.6a994f867655",{p0:(usage.month)})}
      hint={usage.limitBytes > 0 ? LEVEL_TEXT[usage.level] : translate("common.17f384d4cebc")}
    >
      <div className="usage-meter">
        <div className={`usage-fill ${usage.level}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="muted">
        {gb(usage.bytes)}
        {usage.limitBytes > 0 && ` de ${gb(usage.limitBytes)} (${pct.toFixed(1)}%)`}
      </span>
    </Field>
  );
}

function SettingsTab({ accountId }: { accountId: string }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [draft, setDraft] = useState<InstanceSettings | null>(null);
  const api = apiFor(accountId);
  useEffect(() => {
    void api.get<AdminOverview>("/admin/overview").then((o) => {
      setOverview(o);
      setDraft(o.settings);
    }, (e: Error) => toast(e.message));
  }, [accountId]);
  if (!overview || !draft) return <p className="muted">{translate("common.6cc1bbba0f84")}</p>;
  const save = () => void act(api.patch<InstanceSettings>("/admin/settings", draft), translate("common.05d89bcc22b8"));
  return (
    <div className="form">
      <div className="stat-row">
        <div><strong>{overview.userCount}</strong><span>{translate("common.8c2c6ad91753")}</span></div>
        <div><strong>{overview.serverCount}</strong><span>{translate("common.75208deec696")}</span></div>
        <div><strong>{overview.messageCount.toLocaleString(localizationPreferences().region)}</strong><span>{translate("common.a599d808caaa")}</span></div>
        <div><strong>{formatSize(overview.uploadsBytes)}</strong><span>{translate("common.bf627ff251cb")}</span></div>
      </div>
      {overview.voiceUsage && <VoiceUsageBar usage={overview.voiceUsage} />}
      <Field label={translate("common.f3eb9950496c")} hint={MODE_TEXT[draft.registration]}>
        <div className="segmented">
          {(["open", "invite", "closed"] as const).map((m) => (
            <button key={m} className={draft.registration === m ? "active" : ""} onClick={() => setDraft({ ...draft, registration: m })}>
              {m === "open" ? translate("common.84276cb66432") : m === "invite" ? translate("common.17588542ad8f") : translate("common.dee988a2b6b3")}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid-2">
        <Field label={translate("common.7492b663674c")} hint={translate("common.0bb3682ca480")}>
          <Input
            type="number"
            min={1}
            value={draft.maxServersPerUser ?? ""}
            onChange={(e) => setDraft({ ...draft, maxServersPerUser: e.target.value ? Number(e.target.value) : null })}
            placeholder={translate("common.b669ba5781e9")}
          />
        </Field>
        <Field label={translate("common.3747ce9fbc1a")}>
          <Input type="number" min={1} max={500} value={draft.maxUploadMb} onChange={(e) => setDraft({ ...draft, maxUploadMb: Number(e.target.value) || 1 })} />
        </Field>
      </div>
      <div className="form-actions">
        <button className="btn" onClick={save}>{translate("common.aef7cd5b2081")}</button>
      </div>
    </div>
  );
}

/** "0.7.10" > "0.7.9". */
function newer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

function UpdatesTab({ accountId }: { accountId: string }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  /** Version that was running when the admin asked for the update. */
  const [waitingFrom, setWaitingFrom] = useState<string | null>(null);
  const api = apiFor(accountId);
  useEffect(() => {
    void api.get<UpdateStatus>("/admin/updates").then(setStatus, (e: Error) => toast(e.message));
  }, [accountId]);
  // While updating, the server restarts: keep asking until the new version answers.
  useEffect(() => {
    if (!waitingFrom) return;
    const started = Date.now();
    const timer = setInterval(() => {
      void api.get<UpdateStatus>("/admin/updates").then((s) => {
        setStatus(s);
        if (s.current !== waitingFrom) {
          setWaitingFrom(null);
          toast(translate("common.6948e7fded5e",{p0:(s.current)}));
        } else if (!s.updating && Date.now() - started > 15_000) {
          setWaitingFrom(null);
          if (s.lastError) toast(s.lastError);
          else toast(translate("common.1142ead864bb"));
        }
      }, () => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [waitingFrom, accountId]);
  if (!status) return <p className="muted">{translate("common.6cc1bbba0f84")}</p>;
  const outdated = status.latest !== null && newer(status.latest, status.current);
  const setAuto = (auto: boolean) => void api.patch<UpdateStatus>("/admin/updates", { auto }).then(setStatus, (e: Error) => toast(e.message));
  const apply = () =>
    void api.post<UpdateStatus>("/admin/updates/apply", {}).then((s) => {
      setStatus(s);
      setWaitingFrom(s.current);
    }, (e: Error) => toast(e.message));
  return (
    <div className="form">
      <div className="stat-row">
        <div><strong>{status.current}</strong><span>{translate("common.ccae7530ecb5")}</span></div>
        <div><strong>{status.latest ?? "?"}</strong><span>{translate("common.8803928560e6")}</span></div>
      </div>
      <p className="muted small">
        {status.latest === null
          ? translate("common.ebcd5e8060be")
          : outdated
            ? translate("common.59aafd18c704",{p0:(status.latest)})
            : translate("common.d76985147a70")}
      </p>
      {status.available ? (
        <>
          <div className="form-actions">
            <button className="btn" disabled={waitingFrom !== null || status.updating} onClick={apply}>
              {waitingFrom !== null || status.updating ? translate("common.bf7bf10b3c9d") : translate("common.6301ab1abf1f")}
            </button>
          </div>
          <label className="check">
            <Switch checked={status.auto} onCheckedChange={setAuto} />{translate("common.b545add65791")}</label>
          <p className="muted small">
            {status.auto
              ? translate("common.51cc2b9f401e",{p0:(status.intervalHours ?? 6)})
              : translate("common.f6251d12ce9d")}
            {status.channel && status.channel !== "latest" && translate("common.1e09fb42f5d2",{p0:(status.channel)})}
          </p>
          {status.lastCheck && <p className="muted small">{rich("common.e822ee324a5b",{p0:(formatTime(status.lastCheck))})}</p>}
          {status.lastError && <p className="warning">{status.lastError}</p>}
        </>
      ) : (
        <p className="warning">{rich("common.a736767b82f5",{p0:(<code>{translate("common.ecbf7c88b628")}</code>)})}</p>
      )}
    </div>
  );
}

function InvitesTab({ accountId }: { accountId: string }) {
  const [invites, setInvites] = useState<SignupInvite[] | null>(null);
  const [maxUses, setMaxUses] = useState("1");
  const [expires, setExpires] = useState("168");
  const api = apiFor(accountId);
  const account = getState().accounts.find((a) => a.id === accountId);
  const address = account?.url.replace(/^https?:\/\//, "") ?? "";
  const load = () => void api.get<SignupInvite[]>("/admin/invites").then(setInvites, (e: Error) => toast(e.message));
  useEffect(load, [accountId]);
  const create = () =>
    void api
      .post<SignupInvite>("/admin/invites", { maxUses: maxUses ? Number(maxUses) : null, expiresInHours: expires ? Number(expires) : null })
      .then((inv) => {
        load();
        void navigator.clipboard.writeText(translate("common.1cf0bbd091a7",{p0:(address),p1:(inv.code)}));
        toast(translate("common.2ab0a884e98c"));
      }, (e: Error) => toast(e.message));
  const now = new Date().toISOString();
  return (
    <div className="form">
      <p className="muted small">{rich("common.5c52f7ccb006",{p0:(<strong>{translate("common.dd64642e2be5")}</strong>)})}</p>
      <div className="inline-form">
        <Field label={translate("common.feba17310985")}>
          <Select value={maxUses} onChange={(e) => setMaxUses(e.target.value)}>
            <option value="1">{translate("common.2005d6d2af21")}</option>
            <option value="5">{translate("common.4187e614ef67")}</option>
            <option value="25">{translate("common.758f57c2161a")}</option>
            <option value="">{translate("common.b669ba5781e9")}</option>
          </Select>
        </Field>
        <Field label={translate("common.e5b7cdb2f565")}>
          <Select value={expires} onChange={(e) => setExpires(e.target.value)}>
            <option value="24">{translate("common.f2beffdd5114")}</option>
            <option value="168">{translate("common.23060decf8cd")}</option>
            <option value="720">{translate("common.59c86fb6958a")}</option>
            <option value="">{translate("common.12fcd0c7b77c")}</option>
          </Select>
        </Field>
        <button className="btn" onClick={create}>{rich("common.3ead31b308c0",{p0:(<Icon name="plus" size={16} />)})}</button>
      </div>
      <div className="list">
        {invites?.length === 0 && <p className="muted">{translate("common.54179ddfad08")}</p>}
        {invites?.map((inv) => {
          const dead = (inv.expiresAt !== null && inv.expiresAt < now) || (inv.maxUses !== null && inv.uses >= inv.maxUses);
          return (
            <div key={inv.code} className={`list-row${dead ? " dim" : ""}`}>
              <span>
                <code className="invite-code">{inv.code}</code>
                <span className="muted small">{rich("common.8ac354e7a31b",{p0:(inv.uses),p1:(inv.maxUses ?? "∞"),p2:(inv.expiresAt ? `expira ${formatTime(inv.expiresAt)}` : translate("common.3d0f8cf7c58c")),p3:(dead ? " · encerrado" : "")})}</span>
              </span>
              <span className="row-actions">
                <button className="icon-btn" title={translate("desktop.39dcf1cbeb5a")} onClick={() => void navigator.clipboard.writeText(inv.code).then(() => toast(translate("common.8ef745e3e496")))}>
                  <Icon name="link" size={16} />
                </button>
                <button className="icon-btn danger" title={translate("common.f3404a4d6d1f")} onClick={() => void act(api.del(`/admin/invites/${inv.code}`)).then(load)}>
                  <Icon name="trash" size={16} />
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function UsersTab({ accountId }: { accountId: string }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [q, setQ] = useState("");
  const me = useStore((s) => s.instances[accountId]?.user?.id);
  const api = apiFor(accountId);
  const load = () => void api.get<AdminUser[]>(`/admin/users?q=${encodeURIComponent(q)}`).then(setUsers, (e: Error) => toast(e.message));
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [accountId, q]);
  const ban = async (u: AdminUser) => {
    const reason = await promptText(translate("common.e6c9ff049b6b",{p0:(u.user.displayName)}));
    if (reason !== null) void act(api.post(`/admin/users/${u.user.id}/ban`, { reason }), translate("common.529d410aeddb")).then(load);
  };
  const remove = async (u: AdminUser) => {
    if (!await confirmAction(translate("common.43bf0ba223b1",{p0:(u.user.displayName)}))) return;
    const messages = await confirmAction(translate("common.780083bead19"), {confirmLabel:translate("common.6cbcb850c675"),cancelLabel:translate("common.92f3877caa1d")});
    void act(api.del(`/admin/users/${u.user.id}?deleteMessages=${messages ? 1 : 0}`), translate("common.56a84683d20d")).then(load);
  };
  return (
    <div className="form">
      <Input placeholder={translate("common.989c35aa4ec1")} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="list">
        {users?.map((u) => (
          <div key={u.user.id} className={`list-row user-row-admin${u.bannedAt ? " dim" : ""}`}>
            <Avatar user={u.user} size={32} />
            <span className="grow">
              <strong>{u.user.displayName}</strong> <span className="muted small">@{u.user.username}</span>
              <span className="tags">
                {u.isAdmin && <span className="tag accent">{translate("common.8c6976e5b541")}</span>}
                {u.imported && <span className="tag">{translate("common.74f5d3d7eea9")}</span>}
                {u.discordLinked && <span className="tag">{translate("common.e1ba4807a15d")}</span>}
                {u.bannedAt && <span className="tag danger">{rich("common.7751b50b1c8f",{p0:(u.banReason ? `: ${u.banReason}` : "")})}</span>}
              </span>
              <span className="muted small">{rich("common.c95f315b2327",{p0:(new Date(u.createdAt).toLocaleDateString(localizationPreferences().region)),p1:(u.serverCount)})}</span>
            </span>
            {u.user.id !== me && !u.imported && (
              <span className="row-actions">
                <button className="btn btn-ghost btn-small" onClick={() => void act(api.patch(`/admin/users/${u.user.id}`, { isAdmin: !u.isAdmin })).then(load)}>
                  {u.isAdmin ? translate("common.776ef3034932") : translate("common.0b7fd02234f7")}
                </button>
                {!u.isAdmin &&
                  (u.bannedAt ? (
                    <button className="btn btn-ghost btn-small" onClick={() => void act(api.del(`/admin/users/${u.user.id}/ban`), translate("common.5439013791fc")).then(load)}>{translate("common.86e02dde6773")}</button>
                  ) : (
                    <button className="btn btn-danger btn-small" onClick={() => ban(u)}>{translate("common.72f47df8c3fa")}</button>
                  ))}
                {!u.isAdmin && (
                  <button className="icon-btn danger" title={translate("common.8d9113221273")} onClick={() => remove(u)}>
                    <Icon name="trash" size={16} />
                  </button>
                )}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ServersTab({ accountId }: { accountId: string }) {
  const [servers, setServers] = useState<AdminServer[] | null>(null);
  const me = useStore((s) => s.accounts.find((a) => a.id === accountId)?.userId);
  const api = apiFor(accountId);
  const load = () => void api.get<AdminServer[]>("/admin/servers").then(setServers, (e: Error) => toast(e.message));
  useEffect(load, [accountId]);
  return (
    <div className="list">
      {servers?.length === 0 && <p className="muted">{translate("common.ecb29ba214ac")}</p>}
      {servers?.map((s) => (
        <div key={s.server.id} className="list-row">
          <span className="grow">
            <strong>{s.server.name}</strong>
            <span className="muted small">{rich("common.76e944b28852",{p0:(s.owner?.displayName ?? "?"),p1:(s.memberCount),p2:(s.channelCount),p3:(new Date(s.createdAt).toLocaleDateString(localizationPreferences().region))})}</span>
          </span>
          <button
            className="icon-btn danger"
            title={s.server.ownerId === me && s.memberCount > 1 ? translate("common.12c8d248cf08") : translate("common.e5851a510556")}
            disabled={s.server.ownerId === me && s.memberCount > 1}
            onClick={async () => {
              if (await confirmAction(
                translate("common.3116a9c05a6a",{p0:(s.server.name)}),
                { title: translate("settings.2ff41a4858a5",{p0:(s.server.name)}), confirmLabel: translate("common.e5851a510556") },
              )) void act(api.del(`/admin/servers/${s.server.id}`), translate("common.a8140b4b836e")).then(load);
            }}
          >
            <Icon name="trash" size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function InstanceAdminModal({ accountId }: { accountId: string }) {
  const [tab, setTab] = useState<Tab>("settings");
  const account = useStore((s) => s.accounts.find((a) => a.id === accountId));
  return (
    <Modal title={translate("common.281b25e03eef",{p0:(account?.instanceName ?? "")})} wide>
      <div className="tabs">
        {(
          [
            ["settings", translate("common.36664e8242af")],
            ["updates", translate("common.a1f09a31ad36")],
            ["invites", translate("common.e263fc7fddf9")],
            ["users", translate("common.06e7eb96a58e")],
            ["servers", translate("common.c1158df03518")],
          ] as const
        ).map(([t, label]) => (
          <button key={t} className={tab === t ? "tab active" : "tab"} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "settings" && <SettingsTab accountId={accountId} />}
      {tab === "updates" && <UpdatesTab accountId={accountId} />}
      {tab === "invites" && <InvitesTab accountId={accountId} />}
      {tab === "users" && <UsersTab accountId={accountId} />}
      {tab === "servers" && <ServersTab accountId={accountId} />}
    </Modal>
  );
}

/** Self-service account deletion. */
export function DeleteAccountModal({ accountId }: { accountId: string }) {
  const user = useStore((s) => s.instances[accountId]?.user);
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const [deleteMessages, setDeleteMessages] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const submit = async () => {
    setBusy(true);
    const ok = await act(apiFor(accountId).request("DELETE", "/users/@me", { confirm: confirmText, password: password || undefined, deleteMessages }));
    setBusy(false);
    if (ok) {
      closeModal();
      removeAccount(accountId);
      toast(translate("common.56a84683d20d"));
    }
  };
  return (
    <Modal title={translate("common.37642ff749e3")}>
      <div className="form">
        <p className="warning">{translate("common.389cf11250de")}</p>
        <label className="check">
          <Checkbox  checked={deleteMessages} onChange={(e) => setDeleteMessages(e.target.checked)} />{translate("common.22732ed71af8")}</label>
        <p className="muted small">{translate("common.fe48cd4d0ca4")}</p>
        <Field label={translate("common.a5c92f994d5e",{p0:(user.username)})}>
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={user.username} />
        </Field>
        <Field label={translate("common.d482c10b3d4d")} hint={translate("common.e9ad4c3911c9")}>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        <div className="form-actions">
          <button className="btn btn-ghost" onClick={closeModal}>{translate("common.bb9dbb406dcb")}</button>
          <button className="btn btn-danger" disabled={busy || confirmText.trim().toLowerCase() !== user.username.toLowerCase()} onClick={() => void submit()}>{translate("common.8d9113221273")}</button>
        </div>
      </div>
    </Modal>
  );
}

onLocalizationChange(()=>{MODE_TEXT={
  open: translate("common.876622889345"),
  invite: translate("common.fc06912c2595"),
  closed: translate("common.fe6a1348f3ad"),
};});
onLocalizationChange(()=>{LEVEL_TEXT={
  ok: translate("common.8b2c555f2b8b"),
  video_off: translate("common.ddfbc131053a"),
  off: translate("common.67ed9e96f10f"),
};});


