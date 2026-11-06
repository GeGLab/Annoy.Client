// What the others receive from your microphone: the call's track sent through a
// local WebRTC connection, encoded with the same Opus settings as a call
// (64 kbps, FEC, DTX) and decoded again. Nothing leaves this computer.
import { OPUS_VOICE, tuneOpus } from "../media-profiles.ts";

export interface OpusLoopback {
  /** The decoded track, as a call would play it. */
  track: MediaStreamTrack;
  /** Sends another track through the same connection (new noise filter or microphone). */
  replace(track: MediaStreamTrack): Promise<void>;
  close(): void;
}

export async function opusLoopback(track: MediaStreamTrack): Promise<OpusLoopback> {
  const send = new RTCPeerConnection();
  const receive = new RTCPeerConnection();
  const close = () => { send.close(); receive.close(); };
  try {
    send.onicecandidate = (event) => { if (event.candidate) void receive.addIceCandidate(event.candidate).catch(() => undefined); };
    receive.onicecandidate = (event) => { if (event.candidate) void send.addIceCandidate(event.candidate).catch(() => undefined); };
    const received = new Promise<MediaStreamTrack>((resolve) => { receive.ontrack = (event) => resolve(event.track); });
    const transceiver = send.addTransceiver(track, { direction: "sendonly" });
    await send.setLocalDescription(await send.createOffer());
    await receive.setRemoteDescription(send.localDescription!);
    const answer = await receive.createAnswer();
    await receive.setLocalDescription(answer);
    // The sender encodes by what the answer asks for: the same Opus settings as a call.
    await send.setRemoteDescription({ type: "answer", sdp: tuneOpus(answer.sdp!, new Map([[transceiver.mid!, OPUS_VOICE]])) });
    const decoded = await Promise.race([
      received,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("loopback timeout")), 5000)),
    ]);
    return { track: decoded, replace: (next) => transceiver.sender.replaceTrack(next), close };
  } catch (error) {
    close();
    throw error;
  }
}
