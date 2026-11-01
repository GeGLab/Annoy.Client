import logo from "../assets/logo.svg";
import { cn } from "../lib/utils.ts";

export function Brand({ size = 32, wordmark = false, className }: { size?: number; wordmark?: boolean; className?: string }) {
  return <span className={cn("brand", className)}><span className="brand-symbol" role={wordmark ? undefined : "img"} aria-label={wordmark ? undefined : "Annoy"} aria-hidden={wordmark || undefined} style={{ width: size, height: size, maskImage: `url(${JSON.stringify(logo)})` }} />{wordmark && <span className="brand-wordmark">annoy<span className="brand-period">.</span></span>}</span>;
}
