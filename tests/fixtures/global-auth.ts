import { createServer } from "node:http";
import type { Page } from "@playwright/test";

/** Real HTTP validation by the main process; no production authentication bypass. */
export async function globalAuthFixture() {
  const token = "synthetic-global-session-for-tests";
  const user = { id: "test-global", name: "Test Global", email: "test@example.com" };
  let mode = "local";
  const localToken = "synthetic-local-session-for-tests";
  const server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "authorization, content-type");
    if (req.method === "OPTIONS") { res.end(); return; }
    if (req.url === "/api/info") res.end(JSON.stringify({ accountMode: mode }));
    else if (req.url === "/api/users/@me" && req.headers.authorization === `Bearer ${localToken}`) res.end(JSON.stringify({ id: "local-user", global: false }));
    else if (req.url === "/v1/me" && req.headers.authorization === `Bearer ${token}`) res.end(JSON.stringify(user));
    else if (req.url === "/v1/auth/logout") res.end("{}");
    else { res.statusCode = 401; res.end('{"error":"unauthorized"}'); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  async function authenticate(page: Page) {
    await page.evaluate(async ({ token, user }) => {
      await window.annoy!.auth.global(token);
      if (location.protocol === "file:") return;
      // The app's own start-up check finds no saved session and clears the account: let it finish first.
      const { restoreSession } = await import(/* @vite-ignore */ `${location.origin}/src/auth/session.ts`);
      await restoreSession();
      const { setState } = await import(/* @vite-ignore */ `${location.origin}/src/store.ts`);
      setState((s: any) => { s.global = user; });
    }, { token, user });
  }
  async function keepAuthenticated(page: Page) {
    await page.waitForURL(url => url.protocol === "file:" || url.host === "127.0.0.1:5178");
    await page.waitForLoadState("load");
    page.on("load", () => { void authenticate(page).catch(() => undefined); });
    await authenticate(page);
  }
  return { url: `http://127.0.0.1:${address.port}`, token, user, localToken, setMode: (value: string) => { mode = value; }, authenticate, keepAuthenticated,
    close: () => new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve())) };
}
