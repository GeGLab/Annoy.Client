import type { IntegrationHttp } from "@annoy/protocol";

/**
 * How integration calls leave the app. On desktop the main process sends them
 * (public HTTPS only, no cookies, outside the VPN routes). Where there is no
 * main process (Android), the page's own fetch does: the endpoint needs CORS.
 */
export const integrationHttp: IntegrationHttp = async (request) => {
  const bridge = window.annoy?.integrations;
  if (bridge) {
    const res = await bridge.request(request);
    if (!res.ok) throw new Error("unreachable");
    return { status: res.status, type: res.type, body: res.body };
  }
  const res = await fetch(request.url, { method: request.method, headers: request.headers, body: request.body, credentials: "omit", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(request.timeoutMs) });
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.length > request.maxBytes) throw new Error("too large");
  return { status: res.status, type: res.headers.get("content-type") ?? "", body };
};
