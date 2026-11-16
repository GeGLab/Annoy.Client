import { useEffect, useRef, useSyncExternalStore } from "react";

type Attach = (files: File[]) => void;
const targets: { current: Attach }[] = [];
const listeners = new Set<() => void>();
const changed = () => { for (const listener of listeners) listener(); };

/**
 * The composer on screen accepts files from elsewhere in the app (the image
 * viewer attaches an edited picture to it). The most recently mounted one wins.
 */
export function useComposerAttach(attach: Attach | null) {
  const latest = useRef(attach);
  latest.current = attach;
  const enabled = !!attach;
  useEffect(() => {
    if (!enabled) return;
    const target = { current: (files: File[]) => latest.current?.(files) };
    targets.push(target);
    changed();
    return () => {
      targets.splice(targets.indexOf(target), 1);
      changed();
    };
  }, [enabled]);
}

const snapshot = () => targets.at(-1)?.current ?? null;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };
/** Attaches to the current composer, or null when none can take files. */
export const useAttachTarget = () => useSyncExternalStore(subscribe, snapshot);
