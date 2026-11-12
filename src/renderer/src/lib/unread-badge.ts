import { getState, useStore } from "../store.ts";
import { useEffect } from "react";

/** What deserves the system's attention: direct messages (cloud and server) and mentions. */
function attentionCount(): number {
  const s = getState();
  let total = 0;
  for (const count of Object.values(s.social.unread)) total += count;
  for (const inst of Object.values(s.instances)) {
    const dms = new Set((inst.dms ?? []).map((dm) => dm.id));
    for (const [channelId, unread] of Object.entries(inst.unread)) {
      if (dms.has(channelId)) total += unread.count;
      else if (unread.mention) total += Math.max(1, unread.count);
    }
  }
  return total;
}

function canvas(size: number) {
  const el = document.createElement("canvas");
  el.width = el.height = size;
  return [el, el.getContext("2d")!] as const;
}

/** Taskbar overlay: a red disc with the count, like other chat apps (16px at 2x). */
function overlay(count: number): string {
  const [el, g] = canvas(32);
  g.fillStyle = "#f23f43";
  g.beginPath(); g.arc(16, 16, 16, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#ffffff";
  g.font = `700 ${count > 9 ? 17 : 21}px "Segoe UI", system-ui, sans-serif`;
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(count > 99 ? "99+" : String(count), 16, 17);
  return el.toDataURL("image/png");
}

let trayGlyph: Promise<HTMLImageElement | null> | null = null;
/** The tray glyph with a red dot in its corner, at 2x. */
async function trayWithDot(): Promise<string | null> {
  trayGlyph ??= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = new URL("./tray@2x.png", document.baseURI).href;
  });
  const img = await trayGlyph;
  if (!img) return null;
  const [el, g] = canvas(32);
  g.drawImage(img, 0, 0, 32, 32);
  g.globalCompositeOperation = "destination-out"; // a cut-out ring keeps the dot readable on the glyph
  g.beginPath(); g.arc(25, 25, 8.5, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = "source-over";
  g.fillStyle = "#f23f43";
  g.beginPath(); g.arc(25, 25, 6.5, 0, Math.PI * 2); g.fill();
  return el.toDataURL("image/png");
}

/** Keeps the taskbar/tray badge in step with unread direct messages and mentions. */
export function useUnreadBadge(): void {
  const count = useStore(() => attentionCount());
  useEffect(() => {
    const badge = window.annoy?.unreadBadge;
    if (!badge) return;
    let cancelled = false;
    void (async () => {
      const tray = count > 0 ? await trayWithDot() : null;
      if (!cancelled) badge(count, count > 0 ? overlay(count) : null, tray);
    })();
    return () => { cancelled = true; };
  }, [count]);
}
