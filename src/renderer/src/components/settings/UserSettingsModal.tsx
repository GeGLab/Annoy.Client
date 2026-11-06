import {rich} from "../../lib/localization.ts";
import { DevicesList } from "../auth/DevicesList.tsx";
import { CloudProfileEditor } from "../social/CloudProfileEditor.tsx";
import {localizationPreferences} from "../../../../shared/localization/index.ts";
import {configureLocalization,normalizeLocalization} from "../../../../shared/localization/index.ts";
import {LocalizationSettings} from "./LocalizationSettings.tsx";
import {DesktopSettings} from "./DesktopSettings.tsx";
import type {DesktopPreferences,DesktopSnapshot} from "../../../../shared/desktop.ts";
import {t as translate,textForError,onLocalizationChange} from "../../../../shared/localization/index.ts";
import {normalizeProfileField} from "@annoy/protocol";
import { Checkbox } from "../ui/checkbox.tsx";
import { Slider } from "../ui/slider.tsx";
import { confirmAction } from "../ui/action-dialog.tsx";
import type { DiscordLoginBegin, User } from "@annoy/protocol";
import { useEffect, useRef, useState } from "react";
import { discordLogin, fetchInfo } from "../../api.ts";
import { apiFor, applyUserUpdate, removeAccount, updateVoiceSettings } from "../../client.ts";
import { getState, setState, toast, useStore, type Settings } from "../../store.ts";
import { deviceChoice, shownDevice } from "../../lib/devices.ts";
import { applyTheme } from "../../lib/theme.ts";
import { registerNavigationGuard, requestNavigation } from "../../lib/navigation-guard.ts";
import { AppearanceSettings } from "../AppearanceSettings.tsx";
import { Input } from "../ui/input.tsx";
import { ActivityCard } from "../../features/activity/ActivityCard.tsx";
import { SteamConnection } from "../../features/activity/SteamConnection.tsx";
import { Avatar, Field, Icon, Modal, openModal, type IconName } from "../ui.tsx";
import { Button } from "../ui/button.tsx";
import { Select } from "../ui/select.tsx";
import { RadioGroup } from "../ui/radio-group.tsx";
import { Switch } from "../ui/switch.tsx";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog.tsx";
import { UpdateSettings } from "../Updates.tsx";
import { MediaLibrarySettings } from "../../features/expression/MediaLibrarySettings.tsx";
import { ProfileEditor, type ProfileDraft } from "./ProfileEditor.tsx";
import { NOISE_FILTERS, openMic, type Mic, type NoiseFilter } from "../../noise.ts";
import { HiddenServices } from "../Services.tsx";
import { screenAudioSupported } from "../../media-profiles.ts";
import { PreferenceCard } from "./PreferenceCard.tsx";
import { MicFiltersEditor } from "./MicFiltersEditor.tsx";
import type { MicFilters } from "../../audio/mic-filters.ts";
import { accountWebsite, signOut as signOutGlobal } from "../../auth/session.ts";
import { useRequestOwner } from "../../lib/use-request-owner.ts";
import { isCancellation } from "../../../../shared/requests.ts";
import { SavedNotice, useSavedNotice } from "./SavedNotice.tsx";

let SETTINGS_PAGES: { id: string; label: string; icon: IconName; search: string }[] = [
  {id:"desktop",label:translate("desktop.title"),icon:"monitor",search:translate("desktop.title")},
  {id:"localization",label:translate("settings.b7b7db231778"),icon:"globe",search:translate("settings.97bbf9167943")},
  { id: "profile", label: translate("settings.b9e5ce2ce127"), icon: "users", search: translate("common.f1097b1bdaf9") },
  { id: "expressions", label: translate("expression.728001e6a865"), icon: "smile", search: translate("settings.8531d86304ac") },
  { id: "voice", label: translate("settings.7bb3eccdf5f8"), icon: "mic", search: translate("settings.7e1b71648e19") },
  { id: "appearance", label: translate("settings.04f9f0a78dbe"), icon: "palette", search: translate("settings.ae256cfcdedc") },
  { id: "tabs", label: translate("settings.0ac1d8649dc7"), icon: "sliders", search: translate("settings.1ae5d2bcf2c5") },
  { id: "activity", label: translate("common.a5121730503f"), icon: "radio", search: translate("settings.a19ddf531397") },
  { id: "notifications", label: translate("settings.6b8e9ecbc2ba"), icon: "message", search: translate("settings.95f1668c7abc") },
  { id: "security", label: translate("common.797c0d01ff48"), icon: "lock", search: translate("common.fd32174ee399") },
  { id: "updates", label: translate("common.a1f09a31ad36"), icon: "download", search: translate("settings.89883f1fa251") },
];
const normalizeSearch = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase(localizationPreferences().region);

/** Live level of the filtered microphone, optionally played back so you can hear the filter. */
const SLOT = { inputDeviceId: "input", outputDeviceId: "output", cameraDeviceId: "camera" } as const;
const LABEL = { inputDeviceId: "inputDeviceLabel", outputDeviceId: "outputDeviceLabel", cameraDeviceId: "cameraDeviceLabel" } as const;

function MicMeter({ deviceId, deviceLabel, threshold, filter, filters }: { deviceId: string; deviceLabel: string; threshold: number; filter: NoiseFilter; filters: MicFilters }) {
  const [enabled, setEnabled] = useState(false);
  const live = useRef<Mic | null>(null);
  const latest = useRef(filters);
  latest.current = filters;
  // Filter values change live, so tuning them while listening needs no restart.
  useEffect(() => { live.current?.setFilters(filters); }, [filters]);
  const [monitor, setMonitor] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false,
      frame = 0;
    let mic: Mic | null = null;
    void openMic(deviceId, filter, latest.current, deviceLabel)
      .then((value) => {
        if (stopped) return value.stop();
        mic = value;
        live.current = value;
        const analyser = value.ctx.createAnalyser();
        analyser.fftSize = 512;
        value.output.connect(analyser);
        if (monitor) value.output.connect(value.ctx.destination);
        const bytes = new Uint8Array(analyser.fftSize);
        const loop = () => {
          if (stopped) return;
          analyser.getByteTimeDomainData(bytes);
          let peak = 0;
          for (const byte of bytes) peak = Math.max(peak, Math.abs(byte - 128));
          setLevel((peak / 128) * 100);
          frame = requestAnimationFrame(loop);
        };
        loop();
      })
      .catch(() => {
        setError(translate("settings.dffef56aa220"));
        setEnabled(false);
      });
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      mic?.stop();
      live.current = null;
    };
  }, [enabled, deviceId, filter, monitor]);
  return (
    <>
      <div className="meter">
        <div className={`meter-fill${level >= threshold ? " hot" : ""}`} style={{ width: `${Math.min(100, level)}%` }} />
        <div className="meter-threshold" style={{ left: `${threshold}%` }} />
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          setError(null);
          setEnabled((value) => !value);
        }}
      >
        {enabled ? translate("settings.50729949a7d2") : translate("settings.06ae64f429c4")}
      </Button>
      <label className="check">
        <Checkbox checked={monitor} onChange={(event) => setMonitor(event.target.checked)} />{translate("settings.df335610213e")}</label>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function AccountActions({ accountId, busy }: { accountId: string; busy: boolean }) {
  const requests = useRequestOwner(accountId);
  const account = useStore((s) => s.accounts.find((a) => a.id === accountId));
  const [discord, setDiscord] = useState(false);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    if (!account) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, requests.signal]);
    void fetchInfo(account.url, signal).then((info) => { signal.throwIfAborted(); setDiscord(info.discordLogin); })
      .catch((error) => { if (!isCancellation(error)) setDiscord(false); });
    return () => controller.abort();
  }, [account?.url]);
  const sync = async () => {
    if (!account || syncing) return;
    const signal = requests.signal;
    setSyncing(true);
    try {
      await discordLogin(
        account.url,
        () => apiFor(accountId).post<DiscordLoginBegin>("/auth/discord/begin", { link: true }, signal),
        signal,
      );
      signal.throwIfAborted();
      toast(translate("settings.c20a38d028a4"));
    } catch (error) {
      if (!isCancellation(error)) toast((error as Error).message);
    } finally {
      setSyncing(false);
    }
  };
  return (
    <div className="account-actions">
      {discord && (
        <Button variant="secondary" size="sm" disabled={busy} loading={syncing} onClick={() => requestNavigation(() => void sync())}>{translate("settings.70aae5a6660f")}</Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() =>
          requestNavigation(async () => {
            if (await confirmAction(translate("common.4acd3c09c649",{p0:(account?.instanceName)}))) removeAccount(accountId, "signOut");
          })
        }
      >{translate("settings.b73f3ff34b4b")}</Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => openModal({ kind: "deleteAccount", accountId })}>{rich("common.87f77d3d21b7",{p0:(<Icon name="trash" size={14} />)})}</Button>
    </div>
  );
}


export function UserSettingsModal() {
  const requests = useRequestOwner("user-settings");
  const [page, setPage] = useState(() => {
    const modal = getState().modal;
    return modal?.kind === "userSettings" ? modal.section ?? "profile" : "profile";
  });
  const [search, setSearch] = useState("");
  const accounts = useStore((s) => s.accounts);
  const instances = useStore((s) => s.instances);
  // "Editar perfil" opens on the account it was clicked from; the others follow.
  // Settings belong to the selected account only: never another account's profile.
  const [selected] = useState(() => {
    const state = getState(), modal = state.modal;
    const id = (modal?.kind === "userSettings" ? modal.accountId : undefined) ?? ("accountId" in state.view ? state.view.accountId : undefined);
    return id ?? (state.global ? null : state.accounts[0]?.id ?? null);
  });
  const annoy = useStore((s) => s.global);
  const annoyMode = selected === null && !!annoy;
  const shownAccounts = accounts.filter((account) => account.id === selected);
  const profileUser = annoyMode ? { id: annoy!.id, username: annoy!.name, displayName: annoy!.name, avatarUrl: null } : shownAccounts[0] ? instances[shownAccounts[0].id]?.user : undefined;
  const saved = useStore((s) => s.settings);
  const [desktopStatus,setDesktopStatus]=useState<DesktopSnapshot|null>(null);
  const [desktopDraft,setDesktopDraft]=useState<DesktopPreferences|null>(null);
  const [desktopLoadError,setDesktopLoadError]=useState(false);
  const desktopDirty=!!desktopDraft&&!!desktopStatus&&JSON.stringify(desktopDraft)!==JSON.stringify(desktopStatus.saved);
  const filteredPages = SETTINGS_PAGES.filter((item) => normalizeSearch(`${item.label} ${item.search}`).includes(normalizeSearch(search.trim())));
  const desktopActivity = useStore((s) => s.desktopActivity);
  const [draft, setDraft] = useState<Settings>(() => ({ ...getState().settings }));
  const [profiles, setProfiles] = useState<Record<string, ProfileDraft>>({});
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedShown, showSaved] = useSavedNotice();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const allowWindowClose = useRef(false);
  const dirtyProfiles = accounts.filter((account) => {
    const change = profiles[account.id],
      user = instances[account.id]?.user;
    return change && user && (change.displayName.trim() !== user.displayName || change.avatar !== undefined || (change.bio ?? user.bio ?? "") !== (user.bio ?? "") || change.details !== undefined);
  });
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved) || dirtyProfiles.length > 0 || desktopDirty;
  const update = (patch: Partial<Settings>) => setDraft((current) => ({ ...current, ...patch }));
  const reset = () => {
    setDesktopDraft(desktopStatus?.saved??null);
    setDraft({ ...getState().settings });
    setProfiles({});
    setError(null);
  };
  const leave = (action: () => void) => {
    if (saving) return;
    if (dirty) setPending(() => action);
    else action();
  };
  useEffect(() => registerNavigationGuard(leave), [dirty, saving]);
  const refreshDesktop=()=>{void window.annoy?.desktop?.get().then(status=>{if(requests.signal.aborted)return;setDesktopStatus(status);setDesktopDraft(current=>current??status.saved);setDesktopLoadError(false);}).catch(()=>{if(!requests.signal.aborted)setDesktopLoadError(true);});};
  useEffect(()=>{refreshDesktop();},[]);
  useEffect(()=>{configureLocalization(draft);},[draft.language,draft.region,draft.hourCycle,draft.fontSize,draft.underlineLinks]);
  useEffect(()=>()=>configureLocalization(getState().settings),[]);
  useEffect(() => {
    applyTheme(draft.theme, draft);
    return () => {
      const current = getState().settings;
      applyTheme(current.theme, current);
    };
  }, [draft.theme, draft.accentColor, draft.surfaceColor]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const change = () => applyTheme(draft.theme, draft);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, [draft]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if ((!dirty && !saving) || allowWindowClose.current) return;
      event.preventDefault();
      event.returnValue = "";
      leave(() => {
        allowWindowClose.current = true;
        window.annoy?.window.close();
      });
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, saving]);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void navigator.mediaDevices.enumerateDevices().then(
        (list) => {
          if (active) setDevices(list);
        },
        () => undefined,
      );
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => {
      active = false;
      navigator.mediaDevices.removeEventListener("devicechange", refresh);
    };
  }, []);
  useEffect(() => {
    if (!capturing) return;
    const key = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code !== "Escape") update({ pttKey: event.code });
      setCapturing(false);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [capturing]);
  const save = async () => {
    if (saving) return false;
    setSaving(true);
    setError(null);
    const signal = requests.signal;
    try {
      for (const account of dirtyProfiles) {
        const change = profiles[account.id]!,
          user = getState().instances[account.id]?.user;
        if (!user) continue;
        const name = change.displayName.trim();
        if (!name) throw new Error(translate("settings.f4c6dcf48c78"));
        const api = apiFor(account.id);
        const profileDetails=change.details?{fields:change.details.fields.map(field=>({...field,value:normalizeProfileField(field.kind,field.value)})).filter(field=>field.value),historyEnabled:change.details.historyEnabled}:undefined;
        if(profileDetails&&!getState().instances[account.id]?.instance?.profileDetails)throw new Error(translate("settings.8b950195eb67"));
        const bioChanged = change.bio !== undefined && change.bio !== (user.bio ?? "");
        if (bioChanged && !getState().instances[account.id]?.instance?.socialProfiles) throw new Error(translate("settings.ffe91680efa4"));
        if (name !== user.displayName || bioChanged) {
          const updated = await api.patch<User>("/users/@me", { displayName: name, ...(bioChanged && { bio: change.bio }) }, signal);
          signal.throwIfAborted();
          applyUserUpdate(account.id, updated);
        }
        if(profileDetails){await api.patch("/users/@me/profile",profileDetails,signal);signal.throwIfAborted();setState(s=>{const inst=s.instances[account.id];if(inst)inst.profileRevision=(inst.profileRevision??0)+1;});}
        if (change.avatar !== undefined) {
          const updated =
            change.avatar === null ? await api.patch<User>("/users/@me", { avatarUrl: null }, signal) : await api.uploadAvatar<User>(change.avatar, signal);
          signal.throwIfAborted();
          // Old servers may ignore an unknown avatar field. Never claim success.
          if (change.avatar === null && updated.avatarUrl !== null)
            throw new Error(translate("settings.19472d8ef3c7"));
          applyUserUpdate(account.id, updated);
        }
      }
      const next={...draft,previousLanguage:draft.language!==saved.language?saved.language:draft.previousLanguage};
      if(desktopDirty&&desktopDraft){try{const status=await window.annoy!.desktop.set(desktopDraft);signal.throwIfAborted();setDesktopStatus(status);setDesktopDraft(status.saved);}catch{refreshDesktop();throw new Error(translate("desktop.saveError"));}}
      await window.annoy?.localization?.set(normalizeLocalization(next));signal.throwIfAborted();
      setState((s)=>{Object.assign(s.settings,next);});setDraft(next);
      updateVoiceSettings();
      setProfiles({});
      showSaved();
      return true;
    } catch (error) {
      if (!isCancellation(error)) setError(textForError(error) || translate("settings.fcd0784e9779"));
      return false;
    } finally {
      setSaving(false);
    }
  };
  const finish = (action: () => void) => {
    setPending(null);
    queueMicrotask(action);
  };
  const close = () =>
    setState((s) => {
      s.modal = null;
    });
  const deviceSelect = (
    label: string,
    kind: MediaDeviceKind,
    value: string,
    key: "inputDeviceId" | "outputDeviceId" | "cameraDeviceId",
  ) => (
    <Field label={label}>
      <Select aria-label={label} value={shownDevice(value, draft[LABEL[key]], devices.filter((d) => d.kind === kind))} onChange={(event) => update(deviceChoice(SLOT[key], event.target.value, devices))} disabled={saving}>
        <option value="default">{translate("common.f48584be4417")}</option>
        {devices
          .filter((d) => d.kind === kind && d.deviceId !== "default")
          .map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || label}
            </option>
          ))}
      </Select>
    </Field>
  );
  return (
    <>
      <Modal
        title={translate("common.76b0fb6ad189")}
        wide
        onClose={() => leave(close)}
        className="user-settings-modal"
        busy={saving}
        footer={
          dirty ? (
            <div className="settings-savebar" role="status">
              <span role={error ? "alert" : undefined} className={error ? "save-error" : undefined}>
                {error ?? translate("settings.32789d800cdf")}
              </span>
              <Button variant="ghost" disabled={saving} onClick={reset}>{translate("settings.c54fabd99e62")}</Button>
              <Button loading={saving} onClick={() => void save()}>{translate("settings.7368658c96c4")}</Button>
            </div>
          ) : savedShown ? <SavedNotice /> : null
        }
      >
        <div className="settings-layout">
          <aside className="settings-sidebar">
            {profileUser && (
              <div className="settings-identity">
                <Avatar user={profileUser} size={36} />
                <span><strong className="truncate">{profileUser.displayName}</strong><small>{translate("settings.b69f4632a0fd")}</small></span>
              </div>
            )}
            <Input type="search" placeholder={translate("settings.4d0da88ae785")} aria-label={translate("settings.4d0da88ae785")} value={search} onChange={(event) => setSearch(event.target.value)} />
            <nav aria-label={translate("settings.6910d40ca6b1")}>
              {filteredPages.map((item) => (
                <button key={item.id} aria-current={page === item.id ? "page" : undefined} onClick={() => setPage(item.id)}>
                  <Icon name={item.icon} size={18} />{item.label}
                </button>
              ))}
              {!filteredPages.length && <p className="muted small" role="status">{translate("settings.c58db263b297")}</p>}
            </nav>
          </aside>
          <div className="settings-content" key={page}>
            {page === "appearance" && (
              <section className="settings-section appearance-section">
                <h3>{rich("common.bfc59a5015a7",{p0:(<Icon name="palette" size={24} />)})}</h3>
                <p className="muted">{translate("settings.1126123c9926")}</p>
                <div className="theme-options" role="group" aria-label={translate("settings.eb88b483ea19")}>
                  {(["dark", "light", "system"] as const).map((theme) => (
                    <button
                      key={theme}
                      className={`theme-option${draft.theme === theme ? " selected" : ""}`}
                      aria-pressed={draft.theme === theme}
                      onClick={() => update({ theme })}
                      disabled={saving}
                      aria-label={theme === "dark" ? translate("settings.fde8bb83362a") : theme === "light" ? translate("settings.2f3e8dcc2464") : translate("settings.f150afd3c599")}
                    >
                      <Icon name={theme === "dark" ? "moon" : theme === "light" ? "sun" : "monitor"} size={20} />
                      <span><strong>{theme === "dark" ? translate("settings.fde8bb83362a") : theme === "light" ? translate("settings.2f3e8dcc2464") : translate("settings.f150afd3c599")}</strong><small>{theme === "dark" ? translate("settings.c4cfc071d34a") : theme === "light" ? translate("settings.d67b88b35930") : translate("settings.7a74e2ab7eb5")}</small></span>
                      {draft.theme === theme && <Icon name="check" size={16} />}
                    </button>
                  ))}
                </div>
                <AppearanceSettings settings={draft} update={update} />
              </section>
            )}
            {page === "localization"&&<LocalizationSettings draft={draft} onChange={update} disabled={saving}/>}
            {page === "desktop"&&<DesktopSettings status={desktopStatus} draft={desktopDraft} onChange={patch=>setDesktopDraft(current=>current?{...current,...patch}:current)} disabled={saving} loadError={desktopLoadError} refresh={refreshDesktop}/>}
            {page === "expressions" && <MediaLibrarySettings />}
            {page === "profile" && (
              <section className="settings-section">
                <h3>{rich("common.ce989b279c2d",{p0:(<Icon name="users" size={24} />)})}</h3>
                <p className="muted">{translate("settings.10bdfb7e1dd7")}</p>
                <Button variant="secondary" onClick={() => openModal({ kind: "switchAccount" })}>{rich("common.facf0ad3761a",{p0:(<Icon name="users" />)})}</Button>
                {annoyMode && (
                  <div className="settings-account annoy-profile global-account-panel">
                    <span className="account-badge">{rich("common.841a23466805",{p0:(<Icon name="check" size={12} />)})}</span>
                    <p><strong>{annoy!.name}</strong> <span className="muted">({annoy!.email})</span></p>
                    <div className="account-actions global-account-actions">
                      <a className="ui-button ui-button-secondary ui-button-sm" href={`${accountWebsite()}/conta`} target="_blank" rel="noreferrer">{translate("settings.1ea5d01cdfe6")}</a>
                      <Button variant="ghost" size="sm" onClick={() => void signOutGlobal()}>{translate("common.63783041b62a")}</Button>
                    </div>
                    <CloudProfileEditor />
                  </div>
                )}
                {shownAccounts.map((account) => {
                  const user = instances[account.id]?.user;
                  return (
                    user && (
                      <div className="settings-account" key={account.id}>
                        {account.annoy && annoy && <p className="annoy-account-row"><span className="account-badge" title={translate("common.cb4b27522bb8")}>{rich("common.841a23466805",{p0:(<Icon name="check" size={12} />)})}</span><span className="muted">{annoy.email}</span><button type="button" className="link-button" onClick={() => void signOutGlobal()}>{translate("common.63783041b62a")}</button></p>}
                        <ProfileEditor
                          account={account}
                          user={user}
                          draft={profiles[account.id] ?? { displayName: user.displayName }}
                          onChange={(value) => setProfiles((current) => ({ ...current, [account.id]: value }))}
                          disabled={saving}
                        />
                        <AccountActions accountId={account.id} busy={saving} />
                      </div>
                    )
                  );
                })}
                <Button variant="secondary" disabled={saving} onClick={() => openModal({ kind: "addAccount" })}>{rich("common.fb3340294ec1",{p0:(<Icon name="plus" size={16} />)})}</Button>
              </section>
            )}
            {page === "voice" && (
              <section className="settings-section">
                <h3>{rich("common.c1bea92367ca",{p0:(<Icon name="mic" size={24} />)})}</h3>
                <p className="muted">{translate("settings.96d137a3a28e")}</p>
                <PreferenceCard icon="headphones" title={translate("settings.a70a1e628334")} description={translate("settings.d0ae58087657")}>
                <div className="grid-2">
                  {deviceSelect(translate("common.39aa7e5f1a46"), "audioinput", draft.inputDeviceId, "inputDeviceId")}
                  {deviceSelect(translate("settings.62bebedcf69e"), "audiooutput", draft.outputDeviceId, "outputDeviceId")}
                </div>
                {deviceSelect(translate("common.dafb61aca12d"), "videoinput", draft.cameraDeviceId, "cameraDeviceId")}
                </PreferenceCard>
                <PreferenceCard icon="monitor" title={translate("settings.e2cff36ee101")} description={translate("settings.c90117711485")}>
                  <label className="check">
                    <Switch checked={draft.screenAudio} disabled={saving || !screenAudioSupported()} onCheckedChange={(checked) => update({ screenAudio: checked })} />{translate("settings.3b2aa8d81025")}</label>
                  {!screenAudioSupported() && <p className="muted small">{translate("settings.6ba226fe21b7")}</p>}
                </PreferenceCard>
                <PreferenceCard icon="sliders" title={translate("settings.bf63e677e2c3")} description={translate("settings.b57be3f5a0fe")}>
                <Field
                  label={translate("settings.807e3be2127c")}
                  hint={translate("settings.9702c7e30fb9",{p0:(NOISE_FILTERS.find((f) => f.value === draft.noiseFilter)?.hint ?? "")})}
                >
                  <Select
                    aria-label={translate("settings.807e3be2127c")}
                    value={draft.noiseFilter}
                    onChange={(event) => update({ noiseFilter: event.target.value as NoiseFilter })}
                    disabled={saving}
                  >
                    {NOISE_FILTERS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={translate("settings.42c4a1e18da5")} hint={translate("settings.062bf8bc2141")}>
                  <RadioGroup
                    label={translate("settings.42c4a1e18da5")}
                    value={draft.inputMode}
                    onValueChange={(value) => update({ inputMode: value as "vad" | "ptt" })}
                    options={[
                      { value: "vad", label: translate("settings.1e944f2cac8d") },
                      { value: "ptt", label: translate("settings.49788d960ad2") },
                    ]}
                  />
                </Field>
                </PreferenceCard>
                {draft.inputMode === "ptt" ? (
                  <Field label={translate("settings.2150611eb025")} hint={translate("settings.49ed8a146867")}>
                    <Button variant="secondary" onClick={() => setCapturing(true)}>
                      {capturing
                        ? translate("settings.72309e21e517")
                        : draft.pttKey
                            .replace(/^Key/, "")
                            .replace(/^Digit/, "")
                            .replace("Backquote", "` (crase)")}
                    </Button>
                  </Field>
                ) : (
                  <Field label={translate("settings.5a7209f54442",{p0:(draft.vadThreshold)})} hint={translate("settings.4e83db8dad07")}>
                    <Slider
                      aria-label={translate("settings.134cdd960f19")}

                      min={1}
                      max={60}
                      value={draft.vadThreshold}
                      onChange={(event) => update({ vadThreshold: Number(event.target.value) })}
                    />
                  </Field>
                )}
                <PreferenceCard icon="sliders" title={translate("voice.filters.title")} description={translate("voice.filters.description")}>
                  <MicFiltersEditor value={draft.micFilters} disabled={saving} onChange={(micFilters) => update({ micFilters })} />
                </PreferenceCard>
                <PreferenceCard icon="mic" title={translate("settings.1633f9ec8fb3")} description={translate("settings.c86b8e23e03c")}>
                <MicMeter deviceId={draft.inputDeviceId} deviceLabel={draft.inputDeviceLabel} threshold={draft.inputMode === "vad" ? draft.vadThreshold : 0} filter={draft.noiseFilter} filters={draft.micFilters} />
                </PreferenceCard>
              </section>
            )}
            {page === "security" && (
              <section className="settings-section">
                <h3>{rich("common.fcad23d8694d",{p0:(<Icon name="lock" size={24} />)})}</h3>
                <DevicesList />
              </section>
            )}
            {page === "updates" && (
              <section className="settings-section">
                <h3>{translate("common.a1f09a31ad36")}</h3>
                <UpdateSettings />
              </section>
            )}
            {page === "tabs" && (
              <section className="settings-section">
                <h3>{rich("common.03789960fb4a",{p0:(<Icon name="sliders" size={24} />)})}</h3>
                <p className="muted">{translate("settings.1b4b4fb880f0")}</p>
                <label className="switch-setting">
                  <span><strong>{rich("common.1d8a0d5f58f8",{p0:(<Icon name="radio" />)})}</strong><small>{translate("settings.59d7fb0b1556")}</small></span>
                  <Switch aria-label={translate("settings.c6f9a3603fdf")} checked={draft.showVoiceBar} onCheckedChange={(checked) => update({ showVoiceBar: checked })} />
                </label>
                {draft.showVoiceBar && <Field label={translate("settings.fd31f56b4f4e")}><RadioGroup label={translate("settings.fd31f56b4f4e")} cards value={draft.voiceBarMode} onValueChange={(value) => update({ voiceBarMode: value as Settings["voiceBarMode"] })} options={[{ value: "external", label: translate("settings.d66988647bf3"), hint: translate("settings.1b145e07da21") }, { value: "always", label: translate("settings.dd0ab3e4c0ec"), hint: translate("settings.b3b6b99a5856") }]} /></Field>}
                <Field label={translate("settings.cff92846f15c")}>
                  <RadioGroup
                    label={translate("settings.cff92846f15c")}
                    cards
                    value={draft.barPosition}
                    onValueChange={(value) => update({ barPosition: value as Settings["barPosition"] })}
                    options={[
                      { value: "side", label: <><Icon name="panelLeft" />{translate("settings.60f890179ecf")}</>, hint: translate("settings.7aad80853e0b") },
                      { value: "top", label: <><Icon name="monitor" />{translate("settings.a8621da1e2dc")}</>, hint: translate("settings.0709ccd360cd") },
                    ]}
                  />
                </Field>
                <div className="grid-2">
                  <Field label={translate("settings.5c2c0506ebfb")}>
                    <Select
                      aria-label={translate("settings.f819f179a900")}
                      value={draft.servicePlacement}
                      onChange={(event) => update({ servicePlacement: event.target.value as Settings["servicePlacement"] })}
                    >
                      <option value="before">{translate("common.3b856d7cd0b4")}</option>
                      <option value="after">{translate("common.d0e145bc660d")}</option>
                    </Select>
                  </Field>
                  <Field label={translate("common.0b4cf0d2ea73")}>
                    <Select
                      aria-label={translate("settings.d1c2644f2440")}
                      value={draft.serviceDisplay}
                      onChange={(event) => update({ serviceDisplay: event.target.value as Settings["serviceDisplay"] })}
                    >
                      <option value="full">{translate("common.593c128aa54e")}</option>
                      <option value="icon">{translate("common.e0520b5efa74")}</option>
                    </Select>
                  </Field>
                </div>
                <p className="muted small">{translate("settings.696fee52e9fb")}</p>
                <HiddenServices />
              </section>
            )}
            {page === "activity" && (
              <section className="settings-section">
                <h3>{rich("common.5b986d904c4a",{p0:(<Icon name="radio" size={24} />)})}</h3>
                <p className="muted">{translate("settings.ef3f1976270b")}</p>
                {window.annoy?.platform === "win32" || window.annoy?.platform === "linux" ? (
                  <>
                    <label className="switch-setting">
                      <span><strong>{rich("common.7d846bb586da",{p0:(<Icon name="radio" />)})}</strong><small>{translate("settings.90aac47f7432")}</small></span>
                      <Switch aria-label={translate("settings.08b8c2ca2393")} checked={draft.shareActivity} onCheckedChange={(checked) => update({ shareActivity: checked })} />
                    </label>
                    <p className="muted small">{translate("settings.6f93545e241c")}</p>
                    <h4>{translate("settings.8b563d2943c9")}</h4>
                    {(desktopActivity?.activities ?? []).map((activity) => <ActivityCard key={activity.kind} activity={activity} />)}
                    {!desktopActivity?.activities.length && <p className="muted small">{saved.shareActivity ? translate("common.f557b5cdcc29") : translate("settings.81e785d7823f")}</p>}
                    {desktopActivity?.error && (
                      <p className="error" role="status">
                        {desktopActivity.error}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="muted">{translate("settings.c7a6df285e2a")}</p>
                )}
                {accounts.some((account) => instances[account.id]?.instance?.steamConnection) && <h4>{translate("settings.3985bcd7ade0")}</h4>}
                {shownAccounts.map((account) => <SteamConnection key={account.id} accountId={account.id} />)}
              </section>
            )}
            {page === "notifications" && (
              <section className="settings-section">
                <h3>{rich("common.2ae3a369075f",{p0:(<Icon name="bell" size={24} />)})}</h3>
                <p className="muted">{translate("settings.c05f1116c786")}</p>
                <label className="switch-setting preference-toggle"><span><strong>{rich("common.613407297568",{p0:(<Icon name="bell" />)})}</strong><small>{translate("settings.20cd2a81ec1f")}</small></span><Switch aria-label={translate("settings.3ac6c1438f09")} checked={draft.notifications} onCheckedChange={(value) => update({ notifications: value })} /></label>
                <label className="switch-setting preference-toggle"><span><strong>{rich("common.6f89516786d0",{p0:(<Icon name="speaker" />)})}</strong><small>{translate("settings.cd4d42344247")}</small></span><Switch aria-label={translate("settings.0595fc0bec52")} checked={draft.messageSounds} onCheckedChange={(value) => update({ messageSounds: value })} /></label>
                <PreferenceCard icon="clock" title={translate("settings.e2fe024908b1")} description={translate("settings.c1a3106d619e")}><Field label={translate("settings.abe1619e9eba")}><Select aria-label={translate("settings.dedad3948705")} value={String(draft.awayMinutes)} onChange={(event) => update({ awayMinutes: Number(event.target.value) })}>{[1, 5, 10, 15, 30, 60].map((minutes) => <option key={minutes} value={minutes}>{rich("common.565c188e5706",{p0:(minutes)})}</option>)}<option value="0">{translate("settings.44c195bf1e9c")}</option></Select></Field></PreferenceCard>
                <p className="muted small">{translate("settings.30b14b976fdc")}</p>
              </section>
            )}
          </div>
        </div>
      </Modal>
      {pending && (
        <Dialog open onOpenChange={(open) => !open && !saving && setPending(null)}>
          <DialogContent className="modal unsaved-dialog" showClose={false} aria-describedby="unsaved-description">
            <div className="modal-body">
              <DialogTitle>{translate("settings.e0cf65f22d9a")}</DialogTitle>
              <p id="unsaved-description" className="muted">{translate("settings.024a8f70de17")}</p>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className="form-actions">
                <Button variant="ghost" disabled={saving} onClick={() => setPending(null)}>{translate("settings.a226aabb5545")}</Button>
                <Button
                  variant="secondary"
                  disabled={saving}
                  onClick={() => {
                    reset();
                    finish(pending);
                  }}
                >{translate("settings.534c4da81431")}</Button>
                <Button loading={saving} onClick={() => void save().then((ok) => ok && finish(pending))}>{translate("settings.af2b1a24f03c")}</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

onLocalizationChange(()=>{SETTINGS_PAGES=[
  {id:"desktop",label:translate("desktop.title"),icon:"monitor",search:translate("desktop.title")},
  {id:"localization",label:translate("settings.b7b7db231778"),icon:"globe",search:translate("settings.97bbf9167943")},
  { id: "profile", label: translate("settings.b9e5ce2ce127"), icon: "users", search: translate("common.f1097b1bdaf9") },
  { id: "expressions", label: translate("expression.728001e6a865"), icon: "smile", search: translate("settings.8531d86304ac") },
  { id: "voice", label: translate("settings.7bb3eccdf5f8"), icon: "mic", search: translate("settings.7e1b71648e19") },
  { id: "appearance", label: translate("settings.04f9f0a78dbe"), icon: "palette", search: translate("settings.ae256cfcdedc") },
  { id: "tabs", label: translate("settings.0ac1d8649dc7"), icon: "sliders", search: translate("settings.1ae5d2bcf2c5") },
  { id: "activity", label: translate("common.a5121730503f"), icon: "radio", search: translate("settings.a19ddf531397") },
  { id: "notifications", label: translate("settings.6b8e9ecbc2ba"), icon: "message", search: translate("settings.95f1668c7abc") },
  { id: "security", label: translate("common.797c0d01ff48"), icon: "lock", search: translate("common.fd32174ee399") },
  { id: "updates", label: translate("common.a1f09a31ad36"), icon: "download", search: translate("settings.89883f1fa251") },
];});
