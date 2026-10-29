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

export function AddAccountModal() {
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
    if (!info?.info.globalServerId) return;
    setError(null);
    setBusy(true);
    try {
      const first = globalFirst ? { username, ...(displayName && { displayName }), ...(inviteCode.trim() && { inviteCode: inviteCode.trim() }) } : undefined;
      const auth = await signInServer(info.url, info.info.globalServerId, first);
      addAccount(toAccount(info.url, info.info, auth));
    } catch (err) {
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
    let active = true;
    void findInstance(remembered.url).then((value) => { if (active) setInfo(value); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function probe(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setInfo(await findInstance(address));
    } catch (err) {
      setError(err instanceof TypeError ? "Não foi possível alcançar o servidor" : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const [waitingDiscord, setWaitingDiscord] = useState(false);
  const discordAbort = useRef<AbortController | null>(null);

  async function withDiscord() {
    if (!info) return;
    setError(null);
    setWaitingDiscord(true);
    const abort = new AbortController();
    discordAbort.current = abort;
    try {
      const { auth } = await discordLogin(info.url, () => beginDiscordLogin(info.url, inviteCode.trim() || undefined), abort.signal);
      if (auth) addAccount({ id: `${info.url}#${auth.user.id}`, url: info.url, token: auth.token, userId: auth.user.id, instanceName: info.info.name });
    } catch (err) {
      if (!abort.signal.aborted) setError((err as Error).message);
    } finally {
      setWaitingDiscord(false);
    }
  }

  // Older servers don't send `registration`; they never require an invite.
  const needsInvite = info?.info.registration === "invite";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!info) return;
    setError(null);
    setBusy(true);
    try {
      const res = await authenticate(info.url, mode, {
        username,
        password,
        ...(mode === "register" && displayName && { displayName }),
        ...(mode === "register" && inviteCode.trim() && { inviteCode: inviteCode.trim() }),
      });
      addAccount({ id: `${info.url}#${res.user.id}`, url: info.url, token: res.token, userId: res.user.id, instanceName: info.info.name });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={info ? mode === "register" ? "Criar sua conta" : "Bem-vindo de volta" : "Conectar a um servidor Annoy"} className="auth-modal">
      <div className="auth-intro"><Brand size={44} wordmark /><p>{info ? `Seu espaço em ${info.info.name}. ${mode === "register" ? "Escolha como seus amigos vão encontrar você." : "Entre para continuar suas conversas."}` : "Suas comunidades, suas conversas. Comece pelo endereço da sua instância."}</p></div>
      {!info ? (
        <form onSubmit={probe} className="form">
          <p className="muted">
            Digite só o endereço do servidor, sem https://, como no TeamSpeak. Se ele não responder pelo endereço, o client tenta a porta {DEFAULT_PORT}.
          </p>
          <Field label="Endereço">
            <Input autoFocus value={address} onChange={(e) => setAddress(e.target.value)} placeholder="chat.exemplo.com ou 192.168.0.10" required />
          </Field>
          {error && <p className="error">{error}</p>}
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={closeModal}>
              Cancelar
            </Button>
            <Button type="submit" loading={busy}>
              {busy ? "Conectando…" : "Continuar"}
            </Button>
          </div>
        </form>
      ) : globalFirst ? (
        <form onSubmit={(e) => void withGlobal(e)} className="form">
          <p className="muted">
            Primeira vez neste servidor com a conta global. Escolha como você aparece aqui: ele não fica sabendo da sua conta global.
          </p>
          <Field label="Nome de usuário neste servidor">
            <Input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" required />
          </Field>
          <Field label="Nome de exibição" hint="Opcional; você pode mudar depois">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
          {needsInvite && (
            <Field label="Convite de cadastro" hint="Peça a quem hospeda esta instância">
              <Input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="aB3dE5gH" required />
            </Field>
          )}
          {error && <p className="error">{error}</p>}
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={() => setGlobalFirst(false)}>
              Voltar
            </Button>
            <Button type="submit" loading={busy}>
              {busy ? "Aguarde…" : "Entrar"}
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={submit} className="form">
          {info.info.globalServerId && globalAccount && (
            <>
              <Button type="button" variant={globalDefault ? "default" : "outline"} loading={busy} onClick={() => void withGlobal()}>
                Entrar com a conta global ({globalAccount.name})
              </Button>
              <div className="or">
                <span>ou com uma conta deste servidor</span>
              </div>
            </>
          )}
          <div className="tabs">
            <Button type="button" variant="ghost" className={mode === "login" ? "tab active" : "tab"} onClick={() => { setMode("login"); if (remembered) setUsername(remembered.username); }}>
              Entrar
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={mode === "register" ? "tab active" : "tab"}
              onClick={() => { setMode("register"); if (remembered) setUsername(""); }}
              disabled={!info.info.registrationOpen}
              title={info.info.registrationOpen ? undefined : "Cadastro fechado nesta instância"}
            >
              Criar conta
            </Button>
          </div>
          <p className="muted">{info.url}</p>
          {remembered && mode === "login" && <div className="auth-remembered"><Avatar user={{ id: remembered.userId, username: remembered.username, displayName: remembered.displayName, avatarUrl: remembered.avatarUrl }} size={40} /><div><strong>{remembered.displayName}</strong><small>@{remembered.username} · Conta lembrada neste dispositivo</small></div></div>}
          {info.info.discordLogin && (
            <>
              {waitingDiscord ? (
                <div className="discord-wait">
                  <span>Autorize no navegador que abriu…</span>
                  <Button type="button" variant="secondary" onClick={() => discordAbort.current?.abort()}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <Button type="button" variant="outline" onClick={() => void withDiscord()}>
                  Entrar com Discord
                </Button>
              )}
              {needsInvite && (
                <Field label="Convite (para conta nova)" hint="Quem já tem conta pode deixar em branco">
                  <Input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="aB3dE5gH" />
                </Field>
              )}
              <div className="or">
                <span>ou com usuário e senha</span>
              </div>
            </>
          )}
          <Field label="Usuário">
            <Input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
          </Field>
          {mode === "register" && (
            <Field label="Nome de exibição" hint="Opcional; você pode mudar depois">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </Field>
          )}
          {mode === "register" && needsInvite && (
            <Field label="Convite de cadastro" hint="Peça a quem hospeda esta instância">
              <Input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="aB3dE5gH" required />
            </Field>
          )}
          <Field label="Senha" hint={mode === "register" ? "Mínimo de 8 caracteres" : undefined}>
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
            <Button type="button" variant="secondary" onClick={() => setInfo(null)}>
              Voltar
            </Button>
            <Button type="submit" loading={busy}>
              {busy ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar conta"}
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
  return <Modal title="Trocar de conta" className="account-switcher"><p className="muted">Escolha uma conta conectada ou entre novamente em uma conta salva. Senhas não são lembradas.</p><div className="saved-accounts">{accounts.map((account) => { const user = instances[account.id]?.user; return <button key={account.id} className="saved-account" onClick={() => { navigate({ kind: "home", accountId: account.id, dmId: null }); closeModal(); }}>
    {user ? <Avatar user={user} size={40} /> : <Brand size={40} />}<span><strong>{user?.displayName ?? account.instanceName}</strong><small>{account.instanceName} · Conectada</small></span><Icon name="check" /></button>; })}
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
