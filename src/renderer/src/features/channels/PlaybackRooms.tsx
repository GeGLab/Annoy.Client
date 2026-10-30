import { has, Permission, playbackPosition, type Channel, type Message, type PlaybackItem, type ServerState } from "@distopic/protocol";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { apiFor, joinVoice, leaveVoice, openChannel } from "../../client.ts";
import { displayNameOf } from "../../perms.ts";
import { toast, useStore } from "../../store.ts";
import { Chat } from "../../components/Chat.tsx";
import { VoiceStage } from "../../components/VoiceStage.tsx";
import { Icon, type IconName } from "../../components/ui.tsx";
import { currentItem, elementDriver, useSync, usePlayback, viewDriver, type Driver, type Playback, type UserEvents } from "./playback.ts";

type Slot = "theater" | "music";
const inView = (item: PlaybackItem | null) => item?.kind === "youtube" || item?.kind === "site";
const KIND_LABEL: Record<PlaybackItem["kind"], string> = { file: "Arquivo", direct: "Link direto", youtube: "YouTube", site: "Site" };
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
    const bridge = window.distopic?.theater;
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
      window.distopic?.theater.open(slot, url, kind);
      const made = viewDriver(slot, () => events.current!);
      setDriver(made.driver);
      return () => {
        made.dispose();
        setDriver(null);
      };
    }
    window.distopic?.theater.close(slot);
    if (!media) return;
    const made = elementDriver(media, () => events.current!);
    setDriver(made.driver);
    return () => {
      made.dispose();
      setDriver(null);
    };
  }, [slot, view, url, kind, media]);

  useEffect(() => () => window.distopic?.theater.close(slot), [slot]);
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
        title={state.paused ? "Reproduzir para todos" : "Pausar para todos"}
      >
        <Icon name={state.paused ? "play" : "pause"} size={20} />
      </button>
      <button className="round-btn" disabled={!canSkip} onClick={() => void send({ op: "next" })} title="Próximo">
        <Icon name="skip" size={20} />
      </button>
      <span className="playback-now">
        <strong className="truncate">{item.title}</strong>
        <small className="muted">
          {state.paused ? "Pausado" : "Tocando"} · {clock(position)}
        </small>
      </span>
      <button className={`chip${state.autoplay ? " on" : ""}`} disabled={!canControl} onClick={() => void send({ op: "autoplay", value: !state.autoplay })}>
        Reprodução automática
      </button>
    </div>
  );
}

function Queue({ accountId, channel, playback, perms, me, names, audioOnly }: { accountId: string; channel: Channel; playback: Playback; perms: number; me: string; names: Map<string, string>; audioOnly: boolean }) {
  const { state, send } = playback;
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const canAdd = has(perms, Permission.SEND_MESSAGES);
  const canAttach = canAdd && has(perms, Permission.ATTACH_FILES);
  const moderator = has(perms, Permission.MANAGE_MESSAGES);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    await send({ op: "add", url: url.trim() });
    setUrl("");
    setBusy(false);
  };

  // An upload is a message in the room's chat; its file then joins the queue.
  const upload = async (list: File[]) => {
    setBusy(true);
    try {
      for (const f of list) {
        const message = await apiFor(accountId).sendMessage<Message>(channel.id, `Adicionou à fila: ${f.name}`, [f], null);
        const attachment = message.attachments[0];
        if (attachment) await send({ op: "add", url: "", uploadId: attachment.id });
      }
    } catch (err) {
      toast((err as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="playback-queue">
      {canAdd && (
        <form className="queue-add" onSubmit={add}>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={audioOnly ? "Link do YouTube ou de um arquivo de áudio" : "Link do YouTube, de um vídeo ou de um site"}
            aria-label="Link para adicionar à fila"
          />
          <button className="btn" disabled={busy || !url.trim()}>
            <Icon name="plus" size={16} />
            Adicionar
          </button>
          {canAttach && (
            <>
              <button type="button" className="icon-btn" disabled={busy} title="Enviar arquivo de áudio ou vídeo" onClick={() => file.current?.click()}>
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
        {state?.queue.length === 0 && <li className="muted queue-empty">A fila está vazia. Adicione um link para começar.</li>}
        {state?.queue.map((item, index) => {
          const current = item.id === state.currentId;
          const removable = moderator || item.addedBy === me;
          return (
            <li key={item.id} className={`queue-item${current ? " current" : ""}`}>
              <span className="queue-index">{current ? <Icon name={state.paused ? "pause" : "play"} size={14} /> : index + 1}</span>
              <span className="queue-meta">
                <strong className="truncate" title={item.url}>
                  {item.title}
                </strong>
                <small className="muted truncate">
                  <Icon name={KIND_ICON[item.kind]} size={12} /> {KIND_LABEL[item.kind]} · {names.get(item.addedBy) ?? "alguém"}
                </small>
              </span>
              <span className="row-actions">
                {!current && canAdd && (
                  <button className="icon-btn tiny" title="Tocar agora" onClick={() => void send({ op: "play", itemId: item.id })}>
                    <Icon name="play" size={14} />
                  </button>
                )}
                {moderator && index > 0 && (
                  <button className="icon-btn tiny" title="Subir" onClick={() => void send({ op: "move", itemId: item.id, index: index - 1 })}>
                    <Icon name="up" size={14} />
                  </button>
                )}
                {removable && (
                  <button className="icon-btn tiny" title="Remover da fila" onClick={() => void send({ op: "remove", itemId: item.id })}>
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
      title="Chat"
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
        <h2>Nada passando agora</h2>
        <p className="muted">Adicione um link do YouTube, um vídeo ou um site na fila. Em sites, anúncios e pop-ups são bloqueados.</p>
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
        <div className="segmented" role="tablist" aria-label="O que assistir">
          <button role="tab" aria-selected={mode === "player"} className={mode === "player" ? "active" : ""} onClick={() => setMode("player")}>
            Player
          </button>
          <button role="tab" aria-selected={mode === "screen"} className={mode === "screen" ? "active" : ""} onClick={() => setMode("screen")}>
            Telas{sharing ? " •" : ""}
          </button>
        </div>
        <span className="chat-topic">{inCall.length === 0 ? "Ninguém na chamada" : `${inCall.length} na chamada`}</span>
        {connected ? (
          <button className="btn btn-ghost" onClick={() => leaveVoice()}>
            <Icon name="hangup" size={16} />
            Sair da chamada
          </button>
        ) : (
          has(perms, Permission.CONNECT) && (
            <button className="btn" onClick={() => void joinVoice(accountId, state.server.id, channel.id)}>
              <Icon name="mic" size={16} />
              Entrar na chamada
            </button>
          )
        )}
      </header>
      <div className="theater-body">
        <div className="theater-stage">
          {mode === "player" ? (
            <>
              <TheaterPlayer accountId={accountId} playback={playback} />
              <Controls playback={playback} canControl={canControl} canSkip={canSkip} />
            </>
          ) : (
            <VoiceStage accountId={accountId} state={state} channel={channel} embedded />
          )}
        </div>
        <aside className="theater-side">
          <div className="segmented" role="tablist" aria-label="Painel lateral">
            <button role="tab" aria-selected={side === "queue"} className={side === "queue" ? "active" : ""} onClick={() => setSide("queue")}>
              Fila{playback.state?.queue.length ? ` (${playback.state.queue.length})` : ""}
            </button>
            <button role="tab" aria-selected={side === "chat"} className={side === "chat" ? "active" : ""} onClick={() => setSide("chat")}>
              Chat
            </button>
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

export function SongView({ accountId, state, channel, perms }: { accountId: string; state: ServerState; channel: Channel; perms: number }) {
  const playback = usePlayback(accountId, channel.id);
  const me = useStore((s) => s.instances[accountId]?.user?.id ?? "");
  const names = useNames(state);
  const current = useListening();
  const here = current?.accountId === accountId && current.channelId === channel.id;
  const item = currentItem(playback.state);
  const [side, setSide] = useState<"queue" | "chat">("queue");
  const canSkip = has(perms, Permission.MANAGE_MESSAGES) || item?.addedBy === me;

  return (
    <section className="chat song-room">
      <header className="chat-header">
        <Icon name="song" size={20} />
        <h1 className="truncate">{channel.name}</h1>
        <span className="chat-topic">{channel.topic || "Todos ouvem a mesma música ao mesmo tempo"}</span>
        {here ? (
          <button className="btn btn-ghost" onClick={() => listenTo(null)}>
            <Icon name="volumeOff" size={16} />
            Parar de ouvir
          </button>
        ) : (
          <button className="btn" onClick={() => listenTo({ accountId, serverId: state.server.id, channelId: channel.id, name: channel.name })}>
            <Icon name="headphones" size={16} />
            Ouvir junto
          </button>
        )}
      </header>
      <div className="song-body">
        <div className="song-now">
          {here && inView(item) ? (
            <div className="song-video" ref={setVideoSlot} />
          ) : (
            <div className="song-cover">
              <Icon name="music" size={56} />
              <strong>{item?.title ?? "Nada tocando"}</strong>
              {!here && item && <span className="muted">Clique em Ouvir junto para escutar com a sala.</span>}
            </div>
          )}
          <Controls playback={playback} canControl={has(perms, Permission.SEND_MESSAGES)} canSkip={canSkip} />
        </div>
        <aside className="theater-side">
          <div className="segmented" role="tablist" aria-label="Painel lateral">
            <button role="tab" aria-selected={side === "queue"} className={side === "queue" ? "active" : ""} onClick={() => setSide("queue")}>
              Fila{playback.state?.queue.length ? ` (${playback.state.queue.length})` : ""}
            </button>
            <button role="tab" aria-selected={side === "chat"} className={side === "chat" ? "active" : ""} onClick={() => setSide("chat")}>
              Chat
            </button>
          </div>
          {side === "queue" ? (
            <Queue accountId={accountId} channel={channel} playback={playback} perms={perms} me={me} names={names} audioOnly />
          ) : (
            <RoomChat accountId={accountId} state={state} channel={channel} perms={perms} />
          )}
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
    <div className="song-dock" role="region" aria-label="Música da sala">
      <Icon name="song" size={16} />
      <button className="song-dock-title truncate" title="Abrir a sala" onClick={() => openChannel(session.accountId, session.serverId, session.channelId)}>
        <strong>{item?.title ?? "Fila vazia"}</strong>
        <span className="muted"> · {session.name}</span>
      </button>
      {item && <span className="muted">{clock(position)}</span>}
      {item && !inView(item) && <video key={item.id} ref={setAudio} className="song-audio" src={apiFor(session.accountId).resolve(item.url)} autoPlay />}
      <button className="icon-btn tiny" title="Parar de ouvir" onClick={() => listenTo(null)}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

/** The song room's player, alive while the user listens, wherever they are in the app. */
export function SongDock() {
  const session = useListening();
  const accounts = useStore((s) => s.accounts);
  // Signing out of the account stops the music too.
  useEffect(() => {
    if (session && !accounts.some((a) => a.id === session.accountId)) listenTo(null);
  }, [session, accounts]);
  if (!session) return null;
  return <SongPlayer key={`${session.accountId}:${session.channelId}`} session={session} />;
}
