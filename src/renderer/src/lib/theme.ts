import type { Settings } from "../store.ts";
import { applyAppearance } from "./appearance.ts";

export type Theme = "dark" | "light" | "system";
export function applyTheme(theme: Settings["theme"], appearance?: Pick<Settings, "accentColor" | "surfaceColor">) {
  const resolved = theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.classList.toggle("dark", resolved === "dark");
  if (appearance) applyAppearance(appearance);
}
