// Browser services that can live in a tab next to Annoy servers. Shared by the
// main process (which hosts each one in its own sandboxed view and session) and
// the renderer (which lists, adds and removes them).

export type ServiceKind = "discord" | "whatsapp" | "telegram" | "element" | "slack" | "web" | "teamspeak";

export interface TeamSpeakServer {
  id: string;
  name: string;
  /** host or host:port */
  address: string;
  nickname: string;
  channel: string;
}

export interface Service {
  id: string;
  kind: ServiceKind;
  name: string;
  /** Start page; every kind but teamspeak has one. */
  url: string;
  teamspeak?: TeamSpeakServer[];
  /** Per-tab overrides of the defaults in Settings; unset follows the default. */
  placement?: TabPlacement;
  display?: TabDisplay;
  /** Kept with its login, just not shown in the tab bar. */
  hidden?: boolean;
}

/** Whether service tabs sit before or after the Annoy servers in the tab bar. */
export type TabPlacement = "before" | "after";
export type TabDisplay = "full" | "icon";

export interface CatalogEntry {
  kind: Exclude<ServiceKind, "web">;
  name: string;
  description: string;
  url: string;
  /** Two-letter tile and its colour in the tab bar. */
  tile: string;
  color: string;
}

export const CATALOG: readonly CatalogEntry[] = [
  { kind: "discord", name: "Discord", description: "Seus servidores e conversas do Discord, logado como no navegador.", url: "https://discord.com/app", tile: "DC", color: "#5865f2" },
  { kind: "teamspeak", name: "TeamSpeak", description: "Seus servidores do TeamSpeak, a um clique no app oficial.", url: "", tile: "TS", color: "#2580c3" },
  { kind: "whatsapp", name: "WhatsApp", description: "WhatsApp Web, pareado com o seu celular.", url: "https://web.whatsapp.com/", tile: "WA", color: "#25d366" },
  { kind: "telegram", name: "Telegram", description: "Telegram Web, com suas conversas e grupos.", url: "https://web.telegram.org/k/", tile: "TG", color: "#27a7e7" },
  { kind: "element", name: "Element", description: "Salas do Matrix pelo Element.", url: "https://app.element.io/", tile: "EL", color: "#0dbd8b" },
  { kind: "slack", name: "Slack", description: "Seus workspaces do Slack.", url: "https://app.slack.com/client", tile: "SL", color: "#611f69" },
];

/** Domains each kind may navigate within; anything else opens in the system browser. */
const SITES: Record<Exclude<ServiceKind, "web" | "teamspeak">, readonly string[]> = {
  discord: ["discord.com", "discordapp.com", "discord.gg", "discord.new", "discordapp.net", "discord.media"],
  whatsapp: ["whatsapp.com", "whatsapp.net"],
  telegram: ["telegram.org", "t.me"],
  element: ["element.io", "matrix.org"],
  slack: ["slack.com", "slack-edge.com", "slackb.com"],
};

/** Labels under which sites register names (example.com.br, example.co.uk). */
const SECOND_LEVEL = /^(com|net|org|gov|edu|co|ac)$/;

/** The registrable domain of a host, close enough for keeping navigation inside one site. */
export function siteOf(host: string): string {
  const labels = host.toLowerCase().split(".");
  const n = labels.length >= 3 && SECOND_LEVEL.test(labels[labels.length - 2]!) ? 3 : 2;
  return labels.slice(-n).join(".");
}

export function sitesFor(service: Pick<Service, "kind" | "url">): readonly string[] {
  if (service.kind === "teamspeak") return [];
  if (service.kind === "web") {
    try {
      return [siteOf(new URL(service.url).hostname)];
    } catch {
      return [];
    }
  }
  return SITES[service.kind];
}

export function catalogEntry(kind: ServiceKind): CatalogEntry | undefined {
  return CATALOG.find((c) => c.kind === kind);
}

/** ts3server:// link understood by the TeamSpeak 3, 5 and 6 clients. */
export function teamspeakLink(server: TeamSpeakServer): string {
  const [host, port] = server.address.trim().split(":");
  const params = new URLSearchParams();
  if (port) params.set("port", port);
  if (server.nickname.trim()) params.set("nickname", server.nickname.trim());
  if (server.channel.trim()) params.set("channel", server.channel.trim());
  const query = params.toString();
  return `ts3server://${host}${query ? `?${query}` : ""}`;
}
