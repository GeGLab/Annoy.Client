import { Input } from "./ui/input.tsx";
import { confirmAction } from "./ui/action-dialog.tsx";
import { Select } from "./ui/select.tsx";
import { ActivityCard } from "../features/activity/ActivityCard.tsx";
import type { Relationship } from "@distopic/protocol";
import { useState, type FormEvent } from "react";
import { apiFor, navigate, openDm } from "../client.ts";
import { EMPTY_ACTIVITIES, useStore } from "../store.ts";
import { Chat } from "./Chat.tsx";
import { act, Avatar, Icon, openModal } from "./ui.tsx";
import { ResizablePanel } from "./layout/ResizablePanel.tsx";
import { Brand } from "./Brand.tsx";
import { UserPanel } from "./TopBar.tsx";
import { Button } from "./ui/button.tsx";

type Tab = "online" | "all" | "pending" | "add";

function FriendRow({ accountId, rel, online }: { accountId: string; rel: Relationship; online: boolean }) {
  const activities = useStore((s) => s.instances[accountId]?.activities?.[rel.user.id] ?? EMPTY_ACTIVITIES);
  const api = apiFor(accountId);
  return (
    <div className="friend">
      <Avatar user={rel.user} size={36} presence={online ? "online" : "offline"} />
      <div className="friend-names">
        <strong>{rel.user.displayName}</strong>
        <span className="muted">
          {rel.status === "incoming" ? "Pedido recebido" : rel.status === "outgoing" ? "Pedido enviado" : online ? "Online" : "Offline"}
        </span>
        {rel.status === "friend" && activities.map((activity) => <ActivityCard key={activity.kind} activity={activity} compact />)}
      </div>
      <span className="spacer" />
      {rel.status === "friend" && (
        <button className="icon-btn" title="Mensagem" onClick={() => void openDm(accountId, rel.user.id)}>
          <Icon name="message" />
        </button>
      )}
      {rel.status === "incoming" && (
        <button className="icon-btn ok" title="Aceitar" onClick={() => void act(api.put(`/relationships/${rel.user.id}`))}>
          <Icon name="check" />
        </button>
      )}
      <button
        className="icon-btn danger"
        title={rel.status === "friend" ? "Desfazer amizade" : "Recusar/cancelar"}
        onClick={async () =>
          (rel.status !== "friend" || (await confirmAction(`Desfazer amizade com ${rel.user.displayName}?`))) &&
          void act(api.del(`/relationships/${rel.user.id}`))
        }
      >
        <Icon name="x" />
      </button>
    </div>
  );
}

function Friends({ accountId }: { accountId: string }) {
  const inst = useStore((s) => s.instances[accountId]);
  const [tab, setTab] = useState<Tab>("online");
  const [username, setUsername] = useState("");
  const rels = inst?.relationships ?? [];
  const online = (id: string) => inst?.presences[id] === "online";
  const pending = rels.filter((r) => r.status !== "friend");
  const list =
    tab === "online"
      ? rels.filter((r) => r.status === "friend" && online(r.user.id))
      : tab === "all"
        ? rels.filter((r) => r.status === "friend")
        : pending;

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (await act(apiFor(accountId).post("/relationships", { username: username.trim() }), "Pedido de amizade enviado")) setUsername("");
  };

  return (
    <section className="chat">
      <header className="chat-header">
        <Icon name="users" size={20} />
        <h1>Amigos</h1>
        <div className="tabs inline">
          {(["online", "all", "pending"] as const).map((t) => (
            <button key={t} className={tab === t ? "tab active" : "tab"} onClick={() => setTab(t)}>
              {t === "online" ? "Online" : t === "all" ? "Todos" : "Pendentes"}
              {t === "pending" && pending.some((r) => r.status === "incoming") && (
                <span className="badge">{pending.filter((r) => r.status === "incoming").length}</span>
              )}
            </button>
          ))}
          <button className={tab === "add" ? "tab tab-add active" : "tab tab-add"} onClick={() => setTab("add")}>
            Adicionar amigo
          </button>
        </div>
      </header>
      <div className="friends">
        {tab === "add" ? (
          <form className="add-friend" onSubmit={add}>
            <h3>Adicionar amigo</h3>
            <p className="muted">
              Digite o nome de usuário de alguém nesta instância ({inst?.user ? `você é @${inst.user.username}` : ""}).
            </p>
            <div className="add-friend-row">
              <Input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} placeholder="nome_de_usuario" />
              <button className="btn" disabled={!username.trim()}>
                Enviar pedido
              </button>
            </div>
          </form>
        ) : list.length === 0 ? (
          <div className="friends-empty">
            <Icon name={tab === "pending" ? "check" : "users"} size={40} />
            <h2>
              {tab === "pending" ? "Tudo em dia por aqui" : tab === "online" ? "O papo começa com um olá" : "Boas conversas começam aqui"}
            </h2>
            <p>
              {tab === "pending"
                ? "Seus próximos pedidos de amizade aparecem aqui."
                : tab === "online"
                  ? "Seus amigos aparecerão aqui quando estiverem online."
                  : "Adicione alguém da sua instância para começar uma conversa."}
            </p>
            {tab !== "pending" && (
              <Button variant="secondary" onClick={() => setTab(tab === "online" ? "all" : "add")}>
                {tab === "online" ? "Ver todos os amigos" : "Adicionar amigo"}
              </Button>
            )}
          </div>
        ) : (
          list.map((r) => <FriendRow key={r.user.id} accountId={accountId} rel={r} online={online(r.user.id)} />)
        )}
      </div>
    </section>
  );
}

export function Home({ accountId, dmId }: { accountId: string | null; dmId: string | null }) {
  const accounts = useStore((s) => s.accounts);
  const inst = useStore((s) => (accountId ? s.instances[accountId] : undefined));
  const unread = inst?.unread;

  if (!accountId || !inst) {
    return (
      <div className="server-view">
        <ResizablePanel panel="channels">
          <header className="channels-header static">
            <span>Seu espaço</span>
            <Icon name="message" size={18} />
          </header>
          <div className="channel-scroll first-run-sidebar">
            <button className="channel active" aria-current="page">
              <Icon name="home" />
              <span>Início</span>
            </button>
            <div className="sidebar-section-heading">
              <span>Mensagens diretas</span>
              <button className="icon-btn tiny" aria-label="Conectar para conversar" onClick={() => openModal({ kind: "addAccount" })}>
                <Icon name="plus" size={14} />
              </button>
            </div>
            <p className="sidebar-empty">Suas conversas vão encontrar um lugar aqui.</p>
            <div className="sidebar-connect">
              <Icon name="message" size={22} />
              <strong>Traga sua comunidade.</strong>
              <p>Conecte uma instância e encontre seus canais, amigos e chamadas.</p>
              <button onClick={() => openModal({ kind: "addAccount" })}>
                Conectar instância <Icon name="right" size={14} />
              </button>
            </div>
          </div>
          <UserPanel />
        </ResizablePanel>
        <div className="empty-main welcome">
          <header className="welcome-topline">
            <Icon name="home" size={18} />
            <span>Início</span>
          </header>
          <div className="welcome-content">
            <Brand size={72} />
            <h1>
              O seu lugar.
              <br />
              <span>As suas conversas.</span>
            </h1>
            <p>
              Entre na sua comunidade, encontre seus amigos
              <br className="desktop-break" /> e fique para mais uma conversa.
            </p>
            <div className="welcome-actions">
              <Button onClick={() => openModal({ kind: "addAccount" })}>
                <Icon name="plus" size={17} />
                Conectar uma instância
              </Button>
              <Button variant="secondary" onClick={() => navigate({ kind: "discord" })}>
                Abrir Discord
                <Icon name="right" size={16} />
              </Button>
            </div>
            <span className="welcome-hint">Tem um endereço de servidor? É tudo de que você precisa.</span>
          </div>
          <footer className="welcome-footer">
            <Brand size={20} wordmark />
            <span>Comunidades independentes. Conversas próximas.</span>
          </footer>
        </div>
      </div>
    );
  }

  const dm = inst.dms.find((d) => d.id === dmId);
  const other = dm?.recipients[0];
  const me = inst.user;

  return (
    <div className="server-view">
      <ResizablePanel panel="channels">
        <header className="channels-header static">
          {accounts.length > 1 ? (
            <Select
              className="account-select"
              value={accountId}
              onChange={(e) => navigate({ kind: "home", accountId: e.target.value, dmId: null })}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.instanceName}
                </option>
              ))}
            </Select>
          ) : (
            <span className="truncate">{accounts[0]?.instanceName}</span>
          )}
        </header>
        <ul className="channel-scroll">
          <li>
            <div className={`channel${!dmId ? " active" : ""}`} onClick={() => navigate({ kind: "home", accountId, dmId: null })}>
              <Icon name="users" size={18} />
              <span className="channel-name">Amigos</span>
            </div>
          </li>
          <li className="section-label padded">Mensagens diretas</li>
          {inst.dms.map((d) => {
            const r = d.recipients[0];
            if (!r) return null;
            const u = unread?.[d.id];
            return (
              <li key={d.id}>
                <div
                  className={`channel dm${dmId === d.id ? " active" : ""}${u ? " unread" : ""}`}
                  onClick={() => navigate({ kind: "home", accountId, dmId: d.id })}
                >
                  <Avatar user={r} size={28} presence={inst.presences[r.id] ?? "offline"} />
                  <span className="channel-name">{r.displayName}</span>
                  {u && <span className="badge">{u.count}</span>}
                </div>
              </li>
            );
          })}
          {inst.dms.length === 0 && <li className="muted padded small">Abra uma DM pela lista de amigos ou de membros.</li>}
        </ul>
        <UserPanel />
      </ResizablePanel>
      {dm && other && me ? (
        <Chat
          key={dm.id}
          accountId={accountId}
          channelId={dm.id}
          title={other.displayName}
          icon={null}
          canSend
          canAttach
          canModerate={false}
          nameOf={(id) => (id === me.id ? me.displayName : dm.recipients.find((r) => r.id === id)?.displayName)}
          mentionables={dm.recipients.map((r) => ({ id: r.id, name: r.displayName, username: r.username }))}
        />
      ) : (
        <Friends accountId={accountId} />
      )}
    </div>
  );
}
