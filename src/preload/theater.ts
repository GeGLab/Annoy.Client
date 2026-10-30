import { ipcRenderer } from "electron";

// Runs in every frame of a theater page. The frame whose video is the biggest one on
// screen reports its time and the viewer's own play/pause/seek, and obeys the room.

interface Command {
  action: "play" | "pause" | "seek";
  position?: number;
}

let video: HTMLVideoElement | null = null;
/** Events caused by our own commands are not the viewer's and must not echo back. */
let quietUntil = 0;

function pick(): HTMLVideoElement | null {
  let best: HTMLVideoElement | null = null;
  let area = 0;
  for (const el of document.querySelectorAll("video")) {
    const rect = el.getBoundingClientRect();
    const size = rect.width * rect.height;
    if (size > area && (el.currentSrc || el.srcObject)) {
      best = el;
      area = size;
    }
  }
  return best;
}

function user(action: Command["action"]): void {
  if (!video || Date.now() < quietUntil) return;
  ipcRenderer.send("theater:user", { action, position: video.currentTime });
}

const onPlay = () => user("play");
const onPause = () => {
  if (!video?.ended) user("pause");
};
const onSeeked = () => user("seek");
const onEnded = () => ipcRenderer.send("theater:ended", { position: video?.currentTime ?? 0 });

function attach(next: HTMLVideoElement | null): void {
  if (video) {
    video.removeEventListener("play", onPlay);
    video.removeEventListener("pause", onPause);
    video.removeEventListener("seeked", onSeeked);
    video.removeEventListener("ended", onEnded);
  }
  video = next;
  if (!video) return;
  video.addEventListener("play", onPlay);
  video.addEventListener("pause", onPause);
  video.addEventListener("seeked", onSeeked);
  video.addEventListener("ended", onEnded);
}

setInterval(() => {
  const found = pick();
  if (found !== video) attach(found);
  if (!video) return;
  ipcRenderer.send("theater:status", {
    position: video.currentTime,
    duration: Number.isFinite(video.duration) ? video.duration : null,
    paused: video.paused,
    ended: video.ended,
  });
}, 1000);

ipcRenderer.on("theater:control", (_event, command: Command) => {
  const target = video ?? pick();
  if (!target) return;
  if (target !== video) attach(target);
  quietUntil = Date.now() + 800;
  if (typeof command.position === "number" && Math.abs(target.currentTime - command.position) > 0.5) target.currentTime = command.position;
  if (command.action === "play" && target.paused) void target.play().catch(() => {});
  if (command.action === "pause" && !target.paused) target.pause();
});
