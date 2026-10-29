import * as SliderPrimitive from "@radix-ui/react-slider";
import type { ComponentProps } from "react";
export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  className,
  "aria-label": label,
  ...props
}: Omit<ComponentProps<typeof SliderPrimitive.Root>, "value" | "onValueChange" | "onChange"> & {
  value: number;
  onChange?: (event: { target: { value: string } }) => void;
}) {
  return (
    <SliderPrimitive.Root
      {...props}
      className={`ui-slider ${className ?? ""}`}
      min={min}
      max={max}
      step={step}
      value={[value]}
      onValueChange={(values) => onChange?.({ target: { value: String(values[0]) } })}
    >
      <SliderPrimitive.Track className="ui-slider-track">
        <SliderPrimitive.Range className="ui-slider-fill" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="ui-slider-thumb" aria-label={label} />
    </SliderPrimitive.Root>
  );
}
