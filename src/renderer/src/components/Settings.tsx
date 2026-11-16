import {rich} from "../lib/localization.ts";
import {t as translate,onLocalizationChange} from "../../../shared/localization/index.ts";
import { Checkbox } from "./ui/checkbox.tsx";
import { Input } from "./ui/input.tsx";
import { confirmAction, promptText } from "./ui/action-dialog.tsx";
import { Select } from "./ui/select.tsx";
import { EntityPicker } from "./ui/entity-picker.tsx";
import { RadioGroup } from "./ui/radio-group.tsx";
import { PermissionToggle } from "./ui/permission-toggle.tsx";
import { Textarea } from "./ui/textarea.tsx";
import {
  has,
  Permission,
  PERMISSION_LABELS,
  categoryAccepts,
  type Ban,
  type CategoryKind,
  type Channel,
  type DiscordLoginBegin,
  type Invite,
  type Overwrite,
  type PermissionName,
  type Role,
  type ServerState,
  type ServerSummary,
  type User,
  type ServerStickerList,
  type PlaybackState,
} from "@annoy/protocol";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { discordLogin, fetchInfo } from "../api.ts";
import { apiFor, ensureServer, openChannel, removeAccount, updateVoiceSettings } from "../client.ts";
import { displayNameOf, rankOf } from "../perms.ts";
import { getState, setState, toast, useStore, type CreatableChannel } from "../store.ts";
import { act, closeModal, Field, Icon, Modal, type IconName } from "./ui.tsx";
import { HiddenServices } from "./Services.tsx";
import { ServerIntegrations } from "../features/integrations/ServerIntegrations.tsx";
import { UpdateSettings } from "./Updates.tsx";
import { Brand } from "./Brand.tsx";
import { Scenery } from "../features/redesign/Scenery.tsx";
const ImageCropper = lazy(() => import("./settings/AvatarCropper.tsx").then((module) => ({ default: module.ImageCropper })));

/** The cover is stored at 960×400; the channel list shows it 132px tall at 220–380px wide. */
const COVER = { width: 960, height: 400 };
const COVER_ASPECT = COVER.width / COVER.height;
const COVER_SAFE = { width: Math.min(1, (220 / 132) / COVER_ASPECT), height: Math.min(1, COVER_ASPECT / (380 / 132)) };
import { ColorPicker } from "./ui/color-picker.tsx";
import { useSettingsDraft, useSettingsGuard } from "./settings/SettingsGuard.tsx";
import { requestNavigation } from "../lib/navigation-guard.ts";
import { useRequestOwner } from "../lib/use-request-owner.ts";
import { isCancellation } from "../../../shared/requests.ts";
import { Switch } from "./ui/switch.tsx";
import { channelNameTaken, storedChannelName } from "../../../shared/channel-order.ts";

const ALL_NAMES = Object.keys(Permission) as PermissionName[];
const TEXT_PERMS: PermissionName[] = ["VIEW_CHANNEL", "SEND_MESSAGES", "MANAGE_MESSAGES", "ATTACH_FILES", "MENTION_EVERYONE"];
const VOICE_PERMS: PermissionName[] = ["VIEW_CHANNEL", "CONNECT", "SPEAK", "STREAM", "MUTE_MEMBERS"];

function useServer(accountId: string, serverId: string): { state: ServerState | undefined; me: string | undefined } {
  return {
    state: useStore((s) => s.instances[accountId]?.serverStates[serverId]),
    me: useStore((s) => s.instances[accountId]?.user?.id),
  };
}

export { UserSettingsModal } from "./settings/UserSettingsModal.tsx";

// Server settings --------------------------------------------------------

function RoleEditor({ accountId, state, role, me, signal }: { accountId: string; state: ServerState; role: Role; me: string; signal: AbortSignal }) {
  const isEveryone = role.id === state.server.id;
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color ?? "#99aab5");
  const [useColor, setUseColor] = useState(role.color !== null);
  const [perms, setPerms] = useState(role.permissions);
  const [baseline, setBaseline] = useState(() => JSON.stringify([role.name, role.color, role.permissions]));
  const values = JSON.stringify([name, useColor ? color : null, perms]);
  useEffect(() => {
    setName(role.name);
    setColor(role.color ?? "#99aab5");
    setUseColor(role.color !== null);
    setPerms(role.permissions);
    setBaseline(JSON.stringify([role.name, role.color, role.permissions]));
  }, [role.id]);
  const editable = isEveryone || rankOf(state, me) > role.position;
  const api = apiFor(accountId);
  const path = `/servers/${state.server.id}/roles/${role.id}`;

  const saveRole = async () => {
    if (!editable) return false;
    const body = isEveryone ? { permissions: perms } : { name, color: useColor ? color : null, permissions: perms };
    const ok = await act(api.patch(path, body, signal), translate("settings.58778bdb575b"));
    if (ok) setBaseline(values);
    return ok;
  };
  useSettingsDraft(`role-${role.id}`, editable && values !== baseline, saveRole, () => {
    setName(role.name);
    setColor(role.color ?? "#99aab5");
    setUseColor(role.color !== null);
    setPerms(role.permissions);
    setBaseline(JSON.stringify([role.name, role.color, role.permissions]));
  });

  return (
    <form
      className="role-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void saveRole();
      }}
    >
      {!editable && <p className="warning">{translate("settings.83af26143fe1")}</p>}
      {!isEveryone && (
        <div className="grid-2">
          <Field label={translate("common.5086900635fe")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!editable} maxLength={100} />
          </Field>
          <Field label={translate("settings.2237b88f398f")}>
            <div className="color-row">
              <Checkbox checked={useColor} onChange={(e) => setUseColor(e.target.checked)} disabled={!editable} />
              <ColorPicker label={translate("settings.2b3809072eeb")} value={color} onChange={setColor} disabled={!editable || !useColor} />
            </div>
          </Field>
        </div>
      )}
      <div className="perm-list">
        {ALL_NAMES.map((p) => (
          <label key={p} className="perm">
            <Checkbox
              checked={(perms & Permission[p]) !== 0}
              disabled={!editable || (!has(state.permissions, Permission[p]) && state.server.ownerId !== me)}
              onChange={(e) => setPerms((v) => (e.target.checked ? v | Permission[p] : v & ~Permission[p]))}
            />
            {PERMISSION_LABELS[p]}
          </label>
        ))}
      </div>
      <div className="form-actions">
        {!isEveryone && editable && (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              title={translate("settings.fb180a2fe512")}
              onClick={() => void act(api.patch(path, { position: role.position + 1 }, signal))}
            >{translate("settings.bdb9ecae8484")}</button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={role.position <= 1}
              onClick={() => void act(api.patch(path, { position: role.position - 1 }, signal))}
            >{translate("settings.25e47ccc8a4d")}</button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={async () => (await confirmAction(translate("settings.1da882b6d78b",{p0:(role.name)}))) && !signal.aborted && void act(api.del(path, signal))}
            >{translate("common.8b19518ff49b")}</button>
          </>
        )}
        <button className="btn" disabled={!editable}>{translate("common.aef7cd5b2081")}</button>
      </div>
    </form>
  );
}

function Bans({ accountId, serverId }: { accountId: string; serverId: string }) {
  const requests = useRequestOwner(JSON.stringify([accountId, serverId, "bans"]));
  const signal = requests.signal;
  const [bans, setBans] = useState<Ban[] | null>(null);
  const load = () =>
    void apiFor(accountId)
      .get<Ban[]>(`/servers/${serverId}/bans`, signal)
      .then((value) => { if (!signal.aborted) setBans(value); }, (e: Error) => { if (!isCancellation(e) && !signal.aborted) toast(e.message); });
  useEffect(load, [accountId, serverId]);
  if (!bans) return <p className="muted">{translate("common.6cc1bbba0f84")}</p>;
  if (bans.length === 0) return <p className="muted">{translate("settings.8154ee0b9e33")}</p>;
  return (
    <div className="list">
      {bans.map((b) => (
        <div key={b.user.id} className="list-row">
          <span>
            <strong>{b.user.displayName}</strong> <span className="muted">@{b.user.username}</span>
            {b.reason && <div className="muted small">{b.reason}</div>}
          </span>
          <button
            className="btn btn-ghost"
            onClick={() => void act(apiFor(accountId).del(`/servers/${serverId}/bans/${b.user.id}`, signal)).then((ok) => ok && !signal.aborted && load())}
          >{translate("common.f3404a4d6d1f")}</button>
        </div>
      ))}
    </div>
  );
}

/** The server's own sticker pack: members send them anywhere, with the server's name. */
function ServerStickers({ accountId, serverId }: { accountId: string; serverId: string }) {
  const requests = useRequestOwner(JSON.stringify([accountId, serverId, "stickers"]));
  const signal = requests.signal;
  const [list, setList] = useState<ServerStickerList | null>(null);
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void apiFor(accountId).get<ServerStickerList>(`/servers/${serverId}/stickers`, signal)
      .then((value) => { if (!signal.aborted) setList(value); }, (e: Error) => { if (!isCancellation(e) && !signal.aborted) toast(e.message); });
  }, [accountId, serverId]);
  if (!list) return <p className="muted">{translate("common.6cc1bbba0f84")}</p>;
  const full = list.stickers.length >= list.limit;
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || !name.trim() || busy || full) return;
    setBusy(true);
    try {
      const next = await apiFor(accountId).uploadSticker<ServerStickerList>(serverId, name.trim(), file, signal);
      if (signal.aborted) return;
      setList(next); setName(""); setFile(null);
      if (input.current) input.current.value = "";
    } catch (error) { if (!isCancellation(error)) toast((error as Error).message); }
    finally { setBusy(false); }
  };
  const remove = async (id: string, label: string) => {
    if (!await confirmAction(translate("settings.stickers.removeConfirm", { p0: label }), { title: translate("settings.stickers.remove"), confirmLabel: translate("settings.stickers.remove") }) || signal.aborted) return;
    try { const next = await apiFor(accountId).del<ServerStickerList>(`/servers/${serverId}/stickers/${id}`, signal); if (!signal.aborted) setList(next); }
    catch (error) { if (!isCancellation(error)) toast((error as Error).message); }
  };
  return (
    <div className="form server-stickers">
      <p className="muted">{translate("settings.stickers.hint")} {translate("settings.stickers.count", { p0: list.stickers.length, p1: list.limit })}</p>
      <form className="server-sticker-add" onSubmit={(event) => void add(event)}>
        <Field label={translate("settings.stickers.name")}><Input value={name} maxLength={32} onChange={(e) => setName(e.target.value)} disabled={busy || full} /></Field>
        <Field label={translate("settings.stickers.image")}><input ref={input} type="file" accept="image/png,image/webp,image/gif" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={busy || full} /></Field>
        <button className="btn" type="submit" disabled={!file || !name.trim() || busy || full}>{translate("settings.stickers.add")}</button>
      </form>
      {full && <p className="muted small">{translate("settings.stickers.full", { p0: list.limit })}</p>}
      <div className="server-sticker-grid">
        {list.stickers.map((sticker) => (
          <figure key={sticker.id}>
            <img src={sticker.url} alt="" loading="lazy" />
            <figcaption className="truncate">{sticker.name}</figcaption>
            <button className="icon-btn" title={translate("settings.stickers.remove")} aria-label={translate("settings.stickers.removeConfirm", { p0: sticker.name })} onClick={() => void remove(sticker.id, sticker.name)}><Icon name="trash" size={15} /></button>
          </figure>
        ))}
      </div>
    </div>
  );
}

export type ServerSettingsPage = "overview" | "roles" | "bans" | "stickers" | "integrations" | "advanced";

export function ServerSettingsModal({ accountId, serverId, initialPage = "overview" }: { accountId: string; serverId: string; initialPage?: ServerSettingsPage }) {
  const requests = useRequestOwner(JSON.stringify([accountId, serverId, "server-settings"]));
  const signal = requests.signal;
  const { state, me } = useServer(accountId, serverId);
  const [tab, setTab] = useState<ServerSettingsPage>(initialPage);
  const stickersSupported = useStore((s) => s.instances[accountId]?.instance?.serverStickers === true);
  const integrationsSupported = useStore((s) => s.instances[accountId]?.instance?.integrations === true);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [name, setName] = useState(state?.server.name ?? "");
  const [icon, setIcon] = useState<File | null | undefined>();
  const [preview, setPreview] = useState<string | null>(state?.server.iconUrl ?? null);
  // The cover at the top of the channel list: undefined = unchanged, null = back to the default art.
  const bannersSupported = useStore((s) => s.instances[accountId]?.instance?.serverBanners === true);
  const [banner, setBanner] = useState<File | null | undefined>();
  const [bannerPreview, setBannerPreview] = useState<string | null>(state?.server.bannerUrl ?? null);
  const bannerInput = useRef<HTMLInputElement>(null);
  // Framing before upload: the file being cropped, and the last original of each so it can be reframed.
  const [cropping, setCropping] = useState<{ kind: "icon" | "banner"; file: File } | null>(null);
  const originals = useRef<{ icon?: File; banner?: File }>({});
  const pickImage = (kind: "icon" | "banner", file: File) => {
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 8 * 1024 * 1024) { toast(translate("settings.4dbb650e6a3d")); return; }
    originals.current[kind] = file;
    // An animated server image keeps its animation; covers are always one still frame.
    if (kind === "icon" && file.type === "image/gif") setIcon(file);
    else setCropping({ kind, file });
  };
  const reframe = async (kind: "icon" | "banner") => {
    const original = originals.current[kind];
    if (original) { setCropping({ kind, file: original }); return; }
    const url = kind === "icon" ? state?.server.iconUrl : state?.server.bannerUrl;
    if (!url) return;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      setCropping({ kind, file: new File([blob], `${kind}.webp`, { type: blob.type }) });
    } catch { toast(translate("settings.9666f56d98a7")); }
  };
  const applyCrop = (blob: Blob) => {
    if (!cropping) return;
    const framed = new File([blob], `${cropping.kind}.webp`, { type: "image/webp" });
    if (cropping.kind === "icon") setIcon(framed); else setBanner(framed);
  };
  useEffect(() => {
    if (banner) { const url = URL.createObjectURL(banner); setBannerPreview(url); return () => URL.revokeObjectURL(url); }
    setBannerPreview(banner === null ? null : state?.server.bannerUrl ?? null);
  }, [banner, state?.server.bannerUrl]);
  const [savingServer, setSavingServer] = useState(false);
  const guard = useSettingsGuard();
  const iconInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (icon) { const url = URL.createObjectURL(icon); setPreview(url); return () => URL.revokeObjectURL(url); }
    setPreview(icon === null ? null : state?.server.iconUrl ?? null);
  }, [icon, state?.server.iconUrl]);
  const [baselineName, setBaselineName] = useState(state?.server.name ?? "");
  const [nextOwner, setNextOwner] = useState("");
  const [transferring, setTransferring] = useState(false);
  const ownershipSupported = useStore((s) => s.instances[accountId]?.instance?.serverOwnership === true);
  const saveName = async () => {
    if (!state || !name.trim() || savingServer || !has(state.permissions, Permission.MANAGE_SERVER)) return false;
    setSavingServer(true);
    try {
      const api = apiFor(accountId);
      let server = await api.patch<ServerSummary>(`/servers/${serverId}`, { name: name.trim(), ...(icon === null && { iconUrl: null }), ...(banner === null && { bannerUrl: null }) }, signal);
      signal.throwIfAborted();
      if (icon) server = await api.uploadServerIcon<ServerSummary>(serverId, icon, signal);
      signal.throwIfAborted();
      if (banner) server = await api.uploadServerBanner<ServerSummary>(serverId, banner, signal);
      signal.throwIfAborted();
      setState((s) => {
        const instance = s.instances[accountId];
        if (instance?.serverStates[serverId]) instance.serverStates[serverId]!.server = server;
        const index = instance?.servers.findIndex((item) => item.id === serverId) ?? -1;
        if (instance && index >= 0) instance.servers[index] = server;
      });
      setName(server.name); setBaselineName(server.name); setIcon(undefined); setBanner(undefined);
      return true;
    } catch (error) { if (!isCancellation(error)) toast((error as Error).message); return false; }
    finally { setSavingServer(false); }
  };
  useSettingsDraft("server-name", !!state && (name !== baselineName || icon !== undefined || banner !== undefined), saveName, () => {
    setName(state?.server.name ?? ""); setBaselineName(state?.server.name ?? ""); setIcon(undefined); setBanner(undefined);
  });
  if (!state || !me) return null;
  const isOwner = state.server.ownerId === me;
  const canRoles = has(state.permissions, Permission.MANAGE_ROLES);
  const canBans = has(state.permissions, Permission.BAN_MEMBERS);
  const canServer = has(state.permissions, Permission.MANAGE_SERVER);
  const canStickers = stickersSupported && has(state.permissions, Permission.MANAGE_STICKERS);
  const api = apiFor(accountId);
  const role = state.roles.find((r) => r.id === roleId) ?? null;
  const alone = state.members.length === 1 && state.members[0]?.user.id === me;
  const eligibleOwners = state.members.filter((m) => m.user.id !== me && !/^(dc|deleted)\./i.test(m.user.username));
  const transfer = async () => {
    const target = eligibleOwners.find((m) => m.user.id === nextOwner);
    if (!target || !ownershipSupported || transferring) return;
    if (!await confirmAction(
      translate("settings.7fc91154f1ec",{p0:(state.server.name),p1:(displayNameOf(target))}),
      { title: translate("settings.cf67a5712a37",{p0:(state.server.name)}), confirmLabel: translate("settings.2ffa385a1bc4") },
    ) || signal.aborted) return;
    setTransferring(true);
    try {
      await api.post(`/servers/${serverId}/ownership`, { userId: target.user.id }, signal);
      signal.throwIfAborted();
      await ensureServer(accountId, serverId, true, signal);
      signal.throwIfAborted();
      toast(translate("settings.56c8b989d512"));
      closeModal();
    } catch (error) { if (!isCancellation(error)) toast((error as Error).message); }
    finally { setTransferring(false); }
  };

  const pages: { id: ServerSettingsPage; icon: IconName; label: string }[] = [
    { id: "overview", icon: "gear", label: translate("common.36664e8242af") },
    ...(canRoles ? [{ id: "roles" as const, icon: "shield" as IconName, label: translate("common.0ca317ead9f6") }] : []),
    ...(canBans ? [{ id: "bans" as const, icon: "lock" as IconName, label: translate("settings.3fa784bd9f2f") }] : []),
    ...(canStickers ? [{ id: "stickers" as const, icon: "smile" as IconName, label: translate("settings.stickers.tab") }] : []),
    ...(integrationsSupported ? [{ id: "integrations" as const, icon: "bot" as IconName, label: translate("integrations.server.tab") }] : []),
  ];
  // Critical actions (ownership, deleting the server) live apart, only for the owner.
  const page: ServerSettingsPage = tab === "advanced" ? (isOwner ? "advanced" : "overview") : pages.some((item) => item.id === tab) ? tab : "overview";
  const go = (next: ServerSettingsPage) => requestNavigation(() => setTab(next));
  const ownerMember = state.members.find((m) => m.user.id === state.server.ownerId);
  const editable = canServer && !savingServer;

  return (
    <Modal title={translate("settings.f9c1ead13901",{p0:(state.server.name)})} className="settings-shell server-settings-modal">
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <div className="settings-identity server-settings-identity">
            <span className="server-settings-mark">{preview ? <img src={preview} alt="" /> : <Icon name="users" size={18} />}</span>
            <span><strong className="truncate">{state.server.name}</strong><small>{translate("settings.server.sidebarCaption")}</small></span>
          </div>
          <nav aria-label={translate("settings.server.nav")}>
            {pages.map((item) => (
              <button key={item.id} aria-current={page === item.id ? "page" : undefined} onClick={() => go(item.id)}>
                <Icon name={item.icon} size={18} />{item.label}
              </button>
            ))}
            {isOwner && <>
              <hr className="settings-nav-divider" />
              <button className="settings-nav-advanced" aria-current={page === "advanced" ? "page" : undefined} onClick={() => go("advanced")}>
                <Icon name="sliders" size={18} />{translate("settings.server.advanced")}
              </button>
            </>}
          </nav>
        </aside>
        <div className="settings-content" key={page}>

      {page === "overview" && (
        <section className="settings-section server-overview">
          <h3>{translate("common.36664e8242af")}</h3>
          <p className="muted">{translate("settings.server.overviewHint")}</p>
          <div className="server-profile-card">
            <div className="server-profile-cover">
              {bannerPreview ? <img src={bannerPreview} alt={translate("settings.banner.preview")} /> : <Scenery />}
              <div className="server-profile-identity">
                <span className="server-profile-icon">{preview ? <img src={preview} alt={translate("settings.e01c38cf8f6a")} /> : <Icon name="users" size={28} />}</span>
                <strong className="truncate">{name.trim() || state.server.name}</strong>
              </div>
            </div>
            <div className="server-profile-controls">
              <div className="server-media-control">
                <h4>{translate("settings.d5430e10d673")}</h4>
                <p>{translate("settings.2d0730e4b559")}</p>
                <div className="profile-actions">
                  <button type="button" className="btn btn-ghost" disabled={!editable} onClick={() => iconInput.current?.click()}>{rich("common.9d7834105f23",{p0:(<Icon name="upload" size={16} />)})}</button>
                  {preview && !(icon ?? originals.current.icon)?.type.includes("gif") && <button type="button" className="btn btn-ghost" disabled={!editable} onClick={() => void reframe("icon")}>{rich("common.a3a3d1eeeba5",{p0:(<Icon name="crop" size={16} />)})}</button>}
                  {preview && <button type="button" className="btn btn-ghost" disabled={!editable} onClick={() => setIcon(null)}>{translate("settings.a3037dc71a43")}</button>}
                </div>
                <small>{translate("settings.aaab0145bf73")}</small>
                <input ref={iconInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label={translate("settings.3d36c034c960")} onChange={(event) => { const file = event.target.files?.[0]; if (file) pickImage("icon", file); event.target.value = ""; }} />
              </div>
              <div className="server-media-control server-banner-editor">
                <h4>{translate("settings.banner.title")}</h4>
                <p>{translate("settings.banner.hint")}</p>
                {bannersSupported ? <>
                  <div className="profile-actions">
                    <button type="button" className="btn btn-ghost" disabled={!editable} onClick={() => bannerInput.current?.click()}><Icon name="upload" size={16} />{translate("settings.banner.change")}</button>
                    {bannerPreview && <button type="button" className="btn btn-ghost" disabled={!editable} onClick={() => void reframe("banner")}>{rich("common.a3a3d1eeeba5",{p0:(<Icon name="crop" size={16} />)})}</button>}
                    {bannerPreview && <button type="button" className="btn btn-ghost" disabled={!editable} onClick={() => setBanner(null)}>{translate("settings.banner.remove")}</button>}
                  </div>
                  <small>{translate("settings.banner.formats")}</small>
                  <input ref={bannerInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label={translate("settings.banner.input")} onChange={(event) => { const file = event.target.files?.[0]; if (file) pickImage("banner", file); event.target.value = ""; }} />
                </> : <small>{translate("settings.banner.unsupported")}</small>}
              </div>
            </div>
          </div>
          <form
            className="server-name-form"
            onSubmit={(e) => {
              e.preventDefault();
              void saveName().then((ok) => { if (ok) guard?.showSaved(); });
            }}
          >
            <Field label={translate("common.87f8ee74878a")}>
              <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!editable} maxLength={100} />
            </Field>
          </form>
          {cropping && (
            <Suspense fallback={null}>
              <ImageCropper
                key={`${cropping.kind}-${cropping.file.name}-${cropping.file.size}`}
                file={cropping.file}
                aspect={cropping.kind === "icon" ? 1 : COVER_ASPECT}
                output={cropping.kind === "icon" ? { width: 512, height: 512 } : COVER}
                title={cropping.kind === "icon" ? translate("settings.crop.iconTitle") : translate("settings.crop.bannerTitle")}
                description={cropping.kind === "icon" ? translate("settings.crop.iconHint") : translate("settings.crop.bannerHint")}
                maskClassName={cropping.kind === "icon" ? "server-icon-crop-mask" : "server-cover-crop-mask"}
                safeArea={cropping.kind === "banner" ? COVER_SAFE : undefined}
                onApply={applyCrop}
                onClose={() => setCropping(null)}
              />
            </Suspense>
          )}
          <p className="muted small server-overview-stats">{rich("common.599e82279c68",{p0:(state.members.length),p1:(state.channels.length),p2:(ownerMember ? displayNameOf(ownerMember) : "—")})}</p>
        </section>
      )}

      {page === "advanced" && isOwner && (
        <section className="settings-section server-advanced">
          <h3>{translate("settings.server.advanced")}</h3>
          <p className="muted">{translate("settings.server.advancedHint")}</p>
          {state.members.length > 1 && (
            <div className="advanced-card">
              <div className="advanced-card-copy">
                <h4>{translate("settings.2ffa385a1bc4")}</h4>
                <p>{ownershipSupported ? translate("settings.ad208b966e27") : translate("settings.675043339ee8")}</p>
              </div>
              <div className="advanced-card-action">
                <Field label={translate("settings.f13545530622")}>
                  <Select aria-label={translate("settings.f13545530622")} value={nextOwner} disabled={!ownershipSupported || transferring} onChange={(event) => setNextOwner(event.target.value)}>
                    <option value="">{translate("settings.e4ff0744869e")}</option>
                    {eligibleOwners.map((m) => <option key={m.user.id} value={m.user.id}>{displayNameOf(m)}</option>)}
                  </Select>
                </Field>
                <button className="btn btn-ghost" disabled={!ownershipSupported || !nextOwner || transferring} onClick={() => void transfer()}>
                  {transferring ? translate("common.25135fc46d48") : translate("settings.2ffa385a1bc4")}
                </button>
              </div>
            </div>
          )}
          <div className="advanced-card advanced-card-danger">
            <div className="advanced-card-copy">
              <h4>{translate("common.e5851a510556")}</h4>
              <p>{translate("settings.a5a64afbc77b")}</p>
              {!alone && <p className="advanced-card-note">{translate("settings.11382df9e2be")}</p>}
            </div>
            <div className="advanced-card-action">
              <button
                className="btn btn-danger"
                disabled={!alone || transferring}
                onClick={async () => {
                  if (alone && await confirmAction(
                    translate("common.3116a9c05a6a",{p0:(state.server.name)}),
                    { title: translate("settings.2ff41a4858a5",{p0:(state.server.name)}), confirmLabel: translate("common.e5851a510556") },
                  )) {
                    void act(api.del(`/servers/${serverId}`)).then((ok) => ok && closeModal());
                  }
                }}
              >{translate("common.e5851a510556")}</button>
            </div>
          </div>
        </section>
      )}

      {page === "roles" && (
        <section className="settings-section server-roles">
        <h3>{translate("common.0ca317ead9f6")}</h3>
        <div className="roles-layout">
          <div className="roles-list">
            <button
              className="btn btn-ghost full"
              onClick={() =>
                void api.post<Role>(`/servers/${serverId}/roles`, { name: translate("settings.1e2d5bd4271d") }).then(
                  (r) => requestNavigation(() => setRoleId(r.id)),
                  (e: Error) => toast(e.message),
                )
              }
            >{rich("common.6b8c1e48e666",{p0:(<Icon name="plus" size={16} />)})}</button>
            {state.roles.map((r) => (
              <button
                key={r.id}
                className={`role-item${r.id === roleId ? " active" : ""}`}
                onClick={() => requestNavigation(() => setRoleId(r.id))}
              >
                <span className="role-dot" style={{ background: r.color ?? "var(--text-muted)" }} />
                <span className="truncate">{r.name}</span>
              </button>
            ))}
          </div>
          <div className="roles-editor">
            {role ? (
                    <RoleEditor key={role.id} accountId={accountId} state={state} role={role} me={me} signal={signal} />
            ) : (
              <p className="muted">{translate("settings.833a555bd986")}</p>
            )}
          </div>
        </div>
        </section>
      )}

      {page === "bans" && <section className="settings-section"><h3>{translate("settings.3fa784bd9f2f")}</h3><Bans accountId={accountId} serverId={serverId} /></section>}
      {page === "stickers" && canStickers && <section className="settings-section"><h3>{translate("settings.stickers.tab")}</h3><ServerStickers accountId={accountId} serverId={serverId} /></section>}
      {page === "integrations" && integrationsSupported && <section className="settings-section"><h3>{translate("integrations.server.tab")}</h3><ServerIntegrations accountId={accountId} serverId={serverId} isOwner={isOwner} /></section>}
        </div>
      </div>
    </Modal>
  );
}

// Channel settings -------------------------------------------------------

function OverwriteEditor({ accountId, state, channel, me, signal }: { accountId: string; state: ServerState; channel: Channel; me: string; signal: AbortSignal }) {
  const targets = useMemo(
    () => [
      ...state.roles.map((r) => ({ id: r.id, type: "role" as const, label: r.name })),
      ...state.members.map((m) => ({ id: m.user.id, type: "member" as const, label: displayNameOf(m) })),
    ],
    [state.roles, state.members],
  );
  const [targetId, setTargetId] = useState(state.server.id);
  const existing = channel.overwrites.find((o) => o.targetId === targetId);
  const [allow, setAllow] = useState(existing?.allow ?? 0);
  const [deny, setDeny] = useState(existing?.deny ?? 0);
  const [baseline, setBaseline] = useState(() => `${existing?.allow ?? 0}:${existing?.deny ?? 0}`);
  const last = useRef(targetId);
  useEffect(() => {
    if (last.current !== targetId) {
      setAllow(existing?.allow ?? 0);
      setDeny(existing?.deny ?? 0);
      last.current = targetId;
      setBaseline(`${existing?.allow ?? 0}:${existing?.deny ?? 0}`);
    }
  }, [targetId, existing]);

  const target = targets.find((t) => t.id === targetId)!;
  const names =
    channel.type === "voice" ? VOICE_PERMS : channel.type === "text" ? TEXT_PERMS : [...new Set([...TEXT_PERMS, ...VOICE_PERMS])];
  const api = apiFor(accountId);
  const set = (p: PermissionName, mode: "allow" | "inherit" | "deny") => {
    const bit = Permission[p];
    setAllow((a) => (mode === "allow" ? a | bit : a & ~bit));
    setDeny((d) => (mode === "deny" ? d | bit : d & ~bit));
  };
  const save = async () => {
    if (!target || !canEdit) return false;
    const body: Overwrite & { targetType: "role" | "member" } = { targetId, targetType: target.type, allow, deny };
    const ok = await act(api.put(`/channels/${channel.id}/overwrites/${targetId}`, body, signal), translate("settings.37a421b916b2"));
    if (ok) setBaseline(`${allow}:${deny}`);
    return ok;
  };
  const canEdit = has(state.permissions, Permission.MANAGE_ROLES) || state.server.ownerId === me;
  useSettingsDraft(`overwrite-${channel.id}`, canEdit && `${allow}:${deny}` !== baseline, save, () => {
    setAllow(existing?.allow ?? 0);
    setDeny(existing?.deny ?? 0);
    setBaseline(`${existing?.allow ?? 0}:${existing?.deny ?? 0}`);
  });

  return (
    <div className="overwrites">
      <div className="field">
        <span className="field-label">{translate("settings.e5cbba99ab86")}</span>
        <EntityPicker
          label={translate("settings.6e30ee02c142")}
          value={targetId}
          onValueChange={(id) => requestNavigation(() => setTargetId(id))}
          items={targets.map((t) => ({
            id: t.id,
            label: t.label,
            group: t.type === "role" ? translate("common.0ca317ead9f6") : translate("chat.d5fe73508340"),
            description:
              t.type === "role"
                ? t.id === state.server.id
                  ? translate("settings.6a69de16d1bc")
                  : translate("settings.359565b63ccc")
                : `@${state.members.find((m) => m.user.id === t.id)?.user.username ?? ""}`,
            color: state.roles.find((r) => r.id === t.id)?.color,
            avatarUrl: state.members.find((m) => m.user.id === t.id)?.user.avatarUrl,
            customized: channel.overwrites.some((o) => o.targetId === t.id),
          }))}
        />
        <span className="field-hint">{translate("settings.b2790f214f5d")}</span>
      </div>
      <div className="tri-list">
        {names.map((p) => {
          const bit = Permission[p];
          const mode = allow & bit ? "allow" : deny & bit ? "deny" : "inherit";
          return (
            <div key={p} className="tri-row">
              <span>{PERMISSION_LABELS[p]}</span>
              <PermissionToggle label={PERMISSION_LABELS[p]} value={mode} disabled={!canEdit} onValueChange={(mode) => set(p, mode)} />
            </div>
          );
        })}
      </div>
      <div className="form-actions">
        {existing && (
          <button
            className="btn btn-ghost"
            disabled={!canEdit}
            onClick={() =>
              void act(api.del(`/channels/${channel.id}/overwrites/${targetId}`, signal), translate("settings.26de106a45e7")).then((ok) => {
                if (ok) {
                  setAllow(0);
                  setDeny(0);
                  setBaseline("0:0");
                }
              })
            }
          >{translate("settings.f3a8290d5fd0")}</button>
        )}
        <button className="btn" onClick={() => void save()} disabled={!canEdit}>{translate("settings.e4969ff26ac9")}</button>
      </div>
    </div>
  );
}

export function ChannelSettingsModal({ accountId, serverId, channelId }: { accountId: string; serverId: string; channelId: string }) {
  const requests = useRequestOwner(JSON.stringify([accountId, serverId, channelId, "channel-settings"]));
  const signal = requests.signal;
  const { state, me } = useServer(accountId, serverId);
  const channel = state?.channels.find((c) => c.id === channelId);
  const [tab, setTab] = useState<"overview" | "perms">("overview");
  const [name, setName] = useState(channel?.name ?? "");
  const [topic, setTopic] = useState(channel?.topic ?? "");
  const [parentId, setParentId] = useState(channel?.parentId ?? "");
  const [ttl, setTtl] = useState(String(channel?.messageTtlMs ?? 0));
  const [kind, setKind] = useState<CategoryKind>(channel?.categoryKind ?? "mixed");
  const kindsSupported = useStore((s) => s.instances[accountId]?.instance?.categoryKinds === true);
  const [baseline, setBaseline] = useState(() => JSON.stringify([channel?.name ?? "", channel?.topic ?? "", channel?.parentId ?? "", String(channel?.messageTtlMs ?? 0), channel?.categoryKind ?? "mixed"]));
  const values = JSON.stringify([name, topic, parentId, ttl, kind]);
  // Music rooms: whether a finished track leaves the queue for the history. It lives with the
  // room's playback; "unsupported" when the server doesn't have it yet.
  const [removePlayed, setRemovePlayed] = useState<boolean | "unsupported" | null>(null);
  const [removeSaved, setRemoveSaved] = useState<boolean | "unsupported" | null>(null);
  useEffect(() => {
    if (channel?.type !== "song") return;
    void apiFor(accountId).get<PlaybackState>(`/channels/${channelId}/playback`, signal).then(
      (playback) => { const value = playback.removePlayed ?? "unsupported"; setRemovePlayed(value); setRemoveSaved(value); },
      () => undefined,
    );
  }, [accountId, channelId, channel?.type]);
  const removeChanged = typeof removePlayed === "boolean" && removePlayed !== removeSaved;
  const saveChannel = async () => {
    if (!channel || !name.trim()) return false;
    const place = channel.type === "category" ? null : parentId || null;
    // Only a new name or place must be free: rooms that already share a name stay editable.
    if ((name.trim() !== channel.name || place !== (channel.parentId ?? null)) && !channel.temporary && state && channelNameTaken(state.channels, channel.type, name, place, channel.id)) {
      toast(translate(channel.type === "category" ? "channels.categoryNameTaken" : "channels.nameTaken"));
      return false;
    }
    // A category becomes text or voice only once every room in it is of that kind.
    if (channel.type === "category" && kind !== (channel.categoryKind ?? "mixed") && state?.channels.some((c) => c.parentId === channel.id && !categoryAccepts(kind, c.type))) {
      toast(translate("channels.kindDoesNotFit"));
      return false;
    }
    if (removeChanged) {
      const saved = await act(apiFor(accountId).post(`/channels/${channel.id}/playback`, { op: "removePlayed", value: removePlayed }, signal), translate("settings.286e2185677a"));
      if (!saved) return false;
      setRemoveSaved(removePlayed);
      if (values === baseline) return true;
    }
    const ok = await act(
      apiFor(accountId).patch(`/channels/${channel.id}`, {
        name,
        topic,
        ...(channel.type !== "category" && { parentId: parentId || null }),
        ...(channel.type === "text" && { messageTtlMs: Number(ttl) || null }),
        ...(channel.type === "category" && kindsSupported && kind !== (channel.categoryKind ?? "mixed") && { categoryKind: kind }),
      }, signal),
      translate("settings.286e2185677a"),
    );
    if (ok) setBaseline(values);
    return ok;
  };
  useSettingsDraft("channel", !!channel && (values !== baseline || removeChanged), saveChannel, () => {
    setRemovePlayed(removeSaved);
    setName(channel?.name ?? "");
    setTopic(channel?.topic ?? "");
    setParentId(channel?.parentId ?? "");
    setTtl(String(channel?.messageTtlMs ?? 0));
    setKind(channel?.categoryKind ?? "mixed");
    setBaseline(JSON.stringify([channel?.name ?? "", channel?.topic ?? "", channel?.parentId ?? "", String(channel?.messageTtlMs ?? 0), channel?.categoryKind ?? "mixed"]));
  });
  if (!state || !channel || !me) return null;
  const api = apiFor(accountId);
  // A room may only go into categories that take its kind (and stays listed where it already is).
  const categories = state.channels.filter((c) => c.type === "category" && (c.id === channel.parentId || categoryAccepts(c.categoryKind, channel.type)));

  return (
    <Modal title={translate("settings.9d291f786fc2",{p0:(channel.type === "category" ? "categoria" : "canal"),p1:(channel.name)})} wide className="edit-settings-modal channel-settings-modal">
      <div className="tabs">
        <button className={tab === "overview" ? "tab active" : "tab"} onClick={() => requestNavigation(() => setTab("overview"))}>{translate("common.36664e8242af")}</button>
        <button className={tab === "perms" ? "tab active" : "tab"} onClick={() => requestNavigation(() => setTab("perms"))}>{translate("settings.e998327fd0a8")}</button>
      </div>
      {tab === "overview" ? (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void saveChannel();
          }}
        >
          <Field label={translate("common.5086900635fe")}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
          </Field>
          {channel.type === "text" && (
            <Field label={translate("settings.9b4712e9b37d")}>
              <Textarea value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={1024} rows={3} />
            </Field>
          )}
          {channel.type === "text" && (
            <Field label={translate("common.b00744e0264c")} hint={translate("common.080ea8f6c8b6")}>
              <Select value={ttl} onChange={(e) => setTtl(e.target.value)} aria-label={translate("common.b00744e0264c")}>
                <option value="0">{translate("common.7478aab6c4ec")}</option>
                <option value="3600000">{translate("common.58ad51cd91ae")}</option>
                <option value="86400000">{translate("common.f47c055c40a2")}</option>
                <option value="604800000">{translate("common.8189eb8c1819")}</option>
              </Select>
            </Field>
          )}
          {channel.type === "category" && kindsSupported && <CategoryKindChoice value={kind} onChange={setKind} />}
          {channel.type === "song" && removePlayed !== null && (
            removePlayed === "unsupported"
              ? <p className="muted small">{translate("song.removePlayedServer")}</p>
              : (
                <label className="switch-setting">
                  <span><strong>{translate("song.removePlayed")}</strong><small>{translate("song.removePlayedHint")}</small></span>
                  <Switch aria-label={translate("song.removePlayed")} checked={removePlayed} onCheckedChange={setRemovePlayed} />
                </label>
              )
          )}
          {channel.type !== "category" && (
            <Field label={translate("settings.54276aa0307f")}>
              <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">{translate("settings.ccad7dc69cc9")}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-danger"
              onClick={async () =>
                (await confirmAction(translate("settings.d0d7e34435f3",{p0:(channel.name)}))) &&
                !signal.aborted && void act(api.del(`/channels/${channel.id}`, signal)).then((ok) => ok && !signal.aborted && closeModal())
              }
            >{translate("common.8b19518ff49b")}</button>
            <button className="btn">{translate("common.aef7cd5b2081")}</button>
          </div>
        </form>
      ) : (
        <OverwriteEditor accountId={accountId} state={state} channel={channel} me={me} signal={signal} />
      )}
    </Modal>
  );
}

// Create channel / invite ------------------------------------------------

let CHANNEL_KINDS: { type: Exclude<CreatableChannel, "category">; icon: IconName; label: string; hint: string; placeholder: string }[] = [
  { type: "text", icon: "hash", label: translate("settings.6df3d6661c09"), hint: translate("settings.4d2823a7ab2b"), placeholder: "novo-canal" },
  { type: "voice", icon: "speaker", label: translate("settings.c9566ca43bdc"), hint: translate("settings.5137e48939d0"), placeholder: translate("settings.46a6407e52eb") },
  { type: "files", icon: "folder", label: translate("settings.c11445cb4fe1"), hint: translate("settings.899d9009f3a1"), placeholder: "arquivos" },
  { type: "code", icon: "code", label: translate("settings.f58b85570398"), hint: translate("settings.1e70fd4d58b6"), placeholder: "projeto" },
  { type: "theater", icon: "theater", label: translate("settings.fbfbad677c30"), hint: translate("settings.40870c267edf"), placeholder: translate("settings.89ec0bb81771") },
  { type: "song", icon: "song", label: translate("settings.fea4b5ceffa8"), hint: translate("settings.5ec4ffe12cbf"), placeholder: translate("settings.0ff883c0e9cf") },
];

export function CreateChannelModal({
  accountId,
  serverId,
  parentId: initialParent,
  type: initialType,
}: {
  accountId: string;
  serverId: string;
  parentId: string | null;
  type: CreatableChannel;
}) {
  const requests = useRequestOwner(JSON.stringify([accountId, serverId, "create-channel"]));
  const signal = requests.signal;
  const { state } = useServer(accountId, serverId);
  const kindsSupported = useStore((s) => s.instances[accountId]?.instance?.categoryKinds === true);
  // Opened from a voice-only category, a room starts as voice (and the other way round).
  const [type, setType] = useState<CreatableChannel>(() => {
    const kind = state?.channels.find((c) => c.id === initialParent)?.categoryKind;
    return initialType === "category" || categoryAccepts(kind, initialType) ? initialType : kind === "voice" ? "voice" : "text";
  });
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState(initialParent ?? "");
  const [categoryKind, setCategoryKind] = useState<CategoryKind>("mixed");
  const [creating, setCreating] = useState(false);
  // Only the categories that take this kind of room.
  const categories = state?.channels.filter((c) => c.type === "category" && categoryAccepts(c.categoryKind, type)) ?? [];
  const place = type !== "category" && categories.some((c) => c.id === parentId) ? parentId : "";
  // Same rule as the server: one name per type and place.
  const taken = !!state && !!name.trim() && channelNameTaken(state.channels, type, storedChannelName(type, name), place || null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (creating || taken) return;
    setCreating(true);
    try {
      const channel = await apiFor(accountId).post<Channel>(`/servers/${serverId}/channels`, {
        name,
        type,
        parentId: place || null,
        ...(type === "category" && kindsSupported && { categoryKind }),
      }, signal);
      signal.throwIfAborted();
      closeModal();
      if (channel.type !== "category" && channel.type !== "voice" && channel.type !== "theater") openChannel(accountId, serverId, channel.id);
    } catch (err) {
      if (!isCancellation(err)) toast((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal title={type === "category" ? translate("common.81e041a9dd1e") : translate("common.710092c64ff1")}>
      <form className="form" onSubmit={submit}>
        {initialType !== "category" && (
          <RadioGroup
            cards
            label={translate("settings.54238d0a9e5e")}
            value={type}
            onValueChange={(value) => setType(value as CreatableChannel)}
            options={CHANNEL_KINDS.map((kind) => ({
              value: kind.type,
              label: (
                <>
                  <Icon name={kind.icon} />
                  <span>
                    <strong>{kind.label}</strong>
                    <span className="muted small">{kind.hint}</span>
                  </span>
                </>
              ),
            }))}
          />
        )}
        <Field label={translate("common.5086900635fe")}>
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={type === "category" ? translate("settings.bd2af681513d") : (CHANNEL_KINDS.find((k) => k.type === type)?.placeholder ?? translate("common.f118f1738f1c"))}
            required
            maxLength={100}
            aria-invalid={taken || undefined}
          />
        </Field>
        {taken && <p className="error small" role="alert">{translate(type === "category" ? "channels.categoryNameTaken" : "channels.nameTaken")}</p>}
        {type === "category" && kindsSupported && <CategoryKindChoice value={categoryKind} onChange={setCategoryKind} />}
        {type !== "category" && categories.length > 0 && (
          <Field label={translate("settings.54276aa0307f")}>
            <Select value={place} onChange={(e) => setParentId(e.target.value)}>
              <option value="">{translate("settings.ccad7dc69cc9")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={closeModal}>{translate("common.bb9dbb406dcb")}</button>
          <button className="btn" disabled={!name.trim() || creating}>
            {creating ? translate("common.c2bfeb573530") : translate("common.49ba5d18d8c4")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function InviteModal({ accountId, serverId }: { accountId: string; serverId: string }) {
  const requests = useRequestOwner(JSON.stringify([accountId, serverId, "invite"]));
  const signal = requests.signal;
  const { state } = useServer(accountId, serverId);
  const account = getState().accounts.find((a) => a.id === accountId);
  const [expires, setExpires] = useState<string>("168");
  const [maxUses, setMaxUses] = useState<string>("");
  const [invite, setInvite] = useState<Invite | null>(null);
  const [creating, setCreating] = useState(false);
  const create = async () => {
    if (creating || signal.aborted) return;
    setCreating(true);
    try {
      const value = await apiFor(accountId).post<Invite>(`/servers/${serverId}/invites`, {
        expiresInHours: expires ? Number(expires) : null,
        maxUses: maxUses ? Number(maxUses) : null,
      }, signal);
      signal.throwIfAborted();
      setInvite(value);
    } catch (error) {
      if (!isCancellation(error) && !signal.aborted) toast((error as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const address = account?.url.replace(/^https?:\/\//, "") ?? "";
  const shareText = invite ? translate("settings.dad5e4dea793",{p0:(state?.server.name ?? "servidor"),p1:(address),p2:(invite.code)}) : "";

  return (
    <Modal className="invite-modal" title={translate("settings.da11a4766d0f",{p0:(state?.server.name ?? "servidor")})}>
      <p className="muted invite-hint">{translate("settings.9d3bb8f1f7de")}</p>
      <section className="invite-share" aria-live="polite">
        <div className="invite-share-row">
          <span className="section-label">{translate("common.ef5e7e12bdac")}</span>
          <code className="invite-address" title={address}>{address}</code>
        </div>
        <div className="invite-share-row">
          <span className="section-label">{translate("settings.fd2dea51bf78")}</span>
          <div className="invite-code-line">
            {invite ? <code className="invite-code">{invite.code}</code> : <span className="invite-code-empty">{translate("settings.829454028287")}</span>}
            {invite && (
              <button
                className="btn invite-copy"
                onClick={() => void navigator.clipboard.writeText(shareText).then(() => toast(translate("settings.93b61881e9ef")))}
              >{rich("common.fc99510c240c",{p0:(<Icon name="link" size={16} />)})}</button>
            )}
          </div>
        </div>
      </section>
      <div className="grid-2 invite-options">
        <Field label={translate("common.e5b7cdb2f565")}>
          <Select value={expires} disabled={creating} onChange={(e) => setExpires(e.target.value)}>
            <option value="1">{translate("settings.7e93c7711c40")}</option>
            <option value="24">{translate("common.f2beffdd5114")}</option>
            <option value="168">{translate("common.23060decf8cd")}</option>
            <option value="">{translate("common.12fcd0c7b77c")}</option>
          </Select>
        </Field>
        <Field label={translate("settings.52df929283ec")}>
          <Select value={maxUses} disabled={creating} onChange={(e) => setMaxUses(e.target.value)}>
            <option value="">{translate("common.b669ba5781e9")}</option>
            <option value="1">{translate("settings.444c70050e3e")}</option>
            <option value="5">{translate("settings.b7b0d307f247")}</option>
            <option value="25">{translate("settings.318a6f8cb146")}</option>
          </Select>
        </Field>
      </div>
      <div className="form-actions">
        <button className={invite ? "btn btn-ghost" : "btn"} disabled={creating} onClick={() => void create()}>
          {creating ? translate("common.7bf220a3c328") : invite ? translate("settings.911b7023c02d") : translate("settings.3d461f35dfb4")}
        </button>
      </div>
    </Modal>
  );
}

onLocalizationChange(()=>{CHANNEL_KINDS=[
  { type: "text", icon: "hash", label: translate("settings.6df3d6661c09"), hint: translate("settings.4d2823a7ab2b"), placeholder: "novo-canal" },
  { type: "voice", icon: "speaker", label: translate("settings.c9566ca43bdc"), hint: translate("settings.5137e48939d0"), placeholder: translate("settings.46a6407e52eb") },
  { type: "files", icon: "folder", label: translate("settings.c11445cb4fe1"), hint: translate("settings.899d9009f3a1"), placeholder: "arquivos" },
  { type: "code", icon: "code", label: translate("settings.f58b85570398"), hint: translate("settings.1e70fd4d58b6"), placeholder: "projeto" },
  { type: "theater", icon: "theater", label: translate("settings.fbfbad677c30"), hint: translate("settings.40870c267edf"), placeholder: translate("settings.89ec0bb81771") },
  { type: "song", icon: "song", label: translate("settings.fea4b5ceffa8"), hint: translate("settings.5ec4ffe12cbf"), placeholder: translate("settings.0ff883c0e9cf") },
];});

onLocalizationChange(()=>{CHANNEL_KINDS=[
  { type: "text", icon: "hash", label: translate("settings.6df3d6661c09"), hint: translate("settings.4d2823a7ab2b"), placeholder: "novo-canal" },
  { type: "voice", icon: "speaker", label: translate("settings.c9566ca43bdc"), hint: translate("settings.5137e48939d0"), placeholder: translate("settings.46a6407e52eb") },
  { type: "files", icon: "folder", label: translate("settings.c11445cb4fe1"), hint: translate("settings.899d9009f3a1"), placeholder: "arquivos" },
  { type: "code", icon: "code", label: translate("settings.f58b85570398"), hint: translate("settings.1e70fd4d58b6"), placeholder: "projeto" },
  { type: "theater", icon: "theater", label: translate("settings.fbfbad677c30"), hint: translate("settings.40870c267edf"), placeholder: translate("settings.89ec0bb81771") },
  { type: "song", icon: "song", label: translate("settings.fea4b5ceffa8"), hint: translate("settings.5ec4ffe12cbf"), placeholder: translate("settings.0ff883c0e9cf") },
];});

/** Mixed, text-only or voice-only: what rooms a category takes. */
function CategoryKindChoice({ value, onChange }: { value: CategoryKind; onChange: (kind: CategoryKind) => void }) {
  const kinds: { value: CategoryKind; label: string; hint: string }[] = [
    { value: "mixed", label: translate("channels.kindMixed"), hint: translate("channels.kindMixedHint") },
    { value: "text", label: translate("channels.kindText"), hint: translate("channels.kindTextHint") },
    { value: "voice", label: translate("channels.kindVoice"), hint: translate("channels.kindVoiceHint") },
  ];
  return (
    <Field label={translate("channels.kind")} hint={kinds.find((kind) => kind.value === value)?.hint}>
      <Select value={value} onChange={(event) => onChange(event.target.value as CategoryKind)} aria-label={translate("channels.kind")}>
        {kinds.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
      </Select>
    </Field>
  );
}
