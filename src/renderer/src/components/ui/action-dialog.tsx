import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useRef, useSyncExternalStore } from "react";
import { Button } from "./button.tsx";
import { Input } from "./input.tsx";
type Request = {
  id: number;
  message: string;
  title: string;
  prompt: boolean;
  /** Hide what's typed (a password). */
  secret: boolean;
  value: string;
  confirmLabel: string;
  cancelLabel: string;
  resolve: (value: string | boolean | null) => void;
};
let sequence = 0;
const queue: Request[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
function ask(
  message: string,
  prompt: boolean,
  value = "",
  options?: { title?: string; confirmLabel?: string; cancelLabel?: string; secret?: boolean },
): Promise<string | boolean | null> {
  return new Promise((resolve) => {
    queue.push({
      id: ++sequence,
      message,
      title: options?.title ?? (prompt ? "Confirme os detalhes" : "Confirmar ação"),
      prompt,
      secret: options?.secret ?? false,
      value,
      confirmLabel: options?.confirmLabel ?? (prompt ? "Confirmar" : "Confirmar ação"),
      cancelLabel: options?.cancelLabel ?? "Cancelar",
      resolve,
    });
    emit();
  });
}
export async function confirmAction(message: string, options?: { title?: string; confirmLabel?: string; cancelLabel?: string }) {
  return (await ask(message, false, "", options)) === true;
}
export async function promptText(message: string, value = "", options?: { confirmLabel?: string; secret?: boolean }) {
  const result = await ask(message, true, value, options);
  return typeof result === "string" ? result : null;
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
/** Shared async replacement for renderer confirm/prompt. Preserves keyboard focus and queues requests. */
export function ActionDialogHost() {
  const request = useSyncExternalStore(subscribe, () => queue[0] ?? null);
  const input = useRef<HTMLInputElement | null>(null);
  if (!request) return null;
  const done = (accepted: boolean) => {
    const item = queue.shift();
    item?.resolve(accepted ? (item.prompt ? item.value : true) : item?.prompt ? null : false);
    emit();
  };
  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && done(false)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay action-dialog-overlay" />
        <AlertDialog.Content key={request.id} className="dialog-content action-dialog" onOpenAutoFocus={(event) => {
          if (request.prompt) { event.preventDefault(); input.current?.focus(); }
        }}>
          <form
            className="action-dialog-form"
            onSubmit={(e) => {
              e.preventDefault();
              done(true);
            }}
          >
            <div className="action-dialog-body">
            <AlertDialog.Title className="action-dialog-title">{request.title}</AlertDialog.Title>
            <AlertDialog.Description className="action-dialog-description">{request.message}</AlertDialog.Description>
            {request.prompt && (
              <Input
                ref={input}
                aria-label="Sua resposta"
                type={request.secret ? "password" : "text"}
                autoComplete={request.secret ? "current-password" : undefined}
                defaultValue={request.value}
                onChange={(e) => {
                  request.value = e.target.value;
                }}
                autoFocus
              />
            )}
            </div>
            <div className="action-dialog-actions">
              <AlertDialog.Cancel asChild><Button variant="secondary">
                {request.cancelLabel}
              </Button></AlertDialog.Cancel>
              <Button type="submit">{request.confirmLabel}</Button>
            </div>
          </form>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
