import * as Popover from "@radix-ui/react-popover";
import { HexColorInput, HexColorPicker } from "react-colorful";
import { useState, useSyncExternalStore } from "react";
import { validColor } from "../../lib/appearance.ts";
import { Button } from "./button.tsx";
import { Icon } from "./icon.tsx";

const KEY = "distopic.recentColors";
let recent: string[];
try {
  const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
  recent = Array.isArray(parsed) ? [...new Set(parsed.filter(validColor))].slice(0, 12) : [];
} catch {
  recent = [];
}
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => recent;
const presets = ["#ffb020", "#ef6a79", "#c47be8", "#8394f7", "#5daceb", "#61c8bd", "#8cb879", "#e6c36d"];
function remember(color: string) {
  recent = [color.toLowerCase(), ...recent.filter((value) => value.toLowerCase() !== color.toLowerCase())].slice(0, 12);
  localStorage.setItem(KEY, JSON.stringify(recent));
  for (const listener of listeners) listener();
}
export function ColorPicker({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(value);
  const history = useSyncExternalStore(subscribe, snapshot);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setPending(value);
        setOpen(next);
      }}
    >
      <Popover.Trigger asChild>
        <button type="button" className="color-trigger" disabled={disabled} aria-label={label}>
          <span className="color-swatch" style={{ background: value }} />
          <span>{value.toUpperCase()}</span>
          <Icon name="palette" size={15} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="color-popover" sideOffset={8} collisionPadding={14} aria-label={`Escolher ${label}`}>
          <div className="color-picker-heading">
            <strong>{label}</strong>
            <span className="color-swatch" style={{ background: pending }} />
          </div>
          <HexColorPicker color={pending} onChange={setPending} aria-label={`Seletor de ${label}`} />
          <label className="hex-field">
            <span>HEX</span>
            <HexColorInput color={pending} onChange={setPending} prefixed aria-label={`Código hexadecimal de ${label}`} />
          </label>
          <div className="color-presets" aria-label="Cores sugeridas">
            {presets.map((color) => (
              <button
                key={color}
                className="color-chip"
                style={{ background: color }}
                aria-label={`Selecionar ${color}`}
                onClick={() => setPending(color)}
              />
            ))}
          </div>
          <div className="color-history">
            <span>Últimas cores</span>
            {history.length ? (
              <div className="color-presets">
                {history.map((color) => (
                  <button
                    key={color}
                    className="color-chip"
                    style={{ background: color }}
                    aria-label={`Cor recente ${color}`}
                    onClick={() => setPending(color)}
                  />
                ))}
              </div>
            ) : (
              <p>As cores que você usar aparecem aqui.</p>
            )}
          </div>
          <div className="form-actions">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={!validColor(pending)}
              onClick={() => {
                remember(pending);
                onChange(pending);
                setOpen(false);
              }}
            >
              Usar cor
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
