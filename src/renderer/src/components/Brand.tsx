import logo from "../assets/logo.svg";
import classic from "../assets/classic.png";
import { cn } from "../lib/utils.ts";
import { useStore } from "../store.ts";
import type { AppIcon } from "../../../shared/app-icon.ts";

export const brandImage = (icon: AppIcon) => (icon === "classic" ? classic : logo);

export function Brand({ size = 32, wordmark = false, className, icon }: { size?: number; wordmark?: boolean; className?: string; icon?: AppIcon }) {
  const chosen = useStore((s) => s.settings.appIcon);
  return <span className={cn("brand", className)}><img src={brandImage(icon ?? chosen)} width={size} height={size} alt={wordmark ? "" : "Annoy"} draggable={false} />{wordmark && <span className="brand-wordmark">annoy<span className="brand-period">.</span></span>}</span>;
}
