import {rich} from "../../lib/localization.ts";
import {t as translate,onLocalizationChange} from "../../../../shared/localization/index.ts";
import { DJ_STYLES, has, Permission, playbackPosition, type Channel, type DjStyle, type Message, type PlaybackItem, type ServerState } from "@annoy/protocol";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { flushSync } from "react-dom";
import { apiFor, joinVoice, leaveVoice, openChannel } from "../../client.ts";
import { channelPerms, displayNameOf } from "../../perms.ts";
import { setState, toast, useStore } from "../../store.ts";
import { Chat } from "../../components/Chat.tsx";
import { VoiceStage } from "../../components/VoiceStage.tsx";
import { Icon, type IconName } from "../../components/ui.tsx";
import { currentItem, elementDriver, useSync, usePlayback, viewDriver, type Driver, type Playback, type UserEvents } from "./playback.ts";
import { useRequestOwner } from "../../lib/use-request-owner.ts";
import { isCancellation } from "../../../../shared/requests.ts";
import type { LyricLine, SongInfo } from "../../../../shared/song-info.ts";

type Slot = "theater" | "music" | "musicB";
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

  const latest = useRef(playback);
  latest.current = playback;
  useEffect(() => {
    if (view) {
      if (!url || !kind) return;
      // Joining mid-video starts there, not from the top.
      const { state, offset } = latest.current;
      window.annoy?.theater.open(slot, url, kind, { start: state ? playbackPosition(state, offset) : 0 });
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
              <span className="queue-index">{current ? (song && !state.paused ? <span className="song-bars" aria-hidden="true"><i /><i /><i /></span> : <Icon name={state.paused ? "pause" : "play"} size={14} />) : song ? String(index + 1).padStart(2, "0") : index + 1}</span>
              {song && <QueueThumb item={item} />}
              <span className="queue-meta">
                <strong className="truncate" title={item.title}>
                  {song ? songInfos.get(item.id)?.track ?? item.title : item.title}
                </strong>
                {song ? (
                  <small className="muted truncate">
                    {[songInfos.get(item.id)?.artist, translate("song.requestedBy", { p0: names.get(item.addedBy) ?? translate("common.11bf7e98a3f1") })].filter(Boolean).join(" · ")}
                  </small>
                ) : (
                  <small className="muted truncate">
                    <Icon name={KIND_ICON[item.kind]} size={12} /> {KIND_LABEL[item.kind]} · {names.get(item.addedBy) ?? translate("common.11bf7e98a3f1")}
                  </small>
                )}
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
// SongDock, mounted once by the app, and the song room shows the cover, lyrics and queue.

interface Listening {
  accountId: string;
  serverId: string;
  channelId: string;
  name: string;
}

let listening: Listening | null = null;
let videoSlot: HTMLElement | null = null;
/** The dock's player is lowered right now because people in the call are talking. */
let duckedNow = false;
/** The DJ transition playing right now, if any. */
let mixingNow: DjPreset | null = null;
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
const useDucked = () => useSyncExternalStore(subscribe, () => duckedNow);
const useMixing = () => useSyncExternalStore(subscribe, () => mixingNow);

function setVideoSlot(el: HTMLElement | null): void {
  if (videoSlot === el) return;
  videoSlot = el;
  notify();
}

function setDucked(value: boolean): void {
  if (duckedNow === value) return;
  duckedNow = value;
  notify();
}

function setMixing(value: DjPreset | null): void {
  if (mixingNow === value) return;
  mixingNow = value;
  notify();
}

// Personal preferences (this device only) ------------------------------------------

function readLocal<T>(key: string, parse: (raw: string) => T | null, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : parse(raw) ?? fallback;
  } catch {
    return fallback;
  }
}
function writeLocal(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* still works for this session */ }
}

/** This device's music volume (0 to 1), kept between launches; the room's ducking scales it. */
const VOLUME_KEY = "annoy.songVolume";
let musicVolume = readLocal(VOLUME_KEY, (raw) => { const v = Number(raw); return Number.isFinite(v) && v >= 0 && v <= 1 ? v : null; }, 0.8);
function setMusicVolume(value: number): void {
  const next = Math.min(1, Math.max(0, Math.round(value * 100) / 100));
  if (next === musicVolume) return;
  musicVolume = next;
  writeLocal(VOLUME_KEY, String(next));
  notify();
}
const useMusicVolume = () => useSyncExternalStore(subscribe, () => musicVolume);

/** Light mode: just the music. No lyrics, visualizer, spectrum analysis, blur or ambient motion. */
const LITE_KEY = "annoy.songLite";
let songLite = readLocal(LITE_KEY, (raw) => raw === "1", false);
function setSongLite(value: boolean): void {
  if (songLite === value) return;
  songLite = value;
  writeLocal(LITE_KEY, value ? "1" : "0");
  notify();
}
const useSongLite = () => useSyncExternalStore(subscribe, () => songLite);

/** Where the floating mini player was left, as fractions of the free space (survives resizes). */
const DOCK_KEY = "annoy.songDock";
let dockAt = readLocal(DOCK_KEY, (raw) => {
  const v = JSON.parse(raw) as { x?: unknown; y?: unknown };
  return typeof v.x === "number" && typeof v.y === "number" ? { x: Math.min(1, Math.max(0, v.x)), y: Math.min(1, Math.max(0, v.y)) } : null;
}, { x: 0.5, y: 0.045 });

// Tracks ---------------------------------------------------------------------------

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

/** The thumbnail of a YouTube item, for its row in the queue. */
function youtubeThumb(item: PlaybackItem): string | null {
  if (item.kind !== "youtube") return null;
  try {
    const url = new URL(item.url);
    const host = url.hostname.replace(/^(www|m|music)\./, "");
    const id = host === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v") ?? /^\/(embed|shorts|live)\/([\w-]+)/.exec(url.pathname)?.[2];
    return id && /^[\w-]{6,20}$/.test(id) ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
  } catch {
    return null;
  }
}

function QueueThumb({ item }: { item: PlaybackItem }) {
  const known = songInfos.get(item.id)?.cover;
  const src = known ?? youtubeThumb(item);
  const [broken, setBroken] = useState(false);
  return (
    <span className="queue-thumb" style={{ "--art-hue": hueOf(item.title) } as CSSProperties} aria-hidden="true">
      {src && !broken ? <img src={src} alt="" draggable={false} referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : item.title.trim().charAt(0).toUpperCase() || "♪"}
    </span>
  );
}

function QueueDuration({ id }: { id: string }) {
  const seconds = useDuration(id);
  return seconds ? <span className="queue-duration">{clock(seconds)}</span> : null;
}

/** Where this device's own player is: lyrics follow it more closely than the room's clock. */
let localClock: { itemId: string; position: number; paused: boolean; at: number } | null = null;
function tickLocal(itemId: string, position: number, paused: boolean): void {
  if (Number.isFinite(position)) localClock = { itemId, position, paused, at: Date.now() };
}

/** Seconds into the current item: this device's player when it is the one playing it, else the room's clock. */
function positionOf(playback: Playback, itemId: string | undefined, here: boolean): number {
  const { state, offset } = playback;
  if (!state || !itemId) return 0;
  const local = localClock;
  if (here && local?.itemId === itemId && Date.now() - local.at < 3000) return local.position + (local.paused ? 0 : (Date.now() - local.at) / 1000);
  return playbackPosition(state, offset);
}

/** This device's player is actually producing sound for the item (not still loading it). */
function sounding(itemId: string | undefined): boolean {
  const local = localClock;
  return !!itemId && local?.itemId === itemId && !local.paused && Date.now() - local.at < 2600;
}

function useTick(ms: number, enabled = true): void {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => tick((n) => n + 1), ms);
    return () => clearInterval(timer);
  }, [ms, enabled]);
}

// Ducking --------------------------------------------------------------------

const DUCKED_VOLUME = 0.2;

/** Someone in this user's call is talking; held a moment after they stop so the music doesn't pump. */
function useCallTalking(): boolean {
  const talking = useStore((s) => {
    const voice = s.voice;
    if (!voice || voice.status !== "connected") return false;
    return !!s.instances[voice.accountId]?.serverStates[voice.serverId]?.voiceStates.some(
      (v) => v.channelId === voice.channelId && v.speaking && !v.selfMute && !v.serverMute,
    );
  });
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (talking) { setHeld(true); return; }
    const timer = setTimeout(() => setHeld(false), 900);
    return () => clearTimeout(timer);
  }, [talking]);
  return talking || held;
}

/** Eases a <video>/<audio> element to `target` instead of jumping. */
function useElementVolume(el: HTMLMediaElement | null, target: number): void {
  useEffect(() => {
    if (!el) return;
    const step = () => {
      const diff = target - el.volume;
      if (Math.abs(diff) <= 0.04) { el.volume = target; return true; }
      el.volume = Math.min(1, Math.max(0, el.volume + Math.sign(diff) * Math.max(0.04, Math.abs(diff) * 0.25)));
      return false;
    };
    if (step()) return;
    const timer = setInterval(() => { if (step()) clearInterval(timer); }, 30);
    return () => clearInterval(timer);
  }, [el, target]);
}

// Cover, album and lyrics ------------------------------------------------------

/** Looked up once per queued item and kept while the app runs. */
const songInfos = new Map<string, SongInfo>();

function useSongInfo(item: PlaybackItem | null, duration: number | null): { info: SongInfo | null; loading: boolean } {
  const id = item?.id;
  const [, refresh] = useState(0);
  const [waited, setWaited] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const knowsDuration = duration !== null;
  // The length tells covers and lyrics of different versions apart; give the player a moment to report it.
  useEffect(() => {
    if (!id || knowsDuration) return;
    const timer = setTimeout(() => setWaited(id), 2500);
    return () => clearTimeout(timer);
  }, [id, knowsDuration]);
  // YouTube lengths are read from the video itself by the lookup: no need to wait for the player.
  const ready = !!id && (knowsDuration || waited === id || item?.kind === "youtube");
  const durationRef = useRef(duration);
  durationRef.current = duration;
  useEffect(() => {
    if (!item || !ready || songInfos.has(item.id)) return;
    const lookup = window.annoy?.theater.songInfo;
    if (!lookup) return setFailed(item.id);
    let live = true;
    void lookup(item.kind === "youtube" ? item.url : "", item.title, durationRef.current).then(
      (info) => {
        if (info) { songInfos.set(item.id, info); notify(); }
        if (!live) return;
        if (info) refresh((n) => n + 1);
        else setFailed(item.id);
      },
      () => { if (live) setFailed(item.id); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one lookup per item, once ready
  }, [id, ready]);
  const info = id ? songInfos.get(id) ?? null : null;
  return { info, loading: !!id && !info && failed !== id };
}

function SongCover({ info, item, spinning, loading = false }: { info: SongInfo | null; item: PlaybackItem | null; spinning: boolean; loading?: boolean }) {
  const [broken, setBroken] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const src = info?.cover && broken !== info.cover ? info.cover : null;
  if (loading && !src) {
    // Looking the album up: a shimmering sleeve with a record turning inside.
    return (
      <div className="song-art song-art-loading" aria-hidden="true">
        <span className="song-disc spinning-slow"><span className="song-label" /></span>
      </div>
    );
  }
  if (src) {
    return (
      <div className={`song-art song-cover-art${src.includes("i.ytimg.com") ? " from-video" : ""}${loaded === src ? " loaded" : ""}`}>
        <img src={src} alt="" draggable={false} referrerPolicy="no-referrer" onLoad={() => setLoaded(src)} onError={() => setBroken(src)} />
      </div>
    );
  }
  return (
    <div className={`song-art${spinning ? " spinning" : ""}`} style={{ "--art-hue": hueOf(item?.title ?? "") } as CSSProperties} aria-hidden="true">
      <span className="song-disc"><span className="song-label" /></span>
    </div>
  );
}

/** A few words that change while something loads, so waiting feels alive. */
type LineKey = Parameters<typeof translate>[0];
function useLoadingLine(keys: readonly LineKey[], ms = 1800): string {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex((n) => (n + 1) % keys.length), ms);
    return () => clearInterval(timer);
  }, [keys, ms]);
  return translate(keys[index % keys.length]!);
}
const ROOM_LOADING: readonly LineKey[] = ["song.loading1", "song.loading2", "song.loading3", "song.loading4", "song.loading5"];
const LYRICS_LOADING: readonly LineKey[] = ["song.lyricsLoading", "song.loading6", "song.loading7"];

/** The room's first load: an equalizer that dances while the room answers. */
function SongLoader() {
  const line = useLoadingLine(ROOM_LOADING);
  return (
    <div className="song-loader" role="status">
      <span className="song-loader-eq" aria-hidden="true">{Array.from({ length: 7 }, (_, i) => <i key={i} />)}</span>
      <span key={line} className="song-loader-line">{line}</span>
    </div>
  );
}

/** Index of the line being sung at `time`: the last one that started. */
function lineAt(lines: readonly LyricLine[], time: number): number {
  let lo = 0, hi = lines.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid]!.time <= time) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

/** A word and when it is sung, in the lyrics' own time. */
interface TimedWord { text: string; start: number; end: number }

/**
 * When each word of a line is sung. Word-synced lyrics say so; otherwise the line's singing
 * time is spread over its words by length, at a realistic pace (a long gap before the next
 * line is an instrumental break, not a slow line).
 */
function lineWords(line: LyricLine, next: number | undefined): TimedWord[] {
  const nextTime = next ?? line.time + 8;
  if (line.words?.length) {
    const words = line.words;
    const end = Math.min(line.end ?? nextTime, nextTime);
    return words.map((w, i) => ({ text: w.text, start: w.time, end: Math.max(w.time + 0.05, Math.min(words[i + 1]?.time ?? end, end)) }));
  }
  const parts = line.text.match(/\S+\s*/g) ?? [];
  if (!parts.length) return [];
  const letters = parts.reduce((sum, part) => sum + part.trim().length, 0);
  const span = Math.max(0.4, Math.min(nextTime - line.time - 0.1, Math.max(0.6, letters / 12 + 0.35)));
  const weights = parts.map((part) => part.trim().length + 1.5);
  const total = weights.reduce((sum, w) => sum + w, 0);
  let at = line.time;
  return parts.map((text, i) => {
    const length = (span * weights[i]!) / total;
    const word = { text, start: at, end: at + length };
    at += length;
    return word;
  });
}

// Lyrics alignment ---------------------------------------------------------------------
// Lyrics are timed to one recording; a music video is often another one (an intro, a scene
// in the middle, a different edit). While the song plays here, the singing measured in the
// audio (centre against sides in the singing band, from the theater preload) is matched
// against where these lyrics expect singing, and the lyrics shift to follow the video.
// It only steps in when the lyrics can't be trusted as they are: the video's length differs
// from the recording they're timed to, or nobody knows that recording. A nudge by hand always
// wins and is remembered for the video.

const ALIGN_RATE = 10;
const ALIGN_WINDOW = 40;

interface Alignment {
  /** The video (or file) these lyrics play over: hand-made offsets are remembered per video. */
  key: string;
  /** Lyrics time = media time − offset. */
  offset: number;
  source: "none" | "auto" | "manual";
  /** The lyrics may be off: the audio is listened to. */
  engaged: boolean;
  /** The largest offset considered, in seconds. */
  span: number;
  /** Singing measure per tenth of a second of media time (NaN: not heard yet). */
  heard: Float32Array;
  /** 1 where the lyrics expect singing, per tenth of a second of lyrics time. */
  expected: Float32Array;
  checkedAt: number;
  /** A better offset seen once: it must be seen again before the lyrics move. */
  pending: { offset: number; count: number } | null;
  /** The audio clearly agrees with the current offset. */
  confirmed: boolean;
  /** When the lyrics last moved by ear: they stay put for a while after. */
  movedAt: number;
}
const alignments = new Map<string, Alignment>();

const SYNC_KEY = "annoy.lyricsSync";
const manualSync: Record<string, number> = readLocal(SYNC_KEY, (raw) => {
  const value = JSON.parse(raw) as unknown;
  return value && typeof value === "object" ? (value as Record<string, number>) : null;
}, {});
function rememberSync(key: string, offset: number | null): void {
  if (offset === null) delete manualSync[key];
  else manualSync[key] = Math.round(offset * 10) / 10;
  const keys = Object.keys(manualSync);
  for (const old of keys.slice(0, Math.max(0, keys.length - 300))) delete manualSync[old];
  writeLocal(SYNC_KEY, JSON.stringify(manualSync));
}

function mediaKey(item: PlaybackItem): string {
  const thumb = youtubeThumb(item);
  return thumb ? `yt:${/\/vi\/([\w-]+)\//.exec(thumb)?.[1] ?? item.url}` : item.url;
}

function alignmentFor(item: PlaybackItem, info: SongInfo): Alignment | null {
  const lines = info.synced;
  if (!lines?.length) return null;
  const existing = alignments.get(item.id);
  if (existing) return existing;
  const media = info.mediaDuration ?? durations.get(item.id) ?? info.duration ?? null;
  const last = lines[lines.length - 1]!.time;
  const delta = media && info.lyricsDuration ? media - info.lyricsDuration : null;
  const expected = new Float32Array(Math.ceil((last + 15) * ALIGN_RATE));
  lines.forEach((line, i) => {
    const words = lineWords(line, lines[i + 1]?.time);
    if (!words.length) return;
    const from = Math.max(0, Math.round(words[0]!.start * ALIGN_RATE)), to = Math.min(expected.length, Math.round(words[words.length - 1]!.end * ALIGN_RATE));
    for (let k = from; k < to; k++) expected[k] = 1;
  });
  const key = mediaKey(item);
  const manual = manualSync[key];
  const alignment: Alignment = {
    key,
    offset: manual ?? 0,
    source: manual !== undefined ? "manual" : "none",
    engaged: delta === null || Math.abs(delta) > 1.5,
    span: Math.min(60, Math.max(6, (delta === null ? 12 : Math.abs(delta)) + 4)),
    heard: new Float32Array(Math.ceil(((media ?? last + 60) + 10) * ALIGN_RATE)).fill(Number.NaN),
    expected,
    checkedAt: 0,
    pending: null,
    confirmed: false,
    movedAt: 0,
  };
  alignments.set(item.id, alignment);
  if (alignments.size > 40) alignments.delete(alignments.keys().next().value!);
  return alignment;
}

const lyricsOffset = (itemId: string | undefined) => (itemId ? alignments.get(itemId)?.offset ?? 0 : 0);

/** One reading of the audio at `position` (media time), from the player. */
function feedVoice(item: PlaybackItem, position: number, vr: number | undefined, vl: number | undefined): void {
  if (vr === undefined || vl === undefined) return;
  const info = songInfos.get(item.id);
  const alignment = info ? alignmentFor(item, info) : null;
  if (!alignment) return;
  const index = Math.round(position * ALIGN_RATE);
  if (index < 0 || index >= alignment.heard.length) return;
  // A quiet passage says nothing about singing: it counts as the least singing there is.
  alignment.heard[index] = vl < -62 ? -6 : vr;
  if (alignment.source === "manual" || !alignment.engaged) return;
  const now = performance.now();
  if (now - alignment.checkedAt < 2000) return;
  alignment.checkedAt = now;
  realign(alignment, index);
}

/**
 * Finds the offset at which the expected singing best matches what was heard over the last
 * ALIGN_WINDOW seconds (Pearson correlation). The lyrics move only for a clearly better match,
 * seen twice in a row, so a noisy passage can't throw them around.
 */
function realign(alignment: Alignment, now: number): void {
  const { heard, expected } = alignment;
  const positions: number[] = [];
  const values: number[] = [];
  for (let j = Math.max(0, now - ALIGN_WINDOW * ALIGN_RATE); j <= now; j++) {
    const value = heard[j]!;
    if (!Number.isNaN(value)) { positions.push(j); values.push(value); }
  }
  const n = values.length;
  if (n < 15 * ALIGN_RATE) return;
  const meanX = values.reduce((sum, v) => sum + v, 0) / n;
  const stdX = Math.sqrt(values.reduce((sum, v) => sum + (v - meanX) ** 2, 0) / n);
  if (stdX < 0.5) return;
  const reach = Math.round(alignment.span * ALIGN_RATE);
  const currentK = Math.round(alignment.offset * ALIGN_RATE);
  let best = -1, bestK = currentK, current = -1;
  for (let k = -reach; k <= reach; k++) {
    let sy = 0, sxy = 0;
    for (let m = 0; m < n; m++) {
      const at = positions[m]! - k;
      const y = at >= 0 && at < expected.length ? expected[at]! : 0;
      sy += y;
      sxy += (values[m]! - meanX) * y;
    }
    // The window has to hold both singing and gaps at this offset to say anything.
    const meanY = sy / n, varY = meanY - meanY * meanY;
    if (sy < 3 * ALIGN_RATE || varY < 0.02) continue;
    const corr = sxy / n / (stdX * Math.sqrt(varY));
    if (corr > best) { best = corr; bestK = k; }
    if (k === currentK) current = corr;
  }
  const offset = bestK / ALIGN_RATE;
  const needed = n < 25 * ALIGN_RATE ? 0.45 : 0.32;
  // The best match is where the lyrics already are, give or take what the measure can tell:
  // they're right (the extra length is elsewhere).
  if (best >= needed && Math.abs(offset - alignment.offset) < 0.5) {
    alignment.pending = null;
    if (!alignment.confirmed) { alignment.confirmed = true; notify(); }
    return;
  }
  // Once lined up, moving again takes a clearly better match, seen three times, and not too soon.
  const settled = alignment.source === "auto";
  if (best < needed || best - current < (settled ? 0.15 : 0.1)) { alignment.pending = null; return; }
  if (alignment.pending && Math.abs(alignment.pending.offset - offset) <= 0.3) alignment.pending.count++;
  else alignment.pending = { offset, count: 1 };
  if (alignment.pending.count < (settled ? 3 : 2)) return;
  if (settled && performance.now() - alignment.movedAt < 20_000) return;
  alignment.movedAt = performance.now();
  alignment.offset = offset;
  alignment.source = "auto";
  alignment.pending = null;
  alignment.confirmed = true;
  notify();
}

function nudgeSync(item: PlaybackItem, info: SongInfo, seconds: number | null): void {
  const alignment = alignmentFor(item, info);
  if (!alignment) return;
  if (seconds === null) {
    rememberSync(alignment.key, null);
    alignment.offset = 0;
    alignment.source = "none";
    alignment.checkedAt = 0;
    alignment.pending = null;
    alignment.confirmed = false;
  } else {
    alignment.offset = Math.round((alignment.offset + seconds) * 10) / 10;
    alignment.source = "manual";
    rememberSync(alignment.key, alignment.offset);
  }
  notify();
}

const signed = (seconds: number) => `${seconds > 0 ? "+" : seconds < 0 ? "−" : "±"}${Math.abs(seconds).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}s`;

/** How the lyrics are lined up, and a nudge either way when the ear disagrees. */
function SyncControl({ item, info }: { item: PlaybackItem; info: SongInfo }) {
  const state = useSyncExternalStore(subscribe, () => {
    const a = alignments.get(item.id);
    return a ? `${a.source}|${a.offset}|${a.engaged && !a.confirmed ? 1 : 0}` : "none|0|0";
  });
  const [source, raw, engaged] = state.split("|");
  const offset = Number(raw);
  const label = source === "manual" ? translate("song.syncManual", { p0: signed(offset) })
    : source === "auto" ? translate("song.syncAuto", { p0: signed(offset) })
    : engaged === "1" ? translate("song.syncAligning") : translate("song.syncOk");
  return (
    <div className={`song-sync${source !== "none" ? " adjusted" : ""}`} role="group" aria-label={translate("song.sync")}>
      <button type="button" title={translate("song.syncEarlier")} aria-label={translate("song.syncEarlier")} onClick={() => nudgeSync(item, info, -0.5)}><Icon name="minus" size={13} /></button>
      <span className="song-sync-label">{source === "auto" && <Icon name="voice" size={12} />}{label}</span>
      <button type="button" title={translate("song.syncLater")} aria-label={translate("song.syncLater")} onClick={() => nudgeSync(item, info, 0.5)}><Icon name="plus" size={13} /></button>
      {source === "manual" && <button type="button" title={translate("song.syncReset")} aria-label={translate("song.syncReset")} onClick={() => nudgeSync(item, info, null)}><Icon name="reset" size={13} /></button>}
    </div>
  );
}

function LyricsLoading() {
  const line = useLoadingLine(LYRICS_LOADING, 1600);
  return (
    <div className="song-lyrics-skeleton" role="status">
      {[78, 56, 88, 64, 42].map((width, i) => <span key={i} style={{ width: `${width}%`, animationDelay: `${i * 120}ms` }} />)}
      <p key={line}><Icon name="voice" size={16} /> {line}</p>
    </div>
  );
}

/**
 * Karaoke: big lines, the one being sung in the middle; inside it only the words already sung
 * light up, the current one filling as it is sung, like a karaoke screen.
 */
function Lyrics({ item, info, loading, position, playing, onSeek }: { item: PlaybackItem; info: SongInfo | null; loading: boolean; position: () => number; playing: () => boolean; onSeek: ((seconds: number) => void) | null }) {
  const lines = info?.synced ?? null;
  const timeline = useMemo(() => lines?.map((line, i) => lineWords(line, lines[i + 1]?.time)) ?? null, [lines]);
  if (info && lines) alignmentFor(item, info);
  const box = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(-1);
  /** After the viewer scrolls the lyrics, leave them where they are for a while. */
  const manualUntil = useRef(0);
  const positionRef = useRef(position);
  positionRef.current = position;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const itemId = item.id;

  useEffect(() => {
    setActive(-1);
    box.current?.scrollTo({ top: 0 });
    if (!lines || !timeline) return;
    let frame = 0;
    let shownLine = -2;
    /** How lit each word of the shown line is (0–100), so only changes touch the page. */
    let lit: number[] = [];
    let last = 0;
    /** The lyrics' own clock: steady, never wobbling back and forth with the player's reports. */
    let clock = Number.NaN;
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      // About 30 updates a second is plenty for words filling up, and half the work of 60.
      if (now - last < 32 || document.hidden) return;
      const elapsed = last ? Math.min(0.25, (now - last) / 1000) : 0;
      last = now;
      // The player's position arrives in bursts and wobbles by a few hundredths of a second.
      // Followed as is, a word on the edge lights and dims over and over: instead the clock runs
      // on its own and leans towards the player's. Real jumps (a seek, a new offset) jump.
      const target = positionRef.current() - lyricsOffset(itemId);
      if (!playingRef.current() || !Number.isFinite(clock) || Math.abs(target - clock) > 1) clock = target;
      else { const predicted = clock + elapsed; clock = predicted + (target - predicted) * 0.12; }
      const time = clock;
      // The line comes into place a moment before its first word.
      const index = lineAt(lines, time + 0.3);
      if (index !== shownLine) { shownLine = index; lit = []; setActive(index); }
      const words = index >= 0 ? timeline[index]! : [];
      const el = index >= 0 ? box.current?.querySelector<HTMLElement>(`[data-line="${index}"]`) : null;
      if (!el || !words.length) return;
      const spans = el.children;
      for (let w = 0; w < words.length && w < spans.length; w++) {
        const word = words[w]!;
        const at = time + 0.04;
        const fill = at >= word.end ? 100 : at <= word.start ? 0 : Math.round(((at - word.start) / Math.max(0.05, word.end - word.start)) * 100);
        if (lit[w] !== fill) { lit[w] = fill; (spans[w] as HTMLElement).style.setProperty("--p", `${fill}%`); }
      }
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [lines, timeline, itemId]);

  useEffect(() => {
    const el = box.current;
    if (!el || Date.now() < manualUntil.current) return;
    const line = active >= 0 ? el.querySelector<HTMLElement>(`[data-line="${active}"]`) : null;
    el.scrollTo({ top: line ? line.offsetTop - el.clientHeight * 0.42 + line.offsetHeight / 2 : 0, behavior: "smooth" });
  }, [active]);

  const holdScroll = () => { manualUntil.current = Date.now() + 5000; };
  const credit = info && (info.synced || info.plain) ? `${info.synced ? "" : `${translate("song.lyricsUnsynced")} · `}${translate("song.lyricsSource")}` : null;

  let body;
  if (loading) body = <LyricsLoading />;
  else if (lines && timeline) {
    body = (
      <div ref={box} className="song-lyrics-lines synced" onWheel={holdScroll} onTouchMove={holdScroll} onKeyDown={holdScroll}>
        {lines.map((line, index) => {
          const state = index === active ? " active" : index < active ? " past" : index === active + 1 ? " next" : "";
          const words = timeline[index]!;
          // How far from the sung line: drives the Apple Music-like scale, blur and stagger.
          const distance = active < 0 ? Math.min(6, index + 1) : Math.min(6, Math.abs(index - active));
          const content = words.length ? words.map((word, w) => <span key={w} className="lyric-word">{word.text}</span>) : "♪";
          return onSeek ? (
            <button key={index} type="button" data-line={index} className={`lyric-line${state}`} style={{ "--d": distance } as CSSProperties} title={translate("song.lyricsSeek")} onClick={() => { manualUntil.current = 0; onSeek(line.time + lyricsOffset(itemId)); }}>{content}</button>
          ) : (
            <p key={index} data-line={index} className={`lyric-line${state}`} style={{ "--d": distance } as CSSProperties}>{content}</p>
          );
        })}
      </div>
    );
  } else if (info?.plain) {
    body = <div className="song-lyrics-lines plain">{info.plain.split(/\r?\n/).map((text, index) => <p key={index} className="lyric-line">{text || " "}</p>)}</div>;
  } else {
    body = <p className="song-lyrics-note"><Icon name="music" size={16} /> {info?.instrumental ? translate("song.instrumental") : translate("song.lyricsNone")}</p>;
  }

  return (
    <section className="song-lyrics" aria-label={translate("song.lyrics")}>
      {body}
      <div className="song-lyrics-foot">
        {info && lines && <SyncControl item={item} info={info} />}
        {credit && <span className="song-lyrics-credit">{credit}</span>}
      </div>
    </section>
  );
}

// Voice ribbon -------------------------------------------------------------------

/** The latest spectrum from this device's music player, read by the visualizer every frame. */
let spectrum: { levels: number[]; at: number } | null = null;
/** Visualizers on screen; the player only analyses its sound while one is showing. */
let visualizers = 0;
const useVisualizerShown = () => useSyncExternalStore(subscribe, () => visualizers > 0);

/**
 * The voice ribbon: the singer's range (about 140 Hz to 5 kHz) drawn as a mirrored, liquid
 * shape that swells from the middle when someone sings, like a voice memo's waveform. It is
 * also the progress bar: the part already played is lit, and a click seeks there.
 * Without the player's spectrum (media the page can't read, or not listening here) it keeps a
 * gentle breath while playing and lies flat when paused.
 */
function Visualizer({ playing, live, progress, onSeek, label }: { playing: boolean; live: boolean; progress?: () => number | null; onSeek?: ((fraction: number) => void) | null; label?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const progressRef = useRef(progress);
  progressRef.current = progress;

  useEffect(() => {
    if (!live) return;
    visualizers++;
    notify();
    return () => { visualizers--; notify(); };
  }, [live]);

  useEffect(() => {
    const el = canvas.current;
    const g = el?.getContext("2d");
    if (!el || !g) return;
    const POINTS = 64;
    const shown = new Float32Array(POINTS);
    const smooth = new Float32Array(POINTS);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let peak = 0.4;
    let frame = 0;
    let last = 0;
    let lit = "", dim = "";
    let colorAt = -Infinity;
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      // Hidden windows and 60 fps for a ribbon are both a waste: about 40 fps is smooth to the eye.
      if (document.hidden || now - last < 24) return;
      last = now;
      const width = el.clientWidth, height = el.clientHeight, ratio = devicePixelRatio || 1;
      if (!width || !height) return;
      if (el.width !== Math.round(width * ratio) || el.height !== Math.round(height * ratio)) {
        el.width = Math.round(width * ratio);
        el.height = Math.round(height * ratio);
      }
      // The colours follow the theme; look them up now and then, not every frame.
      if (now - colorAt > 1000) {
        const style = getComputedStyle(el);
        lit = style.color;
        dim = style.getPropertyValue("--ribbon-dim").trim() || "rgba(255,255,255,.22)";
        colorAt = now;
      }
      const fresh = live && spectrum && performance.now() - spectrum.at < 400 ? spectrum.levels : null;
      if (fresh) {
        let loudest = 0;
        for (const level of fresh) loudest = Math.max(loudest, level / 255);
        // Up at once, down slowly: the shape survives quiet verses and loud choruses alike.
        peak = loudest > peak ? loudest : Math.max(0.16, peak * 0.996 + loudest * 0.004);
      }
      const t = now / 1000;
      const half = (POINTS - 1) / 2;
      for (let i = 0; i < POINTS; i++) {
        // Mirrored: the voice's body (its lowest bands) in the middle, its air towards both ends.
        const away = Math.abs(i - half) / half;
        let target: number;
        if (!playingRef.current) target = 0.035;
        else if (fresh) {
          const at = away * (fresh.length - 1);
          const lo = Math.floor(at), hi = Math.min(fresh.length - 1, lo + 1);
          const raw = (fresh[lo]! * (1 - (at - lo)) + fresh[hi]! * (at - lo)) / 255;
          target = Math.min(1, Math.pow(raw / peak, 1.8) * (1 - away * 0.35));
        } else if (reduced) target = 0.18 * (1 - away * 0.6);
        else target = Math.max(0.04, (0.2 + 0.2 * Math.sin(t * 2.1 + away * 4) * Math.sin(t * 0.9 + i * 0.09) + 0.1 * Math.sin(t * 4.3 + away * 9)) * (1 - away * 0.55));
        shown[i] = shown[i]! + (target - shown[i]!) * (target > shown[i]! ? 0.34 : 0.1);
      }
      for (let i = 0; i < POINTS; i++) smooth[i] = (shown[Math.max(0, i - 1)]! + 2 * shown[i]! + shown[Math.min(POINTS - 1, i + 1)]!) / 4;

      const mid = height / 2, reach = mid - 1.5, step = width / (POINTS - 1);
      const amp = (v: number) => Math.max(1.2, v * reach);
      const ribbon = new Path2D();
      ribbon.moveTo(0, mid - amp(smooth[0]!));
      for (let i = 1; i < POINTS; i++) ribbon.quadraticCurveTo((i - 1) * step, mid - amp(smooth[i - 1]!), (i - 0.5) * step, mid - (amp(smooth[i - 1]!) + amp(smooth[i]!)) / 2);
      ribbon.lineTo(width, mid - amp(smooth[POINTS - 1]!));
      ribbon.lineTo(width, mid + amp(smooth[POINTS - 1]!));
      for (let i = POINTS - 1; i > 0; i--) ribbon.quadraticCurveTo(i * step, mid + amp(smooth[i]!), (i - 0.5) * step, mid + (amp(smooth[i]!) + amp(smooth[i - 1]!)) / 2);
      ribbon.lineTo(0, mid + amp(smooth[0]!));
      ribbon.closePath();

      g.setTransform(ratio, 0, 0, ratio, 0, 0);
      g.clearRect(0, 0, width, height);
      const done = progressRef.current?.() ?? null;
      g.fillStyle = done === null ? lit : dim;
      g.fill(ribbon);
      if (done !== null) {
        const x = Math.max(0, Math.min(1, done)) * width;
        g.save();
        g.beginPath();
        g.rect(0, 0, x, height);
        g.clip();
        g.fillStyle = lit;
        g.fill(ribbon);
        g.restore();
        // The playhead.
        g.fillStyle = lit;
        g.beginPath();
        g.roundRect(Math.max(0, x - 1), 2, 2, height - 4, 1);
        g.fill();
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [live]);

  const seekable = !!onSeek;
  return (
    <canvas
      ref={canvas}
      className={`song-visualizer${playing ? " playing" : ""}${seekable ? " seekable" : ""}`}
      role={progress ? "progressbar" : undefined}
      aria-label={label}
      aria-hidden={progress ? undefined : true}
      onClick={seekable ? (e) => { const r = e.currentTarget.getBoundingClientRect(); onSeek!(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))); } : undefined}
    />
  );
}

// Volume ---------------------------------------------------------------------------

function VolumeControl({ compact = false }: { compact?: boolean }) {
  const volume = useMusicVolume();
  const restore = useRef(volume || 0.8);
  if (volume > 0) restore.current = volume;
  const percent = Math.round(volume * 100);
  const fromPointer = (el: HTMLElement, clientX: number) => {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0) setMusicVolume((clientX - rect.left) / rect.width);
  };
  return (
    <span className={`song-volume${compact ? " compact" : ""}`}>
      <button type="button" className="song-volume-mute" title={volume ? translate("song.mute") : translate("song.unmute")} aria-label={volume ? translate("song.mute") : translate("song.unmute")} onClick={() => setMusicVolume(volume ? 0 : restore.current)}>
        <Icon name={volume ? "speaker" : "volumeOff"} size={compact ? 14 : 16} />
      </button>
      {/* Drawn by hand: the app's input styles would turn a native range into a text field. */}
      <span
        className="song-slider"
        role="slider"
        tabIndex={0}
        aria-label={translate("song.volume")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}%`}
        title={`${percent}%`}
        style={{ "--fill": `${percent}%` } as CSSProperties}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); fromPointer(e.currentTarget, e.clientX); }}
        onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e.currentTarget, e.clientX); }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.05;
          const next = e.key === "ArrowRight" || e.key === "ArrowUp" ? volume + step : e.key === "ArrowLeft" || e.key === "ArrowDown" ? volume - step : e.key === "Home" ? 0 : e.key === "End" ? 1 : null;
          if (next === null) return;
          e.preventDefault();
          setMusicVolume(next);
        }}
      >
        <span className="song-slider-fill" />
      </span>
      {!compact && <Icon name="speaker" size={16} />}
    </span>
  );
}

// DJ ---------------------------------------------------------------------------------

type DjPreset = Exclude<DjStyle, "auto">;
const DJ_PRESETS: readonly DjPreset[] = ["smooth", "filter", "echo", "brake", "bassswap", "riser"];
/** How long each transition plays both tracks. */
const DJ_SECONDS: Record<DjPreset, number> = { smooth: 8, filter: 8, echo: 6, brake: 2.5, bassswap: 10, riser: 7 };
/** "auto" picks a transition per track from its id, so every listener hears the same one. */
function presetFor(style: DjStyle | undefined, nextId: string): DjPreset {
  return style && style !== "auto" ? style : DJ_PRESETS[hueOf(nextId) % DJ_PRESETS.length]!;
}
const djLabel = (style: DjStyle) => translate(`song.dj.${style}`);

type Deck = "music" | "musicB";
const DECKS: readonly Deck[] = ["music", "musicB"];
const otherDeck = (deck: Deck): Deck => (deck === "music" ? "musicB" : "music");

/** Plays the room's current item on `deck` and keeps it in sync. Decks are opened and closed by the player. */
function useDeckDriver(deck: Deck, playback: Playback, media: HTMLMediaElement | null, syncing: boolean): void {
  const item = currentItem(playback.state);
  const [driver, setDriver] = useState<Driver | null>(null);
  const events = useRef<UserEvents | null>(null);
  const latest = useRef(playback);
  latest.current = playback;
  const view = inView(item);
  const url = item?.url;
  const kind = item?.kind;
  useEffect(() => {
    if (view) {
      if (!url || !kind) return;
      // Joining mid-song starts there, not from the top (the sync loop then trims the rest).
      const { state, offset } = latest.current;
      // A paused room opens held: no autoplayed second that the room then stops. Its play releases it.
      window.annoy?.theater.open(deck, url, kind, { start: state ? playbackPosition(state, offset) : 0, hold: !!state?.paused });
      const made = viewDriver(deck, () => events.current!);
      setDriver(made.driver);
      return () => { made.dispose(); setDriver(null); };
    }
    if (!media) return;
    const made = elementDriver(media, () => events.current!);
    setDriver(made.driver);
    return () => { made.dispose(); setDriver(null); };
  }, [deck, view, url, kind, media]);
  events.current = useSync(driver, playback, syncing);
}

// Room -----------------------------------------------------------------------

/** Joining or leaving animates between the invitation and the player: the cover flies across. */
function withTransition(change: () => void): void {
  const doc = document as Document & { startViewTransition?: (update: () => void) => unknown };
  if (!doc.startViewTransition || songLite || matchMedia("(prefers-reduced-motion: reduce)").matches) return change();
  doc.startViewTransition(() => flushSync(change));
}

function UpNext({ playback, onOpen }: { playback: Playback; onOpen: () => void }) {
  const state = playback.state;
  const item = currentItem(state);
  useSyncExternalStore(subscribe, () => songInfos.size);
  if (!state || !item) return null;
  const index = state.queue.findIndex((entry) => entry.id === item.id);
  const next = state.queue[index + 1];
  const info = next ? songInfos.get(next.id) : undefined;
  return (
    <button type="button" className="song-upnext" onClick={onOpen}>
      <span className="song-upnext-label">{translate("song.upNextTitle")} <span>· {translate("song.positionOf", { p0: index + 1, p1: state.queue.length })}</span></span>
      {next ? (
        <span className="song-upnext-track">
          <QueueThumb item={next} />
          <span className="song-upnext-copy">
            <strong className="truncate">{info?.track ?? next.title}</strong>
            <small className="truncate">{info?.artist ?? KIND_LABEL[next.kind]}{state.dj ? ` · ${djLabel(presetFor(state.djStyle, next.id))}` : ""}</small>
          </span>
          <Icon name="right" size={16} />
        </span>
      ) : (
        <span className="song-upnext-empty"><Icon name="plus" size={14} /> {translate("song.queueEmptyHint")}</span>
      )}
    </button>
  );
}

function SongPanel({ playback, here, lite, canControl, canSkip, names, info, loading, duration, position, video, onVideo, onRequest, onSeek, onQueue }: {
  playback: Playback; here: boolean; lite: boolean; canControl: boolean; canSkip: boolean; names: Map<string, string>;
  info: SongInfo | null; loading: boolean; duration: number | null; position: () => number; video: boolean; onVideo: (next: boolean) => void;
  onRequest: () => void; onSeek: ((seconds: number) => void) | null; onQueue: () => void;
}) {
  const { state, send } = playback;
  const item = currentItem(state);
  const ducked = useDucked();
  const mixing = useMixing();
  useTick(1000, !!item);
  const playing = !!item && !state?.paused;
  const requester = item ? names.get(item.addedBy) ?? translate("common.11bf7e98a3f1") : "";
  const canVideo = here && inView(item) && !lite;
  const showVideo = canVideo && video;
  const at = position();
  const buffering = here && playing && !sounding(item?.id);
  const fraction = () => (duration ? Math.min(1, positionOf(playback, item?.id, here) / duration) : null);
  const seekTo = onSeek && duration ? (f: number) => onSeek(f * duration) : null;

  if (!item || !state) {
    return (
      <div className="song-panel empty">
        <div className="song-stage"><SongCover info={null} item={null} spinning={false} /></div>
        <h2 className="song-title">{translate("common.29f1d2c89080")}</h2>
        <p className="song-empty-hint">{translate("song.emptyHint")}</p>
        {canControl && <button className="song-invite-join small" onClick={onRequest}><Icon name="plus" size={16} /> {translate("song.request")}</button>}
      </div>
    );
  }

  const album = info?.album ? (info.year ? `${info.album} · ${info.year}` : info.album) : null;
  return (
    <div className="song-panel">
      <div className={`song-stage${showVideo ? " video" : ""}`}>
        {showVideo ? <div className="song-video" ref={setVideoSlot} /> : <SongCover info={info} item={item} spinning={playing && here && !lite} loading={loading} />}
        {buffering && !showVideo && <span className="song-stage-buffer" role="status"><span className="song-loader-eq small" aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <i key={i} />)}</span>{translate("song.tuning")}</span>}
        {canVideo && (
          <button type="button" className="song-stage-toggle" onClick={() => onVideo(!video)}>
            <Icon name={showVideo ? "image" : "film"} size={14} /> {showVideo ? translate("song.showCover") : translate("song.showVideo")}
          </button>
        )}
      </div>

      <div className="song-meta">
        <h2 className="song-title" title={item.title}>{info?.track ?? item.title}</h2>
        {loading && !info ? <span className="song-skeleton-line" aria-hidden="true" /> : <span className="song-subtitle truncate">{info?.artist ?? KIND_LABEL[item.kind]}</span>}
        <span className="song-album truncate">
          {mixing ? <span className="song-mixing"><Icon name="disc" size={12} /> {translate("song.mixing", { p0: djLabel(mixing) })}</span>
            : buffering ? translate("song.tuning")
            : [album, translate("song.requestedBy", { p0: requester })].filter(Boolean).join(" · ")}
        </span>
      </div>

      <div className="song-progress">
        {lite ? (
          <span className={`song-track${seekTo ? " seekable" : ""}`} role="progressbar" aria-label={translate("song.progress")} aria-valuemin={0} aria-valuemax={duration ? Math.round(duration) : undefined} aria-valuenow={Math.round(at)}
            onClick={seekTo ? (e) => { const r = e.currentTarget.getBoundingClientRect(); seekTo(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))); } : undefined}>
            <span style={{ width: `${duration ? Math.min(100, (at / duration) * 100) : 0}%` }} />
          </span>
        ) : (
          <Visualizer playing={playing && !buffering} live={here} progress={fraction} onSeek={seekTo} label={translate("song.progress")} />
        )}
        <span className="song-times"><span>{clock(at)}</span><span>{duration ? `-${clock(Math.max(0, duration - at))}` : "--:--"}</span></span>
      </div>

      <div className="song-transport">
        <button className={`song-toggle${state.autoplay ? " on" : ""}`} aria-pressed={state.autoplay} disabled={!canControl} title={translate("common.aaae0f8a9481")} aria-label={translate("common.aaae0f8a9481")} onClick={() => void send({ op: "autoplay", value: !state.autoplay })}>
          <Icon name="repeat" size={17} />
        </button>
        <button className={`song-play${buffering ? " buffering" : ""}`} disabled={!canControl} onClick={() => void send(state.paused ? { op: "play" } : { op: "pause", position: at })} title={state.paused ? translate("common.ca0709c34209") : translate("common.c1301275ce3f")} aria-label={state.paused ? translate("common.ca0709c34209") : translate("common.c1301275ce3f")}>
          <Icon name={state.paused ? "play" : "pause"} size={26} />
        </button>
        <button className="song-skip" disabled={!canSkip} onClick={() => void send({ op: "next" })} title={translate("common.4a1772b0c06a")} aria-label={translate("common.4a1772b0c06a")}>
          <Icon name="skip" size={20} />
        </button>
        {state.dj !== undefined ? (
          <button className={`song-toggle${state.dj ? " on" : ""}`} aria-pressed={state.dj} disabled={!canControl} title={translate("song.djHint")} aria-label={translate("song.dj")} onClick={() => void send({ op: "dj", value: !state.dj })}>
            <Icon name="disc" size={17} />
          </button>
        ) : <span />}
      </div>

      {state.dj && (
        <div className="song-dj" role="radiogroup" aria-label={translate("song.djStyle")}>
          {DJ_STYLES.map((style) => (
            <button key={style} role="radio" aria-checked={(state.djStyle ?? "auto") === style} className={`song-dj-style${(state.djStyle ?? "auto") === style ? " on" : ""}`} disabled={!canControl} onClick={() => void send({ op: "dj", value: true, style })}>
              {djLabel(style)}
            </button>
          ))}
        </div>
      )}

      {here && <VolumeControl />}

      <UpNext playback={playback} onOpen={onQueue} />

      <div className="song-options">
        {canControl && <button className="song-pill primary" onClick={onRequest}><Icon name="plus" size={13} /> {translate("song.request")}</button>}
        {state.ducking !== undefined && (
          <button className={`song-pill${state.ducking ? " on" : ""}`} aria-pressed={state.ducking} disabled={!canControl} title={translate("song.duckingHint")} onClick={() => void send({ op: "ducking", value: !state.ducking })}>
            <Icon name="mic" size={13} /> {translate("song.ducking")}
          </button>
        )}
        <button className={`song-pill${lite ? " on" : ""}`} aria-pressed={lite} title={translate("song.liteHint")} onClick={() => withTransition(() => setSongLite(!lite))}>
          <Icon name="feather" size={13} /> {translate("song.lite")}
        </button>
      </div>
      {here && ducked && <span className="song-ducked" role="status"><Icon name="mic" size={13} /> {translate("song.ducked")}</span>}
    </div>
  );
}

/** What someone who hasn't joined sees: what's on, big and inviting, and one button to come in. */
function SongInvite({ playback, info, loading, names, channel, canControl, onJoin }: { playback: Playback; info: SongInfo | null; loading: boolean; names: Map<string, string>; channel: Channel; canControl: boolean; onJoin: () => void }) {
  const state = playback.state!;
  const item = currentItem(state)!;
  const index = state.queue.findIndex((entry) => entry.id === item.id);
  const next = state.queue[index + 1];
  const requester = names.get(item.addedBy) ?? translate("common.11bf7e98a3f1");
  const album = info?.album ? (info.year ? `${info.album} · ${info.year}` : info.album) : null;
  return (
    <div className="song-invite">
      <div className="song-invite-art">
        <span className={`song-invite-vinyl${state.paused ? "" : " spinning"}`} aria-hidden="true"><span /></span>
        <div className="song-invite-cover"><SongCover info={info} item={item} spinning={false} loading={loading} /></div>
      </div>
      <div className="song-invite-copy">
        <span className="song-invite-eyebrow">
          {state.paused ? <Icon name="pause" size={12} /> : <span className="song-live-dot" aria-hidden="true" />}
          {translate(state.paused ? "song.pausedIn" : "song.liveIn", { p0: channel.name })}
        </span>
        <h2 className="song-invite-title" title={item.title}>{info?.track ?? item.title}</h2>
        {loading && !info ? <span className="song-skeleton-line wide" aria-hidden="true" /> : <p className="song-invite-artist">{[info?.artist, album].filter(Boolean).join(" · ") || KIND_LABEL[item.kind]}</p>}
        {!songLite && <Visualizer playing={!state.paused} live={false} />}
        <button type="button" className="song-invite-join" onClick={onJoin} autoFocus>
          <Icon name={state.paused && canControl ? "play" : "headphones"} size={20} /> {translate(state.paused && canControl ? "song.playAndJoin" : "song.listenHere")}
        </button>
        {state.paused && !canControl && <p className="song-invite-meta">{translate("song.roomPaused")}</p>}
        <p className="song-invite-meta">
          {translate("song.requestedBy", { p0: requester })} · {translate("song.positionOf", { p0: index + 1, p1: state.queue.length })}
          {next && <> · {translate("song.upNext")} <strong>{songInfos.get(next.id)?.track ?? next.title}</strong></>}
        </p>
      </div>
    </div>
  );
}

export function SongView({ accountId, state, channel, perms }: { accountId: string; state: ServerState; channel: Channel; perms: number }) {
  const playback = usePlayback(accountId, channel.id);
  const me = useStore((s) => s.instances[accountId]?.user?.id ?? "");
  const names = useNames(state);
  const current = useListening();
  const lite = useSongLite();
  const here = current?.accountId === accountId && current.channelId === channel.id;
  const item = currentItem(playback.state);
  const canControl = has(perms, Permission.SEND_MESSAGES);
  const canSkip = has(perms, Permission.MANAGE_MESSAGES) || item?.addedBy === me;
  const queued = playback.state?.queue.length ?? 0;
  const known = useDuration(item?.id);
  const { info, loading } = useSongInfo(item, known);
  const duration = known ?? info?.duration ?? null;
  const [video, setVideo] = useState(false);
  const [side, setSide] = useState<"chat" | "queue">("chat");
  const [requested, setRequested] = useState(0);
  // "Request a song" opens the queue and puts the cursor in its field.
  useEffect(() => {
    if (!requested) return;
    const frame = requestAnimationFrame(() => document.getElementById(songRequestId(channel.id))?.focus());
    return () => cancelAnimationFrame(frame);
  }, [requested, channel.id]);
  // The room re-renders only on its own changes; the clock lives in the panel, so the chat
  // beside it doesn't redraw every second.
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const itemId = item?.id;
  const position = useCallback(() => positionOf(playbackRef.current, itemId, here), [itemId, here]);
  const playing = useCallback(() => {
    const room = playbackRef.current.state;
    return !!room && !room.paused && (!here || sounding(itemId));
  }, [itemId, here]);
  const seek = canControl && item ? (seconds: number) => void playback.send({ op: "seek", position: Math.max(0, seconds - 0.1) }) : null;
  const join = () => {
    withTransition(() => listenTo({ accountId, serverId: state.server.id, channelId: channel.id, name: channel.name }));
    // Joining a paused room means wanting to hear it: whoever may control it plays it.
    if (playback.state?.paused && item && canControl) void playback.send({ op: "play" });
  };
  const leave = () => withTransition(() => listenTo(null));
  const inviting = !here && !!item;
  const cover = !lite ? info?.cover ?? null : null;
  const firstLoad = playback.loading && !playback.state;

  return (
    <section className={`chat song-room${inviting ? " inviting" : " joined"}${lite ? " lite" : ""}`} style={{ "--art-hue": hueOf(item?.title ?? channel.name) } as CSSProperties}>
      <div className="song-ambient" aria-hidden="true">
        {cover && <img key={cover} src={cover} alt="" referrerPolicy="no-referrer" />}
        {!lite && <><span className="song-aurora one" /><span className="song-aurora two" /><span className="song-aurora three" /></>}
      </div>
      <header className="chat-header song-header">
        <span className="song-header-icon"><Icon name="song" size={17} /></span>
        <h1 className="truncate">{channel.name}</h1>
        <span className="chat-topic">{channel.topic || translate("common.58547828fc8e")}</span>
        {here && <span className="song-header-pill"><span className="song-live-dot" aria-hidden="true" /> {translate("song.listening")}</span>}
        {here ? (
          <button className="song-glass-btn" onClick={leave}>{rich("common.3f4403be164d",{p0:(<Icon name="volumeOff" size={15} />)})}</button>
        ) : !item && !firstLoad && (
          <button className="song-glass-btn" onClick={join}>{rich("common.89b5c2ca7704",{p0:(<Icon name="headphones" size={15} />)})}</button>
        )}
      </header>
      {firstLoad ? (
        <SongLoader />
      ) : inviting ? (
        <SongInvite playback={playback} info={info} loading={loading} names={names} channel={channel} canControl={canControl} onJoin={join} />
      ) : (
        <div className="song-body">
          <div className={`song-main${item ? "" : " idle"}`}>
            <PlaybackFeedback playback={playback} />
            <div className="song-layout">
              <SongPanel
                playback={playback} here={here} lite={lite} canControl={canControl} canSkip={canSkip} names={names} info={info} loading={loading} duration={duration}
                position={position} video={video} onVideo={setVideo} onSeek={seek} onQueue={() => setSide("queue")}
                onRequest={() => { setSide("queue"); setRequested((n) => n + 1); }}
              />
              {item && !lite && <Lyrics key={item.id} item={item} info={info} loading={loading} position={position} playing={playing} onSeek={seek} />}
            </div>
          </div>
          <aside className="theater-side song-side" aria-label={translate("song.chat")}>
            <div className="song-tabs" role="tablist" aria-label={translate("common.ded83118d934")} data-active={side}>
              <span className="song-tabs-glider" aria-hidden="true" />
              <button role="tab" aria-selected={side === "chat"} onClick={() => setSide("chat")}><Icon name="message" size={14} /> {translate("common.460b3a7da007")}</button>
              <button role="tab" aria-selected={side === "queue"} onClick={() => setSide("queue")}><Icon name="song" size={14} /> {translate("song.queue")}{queued ? <span className="song-tabs-count">{queued}</span> : null}</button>
            </div>
            {side === "chat" ? (
              <RoomChat accountId={accountId} state={state} channel={channel} perms={perms} />
            ) : (
              <Queue accountId={accountId} channel={channel} playback={playback} perms={perms} me={me} names={names} audioOnly song />
            )}
          </aside>
        </div>
      )}
    </section>
  );
}

// Player -----------------------------------------------------------------------------

/** Drags the floating mini player by its handle; where it's dropped is where it stays. */
function useFloating(box: RefObject<HTMLElement | null>) {
  const [at, setAt] = useState(dockAt);
  const [dragging, setDragging] = useState(false);
  const [, relayout] = useState(0);
  const start = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  useEffect(() => {
    const onResize = () => relayout((n) => n + 1);
    window.addEventListener("resize", onResize);
    relayout((n) => n + 1);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const margin = 8;
  const width = box.current?.offsetWidth ?? 560, height = box.current?.offsetHeight ?? 56;
  const freeX = Math.max(0, window.innerWidth - width - margin * 2), freeY = Math.max(0, window.innerHeight - height - margin * 2);
  const left = margin + at.x * freeX, top = margin + at.y * freeY;
  const place = (x: number, y: number) => setAt({ x: freeX ? Math.min(1, Math.max(0, (x - margin) / freeX)) : 0.5, y: freeY ? Math.min(1, Math.max(0, (y - margin) / freeY)) : 0 });
  return {
    style: { left: Math.round(left), top: Math.round(top) } as CSSProperties,
    dragging,
    handle: {
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, y: e.clientY, left, top };
        setDragging(true);
      },
      onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
        const s = start.current;
        if (s) place(s.left + e.clientX - s.x, s.top + e.clientY - s.y);
      },
      onPointerUp: () => {
        start.current = null;
        setDragging(false);
        setAt((value) => { dockAt = value; writeLocal(DOCK_KEY, JSON.stringify(value)); return value; });
      },
      onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => {
        const step = e.shiftKey ? 40 : 12;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        if (!dx && !dy) return;
        e.preventDefault();
        place(left + dx, top + dy);
      },
    },
  };
}

/** The floating mini player: the music keeps going (and stays at hand) anywhere in the app. */
function SongPlayer({ session }: { session: Listening }) {
  const playback = usePlayback(session.accountId, session.channelId);
  const state = playback.state;
  const item = currentItem(state);
  const itemId = item?.id;
  const view = inView(item);
  const [audio, setAudio] = useState<HTMLVideoElement | null>(null);
  const slot = useVideoSlot();
  const latest = useRef(playback);
  latest.current = playback;

  // Two decks, so DJ mode can play the next track while the current one plays out. The deck an
  // item was loaded on keeps it: a track mixed in is never loaded twice.
  const decks = useRef({ current: "music" as Deck, assigned: new Map<string, Deck>(), preload: null as { deck: Deck; itemId: string } | null });
  const deck = (itemId && decks.current.assigned.get(itemId)) || decks.current.current;
  decks.current.current = deck;
  const deckRef = useRef(deck);
  deckRef.current = deck;
  /** The deck playing out a transition, and for how long. */
  const [tail, setTail] = useState<{ deck: Deck; seconds: number; itemId: string } | null>(null);
  useDeckDriver(deck, playback, view ? null : audio, tail?.deck !== deck);
  useViewBounds(deck, slot, view && !!slot?.isConnected);

  // The room can lower the music for everyone while people in their call talk.
  const talking = useCallTalking();
  const duck = !!item && (state?.ducking ?? true) && talking;
  useEffect(() => setDucked(duck), [duck]);
  useEffect(() => () => { setDucked(false); setMixing(null); }, []);
  const volume = useMusicVolume() * (duck ? DUCKED_VOLUME : 1);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  useElementVolume(view ? null : audio, volume);

  // Pages fade themselves; volume and spectrum are asked again on every status, so a newly
  // loaded track gets them too. Only the active deck speaks for the room.
  const wantLevels = useVisualizerShown() && !songLite;
  useEffect(() => {
    const bridge = window.annoy?.theater;
    if (!bridge || !view || !itemId) return;
    const ask = () => {
      for (const d of DECKS) bridge.control(d, { action: "volume", volume });
      bridge.control(deck, { action: "levels", on: wantLevels });
      bridge.control(otherDeck(deck), { action: "levels", on: false });
    };
    ask();
    const offStatus = bridge.on("status", (from, status) => {
      if (from !== deckRef.current) return;
      ask();
      tickLocal(itemId, status.position, status.paused);
      if (status.duration) rememberDuration(itemId, status.duration);
    });
    const offLevels = bridge.on("levels", (from, payload) => {
      if (from !== deckRef.current) return;
      spectrum = { levels: payload.levels, at: performance.now() };
      tickLocal(itemId, payload.position, false);
      const playing = currentItem(latest.current.state);
      if (playing?.id === itemId) feedVoice(playing, payload.position, payload.vr, payload.vl);
    });
    return () => { offStatus(); offLevels(); spectrum = null; };
  }, [view, itemId, volume, wantLevels, deck]);

  const known = useDuration(itemId);
  const { info } = useSongInfo(item, known);
  const duration = known ?? info?.duration ?? null;

  // DJ mode: shortly before the end, load the next track on the other deck (held, silent);
  // at the mix point start it with its transition, play this one out, and move the room on.
  // Every listener does this at the same room time, so everyone hears the same mix.
  const index = state && item ? state.queue.findIndex((entry) => entry.id === item.id) : -1;
  const next = index >= 0 ? state!.queue[index + 1] : undefined;
  const preset = next ? presetFor(state?.djStyle, next.id) : null;
  const dj = state?.dj === true && !!state.autoplay;
  useEffect(() => {
    const bridge = window.annoy?.theater;
    if (!bridge || !dj || !item || !next || !preset || !view || !inView(next) || !duration || state?.paused || tail) return;
    const seconds = DJ_SECONDS[preset];
    const remaining = duration - positionOf(latest.current, item.id, true);
    // Joined (or skipped) too close to the end for this one: it simply ends.
    if (remaining < seconds + 1.5) return;
    const target = otherDeck(deck);
    const timers = [
      setTimeout(() => {
        decks.current.assigned.set(next.id, target);
        decks.current.preload = { deck: target, itemId: next.id };
        bridge.open(target, next.url, next.kind, { hold: true });
      }, Math.max(0, remaining - seconds - 20) * 1000),
      setTimeout(() => {
        if (decks.current.preload?.itemId !== next.id) return;
        setMixing(preset);
        setTail({ deck, seconds, itemId: item.id });
        bridge.control(target, { action: "volume", volume: volumeRef.current });
        bridge.control(target, { action: "fx", preset, role: "in", seconds });
        bridge.control(target, { action: "play", position: 0 });
        bridge.control(deck, { action: "fx", preset, role: "out", seconds });
        void latest.current.send({ op: "ended", itemId: item.id });
      }, (remaining - seconds) * 1000),
    ];
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rescheduled on any room change (seek, queue, pause)
  }, [dj, itemId, next?.id, preset, view, duration, deck, state?.paused, state?.updatedAt, tail]);

  // The deck that played out a transition closes once it's done.
  useEffect(() => {
    if (!tail) return;
    const timer = setTimeout(() => {
      // The room didn't move on (a lost request): ask again rather than leave it silent.
      if (latest.current.state?.currentId === tail.itemId) void latest.current.send({ op: "ended", itemId: tail.itemId });
      else window.annoy?.theater.close(tail.deck);
      decks.current.preload = null;
      setTail(null);
      setMixing(null);
    }, (tail.seconds + 0.8) * 1000);
    return () => clearTimeout(timer);
  }, [tail]);

  // A deck nobody plays from closes; one still sounding fades out first instead of cutting off.
  useEffect(() => {
    const bridge = window.annoy?.theater;
    if (!bridge) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const d of DECKS) {
      const inUse = (view && d === deck) || tail?.deck === d || decks.current.preload?.deck === d;
      if (inUse) continue;
      bridge.control(d, { action: "fx", preset: "smooth", role: "out", seconds: 1 });
      timers.push(setTimeout(() => {
        const stillFree = !((inView(currentItem(latest.current.state)) && d === deckRef.current) || decks.current.preload?.deck === d);
        if (stillFree) bridge.close(d);
      }, 1200));
    }
    return () => timers.forEach(clearTimeout);
  }, [deck, view, tail]);
  useEffect(() => () => { for (const d of DECKS) window.annoy?.theater.close(d); }, []);

  // Listening shows as an activity, like a game or Spotify.
  const track = item ? info?.track ?? item.title : null;
  const artist = info?.artist ?? session.name;
  const paused = !state || state.paused;
  useEffect(() => {
    if (!track || paused) { setState((s) => { s.songActivity = null; }); return; }
    const startedAt = Math.round(Date.now() - positionOf(latest.current, itemId, true) * 1000);
    setState((s) => { s.songActivity = { kind: "generic", provider: "system-media", name: track.slice(0, 120), artist: artist.slice(0, 120), startedAt }; });
  }, [track, artist, paused, itemId]);
  useEffect(() => () => setState((s) => { s.songActivity = null; }), []);

  const inRoom = useStore((s) => s.view.kind === "server" && s.view.accountId === session.accountId && s.view.channelId === session.channelId);
  const me = useStore((s) => s.instances[session.accountId]?.user?.id ?? "");
  const perms = useStore((s) => {
    const st = s.instances[session.accountId]?.serverStates[session.serverId];
    const channel = st?.channels.find((c) => c.id === session.channelId);
    return st && channel && me ? channelPerms(st, me, channel) : 0;
  });
  const canControl = has(perms, Permission.SEND_MESSAGES);
  const canSkip = has(perms, Permission.MANAGE_MESSAGES) || item?.addedBy === me;
  const mixing = useMixing();
  useTick(1000, !inRoom);
  const capsule = useRef<HTMLDivElement>(null);
  const floating = useFloating(capsule);

  // Joining mid-song: files start where the room is, not from the top.
  const fileStart = useRef<{ id: string; at: number } | null>(null);
  if (item && !view && fileStart.current?.id !== item.id) fileStart.current = { id: item.id, at: state ? Math.floor(playbackPosition(state, playback.offset)) : 0 };
  const position = positionOf(playback, itemId, true);
  const open = () => openChannel(session.accountId, session.serverId, session.channelId);
  const cover = info?.cover ?? null;
  const buffering = !!item && !paused && !sounding(itemId);
  return (
    <div className={`song-dock${inRoom ? " in-room" : ""}${floating.dragging ? " dragging" : ""}`} role="region" aria-label={translate("common.62fe17b6d2a1")} style={floating.style}>
      <div className="song-dock-capsule" ref={capsule}>
        <span className="song-dock-grip" role="button" tabIndex={0} title={translate("song.move")} aria-label={translate("song.move")} {...floating.handle}>
          <Icon name="grip" size={14} />
        </span>
        <button type="button" className="song-dock-art" title={translate("common.bea6078b5e33")} onClick={open} style={{ "--art-hue": hueOf(item?.title ?? session.name) } as CSSProperties}>
          {cover ? <img src={cover} alt="" referrerPolicy="no-referrer" className={cover.includes("i.ytimg.com") ? "from-video" : undefined} /> : <Icon name="music" size={16} />}
          {item && !paused && <span className={`song-bars${buffering ? " waiting" : ""}`} aria-hidden="true"><i /><i /><i /></span>}
        </button>
        <button type="button" className="song-dock-title" title={translate("common.bea6078b5e33")} onClick={open}>
          <strong className="truncate">{track ?? translate("common.cede3e8165b2")}</strong>
          <span className="truncate">{mixing ? translate("song.mixing", { p0: djLabel(mixing) }) : buffering ? translate("song.tuning") : info?.artist ? `${info.artist} · ${session.name}` : session.name}</span>
        </button>
        <PlaybackFeedback playback={playback} />
        {duck && <span className="song-dock-duck" title={translate("song.ducked")}><Icon name="mic" size={13} /></span>}
        {item && state && (
          <span className="song-dock-controls">
            <button type="button" className="song-dock-btn primary" disabled={!canControl} onClick={() => void playback.send(state.paused ? { op: "play" } : { op: "pause", position })} aria-label={state.paused ? translate("common.ca0709c34209") : translate("common.c1301275ce3f")} title={state.paused ? translate("common.ca0709c34209") : translate("common.c1301275ce3f")}>
              <Icon name={state.paused ? "play" : "pause"} size={16} />
            </button>
            <button type="button" className="song-dock-btn" disabled={!canSkip} onClick={() => void playback.send({ op: "next" })} aria-label={translate("common.4a1772b0c06a")} title={translate("common.4a1772b0c06a")}>
              <Icon name="skip" size={15} />
            </button>
          </span>
        )}
        <VolumeControl compact />
        <button type="button" className="song-dock-btn" title={translate("common.512e5a1c3a9e")} aria-label={translate("common.512e5a1c3a9e")} onClick={() => listenTo(null)}>
          <Icon name="x" size={14} />
        </button>
        {item && <span className="song-dock-progress" aria-hidden="true"><span style={{ width: duration ? `${Math.min(100, (position / duration) * 100)}%` : "0%" }} /></span>}
      </div>
      {item && !view && (
        <video
          key={item.id}
          ref={setAudio}
          className="song-audio"
          src={`${apiFor(session.accountId).resolve(item.url)}${fileStart.current && fileStart.current.at > 0 ? `#t=${fileStart.current.at}` : ""}`}
          autoPlay
          onDurationChange={(e) => rememberDuration(item.id, e.currentTarget.duration)}
          onTimeUpdate={(e) => tickLocal(item.id, e.currentTarget.currentTime, e.currentTarget.paused)}
          onPause={(e) => tickLocal(item.id, e.currentTarget.currentTime, true)}
          onPlay={(e) => tickLocal(item.id, e.currentTarget.currentTime, false)}
        />
      )}
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
