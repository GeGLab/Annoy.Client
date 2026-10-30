import { useEffect, useRef } from "react";
import { useStore } from "../store.ts";
import { callAction, useDirectCallMedia } from "../features/direct-calls.ts";
import { playCallFeedback } from "../lib/voice-feedback.ts";
import { toggleVoiceSetting } from "../client.ts";
import { Avatar, Icon, Modal } from "./ui.tsx";
import { Button } from "./ui/button.tsx";
import { UserVolumeControl } from "./UserVolumeControl.tsx";
import { userVolume } from "../../../shared/user-volume.ts";
import { RemoteAudioMixer, type AmplifiedAudio } from "../lib/remote-audio.ts";

function CallVideo({ stream, local = false }: { stream: MediaStream | null; local?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) { ref.current.srcObject = stream; if (stream?.getVideoTracks().length) void ref.current.play().catch(() => undefined); } }, [stream]);
  return <video ref={ref} autoPlay playsInline muted aria-label={local ? "Sua câmera" : "Câmera do seu amigo"} />;
}
export function DirectCallPanel() {
  const entry = useStore((s) => s.directCall);
  const instance = useStore((s) => entry ? s.instances[entry.accountId] : undefined);
  const settings = useStore((s) => s.settings);
  const media = useDirectCallMedia();
  const audio = useRef<HTMLAudioElement>(null);
  const amplified = useRef<AmplifiedAudio | null>(null);
  const ringing = entry?.call.status === "ringing";
  const incoming = entry?.call.calleeId === instance?.user?.id;
  const otherId = entry ? (incoming ? entry.call.callerId : entry.call.calleeId) : "";
  const percent = userVolume(settings.userVolumes, entry?.accountId ?? "", otherId);
  const audioTracks = media.remote?.getAudioTracks().map((track) => track.id).join("|") ?? "";
  useEffect(() => {
    if (!ringing || settings.manualPresence === "dnd") return;
    playCallFeedback("join");
    const timer = setInterval(() => playCallFeedback("join"), 1800);
    return () => clearInterval(timer);
  }, [ringing, settings.manualPresence]);
  useEffect(() => {
    const element = audio.current;
    if (!element || !media.remote?.getAudioTracks().length) return;
    const mixer = new RemoteAudioMixer();
    const output = mixer.connect(new MediaStream(media.remote.getAudioTracks()), percent, element);
    amplified.current = output;
    return () => {
      element.pause(); element.srcObject = null;
      if (amplified.current === output) amplified.current = null;
      mixer.close();
    };
  }, [audioTracks, entry?.call.id]);
  useEffect(() => { amplified.current?.setVolume(percent); }, [percent, audioTracks, entry?.call.id]);
  useEffect(() => {
    const element = audio.current;
    if (!element || !amplified.current) return;
    const stream = amplified.current.stream;
    let active = true;
    element.muted = settings.selfDeaf;
    const sink = "setSinkId" in element ? element.setSinkId(settings.outputDeviceId === "default" ? "" : settings.outputDeviceId).catch(() => undefined) : Promise.resolve();
    void sink.then(() => { if (active && element.srcObject === stream) void element.play().catch(() => undefined); });
    return () => { active = false; };
  }, [audioTracks, entry?.call.id, settings.selfDeaf, settings.outputDeviceId]);
  if (!entry || !instance?.user) return null;
  const friend = instance.relationships.find((relationship) => relationship.user.id === otherId);
  const other = friend?.user ?? instance.dms.flatMap((dm) => dm.recipients).find((user) => user.id === otherId);
  const name = friend?.nickname || other?.displayName || "Amigo";
  if (ringing) return <Modal title={incoming ? "Chamada recebida" : "Chamando…"} onClose={() => callAction(incoming ? "reject" : "end")} className="direct-call-invite">
    <div className="call-invite-person">{other && <Avatar user={other} size={80} />}<h3>{name}</h3><p className="muted">{incoming ? "Quer conversar com você" : "Aguardando atender"} · {entry.call.video ? "Vídeo e áudio" : "Áudio"}</p></div>
    <div className="call-invite-actions"><Button variant="secondary" onClick={() => callAction(incoming ? "reject" : "end")}><Icon name="hangup" />{incoming ? "Recusar" : "Cancelar"}</Button>{incoming && <Button onClick={() => callAction("accept")}><Icon name={entry.call.video ? "camera" : "phone"} />Atender</Button>}</div>
  </Modal>;
  return <section className="direct-call-panel" aria-label={`Chamada com ${name}`}>
    <header>{other && <Avatar user={other} size={32} />}<div><strong>{name}</strong><small>{media.connected ? "Chamada conectada" : "Conectando mídia…"}</small></div><Icon name={entry.call.video ? "camera" : "phone"} /></header>
    <UserVolumeControl accountId={entry.accountId} userId={otherId} name={name} />
    <audio ref={audio} autoPlay />
    {entry.call.video && <div className="direct-call-video"><CallVideo stream={media.remote} /><CallVideo stream={media.local} local /></div>}
    <footer><button className={`icon-btn${settings.selfMute ? " danger" : ""}`} aria-label={settings.selfMute ? "Ativar microfone da chamada" : "Silenciar microfone da chamada"} onClick={() => toggleVoiceSetting("selfMute")}><Icon name={settings.selfMute ? "micOff" : "mic"} /></button><button className="icon-btn" aria-label={settings.selfDeaf ? "Ativar áudio da chamada" : "Desativar áudio da chamada"} onClick={() => toggleVoiceSetting("selfDeaf")}><Icon name={settings.selfDeaf ? "headphonesOff" : "headphones"} /></button><Button variant="destructive" onClick={() => callAction("end")}><Icon name="hangup" />Encerrar</Button></footer>
  </section>;
}
