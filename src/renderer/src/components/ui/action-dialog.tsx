import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { useSyncExternalStore } from "react";
import { Button } from "./button.tsx";
import { Input } from "./input.tsx";
type Request = {
  id: number;
  message: string;
  prompt: boolean;
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
  options?: { confirmLabel?: string; cancelLabel?: string },
): Promise<string | boolean | null> {
  return new Promise((resolve) => {
    queue.push({
      id: ++sequence,
      message,
      prompt,
      value,
      confirmLabel: options?.confirmLabel ?? (prompt ? "Confirmar" : "Confirmar ação"),
      cancelLabel: options?.cancelLabel ?? "Cancelar",
      resolve,
    });
    emit();
  });
}
export async function confirmAction(message: string, options?: { confirmLabel?: string; cancelLabel?: string }) {
  return (await ask(message, false, "", options)) === true;
}
export async function promptText(message: string, value = "") {
  const result = await ask(message, true, value);
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
        <AlertDialog.Content key={request.id} className="dialog-content modal action-dialog">
          <form
            className="modal-body"
            onSubmit={(e) => {
              e.preventDefault();
              done(true);
            }}
          >
            <AlertDialog.Title>{request.prompt ? "Confirme os detalhes" : "Confirmar ação"}</AlertDialog.Title>
            <AlertDialog.Description>{request.message}</AlertDialog.Description>
            {request.prompt && (
              <Input
                aria-label="Sua resposta"
                defaultValue={request.value}
                onChange={(e) => {
                  request.value = e.target.value;
                }}
                autoFocus
              />
            )}
            <div className="form-actions">
              <Button variant="secondary" onClick={() => done(false)}>
                {request.cancelLabel}
              </Button>
              <Button type="submit">{request.confirmLabel}</Button>
            </div>
          </form>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
