import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRef, type ComponentProps } from "react";
import { cn } from "../../lib/utils.ts";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, overlayClassName, children, showClose = true, onCloseAutoFocus, ...props }: ComponentProps<typeof DialogPrimitive.Content> & { showClose?: boolean; overlayClassName?:string }) {
  // These dialogs can be opened through application state instead of a Radix
  // trigger. Preserve the invoking element across lazy loading and focus traps.
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  return <DialogPrimitive.Portal><DialogPrimitive.Overlay className={cn("dialog-overlay",overlayClassName)} /><DialogPrimitive.Content className={cn("dialog-content", className)} onCloseAutoFocus={event => { onCloseAutoFocus?.(event); if (!event.defaultPrevented) { event.preventDefault(); requestAnimationFrame(() => {
    // A navigation action can already have focused its next dialog or picker.
    // Closing an older dialog must not pull focus out of that new surface.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return;
    if (opener.current?.isConnected) opener.current.focus();
  }); } }} {...props}>{children}{showClose && <DialogPrimitive.Close className="icon-btn dialog-close" aria-label="Fechar"><X size={18} /></DialogPrimitive.Close>}</DialogPrimitive.Content></DialogPrimitive.Portal>;
}
