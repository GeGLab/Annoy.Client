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

const MODE_TEXT: Record<RegistrationMode, string> = {
  open: "Qualquer pessoa com o endereço cria uma conta.",
  invite: "Só quem tem um convite de cadastro gerado aqui.",
  closed: "Ninguém cria conta nova; quem já tem continua entrando.",
};

const LEVEL_TEXT: Record<VoiceUsage["level"], string> = {
  ok: "Estimativa pelo bitrate máximo; o uso real fica abaixo. Câmera e tela pausam em 80%, a voz em 95%.",
  video_off: "Câmera e tela estão pausadas até o próximo mês para não passar do limite.",
  off: "A voz está pausada até o próximo mês para não passar do limite.",
};

/** Cloudflare bills decimal gigabytes. */
const gb = (bytes: number) => `${(bytes / 1e9).toLocaleString("pt-BR", { maximumFractionDigits: bytes < 1e10 ? 2 : 0 })} GB`;

function VoiceUsageBar({ usage }: { usage: VoiceUsage }) {
  const pct = usage.limitBytes > 0 ? Math.min(100, (usage.bytes / usage.limitBytes) * 100) : 0;
  return (
    <Field
      label={`Tráfego de voz no Cloudflare (${usage.month})`}
      hint={usage.limitBytes > 0 ? LEVEL_TEXT[usage.level] : "Sem limite configurado (ANNOY_CF_SFU_MONTHLY_GB=0)."}
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
  if (!overview || !draft) return <p className="muted">Carregando…</p>;
  const save = () => void act(api.patch<InstanceSettings>("/admin/settings", draft), "Configurações da instância salvas");
  return (
    <div className="form">
      <div className="stat-row">
        <div><strong>{overview.userCount}</strong><span>contas</span></div>
        <div><strong>{overview.serverCount}</strong><span>servidores</span></div>
        <div><strong>{overview.messageCount.toLocaleString("pt-BR")}</strong><span>mensagens</span></div>
        <div><strong>{formatSize(overview.uploadsBytes)}</strong><span>em anexos</span></div>
      </div>
      {overview.voiceUsage && <VoiceUsageBar usage={overview.voiceUsage} />}
      <Field label="Cadastro de contas novas" hint={MODE_TEXT[draft.registration]}>
        <div className="segmented">
          {(["open", "invite", "closed"] as const).map((m) => (
            <button key={m} className={draft.registration === m ? "active" : ""} onClick={() => setDraft({ ...draft, registration: m })}>
              {m === "open" ? "Aberto" : m === "invite" ? "Só com convite" : "Fechado"}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid-2">
        <Field label="Servidores por conta" hint="Vazio = sem limite. Admins não têm limite.">
          <Input
            type="number"
            min={1}
            value={draft.maxServersPerUser ?? ""}
            onChange={(e) => setDraft({ ...draft, maxServersPerUser: e.target.value ? Number(e.target.value) : null })}
            placeholder="Sem limite"
          />
        </Field>
        <Field label="Tamanho máximo por anexo (MB)">
          <Input type="number" min={1} max={500} value={draft.maxUploadMb} onChange={(e) => setDraft({ ...draft, maxUploadMb: Number(e.target.value) || 1 })} />
        </Field>
      </div>
      <div className="form-actions">
        <button className="btn" onClick={save}>
          Salvar
        </button>
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
          toast(`Servidor atualizado para a versão ${s.current}`);
        } else if (!s.updating && Date.now() - started > 15_000) {
          setWaitingFrom(null);
          if (s.lastError) toast(s.lastError);
          else toast("O servidor já está na versão mais nova da imagem que ele segue");
        }
      }, () => undefined);
    }, 3000);
    return () => clearInterval(timer);
  }, [waitingFrom, accountId]);
  if (!status) return <p className="muted">Carregando…</p>;
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
        <div><strong>{status.current}</strong><span>versão instalada</span></div>
        <div><strong>{status.latest ?? "?"}</strong><span>versão mais nova</span></div>
      </div>
      <p className="muted small">
        {status.latest === null
          ? "Não deu para consultar a versão mais nova agora."
          : outdated
            ? `Há uma versão nova: ${status.latest}.`
            : "O servidor está na versão mais nova."}
      </p>
      {status.available ? (
        <>
          <div className="form-actions">
            <button className="btn" disabled={waitingFrom !== null || status.updating} onClick={apply}>
              {waitingFrom !== null || status.updating ? "Atualizando… o servidor reinicia sozinho" : "Atualizar agora"}
            </button>
          </div>
          <label className="check">
            <Switch checked={status.auto} onCheckedChange={setAuto} />
            Atualizar automaticamente
          </label>
          <p className="muted small">
            {status.auto
              ? `O servidor procura versão nova a cada ${status.intervalHours ?? 6} h e reinicia sozinho; quem estiver em chamada volta em segundos.`
              : "Desligado: o servidor só atualiza quando você pedir aqui."}
            {status.channel && status.channel !== "latest" && ` Segue só a versão ${status.channel} (ANNOY_VERSION).`}
          </p>
          {status.lastCheck && <p className="muted small">Última verificação: {formatTime(status.lastCheck)}</p>}
          {status.lastError && <p className="warning">{status.lastError}</p>}
        </>
      ) : (
        <p className="warning">
          O atualizador não está rodando neste servidor, então a atualização tem que ser feita nele. Na pasta do annoy-server, rode{" "}
          <code>git pull && docker compose up -d</code>. Depois disso, você atualiza e liga a atualização automática por aqui.
        </p>
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
        void navigator.clipboard.writeText(`Crie sua conta no Annoy\nEndereço: ${address}\nConvite de cadastro: ${inv.code}`);
        toast("Convite criado e copiado");
      }, (e: Error) => toast(e.message));
  const now = new Date().toISOString();
  return (
    <div className="form">
      <p className="muted small">
        Convites de <strong>cadastro</strong> deixam alguém criar uma conta nesta instância. Para chamar alguém para um servidor, use o convite do servidor.
      </p>
      <div className="inline-form">
        <Field label="Usos">
          <Select value={maxUses} onChange={(e) => setMaxUses(e.target.value)}>
            <option value="1">1 pessoa</option>
            <option value="5">5 pessoas</option>
            <option value="25">25 pessoas</option>
            <option value="">Sem limite</option>
          </Select>
        </Field>
        <Field label="Expira em">
          <Select value={expires} onChange={(e) => setExpires(e.target.value)}>
            <option value="24">1 dia</option>
            <option value="168">7 dias</option>
            <option value="720">30 dias</option>
            <option value="">Nunca</option>
          </Select>
        </Field>
        <button className="btn" onClick={create}>
          <Icon name="plus" size={16} /> Gerar convite
        </button>
      </div>
      <div className="list">
        {invites?.length === 0 && <p className="muted">Nenhum convite ainda.</p>}
        {invites?.map((inv) => {
          const dead = (inv.expiresAt !== null && inv.expiresAt < now) || (inv.maxUses !== null && inv.uses >= inv.maxUses);
          return (
            <div key={inv.code} className={`list-row${dead ? " dim" : ""}`}>
              <span>
                <code className="invite-code">{inv.code}</code>
                <span className="muted small">
                  {" "}
                  · {inv.uses}/{inv.maxUses ?? "∞"} usos · {inv.expiresAt ? `expira ${formatTime(inv.expiresAt)}` : "não expira"}
                  {dead ? " · encerrado" : ""}
                </span>
              </span>
              <span className="row-actions">
                <button className="icon-btn" title="Copiar" onClick={() => void navigator.clipboard.writeText(inv.code).then(() => toast("Código copiado"))}>
                  <Icon name="link" size={16} />
                </button>
                <button className="icon-btn danger" title="Revogar" onClick={() => void act(api.del(`/admin/invites/${inv.code}`)).then(load)}>
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
    const reason = await promptText(`Suspender ${u.user.displayName}? Motivo (opcional):`);
    if (reason !== null) void act(api.post(`/admin/users/${u.user.id}/ban`, { reason }), "Conta suspensa").then(load);
  };
  const remove = async (u: AdminUser) => {
    if (!await confirmAction(`Excluir a conta de ${u.user.displayName}? Os dados pessoais são apagados.`)) return;
    const messages = await confirmAction("Apagar também todas as mensagens dessa pessoa? Você pode mantê-las como “Usuário excluído”.", {confirmLabel:"Apagar mensagens",cancelLabel:"Manter mensagens"});
    void act(api.del(`/admin/users/${u.user.id}?deleteMessages=${messages ? 1 : 0}`), "Conta excluída").then(load);
  };
  return (
    <div className="form">
      <Input placeholder="Buscar por nome ou @usuário" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="list">
        {users?.map((u) => (
          <div key={u.user.id} className={`list-row user-row-admin${u.bannedAt ? " dim" : ""}`}>
            <Avatar user={u.user} size={32} />
            <span className="grow">
              <strong>{u.user.displayName}</strong> <span className="muted small">@{u.user.username}</span>
              <span className="tags">
                {u.isAdmin && <span className="tag accent">admin</span>}
                {u.imported && <span className="tag">importado</span>}
                {u.discordLinked && <span className="tag">discord</span>}
                {u.bannedAt && <span className="tag danger">suspenso{u.banReason ? `: ${u.banReason}` : ""}</span>}
              </span>
              <span className="muted small">
                desde {new Date(u.createdAt).toLocaleDateString("pt-BR")} · {u.serverCount} servidor(es)
              </span>
            </span>
            {u.user.id !== me && !u.imported && (
              <span className="row-actions">
                <button className="btn btn-ghost btn-small" onClick={() => void act(api.patch(`/admin/users/${u.user.id}`, { isAdmin: !u.isAdmin })).then(load)}>
                  {u.isAdmin ? "Remover admin" : "Tornar admin"}
                </button>
                {!u.isAdmin &&
                  (u.bannedAt ? (
                    <button className="btn btn-ghost btn-small" onClick={() => void act(api.del(`/admin/users/${u.user.id}/ban`), "Suspensão removida").then(load)}>
                      Reativar
                    </button>
                  ) : (
                    <button className="btn btn-danger btn-small" onClick={() => ban(u)}>
                      Suspender
                    </button>
                  ))}
                {!u.isAdmin && (
                  <button className="icon-btn danger" title="Excluir conta" onClick={() => remove(u)}>
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
      {servers?.length === 0 && <p className="muted">Nenhum servidor nesta instância.</p>}
      {servers?.map((s) => (
        <div key={s.server.id} className="list-row">
          <span className="grow">
            <strong>{s.server.name}</strong>
            <span className="muted small">
              {" "}
              · dono {s.owner?.displayName ?? "?"} · {s.memberCount} membros · {s.channelCount} canais · criado {new Date(s.createdAt).toLocaleDateString("pt-BR")}
            </span>
          </span>
          <button
            className="icon-btn danger"
            title={s.server.ownerId === me && s.memberCount > 1 ? "Transfira a propriedade antes de excluir um servidor com outros membros." : "Excluir servidor"}
            disabled={s.server.ownerId === me && s.memberCount > 1}
            onClick={async () => {
              if (await confirmAction(
                `Deseja mesmo excluir ${s.server.name}? Os canais, as mensagens e os anexos serão apagados.`,
                { title: `Excluir "${s.server.name}"`, confirmLabel: "Excluir servidor" },
              )) void act(api.del(`/admin/servers/${s.server.id}`), "Servidor excluído").then(load);
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
    <Modal title={`Administrar instância · ${account?.instanceName ?? ""}`} wide>
      <div className="tabs">
        {(
          [
            ["settings", "Visão geral"],
            ["updates", "Atualizações"],
            ["invites", "Convites de cadastro"],
            ["users", "Contas"],
            ["servers", "Servidores"],
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
      toast("Conta excluída");
    }
  };
  return (
    <Modal title="Excluir minha conta">
      <div className="form">
        <p className="warning">
          Isto apaga sua conta nesta instância: nome, foto, vínculo com o Discord, amizades e participação nos servidores. Não dá para desfazer.
        </p>
        <label className="check">
          <Checkbox  checked={deleteMessages} onChange={(e) => setDeleteMessages(e.target.checked)} />
          Apagar também todas as minhas mensagens e anexos
        </label>
        <p className="muted small">Sem marcar, suas mensagens continuam aparecendo como "Usuário excluído".</p>
        <Field label={`Digite @${user.username} para confirmar`}>
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={user.username} />
        </Field>
        <Field label="Senha" hint="Deixe em branco se você entra só pelo Discord">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        <div className="form-actions">
          <button className="btn btn-ghost" onClick={closeModal}>
            Cancelar
          </button>
          <button className="btn btn-danger" disabled={busy || confirmText.trim().toLowerCase() !== user.username.toLowerCase()} onClick={() => void submit()}>
            Excluir conta
          </button>
        </div>
      </div>
    </Modal>
  );
}
