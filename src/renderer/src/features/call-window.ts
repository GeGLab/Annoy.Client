import { t } from "../../../shared/localization/index.ts";
import { useSyncExternalStore } from "react";
import { getState, subscribe, toast } from "../store.ts";
import { bindVoiceShortcuts } from "../lib/voice-shortcuts.ts";

let child: Window | null = null;
let callKey: string | null = null;
const listeners = new Set<() => void>();
let dispose: (() => void) | null = null;
const publish = () => { for (const listener of listeners) listener(); };
const key = () => { const voice = getState().voice; return voice ? `${voice.accountId}:${voice.channelId}` : null; };

export function closeCallWindow(): void {
  const previous = child;
  child = null; callKey = null;
  dispose?.(); dispose = null;
  publish();
  if (previous && !previous.closed) previous.close();
}
export function focusCallWindow(): void { child?.focus(); }

export function openCallWindow(title: string): void {
  if (!key()) return;
  if (child && !child.closed) return child.focus();
  // Reuse the media namespace accepted by the running Electron window policy.
  let next: Window | null = null;
  try {
    next = window.open("about:blank", "annoy-stream:call", "width=1100,height=720");
    if (!next) throw new Error("Call window was blocked");
    const opened = next;
    const doc = opened.document;
    doc.title = title;
    const base = doc.createElement("base"); base.href = document.baseURI; doc.head.append(base);
    const copyTheme = () => {
      for (const attribute of [...doc.documentElement.attributes]) doc.documentElement.removeAttribute(attribute.name);
      for (const attribute of document.documentElement.attributes) doc.documentElement.setAttribute(attribute.name, attribute.value);
    };
    const copyStyles = () => {
      doc.head.querySelectorAll("style,link[rel=stylesheet]").forEach(node => node.remove());
      for (const node of document.head.querySelectorAll("style,link[rel=stylesheet]")) doc.head.append(node.cloneNode(true));
    };
    copyTheme(); copyStyles();
    doc.body.className = "call-window";
    const root = doc.createElement("div"); root.id = "call-window-root"; doc.body.append(root);
    const theme = new MutationObserver(copyTheme), styles = new MutationObserver(copyStyles);
    theme.observe(document.documentElement, { attributes: true });
    styles.observe(document.head, { childList: true, subtree: true, characterData: true });
    const closed = () => { if (child === opened) closeCallWindow(); };
    opened.addEventListener("pagehide", closed);
    const unbindKeys = bindVoiceShortcuts(opened);
    const timer = setInterval(() => { if (opened.closed) closed(); }, 500);
    dispose = () => { unbindKeys(); theme.disconnect(); styles.disconnect(); clearInterval(timer); opened.removeEventListener("pagehide", closed); };
    child = opened; callKey = key(); publish();
  } catch (error) {
    if (child === next) closeCallWindow();
    else if (next && !next.closed) next.close();
    console.warn("Could not open call window", error);
    toast(t("voice.callWindowError"));
  }
}

subscribe(() => { if (child && callKey !== key()) closeCallWindow(); });
window.addEventListener("beforeunload", closeCallWindow);
export function useCallWindow(): Window | null {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => child);
}
