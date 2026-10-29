import { useEffect, useState } from "react";
import { leaveVoice, openChannel, toggleCamera, toggleScreenShare, updateVoiceSettings } from "../client.ts";
import { setState, useStore } from "../store.ts";
import { Icon } from "./ui.tsx";
import { Tooltip } from "./ui/tooltip.tsx";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "./ui/dropdown-menu.tsx";

export function DeviceMenu({ kind }: { kind: "input" | "output" }) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [open, setOpen] = useState(false);
  const selected = useStore((s) => (kind === "input" ? s.settings.inputDeviceId : s.settings.outputDeviceId));
  useEffect(() => {
    if (!open) return;
    let active = true;
    void navigator.mediaDevices.enumerateDevices().then(
      (list) => {
        if (active)
          setDevices(list.filter((d) => d.kind === (kind === "input" ? "audioinput" : "audiooutput") && d.deviceId !== "default"));
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [open, kind]);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className="device-menu-trigger"
          aria-label={kind === "input" ? "Dispositivos de microfone" : "Dispositivos de áudio"}
          title="Escolher dispositivo"
        >
          <Icon name="chevron" size={11} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="device-dropdown">
        <DropdownMenuLabel>{kind === "input" ? "Dispositivo de entrada" : "Dispositivo de saída"}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={selected}
          onValueChange={(value) => {
            setState((s) => {
              if (kind === "input") s.settings.inputDeviceId = value;
              else s.settings.outputDeviceId = value;
            });
            updateVoiceSettings();
          }}
        >
          <DropdownMenuRadioItem value="default">Padrão do sistema</DropdownMenuRadioItem>
          {devices.map((device) => (
            <DropdownMenuRadioItem key={device.deviceId} value={device.deviceId}>
              {device.label || (kind === "input" ? "Microfone" : "Alto-falante")}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() =>
            setState((s) => {
              s.modal = { kind: "userSettings" };
            })
          }
        >
          <Icon name="sliders" />
          Configurações de voz
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function VoicePanel() {
  const voice = useStore((s) => s.voice);
  const server = useStore((s) => (s.voice ? s.instances[s.voice.accountId]?.serverStates[s.voice.serverId] : undefined));
  if (!voice) return null;
  const channel = server?.channels.find((c) => c.id === voice.channelId);
  const connected = voice.status === "connected";
  const count = server?.voiceStates.filter((s) => s.channelId === voice.channelId).length ?? 0;
  return (
    <div className={`voice-panel${connected ? " connected" : " connecting"}`}>
      <div className="voice-panel-heading">
        <Icon name={connected ? "radio" : "loader"} size={22} />
        <button
          className="voice-panel-location"
          onClick={() => openChannel(voice.accountId, voice.serverId, voice.channelId)}
          aria-label="Abrir chamada atual"
        >
          <strong>{connected ? "Voz conectada" : "Conectando…"}</strong>
          <span className="truncate">
            {channel?.name ?? "Voz"} / {server?.server.name ?? "Servidor"}
          </span>
        </button>
        <Tooltip content="Sair da chamada" side="top">
          <button className="icon-btn danger" aria-label="Desconectar da voz" onClick={() => leaveVoice()}>
            <Icon name="hangup" size={18} />
          </button>
        </Tooltip>
      </div>
      <div className="voice-panel-actions">
        <Tooltip
          content={!voice.canStream ? "Sem permissão para transmitir" : voice.camera ? "Desligar câmera" : "Ligar câmera"}
          side="top"
        >
          <button
            disabled={!connected || !voice.canStream}
            className={`voice-action${voice.camera ? " on" : ""}`}
            aria-label={voice.camera ? "Desligar câmera" : "Ligar câmera"}
            aria-pressed={voice.camera}
            onClick={() => void toggleCamera()}
          >
            <Icon name={voice.camera ? "camera" : "cameraOff"} size={18} />
            <span>Câmera</span>
          </button>
        </Tooltip>
        <Tooltip
          content={!voice.canStream ? "Sem permissão para transmitir" : voice.screen ? "Parar transmissão" : "Compartilhar tela"}
          side="top"
        >
          <button
            disabled={!connected || !voice.canStream}
            className={`voice-action${voice.screen ? " on" : ""}`}
            aria-label={voice.screen ? "Parar transmissão" : "Compartilhar tela"}
            aria-pressed={voice.screen}
            onClick={() => void toggleScreenShare()}
          >
            <Icon name="monitor" size={18} />
            <span>{voice.screen ? "Ao vivo" : "Transmitir"}</span>
          </button>
        </Tooltip>
      </div>
      <span className="voice-panel-note">
        {connected ? `${count || 1} ${count === 1 || !count ? "pessoa na sala" : "pessoas na sala"}` : "Estabelecendo conexão de áudio"}
      </span>
    </div>
  );
}
