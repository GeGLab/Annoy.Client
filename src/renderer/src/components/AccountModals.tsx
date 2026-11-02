import {rich} from "../lib/localization.ts";
import {t as translate,counted} from "../../../shared/localization/index.ts";
import { Select } from "./ui/select.tsx";
import type { InstanceInfo, Invite, ServerSummary } from "@distopic/protocol";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { authenticate, beginDiscordLogin, DEFAULT_PORT, discordLogin, findInstance } from "../api.ts";
import { addAccount, apiFor, openServer, navigate } from "../client.ts";
import { getState, setState, toast, useStore } from "../store.ts";
import { Avatar, closeModal, Field, Icon, Modal, openModal } from "./ui.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { Brand } from "./Brand.tsx";
import { GlobalError, signInServer, toAccount } from "../global.ts";
import { useRequestOwner } from "../lib/use-request-owner.ts";
import { isCancellation } from "../../../shared/requests.ts";

export function AddAccountModal() {
  const requests = useRequestOwner();
  const modal = getState().modal;
  const remembered = modal?.kind === "addAccount" ? getState().rememberedAccounts.find((account) => account.id === modal.rememberedId) : undefined;
  const [address, setAddress] = useState(remembered?.url ?? "");
  const [info, setInfo] = useState<{ url: string; info: InstanceInfo } | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState(remembered?.username ?? "");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const globalAccount = useStore((s) => s.global);
  const globalDefault = useStore((s) => s.settings.globalDefault);
  /** First global sign-in on this server: it asks for a username here. */
  const [globalFirst, setGlobalFirst] = useState(false);

  /** Annoy Global: no password for this server; its own identity and a blind token instead. */
  async function withGlobal(e?: FormEvent) {
    e?.preventDefault();
    const signal = requests.signal;
    if (!info?.info.globalServerId || busy || waitingDiscord) return;
    setError(null);
    setBusy(true);
    try {
      const first = globalFirst ? { username, ...(displayName && { displayName }), ...(inviteCode.trim() && { inviteCode: inviteCode.trim() }) } : undefined;
      const auth = await signInServer(info.url, info.info.globalServerId, first, signal);
      signal.throwIfAborted();
      addAccount(toAccount(info.url, info.info, auth));
    } catch (err) {
      if (isCancellation(err)) return;
      if (err instanceof GlobalError && err.code === "global_new_account") {
        setGlobalFirst(true);
        if (!username && globalAccount) setUsername(globalAccount.name.toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 32));
      } else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!remembered) return;
    const signal = requests.signal;
    let active = true;
    void findInstance(remembered.url, signal).then((value) => { if (active) setInfo(value); }).catch((err) => { if (active && !isCancellation(err)) setError((err as Error).message); });
    return () => { active = false; };
  }, []);

  async function probe(e: FormEvent) {
    e.preventDefault();
    const signal = requests.signal;
    if (busy || waitingDiscord) return;
    setError(null);
    setBusy(true);
    try {
      const found = await findInstance(address, signal);
      signal.throwIfAborted();
      setInfo(found);
    } catch (err) {
      if (!isCancellation(err)) setError(err instanceof TypeError ? translate("common.8ad698582e04") : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const [waitingDiscord, setWaitingDiscord] = useState(false);
  const discordAbort = useRef<AbortController | null>(null);

  async function withDiscord() {
    const signal = requests.signal;
    if (!info || busy || waitingDiscord) return;
    setError(null);
    setWaitingDiscord(true);
    const abort = new AbortController();
    discordAbort.current = abort;
    const active = AbortSignal.any([abort.signal, signal]);
    try {
      const { auth } = await discordLogin(info.url, () => beginDiscordLogin(info.url, inviteCode.trim() || undefined, active), active);
      active.throwIfAborted();
      if (auth) addAccount({ id: `${info.url}#${auth.user.id}`, url: info.url, token: auth.token, userId: auth.user.id, instanceName: info.info.name });
    } catch (err) {
      if (!active.aborted) setError((err as Error).message);
    } finally {
      setWaitingDiscord(false);
    }
  }

  // Older servers don't send `registration`; they never require an invite.
  const needsInvite = info?.info.registration === "invite";

  async function submit(e: FormEvent) {
    e.preventDefault();
    const signal = requests.signal;
    if (!info || busy || waitingDiscord) return;
    setError(null);
    setBusy(true);
    try {
      const res = await authenticate(info.url, mode, {
        username,
        password,
        ...(mode === "register" && displayName && { displayName }),
        ...(mode === "register" && inviteCode.trim() && { inviteCode: inviteCode.trim() }),
      }, signal);
      signal.throwIfAborted();
      addAccount({ id: `${info.url}#${res.user.id}`, url: info.url, token: res.token, userId: res.user.id, instanceName: info.info.name });
    } catch (err) {
      if (!isCancellation(err)) setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={info ? mode === "register" ? translate("common.5cee3300234b") : translate("common.5cab734a703f") : translate("common.9c9822ea2ed2")} className="auth-modal">
      <div className="auth-intro"><Brand size={44} wordmark /><p>{info ? translate("common.461f89141d29",{p0:(info.info.name),p1:(mode === "register" ? translate("common.fa8a67c48a9a") : translate("common.0b4a1f0a5d92"))}) : translate("common.eb405545f232")}</p></div>
      {!info ? (
        <form onSubmit={probe} className="form">
          <p className="muted">{rich("common.a8f0392bbff0",{p0:(DEFAULT_PORT)})}</p>
          <Field label={translate("common.ef5e7e12bdac")}>
            <Input autoFocus value={address} onChange={(e) => setAddress(e.target.value)} placeholder={translate("common.7a85f966dd7d")} required />
          </Field>
          {error && <p className="error">{error}</p>}
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={closeModal}>{translate("common.bb9dbb406dcb")}</Button>
            <Button type="submit" loading={busy}>
              {busy ? translate("common.cc190ab9f5ec") : translate("common.63e2bbaf1c92")}
            </Button>
          </div>
        </form>
      ) : globalFirst ? (
        <form onSubmit={(e) => void withGlobal(e)} className="form">
          <p className="muted">{translate("common.d225f33c0b43")}</p>
          <Field label={translate("common.118590be3458")}>
            <Input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" required />
          </Field>
          <Field label={translate("common.80d20f1ebbc0")} hint={translate("common.3801e195f8e9")}>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
          {needsInvite && (
            <Field label={translate("common.3dba7a6e77c4")} hint={translate("common.2dd350972cf4")}>
              <Input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder={translate("common.fb6e4a9111bb")} required />
            </Field>
          )}
          {error && <p className="error">{error}</p>}
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={() => setGlobalFirst(false)}>{translate("common.59dc926760d0")}</Button>
            <Button type="submit" loading={busy}>
              {busy ? translate("common.02cd97f15be8") : translate("common.4105811890ae")}
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={submit} className="form">
          {info.info.globalServerId && globalAccount && (
            <>
              <Button type="button" variant={globalDefault ? "default" : "outline"} loading={busy} onClick={() => void withGlobal()}>{rich("common.8243cbed1058",{p0:(globalAccount.name)})}</Button>
              <div className="or">
                <span>{translate("common.bf980888f076")}</span>
              </div>
            </>
          )}
          <div className="tabs">
            <Button type="button" variant="ghost" className={mode === "login" ? "tab active" : "tab"} onClick={() => { setMode("login"); if (remembered) setUsername(remembered.username); }}>{translate("common.4105811890ae")}</Button>
            <Button
              type="button"
              variant="ghost"
              className={mode === "register" ? "tab active" : "tab"}
              onClick={() => { setMode("register"); if (remembered) setUsername(""); }}
              disabled={!info.info.registrationOpen}
              title={info.info.registrationOpen ? undefined : translate("common.7e880dddb2bf")}
            >{translate("common.8cb3525e3b7e")}</Button>
          </div>
          <p className="muted">{info.url}</p>
          {remembered && mode === "login" && <div className="auth-remembered"><Avatar user={{ id: remembered.userId, username: remembered.username, displayName: remembered.displayName, avatarUrl: remembered.avatarUrl }} size={40} /><div><strong>{remembered.displayName}</strong><small>{rich("common.e839b7bc6a6e",{p0:(remembered.username)})}</small></div></div>}
          {info.info.discordLogin && (
            <>
              {waitingDiscord ? (
                <div className="discord-wait">
                  <span>{translate("common.2b4dccbda2db")}</span>
                  <Button type="button" variant="secondary" onClick={() => discordAbort.current?.abort()}>{translate("common.bb9dbb406dcb")}</Button>
                </div>
              ) : (
                <Button type="button" variant="outline" onClick={() => void withDiscord()}>{translate("common.d1a81cb724d8")}</Button>
              )}
              {needsInvite && (
                <Field label={translate("common.46ab540b0def")} hint={translate("common.32d8dc1914f9")}>
                  <Input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder={translate("common.fb6e4a9111bb")} />
                </Field>
              )}
              <div className="or">
                <span>{translate("common.44dd7040a457")}</span>
              </div>
            </>
          )}
          <Field label={translate("expression.f53bbaa05fae")}>
            <Input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          </Field>
          {mode === "register" && (
            <Field label={translate("common.80d20f1ebbc0")} hint={translate("common.3801e195f8e9")}>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </Field>
          )}
          {mode === "register" && needsInvite && (
            <Field label={translate("common.3dba7a6e77c4")} hint={translate("common.2dd350972cf4")}>
              <Input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder={translate("common.fb6e4a9111bb")} required />
            </Field>
          )}
          <Field label={translate("common.d482c10b3d4d")} hint={mode === "register" ? translate("common.7ecfbdb65f40") : undefined}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              required
            />
          </Field>
          {error && <p className="error">{error}</p>}
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={() => setInfo(null)}>{translate("common.59dc926760d0")}</Button>
            <Button type="submit" loading={busy}>
              {busy ? translate("common.02cd97f15be8") : mode === "login" ? translate("common.4105811890ae") : translate("common.8cb3525e3b7e")}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function SwitchAccountModal() {
  const accounts = useStore((s) => s.accounts), instances = useStore((s) => s.instances), remembered = useStore((s) => s.rememberedAccounts);
  const saved = remembered.filter((item) => !accounts.some((account) => account.id === item.id));
  return <Modal title={translate("common.cd405060935b")} className="account-switcher"><p className="muted">{translate("common.7cad3bbb5598")}</p><div className="saved-accounts">{accounts.map((account) => { const user = instances[account.id]?.user; return <button key={account.id} className="saved-account" onClick={() => { navigate({ kind: "home", accountId: account.id, dmId: null }); closeModal(); }}>
    {user ? <Avatar user={user} size={40} /> : <Brand size={40} />}<span><strong>{user?.displayName ?? account.instanceName}</strong><small>{rich("common.585ec732bc98",{p0:(account.instanceName)})}</small></span><Icon name="check" /></button>; })}
    {saved.map((account) => <div className="saved-account-row" key={account.id}><button className="saved-account" onClick={() => openModal({ kind: "addAccount", rememberedId: account.id })}><Avatar user={{ id: account.userId, username: account.username, displayName: account.displayName, avatarUrl: account.avatarUrl }} size={40} /><span><strong>{account.displayName}</strong><small>{rich("common.e089089b332e",{p0:(account.instanceName)})}</small></span><Icon name="right" /></button><button className="icon-btn" aria-label={translate("common.cb11afce3a10",{p0:(account.displayName)})} onClick={() => setState((s) => { s.rememberedAccounts = s.rememberedAccounts.filter((item) => item.id !== account.id); })}><Icon name="x" /></button></div>)}
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
          <p className="invite-preview"><strong>{preview.server.name}</strong> ? {counted(preview.memberCount,"counts.member.one","counts.member.other")}</p>
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
        <p className="muted small">{translate("common.9390c74f16b6")}</p>
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




