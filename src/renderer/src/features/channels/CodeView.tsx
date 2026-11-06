import {rich} from "../../lib/localization.ts";
import {localizationPreferences} from "../../../../shared/localization/index.ts";
import {t as translate,onLocalizationChange} from "../../../../shared/localization/index.ts";
import { has, Permission, type Channel, type CodeEntry, type CodeFile, type CodeRepo, type CodeStatus, type ServerState } from "@annoy/protocol";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { RequestError } from "../../api.ts";
import { apiFor } from "../../client.ts";
import { toast, useStore } from "../../store.ts";
import { act, Icon } from "../../components/ui.tsx";
import { confirmAction, promptText } from "../../components/ui/action-dialog.tsx";
import { onRoomEvent } from "./events.ts";
import { useRequestOwner } from "../../lib/use-request-owner.ts";
import { registerNavigationGuard } from "../../lib/navigation-guard.ts";
import { isCancellation } from "../../../../shared/requests.ts";

type Monaco = typeof import("./monaco.ts");
let monacoModule: Promise<Monaco> | null = null;
const loadMonaco = () => (monacoModule ??= import("./monaco.ts").catch((error) => { monacoModule = null; throw error; }));

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

let STATUS_LABEL: Record<string, string> = { M: translate("common.079552d3fad4"), A: translate("common.d88febcb6438"), D: translate("common.e660ce34d4df"), R: translate("common.fe24c71a62f0"), "?": translate("common.2b1d9b4b4ba4"), U: translate("common.6d6f698328c5") };
const statusLetter = (code: string) => (code === "??" ? "U" : (code.trim()[0] ?? "M"));

function LinkRepo({ accountId, channel, repo }: { accountId: string; channel: Channel; repo: CodeRepo }) {
  const requests = useRequestOwner(JSON.stringify([accountId, channel.id]));
  const pending = useRef(false);
  const [url, setUrl] = useState(repo.url ?? "");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const saved = await act(apiFor(accountId).put(`/channels/${channel.id}/code`, { url, token: token || undefined }, requests.signal));
      if (saved && token && !requests.signal.aborted) tokens.set(`${accountId}:${channel.id}`, token);
    } finally { pending.current = false; if (!requests.signal.aborted) setBusy(false); }
  };
  return (
    <form className="code-link form" onSubmit={submit}>
      <Icon name="branch" size={36} />
      <h2>{translate("common.e612b77a1579")}</h2>
      <p role="note">{translate("common.f78c48919194")}</p>
      <p className="muted">{translate("common.579cd0476ab0")}</p>
      <label className="field">
        <span>{translate("common.9dcfbaed6ced")}</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={translate("common.a772f4745ebf")} required />
      </label>
      <label className="field">
        <span>{translate("common.eba900cc36b3")}</span>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={translate("common.289fca5b8fff")} autoComplete="off" />
      </label>
      <button className="btn" disabled={busy || !url.trim()}>
        {busy ? translate("common.19bfa772aabe") : repo.url ? translate("common.91fe96077d92") : translate("common.990c1a987872")}
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
  const requests = useRequestOwner(JSON.stringify([accountId, channel.id]));
  const refreshVersion = useRef(0), diffVersion = useRef(0);
  const fileVersions = useRef(new Map<string, number>());
  const saving = useRef(new Set<string>()), operation = useRef(false), leaving = useRef(false);
  const [savingPaths, setSavingPaths] = useState(new Set<string>());
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
    const version = ++refreshVersion.current;
    const live = () => !requests.signal.aborted && version === refreshVersion.current;
    setLoading(true);
    setLoadError(null);
    try {
      const info = await api.get<CodeRepo>(base, requests.signal);
      if (!live()) return;
      setRepo(info);
      if (info.status !== "ready") { setEntries([]); setStatus(null); return; }
      const [tree, git] = await Promise.all([api.get<CodeEntry[]>(`${base}/tree`, requests.signal), api.get<CodeStatus>(`${base}/status`, requests.signal)]);
      if (!live()) return;
      setEntries(tree);
      setStatus(git);
    } catch (err) {
      if (live() && !isCancellation(err)) setLoadError((err as Error).message || translate("common.5779c56625eb"));
    } finally {
      if (live()) setLoading(false);
    }
  }, [api, base, requests]);

  useEffect(() => {
    void refresh();
    void loadMonaco().then((value) => { if (!requests.signal.aborted) setMonaco(value); }).catch((error) => { if (!requests.signal.aborted) setLoadError(error.message); });
  }, [refresh, requests]);

  const patchFile = (path: string, patch: Partial<OpenFile>) => setFiles((list) => list.map((f) => (f.path === path ? { ...f, ...patch } : f)));

  /** Loads `path` into its model, replacing the text unless the user has unsaved edits. */
  const fetchFile = useCallback(
    async (path: string, force = false) => {
      const version = fileVersions.current.get(path) ?? 0;
      // The first file can be opened before Monaco finished loading.
      const monaco = await loadMonaco();
      requests.signal.throwIfAborted();
      const file = await api.get<CodeFile>(`${base}/file?path=${encodeURIComponent(path)}`, requests.signal);
      requests.signal.throwIfAborted();
      if (version !== (fileVersions.current.get(path) ?? 0)) throw new DOMException("Obsolete file read", "AbortError");
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
    [api, base, channel.id, requests],
  );

  const openFile = async (path: string) => {
    ++diffVersion.current;
    setDiff(null);
    if (!filesRef.current.some((f) => f.path === path)) {
      try {
        await fetchFile(path);
      } catch (err) {
        if (!requests.signal.aborted && !isCancellation(err)) toast((err as Error).message);
        return;
      }
    }
    if (requests.signal.aborted) return;
    setActive(path);
  };

  // Live updates from everyone else in the channel.
  useEffect(
    () =>
      onRoomEvent(accountId, channel.id, (event) => {
        if (event.t !== "CODE_UPDATE") return;
        setRepo(event.d.repo);
        if (event.d.repo.status !== "ready") return;
        void Promise.all([api.get<CodeEntry[]>(`${base}/tree`, requests.signal), api.get<CodeStatus>(`${base}/status`, requests.signal)])
          .then(([tree, git]) => {
            if (requests.signal.aborted) return;
            setEntries(tree);
            setStatus(git);
          })
          .catch((error) => { if (!requests.signal.aborted && !isCancellation(error)) setLoadError(error.message); });
        if (event.d.by === me && !event.d.paths.includes("*")) return;
        for (const file of filesRef.current) {
          if (event.d.paths.includes("*") || event.d.paths.includes(file.path)) void fetchFile(file.path).catch((error) => { if (!requests.signal.aborted && !isCancellation(error)) { patchFile(file.path, { stale: true }); toast(error.message); } });
        }
      }),
    [accountId, channel.id, api, base, me, fetchFile, requests],
  );

  // One editor; switching tabs swaps its model, like VS Code.
  useEffect(() => {
    if (!monaco || !host.current || !ready) return;
    const instance = monaco.monaco.editor.create(host.current, {
      theme: monaco.editorTheme(),
      automaticLayout: true,
      minimap: { enabled: true },
      fontSize: localizationPreferences().fontSize,
      fontLigatures: true,
      scrollBeyondLastLine: false,
      readOnly: !canEdit,
      model: null,
    });
    editor.current = instance;
    const stopText=onLocalizationChange(()=>instance.updateOptions({fontSize:localizationPreferences().fontSize}));
    return () => {
      stopText();
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
      const diff = diffEditor.current, pair = diff?.getModel();
      diff?.dispose(); pair?.original.dispose(); pair?.modified.dispose(); diffEditor.current = null;
    },
    [],
  );

  const save = useCallback(
    async (path = activeRef.current, overwrite = false) => {
      const file = filesRef.current.find((f) => f.path === path);
      const model = path ? models.current.get(path) : undefined;
      if (!path || !file || !model || !canEdit || saving.current.has(path)) return false;
      saving.current.add(path); setSavingPaths(new Set(saving.current));
      const version = model.getVersionId(), content = model.getValue();
      try {
        const saved = await api.put<CodeFile>(`${base}/file`, { path, content, baseHash: overwrite ? undefined : file.hash }, requests.signal);
        requests.signal.throwIfAborted();
        if (model.isDisposed()) return false;
        const edited = model.getVersionId() !== version;
        patchFile(path, { hash: saved.hash, dirty: edited, stale: false });
        return !edited;
      } catch (err) {
        if (requests.signal.aborted || isCancellation(err)) return false;
        if (err instanceof RequestError && err.status === 409) {
          patchFile(path, { stale: true });
          toast(translate("common.d12acb44a12c"));
        } else toast((err as Error).message);
        return false;
      } finally {
        saving.current.delete(path);
        if (!requests.signal.aborted) setSavingPaths(new Set(saving.current));
      }
    },
    [api, base, canEdit, requests],
  );

  useEffect(() => registerNavigationGuard((action) => {
    if (saving.current.size || operation.current) return;
    if (leaving.current || !filesRef.current.some((file) => file.dirty)) { action(); return; }
    void confirmAction(translate("common.4d8d02e7e59a", { p0: filesRef.current.filter((file) => file.dirty).map((file) => file.path).join(", ") }), { title: translate("common.2fe59d189a9f"), confirmLabel: translate("common.0f2bd88ef0ac") }).then((yes) => {
      if (yes && !requests.signal.aborted) { leaving.current = true; action(); }
    });
  }), [requests]);

  // Ctrl+S saves, as in any editor.
  useEffect(() => {
    if (!monaco || !editor.current) return;
    const { KeyMod, KeyCode } = monaco.monaco;
    const action = editor.current.addAction({ id: "annoy.save", label: translate("common.aef7cd5b2081"), keybindings: [KeyMod.CtrlCmd | KeyCode.KeyS], run: () => void save() });
    return () => action.dispose();
  }, [monaco, save, ready]);

  const closeFile = async (path: string) => {
    const file = files.find((f) => f.path === path);
    if (file?.dirty && !(await confirmAction(translate("common.4d8d02e7e59a",{p0:(path)}), { title: translate("common.2fe59d189a9f"), confirmLabel: translate("common.0f2bd88ef0ac") }))) return;
    if (requests.signal.aborted || saving.current.has(path)) return;
    fileVersions.current.set(path, (fileVersions.current.get(path) ?? 0) + 1);
    models.current.get(path)?.dispose();
    models.current.delete(path);
    const rest = files.filter((f) => f.path !== path);
    setFiles(rest);
    if (active === path) setActive(rest.at(-1)?.path ?? null);
  };

  const showDiff = async (path: string) => {
    if (!monaco || !host.current) return;
    const version = ++diffVersion.current;
    try {
      const { original } = await api.get<{ diff: string; original: string }>(`${base}/diff?path=${encodeURIComponent(path)}`, requests.signal);
      const current = await api.get<CodeFile>(`${base}/file?path=${encodeURIComponent(path)}`, requests.signal).catch((error) => { if (error instanceof RequestError && error.status === 404) return { content: "" } as CodeFile; throw error; });
      requests.signal.throwIfAborted();
      if (version !== diffVersion.current) return;
      setActive(null);
      setDiff(path);
      requestAnimationFrame(() => {
        const el = document.getElementById(`code-diff-${channel.id}`);
        if (!el || requests.signal.aborted || version !== diffVersion.current) return;
        const previous = diffEditor.current, pair = previous?.getModel();
        previous?.dispose(); pair?.original.dispose(); pair?.modified.dispose();
        const language = monaco.languageOf(path);
        const instance = monaco.monaco.editor.createDiffEditor(el, { theme: monaco.editorTheme(), automaticLayout: true, readOnly: true, renderSideBySide: true });
        instance.setModel({ original: monaco.monaco.editor.createModel(original, language), modified: monaco.monaco.editor.createModel(current.content, language) });
        diffEditor.current = instance;
      });
    } catch (err) {
      if (!requests.signal.aborted && !isCancellation(err)) toast((err as Error).message);
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
    const name = await promptText(translate("common.e67565bea6c7"), dir ? `${dir}/` : "");
    if (!name?.trim() || requests.signal.aborted) return;
    const path = name.trim().replace(/^\/+/, "");
    if (await act(api.put(`${base}/file`, { path, content: "", baseHash: null }, requests.signal))) {
      await refresh();
      await openFile(path);
    }
  };

  const renamePath = async (node: TreeNode) => {
    const to = await promptText(translate("common.97ae558ab7a9",{p0:(node.path)}), node.path);
    if (!to?.trim() || to.trim() === node.path || requests.signal.aborted) return;
    if (await act(api.post(`${base}/rename`, { from: node.path, to: to.trim() }, requests.signal))) {
      for (const f of files.filter((x) => x.path === node.path || x.path.startsWith(`${node.path}/`))) await closeFile(f.path);
      void refresh();
    }
  };

  const removePath = async (node: TreeNode) => {
    if (!(await confirmAction(translate("common.7813657d346a",{p0:(node.path)}), { title: translate("common.8b19518ff49b"), confirmLabel: translate("common.8b19518ff49b") }))) return;
    if (requests.signal.aborted) return;
    if (await act(api.del(`${base}/file?path=${encodeURIComponent(node.path)}`, requests.signal))) {
      for (const f of files.filter((x) => x.path === node.path || x.path.startsWith(`${node.path}/`))) {
        models.current.get(f.path)?.dispose();
        models.current.delete(f.path);
      }
      setFiles((list) => list.filter((x) => x.path !== node.path && !x.path.startsWith(`${node.path}/`)));
      void refresh();
    }
  };

  const git = async (label: string, run: () => Promise<unknown>, ok?: string) => {
    if (operation.current || requests.signal.aborted) return false;
    operation.current = true;
    setBusy(label);
    try { return await act(run(), ok); }
    finally { operation.current = false; if (!requests.signal.aborted) { setBusy(null); void refresh(); } }
  };

  const askToken = async (why: string) => {
    const saved = tokens.get(tokenKey);
    if (saved) return saved;
    const token = await promptText(translate("common.4664b8a02f51",{p0:(why)}), "", {
      secret: true,
      confirmLabel: translate("common.63e2bbaf1c92"),
    });
    if (token?.trim()) tokens.set(tokenKey, token.trim());
    return token?.trim() || null;
  };

  const commit = async (e: FormEvent) => {
    e.preventDefault();
    const dirty = files.filter((f) => f.dirty);
    if (dirty.length) {
      if (!(await confirmAction(translate("common.e70c5afbcf4b",{p0:(dirty.length)}), { title: translate("common.ef62cc8ce991"), confirmLabel: translate("common.aef7cd5b2081") }))) return;
      for (const f of dirty) if (!await save(f.path)) return;
    }
    try {
      localStorage.setItem("annoy.git.email", email);
    } catch {
      // Private mode: the address is just not remembered.
    }
    if (await git("commit", () => api.post(`${base}/commit`, { message, email: email.trim() || undefined }, requests.signal), "Commit feito")) setMessage("");
  };

  const push = async () => {
    const token = await askToken(translate("common.0208b523ec6c"));
    if (!token) return;
    const ok = await git("push", () => api.post(`${base}/push`, { token }, requests.signal), translate("common.0d7017f71296"));
    if (!ok) tokens.delete(tokenKey);
  };

  const pull = () => git("pull", () => api.post(`${base}/pull`, { token: tokens.get(tokenKey) }, requests.signal), translate("common.9bad2b2f05a9"));

  const checkout = async (branch: string, create = false) => {
    if (files.some((f) => f.dirty) && !(await confirmAction(translate("common.2a5ffad9ff90"), { title: translate("common.16155b83733b"), confirmLabel: translate("common.a5575a1a9fa7") }))) return;
    await git("checkout", () => api.post(`${base}/checkout`, { branch, create }, requests.signal));
  };

  const tree = useMemo(() => buildTree(entries), [entries]);
  const changed = useMemo(() => new Map(status?.files.map((f) => [f.path, f.code]) ?? []), [status]);
  const activeFile = files.find((f) => f.path === active) ?? null;

  if (!repo) return <section className="chat code-room">
    <header className="chat-header"><Icon name="code" size={20} /><h1 className="truncate">{channel.name}</h1></header>
    <div className="code-load-state" role={loadError ? "alert" : "status"} aria-busy={loading}>
      {loading ? <><span className="code-load-skeleton" /><span className="code-load-skeleton short" /><p>{translate("common.284898b3e112")}</p></> : <><Icon name="wifiOff" size={26} /><h2>{translate("common.857978c8edae")}</h2><p>{loadError ?? translate("common.c75ee4cb959b")}</p><button className="btn" onClick={() => void refresh()}>{translate("common.b9e10688be01")}</button></>}
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
              <h2>{rich("common.5c740cf40928",{p0:(repo.url)})}</h2>
              <p className="muted">{translate("common.e56d714b10ba")}</p>
            </>
          ) : canLink ? (
            <>
              {repo.status === "error" && <p className="advisory">{repo.error}</p>}
              <LinkRepo accountId={accountId} channel={channel} repo={repo} />
            </>
          ) : (
            <>
              <Icon name="branch" size={36} />
              <h2>{repo.status === "error" ? translate("common.3e707847d930") : translate("common.131e67d87bb5")}</h2>
              <p className="muted">{repo.error ?? translate("common.553b464bd16a")}</p>
            </>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="chat code-room">
      <p className="connection-notice">{translate("common.1a14de17cfd9")}</p>
      <header className="chat-header">
        <Icon name="code" size={20} />
        <h1 className="truncate">{channel.name}</h1>
        <a className="chat-topic truncate" href={repo.url ?? undefined} target="_blank" rel="noreferrer">
          {repo.url}
        </a>
        {canLink && (
          <button
            className="icon-btn"
            title={translate("common.117067ec5f7a")}
            onClick={async () => {
              if (await confirmAction(translate("common.c81738b44ed0"), { title: translate("common.117067ec5f7a"), confirmLabel: translate("common.66667c616661") })) {
                void act(api.del(base, requests.signal));
              }
            }}
          >
            <Icon name="trash" size={16} />
          </button>
        )}
      </header>
      <div className="code-body">
        {loadError && <div className="code-load-banner" role="alert"><span>{rich("common.79eb7af9c068",{p0:(loadError)})}</span><button className="btn btn-ghost btn-small" disabled={loading} onClick={() => void refresh()}>{loading ? translate("common.84e496a080f7") : translate("common.b9e10688be01")}</button></div>}
        <nav className="code-activity" aria-label={translate("common.36e168ed8dd3")}>
          <button className={panel === "files" ? "active" : ""} title={translate("common.d5120059860d")} onClick={() => setPanel("files")}>
            <Icon name="file" size={20} />
          </button>
          <button className={panel === "git" ? "active" : ""} title={translate("common.e42bf43a6bfb")} onClick={() => setPanel("git")}>
            <Icon name="branch" size={20} />
            {!!status?.files.length && <span className="badge">{status.files.length}</span>}
          </button>
        </nav>
        <aside className="code-side">
          {panel === "files" ? (
            <>
              <div className="code-side-title">
                <span>{translate("common.d5120059860d")}</span>
                {canEdit && (
                  <button className="icon-btn tiny" title={translate("common.856e861746de")} onClick={() => void newFile()}>
                    <Icon name="filePlus" size={14} />
                  </button>
                )}
                <button className="icon-btn tiny" title={translate("common.dafb59613e12")} onClick={() => void refresh()}>
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
                        <button className="icon-btn tiny" title={translate("common.a26e7a1d31c4")} onClick={() => void newFile(node.path)}>
                          <Icon name="filePlus" size={12} />
                        </button>
                      )}
                      <button className="icon-btn tiny" title={translate("common.47f74d87a051")} onClick={() => void renamePath(node)}>
                        <Icon name="edit" size={12} />
                      </button>
                      <button className="icon-btn tiny" title={translate("common.8b19518ff49b")} onClick={() => void removePath(node)}>
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
                <span>{translate("common.e42bf43a6bfb")}</span>
              </div>
              <div className="code-branch">
                <Icon name="branch" size={14} />
                <select value={status?.branch ?? ""} disabled={!canEdit || !!busy} onChange={(e) => void checkout(e.target.value)} aria-label={translate("common.52656e8104ee")}>
                  {[...new Set([status?.branch ?? "", ...(status?.branches ?? [])])].filter(Boolean).map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                {canEdit && (
                  <button
                    className="icon-btn tiny"
                    title={translate("common.db5a7bc92d20")}
                    onClick={async () => {
                      const name = await promptText(translate("common.f2204dab467e"));
                      if (name?.trim()) void checkout(name.trim(), true);
                    }}
                  >
                    <Icon name="plus" size={14} />
                  </button>
                )}
              </div>
              {canEdit && (
                <form className="code-commit" onSubmit={commit}>
                  <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder={translate("common.965629ccd272")} rows={3} required />
                  <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder={translate("common.12c70b2dacba")} />
                  <button className="btn" disabled={!!busy || !message.trim() || !status?.files.length}>
                    <Icon name="check" size={16} />
                    {busy === "commit" ? translate("common.a84378880cc6") : translate("common.82a9c46ffa47")}
                  </button>
                  <div className="code-sync">
                    <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => void pull()} title={translate("common.ba0930737a3f")}>
                      <Icon name="pull" size={16} />
                      {busy === "pull" ? "…" : translate("common.67c53b51e2c4",{p0:(status?.behind ? ` (${status.behind})` : "")})}
                    </button>
                    <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => void push()} title={translate("common.45328e9739bf")}>
                      <Icon name="push" size={16} />
                      {busy === "push" ? "…" : translate("common.6f5cafa1a337",{p0:(status?.ahead ? ` (${status.ahead})` : "")})}
                    </button>
                  </div>
                </form>
              )}
              <h3 className="code-section">{rich("common.4171a2ef4381",{p0:(status?.files.length ?? 0)})}</h3>
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
                        title={translate("common.a350912ad6ee")}
                        onClick={async () => {
                          if (await confirmAction(translate("common.295e4e1e645e",{p0:(f.path)}), { title: translate("common.a350912ad6ee"), confirmLabel: translate("common.1a878a55c594") })) {
                            await git("discard", () => api.post(`${base}/discard`, { path: f.path }, requests.signal));
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
              <h3 className="code-section">{translate("common.972b0c4c2d39")}</h3>
              <ul className="code-log">
                {status?.log.map((c) => (
                  <li key={c.hash} title={translate("common.61791a3671b0",{p0:(c.hash),p1:(c.author),p2:(new Date(c.date).toLocaleString(localizationPreferences().region,{hourCycle:localizationPreferences().hourCycle}))})}>
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
                {f.dirty ? <span className="code-dirty" aria-label={translate("common.28424d39e33d")} /> : null}
                <button
                  className="icon-btn tiny"
                  aria-label={translate("common.c37427d712ba",{p0:(f.path)})}
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
                <span className="truncate">{rich("common.f8be101caa77",{p0:(diff.split("/").pop())})}</span>
                <button className="icon-btn tiny" aria-label={translate("common.938b40200ca4")} onClick={() => setDiff(null)}>
                  <Icon name="x" size={12} />
                </button>
              </div>
            )}
          </div>
          {activeFile?.stale && (
            <div className="code-conflict" role="alert">
              <span>{translate("common.9d38204d7f3e")}</span>
              <button className="btn btn-ghost" onClick={() => void fetchFile(activeFile.path, true).catch((error) => { if (!requests.signal.aborted && !isCancellation(error)) toast(error.message); })}>{translate("common.c93d468c72bb")}</button>
              <button className="btn" onClick={() => void save(activeFile.path, true)}>{translate("common.b92d153723fe")}</button>
            </div>
          )}
          <div className="code-editor" ref={host} hidden={!!diff || !active || !!activeFile?.binary} />
          {diff && <div className="code-editor" id={`code-diff-${channel.id}`} />}
          {!diff && activeFile?.binary && (
            <div className="code-empty">
              <Icon name="file" size={36} />
              <p className="muted">{translate("common.15b69639d3a7")}</p>
            </div>
          )}
          {!diff && !active && (
            <div className="code-empty">
              <Icon name="code" size={40} />
              <h2>{repo.url?.replace(/^https:\/\/(www\.)?/, "")}</h2>
              <p className="muted">{translate("common.6be79618fdc2")}</p>
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
                <span>{activeFile.dirty ? translate("common.28424d39e33d") : translate("common.db14b511e33a")}</span>
                <span>{monaco?.languageOf(activeFile.path)}</span>
                {canEdit && activeFile.dirty && (
                  <button className="code-save" disabled={savingPaths.has(activeFile.path)} aria-busy={savingPaths.has(activeFile.path)} onClick={() => void save()}>{rich("common.f8a58a64aa6d",{p0:(<Icon name="save" size={12} />)})}</button>
                )}
              </>
            )}
            {!canEdit && <span>{translate("common.0e156e8eefc1")}</span>}
          </footer>
        </div>
      </div>
    </section>
  );
}

onLocalizationChange(()=>{STATUS_LABEL={ M: translate("common.079552d3fad4"), A: translate("common.d88febcb6438"), D: translate("common.e660ce34d4df"), R: translate("common.fe24c71a62f0"), "?": translate("common.2b1d9b4b4ba4"), U: translate("common.6d6f698328c5") };});
