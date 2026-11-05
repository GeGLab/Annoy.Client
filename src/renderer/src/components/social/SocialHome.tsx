import type { User } from "@distopic/protocol";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { t as translate } from "../../../../shared/localization/index.ts";
import { navigate } from "../../client.ts";
import { formatClock, formatDay, formatTime, renderContent } from "../../format.tsx";
import { setState, toast, useStore } from "../../store.ts";
import { ActivityStack } from "../../features/activity/ActivityCard.tsx";
import { startDirectCall } from "../../features/direct-calls.ts";
import { acceptFriend, addFriend, displayName, ensureProfiles, removeFriend, setFriendNickname } from "../../social/index.ts";
import { deleteDm, editDm, loadThread, markDmRead, openAttachment, openDmWith, retryDm, sendDm, sendDmTyping, setStore } from "../../social/dms.ts";
import { imageUrl } from "../../social/cloud.ts";
import { CLOUD_ACCOUNT, type CloudPresence, type CloudProfile, type CloudRelationship, type DmAttachment, type DmMessage } from "../../social/types.ts";
import { ResizablePanel } from "../layout/ResizablePanel.tsx";
import { UserPanel } from "../TopBar.tsx";
import { Button } from "../ui/button.tsx";
import { confirmAction, promptText } from "../ui/action-dialog.tsx";
import { Input } from "../ui/input.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { Avatar, Icon } from "../ui.tsx";
import { WelcomeMain } from "../Home.tsx";

/**
 * Home of the Annoy account (TODO item 1): friends and DMs from the Annoy
 * cloud. Works with no server open; servers never see any of this.
 */

export const cloudUser = (p: CloudProfile | undefined, fallbackId = ""): User => ({
  id: p?.id ?? fallbackId,
  username: p?.username ?? "",
  displayName: displayName(p) || translate("social.unknownUser"),
  avatarUrl: imageUrl(p?.avatar),
});

const isOnline = (p: CloudPresence | undefined) => !!p && p.status !== "offline";
const GROUP_WINDOW_MS = 7 * 60_000;
const EMPTY: DmMessage[] = [];

function presenceLabel(p: CloudPresence | undefined): string {
  if (!p || p.status === "offline") return translate("social.offline");
  if (p.status === "idle") return translate("social.idle");
  if (p.status === "dnd") return translate("social.dnd");
  return translate("social.online");
}

function WhereLine({ presence }: { presence: CloudPresence | undefined }) {
  if (!presence?.where) return null;
  return (
    <small className="muted truncate">
      {presence.where.channel ? translate("social.whereChannel", { p0: presence.where.server, p1: presence.where.channel }) : translate("social.whereServer", { p0: presence.where.server })}
    </small>
  );
}

function FriendRow({ rel }: { rel: CloudRelationship }) {
  const presence = useStore((s) => s.social.presences[rel.user.id]);
  const ready = useStore((s) => s.social.status === "ready");
  const user = cloudUser(rel.user);
  const online = isOnline(presence);
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (error) {
      toast((error as Error).message);
    }
  };
  const message = async () => {
    try {
      const dm = await openDmWith(rel.user.id);
      navigate({ kind: "home", accountId: null, dmId: dm.id });
    } catch (error) {
      toast((error as Error).message);
    }
  };
  return (
    <div className="friend">
      <Avatar user={user} size={36} presence={rel.status === "friend" ? (presence?.status ?? "offline") : undefined} />
      <div className="friend-names">
        <strong>{rel.nickname || user.displayName}</strong>
        <span className="muted">
          {rel.status === "incoming" ? translate("social.incoming") : rel.status === "outgoing" ? translate("social.outgoing") : presenceLabel(presence)}
          {rel.user.username && <> · @{rel.user.username}</>}
        </span>
        {rel.status === "friend" && <WhereLine presence={presence} />}
        {rel.status === "friend" && presence && <ActivityStack activities={presence.activities} compact />}
      </div>
      <span className="spacer" />
      {rel.status === "friend" && (
        <>
          <button className="icon-btn" disabled={!ready || !online} aria-label={translate("social.voiceCall", { p0: user.displayName })} title={translate("social.voiceCall", { p0: user.displayName })} onClick={() => void startDirectCall(CLOUD_ACCOUNT, rel.user.id, false)}>
            <Icon name="phone" />
          </button>
          <button className="icon-btn" disabled={!ready || !online} aria-label={translate("social.videoCall", { p0: user.displayName })} title={translate("social.videoCall", { p0: user.displayName })} onClick={() => void startDirectCall(CLOUD_ACCOUNT, rel.user.id, true)}>
            <Icon name="camera" />
          </button>
          <button className="icon-btn" title={translate("social.message")} aria-label={translate("social.message")} onClick={() => void message()}>
            <Icon name="message" />
          </button>
          {/* Private friend nickname: only you see it (not the server nickname). */}
          <button className="icon-btn" disabled={!ready} title={translate("social.editNickname", { p0: user.displayName })} aria-label={translate("social.editNickname", { p0: user.displayName })}
            onClick={async () => {
              const nickname = await promptText(translate("common.91e4e0317865"), rel.nickname ?? "");
              if (nickname !== null) await run(() => setFriendNickname(rel.user.id, nickname.trim().slice(0, 64) || null));
            }}>
            <Icon name="edit" />
          </button>
        </>
      )}
      {rel.status === "incoming" && (
        <button className="icon-btn ok" disabled={!ready} title={translate("social.accept")} aria-label={translate("social.accept")} onClick={() => void run(() => acceptFriend(rel.user.id))}>
          <Icon name="check" />
        </button>
      )}
      <button
        className="icon-btn danger"
        disabled={!ready}
        title={rel.status === "friend" ? translate("social.removeFriend") : translate("social.cancelRequest")}
        aria-label={rel.status === "friend" ? translate("social.removeFriend") : translate("social.cancelRequest")}
        onClick={async () => {
          if (rel.status === "friend" && !(await confirmAction(translate("social.removeFriendConfirm", { p0: user.displayName })))) return;
          void run(() => removeFriend(rel.user.id));
        }}
      >
        <Icon name="x" />
      </button>
    </div>
  );
}

type Tab = "online" | "all" | "pending" | "add";

function Friends({ initialTab = "online" }: { initialTab?: Tab }) {
  const rels = useStore((s) => s.social.relationships);
  const presences = useStore((s) => s.social.presences);
  const me = useStore((s) => s.social.me);
  const status = useStore((s) => s.social.status);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = rels.filter((r) => r.status !== "friend");
  const incoming = pending.filter((r) => r.status === "incoming").length;
  const list = tab === "online" ? rels.filter((r) => r.status === "friend" && isOnline(presences[r.user.id])) : tab === "all" ? rels.filter((r) => r.status === "friend") : pending;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await addFriend(name);
      toast(translate("social.requestSent"));
      setName("");
    } catch (error) {
      toast((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="chat">
      <header className="chat-header">
        <Icon name="users" size={20} />
        <h1>{translate("social.friends")}</h1>
        <div className="tabs inline">
          {(["online", "all", "pending"] as const).map((t) => (
            <button key={t} className={tab === t ? "tab active" : "tab"} onClick={() => setTab(t)}>
              {t === "online" ? translate("social.online") : t === "all" ? translate("social.all") : translate("social.pending")}
              {t === "pending" && incoming > 0 && <span className="badge">{incoming}</span>}
            </button>
          ))}
          <button className={tab === "add" ? "tab tab-add active" : "tab tab-add"} onClick={() => setTab("add")}>
            {translate("social.addFriend")}
          </button>
        </div>
      </header>
      {status !== "ready" && <div className="connection-notice" role="status">{status === "connecting" ? translate("social.connecting") : translate("social.cloudOffline")}</div>}
      <div className="friends">
        {tab === "add" ? (
          <form className="add-friend" onSubmit={submit}>
            <h3>{translate("social.addFriend")}</h3>
            <p className="muted">{translate("social.addFriendHelp", { p0: me ? `@${me.username}` : "", p1: me?.id ?? "" })}</p>
            <div className="add-friend-row">
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={translate("social.addFriendPlaceholder")} />
              <button className="btn" disabled={busy || status !== "ready" || !name.trim()}>
                {translate("social.sendRequest")}
              </button>
            </div>
          </form>
        ) : list.length === 0 ? (
          <div className="friends-empty">
            <Icon name={tab === "pending" ? "check" : "users"} size={40} />
            <h2>{tab === "pending" ? translate("social.noPending") : tab === "online" ? translate("social.nobodyOnline") : translate("social.noFriends")}</h2>
            {tab !== "pending" && (
              <Button variant="secondary" onClick={() => setTab(tab === "online" ? "all" : "add")}>
                {tab === "online" ? translate("social.seeAll") : translate("social.addFriend")}
              </Button>
            )}
          </div>
        ) : (
          list.map((r) => <FriendRow key={r.user.id} rel={r} />)
        )}
      </div>
    </section>
  );
}

function AttachmentView({ attachment }: { attachment: DmAttachment }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const image = attachment.type.startsWith("image/") && attachment.size <= 10 * 1024 * 1024;
  useEffect(() => {
    if (!image) return;
    let revoked = false, made: string | null = null;
    openAttachment(attachment)
      .then((blob) => {
        if (revoked) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => setFailed(true));
    return () => {
      revoked = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [attachment.blobId, image]);
  const download = async () => {
    try {
      const blob = await openAttachment(attachment);
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = attachment.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    } catch (error) {
      toast((error as Error).message);
    }
  };
  if (image && url) return <img className="attachment-image" src={url} alt={attachment.name} onClick={() => void download()} />;
  return (
    <button className="attachment-file" onClick={() => void download()}>
      <Icon name="file" size={18} />
      <span className="truncate">{attachment.name}</span>
      <small className="muted">{failed ? translate("social.fileGone") : `${Math.max(1, Math.round(attachment.size / 1024))} KB`}</small>
    </button>
  );
}

function DmRow({ message, compact, me, nameOf, replyTo, onReply }: { message: DmMessage; compact: boolean; me: string; nameOf: (id: string) => string | undefined; replyTo: DmMessage | undefined; onReply: () => void }) {
  const profile = useStore((s) => s.social.profiles[message.senderId]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const own = message.senderId === me;
  const save = async () => {
    const content = draft.trim();
    try {
      if (content && content !== message.content) await editDm(message, content);
      setEditing(false);
    } catch (error) {
      toast((error as Error).message);
    }
  };
  return (
    <div data-message-id={message.id} className={`message${compact ? " compact" : ""}${message.state ? ` message-${message.state}` : ""}`}>
      {message.replyTo && (
        <div className="reply-ref">
          <Icon name="reply" size={12} />
          {replyTo ? (
            <>
              <strong>{nameOf(replyTo.senderId)}</strong>
              <span className="truncate">{replyTo.content}</span>
            </>
          ) : (
            <span className="muted">{translate("social.replyMissing")}</span>
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
              <Avatar user={cloudUser(profile, message.senderId)} size={22} />
              <span className="message-author">{nameOf(message.senderId)}</span>
            </div>
          )}
          {message.state === "undecryptable" ? (
            <div className="message-content muted">{translate("social.undecryptable")}</div>
          ) : editing ? (
            <div className="edit-box">
              <Textarea
                autoFocus
                value={draft}
                maxLength={4000}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void save();
                  } else if (e.key === "Escape") setEditing(false);
                }}
              />
            </div>
          ) : (
            message.content && (
              <div className="message-content">
                {renderContent(message.content, nameOf, me)}
                {message.editedAt && <span className="edited">{translate("social.edited")}</span>}
              </div>
            )
          )}
          {message.attachments.length > 0 && (
            <div className="attachments">
              {message.attachments.map((a) => (
                <AttachmentView key={a.blobId} attachment={a} />
              ))}
            </div>
          )}
          {message.state === "sending" && <small className="muted">{translate("social.sending")}</small>}
          {message.state === "failed" && (
            <small className="danger-text">
              {translate("social.failed")}{" "}
              <button className="link-btn" onClick={() => retryDm(message)}>
                {translate("social.retry")}
              </button>
            </small>
          )}
        </div>
      </div>
      {!editing && !message.state && (
        <div className="message-actions">
          <button className="icon-btn tiny" title={translate("social.reply")} aria-label={translate("social.reply")} onClick={onReply}>
            <Icon name="reply" size={16} />
          </button>
          {own && (
            <button
              className="icon-btn tiny"
              title={translate("social.edit")}
              aria-label={translate("social.edit")}
              onClick={() => {
                setDraft(message.content);
                setEditing(true);
              }}
            >
              <Icon name="edit" size={16} />
            </button>
          )}
          {own && (
            <button
              className="icon-btn tiny danger"
              title={translate("social.delete")}
              aria-label={translate("social.delete")}
              onClick={async () => {
                if (await confirmAction(translate("social.deleteConfirm"))) deleteDm(message).catch((error) => toast((error as Error).message));
              }}
            >
              <Icon name="trash" size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DmConversation({ dmId }: { dmId: string }) {
  const conversation = useStore((s) => s.social.dms.find((d) => d.id === dmId));
  const thread = useStore((s) => s.social.threads[dmId]);
  const me = useStore((s) => s.social.me);
  const other = useStore((s) => (conversation ? s.social.profiles[conversation.recipientId] : undefined));
  const nickname = useStore((s) => s.social.relationships.find((r) => r.user.id === conversation?.recipientId)?.nickname);
  const presence = useStore((s) => (conversation ? s.social.presences[conversation.recipientId] : undefined));
  const typing = useStore((s) => (conversation ? (s.social.typing[conversation.recipientId] ?? 0) > Date.now() : false));
  const ready = useStore((s) => s.social.status === "ready");
  const muted = useStore((s) => s.settings.mutedChannels.includes(`annoy:${dmId}`));
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [replyTo, setReplyTo] = useState<DmMessage | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const items = thread?.items ?? EMPTY;
  const byId = useMemo(() => new Map(items.map((m) => [m.id, m])), [items]);

  useEffect(() => {
    void loadThread(dmId);
    markDmRead(dmId);
    if (conversation) void ensureProfiles([conversation.recipientId]).catch(() => undefined);
  }, [dmId, conversation?.recipientId]);
  useEffect(() => {
    markDmRead(dmId);
    const el = scroller.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 400) el.scrollTop = el.scrollHeight;
  }, [items.length, dmId]);

  if (!conversation || !me) return <div className="empty-main" />;
  const title = nickname || displayName(other) || translate("social.unknownUser");
  const nameOf = (id: string) => (id === me.id ? displayName(me) : id === conversation.recipientId ? title : undefined);
  const stored = conversation.store.mine || conversation.store.theirs;

  const send = async () => {
    const content = text.trim();
    if (!content && !files.length) return;
    const picked = files, reply = replyTo?.id ?? null;
    setText("");
    setFiles([]);
    setReplyTo(null);
    await sendDm(dmId, content, picked, reply);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };
  const toggleStore = async () => {
    const next = !conversation.store.mine;
    if (!next && conversation.store.theirs) toast(translate("social.storeStillOn", { p0: title }));
    else if (!(await confirmAction(next ? translate("social.storeOnConfirm") : translate("social.storeOffConfirm")))) return;
    setStore(dmId, next).catch((error) => toast((error as Error).message));
  };

  return (
    <section
      className="chat"
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) setFiles((f) => [...f, ...Array.from(e.dataTransfer.files)].slice(0, 10));
      }}
    >
      <header className="chat-header">
        <Avatar user={cloudUser(other, conversation.recipientId)} size={28} presence={presence?.status ?? "offline"} />
        <h1 className="truncate">{title}</h1>
        <span className="chat-topic truncate">{presenceLabel(presence)}</span>
        <span className="spacer" />
        <button className={`icon-btn${stored ? " on" : ""}`} aria-pressed={conversation.store.mine} title={stored ? translate("social.storeOnTitle") : translate("social.storeOffTitle")} aria-label={translate("social.store")} onClick={() => void toggleStore()}>
          <Icon name="save" />
        </button>
        <button className="icon-btn" disabled={!ready || !isOnline(presence)} aria-label={translate("social.voiceCall", { p0: title })} onClick={() => void startDirectCall(CLOUD_ACCOUNT, conversation.recipientId, false)}>
          <Icon name="phone" />
        </button>
        <button className="icon-btn" disabled={!ready || !isOnline(presence)} aria-label={translate("social.videoCall", { p0: title })} onClick={() => void startDirectCall(CLOUD_ACCOUNT, conversation.recipientId, true)}>
          <Icon name="camera" />
        </button>
        <button
          className="icon-btn"
          aria-label={muted ? translate("social.unmute") : translate("social.mute")}
          onClick={() =>
            setState((s) => {
              const key = `annoy:${dmId}`;
              s.settings.mutedChannels = s.settings.mutedChannels.includes(key) ? s.settings.mutedChannels.filter((k) => k !== key) : [...s.settings.mutedChannels, key];
            })
          }
        >
          <Icon name={muted ? "bellOff" : "bell"} />
        </button>
      </header>
      <div className="messages" ref={scroller}>
        <div className="message-log">
          <div className="channel-start">
            <h2>{title}</h2>
            {thread?.hasMoreRemote && (
              <button className="btn btn-ghost" onClick={() => void loadThread(dmId, true)}>
                {translate("social.loadOlder")}
              </button>
            )}
          </div>
          {items.map((m, i) => {
            const prev = items[i - 1];
            const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
            const compact = !newDay && !!prev && !m.replyTo && prev.senderId === m.senderId && Date.parse(m.createdAt) - Date.parse(prev.createdAt) < GROUP_WINDOW_MS;
            return (
              <div key={m.clientId}>
                {newDay && (
                  <div className="day-divider" role="separator">
                    <span>{formatDay(m.createdAt)}</span>
                  </div>
                )}
                <DmRow message={m} compact={compact} me={me.id} nameOf={nameOf} replyTo={m.replyTo ? byId.get(m.replyTo) : undefined} onReply={() => setReplyTo(m)} />
              </div>
            );
          })}
        </div>
      </div>
      {replyTo && (
        <div className="reply-bar">
          <span className="truncate">{translate("social.replyingTo", { p0: nameOf(replyTo.senderId) ?? "" })}</span>
          <button className="icon-btn tiny" aria-label={translate("social.cancel")} onClick={() => setReplyTo(null)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
      {files.length > 0 && (
        <div className="pending-files">
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="pending-file">
              <span className="truncate">{f.name}</span>
              <button className="icon-btn tiny" aria-label={translate("social.cancel")} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                <Icon name="x" size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="composer">
        <button className="icon-btn" disabled={!ready} title={translate("social.attach")} aria-label={translate("social.attach")} onClick={() => fileInput.current?.click()}>
          <Icon name="plus" size={20} />
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) setFiles((f) => [...f, ...Array.from(e.target.files!)].slice(0, 10));
            e.target.value = "";
          }}
        />
        <Textarea
          rows={1}
          value={text}
          maxLength={4000}
          aria-label={translate("social.messageTo", { p0: title })}
          placeholder={ready ? translate("social.messageTo", { p0: title }) : translate("social.connecting")}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value) sendDmTyping(conversation.recipientId);
          }}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const pasted = Array.from(e.clipboardData.files);
            if (pasted.length) setFiles((f) => [...f, ...pasted].slice(0, 10));
          }}
        />
        <Button variant="ghost" size="icon" className="composer-send" disabled={!text.trim() && !files.length} onClick={() => void send()} aria-label={translate("social.send")}>
          <Icon name="send" size={19} />
        </Button>
      </div>
      <div className="typing-line" aria-live="polite">{typing ? translate("social.typing", { p0: title }) : ""}</div>
    </section>
  );
}

export function SocialHome({ dmId }: { dmId: string | null }) {
  const dms = useStore((s) => s.social.dms);
  const profiles = useStore((s) => s.social.profiles);
  const presences = useStore((s) => s.social.presences);
  const unread = useStore((s) => s.social.unread);
  const rels = useStore((s) => s.social.relationships);
  const incoming = rels.filter((r) => r.status === "incoming").length;
  const hasServers = useStore((s) => s.accounts.length > 0);
  const [friendsOpened, setFriendsOpened] = useState(false);
  // First run: no friend, conversation or server yet. The welcome stays, with "Adicionar amigo".
  const firstRun = !friendsOpened && !rels.length && !dms.length && !hasServers;
  useEffect(() => {
    const missing = dms.map((d) => d.recipientId).filter((id) => !profiles[id]);
    if (missing.length) void ensureProfiles(missing).catch(() => undefined);
  }, [dms]);
  const current = dmId && dms.some((d) => d.id === dmId) ? dmId : null;
  return (
    <div className="server-view">
      <ResizablePanel panel="channels">
        <header className="channels-header static">
          <span className="truncate">{translate("social.homeTitle")}</span>
          <Icon name="message" size={18} />
        </header>
        <ul className="channel-scroll">
          <li>
            <div className={`channel${!current ? " active" : ""}`} onClick={() => { setFriendsOpened(true); navigate({ kind: "home", accountId: null, dmId: null }); }}>
              <Icon name="users" size={18} />
              <span className="channel-name">{translate("social.friends")}</span>
              {incoming > 0 && <span className="badge">{incoming}</span>}
            </div>
          </li>
          <li className="section-label padded">{translate("social.dms")}</li>
          {dms.map((d) => {
            const p = profiles[d.recipientId];
            const nick = rels.find((r) => r.user.id === d.recipientId)?.nickname;
            const n = unread[d.id];
            return (
              <li key={d.id}>
                <div className={`channel dm${current === d.id ? " active" : ""}${n ? " unread" : ""}`} onClick={() => navigate({ kind: "home", accountId: null, dmId: d.id })}>
                  <Avatar user={cloudUser(p, d.recipientId)} size={28} presence={presences[d.recipientId]?.status ?? "offline"} />
                  <span className="channel-name">{nick || displayName(p) || translate("social.unknownUser")}</span>
                  {n ? <span className="badge">{n}</span> : null}
                </div>
              </li>
            );
          })}
          {dms.length === 0 && <li className="muted padded small">{translate("social.noDms")}</li>}
        </ul>
        <UserPanel />
      </ResizablePanel>
      {current ? <DmConversation key={current} dmId={current} /> : firstRun ? <WelcomeMain onAddFriend={() => setFriendsOpened(true)} /> : <Friends initialTab={friendsOpened && !rels.length ? "add" : "online"} />}
    </div>
  );
}
