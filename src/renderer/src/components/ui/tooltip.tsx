import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";

export const TooltipProvider = TooltipPrimitive.Provider;
export function Tooltip({ children, content, side = "right" }: { children: ReactElement; content: ReactNode; side?: "top" | "right" | "bottom" | "left" }) {
  return <TooltipPrimitive.Root><TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger><TooltipPrimitive.Portal><TooltipPrimitive.Content className="ui-tooltip" side={side} sideOffset={10}>{content}<TooltipPrimitive.Arrow className="ui-tooltip-arrow" /></TooltipPrimitive.Content></TooltipPrimitive.Portal></TooltipPrimitive.Root>;
}
