import logo from "../assets/logo.svg";
import { cn } from "../lib/utils.ts";

export function Brand({ size = 32, wordmark = false, className }: { size?: number; wordmark?: boolean; className?: string }) {
  return <span className={cn("brand", className)}><img src={logo} width={size} height={size} alt={wordmark ? "" : "Annoy"} draggable={false} />{wordmark && <span className="brand-wordmark">annoy<span className="brand-period">.</span></span>}</span>;
}
