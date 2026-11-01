import { GlobalSignIn } from "./GlobalSignIn.tsx";
import { Select } from "./ui/select.tsx";
import type { AuthResponse, InstanceInfo, Invite, ServerSummary } from "@distopic/protocol";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { authenticate, beginDiscordLogin, discordLogin, DEFAULT_PORT, findInstance } from "../api.ts";
import { addAccount, apiFor, openServer, navigate, signOutAccount } from "../client.ts";
import { Tooltip } from "./ui/tooltip.tsx";
import { getState, setState, toast, useStore } from "../store.ts";
import { Avatar, closeModal, Field, Icon, Modal, openModal } from "./ui.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { Brand } from "./Brand.tsx";
import { GlobalError, migrateServer, signInServer, syncVault, toAccount } from "../global.ts";

export function AddAccountModal() {
  const modal = getState().modal;
  const remembered = modal?.kind === "addAccount" ? getState().rememberedAccounts.find(a => a.id === modal.rememberedId) : undefined;
  const saved = modal?.kind === "addAccount" ? getState().accounts.find(a => a.id === modal.accountId) : undefined;
  const cached = saved ? getState().instances[saved.id]?.user : undefined;
  const [address, setAddress] = useState(saved?.url ?? remembered?.url ?? "");
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
  const [globalFirst, setGlobalFirst] = useState(false);
  const [migration, setMigration] = useState(false);
  const discordAbort = useRef<AbortController | null>(null);
  useEffect(() => () => discordAbort.current?.abort(), []);
  const localMode = info?.info.accountMode === "local";
  const needsInvite = info?.info.registration === "invite";

  useEffect(() => {
    if (!address) return;
    let active = true;
    void findInstance(address).then(async value => {
      if (!active) return;
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
    try { setInfo(await findInstance(address)); }
    catch (err) { setError(err instanceof TypeError ? "Não foi possível alcançar o servidor" : (err as Error).message); }
    finally { setBusy(false); }
  }
  async function withGlobal(e?: FormEvent) {
    e?.preventDefault();
    if (!info?.info.globalServerId) return;
    setError(null); setBusy(true);
    try {
      const auth = migration
        ? await migrateServer(info.url, info.info, { username, password, recoveryCode }, saved?.token)
        : await signInServer(info.url, info.info.globalServerId, globalFirst ? { username, ...(displayName && { displayName }), ...(inviteCode && { inviteCode }) } : undefined);
      addAccount(toAccount(info.url, info.info, auth));
    } catch (err) {
      if (err instanceof GlobalError && err.code === "global_new_account") {
        setGlobalFirst(true);
        if (!username && globalAccount) setUsername(globalAccount.name.toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 32));
      } else setError((err as Error).message);
    } finally { setBusy(false); }
  }
  async function submitLocal(e: FormEvent) {
    e.preventDefault(); if (!info) return;
    setError(null); setBusy(true);
    try {
      const auth: AuthResponse = migration
        ? await migrateServer(info.url, info.info, { username, recoveryCode, newPassword }, saved?.token)
        : await authenticate(info.url, mode, { username, password, ...(mode === "register" && { displayName: displayName || username, inviteCode }) });
      addAccount(toAccount(info.url, info.info, auth));
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  async function withDiscord() {
    if (!info || !localMode) return;
    const abort = new AbortController(); discordAbort.current = abort;
    setBusy(true); setError(null);
    try {
      const { auth } = await discordLogin(info.url, () => beginDiscordLogin(info.url, inviteCode || undefined), abort.signal);
      if (auth) addAccount(toAccount(info.url, info.info, auth));
    } catch (err) { if (!abort.signal.aborted) setError((err as Error).message); }
    finally { setBusy(false); discordAbort.current = null; }
  }
  const ownershipFields = <>
    <Field label="Usuário anterior neste servidor"><Input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required /></Field>
    {!localMode && <Field label="Senha local anterior"><Input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></Field>}
    <Field label="Código de recuperação" hint="Se não tiver a senha anterior, peça um código ao administrador do servidor."><Input value={recoveryCode} onChange={e => setRecoveryCode(e.target.value)} autoComplete="off" /></Field>
    {saved && <p className="muted small">A sessão salva comprova sua conta anterior. Senha ou código só são necessários se ela não for mais válida.</p>}
  </>;
  const syncNow = async () => {
    setBusy(true); setError(null);
    try { await syncVault(); toast("Servidores da conta Annoy sincronizados"); closeModal(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return <Modal title={info ? migration ? "Migrar sua conta" : localMode ? "Conta local deste servidor" : "Entrar com conta Annoy" : "Adicionar conta"} className="auth-modal" busy={busy}>
    <div className="auth-intro"><Brand size={44} wordmark /><p>{info ? info.info.name : "Entre com a conta Annoy para trazer seus servidores, ou conecte um servidor pelo endereço."}</p></div>
    {!info && !saved && (globalAccount
      ? <div className="form"><Button type="button" loading={busy} onClick={() => void syncNow()}><Icon name="refresh" />Trazer servidores da conta Annoy</Button></div>
      : <GlobalSignIn intro="Sua conta Annoy guarda a lista dos seus servidores e os conecta automaticamente." onSignedIn={() => { toast("Conta Annoy conectada. Seus servidores estão sendo adicionados."); closeModal(); }} />)}
    {!info && !saved && <p className="muted small auth-divider">ou conecte um servidor pelo endereço (porta padrão {DEFAULT_PORT})</p>}
    {!info ? <form onSubmit={probe} className="form">
      <Field label="Endereço"><Input autoFocus value={address} onChange={e => setAddress(e.target.value)} placeholder="chat.exemplo.com ou 192.168.0.10" required /></Field>
      {error && <p className="error">{error}</p>}
      <Button type="submit" loading={busy}>Continuar</Button>
    </form> : <>
      {!localMode && <p role={migration ? "alert" : undefined}>Atualização de segurança: este servidor exige uma conta Annoy. Contas locais existentes devem cadastrar ou acessar uma conta Annoy e concluir a migração para preservar seu histórico e permissões.</p>}
      {localMode && <p>O administrador escolheu contas locais. Este servidor não se comunica com o serviço de contas Annoy.{migration && " Defina uma senha local para continuar com sua conta."}</p>}
      {!localMode && !globalAccount ? <GlobalSignIn /> : <form className="form" onSubmit={localMode ? submitLocal : e => void withGlobal(e)}>
        {migration ? ownershipFields : (localMode || globalFirst) && <>
          {localMode && <div className="tabs"><Button type="button" variant="ghost" onClick={() => setMode("login")}>Entrar</Button><Button type="button" variant="ghost" disabled={!info.info.registrationOpen} onClick={() => setMode("register")}>Criar conta local</Button></div>}
          <Field label="Usuário neste servidor"><Input autoFocus value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required /></Field>
          {(globalFirst || mode === "register") && <>
            <Field label="Nome de exibição"><Input value={displayName} onChange={e => setDisplayName(e.target.value)} /></Field>
            {needsInvite && <Field label="Convite de cadastro"><Input value={inviteCode} onChange={e => setInviteCode(e.target.value)} required /></Field>}
          </>}
        </>}
        {localMode && <Field label={migration ? "Nova senha local" : "Senha local"}><Input type="password" value={migration ? newPassword : password} onChange={e => migration ? setNewPassword(e.target.value) : setPassword(e.target.value)} autoComplete={migration || mode === "register" ? "new-password" : "current-password"} minLength={migration || mode === "register" ? 8 : undefined} required /></Field>}
        {migration && !localMode && <p className="muted small">Sua conta anterior passará a usar somente o login da conta Annoy. Se essa conta Annoy já tiver um usuário aqui, os históricos serão unificados.</p>}
        {!localMode && !info.info.globalServerId && <>
          <p className="error">Login da conta Annoy temporariamente indisponível.</p>
          <Button type="button" variant="secondary" onClick={() => void findInstance(info.url).then(setInfo, err => setError((err as Error).message))}>Tentar novamente</Button>
        </>}
        {error && <p className="error">{error}</p>}
        <Button type="submit" loading={busy} disabled={!localMode && !info.info.globalServerId}>{migration ? "Concluir migração" : localMode ? mode === "register" ? "Criar conta local" : "Entrar" : `Continuar com ${globalAccount?.name ?? "conta Annoy"}`}</Button>
      </form>}
      {localMode && info.info.discordLogin && !migration && <Button type="button" variant="outline" loading={busy} onClick={() => void withDiscord()}>Entrar com Discord</Button>}
      {discordAbort.current && <Button type="button" variant="secondary" onClick={() => discordAbort.current?.abort()}>Cancelar autorização</Button>}
      <div className="form-actions">
        <Button type="button" variant="ghost" onClick={() => { setMigration(!migration); setGlobalFirst(false); setError(null); }}>{migration ? "Voltar ao login" : "Migrar uma conta existente"}</Button>
        <Button type="button" variant="secondary" onClick={closeModal}>Fechar</Button>
      </div>
    </>}
  </Modal>;
}

export function SwitchAccountModal() {
  const accounts = useStore((s) => s.accounts), instances = useStore((s) => s.instances), remembered = useStore((s) => s.rememberedAccounts);
  const saved = remembered.filter((item) => !accounts.some((account) => account.id === item.id));
  return <Modal title="Trocar de conta" className="account-switcher"><p className="muted">Escolha uma conta conectada ou entre novamente em uma conta salva. Senhas não são lembradas.</p><div className="saved-accounts">{accounts.map((account) => { const user = instances[account.id]?.user, name = user?.displayName ?? account.instanceName; return <div className="saved-account-row" key={account.id}><button className="saved-account" onClick={() => { navigate({ kind: "home", accountId: account.id, dmId: null }); closeModal(); }}>
    {user ? <Avatar user={user} size={40} /> : <Brand size={40} />}<span><strong>{name}</strong><small>{account.instanceName} · Conectada</small></span><Icon name="check" /></button><Tooltip content="Sair desta conta"><button className="icon-btn" aria-label={`Sair de ${name}`} onClick={() => signOutAccount(account.id)}><Icon name="logout" /></button></Tooltip></div>; })}
    {saved.map((account) => <div className="saved-account-row" key={account.id}><button className="saved-account" onClick={() => openModal({ kind: "addAccount", rememberedId: account.id })}><Avatar user={{ id: account.userId, username: account.username, displayName: account.displayName, avatarUrl: account.avatarUrl }} size={40} /><span><strong>{account.displayName}</strong><small>{account.instanceName} · Entrar novamente</small></span><Icon name="right" /></button><button className="icon-btn" aria-label={`Esquecer ${account.displayName}`} onClick={() => setState((s) => { s.rememberedAccounts = s.rememberedAccounts.filter((item) => item.id !== account.id); })}><Icon name="x" /></button></div>)}
  </div><Button onClick={() => openModal({ kind: "addAccount" })}><Icon name="plus" />Adicionar conta</Button></Modal>;
}

/** Invite codes may be pasted bare or as part of a link. */
const inviteCodeOf = (input: string) => input.trim().split(/[/\s]/).filter(Boolean).pop() ?? "";

export function CreateServerModal({ accountId: initialAccount }: { accountId: string }) {
  const accounts = useStore((s) => s.accounts);
  const [accountId, setAccountId] = useState(initialAccount);
  const [name, setName] = useState("");
  const [invite, setInvite] = useState("");
  const [preview, setPreview] = useState<Invite | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const server = await apiFor(accountId).post<ServerSummary>("/servers", { name });
      closeModal();
      void openServer(accountId, server.id);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const code = inviteCodeOf(invite);
      if (!preview) {
        setPreview(await apiFor(accountId).get<Invite>(`/invites/${code}`));
        return;
      }
      const server = await apiFor(accountId).post<ServerSummary>(`/invites/${code}`);
      closeModal();
      void openServer(accountId, server.id);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Adicionar servidor">
      {accounts.length > 1 && (
        <Field label="Instância">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.instanceName} ({a.url})
              </option>
            ))}
          </Select>
        </Field>
      )}
      <form onSubmit={create} className="form">
        <h3>Criar um servidor</h3>
        <Field label="Nome do servidor">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Meu servidor" required maxLength={100} />
        </Field>
        <div className="form-actions">
          <Button type="submit" loading={busy} disabled={!name.trim()}>
            Criar
          </Button>
        </div>
      </form>
      <hr />
      <form onSubmit={join} className="form">
        <h3>Entrar com um convite</h3>
        <Field label="Código do convite">
          <Input
            value={invite}
            onChange={(e) => {
              setInvite(e.target.value);
              setPreview(null);
            }}
            placeholder="aB3dE5gH"
            required
          />
        </Field>
        {preview && (
          <p className="invite-preview">
            <strong>{preview.server.name}</strong> · {preview.memberCount} membro{preview.memberCount === 1 ? "" : "s"}
          </p>
        )}
        <div className="form-actions">
          <Button type="submit" loading={busy} disabled={!invite.trim()}>
            {preview ? "Entrar no servidor" : "Verificar convite"}
          </Button>
        </div>
      </form>
      <hr />
      <div className="form">
        <h3>Trazer do Discord</h3>
        <p className="muted small">Copie canais, cargos, permissões e o histórico de um servidor do Discord, escolhendo o que entra.</p>
        <div className="form-actions start">
          <Button
            variant="secondary"
            onClick={() =>
              setState((s) => {
                s.modal = { kind: "importDiscord", accountId, serverId: null };
              })
            }
          >
            Importar do Discord…
          </Button>
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
        >
          Conectar a outra instância Annoy…
        </Button>
      </div>
    </Modal>
  );
}
