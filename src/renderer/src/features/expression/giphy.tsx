import {t as translate, localizationPreferences} from "../../../../shared/localization/index.ts";
import giphyAttribution from "../../assets/expression/powered-by-giphy.gif";
import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { cloudUrls } from "../../social/cloud.ts";
import { toast } from "../../store.ts";
import { gifFavoritesAvailable, toggleGifFavorite, useGifFavorites } from "./gif-favorites.ts";
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
/** Several GIFs by GIPHY ID (favorites), in the order given; at most 24. */
export function giphyByIds(ids: readonly string[], signal: AbortSignal) {
  return gifs<{ data: GiphyItem[] }>(`?ids=${ids.map(encodeURIComponent).join(",")}`, signal);
}
/** Star that adds or removes a GIF from the account's favorites. */
export function FavoriteStar({ id }: { id: string }) {
  const favorites = useGifFavorites();
  if (!gifFavoritesAvailable()) return null;
  const on = favorites.includes(id);
  const label = on ? translate("expression.gifUnfavorite") : translate("expression.gifFavorite");
  return <button type="button" className={`gif-favorite${on ? " on" : ""}`} aria-pressed={on} aria-label={label} title={label}
    onClick={(event) => { event.preventDefault(); event.stopPropagation(); void toggleGifFavorite(id).catch((error: Error) => toast(error.message)); }}>
    <Star size={16} fill={on ? "currentColor" : "none"} />
  </button>;
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
  return url && id ? <span className="giphy-message-wrap"><a className="giphy-message" href={content.trim()} target="_blank" rel="noreferrer"><img src={url} alt={item?.title || translate("expression.984615e925bc")} loading="lazy" /><GiphyAttribution /></a><FavoriteStar id={id} /></span> : null;
}
