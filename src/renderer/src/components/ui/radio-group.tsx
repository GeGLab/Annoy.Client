import * as Radio from "@radix-ui/react-radio-group";
import { useId, type ReactNode } from "react";
export function RadioGroup({
  value,
  onValueChange,
  options,
  label,
  cards = false,
}: {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  cards?: boolean;
  options: { value: string; label: ReactNode; disabled?: boolean; hint?: string }[];
}) {
  const id = useId();
  return (
    <Radio.Root className={cards ? "radio-cards" : "radio-row"} value={value} onValueChange={onValueChange} aria-label={label}>
      {options.map((option) => (
        <label
          key={option.value}
          htmlFor={`${id}-${option.value}`}
          className={cards ? `radio-card${value === option.value ? " active" : ""}` : undefined}
          title={option.hint}
        >
          <Radio.Item className="ui-radio" id={`${id}-${option.value}`} value={option.value} disabled={option.disabled}>
            <Radio.Indicator className="ui-radio-dot" />
          </Radio.Item>
          <span className="radio-option-copy">{option.label}{cards && option.hint && <small aria-hidden>{option.hint}</small>}</span>
        </label>
      ))}
    </Radio.Root>
  );
}
