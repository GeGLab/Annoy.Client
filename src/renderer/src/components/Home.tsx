import type { Relationship } from "@distopic/protocol";
import { useState, type FormEvent } from "react";
import { apiFor, navigate, openDm } from "../client.ts";
import { useStore } from "../store.ts";
import { Chat } from "./Chat.tsx";
import { act, Avatar, Icon, openModal } from "./ui.tsx";

type Tab = "online" | "all" | "pending" | "add";

function FriendRow({ accountId, rel, online }: { accountId: string; rel: Relationship; online: boolean }) {
  const api = apiFor(accountId);
  return (
    <div className="friend">
      <Avatar user={rel.user} size={36} presence={online ? "online" : "offline"} />
      <div className="friend-names">
        <strong>{rel.user.displayName}</strong>
        <span className="muted">
          {rel.status === "incoming" ? "Pedido recebido" : rel.status === "outgoing" ? "Pedido enviado" : online ? "Online" : "Offline"}
        </span>
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
        onClick={() => (rel.status !== "friend" || confirm(`Desfazer amizade com ${rel.user.displayName}?`)) && void act(api.del(`/relationships/${rel.user.id}`))}
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
  const list = tab === "online" ? rels.filter((r) => r.status === "friend" && online(r.user.id)) : tab === "all" ? rels.filter((r) => r.status === "friend") : pending;

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
              {t === "pending" && pending.some((r) => r.status === "incoming") && <span className="badge">{pending.filter((r) => r.status === "incoming").length}</span>}
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
            <p className="muted">Digite o nome de usuário de alguém nesta instância ({inst?.user ? `você é @${inst.user.username}` : ""}).</p>
            <div className="add-friend-row">
              <input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} placeholder="nome_de_usuario" />
              <button className="btn" disabled={!username.trim()}>
                Enviar pedido
              </button>
            </div>
          </form>
        ) : list.length === 0 ? (
          <p className="empty">{tab === "pending" ? "Nenhum pedido pendente." : tab === "online" ? "Nenhum amigo online agora." : "Você ainda não adicionou amigos."}</p>
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
        <aside className="channels">
          <div className="channel-scroll" />
        </aside>
        <div className="empty-main welcome">
          <h1>Bem-vindo ao Annoy</h1>
          <p>Junte suas comunidades num lugar só: servidores Annoy e os serviços que você já usa, como Discord, WhatsApp e TeamSpeak, cada um na sua aba.</p>
          <div className="form-actions center">
            <button className="btn" onClick={() => openModal({ kind: "addAccount" })}>
              Conectar a um servidor Annoy
            </button>
            <button className="btn btn-ghost" onClick={() => openModal({ kind: "addTab" })}>
              Adicionar serviço
            </button>
          </div>
        </div>
      </div>
    );
  }

  const dm = inst.dms.find((d) => d.id === dmId);
  const other = dm?.recipients[0];
  const me = inst.user;

  return (
    <div className="server-view">
      <aside className="channels">
        <header className="channels-header static">
          {accounts.length > 1 ? (
            <select className="account-select" value={accountId} onChange={(e) => navigate({ kind: "home", accountId: e.target.value, dmId: null })}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.instanceName}
                </option>
              ))}
            </select>
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
                <div className={`channel dm${dmId === d.id ? " active" : ""}${u ? " unread" : ""}`} onClick={() => navigate({ kind: "home", accountId, dmId: d.id })}>
                  <Avatar user={r} size={28} presence={inst.presences[r.id] ?? "offline"} />
                  <span className="channel-name">{r.displayName}</span>
                  {u && <span className="badge">{u.count}</span>}
                </div>
              </li>
            );
          })}
          {inst.dms.length === 0 && <li className="muted padded small">Abra uma DM pela lista de amigos ou de membros.</li>}
        </ul>
      </aside>
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
