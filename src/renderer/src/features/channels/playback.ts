import { playbackPosition, type PlaybackAction, type PlaybackItem, type PlaybackState } from "@distopic/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFor } from "../../client.ts";
import { toast, useStore } from "../../store.ts";
import { onRoomEvent } from "./events.ts";
import { isCancellation } from "../../../../shared/requests.ts";

// One theater or song room's shared playback, and the loop that keeps this device on it.

export interface Playback {
  state: PlaybackState | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
  /** Server clock minus ours, in ms. */
  offset: number;
  send: (action: PlaybackAction) => Promise<void>;
}

export function usePlayback(accountId: string, channelId: string): Playback {
  const connected = useStore((s) => s.instances[accountId]?.status === "ready");
  const [state, setState] = useState<PlaybackState | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const apply = useCallback((next: PlaybackState) => {
    setOffset(next.serverTime - Date.now());
    setState(next);
  }, []);

  useEffect(() => {
    if (!connected) { setState(null); setLoading(false); setError(null); return; }
    let live = true;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void apiFor(accountId)
      .get<PlaybackState>(`/channels/${channelId}/playback`, controller.signal)
      .then((s) => { if (live) apply(s); })
      .catch((err: Error) => { if (live && !isCancellation(err)) setError(err.message); })
      .finally(() => { if (live) setLoading(false); });
    const off = onRoomEvent(accountId, channelId, (event) => {
      if (event.t === "PLAYBACK_UPDATE") { setError(null); setLoading(false); apply(event.d); }
    });
    return () => {
      live = false;
      controller.abort();
      off();
    };
  }, [accountId, channelId, apply, connected, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const send = useCallback(
    async (action: PlaybackAction) => {
      try {
        apply(await apiFor(accountId).post<PlaybackState>(`/channels/${channelId}/playback`, action));
      } catch (err) {
        toast((err as Error).message);
      }
    },
    [accountId, channelId, apply],
  );

  return { state: connected ? state : null, offset, send, loading: connected && loading, error: connected ? error : null, retry };
}

export const currentItem = (state: PlaybackState | null): PlaybackItem | null =>
  state?.queue.find((i) => i.id === state.currentId) ?? null;

/** What a player can do; the sync loop never cares whether it is a <video> or a web page. */
export interface Driver {
  /** Seconds, or null before the media is ready. */
  position(): number | null;
  paused(): boolean | null;
  apply(command: { action: "play" | "pause" | "seek"; position: number }): void;
}

export interface UserEvents {
  onUser(action: "play" | "pause" | "seek", position: number): void;
  onEnded(): void;
}

/** Drifting more than this is corrected with a seek; less is left alone to avoid stutter. */
const TOLERANCE_S = 2.5;

/** Keeps `driver` on the room's playback and turns the viewer's own actions into room actions. */
export function useSync(driver: Driver | null, playback: Playback, enabled = true): UserEvents {
  const { state, offset, send } = playback;
  const ref = useRef({ state, offset });
  ref.current = { state, offset };

  useEffect(() => {
    if (!driver || !enabled) return;
    const tick = () => {
      const { state: s, offset: o } = ref.current;
      if (!s?.currentId) return;
      const target = playbackPosition(s, o);
      const position = driver.position();
      const paused = driver.paused();
      if (position === null || paused === null) return;
      if (s.paused) {
        if (!paused || Math.abs(position - target) > 1) driver.apply({ action: "pause", position: target });
      } else if (paused || Math.abs(position - target) > TOLERANCE_S) {
        driver.apply({ action: "play", position: target });
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [driver, enabled, state]);

  return {
    onUser(action, position) {
      const s = ref.current.state;
      if (!s?.currentId) return;
      if (action === "pause" && !s.paused) void send({ op: "pause", position });
      else if (action === "play" && s.paused) void send({ op: "seek", position }).then(() => send({ op: "play" }));
      else if (action === "seek" && Math.abs(playbackPosition(s, ref.current.offset) - position) > 1) void send({ op: "seek", position });
    },
    onEnded() {
      const s = ref.current.state;
      if (s?.currentId) void send({ op: "ended", itemId: s.currentId });
    },
  };
}

/** Drives a <video>/<audio> element; events our own commands cause are not reported as the viewer's. */
export function elementDriver(el: HTMLMediaElement, events: () => UserEvents): { driver: Driver; dispose: () => void } {
  let quietUntil = 0;
  const user = (action: "play" | "pause" | "seek") => () => {
    if (Date.now() < quietUntil || (action === "pause" && el.ended)) return;
    events().onUser(action, el.currentTime);
  };
  const handlers: [string, () => void][] = [
    ["play", user("play")],
    ["pause", user("pause")],
    ["seeked", user("seek")],
    ["ended", () => events().onEnded()],
  ];
  for (const [name, fn] of handlers) el.addEventListener(name, fn);
  const driver: Driver = {
    position: () => (el.readyState >= 1 ? el.currentTime : null),
    paused: () => (el.readyState >= 1 ? el.paused : null),
    apply({ action, position }) {
      quietUntil = Date.now() + 800;
      if (Math.abs(el.currentTime - position) > 0.5) el.currentTime = position;
      if (action === "play" && el.paused) void el.play().catch(() => {});
      if (action === "pause" && !el.paused) el.pause();
    },
  };
  return { driver, dispose: () => { handlers.forEach(([name, fn]) => el.removeEventListener(name, fn)); el.pause(); } };
}

type Slot = "theater" | "music";

/** Drives the YouTube or website view of a slot through the main process. */
export function viewDriver(slot: Slot, events: () => UserEvents): { driver: Driver; dispose: () => void } {
  const bridge = window.distopic?.theater;
  let status: { position: number; paused: boolean; at: number } | null = null;
  const offs = [
    bridge?.on("status", (from, s) => {
      if (from === slot) status = { position: s.position, paused: s.paused, at: Date.now() };
    }),
    bridge?.on("user", (from, e) => {
      if (from !== slot) return;
      status = { position: e.position, paused: e.action === "pause", at: Date.now() };
      events().onUser(e.action, e.position);
    }),
    bridge?.on("ended", (from) => from === slot && events().onEnded()),
  ];
  const driver: Driver = {
    position: () => (status ? status.position + (status.paused ? 0 : (Date.now() - status.at) / 1000) : null),
    paused: () => status?.paused ?? null,
    apply(command) {
      bridge?.control(slot, command);
      if (status) status = { position: command.position, paused: command.action === "pause", at: Date.now() };
    },
  };
  return { driver, dispose: () => offs.forEach((off) => off?.()) };
}
