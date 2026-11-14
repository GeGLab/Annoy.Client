import { useEffect, useMemo, useReducer } from "react";

/** Cancel owned work when this UI scope disappears or changes identity. */
export function useRequestOwner(identity = "component"): { readonly signal: AbortSignal } {
  const [, render] = useReducer((revision: number) => revision + 1, 0);
  const owner = useMemo(() => ({ controller: new AbortController(), closing: false, get signal() { return this.controller.signal; } }), [identity]);
  useEffect(() => {
    owner.closing = false;
    // Defensive: a signal aborted by an earlier unmount is replaced, and consumers
    // that captured it during render get a fresh one on the next render.
    if (owner.signal.aborted) {
      owner.controller = new AbortController();
      render();
    }
    // The abort waits a microtask: StrictMode replays cleanup and setup back to
    // back without rendering, and the effects that captured `signal` at render
    // (a page loading its data on mount) run only once with it. Aborting there
    // would cancel that first load for good and leave the page on "Loading…".
    // A real unmount or identity change has no setup in between, so it aborts.
    return () => {
      owner.closing = true;
      queueMicrotask(() => { if (owner.closing) owner.controller.abort(); });
    };
  }, [owner]);
  return owner;
}
