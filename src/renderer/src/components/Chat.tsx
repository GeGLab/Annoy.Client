import {rich} from "../lib/localization.ts";
import {localizationPreferences} from "../../../shared/localization/index.ts";
import {t as translate,counted} from "../../../shared/localization/index.ts";
import { SecureAttachment } from "./SecureAttachment.tsx";
import { REACTION_SHORTCUTS, ReactionChips } from "../features/expression/MessageReactions.tsx";
import { EmojiMenu, MediaPicker } from "../features/expression/MediaPicker.tsx";
import { GiphyMessage } from "../features/expression/giphy.tsx";
import { isStickerMessage, StickerMessage } from "../features/expression/AnnoySticker.tsx";
import { confirmAction } from "./ui/action-dialog.tsx";
import { LIMITS, type Message } from "@distopic/protocol";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
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
  type UIEvent,
} from "react";
import { apiFor, jumpToMessage, loadMessages, loadPinnedMessages, markChannelRead, returnToLatest, sendTyping } from "../client.ts";
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
import { isCancellation, RequestError } from "../../../shared/requests.ts";
import { draftKey, readChatDraft, readPendingFiles, writeChatDraft, writePendingFiles, readChatAnchor, writeChatAnchor, clearChatAnchor, flushChatState, type ChatDraft } from "../chat-state.ts";

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
          {file.type.startsWith("image/") ? <img src={url} alt={translate("chat.2cefb830f434",{p0:(file.name)})} onError={() => setFailed(true)} />
            : file.type.startsWith("video/") ? <video src={url} controls muted playsInline preload="metadata" aria-label={translate("chat.2cefb830f434",{p0:(file.name)})} onError={() => setFailed(true)} />
            : <><Icon name="music" size={24} /><audio src={url} controls preload="metadata" aria-label={translate("chat.2cefb830f434",{p0:(file.name)})} onError={() => setFailed(true)} /></>}
        </div>
      ) : <div className="pending-preview pending-preview-file"><Icon name="paperclip" size={24} /><span>{failed ? translate("chat.03d8e08e0311") : translate("chat.f9c6a1bb7ec8")}</span></div>}
      <div className="pending-file-details">
        <span className="truncate" title={file.name}>{file.name}</span>
        <span className="pending-file-size">{formatSize(file.size)}</span>
        <button className="icon-btn tiny" disabled={disabled} onClick={onRemove} aria-label={translate("expression.82e85db7347e",{p0:(file.name)})}><Icon name="x" size={14} /></button>
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
  canPin?: boolean;
  serverId?: string | null;
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
        a.url.startsWith("/api/uploads/") ? <SecureAttachment key={a.id} accountId={accountId} message={message} file={a}/> : isImage(a.contentType) ? (
          <button
            key={a.id}
            type="button"
            className="attachment-image"
            aria-label={translate("chat.5ed9aabafd14",{p0:(a.filename)})}
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
            aria-label={translate("chat.537a5bf35fe2",{p0:(a.filename)})}
          >
            <span className="attachment-play">
              <Icon name="play" size={21} />
            </span>
            <span>
              <strong>{a.filename}</strong>
              <small>
                {a.contentType.startsWith("video/") ? translate("common.bc10c86c24b5") : translate("common.195c60bb2325")} · {formatSize(a.size)}
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
            <div className="overlay-loading" role="status">{translate("chat.5552db7880c0")}</div>
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
            <div className="overlay-loading" role="status">{translate("chat.5754e4c79e50")}</div>
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
  canPin = canModerate,
  canReact,
  highlighted=false,
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
  canPin?: boolean;
  canReact: boolean;
  highlighted?: boolean;
  onReply: (m: Message) => void;
}) {
  const reactionsEnabled = useStore((s) => s.instances[accountId]?.instance?.reactions === true);
  const isPinned = useStore((s) => s.instances[accountId]?.messages[message.channelId]?.pins?.some(pin => pin.message.id === message.id) ?? false);
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
    if (await confirmAction(translate("chat.791408c2831d")))
      void act(apiFor(accountId).del(`/channels/${message.channelId}/messages/${message.id}`));
  };

  return (
    <div data-message-id={message.id} className={`message${arrival}${compact ? " compact" : ""}${mentioned ? " mentioned" : ""}${highlighted?" search-highlight":""}`}>
      {message.replyToId && (
        <div className="reply-ref">
          <Icon name="reply" size={12} />
          {replyTo ? (
            <>
              <strong>{nameOf(replyTo.author.id) ?? replyTo.author.displayName}</strong>
              <span className="truncate">{replyTo.content || translate("common.be9ae4ef7a22")}</span>
            </>
          ) : (
            <span className="muted">{translate("chat.aee2220f75f2")}</span>
          )}
        </div>
      )}
      <div className="message-main">
        <time className="message-stamp" dateTime={message.createdAt} title={formatTime(message.createdAt)}>
          {formatClock(message.createdAt)}
        </time>
        <div className="message-body">
          {message.sharedBy&&<small className="muted">{rich("common.4ed74142d755",{p0:(nameOf(message.sharedBy)??message.sharedBy)})}</small>}
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
              <span className="muted small">{translate("chat.057d64271e1c")}</span>
            </div>
          ) : (
            message.content && !isStickerMessage(message.content) && (
              <div className="message-content">
                {renderContent(message.content, nameOf, me, channelOf)}
                {message.editedAt && <span className="edited">{translate("chat.9629ca339f1f")}</span>}
              </div>
            )
          )}
          <GiphyMessage accountId={accountId} content={message.content} />
          {message.content && <StickerMessage content={message.content} />}
          {message.attachments.length > 0 && <Attachments accountId={accountId} message={message} />}
          <ReactionChips reactions={message.reactions ?? []} me={me} nameOf={nameOf} disabled={reacting || !reactionsEnabled || !canReact} onToggle={(emoji) => void react(emoji)} />
        </div>
      </div>
      {!editing && (
        <div className="message-actions">
          {reactionsEnabled && canReact && <>
            <div className="reaction-shortcuts" aria-label={translate("chat.d767e158a964")}>{REACTION_SHORTCUTS.map((emoji) => <button key={emoji} className="reaction-quick" aria-label={translate("chat.e113ea72ab1d",{p0:(emoji)})} aria-pressed={message.reactions?.some((reaction) => reaction.emoji === emoji && reaction.userIds.includes(me)) ?? false} title={translate("chat.e113ea72ab1d",{p0:(emoji)})} disabled={reacting} onClick={() => void react(emoji)}>{emoji}</button>)}</div>
            <EmojiMenu disabled={reacting} onSelect={(emoji) => void react(emoji)} />
            <span className="message-action-divider" aria-hidden="true" />
          </>}
          {!reactionsEnabled && canReact && <button className="icon-btn tiny" aria-label={translate("expression.3fabbf2c1eb1")} title={translate("chat.25c010d1cb69")} onClick={() => toast(translate("chat.99b1109a32bd"))}><Icon name="smile" size={16} /></button>}
          <button className="icon-btn tiny" title={translate("chat.8630a0dc25e2")} onClick={() => onReply(message)}>
            <Icon name="reply" size={16} />
          </button>
          {canPin && <button className="icon-btn tiny" title={isPinned ? translate("chat.39b764469fcf") : translate("chat.0cc3fad10ab0")} aria-pressed={isPinned} onClick={async () => {
            try { const path=`/channels/${encodeURIComponent(message.channelId)}/pins/${encodeURIComponent(message.id)}`; if(isPinned) await apiFor(accountId).del(path); else await apiFor(accountId).put(path); await loadPinnedMessages(accountId,message.channelId); }
            catch(error){toast((error as Error).message);}
          }}><Icon name="pin" size={16} /></button>}
          {own && (
            <button
              className="icon-btn tiny"
              title={translate("chat.2eba946b2e1e")}
              onClick={() => {
                setDraft(message.content);
                setEditing(true);
              }}
            >
              <Icon name="edit" size={16} />
            </button>
          )}
          {(own || canModerate) && (
            <button className="icon-btn tiny danger" title={translate("common.8b19518ff49b")} onClick={remove}>
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
    .map(([id]) => nameOf(id) ?? translate("chat.ba005c2a5211"));
  if (names.length === 0) return <div className="typing" />;
  const text =
    names.length === 1
      ? translate("chat.29fa14c0a365",{p0:(names[0])})
      : names.length <= 3
        ? translate("chat.33fb983afa97",{p0:(names.join(", "))})
        : translate("chat.dfa9ad021e4b");
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
  replyToId,
  replyValid,
  replyStatus,
  draft,
  onDraftChange,
  onDiscard,
  onClearReply,
  onRetryReply,
  draftPersistenceFailed,
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
  replyToId: string | null;
  replyValid: boolean;
  replyStatus: "checking" | "valid" | "unavailable" | null;
  draft: ChatDraft;
  onDraftChange: (patch: Partial<Omit<ChatDraft, "updatedAt">>) => void;
  onDiscard: () => void;
  onClearReply: () => void;
  onRetryReply: () => void;
  draftPersistenceFailed: boolean;
  nameOf: NameOf;
}) {
  const text = draft.text;
  const [files, setFiles] = useState<File[]>(() => readPendingFiles(accountId, channelId));
  const [sending, setSending] = useState(false);
  const expiresIn = useMessageTtl(accountId, channelId);
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
    onDraftChange({ text: before + text.slice(caret) });
    setPicked((p) => (p.some((x) => x.id === m.id) ? p : [...p, m]));
    setQuery(null);
    requestAnimationFrame(() => el?.setSelectionRange(before.length, before.length));
  };

  const insertExpression = (value: string) => {
    const element = input.current, start = element?.selectionStart ?? text.length, end = element?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + value + text.slice(end);
    if (next.length > LIMITS.messageMax) return toast(translate("chat.bad8a97bbd10"));
    onDraftChange({ text: next });
    requestAnimationFrame(() => { element?.focus(); element?.setSelectionRange(start + value.length, start + value.length); });
  };
  const addFiles = (list: FileList | File[]) => {
    if (!canAttach || !connected) return;
    const next = [...files, ...Array.from(list)].slice(0, LIMITS.attachmentsPerMessage);
    setFiles(next);
    writePendingFiles(accountId, channelId, next);
    onDraftChange({ attachmentCount: next.length });
  };
  dropRef.current = addFiles;

  const send = async () => {
    if (!connected) return;
    // Longest names first so "@Ana Maria" wins over "@Ana".
    let content = text;
    for (const m of [...picked].sort((a, b) => b.name.length - a.name.length)) content = content.split(`@${m.name}`).join(`<@${m.id}>`);
    content = content.trim();
    if ((!content && files.length === 0) || sending || (replyToId !== null && !replyValid) || draft.attachmentCount > files.length) return;
    setSending(true);
    const signal = requests.signal;
    try {
      await apiFor(accountId).sendMessage(channelId, content, files, replyToId, expiresIn ? new Date(Date.now() + expiresIn).toISOString() : null, signal);
      signal.throwIfAborted();
      onDraftChange({ text: "", replyToId: null, attachmentCount: 0 });
      setFiles([]);
      writePendingFiles(accountId, channelId, []);
      setPicked([]);
    } catch (err) {
      if (!isCancellation(err)) toast((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  /** An Annoy sticker is its own message (the cdnannoy link); the draft and attachments stay. */
  const sendSticker = async (url: string) => {
    if (!connected || sending) return;
    setSending(true);
    const signal = requests.signal;
    try {
      await apiFor(accountId).sendMessage(channelId, url, [], null, expiresIn ? new Date(Date.now() + expiresIn).toISOString() : null, signal);
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
    if (e.key === "Escape" && replyToId) return onClearReply();
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

  if (!canSend) return <div className="composer composer-locked">{translate("chat.0a2a9f69102b")}</div>;

  return (
    <div className="composer-wrap">
      {suggestions.length > 0 && (
        <div className="suggestions">
          <div className="section-label">{translate("chat.d5fe73508340")}</div>
          {suggestions.map((m, i) => (
            <button key={m.id} className={i === sel ? "active" : ""} onMouseDown={(e) => (e.preventDefault(), pick(m))}>
              <strong>{m.name}</strong> <span className="muted">@{m.username}</span>
            </button>
          ))}
        </div>
      )}
      {replyTo && (
        <div className="reply-bar">{translate("chat.040c7dc9f553")}<strong>{nameOf(replyTo.author.id) ?? replyTo.author.displayName}</strong>
          <button className="icon-btn tiny" onClick={onClearReply} title={translate("chat.c0ec9adf7f1d")}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
      {replyToId && !replyTo && <div className="reply-bar" role="status">
        <span>{replyValid ? translate("chat.daa628ee773b") : replyStatus === "checking" ? translate("chat.32ece7067212") : translate("chat.555f78669b82")}</span>
        <button className="btn btn-ghost" disabled={replyValid || replyStatus === "checking"} onClick={onRetryReply}>{translate("chat.861c025f8735")}</button>
        <button className="icon-btn tiny" onClick={onClearReply} title={translate("chat.c5336a205266")}><Icon name="x" size={14} /></button>
      </div>}
      {draft.attachmentCount > files.length && <div className="draft-attachment-notice" role="status">
        <span>{rich("common.4802686b44c1",{p0:(draft.attachmentCount - files.length)})}</span>
        <button className="btn btn-ghost" type="button" onClick={() => fileInput.current?.click()}>{translate("chat.914cb0637e75")}</button>
        <button className="btn btn-ghost" type="button" onClick={() => { writePendingFiles(accountId, channelId, files); onDraftChange({ attachmentCount: files.length }); }}>{translate("chat.7704baaeda1c")}</button>
      </div>}
      {draftPersistenceFailed && <p className="draft-save-warning" role="alert">{translate("chat.d217cb945f73")}</p>}
      {files.length > 0 && (
        <div className="pending-files">
          {files.map((f, i) => (
            <PendingFile key={`${f.name}-${f.lastModified}-${i}`} file={f} disabled={sending} onRemove={() => {
              const next = files.filter((_, j) => j !== i);
              setFiles(next);
              writePendingFiles(accountId, channelId, next);
              onDraftChange({ attachmentCount: next.length });
            }} />
          ))}
        </div>
      )}
      <div className="composer">
        {canAttach && (
          <>
            <button className="icon-btn" disabled={!connected} title={translate("chat.0176661d7e81")} onClick={() => fileInput.current?.click()}>
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
          placeholder={connected ? placeholder : translate("common.e781a208e7bb")}
          disabled={!connected}
          onChange={(e) => {
            onDraftChange({ text: e.target.value });
            updateQuery(e.target.value, e.target.selectionStart);
            if (e.target.value) sendTyping(accountId, channelId);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => setQuery(null)}
        />
        <MediaPicker accountId={accountId} canAttach={canAttach} disabled={sending || !connected} onEmoji={insertExpression} onFile={(file) => addFiles([file])} onLink={(link) => insertExpression(`${text.trim() ? " " : ""}${link}`)} onSticker={(url) => void sendSticker(url)} />
        <Button
          variant="ghost"
          size="icon"
          className="composer-send"
          loading={sending}
          disabled={!connected || sending || (!text.trim() && files.length === 0) || (replyToId !== null && !replyValid) || draft.attachmentCount > files.length}
          onClick={() => void send()}
          aria-label={translate("chat.56c57edf5258")}
        >
          <Icon name="send" size={19} />
        </Button>
        {(text.length > 0 || replyToId !== null || files.length > 0 || draft.attachmentCount > files.length) && <button className="icon-btn" type="button" disabled={sending} onClick={async () => {
          if (await confirmAction(translate("chat.62a896f8437b"), { title: translate("chat.a09075a45b43"), confirmLabel: translate("common.1a878a55c594") })) {
            onDiscard();
            setFiles([]);
            writePendingFiles(accountId, channelId, []);
            setPicked([]);
          }
        }} title={translate("chat.a09075a45b43")} aria-label={translate("chat.a09075a45b43")}><Icon name="trash" size={16} /></button>}
      </div>
    </div>
  );
}

/** How long new messages live in this channel, as set by the server admins (0: permanent). */
function useMessageTtl(accountId: string, channelId: string): number {
  return useStore((s) => {
    for (const server of Object.values(s.instances[accountId]?.serverStates ?? {})) {
      const channel = server.channels.find((c) => c.id === channelId);
      if (channel) return channel.messageTtlMs ?? 0;
    }
    return 0;
  });
}

const TTL_LABELS: Record<number, string> = { 3_600_000: "1 hora", 86_400_000: "1 dia", 604_800_000: "7 dias" };

/** Only a notice: the lifetime itself is a channel setting of the server admins. */
function RetentionNotice({ accountId, channelId }: { accountId: string; channelId: string }) {
  const ttl = useMessageTtl(accountId, channelId);
  if (!ttl) return null;
  return <div className="connection-notice" role="note"><Icon name="clock" size={14} /><span>{rich("common.bf4871117816",{p0:(TTL_LABELS[ttl] ?? Math.round(ttl / 3_600_000) + " horas")})}</span></div>;
}

const EMPTY_UNREAD={count:0,mention:false};

export function Chat(props: ChatProps) {
  const { accountId, channelId, nameOf } = props;
  const entry = useStore((s) => s.instances[accountId]?.messages[channelId]);
  const me = useStore((s) => s.instances[accountId]?.user?.id ?? "");
  const connected = useStore((s) => s.instances[accountId]?.status === "ready");
  const items = entry?.items ?? EMPTY;
  const unread = useStore((s) => s.instances[accountId]?.unread[channelId] ?? EMPTY_UNREAD);
  const [draft, setDraft] = useState<ChatDraft>(() => readChatDraft(accountId, channelId));
  const [draftPersistenceFailed, setDraftPersistenceFailed] = useState(false);
  const [replyResolution, setReplyResolution] = useState<{ id: string; status: "checking" | "valid" | "unavailable"; message: Message | null } | null>(
    () => draft.replyToId ? { id: draft.replyToId, status: "checking", message: null } : null,
  );
  const [replyValidationAttempt, setReplyValidationAttempt] = useState(0);
  const [dragging, setDragging] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const virtualWindow=useRef<HTMLDivElement>(null);
  const [pinsOpen, setPinsOpen] = useState(false);
  const pinsButton=useRef<HTMLButtonElement>(null);
  const pinsSupported=useStore(s=>s.instances[accountId]?.instance?.messagePins===true);
  const readingIntent=useRef(false);
  const pendingAnchor=useRef<{id:string;offset:number}|null>(null);
  const restoringAnchor=useRef<{id:string;offset:number|null}|null>(null);
  const readingAnchor=useRef<{id:string;offset:number}|null>(null);
  const focusVisit=useRef<string|null>(null);
  const virtualizer = useVirtualizer({ count: items.length, getScrollElement: () => scroller.current, estimateSize: () => 88, overscan: 12, scrollMargin:virtualWindow.current?.offsetTop??0, getItemKey: index => items[index]?.id ?? index, measureElement: element => element.getBoundingClientRect().height });
  const pinned = useRef(true);
  const prevHeight = useRef<number | null>(null);
  const restoredVisit = useRef<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const chatRequests = useRequestOwner(JSON.stringify([accountId, channelId]));
  const firstId = items[0]?.id;
  const navigation = useStore((s) => s.chatNavigation);
  const focus = useStore((s) =>
    s.messageFocus?.accountId === accountId && s.messageFocus.channelId === channelId ? s.messageFocus : null,
  );
  const messageLog = useRef<HTMLDivElement>(null);
  const lastTop = useRef(0);
  const changeDraft = (patch: Partial<Omit<ChatDraft, "updatedAt">>) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    setDraftPersistenceFailed(!writeChatDraft(accountId, channelId, next));
  };
  const localReply = draft.replyToId ? items.find((message) => message.id === draft.replyToId) ?? null : null;
  const replyTo = localReply ?? (replyResolution?.id === draft.replyToId && replyResolution.status === "valid" ? replyResolution.message : null);
  const replyValid = !draft.replyToId || !!localReply || (replyResolution?.id === draft.replyToId && replyResolution.status === "valid");
  const replyStatus = draft.replyToId && replyResolution?.id === draft.replyToId ? replyResolution.status : draft.replyToId ? "checking" : null;
  const positionMessage=(id:string,offset:number|null)=>{
    const target={id,offset};restoringAnchor.current=target;
    const index=items.findIndex(message=>message.id===id);if(index<0){restoringAnchor.current=null;return;}
    virtualizer.scrollToIndex(index,{align:offset===null?"center":"start"});
    let attempts=0;
    const settle=()=>{
      const el=scroller.current;if(!el?.isConnected||restoringAnchor.current!==target)return;
      const row=el.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`);
      if(row){const desired=offset??Math.max(0,(el.clientHeight-row.getBoundingClientRect().height)/2);el.scrollTop+=row.getBoundingClientRect().top-el.getBoundingClientRect().top-desired;lastTop.current=el.scrollTop;readingAnchor.current={id,offset:desired};}
      else virtualizer.scrollToIndex(index,{align:offset===null?"center":"start"});
      if(++attempts<8)requestAnimationFrame(settle);else restoringAnchor.current=null;
    };
    requestAnimationFrame(settle);
  };

  useEffect(() => {
    const replyId = draft.replyToId;
    if (!replyId) { setReplyResolution(null); return; }
    const cached = items.find((message) => message.id === replyId);
    if (cached) { setReplyResolution({ id: replyId, status: "valid", message: cached }); return; }
    if (!entry || entry.loading) return;
    if (!connected) { setReplyResolution({ id: replyId, status: "unavailable", message: null }); return; }
    const controller = new AbortController();
    const signal = AbortSignal.any([chatRequests.signal, controller.signal]);
    setReplyResolution({ id: replyId, status: "checking", message: null });
    void (async () => {
      try {
        const page = await apiFor(accountId).get<Message[]>(`/channels/${encodeURIComponent(channelId)}/messages?around=${encodeURIComponent(replyId)}`, signal);
        if (signal.aborted || draft.replyToId !== replyId) return;
        const original = page.find((message) => message.id === replyId && message.channelId === channelId);
        if (original) setReplyResolution({ id: replyId, status: "valid", message: original });
        else {
          setReplyResolution(null);
          changeDraft({ replyToId: null });
          toast(translate("chat.8fb63d820c39"));
        }
      } catch (error) {
        if (signal.aborted || isCancellation(error) || draft.replyToId !== replyId) return;
        if (error instanceof RequestError && error.status === 404) {
          setReplyResolution(null);
          changeDraft({ replyToId: null });
          toast(translate("chat.8fb63d820c39"));
        } else setReplyResolution({ id: replyId, status: "unavailable", message: null });
      }
    })();
    return () => controller.abort();
  }, [accountId, channelId, draft.replyToId, entry, connected, items, replyValidationAttempt, chatRequests]);

  useEffect(() => () => flushChatState(), []);
  useLayoutEffect(()=>{
    restoredVisit.current=null; focusVisit.current=null; readingIntent.current=false;restoringAnchor.current=null;readingAnchor.current=null;
    pinned.current=!focus; prevHeight.current=null;
  },[accountId,channelId,navigation]);

  useLayoutEffect(()=>{
    if(!focus||entry?.loading||!items.length)return;
    const visit=JSON.stringify([navigation,focus.messageId]);if(focusVisit.current===visit)return;
    const index=items.findIndex(message=>message.id===focus.messageId);if(index<0)return;
    focusVisit.current=visit;pinned.current=false;
    positionMessage(focus.messageId,null);
  },[focus,items,entry?.loading,navigation]);

  useLayoutEffect(()=>{
    const el=scroller.current;if(!el||focus||!entry||entry.loading||entry.error||!items.length)return;
    const visit=JSON.stringify([draftKey(accountId,channelId),navigation]);if(restoredVisit.current===visit)return;
    restoredVisit.current=visit;
    const saved=readChatAnchor(accountId,channelId);
    const target=saved?.messageId??entry.initialPosition;
    const index=target?items.findIndex(message=>message.id===target):-1;
    if(index>=0){
      pinned.current=false;positionMessage(target!,saved?.offset??0);return;
    }
    if(saved)clearChatAnchor(accountId,channelId);
    pinned.current=true;virtualizer.scrollToIndex(items.length-1,{align:"end"});el.scrollTop=el.scrollHeight;lastTop.current=el.scrollTop;
  },[accountId,channelId,navigation,items,entry?.loading,entry?.error,focus]);

  // Images can grow after the message list mounts. Follow that growth only
  // while the reader remains at the latest message, never while reading back.
  useEffect(() => {
    if (!messageLog.current) return;
    const observer = new ResizeObserver(() => {
      const el = scroller.current;
      // A DOM scroll can precede React's scroll event. Respect the actual
      // position before a resize callback can pin the reader back to the end.
      if(el&&el.scrollTop<lastTop.current-1)pinned.current=false;
      if (el && pinned.current && prevHeight.current === null) {
        el.scrollTop = el.scrollHeight;
        lastTop.current = el.scrollTop;
      } else if(el&&!restoringAnchor.current&&readingAnchor.current){
        const anchor=readingAnchor.current,row=el.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(anchor.id)}"]`);
        if(row){el.scrollTop+=row.getBoundingClientRect().top-el.getBoundingClientRect().top-anchor.offset;lastTop.current=el.scrollTop;}
      }
    });
    observer.observe(messageLog.current);
    if (scroller.current) observer.observe(scroller.current);
    return () => observer.disconnect();
  }, [accountId, channelId]);

  useEffect(() => {
    void loadMessages(accountId, channelId);
    void loadPinnedMessages(accountId, channelId);
  }, [accountId, channelId]);

  // Keep the view pinned to the bottom for new messages, and steady when older ones load above.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if(el.scrollTop<lastTop.current-1)pinned.current=false;
    const anchor=pendingAnchor.current;
    if(anchor){
      pendingAnchor.current=null;prevHeight.current=null;
      const index=items.findIndex(message=>message.id===anchor.id);
      if(index>=0)positionMessage(anchor.id,anchor.offset);
    } else if(pinned.current) el.scrollTop=el.scrollHeight;
    lastTop.current=el.scrollTop;
  }, [items, firstId]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = scroller.current;
    if (!el) return;
    if(restoringAnchor.current){lastTop.current=el.scrollTop;return;}
    if (el.scrollTop < lastTop.current - 1) pinned.current = false;
    else if (el.scrollHeight - el.scrollTop - el.clientHeight < 80 && !entry?.hasMoreAfter) pinned.current = true;
    lastTop.current = el.scrollTop;
    const viewportTop = el.getBoundingClientRect().top;
    const firstVisible = [...(messageLog.current?.querySelectorAll<HTMLElement>("[data-message-id]") ?? [])]
      .find((row) => row.getBoundingClientRect().bottom > viewportTop);
    if (firstVisible?.dataset.messageId) {
      readingAnchor.current={id:firstVisible.dataset.messageId,offset:firstVisible.getBoundingClientRect().top-viewportTop};
      writeChatAnchor(accountId, channelId, { messageId: firstVisible.dataset.messageId, offset: firstVisible.getBoundingClientRect().top - viewportTop });
    }
    if (readingIntent.current && el.scrollTop < 200 && entry?.hasMore && !entry.loading && !entry.error) {
      if(firstVisible?.dataset.messageId)pendingAnchor.current={id:firstVisible.dataset.messageId,offset:firstVisible.getBoundingClientRect().top-viewportTop};
      prevHeight.current = el.scrollHeight;
      void loadMessages(accountId, channelId, true);
    }
    if (readingIntent.current && el.scrollHeight - el.scrollTop - el.clientHeight < 160 && entry?.hasMoreAfter && !entry.loading && !entry.error) {
      if(firstVisible?.dataset.messageId)pendingAnchor.current={id:firstVisible.dataset.messageId,offset:firstVisible.getBoundingClientRect().top-viewportTop};
      void loadMessages(accountId,channelId,"newer");
    }
    if(event.nativeEvent.isTrusted)markVisibleRead();
  };

  const markVisibleRead=()=>{
    const el=scroller.current;if(!el||!readingIntent.current||!document.hasFocus()||document.querySelector(".dialog-overlay"))return;
    const viewport=el.getBoundingClientRect();
    const rows=[...(messageLog.current?.querySelectorAll<HTMLElement>("[data-message-id]")??[])].filter(row=>{const rect=row.getBoundingClientRect();return rect.bottom>viewport.top&&rect.top<viewport.bottom;});
    const id=rows.at(-1)?.dataset.messageId;if(id)void markChannelRead(accountId,channelId,id);
  };
  const startReading=()=>{restoringAnchor.current=null;readingIntent.current=true;requestAnimationFrame(markVisibleRead);};
  useEffect(()=>{
    const frame=requestAnimationFrame(markVisibleRead);
    window.addEventListener("focus",markVisibleRead);
    return()=>{cancelAnimationFrame(frame);window.removeEventListener("focus",markVisibleRead);};
  },[items,connected]);

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
      onKeyDown={event=>{if(pinsOpen&&event.key==="Escape"){event.preventDefault();setPinsOpen(false);pinsButton.current?.focus();}}}
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
        <button ref={pinsButton} className={`icon-btn${pinsOpen ? " on" : ""}`} aria-label={translate("chat.dd5705122a58")} aria-expanded={pinsOpen} title={translate("chat.dd5705122a58")} onClick={() => {if(!pinsSupported){toast(translate("chat.f752af7c401b"));return;}setPinsOpen(value=>!value);void loadPinnedMessages(accountId,channelId);}}><Icon name="pin" size={17} /></button>
        {props.headerExtra}
      </header>
      {pinsOpen && <div className="pins-panel" role="region" aria-label={translate("chat.dd5705122a58")}>
        <div className="pins-panel-title"><strong>{translate("chat.dd5705122a58")}</strong><button className="icon-btn tiny" aria-label={translate("chat.0f2cac634ffa")} onClick={()=>setPinsOpen(false)}><Icon name="x" size={15}/></button></div>
        {entry?.pinsLoading && <p role="status">{translate("chat.705ff05e88ed")}</p>}{entry?.pinsError && <p role="alert">{entry.pinsError} <button className="btn btn-ghost" onClick={()=>void loadPinnedMessages(accountId,channelId)}>{translate("common.b9e10688be01")}</button></p>}{!entry?.pinsLoading && !entry?.pinsError && !entry?.pins?.length ? <p className="muted small">{translate("chat.ccd83eb43bb7")}</p> : entry?.pins?.map(pin=><button className="pinned-message" key={pin.message.id} onClick={()=>{setPinsOpen(false);void jumpToMessage(accountId,channelId,pin.message.id,props.serverId??null).catch(error=>toast((error as Error).message));}}><span><strong>{pin.message.author.displayName}</strong><small>{new Date(pin.pinnedAt).toLocaleString(localizationPreferences().region,{hourCycle:localizationPreferences().hourCycle})}</small></span><span className="pinned-message-content">{pin.message.content || translate("common.e186297c35aa")}</span></button>)}
        {entry?.pinsNextCursor&&<button className="btn btn-ghost" disabled={entry.pinsLoading} onClick={()=>void loadPinnedMessages(accountId,channelId,true)}>{translate("chat.d4d0696420fd")}</button>}
      </div>}
      <ConnectionNotice accountId={accountId} />
      <RetentionNotice accountId={accountId} channelId={channelId} />
      <div className="messages" ref={scroller} onScroll={onScroll} tabIndex={0} onWheel={startReading} onPointerDown={startReading} onKeyDown={startReading}>
        <div ref={messageLog} className="message-log">
          {entry && !entry.hasMore && (
            <div className="channel-start">
              <h2>{rich("common.57721d7e9cd7",{p0:(props.icon === "hash" ? `#${props.title}` : props.title)})}</h2>
              <p className="muted">{translate("chat.b5d86dab8396")}</p>
            </div>
          )}
          {entry?.loading &&
            (items.length === 0 ? (
              <ChatSkeleton />
            ) : (
              <div className="loading small" role="status">{translate("chat.d5818e7a4245")}</div>
            ))}
          {entry?.error && <div className="history-error" role="alert">
            <p>{entry.error}</p>
            <button className="btn btn-ghost" onClick={() => void loadMessages(accountId, channelId, items.length > 0)}>{translate("chat.7df4ee8299f8")}</button>
          </div>}
          <div ref={virtualWindow} className="message-window" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const i=virtualRow.index;
            const m=items[i]!;
            const prev = items[i - 1];
            const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
            const compact =
              !newDay &&
              !!prev &&
              !m.replyToId &&
              prev.author.id === m.author.id &&
              Date.parse(m.createdAt) - Date.parse(prev.createdAt) < GROUP_WINDOW_MS;
            return (
              <div key={m.id} data-index={i} ref={virtualizer.measureElement} className="virtual-message" style={{ transform: `translateY(${virtualRow.start-virtualizer.options.scrollMargin}px)` }}>
                {entry?.unreadBoundary && m.id > entry.unreadBoundary && (i===0 || items[i-1]!.id <= entry.unreadBoundary) && <div className="unread-divider" role="separator"><span>{translate("chat.6f263e8e0348")}</span></div>}
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
                  canPin={pinsSupported && (props.canPin??props.canModerate)}
                  canReact={props.canSend}
                  highlighted={focus?.messageId===m.id}
                  onReply={(message) => { changeDraft({ replyToId: message.id }); setReplyResolution({ id: message.id, status: "valid", message }); }}
                />
              </div>
            );
          })}
          </div>
        </div>
      </div>
      {(focus || entry?.hasMoreAfter || unread.count>0) && (
        <button className="return-latest" onClick={() => returnToLatest(accountId, channelId)}>
          {focus ? translate("chat.d284ad0cf8d8") : unread.count?counted(unread.count,"counts.unread.one","counts.unread.other"):translate("common.ade822bf50f9")}
        </button>
      )}
      <Composer
        dropRef={dropTarget}
        accountId={accountId}
        channelId={channelId}
        placeholder={translate("chat.5b0d728f295a",{p0:(props.icon === "hash" ? "#" : ""),p1:(props.title)})}
        canSend={props.canSend}
        canAttach={props.canAttach}
        mentionables={props.mentionables}
        draft={draft}
        onDraftChange={changeDraft}
        replyTo={replyTo}
        replyToId={draft.replyToId}
        replyValid={replyValid}
        replyStatus={replyStatus}
        onClearReply={() => { changeDraft({ replyToId: null }); setReplyResolution(null); }}
        onRetryReply={() => setReplyValidationAttempt((attempt) => attempt + 1)}
        draftPersistenceFailed={draftPersistenceFailed}
        onDiscard={() => {
          changeDraft({ text: "", replyToId: null, attachmentCount: 0 });
          setReplyResolution(null);
        }}
        nameOf={nameOf}
      />
      <TypingLine accountId={accountId} channelId={channelId} me={me} nameOf={nameOf} />
      {dragging && <div className="drop-overlay">{translate("chat.dc29e3aa63fe")}</div>}
    </section>
  );
}
