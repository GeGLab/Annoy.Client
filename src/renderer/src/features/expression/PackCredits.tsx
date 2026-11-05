import { t as translate } from "../../../../shared/localization/index.ts";
import type { MediaPack } from "./types.ts";

/** Author, license and source of an imported pack. */
export function PackCredits({ pack }: { pack: Omit<MediaPack, "items"> }) {
  return <details className="expression-credits"><summary>{translate("expression.catalog.225b1203a907")}</summary>
    <p>{pack.credits ?? `${pack.author} · ${pack.license}`}</p>
    {pack.version && <small>{translate("expression.catalog.version", { p0: pack.version })}</small>}
    <div>{/^https:\/\//.test(pack.source) && <a href={pack.source} target="_blank" rel="noreferrer">{translate("expression.7b9afa8bda07")}</a>}
      {pack.licenseUrl && /^https:\/\//.test(pack.licenseUrl) && <a href={pack.licenseUrl} target="_blank" rel="noreferrer">{pack.license}</a>}</div>
  </details>;
}
