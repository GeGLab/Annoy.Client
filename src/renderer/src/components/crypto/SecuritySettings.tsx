import { useStore } from "../../store.ts";
import { Button } from "../ui/button.tsx";
import { PreferenceCard } from "../settings/PreferenceCard.tsx";
import { backup, devices, restore, unlockVault, verifyIdentity } from "./actions.ts";
import { ChannelEncryption } from "./ChannelEncryption.tsx";

/** Settings → Privacy and security: this device's keys and the direct messages of each account. */
export function SecuritySettings({ accountId }: { accountId: string | null }) {
  const instance = useStore((s) => (accountId ? s.instances[accountId] : undefined));
  if (!window.distopic?.crypto) return <p className="muted">A criptografia de ponta a ponta exige o aplicativo Annoy para desktop.</p>;
  if (!accountId) return <p className="muted">A criptografia vale por servidor. Selecione uma conta de servidor em Trocar de conta.</p>;
  const me = instance?.user?.id;
  const dms = (instance?.dms ?? []).map((dm) => ({ id: dm.id, name: dm.recipients.filter((r) => r.id !== me).map((r) => r.displayName).join(", ") || "Mensagem direta" }));
  const people = [...new Map((instance?.dms ?? []).flatMap((dm) => dm.recipients).filter((r) => r.id !== me).map((r) => [r.id, { id: r.id, name: r.displayName }])).values()];
  return (
    <>

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
