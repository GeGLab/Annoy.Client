import { Checkbox } from "./ui/checkbox.tsx";
import { Input } from "./ui/input.tsx";
import { Select } from "./ui/select.tsx";
import { RadioGroup } from "./ui/radio-group.tsx";
import type { ImportChannel, ImportGuild, ImportGuildList, ImportJob, ImportRequest, ImportStructure } from "@distopic/protocol";
import { useMemo, useState, type FormEvent } from "react";
import { apiFor, openServer } from "../client.ts";
import { initials } from "../format.tsx";
import { setState, toast, useStore } from "../store.ts";
import { closeModal, Field, Icon, Modal } from "./ui.tsx";

const DEV_PORTAL = "https://discord.com/developers/applications";
const LIMITS = [
  { label: "Últimas 100", value: 100 },
  { label: "Últimas 1.000", value: 1000 },
  { label: "Últimas 10.000", value: 10_000 },
  { label: "Histórico completo", value: null },
] as const;

type Step =
  | { kind: "token" }
  | { kind: "guild"; list: ImportGuildList }
  | { kind: "select"; list: ImportGuildList; structure: ImportStructure }
  | { kind: "progress"; jobId: string };

function TokenStep({ accountId, onDone }: { accountId: string; onDone: (token: string, list: ImportGuildList) => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      onDone(token.trim(), await apiFor(accountId).post<ImportGuildList>("/import/discord/guilds", { token: token.trim() }));
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form" onSubmit={submit}>
      <p className="muted">
        A importação usa um bot pela API oficial do Discord. Sua conta não é usada, então não há risco de banimento. Para preparar o bot:
      </p>
      <ol className="steps">
        <li>
          No{" "}
          <a href={DEV_PORTAL} target="_blank" rel="noreferrer">
            portal de desenvolvedores
          </a>
          , crie uma aplicação (<strong>New Application</strong>).
        </li>
        <li>
          Na aba <strong>Bot</strong>, ative <strong>Message Content Intent</strong> (sem ela as mensagens chegam vazias) e copie o token em{" "}
          <strong>Reset Token</strong>.
        </li>
        <li>Cole o token abaixo; no próximo passo você adiciona o bot ao seu servidor com um link pronto.</li>
      </ol>
      <Field label="Token do bot" hint="Usado só durante a importação; o Annoy não salva o token">
        <Input
          type="password"
          autoFocus
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="MTIz…"
          autoComplete="off"
          required
        />
      </Field>
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={closeModal}>
          Cancelar
        </button>
        <button className="btn" disabled={busy || token.trim().length < 30}>
          {busy ? "Verificando…" : "Continuar"}
        </button>
      </div>
    </form>
  );
}

function GuildStep({
  accountId,
  token,
  list,
  onRefresh,
  onPick,
}: {
  accountId: string;
  token: string;
  list: ImportGuildList;
  onRefresh: (list: ImportGuildList) => void;
  onPick: (structure: ImportStructure) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const api = apiFor(accountId);
  const pick = async (guild: ImportGuild) => {
    setBusy(guild.id);
    try {
      onPick(await api.post<ImportStructure>("/import/discord/structure", { token, guildId: guild.id }));
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const refresh = async () => {
    setBusy("refresh");
    try {
      onRefresh(await api.post<ImportGuildList>("/import/discord/guilds", { token }));
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="form">
      <p className="muted">
        Bot conectado: <strong>{list.bot.username}</strong>. Ele só vê os servidores em que foi adicionado. Adicionar exige a permissão
        "Gerenciar servidor" no Discord.
      </p>
      <div className="guild-grid">
        {list.guilds.map((g) => (
          <button key={g.id} className="guild-card" onClick={() => void pick(g)} disabled={busy !== null}>
            {g.iconUrl ? <img src={g.iconUrl} alt="" /> : <span className="guild-initials">{initials(g.name)}</span>}
            <span className="truncate">{g.name}</span>
            {busy === g.id && <span className="muted small">lendo…</span>}
          </button>
        ))}
        {list.guilds.length === 0 && <p className="muted">O bot ainda não está em nenhum servidor.</p>}
      </div>
      <div className="form-actions">
        <a className="btn btn-ghost" href={list.inviteUrl} target="_blank" rel="noreferrer">
          <Icon name="userPlus" size={16} /> Adicionar o bot a um servidor
        </a>
        <button className="btn btn-ghost" onClick={() => void refresh()} disabled={busy !== null}>
          <Icon name="refresh" size={16} /> Atualizar lista
        </button>
      </div>
    </div>
  );
}

function SelectStep({
  accountId,
  token,
  structure,
  presetServerId,
  onStart,
}: {
  accountId: string;
  token: string;
  structure: ImportStructure;
  presetServerId: string | null;
  onStart: (job: ImportJob) => void;
}) {
  const me = useStore((s) => s.instances[accountId]?.user?.id);
  const servers = useStore((s) => s.instances[accountId]?.servers);
  const owned = (servers ?? []).filter((s) => s.ownerId === me);
  const { guild, roles } = structure;
  const importable = structure.channels.filter((c) => c.kind !== "unsupported");
  const textIds = importable.filter((c) => c.kind === "text").map((c) => c.id);

  const [target, setTarget] = useState<"new" | "existing">(presetServerId ? "existing" : "new");
  const [name, setName] = useState(guild.name);
  const [serverId, setServerId] = useState(presetServerId ?? owned[0]?.id ?? "");
  const [roleIds, setRoleIds] = useState(() => new Set(roles.filter((r) => !r.managed).map((r) => r.id)));
  const [channelIds, setChannelIds] = useState(() => new Set(importable.map((c) => c.id)));
  const [historyIds, setHistoryIds] = useState(() => new Set(textIds));
  const [limit, setLimit] = useState<number | null>(1000);
  const [attachments, setAttachments] = useState(true);
  const [overwrites, setOverwrites] = useState(true);
  const [busy, setBusy] = useState(false);

  const tree = useMemo(() => {
    const cats = structure.channels.filter((c) => c.kind === "category");
    const loose = structure.channels.filter((c) => c.kind !== "category" && (!c.parentId || !cats.some((k) => k.id === c.parentId)));
    return { loose, groups: cats.map((cat) => ({ cat, children: structure.channels.filter((c) => c.parentId === cat.id) })) };
  }, [structure.channels]);

  const toggle = (set: Set<string>, ids: string[], on: boolean) => {
    const next = new Set(set);
    for (const id of ids) on ? next.add(id) : next.delete(id);
    return next;
  };
  const setChannels = (ids: string[], on: boolean) => {
    setChannelIds((s) => toggle(s, ids, on));
    if (!on) setHistoryIds((s) => toggle(s, ids, false));
  };

  const row = (c: ImportChannel, nested: boolean) => {
    const supported = c.kind !== "unsupported";
    const on = channelIds.has(c.id);
    return (
      <div key={c.id} className={`import-row${nested ? " nested" : ""}${supported ? "" : " disabled"}`}>
        <label className="check">
          <Checkbox checked={supported && on} disabled={!supported} onChange={(e) => setChannels([c.id], e.target.checked)} />
          <Icon name={c.kind === "voice" ? "speaker" : "hash"} size={14} />
          <span className="truncate">{c.name}</span>
          {c.label !== "texto" && c.label !== "voz" && <span className="tag">{c.label}</span>}
          {!supported && <span className="muted small">sem equivalente</span>}
        </label>
        {c.kind === "text" && (
          <label className="check history">
            <Checkbox
              checked={historyIds.has(c.id)}
              disabled={!on}
              onChange={(e) => setHistoryIds((s) => toggle(s, [c.id], e.target.checked))}
            />
            histórico
          </label>
        )}
      </div>
    );
  };

  const selectedHistory = [...historyIds].filter((id) => channelIds.has(id));
  const start = async () => {
    setBusy(true);
    const body: ImportRequest = {
      token,
      guildId: guild.id,
      target: target === "new" ? { kind: "new", name } : { kind: "existing", serverId },
      roleIds: [...roleIds],
      channelIds: [...channelIds],
      messageChannelIds: selectedHistory,
      messageLimit: limit,
      attachments,
      overwrites,
    };
    try {
      const job = await apiFor(accountId).post<ImportJob>("/import/discord", body);
      setState((s) => {
        const inst = s.instances[accountId];
        if (inst) inst.imports[job.id] ??= job;
      });
      onStart(job);
    } catch (err) {
      toast((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="form import-select">
      <section>
        <h3>Destino</h3>
        <RadioGroup
          label="Destino da importação"
          value={target}
          onValueChange={(value) => setTarget(value as "new" | "existing")}
          options={[
            { value: "new", label: "Novo servidor" },
            {
              value: "existing",
              label: "Servidor existente",
              disabled: owned.length === 0,
              hint: owned.length === 0 ? "Você não é dono de nenhum servidor nesta instância" : undefined,
            },
          ]}
        />
        {target === "new" ? (
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="Nome do servidor" />
        ) : (
          <Select value={serverId} onChange={(e) => setServerId(e.target.value)}>
            {owned.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        )}
      </section>

      <section>
        <div className="section-head">
          <h3>Canais</h3>
          <span className="spacer" />
          <button
            className="link-btn"
            onClick={() =>
              setChannels(
                importable.map((c) => c.id),
                true,
              )
            }
          >
            todos
          </button>
          <button
            className="link-btn"
            onClick={() =>
              setChannels(
                importable.map((c) => c.id),
                false,
              )
            }
          >
            nenhum
          </button>
          <button className="link-btn" onClick={() => setHistoryIds(new Set(textIds.filter((id) => channelIds.has(id))))}>
            histórico em todos
          </button>
          <button className="link-btn" onClick={() => setHistoryIds(new Set())}>
            sem histórico
          </button>
        </div>
        <div className="import-tree">
          {tree.loose.map((c) => row(c, false))}
          {tree.groups.map(({ cat, children }) => {
            const ids = [cat.id, ...children.filter((c) => c.kind !== "unsupported").map((c) => c.id)];
            const all = ids.every((id) => channelIds.has(id));
            // The category is imported whenever it is selected; "partial" means some children are left out.
            const partial = !all && ids.some((id) => channelIds.has(id));
            return (
              <div key={cat.id}>
                <div className="import-row category">
                  <label className="check">
                    <Checkbox checked={all} indeterminate={partial} onChange={() => setChannels(ids, !all)} />
                    <span className="truncate">{cat.name.toUpperCase()}</span>
                  </label>
                </div>
                {children.map((c) => row(c, true))}
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h3>Cargos</h3>
        <div className="role-picks">
          {roles.map((r) => (
            <label key={r.id} className="check role-pick">
              <Checkbox checked={roleIds.has(r.id)} onChange={(e) => setRoleIds((s) => toggle(s, [r.id], e.target.checked))} />
              <span className="role-dot" style={{ background: r.color ?? "var(--text-muted)" }} />
              {r.id === guild.id ? "Permissões de @everyone" : r.name}
              {r.managed && <span className="tag">bot</span>}
            </label>
          ))}
        </div>
      </section>

      <section className="grid-2">
        <Field label="Mensagens por canal">
          <Select value={String(limit)} onChange={(e) => setLimit(e.target.value === "null" ? null : Number(e.target.value))}>
            {LIMITS.map((l) => (
              <option key={String(l.value)} value={String(l.value)}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="option-checks">
          <label className="check">
            <Checkbox checked={attachments} onChange={(e) => setAttachments(e.target.checked)} /> Baixar anexos
          </label>
          <label className="check">
            <Checkbox checked={overwrites} onChange={(e) => setOverwrites(e.target.checked)} /> Permissões por canal
          </label>
        </div>
      </section>

      <p className="muted small">
        {channelIds.size} canais/categorias · {selectedHistory.length} com histórico · {[...roleIds].filter((id) => id !== guild.id).length}{" "}
        cargos. Os autores das mensagens viram perfis importados (sem login); membros do Discord não viram contas aqui.
      </p>
      <div className="form-actions">
        <button
          className="btn"
          onClick={() => void start()}
          disabled={busy || channelIds.size === 0 || (target === "existing" && !serverId)}
        >
          {busy ? "Iniciando…" : "Importar"}
        </button>
      </div>
    </div>
  );
}

const PHASE_LABEL: Record<ImportJob["phase"], string> = {
  structure: "Criando cargos e canais…",
  messages: "Copiando histórico…",
  done: "Importação concluída",
  failed: "Importação falhou",
  cancelled: "Importação cancelada",
};

function ProgressStep({ accountId, jobId }: { accountId: string; jobId: string }) {
  const job = useStore((s) => s.instances[accountId]?.imports[jobId]);
  if (!job) return <p className="muted">Aguardando o servidor…</p>;
  const running = job.phase === "structure" || job.phase === "messages";
  const pct = job.channelsTotal ? Math.round((job.channelsDone / job.channelsTotal) * 100) : job.phase === "done" ? 100 : 0;
  return (
    <div className="form">
      <h3>{PHASE_LABEL[job.phase]}</h3>
      <div className="progress">
        <div className={`progress-fill${running ? " running" : ""}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="muted small">
        {job.channelsDone}/{job.channelsTotal} canais · {job.messagesImported.toLocaleString("pt-BR")} mensagens · {job.attachmentsImported}{" "}
        anexos
        {job.currentChannel && running ? ` · agora em #${job.currentChannel}` : ""}
      </p>
      {job.error && <p className="error">{job.error}</p>}
      {(job.phase === "cancelled" || job.phase === "failed") && job.serverId && (
        <p className="muted small">O que já foi importado continua no servidor; exclua-o nas configurações se quiser recomeçar.</p>
      )}
      {job.warnings.length > 0 && (
        <details className="warnings" open={!running}>
          <summary>{job.warnings.length} aviso(s)</summary>
          <ul>
            {job.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="form-actions">
        {running && (
          <button
            className="btn btn-danger"
            onClick={() =>
              void apiFor(accountId)
                .post(`/import/jobs/${job.id}/cancel`)
                .catch((e: Error) => toast(e.message))
            }
          >
            Cancelar
          </button>
        )}
        {job.serverId && (
          <button
            className="btn"
            onClick={() => {
              closeModal();
              void openServer(accountId, job.serverId!);
            }}
          >
            {running ? "Abrir enquanto importa" : "Abrir servidor"}
          </button>
        )}
      </div>
    </div>
  );
}

export function ImportDiscordModal({ accountId, serverId }: { accountId: string; serverId: string | null }) {
  const [step, setStep] = useState<Step>({ kind: "token" });
  const [token, setToken] = useState("");
  const title =
    step.kind === "token"
      ? "Importar do Discord"
      : step.kind === "guild"
        ? "Escolha o servidor do Discord"
        : step.kind === "select"
          ? `Importar ${step.structure.guild.name}`
          : "Importando";

  return (
    <Modal title={title} wide={step.kind === "select"}>
      {step.kind === "token" && (
        <TokenStep
          accountId={accountId}
          onDone={(t, list) => {
            setToken(t);
            setStep({ kind: "guild", list });
          }}
        />
      )}
      {step.kind === "guild" && (
        <GuildStep
          accountId={accountId}
          token={token}
          list={step.list}
          onRefresh={(list) => setStep({ kind: "guild", list })}
          onPick={(structure) => setStep({ kind: "select", list: step.list, structure })}
        />
      )}
      {step.kind === "select" && (
        <>
          <button className="link-btn back" onClick={() => setStep({ kind: "guild", list: step.list })}>
            ← outro servidor
          </button>
          <SelectStep
            accountId={accountId}
            token={token}
            structure={step.structure}
            presetServerId={serverId}
            onStart={(job) => setStep({ kind: "progress", jobId: job.id })}
          />
        </>
      )}
      {step.kind === "progress" && <ProgressStep accountId={accountId} jobId={step.jobId} />}
    </Modal>
  );
}
