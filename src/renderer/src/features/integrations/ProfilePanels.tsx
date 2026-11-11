import { useEffect, useState } from "react";
import { isPublicHttpsUrl } from "@annoy/protocol";
import { t as translate } from "../../../../shared/localization/index.ts";
import { IntegrationIcon } from "./Setup.tsx";
import { integrationById, loadCatalog, profilePanelsOf, type ProfilePanel } from "./state.ts";

/** Panels an Annoy account chose to show on its profile (e.g. SteamProfiler's card). */
export function ProfilePanels({ annoyId }: { annoyId: string | null | undefined }) {
  const [panels, setPanels] = useState<ProfilePanel[]>([]);
  useEffect(() => {
    if (!annoyId) return;
    let active = true;
    void Promise.all([profilePanelsOf(annoyId), loadCatalog()]).then(([shown]) => active && setPanels(shown.filter((p) => isPublicHttpsUrl(p.image) && (!p.link || isPublicHttpsUrl(p.link)))));
    return () => { active = false; };
  }, [annoyId]);
  if (!panels.length) return null;
  return (
    <>
      {panels.map((panel) => {
        const integration = integrationById(panel.integration);
        const name = integration?.name ?? panel.integration;
        const image = <img className="profile-panel-image" src={panel.image} alt={name} loading="lazy" referrerPolicy="no-referrer" />;
        return (
          <section key={panel.integration} className="profile-panel">
            <h3>{integration && <IntegrationIcon integration={integration} size={18} />}{name}</h3>
            {panel.link ? <a href={panel.link} target="_blank" rel="noreferrer" aria-label={translate("integrations.website")}>{image}</a> : image}
          </section>
        );
      })}
    </>
  );
}
