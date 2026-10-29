import { useState, type FormEvent } from "react";
import { CATALOG, catalogEntry, teamspeakLink, type CatalogEntry, type Service, type TabDisplay, type TabPlacement, type TeamSpeakServer } from "../../../shared/services.ts";
import { addService, navigate, removeService, setServiceHidden, updateService } from "../client.ts";
import { initials } from "../format.tsx";
import { getState, useStore, type Settings } from "../store.ts";
import { closeModal, Field, Icon, Modal, openModal } from "./ui.tsx";

const newId = () => crypto.randomUUID();

/** "WhatsApp", then "WhatsApp 2" for a second account. */
function freeName(base: string): string {
  const taken = new Set(getState().services.map((s) => s.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}

function tileOf(service: Service): { text: string; color: string | undefined } {
  const entry = catalogEntry(service.kind);
  return { text: entry?.tile ?? initials(service.name), color: entry?.color };
}

/** A tab's placement and display, falling back to the defaults in Settings. */
export function tabLayout(service: Service, settings: Settings): { placement: TabPlacement; display: TabDisplay } {
  return { placement: service.placement ?? settings.servicePlacement, display: service.display ?? settings.serviceDisplay };
}

export function ServiceTab({ service }: { service: Service }) {
  const iconOnly = useStore((s) => tabLayout(service, s.settings).display === "icon");
  const active = useStore((s) => s.view.kind === "service" && s.view.serviceId === service.id);
  const badge = useStore((s) => s.serviceBadges[service.id]);
  const tile = tileOf(service);
  return (
    <button
      className={`tab-item service${active ? " active" : ""}${iconOnly ? " icon-only" : ""}`}
      onClick={() => navigate({ kind: "service", serviceId: service.id })}
      onContextMenu={(e) => {
        e.preventDefault();
        openModal({ kind: "serviceSettings", serviceId: service.id });
      }}
      title={`${service.name} · botão direito para opções`}
      aria-label={service.name}
      aria-current={active ? "page" : undefined}
    >
      <span className="tab-tile" style={tile.color ? { background: tile.color, color: "#fff" } : undefined}>
        {tile.text}
      </span>
      {!iconOnly && <span className="rail-label">{service.name}</span>}
      {badge && <span className="tab-badge">{badge}</span>}
    </button>
  );
}

/** Hidden tabs keep their login; this lists them so they can come back. */
export function HiddenServices() {
  // Selectors must return stored references, so filter outside of it.
  const hidden = useStore((s) => s.services).filter((sv) => sv.hidden);
  if (hidden.length === 0) return null;
  return (
    <ul className="hidden-services">
      {hidden.map((service) => {
        const tile = tileOf(service);
        return (
          <li key={service.id}>
            <span className="tab-tile" style={tile.color ? { background: tile.color, color: "#fff" } : undefined}>
              {tile.text}
            </span>
            <span className="truncate">{service.name}</span>
            <button className="btn btn-ghost btn-small" onClick={() => setServiceHidden(service.id, false)}>
              Mostrar
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ServiceCard({ entry }: { entry: CatalogEntry }) {
  const add = () =>
    addService({ id: newId(), kind: entry.kind, name: freeName(entry.name), url: entry.url, ...(entry.kind === "teamspeak" && { teamspeak: [] }) });
  return (
    <button className="service-card" onClick={add}>
      <span className="service-tile" style={{ background: entry.color }}>
        {entry.tile}
      </span>
      <span className="service-text">
        <strong>{entry.name}</strong>
        <span>{entry.description}</span>
      </span>
    </button>
  );
}

/** What the tab bar's "+" offers: Annoy communities first, then browser services. */
export function AddTabModal() {
  const accounts = useStore((s) => s.accounts);
  const hasHidden = useStore((s) => s.services.some((sv) => sv.hidden));
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addWeb = (e: FormEvent) => {
    e.preventDefault();
    let parsed: URL;
    try {
      parsed = new URL(/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
    } catch {
      return setError("Endereço inválido");
    }
    if (parsed.protocol !== "https:") return setError("Só sites com https");
    addService({ id: newId(), kind: "web", name: freeName(name.trim() || parsed.hostname.replace(/^www\./, "")), url: parsed.toString() });
  };

  return (
    <Modal title="Nova aba" wide>
      <div className="form">
        <h3>Comunidades Annoy</h3>
        <div className="form-actions start">
          <button className="btn" onClick={() => openModal({ kind: "addAccount" })}>
            Conectar a um servidor Annoy
          </button>
          {accounts[0] && (
            <button className="btn btn-ghost" onClick={() => openModal({ kind: "createServer", accountId: accounts[0]!.id })}>
              Criar ou entrar em um servidor
            </button>
          )}
        </div>
      </div>
      <hr />
      <div className="form">
        <h3>Serviços</h3>
        <p className="muted small">Cada serviço abre numa aba própria, com o login guardado só nele.</p>
        <div className="service-grid">
          {CATALOG.map((entry) => (
            <ServiceCard key={entry.kind} entry={entry} />
          ))}
        </div>
      </div>
      {hasHidden && (
        <>
          <hr />
          <div className="form">
            <h3>Abas ocultas</h3>
            <HiddenServices />
          </div>
        </>
      )}
      <hr />
      <form className="form" onSubmit={addWeb}>
        <h3>Outro site</h3>
        <div className="grid-2">
          <Field label="Endereço">
            <input value={url} onChange={(e) => (setUrl(e.target.value), setError(null))} placeholder="chat.exemplo.com" />
          </Field>
          <Field label="Nome da aba">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Opcional" />
          </Field>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="form-actions">
          <button className="btn btn-ghost" disabled={!url.trim()}>
            Adicionar site
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function ServiceSettingsModal({ serviceId }: { serviceId: string }) {
  const service = useStore((s) => s.services.find((sv) => sv.id === serviceId));
  const defaults = useStore((s) => s.settings);
  const [name, setName] = useState(service?.name ?? "");
  const [placement, setPlacement] = useState<TabPlacement | "">(service?.placement ?? "");
  const [display, setDisplay] = useState<TabDisplay | "">(service?.display ?? "");
  if (!service) return null;
  const save = (e: FormEvent) => {
    e.preventDefault();
    updateService(service.id, (sv) => {
      if (name.trim()) sv.name = name.trim();
      sv.placement = placement || undefined;
      sv.display = display || undefined;
    });
    closeModal();
  };
  const hide = () => {
    setServiceHidden(service.id, true);
    closeModal();
  };
  const remove = () => {
    const what = service.kind === "teamspeak" ? "Os servidores salvos nela serão apagados." : "O login neste serviço será apagado deste computador.";
    if (confirm(`Remover a aba ${service.name}? ${what}`)) void removeService(service.id);
  };
  return (
    <Modal title={service.name}>
      <form className="form" onSubmit={save}>
        <Field label="Nome da aba">
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        {service.kind !== "teamspeak" && <p className="muted small">{service.url}</p>}
        <div className="grid-2">
          <Field label="Posição">
            <select value={placement} onChange={(e) => setPlacement(e.target.value as TabPlacement | "")}>
              <option value="">Padrão ({defaults.servicePlacement === "before" ? "antes" : "depois"} dos servidores)</option>
              <option value="before">Antes dos servidores Annoy</option>
              <option value="after">Depois dos servidores Annoy</option>
            </select>
          </Field>
          <Field label="Na barra">
            <select value={display} onChange={(e) => setDisplay(e.target.value as TabDisplay | "")}>
              <option value="">Padrão ({defaults.serviceDisplay === "full" ? "ícone e nome" : "só ícone"})</option>
              <option value="full">Ícone e nome</option>
              <option value="icon">Só ícone</option>
            </select>
          </Field>
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={hide} title="Some da barra, mas continua logado. Volta pelo + ou em Configurações.">
            Ocultar
          </button>
          {service.kind !== "teamspeak" && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                window.distopic?.services.reload(service.id);
                closeModal();
              }}
            >
              Recarregar
            </button>
          )}
          <button type="button" className="btn btn-danger" onClick={remove}>
            Remover aba
          </button>
          <button className="btn">Salvar</button>
        </div>
      </form>
    </Modal>
  );
}

/** Placeholder under the native view while a browser service loads. */
export function ServicePlaceholder({ service }: { service: Service }) {
  return (
    <div className="service-placeholder">
      <p>Carregando {service.name}…</p>
    </div>
  );
}

const EMPTY_SERVER: Omit<TeamSpeakServer, "id"> = { name: "", address: "", nickname: "", channel: "" };

/** TeamSpeak has no web client, so its tab keeps servers and joins them through the official app. */
export function TeamSpeakView({ service }: { service: Service }) {
  const servers = service.teamspeak ?? [];
  const [draft, setDraft] = useState(EMPTY_SERVER);
  const [adding, setAdding] = useState(servers.length === 0);
  const set = (patch: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...patch }));

  const add = (e: FormEvent) => {
    e.preventDefault();
    const server = { ...draft, id: newId(), name: draft.name.trim() || draft.address.trim() };
    updateService(service.id, (sv) => void (sv.teamspeak = [...(sv.teamspeak ?? []), server]));
    setDraft(EMPTY_SERVER);
    setAdding(false);
  };
  const remove = (id: string) => updateService(service.id, (sv) => void (sv.teamspeak = (sv.teamspeak ?? []).filter((s) => s.id !== id)));

  return (
    <div className="teamspeak-view">
      <header className="teamspeak-header">
        <div>
          <h1>{service.name}</h1>
          <p className="muted">Entrar abre o app do TeamSpeak já no servidor, com o seu apelido.</p>
        </div>
        <button className="icon-btn" title="Opções da aba" onClick={() => openModal({ kind: "serviceSettings", serviceId: service.id })}>
          <Icon name="gear" />
        </button>
      </header>
      <ul className="ts-list">
        {servers.map((server) => (
          <li key={server.id} className="ts-server">
            <span className="service-tile" style={{ background: "#2580c3" }}>
              {initials(server.name)}
            </span>
            <span className="service-text">
              <strong>{server.name}</strong>
              <span>
                {server.address}
                {server.channel && ` · ${server.channel}`}
                {server.nickname && ` · como ${server.nickname}`}
              </span>
            </span>
            <button className="btn" onClick={() => window.distopic?.openTeamSpeak(teamspeakLink(server))}>
              Entrar
            </button>
            <button className="icon-btn" title="Remover" onClick={() => remove(server.id)}>
              <Icon name="trash" size={16} />
            </button>
          </li>
        ))}
      </ul>
      {adding ? (
        <form className="form ts-form" onSubmit={add}>
          <h3>Adicionar servidor</h3>
          <div className="grid-2">
            <Field label="Endereço" hint="Ex.: ts.meuclan.com ou 203.0.113.10:9987">
              <input value={draft.address} onChange={(e) => set({ address: e.target.value })} autoFocus />
            </Field>
            <Field label="Nome">
              <input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Opcional" />
            </Field>
            <Field label="Seu apelido">
              <input value={draft.nickname} onChange={(e) => set({ nickname: e.target.value })} />
            </Field>
            <Field label="Canal" hint="Opcional; entra direto nele">
              <input value={draft.channel} onChange={(e) => set({ channel: e.target.value })} />
            </Field>
          </div>
          <div className="form-actions start">
            <button className="btn" disabled={!draft.address.trim()}>
              Salvar servidor
            </button>
            {servers.length > 0 && (
              <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      ) : (
        <button className="btn btn-ghost" onClick={() => setAdding(true)}>
          Adicionar servidor
        </button>
      )}
      <p className="muted small">Precisa do TeamSpeak instalado. Funciona com TeamSpeak 3, 5 e 6.</p>
    </div>
  );
}
