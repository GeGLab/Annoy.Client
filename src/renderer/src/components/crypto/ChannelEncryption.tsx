import { lazy, Suspense, useEffect, useState } from "react";
import { apiFor } from "../../client.ts";
import { Field } from "../ui.tsx";
import { Button } from "../ui/button.tsx";
import { Select } from "../ui/select.tsx";
import { RadioGroup } from "../ui/radio-group.tsx";
import { PreferenceCard } from "../settings/PreferenceCard.tsx";
import { authorizeMembers, historyPolicy, importLegacy } from "./actions.ts";
const LegacyArchive = lazy(() => import("../LegacyArchive.tsx").then((module) => ({ default: module.LegacyArchive })));

/** End-to-end encryption of one conversation: participants, history for newcomers and the old plaintext archive. */
export function ChannelEncryption({ accountId, channels, members }: { accountId: string; channels: { id: string; name: string }[]; members: { id: string; name: string }[] }) {
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [active, setActive] = useState<boolean | null>(null);
  const [history, setHistory] = useState<"since_join" | "share_permanent">("since_join");
  const [owner, setOwner] = useState("");
  const [archive, setArchive] = useState(false);
  useEffect(() => {
    if (!channelId) return;
    let current = true;
    setActive(null);
    apiFor(accountId).cryptoStatus(channelId).then((status) => current && setActive(status.active), () => current && setActive(false));
    return () => { current = false; };
  }, [accountId, channelId]);
  if (!channels.length) return <p className="muted">Nenhuma conversa de texto.</p>;
  return (
    <>
      <Field label="Conversa">
        <Select value={channelId} onChange={(event) => setChannelId(event.target.value)} aria-label="Conversa">
          {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
        </Select>
      </Field>
      <p className="muted">{active === null ? "Verificando…" : active ? "Mensagens novas cifradas de ponta a ponta (OpenMLS)." : "Ainda sem grupo cifrado: a primeira mensagem segura cria o grupo."}</p>
      <PreferenceCard icon="users" title="Participantes" description="Confirme quem entra no grupo cifrado. A administração do servidor não recebe chaves.">
        <Button variant="secondary" onClick={() => void authorizeMembers(accountId, channelId)}>Revisar e autorizar participantes</Button>
      </PreferenceCard>
      <PreferenceCard icon="clock" title="Histórico para quem entra" description="Só o administrador criptográfico do canal pode mudar. Mensagens temporárias nunca são compartilhadas.">
        <RadioGroup label="Histórico para quem entra" value={history} onValueChange={(value) => setHistory(value as typeof history)} options={[
          { value: "since_join", label: "A partir da entrada" },
          { value: "share_permanent", label: "Compartilhar mensagens permanentes" },
        ]} />
        <Field label="Transferir administração criptográfica">
          <Select value={owner} onChange={(event) => setOwner(event.target.value)} aria-label="Transferir administração criptográfica">
            <option value="">Manter atual</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </Select>
        </Field>
        <Button variant="secondary" onClick={() => void historyPolicy(accountId, channelId, history, owner || null)}>Salvar política</Button>
      </PreferenceCard>
      <PreferenceCard icon="download" title="Histórico antigo" description="Mensagens de antes do E2EE ficam separadas e identificadas. Copie-as para o armazenamento local cifrado.">
        <Button variant="secondary" onClick={() => void importLegacy(accountId, channelId)}>Copiar para o armazenamento local</Button>
        {active && <Button variant="ghost" onClick={() => setArchive(true)}>Ver histórico antigo</Button>}
      </PreferenceCard>
      {archive && <Suspense fallback={null}><LegacyArchive accountId={accountId} channelId={channelId} onClose={() => setArchive(false)} /></Suspense>}
    </>
  );
}
