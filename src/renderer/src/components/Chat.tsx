import { LIMITS, type Message } from "@distopic/protocol";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { apiFor, loadMessages, sendTyping } from "../client.ts";
import { formatClock, formatDay, formatSize, formatTime, previewText, renderContent, type NameOf } from "../format.tsx";
import { useStore } from "../store.ts";
import { act, Avatar, Icon, type IconName } from "./ui.tsx";

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
  return (
    <div className="attachments">
      {message.attachments.map((a) =>
        /^image\/(png|jpeg|gif|webp)$/.test(a.contentType) ? (
          <a key={a.id} href={api.resolve(a.url)} target="_blank" rel="noreferrer" className="attachment-image">
            <img src={api.resolve(a.url)} alt={a.filename} loading="lazy" />
          </a>
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
  onReply: (m: Message) => void;
}) {
  const [editing, setEditing] = useState(false);
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

  const remove = () => {
    if (confirm("Excluir esta mensagem?")) void act(apiFor(accountId).del(`/channels/${message.channelId}/messages/${message.id}`));
  };

  return (
    <div className={`message${compact ? " compact" : ""}${mentioned ? " mentioned" : ""}`}>
      {message.replyToId && (
        <div className="reply-ref">
          <Icon name="reply" size={12} />
          {replyTo ? (
            <>
              <strong>{nameOf(replyTo.author.id) ?? replyTo.author.displayName}</strong>
              <span className="truncate">{previewText(replyTo.content, nameOf, channelOf) || "anexo"}</span>
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
              <span className="message-author">{name}</span>
            </div>
          )}
          {editing ? (
            <div className="edit-box">
              <textarea
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
          {message.attachments.length > 0 && <Attachments accountId={accountId} message={message} />}
        </div>
      </div>
      {!editing && (
        <div className="message-actions">
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
  const text = names.length === 1 ? `${names[0]} está digitando…` : names.length <= 3 ? `${names.join(", ")} estão digitando…` : "Várias pessoas estão digitando…";
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

  const addFiles = (list: FileList | File[]) => {
    if (!canAttach) return;
    setFiles((f) => [...f, ...Array.from(list)].slice(0, LIMITS.attachmentsPerMessage));
  };
  dropRef.current = addFiles;

  const send = async () => {
    // Longest names first so "@Ana Maria" wins over "@Ana".
    let content = text;
    for (const m of [...picked].sort((a, b) => b.name.length - a.name.length)) content = content.split(`@${m.name}`).join(`<@${m.id}>`);
    content = content.trim();
    if ((!content && files.length === 0) || sending) return;
    setSending(true);
    try {
      await apiFor(accountId).sendMessage(channelId, content, files, replyTo?.id ?? null);
      setText("");
      setFiles([]);
      setPicked([]);
      clearReply();
    } catch (err) {
      alert((err as Error).message);
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
            <span key={`${f.name}-${i}`} className="pending-file">
              <Icon name="paperclip" size={14} />
              <span className="truncate">{f.name}</span>
              <span className="muted">{formatSize(f.size)}</span>
              <button className="icon-btn tiny" onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}>
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="composer">
        {canAttach && (
          <>
            <button className="icon-btn" title="Anexar arquivo" onClick={() => fileInput.current?.click()}>
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
        <textarea
          ref={input}
          rows={1}
          value={text}
          maxLength={LIMITS.messageMax}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            updateQuery(e.target.value, e.target.selectionStart);
            if (e.target.value) sendTyping(accountId, channelId);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => setQuery(null)}
        />
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
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 200 && entry?.hasMore && !entry.loading) {
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
      <div className="messages" ref={scroller} onScroll={onScroll}>
        {entry && !entry.hasMore && (
          <div className="channel-start">
            <h2>Início de {props.icon === "hash" ? `#${props.title}` : props.title}</h2>
            <p className="muted">Este é o começo da conversa.</p>
          </div>
        )}
        {entry?.loading && <div className="loading small">Carregando…</div>}
        {items.map((m, i) => {
          const prev = items[i - 1];
          const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
          const compact =
            !newDay && !!prev && !m.replyToId && prev.author.id === m.author.id && Date.parse(m.createdAt) - Date.parse(prev.createdAt) < GROUP_WINDOW_MS;
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
              onReply={setReplyTo}
            />
            </Fragment>
          );
        })}
      </div>
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
