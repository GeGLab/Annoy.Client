import { Icon } from "../../components/ui.tsx";
const sources = import.meta.glob<string>("../../assets/providers/*.svg", { eager: true, query: "?url", import: "default" });
export function DevelopmentIcon({ name, size = 24 }: { name: string; size?: number }) {
  const src = sources[`../../assets/providers/${name}.svg`];
  return src ? <img className={`provider-icon provider-${name}`} src={src} width={size} height={size} alt="" aria-hidden /> : <Icon name="code" size={size} />;
}
