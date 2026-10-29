import type { Settings } from "../store.ts";
import { Button } from "./ui/button.tsx";
import { ColorPicker } from "./ui/color-picker.tsx";
import { validColor } from "../lib/appearance.ts";

export function AppearanceSettings({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  return (
    <div className="personal-colors">
      <p className="muted small">Suas cores ficam apenas neste cliente. O contraste é ajustado automaticamente em cada tema.</p>
      <div className="grid-2">
        <div className="color-field">
          <span>Cor de destaque</span>
          <ColorPicker
            label="Cor de destaque"
            value={validColor(settings.accentColor) ? settings.accentColor : "#ffb020"}
            onChange={(accentColor) => update({ accentColor })}
          />
          <span className="muted">Botões, seleção e links</span>
        </div>
        <div className="color-field">
          <span>Tom dos painéis</span>
          <ColorPicker
            label="Tom dos painéis"
            value={validColor(settings.surfaceColor) ? settings.surfaceColor : "#171621"}
            onChange={(surfaceColor) => update({ surfaceColor })}
          />
          <span className="muted">Uma tonalidade sutil no fundo</span>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        disabled={!settings.accentColor && !settings.surfaceColor}
        onClick={() => update({ accentColor: null, surfaceColor: null })}
      >
        Restaurar cores originais
      </Button>
    </div>
  );
}
