import { useState, type FormEvent } from "react";
import { GLOBAL_URL, signInGlobal } from "../global.ts";
import { Field } from "./ui.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";

export function GlobalSignIn({ onSignedIn, intro = "Entre ou cadastre uma conta Annoy para continuar." }: { onSignedIn?: () => void; intro?: string } = {}) {
  const [email, setEmail] = useState("");
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
    <Field label="E-mail da conta Annoy"><Input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required /></Field>
    <Field label="Senha da conta Annoy"><Input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required /></Field>
    {error && <p className="error">{error}</p>}
    <Button type="submit" loading={busy}>Entrar na conta Annoy</Button>
    <a href={`${GLOBAL_URL}/cadastro`} target="_blank" rel="noreferrer">Cadastrar conta Annoy</a>
  </form>;
}

