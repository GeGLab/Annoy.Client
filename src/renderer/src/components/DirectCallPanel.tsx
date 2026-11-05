import {rich} from "../lib/localization.ts";
import {t as translate} from "../../../shared/localization/index.ts";
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
import { CLOUD_ACCOUNT } from "../social/types.ts";
import { cloudUser } from "./social/SocialHome.tsx";

function CallVideo({ stream, local = false }: { stream: MediaStream | null; local?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) { ref.current.srcObject = stream; if (stream?.getVideoTracks().length) void ref.current.play().catch(() => undefined); } }, [stream]);
  return <video ref={ref} autoPlay playsInline muted aria-label={local ? translate("common.ed2e4192d344") : translate("common.d8c1dea677cb")} />;
}
export function DirectCallPanel() {
  const entry = useStore((s) => s.directCall);
  const instance = useStore((s) => entry ? s.instances[entry.accountId] : undefined);
  const cloudCall = entry?.accountId === CLOUD_ACCOUNT;
  const cloudMe = useStore((s) => s.social.me?.id);
  const cloudFriends = useStore((s) => s.social.relationships);
  const cloudProfiles = useStore((s) => s.social.profiles);
  const settings = useStore((s) => s.settings);
  const media = useDirectCallMedia();
  const audio = useRef<HTMLAudioElement>(null);
  const amplified = useRef<AmplifiedAudio | null>(null);
  const ringing = entry?.call.status === "ringing";
  const myId = cloudCall ? cloudMe : instance?.user?.id;
  const incoming = entry?.call.calleeId === myId;
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
  if (!entry || !myId) return null;
  let other: import("@distopic/protocol").User | undefined, name: string;
  if (cloudCall) {
    other = cloudUser(cloudProfiles[otherId], otherId);
    name = cloudFriends.find((r) => r.user.id === otherId)?.nickname || other.displayName;
  } else {
    const friend = instance!.relationships.find((relationship) => relationship.user.id === otherId);
    other = friend?.user ?? instance!.dms.flatMap((dm) => dm.recipients).find((user) => user.id === otherId);
    name = friend?.nickname || other?.displayName || translate("common.dfdf1ff8c702");
  }
  if (ringing) return <Modal title={incoming ? translate("common.93947904c31c") : translate("common.c330e6eab743")} onClose={() => callAction(incoming ? "reject" : "end")} className="direct-call-invite">
    <div className="call-invite-person">{other && <Avatar user={other} size={80} />}<h3>{name}</h3><p className="muted">{incoming ? translate("common.b691e187af93") : translate("common.74d16463d404")} · {entry.call.video ? translate("common.63fb625e5405") : translate("common.195c60bb2325")}</p></div>
    <div className="call-invite-actions"><Button variant="secondary" onClick={() => callAction(incoming ? "reject" : "end")}><Icon name="hangup" />{incoming ? translate("common.ce432849d60e") : translate("common.bb9dbb406dcb")}</Button>{incoming && <Button onClick={() => callAction("accept")}>{rich("common.c783dd737e63",{p0:(<Icon name={entry.call.video ? "camera" : "phone"} />)})}</Button>}</div>
  </Modal>;
  return <section className="direct-call-panel" aria-label={translate("common.395edaa78986",{p0:(name)})}>
    <header>{other && <Avatar user={other} size={32} />}<div><strong>{name}</strong><small>{media.connected ? translate("common.77a41191fcc1") : translate("common.c059f8b22580")}</small></div><Icon name={entry.call.video ? "camera" : "phone"} /></header>
    <UserVolumeControl accountId={entry.accountId} userId={otherId} name={name} />
    <audio ref={audio} autoPlay />
    {entry.call.video && <div className="direct-call-video"><CallVideo stream={media.remote} /><CallVideo stream={media.local} local /></div>}
    <footer><button className={`icon-btn${settings.selfMute ? " danger" : ""}`} aria-label={settings.selfMute ? translate("common.52d69c135ad9") : translate("common.b07117293797")} onClick={() => toggleVoiceSetting("selfMute")}><Icon name={settings.selfMute ? "micOff" : "mic"} /></button><button className="icon-btn" aria-label={settings.selfDeaf ? translate("common.0490315480b4") : translate("common.7080663704f1")} onClick={() => toggleVoiceSetting("selfDeaf")}><Icon name={settings.selfDeaf ? "headphonesOff" : "headphones"} /></button><Button variant="destructive" onClick={() => callAction("end")}>{rich("common.05c882069cb5",{p0:(<Icon name="hangup" />)})}</Button></footer>
  </section>;
}
