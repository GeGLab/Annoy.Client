import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import type { ComponentProps } from "react";
export function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  className,
  ...props
}: Omit<ComponentProps<typeof CheckboxPrimitive.Root>, "checked" | "onCheckedChange" | "onChange"> & {
  checked?: boolean;
  indeterminate?: boolean;
  onChange?: (event: { target: { checked: boolean } }) => void;
}) {
  return (
    <CheckboxPrimitive.Root
      {...props}
      className={`ui-checkbox ${className ?? ""}`}
      checked={indeterminate ? "indeterminate" : checked}
      onCheckedChange={(value) => onChange?.({ target: { checked: value === true } })}
    >
      <CheckboxPrimitive.Indicator>{indeterminate ? <Minus size={12} /> : <Check size={12} />}</CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
