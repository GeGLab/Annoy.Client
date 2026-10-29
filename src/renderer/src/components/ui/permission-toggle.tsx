import * as Radio from "@radix-ui/react-radio-group";
import { Check, Minus, X } from "lucide-react";
export function PermissionToggle({
  value,
  onValueChange,
  label,
  disabled,
}: {
  value: "allow" | "inherit" | "deny";
  onValueChange: (value: "allow" | "inherit" | "deny") => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Radio.Root
      className="tri"
      aria-label={label}
      value={value}
      onValueChange={(mode) => onValueChange(mode as typeof value)}
      disabled={disabled}
    >
      {(["deny", "inherit", "allow"] as const).map((mode) => (
        <Radio.Item
          key={mode}
          value={mode}
          className={`${mode}${value === mode ? " on" : ""}`}
          title={mode === "deny" ? "Negar" : mode === "inherit" ? "Herdar" : "Permitir"}
          aria-label={mode === "deny" ? "Negar" : mode === "inherit" ? "Herdar" : "Permitir"}
        >
          {mode === "deny" ? <X size={16} /> : mode === "inherit" ? <Minus size={16} /> : <Check size={16} />}
        </Radio.Item>
      ))}
    </Radio.Root>
  );
}
