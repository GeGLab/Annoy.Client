import { t as translate } from "../../../../shared/localization/index.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import type { MediaPage } from "./types.ts";

/** One request per list; generation checks also cover non-cancellable IDB reads. */
export function useMediaPages<T>(load: (after: string | null, signal: AbortSignal) => Promise<MediaPage<T>>) {
  const [items, setItems] = useState<T[]>([]), [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null), cursor = useRef<string | null>(null), initialized = useRef(false);
  const run = useCallback(async (reset = false) => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setLoading(true); setError(null);
    try {
      const page = await load(reset ? null : cursor.current, controller.signal);
      if (controller.signal.aborted) return;
      setItems((items) => reset ? page.items : [...items, ...page.items]);
      cursor.current = page.next; setNext(page.next); initialized.current = true;
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : translate("expression.catalog.3e5d1e930758")); }
    finally { if (active.current === controller) { active.current = null; setLoading(false); } }
  }, [load]);
  useEffect(() => {
    active.current?.abort(); active.current = null; cursor.current = null; initialized.current = false;
    setItems([]); setNext(null); void run(true);
    return () => { active.current?.abort(); active.current = null; };
  }, [run]);
  return { items, next, loading, error, more: () => void run(!initialized.current) };
}
export function PageEnd({ page, empty, end }: { page: { items: unknown[]; next: string | null; loading: boolean; error: string | null; more: () => void }; empty: string; end: string }) {
  const target = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!page.next || page.loading || page.error || !target.current) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting) page.more(); });
    observer.observe(target.current);
    return () => observer.disconnect();
  }, [page.next, page.loading, page.error, page.more]);
  return <div className="expression-page-end" ref={target}>
    {page.loading && <div role="status" aria-label={translate("expression.catalog.b6422bb7d048")}><div className="expression-skeleton" aria-hidden="true" /><span>{translate("common.6cc1bbba0f84")}</span></div>}
    {page.error ? <><p className="expression-error" role="alert">{page.error}</p><Button variant="secondary" size="sm" onClick={page.more}>{translate("common.b9e10688be01")}</Button></>
      : !page.loading && (page.next ? <Button variant="secondary" size="sm" onClick={page.more}>{translate("expression.catalog.96158857b24c")}</Button> : <p className="muted small" role="status">{page.items.length ? end : empty}</p>)}
  </div>;
}
