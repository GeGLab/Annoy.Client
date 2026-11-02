import {t as translate} from "../../../../shared/localization/index.ts";
import { useStore } from "../../store.ts";
import { Button } from "../ui/button.tsx";
import { PreferenceCard } from "../settings/PreferenceCard.tsx";
import { backup, devices, restore, unlockVault, verifyIdentity } from "./actions.ts";
import { ChannelEncryption } from "./ChannelEncryption.tsx";

/** Settings → Privacy and security: this device's keys and the direct messages of each account. */
export function SecuritySettings({ accountId }: { accountId: string | null }) {
  const instance = useStore((s) => (accountId ? s.instances[accountId] : undefined));
  if (!window.distopic?.crypto) return <p className="muted">{translate("common.51e52ae737b8")}</p>;
  if (!accountId) return <p className="muted">{translate("common.05bd39d16a8d")}</p>;
  const me = instance?.user?.id;
  const dms = (instance?.dms ?? []).map((dm) => ({ id: dm.id, name: dm.recipients.filter((r) => r.id !== me).map((r) => r.displayName).join(", ") || "Mensagem direta" }));
  const people = [...new Map((instance?.dms ?? []).flatMap((dm) => dm.recipients).filter((r) => r.id !== me).map((r) => [r.id, { id: r.id, name: r.displayName }])).values()];
  return (
    <>

      <PreferenceCard icon="lock" title={translate("common.5727114d4cbc")} description={translate("common.9f3193e4aff4")}>
        <Button variant="secondary" onClick={() => void unlockVault()}>{translate("common.2dc3806a9b9a")}</Button>
      </PreferenceCard>
      <PreferenceCard icon="shield" title={translate("common.edad75dbb2d8")} description={translate("common.181fc1939780")}>
        <Button variant="secondary" onClick={() => void verifyIdentity(accountId)}>{translate("common.79af1df48af2")}</Button>
      </PreferenceCard>
      <PreferenceCard icon="save" title={translate("common.84bc59832c10")} description={translate("common.f40210b716ab")}>
        <Button variant="secondary" onClick={() => void backup(accountId)}>{translate("common.bede320142c8")}</Button>
        <Button variant="ghost" onClick={() => void restore(accountId)}>{translate("common.eda02893d340")}</Button>
      </PreferenceCard>
      <PreferenceCard icon="monitor" title={translate("settings.a70a1e628334")} description={translate("common.9c1fd0da6bc2")}>
        <Button variant="secondary" onClick={() => void devices(accountId)}>{translate("common.59edfed69e15")}</Button>
      </PreferenceCard>
      <h4>{translate("common.53c413d8aae2")}</h4>
      <ChannelEncryption key={accountId} accountId={accountId} channels={dms} members={people} />
    </>
  );
}
