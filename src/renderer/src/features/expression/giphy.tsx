import {t as translate} from "../../../../shared/localization/index.ts";
import giphyAttribution from "../../assets/expression/powered-by-giphy.gif";
import { useEffect, useState } from "react";
import { apiFor } from "../../client.ts";
export function GiphyAttribution() { return <img className="giphy-attribution" src={giphyAttribution} alt={translate("expression.05f14e07ec0c")} />; }
export interface GiphyItem { id: string; title: string; images: { fixed_height: { url: string }; original: { url: string } }; }
const keyRequests = new Map<string, Promise<string | null>>();
export const localGiphyKey = () => localStorage.getItem("annoy.giphy-client-key") ?? "";
export function setGiphyKey(value: string) { if (value.trim()) localStorage.setItem("annoy.giphy-client-key", value.trim()); else localStorage.removeItem("annoy.giphy-client-key"); keyRequests.clear(); }
export async function giphyKey(accountId: string): Promise<string | null> {
  if (localGiphyKey()) return localGiphyKey();
  let request = keyRequests.get(accountId);
  if (!request) { request = apiFor(accountId).get<{giphyApiKey?: string}>("/media/config").then((config) => config.giphyApiKey || null).catch(() => null); keyRequests.set(accountId, request); }
  return request;
}
export function giphyImage(url: string | undefined): string | undefined {
  try { const parsed = new URL(url!); return parsed.protocol === "https:" && (parsed.hostname === "giphy.com" || parsed.hostname.endsWith(".giphy.com")) ? url : undefined; } catch { return undefined; }
}
export async function searchGiphy(key: string, query: string, signal: AbortSignal, offset = 0) {
  const params = new URLSearchParams({ api_key: key, limit: "24", offset: String(offset), rating: "pg-13", lang: "pt", ...(query.trim() ? {q: query.trim()} : {}) });
  const response = await fetch(`https://api.giphy.com/v1/gifs/${query.trim() ? "search" : "trending"}?${params}`, {signal, cache:"no-store", credentials:"omit"});
  if (!response.ok) throw new Error(response.status === 429 ? translate("expression.6029173a7bbc") : translate("expression.1be1b0a22011"));
  return await response.json() as { data: GiphyItem[]; pagination: { total_count: number; offset: number; count: number } };
}
export function GiphyMessage({accountId, content}: {accountId: string; content: string}) {
  const id = /^https:\/\/giphy\.com\/gifs\/([a-zA-Z0-9]{1,100})$/.exec(content.trim())?.[1];
  const [item, setItem] = useState<GiphyItem | null>(null);
  useEffect(() => {
    setItem(null); if (!id) return;
    const controller = new AbortController();
    void giphyKey(accountId).then(async (key) => {
      if (!key || controller.signal.aborted) return;
      const response = await fetch(`https://api.giphy.com/v1/gifs/${id}?${new URLSearchParams({api_key:key})}`, {signal:controller.signal,cache:"no-store",credentials:"omit"});
      if (response.ok) { const result = await response.json(); if (!controller.signal.aborted && result.data && !Array.isArray(result.data)) setItem(result.data); }
    }).catch(() => undefined);
    return () => controller.abort();
  }, [accountId,id]);
  const url = giphyImage(item?.images?.original?.url);
  return url ? <a className="giphy-message" href={content.trim()} target="_blank" rel="noreferrer"><img src={url} alt={item?.title || translate("expression.984615e925bc")} loading="lazy" /><GiphyAttribution /></a> : null;
}




