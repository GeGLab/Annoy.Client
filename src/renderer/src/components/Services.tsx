import {rich} from "../lib/localization.ts";
import {t as translate} from "../../../shared/localization/index.ts";
import { ServiceLogo } from "./ServiceLogo.tsx";
import { useState, type FormEvent, type ReactNode } from "react";
import { CATALOG, catalogEntry, teamspeakLink, type CatalogEntry, type Service, type TabDisplay, type TabPlacement, type TeamSpeakServer } from "../../../shared/services.ts";
import { addService, navigate, openServer, removeService, setServiceHidden, updateService } from "../client.ts";
import { initials } from "../format.tsx";
import { getState, useStore, type Settings } from "../store.ts";
import { closeModal, Field, Icon, Modal, openModal } from "./ui.tsx";
import { EntryContextMenu, type MenuEntry } from "./ui/entry-menu.tsx";

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

function confirmRemoveService(service: Service): void {
  const what = service.kind === "teamspeak" ? translate("common.c1b93ab8707a") : translate("common.1ff423405b53");
  if (confirm(translate("common.89627d35a828",{p0:(service.name),p1:(what)}))) void removeService(service.id);
}

/** Right-click options for a service tab; the full settings stay in the modal. */
function ServiceTabMenu({ service, children }: { service: Service; children: ReactNode }) {
  const defaults = useStore((s) => s.settings);
  const entries: MenuEntry[] = [
    { kind: "label", text: service.name },
    ...(service.kind !== "teamspeak" ? [{ kind: "item", id: "reload", icon: "refresh", text: translate("common.9b6bb68d29b1"), run: () => window.annoy?.services.reload(service.id) } as const] : []),
    { kind: "item", id: "hide", icon: "eyeOff", text: translate("common.dd680772877e"), run: () => setServiceHidden(service.id, true) },
    { kind: "separator" },
    { kind: "label", text: translate("common.c777cba8ebf0") },
    { kind: "radio", id: "placement", value: service.placement ?? "", run: (value) => updateService(service.id, (sv) => void (sv.placement = (value || undefined) as TabPlacement | undefined)), options: [
      { value: "", text: translate("common.c10b1cc04814", { p0: defaults.servicePlacement === "before" ? "antes" : "depois" }) },
      { value: "before", text: translate("common.3b856d7cd0b4") },
      { value: "after", text: translate("common.d0e145bc660d") },
    ] },
    { kind: "separator" },
    { kind: "label", text: translate("common.0b4cf0d2ea73") },
    { kind: "radio", id: "display", value: service.display ?? "", run: (value) => updateService(service.id, (sv) => void (sv.display = (value || undefined) as TabDisplay | undefined)), options: [
      { value: "", text: translate("common.bcd11cd1c70f", { p0: defaults.serviceDisplay === "full" ? translate("common.c99567ffa8ae") : translate("common.6edd17148430") }) },
      { value: "full", text: translate("common.593c128aa54e") },
      { value: "icon", text: translate("common.e0520b5efa74") },
    ] },
    { kind: "separator" },
    { kind: "item", id: "settings", icon: "gear", text: translate("common.76b0fb6ad189"), run: () => openModal({ kind: "serviceSettings", serviceId: service.id }) },
    { kind: "separator" },
    { kind: "item", id: "remove", icon: "trash", destructive: true, text: translate("common.ba25e7dd2cb3"), run: () => confirmRemoveService(service) },
  ];
  return <EntryContextMenu label={translate("common.63801f844138")} entries={entries}>{children}</EntryContextMenu>;
}

export function ServiceTab({ service }: { service: Service }) {
  const iconOnly = useStore((s) => tabLayout(service, s.settings).display === "icon");
  const active = useStore((s) => s.view.kind === "service" && s.view.serviceId === service.id);
  const badge = useStore((s) => s.serviceBadges[service.id]);
  const tile = tileOf(service);
  return (
    <ServiceTabMenu service={service}>
    <button
      className={`tab-item service${active ? " active" : ""}${iconOnly ? " icon-only" : ""}`}
      onClick={() => navigate({ kind: "service", serviceId: service.id })}
      title={translate("common.2319674a134e",{p0:(service.name)})}
      aria-label={service.name}
      aria-current={active ? "page" : undefined}
    >
      <span className="tab-tile" style={tile.color ? { background: tile.color, color: "#fff" } : undefined}>
        {service.kind === "web" ? tile.text : <ServiceLogo kind={service.kind} />}
      </span>
      {!iconOnly && <span className="rail-label">{service.name}</span>}
      {badge && <span className="tab-badge">{badge}</span>}
    </button>
    </ServiceTabMenu>
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
              {service.kind === "web" ? tile.text : <ServiceLogo kind={service.kind} />}
            </span>
            <span className="truncate">{service.name}</span>
            <button className="btn btn-ghost btn-small" onClick={() => setServiceHidden(service.id, false)}>{translate("common.5c492f37a63f")}</button>
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
        <ServiceLogo kind={entry.kind} />
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
  const instances = useStore((s) => s.instances);
  const hasHidden = useStore((s) => s.services.some((sv) => sv.hidden));
  const [section, setSection] = useState<"communities" | "services">("communities");
  const [showAllServices, setShowAllServices] = useState(false);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addWeb = (e: FormEvent) => {
    e.preventDefault();
    let parsed: URL;
    try {
      parsed = new URL(/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
    } catch {
      return setError(translate("common.1f25fa406b37"));
    }
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) return setError(translate("common.3fe4765a3520"));
    if (parsed.toString().length > 2048) return setError(translate("common.49795e4ecc31"));
    addService({ id: newId(), kind: "web", name: freeName(name.trim() || parsed.hostname.replace(/^www\./, "")), url: parsed.toString() });
  };

  return (
    <Modal title={translate("common.32db25cd960a")} wide>
      <div className="new-tab-sections" role="tablist" aria-label={translate("common.2344d2bf6770")}>
        <button role="tab" aria-selected={section === "communities"} className={section === "communities" ? "active" : ""} onClick={() => setSection("communities")}>{translate("common.4e423b4b37b2")}</button>
        <button role="tab" aria-selected={section === "services"} className={section === "services" ? "active" : ""} onClick={() => setSection("services")}>{translate("common.190e8905eecf")}</button>
      </div>
      {section === "communities" ? <section className="new-tab-community" aria-labelledby="new-tab-community-title">
        <header className="new-tab-heading"><div><h3 id="new-tab-community-title">{translate("common.1471b88bbb29")}</h3><p className="muted small">{translate("common.e4d95e6a6c60")}</p></div>
          <button className="btn" onClick={() => openModal({ kind: "addAccount" })}>{rich("common.6a7a1e274c57",{p0:(<Icon name="plus" size={16} />)})}</button>
        </header>
        {accounts.length > 0 && <ul className="new-tab-communities">
          {accounts.flatMap((account) => (instances[account.id]?.servers ?? []).slice(0, 5).map((server) => ({ account, server }))).slice(0, 10).map(({ account, server }) => (
            <li key={JSON.stringify([account.id, server.id])}><button className="new-tab-community-row" onClick={() => { closeModal(); void openServer(account.id, server.id); }}>
              <span className="server-directory-avatar">{server.iconUrl ? <img src={server.iconUrl} alt="" /> : initials(server.name)}</span>
              <span><strong>{server.name}</strong><small>{account.instanceName}</small></span><Icon name="right" size={16} />
            </button></li>
          ))}
        </ul>}
        {accounts.length > 0 && !accounts.some((account) => (instances[account.id]?.servers.length ?? 0) > 0) && <p className="new-tab-empty muted">{translate("common.d5d79036f49e")}</p>}
        {accounts.length > 0 && <div className="new-tab-secondary-actions">
          <button className="btn btn-ghost" onClick={() => openModal({ kind: "createServer", accountId: accounts.length === 1 ? accounts[0]!.id : undefined, initialMode: "create" })}>{rich("common.7adc4d5c84ef",{p0:(<Icon name="plus" size={16} />)})}</button>
          <button className="btn btn-ghost" onClick={() => openModal({ kind: "createServer", accountId: accounts.length === 1 ? accounts[0]!.id : undefined, initialMode: "join" })}>{rich("common.f42a4b3fc431",{p0:(<Icon name="userPlus" size={16} />)})}</button>
          <button className="btn btn-ghost" onClick={() => { closeModal(); navigate({ kind: "servers" }); }}>{translate("common.ecafc312dae5")}</button>
        </div>}
      </section> : <section className="new-tab-services" aria-labelledby="new-tab-services-title">
        <header className="new-tab-heading"><div><h3 id="new-tab-services-title">{translate("common.8bd0583e0c80")}</h3><p className="muted small">{translate("common.1f45c1a1f215")}</p></div></header>
        <div className="service-grid">
          {(showAllServices ? CATALOG : CATALOG.slice(0, 3)).map((entry) => <ServiceCard key={entry.kind} entry={entry} />)}
        </div>
        {!showAllServices && <button className="btn btn-ghost" onClick={() => setShowAllServices(true)}>{rich("common.61f648128a8d",{p0:(CATALOG.length)})}</button>}
        {showAllServices && <form className="form" onSubmit={addWeb}>
          <h3>{translate("common.4d205f284975")}</h3>
          <div className="grid-2">
            <Field label={translate("common.ef5e7e12bdac")}><input type="url" value={url} onChange={(e) => (setUrl(e.target.value), setError(null))} placeholder={translate("common.8981a9c74d0e")} maxLength={2048} /></Field>
            <Field label={translate("common.bfc80a4b622e")}><input value={name} onChange={(e) => setName(e.target.value)} placeholder={translate("common.a6e63474985f")} maxLength={100} /></Field>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="form-actions"><button className="btn btn-ghost" disabled={!url.trim()}>{translate("common.d0ff85892124")}</button></div>
        </form>}
      </section>}
      {hasHidden && <section className="new-tab-hidden"><h3>{translate("common.11ca2dace005")}</h3><HiddenServices /></section>}
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
  const remove = () => confirmRemoveService(service);
  return (
    <Modal title={service.name}>
      <form className="form" onSubmit={save}>
        <Field label={translate("common.bfc80a4b622e")}>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        {service.kind !== "teamspeak" && <p className="muted small">{service.url}</p>}
        <div className="grid-2">
          <Field label={translate("common.c777cba8ebf0")}>
            <select value={placement} onChange={(e) => setPlacement(e.target.value as TabPlacement | "")}>
              <option value="">{rich("common.c10b1cc04814",{p0:(defaults.servicePlacement === "before" ? "antes" : "depois")})}</option>
              <option value="before">{translate("common.3b856d7cd0b4")}</option>
              <option value="after">{translate("common.d0e145bc660d")}</option>
            </select>
          </Field>
          <Field label={translate("common.0b4cf0d2ea73")}>
            <select value={display} onChange={(e) => setDisplay(e.target.value as TabDisplay | "")}>
              <option value="">{rich("common.bcd11cd1c70f",{p0:(defaults.serviceDisplay === "full" ? translate("common.c99567ffa8ae") : translate("common.6edd17148430"))})}</option>
              <option value="full">{translate("common.593c128aa54e")}</option>
              <option value="icon">{translate("common.e0520b5efa74")}</option>
            </select>
          </Field>
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={hide} title={translate("common.fcdc546da7fe")}>{translate("common.dd680772877e")}</button>
          {service.kind !== "teamspeak" && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                window.annoy?.services.reload(service.id);
                closeModal();
              }}
            >{translate("common.9b6bb68d29b1")}</button>
          )}
          <button type="button" className="btn btn-danger" onClick={remove}>{translate("common.ba25e7dd2cb3")}</button>
          <button className="btn">{translate("common.aef7cd5b2081")}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Placeholder under the native view while a browser service loads. */
export function ServicePlaceholder({ service }: { service: Service }) {
  return (
    <div className="service-placeholder">
      <p>{rich("common.05d424e2d7f4",{p0:(service.name)})}</p>
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
          <p className="muted">{translate("common.4d9b55d71c0c")}</p>
        </div>
        <button className="icon-btn" title={translate("common.63801f844138")} onClick={() => openModal({ kind: "serviceSettings", serviceId: service.id })}>
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
                {server.nickname && translate("common.884db61cf183",{p0:(server.nickname)})}
              </span>
            </span>
            <button className="btn" onClick={() => window.annoy?.openTeamSpeak(teamspeakLink(server))}>{translate("common.4105811890ae")}</button>
            <button className="icon-btn" title={translate("settings.a3037dc71a43")} onClick={() => remove(server.id)}>
              <Icon name="trash" size={16} />
            </button>
          </li>
        ))}
      </ul>
      {adding ? (
        <form className="form ts-form" onSubmit={add}>
          <h3>{translate("common.dd3be401fe8f")}</h3>
          <div className="grid-2">
            <Field label={translate("common.ef5e7e12bdac")} hint={translate("common.69d5d9c150a5")}>
              <input value={draft.address} onChange={(e) => set({ address: e.target.value })} autoFocus />
            </Field>
            <Field label={translate("common.5086900635fe")}>
              <input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder={translate("common.a6e63474985f")} />
            </Field>
            <Field label={translate("common.6b15645ca9f2")}>
              <input value={draft.nickname} onChange={(e) => set({ nickname: e.target.value })} />
            </Field>
            <Field label={translate("common.0119803da011")} hint={translate("common.cf5350e93f1c")}>
              <input value={draft.channel} onChange={(e) => set({ channel: e.target.value })} />
            </Field>
          </div>
          <div className="form-actions start">
            <button className="btn" disabled={!draft.address.trim()}>{translate("common.c51dc7a61d58")}</button>
            {servers.length > 0 && (
              <button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>{translate("common.bb9dbb406dcb")}</button>
            )}
          </div>
        </form>
      ) : (
        <button className="btn btn-ghost" onClick={() => setAdding(true)}>{translate("common.dd3be401fe8f")}</button>
      )}
      <p className="muted small">{translate("common.dd635793d0db")}</p>
    </div>
  );
}




