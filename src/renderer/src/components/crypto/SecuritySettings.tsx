import { useState } from "react";
import { useStore } from "../../store.ts";
import { Field } from "../ui.tsx";
import { Button } from "../ui/button.tsx";
import { Select } from "../ui/select.tsx";
import { PreferenceCard } from "../settings/PreferenceCard.tsx";
import { backup, devices, restore, unlockVault, verifyIdentity } from "./actions.ts";
import { ChannelEncryption } from "./ChannelEncryption.tsx";

/** Settings → Privacy and security: this device's keys and the direct messages of each account. */
export function SecuritySettings() {
  const accounts = useStore((s) => s.accounts);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const instance = useStore((s) => s.instances[accountId]);
  if (!window.distopic?.crypto) return <p className="muted">A criptografia de ponta a ponta exige o aplicativo Annoy para desktop.</p>;
  if (!accounts.length) return <p className="muted">Entre em uma instância para configurar a criptografia.</p>;
  const me = instance?.user?.id;
  const dms = (instance?.dms ?? []).map((dm) => ({ id: dm.id, name: dm.recipients.filter((r) => r.id !== me).map((r) => r.displayName).join(", ") || "Mensagem direta" }));
  const people = [...new Map((instance?.dms ?? []).flatMap((dm) => dm.recipients).filter((r) => r.id !== me).map((r) => [r.id, { id: r.id, name: r.displayName }])).values()];
  return (
    <>
      {accounts.length > 1 && (
        <Field label="Conta">
          <Select value={accountId} onChange={(event) => setAccountId(event.target.value)} aria-label="Conta">
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.instanceName ?? account.url}</option>)}
          </Select>
        </Field>
      )}
      <PreferenceCard icon="lock" title="Armazenamento local" description="Guarda as chaves e o histórico cifrados neste computador. Sem o chaveiro do sistema, use uma senha.">
        <Button variant="secondary" onClick={() => void unlockVault()}>Desbloquear com senha</Button>
      </PreferenceCard>
      <PreferenceCard icon="shield" title="Verificar identidade" description="Compare códigos de segurança com outra pessoa por um canal externo para confirmar as chaves dela.">
        <Button variant="secondary" onClick={() => void verifyIdentity(accountId)}>Comparar códigos</Button>
      </PreferenceCard>
      <PreferenceCard icon="save" title="Backup cifrado" description="Inclui o histórico permanente. Sem a chave de recuperação, perder os dispositivos pode apagar os dados de vez.">
        <Button variant="secondary" onClick={() => void backup(accountId)}>Criar backup</Button>
        <Button variant="ghost" onClick={() => void restore(accountId)}>Restaurar</Button>
      </PreferenceCard>
      <PreferenceCard icon="monitor" title="Dispositivos" description="Veja os dispositivos com acesso às suas conversas cifradas e revogue os que não usa.">
        <Button variant="secondary" onClick={() => void devices(accountId)}>Gerenciar dispositivos</Button>
      </PreferenceCard>
      <h4>Mensagens diretas</h4>
      <ChannelEncryption key={accountId} accountId={accountId} channels={dms} members={people} />
    </>
  );
}
