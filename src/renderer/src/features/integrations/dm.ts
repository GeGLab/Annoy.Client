import { findTrigger, imageKind, INTEGRATION_LIMITS, IntegrationError, isCallable, runIntegration, type IntegrationFile, type IntegrationHistoryItem, type IntegrationSignature, type StoreIntegration } from "@annoy/protocol";
import { cloud } from "../../social/cloud.ts";
import { localizationPreferences, t as translate } from "../../../../shared/localization/index.ts";
import { loadThread, openAttachment, sendDm, setDmMessageHook } from "../../social/dms.ts";
import { displayName, runtime, social } from "../../social/runtime.ts";
import type { DmIntegrationMeta, DmMessage } from "../../social/types.ts";
import { toast } from "../../store.ts";
import { iconOf, integrationById, integrations, loadCatalog, updateAccount, type DmLink } from "./state.ts";
import { integrationHttp } from "./transport.ts";

/**
 * Store integrations in DMs. Whoever connected an integration adds it to a
 * conversation; the other person must accept. From then on either of them
 * calls it with "/command" or "@Name", and the app of whoever added it makes
 * the call, with that person's API key, and sends the answer as a message
 * marked as the integration's. Nothing runs while that person is offline.
 */

/** History sent along when the integration reads history and sets no size of its own. */
const DEFAULT_HISTORY = 20;

const nameOf = (userId: string): string => {
  const s = social();
  const nickname = s.relationships.find((r) => r.user.id === userId)?.nickname;
  return nickname || displayName(userId === s.me?.id ? s.me : s.profiles[userId]) || translate("social.unknownUser");
};
/** The name a person shows to the other side: never the nickname the reader gave them. */
const ownName = (userId: string): string => displayName(userId === social().me?.id ? social().me : social().profiles[userId]) || translate("social.unknownUser");

export const dmLinks = (conversationId: string): Record<string, DmLink> => integrations().account.dms[conversationId] ?? {};

/** The sentence of a request/accept/decline/remove line. Also the text older apps show for it. */
export function controlText(meta: DmIntegrationMeta, senderId: string): string {
  const key = meta.op === "request" ? "integrations.requestText" : meta.op === "accept" ? "integrations.accepted" : meta.op === "decline" ? "integrations.declined" : "integrations.removed";
  return translate(key, { p0: nameOf(senderId), p1: meta.name });
}

function control(conversationId: string, op: "request" | "accept" | "decline" | "remove", id: string, name: string): Promise<void> {
  const me = runtime.me;
  if (!me) return Promise.resolve();
  const meta: DmIntegrationMeta = { op, id, name };
  // The text travels too, in the sender's words, for apps that don't know integrations.
  return sendDm(conversationId, translate(op === "request" ? "integrations.requestText" : op === "accept" ? "integrations.accepted" : op === "decline" ? "integrations.declined" : "integrations.removed", { p0: ownName(me), p1: name }), [], null, { integration: meta });
}

export function requestDmIntegration(conversationId: string, integration: StoreIntegration): Promise<void> {
  return control(conversationId, "request", integration.id, integration.name);
}
export function answerDmIntegration(conversationId: string, id: string, name: string, accept: boolean): Promise<void> {
  return control(conversationId, accept ? "accept" : "decline", id, name);
}
export function removeDmIntegration(conversationId: string, id: string, name: string): Promise<void> {
  return control(conversationId, "remove", id, name);
}

/** A request/accept/decline/remove message moves the link of that integration in that conversation. */
function applyControl(message: DmMessage, meta: Exclude<DmIntegrationMeta, { op: "reply" }>): void {
  const me = runtime.me;
  if (!me) return;
  const { conversationId, senderId } = message;
  void updateAccount((account) => {
    const links = (account.dms[conversationId] ??= {});
    const link = links[meta.id];
    if (meta.op === "request") {
      // An active link stays with whoever added it; a new request never takes it over.
      if (!link || link.status === "pending") links[meta.id] = { owner: senderId, status: "pending" };
    } else if (meta.op === "accept") {
      if (link?.status === "pending" && link.owner !== senderId) link.status = "active";
    } else if (meta.op === "decline") {
      if (link?.status === "pending" && link.owner !== senderId) delete links[meta.id];
    } else delete links[meta.id];
  }).catch(() => undefined);
}

const ERROR_KEYS = {
  key_missing: "integrations.error.keyMissing",
  settings_missing: "integrations.error.settingsMissing",
  unsupported: "integrations.error.unsupported",
  unreachable: "integrations.error.unreachable",
  bad_response: "integrations.error.badResponse",
  remote_error: "integrations.error.remote",
  empty: "integrations.error.empty",
} as const;
export const integrationErrorText = (error: IntegrationError): string => error.detail ?? translate(ERROR_KEYS[error.code]);

async function replyClientId(messageId: string, integrationId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`annoy-integration-reply|${messageId}|${integrationId}`));
  return [...new Uint8Array(digest).subarray(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const running = new Set<string>();

async function answer(message: DmMessage, local: boolean): Promise<void> {
  const me = runtime.me;
  if (!me) return;
  const state = integrations();
  const mine = Object.entries(dmLinks(message.conversationId)).flatMap(([id, link]) => {
    const integration = link.status === "active" && link.owner === me && state.account.connected[id] ? integrationById(id) : undefined;
    return integration && isCallable(integration, "dm") ? [integration] : [];
  });
  const trigger = findTrigger(message.content, mine);
  if (!trigger) {
    if (local) {
      const pending = Object.entries(dmLinks(message.conversationId)).flatMap(([id, link]) => {
        const integration = link.status === "pending" ? integrationById(id) : undefined;
        return integration && isCallable(integration, "dm") ? [integration] : [];
      });
      const pendingTrigger = findTrigger(message.content, pending);
      if (pendingTrigger) {
        const other = social().dms.find((d) => d.id === message.conversationId)?.recipientId;
        const link = dmLinks(message.conversationId)[pendingTrigger.integration.id]!;
        // Only the sender's app shows this notice; pending calls never leave the conversation.
        toast(translate(link.owner === me ? "integrations.pending" : "integrations.requestText", link.owner === me
          ? { p0: other ? nameOf(other) : translate("social.unknownUser") }
          : { p0: nameOf(link.owner), p1: pendingTrigger.integration.name }));
      }
    }
    return;
  }
  const { integration } = trigger;
  const clientId = await replyClientId(message.id, integration.id);
  if (running.has(clientId)) return;
  running.add(clientId);
  try {
    // Another install of this account may be online too: give it a moment, then answer only if it did not.
    if (!local) await new Promise((resolve) => setTimeout(resolve, 300 + Math.random() * 1200));
    await loadThread(message.conversationId);
    const items = social().threads[message.conversationId]?.items ?? [];
    if (runtime.me !== me || items.some((m) => m.clientId === clientId)) return;
    const connected = integrations().account.connected[integration.id];
    if (!connected) return;
    const count = integration.access.history ? Math.min(INTEGRATION_LIMITS.history, typeof connected.settings.history === "number" ? connected.settings.history : DEFAULT_HISTORY) : 0;
    const history: IntegrationHistoryItem[] = count
      ? items
          .filter((m) => m.id < message.id && !m.state && m.content && (!m.integration || m.integration.op === "reply"))
          .slice(-count)
          .map((m) => ({ author: m.integration ? m.integration.name : ownName(m.senderId), text: m.content, at: m.createdAt, ...(m.integration?.id === integration.id && { self: true }) }))
      : [];
    const attachments: IntegrationFile[] = [];
    if (integration.access.attachments) {
      for (const a of message.attachments.filter((f) => f.size <= INTEGRATION_LIMITS.attachmentBytes).slice(0, INTEGRATION_LIMITS.attachments)) {
        const data = await openAttachment(a).then(async (blob) => new Uint8Array(await blob.arrayBuffer()), () => null);
        if (data && imageKind(data)) attachments.push({ name: a.name, type: imageKind(data)!.type, data });
      }
    }
    const meta: DmIntegrationMeta = { op: "reply", id: integration.id, name: integration.name, icon: iconOf(integration) };
    let text: string, files: File[] = [];
    try {
      const output = await runIntegration(integrationHttp, {
        trigger, scope: "dm", locale: localizationPreferences().language, invoker: ownName(message.senderId), history, attachments, settings: connected.settings, apiKey: connected.key,
        // devannoy signs the body hash so the developer knows the call comes from Annoy; it never sees the content.
        sign: (integration, bodySha256) => cloud<IntegrationSignature>("dev", "/v1/calls/sign", { body: { integration, scope: "dm", bodySha256 } }),
        report: (integration, ok) => void cloud("dev", "/v1/calls/result", { body: { integration, scope: "dm", ok } }).catch(() => undefined),
      });
      text = output.text;
      files = output.images.map((image) => new File([image.data as BlobPart], image.name, { type: image.type }));
    } catch (err) {
      text = integrationErrorText(err instanceof IntegrationError ? err : new IntegrationError("bad_response"));
    }
    if (runtime.me !== me) return;
    // The link may have been removed while the call ran.
    const link = dmLinks(message.conversationId)[integration.id];
    if (link?.status !== "active" || link.owner !== me) return;
    await sendDm(message.conversationId, text, files, message.id, { clientId, integration: meta });
  } finally {
    running.delete(clientId);
  }
}

function onMessage(message: DmMessage, live: boolean, local: boolean): void {
  const meta = message.integration;
  if (meta && meta.op !== "reply") return applyControl(message, meta);
  // An answer of an integration never calls another; old messages (read while this app was closed) call nothing.
  if (meta || !live || !message.content) return;
  // A message this account sent from another install is answered by that install.
  if (!local && message.senderId === runtime.me) return;
  if (!message.content.startsWith("/") && !message.content.includes("@")) return;
  void loadCatalog().then(() => answer(message, local)).catch((error) => console.warn("integration call failed", (error as Error).message));
}

export function initDmIntegrations(): void {
  setDmMessageHook(onMessage);
}
