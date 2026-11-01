import { LOCKED_ACCESS, type AppAccessState } from "../shared/app-access.ts";
import {secureHttpUrl} from '../shared/transport.ts';

export interface LocalCredential { id: string; url: string; token: string; userId: string }
interface GlobalUser { id: string; name: string; email: string; cryptoMigrationRequired?:boolean }

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
    if (!res.ok) throw new Error("Sessão inválida. Entre novamente.");
    return await res.json() as Record<string, unknown>;
  }
  async function verifyGlobal(token: unknown): Promise<GlobalUser> {
    if (typeof token !== "string" || !token || token.length > 4096) throw new Error("Credencial inválida");
    const version = ++globalVersion;
    try {
      const user = await json(`${globalUrl}/v1/me`, token);
      if (version !== globalVersion) throw new Error("Autenticação cancelada");
      if (typeof user.id !== "string" || !user.id || typeof user.name !== "string" || typeof user.email !== "string") throw new Error("Conta Annoy inválida");
      globalToken = token; publish();
      return { id: user.id, name: user.name, email: user.email, ...(user.cryptoMigrationRequired===true?{cryptoMigrationRequired:true}:{}) };
    } catch (err) {
      if (version === globalVersion) { globalToken = null; publish(); }
      throw err;
    }
  }
  async function verifyLocal(raw: unknown): Promise<void> {
    const account = raw as Partial<LocalCredential> | null;
    if (!account || typeof account.id !== "string" || typeof account.url !== "string" || typeof account.token !== "string" || typeof account.userId !== "string" || !account.token || account.token.length > 4096) throw new Error("Credencial local inválida");
    const credential = account as LocalCredential;
    const version = (versions.get(credential.id) ?? 0) + 1;
    versions.set(credential.id, version);
    const started = epoch;
    try {
      const url = secureHttpUrl(credential.url);
      const info = await json(`${url.origin}/api/info`);
      // Servers before account modes have no accountMode field and keep local accounts.
      if (info.accountMode === "global") throw new Error("Este servidor exige conta Annoy");
      const me = await json(`${url.origin}/api/users/@me`, credential.token);
      if (started !== epoch || version !== versions.get(credential.id)) throw new Error("Autenticação cancelada");
      if (me.id !== credential.userId || me.global === true) throw new Error("Conta local inválida");
      locals.set(credential.id, credential); publish();
    } catch (err) {
      if (started === epoch && version === versions.get(credential.id)) { locals.delete(credential.id); publish(); }
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
