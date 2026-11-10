import { useEffect, useState } from "react";
import { t } from "../../../../shared/localization/index.ts";
import { Button } from "../../components/ui/button.tsx";
import { Checkbox } from "../../components/ui/checkbox.tsx";
import { Select } from "../../components/ui/select.tsx";
import type { MediaItem, MediaKind } from "./types.ts";
import type { ZipImage } from "./zip.ts";

function ZipThumbnail({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => { const next = URL.createObjectURL(blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [blob]);
  return <img src={url} alt="" loading="lazy" />;
}
export function ZipImportPreview({ images, name, busy, cancel, importItems }: {
  images: ZipImage[]; name: string; busy: boolean; cancel: () => void;
  importItems: (name: string, items: MediaItem[]) => void;
}) {
  const [packName, setPackName] = useState(name.slice(0, 80));
  const [rows, setRows] = useState(() => images.map((image) => ({ ...image, selected: !!image.blob, kind: (image.blob?.type === "image/gif" ? "gif" : "sticker") as MediaKind })));
  const usable = rows.filter(row => row.blob), chosen = rows.filter(row => row.selected && row.blob);
  const valid = !!packName.trim() && chosen.length > 0 && chosen.length <= 60 && chosen.every(row => row.name.trim()) && chosen.reduce((sum, row) => sum + row.blob!.size, 0) <= 50 * 1024 * 1024;
  const patch = (index: number, value: Partial<(typeof rows)[number]>) => setRows(current => current.map((row, i) => i === index ? { ...row, ...value } : row));
  return <section className="expression-zip-preview" aria-label={t("expression.zip.preview")} aria-busy={busy}>
    <div className="expression-zip-heading"><h4>{t("expression.zip.preview")}</h4><span className="muted small">{t("expression.zip.summary", { count: rows.length, selected: chosen.length })}</span></div>
    <label className="expression-zip-name">{t("expression.zip.packName")}<input value={packName} maxLength={80} disabled={busy} onChange={event => setPackName(event.target.value)} /></label>
    <p className="muted small">{t("expression.zip.hint")}</p>
    <label className="expression-zip-all"><Checkbox disabled={busy || !usable.length} checked={usable.length > 0 && chosen.length === usable.length} indeterminate={chosen.length > 0 && chosen.length < usable.length} onChange={event => setRows(current => current.map(row => ({ ...row, selected: !!row.blob && event.target.checked })))} />{t("expression.zip.all")}</label>
    <div className="expression-zip-list">
      {rows.map((row, index) => <div className={`expression-zip-row${row.problem ? " has-error" : ""}`} key={index}>
        <Checkbox disabled={busy || !row.blob} checked={row.selected} aria-label={t("expression.zip.select", { name: row.path })} onChange={event => patch(index, { selected: event.target.checked })} />
        <div className="expression-zip-thumb">{row.blob && <ZipThumbnail blob={row.blob} />}</div>
        <div className="expression-zip-fields"><span className="muted small" title={row.path}>{row.path}</span><div>
          <input aria-label={t("expression.zip.name", { name: row.path })} maxLength={80} value={row.name} disabled={busy || !row.blob} onChange={event => patch(index, { name: event.target.value })} />
          <Select aria-label={t("expression.zip.kind", { name: row.path })} value={row.kind} disabled={busy || !row.blob} onChange={event => patch(index, { kind: event.target.value as MediaKind })}>
            <option value="emoji">Emoji</option><option value="gif">GIF</option><option value="sticker">{t("expression.3076a998ce59")}</option>
          </Select>
        </div>{row.problem && <span className="expression-error small">{row.problem}</span>}</div>
      </div>)}
    </div>
    <div className="expression-import-actions">
      <Button variant="ghost" size="sm" disabled={busy} onClick={cancel}>{t("common.bb9dbb406dcb")}</Button>
      <Button size="sm" disabled={busy || !valid} onClick={() => importItems(packName.trim(), chosen.map(row => ({ id: crypto.randomUUID(), name: row.name.trim(), kind: row.kind, blob: row.blob! })))}>{t("expression.zip.importSelected")}</Button>
    </div>
  </section>;
}
