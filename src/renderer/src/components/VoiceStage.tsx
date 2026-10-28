import type { Channel, ServerState, VoiceState } from "@distopic/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import { joinVoice, leaveVoice, startScreenShare, toggleCamera, toggleScreenShare, updateVoiceSettings } from "../client.ts";
import { useVideoTiles, type VideoTile } from "../media.ts";
import { displayNameOf } from "../perms.ts";
import { setState, useStore } from "../store.ts";
import { Avatar, closeModal, Icon, Modal } from "./ui.tsx";

function Video({ tile }: { tile: VideoTile }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== tile.stream) ref.current.srcObject = tile.stream;
  }, [tile.stream]);
  // Our own camera is mirrored, like a mirror; screens never are.
  return <video ref={ref} autoPlay playsInline muted className={tile.local && tile.source === "camera" ? "mirrored" : ""} />;
}

interface Person {
  state: VoiceState;
  name: string;
  user: ServerState["members"][number]["user"];
}

function VideoCard({ tile, person, focused, onFocus }: { tile: VideoTile; person: Person | undefined; focused: boolean; onFocus: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  return (
    <div ref={card} className={`stage-card video ${tile.source}${focused ? " focused" : ""}${person?.state.speaking ? " speaking" : ""}`} onClick={onFocus}>
      <Video tile={tile} />
      <div className="stage-label">
        {tile.source === "screen" && <span className="live">AO VIVO</span>}
        <span className="truncate">
          {person?.name ?? "…"}
          {tile.local ? " (você)" : ""}
        </span>
      </div>
      <button
        className="icon-btn stage-full"
        title="Tela cheia"
        onClick={(e) => {
          e.stopPropagation();
          void card.current?.requestFullscreen();
        }}
      >
        <Icon name="maximize" size={16} />
      </button>
    </div>
  );
}

function PersonCard({ person }: { person: Person }) {
  const muted = person.state.selfMute || person.state.serverMute;
  return (
    <div className={`stage-card person${person.state.speaking && !muted ? " speaking" : ""}`}>
      <Avatar user={person.user} size={72} speaking={person.state.speaking && !muted} />
      <div className="stage-label">
        <span className="truncate">{person.name}</span>
        {muted && <Icon name="micOff" size={14} />}
        {person.state.selfDeaf && <Icon name="headphonesOff" size={14} />}
      </div>
    </div>
  );
}

/** Voice channel view: everyone in the call, with cameras and screen shares. */
export function VoiceStage({ accountId, state, channel }: { accountId: string; state: ServerState; channel: Channel }) {
  const voice = useStore((s) => s.voice);
  const settings = useStore((s) => s.settings);
  const tiles = useVideoTiles();
  const [focus, setFocus] = useState<string | null>(null);
  const connected = voice?.accountId === accountId && voice.channelId === channel.id;

  const people = useMemo(() => {
    const map = new Map<string, Person>();
    for (const v of state.voiceStates.filter((x) => x.channelId === channel.id)) {
      const member = state.members.find((m) => m.user.id === v.userId);
      if (member) map.set(v.userId, { state: v, name: displayNameOf(member), user: member.user });
    }
    return map;
  }, [state.voiceStates, state.members, channel.id]);

  const visibleTiles = connected ? tiles : [];
  // Screens first: they're usually what everyone is looking at.
  const ordered = [...visibleTiles].sort((a, b) => (a.source === b.source ? 0 : a.source === "screen" ? -1 : 1));
  const withVideo = new Set(visibleTiles.filter((t) => t.source === "camera").map((t) => t.userId));
  const audioOnly = [...people.values()].filter((p) => !withVideo.has(p.state.userId));
  const focusedTile = ordered.find((t) => t.key === focus) ?? null;

  const toggle = (key: "selfMute" | "selfDeaf") => {
    setState((s) => {
      s.settings[key] = !s.settings[key];
      if (key === "selfDeaf" && !s.settings.selfDeaf) s.settings.selfMute = false;
    });
    updateVoiceSettings();
  };

  return (
    <section className="chat stage">
      <header className="chat-header">
        <Icon name="speaker" size={20} />
        <h1 className="truncate">{channel.name}</h1>
        <span className="chat-topic">{people.size === 0 ? "Ninguém na chamada" : `${people.size} na chamada`}</span>
      </header>

      {!connected ? (
        <div className="stage-empty">
          <div className="stage-avatars">
            {[...people.values()].slice(0, 6).map((p) => (
              <Avatar key={p.state.userId} user={p.user} size={44} speaking={p.state.speaking} />
            ))}
          </div>
          <h2>{people.size === 0 ? "A sala está vazia" : `${[...people.values()].map((p) => p.name).slice(0, 3).join(", ")}${people.size > 3 ? "…" : ""}`}</h2>
          <button className="btn" onClick={() => void joinVoice(accountId, state.server.id, channel.id)}>
            Entrar na chamada
          </button>
        </div>
      ) : (
        <>
          <div className={`stage-grid${focusedTile ? " has-focus" : ""}`}>
            {focusedTile && (
              <div className="stage-focus">
                <VideoCard tile={focusedTile} person={people.get(focusedTile.userId)} focused onFocus={() => setFocus(null)} />
              </div>
            )}
            <div className="stage-tiles">
              {ordered
                .filter((t) => t.key !== focusedTile?.key)
                .map((t) => (
                  <VideoCard key={t.key} tile={t} person={people.get(t.userId)} focused={false} onFocus={() => setFocus(t.key)} />
                ))}
              {audioOnly.map((p) => (
                <PersonCard key={p.state.userId} person={p} />
              ))}
            </div>
          </div>
          <div className="stage-controls">
            <button className={`round-btn${settings.selfMute ? " off" : ""}`} onClick={() => toggle("selfMute")} title={settings.selfMute ? "Ativar microfone" : "Silenciar"}>
              <Icon name={settings.selfMute ? "micOff" : "mic"} size={20} />
            </button>
            <button className={`round-btn${settings.selfDeaf ? " off" : ""}`} onClick={() => toggle("selfDeaf")} title={settings.selfDeaf ? "Ativar áudio" : "Ensurdecer"}>
              <Icon name={settings.selfDeaf ? "headphonesOff" : "headphones"} size={20} />
            </button>
            <button
              className={`round-btn${voice.camera ? " on" : ""}`}
              disabled={!voice.canStream}
              onClick={() => void toggleCamera()}
              title={!voice.canStream ? "Sem permissão para transmitir" : voice.camera ? "Desligar câmera" : "Ligar câmera"}
            >
              <Icon name={voice.camera ? "camera" : "cameraOff"} size={20} />
            </button>
            <button
              className={`round-btn${voice.screen ? " on" : ""}`}
              disabled={!voice.canStream}
              onClick={() => void toggleScreenShare()}
              title={!voice.canStream ? "Sem permissão para transmitir" : voice.screen ? "Parar de compartilhar" : "Compartilhar tela"}
            >
              <Icon name="monitor" size={20} />
            </button>
            <button className="round-btn hangup" onClick={() => leaveVoice()} title="Sair da chamada">
              <Icon name="hangup" size={20} />
            </button>
          </div>
        </>
      )}
    </section>
  );
}

interface Source {
  id: string;
  name: string;
  kind: "screen" | "window";
  thumbnail: string;
}

/** Choose a screen or window to share (Windows, macOS and X11; Wayland uses the system portal). */
export function ScreenPickerModal() {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [tab, setTab] = useState<"screen" | "window">("screen");
  useEffect(() => {
    void window.distopic?.screen.sources().then(setSources);
  }, []);
  const list = sources?.filter((s) => s.kind === tab) ?? [];
  return (
    <Modal title="Compartilhar tela" wide>
      <div className="tabs">
        <button className={tab === "screen" ? "tab active" : "tab"} onClick={() => setTab("screen")}>
          Telas
        </button>
        <button className={tab === "window" ? "tab active" : "tab"} onClick={() => setTab("window")}>
          Janelas
        </button>
      </div>
      {!sources ? (
        <p className="muted">Procurando telas e janelas…</p>
      ) : list.length === 0 ? (
        <p className="muted">Nada para compartilhar aqui.</p>
      ) : (
        <div className="source-grid">
          {list.map((src) => (
            <button
              key={src.id}
              className="source-card"
              onClick={() => {
                closeModal();
                void startScreenShare(src.id);
              }}
            >
              <img src={src.thumbnail} alt="" />
              <span className="truncate">{src.name}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
