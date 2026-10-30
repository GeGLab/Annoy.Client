import type { Presence, User } from "@distopic/protocol";
import { requestNavigation } from "../lib/navigation-guard.ts";
import { useSettingsGuard } from "./settings/SettingsGuard.tsx";
import { type ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog.tsx";
import { Icon } from "./ui/icon.tsx";
export { Icon, type IconName } from "./ui/icon.tsx";
import { colorFor, initials } from "../format.tsx";
import { setState, toast, type Modal as ModalState } from "../store.ts";
import { isCancellation } from "../../../shared/requests.ts";

export function Avatar({ user, size = 32, presence, speaking }: { user: User; size?: number; presence?: Presence; speaking?: boolean }) {
  return (
    <span className={`avatar${speaking ? " speaking" : ""}`} style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {user.avatarUrl ? (
        <img className="avatar-face" src={user.avatarUrl} alt="" draggable={false} />
      ) : (
        <span className="avatar-face" style={{ background: colorFor(user.id) }}>
          {initials(user.displayName)}
        </span>
      )}
      {presence && <span className={`presence presence-${presence}`} />}
    </span>
  );
}

export function openModal(modal: ModalState): void {
  requestNavigation(() =>
    setState((s) => {
      s.modal = modal;
    }),
  );
}

/** Runs a request, surfacing failures (and optionally success) as a toast. */
export async function act(promise: Promise<unknown>, ok?: string): Promise<boolean> {
  try {
    await promise;
    if (ok) toast(ok);
    return true;
  } catch (err) {
    if (!isCancellation(err)) toast((err as Error).message);
    return false;
  }
}

export function closeModal(): void {
  requestNavigation(() =>
    setState((s) => {
      s.modal = null;
    }),
  );
}

export function Modal({
  title,
  children,
  wide,
  onClose = closeModal,
  footer,
  className = "",
  busy = false,
}: {
  title: string;
  children: ReactNode;
  wide?: boolean;
  onClose?: () => void;
  footer?: ReactNode;
  className?: string;
  busy?: boolean;
}) {
  const guard = useSettingsGuard();
  const requestClose = () => {
    if (guard)
      guard.leave(() =>
        onClose === closeModal
          ? setState((s) => {
              s.modal = null;
            })
          : onClose(),
      );
    else onClose();
  };
  const actions = footer ?? guard?.footer;
  return (
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      <DialogContent
        className={`modal${wide ? " modal-wide" : ""} ${className}${actions ? " has-savebar" : ""}`}
        aria-describedby={undefined}
        showClose={false}
      >
        <header className="modal-header">
          <DialogTitle asChild>
            <h2>{title}</h2>
          </DialogTitle>
          <button className="icon-btn" onClick={requestClose} aria-label="Fechar">
            <Icon name="x" />
          </button>
        </header>
        <div className="modal-body" inert={busy || guard?.saving || undefined}>
          {children}
        </div>
        {actions}
      </DialogContent>
    </Dialog>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
