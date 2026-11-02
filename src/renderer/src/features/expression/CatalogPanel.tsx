import { t as translate } from "../../../../shared/localization/index.ts";
import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Select } from "../../components/ui/select.tsx";
import { CATEGORIES, readCatalogPage, type Category } from "./catalog.ts";
import { readPackMetadata } from "./storage.ts";
import { ItemImage } from "./MediaPicker.tsx";
import { PageEnd, useMediaPages } from "./paging.tsx";
import type { MediaPack, PackMetadata } from "./types.ts";

export function PackCredits({ pack }: { pack: Omit<MediaPack, "items"> }) {
  return <details className="expression-credits"><summary>{translate("expression.catalog.225b1203a907")}</summary>
    <p>{pack.credits ?? `${pack.author} · ${pack.license}`}</p>
    {pack.version && <small>{translate("expression.catalog.version", { p0: pack.version })}</small>}
    <div>{/^https:\/\//.test(pack.source) && <a href={pack.source} target="_blank" rel="noreferrer">{translate("expression.7b9afa8bda07")}</a>}
      {pack.licenseUrl && /^https:\/\//.test(pack.licenseUrl) && <a href={pack.licenseUrl} target="_blank" rel="noreferrer">{pack.license}</a>}</div>
  </details>;
}
export function CatalogPanel({ revision, busy, canUse, onInstall, onUse }: { revision: number; busy: boolean; canUse: boolean; onInstall: (pack: MediaPack) => void; onUse: (pack: Pick<PackMetadata, "kinds">) => void }) {
  const [query, setQuery] = useState(""), [category, setCategory] = useState<Category>("all");
  const [debounced, setDebounced] = useState("");
  const [installed, setInstalled] = useState<Record<string, PackMetadata>>({});
  useEffect(() => { const timer = setTimeout(() => setDebounced(query), 250); return () => clearTimeout(timer); }, [query]);
  const load = useCallback((after: string | null, signal: AbortSignal) => readCatalogPage({ after, signal, query: debounced, category }), [debounced, category]);
  const page = useMediaPages(load);
  useEffect(() => {
    let disposed = false;
    void Promise.all(page.items.map((pack) => readPackMetadata(pack.id))).then((packs) => {
      if (!disposed) setInstalled(Object.fromEntries(packs.filter((pack) => !!pack).map((pack) => [pack.id, pack])));
    }).catch(() => { if (!disposed) setInstalled({}); });
    return () => { disposed = true; };
  }, [page.items, revision]);
  return <section aria-label={translate("expression.catalog.ee63de14be85")} className="expression-catalog">
    <h4>{translate("expression.catalog.ee63de14be85")}</h4>
    <div className="expression-catalog-filters">
      <Input aria-label={translate("expression.catalog.521855a12ce0")} placeholder={translate("expression.catalog.9cac0312d6be")} value={query} onChange={(event) => setQuery(event.target.value)} />
      <Select aria-label={translate("expression.catalog.ffd6ffa14600")} value={category} onChange={(event) => setCategory(event.target.value as Category)}>
        {Object.entries(CATEGORIES).map(([value, label]) => <option key={value} value={value}>{translate(label)}</option>)}
      </Select>
    </div>
    {page.items.map((pack) => {
      const saved = installed[pack.id], update = saved && saved.version !== pack.version;
      return <article className="expression-pack" key={pack.id}>
        <div className="expression-pack-preview">{pack.items.slice(0, 3).map((item) => <ItemImage key={item.id} item={item} />)}</div>
        <div><strong>{pack.name}</strong><small>{translate("expression.catalog.summary", { count: pack.items.length, p0: pack.author })}</small><small>{pack.license} · v{pack.version}</small><PackCredits pack={pack} /></div>
        <Button variant="secondary" size="sm" disabled={busy || (!!saved && !update && !canUse)} onClick={() => saved && !update ? onUse(saved) : onInstall(pack)}>
          {!saved && <Download size={14} />}{update ? translate("common.dafb59613e12") : saved ? translate("expression.820eaa6af764") : translate("expression.b45ae836a031")}
        </Button>
      </article>;
    })}
    <PageEnd page={page} empty={translate("expression.catalog.0ae709d02491")} end={translate("expression.catalog.385243ee3e61")} />
  </section>;
}
