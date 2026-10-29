/** Public game icons are resolved in main, without exposing arbitrary network access to the renderer. */
const cache = new Map<string, { expires: number; result: Promise<string | null> }>();

export function steamGameIcon(appId: string): Promise<string | null> {
  if (!/^\d{1,10}$/.test(appId)) return Promise.resolve(null);
  const cached = cache.get(appId);
  if (cached && cached.expires > Date.now()) return cached.result;
  const icon = new RegExp(`https://[a-z0-9.-]+\\.steamstatic\\.com/(?:community_assets|steamcommunity/public)/images/apps/${appId}/[a-f0-9]{40}\\.(?:jpg|png)`, "i");
  const item = { expires: Date.now() + 60_000, result: Promise.resolve<string | null>(null) };
  item.result = (async () => {
    try {
      const response = await fetch(`https://steamcommunity.com/app/${appId}`, { signal: AbortSignal.timeout(5000), redirect: "error" });
      if (!response.ok || !response.body) return null;
      const reader = response.body.getReader();
      try {
        const decoder = new TextDecoder();
        let html = "", size = 0;
        while (size < 256 * 1024) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 256 * 1024) break;
          html += decoder.decode(value, { stream: true });
          const url = icon.exec(html)?.[0];
          if (url) {
            item.expires = Date.now() + 24 * 60 * 60_000;
            return url;
          }
        }
      } finally { await reader.cancel().catch(() => undefined); }
    } catch { /* Icon lookup is optional and must never interrupt the activity. */ }
    return null;
  })();
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  cache.set(appId, item);
  return item.result;
}
