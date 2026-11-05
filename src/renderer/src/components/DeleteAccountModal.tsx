import {t as translate} from "../../../shared/localization/index.ts";
import { Input } from "./ui/input.tsx";
import { useState } from "react";
import { apiFor, removeAccount } from "../client.ts";
import { toast, useStore } from "../store.ts";
import { act, closeModal, Field, Modal } from "./ui.tsx";

/** Self-service account deletion. */
export function DeleteAccountModal({ accountId }: { accountId: string }) {
  const user = useStore((s) => s.instances[accountId]?.user);
  const [confirmText, setConfirmText] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const submit = async () => {
    setBusy(true);
    const ok = await act(apiFor(accountId).request("DELETE", "/users/@me", { confirm: confirmText, password: password || undefined }));
    setBusy(false);
    if (ok) {
      closeModal();
      removeAccount(accountId, "remove");
      toast(translate("common.56a84683d20d"));
    }
  };
  return (
    <Modal title={translate("common.37642ff749e3")}>
      <div className="form">
        <p className="warning">{translate("common.34bb391049e7")}</p>
        <Field label={translate("common.a5c92f994d5e",{p0:(user.username)})}>
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={user.username} />
        </Field>
        <Field label={translate("common.d482c10b3d4d")} hint={translate("common.e9ad4c3911c9")}>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        <div className="form-actions">
          <button className="btn btn-ghost" onClick={closeModal}>{translate("common.bb9dbb406dcb")}</button>
          <button className="btn btn-danger" disabled={busy || confirmText.trim().toLowerCase() !== user.username.toLowerCase()} onClick={() => void submit()}>{translate("common.8d9113221273")}</button>
        </div>
      </div>
    </Modal>
  );
}
