import type { Draft } from "immer";
import { getState, setState } from "../store.ts";
import type { CloudGateway } from "./gateway.ts";
import type { SocialState } from "./types.ts";

/** Shared runtime of the social layer: who is signed in, this device, the live connection. */
export const runtime = {
  me: null as string | null,
  gateway: null as CloudGateway | null,
  generation: 0,
};

export function setSocial(recipe: (social: Draft<SocialState>) => void): void {
  setState((s) => {
    recipe(s.social);
  });
}

export const social = () => getState().social;

/**
 * This device's ID for chatannoy's delivery queue: stable across restarts, so
 * messages wait for it. Random, nothing derived from the machine (TODO item 2.4
 * will replace it with the client ID).
 */
export function cloudDevice(): string {
  const KEY = "annoy.cloudDevice";
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && /^[A-Za-z0-9_-]{22,64}$/.test(saved)) return saved;
  } catch {
    /* fall through */
  }
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const id = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* in-memory for this run */
  }
  return id;
}

export const displayName = (p: { displayName: string | null; username: string } | undefined | null) => p?.displayName || p?.username || "";
