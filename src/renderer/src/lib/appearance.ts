import type { Settings } from "../store.ts";

const HEX = /^#[\da-f]{6}$/i;
export function validColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}
function rgb(hex: string) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
function luminance(hex: string) {
  const values = rgb(hex).map((v) => {
    const n = v / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
}
function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (x! + 0.05) / (y! + 0.05);
}
function mix(a: string, b: string, amount: number) {
  const other = rgb(b);
  return `#${rgb(a)
    .map((v, i) =>
      Math.round(v * (1 - amount) + other[i]! * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
/** Keep personalized colors readable in either theme, including extreme picks. */
export function readableColor(color: string, background: string) {
  const target = luminance(background) > 0.4 ? "#000000" : "#ffffff";
  for (let step = 0; step <= 20; step++) {
    const candidate = mix(color, target, step / 20);
    if (contrast(candidate, background) >= 4.5) return candidate;
  }
  return target;
}

const CUSTOM_PROPERTIES = [
  "--accent",
  "--accent-hover",
  "--accent-strong",
  "--accent-soft",
  "--accent-line",
  "--on-accent",
  "--link",
  "--mention",
  "--bg-rail",
  "--bg-channels",
  "--bg-main",
  "--bg-elev",
  "--bg-hover",
  "--bg-active",
  "--bg-input",
  "--bg-deep",
  "--border",
  "--border-strong",
];
export function applyAppearance(settings: Pick<Settings, "accentColor" | "surfaceColor">) {
  const root = document.documentElement;
  for (const key of CUSTOM_PROPERTIES) root.style.removeProperty(key);
  const light = root.dataset.theme === "light";
  if (validColor(settings.surfaceColor)) {
    // Limit tint saturation to preserve neutral surfaces and text contrast.
    const base = mix(light ? "#fcfbf9" : "#27292f", settings.surfaceColor, 0.12);
    for (const [key, amount] of Object.entries({
      "--bg-rail": 0.3,
      "--bg-channels": 0.14,
      "--bg-main": 0,
      "--bg-elev": -0.05,
      "--bg-hover": -0.09,
      "--bg-active": -0.14,
      "--bg-input": -0.05,
      "--bg-deep": 0.2,
    })) {
      root.style.setProperty(
        key,
        mix(base, amount >= 0 ? (light ? "#c6c1b7" : "#000000") : light ? "#b6b0a7" : "#ffffff", Math.abs(amount)),
      );
    }
  }
  if (validColor(settings.accentColor)) {
    const background = getComputedStyle(root).getPropertyValue("--bg-main").trim();
    const accent = readableColor(settings.accentColor, background);
    const foreground = contrast(accent, "#ffffff") >= 4.5 ? "#ffffff" : "#17191d";
    root.style.setProperty("--accent", accent);
    root.style.setProperty("--accent-hover", mix(accent, foreground === "#ffffff" ? "#000000" : "#ffffff", 0.08));
    root.style.setProperty("--accent-strong", readableColor(accent, background));
    root.style.setProperty("--on-accent", foreground);
    root.style.setProperty("--accent-soft", `${accent}17`);
    root.style.setProperty("--accent-line", `${accent}66`);
    root.style.setProperty("--mention", `${accent}10`);
    root.style.setProperty("--link", accent);
  }
}
