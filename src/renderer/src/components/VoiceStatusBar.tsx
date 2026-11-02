import {t as translate} from "../../../shared/localization/index.ts";
import { leaveVoice, openChannel } from "../client.ts";
import { useStore } from "../store.ts";
import { Icon } from "./ui.tsx";
import { Button } from "./ui/button.tsx";

export const VOICE_BAR_HEIGHT = 36;
export function VoiceStatusBar() {
  const voice = useStore((s) => s.voice);
  const visible = useStore((s) => s.settings.showVoiceBar);
  const contextVisible = useStore((s) => s.settings.voiceBarMode === "always" || s.view.kind === "service");
  const state = useStore((s) => (s.voice ? s.instances[s.voice.accountId]?.serverStates[s.voice.serverId] : undefined));
  if (!voice || !visible || !contextVisible) return null;
  const channel = state?.channels.find((c) => c.id === voice.channelId);
  const count = state?.voiceStates.filter((v) => v.channelId === voice.channelId).length ?? 0;
  return (
    <div className={`voice-status-bar ${voice.status}`}>
      <span className="voice-connection-icon">
        <Icon name={voice.status === "connected" ? "radio" : "loader"} size={16} />
      </span>
      <div className="voice-status-copy">
        <span role="status">{voice.status === "connected" ? translate("common.e58c700521d2") : "Conectando…"}</span>
        <strong className="truncate">
          {channel?.name ?? translate("common.b9bd50cb65eb")}
          <span>
            {" "}
            · {state?.server.name ?? translate("common.05e427a291c2")}
            {count > 0 && ` · ${count} na sala`}
          </span>
        </strong>
      </div>
      <Button variant="ghost" size="sm" onClick={() => openChannel(voice.accountId, voice.serverId, voice.channelId)}>{translate("common.22615e437db8")}</Button>
      <Button variant="ghost" size="icon" aria-label={translate("common.4e054f9afb78")} title={translate("common.df851ef5297e")} onClick={() => leaveVoice()}>
        <Icon name="hangup" />
      </Button>
    </div>
  );
}


