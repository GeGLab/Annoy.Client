import {t as translate, localizationPreferences} from "../../../../shared/localization/index.ts";
import giphyAttribution from "../../assets/expression/powered-by-giphy.gif";
import { useEffect, useState } from "react";
import { cloudUrls } from "../../social/cloud.ts";
export function GiphyAttribution() { return <img className="giphy-attribution" src={giphyAttribution} alt={translate("expression.05f14e07ec0c")} />; }
export interface GiphyItem { id: string; title: string; images: { fixed_height: { url: string }; original: { url: string } }; }
/** Thrown when cdnannoy has no GIPHY key yet. */
export class GifsUnavailable extends Error {}
export function giphyImage(url: string | undefined): string | undefined {
  try { const parsed = new URL(url!); return parsed.protocol === "https:" && (parsed.hostname === "giphy.com" || parsed.hostname.endsWith(".giphy.com")) ? url : undefined; } catch { return undefined; }
}
/** GIF search goes through cdnannoy, which holds the GIPHY key for every user. */
async function gifs<T>(path: string, signal: AbortSignal): Promise<T> {
  const { cdn } = await cloudUrls();
  const response = await fetch(`${cdn}/v1/gifs${path}`, { signal, credentials: "omit" });
  if (response.status === 503) throw new GifsUnavailable(translate("expression.gifsUnavailable"));
  if (!response.ok) throw new Error(response.status === 429 ? translate("expression.6029173a7bbc") : translate("expression.1be1b0a22011"));
  return await response.json() as T;
}
export function searchGiphy(query: string, signal: AbortSignal, offset = 0) {
  const lang = localizationPreferences().language.split("-")[0] || "pt";
  const params = new URLSearchParams({ offset: String(offset), lang, ...(query.trim() ? { q: query.trim() } : {}) });
  return gifs<{ data: GiphyItem[]; pagination: { total_count: number; offset: number; count: number } }>(`?${params}`, signal);
}
export function GiphyMessage({ content }: { accountId?: string; content: string }) {
  const id = /^https:\/\/giphy\.com\/gifs\/([a-zA-Z0-9]{1,100})$/.exec(content.trim())?.[1];
  const [item, setItem] = useState<GiphyItem | null>(null);
  useEffect(() => {
    setItem(null); if (!id) return;
    const controller = new AbortController();
    void gifs<GiphyItem>(`/${id}`, controller.signal).then((result) => { if (!controller.signal.aborted) setItem(result); }).catch(() => undefined);
    return () => controller.abort();
  }, [id]);
  const url = giphyImage(item?.images?.original?.url);
  return url ? <a className="giphy-message" href={content.trim()} target="_blank" rel="noreferrer"><img src={url} alt={item?.title || translate("expression.984615e925bc")} loading="lazy" /><GiphyAttribution /></a> : null;
}
