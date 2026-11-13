import { useEffect, useMemo, useReducer } from "react";

/** Cancel owned work when this UI scope disappears or changes identity. */
export function useRequestOwner(identity = "component"): { readonly signal: AbortSignal } {
  const [, render] = useReducer((revision: number) => revision + 1, 0);
  const owner = useMemo(() => ({ controller: new AbortController(), get signal() { return this.controller.signal; } }), [identity]);
  useEffect(() => {
    // StrictMode replays effect setup/cleanup without rendering again.
    if (owner.signal.aborted) {
      owner.controller = new AbortController();
      // Consumers may capture the signal during render. Refresh those handlers
      // after StrictMode's cleanup so they do not retain the aborted signal.
      render();
    }
    return () => owner.controller.abort();
  }, [owner]);
  return owner;
}
