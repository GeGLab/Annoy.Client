import { leaveVoice, openChannel } from "../client.ts";
import { useStore } from "../store.ts";
import { Icon } from "./ui.tsx";
import { Button } from "./ui/button.tsx";

export const VOICE_BAR_HEIGHT = 56;
export function VoiceStatusBar() {
  const voice = useStore((s) => s.voice);
  const state = useStore((s) => (s.voice ? s.instances[s.voice.accountId]?.serverStates[s.voice.serverId] : undefined));
  if (!voice) return null;
  const channel = state?.channels.find((c) => c.id === voice.channelId);
  const count = state?.voiceStates.filter((v) => v.channelId === voice.channelId).length ?? 0;
  return (
    <div className={`voice-status-bar ${voice.status}`}>
      <span className="voice-connection-icon">
        <Icon name={voice.status === "connected" ? "radio" : "loader"} size={23} />
      </span>
      <div className="voice-status-copy">
        <span role="status">{voice.status === "connected" ? "Você está conectado à voz" : "Conectando à chamada…"}</span>
        <strong className="truncate">
          {channel?.name ?? "Canal de voz"}
          <span>
            {" "}
            · {state?.server.name ?? "Servidor"}
            {count > 0 && ` · ${count} na sala`}
          </span>
        </strong>
      </div>
      <Button variant="ghost" size="sm" onClick={() => openChannel(voice.accountId, voice.serverId, voice.channelId)}>
        Ver chamada
      </Button>
      <Button variant="ghost" size="icon" aria-label="Sair da chamada de voz" title="Sair da chamada" onClick={() => leaveVoice()}>
        <Icon name="hangup" />
      </Button>
    </div>
  );
}
