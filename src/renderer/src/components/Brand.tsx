import logo from "../assets/distopic.svg";
import { cn } from "../lib/utils.ts";

export function Brand({ size = 32, wordmark = false, className }: { size?: number; wordmark?: boolean; className?: string }) {
  return <span className={cn("brand", className)}><img src={logo} width={size} height={size} alt={wordmark ? "" : "Distopic"} draggable={false} />{wordmark && <span className="brand-wordmark">distopic<span className="brand-period">.</span></span>}</span>;
}
