import { has, LIMITS, Permission, type Attachment, type Channel, type Message, type ServerState } from "@distopic/protocol";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { apiFor, loadMessages } from "../../client.ts";
import { formatDay, formatSize } from "../../format.tsx";
import { displayNameOf } from "../../perms.ts";
import { toast, useStore } from "../../store.ts";
import { act, Icon, type IconName } from "../../components/ui.tsx";
import { confirmAction } from "../../components/ui/action-dialog.tsx";
import { Select } from "../../components/ui/select.tsx";

const ImageViewer = lazy(() => import("../../components/ImageViewer.tsx"));
const MediaViewer = lazy(() => import("../../components/MediaViewer.tsx"));

interface SharedFile {
  attachment: Attachment;
  message: Message;
}

interface Upload {
  id: number;
  names: string;
  progress: number;
  error: string | null;
  abort: AbortController;
}

type Sort = "recent" | "name" | "size";

function iconFor(contentType: string, filename: string): IconName {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "film";
  if (contentType.startsWith("audio/")) return "music";
  if (/\.(js|ts|tsx|jsx|py|cs|java|go|rs|c|cpp|h|json|ya?ml|toml|sh|html|css|sql)$/i.test(filename)) return "code";
  return "file";
}

let uploadSeq = 0;

/** A files channel: every message is a share, shown as a searchable list of files. */
export function FilesView({ accountId, state, channel, perms }: { accountId: string; state: ServerState; channel: Channel; perms: number }) {
  const entry = useStore((s) => s.instances[accountId]?.messages[channel.id]);
  const me = useStore((s) => s.instances[accountId]?.user?.id ?? "");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState("");
  const [image, setImage] = useState<number | null>(null);
  const [media, setMedia] = useState<{ url: string; filename: string; contentType: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const api = apiFor(accountId);
  const canUpload = has(perms, Permission.SEND_MESSAGES) && has(perms, Permission.ATTACH_FILES);
  const canModerate = has(perms, Permission.MANAGE_MESSAGES);
  const names = useMemo(() => new Map(state.members.map((m) => [m.user.id, displayNameOf(m)])), [state.members]);

  useEffect(() => {
    void loadMessages(accountId, channel.id);
  }, [accountId, channel.id]);

  const files = useMemo(() => {
    const all: SharedFile[] = (entry?.items ?? []).flatMap((message) => message.attachments.map((attachment) => ({ attachment, message })));
    const q = query.trim().toLowerCase();
    const found = q
      ? all.filter(({ attachment, message }) =>
          [attachment.filename, message.content, names.get(message.author.id) ?? message.author.displayName].some((t) => t.toLowerCase().includes(q)),
        )
      : all;
    return [...found].sort((a, b) =>
      sort === "name"
        ? a.attachment.filename.localeCompare(b.attachment.filename, "pt-BR", { numeric: true })
        : sort === "size"
          ? b.attachment.size - a.attachment.size
          : b.message.id.localeCompare(a.message.id),
    );
  }, [entry?.items, query, sort, names]);
  const images = files
    .filter((f) => f.attachment.contentType.startsWith("image/"))
    .map((f) => ({ id: f.attachment.id, url: api.resolve(f.attachment.url), filename: f.attachment.filename, size: f.attachment.size }));
  const totalSize = files.reduce((sum, f) => sum + f.attachment.size, 0);

  const upload = async (list: File[]) => {
    if (!canUpload) return toast("Sem permissão para enviar arquivos aqui");
    const description = note.trim();
    setNote("");
    // The server takes a limited number of files per message.
    for (let i = 0; i < list.length; i += LIMITS.attachmentsPerMessage) {
      const batch = list.slice(i, i + LIMITS.attachmentsPerMessage);
      const job: Upload = { id: ++uploadSeq, names: batch.map((f) => f.name).join(", "), progress: 0, error: null, abort: new AbortController() };
      setUploads((u) => [...u, job]);
      const update = (patch: Partial<Upload>) => setUploads((u) => u.map((x) => (x.id === job.id ? { ...x, ...patch } : x)));
      try {
        await api.uploadMessage(channel.id, i === 0 ? description : "", batch, (progress) => update({ progress }), job.abort.signal);
        setUploads((u) => u.filter((x) => x.id !== job.id));
      } catch (err) {
        if ((err as Error).name === "AbortError") setUploads((u) => u.filter((x) => x.id !== job.id));
        else update({ error: (err as Error).message });
      }
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = [...e.dataTransfer.files];
    if (dropped.length) void upload(dropped);
  };

  const remove = async (file: SharedFile) => {
    const others = file.message.attachments.length - 1;
    const ok = await confirmAction(
      others > 0 ? `Este envio tem mais ${others} arquivo(s), que também serão excluídos.` : `"${file.attachment.filename}" será excluído para todos.`,
      { title: "Excluir arquivo", confirmLabel: "Excluir" },
    );
    if (ok) void act(api.del(`/channels/${channel.id}/messages/${file.message.id}`));
  };

  const open = (file: SharedFile) => {
    const { contentType, url, filename } = file.attachment;
    if (contentType.startsWith("image/")) setImage(images.findIndex((i) => i.id === file.attachment.id));
    else if (/^(audio|video)\//.test(contentType)) setMedia({ url: api.resolve(url), filename, contentType });
    else window.distopic?.download(api.resolve(url));
  };

  return (
    <section
      className={`chat files-room${dragging ? " dragging" : ""}`}
      onDragOver={(e) => {
        if (!canUpload || !e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <header className="chat-header">
        <Icon name="folder" size={20} />
        <h1 className="truncate">{channel.name}</h1>
        <span className="chat-topic">{channel.topic || `${files.length} arquivo(s) · ${formatSize(totalSize)}`}</span>
      </header>

      <div className="files-toolbar">
        <label className="files-search">
          <Icon name="search" size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nome, descrição ou pessoa" aria-label="Buscar arquivos" />
        </label>
        <Select className="files-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Ordenar">
          <option value="recent">Mais recentes</option>
          <option value="name">Nome</option>
          <option value="size">Tamanho</option>
        </Select>
        {canUpload && (
          <>
            <input className="files-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Descrição (opcional)" maxLength={LIMITS.messageMax} />
            <button className="btn" onClick={() => input.current?.click()}>
              <Icon name="upload" size={16} />
              Enviar arquivos
            </button>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                const list = [...(e.target.files ?? [])];
                e.target.value = "";
                if (list.length) void upload(list);
              }}
            />
          </>
        )}
      </div>

      {uploads.length > 0 && (
        <ul className="files-uploads">
          {uploads.map((u) => (
            <li key={u.id} className={u.error ? "failed" : ""}>
              <Icon name={u.error ? "x" : "upload"} size={16} />
              <span className="truncate">{u.names}</span>
              {u.error ? <span className="danger-text">{u.error}</span> : <progress value={u.progress} max={1} />}
              <button className="icon-btn tiny" aria-label={u.error ? "Dispensar" : "Cancelar envio"} onClick={() => (u.error ? setUploads((x) => x.filter((y) => y.id !== u.id)) : u.abort.abort())}>
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="files-list" role="list">
        {files.length === 0 && !entry?.loading && (
          <div className="files-empty">
            <Icon name="folderOpen" size={40} />
            <h2>{query ? "Nada encontrado" : "Nenhum arquivo ainda"}</h2>
            <p className="muted">{query ? "Tente outro termo." : canUpload ? "Arraste arquivos para cá ou use Enviar arquivos." : "Quando alguém compartilhar, os arquivos aparecem aqui."}</p>
          </div>
        )}
        {files.map((file) => {
          const { attachment, message } = file;
          const mine = message.author.id === me;
          return (
            <div key={attachment.id} className="file-row" role="listitem">
              <button className="file-open" onClick={() => open(file)} title={attachment.contentType.startsWith("image/") || /^(audio|video)\//.test(attachment.contentType) ? "Abrir" : "Baixar"}>
                {attachment.contentType.startsWith("image/") ? (
                  <img className="file-thumb" src={api.resolve(attachment.url)} alt="" loading="lazy" decoding="async" />
                ) : (
                  <span className="file-thumb">
                    <Icon name={iconFor(attachment.contentType, attachment.filename)} size={22} />
                  </span>
                )}
                <span className="file-meta">
                  <strong className="truncate">{attachment.filename}</strong>
                  <small className="muted truncate">
                    {formatSize(attachment.size)} · {names.get(message.author.id) ?? message.author.displayName} · {formatDay(message.createdAt)}
                  </small>
                  {message.content && <span className="file-note truncate">{message.content}</span>}
                </span>
              </button>
              <span className="row-actions">
                <button className="icon-btn" title="Baixar" aria-label={`Baixar ${attachment.filename}`} onClick={() => window.distopic?.download(api.resolve(attachment.url))}>
                  <Icon name="download" size={16} />
                </button>
                <button
                  className="icon-btn"
                  title="Copiar link"
                  aria-label={`Copiar link de ${attachment.filename}`}
                  onClick={() => void navigator.clipboard.writeText(api.resolve(attachment.url)).then(() => toast("Link copiado"))}
                >
                  <Icon name="link" size={16} />
                </button>
                {(mine || canModerate) && (
                  <button className="icon-btn danger" title="Excluir" aria-label={`Excluir ${attachment.filename}`} onClick={() => void remove(file)}>
                    <Icon name="trash" size={16} />
                  </button>
                )}
              </span>
            </div>
          );
        })}
        {entry?.hasMore && (
          <button className="btn btn-ghost files-more" disabled={entry.loading} onClick={() => void loadMessages(accountId, channel.id, true)}>
            {entry.loading ? "Carregando…" : "Carregar mais antigos"}
          </button>
        )}
      </div>

      {dragging && (
        <div className="files-drop" aria-hidden>
          <Icon name="upload" size={36} />
          <strong>Solte para compartilhar em #{channel.name}</strong>
        </div>
      )}
      {image !== null && image >= 0 && (
        <Suspense fallback={null}>
          <ImageViewer images={images} initialIndex={image} onClose={() => setImage(null)} />
        </Suspense>
      )}
      {media && (
        <Suspense fallback={null}>
          <MediaViewer media={media} onClose={() => setMedia(null)} />
        </Suspense>
      )}
    </section>
  );
}
