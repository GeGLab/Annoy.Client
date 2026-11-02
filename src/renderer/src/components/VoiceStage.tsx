import {rich} from "../lib/localization.ts";
import {t as translate} from "../../../shared/localization/index.ts";
import { UserProfile } from "./UserProfile.tsx";
import type { Channel, ServerState, VoiceState } from "@distopic/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import { joinVoice, leaveVoice, startScreenShare, toggleCamera, toggleScreenShare, toggleVoiceSetting } from "../client.ts";
import { useVideoTiles, type VideoTile } from "../media.ts";
import { displayNameOf } from "../perms.ts";
import { setState, useStore } from "../store.ts";
import { Avatar, closeModal, Field, Icon, Modal } from "./ui.tsx";
import { Select } from "./ui/select.tsx";
import { SCREEN_RESOLUTIONS, screenQualityLabel } from "../lib/screen-profile.ts";

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
        {tile.source === "screen" && <span className="live">{screenQualityLabel(person?.state.screenQuality)}</span>}
        <span className="truncate">
          {person?.name ?? "…"}
          {tile.local ? translate("common.0eaa1e8430de") : ""}
        </span>
      </div>
      <button
        className="icon-btn stage-full"
        title={translate("common.cdd35dea1ee3")}
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

function PersonCard({ person, accountId }: { person: Person; accountId: string }) {
  const muted = person.state.selfMute || person.state.serverMute;
  return (
    <div className={`stage-card person${person.state.speaking && !muted ? " speaking" : ""}`}>
      <UserProfile user={person.user} accountId={accountId}><Avatar user={person.user} size={72} speaking={person.state.speaking && !muted} /></UserProfile>
      <div className="stage-label">
        <span className="truncate">{person.name}</span>
        {muted && <Icon name="micOff" size={14} />}
        {person.state.selfDeaf && <Icon name="headphonesOff" size={14} />}
      </div>
    </div>
  );
}

/** Voice channel view: everyone in the call, with cameras and screen shares. */
export function VoiceStage({ accountId, state, channel, embedded = false, canConnect = true }: { accountId: string; state: ServerState; channel: Channel; embedded?: boolean; canConnect?: boolean }) {
  const voice = useStore((s) => s.voice);
  const settings = useStore((s) => s.settings);
  const tiles = useVideoTiles();
  const [focus, setFocus] = useState<string | null>(null);
  const connected = voice?.accountId === accountId && voice.channelId === channel.id;
  const joining = connected && voice.status === "connecting";

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


  return (
    <section className={`chat stage${embedded ? " embedded" : ""}`}>
      {!embedded && (
        <header className="chat-header">
          <Icon name={channel.temporary ? "hourglass" : "speaker"} size={20} />
          <h1 className="truncate">{channel.name}</h1>
          <span className="chat-topic">
            {people.size === 0 ? translate("common.f5c42021d624") : translate("common.dc3f6b2c7d4d",{p0:(people.size)})}
            {channel.temporary ? translate("common.e2eac5d491f9") : ""}
          </span>
        </header>
      )}

      {!connected && !canConnect ? (
        <div className="stage-empty" role="status"><Icon name="lock" size={30} /><h2>{translate("common.6e1b48552704")}</h2><p className="muted">{translate("common.36614b7fc786")}</p></div>
      ) : !connected ? (
        <div className="stage-empty">
          <div className="stage-avatars">
            {[...people.values()].slice(0, 6).map((p) => (
              <Avatar key={p.state.userId} user={p.user} size={44} speaking={p.state.speaking} />
            ))}
          </div>
          <h2>{people.size === 0 ? translate("common.4aba0ac7e05f") : `${[...people.values()].map((p) => p.name).slice(0, 3).join(", ")}${people.size > 3 ? "…" : ""}`}</h2>
          <button className="btn" onClick={() => void joinVoice(accountId, state.server.id, channel.id)}>{translate("common.5216ad0285e0")}</button>
        </div>
      ) : joining ? (
        <div className="stage-empty" role="status" aria-live="polite"><Icon name="loader" size={30} /><h2>{translate("common.e0575c81307c")}</h2><p className="muted">{translate("common.eff4c19bf87b")}</p><button className="btn btn-ghost" onClick={() => leaveVoice()}>{translate("common.4790f9380f81")}</button></div>
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
                <PersonCard key={p.state.userId} person={p} accountId={accountId} />
              ))}
            </div>
          </div>
          <div className="stage-controls">
            <button className={`round-btn${settings.selfMute ? " off" : ""}`} onClick={() => toggleVoiceSetting("selfMute")} title={settings.selfMute ? translate("common.2c42f42f33a1") : translate("common.8953cc8c3228")}>
              <Icon name={settings.selfMute ? "micOff" : "mic"} size={20} />
            </button>
            <button className={`round-btn${settings.selfDeaf ? " off" : ""}`} onClick={() => toggleVoiceSetting("selfDeaf")} title={settings.selfDeaf ? translate("common.5cfebda5d336") : translate("common.be50b0723878")}>
              <Icon name={settings.selfDeaf ? "headphonesOff" : "headphones"} size={20} />
            </button>
            <button
              className={`round-btn${voice.camera ? " on" : ""}`}
              disabled={!voice.canStream}
              onClick={() => void toggleCamera()}
              title={!voice.canStream ? translate("common.957726dc235e") : voice.camera ? translate("common.7c25aa8599d9") : translate("common.df2b6ab01662")}
            >
              <Icon name={voice.camera ? "camera" : "cameraOff"} size={20} />
            </button>
            <button
              className={`round-btn${voice.screen ? " on" : ""}`}
              disabled={!voice.canStream}
              onClick={() => void toggleScreenShare()}
              title={!voice.canStream ? translate("common.957726dc235e") : voice.screen ? translate("common.c3ce13ec2b48") : translate("common.b1f3d8d4c916")}
            >
              <Icon name="monitor" size={20} />
            </button>
            <button className="round-btn hangup" onClick={() => leaveVoice()} title={translate("common.df851ef5297e")}>
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
  const settings = useStore((s) => s.settings);
  const [system, setSystem] = useState(false);
  const [sources, setSources] = useState<Source[] | null>(null);
  const [tab, setTab] = useState<"screen" | "window">("screen");
  useEffect(() => {
    void window.distopic?.screen.mode().then(async (mode) => {
      if (mode === "system") { setSystem(true); setSources([]); }
      else setSources(await window.distopic!.screen.sources());
    }).catch(() => setSources([]));
  }, []);
  const list = sources?.filter((s) => s.kind === tab) ?? [];
  return (
    <Modal title={translate("common.b1f3d8d4c916")} wide>
      <p className="muted small">{translate("common.cf987bb7e740")}</p>
      <div className="grid-2 screen-quality-options">
        <Field label={translate("common.742773f345e2")}><Select aria-label={translate("common.431d2cdd9597")} value={String(settings.screenHeight)} onChange={(event) => setState((s) => { s.settings.screenHeight = Number(event.target.value); })}>{SCREEN_RESOLUTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select></Field>
        <Field label={translate("common.00cd80cc7714")}><Select aria-label={translate("common.309c8286f5f5")} value={String(settings.screenFps)} onChange={(event) => setState((s) => { s.settings.screenFps = Number(event.target.value); })}>{[0, 15, 24, 30, 60, 120].map((fps) => <option key={fps} value={fps}>{fps ? `${fps} FPS` : translate("common.b669ba5781e9")}</option>)}</Select></Field>
      </div>
      {system ? <button className="btn" onClick={() => { closeModal(); void startScreenShare(null); }}>{rich("common.bbbccb1b874e",{p0:(<Icon name="monitor" />)})}</button> : <>
      <div className="tabs">
        <button className={tab === "screen" ? "tab active" : "tab"} onClick={() => setTab("screen")}>{translate("common.9fd84e06e26a")}</button>
        <button className={tab === "window" ? "tab active" : "tab"} onClick={() => setTab("window")}>{translate("common.3466640973b1")}</button>
      </div>
      {!sources ? (
        <p className="muted">{translate("common.86615c219da7")}</p>
      ) : list.length === 0 ? (
        <p className="muted">{translate("common.5ae612766642")}</p>
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
      </>}
    </Modal>
  );
}




