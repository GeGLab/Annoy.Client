import { useEffect, useState } from "react";
import type { PublicSticker } from "@annoy/protocol";
import { t as translate } from "../../../../shared/localization/index.ts";
import { cloudUrls, currentCloudUrls } from "../../social/cloud.ts";
import { annoyImage, annoySet, isAnnoySticker, stickerSize } from "./annoy-set.ts";

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

// Server stickers ------------------------------------------------------------

/** A server's own sticker: public on that server, so it can be sent anywhere. */
const SERVER_STICKER = /^(https:\/\/[^/\s?#@]+|http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?)\/api\/stickers\/([a-f0-9]{32})\.webp$/;
export function serverStickerOf(content: string): { origin: string; id: string; url: string } | null {
  const match = SERVER_STICKER.exec(content.trim());
  return match ? { origin: match[1]!, id: match[2]!, url: content.trim() } : null;
}
/** The message is only a sticker (Annoy set or a server's pack). */
export const isStickerMessage = (content: string) => !!annoyStickerOf(content) || !!serverStickerOf(content);

const stickerInfo = new Map<string, Promise<PublicSticker>>();
function readStickerInfo(origin: string, id: string): Promise<PublicSticker> {
  const key = `${origin}/${id}`;
  let info = stickerInfo.get(key);
  if (!info) {
    info = fetch(`${origin}/api/sticker-info/${id}`, { credentials: "omit", redirect: "error", signal: AbortSignal.timeout(10_000) })
      .then((response) => { if (!response.ok) throw new Error(String(response.status)); return response.json() as Promise<PublicSticker>; });
    info.catch(() => stickerInfo.delete(key));
    stickerInfo.set(key, info);
  }
  return info;
}

export function ServerSticker({ origin, id, url }: { origin: string; id: string; url: string }) {
  const [info, setInfo] = useState<PublicSticker | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    setInfo(null); setFailed(false);
    void readStickerInfo(origin, id).then((value) => { if (!disposed) setInfo(value); }).catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; };
  }, [origin, id]);
  if (failed) return <a className="annoy-sticker-link" href={url} target="_blank" rel="noreferrer">{url}</a>;
  return <span className="server-sticker">
    <span className="annoy-sticker" style={{ width: 160, height: 160 }}><img src={url} alt={info?.name ?? ""} draggable={false} /></span>
    {info && <span className="server-sticker-origin" title={translate("expression.serverStickerFrom", { p0: info.server.name })}>
      {info.server.iconUrl ? <img src={info.server.iconUrl} alt="" /> : <span className="server-sticker-initial" aria-hidden>{info.server.name.slice(0, 1).toUpperCase()}</span>}
      <span className="truncate">{info.server.name}</span>
    </span>}
  </span>;
}

/** The link is a sticker of either kind (used for sticker reactions). */
export const isStickerLink = (url: string) => !!annoyStickerOf(url) || !!serverStickerOf(url);
/** The sticker's name: from the cached Annoy set, or from the server it comes from. */
export async function stickerName(url: string): Promise<string | null> {
  if (annoyStickerOf(url)) return (await annoySet())?.items.find((item) => item.url === url)?.name ?? null;
  const server = serverStickerOf(url);
  return server ? (await readStickerInfo(server.origin, server.id)).name : null;
}
/** A small sticker image, for reaction chips. Annoy set images come from the local cache. */
export function StickerThumb({ url }: { url: string }) {
  const annoy = !!annoyStickerOf(url);
  const [src, setSrc] = useState<string | null>(annoy ? null : url);
  useEffect(() => {
    if (!annoy) { setSrc(url); return; }
    let disposed = false, objectUrl: string | undefined;
    setSrc(null);
    void annoyImage(url).then((blob) => { if (disposed) return; objectUrl = URL.createObjectURL(blob); setSrc(objectUrl); }).catch(() => undefined);
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url, annoy]);
  return <span className="reaction-sticker" aria-hidden="true">{src && <img src={src} alt="" draggable={false} />}</span>;
}

/** Draws a sticker message of either kind. */
export function StickerMessage({ content }: { content: string }) {
  const annoy = annoyStickerOf(content);
  if (annoy) return <AnnoySticker url={annoy} />;
  const server = serverStickerOf(content);
  return server ? <ServerSticker {...server} /> : null;
}
