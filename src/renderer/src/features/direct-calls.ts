import {t as translate} from "../../../shared/localization/index.ts";
import { openMic, type Mic } from "../noise.ts";
import type { DirectCall, GatewayEvent, ClientOp } from "@distopic/protocol";
import { useSyncExternalStore } from "react";
import { apiFor, gatewayFor, leaveVoice } from "../client.ts";
import { getState, setState, toast } from "../store.ts";
import { playCallFeedback } from "../lib/voice-feedback.ts";
import { deviceId } from "../lib/device-id.ts";
import { CallEncryption, callEncryptionSupported, needsEncodedStreamsFlag } from "../media-e2ee/call-encryption.ts";
import type { VoiceMediaEvent } from "@distopic/protocol";

export const callDeviceId = deviceId;
let media = { local: null as MediaStream | null, remote: null as MediaStream | null, connected: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
let peer: RTCPeerConnection | null = null, sessionId: string | null = null;
let callMic: Mic | null = null;
let preparing: Promise<RTCPeerConnection> | null = null;
let candidates: RTCIceCandidateInit[] = [];
/** SFrame for an encrypted call: an MLS group of the two devices, sequenced by the server. */
let crypt: CallEncryption | null = null;
let protectedReceivers = new WeakSet<RTCRtpReceiver>();
/** Chromium only feeds a receive transform installed before the section starts receiving. */
function protectReceiver(receiver: RTCRtpReceiver, kind: "audio" | "video") {
  if (!crypt || protectedReceivers.has(receiver)) return;
  protectedReceivers.add(receiver); crypt.protectReceiver(receiver, kind);
}
export const useDirectCallMedia = () => useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => media);

function cleanup() {
  sessionId = null; preparing = null; candidates = [];
  crypt?.close(); crypt = null; protectedReceivers = new WeakSet();
  const connection = peer; peer = null; connection?.close();
  callMic?.stop(); callMic = null;
  media.local?.getTracks().forEach((track) => track.stop());
  media.remote?.getTracks().forEach((track) => track.stop());
  media = { local: null, remote: null, connected: false }; emit();
}
export async function callAction(action: "accept" | "reject" | "end") {
  const entry = getState().directCall;
  if (!entry) return;
  const encrypted = entry.call.protection === "sframe";
  if (action === "accept") {
    if (encrypted && !callEncryptionSupported()) return toast(translate("common.924656d6c0c5"));
    if (!encrypted) toast(translate("common.c8095a61e755"), 6000);
    if (getState().directCall?.call.id !== entry.call.id) return;
    leaveVoice();
  }
  gatewayFor(entry.accountId)?.send({ op: "call", deviceId: callDeviceId, callId: entry.call.id, action, protection: encrypted ? "sframe" : "transport_only_acknowledged" });
  if (action !== "accept") { cleanup(); setState((s) => { s.directCall = null; }); }
}
export async function startDirectCall(accountId: string, userId: string, video: boolean) {
  if (getState().instances[accountId]?.status !== "ready") return toast(translate("common.94c2e2f7ad46"));
  if (!getState().instances[accountId]?.instance?.directCalls) return toast(translate("common.15fbe9001510"));
  if (getState().directCall) return toast("Encerre a chamada privada atual primeiro.");
  let encrypted = callEncryptionSupported();
  if (!encrypted) toast(translate("common.c8d9842c8940"), 6000);
  try {
    leaveVoice();
    let call: DirectCall;
    try { call = await apiFor(accountId).post<DirectCall>("/calls", { userId, video, deviceId: callDeviceId, protection: encrypted ? "sframe" : "transport_only_acknowledged" }); }
    catch (error) {
      // Servers before SFrame refuse the encrypted request: ask before calling without it.
      if (!encrypted || !/SFrame|E2EE/.test((error as Error).message)) throw error;
      toast(translate("common.17d86edbb3bf"), 6000);
      encrypted = false;
      call = await apiFor(accountId).post<DirectCall>("/calls", { userId, video, deviceId: callDeviceId, protection: "transport_only_acknowledged" });
    }
    // A server that ignored the request rings without E2EE: say so instead of continuing silently.
    if (encrypted && call.protection !== "sframe") toast(translate("common.17d86edbb3bf"), 6000);
  }
  catch (error) { toast((error as Error).message); }
}
function sendSignal(accountId: string, call: DirectCall, signal: Extract<ClientOp, { op: "call" }>["signal"]) {
  gatewayFor(accountId)?.send({ op: "call", callId: call.id, deviceId: callDeviceId, action: "signal", signal });
}
function prepare(accountId: string, call: DirectCall): Promise<RTCPeerConnection> {
  if (sessionId === call.id && preparing) return preparing;
  cleanup(); sessionId = call.id;
  const encrypted = call.protection === "sframe";
  const connection = new RTCPeerConnection({ iceServers: call.iceServers ?? [], ...(encrypted && needsEncodedStreamsFlag && { encodedInsertableStreams: true }) } as RTCConfiguration); peer = connection;
  const remote = new MediaStream(); media = { ...media, remote }; emit();
  connection.ontrack = (event) => {
    if (sessionId !== call.id) return;
    // Remote descriptions are applied only after `preparing`, so the call key exchange already started.
    if (encrypted) { if (!crypt) return; protectReceiver(event.receiver, event.track.kind === "video" ? "video" : "audio"); }
    if (!remote.getTracks().some((track) => track.id === event.track.id)) remote.addTrack(event.track);
    // A new stream reference also attaches tracks that arrived after the empty stream was rendered.
    media = { ...media, remote: new MediaStream(remote.getTracks()) }; emit();
  };
  connection.onicecandidate = (event) => { if (event.candidate && sessionId === call.id) sendSignal(accountId, call, { candidate: { ...event.candidate.toJSON(), candidate: event.candidate.candidate } }); };
  connection.onconnectionstatechange = () => {
    if (sessionId !== call.id) return;
    if (connection.connectionState === "failed") { toast(translate("common.51b873d7167c")); callAction("end"); }
    if (connection.connectionState === "connected") { media = { ...media, connected: true }; emit(); }
  };
  preparing = (async () => {
    if (encrypted) {
      const account = getState().accounts.find((a) => a.id === accountId), gateway = gatewayFor(accountId);
      if (!account || !gateway) throw new Error(translate("common.d767ea00e698"));
      const signaling = { voice: <T,>(method: "mediaCreate" | "mediaPropose" | "mediaCommit", data: Record<string, unknown>) => gateway.voice<T>(method, { ...data, directCall: call.id }) };
      const started = await CallEncryption.start(signaling, { url: account.url, token: account.token, userId: account.userId }, "call:" + call.id, { callId: null }, (message) => toast(message, 10000));
      if (sessionId !== call.id) { started.close(); throw new Error(translate("common.b868f5fbf270")); }
      crypt = started;
    }
    const settings = getState().settings;
    const mic = await openMic(settings.inputDeviceId, settings.noiseFilter);
    if (sessionId !== call.id) { mic.stop(); throw new Error(translate("common.b868f5fbf270")); }
    callMic = mic;
    const stream = new MediaStream([mic.track]);
    if (call.video) {
      const camera = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, ...(settings.cameraDeviceId !== "default" && { deviceId: { exact: settings.cameraDeviceId } }) } });
      if (sessionId !== call.id) { camera.getTracks().forEach((track) => track.stop()); mic.stop(); throw new Error(translate("common.b868f5fbf270")); }
      camera.getVideoTracks().forEach((track) => stream.addTrack(track));
    }
    if (sessionId !== call.id) { stream.getTracks().forEach((track) => track.stop()); throw new Error(translate("common.b868f5fbf270")); }
    for (const track of stream.getTracks()) {
      if (track.kind === "audio") track.enabled = !settings.selfMute && !settings.selfDeaf;
      const sender = connection.addTrack(track, stream);
      // Before any offer or answer: no frame of this call leaves without SFrame.
      if (crypt) {
        crypt.protectSender(sender, track.kind === "video" ? "camera" : "mic", track.kind === "video" ? "video" : "audio");
        const transceiver = connection.getTransceivers().find((t) => t.sender === sender);
        if (transceiver) protectReceiver(transceiver.receiver, track.kind === "video" ? "video" : "audio");
        if (track.kind === "video") preferVp8(transceiver);
      }
    }
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
    if (getState().instances[accountId]?.status !== "ready") return;
    if (event.t === "CALL_UPDATE") {
      const call = event.d, me = getState().instances[accountId]?.user?.id;
      if (me !== call.callerId && me !== call.calleeId) return;
      if (me === call.callerId && call.callerDeviceId !== callDeviceId) return;
      if (call.status === "active" && me === call.calleeId && call.calleeDeviceId !== callDeviceId) { if (getState().directCall?.call.id === call.id) { cleanup(); setState((s) => { s.directCall = null; }); } return; }
      if (call.status === "ended") { if (getState().directCall?.call.id !== call.id) return; cleanup(); setState((s) => { s.directCall = null; }); playCallFeedback("leave"); if (call.reason) toast(call.reason); return; }
      const existed = getState().directCall?.call;
      if (getState().settings.manualPresence !== "dnd" && incomingNotificationNeeded(call, me, existed?.id)) {
        window.distopic?.flashWindow();
        if (!document.hasFocus()) try { const notification = new Notification(translate("common.93947904c31c"), { body: `${getState().instances[accountId]?.relationships.find((r) => r.user.id === call.callerId)?.user.displayName ?? translate("common.9980aa129514")} está chamando você.`, silent: true }); notification.onclick = () => window.focus(); } catch { /* The in-app invitation and ringtone remain available. */ }
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
  } catch (error) {
    const callId = event.t === "CALL_UPDATE" ? event.d.id : event.d.callId;
    if (getState().directCall?.accountId === accountId && getState().directCall?.call.id === callId) { toast((error as Error).message); callAction("end"); }
  }
}
export function handleDirectCallMedia(accountId: string, event: VoiceMediaEvent) {
  const entry = getState().directCall;
  if (entry?.accountId === accountId && event.channelId === "call:" + entry.call.id) crypt?.handleEvent(event);
}
/** True when the media of the current private call is end-to-end encrypted. */
export const directCallEncrypted = () => crypt !== null;
export const directCallStats = () => crypt?.stats() ?? Promise.resolve(null);
function preferVp8(transceiver: RTCRtpTransceiver | undefined) {
  const codecs = RTCRtpSender.getCapabilities("video")?.codecs ?? [];
  const allowed = codecs.filter((c) => /^video\/(vp8|rtx|red|ulpfec)$/i.test(c.mimeType));
  if (transceiver && allowed.some((c) => /vp8$/i.test(c.mimeType))) transceiver.setCodecPreferences(allowed);
}
export function disconnectDirectCall(accountId: string) { if (getState().directCall?.accountId === accountId) { cleanup(); setState((s) => { s.directCall = null; }); } }
const incomingNotificationNeeded = (call: DirectCall, userId: string | undefined, previousId?: string) => call.status === "ringing" && call.calleeId === userId && previousId !== call.id;
