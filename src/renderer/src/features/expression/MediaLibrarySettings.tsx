import { t as translate } from "../../../../shared/localization/index.ts";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Download, Trash2, Upload, ImagePlus } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { Icon } from "../../components/ui.tsx";
import { setState, toast } from "../../store.ts";
import { requestNavigation } from "../../lib/navigation-guard.ts";
import { confirmAction } from "../../components/ui/action-dialog.tsx";
import { exportPack, installPack, parsePack, readPack, readPackPage, removePack, savePack, type PackMetadata } from "./library.ts";
import { PackCredits } from "./PackCredits.tsx";
import { PageEnd, useMediaPages } from "./paging.tsx";
import { hasMediaPicker, openMediaPicker, subscribeMediaPicker } from "./navigation.ts";

export function MediaLibrarySettings() {
  const canUse = useSyncExternalStore(subscribeMediaPicker, hasMediaPicker);
  const [revision, setRevision] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const input = useRef<HTMLInputElement>(null), manifest = useRef<HTMLInputElement>(null);
  const operation = useRef<AbortController | null>(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); }; }, []);
  const load = useCallback((after: string | null) => readPackPage({ after }), [revision]);
  const packs = useMediaPages(load);
  const perform = async (action: (signal: AbortSignal) => Promise<unknown>) => {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setError(null); setProgress(null);
    try {
      await action(controller.signal);
      if (mounted.current) { setRevision((value) => value + 1); toast(translate("expression.catalog.33a394820fe5")); }
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setError(error instanceof Error ? error.message : translate("expression.catalog.839de709c336"));
    } finally {
      if (operation.current === controller) operation.current = null;
      if (mounted.current) { setBusy(false); setProgress(null); }
    }
  };
  const usePack = (pack: Pick<PackMetadata, "kinds">) => {
    if (!canUse) return;
    requestNavigation(() => {
      setState((s) => { s.modal = null; });
      requestAnimationFrame(() => requestAnimationFrame(() => openMediaPicker(pack.kinds.includes("sticker") ? "sticker" : pack.kinds.includes("gif") ? "gif" : "emoji")));
    });
  };
  const importFiles = async (files: File[], signal: AbortSignal) => {
    if (files.length > 60) throw new Error(translate("expression.ba7125c0739e"));
    const current = await readPack("my-media");
    const items = [...(current?.items ?? [])];
    for (const file of files) {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 8 * 1024 * 1024) throw new Error(translate("expression.catalog.afe2acdb3bf9"));
      items.push({ id: crypto.randomUUID(), name: file.name.slice(0, 80), kind: file.type === "image/gif" ? "gif" as const : "sticker" as const, blob: file });
    }
    if (items.length > 60) throw new Error(translate("expression.catalog.142416ad36f7"));
    if (items.reduce((sum, item) => sum + (item.blob?.size ?? 0), 0) > 50 * 1024 * 1024) throw new Error(translate("expression.96198a4fa625"));
    signal.throwIfAborted();
    await savePack({ id: "my-media", name: translate("expression.d35e38529430"), author: translate("expression.b21e91730d18"), license: translate("expression.catalog.c10c5f263014"), source: "local", items }, signal);
  };
  const exportInstalled = async (metadata: PackMetadata) => {
    const pack = await readPack(metadata.id);
    if (!pack) throw new Error(translate("expression.catalog.c0e8c2193a0d"));
    const blob = await exportPack(pack), url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `${pack.name}.annoy-pack.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="settings-section media-library-settings">
    <h3><Icon name="image" size={24} /> {translate("expression.728001e6a865")}</h3>
    <p className="muted">{translate("expression.library.intro")}</p>
    {!canUse && <p className="muted small">{translate("expression.catalog.ea86569fb632")}</p>}
    {busy && <div className="expression-install-progress" role="status">
      <span>{progress ? translate("expression.catalog.installProgress", { p0: progress.done, p1: progress.total }) : translate("expression.catalog.63a58a19afba")}</span>
      {progress && <progress value={progress.done} max={progress.total} aria-label={translate("expression.catalog.84fb8a365775")} />}
      <Button variant="ghost" size="sm" onClick={() => operation.current?.abort()}>{translate("common.bb9dbb406dcb")}</Button>
    </div>}
    {error && <p className="expression-error" role="alert">{error}</p>}
    <div className="expression-import-actions">
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => input.current?.click()}><ImagePlus size={15} />{translate("expression.c8630e10d977")}</Button>
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => manifest.current?.click()}><Upload size={15} />{translate("expression.99e439de4649")}</Button>
    </div>
    <section className="expression-installed" aria-label={translate("expression.8a8b5ccdce78")}><h4>{translate("expression.8a8b5ccdce78")}</h4>
      {packs.items.map((pack) => <div key={pack.id}>
        <span><strong>{pack.name}</strong><small>{translate("expression.catalog.summary", { count: pack.itemCount, p0: pack.author })} · {pack.license}</small><PackCredits pack={pack} /></span>
        <Button variant="secondary" size="sm" disabled={busy || !canUse} title={canUse ? translate("expression.catalog.5da341f3979a") : translate("expression.catalog.c5d6c44409a9")} onClick={() => usePack(pack)} aria-label={translate("expression.b4d5dd78d97a", {p0: (pack.name)})}>{translate("expression.820eaa6af764")}</Button>
        <button className="icon-btn tiny" aria-label={translate("expression.6fe9ceb2e844", {p0: (pack.name)})} disabled={busy} onClick={() => void perform(() => exportInstalled(pack))}><Download size={15} /></button>
        <button className="icon-btn tiny danger" aria-label={translate("expression.82e85db7347e", {p0: (pack.name)})} disabled={busy} onClick={() => void confirmAction(translate("expression.catalog.da6cf2e5bc0b", {p0: (pack.name)})).then((yes) => { if (yes && mounted.current) return perform(() => removePack(pack.id)); })}><Trash2 size={15} /></button>
      </div>)}
      <PageEnd page={packs} empty={translate("expression.catalog.8acaaf6537db")} end={translate("expression.catalog.ab91d3f0db4d")} />
    </section>
    <input ref={input} type="file" multiple hidden accept="image/png,image/jpeg,image/webp,image/gif" aria-label={translate("expression.1cdcd529e1bd")} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) void perform((signal) => importFiles(files, signal)); }} />
    <input ref={manifest} type="file" hidden accept="application/json,.json" aria-label={translate("expression.catalog.b81f4e711dcd")} onChange={(event) => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (file) void perform(async (signal) => {
        if (file.size > 72 * 1024 * 1024) throw new Error(translate("expression.catalog.68184c5a4351"));
        await installPack(parsePack(JSON.parse(await file.text())), { signal, onProgress: (done, total) => { if (mounted.current) setProgress({ done, total }); } });
      });
    }} />
  </section>;
}
