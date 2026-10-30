import { openMic, type Mic } from "../noise.ts";
import type { DirectCall, GatewayEvent, ClientOp } from "@distopic/protocol";
import { useSyncExternalStore } from "react";
import { apiFor, gatewayFor, leaveVoice } from "../client.ts";
import { getState, setState, toast } from "../store.ts";
import { playCallFeedback } from "../lib/voice-feedback.ts";
import { deviceId } from "../lib/device-id.ts";

export const callDeviceId = deviceId;
let media = { local: null as MediaStream | null, remote: null as MediaStream | null, connected: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
let peer: RTCPeerConnection | null = null, sessionId: string | null = null;
let callMic: Mic | null = null;
let preparing: Promise<RTCPeerConnection> | null = null;
let candidates: RTCIceCandidateInit[] = [];
export const useDirectCallMedia = () => useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => media);

function cleanup() {
  sessionId = null; preparing = null; candidates = [];
  const connection = peer; peer = null; connection?.close();
  callMic?.stop(); callMic = null;
  media.local?.getTracks().forEach((track) => track.stop());
  media.remote?.getTracks().forEach((track) => track.stop());
  media = { local: null, remote: null, connected: false }; emit();
}
export function callAction(action: "accept" | "reject" | "end") {
  const entry = getState().directCall;
  if (!entry) return;
  if (action === "accept") leaveVoice();
  gatewayFor(entry.accountId)?.send({ op: "call", deviceId: callDeviceId, callId: entry.call.id, action });
  if (action !== "accept") { cleanup(); setState((s) => { s.directCall = null; }); }
}
export async function startDirectCall(accountId: string, userId: string, video: boolean) {
  if (!getState().instances[accountId]?.instance?.directCalls) return toast("Esta instância precisa ser atualizada para chamadas privadas.");
  if (getState().directCall) return toast("Encerre a chamada privada atual primeiro.");
  try { leaveVoice(); await apiFor(accountId).post<DirectCall>("/calls", { userId, video, deviceId: callDeviceId }); }
  catch (error) { toast((error as Error).message); }
}
function sendSignal(accountId: string, call: DirectCall, signal: Extract<ClientOp, { op: "call" }>["signal"]) {
  gatewayFor(accountId)?.send({ op: "call", callId: call.id, deviceId: callDeviceId, action: "signal", signal });
}
function prepare(accountId: string, call: DirectCall): Promise<RTCPeerConnection> {
  if (sessionId === call.id && preparing) return preparing;
  cleanup(); sessionId = call.id;
  const connection = new RTCPeerConnection({ iceServers: call.iceServers ?? [] }); peer = connection;
  const remote = new MediaStream(); media = { ...media, remote }; emit();
  connection.ontrack = (event) => {
    if (sessionId !== call.id) return;
    if (!remote.getTracks().some((track) => track.id === event.track.id)) remote.addTrack(event.track);
    // A new stream reference also attaches tracks that arrived after the empty stream was rendered.
    media = { ...media, remote: new MediaStream(remote.getTracks()) }; emit();
  };
  connection.onicecandidate = (event) => { if (event.candidate && sessionId === call.id) sendSignal(accountId, call, { candidate: { ...event.candidate.toJSON(), candidate: event.candidate.candidate } }); };
  connection.onconnectionstatechange = () => {
    if (sessionId !== call.id) return;
    if (connection.connectionState === "failed") { toast("A conexão da chamada falhou. Confira a rede ou a configuração TURN da instância."); callAction("end"); }
    if (connection.connectionState === "connected") { media = { ...media, connected: true }; emit(); }
  };
  preparing = (async () => {
    const settings = getState().settings;
    const mic = await openMic(settings.inputDeviceId, settings.noiseFilter);
    if (sessionId !== call.id) { mic.stop(); throw new Error("Chamada encerrada"); }
    callMic = mic;
    const stream = new MediaStream([mic.track]);
    if (call.video) {
      const camera = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, ...(settings.cameraDeviceId !== "default" && { deviceId: { exact: settings.cameraDeviceId } }) } });
      if (sessionId !== call.id) { camera.getTracks().forEach((track) => track.stop()); mic.stop(); throw new Error("Chamada encerrada"); }
      camera.getVideoTracks().forEach((track) => stream.addTrack(track));
    }
    if (sessionId !== call.id) { stream.getTracks().forEach((track) => track.stop()); throw new Error("Chamada encerrada"); }
    for (const track of stream.getTracks()) { if (track.kind === "audio") track.enabled = !settings.selfMute && !settings.selfDeaf; connection.addTrack(track, stream); }
    media = { ...media, local: stream }; updateDirectCallMute(); emit(); return connection;
  })();
  return preparing;
}
export function updateDirectCallMute() {
  const settings = getState().settings;
  media.local?.getAudioTracks().forEach((track) => { track.enabled = !settings.selfMute && !settings.selfDeaf; });
}
export async function handleDirectCallEvent(accountId: string, event: Extract<GatewayEvent, { t: "CALL_UPDATE" | "CALL_SIGNAL" }>) {
  try {
    if (event.t === "CALL_UPDATE") {
      const call = event.d, me = getState().instances[accountId]?.user?.id;
      if (me !== call.callerId && me !== call.calleeId) return;
      if (me === call.callerId && call.callerDeviceId !== callDeviceId) return;
      if (call.status === "active" && me === call.calleeId && call.calleeDeviceId !== callDeviceId) { if (getState().directCall?.call.id === call.id) { cleanup(); setState((s) => { s.directCall = null; }); } return; }
      if (call.status === "ended") { if (getState().directCall?.call.id !== call.id) return; cleanup(); setState((s) => { s.directCall = null; }); playCallFeedback("leave"); if (call.reason) toast(call.reason); return; }
      const existed = getState().directCall?.call;
      if (getState().settings.manualPresence !== "dnd" && incomingNotificationNeeded(call, me, existed?.id)) {
        window.distopic?.flashWindow();
        if (!document.hasFocus()) try { const notification = new Notification("Chamada recebida", { body: `${getState().instances[accountId]?.relationships.find((r) => r.user.id === call.callerId)?.user.displayName ?? "Um amigo"} está chamando você.`, silent: true }); notification.onclick = () => window.focus(); } catch { /* The in-app invitation and ringtone remain available. */ }
      }
      setState((s) => { s.directCall = { accountId, call }; });
      if (call.status === "active" && existed?.status !== "active") {
        playCallFeedback("join");
        const connection = await prepare(accountId, call);
        if (me === call.callerId) { const offer = await connection.createOffer(); await connection.setLocalDescription(offer); sendSignal(accountId, call, { description: { type: "offer", sdp: offer.sdp! } }); }
      }
    } else {
      const entry = getState().directCall;
      if (!entry || entry.accountId !== accountId || entry.call.id !== event.d.callId || entry.call.status !== "active") return;
      const connection = await prepare(accountId, entry.call), signal = event.d.signal;
      if (signal.description) {
        await connection.setRemoteDescription(signal.description);
        for (const candidate of candidates.splice(0)) await connection.addIceCandidate(candidate);
        if (signal.description.type === "offer") { const answer = await connection.createAnswer(); await connection.setLocalDescription(answer); sendSignal(accountId, entry.call, { description: { type: "answer", sdp: answer.sdp! } }); }
      } else if (signal.candidate) {
        if (connection.remoteDescription) await connection.addIceCandidate(signal.candidate); else candidates.push(signal.candidate);
      }
    }
  } catch (error) { if (getState().directCall?.accountId === accountId) { toast((error as Error).message); callAction("end"); } }
}
export function disconnectDirectCall(accountId: string) { if (getState().directCall?.accountId === accountId) { cleanup(); setState((s) => { s.directCall = null; }); } }
const incomingNotificationNeeded = (call: DirectCall, userId: string | undefined, previousId?: string) => call.status === "ringing" && call.calleeId === userId && previousId !== call.id;
