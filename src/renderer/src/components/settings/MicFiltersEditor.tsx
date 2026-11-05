import { t as translate, type MessageKey } from "../../../../shared/localization/index.ts";
import { DEFAULT_MIC_FILTERS, MIC_FILTER_RANGES, normalizeMicFilters, type MicFilters } from "../../audio/mic-filters.ts";
import { Button } from "../ui/button.tsx";
import { Field } from "../ui.tsx";
import { Slider } from "../ui/slider.tsx";
import { Switch } from "../ui/switch.tsx";

type Group = keyof MicFilters;
type Unit = "db" | "ms" | "ratio";

interface Control { key: string; label: MessageKey; unit: Unit; step: number }

/** Same filters, names and order as OBS's audio filters, so OBS presets carry over. */
const GROUPS: { id: Group; title: MessageKey; hint: MessageKey; controls: Control[] }[] = [
  {
    id: "gate", title: "voice.filters.gate", hint: "voice.filters.gateHint", controls: [
      { key: "closeDb", label: "voice.filters.closeThreshold", unit: "db", step: 1 },
      { key: "openDb", label: "voice.filters.openThreshold", unit: "db", step: 1 },
      { key: "attackMs", label: "voice.filters.attack", unit: "ms", step: 1 },
      { key: "holdMs", label: "voice.filters.hold", unit: "ms", step: 10 },
      { key: "releaseMs", label: "voice.filters.release", unit: "ms", step: 10 },
    ],
  },
  {
    id: "eq", title: "voice.filters.eq", hint: "voice.filters.eqHint", controls: [
      { key: "lowDb", label: "voice.filters.low", unit: "db", step: 0.5 },
      { key: "midDb", label: "voice.filters.mid", unit: "db", step: 0.5 },
      { key: "highDb", label: "voice.filters.high", unit: "db", step: 0.5 },
    ],
  },
  { id: "gain", title: "voice.filters.gain", hint: "voice.filters.gainHint", controls: [{ key: "db", label: "voice.filters.gain", unit: "db", step: 0.5 }] },
  {
    id: "compressor", title: "voice.filters.compressor", hint: "voice.filters.compressorHint", controls: [
      { key: "ratio", label: "voice.filters.ratio", unit: "ratio", step: 0.5 },
      { key: "thresholdDb", label: "voice.filters.threshold", unit: "db", step: 1 },
      { key: "attackMs", label: "voice.filters.attack", unit: "ms", step: 1 },
      { key: "releaseMs", label: "voice.filters.release", unit: "ms", step: 10 },
      { key: "outputDb", label: "voice.filters.outputGain", unit: "db", step: 0.5 },
    ],
  },
  {
    id: "limiter", title: "voice.filters.limiter", hint: "voice.filters.limiterHint", controls: [
      { key: "thresholdDb", label: "voice.filters.threshold", unit: "db", step: 0.5 },
      { key: "releaseMs", label: "voice.filters.release", unit: "ms", step: 10 },
    ],
  },
];

const format = (value: number, unit: Unit) => (unit === "db" ? `${value} dB` : unit === "ms" ? `${value} ms` : `${value}:1`);

export function MicFiltersEditor({ value, onChange, disabled }: { value: MicFilters; onChange: (next: MicFilters) => void; disabled?: boolean }) {
  const set = (group: Group, key: string, next: number | boolean) =>
    onChange(normalizeMicFilters({ ...value, [group]: { ...value[group], [key]: next } }));
  return (
    <div className="mic-filters">
      {GROUPS.map((group) => {
        const current = value[group.id] as unknown as Record<string, number | boolean>;
        const ranges = MIC_FILTER_RANGES[group.id] as Record<string, readonly [number, number]>;
        return (
          <fieldset key={group.id} className="mic-filter" disabled={disabled}>
            <label className="check">
              <Switch checked={current.enabled === true} disabled={disabled} onCheckedChange={(checked) => set(group.id, "enabled", checked)} />
              <strong>{translate(group.title)}</strong>
            </label>
            <p className="muted small">{translate(group.hint)}</p>
            {current.enabled === true && (
              <div className="mic-filter-controls">
                {group.controls.map((control) => {
                  const [min, max] = ranges[control.key]!;
                  const number = current[control.key] as number;
                  return (
                    <Field key={control.key} label={`${translate(control.label)}: ${format(number, control.unit)}`}>
                      <Slider aria-label={translate(control.label)} aria-valuetext={format(number, control.unit)} min={min} max={max} step={control.step} value={number}
                        onChange={(event) => set(group.id, control.key, Number(event.target.value))} />
                    </Field>
                  );
                })}
              </div>
            )}
          </fieldset>
        );
      })}
      <Button variant="secondary" size="sm" disabled={disabled} onClick={() => onChange(DEFAULT_MIC_FILTERS)}>{translate("voice.filters.reset")}</Button>
    </div>
  );
}
