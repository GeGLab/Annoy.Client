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
  type Ban,
  type Channel,
  type DiscordLoginBegin,
  type Invite,
  type Overwrite,
  type PermissionName,
  type Role,
  type ServerState,
  type ServerSummary,
  type User,
} from "@distopic/protocol";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { discordLogin, fetchInfo } from "../api.ts";
import { apiFor, openChannel, removeAccount, updateVoiceSettings } from "../client.ts";
import { displayNameOf, rankOf } from "../perms.ts";
import { getState, setState, toast, useStore, type Settings } from "../store.ts";
import { act, closeModal, Field, Icon, Modal, openModal } from "./ui.tsx";
import { NOISE_FILTERS, openMic, type Mic, type NoiseFilter } from "../noise.ts";
import { HiddenServices } from "./Services.tsx";
import { UpdateSettings } from "./Updates.tsx";
import { Brand } from "./Brand.tsx";
import { ColorPicker } from "./ui/color-picker.tsx";
import { useSettingsDraft } from "./settings/SettingsGuard.tsx";
import { requestNavigation } from "../lib/navigation-guard.ts";

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

function RoleEditor({ accountId, state, role, me }: { accountId: string; state: ServerState; role: Role; me: string }) {
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
    const ok = await act(api.patch(path, body), "Cargo salvo");
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
      {!editable && <p className="warning">Este cargo está no seu nível ou acima; você não pode editá-lo.</p>}
      {!isEveryone && (
        <div className="grid-2">
          <Field label="Nome">
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!editable} maxLength={100} />
          </Field>
          <Field label="Cor">
            <div className="color-row">
              <Checkbox checked={useColor} onChange={(e) => setUseColor(e.target.checked)} disabled={!editable} />
              <ColorPicker label="Cor do cargo" value={color} onChange={setColor} disabled={!editable || !useColor} />
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
              title="Subir na hierarquia"
              onClick={() => void act(api.patch(path, { position: role.position + 1 }))}
            >
              ↑ Subir
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={role.position <= 1}
              onClick={() => void act(api.patch(path, { position: role.position - 1 }))}
            >
              ↓ Descer
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={async () => (await confirmAction(`Excluir o cargo ${role.name}?`)) && void act(api.del(path))}
            >
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
  const load = () =>
    void apiFor(accountId)
      .get<Ban[]>(`/servers/${serverId}/bans`)
      .then(setBans, (e: Error) => toast(e.message));
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
          <button
            className="btn btn-ghost"
            onClick={() => void act(apiFor(accountId).del(`/servers/${serverId}/bans/${b.user.id}`)).then(load)}
          >
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
  const [icon, setIcon] = useState<File | null | undefined>();
  const [preview, setPreview] = useState<string | null>(state?.server.iconUrl ?? null);
  const [savingServer, setSavingServer] = useState(false);
  const iconInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (icon) { const url = URL.createObjectURL(icon); setPreview(url); return () => URL.revokeObjectURL(url); }
    setPreview(icon === null ? null : state?.server.iconUrl ?? null);
  }, [icon, state?.server.iconUrl]);
  const [baselineName, setBaselineName] = useState(state?.server.name ?? "");
  const saveName = async () => {
    if (!state || !name.trim() || savingServer || !has(state.permissions, Permission.MANAGE_SERVER)) return false;
    setSavingServer(true);
    try {
      const api = apiFor(accountId);
      let server = await api.patch<ServerSummary>(`/servers/${serverId}`, { name: name.trim(), ...(icon === null && { iconUrl: null }) });
      if (icon) server = await api.uploadServerIcon<ServerSummary>(serverId, icon);
      setState((s) => {
        const instance = s.instances[accountId];
        if (instance?.serverStates[serverId]) instance.serverStates[serverId]!.server = server;
        const index = instance?.servers.findIndex((item) => item.id === serverId) ?? -1;
        if (instance && index >= 0) instance.servers[index] = server;
      });
      setName(server.name); setBaselineName(server.name); setIcon(undefined); toast("Servidor atualizado");
      return true;
    } catch (error) { toast((error as Error).message); return false; }
    finally { setSavingServer(false); }
  };
  useSettingsDraft("server-name", !!state && (name !== baselineName || icon !== undefined), saveName, () => {
    setName(state?.server.name ?? ""); setBaselineName(state?.server.name ?? ""); setIcon(undefined);
  });
  if (!state || !me) return null;
  const isOwner = state.server.ownerId === me;
  const canRoles = has(state.permissions, Permission.MANAGE_ROLES);
  const canBans = has(state.permissions, Permission.BAN_MEMBERS);
  const canServer = has(state.permissions, Permission.MANAGE_SERVER);
  const api = apiFor(accountId);
  const role = state.roles.find((r) => r.id === roleId) ?? null;

  return (
    <Modal title={`${state.server.name} · Configurações`} wide className="edit-settings-modal server-settings-modal">
      <div className="tabs">
        <button className={tab === "overview" ? "tab active" : "tab"} onClick={() => requestNavigation(() => setTab("overview"))}>
          Visão geral
        </button>
        {canRoles && (
          <button className={tab === "roles" ? "tab active" : "tab"} onClick={() => requestNavigation(() => setTab("roles"))}>
            Cargos
          </button>
        )}
        {canBans && (
          <button className={tab === "bans" ? "tab active" : "tab"} onClick={() => requestNavigation(() => setTab("bans"))}>
            Banimentos
          </button>
        )}
      </div>

      {tab === "overview" && (
        <div className="form server-overview">
          <div className="server-identity-editor">
            <div className="server-image-preview">{preview ? <img src={preview} alt="Prévia da imagem do servidor" /> : <Icon name="users" size={42} />}</div>
            <div><h2>Uma cara para sua comunidade</h2><p>Use uma imagem que ajude as pessoas a reconhecer seu servidor.</p><div className="profile-actions"><button className="btn btn-ghost" disabled={!canServer || savingServer} onClick={() => iconInput.current?.click()}><Icon name="upload" size={16} />Alterar imagem</button>{preview && <button className="btn btn-ghost" disabled={!canServer || savingServer} onClick={() => setIcon(null)}>Remover</button>}</div><small>PNG, JPEG, WebP ou GIF · até 8 MB</small></div>
            <input ref={iconInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Imagem do servidor" onChange={(event) => { const file = event.target.files?.[0]; if (file) { if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 8 * 1024 * 1024) toast("Use uma imagem de até 8 MB."); else setIcon(file); } event.target.value = ""; }} />
          </div>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              void saveName();
            }}
          >
            <Field label="Nome do servidor">
              <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canServer || savingServer} maxLength={100} />
            </Field>
            <button className="btn" disabled={!canServer || savingServer || !name.trim() || (name === baselineName && icon === undefined)}>
              Salvar
            </button>
          </form>
          <p className="muted small">
            {state.members.length} membros · {state.channels.length} canais · dono:{" "}
            {displayNameOf(state.members.find((m) => m.user.id === state.server.ownerId)!)}
          </p>
          {isOwner && (
            <div className="danger-zone">
              <strong>Zona de perigo</strong>
              <p className="muted small">Excluir o servidor apaga canais, mensagens e anexos para todos.</p>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  if ((await promptText(`Digite o nome do servidor para confirmar: ${state.server.name}`)) === state.server.name) {
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
                void api.post<Role>(`/servers/${serverId}/roles`, { name: "novo cargo" }).then(
                  (r) => requestNavigation(() => setRoleId(r.id)),
                  (e: Error) => toast(e.message),
                )
              }
            >
              <Icon name="plus" size={16} /> Criar cargo
            </button>
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
              <RoleEditor key={role.id} accountId={accountId} state={state} role={role} me={me} />
            ) : (
              <p className="muted">Escolha um cargo para editar.</p>
            )}
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
    const ok = await act(api.put(`/channels/${channel.id}/overwrites/${targetId}`, body), "Permissões salvas");
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
        <span className="field-label">Permissões para</span>
        <EntityPicker
          label="Cargo ou membro"
          value={targetId}
          onValueChange={(id) => requestNavigation(() => setTargetId(id))}
          items={targets.map((t) => ({
            id: t.id,
            label: t.label,
            group: t.type === "role" ? "Cargos" : "Membros",
            description:
              t.type === "role"
                ? t.id === state.server.id
                  ? "Todos os membros do servidor"
                  : "Quem possui este cargo"
                : `@${state.members.find((m) => m.user.id === t.id)?.user.username ?? ""}`,
            color: state.roles.find((r) => r.id === t.id)?.color,
            avatarUrl: state.members.find((m) => m.user.id === t.id)?.user.avatarUrl,
            customized: channel.overwrites.some((o) => o.targetId === t.id),
          }))}
        />
        <span className="field-hint">Cargos afetam um grupo. Membros recebem uma exceção individual.</span>
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
              void act(api.del(`/channels/${channel.id}/overwrites/${targetId}`), "Sobrescrita removida").then((ok) => {
                if (ok) {
                  setAllow(0);
                  setDeny(0);
                  setBaseline("0:0");
                }
              })
            }
          >
            Remover sobrescrita
          </button>
        )}
        <button className="btn" onClick={() => void save()} disabled={!canEdit}>
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
  const [baseline, setBaseline] = useState(() => JSON.stringify([channel?.name ?? "", channel?.topic ?? "", channel?.parentId ?? ""]));
  const values = JSON.stringify([name, topic, parentId]);
  const saveChannel = async () => {
    if (!channel || !name.trim()) return false;
    const ok = await act(
      apiFor(accountId).patch(`/channels/${channel.id}`, {
        name,
        topic,
        ...(channel.type !== "category" && { parentId: parentId || null }),
      }),
      "Canal salvo",
    );
    if (ok) setBaseline(values);
    return ok;
  };
  useSettingsDraft("channel", !!channel && values !== baseline, saveChannel, () => {
    setName(channel?.name ?? "");
    setTopic(channel?.topic ?? "");
    setParentId(channel?.parentId ?? "");
    setBaseline(JSON.stringify([channel?.name ?? "", channel?.topic ?? "", channel?.parentId ?? ""]));
  });
  if (!state || !channel || !me) return null;
  const api = apiFor(accountId);
  const categories = state.channels.filter((c) => c.type === "category");

  return (
    <Modal title={`Editar ${channel.type === "category" ? "categoria" : "canal"}: ${channel.name}`} wide className="edit-settings-modal channel-settings-modal">
      <div className="tabs">
        <button className={tab === "overview" ? "tab active" : "tab"} onClick={() => requestNavigation(() => setTab("overview"))}>
          Visão geral
        </button>
        <button className={tab === "perms" ? "tab active" : "tab"} onClick={() => requestNavigation(() => setTab("perms"))}>
          Permissões
        </button>
      </div>
      {tab === "overview" ? (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void saveChannel();
          }}
        >
          <Field label="Nome">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
          </Field>
          {channel.type === "text" && (
            <Field label="Tópico">
              <Textarea value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={1024} rows={3} />
            </Field>
          )}
          {channel.type !== "category" && (
            <Field label="Categoria">
              <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">Sem categoria</option>
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
                (await confirmAction(`Excluir ${channel.name}? Mensagens serão apagadas.`)) &&
                void act(api.del(`/channels/${channel.id}`)).then((ok) => ok && closeModal())
              }
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
      const channel = await apiFor(accountId).post<Channel>(`/servers/${serverId}/channels`, {
        name,
        type,
        parentId: type === "category" ? null : parentId || null,
      });
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
          <RadioGroup
            cards
            label="Tipo de canal"
            value={type}
            onValueChange={(value) => setType(value as "text" | "voice")}
            options={["text", "voice"].map((t) => ({
              value: t,
              label: (
                <>
                  <Icon name={t === "text" ? "hash" : "speaker"} />
                  <span>
                    <strong>{t === "text" ? "Texto" : "Voz"}</strong>
                    <span className="muted small">{t === "text" ? "Mensagens, imagens e arquivos" : "Conversa por voz em tempo real"}</span>
                  </span>
                </>
              ),
            }))}
          />
        )}
        <Field label="Nome">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={type === "text" ? "novo-canal" : type === "voice" ? "Sala" : "Nova categoria"}
            required
            maxLength={100}
          />
        </Field>
        {type !== "category" && categories.length > 0 && (
          <Field label="Categoria">
            <Select value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">Sem categoria</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
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
  const shareText = invite ? `Entre no ${state?.server.name ?? "servidor"} no Annoy\nEndereço: ${address}\nConvite: ${invite.code}` : "";

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
          <Select value={expires} onChange={(e) => setExpires(e.target.value)}>
            <option value="1">1 hora</option>
            <option value="24">1 dia</option>
            <option value="168">7 dias</option>
            <option value="">Nunca</option>
          </Select>
        </Field>
        <Field label="Máximo de usos">
          <Select value={maxUses} onChange={(e) => setMaxUses(e.target.value)}>
            <option value="">Sem limite</option>
            <option value="1">1 uso</option>
            <option value="5">5 usos</option>
            <option value="25">25 usos</option>
          </Select>
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
