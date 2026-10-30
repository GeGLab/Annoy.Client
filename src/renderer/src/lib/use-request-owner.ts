import { useEffect, useMemo } from "react";

/** Cancel owned work when this UI scope disappears or changes identity. */
export function useRequestOwner(identity = "component"): { readonly signal: AbortSignal } {
  const owner = useMemo(() => ({ controller: new AbortController(), get signal() { return this.controller.signal; } }), [identity]);
  useEffect(() => {
    // StrictMode replays effect setup/cleanup without rendering again.
    if (owner.signal.aborted) owner.controller = new AbortController();
    return () => owner.controller.abort();
  }, [owner]);
  return owner;
}
