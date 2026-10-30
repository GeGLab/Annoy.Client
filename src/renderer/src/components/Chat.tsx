import { REACTION_SHORTCUTS, ReactionChips } from "../features/expression/MessageReactions.tsx";
import { EmojiMenu, MediaPicker } from "../features/expression/MediaPicker.tsx";
import { GiphyMessage } from "../features/expression/giphy.tsx";
import { confirmAction } from "./ui/action-dialog.tsx";
import { LIMITS, type Message } from "@distopic/protocol";
import {
  Fragment,
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { apiFor, loadMessages, returnToLatest, sendTyping } from "../client.ts";
import { formatClock, formatDay, formatSize, formatTime, renderContent, type NameOf } from "../format.tsx";
import { toast, getState, setState, useStore } from "../store.ts";
import { act, Avatar, Icon, type IconName } from "./ui.tsx";
import { ChatSkeleton } from "./ui/skeleton.tsx";
import { ConnectionNotice } from "./ConnectionOverlay.tsx";
import { Button } from "./ui/button.tsx";
import { Textarea } from "./ui/textarea.tsx";
import { notificationKey } from "../lib/notification-preferences.ts";
import { UserProfile } from "./UserProfile.tsx";
import { useRequestOwner } from "../lib/use-request-owner.ts";
import { isCancellation } from "../../../shared/requests.ts";

function PendingFile({ file, onRemove, disabled }: { file: File; onRemove: () => void; disabled: boolean }) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  const media = /^(image|video|audio)\//.test(file.type);
  useEffect(() => {
    if (!media) return;
    const source = URL.createObjectURL(file);
    setUrl(source);
    return () => URL.revokeObjectURL(source);
  }, [file, media]);
  return (
    <div className="pending-file">
      {media && !failed ? (
        <div className="pending-preview">
          {file.type.startsWith("image/") ? <img src={url} alt={`Prévia de ${file.name}`} onError={() => setFailed(true)} />
            : file.type.startsWith("video/") ? <video src={url} controls muted playsInline preload="metadata" aria-label={`Prévia de ${file.name}`} onError={() => setFailed(true)} />
            : <><Icon name="music" size={24} /><audio src={url} controls preload="metadata" aria-label={`Prévia de ${file.name}`} onError={() => setFailed(true)} /></>}
        </div>
      ) : <div className="pending-preview pending-preview-file"><Icon name="paperclip" size={24} /><span>{failed ? "Prévia indisponível" : "Arquivo anexado"}</span></div>}
      <div className="pending-file-details">
        <span className="truncate" title={file.name}>{file.name}</span>
        <span className="pending-file-size">{formatSize(file.size)}</span>
        <button className="icon-btn tiny" disabled={disabled} onClick={onRemove} aria-label={`Remover ${file.name}`}><Icon name="x" size={14} /></button>
      </div>
    </div>
  );
}

const ImageViewer = lazy(() => import("./ImageViewer.tsx"));
const MediaViewer = lazy(() => import("./MediaViewer.tsx"));
const isImage = (type: string) => /^image\/(png|jpe?g|gif|webp|avif)$/i.test(type);

const GROUP_WINDOW_MS = 7 * 60_000;
const EMPTY: Message[] = [];

export interface Mentionable {
  id: string;
  name: string;
  username: string;
}

interface ChatProps {
  accountId: string;
  channelId: string;
  title: string;
  icon: IconName | null;
  topic?: string;
  canSend: boolean;
  canAttach: boolean;
  canModerate: boolean;
  nameOf: NameOf;
  /** Resolves <#channel> mentions; DMs have none. */
  channelOf?: NameOf;
  mentionables: Mentionable[];
  headerExtra?: ReactNode;
}

function Attachments({ accountId, message }: { accountId: string; message: Message }) {
  const api = apiFor(accountId);
  const [opened, setOpened] = useState<number | null>(null);
  const [media, setMedia] = useState<{ url: string; filename: string; contentType: string } | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const images = message.attachments
    .filter((a) => isImage(a.contentType))
    .map((a) => ({ id: a.id, url: api.resolve(a.url), filename: a.filename, size: a.size }));
  return (
    <div className="attachments">
      {message.attachments.map((a) =>
        isImage(a.contentType) ? (
          <button
            key={a.id}
            type="button"
            className="attachment-image"
            aria-label={`Visualizar ${a.filename}`}
            onClick={(e) => {
              opener.current = e.currentTarget;
              setOpened(images.findIndex((image) => image.id === a.id));
            }}
          >
            <img src={api.resolve(a.url)} alt={a.filename} loading="lazy" decoding="async" />
            <span className="attachment-expand">
              <Icon name="maximize" size={16} />
            </span>
          </button>
        ) : /^(audio|video)\//.test(a.contentType) ? (
          <button
            key={a.id}
            className="attachment-media"
            onClick={(event) => {
              opener.current = event.currentTarget;
              setMedia({ url: api.resolve(a.url), filename: a.filename, contentType: a.contentType });
            }}
            aria-label={`Reproduzir ${a.filename}`}
          >
            <span className="attachment-play">
              <Icon name="play" size={21} />
            </span>
            <span>
              <strong>{a.filename}</strong>
              <small>
                {a.contentType.startsWith("video/") ? "Vídeo" : "Áudio"} · {formatSize(a.size)}
              </small>
            </span>
            <Icon name={a.contentType.startsWith("video/") ? "film" : "music"} size={22} />
          </button>
        ) : (
          <a key={a.id} href={api.resolve(a.url)} target="_blank" rel="noreferrer" className="attachment-file">
            <Icon name="paperclip" size={20} />
            <span>
              <span className="attachment-name">{a.filename}</span>
              <span className="muted">{formatSize(a.size)}</span>
            </span>
          </a>
        ),
      )}
      {opened !== null && (
        <Suspense
          fallback={
            <div className="overlay-loading" role="status">
              Abrindo imagem…
            </div>
          }
        >
          <ImageViewer
            images={images}
            initialIndex={opened}
            onClose={() => {
              setOpened(null);
              requestAnimationFrame(() => opener.current?.focus());
            }}
          />
        </Suspense>
      )}
      {media && (
        <Suspense
          fallback={
            <div className="overlay-loading" role="status">
              Abrindo player…
            </div>
          }
        >
          <MediaViewer
            media={media}
            onClose={() => {
              setMedia(null);
              requestAnimationFrame(() => opener.current?.focus());
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

function MessageRow({
  accountId,
  message,
  compact,
  me,
  replyTo,
  nameOf,
  channelOf,
  canModerate,
  canReact,
  onReply,
}: {
  accountId: string;
  message: Message;
  compact: boolean;
  me: string;
  replyTo: Message | null | undefined;
  nameOf: NameOf;
  channelOf: NameOf | undefined;
  canModerate: boolean;
  canReact: boolean;
  onReply: (m: Message) => void;
}) {
  const reactionsEnabled = useStore((s) => s.instances[accountId]?.instance?.reactions === true);
  const [reacting, setReacting] = useState(false);
  const react = async (emoji: string) => {
    if (reacting || !reactionsEnabled || !canReact) return;
    setReacting(true);
    try {
      const path = `/channels/${message.channelId}/messages/${message.id}/reactions/${encodeURIComponent(emoji)}`;
      const exists = message.reactions?.some((reaction) => reaction.emoji === emoji && reaction.userIds.includes(me));
      const updated = exists ? await apiFor(accountId).del<Message>(path) : await apiFor(accountId).put<Message>(path);
      const latest = getState().instances[accountId]?.messages[message.channelId]?.items.find((item) => item.id === message.id);
      // A newer gateway update may already include reactions from another person.
      if (latest?.reactions === message.reactions) setState((s) => {
        const current = s.instances[accountId]?.messages[message.channelId]?.items.find((item) => item.id === message.id);
        if (current) current.reactions = updated.reactions ?? [];
      });
    } catch (error) { toast((error as Error).message); }
    finally { setReacting(false); }
  };
  const [editing, setEditing] = useState(false);
  const recent = useStore((s) => s.recentMessages[notificationKey(accountId, message.id)]);
  const arrival = recent && Date.now() - recent.at < 4000 ? (recent.own ? " message-sent" : " message-received") : "";
  const [draft, setDraft] = useState(message.content);
  const own = message.author.id === me;
  const mentioned = message.mentionsEveryone || message.mentionIds.includes(me);
  const name = nameOf(message.author.id) ?? message.author.displayName;

  const save = async () => {
    const content = draft.trim();
    if (content && content !== message.content) {
      const ok = await act(apiFor(accountId).patch(`/channels/${message.channelId}/messages/${message.id}`, { content }));
      if (!ok) return;
    }
    setEditing(false);
  };

  const remove = async () => {
    if (await confirmAction("Excluir esta mensagem?"))
      void act(apiFor(accountId).del(`/channels/${message.channelId}/messages/${message.id}`));
  };

  return (
    <div data-message-id={message.id} className={`message${arrival}${compact ? " compact" : ""}${mentioned ? " mentioned" : ""}`}>
      {message.replyToId && (
        <div className="reply-ref">
          <Icon name="reply" size={12} />
          {replyTo ? (
            <>
              <strong>{nameOf(replyTo.author.id) ?? replyTo.author.displayName}</strong>
              <span className="truncate">{replyTo.content || "anexo"}</span>
            </>
          ) : (
            <span className="muted">mensagem original não carregada</span>
          )}
        </div>
      )}
      <div className="message-main">
        <time className="message-stamp" dateTime={message.createdAt} title={formatTime(message.createdAt)}>
          {formatClock(message.createdAt)}
        </time>
        <div className="message-body">
          {!compact && (
            <div className="message-head">
              <Avatar user={message.author} size={22} />
              <UserProfile accountId={accountId} user={message.author}><span className="message-author">{name}</span></UserProfile>
            </div>
          )}
          {editing ? (
            <div className="edit-box">
              <Textarea
                autoFocus
                value={draft}
                maxLength={LIMITS.messageMax}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void save();
                  } else if (e.key === "Escape") setEditing(false);
                }}
              />
              <span className="muted small">Esc para cancelar · Enter para salvar</span>
            </div>
          ) : (
            message.content && (
              <div className="message-content">
                {renderContent(message.content, nameOf, me, channelOf)}
                {message.editedAt && <span className="edited"> (editado)</span>}
              </div>
            )
          )}
          <GiphyMessage accountId={accountId} content={message.content} />
          {message.attachments.length > 0 && <Attachments accountId={accountId} message={message} />}
          <ReactionChips reactions={message.reactions ?? []} me={me} nameOf={nameOf} disabled={reacting || !reactionsEnabled || !canReact} onToggle={(emoji) => void react(emoji)} />
        </div>
      </div>
      {!editing && (
        <div className="message-actions">
          {reactionsEnabled && canReact && <>
            <div className="reaction-shortcuts" aria-label="Reações rápidas">{REACTION_SHORTCUTS.map((emoji) => <button key={emoji} className="reaction-quick" aria-label={`Reagir com ${emoji}`} aria-pressed={message.reactions?.some((reaction) => reaction.emoji === emoji && reaction.userIds.includes(me)) ?? false} title={`Reagir com ${emoji}`} disabled={reacting} onClick={() => void react(emoji)}>{emoji}</button>)}</div>
            <EmojiMenu disabled={reacting} onSelect={(emoji) => void react(emoji)} />
            <span className="message-action-divider" aria-hidden="true" />
          </>}
          {!reactionsEnabled && canReact && <button className="icon-btn tiny" aria-label="Adicionar reação" title="Atualize o Annoy Server para habilitar reações compartilhadas" onClick={() => toast("Esta instância ainda não oferece reações. Atualize o Annoy Server e reconecte o Client para reagir às mensagens.")}><Icon name="smile" size={16} /></button>}
          <button className="icon-btn tiny" title="Responder" onClick={() => onReply(message)}>
            <Icon name="reply" size={16} />
          </button>
          {own && (
            <button
              className="icon-btn tiny"
              title="Editar"
              onClick={() => {
                setDraft(message.content);
                setEditing(true);
              }}
            >
              <Icon name="edit" size={16} />
            </button>
          )}
          {(own || canModerate) && (
            <button className="icon-btn tiny danger" title="Excluir" onClick={remove}>
              <Icon name="trash" size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function TypingLine({ accountId, channelId, me, nameOf }: { accountId: string; channelId: string; me: string; nameOf: NameOf }) {
  const typing = useStore((s) => s.instances[accountId]?.typing[channelId]);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const now = Date.now();
  const names = Object.entries(typing ?? {})
    .filter(([id, until]) => id !== me && until > now)
    .map(([id]) => nameOf(id) ?? "Alguém");
  if (names.length === 0) return <div className="typing" />;
  const text =
    names.length === 1
      ? `${names[0]} está digitando…`
      : names.length <= 3
        ? `${names.join(", ")} estão digitando…`
        : "Várias pessoas estão digitando…";
  return <div className="typing">{text}</div>;
}

function Composer({
  dropRef,
  accountId,
  channelId,
  placeholder,
  canSend,
  canAttach,
  mentionables,
  replyTo,
  clearReply,
  nameOf,
}: {
  dropRef: RefObject<((files: FileList) => void) | null>;
  accountId: string;
  channelId: string;
  placeholder: string;
  canSend: boolean;
  canAttach: boolean;
  mentionables: Mentionable[];
  replyTo: Message | null;
  clearReply: () => void;
  nameOf: NameOf;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const requests = useRequestOwner(JSON.stringify([accountId, channelId]));
  const connected = useStore((s) => s.instances[accountId]?.status === "ready");
  const [picked, setPicked] = useState<Mentionable[]>([]);
  const [query, setQuery] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (replyTo) input.current?.focus();
  }, [replyTo]);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const suggestions = useMemo(() => {
    if (query === null) return [];
    const q = query.toLowerCase();
    return mentionables.filter((m) => m.name.toLowerCase().includes(q) || m.username.toLowerCase().includes(q)).slice(0, 8);
  }, [query, mentionables]);

  const updateQuery = (value: string, caret: number) => {
    const match = /(?:^|\s)@([^\s@]{0,32})$/.exec(value.slice(0, caret));
    setQuery(match ? match[1]! : null);
    setSel(0);
  };

  const pick = (m: Mentionable) => {
    const el = input.current;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([^\s@]{0,32})$/, `@${m.name} `);
    setText(before + text.slice(caret));
    setPicked((p) => (p.some((x) => x.id === m.id) ? p : [...p, m]));
    setQuery(null);
    requestAnimationFrame(() => el?.setSelectionRange(before.length, before.length));
  };

  const insertExpression = (value: string) => {
    const element = input.current, start = element?.selectionStart ?? text.length, end = element?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + value + text.slice(end);
    if (next.length > LIMITS.messageMax) return toast("A mensagem atingiu o limite de caracteres.");
    setText(next);
    requestAnimationFrame(() => { element?.focus(); element?.setSelectionRange(start + value.length, start + value.length); });
  };
  const addFiles = (list: FileList | File[]) => {
    if (!canAttach || !connected) return;
    setFiles((f) => [...f, ...Array.from(list)].slice(0, LIMITS.attachmentsPerMessage));
  };
  dropRef.current = addFiles;

  const send = async () => {
    if (!connected) return;
    // Longest names first so "@Ana Maria" wins over "@Ana".
    let content = text;
    for (const m of [...picked].sort((a, b) => b.name.length - a.name.length)) content = content.split(`@${m.name}`).join(`<@${m.id}>`);
    content = content.trim();
    if ((!content && files.length === 0) || sending) return;
    setSending(true);
    const signal = requests.signal;
    try {
      await apiFor(accountId).sendMessage(channelId, content, files, replyTo?.id ?? null, signal);
      signal.throwIfAborted();
      setText("");
      setFiles([]);
      setPicked([]);
      clearReply();
    } catch (err) {
      if (!isCancellation(err)) toast((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSel((i) => (i + (e.key === "ArrowDown" ? 1 : suggestions.length - 1)) % suggestions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(suggestions[sel]!);
        return;
      }
      if (e.key === "Escape") return setQuery(null);
    }
    if (e.key === "Escape" && replyTo) return clearReply();
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const onPaste = (e: ClipboardEvent) => {
    if (e.clipboardData.files.length > 0) {
      e.preventDefault();
      addFiles(e.clipboardData.files);
    }
  };

  if (!canSend) return <div className="composer composer-locked">Você não tem permissão para enviar mensagens neste canal.</div>;

  return (
    <div className="composer-wrap">
      {suggestions.length > 0 && (
        <div className="suggestions">
          <div className="section-label">Membros</div>
          {suggestions.map((m, i) => (
            <button key={m.id} className={i === sel ? "active" : ""} onMouseDown={(e) => (e.preventDefault(), pick(m))}>
              <strong>{m.name}</strong> <span className="muted">@{m.username}</span>
            </button>
          ))}
        </div>
      )}
      {replyTo && (
        <div className="reply-bar">
          Respondendo a <strong>{nameOf(replyTo.author.id) ?? replyTo.author.displayName}</strong>
          <button className="icon-btn tiny" onClick={clearReply} title="Cancelar resposta">
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
      {files.length > 0 && (
        <div className="pending-files">
          {files.map((f, i) => (
            <PendingFile key={`${f.name}-${f.lastModified}-${i}`} file={f} disabled={sending} onRemove={() => setFiles((list) => list.filter((_, j) => j !== i))} />
          ))}
        </div>
      )}
      <div className="composer">
        {canAttach && (
          <>
            <button className="icon-btn" disabled={!connected} title="Anexar arquivo" onClick={() => fileInput.current?.click()}>
              <Icon name="plus" size={20} />
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </>
        )}
        <Textarea
          ref={input}
          aria-label={placeholder}
          rows={1}
          value={text}
          maxLength={LIMITS.messageMax}
          placeholder={connected ? placeholder : "Sem conexão com o servidor"}
          disabled={!connected}
          onChange={(e) => {
            setText(e.target.value);
            updateQuery(e.target.value, e.target.selectionStart);
            if (e.target.value) sendTyping(accountId, channelId);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => setQuery(null)}
        />
        <MediaPicker accountId={accountId} canAttach={canAttach} disabled={sending || !connected} onEmoji={insertExpression} onFile={(file) => addFiles([file])} onLink={(link) => insertExpression(`${text.trim() ? " " : ""}${link}`)} />
        <Button
          variant="ghost"
          size="icon"
          className="composer-send"
          loading={sending}
          disabled={!connected || sending || (!text.trim() && files.length === 0)}
          onClick={() => void send()}
          aria-label="Enviar mensagem"
        >
          <Icon name="send" size={19} />
        </Button>
      </div>
    </div>
  );
}

export function Chat(props: ChatProps) {
  const { accountId, channelId, nameOf } = props;
  const entry = useStore((s) => s.instances[accountId]?.messages[channelId]);
  const me = useStore((s) => s.instances[accountId]?.user?.id ?? "");
  const items = entry?.items ?? EMPTY;
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [dragging, setDragging] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const prevHeight = useRef<number | null>(null);
  const firstId = items[0]?.id;
  const navigation = useStore((s) => s.chatNavigation);
  const focus = useStore((s) =>
    s.messageFocus?.accountId === accountId && s.messageFocus.channelId === channelId ? s.messageFocus : null,
  );
  const messageLog = useRef<HTMLDivElement>(null);
  const lastTop = useRef(0);
  useLayoutEffect(() => {
    if (!focus) return;
    pinned.current = false;
    const row = scroller.current?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(focus.messageId)}"]`);
    row?.scrollIntoView({ block: "center" });
    row?.classList.add("search-highlight");
    return () => row?.classList.remove("search-highlight");
  }, [focus, items]);

  useLayoutEffect(() => {
    pinned.current = !focus;
    prevHeight.current = null;
    const el = scroller.current;
    if (el && !focus) {
      el.scrollTop = el.scrollHeight;
      lastTop.current = el.scrollTop;
    }
  }, [accountId, channelId, navigation]);

  // Images can grow after the message list mounts. Follow that growth only
  // while the reader remains at the latest message, never while reading back.
  useEffect(() => {
    if (!messageLog.current) return;
    const observer = new ResizeObserver(() => {
      const el = scroller.current;
      if (el && pinned.current && prevHeight.current === null) {
        el.scrollTop = el.scrollHeight;
        lastTop.current = el.scrollTop;
      }
    });
    observer.observe(messageLog.current);
    if (scroller.current) observer.observe(scroller.current);
    return () => observer.disconnect();
  }, [accountId, channelId]);

  useEffect(() => {
    void loadMessages(accountId, channelId);
  }, [accountId, channelId]);

  // Keep the view pinned to the bottom for new messages, and steady when older ones load above.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prevHeight.current !== null) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
      prevHeight.current = null;
    } else if (pinned.current) el.scrollTop = el.scrollHeight;
  }, [items, firstId]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    if (el.scrollTop < lastTop.current - 1) pinned.current = false;
    else if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) pinned.current = true;
    lastTop.current = el.scrollTop;
    if (el.scrollTop < 200 && entry?.hasMore && !entry.loading && !entry.error) {
      prevHeight.current = el.scrollHeight;
      void loadMessages(accountId, channelId, true);
    }
  };

  const byId = useMemo(() => new Map(items.map((m) => [m.id, m])), [items]);

  const dropTarget = useRef<((files: FileList) => void) | null>(null);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (props.canAttach && e.dataTransfer.files.length) dropTarget.current?.(e.dataTransfer.files);
  };

  return (
    <section
      className="chat"
      onDragOver={(e) => {
        if (props.canAttach && e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      <header className="chat-header">
        {props.icon && <Icon name={props.icon} size={20} />}
        <h1 className="truncate">{props.title}</h1>
        {props.topic && <span className="chat-topic truncate">{props.topic}</span>}
        <span className="spacer" />
        {props.headerExtra}
      </header>
      <ConnectionNotice accountId={accountId} />
      <div className="messages" ref={scroller} onScroll={onScroll}>
        <div ref={messageLog} className="message-log">
          {entry && !entry.hasMore && (
            <div className="channel-start">
              <h2>Início de {props.icon === "hash" ? `#${props.title}` : props.title}</h2>
              <p className="muted">Este é o começo da conversa.</p>
            </div>
          )}
          {entry?.loading &&
            (items.length === 0 ? (
              <ChatSkeleton />
            ) : (
              <div className="loading small" role="status">
                Carregando mensagens anteriores…
              </div>
            ))}
          {entry?.error && <div className="history-error" role="alert">
            <p>{entry.error}</p>
            <button className="btn btn-ghost" onClick={() => void loadMessages(accountId, channelId, items.length > 0)}>Tentar carregar mensagens novamente</button>
          </div>}
          {items.map((m, i) => {
            const prev = items[i - 1];
            const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
            const compact =
              !newDay &&
              !!prev &&
              !m.replyToId &&
              prev.author.id === m.author.id &&
              Date.parse(m.createdAt) - Date.parse(prev.createdAt) < GROUP_WINDOW_MS;
            return (
              <Fragment key={m.id}>
                {newDay && (
                  <div className="day-divider" role="separator">
                    <span>{formatDay(m.createdAt)}</span>
                  </div>
                )}
                <MessageRow
                  accountId={accountId}
                  message={m}
                  compact={compact}
                  me={me}
                  replyTo={m.replyToId ? byId.get(m.replyToId) : undefined}
                  nameOf={nameOf}
                  channelOf={props.channelOf}
                  canModerate={props.canModerate}
                  canReact={props.canSend}
                  onReply={setReplyTo}
                />
              </Fragment>
            );
          })}
        </div>
      </div>
      {focus && (
        <button className="return-latest" onClick={() => returnToLatest(accountId, channelId)}>
          Você está vendo uma mensagem da busca · Voltar às mais recentes
        </button>
      )}
      <Composer
        dropRef={dropTarget}
        accountId={accountId}
        channelId={channelId}
        placeholder={`Conversar em ${props.icon === "hash" ? "#" : ""}${props.title}`}
        canSend={props.canSend}
        canAttach={props.canAttach}
        mentionables={props.mentionables}
        replyTo={replyTo}
        clearReply={() => setReplyTo(null)}
        nameOf={nameOf}
      />
      <TypingLine accountId={accountId} channelId={channelId} me={me} nameOf={nameOf} />
      {dragging && <div className="drop-overlay">Solte para anexar</div>}
    </section>
  );
}
