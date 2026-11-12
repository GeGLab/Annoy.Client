import type { Session } from "electron";

/**
 * Development only. `npm run dev` serves the renderer from Vite (http://localhost:5173), but the
 * production Annoy cloud and Annoy instances only accept the installed app's origin ("null", from
 * file://) and refuse CORS to anything else, so every fetch fails while WebSockets still connect.
 * Present Vite's requests as the installed app does and let the Vite page read the answer.
 *
 * Instances are added by the user at runtime, so this covers every secure host, but it only touches
 * requests that carry the Vite origin and answers that allow "null". Electron keeps a single listener
 * per webRequest event, so nothing else in the app may register these. Never installed in packaged builds.
 */
export function allowDevOriginForRemotes(s: Session, devOrigin: string): void {
  const urls = ["https://*/*", "wss://*/*"];
  const header = (headers: Record<string, unknown>, name: string) => Object.keys(headers).find((key) => key.toLowerCase() === name);
  const rewritten = new Set<number>();

  s.webRequest.onBeforeSendHeaders({ urls }, (details, callback) => {
    const headers = details.requestHeaders;
    const key = header(headers, "origin");
    if (key && headers[key] === devOrigin) { headers[key] = "null"; rewritten.add(details.id); }
    callback({ requestHeaders: headers });
  });

  s.webRequest.onHeadersReceived({ urls }, (details, callback) => {
    const ours = rewritten.delete(details.id);
    const headers = details.responseHeaders;
    if (!ours || !headers) return callback({});
    const key = header(headers, "access-control-allow-origin");
    if (key && headers[key]?.[0] === "null") headers[key] = [devOrigin];
    callback({ responseHeaders: headers });
  });

  const forget = (details: { id: number }) => { rewritten.delete(details.id); };
  s.webRequest.onErrorOccurred({ urls }, forget);
  s.webRequest.onCompleted({ urls }, forget);
}
