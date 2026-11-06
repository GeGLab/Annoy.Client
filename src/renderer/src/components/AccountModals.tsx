import {rich} from "../lib/localization.ts";
import {t as translate,counted} from "../../../shared/localization/index.ts";
import { SignInForm as GlobalSignIn } from "./auth/SignInForm.tsx";
import { clientAccepted, updateRequired } from "../lib/client-version.ts";
import { Select } from "./ui/select.tsx";
import type { AuthResponse, InstanceInfo, Invite, ServerSummary } from "@annoy/protocol";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { authenticate, beginDiscordLogin, discordLogin, DEFAULT_PORT, findInstance } from "../api.ts";
import { addAccount, apiFor, openServer, navigate, signOutAccount } from "../client.ts";
import { Tooltip } from "./ui/tooltip.tsx";
import { getState, setState, toast, useStore } from "../store.ts";
import { Avatar, closeModal, Field, Icon, Modal, openModal } from "./ui.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { Brand } from "./Brand.tsx";
import { AuthError as GlobalError, signedIn as globalSignedIn } from "../auth/session.ts";
import { keepVaultInSync, migrateServer, signInServer, toAccount } from "../auth/servers.ts";
import { useRequestOwner } from "../lib/use-request-owner.ts";
import { isCancellation } from "../../../shared/requests.ts";

export function AddAccountModal() {
  const requests = useRequestOwner();
  const modal = getState().modal;
  const remembered = modal?.kind === "addAccount" ? getState().rememberedAccounts.find(a => a.id === modal.rememberedId) : undefined;
  const saved = modal?.kind === "addAccount" ? getState().accounts.find(a => a.id === modal.accountId) : undefined;
  const cached = saved ? getState().instances[saved.id]?.user : undefined;
  const [address, setAddress] = useState(saved?.url ?? remembered?.url ?? (modal?.kind === "addAccount" ? modal.address : undefined) ?? "");
  const [info, setInfo] = useState<{ url: string; info: InstanceInfo } | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState(cached?.username ?? remembered?.username ?? "");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const globalAccount = useStore(s => s.global);
  // A remembered name is not a session: without a live Annoy session, ask for the Annoy sign-in.
  const annoyReady = !!globalAccount && globalSignedIn();
  // Signing in again after leaving an account always asks for the Annoy credentials:
  // a session still open in the app never brings a signed-out account back by itself.
  const [reauthenticated, setReauthenticated] = useState(false);
  const needsCredentials = !annoyReady || (!!remembered?.annoy && !reauthenticated);
  const [globalFirst, setGlobalFirst] = useState(false);
  const [migration, setMigration] = useState(false);
  const discordAbort = useRef<AbortController | null>(null);
  useEffect(() => () => discordAbort.current?.abort(), []);
  // Servers before account modes (no accountMode field) keep local accounts.
  const localMode = !!info && info.info.accountMode !== "global";
  const needsInvite = info?.info.registration === "invite";

  useEffect(() => {
    if (!address) return;
    let active = true;
    void findInstance(address).then(async value => {
      if (!active) return;
      if (!clientAccepted(value.info)) { setError(updateRequired(value.info)); return; }
      setInfo(value);
      if (saved) {
        const res = await fetch(`${value.url}/api/auth/migration/status`, {
          method: "POST", headers: { authorization: `Bearer ${saved.token}` },
        });
        if (res.ok) {
          const status = await res.json() as { username?: string; pending: boolean };
          if (active) { setMigration(status.pending); if (status.username) setUsername(status.username); }
        }
      }
    }).catch(err => { if (active) setError((err as Error).message); });
    return () => { active = false; };
  }, []);

  async function probe(e: FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      const found = await findInstance(address);
      // A server that needs a newer app is not opened: the person updates first.
      if (!clientAccepted(found.info)) { setError(updateRequired(found.info)); return; }
      setInfo(found);
    }
    catch (err) { setError(err instanceof TypeError ? translate("common.8ad698582e04") : (err as Error).message); }
    finally { setBusy(false); }
  }
  async function withGlobal(e?: FormEvent) {
    e?.preventDefault();
    const signal = requests.signal;
    if (!info?.info.globalServerId || busy) return;
    setError(null); setBusy(true);
    try {
      const first = globalFirst ? { username, ...(displayName && { displayName }), ...(inviteCode.trim() && { inviteCode: inviteCode.trim() }) } : undefined;
      const auth = migration
        ? await migrateServer(info.url, info.info, { username, password, recoveryCode }, saved?.token)
        : await signInServer(info.url, info.info.globalServerId, first, signal);
      signal.throwIfAborted();
      addAccount(toAccount(info.url, info.info, auth));
    } catch (err) {
      if (isCancellation(err)) return;
      if (err instanceof GlobalError && err.code === "global_new_account") {
        setGlobalFirst(true);
        if (!username && globalAccount) setUsername(globalAccount.name.toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 32));
      } else setError((err as Error).message);
    } finally { setBusy(false); }
  }
  async function submitLocal(e: FormEvent) {
    e.preventDefault();
    const signal = requests.signal;
    if (!info || busy) return;
    setError(null); setBusy(true);
    try {
      const auth: AuthResponse = migration
        ? await migrateServer(info.url, info.info, { username, recoveryCode, newPassword }, saved?.token)
        : await authenticate(info.url, mode, { username, password, ...(mode === "register" && { displayName: displayName || username, ...(inviteCode.trim() && { inviteCode: inviteCode.trim() }) }) }, signal);
      signal.throwIfAborted();
      addAccount(toAccount(info.url, info.info, auth));
    } catch (err) { if (!isCancellation(err)) setError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function withDiscord() {
    if (!info || !localMode || busy) return;
    const abort = new AbortController(); discordAbort.current = abort;
    const active = AbortSignal.any([abort.signal, requests.signal]);
    setBusy(true); setError(null);
    try {
      const { auth } = await discordLogin(info.url, () => beginDiscordLogin(info.url, inviteCode.trim() || undefined, active), active);
      active.throwIfAborted();
      if (auth) addAccount(toAccount(info.url, info.info, auth));
    } catch (err) { if (!active.aborted) setError((err as Error).message); }
    finally { setBusy(false); discordAbort.current = null; }
  }
  const ownershipFields = <>
    <Field label={translate("common.9ee3734e990d")}><Input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required /></Field>
    {!localMode && <Field label={translate("common.5e211fa604a6")}><Input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></Field>}
    <Field label={translate("common.9682a3205283")} hint={translate("common.ab75db8fb0e5")}><Input value={recoveryCode} onChange={e => setRecoveryCode(e.target.value)} autoComplete="off" /></Field>
    {saved && <p className="muted small">{translate("common.93de37b1bcc5")}</p>}
  </>;
  async function afterAnnoySignIn() {
    // Signing in selects the Annoy account and lists every server of it; those that fail show as disconnected.
    await keepVaultInSync();
    const linked = getState().accounts.find((account) => account.annoy);
    navigate({ kind: "home", accountId: linked?.id ?? null, dmId: null });
    closeModal();
  }
  return <Modal title={info ? migration ? translate("common.ae9b6499529e") : localMode ? translate("common.5e77147cf065") : translate("common.939b100daa64") : translate("common.11cf7643fb7e")} className="auth-modal" busy={busy}>
    <div className="auth-intro"><Brand size={44} wordmark /><p>{info ? info.info.name : translate("common.cada4e4201a8")}</p></div>
    {!info && !saved && !address && <GlobalSignIn intro={translate("common.6cae7aca7c95")} onSignedIn={() => void afterAnnoySignIn()} />}
    {!info && !saved && <p className="muted small auth-divider">{rich("common.d7503c4419d6",{p0:String(DEFAULT_PORT)})}</p>}
    {!info ? <form onSubmit={probe} className="form">
      <Field label={translate("common.ef5e7e12bdac")}><Input autoFocus value={address} onChange={e => setAddress(e.target.value)} placeholder={translate("common.7a85f966dd7d")} required /></Field>
      {error && <p className="error">{error}</p>}
      <Button type="submit" loading={busy}>{translate("common.63e2bbaf1c92")}</Button>
    </form> : <>
      {!localMode && <p role={migration ? "alert" : undefined}>{translate("common.3c6e57294ab7")}</p>}
      {localMode && <p>{info.info.accountMode === "local" ? translate("common.b58caef0b088") : translate("common.bb61831cf63a")}{migration && translate("common.da0bf384ca28")}</p>}
      {!localMode && needsCredentials ? <GlobalSignIn identifier={remembered?.annoyEmail} onSignedIn={() => { setReauthenticated(true); if (remembered?.annoy) void withGlobal(); }} /> : <form className="form" onSubmit={localMode ? submitLocal : e => void withGlobal(e)}>
        {migration ? ownershipFields : (localMode || globalFirst) && <>
          {localMode && <div className="tabs"><Button type="button" variant="ghost" onClick={() => setMode("login")}>{translate("common.4105811890ae")}</Button><Button type="button" variant="ghost" disabled={!info.info.registrationOpen} onClick={() => setMode("register")}>{translate("common.391f1af9142d")}</Button></div>}
          <Field label={translate("common.47644adea672")}><Input autoFocus value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required /></Field>
          {(globalFirst || mode === "register") && <>
            <Field label={translate("common.80d20f1ebbc0")}><Input value={displayName} onChange={e => setDisplayName(e.target.value)} /></Field>
            {needsInvite && <Field label={translate("common.3dba7a6e77c4")}><Input value={inviteCode} onChange={e => setInviteCode(e.target.value)} required /></Field>}
          </>}
        </>}
        {localMode && <Field label={migration ? translate("common.af1264c3f0e8") : translate("common.b87fd0b63102")}><Input type="password" value={migration ? newPassword : password} onChange={e => migration ? setNewPassword(e.target.value) : setPassword(e.target.value)} autoComplete={migration || mode === "register" ? "new-password" : "current-password"} minLength={migration || mode === "register" ? 8 : undefined} required /></Field>}
        {migration && !localMode && <p className="muted small">{translate("common.45588c91e750")}</p>}
        {!localMode && !info.info.globalServerId && <>
          <p className="error">{translate("common.b6326ea2c6c6")}</p>
          <Button type="button" variant="secondary" onClick={() => void findInstance(info.url).then(setInfo, err => setError((err as Error).message))}>{translate("common.b9e10688be01")}</Button>
        </>}
        {error && <p className="error">{error}</p>}
        <Button type="submit" loading={busy} disabled={!localMode && !info.info.globalServerId}>{migration ? translate("common.680f2192f2f7") : localMode ? mode === "register" ? translate("common.391f1af9142d") : translate("common.4105811890ae") : translate("common.e32748582627",{p0:(globalAccount?.name ?? "conta Annoy")})}</Button>
      </form>}
      {localMode && info.info.discordLogin && !migration && <Button type="button" variant="outline" loading={busy} onClick={() => void withDiscord()}>{translate("common.d1a81cb724d8")}</Button>}
      {discordAbort.current && <Button type="button" variant="secondary" onClick={() => discordAbort.current?.abort()}>{translate("common.2a2c8450b1c9")}</Button>}
      <div className="form-actions">
        <Button type="button" variant="ghost" onClick={() => { setMigration(!migration); setGlobalFirst(false); setError(null); }}>{migration ? translate("common.0fe6598d4da8") : translate("common.37278013d5ed")}</Button>
        <Button type="button" variant="secondary" onClick={closeModal}>{translate("common.0f2bd88ef0ac")}</Button>
      </div>
    </>}
  </Modal>;
}

export function SwitchAccountModal() {
  const accounts = useStore((s) => s.accounts), instances = useStore((s) => s.instances), remembered = useStore((s) => s.rememberedAccounts);
  const current = useStore((s) => ("accountId" in s.view ? s.view.accountId : null));
  const saved = remembered.filter((item) => !accounts.some((account) => account.id === item.id));
  return <Modal title={translate("common.cd405060935b")} className="account-switcher"><p className="muted">{translate("common.7cad3bbb5598")}</p><div className="saved-accounts">
    {accounts.map((account) => { const user = instances[account.id]?.user, name = user?.displayName ?? account.instanceName; return <div className="saved-account-row" key={account.id}><button className={account.id === current ? "saved-account active" : "saved-account"} aria-current={account.id === current ? "true" : undefined} onClick={() => { navigate({ kind: "home", accountId: account.id, dmId: null }); closeModal(); }}>
    {user ? <Avatar user={user} size={40} /> : <Brand size={40} />}<span><strong>{name}</strong><small>{account.annoy ? translate("common.21c5709ca7b8") : translate("common.8e8a58b4d1d5")} · {account.instanceName} · {account.pending || instances[account.id]?.status === "offline" || instances[account.id]?.status === "invalid" ? translate("common.c1f272b304da") : account.id === current ? translate("common.256189f0291c") : translate("common.79c5eb4810e5")}</small></span>{account.id === current && <Icon name="check" />}</button><Tooltip content={translate("common.bff9a330986f")}><button className="icon-btn" aria-label={translate("common.ece23c8b325f",{p0:(name)})} onClick={() => signOutAccount(account.id)}><Icon name="logout" /></button></Tooltip></div>; })}
    {saved.map((account) => <div className="saved-account-row" key={account.id}><button className="saved-account" onClick={() => openModal({ kind: "addAccount", rememberedId: account.id })}><Avatar user={{ id: account.userId, username: account.username, displayName: account.displayName, avatarUrl: account.avatarUrl }} size={40} /><span><strong>{account.displayName}</strong><small>{rich("common.99f91f6f1e05",{p0:(account.annoy ? translate("common.21c5709ca7b8") : translate("common.8e8a58b4d1d5")),p1:(account.instanceName)})}</small></span><Icon name="right" /></button><button className="icon-btn" aria-label={translate("common.cb11afce3a10",{p0:(account.displayName)})} onClick={() => setState((s) => { s.rememberedAccounts = s.rememberedAccounts.filter((item) => item.id !== account.id); })}><Icon name="x" /></button></div>)}
  </div><Button onClick={() => openModal({ kind: "addAccount" })}>{rich("common.f058dba0348d",{p0:(<Icon name="plus" />)})}</Button></Modal>;
}

/** Invite codes may be pasted bare or as part of a link. */
const inviteCodeOf = (input: string) => input.trim().split(/[/\s]/).filter(Boolean).pop() ?? "";

export function CreateServerModal({ accountId: initialAccount, initialMode = "create" }: { accountId?: string; initialMode?: "create" | "join" }) {
  const accounts = useStore((s) => s.accounts);
  const [accountId, setAccountId] = useState(accounts.length === 1 ? initialAccount ?? accounts[0]!.id : initialAccount ?? "");
  const [mode, setMode] = useState<"create" | "join">(initialMode);
  const requests = useRequestOwner(accountId);
  const [name, setName] = useState("");
  const [invite, setInvite] = useState("");
  const [preview, setPreview] = useState<Invite | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    const signal = requests.signal;
    if (busy || !accountId) return;
    setBusy(true);
    try {
      const server = await apiFor(accountId).post<ServerSummary>("/servers", { name }, signal);
      signal.throwIfAborted();
      closeModal();
      void openServer(accountId, server.id);
    } catch (err) {
      if (!isCancellation(err)) toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    const signal = requests.signal;
    if (busy || !accountId) return;
    setBusy(true);
    try {
      const code = inviteCodeOf(invite);
      if (!preview) {
        const invite = await apiFor(accountId).get<Invite>(`/invites/${code}`, signal);
        signal.throwIfAborted();
        setPreview(invite);
        return;
      }
      const server = await apiFor(accountId).post<ServerSummary>(`/invites/${code}`, {}, signal);
      signal.throwIfAborted();
      closeModal();
      void openServer(accountId, server.id);
    } catch (err) {
      if (!isCancellation(err)) toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={mode === "create" ? translate("common.7f49e3ac1fc1") : translate("common.fec758322645")}>
      {accounts.length > 1 && (
        <Field label={translate("common.328353ea53eb")}>
          <Select value={accountId} disabled={busy} onChange={(e) => { setAccountId(e.target.value); setPreview(null); }}>
            <option value="">{translate("common.9e5b48e0e8cc")}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.instanceName} ({a.url})
              </option>
            ))}
          </Select>
        </Field>
      )}
      {accounts.length === 0 && <div className="empty-action"><p className="muted">{translate("common.32620c152c2e")}</p><Button onClick={() => openModal({ kind: "addAccount" })}>{translate("common.d9d7919adc16")}</Button></div>}
      {accounts.length > 0 && <div className="tabs" role="tablist" aria-label={translate("common.30b932877e7d")}>
        <Button type="button" variant="ghost" role="tab" aria-selected={mode === "create"} className={mode === "create" ? "tab active" : "tab"} onClick={() => { setMode("create"); setPreview(null); }}>{translate("common.49ba5d18d8c4")}</Button>
        <Button type="button" variant="ghost" role="tab" aria-selected={mode === "join"} className={mode === "join" ? "tab active" : "tab"} onClick={() => { setMode("join"); setPreview(null); }}>{translate("common.fec758322645")}</Button>
      </div>}
      {mode === "create" && accounts.length > 0 && <form onSubmit={create} className="form">
        <h3>{translate("common.d825f5d935e9")}</h3>
        <Field label={translate("common.87f8ee74878a")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={translate("common.94a0c36fb1ea")} required maxLength={100} />
        </Field>
        <div className="form-actions">
          <Button type="submit" loading={busy} disabled={!accountId || !name.trim()}>{translate("common.985f18314d9a")}</Button>
        </div>
      </form>}
      {mode === "join" && accounts.length > 0 && <form onSubmit={join} className="form">
        <h3>{translate("common.3d44c76a75cd")}</h3>
        <Field label={translate("common.bf7d8d4c951b")}>
          <Input
            value={invite}
            onChange={(e) => {
              setInvite(e.target.value);
              setPreview(null);
            }}
            placeholder={translate("common.fb6e4a9111bb")}
            required
          />
        </Field>
        {preview && (
          <p className="invite-preview">
            <strong>{preview.server.name}</strong> · {counted(preview.memberCount,"counts.member.one","counts.member.other")}
          </p>
        )}
        <div className="form-actions">
          <Button type="submit" loading={busy} disabled={!accountId || !invite.trim()}>
            {preview ? translate("common.6c371b23031d") : translate("common.f60e5c5c2f25")}
          </Button>
        </div>
      </form>}
      <hr />
      <div className="form">
        <h3>{translate("common.d92359f0e940")}</h3>
        <p className="muted small">{translate("import.description")}</p>
        <div className="form-actions start">
          <Button
            variant="secondary"
            onClick={() =>
              setState((s) => {
                if (accountId) s.modal = { kind: "importDiscord", accountId, serverId: null };
              })
            }
            disabled={!accountId}
          >{translate("common.2ac009991644")}</Button>
        </div>
      </div>
      <hr />
      <div className="form-actions">
        <Button
          variant="secondary"
          onClick={() =>
            setState((s) => {
              s.modal = { kind: "addAccount" };
            })
          }
        >{translate("common.84de157494fd")}</Button>
      </div>
    </Modal>
  );
}
