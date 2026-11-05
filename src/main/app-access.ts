import {t as translate} from "../shared/localization/index.ts";
import { LOCKED_ACCESS, type AppAccessState } from "../shared/app-access.ts";
import {secureHttpUrl} from '../shared/transport.ts';

export interface LocalCredential { id: string; url: string; token: string; userId: string }
interface GlobalUser { id: string; name: string; email: string; cryptoMigrationRequired?:boolean }

/** A refusal from the server itself (401/403). Anything else (network, timeout, 5xx) is not an answer about the session. */
export class SessionRefused extends Error {}
const refused = (error: unknown) => error instanceof SessionRefused;

/** Access is earned with server-validated credentials, never a renderer boolean. */
export function createAppAccess(globalUrl: string, changed: (state: AppAccessState) => void, request: typeof fetch = fetch) {
  let globalToken: string | null = null;
  let globalVersion = 0;
  let epoch = 0;
  const locals = new Map<string, LocalCredential>();
  const versions = new Map<string, number>();
  const getState = (): AppAccessState => ({ allowed: !!globalToken || locals.size > 0, global: !!globalToken, localAccounts: [...locals.keys()] });
  const publish = () => changed(getState());
  async function json(url: string, token?: string): Promise<Record<string, unknown>> {
    secureHttpUrl(url);
    const res = await request(url, { headers: token ? { authorization: `Bearer ${token}` } : {}, redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (res.status === 401 || res.status === 403) throw new SessionRefused(translate("common.e6f8f72dc126"));
    if (!res.ok) throw new Error(translate("common.e6f8f72dc126"));
    return await res.json() as Record<string, unknown>;
  }
  async function verifyGlobal(token: unknown): Promise<GlobalUser> {
    if (typeof token !== "string" || !token || token.length > 4096) throw new Error(translate("common.527237896617"));
    const version = ++globalVersion;
    try {
      const user = await json(`${globalUrl}/v1/me`, token);
      if (version !== globalVersion) throw new Error(translate("common.459edfa35541"));
      if (typeof user.id !== "string" || !user.id || typeof user.name !== "string" || typeof user.email !== "string") throw new Error(translate("common.a449c449c31a"));
      globalToken = token; publish();
      return { id: user.id, name: user.name, email: user.email, ...(user.cryptoMigrationRequired===true?{cryptoMigrationRequired:true}:{}) };
    } catch (err) {
      // Only the server's refusal ends a session. A network failure, a timeout or a restarting
      // service keeps an accepted session; revalidation tries again later.
      if (version === globalVersion && (refused(err) || globalToken !== token)) { globalToken = null; publish(); }
      throw err;
    }
  }
  async function verifyLocal(raw: unknown): Promise<void> {
    const account = raw as Partial<LocalCredential> | null;
    if (!account || typeof account.id !== "string" || typeof account.url !== "string" || typeof account.token !== "string" || typeof account.userId !== "string" || !account.token || account.token.length > 4096) throw new Error(translate("common.2587fca90678"));
    const credential = account as LocalCredential;
    const version = (versions.get(credential.id) ?? 0) + 1;
    versions.set(credential.id, version);
    const started = epoch;
    try {
      const url = secureHttpUrl(credential.url);
      const info = await json(`${url.origin}/api/info`);
      // Servers before account modes have no accountMode field and keep local accounts.
      if (info.accountMode === "global") throw new SessionRefused(translate("common.5c70ad1c4b31"));
      const me = await json(`${url.origin}/api/users/@me`, credential.token);
      if (started !== epoch || version !== versions.get(credential.id)) throw new Error(translate("common.459edfa35541"));
      if (me.id !== credential.userId || me.global === true) throw new SessionRefused(translate("common.a407c7cac9f6"));
      locals.set(credential.id, credential); publish();
    } catch (err) {
      const known = locals.get(credential.id)?.token === credential.token;
      if (started === epoch && version === versions.get(credential.id) && (refused(err) || !known)) { locals.delete(credential.id); publish(); }
      throw err;
    }
  }
  function revokeLocal(id: string) {
    versions.set(id, (versions.get(id) ?? 0) + 1);
    locals.delete(id); publish();
  }
  function revokeGlobal() { ++globalVersion; globalToken = null; publish(); }
  function reset() {
    ++epoch; ++globalVersion; globalToken = null; locals.clear(); versions.clear();
    changed({ ...LOCKED_ACCESS, localAccounts: [] });
  }
  async function revalidate() {
    await Promise.allSettled([...(globalToken ? [verifyGlobal(globalToken)] : []), ...[...locals.values()].map(verifyLocal)]);
  }
  return { getState, verifyGlobal, verifyLocal, revokeGlobal, revokeLocal, reset, revalidate };
}
