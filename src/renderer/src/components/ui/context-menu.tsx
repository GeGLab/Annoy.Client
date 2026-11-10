import {t as translate} from "../../../../shared/localization/index.ts";
import * as Menu from "@radix-ui/react-menu";
import { Slot } from "@radix-ui/react-slot";
import { createContext, useContext, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from "react";
import { cn } from "../../lib/utils.ts";

type ContextState = {
  trigger: RefObject<HTMLElement | null>;
  point: RefObject<{ x: number; y: number }>;
  open: boolean;
  setOpen: (open: boolean) => void;
};
const Context = createContext<ContextState | null>(null);
const useMenu = () => {
  const context = useContext(Context);
  if (!context) throw new Error(translate("common.3622cb81ce99"));
  return context;
};

/** Reuse Radix's menu focus, keyboard and dismissal behavior, anchored at the pointer. */
export function ContextMenu({ children, intercept }: { children: ReactNode; intercept?: (point: { x: number; y: number }) => boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const point = useRef({ x: 0, y: 0 });
  return <Context.Provider value={{ trigger, point, open, setOpen: (next) => { if (!next || !intercept?.(point.current)) setOpen(next); } }}>
    <Menu.Root open={open} onOpenChange={setOpen}>{children}</Menu.Root>
  </Context.Provider>;
}

export function ContextMenuTrigger({ children }: { children: ReactNode }) {
  const menu = useMenu();
  return <Slot ref={menu.trigger} aria-haspopup="menu" aria-expanded={menu.open}
    onContextMenu={(event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      menu.point.current = { x: event.clientX, y: event.clientY };
      menu.setOpen(true);
    }}
    onKeyDown={(event) => {
      if (event.defaultPrevented || !(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      menu.point.current = { x: rect.right, y: rect.top };
      menu.setOpen(true);
    }}
  >{children}</Slot>;
}

export function ContextMenuContent({ className, ...props }: ComponentProps<typeof Menu.Content>) {
  const menu = useMenu();
  const outside = useRef(false);
  const anchor = useRef({ getBoundingClientRect: () => DOMRect.fromRect({ ...menu.point.current, width: 0, height: 0 }) });
  return <>
    <Menu.Anchor virtualRef={anchor} />
    <Menu.Portal container={menu.trigger.current?.ownerDocument.fullscreenElement ?? menu.trigger.current?.ownerDocument.body}><Menu.Content side="right" align="start" sideOffset={2} collisionPadding={10} loop
      {...props} className={cn("ui-dropdown-content ui-context-content", className)}
      onInteractOutside={(event) => { props.onInteractOutside?.(event); outside.current = true; }}
      onCloseAutoFocus={(event) => {
        props.onCloseAutoFocus?.(event);
        if (!event.defaultPrevented) {
          event.preventDefault();
          if (!outside.current && !document.querySelector('[role="dialog"], [role="alertdialog"]')) menu.trigger.current?.focus();
        }
        outside.current = false;
      }}
    /></Menu.Portal>
  </>;
}

export function ContextMenuItem({ className, destructive, ...props }: ComponentProps<typeof Menu.Item> & { destructive?: boolean }) {
  return <Menu.Item {...props} className={cn("ui-dropdown-item", destructive && "destructive", className)} />;
}
export function ContextMenuSeparator() { return <Menu.Separator className="ui-dropdown-separator" />; }
export function ContextMenuLabel({ children }: { children: ReactNode }) { return <Menu.Label className="ui-menu-label">{children}</Menu.Label>; }


