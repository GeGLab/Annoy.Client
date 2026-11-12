import {rich} from "../../lib/localization.ts";
import {t as translate,onLocalizationChange} from "../../../../shared/localization/index.ts";
import { has, Permission, playbackPosition, type Channel, type Message, type PlaybackItem, type ServerState } from "@annoy/protocol";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent } from "react";
import { apiFor, joinVoice, leaveVoice, openChannel } from "../../client.ts";
import { displayNameOf } from "../../perms.ts";
import { toast, useStore } from "../../store.ts";
import { Chat } from "../../components/Chat.tsx";
import { VoiceStage } from "../../components/VoiceStage.tsx";
import { Icon, type IconName } from "../../components/ui.tsx";
import { currentItem, elementDriver, useSync, usePlayback, viewDriver, type Driver, type Playback, type UserEvents } from "./playback.ts";
import { useRequestOwner } from "../../lib/use-request-owner.ts";
import { isCancellation } from "../../../../shared/requests.ts";

type Slot = "theater" | "music";
const inView = (item: PlaybackItem | null) => item?.kind === "youtube" || item?.kind === "site";
let KIND_LABEL: Record<PlaybackItem["kind"], string> = { file: translate("common.ba8a452f2f83"), direct: translate("common.944bf23879bd"), youtube: "YouTube", site: translate("common.fa7955814e32") };
const KIND_ICON: Record<PlaybackItem["kind"], IconName> = { file: "file", direct: "link", youtube: "play", site: "external" };

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** Keeps a native view on top of `el`, hidden while a modal covers the page. */
function useViewBounds(slot: Slot, el: HTMLElement | null, active: boolean): void {
  const modalOpen = useStore((s) => s.modal !== null);
  useLayoutEffect(() => {
    const bridge = window.annoy?.theater;
    if (!bridge) return;
    const hide = () => bridge.setBounds(slot, { x: 0, y: 0, width: 0, height: 0 });
    if (!el || !active || modalOpen) return hide();
    const report = () => {
      const r = el.getBoundingClientRect();
      bridge.setBounds(slot, { x: r.left, y: r.top, width: r.width, height: r.height });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
      hide();
    };
  }, [slot, el, active, modalOpen]);
}

/** The media of the current item: a <video> for files and direct links, a native page otherwise. */
function useMediaDriver(slot: Slot, playback: Playback, media: HTMLMediaElement | null): UserEvents {
  const item = currentItem(playback.state);
  const [driver, setDriver] = useState<Driver | null>(null);
  const events = useRef<UserEvents | null>(null);
  const view = inView(item);
  const url = item?.url;
  const kind = item?.kind;

  useEffect(() => {
    if (view) {
      if (!url || !kind) return;
      window.annoy?.theater.open(slot, url, kind);
      const made = viewDriver(slot, () => events.current!);
      setDriver(made.driver);
      return () => {
        made.dispose();
        setDriver(null);
      };
    }
    window.annoy?.theater.close(slot);
    if (!media) return;
    const made = elementDriver(media, () => events.current!);
    setDriver(made.driver);
    return () => {
      made.dispose();
      setDriver(null);
    };
  }, [slot, view, url, kind, media]);

  useEffect(() => () => window.annoy?.theater.close(slot), [slot]);
  events.current = useSync(driver, playback);
  return events.current;
}

function Controls({ playback, canControl, canSkip }: { playback: Playback; canControl: boolean; canSkip: boolean }) {
  const { state, offset, send } = playback;
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const item = currentItem(state);
  if (!state || !item) return null;
  const position = playbackPosition(state, offset);
  return (
    <div className="playback-controls">
      <button
        className="round-btn"
        disabled={!canControl}
        onClick={() => void send(state.paused ? { op: "play" } : { op: "pause", position })}
        title={state.paused ? translate("common.ca0709c34209") : translate("common.c1301275ce3f")}
      >
        <Icon name={state.paused ? "play" : "pause"} size={20} />
      </button>
      <button className="round-btn" disabled={!canSkip} onClick={() => void send({ op: "next" })} title={translate("common.4a1772b0c06a")}>
        <Icon name="skip" size={20} />
      </button>
      <span className="playback-now">
        <strong className="truncate">{item.title}</strong>
        <small className="muted">
          {state.paused ? translate("common.d455cfb682d3") : translate("common.b6f1f2a32314")} · {clock(position)}
        </small>
      </span>
      <button className={`chip${state.autoplay ? " on" : ""}`} disabled={!canControl} onClick={() => void send({ op: "autoplay", value: !state.autoplay })}>{translate("common.aaae0f8a9481")}</button>
    </div>
  );
}

function PlaybackFeedback({ playback }: { playback: Playback }) {
  if (playback.loading && !playback.state) return <div className="playback-feedback" role="status">{translate("common.de8ebfb32da9")}</div>;
  if (!playback.error) return null;
  return <div className="playback-feedback error" role="alert"><span>{rich("common.3e66b8012f4a",{p0:(playback.error)})}</span><button className="btn btn-ghost btn-small" disabled={playback.loading} onClick={playback.retry}>{playback.loading ? translate("common.5da1f0aee3ad") : translate("common.b9e10688be01")}</button></div>;
}

function Queue({ accountId, channel, playback, perms, me, names, audioOnly, song = false }: { accountId: string; channel: Channel; playback: Playback; perms: number; me: string; names: Map<string, string>; audioOnly: boolean; song?: boolean }) {
  const { state, send } = playback;
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const requests = useRequestOwner(JSON.stringify([accountId, channel.id]));
  const file = useRef<HTMLInputElement>(null);
  const canAdd = has(perms, Permission.SEND_MESSAGES);
  const canAttach = canAdd && has(perms, Permission.ATTACH_FILES);
  const moderator = has(perms, Permission.MANAGE_MESSAGES);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim() || pending.current) return;
    const submitted = url.trim();
    pending.current = true;
    setBusy(true);
    try {
      if (await send({ op: "add", url: submitted })) setUrl((current) => current.trim() === submitted ? "" : current);
    } finally { pending.current = false; if (!requests.signal.aborted) setBusy(false); }
  };

  // An upload is a message in the room's chat; its file then joins the queue.
  const upload = async (list: File[]) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      for (const f of list) {
        const message = await apiFor(accountId).sendMessage<Message>(channel.id, translate("common.d8571b73592d",{p0:(f.name)}), [f], null, null, requests.signal);
        requests.signal.throwIfAborted();
        const attachment = message.attachments[0];
        if (attachment && !await send({ op: "add", url: "", uploadId: attachment.id })) break;
      }
    } catch (err) {
      if (!requests.signal.aborted && !isCancellation(err)) toast((err as Error).message);
    }
    pending.current = false;
    if (!requests.signal.aborted) setBusy(false);
  };

  return (
    <div className="playback-queue">
      {canAdd && (
        <form className="queue-add" onSubmit={add}>
          <input
            id={song ? songRequestId(channel.id) : undefined}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={audioOnly ? translate("common.f92e8e941b1d") : translate("common.006f5c9b0031")}
            aria-label={translate("common.ab491e3fdf77")}
          />
          <button className="btn" disabled={busy || !url.trim()}>{rich("common.86d6df3e9dd0",{p0:(<Icon name="plus" size={16} />)})}</button>
          {canAttach && (
            <>
              <button type="button" className="icon-btn" disabled={busy} title={translate("common.d273bd0711f9")} onClick={() => file.current?.click()}>
                <Icon name="upload" size={18} />
              </button>
              <input
                ref={file}
                type="file"
                accept={audioOnly ? "audio/*,video/*" : "video/*,audio/*"}
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
        </form>
      )}
      <ol className="queue-list">
        {state?.queue.length === 0 && <li className="muted queue-empty">{translate("common.74e940674eb5")}</li>}
        {state?.queue.map((item, index) => {
          const current = item.id === state.currentId;
          const removable = moderator || item.addedBy === me;
          return (
            <li key={item.id} className={`queue-item${current ? " current" : ""}`}>
              <span className="queue-index">{current ? <Icon name={state.paused ? "pause" : "play"} size={14} /> : song ? String(index + 1).padStart(2, "0") : index + 1}</span>
              {song && <span className="queue-thumb" style={{ "--art-hue": hueOf(item.title) } as CSSProperties} aria-hidden="true">{item.title.trim().charAt(0).toUpperCase() || "♪"}</span>}
              <span className="queue-meta">
                <strong className="truncate" title={item.url}>
                  {item.title}
                </strong>
                <small className="muted truncate">
                  <Icon name={KIND_ICON[item.kind]} size={12} /> {KIND_LABEL[item.kind]} · {song ? translate("song.requestedBy", { p0: names.get(item.addedBy) ?? translate("common.11bf7e98a3f1") }) : names.get(item.addedBy) ?? translate("common.11bf7e98a3f1")}
                </small>
              </span>
              {song && <QueueDuration id={item.id} />}
              <span className="row-actions">
                {!current && canAdd && (
                  <button className="icon-btn tiny" title={translate("common.8f94597e6108")} onClick={() => void send({ op: "play", itemId: item.id })}>
                    <Icon name="play" size={14} />
                  </button>
                )}
                {moderator && index > 0 && (
                  <button className="icon-btn tiny" title={translate("common.b3aad4488f3a")} onClick={() => void send({ op: "move", itemId: item.id, index: index - 1 })}>
                    <Icon name="up" size={14} />
                  </button>
                )}
                {removable && (
                  <button className="icon-btn tiny" title={translate("common.59edc3f0849b")} onClick={() => void send({ op: "remove", itemId: item.id })}>
                    <Icon name="x" size={14} />
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function useNames(state: ServerState) {
  return useMemo(() => new Map(state.members.map((m) => [m.user.id, displayNameOf(m)])), [state.members]);
}

function RoomChat({ accountId, state, channel, perms }: { accountId: string; state: ServerState; channel: Channel; perms: number }) {
  const names = useNames(state);
  return (
    <Chat
      accountId={accountId}
      channelId={channel.id}
      title={translate("common.460b3a7da007")}
      icon="message"
      canSend={has(perms, Permission.SEND_MESSAGES)}
      canAttach={has(perms, Permission.ATTACH_FILES)}
      canModerate={has(perms, Permission.MANAGE_MESSAGES)}
      nameOf={(id) => names.get(id)}
      channelOf={(id) => state.channels.find((c) => c.id === id)?.name}
      mentionables={state.members.map((m) => ({ id: m.user.id, name: displayNameOf(m), username: m.user.username }))}
    />
  );
}

// Theater ------------------------------------------------------------------

function TheaterPlayer({ accountId, playback }: { accountId: string; playback: Playback }) {
  const item = currentItem(playback.state);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  useMediaDriver("theater", playback, inView(item) ? null : video);
  useViewBounds("theater", slot, inView(item));
  if (!item) {
    return (
      <div className="theater-empty">
        <Icon name="theater" size={44} />
        <h2>{translate("common.39a3b1a7265b")}</h2>
        <p className="muted">{translate("common.48d6ba9efc7e")}</p>
      </div>
    );
  }
  return inView(item) ? (
    <div className="theater-view" ref={setSlot} />
  ) : (
    <video key={item.id} ref={setVideo} className="theater-video" src={apiFor(accountId).resolve(item.url)} controls autoPlay playsInline />
  );
}

/** Theater: a synced player for links and sites, the call's screen shares, and the room's chat. */
export function TheaterView({ accountId, state, channel, perms }: { accountId: string; state: ServerState; channel: Channel; perms: number }) {
  const playback = usePlayback(accountId, channel.id);
  const voice = useStore((s) => s.voice);
  const me = useStore((s) => s.instances[accountId]?.user?.id ?? "");
  const names = useNames(state);
  const connected = voice?.accountId === accountId && voice.channelId === channel.id;
  const inCall = state.voiceStates.filter((v) => v.channelId === channel.id);
  const sharing = inCall.some((v) => v.screen);
  const [mode, setMode] = useState<"player" | "screen">("player");
  const [side, setSide] = useState<"queue" | "chat">("queue");
  const item = currentItem(playback.state);
  const canControl = has(perms, Permission.SEND_MESSAGES);
  const canSkip = has(perms, Permission.MANAGE_MESSAGES) || item?.addedBy === me;

  // Someone started sharing a screen with nothing queued: show it.
  useEffect(() => {
    if (sharing && !item) setMode("screen");
  }, [sharing, item]);

  return (
    <section className="chat theater-room">
      <header className="chat-header">
        <Icon name="theater" size={20} />
        <h1 className="truncate">{channel.name}</h1>
        <div className="segmented" role="tablist" aria-label={translate("common.08c5711fd759")}>
          <button role="tab" aria-selected={mode === "player"} className={mode === "player" ? "active" : ""} onClick={() => setMode("player")}>{translate("common.64aee8c6cbd0")}</button>
          <button role="tab" aria-selected={mode === "screen"} className={mode === "screen" ? "active" : ""} onClick={() => setMode("screen")}>{rich("common.4acd7eeb327c",{p0:(sharing ? " •" : "")})}</button>
        </div>
        <span className="chat-topic">{inCall.length === 0 ? translate("common.f5c42021d624") : translate("common.dc3f6b2c7d4d",{p0:(inCall.length)})}</span>
        {connected ? (
          <button className="btn btn-ghost" onClick={() => leaveVoice()}>{rich("common.5cf06e6bd5ed",{p0:(<Icon name="hangup" size={16} />)})}</button>
        ) : (
          has(perms, Permission.CONNECT) && (
            <button className="btn" onClick={() => void joinVoice(accountId, state.server.id, channel.id)}>{rich("common.132f882f83f8",{p0:(<Icon name="mic" size={16} />)})}</button>
          )
        )}
      </header>
      <div className="theater-body">
        <div className="theater-stage">
          <PlaybackFeedback playback={playback} />
          {mode === "player" ? (
            <>
              <TheaterPlayer accountId={accountId} playback={playback} />
              <Controls playback={playback} canControl={canControl} canSkip={canSkip} />
            </>
          ) : (
            <VoiceStage accountId={accountId} state={state} channel={channel} embedded canConnect={has(perms, Permission.CONNECT)} />
          )}
        </div>
        <aside className="theater-side">
          <div className="segmented" role="tablist" aria-label={translate("common.ded83118d934")}>
            <button role="tab" aria-selected={side === "queue"} className={side === "queue" ? "active" : ""} onClick={() => setSide("queue")}>{rich("common.8396d1b92ce2",{p0:(playback.state?.queue.length ? ` (${playback.state.queue.length})` : "")})}</button>
            <button role="tab" aria-selected={side === "chat"} className={side === "chat" ? "active" : ""} onClick={() => setSide("chat")}>{translate("common.460b3a7da007")}</button>
          </div>
          {side === "queue" ? (
            <Queue accountId={accountId} channel={channel} playback={playback} perms={perms} me={me} names={names} audioOnly={false} />
          ) : (
            <RoomChat accountId={accountId} state={state} channel={channel} perms={perms} />
          )}
        </aside>
      </div>
    </section>
  );
}

// Song ---------------------------------------------------------------------
// Listening keeps going while the user browses other channels: the player lives in
// SongDock, mounted once by the app, and the song room only shows the queue.

interface Listening {
  accountId: string;
  serverId: string;
  channelId: string;
  name: string;
}

let listening: Listening | null = null;
let videoSlot: HTMLElement | null = null;
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((fn) => fn());
const subscribe = (fn: () => void) => {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
};

export function listenTo(next: Listening | null): void {
  listening = next;
  notify();
}

const useListening = () => useSyncExternalStore(subscribe, () => listening);
const useVideoSlot = () => useSyncExternalStore(subscribe, () => videoSlot);

function setVideoSlot(el: HTMLElement | null): void {
  if (videoSlot === el) return;
  videoSlot = el;
  notify();
}

/** Track lengths, learned from the local player while listening (the room state has none). */
const durations = new Map<string, number>();
function rememberDuration(id: string, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0 || durations.get(id) === seconds) return;
  durations.set(id, seconds);
  notify();
}
const useDuration = (id: string | undefined) => useSyncExternalStore(subscribe, () => (id ? durations.get(id) ?? null : null));
const songRequestId = (channelId: string) => `song-request-${channelId}`;
/** A stable colour per track, for its generated cover. */
function hueOf(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function QueueDuration({ id }: { id: string }) {
  const seconds = useDuration(id);
  return seconds ? <span className="queue-duration">{clock(seconds)}</span> : null;
}

function SongNowPlaying({ playback, here, canControl, canSkip, names }: { playback: Playback; here: boolean; canControl: boolean; canSkip: boolean; names: Map<string, string> }) {
  const { state, offset, send } = playback;
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const item = currentItem(state);
  const duration = useDuration(item?.id);
  const position = state && item ? playbackPosition(state, offset) : 0;
  const index = state && item ? state.queue.findIndex((entry) => entry.id === item.id) : -1;
  const playing = !!item && !state?.paused;
  const requester = item ? names.get(item.addedBy) ?? translate("common.11bf7e98a3f1") : "";
  return (
    <div className="song-hero">
      {here && inView(item) ? (
        <div className="song-video" ref={setVideoSlot} />
      ) : (
        <div className={`song-art${playing && here ? " spinning" : ""}`} style={{ "--art-hue": hueOf(item?.title ?? "") } as CSSProperties} aria-hidden="true">
          <span className="song-disc"><span className="song-label" /></span>
        </div>
      )}
      <div className="song-info">
        <span className="song-eyebrow">
          {item ? (
            <>
              {playing && <span className="song-bars" aria-hidden="true"><i /><i /><i /></span>}
              {state?.paused ? translate("song.paused") : translate("song.nowPlaying")} · {translate("song.requestedBy", { p0: requester })}
            </>
          ) : translate("song.nothing")}
        </span>
        <h2 className="song-title">{item?.title ?? translate("common.29f1d2c89080")}</h2>
        {item && <span className="song-subtitle">{KIND_LABEL[item.kind]}{!here ? ` · ${translate("common.d6dd41e50c28")}` : ""}</span>}
        {item && (
          <div className="song-progress">
            <span>{clock(position)}</span>
            <span className="song-track" role="progressbar" aria-label={translate("song.progress")} aria-valuemin={0} aria-valuemax={duration ? Math.round(duration) : undefined} aria-valuenow={Math.round(position)}>
              <span style={{ width: duration ? `${Math.min(100, (position / duration) * 100)}%` : "0%" }} />
            </span>
            <span>{duration ? clock(duration) : "--:--"}</span>
          </div>
        )}
        <div className="song-actions">
          {item && state && (
            <button className="round-btn song-play" disabled={!canControl} onClick={() => void send(state.paused ? { op: "play" } : { op: "pause", position })} title={state.paused ? translate("common.ca0709c34209") : translate("common.c1301275ce3f")}>
              <Icon name={state.paused ? "play" : "pause"} size={20} />
            </button>
          )}
          {canControl && <button className="btn song-request" onClick={() => document.getElementById(songRequestId(state?.channelId ?? ""))?.focus()}>{translate("song.request")}</button>}
          {item && state && (
            <button className="btn btn-ghost song-skip" disabled={!canSkip} onClick={() => void send({ op: "next" })}>
              {translate("song.skipOf", { p0: index + 1, p1: state.queue.length })}
            </button>
          )}
          {state && <button className={`chip${state.autoplay ? " on" : ""}`} disabled={!canControl} onClick={() => void send({ op: "autoplay", value: !state.autoplay })}>{translate("common.aaae0f8a9481")}</button>}
        </div>
      </div>
    </div>
  );
}

export function SongView({ accountId, state, channel, perms }: { accountId: string; state: ServerState; channel: Channel; perms: number }) {
  const playback = usePlayback(accountId, channel.id);
  const me = useStore((s) => s.instances[accountId]?.user?.id ?? "");
  const names = useNames(state);
  const current = useListening();
  const here = current?.accountId === accountId && current.channelId === channel.id;
  const item = currentItem(playback.state);
  const canSkip = has(perms, Permission.MANAGE_MESSAGES) || item?.addedBy === me;
  const queued = playback.state?.queue.length ?? 0;

  return (
    <section className="chat song-room">
      <header className="chat-header">
        <Icon name="song" size={20} />
        <h1 className="truncate">{channel.name}</h1>
        <span className="chat-topic">{channel.topic || translate("common.58547828fc8e")}</span>
        {here ? (
          <button className="btn btn-ghost" onClick={() => listenTo(null)}>{rich("common.3f4403be164d",{p0:(<Icon name="volumeOff" size={16} />)})}</button>
        ) : (
          <button className="btn" onClick={() => listenTo({ accountId, serverId: state.server.id, channelId: channel.id, name: channel.name })}>{rich("common.89b5c2ca7704",{p0:(<Icon name="headphones" size={16} />)})}</button>
        )}
      </header>
      <div className="song-body">
        <div className="song-main">
          <PlaybackFeedback playback={playback} />
          <SongNowPlaying playback={playback} here={here} canControl={has(perms, Permission.SEND_MESSAGES)} canSkip={canSkip} names={names} />
          <h3 className="song-section-title">{translate("song.queue")} · {queued}</h3>
          <Queue accountId={accountId} channel={channel} playback={playback} perms={perms} me={me} names={names} audioOnly song />
        </div>
        <aside className="theater-side song-side" aria-label={translate("song.chat")}>
          <h3 className="song-section-title">{translate("song.chat")}</h3>
          <RoomChat accountId={accountId} state={state} channel={channel} perms={perms} />
        </aside>
      </div>
    </section>
  );
}

function SongPlayer({ session }: { session: Listening }) {
  const playback = usePlayback(session.accountId, session.channelId);
  const item = currentItem(playback.state);
  const [audio, setAudio] = useState<HTMLVideoElement | null>(null);
  const slot = useVideoSlot();
  useMediaDriver("music", playback, inView(item) ? null : audio);
  useViewBounds("music", slot, inView(item) && !!slot?.isConnected);
  const position = playback.state ? playbackPosition(playback.state, playback.offset) : 0;
  return (
    <div className="song-dock" role="region" aria-label={translate("common.62fe17b6d2a1")}>
      <Icon name="song" size={16} />
      <button className="song-dock-title truncate" title={translate("common.bea6078b5e33")} onClick={() => openChannel(session.accountId, session.serverId, session.channelId)}>
        <strong>{item?.title ?? translate("common.cede3e8165b2")}</strong>
        <span className="muted"> · {session.name}</span>
      </button>
      <PlaybackFeedback playback={playback} />
      {item && <span className="muted">{clock(position)}</span>}
      {item && !inView(item) && <video key={item.id} ref={setAudio} className="song-audio" src={apiFor(session.accountId).resolve(item.url)} autoPlay onDurationChange={(e) => rememberDuration(item.id, e.currentTarget.duration)} />}
      <button className="icon-btn tiny" title={translate("common.512e5a1c3a9e")} onClick={() => listenTo(null)}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

/** The song room's player, alive while the user listens, wherever they are in the app. */
export function SongDock() {
  const session = useListening();
  const accounts = useStore((s) => s.accounts);
  const connected = useStore((s) => !!session && s.instances[session.accountId]?.status === "ready");
  // Signing out of the account stops the music too.
  useEffect(() => {
    if (session && (!connected || !accounts.some((a) => a.id === session.accountId))) listenTo(null);
  }, [session, accounts, connected]);
  if (!session || !connected) return null;
  return <SongPlayer key={`${session.accountId}:${session.channelId}`} session={session} />;
}

onLocalizationChange(()=>{KIND_LABEL={ file: translate("common.ba8a452f2f83"), direct: translate("common.944bf23879bd"), youtube: "YouTube", site: translate("common.fa7955814e32") };});

onLocalizationChange(()=>{KIND_LABEL={ file: translate("common.ba8a452f2f83"), direct: translate("common.944bf23879bd"), youtube: "YouTube", site: translate("common.fa7955814e32") };});
