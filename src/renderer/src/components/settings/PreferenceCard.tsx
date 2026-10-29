import type { ReactNode } from "react";
import { Icon, type IconName } from "../ui.tsx";
export function PreferenceCard({ title, description, icon, children }: { title: string; description: string; icon: IconName; children: ReactNode }) {
  return <div className="preference-card"><header><span className="preference-symbol"><Icon name={icon} size={22} /></span><div><h4>{title}</h4><p>{description}</p></div></header><div className="preference-card-content">{children}</div></div>;
}
