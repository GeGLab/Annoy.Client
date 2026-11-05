import { useEffect, useState, type FormEvent } from "react";
import { t as translate } from "../../../../shared/localization/index.ts";
import { accountWebsite, lastUsername, signIn } from "../../auth/session.ts";
import { Field } from "../ui.tsx";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";

/** Username or e-mail, and password (TODO item 2.2). The username of the last sign-in comes filled in. */
export function SignInForm({ onSignedIn, intro, identifier: given }: { onSignedIn?: () => void; intro?: string; identifier?: string } = {}) {
  const [identifier, setIdentifier] = useState(given || lastUsername());
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [website, setWebsite] = useState(accountWebsite());
  useEffect(() => setWebsite(accountWebsite()), [busy]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(identifier, password);
      setPassword("");
      onSignedIn?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form sign-in-form" onSubmit={submit}>
      {intro && <p>{intro}</p>}
      <Field label={translate("auth.identifier")}>
        <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" autoCapitalize="off" spellCheck={false} required autoFocus={!identifier} />
      </Field>
      <Field label={translate("auth.password")}>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required autoFocus={!!identifier} />
      </Field>
      {error && <p className="error" role="alert">{error}</p>}
      <Button type="submit" loading={busy}>{translate("auth.signIn")}</Button>
      <div className="sign-in-links">
        <a href={`${website}/cadastro`} target="_blank" rel="noreferrer">{translate("auth.createAccount")}</a>
        <a href={`${website}/esqueci`} target="_blank" rel="noreferrer">{translate("auth.forgot")}</a>
      </div>
    </form>
  );
}
