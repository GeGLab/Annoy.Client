import { leaveVoice, updateVoiceSettings } from "../client.ts";
import { setState, useStore } from "../store.ts";
import { Avatar, Icon } from "./ui.tsx";

/** Bottom-left panel: active voice connection plus the current account's controls. */
export function UserPanel({ accountId }: { accountId: string | null }) {
  const inst = useStore((s) => (accountId ? s.instances[accountId] : undefined));
  const voice = useStore((s) => s.voice);
  const voiceInst = useStore((s) => (s.voice ? s.instances[s.voice.accountId] : undefined));
  const settings = useStore((s) => s.settings);
  const user = inst?.user;

  const voiceState = voice && voiceInst?.serverStates[voice.serverId];
  const voiceChannel = voiceState?.channels.find((c) => c.id === voice?.channelId);

  const toggle = (key: "selfMute" | "selfDeaf") => {
    setState((s) => {
      s.settings[key] = !s.settings[key];
      // Undeafening also unmutes, matching Discord.
      if (key === "selfDeaf" && !s.settings.selfDeaf) s.settings.selfMute = false;
    });
    updateVoiceSettings();
  };

  return (
    <div className="user-panel">
      {voice && (
        <div className="voice-bar">
          <div className="voice-bar-info">
            <span className={`voice-status ${voice.status}`}>{voice.status === "connected" ? "Voz conectada" : "Conectando…"}</span>
            <span className="voice-where">
              {voiceChannel?.name ?? "canal"} / {voiceState?.server.name ?? ""}
            </span>
          </div>
          <button className="icon-btn danger" onClick={() => leaveVoice()} title="Desconectar da voz">
            <Icon name="hangup" />
          </button>
        </div>
      )}
      <div className="user-row">
        {user ? <Avatar user={user} size={32} presence="online" /> : <span className="avatar placeholder" />}
        <div className="user-names">
          <span className="user-display">{user?.displayName ?? "Sem conta"}</span>
          <span className="user-handle">{user ? `@${user.username}` : ""}</span>
        </div>
        <button className={`icon-btn${settings.selfMute ? " danger" : ""}`} onClick={() => toggle("selfMute")} title={settings.selfMute ? "Ativar microfone" : "Silenciar"}>
          <Icon name={settings.selfMute ? "micOff" : "mic"} />
        </button>
        <button className={`icon-btn${settings.selfDeaf ? " danger" : ""}`} onClick={() => toggle("selfDeaf")} title={settings.selfDeaf ? "Ativar áudio" : "Ensurdecer"}>
          <Icon name={settings.selfDeaf ? "headphonesOff" : "headphones"} />
        </button>
        <button
          className="icon-btn"
          title="Configurações"
          onClick={() =>
            setState((s) => {
              s.modal = { kind: "userSettings" };
            })
          }
        >
          <Icon name="gear" />
        </button>
      </div>
    </div>
  );
}
