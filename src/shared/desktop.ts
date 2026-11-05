export interface DesktopPreferences {
  hardwareAcceleration: boolean;
  startAtLogin: boolean;
  startMinimized: boolean;
  closeToTray: boolean;
}
export interface DesktopSnapshot {
  saved: DesktopPreferences;
  applied: DesktopPreferences;
  supported: Record<keyof DesktopPreferences, boolean>;
  restartRequired: boolean;
  externalAutostartDisabled: boolean;
  error: string | null;
}
export const desktopDefaults = (_platform: string): DesktopPreferences => ({
  hardwareAcceleration: true,
  startAtLogin: true,
  startMinimized: false,
  closeToTray: true,
});
export function normalizeDesktop(
  value: unknown,
  platform: string,
): DesktopPreferences {
  const defaults = desktopDefaults(platform);
  if (!value || typeof value !== "object") return defaults;
  for (const key of Object.keys(defaults) as (keyof DesktopPreferences)[]) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "boolean") defaults[key] = candidate;
  }
  return defaults;
}
export function parseDesktop(value: unknown): DesktopPreferences {
  const keys = Object.keys(desktopDefaults("win32"));
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some(
      (key) => typeof (value as Record<string, unknown>)[key] !== "boolean",
    )
  )
    throw new Error("Invalid desktop preferences");
  return { ...value } as DesktopPreferences;
}
export function localMainFrame(
  event: { sender: unknown; senderFrame: unknown },
  contents: { mainFrame: unknown } | undefined,
): boolean {
  return (
    !!contents &&
    event.sender === contents &&
    event.senderFrame === contents.mainFrame
  );
}
