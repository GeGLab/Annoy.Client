import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { Children, isValidElement, useId, type ComponentProps, type ReactNode, type ReactElement } from "react";
import { cn } from "../../lib/utils.ts";

const EMPTY = "__distopic_empty_selection__";
type OptionProps = ComponentProps<"option">;
function options(children: ReactNode): ReactElement<OptionProps>[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<OptionProps & { children?: ReactNode }>(child)) return [];
    return child.type === "option" ? [child] : options(child.props.children);
  });
}

/** Shared shadcn/Radix select. Option-style children ease migration of existing forms. */
export function Select({
  value,
  onChange,
  children,
  className,
  disabled,
  id,
  name,
  required,
  portalContainer,
  "aria-label": label,
  ...rest
}: Omit<ComponentProps<"select">, "multiple" | "size" | "defaultValue" | "onChange"> & {
  onChange?: (event: { target: { value: string } }) => void;
  portalContainer?: HTMLElement | null;
}) {
  const generated = useId();
  const items = options(children);
  const selected = String(value ?? "");
  // Keep a disconnected device readable until the person chooses a replacement.
  const missing = selected !== "" && !items.some((item) => String(item.props.value ?? "") === selected);
  return (
    <SelectPrimitive.Root
      value={selected || EMPTY}
      onValueChange={(next) => onChange?.({ target: { value: next === EMPTY ? "" : next } })}
      disabled={disabled}
      name={name}
      required={required}
    >
      <SelectPrimitive.Trigger
        id={id ?? generated}
        className={cn("ui-select-trigger", className)}
        aria-label={label}
        aria-labelledby={rest["aria-labelledby"]}
        aria-describedby={rest["aria-describedby"]}
        aria-invalid={rest["aria-invalid"]}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon asChild>
          <ChevronDown size={16} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal container={portalContainer ?? undefined}>
        <SelectPrimitive.Content className="ui-select-content" position="popper" sideOffset={6} collisionPadding={12}>
          <SelectPrimitive.ScrollUpButton className="ui-select-scroll">
            <ChevronUp size={15} />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="ui-select-viewport">
            {missing && (
              <SelectPrimitive.Item value={selected} className="ui-select-item">
                <SelectPrimitive.ItemText>Dispositivo indisponível</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <Check size={15} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            )}
            {items.map((item, index) => (
              <SelectPrimitive.Item
                key={`${item.props.value}-${index}`}
                value={String(item.props.value ?? "") || EMPTY}
                disabled={item.props.disabled}
                className="ui-select-item"
              >
                <SelectPrimitive.ItemText>{item.props.children}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <Check size={15} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="ui-select-scroll">
            <ChevronDown size={15} />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
