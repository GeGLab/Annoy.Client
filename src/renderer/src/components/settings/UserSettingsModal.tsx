import { Checkbox } from "../ui/checkbox.tsx";
import { Slider } from "../ui/slider.tsx";
import { confirmAction } from "../ui/action-dialog.tsx";
import type { DiscordLoginBegin, User } from "@distopic/protocol";
import { useEffect, useRef, useState } from "react";
import { discordLogin, fetchInfo } from "../../api.ts";
import { apiFor, applyUserUpdate, removeAccount, updateVoiceSettings } from "../../client.ts";
import { getState, setState, toast, useStore, type Settings } from "../../store.ts";
import { applyTheme } from "../../lib/theme.ts";
import { registerNavigationGuard, requestNavigation } from "../../lib/navigation-guard.ts";
import { AppearanceSettings } from "../AppearanceSettings.tsx";
import { Brand } from "../Brand.tsx";
import { Field, Icon, Modal, openModal } from "../ui.tsx";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Select } from "../ui/select.tsx";
import { RadioGroup } from "../ui/radio-group.tsx";
import { Switch } from "../ui/switch.tsx";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog.tsx";
import { UpdateSettings } from "../Updates.tsx";
import { ProfileEditor, type ProfileDraft } from "./ProfileEditor.tsx";
import { NOISE_FILTERS, openMic, type Mic, type NoiseFilter } from "../../noise.ts";
import { HiddenServices } from "../Services.tsx";
import { GLOBAL_URL, GlobalError, linkAccount, mergeAccount, signInGlobal, signOutGlobal } from "../../global.ts";
import { promptText } from "../ui/action-dialog.tsx";
import { SCREEN_QUALITIES, screenAudioSupported, type ScreenQuality } from "../../media-profiles.ts";

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
    void fetchInfo(account.url).then(
      async (info) => {
        setDiscord(info.discordLogin);
        if (!info.globalServerId) return setLinkable(null);
        const me = await apiFor(accountId).get<{ global?: boolean }>("/users/@me");
        setLinkable(me.global ? null : info.globalServerId);
      },
      () => undefined,
    );
  }, [account?.url, signedInGlobal]);
  const link = async () => {
    if (!account || !linkable) return;
    setLinking(true);
    try {
      await linkAccount(account, linkable);
      setLinkable(null);
      toast(`Agora você também entra em ${account.instanceName} com a conta global`);
    } catch (error) {
      if (error instanceof GlobalError && error.code === "global_in_use") await offerMerge(error.message);
      else toast((error as Error).message);
    } finally {
      setLinking(false);
    }
  };
  const sync = async () => {
    if (!account) return;
    setSyncing(true);
    try {
      await discordLogin(
        account.url,
        () => apiFor(accountId).post<DiscordLoginBegin>("/auth/discord/begin", { link: true }),
        new AbortController().signal,
      );
      toast("Perfil do Discord sincronizado");
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setSyncing(false);
    }
  };
  /** Item 1.9: two users of the same person on this server become this one. */
  const offerMerge = async (reason: string) => {
    if (!account || !linkable) return;
    const ok = await confirmAction(
      `${reason}. Unificar com @${self?.username ?? "esta conta"}? Servidores, mensagens, cargos e amigos do outro usuário passam para esta conta, e você entra nela com a conta global ou com a senha. O outro usuário deixa de existir.`,
      { confirmLabel: "Unificar" },
    );
    if (!ok) return;
    const password = await promptText(`Para confirmar, digite a senha de @${self?.username ?? "esta conta"} em ${account.instanceName}.`, "", { confirmLabel: "Unificar", secret: true });
    if (password === null) return;
    try {
      const removed = await mergeAccount(account, linkable, password);
      setLinkable(null);
      // The other user is gone: drop it if this app also had it signed in.
      const stale = getState().accounts.find((a) => a.url === account.url && a.userId === removed);
      if (stale) removeAccount(stale.id);
      toast(`Contas unificadas em ${account.instanceName}`);
    } catch (error) {
      toast((error as Error).message);
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
function GlobalAccountSection({ draft, update }: { draft: Settings; update: (patch: Partial<Settings>) => void }) {
  const account = useStore((s) => s.global);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInGlobal(email, password);
      setPassword("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-section">
      <h3>Conta global</h3>
      {account ? (
        <>
          <p>
            Você entrou como <strong>{account.name}</strong> <span className="muted">({account.email})</span>.
          </p>
          <label className="check">
            <Checkbox checked={draft.globalDefault} onChange={(event) => update({ globalDefault: event.target.checked })} />
            Usar como conta padrão
          </label>
          <p className="muted small">
            Servidores novos começam pela conta global, e os servidores dela voltam sozinhos em outro computador.
          </p>
          <div className="row">
            <a className="ui-button ui-button-secondary ui-button-sm" href={`${GLOBAL_URL}/conta`} target="_blank" rel="noreferrer">
              Gerenciar conta
            </a>
            <Button variant="ghost" size="sm" onClick={() => void signOutGlobal()}>
              Sair da conta global
            </Button>
          </div>
        </>
      ) : (
        <form className="form" onSubmit={(event) => void submit(event)}>
          <p className="muted">Um login para todos os seus servidores Annoy. Ninguém, nem nós, fica sabendo quais são.</p>
          <div className="grid-2">
            <Field label="E-mail">
              <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required />
            </Field>
            <Field label="Senha">
              <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
            </Field>
          </div>
          {error && <p className="error small">{error}</p>}
          <div className="row">
            <Button type="submit" size="sm" loading={busy}>
              {busy ? "Protegendo sua senha…" : "Entrar"}
            </Button>
            <a href={`${GLOBAL_URL}/cadastro`} target="_blank" rel="noreferrer">
              Criar conta global
            </a>
          </div>
        </form>
      )}
    </section>
  );
}

export function UserSettingsModal() {
  const accounts = useStore((s) => s.accounts);
  const instances = useStore((s) => s.instances);
  const saved = useStore((s) => s.settings);
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
    return change && user && (change.displayName.trim() !== user.displayName || change.avatar !== undefined);
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
    try {
      for (const account of dirtyProfiles) {
        const change = profiles[account.id]!,
          user = getState().instances[account.id]?.user;
        if (!user) continue;
        const name = change.displayName.trim();
        if (!name) throw new Error("Informe um nome de exibição.");
        const api = apiFor(account.id);
        if (name !== user.displayName) {
          const updated = await api.patch<User>("/users/@me", { displayName: name });
          applyUserUpdate(account.id, updated);
        }
        if (change.avatar !== undefined) {
          const updated =
            change.avatar === null ? await api.patch<User>("/users/@me", { avatarUrl: null }) : await api.uploadAvatar<User>(change.avatar);
          // Old servers may ignore an unknown avatar field. Never claim success.
          if (change.avatar === null && updated.avatarUrl !== null)
            throw new Error("Esta instância precisa ser atualizada para remover fotos.");
          applyUserUpdate(account.id, updated);
          setProfiles((current) => ({ ...current, [account.id]: { displayName: name } }));
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
      setError((error as Error).message || "Não foi possível salvar. Suas alterações continuam aqui.");
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
        <section className="settings-section appearance-section">
          <div className="settings-brand">
            <Brand size={36} wordmark />
            <span>Um espaço com a sua cara.</span>
          </div>
          <h3>Aparência</h3>
          <p className="muted">Escolha como o Annoy aparece para você.</p>
          <div className="theme-options" role="group" aria-label="Tema do aplicativo">
            {(["dark", "light", "system"] as const).map((theme) => (
              <button
                key={theme}
                className={`theme-option${draft.theme === theme ? " selected" : ""}`}
                aria-pressed={draft.theme === theme}
                onClick={() => update({ theme })}
                disabled={saving}
              >
                <Icon name={theme === "dark" ? "moon" : theme === "light" ? "sun" : "monitor"} size={20} />
                <span>{theme === "dark" ? "Escuro" : theme === "light" ? "Claro" : "Sistema"}</span>
                {draft.theme === theme && <Icon name="check" size={16} />}
              </button>
            ))}
          </div>
          <AppearanceSettings settings={draft} update={update} />
        </section>
        <GlobalAccountSection draft={draft} update={update} />
        <section className="settings-section">
          <h3>Meu perfil e contas</h3>
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
        <section className="settings-section">
          <h3>Voz e vídeo</h3>
          <div className="grid-2">
            {deviceSelect("Microfone", "audioinput", draft.inputDeviceId, "inputDeviceId")}
            {deviceSelect("Saída de áudio", "audiooutput", draft.outputDeviceId, "outputDeviceId")}
          </div>
          {deviceSelect("Câmera", "videoinput", draft.cameraDeviceId, "cameraDeviceId")}
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
          <Field
            label="Transmissão de tela"
            hint={`${SCREEN_QUALITIES.find((q) => q.value === draft.screenQuality)?.hint ?? ""} Vale para a próxima transmissão.`}
          >
            <Select
              aria-label="Qualidade da transmissão de tela"
              value={draft.screenQuality}
              onChange={(event) => update({ screenQuality: event.target.value as ScreenQuality })}
              disabled={saving}
            >
              {SCREEN_QUALITIES.map((q) => (
                <option key={q.value} value={q.value}>
                  {q.label}
                </option>
              ))}
            </Select>
          </Field>
          {screenAudioSupported() ? (
            <label className="check">
              <Checkbox checked={draft.screenAudio} onChange={(event) => update({ screenAudio: event.target.checked })} />
              Transmitir o som do computador junto com a tela
            </label>
          ) : (
            <p className="muted small">O som do computador junto com a tela por enquanto só é transmitido no Windows.</p>
          )}
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
          <MicMeter deviceId={draft.inputDeviceId} threshold={draft.inputMode === "vad" ? draft.vadThreshold : 0} filter={draft.noiseFilter} />
        </section>
        <section className="settings-section">
          <h3>Atualizações</h3>
          <UpdateSettings />
        </section>
        <section className="settings-section">
          <h3>Barra e abas</h3>
          <Field label="Posição da barra">
            <RadioGroup
              label="Posição da barra"
              value={draft.barPosition}
              onValueChange={(value) => update({ barPosition: value as Settings["barPosition"] })}
              options={[
                { value: "side", label: "Lateral" },
                { value: "top", label: "Topo" },
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
        <section className="settings-section">
          <h3>Atividade para amigos</h3>
          <p className="muted">
            Somente amizades confirmadas nesta instância recebem sua atividade. Membros do servidor e contatos por DM não recebem esses
            dados.
          </p>
          {window.distopic?.platform === "win32" ? (
            <>
              <label className="switch-setting">
                <span>Compartilhar jogos da Steam com amigos</span>
                <Switch checked={draft.shareGames} onCheckedChange={(checked) => update({ shareGames: checked })} />
              </label>
              <label className="switch-setting">
                <span>Compartilhar música do Spotify e Apple Music com amigos</span>
                <Switch checked={draft.shareMusic} onCheckedChange={(checked) => update({ shareMusic: checked })} />
              </label>
              <p className="muted small">
                A leitura começa após salvar. Use os aplicativos para Windows com a música em reprodução. Pausar a música ou fechar o jogo
                encerra a atividade detectada.
              </p>
              {desktopActivity?.error && (
                <p className="error" role="status">
                  {desktopActivity.error}
                </p>
              )}
            </>
          ) : (
            <p className="muted">A detecção automática está disponível no Windows.</p>
          )}
        </section>
        <section className="settings-section">
          <h3>Geral</h3>
          <label className="check">
            <Checkbox checked={draft.notifications} onChange={(event) => update({ notifications: event.target.checked })} />
            Notificar menções e mensagens diretas
          </label>
        </section>
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
