import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils.ts";

export const DropdownMenu = DropdownPrimitive.Root;
export const DropdownMenuTrigger = DropdownPrimitive.Trigger;
export const DropdownMenuLabel = DropdownPrimitive.Label;
export const DropdownMenuRadioGroup = DropdownPrimitive.RadioGroup;
export function DropdownMenuRadioItem({ className, children, ...props }: ComponentProps<typeof DropdownPrimitive.RadioItem>) {
  return (
    <DropdownPrimitive.RadioItem className={cn("ui-dropdown-item ui-dropdown-radio", className)} {...props}>
      <span className="dropdown-radio-indicator">
        <DropdownPrimitive.ItemIndicator>•</DropdownPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownPrimitive.RadioItem>
  );
}
export function DropdownMenuContent({ className, ...props }: ComponentProps<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content sideOffset={7} collisionPadding={10} className={cn("ui-dropdown-content", className)} {...props} />
    </DropdownPrimitive.Portal>
  );
}
export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: ComponentProps<typeof DropdownPrimitive.Item> & { destructive?: boolean }) {
  return <DropdownPrimitive.Item className={cn("ui-dropdown-item", destructive && "destructive", className)} {...props} />;
}
export function DropdownMenuSeparator() {
  return <DropdownPrimitive.Separator className="ui-dropdown-separator" />;
}
