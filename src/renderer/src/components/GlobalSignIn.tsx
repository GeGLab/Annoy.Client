import {t as translate} from "../../../shared/localization/index.ts";
import { useState, type FormEvent } from "react";
import { GLOBAL_URL, signInGlobal } from "../global.ts";
import { Field } from "./ui.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";

export function GlobalSignIn({ onSignedIn, intro = translate("common.3e5e4aa4b996"), email: savedEmail = "" }: { onSignedIn?: () => void; intro?: string; email?: string } = {}) {
  const [email, setEmail] = useState(savedEmail);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await signInGlobal(email, password); setPassword(""); onSignedIn?.(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return <form className="form" onSubmit={submit}>
    <p>{intro}</p>
    <Field label={translate("common.24e65f3cb123")}><Input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required /></Field>
    <Field label={translate("common.57ad2312e776")}><Input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required /></Field>
    {error && <p className="error">{error}</p>}
    <Button type="submit" loading={busy}>{translate("common.b7105e36e55e")}</Button>
    <a href={`${GLOBAL_URL}/cadastro`} target="_blank" rel="noreferrer">{translate("common.1a4d12808232")}</a>
  </form>;
}

