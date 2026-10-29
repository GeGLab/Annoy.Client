import { useEffect, useState } from "react";
import { Gamepad2 } from "lucide-react";
import type { UserActivity } from "@distopic/protocol";

/** The game itself is the visual identity; platform branding belongs to the integration settings. */
export function GameIcon({ activity, size = 16 }: { activity: UserActivity; size?: number }) {
  const appId = activity.provider === "steam" && /^\d{1,10}$/.test(activity.appId ?? "") ? activity.appId : undefined;
  const [resolved, setResolved] = useState<{ appId: string; url: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!appId) return;
    let active = true;
    void window.distopic?.activity.gameIcon?.(appId).then((url) => {
      if (active && url) setResolved({ appId, url });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [appId]);
  const url = resolved?.appId === appId ? resolved?.url : undefined;
  if (!url || url === failed) return <Gamepad2 size={size} aria-hidden />;
  return <img className="game-icon" src={url} alt="" aria-hidden width={size} height={size} referrerPolicy="no-referrer" onError={() => setFailed(url)} />;
}
