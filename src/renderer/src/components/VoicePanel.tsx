import {rich} from "../lib/localization.ts";
import {t as translate,counted} from "../../../shared/localization/index.ts";
import { useEffect, useState } from "react";
import { leaveVoice, openChannel, toggleCamera, toggleScreenShare, updateVoiceSettings } from "../client.ts";
import { setState, useStore } from "../store.ts";
import { deviceChoice, shownDevice } from "../lib/devices.ts";
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
  const savedId = useStore((s) => (kind === "input" ? s.settings.inputDeviceId : s.settings.outputDeviceId));
  const savedLabel = useStore((s) => (kind === "input" ? s.settings.inputDeviceLabel : s.settings.outputDeviceLabel));
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
          aria-label={kind === "input" ? translate("common.621f11d1b81b") : translate("common.060bba66a58c")}
          title={translate("common.7e0468cd5c35")}
        >
          <Icon name="chevron" size={11} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="device-dropdown">
        <DropdownMenuLabel>{kind === "input" ? translate("common.1b9441c4f487") : translate("common.fac2b769ff4a")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={shownDevice(savedId, savedLabel, devices)}
          onValueChange={(value) => {
            setState((s) => {
              Object.assign(s.settings, deviceChoice(kind, value, devices));
            });
            updateVoiceSettings();
          }}
        >
          <DropdownMenuRadioItem value="default">{translate("common.f48584be4417")}</DropdownMenuRadioItem>
          {devices.map((device) => (
            <DropdownMenuRadioItem key={device.deviceId} value={device.deviceId}>
              {device.label || (kind === "input" ? translate("common.39aa7e5f1a46") : translate("common.208ad472ea8e"))}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() =>
            setState((s) => {
              s.modal = { kind: "userSettings", section: "voice" };
            })
          }
        >{rich("common.c1a8976a48bc",{p0:(<Icon name="sliders" />)})}</DropdownMenuItem>
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
          aria-label={translate("common.9c0c279ac93f")}
        >
          <strong>{connected ? translate("common.e58c700521d2") : translate("common.cc190ab9f5ec")}</strong>
          <span className="truncate">
            {channel?.name ?? translate("settings.c9566ca43bdc")} / {server?.server.name ?? translate("common.05e427a291c2")}
          </span>
        </button>
        <Tooltip content={translate("common.df851ef5297e")} side="top">
          <button className="icon-btn danger" aria-label={translate("common.e047771bf38f")} onClick={() => leaveVoice()}>
            <Icon name="hangup" size={18} />
          </button>
        </Tooltip>
      </div>
      <div className="voice-panel-actions">
        <Tooltip
          content={!voice.canStream ? translate("common.957726dc235e") : voice.camera ? translate("common.7c25aa8599d9") : translate("common.df2b6ab01662")}
          side="top"
        >
          <button
            disabled={!connected || !voice.canStream}
            className={`voice-action${voice.camera ? " on" : ""}`}
            aria-label={voice.camera ? translate("common.7c25aa8599d9") : translate("common.df2b6ab01662")}
            aria-pressed={voice.camera}
            onClick={() => void toggleCamera()}
          >
            <Icon name={voice.camera ? "camera" : "cameraOff"} size={18} />
            <span>{translate("common.dafb61aca12d")}</span>
          </button>
        </Tooltip>
        <Tooltip
          content={!voice.canStream ? translate("common.957726dc235e") : voice.screen ? translate("common.6ef17b51fd93") : translate("common.b1f3d8d4c916")}
          side="top"
        >
          <button
            disabled={!connected || !voice.canStream}
            className={`voice-action${voice.screen ? " on" : ""}`}
            aria-label={voice.screen ? translate("common.6ef17b51fd93") : translate("common.b1f3d8d4c916")}
            aria-pressed={voice.screen}
            onClick={() => void toggleScreenShare()}
          >
            <Icon name="monitor" size={18} />
            <span>{voice.screen ? translate("common.6872fc989a63") : translate("common.85344dae041c")}</span>
          </button>
        </Tooltip>
      </div>
      <span className="voice-panel-note">
        {connected ? counted(count || 1,"counts.room.one","counts.room.other") : translate("common.7372b662aff9")}
      </span>
    </div>
  );
}




