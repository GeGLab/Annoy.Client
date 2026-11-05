import { t as translate } from "../../../shared/localization/index.ts";
import { SignInForm } from "./auth/SignInForm.tsx";
import { Brand } from "./Brand.tsx";
import { Button } from "./ui/button.tsx";
import { openModal } from "./ui.tsx";

/**
 * What the app shows before anyone signs in (TODO item 2.2): the Annoy
 * account first; separate, in the same card, a server that uses its own
 * local accounts instead.
 */
export function AuthGate() {
  return (
    <main className="auth-gate" aria-labelledby="auth-gate-title">
      <section className="auth-gate-card">
        <Brand size={52} wordmark />
        <h1 id="auth-gate-title">{translate("common.87fa6f65b17e")}</h1>
        <SignInForm />
        <div className="or"><span>{translate("common.69eb14f15555")}</span></div>
        <section className="auth-gate-local" aria-label={translate("common.69eb14f15555")}>
          <p className="muted small">{translate("auth.localHelp")}</p>
          <Button variant="secondary" onClick={() => openModal({ kind: "addAccount" })}>{translate("common.970cfa322bb7")}</Button>
        </section>
      </section>
    </main>
  );
}
