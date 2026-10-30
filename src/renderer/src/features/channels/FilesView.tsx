import { has, LIMITS, Permission, type Attachment, type Channel, type ChannelFilePage, type Message, type ServerState } from "@distopic/protocol";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { apiFor } from "../../client.ts";
import { RequestError } from "../../api.ts";
import { formatDay, formatSize } from "../../format.tsx";
import { displayNameOf } from "../../perms.ts";
import { toast, useStore } from "../../store.ts";
import { act, Icon, type IconName } from "../../components/ui.tsx";
import { confirmAction } from "../../components/ui/action-dialog.tsx";
import { Select } from "../../components/ui/select.tsx";
import { readChatDraft, writeChatDraft } from "../../chat-state.ts";
import { useRequestOwner } from "../../lib/use-request-owner.ts";
import { isCancellation } from "../../../../shared/requests.ts";
import { onRoomEvent } from "./events.ts";

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
  const me = useStore((s) => s.instances[accountId]?.user?.id ?? "");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState(() => readChatDraft(accountId, channel.id).text);
  const [image, setImage] = useState<number | null>(null);
  const [media, setMedia] = useState<{ url: string; filename: string; contentType: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const fileRequest = useRef<AbortController | null>(null);
  const uploadControllers = useRef(new Set<AbortController>());
  const requests = useRequestOwner(JSON.stringify([accountId, channel.id]));
  const api = apiFor(accountId);
  const canUpload = has(perms, Permission.SEND_MESSAGES) && has(perms, Permission.ATTACH_FILES);
  const canModerate = has(perms, Permission.MANAGE_MESSAGES);
  const names = useMemo(() => new Map(state.members.map((m) => [m.user.id, displayNameOf(m)])), [state.members]);

  const fetchFiles = useCallback(async (offset = 0, append = false) => {
    fileRequest.current?.abort();
    const controller = new AbortController();
    fileRequest.current = controller;
    const signal = AbortSignal.any([controller.signal, requests.signal]);
    setLoadingFiles(true);
    setFilesError(null);
    const search = new URLSearchParams({ limit: "50", offset: String(offset), q: query.trim(), sort });
    try {
      const page = await api.get<ChannelFilePage>(`/channels/${encodeURIComponent(channel.id)}/files?${search}`, signal);
      if (signal.aborted || fileRequest.current !== controller) return;
      setFiles((current) => append ? [...current, ...page.files] : page.files);
      setNextOffset(page.nextOffset);
      setTotal(page.total);
    } catch (error) {
      if (!signal.aborted && !isCancellation(error)) setFilesError(error instanceof RequestError && error.status === 404
        ? "Esta instância ainda não oferece busca paginada de arquivos. Atualize o servidor para pesquisar e ordenar o acervo completo."
        : (error as Error).message);
    } finally {
      if (!signal.aborted && fileRequest.current === controller) setLoadingFiles(false);
    }
  }, [api, channel.id, query, sort, requests]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      fileRequest.current?.abort();
      for (const controller of uploadControllers.current) controller.abort();
      uploadControllers.current.clear();
    };
  }, [accountId, channel.id]);

  useEffect(() => {
    const timer = setTimeout(() => void fetchFiles(), query.trim() ? 220 : 0);
    return () => { clearTimeout(timer); fileRequest.current?.abort(); };
  }, [fetchFiles, query, sort]);

  useEffect(() => onRoomEvent(accountId, channel.id, (event) => {
    if (event.t === "MESSAGE_CREATE" || event.t === "MESSAGE_UPDATE" || event.t === "MESSAGE_DELETE") void fetchFiles();
  }), [accountId, channel.id, fetchFiles]);
  const images = files
    .filter((f) => f.attachment.contentType.startsWith("image/"))
    .map((f) => ({ id: f.attachment.id, url: api.resolve(f.attachment.url), filename: f.attachment.filename, size: f.attachment.size }));
  const totalSize = files.reduce((sum, f) => sum + f.attachment.size, 0);

  const upload = async (list: File[]) => {
    if (!canUpload) return toast("Sem permissão para enviar arquivos aqui");
    const description = note.trim();
    let allSucceeded = true;
    // The server takes a limited number of files per message.
    for (let i = 0; i < list.length; i += LIMITS.attachmentsPerMessage) {
      if (!mounted.current) break;
      const batch = list.slice(i, i + LIMITS.attachmentsPerMessage);
      const job: Upload = { id: ++uploadSeq, names: batch.map((f) => f.name).join(", "), progress: 0, error: null, abort: new AbortController() };
      uploadControllers.current.add(job.abort);
      setUploads((u) => [...u, job]);
      const update = (patch: Partial<Upload>) => { if (mounted.current) setUploads((u) => u.map((x) => (x.id === job.id ? { ...x, ...patch } : x))); };
      try {
        await api.uploadMessage(channel.id, i === 0 ? description : "", batch, (progress) => update({ progress }), job.abort.signal);
        if (mounted.current) setUploads((u) => u.filter((x) => x.id !== job.id));
      } catch (err) {
        allSucceeded = false;
        if ((err as Error).name === "AbortError") { if (mounted.current) setUploads((u) => u.filter((x) => x.id !== job.id)); }
        else update({ error: (err as Error).message });
      } finally {
        uploadControllers.current.delete(job.abort);
      }
    }
    if (allSucceeded && mounted.current) {
      setNote("");
      writeChatDraft(accountId, channel.id, { ...readChatDraft(accountId, channel.id), text: "", replyToId: null, attachmentCount: 0 });
      void fetchFiles();
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
    if (ok) void act(api.del(`/channels/${channel.id}/messages/${file.message.id}`)).then((done) => { if (done) void fetchFiles(); });
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
        <span className="chat-topic">{channel.topic || `${files.length} de ${total} arquivo(s) · ${formatSize(totalSize)} carregados`}</span>
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
            <input className="files-note" value={note} onChange={(e) => { setNote(e.target.value); writeChatDraft(accountId, channel.id, { ...readChatDraft(accountId, channel.id), text: e.target.value, replyToId: null, attachmentCount: 0 }); }} placeholder="Descrição (opcional)" maxLength={LIMITS.messageMax} />
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
        {loadingFiles && files.length === 0 && !filesError && <div className="files-loading" role="status"><span /><span /><span /><span /><span /></div>}
        {filesError && <div className="files-load-error" role="alert"><Icon name="wifiOff" size={22} /><strong>Não foi possível carregar os arquivos</strong><span>{filesError}</span><button className="btn btn-ghost" onClick={() => void fetchFiles()}>Tentar novamente</button></div>}
        {files.length === 0 && !loadingFiles && !filesError && (
          <div className="files-empty">
            <Icon name="folderOpen" size={40} />
            <h2>{query ? "Nada encontrado" : "Nenhum arquivo ainda"}</h2>
            <p className="muted">{query ? "Nenhum arquivo do canal corresponde à busca. Experimente outros termos." : canUpload ? "Arraste arquivos para cá ou use Enviar arquivos." : "Quando alguém compartilhar, os arquivos aparecem aqui."}</p>
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
        {nextOffset !== null && (
          <button className="btn btn-ghost files-more" disabled={loadingFiles} onClick={() => void fetchFiles(nextOffset, true)}>
            {loadingFiles ? "Carregando…" : `Carregar mais arquivos (${Math.max(0, total - files.length)} restantes)`}
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
