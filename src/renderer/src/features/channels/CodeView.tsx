import { has, Permission, type Channel, type CodeEntry, type CodeFile, type CodeRepo, type CodeStatus, type ServerState } from "@distopic/protocol";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { RequestError } from "../../api.ts";
import { apiFor } from "../../client.ts";
import { toast, useStore } from "../../store.ts";
import { act, Icon } from "../../components/ui.tsx";
import { confirmAction, promptText } from "../../components/ui/action-dialog.tsx";
import { onRoomEvent } from "./events.ts";

type Monaco = typeof import("./monaco.ts");
let monacoModule: Promise<Monaco> | null = null;
const loadMonaco = () => (monacoModule ??= import("./monaco.ts"));

/** Push tokens live in memory for this session only, never on disk. */
const tokens = new Map<string, string>();

interface OpenFile {
  path: string;
  hash: string;
  binary: boolean;
  dirty: boolean;
  /** Someone else saved it while this copy had unsaved edits. */
  stale: boolean;
}

interface TreeNode {
  name: string;
  path: string;
  dir: boolean;
  children: TreeNode[];
}

function buildTree(entries: CodeEntry[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", dir: true, children: [] };
  const dirs = new Map<string, TreeNode>([["", root]]);
  for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    const parent = dirs.get(entry.path.includes("/") ? entry.path.slice(0, entry.path.lastIndexOf("/")) : "") ?? root;
    const node: TreeNode = { name: entry.path.split("/").pop()!, path: entry.path, dir: entry.type === "dir", children: [] };
    parent.children.push(node);
    if (node.dir) dirs.set(entry.path, node);
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, "en", { numeric: true }) : a.dir ? -1 : 1));
    nodes.forEach((n) => sort(n.children));
  };
  sort(root.children);
  return root.children;
}

const STATUS_LABEL: Record<string, string> = { M: "Modificado", A: "Adicionado", D: "Excluído", R: "Renomeado", "?": "Novo", U: "Conflito" };
const statusLetter = (code: string) => (code === "??" ? "U" : (code.trim()[0] ?? "M"));

function LinkRepo({ accountId, channel, repo }: { accountId: string; channel: Channel; repo: CodeRepo }) {
  const [url, setUrl] = useState(repo.url ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await act(apiFor(accountId).put(`/channels/${channel.id}/code`, { url, token: token || undefined }));
    if (token) tokens.set(`${accountId}:${channel.id}`, token);
    setBusy(false);
  };
  return (
    <form className="code-link form" onSubmit={submit}>
      <Icon name="branch" size={36} />
      <h2>Vincular um repositório</h2>
      <p className="muted">
        O canal trabalha sobre um repositório Git externo (GitHub, GitLab, Gitea…). O servidor clona o projeto e todos editam juntos; commits e push vão para o
        repositório de origem.
      </p>
      <label className="field">
        <span>Link https do repositório</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/dono/projeto" required />
      </label>
      <label className="field">
        <span>Token de acesso (só para repositórios privados)</span>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Usado só para clonar; não fica salvo" autoComplete="off" />
      </label>
      <button className="btn" disabled={busy || !url.trim()}>
        {busy ? "Vinculando…" : repo.url ? "Clonar de novo" : "Clonar repositório"}
      </button>
    </form>
  );
}

function Tree({ nodes, depth, active, changed, onOpen, onToggle, expanded, actions }: {
  nodes: TreeNode[];
  depth: number;
  active: string | null;
  changed: Map<string, string>;
  onOpen: (path: string) => void;
  onToggle: (path: string) => void;
  expanded: Set<string>;
  actions: (node: TreeNode) => React.ReactNode;
}) {
  return (
    <ul className="code-tree" role={depth === 0 ? "tree" : "group"}>
      {nodes.map((node) => (
        <li key={node.path} role="treeitem" aria-expanded={node.dir ? expanded.has(node.path) : undefined}>
          <div
            className={`code-node${active === node.path ? " active" : ""}${changed.has(node.path) ? ` git-${statusLetter(changed.get(node.path)!)}` : ""}`}
            style={{ paddingLeft: 8 + depth * 12 }}
            onClick={() => (node.dir ? onToggle(node.path) : onOpen(node.path))}
          >
            <Icon name={node.dir ? (expanded.has(node.path) ? "folderOpen" : "folder") : "file"} size={14} />
            <span className="truncate">{node.name}</span>
            <span className="code-node-actions" onClick={(e) => e.stopPropagation()}>
              {actions(node)}
            </span>
          </div>
          {node.dir && expanded.has(node.path) && (
            <Tree nodes={node.children} depth={depth + 1} active={active} changed={changed} onOpen={onOpen} onToggle={onToggle} expanded={expanded} actions={actions} />
          )}
        </li>
      ))}
    </ul>
  );
}

/** A code channel: an editor in the VS Code style over the server's clone of an external repository. */
export function CodeView({ accountId, channel, perms }: { accountId: string; state: ServerState; channel: Channel; perms: number }) {
  const api = apiFor(accountId);
  const me = useStore((s) => s.instances[accountId]?.user?.id ?? "");
  const canEdit = has(perms, Permission.SEND_MESSAGES);
  const canLink = has(perms, Permission.MANAGE_CHANNELS);
  const base = `/channels/${channel.id}/code`;
  const tokenKey = `${accountId}:${channel.id}`;

  const [repo, setRepo] = useState<CodeRepo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [entries, setEntries] = useState<CodeEntry[]>([]);
  const [status, setStatus] = useState<CodeStatus | null>(null);
  const [panel, setPanel] = useState<"files" | "git">("files");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [files, setFiles] = useState<OpenFile[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem("annoy.git.email") ?? "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [monaco, setMonaco] = useState<Monaco | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<import("monaco-editor").editor.IStandaloneCodeEditor | null>(null);
  const diffEditor = useRef<import("monaco-editor").editor.IStandaloneDiffEditor | null>(null);
  const models = useRef(new Map<string, import("monaco-editor").editor.ITextModel>());
  const filesRef = useRef(files);
  filesRef.current = files;
  const activeRef = useRef(active);
  activeRef.current = active;
  /** Set while we replace a model's text, so the change isn't taken for the user's edit. */
  const applying = useRef(false);

  const ready = repo?.status === "ready";

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const info = await api.get<CodeRepo>(base);
      setRepo(info);
      if (info.status !== "ready") { setEntries([]); setStatus(null); return; }
      const [tree, git] = await Promise.all([api.get<CodeEntry[]>(`${base}/tree`), api.get<CodeStatus>(`${base}/status`)]);
      setEntries(tree);
      setStatus(git);
    } catch (err) {
      setLoadError((err as Error).message || "Não foi possível carregar o repositório.");
    } finally {
      setLoading(false);
    }
  }, [api, base]);

  useEffect(() => {
    void refresh();
    void loadMonaco().then(setMonaco);
  }, [refresh]);

  const patchFile = (path: string, patch: Partial<OpenFile>) => setFiles((list) => list.map((f) => (f.path === path ? { ...f, ...patch } : f)));

  /** Loads `path` into its model, replacing the text unless the user has unsaved edits. */
  const fetchFile = useCallback(
    async (path: string, force = false) => {
      // The first file can be opened before Monaco finished loading.
      const monaco = await loadMonaco();
      const file = await api.get<CodeFile>(`${base}/file?path=${encodeURIComponent(path)}`);
      const open = filesRef.current.find((f) => f.path === path);
      if (open?.dirty && !force) return patchFile(path, { stale: true });
      let model = models.current.get(path);
      if (!model) {
        model = monaco.monaco.editor.createModel(file.content, monaco.languageOf(path), monaco.monaco.Uri.from({ scheme: "annoy", path: `/${channel.id}/${path}` }));
        models.current.set(path, model);
        model.onDidChangeContent(() => {
          const current = filesRef.current.find((f) => f.path === path);
          if (current && !current.dirty && !applying.current) patchFile(path, { dirty: true });
        });
      } else if (model.getValue() !== file.content) {
        applying.current = true;
        model.pushEditOperations([], [{ range: model.getFullModelRange(), text: file.content }], () => null);
        applying.current = false;
      }
      setFiles((list) =>
        list.some((f) => f.path === path)
          ? list.map((f) => (f.path === path ? { ...f, hash: file.hash, binary: file.binary, dirty: false, stale: false } : f))
          : [...list, { path, hash: file.hash, binary: file.binary, dirty: false, stale: false }],
      );
    },
    [api, base, channel.id],
  );

  const openFile = async (path: string) => {
    setDiff(null);
    if (!filesRef.current.some((f) => f.path === path)) {
      try {
        await fetchFile(path);
      } catch (err) {
        return toast((err as Error).message);
      }
    }
    setActive(path);
  };

  // Live updates from everyone else in the channel.
  useEffect(
    () =>
      onRoomEvent(accountId, channel.id, (event) => {
        if (event.t !== "CODE_UPDATE") return;
        setRepo(event.d.repo);
        if (event.d.repo.status !== "ready") return;
        void Promise.all([api.get<CodeEntry[]>(`${base}/tree`), api.get<CodeStatus>(`${base}/status`)])
          .then(([tree, git]) => {
            setEntries(tree);
            setStatus(git);
          })
          .catch(() => {});
        if (event.d.by === me && !event.d.paths.includes("*")) return;
        for (const file of filesRef.current) {
          if (event.d.paths.includes("*") || event.d.paths.includes(file.path)) void fetchFile(file.path).catch(() => {});
        }
      }),
    [accountId, channel.id, api, base, me, fetchFile],
  );

  // One editor; switching tabs swaps its model, like VS Code.
  useEffect(() => {
    if (!monaco || !host.current || !ready) return;
    const instance = monaco.monaco.editor.create(host.current, {
      theme: monaco.editorTheme(),
      automaticLayout: true,
      minimap: { enabled: true },
      fontSize: 13,
      fontLigatures: true,
      scrollBeyondLastLine: false,
      readOnly: !canEdit,
      model: null,
    });
    editor.current = instance;
    return () => {
      instance.dispose();
      editor.current = null;
    };
  }, [monaco, ready, canEdit]);

  useEffect(() => {
    const instance = editor.current;
    if (!instance) return;
    instance.setModel(active ? (models.current.get(active) ?? null) : null);
    if (active) instance.focus();
  }, [active, files.length, monaco]);

  useEffect(
    () => () => {
      for (const model of models.current.values()) model.dispose();
      models.current.clear();
    },
    [],
  );

  const save = useCallback(
    async (path = activeRef.current, overwrite = false) => {
      const file = filesRef.current.find((f) => f.path === path);
      const model = path ? models.current.get(path) : undefined;
      if (!path || !file || !model || !canEdit) return;
      try {
        const saved = await api.put<CodeFile>(`${base}/file`, { path, content: model.getValue(), baseHash: overwrite ? undefined : file.hash });
        patchFile(path, { hash: saved.hash, dirty: false, stale: false });
      } catch (err) {
        if (err instanceof RequestError && err.status === 409) {
          patchFile(path, { stale: true });
          toast("Outra pessoa salvou este arquivo. Recarregue ou sobrescreva.");
        } else toast((err as Error).message);
      }
    },
    [api, base, canEdit],
  );

  // Ctrl+S saves, as in any editor.
  useEffect(() => {
    if (!monaco || !editor.current) return;
    const { KeyMod, KeyCode } = monaco.monaco;
    const action = editor.current.addAction({ id: "annoy.save", label: "Salvar", keybindings: [KeyMod.CtrlCmd | KeyCode.KeyS], run: () => void save() });
    return () => action.dispose();
  }, [monaco, save, ready]);

  const closeFile = async (path: string) => {
    const file = files.find((f) => f.path === path);
    if (file?.dirty && !(await confirmAction(`"${path}" tem mudanças não salvas.`, { title: "Fechar sem salvar?", confirmLabel: "Fechar" }))) return;
    models.current.get(path)?.dispose();
    models.current.delete(path);
    const rest = files.filter((f) => f.path !== path);
    setFiles(rest);
    if (active === path) setActive(rest.at(-1)?.path ?? null);
  };

  const showDiff = async (path: string) => {
    if (!monaco || !host.current) return;
    try {
      const { original } = await api.get<{ diff: string; original: string }>(`${base}/diff?path=${encodeURIComponent(path)}`);
      const current = await api.get<CodeFile>(`${base}/file?path=${encodeURIComponent(path)}`).catch(() => ({ content: "" }) as CodeFile);
      setActive(null);
      setDiff(path);
      requestAnimationFrame(() => {
        const el = document.getElementById(`code-diff-${channel.id}`);
        if (!el) return;
        diffEditor.current?.dispose();
        const language = monaco.languageOf(path);
        const instance = monaco.monaco.editor.createDiffEditor(el, { theme: monaco.editorTheme(), automaticLayout: true, readOnly: true, renderSideBySide: true });
        instance.setModel({ original: monaco.monaco.editor.createModel(original, language), modified: monaco.monaco.editor.createModel(current.content, language) });
        diffEditor.current = instance;
      });
    } catch (err) {
      toast((err as Error).message);
    }
  };
  useEffect(() => {
    if (diff) return;
    const instance = diffEditor.current;
    if (!instance) return;
    const model = instance.getModel();
    instance.dispose();
    model?.original.dispose();
    model?.modified.dispose();
    diffEditor.current = null;
  }, [diff]);

  const newFile = async (dir = "") => {
    const name = await promptText("Nome do novo arquivo (use / para criar pastas)", dir ? `${dir}/` : "");
    if (!name?.trim()) return;
    const path = name.trim().replace(/^\/+/, "");
    if (await act(api.put(`${base}/file`, { path, content: "", baseHash: null }))) {
      await refresh();
      await openFile(path);
    }
  };

  const renamePath = async (node: TreeNode) => {
    const to = await promptText(`Novo caminho para "${node.path}"`, node.path);
    if (!to?.trim() || to.trim() === node.path) return;
    if (await act(api.post(`${base}/rename`, { from: node.path, to: to.trim() }))) {
      for (const f of files.filter((x) => x.path === node.path || x.path.startsWith(`${node.path}/`))) await closeFile(f.path);
      void refresh();
    }
  };

  const removePath = async (node: TreeNode) => {
    if (!(await confirmAction(`"${node.path}" será excluído do repositório para todos.`, { title: "Excluir", confirmLabel: "Excluir" }))) return;
    if (await act(api.del(`${base}/file?path=${encodeURIComponent(node.path)}`))) {
      for (const f of files.filter((x) => x.path === node.path || x.path.startsWith(`${node.path}/`))) {
        models.current.get(f.path)?.dispose();
        models.current.delete(f.path);
      }
      setFiles((list) => list.filter((x) => x.path !== node.path && !x.path.startsWith(`${node.path}/`)));
      void refresh();
    }
  };

  const git = async (label: string, run: () => Promise<unknown>, ok?: string) => {
    setBusy(label);
    const done = await act(run(), ok);
    setBusy(null);
    void refresh();
    return done;
  };

  const askToken = async (why: string) => {
    const saved = tokens.get(tokenKey);
    if (saved) return saved;
    const token = await promptText(`${why} Informe um token com permissão de escrita (GitHub: Settings → Developer settings → Tokens). Ele fica só na memória deste app até fechar.`, "", {
      secret: true,
      confirmLabel: "Continuar",
    });
    if (token?.trim()) tokens.set(tokenKey, token.trim());
    return token?.trim() || null;
  };

  const commit = async (e: FormEvent) => {
    e.preventDefault();
    const dirty = files.filter((f) => f.dirty);
    if (dirty.length && (await confirmAction(`${dirty.length} arquivo(s) abertos têm mudanças não salvas. Salvar antes do commit?`, { title: "Salvar e fazer commit", confirmLabel: "Salvar" }))) {
      for (const f of dirty) await save(f.path);
    }
    try {
      localStorage.setItem("annoy.git.email", email);
    } catch {
      // Private mode: the address is just not remembered.
    }
    if (await git("commit", () => api.post(`${base}/commit`, { message, email: email.trim() || undefined }), "Commit feito")) setMessage("");
  };

  const push = async () => {
    const token = await askToken("O push precisa de autorização no repositório.");
    if (!token) return;
    const ok = await git("push", () => api.post(`${base}/push`, { token }), "Enviado para o repositório");
    if (!ok) tokens.delete(tokenKey);
  };

  const pull = () => git("pull", () => api.post(`${base}/pull`, { token: tokens.get(tokenKey) }), "Atualizado");

  const checkout = async (branch: string, create = false) => {
    if (files.some((f) => f.dirty) && !(await confirmAction("Há arquivos com mudanças não salvas que serão recarregados.", { title: "Trocar de branch", confirmLabel: "Trocar" }))) return;
    await git("checkout", () => api.post(`${base}/checkout`, { branch, create }));
  };

  const tree = useMemo(() => buildTree(entries), [entries]);
  const changed = useMemo(() => new Map(status?.files.map((f) => [f.path, f.code]) ?? []), [status]);
  const activeFile = files.find((f) => f.path === active) ?? null;

  if (!repo) return <section className="chat code-room">
    <header className="chat-header"><Icon name="code" size={20} /><h1 className="truncate">{channel.name}</h1></header>
    <div className="code-load-state" role={loadError ? "alert" : "status"} aria-busy={loading}>
      {loading ? <><span className="code-load-skeleton" /><span className="code-load-skeleton short" /><p>Carregando o repositório…</p></> : <><Icon name="wifiOff" size={26} /><h2>Não foi possível carregar este canal</h2><p>{loadError ?? "O servidor não retornou os dados do repositório."}</p><button className="btn" onClick={() => void refresh()}>Tentar novamente</button></>}
    </div>
  </section>;

  if (repo.status !== "ready") {
    return (
      <section className="chat code-room">
        <header className="chat-header">
          <Icon name="code" size={20} />
          <h1 className="truncate">{channel.name}</h1>
          {repo.url && <span className="chat-topic truncate">{repo.url}</span>}
        </header>
        <div className="code-empty">
          {repo.status === "cloning" ? (
            <>
              <Icon name="loader" size={36} />
              <h2>Clonando {repo.url}</h2>
              <p className="muted">Repositórios grandes podem levar alguns minutos.</p>
            </>
          ) : canLink ? (
            <>
              {repo.status === "error" && <p className="advisory">{repo.error}</p>}
              <LinkRepo accountId={accountId} channel={channel} repo={repo} />
            </>
          ) : (
            <>
              <Icon name="branch" size={36} />
              <h2>{repo.status === "error" ? "O repositório não pôde ser clonado" : "Nenhum repositório vinculado"}</h2>
              <p className="muted">{repo.error ?? "Quem gerencia os canais pode vincular um repositório externo."}</p>
            </>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="chat code-room">
      <header className="chat-header">
        <Icon name="code" size={20} />
        <h1 className="truncate">{channel.name}</h1>
        <a className="chat-topic truncate" href={repo.url ?? undefined} target="_blank" rel="noreferrer">
          {repo.url}
        </a>
        {canLink && (
          <button
            className="icon-btn"
            title="Desvincular repositório"
            onClick={async () => {
              if (await confirmAction("A cópia no servidor e mudanças sem push serão apagadas.", { title: "Desvincular repositório", confirmLabel: "Desvincular" })) {
                void act(api.del(base));
              }
            }}
          >
            <Icon name="trash" size={16} />
          </button>
        )}
      </header>
      <div className="code-body">
        {loadError && <div className="code-load-banner" role="alert"><span>Alguns dados não foram atualizados: {loadError}</span><button className="btn btn-ghost btn-small" disabled={loading} onClick={() => void refresh()}>{loading ? "Atualizando…" : "Tentar novamente"}</button></div>}
        <nav className="code-activity" aria-label="Painéis">
          <button className={panel === "files" ? "active" : ""} title="Explorador" onClick={() => setPanel("files")}>
            <Icon name="file" size={20} />
          </button>
          <button className={panel === "git" ? "active" : ""} title="Controle do código-fonte" onClick={() => setPanel("git")}>
            <Icon name="branch" size={20} />
            {!!status?.files.length && <span className="badge">{status.files.length}</span>}
          </button>
        </nav>
        <aside className="code-side">
          {panel === "files" ? (
            <>
              <div className="code-side-title">
                <span>Explorador</span>
                {canEdit && (
                  <button className="icon-btn tiny" title="Novo arquivo" onClick={() => void newFile()}>
                    <Icon name="filePlus" size={14} />
                  </button>
                )}
                <button className="icon-btn tiny" title="Atualizar" onClick={() => void refresh()}>
                  <Icon name="refresh" size={14} />
                </button>
              </div>
              <Tree
                nodes={tree}
                depth={0}
                active={active}
                changed={changed}
                onOpen={(p) => void openFile(p)}
                onToggle={(p) =>
                  setExpanded((s) => {
                    const next = new Set(s);
                    if (next.has(p)) next.delete(p);
                    else next.add(p);
                    return next;
                  })
                }
                expanded={expanded}
                actions={(node) =>
                  canEdit && (
                    <>
                      {node.dir && (
                        <button className="icon-btn tiny" title="Novo arquivo aqui" onClick={() => void newFile(node.path)}>
                          <Icon name="filePlus" size={12} />
                        </button>
                      )}
                      <button className="icon-btn tiny" title="Renomear ou mover" onClick={() => void renamePath(node)}>
                        <Icon name="edit" size={12} />
                      </button>
                      <button className="icon-btn tiny" title="Excluir" onClick={() => void removePath(node)}>
                        <Icon name="trash" size={12} />
                      </button>
                    </>
                  )
                }
              />
            </>
          ) : (
            <div className="code-git">
              <div className="code-side-title">
                <span>Controle do código-fonte</span>
              </div>
              <div className="code-branch">
                <Icon name="branch" size={14} />
                <select value={status?.branch ?? ""} disabled={!canEdit || !!busy} onChange={(e) => void checkout(e.target.value)} aria-label="Branch">
                  {[...new Set([status?.branch ?? "", ...(status?.branches ?? [])])].filter(Boolean).map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                {canEdit && (
                  <button
                    className="icon-btn tiny"
                    title="Nova branch"
                    onClick={async () => {
                      const name = await promptText("Nome da nova branch");
                      if (name?.trim()) void checkout(name.trim(), true);
                    }}
                  >
                    <Icon name="plus" size={14} />
                  </button>
                )}
              </div>
              {canEdit && (
                <form className="code-commit" onSubmit={commit}>
                  <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Mensagem do commit" rows={3} required />
                  <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Seu e-mail no Git (opcional, para o GitHub atribuir o commit)" />
                  <button className="btn" disabled={!!busy || !message.trim() || !status?.files.length}>
                    <Icon name="check" size={16} />
                    {busy === "commit" ? "Fazendo commit…" : "Commit"}
                  </button>
                  <div className="code-sync">
                    <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => void pull()} title="Buscar e aplicar mudanças do repositório (fast-forward)">
                      <Icon name="pull" size={16} />
                      {busy === "pull" ? "…" : `Pull${status?.behind ? ` (${status.behind})` : ""}`}
                    </button>
                    <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => void push()} title="Enviar commits para o repositório">
                      <Icon name="push" size={16} />
                      {busy === "push" ? "…" : `Push${status?.ahead ? ` (${status.ahead})` : ""}`}
                    </button>
                  </div>
                </form>
              )}
              <h3 className="code-section">Mudanças ({status?.files.length ?? 0})</h3>
              <ul className="code-changes">
                {status?.files.map((f) => (
                  <li key={f.path} className={`git-${statusLetter(f.code)}`}>
                    <button className="truncate" title={f.path} onClick={() => void showDiff(f.path)}>
                      {f.path}
                    </button>
                    <span className="code-status" title={STATUS_LABEL[statusLetter(f.code)] ?? f.code}>
                      {statusLetter(f.code)}
                    </span>
                    {canEdit && (
                      <button
                        className="icon-btn tiny"
                        title="Descartar mudanças"
                        onClick={async () => {
                          if (await confirmAction(`As mudanças em "${f.path}" serão perdidas para todos.`, { title: "Descartar mudanças", confirmLabel: "Descartar" })) {
                            await git("discard", () => api.post(`${base}/discard`, { path: f.path }));
                            if (files.some((x) => x.path === f.path)) void fetchFile(f.path, true).catch(() => closeFile(f.path));
                          }
                        }}
                      >
                        <Icon name="undo" size={12} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <h3 className="code-section">Commits recentes</h3>
              <ul className="code-log">
                {status?.log.map((c) => (
                  <li key={c.hash} title={`${c.hash} · ${c.author} · ${new Date(c.date).toLocaleString("pt-BR")}`}>
                    <Icon name="commit" size={12} />
                    <span className="truncate">{c.subject}</span>
                    <small className="muted">{c.author}</small>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
        <div className="code-main">
          <div className="code-tabs" role="tablist">
            {files.map((f) => (
              <div key={f.path} role="tab" aria-selected={f.path === active} className={`code-tab${f.path === active ? " active" : ""}`} onClick={() => void openFile(f.path)} title={f.path}>
                <span className="truncate">{f.path.split("/").pop()}</span>
                {f.dirty ? <span className="code-dirty" aria-label="Não salvo" /> : null}
                <button
                  className="icon-btn tiny"
                  aria-label={`Fechar ${f.path}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void closeFile(f.path);
                  }}
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            ))}
            {diff && (
              <div className="code-tab active diff">
                <span className="truncate">{diff.split("/").pop()} (mudanças)</span>
                <button className="icon-btn tiny" aria-label="Fechar comparação" onClick={() => setDiff(null)}>
                  <Icon name="x" size={12} />
                </button>
              </div>
            )}
          </div>
          {activeFile?.stale && (
            <div className="code-conflict" role="alert">
              <span>Outra pessoa salvou este arquivo enquanto você editava.</span>
              <button className="btn btn-ghost" onClick={() => void fetchFile(activeFile.path, true)}>
                Recarregar a versão dela
              </button>
              <button className="btn" onClick={() => void save(activeFile.path, true)}>
                Sobrescrever com a minha
              </button>
            </div>
          )}
          <div className="code-editor" ref={host} hidden={!!diff || !active || !!activeFile?.binary} />
          {diff && <div className="code-editor" id={`code-diff-${channel.id}`} />}
          {!diff && activeFile?.binary && (
            <div className="code-empty">
              <Icon name="file" size={36} />
              <p className="muted">Arquivo binário ou grande demais para o editor.</p>
            </div>
          )}
          {!diff && !active && (
            <div className="code-empty">
              <Icon name="code" size={40} />
              <h2>{repo.url?.replace(/^https:\/\/(www\.)?/, "")}</h2>
              <p className="muted">Abra um arquivo no explorador. Ctrl+S salva para todos no canal.</p>
            </div>
          )}
          <footer className="code-status-bar">
            <span>
              <Icon name="branch" size={12} /> {status?.branch ?? repo.branch ?? "—"}
              {status?.ahead ? ` ↑${status.ahead}` : ""}
              {status?.behind ? ` ↓${status.behind}` : ""}
            </span>
            {activeFile && (
              <>
                <span>{activeFile.dirty ? "Não salvo" : "Salvo"}</span>
                <span>{monaco?.languageOf(activeFile.path)}</span>
                {canEdit && activeFile.dirty && (
                  <button className="code-save" onClick={() => void save()}>
                    <Icon name="save" size={12} /> Salvar
                  </button>
                )}
              </>
            )}
            {!canEdit && <span>Somente leitura</span>}
          </footer>
        </div>
      </div>
    </section>
  );
}
