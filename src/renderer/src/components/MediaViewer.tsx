import { Slider } from "./ui/slider.tsx";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog.tsx";
import { Button } from "./ui/button.tsx";
import { Select } from "./ui/select.tsx";
import { Icon } from "./ui.tsx";

export interface ViewerMedia {
  url: string;
  filename: string;
  contentType: string;
}
const time = (seconds: number) =>
  Number.isFinite(seconds)
    ? `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
        .toString()
        .padStart(2, "0")}`
    : "0:00";

export default function MediaViewer({ media, onClose }: { media: ViewerMedia; onClose: () => void }) {
  const video = media.contentType.startsWith("video/");
  const player = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const [fullscreenRoot, setFullscreenRoot] = useState<Element | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [volume, setVolume] = useState(1);
  const [speed, setSpeed] = useState("1");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const changed = () => setFullscreenRoot(document.fullscreenElement);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  useEffect(() => {
    const element = player.current;
    if (element && element.getAttribute("src") !== media.url) {
      element.src = media.url;
      element.load();
    }
    return () => {
      element?.pause();
      element?.removeAttribute("src");
      element?.load();
    };
  }, [media.url]);
  const toggle = async () => {
    const element = player.current;
    if (!element) return;
    if (!element.paused) element.pause();
    else
      try {
        await element.play();
      } catch {
        setError("Não foi possível reproduzir este arquivo. O formato pode não ser compatível ou a conexão foi interrompida.");
      }
  };
  const events = {
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onTimeUpdate: () => setPosition(player.current?.currentTime ?? 0),
    onLoadedMetadata: () => {
      setDuration(player.current?.duration ?? 0);
      setLoading(false);
    },
    onDurationChange: () => setDuration(player.current?.duration ?? 0),
    onWaiting: () => setLoading(true),
    onCanPlay: () => setLoading(false),
    onError: () => {
      setLoading(false);
      setError("Não foi possível carregar a mídia. Verifique a conexão ou tente um arquivo MP4, WebM, MP3, OGG ou WAV compatível.");
    },
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={`media-viewer${video ? "" : " media-audio"}`} aria-describedby={undefined} showClose={false}>
        <header className="viewer-header">
          <Icon name={video ? "film" : "music"} size={22} />
          <div className="viewer-file-info">
            <DialogTitle className="truncate">{media.filename}</DialogTitle>
            <span className="muted small">{video ? "Vídeo" : "Áudio"} · Player Distopic</span>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar player">
            <Icon name="x" />
          </Button>
        </header>
        <div className="media-stage" ref={container}>
          {video ? (
            <video
              ref={player as React.RefObject<HTMLVideoElement>}
              src={media.url}
              playsInline
              preload="metadata"
              {...events}
              onClick={() => void toggle()}
            />
          ) : (
            <>
              <audio ref={player as React.RefObject<HTMLAudioElement>} src={media.url} preload="metadata" {...events} />
              <div className={`audio-artwork${playing ? " playing" : ""}`}>
                <Icon name="music" size={52} />
                <span>Seu som, no seu espaço.</span>
              </div>
            </>
          )}
          {loading && !error && (
            <span className="media-buffering" role="status">
              <Icon name="loader" />
              Carregando mídia…
            </span>
          )}
          {error && (
            <div className="media-error" role="alert">
              <Icon name="info" size={28} />
              <p>{error}</p>
              <Button
                variant="secondary"
                onClick={() => {
                  setError(null);
                  setLoading(true);
                  player.current?.load();
                }}
              >
                Tentar novamente
              </Button>
            </div>
          )}
        </div>
        <div className="media-controls">
          <label className="media-seek">
            <span className="sr-only">Posição da reprodução</span>
            <Slider
              min={0}
              max={Number.isFinite(duration) && duration > 0 ? duration : 1}
              step={0.1}
              value={position}
              disabled={!duration || !Number.isFinite(duration) || !!error}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (player.current) player.current.currentTime = next;
                setPosition(next);
              }}
            />
          </label>
          <div className="media-control-row">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => void toggle()}
              disabled={!!error}
              aria-label={playing ? "Pausar" : "Reproduzir"}
            >
              <Icon name={playing ? "pause" : "play"} size={23} />
            </Button>
            <span className="media-time">
              {time(position)} <span>/ {time(duration)}</span>
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={volume ? "Silenciar mídia" : "Ativar som da mídia"}
              onClick={() => {
                const next = volume ? 0 : 1;
                setVolume(next);
                if (player.current) player.current.volume = next;
              }}
            >
              <Icon name={volume ? "speaker" : "volumeOff"} />
            </Button>
            <Slider
              className="media-volume"
              aria-label="Volume da mídia"

              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => {
                const next = Number(e.target.value);
                setVolume(next);
                if (player.current) player.current.volume = next;
              }}
            />
            <span className="spacer" />
            <Select
              portalContainer={fullscreenRoot instanceof HTMLElement ? fullscreenRoot : undefined}
              aria-label="Velocidade de reprodução"
              className="media-speed"
              value={speed}
              onChange={(e) => {
                setSpeed(e.target.value);
                if (player.current) player.current.playbackRate = Number(e.target.value);
              }}
            >
              {[0.5, 1, 1.25, 1.5, 2].map((rate) => (
                <option key={rate} value={String(rate)}>
                  {rate}×
                </option>
              ))}
            </Select>
            {video && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Vídeo em tela cheia"
                onClick={() => {
                  if (document.fullscreenElement) void document.exitFullscreen();
                  else if (container.current?.parentElement?.requestFullscreen)
                    void container.current.parentElement.requestFullscreen().catch(() => setError("Não foi possível abrir em tela cheia."));
                }}
              >
                <Icon name="maximize" />
              </Button>
            )}
          </div>
        </div>
        <footer className="media-footer">
          <span>Esc para fechar</span>
          <a href={media.url} target="_blank" rel="noreferrer">
            Abrir arquivo original <Icon name="external" size={13} />
          </a>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
