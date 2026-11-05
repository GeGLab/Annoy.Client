import { rich } from "../../lib/localization.ts";
import { FONT_SIZE, t as translate } from "../../../../shared/localization/index.ts";
import {
  LANGUAGES,
  LANGUAGE_NAMES,
  localizationPreferences,
  normalizeLocalization,
  type LocalizationPreferences,
} from "../../../../shared/localization/index.ts";
import { useStore } from "../../store.ts";
import { Field, Icon } from "../ui.tsx";
import { Select } from "../ui/select.tsx";
import { Button } from "../ui/button.tsx";
import { Switch } from "../ui/switch.tsx";
import { Slider } from "../ui/slider.tsx";
export function LocalizationSettings({
  draft,
  onChange,
  disabled,
}: {
  draft: LocalizationPreferences;
  onChange: (patch: Partial<LocalizationPreferences>) => void;
  disabled: boolean;
}) {
  const saved = useStore((s) => s.settings);
  const systemRegion = Intl.DateTimeFormat().resolvedOptions().locale;
  const regions = [
    ...new Set([
      systemRegion,
      draft.region,
      "pt-BR",
      "pt-PT",
      "en-US",
      "en-GB",
      "en-AU",
      "es-ES",
      "es-MX",
      "fr-FR",
      "fr-CA",
      "it-IT",
      "ja-JP",
      "zh-CN",
      "zh-TW",
    ]),
  ];
  const languageNames = new Intl.DisplayNames([draft.language], {
    type: "language",
  });
  const regionNames = new Intl.DisplayNames([draft.language], {
    type: "region",
  });
  const suggested = new Intl.Locale(draft.region).language;
  const mismatch = new Intl.Locale(draft.language).language !== suggested;
  const previous =
    saved.language !== draft.language ? saved.language : saved.previousLanguage;
  const restore = () => {
    if (previous) onChange({ language: previous });
  };
  return (
    <section className="settings-section localization-settings">
      <h3>
        {rich("common.231661d94937", { p0: <Icon name="globe" size={24} /> })}
      </h3>
      <p className="muted">{translate("settings.71676eedc99d")}</p>
      <Field label={translate("settings.980b2fd3e50c")}>
        <Select
          aria-label={translate("settings.980b2fd3e50c")}
          value={draft.language}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              language: normalizeLocalization({ language: event.target.value })
                .language,
            })
          }
        >
          {LANGUAGES.map((language) => (
            <option key={language} value={language}>
              {languageNames.of(language)} · {LANGUAGE_NAMES[language]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={translate("settings.b210b97febb6")}>
        <Select
          aria-label={translate("settings.b210b97febb6")}
          value={draft.region}
          disabled={disabled}
          onChange={(event) => onChange({ region: event.target.value })}
        >
          {regions.map((region) => (
            <option key={region} value={region}>
              {regionNames.of(new Intl.Locale(region).region ?? "BR")} ·{" "}
              {region}
            </option>
          ))}
        </Select>
      </Field>
      <p className="field-hint">
        {rich("common.80a5fe122659", { p0: systemRegion })}
      </p>
      <Field label={translate("settings.d687e5af9a0f")}>
        <Select
          aria-label={translate("settings.d687e5af9a0f")}
          value={draft.hourCycle}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              hourCycle: event.target
                .value as LocalizationPreferences["hourCycle"],
            })
          }
        >
          <option value="h12">{translate("settings.de07a900f635")}</option>
          <option value="h23">{translate("settings.10280491824d")}</option>
        </Select>
      </Field>
      {mismatch && (
        <div className="localization-notice" role="status">
          <p>{translate("settings.bad6f3cf26b4")}</p>
          {previous && (
            <Button variant="ghost" disabled={disabled} onClick={restore}>
              {translate("settings.e76c77425b25")}
            </Button>
          )}
        </div>
      )}
      {previous && (
        <Button variant="secondary" disabled={disabled} onClick={restore}>
          {rich("common.65204c677b62", { p0: LANGUAGE_NAMES[previous] })}
        </Button>
      )}
      <Field
        label={translate("settings.243cf75e8126")}
        hint={translate("settings.93b6f17695a0")}
      >
        <Slider
          aria-label={translate("settings.243cf75e8126")}
          min={FONT_SIZE.min}
          max={FONT_SIZE.max}
          step={1}
          value={draft.fontSize}
          disabled={disabled}
          onChange={(event) =>
            onChange({ fontSize: Number(event.target.value) })
          }
        />
        <output>{rich("common.f20219043bb7", { p0: draft.fontSize })}</output>
      </Field>
      <label className="check-row">
        <Switch
          checked={draft.underlineLinks}
          disabled={disabled}
          onCheckedChange={(checked) => onChange({ underlineLinks: checked })}
        />
        {translate("settings.132f2fdab73e")}
      </label>
      <div
        className="localization-preview"
        aria-label={translate("settings.192d781bed25")}
      >
        <strong>{translate("settings.2e6f442de5bd")}</strong>
        <p>
          {new Intl.DateTimeFormat(draft.region, {
            dateStyle: "full",
            timeStyle: "short",
            hourCycle: draft.hourCycle,
          }).format(new Date("2026-10-30T16:25:00"))}
        </p>
        <p>
          {new Intl.NumberFormat(draft.region).format(12345.67)} ·{" "}
          <a href="https://annoy.geg.dev.br" target="_blank" rel="noreferrer">
            {translate("settings.e34b9d02d634")}
          </a>
        </p>
      </div>
      <p className="muted small">{translate("settings.4662801db327")}</p>
    </section>
  );
}
