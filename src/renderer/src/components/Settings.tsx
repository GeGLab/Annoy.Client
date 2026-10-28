import {
  has,
  Permission,
  PERMISSION_LABELS,
  type Ban,
  type Channel,
  type DiscordLoginBegin,
  type Invite,
  type Overwrite,
  type PermissionName,
  type Role,
  type ServerState,
  type User,
} from "@distopic/protocol";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { discordLogin, fetchInfo } from "../api.ts";
import { apiFor, openChannel, removeAccount, updateVoiceSettings } from "../client.ts";
import { displayNameOf, rankOf } from "../perms.ts";
import { getState, setState, toast, useStore, type Settings } from "../store.ts";
import { act, closeModal, Field, Icon, Modal, openModal } from "./ui.tsx";
import { UpdateSettings } from "./Updates.tsx";

const ALL_NAMES = Object.keys(Permission) as PermissionName[];
const TEXT_PERMS: PermissionName[] = ["VIEW_CHANNEL", "SEND_MESSAGES", "MANAGE_MESSAGES", "ATTACH_FILES", "MENTION_EVERYONE"];
const VOICE_PERMS: PermissionName[] = ["VIEW_CHANNEL", "CONNECT", "SPEAK", "STREAM", "MUTE_MEMBERS"];

function useServer(accountId: string, serverId: string): { state: ServerState | undefined; me: string | undefined } {
  return {
    state: useStore((s) => s.instances[accountId]?.serverStates[serverId]),
    me: useStore((s) => s.instances[accountId]?.user?.id),
  };
}

// User settings ------------------------------------------------------------

function keyLabel(code: string): string {
  return code.replace(/^Key/, "").replace(/^Digit/, "").replace("Backquote", "` (crase)");
}

function MicMeter({ deviceId }: { deviceId: string }) {
  const [level, setLevel] = useState(0);
  const threshold = useStore((s) => s.settings.vadThreshold);
  useEffect(() => {
    let stop = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    void navigator.mediaDevices
      .getUserMedia({ audio: { deviceId: deviceId === "default" ? undefined : { exact: deviceId } } })
      .then((s) => {
        if (stop) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(s).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        const loop = () => {
          if (stop) return;
          analyser.getByteTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
          setLevel((peak / 128) * 100);
          requestAnimationFrame(loop);
        };
        loop();
      })
      .catch(() => toast("Não foi possível acessar o microfone"));
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
    };
  }, [deviceId]);
  return (
    <div className="meter">
      <div className={`meter-fill${level >= threshold ? " hot" : ""}`} style={{ width: `${Math.min(100, level)}%` }} />
      <div className="meter-threshold" style={{ left: `${threshold}%` }} />
    </div>
  );
}

function AccountRow({ accountId }: { accountId: string }) {
  const account = useStore((s) => s.accounts.find((a) => a.id === accountId));
  const user = useStore((s) => s.instances[accountId]?.user);
  const status = useStore((s) => s.instances[accountId]?.status);
  const isAdmin = useStore((s) => s.instances[accountId]?.instance?.isAdmin ?? false);
  const [name, setName] = useState(user?.displayName ?? "");
  const [discordAvailable, setDiscordAvailable] = useState(false);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => setName(user?.displayName ?? ""), [user?.displayName]);
  useEffect(() => {
    if (account) void fetchInfo(account.url).then((i) => setDiscordAvailable(i.discordLogin), () => undefined);
  }, [account?.url]);
  if (!account) return null;

  // Links Discord to this account, or refreshes name and photo if already linked.
  const syncDiscord = async () => {
    setSyncing(true);
    try {
      await discordLogin(account.url, () => apiFor(accountId).post<DiscordLoginBegin>("/auth/discord/begin", { link: true }), new AbortController().signal);
      toast("Perfil do Discord sincronizado");
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setSyncing(false);
    }
  };
  return (
    <div className="account-row">
      <div>
        <strong>{account.instanceName}</strong> <span className="muted small">{account.url}</span>
        <div className="muted small">
          {user ? `@${user.username}` : ""} · {status === "ready" ? "conectado" : status === "invalid" ? "sessão expirada" : (status ?? "desconectado")}
        </div>
      </div>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void act(apiFor(accountId).patch<User>("/users/@me", { displayName: name }), "Nome atualizado");
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome de exibição" maxLength={32} />
        <button className="btn btn-ghost" disabled={!name.trim() || name === user?.displayName}>
          Salvar
        </button>
      </form>
      {discordAvailable && (
        <button className="btn btn-discord" onClick={() => void syncDiscord()} disabled={syncing} title="Puxa nome e foto do Discord; perfis importados dessa conta passam a ser seus">
          {syncing ? "Aguardando…" : "Sincronizar Discord"}
        </button>
      )}
      {isAdmin && (
        <button className="btn" onClick={() => openModal({ kind: "instanceAdmin", accountId })} title="Cadastro, convites, contas e servidores desta instância">
          Administrar instância
        </button>
      )}
      <button className="btn btn-ghost" onClick={() => confirm(`Sair de ${account.instanceName}?`) && removeAccount(accountId)}>
        Sair
      </button>
      <button className="icon-btn danger" title="Excluir minha conta nesta instância" onClick={() => openModal({ kind: "deleteAccount", accountId })}>
        <Icon name="trash" size={16} />
      </button>
    </div>
  );
}

export function UserSettingsModal() {
  const accounts = useStore((s) => s.accounts);
  const settings = useStore((s) => s.settings);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [capturing, setCapturing] = useState(false);

  const update = (patch: Partial<Settings>) => {
    setState((s) => {
      Object.assign(s.settings, patch);
    });
    updateVoiceSettings();
  };

  useEffect(() => {
    const refresh = () => void navigator.mediaDevices.enumerateDevices().then(setDevices);
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refresh);
  }, []);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== "Escape") update({ pttKey: e.code });
      setCapturing(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing]);

  const inputs = devices.filter((d) => d.kind === "audioinput");
  const cameras = devices.filter((d) => d.kind === "videoinput");
  const outputs = devices.filter((d) => d.kind === "audiooutput");

  return (
    <Modal title="Configurações" wide>
      <section className="settings-section">
        <h3>Contas Distopic</h3>
        {accounts.map((a) => (
          <AccountRow key={a.id} accountId={a.id} />
        ))}
        <button className="btn btn-ghost" onClick={() => openModal({ kind: "addAccount" })}>
          <Icon name="plus" size={16} /> Conectar a outra instância
        </button>
      </section>

      <section className="settings-section">
        <h3>Voz</h3>
        <div className="grid-2">
          <Field label="Microfone">
            <select value={settings.inputDeviceId} onChange={(e) => update({ inputDeviceId: e.target.value })}>
              <option value="default">Padrão do sistema</option>
              {inputs
                .filter((d) => d.deviceId !== "default")
                .map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || "Microfone"}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Saída de áudio">
            <select value={settings.outputDeviceId} onChange={(e) => update({ outputDeviceId: e.target.value })}>
              <option value="default">Padrão do sistema</option>
              {outputs
                .filter((d) => d.deviceId !== "default")
                .map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || "Alto-falante"}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        <Field label="Câmera">
          <select value={settings.cameraDeviceId} onChange={(e) => update({ cameraDeviceId: e.target.value })}>
            <option value="default">Padrão do sistema</option>
            {cameras.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || "Câmera"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Modo de entrada" hint="A mudança vale para a próxima conexão de voz">
          <div className="radio-row">
            <label>
              <input type="radio" checked={settings.inputMode === "vad"} onChange={() => update({ inputMode: "vad" })} /> Detecção de voz
            </label>
            <label>
              <input type="radio" checked={settings.inputMode === "ptt"} onChange={() => update({ inputMode: "ptt" })} /> Apertar para falar
            </label>
          </div>
        </Field>
        {settings.inputMode === "ptt" ? (
          <Field label="Tecla de apertar para falar" hint="Funciona com a janela do Distopic em foco">
            <button className="btn btn-ghost key-capture" onClick={() => setCapturing(true)}>
              {capturing ? "Pressione uma tecla… (Esc cancela)" : keyLabel(settings.pttKey)}
            </button>
          </Field>
        ) : (
          <Field label={`Sensibilidade: ${settings.vadThreshold}`} hint="Fale e ajuste até a barra ficar verde só quando você fala">
            <input type="range" min={1} max={60} value={settings.vadThreshold} onChange={(e) => update({ vadThreshold: Number(e.target.value) })} />
            <MicMeter deviceId={settings.inputDeviceId} />
          </Field>
        )}
      </section>

      <section className="settings-section">
        <h3>Atualizações</h3>
        <UpdateSettings />
        <p className="muted small">
          Você sempre é avisado de versões novas e decide quando atualizar. A única exceção é uma correção de segurança crítica, que é obrigatória.
        </p>
      </section>

      <section className="settings-section">
        <h3>Geral</h3>
        <label className="check">
          <input type="checkbox" checked={settings.notifications} onChange={(e) => update({ notifications: e.target.checked })} />
          Notificar menções e mensagens diretas
        </label>
        <div className="form-actions start">
          <button className="btn btn-ghost" onClick={() => window.distopic?.reloadDiscord()}>
            <Icon name="refresh" size={16} /> Recarregar Discord
          </button>
        </div>
      </section>
    </Modal>
  );
}

// Server settings --------------------------------------------------------

function RoleEditor({ accountId, state, role, me }: { accountId: string; state: ServerState; role: Role; me: string }) {
  const isEveryone = role.id === state.server.id;
  const [name, setName] = useState(role.name);
  const [color, setColor] = useState(role.color ?? "#99aab5");
  const [useColor, setUseColor] = useState(role.color !== null);
  const [perms, setPerms] = useState(role.permissions);
  useEffect(() => {
    setName(role.name);
    setColor(role.color ?? "#99aab5");
    setUseColor(role.color !== null);
    setPerms(role.permissions);
  }, [role]);
  const editable = isEveryone || rankOf(state, me) > role.position;
  const api = apiFor(accountId);
  const path = `/servers/${state.server.id}/roles/${role.id}`;

  const save = (e: FormEvent) => {
    e.preventDefault();
    const body = isEveryone ? { permissions: perms } : { name, color: useColor ? color : null, permissions: perms };
    void act(api.patch(path, body), "Cargo salvo");
  };

  return (
    <form className="role-editor" onSubmit={save}>
      {!editable && <p className="warning">Este cargo está no seu nível ou acima; você não pode editá-lo.</p>}
      {!isEveryone && (
        <div className="grid-2">
          <Field label="Nome">
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={!editable} maxLength={100} />
          </Field>
          <Field label="Cor">
            <div className="color-row">
              <input type="checkbox" checked={useColor} onChange={(e) => setUseColor(e.target.checked)} disabled={!editable} />
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} disabled={!editable || !useColor} />
            </div>
          </Field>
        </div>
      )}
      <div className="perm-list">
        {ALL_NAMES.map((p) => (
          <label key={p} className="perm">
            <input
              type="checkbox"
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
            <button type="button" className="btn btn-ghost" title="Subir na hierarquia" onClick={() => void act(api.patch(path, { position: role.position + 1 }))}>
              ↑ Subir
            </button>
            <button type="button" className="btn btn-ghost" disabled={role.position <= 1} onClick={() => void act(api.patch(path, { position: role.position - 1 }))}>
              ↓ Descer
            </button>
            <button type="button" className="btn btn-danger" onClick={() => confirm(`Excluir o cargo ${role.name}?`) && void act(api.del(path))}>
              Excluir
            </button>
          </>
        )}
        <button className="btn" disabled={!editable}>
          Salvar
        </button>
      </div>
    </form>
  );
}

function Bans({ accountId, serverId }: { accountId: string; serverId: string }) {
  const [bans, setBans] = useState<Ban[] | null>(null);
  const load = () => void apiFor(accountId).get<Ban[]>(`/servers/${serverId}/bans`).then(setBans, (e: Error) => toast(e.message));
  useEffect(load, [accountId, serverId]);
  if (!bans) return <p className="muted">Carregando…</p>;
  if (bans.length === 0) return <p className="muted">Ninguém foi banido.</p>;
  return (
    <div className="list">
      {bans.map((b) => (
        <div key={b.user.id} className="list-row">
          <span>
            <strong>{b.user.displayName}</strong> <span className="muted">@{b.user.username}</span>
            {b.reason && <div className="muted small">{b.reason}</div>}
          </span>
          <button className="btn btn-ghost" onClick={() => void act(apiFor(accountId).del(`/servers/${serverId}/bans/${b.user.id}`)).then(load)}>
            Revogar
          </button>
        </div>
      ))}
    </div>
  );
}

export function ServerSettingsModal({ accountId, serverId }: { accountId: string; serverId: string }) {
  const { state, me } = useServer(accountId, serverId);
  const [tab, setTab] = useState<"overview" | "roles" | "bans">("overview");
  const [roleId, setRoleId] = useState<string | null>(null);
  const [name, setName] = useState(state?.server.name ?? "");
  if (!state || !me) return null;
  const isOwner = state.server.ownerId === me;
  const canRoles = has(state.permissions, Permission.MANAGE_ROLES);
  const canBans = has(state.permissions, Permission.BAN_MEMBERS);
  const canServer = has(state.permissions, Permission.MANAGE_SERVER);
  const api = apiFor(accountId);
  const role = state.roles.find((r) => r.id === roleId) ?? null;

  return (
    <Modal title={`${state.server.name} · Configurações`} wide>
      <div className="tabs">
        <button className={tab === "overview" ? "tab active" : "tab"} onClick={() => setTab("overview")}>
          Visão geral
        </button>
        {canRoles && (
          <button className={tab === "roles" ? "tab active" : "tab"} onClick={() => setTab("roles")}>
            Cargos
          </button>
        )}
        {canBans && (
          <button className={tab === "bans" ? "tab active" : "tab"} onClick={() => setTab("bans")}>
            Banimentos
          </button>
        )}
      </div>

      {tab === "overview" && (
        <div className="form">
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void act(api.patch(`/servers/${serverId}`, { name }), "Servidor renomeado");
            }}
          >
            <Field label="Nome do servidor">
              <input value={name} onChange={(e) => setName(e.target.value)} disabled={!canServer} maxLength={100} />
            </Field>
            <button className="btn" disabled={!canServer || !name.trim() || name === state.server.name}>
              Salvar
            </button>
          </form>
          <p className="muted small">
            {state.members.length} membros · {state.channels.length} canais · dono: {displayNameOf(state.members.find((m) => m.user.id === state.server.ownerId)!)}
          </p>
          {isOwner && (
            <div className="danger-zone">
              <strong>Zona de perigo</strong>
              <p className="muted small">Excluir o servidor apaga canais, mensagens e anexos para todos.</p>
              <button
                className="btn btn-danger"
                onClick={() => {
                  if (prompt(`Digite o nome do servidor para confirmar: ${state.server.name}`) === state.server.name) {
                    void act(api.del(`/servers/${serverId}`)).then((ok) => ok && closeModal());
                  }
                }}
              >
                Excluir servidor
              </button>
            </div>
          )}
        </div>
      )}

      {tab === "roles" && (
        <div className="roles-layout">
          <div className="roles-list">
            <button
              className="btn btn-ghost full"
              onClick={() =>
                void api
                  .post<Role>(`/servers/${serverId}/roles`, { name: "novo cargo" })
                  .then((r) => setRoleId(r.id), (e: Error) => toast(e.message))
              }
            >
              <Icon name="plus" size={16} /> Criar cargo
            </button>
            {state.roles.map((r) => (
              <button key={r.id} className={`role-item${r.id === roleId ? " active" : ""}`} onClick={() => setRoleId(r.id)}>
                <span className="role-dot" style={{ background: r.color ?? "var(--text-muted)" }} />
                <span className="truncate">{r.name}</span>
              </button>
            ))}
          </div>
          <div className="roles-editor">
            {role ? <RoleEditor accountId={accountId} state={state} role={role} me={me} /> : <p className="muted">Escolha um cargo para editar.</p>}
          </div>
        </div>
      )}

      {tab === "bans" && <Bans accountId={accountId} serverId={serverId} />}
    </Modal>
  );
}

// Channel settings -------------------------------------------------------

function OverwriteEditor({ accountId, state, channel, me }: { accountId: string; state: ServerState; channel: Channel; me: string }) {
  const targets = useMemo(
    () => [
      ...state.roles.map((r) => ({ id: r.id, type: "role" as const, label: r.name })),
      ...state.members.map((m) => ({ id: m.user.id, type: "member" as const, label: `@${displayNameOf(m)}` })),
    ],
    [state.roles, state.members],
  );
  const [targetId, setTargetId] = useState(state.server.id);
  const existing = channel.overwrites.find((o) => o.targetId === targetId);
  const [allow, setAllow] = useState(existing?.allow ?? 0);
  const [deny, setDeny] = useState(existing?.deny ?? 0);
  const last = useRef(targetId);
  useEffect(() => {
    if (last.current !== targetId || existing) {
      setAllow(existing?.allow ?? 0);
      setDeny(existing?.deny ?? 0);
      last.current = targetId;
    }
  }, [targetId, existing]);

  const target = targets.find((t) => t.id === targetId)!;
  const names = channel.type === "voice" ? VOICE_PERMS : channel.type === "text" ? TEXT_PERMS : [...new Set([...TEXT_PERMS, ...VOICE_PERMS])];
  const api = apiFor(accountId);
  const set = (p: PermissionName, mode: "allow" | "inherit" | "deny") => {
    const bit = Permission[p];
    setAllow((a) => (mode === "allow" ? a | bit : a & ~bit));
    setDeny((d) => (mode === "deny" ? d | bit : d & ~bit));
  };
  const save = () => {
    const body: Overwrite & { targetType: "role" | "member" } = { targetId, targetType: target.type, allow, deny };
    void act(api.put(`/channels/${channel.id}/overwrites/${targetId}`, body), "Permissões salvas");
  };
  const canEdit = has(state.permissions, Permission.MANAGE_ROLES) || state.server.ownerId === me;

  return (
    <div className="overwrites">
      <Field label="Cargo ou membro">
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
              {channel.overwrites.some((o) => o.targetId === t.id) ? " •" : ""}
            </option>
          ))}
        </select>
      </Field>
      <div className="tri-list">
        {names.map((p) => {
          const bit = Permission[p];
          const mode = allow & bit ? "allow" : deny & bit ? "deny" : "inherit";
          return (
            <div key={p} className="tri-row">
              <span>{PERMISSION_LABELS[p]}</span>
              <div className="tri" role="radiogroup">
                <button className={mode === "deny" ? "deny on" : "deny"} onClick={() => set(p, "deny")} title="Negar" disabled={!canEdit}>
                  ✕
                </button>
                <button className={mode === "inherit" ? "inherit on" : "inherit"} onClick={() => set(p, "inherit")} title="Herdar" disabled={!canEdit}>
                  /
                </button>
                <button className={mode === "allow" ? "allow on" : "allow"} onClick={() => set(p, "allow")} title="Permitir" disabled={!canEdit}>
                  ✓
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="form-actions">
        {existing && (
          <button className="btn btn-ghost" disabled={!canEdit} onClick={() => void act(api.del(`/channels/${channel.id}/overwrites/${targetId}`), "Sobrescrita removida")}>
            Remover sobrescrita
          </button>
        )}
        <button className="btn" onClick={save} disabled={!canEdit}>
          Salvar permissões
        </button>
      </div>
    </div>
  );
}

export function ChannelSettingsModal({ accountId, serverId, channelId }: { accountId: string; serverId: string; channelId: string }) {
  const { state, me } = useServer(accountId, serverId);
  const channel = state?.channels.find((c) => c.id === channelId);
  const [tab, setTab] = useState<"overview" | "perms">("overview");
  const [name, setName] = useState(channel?.name ?? "");
  const [topic, setTopic] = useState(channel?.topic ?? "");
  const [parentId, setParentId] = useState(channel?.parentId ?? "");
  if (!state || !channel || !me) return null;
  const api = apiFor(accountId);
  const categories = state.channels.filter((c) => c.type === "category");

  return (
    <Modal title={`Editar ${channel.type === "category" ? "categoria" : "canal"}: ${channel.name}`} wide>
      <div className="tabs">
        <button className={tab === "overview" ? "tab active" : "tab"} onClick={() => setTab("overview")}>
          Visão geral
        </button>
        <button className={tab === "perms" ? "tab active" : "tab"} onClick={() => setTab("perms")}>
          Permissões
        </button>
      </div>
      {tab === "overview" ? (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void act(api.patch(`/channels/${channel.id}`, { name, topic, ...(channel.type !== "category" && { parentId: parentId || null }) }), "Canal salvo");
          }}
        >
          <Field label="Nome">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
          </Field>
          {channel.type === "text" && (
            <Field label="Tópico">
              <textarea value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={1024} rows={3} />
            </Field>
          )}
          {channel.type !== "category" && (
            <Field label="Categoria">
              <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">Sem categoria</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => confirm(`Excluir ${channel.name}? Mensagens serão apagadas.`) && void act(api.del(`/channels/${channel.id}`)).then((ok) => ok && closeModal())}
            >
              Excluir
            </button>
            <button className="btn">Salvar</button>
          </div>
        </form>
      ) : (
        <OverwriteEditor accountId={accountId} state={state} channel={channel} me={me} />
      )}
    </Modal>
  );
}

// Create channel / invite ------------------------------------------------

export function CreateChannelModal({
  accountId,
  serverId,
  parentId: initialParent,
  type: initialType,
}: {
  accountId: string;
  serverId: string;
  parentId: string | null;
  type: "text" | "voice" | "category";
}) {
  const { state } = useServer(accountId, serverId);
  const [type, setType] = useState(initialType);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState(initialParent ?? "");
  const categories = state?.channels.filter((c) => c.type === "category") ?? [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const channel = await apiFor(accountId).post<Channel>(`/servers/${serverId}/channels`, { name, type, parentId: type === "category" ? null : parentId || null });
      closeModal();
      if (channel.type === "text") openChannel(accountId, serverId, channel.id);
    } catch (err) {
      toast((err as Error).message);
    }
  };

  return (
    <Modal title={type === "category" ? "Criar categoria" : "Criar canal"}>
      <form className="form" onSubmit={submit}>
        {initialType !== "category" && (
          <div className="radio-cards">
            {(["text", "voice"] as const).map((t) => (
              <label key={t} className={type === t ? "radio-card active" : "radio-card"}>
                <input type="radio" checked={type === t} onChange={() => setType(t)} />
                <Icon name={t === "text" ? "hash" : "speaker"} />
                <span>
                  <strong>{t === "text" ? "Texto" : "Voz"}</strong>
                  <span className="muted small">{t === "text" ? "Mensagens, imagens e arquivos" : "Conversa por voz em tempo real"}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        <Field label="Nome">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={type === "text" ? "novo-canal" : type === "voice" ? "Sala" : "Nova categoria"} required maxLength={100} />
        </Field>
        {type !== "category" && categories.length > 0 && (
          <Field label="Categoria">
            <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">Sem categoria</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={closeModal}>
            Cancelar
          </button>
          <button className="btn" disabled={!name.trim()}>
            Criar
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function InviteModal({ accountId, serverId }: { accountId: string; serverId: string }) {
  const { state } = useServer(accountId, serverId);
  const account = getState().accounts.find((a) => a.id === accountId);
  const [expires, setExpires] = useState<string>("168");
  const [maxUses, setMaxUses] = useState<string>("");
  const [invite, setInvite] = useState<Invite | null>(null);

  const create = () =>
    void apiFor(accountId)
      .post<Invite>(`/servers/${serverId}/invites`, {
        expiresInHours: expires ? Number(expires) : null,
        maxUses: maxUses ? Number(maxUses) : null,
      })
      .then(setInvite, (e: Error) => toast(e.message));

  useEffect(create, [accountId, serverId]);

  const address = account?.url.replace(/^https?:\/\//, "") ?? "";
  const shareText = invite ? `Entre no ${state?.server.name ?? "servidor"} no Distopic\nEndereço: ${address}\nConvite: ${invite.code}` : "";

  return (
    <Modal title={`Convidar para ${state?.server.name ?? "servidor"}`}>
      <p className="muted">Quem receber precisa do endereço da instância e do código do convite.</p>
      <div className="invite-box">
        <div>
          <span className="section-label">Endereço</span>
          <code>{address}</code>
        </div>
        <div>
          <span className="section-label">Convite</span>
          <code className="invite-code">{invite?.code ?? "…"}</code>
        </div>
        <button
          className="btn"
          disabled={!invite}
          onClick={() => void navigator.clipboard.writeText(shareText).then(() => toast("Convite copiado"))}
        >
          <Icon name="link" size={16} /> Copiar
        </button>
      </div>
      <div className="grid-2">
        <Field label="Expira em">
          <select value={expires} onChange={(e) => setExpires(e.target.value)}>
            <option value="1">1 hora</option>
            <option value="24">1 dia</option>
            <option value="168">7 dias</option>
            <option value="">Nunca</option>
          </select>
        </Field>
        <Field label="Máximo de usos">
          <select value={maxUses} onChange={(e) => setMaxUses(e.target.value)}>
            <option value="">Sem limite</option>
            <option value="1">1 uso</option>
            <option value="5">5 usos</option>
            <option value="25">25 usos</option>
          </select>
        </Field>
      </div>
      <div className="form-actions">
        <button className="btn btn-ghost" onClick={create}>
          Gerar novo convite
        </button>
      </div>
    </Modal>
  );
}
