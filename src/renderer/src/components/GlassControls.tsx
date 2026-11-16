import { t as translate } from "../../../shared/localization/index.ts";
import { Slider } from "./ui/slider.tsx";

/** How the glass panels look: how much they blur what's behind, and how see-through they are. */
export function GlassControls({ blur, transparency, onChange }: { blur: number; transparency: number; onChange: (patch: { glassBlur?: number; glassTransparency?: number }) => void }) {
  return (
    <div className="glass-controls">
      <label className="studio-slider">
        <span>{translate("glass.blur")}</span>
        <Slider min={0} max={30} value={blur} aria-label={translate("glass.blur")} aria-valuetext={blur ? `${blur} px` : translate("glass.none")} onChange={(e) => onChange({ glassBlur: Number(e.target.value) })} />
        <output>{blur ? `${blur} px` : translate("glass.none")}</output>
      </label>
      <label className="studio-slider">
        <span>{translate("glass.transparency")}</span>
        <Slider min={0} max={90} step={5} value={transparency} aria-label={translate("glass.transparency")} aria-valuetext={`${transparency}%`} onChange={(e) => onChange({ glassTransparency: Number(e.target.value) })} />
        <output>{transparency}%</output>
      </label>
    </div>
  );
}
