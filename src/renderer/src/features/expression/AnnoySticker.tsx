import { useEffect, useState } from "react";
import { cloudUrls, currentCloudUrls } from "../../social/cloud.ts";
import { annoyImage, isAnnoySticker, stickerSize } from "./annoy-set.ts";

// Load the configured cdnannoy address early, so links are recognized on first render.
void cloudUrls();

/** A message that is only an Annoy sticker link: drawn at its admannoy size, bytes from the local cache. */
export function annoyStickerOf(content: string): string | null {
  return isAnnoySticker(content, currentCloudUrls().cdn) ? content.trim() : null;
}
export function AnnoySticker({ url, name }: { url: string; name?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false, objectUrl: string | undefined;
    setSrc(null); setFailed(false);
    void Promise.all([annoyImage(url), stickerSize(url)]).then(([blob, px]) => {
      if (disposed) return;
      objectUrl = URL.createObjectURL(blob);
      setSrc(objectUrl); setSize(px);
    }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);
  if (failed) return <a className="annoy-sticker-link" href={url} target="_blank" rel="noreferrer">{url}</a>;
  const px = size ?? 160;
  return <span className="annoy-sticker" style={{ width: px, height: px }}>{src && <img src={src} alt={name ?? ""} draggable={false} />}</span>;
}
