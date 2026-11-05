import {t as translate} from "../../../shared/localization/index.ts";
import type { Settings } from "../store.ts";
import { Button } from "./ui/button.tsx";
import { ColorPicker } from "./ui/color-picker.tsx";
import { validColor } from "../lib/appearance.ts";
import { APP_ICONS } from "../../../shared/app-icon.ts";
import { brandImage } from "./Brand.tsx";
import { Icon } from "./ui.tsx";

export function AppearanceSettings({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  return (
    <div className="personal-colors">
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
            value={validColor(settings.accentColor) ? settings.accentColor : "#ffb020"}
            onChange={(accentColor) => update({ accentColor })}
          />
          <span className="muted">{translate("settings.26cfe72fc0d9")}</span>
        </div>
        <div className="color-field">
          <span>{translate("settings.383efa53297e")}</span>
          <ColorPicker
            label={translate("settings.383efa53297e")}
            value={validColor(settings.surfaceColor) ? settings.surfaceColor : "#171621"}
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


