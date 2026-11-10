import { useSyncExternalStore, type CSSProperties } from "react";
import { THEME_PRESETS, themePreset } from "../lib/theme-presets.ts";
import {t as translate} from "../../../shared/localization/index.ts";
import type { Settings } from "../store.ts";
import { Button } from "./ui/button.tsx";
import { ColorPicker } from "./ui/color-picker.tsx";
import { validColor } from "../lib/appearance.ts";
import { APP_ICONS } from "../../../shared/app-icon.ts";
import { brandImage } from "./Brand.tsx";
import { Icon } from "./ui.tsx";

const lightQuery = () => matchMedia("(prefers-color-scheme: light)");
const subscribeToMode = (listener: () => void) => {
  const media = lightQuery();
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
};

export function AppearanceSettings({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  const selected = themePreset(settings.themePreset);
  const systemLight = useSyncExternalStore(subscribeToMode, () => lightQuery().matches);
  const light = settings.theme === "light" || (settings.theme === "system" && systemLight);
  return (
    <div className="personal-colors">
      <section className="theme-gallery" aria-label={translate("settings.themes.title")}>
        <div className="theme-gallery-heading">
          <strong>{translate("settings.themes.title")}</strong>
          <p className="muted small">{translate("settings.themes.hint")}</p>
        </div>
        <div className="theme-preset-grid" role="group" aria-label={translate("settings.themes.title")}>
          {THEME_PRESETS.map((preset) => (
            <button type="button" key={preset.id}
              className={`theme-preset${selected.id === preset.id ? " selected" : ""}`}
              aria-pressed={selected.id === preset.id}
              aria-label={translate(`settings.themes.${preset.id}`)}
              onClick={() => update({ themePreset: preset.id, accentColor: null, surfaceColor: null })}
              style={{ "--preview-bg": light ? preset.light : preset.dark, "--preview-accent": light ? preset.lightAccent : preset.accent, "--preview-ink": light ? "#202024" : "#ffffff" } as CSSProperties}>
              <span className="theme-preview" aria-hidden="true">
                <span className="theme-preview-rail"><i /><i /><i /></span>
                <span className="theme-preview-sidebar"><i /><i /><i /><i /></span>
                <span className="theme-preview-chat"><i /><span><b /><b /></span><i /><span><b /><b /></span><em /></span>
              </span>
              <span className="theme-preset-caption"><strong>{translate(`settings.themes.${preset.id}`)}</strong><span className="theme-preset-check">{selected.id === preset.id && <Icon name="check" size={14} />}</span></span>
            </button>
          ))}
        </div>
      </section>
      <div className="app-icon-field">
        <span>{translate("settings.appIcon.title")}</span>
        <div className="theme-options app-icon-options" role="group" aria-label={translate("settings.appIcon.title")}>
          {APP_ICONS.map((icon) => (
            <button
              key={icon}
              type="button"
              className={`theme-option${settings.appIcon === icon ? " selected" : ""}`}
              aria-pressed={settings.appIcon === icon}
              onClick={() => update({ appIcon: icon })}
            >
              <img src={brandImage(icon)} width={36} height={36} alt="" draggable={false} />
              <span><strong>{translate(icon === "classic" ? "settings.appIcon.classic" : "settings.appIcon.white")}</strong></span>
              {settings.appIcon === icon && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
        <span className="muted small">{translate("settings.appIcon.hint")}</span>
      </div>
      <p className="muted small">{translate("settings.bac8755ed814")}</p>
      <div className="grid-2">
        <div className="color-field">
          <span>{translate("settings.555148c1db65")}</span>
          <ColorPicker
            label={translate("settings.555148c1db65")}
            value={validColor(settings.accentColor) ? settings.accentColor : light ? selected.lightAccent : selected.accent}
            onChange={(accentColor) => update({ accentColor })}
          />
          <span className="muted">{translate("settings.26cfe72fc0d9")}</span>
        </div>
        <div className="color-field">
          <span>{translate("settings.383efa53297e")}</span>
          <ColorPicker
            label={translate("settings.383efa53297e")}
            value={validColor(settings.surfaceColor) ? settings.surfaceColor : light ? selected.light : selected.dark}
            onChange={(surfaceColor) => update({ surfaceColor })}
          />
          <span className="muted">{translate("settings.064406e5b276")}</span>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        disabled={!settings.accentColor && !settings.surfaceColor}
        onClick={() => update({ accentColor: null, surfaceColor: null })}
      >{translate("settings.28178cb6879c")}</Button>
    </div>
  );
}


