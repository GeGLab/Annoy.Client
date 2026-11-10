/** Curated palettes share the same semantic tokens in light and dark mode. */
export const THEME_PRESETS = [
  { id: "classic", dark: "#171621", light: "#fcfbf9", accent: "#ffb020", lightAccent: "#8b5400" },
  { id: "midnight", dark: "#101522", light: "#f3f5fc", accent: "#a6b4ff", lightAccent: "#4c50ae" },
  { id: "ocean", dark: "#0d202b", light: "#f0f8fc", accent: "#67d5f5", lightAccent: "#006b88" },
  { id: "aurora", dark: "#12231f", light: "#f1f8f3", accent: "#7cdeb0", lightAccent: "#236d4c" },
  { id: "sakura", dark: "#291c2b", light: "#fff4f8", accent: "#f5a6cf", lightAccent: "#a32d69" },
  { id: "coffee", dark: "#261e1a", light: "#fbf4e8", accent: "#e4b78c", lightAccent: "#80512e" },
] as const;
export type ThemePreset = (typeof THEME_PRESETS)[number]["id"];
export function themePreset(value: unknown) {
  return THEME_PRESETS.find((preset) => preset.id === value) ?? THEME_PRESETS[0];
}
