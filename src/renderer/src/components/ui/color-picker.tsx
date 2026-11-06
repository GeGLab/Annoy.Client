import {t as translate} from "../../../../shared/localization/index.ts";
import * as Popover from "@radix-ui/react-popover";
import { HexColorInput, HexColorPicker } from "react-colorful";
import { useState, useSyncExternalStore } from "react";
import { validColor } from "../../lib/appearance.ts";
import { Button } from "./button.tsx";
import { Icon } from "./icon.tsx";

const KEY = "annoy.recentColors";
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
        <Popover.Content className="color-popover" sideOffset={8} collisionPadding={14} aria-label={translate("common.e0e61df5120b",{p0:(label)})}>
          <div className="color-picker-heading">
            <strong>{label}</strong>
            <span className="color-swatch" style={{ background: pending }} />
          </div>
          <HexColorPicker color={pending} onChange={setPending} aria-label={translate("common.5789e5649265",{p0:(label)})} />
          <label className="hex-field">
            <span>{translate("common.4d4a964e0320")}</span>
            <HexColorInput color={pending} onChange={setPending} prefixed aria-label={translate("common.80fe2472e18b",{p0:(label)})} />
          </label>
          <div className="color-presets" aria-label={translate("common.37b68ef51f8b")}>
            {presets.map((color) => (
              <button
                key={color}
                className="color-chip"
                style={{ background: color }}
                aria-label={translate("common.7aa34b3b94e2",{p0:(color)})}
                onClick={() => setPending(color)}
              />
            ))}
          </div>
          <div className="color-history">
            <span>{translate("common.312f5f461cb8")}</span>
            {history.length ? (
              <div className="color-presets">
                {history.map((color) => (
                  <button
                    key={color}
                    className="color-chip"
                    style={{ background: color }}
                    aria-label={translate("common.78b6e9f5fd37",{p0:(color)})}
                    onClick={() => setPending(color)}
                  />
                ))}
              </div>
            ) : (
              <p>{translate("common.23d730b77422")}</p>
            )}
          </div>
          <div className="form-actions">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{translate("common.bb9dbb406dcb")}</Button>
            <Button
              size="sm"
              disabled={!validColor(pending)}
              onClick={() => {
                remember(pending);
                onChange(pending);
                setOpen(false);
              }}
            >{translate("common.ddf665fa1d37")}</Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}


