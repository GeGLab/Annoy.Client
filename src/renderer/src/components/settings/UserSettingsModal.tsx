import {normalizeProfileField} from "@distopic/protocol";
import { Checkbox } from "../ui/checkbox.tsx";
import { Slider } from "../ui/slider.tsx";
import { confirmAction, promptText } from "../ui/action-dialog.tsx";
import type { DiscordLoginBegin, User } from "@distopic/protocol";
import { useEffect, useRef, useState } from "react";
import { discordLogin, fetchInfo } from "../../api.ts";
import { apiFor, applyUserUpdate, removeAccount, updateVoiceSettings } from "../../client.ts";
import { getState, setState, toast, useStore, type Settings } from "../../store.ts";
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
import { GLOBAL_URL, GlobalError, linkAccount, mergeAccount, signInGlobal, signOutGlobal } from "../../global.ts";
import { useRequestOwner } from "../../lib/use-request-owner.ts";
import { isCancellation } from "../../../../shared/requests.ts";

const SETTINGS_PAGES: { id: string; label: string; icon: IconName; search: string }[] = [
  { id: "profile", label: "Meu perfil e contas", icon: "users", search: "nome foto avatar instância conta global login unificar" },
  { id: "global", label: "Conta global", icon: "shield", search: "conta global login email senha criar cadastro unificar" },
  { id: "expressions", label: "Emojis e mídia", icon: "smile", search: "reações GIFs figurinhas emojis pacotes biblioteca loja GIPHY importar exportar" },
  { id: "voice", label: "Voz e vídeo", icon: "mic", search: "microfone áudio câmera ruído sensibilidade teste som" },
  { id: "appearance", label: "Aparência", icon: "palette", search: "tema cores escuro claro" },
  { id: "tabs", label: "Barra e abas", icon: "sliders", search: "chamada serviços posição" },
  { id: "activity", label: "Atividade", icon: "radio", search: "compartilhar jogos Steam Spotify música Apple amigos" },
  { id: "notifications", label: "Notificações", icon: "message", search: "menções mensagens" },
  { id: "updates", label: "Atualizações", icon: "download", search: "versão atualizar" },
];
const normalizeSearch = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");

/** Live level of the filtered microphone, optionally played back so you can hear the filter. */
function MicMeter({ deviceId, threshold, filter }: { deviceId: string; threshold: number; filter: NoiseFilter }) {
  const [enabled, setEnabled] = useState(false);
  const [monitor, setMonitor] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false,
      frame = 0;
    let mic: Mic | null = null;
    void openMic(deviceId, filter)
      .then((value) => {
        if (stopped) return value.stop();
        mic = value;
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
        setError("Não foi possível acessar o microfone.");
        setEnabled(false);
      });
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      mic?.stop();
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
        {enabled ? "Parar teste" : "Testar microfone"}
      </Button>
      <label className="check">
        <Checkbox checked={monitor} onChange={(event) => setMonitor(event.target.checked)} />
        Ouvir meu microfone com o filtro durante o teste (use fone de ouvido)
      </label>
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
  const admin = useStore((s) => s.instances[accountId]?.instance?.isAdmin);
  const [discord, setDiscord] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const signedInGlobal = useStore((s) => s.global !== null);
  const self = useStore((s) => s.instances[accountId]?.user);
  /** This server's Global ID when it takes global accounts and this one doesn't use it yet. */
  const [linkable, setLinkable] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  useEffect(() => {
    if (!account) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, requests.signal]);
    void fetchInfo(account.url, signal).then(
      async (info) => {
        signal.throwIfAborted();
        setDiscord(info.discordLogin);
        if (!info.globalServerId) return setLinkable(null);
        const me = await apiFor(accountId).get<{ global?: boolean }>("/users/@me", signal);
        signal.throwIfAborted();
        setLinkable(me.global ? null : info.globalServerId);
      },
    ).catch((error) => { if (!isCancellation(error)) { setDiscord(false); setLinkable(null); } });
    return () => controller.abort();
  }, [account?.url, signedInGlobal]);
  const link = async () => {
    if (!account || !linkable) return;
    const signal = requests.signal;
    setLinking(true);
    try {
      await linkAccount(account, linkable, signal);
      signal.throwIfAborted();
      setLinkable(null);
      toast(`Agora você também entra em ${account.instanceName} com a conta global`);
    } catch (error) {
      if (isCancellation(error)) return;
      if (error instanceof GlobalError && error.code === "global_in_use") await offerMerge(error.message);
      else toast((error as Error).message);
    } finally {
      setLinking(false);
    }
  };
  /** Item 1.9: two users of the same person on this server become this one. */
  const offerMerge = async (reason: string) => {
    if (!account || !linkable) return;
    const signal = requests.signal;
    const ok = await confirmAction(
      `${reason}. Unificar com @${self?.username ?? "esta conta"}? Servidores, mensagens, cargos e amigos do outro usuário passam para esta conta, e você entra nela com a conta global ou com a senha. O outro usuário deixa de existir.`,
      { confirmLabel: "Unificar" },
    );
    if (!ok || signal.aborted) return;
    const password = await promptText(`Para confirmar, digite a senha de @${self?.username ?? "esta conta"} em ${account.instanceName}.`, "", { confirmLabel: "Unificar", secret: true });
    if (password === null || signal.aborted) return;
    try {
      const removed = await mergeAccount(account, linkable, password, signal);
      signal.throwIfAborted();
      setLinkable(null);
      // The other user is gone: drop it if this app also had it signed in.
      const stale = getState().accounts.find((a) => a.url === account.url && a.userId === removed);
      if (stale) removeAccount(stale.id);
      toast(`Contas unificadas em ${account.instanceName}`);
    } catch (error) {
      if (!isCancellation(error)) toast((error as Error).message);
    }
  };
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
      toast("Perfil do Discord sincronizado");
    } catch (error) {
      if (!isCancellation(error)) toast((error as Error).message);
    } finally {
      setSyncing(false);
    }
  };
  return (
    <div className="account-actions">
      {discord && (
        <Button variant="secondary" size="sm" disabled={busy} loading={syncing} onClick={() => requestNavigation(() => void sync())}>
          Sincronizar Discord
        </Button>
      )}
      {linkable && signedInGlobal && (
        <Button variant="secondary" size="sm" disabled={busy} loading={linking} onClick={() => void link()}>
          Entrar também com a conta global
        </Button>
      )}
      {admin && (
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => openModal({ kind: "instanceAdmin", accountId })}>
          Administrar instância
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() =>
          requestNavigation(async () => {
            if (await confirmAction(`Desconectar ${account?.instanceName}?`)) removeAccount(accountId);
          })
        }
      >
        Sair da conta
      </Button>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => openModal({ kind: "deleteAccount", accountId })}>
        <Icon name="trash" size={14} />
        Excluir conta
      </Button>
    </div>
  );
}

/**
 * Annoy Global: one account for many servers. Signing in happens here, right
 * away (not on "save"), since it's a login rather than a preference.
 */
function GlobalAccountCard({ draft, update }: { draft: Settings; update: (patch: Partial<Settings>) => void }) {
  const requests = useRequestOwner();
  const account = useStore((s) => s.global);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const signal = requests.signal;
    setBusy(true);
    setError(null);
    try {
      await signInGlobal(email, password, signal);
      signal.throwIfAborted();
      setPassword("");
    } catch (err) {
      if (!isCancellation(err)) setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-section global-account-panel"><h3><Icon name="shield" size={24} />Conta global</h3><p className="muted">Um login para seus servidores Annoy. Entre com uma conta existente ou crie sua conta no portal.</p>
      {account ? (
        <>
          <p>
            Você entrou como <strong>{account.name}</strong> <span className="muted">({account.email})</span>.
          </p>
          <label className="check">
            <Checkbox checked={draft.globalDefault} onChange={(event) => update({ globalDefault: event.target.checked })} />
            Usar como conta padrão
          </label>
          <p className="muted small">Servidores novos começam pela conta global, e os servidores dela voltam sozinhos em outro computador.</p>
          <div className="global-account-actions">
            <a className="ui-button ui-button-secondary ui-button-sm" href={`${GLOBAL_URL}/conta`} target="_blank" rel="noreferrer">
              Gerenciar conta
            </a>
            <Button variant="ghost" size="sm" onClick={() => void signOutGlobal()}>
              Sair da conta global
            </Button>
          </div>
        </>
      ) : (
        <form className="global-signin-form" onSubmit={(event) => void submit(event)}>
          <div className="global-signin-fields">
            <Field label="E-mail">
              <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" disabled={busy} required />
            </Field>
            <Field label="Senha">
              <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" disabled={busy} required />
            </Field>
          </div>
          {error && <p className="error small" role="alert">{error}</p>}
          <div className="global-account-actions">
            <Button type="submit" size="sm" loading={busy}>
              {busy ? "Protegendo sua senha…" : "Entrar"}
            </Button>
            <a className="ui-button ui-button-outline ui-button-sm" href={`${GLOBAL_URL}/cadastro`} target="_blank" rel="noreferrer">
              Criar conta global<Icon name="external" size={14} />
            </a>
          </div>
          <p className="muted small">O cadastro abre no navegador. Depois de criar sua conta, volte aqui para entrar.</p>
        </form>
      )}
    </section>
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
  const profileUser = accounts[0] ? instances[accounts[0].id]?.user : undefined;
  const saved = useStore((s) => s.settings);
  const filteredPages = SETTINGS_PAGES.filter((item) => normalizeSearch(`${item.label} ${item.search}`).includes(normalizeSearch(search.trim())));
  const desktopActivity = useStore((s) => s.desktopActivity);
  const [draft, setDraft] = useState<Settings>(() => ({ ...getState().settings }));
  const [profiles, setProfiles] = useState<Record<string, ProfileDraft>>({});
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const allowWindowClose = useRef(false);
  const dirtyProfiles = accounts.filter((account) => {
    const change = profiles[account.id],
      user = instances[account.id]?.user;
    return change && user && (change.displayName.trim() !== user.displayName || change.avatar !== undefined || (change.bio ?? user.bio ?? "") !== (user.bio ?? "") || change.details !== undefined);
  });
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved) || dirtyProfiles.length > 0;
  const update = (patch: Partial<Settings>) => setDraft((current) => ({ ...current, ...patch }));
  const reset = () => {
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
        window.distopic?.window.close();
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
        if (!name) throw new Error("Informe um nome de exibição.");
        const api = apiFor(account.id);
        const profileDetails=change.details?{fields:change.details.fields.map(field=>({...field,value:normalizeProfileField(field.kind,field.value)})).filter(field=>field.value),historyEnabled:change.details.historyEnabled}:undefined;
        if(profileDetails&&!getState().instances[account.id]?.instance?.profileDetails)throw new Error("Atualize o Annoy.Server para editar contatos e privacidade.");
        const bioChanged = change.bio !== undefined && change.bio !== (user.bio ?? "");
        if (bioChanged && !getState().instances[account.id]?.instance?.socialProfiles) throw new Error("Atualize esta instância para salvar biografias.");
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
            throw new Error("Esta instância precisa ser atualizada para remover fotos.");
          applyUserUpdate(account.id, updated);
        }
      }
      setState((s) => {
        Object.assign(s.settings, draft);
      });
      updateVoiceSettings();
      setProfiles({});
      toast("Alterações salvas");
      return true;
    } catch (error) {
      if (!isCancellation(error)) setError((error as Error).message || "Não foi possível salvar. Suas alterações continuam aqui.");
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
      <Select aria-label={label} value={value} onChange={(event) => update({ [key]: event.target.value })} disabled={saving}>
        <option value="default">Padrão do sistema</option>
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
        title="Configurações"
        wide
        onClose={() => leave(close)}
        className="user-settings-modal"
        busy={saving}
        footer={
          dirty ? (
            <div className="settings-savebar" role="status">
              <span role={error ? "alert" : undefined} className={error ? "save-error" : undefined}>
                {error ?? "Você tem alterações não salvas."}
              </span>
              <Button variant="ghost" disabled={saving} onClick={reset}>
                Redefinir
              </Button>
              <Button loading={saving} onClick={() => void save()}>
                Salvar alterações
              </Button>
            </div>
          ) : null
        }
      >
        <div className="settings-layout">
          <aside className="settings-sidebar">
            {profileUser && (
              <div className="settings-identity">
                <Avatar user={profileUser} size={36} />
                <span><strong className="truncate">{profileUser.displayName}</strong><small>Suas configurações</small></span>
              </div>
            )}
            <Input type="search" placeholder="Buscar configurações" aria-label="Buscar configurações" value={search} onChange={(event) => setSearch(event.target.value)} />
            <nav aria-label="Categorias de configurações">
              {filteredPages.map((item) => (
                <button key={item.id} aria-current={page === item.id ? "page" : undefined} onClick={() => setPage(item.id)}>
                  <Icon name={item.icon} size={18} />{item.label}
                </button>
              ))}
              {!filteredPages.length && <p className="muted small" role="status">Nenhuma categoria encontrada.</p>}
            </nav>
          </aside>
          <div className="settings-content" key={page}>
            {page === "appearance" && (
              <section className="settings-section appearance-section">
                <h3><Icon name="palette" size={24} />Aparência</h3>
                <p className="muted">Escolha como o Annoy aparece para você.</p>
                <div className="theme-options" role="group" aria-label="Tema do aplicativo">
                  {(["dark", "light", "system"] as const).map((theme) => (
                    <button
                      key={theme}
                      className={`theme-option${draft.theme === theme ? " selected" : ""}`}
                      aria-pressed={draft.theme === theme}
                      onClick={() => update({ theme })}
                      disabled={saving}
                      aria-label={theme === "dark" ? "Escuro" : theme === "light" ? "Claro" : "Sistema"}
                    >
                      <Icon name={theme === "dark" ? "moon" : theme === "light" ? "sun" : "monitor"} size={20} />
                      <span><strong>{theme === "dark" ? "Escuro" : theme === "light" ? "Claro" : "Sistema"}</strong><small>{theme === "dark" ? "Menos brilho em ambientes escuros." : theme === "light" ? "Fundos claros para o dia a dia." : "Acompanha o tema do seu computador."}</small></span>
                      {draft.theme === theme && <Icon name="check" size={16} />}
                    </button>
                  ))}
                </div>
                <AppearanceSettings settings={draft} update={update} />
              </section>
            )}
            {page === "expressions" && <MediaLibrarySettings />}
            {page === "global" && <GlobalAccountCard draft={draft} update={update} />}
            {page === "profile" && (
              <section className="settings-section">
                <h3><Icon name="users" size={24} />Meu perfil e contas</h3>
                <p className="muted">Sua identidade em cada instância. As alterações de perfil só são enviadas ao salvar.</p>
                <Button variant="secondary" onClick={() => openModal({ kind: "switchAccount" })}><Icon name="users" />Trocar de conta</Button>

                {accounts.map((account) => {
                  const user = instances[account.id]?.user;
                  return (
                    user && (
                      <div className="settings-account" key={account.id}>
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
                <Button variant="secondary" disabled={saving} onClick={() => openModal({ kind: "addAccount" })}>
                  <Icon name="plus" size={16} />
                  Conectar a outra instância
                </Button>
              </section>
            )}
            {page === "voice" && (
              <section className="settings-section">
                <h3><Icon name="mic" size={24} />Voz e vídeo</h3>
                <p className="muted">Escolha seus dispositivos e ajuste como sua voz chega à chamada.</p>
                <PreferenceCard icon="headphones" title="Dispositivos" description="Escolha de onde sua voz entra, onde você ouve e qual câmera usar.">
                <div className="grid-2">
                  {deviceSelect("Microfone", "audioinput", draft.inputDeviceId, "inputDeviceId")}
                  {deviceSelect("Saída de áudio", "audiooutput", draft.outputDeviceId, "outputDeviceId")}
                </div>
                {deviceSelect("Câmera", "videoinput", draft.cameraDeviceId, "cameraDeviceId")}
                </PreferenceCard>
                <PreferenceCard icon="monitor" title="Transmissão de tela" description="Escolha resolução e FPS ao iniciar. O som do computador pode acompanhar a imagem no Windows.">
                  <label className="check">
                    <Switch checked={draft.screenAudio} disabled={saving || !screenAudioSupported()} onCheckedChange={(checked) => update({ screenAudio: checked })} />
                    Transmitir o som do computador junto com a tela
                  </label>
                  {!screenAudioSupported() && <p className="muted small">Captura de som do computador disponível no Windows.</p>}
                </PreferenceCard>
                <PreferenceCard icon="sliders" title="Entrada de voz" description="Reduza ruídos e controle quando o microfone transmite sua voz.">
                <Field
                  label="Filtro de ruído"
                  hint={`${NOISE_FILTERS.find((f) => f.value === draft.noiseFilter)?.hint ?? ""} Vale para a próxima conexão de voz.`}
                >
                  <Select
                    aria-label="Filtro de ruído"
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
                <Field label="Modo de entrada" hint="O modo de entrada vale para a próxima conexão de voz">
                  <RadioGroup
                    label="Modo de entrada"
                    value={draft.inputMode}
                    onValueChange={(value) => update({ inputMode: value as "vad" | "ptt" })}
                    options={[
                      { value: "vad", label: "Detecção de voz" },
                      { value: "ptt", label: "Apertar para falar" },
                    ]}
                  />
                </Field>
                </PreferenceCard>
                {draft.inputMode === "ptt" ? (
                  <Field label="Tecla de apertar para falar" hint="Funciona com a janela do Annoy em foco">
                    <Button variant="secondary" onClick={() => setCapturing(true)}>
                      {capturing
                        ? "Pressione uma tecla… (Esc cancela)"
                        : draft.pttKey
                            .replace(/^Key/, "")
                            .replace(/^Digit/, "")
                            .replace("Backquote", "` (crase)")}
                    </Button>
                  </Field>
                ) : (
                  <Field label={`Sensibilidade: ${draft.vadThreshold}`} hint="Teste e ajuste até a barra ficar verde só quando você falar">
                    <Slider
                      aria-label="Sensibilidade do microfone"

                      min={1}
                      max={60}
                      value={draft.vadThreshold}
                      onChange={(event) => update({ vadThreshold: Number(event.target.value) })}
                    />
                  </Field>
                )}
                <PreferenceCard icon="mic" title="Teste do microfone" description="Confira o nível da sua voz antes de entrar. A opção de retorno reproduz sua voz nos fones.">
                <MicMeter deviceId={draft.inputDeviceId} threshold={draft.inputMode === "vad" ? draft.vadThreshold : 0} filter={draft.noiseFilter} />
                </PreferenceCard>
              </section>
            )}
            {page === "updates" && (
              <section className="settings-section">
                <h3>Atualizações</h3>
                <UpdateSettings />
              </section>
            )}
            {page === "tabs" && (
              <section className="settings-section">
                <h3><Icon name="sliders" size={24} />Barra e abas</h3>
                <p className="muted">Organize a navegação e escolha quando acompanhar sua chamada no topo.</p>
                <label className="switch-setting">
                  <span><strong><Icon name="radio" />Mostrar barra da chamada</strong><small>Por padrão, aparece sobre WhatsApp, Discord e outros serviços, para lembrar que você está em uma sala.</small></span>
                  <Switch aria-label="Mostrar barra da chamada" checked={draft.showVoiceBar} onCheckedChange={(checked) => update({ showVoiceBar: checked })} />
                </label>
                {draft.showVoiceBar && <Field label="Quando mostrar a chamada"><RadioGroup label="Quando mostrar a chamada" cards value={draft.voiceBarMode} onValueChange={(value) => update({ voiceBarMode: value as Settings["voiceBarMode"] })} options={[{ value: "external", label: "Em outros serviços", hint: "Oculta durante a navegação no Annoy." }, { value: "always", label: "Sempre", hint: "Também aparece nos canais e nas conversas do Annoy." }]} /></Field>}
                <Field label="Posição da barra">
                  <RadioGroup
                    label="Posição da barra"
                    cards
                    value={draft.barPosition}
                    onValueChange={(value) => update({ barPosition: value as Settings["barPosition"] })}
                    options={[
                      { value: "side", label: <><Icon name="panelLeft" />Lateral</>, hint: "Comunidades e conversas à esquerda." },
                      { value: "top", label: <><Icon name="monitor" />Topo</>, hint: "Mais espaço horizontal para os canais." },
                    ]}
                  />
                </Field>
                <div className="grid-2">
                  <Field label="Abas de serviço">
                    <Select
                      aria-label="Posição padrão das abas de serviço"
                      value={draft.servicePlacement}
                      onChange={(event) => update({ servicePlacement: event.target.value as Settings["servicePlacement"] })}
                    >
                      <option value="before">Antes dos servidores Annoy</option>
                      <option value="after">Depois dos servidores Annoy</option>
                    </Select>
                  </Field>
                  <Field label="Na barra">
                    <Select
                      aria-label="Como as abas de serviço aparecem"
                      value={draft.serviceDisplay}
                      onChange={(event) => update({ serviceDisplay: event.target.value as Settings["serviceDisplay"] })}
                    >
                      <option value="full">Ícone e nome</option>
                      <option value="icon">Só ícone</option>
                    </Select>
                  </Field>
                </div>
                <p className="muted small">Cada aba de serviço pode ter a sua: clique com o botão direito nela.</p>
                <HiddenServices />
              </section>
            )}
            {page === "activity" && (
              <section className="settings-section">
                <h3><Icon name="radio" size={24} />Compartilhamento de atividade</h3>
                <p className="muted">
                  Amigos e pessoas nos mesmos servidores podem ver sua atividade. Conversas diretas sem amizade ou servidor em comum não dão acesso.
                </p>
                {window.distopic?.platform === "win32" || window.distopic?.platform === "linux" ? (
                  <>
                    <label className="switch-setting">
                      <span><strong><Icon name="radio" />Compartilhar minha atividade</strong><small>Compartilhe o que você está jogando, ouvindo ou programando, conforme as integrações disponíveis no seu sistema. Ao programar, podem aparecer arquivo, linguagem e projeto; caminhos completos e conteúdo dos arquivos não são enviados.</small></span>
                      <Switch aria-label="Compartilhar minha atividade" checked={draft.shareActivity} onCheckedChange={(checked) => update({ shareActivity: checked })} />
                    </label>
                    <p className="muted small">
                      A detecção começa após salvar e acompanha as atividades compatíveis em execução. Ao encerrar uma atividade, ela deixa de aparecer para seus amigos.
                    </p>
                    <h4>Detectado agora</h4>
                    {(desktopActivity?.activities ?? []).map((activity) => <ActivityCard key={activity.kind} activity={activity} />)}
                    {!desktopActivity?.activities.length && <p className="muted small">{saved.shareActivity ? "Nenhuma atividade detectada agora." : "Salve o compartilhamento ativado para iniciar a detecção."}</p>}
                    {desktopActivity?.error && (
                      <p className="error" role="status">
                        {desktopActivity.error}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="muted">A detecção local está disponível no Windows e Linux. As atividades compatíveis dependem das integrações disponíveis no sistema.</p>
                )}
                {accounts.some((account) => instances[account.id]?.instance?.steamConnection) && <h4>Plataformas conectadas</h4>}
                {accounts.map((account) => <SteamConnection key={account.id} accountId={account.id} />)}
              </section>
            )}
            {page === "notifications" && (
              <section className="settings-section">
                <h3><Icon name="bell" size={24} />Notificações e presença</h3>
                <p className="muted">Controle os avisos que chegam e quando seus amigos veem você como ausente.</p>
                <label className="switch-setting preference-toggle"><span><strong><Icon name="bell" />Alertas na área de trabalho</strong><small>Notifica menções e mensagens privadas quando o Annoy está em segundo plano.</small></span><Switch aria-label="Alertas na área de trabalho" checked={draft.notifications} onCheckedChange={(value) => update({ notifications: value })} /></label>
                <label className="switch-setting preference-toggle"><span><strong><Icon name="speaker" />Sons de mensagens</strong><small>Toca um aviso ao receber uma mensagem nova, inclusive na conversa aberta. Servidores e canais silenciados não tocam.</small></span><Switch aria-label="Sons de mensagens" checked={draft.messageSounds} onCheckedChange={(value) => update({ messageSounds: value })} /></label>
                <PreferenceCard icon="clock" title="Ausente automaticamente" description="O mouse e o teclado do computador mantêm você online. Ao voltar a usar o computador, o status volta a online."><Field label="Tempo sem atividade"><Select aria-label="Tempo para ficar ausente" value={String(draft.awayMinutes)} onChange={(event) => update({ awayMinutes: Number(event.target.value) })}>{[1, 5, 10, 15, 30, 60].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutos</option>)}<option value="0">Nunca ficar ausente automaticamente</option></Select></Field></PreferenceCard>
                <p className="muted small">Para silenciar uma comunidade inteira, abra o menu do servidor. Para um canal, use o menu ao lado do nome. Mensagens e contadores continuam disponíveis.</p>
              </section>
            )}
          </div>
        </div>
      </Modal>
      {pending && (
        <Dialog open onOpenChange={(open) => !open && !saving && setPending(null)}>
          <DialogContent className="modal unsaved-dialog" showClose={false} aria-describedby="unsaved-description">
            <div className="modal-body">
              <DialogTitle>Salvar suas alterações?</DialogTitle>
              <p id="unsaved-description" className="muted">
                Você alterou suas configurações. Salve antes de continuar ou descarte as mudanças.
              </p>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className="form-actions">
                <Button variant="ghost" disabled={saving} onClick={() => setPending(null)}>
                  Continuar editando
                </Button>
                <Button
                  variant="secondary"
                  disabled={saving}
                  onClick={() => {
                    reset();
                    finish(pending);
                  }}
                >
                  Descartar alterações
                </Button>
                <Button loading={saving} onClick={() => void save().then((ok) => ok && finish(pending))}>
                  Salvar e continuar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
