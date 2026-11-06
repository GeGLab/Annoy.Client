import {rich} from "../lib/localization.ts";
import {t as translate,onLocalizationChange} from "../../../shared/localization/index.ts";
import { Checkbox } from "./ui/checkbox.tsx";
import { Input } from "./ui/input.tsx";
import { Select } from "./ui/select.tsx";
import { RadioGroup } from "./ui/radio-group.tsx";
import type { ImportChannel, ImportGuild, ImportGuildList, ImportJob, ImportRequest, ImportStructure } from "@annoy/protocol";
import { useMemo, useState, type FormEvent } from "react";
import { apiFor, openServer } from "../client.ts";
import { initials } from "../format.tsx";
import { setState, toast, useStore } from "../store.ts";
import { closeModal, Field, Icon, Modal } from "./ui.tsx";

const DEV_PORTAL = "https://discord.com/developers/applications";

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
      <p className="muted">{translate("common.d2cccc3bfc19")}</p>
      <ol className="steps">
        <li>{rich("common.78076469b576",{p0:(<a href={DEV_PORTAL} target="_blank" rel="noreferrer">{translate("common.5245643fd980")}</a>),p1:(<strong>{translate("common.6386dc360341")}</strong>)})}</li>
        <li>{rich("import.botToken",{p0:(<strong>{translate("common.41e35ba1a1fd")}</strong>),p1:(<strong>{translate("common.74b3ca264e52")}</strong>)})}</li>
        <li>{translate("common.607cd4cd05aa")}</li>
      </ol>
      <Field label={translate("common.973157512cfd")} hint={translate("common.ed96d8977e3f")}>
        <Input
          type="password"
          autoFocus
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={translate("common.02555581b0aa")}
          autoComplete="off"
          required
        />
      </Field>
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={closeModal}>{translate("common.bb9dbb406dcb")}</button>
        <button className="btn" disabled={busy || token.trim().length < 30}>
          {busy ? translate("update.checking") : translate("common.63e2bbaf1c92")}
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
      <p className="muted">{rich("common.1b4c81917852",{p0:(<strong>{list.bot.username}</strong>)})}</p>
      <div className="guild-grid">
        {list.guilds.map((g) => (
          <button key={g.id} className="guild-card" onClick={() => void pick(g)} disabled={busy !== null}>
            {g.iconUrl ? <img src={g.iconUrl} alt="" /> : <span className="guild-initials">{initials(g.name)}</span>}
            <span className="truncate">{g.name}</span>
            {busy === g.id && <span className="muted small">{translate("common.1cd2b46670dc")}</span>}
          </button>
        ))}
        {list.guilds.length === 0 && <p className="muted">{translate("common.2fcbda924218")}</p>}
      </div>
      <div className="form-actions">
        <a className="btn btn-ghost" href={list.inviteUrl} target="_blank" rel="noreferrer">{rich("common.74e527cc852e",{p0:(<Icon name="userPlus" size={16} />)})}</a>
        <button className="btn btn-ghost" onClick={() => void refresh()} disabled={busy !== null}>{rich("common.ea6b1b832c3c",{p0:(<Icon name="refresh" size={16} />)})}</button>
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

  const [target, setTarget] = useState<"new" | "existing">(presetServerId ? "existing" : "new");
  const [name, setName] = useState(guild.name);
  const [serverId, setServerId] = useState(presetServerId ?? owned[0]?.id ?? "");
  const [roleIds, setRoleIds] = useState(() => new Set(roles.filter((r) => !r.managed).map((r) => r.id)));
  const [channelIds, setChannelIds] = useState(() => new Set(importable.map((c) => c.id)));
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
          {!supported && <span className="muted small">{translate("common.87a20d260545")}</span>}
        </label>
      </div>
    );
  };

  const start = async () => {
    setBusy(true);
    const body: ImportRequest = {
      token,
      guildId: guild.id,
      target: target === "new" ? { kind: "new", name } : { kind: "existing", serverId },
      roleIds: [...roleIds],
      channelIds: [...channelIds],
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
      <p role="note">{translate("common.d2c4dee4495b")}</p>
      <section>
        <h3>{translate("common.8e7290e44546")}</h3>
        <RadioGroup
          label={translate("common.6a81e1948fc5")}
          value={target}
          onValueChange={(value) => setTarget(value as "new" | "existing")}
          options={[
            { value: "new", label: translate("common.29cbaeccd1bd") },
            {
              value: "existing",
              label: translate("common.56d5a50ea724"),
              disabled: owned.length === 0,
              hint: owned.length === 0 ? translate("common.288ccc873114") : undefined,
            },
          ]}
        />
        {target === "new" ? (
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder={translate("common.87f8ee74878a")} />
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
          <h3>{translate("common.dacf0de78182")}</h3>
          <span className="spacer" />
          <button
            className="link-btn"
            onClick={() =>
              setChannels(
                importable.map((c) => c.id),
                true,
              )
            }
          >{translate("common.c8f7ce276036")}</button>
          <button
            className="link-btn"
            onClick={() =>
              setChannels(
                importable.map((c) => c.id),
                false,
              )
            }
          >{translate("common.76e1824b75a3")}</button>
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
        <h3>{translate("common.0ca317ead9f6")}</h3>
        <div className="role-picks">
          {roles.map((r) => (
            <label key={r.id} className="check role-pick">
              <Checkbox checked={roleIds.has(r.id)} onChange={(e) => setRoleIds((s) => toggle(s, [r.id], e.target.checked))} />
              <span className="role-dot" style={{ background: r.color ?? "var(--text-muted)" }} />
              {r.id === guild.id ? translate("common.d77d29cd893a") : r.name}
              {r.managed && <span className="tag">{translate("common.9d74932bdb6f")}</span>}
            </label>
          ))}
        </div>
      </section>

      <section className="option-checks">
        <label className="check">
          <Checkbox checked={overwrites} onChange={(e) => setOverwrites(e.target.checked)} />{translate("common.fe60feaa1250")}</label>
      </section>

      <p className="muted small">{translate("import.summary",{p0:(channelIds.size),p1:([...roleIds].filter((id) => id !== guild.id).length)})}</p>
      <div className="form-actions">
        <button
          className="btn"
          onClick={() => void start()}
          disabled={busy || channelIds.size === 0 || (target === "existing" && !serverId)}
        >
          {busy ? translate("common.d86987681ea3") : translate("common.e7f0e6d956c1")}
        </button>
      </div>
    </div>
  );
}

let PHASE_LABEL: Record<ImportJob["phase"], string> = {
  structure: "Criando cargos e canais…",
  done: translate("common.db003659b843"),
  failed: translate("common.5d8a36ef7254"),
  cancelled: translate("common.bb9811b14ec4"),
};

function ProgressStep({ accountId, jobId }: { accountId: string; jobId: string }) {
  const job = useStore((s) => s.instances[accountId]?.imports[jobId]);
  if (!job) return <p className="muted">{translate("common.fbe9f251d052")}</p>;
  const running = job.phase === "structure";
  const pct = job.channelsTotal ? Math.round((job.channelsDone / job.channelsTotal) * 100) : job.phase === "done" ? 100 : 0;
  return (
    <div className="form">
      <h3>{PHASE_LABEL[job.phase]}</h3>
      <div className="progress">
        <div className={`progress-fill${running ? " running" : ""}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="muted small">{translate("import.progress",{p0:(job.channelsDone),p1:(job.channelsTotal)})}</p>
      {job.error && <p className="error">{job.error}</p>}
      {(job.phase === "cancelled" || job.phase === "failed") && job.serverId && (
        <p className="muted small">{translate("common.ea9c5c602d8b")}</p>
      )}
      {job.warnings.length > 0 && (
        <details className="warnings" open={!running}>
          <summary>{rich("common.0046ab6cd135",{p0:(job.warnings.length)})}</summary>
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
          >{translate("common.bb9dbb406dcb")}</button>
        )}
        {job.serverId && (
          <button
            className="btn"
            onClick={() => {
              closeModal();
              void openServer(accountId, job.serverId!);
            }}
          >
            {running ? translate("common.09f2077bd172") : translate("common.11a2ff46627c")}
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
      ? translate("common.022e40704be5")
      : step.kind === "guild"
        ? translate("common.0755cbf85063")
        : step.kind === "select"
          ? translate("common.f99829a56b4a",{p0:(step.structure.guild.name)})
          : translate("common.8ff2229fb5e9");

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
          <button className="link-btn back" onClick={() => setStep({ kind: "guild", list: step.list })}>{translate("common.77668da99fa8")}</button>
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

onLocalizationChange(()=>{PHASE_LABEL={
  structure: "Criando cargos e canais…",
  done: translate("common.db003659b843"),
  failed: translate("common.5d8a36ef7254"),
  cancelled: translate("common.bb9811b14ec4"),
};});
