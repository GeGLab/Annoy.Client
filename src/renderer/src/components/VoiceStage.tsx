import { closeCallWindow, focusCallWindow, openCallWindow, useCallWindow } from "../features/call-window.ts";
import {rich} from "../lib/localization.ts";
import {t as translate} from "../../../shared/localization/index.ts";
import { UserProfile } from "./UserProfile.tsx";
import type { Channel, ServerState, VoiceState } from "@annoy/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import { joinVoice, leaveVoice, openScreenShareSettings, updateScreenShareQuality, startScreenShare, toggleCamera, toggleScreenShare, toggleVoiceSetting, watchStream } from "../client.ts";
import { useStreamOffers, useVideoTiles, type VideoTile } from "../media.ts";
import { UserVolumeControl } from "./UserVolumeControl.tsx";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "./ui/context-menu.tsx";
import { popOutStream, usePoppedOutStreams } from "../features/stream-popout.ts";
import { displayNameOf } from "../perms.ts";
import { setState, toast, useStore } from "../store.ts";
import { Minimize } from "lucide-react";
import { Avatar, closeModal, Field, Icon, Modal } from "./ui.tsx";
import { Select } from "./ui/select.tsx";
import { SCREEN_RESOLUTIONS, screenQualityLabel } from "../lib/screen-profile.ts";

/**
 * Sizes call tiles so they fill the stage as much as possible while keeping 16:9:
 * tries every column count and keeps the one with the largest tile.
 */
function useFitTiles(count: number, enabled: boolean) {
  const [el, ref] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!el) return;
    if (!enabled || count === 0) { el.style.removeProperty("--tile-w"); return; }
    const fit = () => {
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
      const { width, height } = el.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      let best = 0;
      for (let cols = 1; cols <= count; cols++) {
        const rows = Math.ceil(count / cols);
        const w = Math.min((width - gap * (cols - 1)) / cols, ((height - gap * (rows - 1)) / rows) * (16 / 9));
        if (w > best) best = w;
      }
      el.style.setProperty("--tile-w", `${Math.max(120, Math.floor(best))}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, count, enabled]);
  return ref;
}

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

function VideoCard({ tile, person, focused, onFocus, accountId }: { tile: VideoTile; person: Person | undefined; focused: boolean; onFocus: () => void; accountId: string }) {
  const card = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const owner = card.current?.ownerDocument ?? document;
    const changed = () => setFullscreen(owner.fullscreenElement === card.current);
    changed();
    owner.addEventListener("fullscreenchange", changed);
    return () => owner.removeEventListener("fullscreenchange", changed);
  }, []);
  const fullscreenLabel = translate(fullscreen ? "voice.exitFullscreen" : "common.cdd35dea1ee3");
  const remoteScreen = tile.source === "screen" && !tile.local;
  const popOut = () => popOutStream(tile, translate("voice.streamWindowTitle", { p0: person?.name ?? "…" }));
  const view = (
    <div ref={card} className={`stage-card video ${tile.source}${focused ? " focused" : ""}${person?.state.speaking ? " speaking" : ""}`} onClick={onFocus}>
      <Video tile={tile} />
      <div className="stage-label">
        {tile.source === "screen" && <span className="live">{screenQualityLabel(person?.state.screenQuality)}</span>}
        <span className="truncate">
          {person?.name ?? "…"}
          {tile.local ? translate("common.0eaa1e8430de") : ""}
        </span>
      </div>
      <div className="stage-corner">
        {tile.local && tile.source === "screen" && <button className="icon-btn" title={translate("voice.shareSettings")} aria-label={translate("voice.shareSettings")} onClick={event => { event.stopPropagation(); void openScreenShareSettings(event.currentTarget.ownerDocument); }}><Icon name="sliders" size={16} /></button>}
        {remoteScreen && (
          <button
            className="icon-btn"
            title={translate("voice.streamWindow")}
            onClick={(e) => {
              e.stopPropagation();
              popOut();
            }}
          >
            <Icon name="external" size={16} />
          </button>
        )}
        <button
          className="icon-btn"
          title={fullscreenLabel}
          aria-label={fullscreenLabel}
          aria-pressed={fullscreen}
          onClick={(e) => {
            e.stopPropagation();
            const element = card.current;
            if (!element) return;
            const action = element.ownerDocument.fullscreenElement === element ? element.ownerDocument.exitFullscreen() : element.requestFullscreen();
            void action.catch(() => toast(translate("common.2de9dc35cfe3")));
          }}
        >
          {fullscreen ? <Minimize className="icon" size={16} strokeWidth={1.75} aria-hidden /> : <Icon name="maximize" size={16} />}
        </button>
      </div>
      {remoteScreen && (
        <div className="stage-stream-tools" onClick={(e) => e.stopPropagation()}>
          <button className="btn btn-ghost" onClick={() => watchStream(tile.userId, false)}>{translate("voice.stopWatching")}</button>
        </div>
      )}
    </div>
  );
  if (!remoteScreen) return view;
  // The stream volume lives only in this menu (right click on the stream).
  return (
    <ContextMenu>
      <ContextMenuTrigger>{view}</ContextMenuTrigger>
      <ContextMenuContent
        aria-label={translate("voice.streamVolumeOf", { p0: person?.name ?? "…" })}
        onFocus={(event) => {
          if (event.target !== event.currentTarget) return;
          event.currentTarget.querySelector<HTMLElement>('[role="slider"]')?.focus();
        }}
      >
        {person && <UserVolumeControl accountId={accountId} userId={tile.userId} name={person.name} kind="stream" />}
        <ContextMenuItem onSelect={popOut}><Icon name="external" />{translate("voice.streamWindow")}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Someone is sharing a screen we are not receiving: nothing arrives until the user asks. */
function StreamOfferCard({ person, userId }: { person: Person | undefined; userId: string }) {
  return (
    <div className="stage-card stream-offer">
      {person && <Avatar user={person.user} size={56} />}
      <div className="stream-offer-text">
        <span className="live">{screenQualityLabel(person?.state.screenQuality)}</span>
        <span className="truncate">{translate("voice.isStreaming", { p0: person?.name ?? "…" })}</span>
      </div>
      <button className="btn" onClick={() => watchStream(userId, true)}><Icon name="monitor" size={16} />{translate("voice.watch")}</button>
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
export function VoiceStage({ accountId, state, channel, embedded = false, canConnect = true, detached = false }: { accountId: string; state: ServerState; channel: Channel; embedded?: boolean; canConnect?: boolean; detached?: boolean }) {
  const voice = useStore((s) => s.voice);
  const settings = useStore((s) => s.settings);
  const tiles = useVideoTiles();
  const poppedOut = usePoppedOutStreams();
  const callWindow = useCallWindow();
  const offers = useStreamOffers();
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

  // Shares open in their own window are shown only there.
  const visibleTiles = connected ? tiles.filter((t) => !poppedOut.has(t.key)) : [];
  // Screens first: they're usually what everyone is looking at.
  const ordered = [...visibleTiles].sort((a, b) => (a.source === b.source ? 0 : a.source === "screen" ? -1 : 1));
  const withVideo = new Set(visibleTiles.filter((t) => t.source === "camera").map((t) => t.userId));
  const audioOnly = [...people.values()].filter((p) => !withVideo.has(p.state.userId));
  const focusedTile = ordered.find((t) => t.key === focus) ?? null;
  // Shares not being watched; the voice state confirms the share is still going on.
  const unwatched = connected ? offers.filter((o) => !o.watching && people.get(o.userId)?.state.screen) : [];
  const tileCount = unwatched.length + ordered.length - (focusedTile ? 1 : 0) + audioOnly.length;
  const tilesRef = useFitTiles(tileCount, !focusedTile);


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

      {connected && callWindow && !detached ? <div className="stage-empty"><Icon name="external" size={32} /><h2>{translate("voice.callInWindow")}</h2><div className="row"><button className="btn" onClick={focusCallWindow}>{translate("voice.showCallWindow")}</button><button className="btn btn-ghost" onClick={closeCallWindow}>{translate("voice.dockCall")}</button></div></div> : !connected && !canConnect ? (
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
                <VideoCard tile={focusedTile} person={people.get(focusedTile.userId)} focused onFocus={() => setFocus(null)} accountId={accountId} />
              </div>
            )}
            <div className={`stage-tiles${focusedTile ? "" : " fit"}`} ref={tilesRef}>
              {unwatched.map((o) => (
                <StreamOfferCard key={`offer:${o.userId}`} person={people.get(o.userId)} userId={o.userId} />
              ))}
              {ordered
                .filter((t) => t.key !== focusedTile?.key)
                .map((t) => (
                  <VideoCard key={t.key} tile={t} person={people.get(t.userId)} focused={false} onFocus={() => setFocus(t.key)} accountId={accountId} />
                ))}
              {audioOnly.map((p) => (
                <PersonCard key={p.state.userId} person={p} accountId={accountId} />
              ))}
            </div>
          </div>
          <div className="stage-controls">
            <div className="stage-control-buttons">
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
            {voice.screen && <button className="round-btn" disabled={voice.screenBusy} title={translate("voice.shareSettings")} aria-label={translate("voice.shareSettings")} onClick={event => void openScreenShareSettings(event.currentTarget.ownerDocument)}><Icon name="sliders" size={20} /></button>}
            <button className="round-btn hangup" onClick={() => leaveVoice()} title={translate("common.df851ef5297e")}>
              <Icon name="hangup" size={20} />
            </button>
            </div>
            <div className="stage-window-controls">
              <button className="icon-btn" title={translate(detached ? "voice.dockCall" : "voice.popoutCall")} aria-label={translate(detached ? "voice.dockCall" : "voice.popoutCall")} onClick={() => detached ? closeCallWindow() : openCallWindow(channel.name)}><Icon name={detached ? "panelLeft" : "external"} size={20} /></button>
            </div>
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
  const sharing = useStore(s => !!s.voice?.screen);
  const busy = useStore(s => !!s.voice?.screenBusy);
  const changeQuality = (patch: Partial<Pick<typeof settings, "screenHeight" | "screenFps">>) => {
    if (sharing) void updateScreenShareQuality({ screenHeight: settings.screenHeight, screenFps: settings.screenFps, ...patch });
    else setState(s => { Object.assign(s.settings, patch); });
  };
  const choose = async (id: string | null) => { if (await startScreenShare(id)) closeModal(); };
  const [system, setSystem] = useState(false);
  const [sources, setSources] = useState<Source[] | null>(null);
  const [tab, setTab] = useState<"screen" | "window">("screen");
  useEffect(() => {
    void window.annoy?.screen.mode().then(async (mode) => {
      if (mode === "system") { setSystem(true); setSources([]); }
      else setSources(await window.annoy!.screen.sources());
    }).catch(() => setSources([]));
  }, []);
  const list = sources?.filter((s) => s.kind === tab) ?? [];
  return (
    <Modal title={translate(sharing ? "voice.shareSettings" : "common.b1f3d8d4c916")} wide busy={busy}>
      <p className="muted small">{translate(sharing ? "voice.shareSettingsHint" : "common.cf987bb7e740")}</p>
      <div className="grid-2 screen-quality-options">
        <Field label={translate("common.742773f345e2")}><Select aria-label={translate("common.431d2cdd9597")} value={String(settings.screenHeight)} disabled={busy} onChange={(event) => changeQuality({ screenHeight: Number(event.target.value) })}>{SCREEN_RESOLUTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select></Field>
        <Field label={translate("common.00cd80cc7714")}><Select aria-label={translate("common.309c8286f5f5")} value={String(settings.screenFps)} disabled={busy} onChange={(event) => changeQuality({ screenFps: Number(event.target.value) })}>{[0, 15, 24, 30, 60, 120].map((fps) => <option key={fps} value={fps}>{fps ? translate("common.31007b4e277a",{p0:(fps)}) : translate("common.b669ba5781e9")}</option>)}</Select></Field>
      </div>
      {system ? <button className="btn" onClick={() => void choose(null)}>{rich("common.bbbccb1b874e",{p0:(<Icon name="monitor" />)})}</button> : <>
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
              onClick={() => void choose(src.id)}
            >
              <img src={src.thumbnail} alt="" />
              <span className="truncate">{src.name}</span>
            </button>
          ))}
        </div>
      )}
      </>}
      {sharing && <button className="btn btn-ghost" disabled={busy} onClick={() => void toggleScreenShare().then(closeModal)}><Icon name="square" size={15} />{translate("common.c3ce13ec2b48")}</button>}
    </Modal>
  );
}




