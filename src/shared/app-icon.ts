/** The Annoy icon used inside the app, on the window/taskbar and in the tray. */
export const APP_ICONS = ["white", "classic"] as const;
export type AppIcon = (typeof APP_ICONS)[number];
export const normalizeAppIcon = (value: unknown): AppIcon =>
  APP_ICONS.includes(value as AppIcon) ? (value as AppIcon) : "white";
/** File name inside the renderer's public folder. */
export const appIconFile = (icon: AppIcon) => (icon === "classic" ? "classic.png" : "icon.png");
