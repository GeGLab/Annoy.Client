import type { Session } from "electron";

/**
 * Development only. `npm run dev` serves the renderer from Vite (http://localhost:5173), but the
 * production Annoy cloud only accepts the installed app's origin ("null", from file://) and answers
 * 403 to anything else. For the cloud hosts alone, present the request as the installed app does
 * and let the Vite page read the answer. Never installed in packaged builds.
 */
export function allowDevOriginForCloud(s: Session, devOrigin: string, cloudOrigins: readonly string[]): void {
  const hosts = [...new Set(cloudOrigins.map((value) => new URL(value)).filter((url) => url.protocol === "https:").map((url) => url.host))];
  if (!hosts.length) return;
  const urls = hosts.flatMap((host) => [`https://${host}/*`, `wss://${host}/*`]);
  const header = (headers: Record<string, unknown>, name: string) => Object.keys(headers).find((key) => key.toLowerCase() === name);

  s.webRequest.onBeforeSendHeaders({ urls }, (details, callback) => {
    const headers = details.requestHeaders;
    const key = header(headers, "origin");
    if (key && headers[key] === devOrigin) headers[key] = "null";
    callback({ requestHeaders: headers });
  });

  s.webRequest.onHeadersReceived({ urls }, (details, callback) => {
    const headers = details.responseHeaders;
    if (!headers) return callback({});
    const key = header(headers, "access-control-allow-origin");
    if (key && headers[key]?.[0] === "null") headers[key] = [devOrigin];
    callback({ responseHeaders: headers });
  });
}
