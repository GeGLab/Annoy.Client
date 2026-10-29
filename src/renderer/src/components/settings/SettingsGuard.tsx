import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { registerNavigationGuard } from "../../lib/navigation-guard.ts";
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog.tsx";
import { Button } from "../ui/button.tsx";

interface Draft {
  dirty: boolean;
  save: () => Promise<boolean>;
  reset: () => void;
}
interface Guard {
  register: (id: string, draft: MutableRefObject<Draft>) => () => void;
  changed: () => void;
  leave: (action: () => void) => void;
  footer: ReactNode;
  saving: boolean;
}
const Context = createContext<Guard | null>(null);
export const useSettingsGuard = () => useContext(Context);
export function useSettingsDraft(id: string, dirty: boolean, save: () => Promise<boolean>, reset: () => void) {
  const context = useSettingsGuard();
  const register = context?.register,
    changed = context?.changed;
  const draft = useRef<Draft>({ dirty, save, reset });
  draft.current = { dirty, save, reset };
  useEffect(() => register?.(id, draft), [register, id]);
  useEffect(() => changed?.(), [changed, dirty]);
}

/** Settings forms register their real async save/reset operations with one exit guard. */
export function SettingsGuard({ children }: { children: ReactNode }) {
  const drafts = useRef(new Map<string, MutableRefObject<Draft>>());
  const [, redraw] = useState(0);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const windowExit = useRef(false);
  const changed = useCallback(() => redraw((version) => version + 1), []);
  const register = useCallback(
    (id: string, draft: MutableRefObject<Draft>) => {
      drafts.current.set(id, draft);
      changed();
      return () => {
        drafts.current.delete(id);
        changed();
      };
    },
    [changed],
  );
  const dirty = [...drafts.current.values()].some((value) => value.current.dirty);
  const leave = useCallback(
    (action: () => void) => {
      if (saving) return;
      if (dirty) setPending(() => action);
      else action();
    },
    [dirty, saving],
  );
  useEffect(() => registerNavigationGuard(leave), [leave]);
  useEffect(() => {
    const event = (e: BeforeUnloadEvent) => {
      if ((!dirty && !saving) || windowExit.current) return;
      e.preventDefault();
      e.returnValue = "";
      leave(() => {
        windowExit.current = true;
        window.distopic?.window.close();
      });
    };
    window.addEventListener("beforeunload", event);
    return () => window.removeEventListener("beforeunload", event);
  }, [dirty, saving, leave]);
  const reset = () => {
    for (const value of drafts.current.values()) value.current.reset();
    setError(null);
    changed();
  };
  const save = async () => {
    if (saving) return false;
    setSaving(true);
    setError(null);
    try {
      for (const value of drafts.current.values()) {
        if (value.current.dirty && !(await value.current.save())) {
          setError("Não foi possível salvar todas as alterações. Confira os campos e tente novamente.");
          return false;
        }
      }
      return true;
    } catch (error) {
      setError((error as Error).message);
      return false;
    } finally {
      setSaving(false);
      changed();
    }
  };
  const footer = dirty ? (
    <div className="settings-savebar">
      <span>{error ?? "Você tem alterações não salvas."}</span>
      <Button variant="ghost" disabled={saving} onClick={reset}>
        Redefinir
      </Button>
      <Button loading={saving} onClick={() => void save()}>
        Salvar alterações
      </Button>
    </div>
  ) : null;
  const value = useMemo(() => ({ register, changed, leave, footer, saving }), [register, changed, leave, footer, saving]);
  return (
    <Context.Provider value={value}>
      {children}
      {pending && (
        <Dialog open onOpenChange={(open) => !open && !saving && setPending(null)}>
          <DialogContent className="modal unsaved-dialog" aria-describedby="settings-unsaved-description" showClose={false}>
            <div className="modal-body">
              <DialogTitle>Salvar suas alterações?</DialogTitle>
              <p id="settings-unsaved-description" className="muted">
                Há mudanças não salvas nestas configurações.
              </p>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className="form-actions">
                <Button variant="ghost" disabled={saving} onClick={() => setPending(null)}>
                  Continuar editando
                </Button>
                <Button
                  variant="secondary"
                  disabled={saving}
                  onClick={() => {
                    const action = pending;
                    reset();
                    setPending(null);
                    queueMicrotask(action);
                  }}
                >
                  Descartar alterações
                </Button>
                <Button
                  loading={saving}
                  onClick={() =>
                    void save().then((ok) => {
                      if (ok) {
                        const action = pending;
                        setPending(null);
                        queueMicrotask(action);
                      }
                    })
                  }
                >
                  Salvar e continuar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Context.Provider>
  );
}
