import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { transformSync } from "rolldown/utils";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveDmLinks } from "../../src/renderer/src/features/integrations/dm-consent.ts";

// Render the real recipient invitation and integration dialog without a display.
const steam = { id: "steamprofiler", name: "SteamProfiler", scopes: ["dm"], runtime: { type: "http", endpoint: "https://steamprofiler.org/api/annoy" }, commands: [{ name: "steam" }] };
const h = { items: [], state: {}, cached: undefined, resolveDmLinks };
globalThis.__annoyConsentUI = h;
const stubs = new Map();
const stub = (path, source) => stubs.set(new URL(`../../src/renderer/src/${path}`, import.meta.url).href, source);
stub("client.ts", "export const navigate=()=>{};");
stub("store.ts", "export const toast=()=>{};");
stub("features/integrations/Setup.tsx", "export const IntegrationIcon=()=>null;");
stub("features/integrations/dm.ts", "export const answerDmIntegration=()=>{},removeDmIntegration=()=>{},requestDmIntegration=()=>{};");
stub("features/integrations/state.ts", "export const loadCatalog=async()=>{},useIntegrations=selector=>selector(globalThis.__annoyConsentUI.state);");
stub("features/integrations/dm-links.ts", "export const useDmLinks=()=>{const h=globalThis.__annoyConsentUI;return h.resolveDmLinks(h.cached,h.items);};");
stub("components/ui/button.tsx", `import {createElement} from 'react';export const Button=({children,loading,variant,size,...props})=>createElement('button',props,children);`);
stub("components/ui/dialog.tsx", `import {createElement} from 'react';
  export const Dialog=({children})=>createElement('div',null,children),DialogContent=Dialog,DialogTitle=Dialog;`);
const moduleURL = new URL("../../src/renderer/src/features/integrations/DmIntegrations.tsx", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const url = context.parentURL && specifier.startsWith(".") ? new URL(specifier, context.parentURL).href : null;
    return url && stubs.has(url) ? { url, shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) {
    if (stubs.has(url)) return { format: "module", source: stubs.get(url), shortCircuit: true };
    if (url === moduleURL) return { format: "module", shortCircuit: true, source: transformSync(new URL(url).pathname, readFileSync(new URL(url), "utf8"), { jsx: { runtime: "automatic" } }).code };
    return next(url, context);
  },
});
const { DmIntegrationRequests, DmIntegrationsDialog } = await import(moduleURL);
after(() => { hooks.deregister(); delete globalThis.__annoyConsentUI; });
beforeEach(() => {
  h.cached = undefined;
  h.items = [{ id: "001", senderId: "alice", integration: { id: steam.id, name: steam.name, op: "request" } }];
  h.state = { catalog: [], account: { connected: {}, dms: {} } };
});
const renderRequests = me => renderToStaticMarkup(createElement(DmIntegrationRequests, { conversationId: "dm", me, otherName: "Alice", ready: true }));

test("the recipient sees Accept and Decline even with no catalog, installation or separate account cache", () => {
  const html = renderRequests("bob");
  assert.match(html, /SteamProfiler/);
  assert.match(html, /<button[^>]*>Aceitar<\/button>/);
  assert.match(html, /<button[^>]*>Recusar<\/button>/);
  assert.doesNotMatch(html, /disabled/);
});

test("an inviter cannot accept their own invitation and accepted invitations disappear", () => {
  assert.equal(renderRequests("alice"), "");
  h.items.push({ id: "002", senderId: "bob", integration: { id: steam.id, name: steam.name, op: "accept" } });
  assert.equal(renderRequests("bob"), "");
});

test("the inviter can resend a pending invitation from the integration dialog", () => {
  h.state.catalog = [steam];
  const html = renderToStaticMarkup(createElement(DmIntegrationsDialog, { conversationId: "dm", me: "alice", otherName: "Bob", onClose() {} }));
  assert.match(html, /Reenviar convite/);
  assert.doesNotMatch(html, />Aceitar<\/button>/);
});
