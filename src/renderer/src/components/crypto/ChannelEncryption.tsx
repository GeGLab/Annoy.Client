import {t as translate} from "../../../../shared/localization/index.ts";
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
  if (!channels.length) return <p className="muted">{translate("common.ef6dc37dbbd7")}</p>;
  return (
    <>
      <Field label={translate("common.2377f109281b")}>
        <Select value={channelId} onChange={(event) => setChannelId(event.target.value)} aria-label={translate("common.2377f109281b")}>
          {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
        </Select>
      </Field>
      <p className="muted">{active === null ? translate("update.checking") : active ? translate("common.2d2922c321a0") : translate("common.0b47963a3ffe")}</p>
      <PreferenceCard icon="users" title={translate("common.aff4a93487ce")} description={translate("common.ed93093cef1e")}>
        <Button variant="secondary" onClick={() => void authorizeMembers(accountId, channelId)}>{translate("common.929575d76c04")}</Button>
      </PreferenceCard>
      <PreferenceCard icon="clock" title={translate("common.7483ffa24285")} description={translate("common.ae7f8b09878a")}>
        <RadioGroup label={translate("common.7483ffa24285")} value={history} onValueChange={(value) => setHistory(value as typeof history)} options={[
          { value: "since_join", label: translate("common.9cf705e80ca6") },
          { value: "share_permanent", label: translate("common.008095b07de9") },
        ]} />
        <Field label={translate("common.e913f4e81170")}>
          <Select value={owner} onChange={(event) => setOwner(event.target.value)} aria-label={translate("common.e913f4e81170")}>
            <option value="">{translate("common.6258628a7ecb")}</option>
            {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </Select>
        </Field>
        <Button variant="secondary" onClick={() => void historyPolicy(accountId, channelId, history, owner || null)}>{translate("common.46f4d24b9641")}</Button>
      </PreferenceCard>
      <PreferenceCard icon="download" title={translate("common.261efb77c20f")} description={translate("common.1509c544b2fe")}>
        <Button variant="secondary" onClick={() => void importLegacy(accountId, channelId)}>{translate("common.ad88105b7f15")}</Button>
        {active && <Button variant="ghost" onClick={() => setArchive(true)}>{translate("common.ac8f631399c0")}</Button>}
      </PreferenceCard>
      {archive && <Suspense fallback={null}><LegacyArchive accountId={accountId} channelId={channelId} onClose={() => setArchive(false)} /></Suspense>}
    </>
  );
}
