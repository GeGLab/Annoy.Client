import {t as translate} from "../../../shared/localization/index.ts";
import { openMic, type Mic } from "../noise.ts";
import type { DirectCall, GatewayEvent, ClientOp } from "@annoy/protocol";
import { useSyncExternalStore } from "react";
import { apiFor, gatewayFor, leaveVoice } from "../client.ts";
import { getState, setState, toast, type Settings } from "../store.ts";
import { savedDevice } from "../lib/devices.ts";
import { playCallFeedback } from "../lib/voice-feedback.ts";
import { deviceId } from "../lib/device-id.ts";
import { CLOUD_ACCOUNT } from "../social/types.ts";
import { cloudDevice, displayName, runtime } from "../social/runtime.ts";
import { onCallEvent } from "../social/index.ts";
import { cloud } from "../social/cloud.ts";

/**
 * Direct calls of the Annoy account (TODO item 1) ring through chatannoy, with
 * accountId CLOUD_ACCOUNT. Media goes PC to PC (or via TURN), encrypted by
 * WebRTC (DTLS-SRTP); no SFrame layer on this path.
 */
const isCloud = (accountId: string) => accountId === CLOUD_ACCOUNT;
let cloudIce: RTCIceServer[] = [];
const deviceFor = (accountId: string) => (isCloud(accountId) ? cloudDevice() : callDeviceId);
const meFor = (accountId: string) => (isCloud(accountId) ? runtime.me ?? undefined : getState().instances[accountId]?.user?.id);
const readyFor = (accountId: string) => (isCloud(accountId) ? getState().social.status === "ready" : getState().instances[accountId]?.status === "ready");
async function refreshCloudIce(): Promise<void> {
  try {
    cloudIce = (await cloud<{ iceServers: RTCIceServer[] }>("chat", "/v1/calls/ice", { body: {} })).iceServers;
  } catch {
    cloudIce = [{ urls: "stun:stun.cloudflare.com:3478" }];
  }
}
onCallEvent((event) => {
  if (event.t === "CALL_UPDATE" || event.t === "CALL_SIGNAL") void handleDirectCallEvent(CLOUD_ACCOUNT, event as Extract<GatewayEvent, { t: "CALL_UPDATE" | "CALL_SIGNAL" }>);
  else if (event.t === "CALL_ERROR") toast(String(event.d?.reason ?? ""));
  else if (event.t === "RELATIONSHIP_REMOVE") {
    const entry = getState().directCall;
    if (entry && isCloud(entry.accountId) && [entry.call.callerId, entry.call.calleeId].includes(event.d.userId)) callAction("end");
  } else if (event.t === "SIGNED_OUT") disconnectDirectCall(CLOUD_ACCOUNT);
});

export const callDeviceId = deviceId;
let media = { local: null as MediaStream | null, remote: null as MediaStream | null, connected: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
let peer: RTCPeerConnection | null = null, sessionId: string | null = null;
let callMic: Mic | null = null;
/** Settings the call's microphone was opened with; a new noise filter or device reopens it at once. */
let callMicSettings: Settings | null = null;
let callMicReopening = false;
let preparing: Promise<RTCPeerConnection> | null = null;
let candidates: RTCIceCandidateInit[] = [];
export const useDirectCallMedia = () => useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => media);

function cleanup() {
  sessionId = null; preparing = null; candidates = [];
  const connection = peer; peer = null; connection?.close();
  callMic?.stop(); callMic = null; callMicSettings = null;
  media.local?.getTracks().forEach((track) => track.stop());
  media.remote?.getTracks().forEach((track) => track.stop());
  media = { local: null, remote: null, connected: false }; emit();
}
export async function callAction(action: "accept" | "reject" | "end") {
  const entry = getState().directCall;
  if (!entry) return;
  if (action === "accept" && isCloud(entry.accountId)) {
    leaveVoice();
    await refreshCloudIce();
    runtime.gateway?.send({ op: "call", callId: entry.call.id, action });
    return;
  }
  if (isCloud(entry.accountId)) {
    runtime.gateway?.send({ op: "call", callId: entry.call.id, action });
    cleanup(); setState((s) => { s.directCall = null; });
    return;
  }
  if (action === "accept") {
    if (getState().directCall?.call.id !== entry.call.id) return;
    leaveVoice();
  }
  gatewayFor(entry.accountId)?.send({ op: "call", deviceId: callDeviceId, callId: entry.call.id, action });
  if (action !== "accept") { cleanup(); setState((s) => { s.directCall = null; }); }
}
export async function startDirectCall(accountId: string, userId: string, video: boolean) {
  // A member of an Annoy-account server: the call goes through chatannoy.
  if (!isCloud(accountId) && getState().instances[accountId]?.instance?.annoySocial) {
    const { annoyIdOf } = await import("../client.ts");
    const annoyId = annoyIdOf(accountId, userId);
    if (!annoyId) return toast(translate("social.noAnnoyId"));
    return startDirectCall(CLOUD_ACCOUNT, annoyId, video);
  }
  if (isCloud(accountId)) {
    if (!readyFor(accountId)) return toast(translate("social.cloudOffline"));
    if (getState().directCall) return toast(translate("common.f56448863241"));
    leaveVoice();
    await refreshCloudIce();
    runtime.gateway?.send({ op: "call", action: "invite", userId, video });
    return;
  }
  if (getState().instances[accountId]?.status !== "ready") return toast(translate("common.94c2e2f7ad46"));
  if (!getState().instances[accountId]?.instance?.directCalls) return toast(translate("common.15fbe9001510"));
  if (getState().directCall) return toast(translate("common.f56448863241"));
  try {
    leaveVoice();
    await apiFor(accountId).post<DirectCall>("/calls", { userId, video, deviceId: callDeviceId });
  }
  catch (error) { toast((error as Error).message); }
}
function sendSignal(accountId: string, call: DirectCall, signal: Extract<ClientOp, { op: "call" }>["signal"]) {
  if (isCloud(accountId)) { runtime.gateway?.send({ op: "call", callId: call.id, action: "signal", signal }); return; }
  gatewayFor(accountId)?.send({ op: "call", callId: call.id, deviceId: callDeviceId, action: "signal", signal });
}
function prepare(accountId: string, call: DirectCall): Promise<RTCPeerConnection> {
  if (sessionId === call.id && preparing) return preparing;
  cleanup(); sessionId = call.id;
  const connection = new RTCPeerConnection({ iceServers: isCloud(accountId) ? cloudIce : (call.iceServers ?? []) }); peer = connection;
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
    if (connection.connectionState === "failed") { toast(translate("common.51b873d7167c")); callAction("end"); }
    if (connection.connectionState === "connected") { media = { ...media, connected: true }; emit(); }
  };
  preparing = (async () => {
    const settings = getState().settings;
    const mic = await openMic(settings.inputDeviceId, settings.noiseFilter, settings.micFilters, settings.inputDeviceLabel);
    if (sessionId !== call.id) { mic.stop(); throw new Error(translate("common.b868f5fbf270")); }
    callMic = mic; callMicSettings = settings;
    const stream = new MediaStream([mic.track]);
    if (call.video) {
      const cameraId = await savedDevice("camera", settings);
      const camera = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 }, ...(cameraId && { deviceId: { exact: cameraId } }) } });
      if (sessionId !== call.id) { camera.getTracks().forEach((track) => track.stop()); mic.stop(); throw new Error(translate("common.b868f5fbf270")); }
      camera.getVideoTracks().forEach((track) => stream.addTrack(track));
    }
    if (sessionId !== call.id) { stream.getTracks().forEach((track) => track.stop()); throw new Error(translate("common.b868f5fbf270")); }
    for (const track of stream.getTracks()) {
      if (track.kind === "audio") track.enabled = !settings.selfMute && !settings.selfDeaf;
      const sender = connection.addTrack(track, stream);
    }
    media = { ...media, local: stream }; updateDirectCallMute(); emit(); return connection;
  })();
  return preparing;
}
export function updateDirectCallMute() {
  const settings = getState().settings;
  media.local?.getAudioTracks().forEach((track) => { track.enabled = !settings.selfMute && !settings.selfDeaf; });
  callMic?.setFilters(settings.micFilters);
  if (callMic && callMicSettings && micChanged(callMicSettings, settings) && !callMicReopening) void reopenCallMic();
}
const micChanged = (a: Settings, b: Settings) => a.noiseFilter !== b.noiseFilter || a.inputDeviceId !== b.inputDeviceId || a.inputDeviceLabel !== b.inputDeviceLabel;
/** Opens the new capture, swaps it into the call without renegotiating, then closes the old one. */
async function reopenCallMic(): Promise<void> {
  callMicReopening = true;
  const session = sessionId;
  try {
    const settings = getState().settings;
    const next = await openMic(settings.inputDeviceId, settings.noiseFilter, settings.micFilters, settings.inputDeviceLabel);
    if (session !== sessionId || !peer || !callMic) { next.stop(); return; }
    next.track.enabled = !settings.selfMute && !settings.selfDeaf;
    await peer.getSenders().find((sender) => sender.track?.kind === "audio")?.replaceTrack(next.track);
    const old = callMic;
    callMic = next; callMicSettings = settings;
    media = { ...media, local: new MediaStream([next.track, ...(media.local?.getVideoTracks() ?? [])]) }; emit();
    old.stop();
  } catch (error) {
    console.warn("call microphone reopen failed", error);
  } finally {
    callMicReopening = false;
  }
  // Changed again while the new capture was opening.
  if (session === sessionId && callMic && callMicSettings && micChanged(callMicSettings, getState().settings)) void reopenCallMic();
}
export async function handleDirectCallEvent(accountId: string, event: Extract<GatewayEvent, { t: "CALL_UPDATE" | "CALL_SIGNAL" }>) {
  try {
    if (!readyFor(accountId)) return;
    if (event.t === "CALL_UPDATE") {
      const call = event.d, me = meFor(accountId), device = deviceFor(accountId);
      if (me !== call.callerId && me !== call.calleeId) return;
      if (me === call.callerId && call.callerDeviceId !== device) return;
      if (call.status === "active" && me === call.calleeId && call.calleeDeviceId !== device) { if (getState().directCall?.call.id === call.id) { cleanup(); setState((s) => { s.directCall = null; }); } return; }
      if (call.status === "ended") { if (getState().directCall?.call.id !== call.id) return; cleanup(); setState((s) => { s.directCall = null; }); playCallFeedback("leave"); if (call.reason) toast(call.reason); return; }
      const existed = getState().directCall?.call;
      if (getState().settings.manualPresence !== "dnd" && incomingNotificationNeeded(call, me, existed?.id)) {
        window.annoy?.flashWindow();
        if (!document.hasFocus()) try { const notification = new Notification(translate("common.93947904c31c"), { body: translate("common.beceda3adc2f",{p0:((isCloud(accountId) ? displayName(getState().social.profiles[call.callerId]) : getState().instances[accountId]?.relationships.find((r) => r.user.id === call.callerId)?.user.displayName) || translate("common.9980aa129514"))}), silent: true }); notification.onclick = () => window.focus(); } catch { /* The in-app invitation and ringtone remain available. */ }
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
export function disconnectDirectCall(accountId: string) { if (getState().directCall?.accountId === accountId) { cleanup(); setState((s) => { s.directCall = null; }); } }
const incomingNotificationNeeded = (call: DirectCall, userId: string | undefined, previousId?: string) => call.status === "ringing" && call.calleeId === userId && previousId !== call.id;
