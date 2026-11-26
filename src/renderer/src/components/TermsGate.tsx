import { useState } from "react";
import { t as translate, textForError } from "../../../shared/localization/index.ts";
import { acceptTerms, signOut } from "../auth/session.ts";
import { useLocalization } from "../lib/localization.ts";
import { useStore } from "../store.ts";
import { Button } from "./ui/button.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog.tsx";

/**
 * The terms of use or the privacy policy changed since this Annoy account
 * accepted them. The cloud gives no access token until the new version is
 * accepted; refusing is the same as "Sair" (sign out, wipe this install).
 */
export function TermsGate() {
  const user = useStore((s) => s.global);
  const { language } = useLocalization();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!user?.termsRequired || !user.currentTerms) return null;
  const version = user.currentTerms;
  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await acceptTerms(version);
      // Cloud features started before the acceptance (friends, DMs) start over with access.
      location.reload();
    } catch (e) {
      setError(textForError(e));
      setBusy(false);
    }
  };
  // The texts people read are on annoy.geg.dev.br, in their language (the Global keeps a mirror).
  const legal = (slug: string) => `https://annoy.geg.dev.br/legal/${language === "pt-BR" ? "" : `${language}/`}${slug}/`;
  return (
    <Dialog open>
      <DialogContent className="modal terms-gate" showClose={false} onEscapeKeyDown={(event) => event.preventDefault()} onPointerDownOutside={(event) => event.preventDefault()} onInteractOutside={(event) => event.preventDefault()}>
        <div className="modal-header"><DialogTitle>{translate("terms.title")}</DialogTitle></div>
        <div className="modal-body">
          <DialogDescription>{translate("terms.body")}</DialogDescription>
          <p className="terms-links">
            <a href={legal("terms-of-use")} target="_blank" rel="noreferrer">{translate("terms.termsLink")}</a>
            <span aria-hidden> · </span>
            <a href={legal("privacy-policy")} target="_blank" rel="noreferrer">{translate("terms.privacyLink")}</a>
          </p>
          {error && <p className="error small" role="alert">{error}</p>}
          <div className="form-actions">
            <Button variant="ghost" disabled={busy} onClick={() => void signOut()}>{translate("terms.leave")}</Button>
            <Button loading={busy} onClick={() => void accept()}>{translate("terms.accept")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
