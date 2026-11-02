import {
  existsSync,
  readFileSync,
  unlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
/** Desktop Entry Exec quoting is not shell quoting. Escape both levels specified by XDG. */
export function xdgEntry(executable: string): string {
  if (!isAbsolute(executable) || /[\u0000-\u001f=]/.test(executable))
    throw new Error("Invalid AppImage path");
  const quoted = executable
    .replace(/\\/g, "\\\\\\\\")
    .replace(/"/g, '\\\\"')
    .replace(/`/g, "\\\\`")
    .replace(/\$/g, "\\\\$")
    .replace(/%/g, "%%");
  return `[Desktop Entry]\nType=Application\nVersion=1.0\nName=Annoy\nExec="${quoted}" --annoy-autostart\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`;
}
export function stableAppImage(file: string | undefined): file is string {
  if (
    !file ||
    !isAbsolute(file) ||
    !existsSync(file) ||
    /[\u0000-\u001f=]/.test(file)
  )
    return false;
  try {
    const normalized = realpathSync(file).replaceAll("\\", "/");
    return (
      statSync(file).isFile() &&
      !/(?:^|\/)(?:tmp|temp|\.mount_[^/]*)(?:\/|$)/i.test(normalized)
    );
  } catch {
    return false;
  }
}
export function xdgAutostartPath(
  configHome: string | undefined,
  home: string,
): string {
  return join(
    configHome && isAbsolute(configHome) ? configHome : join(home, ".config"),
    "autostart",
    "annoy.desktop",
  );
}
export function readXdgAutostart(file: string, executable: string): boolean {
  try {
    const text = readFileSync(file, "utf8");
    return (
      !/^\s*(?:Hidden=true|X-GNOME-Autostart-enabled=false)\s*$/m.test(text) &&
      text.includes(
        xdgEntry(executable)
          .split("\n")
          .find((line) => line.startsWith("Exec="))!,
      )
    );
  } catch {
    return false;
  }
}
export function setXdgAutostart(
  file: string,
  executable: string,
  enabled: boolean,
): void {
  if (!enabled) {
    if (existsSync(file)) unlinkSync(file);
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  const staged = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(staged, xdgEntry(executable), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    renameSync(staged, file);
  } finally {
    if (existsSync(staged)) unlinkSync(staged);
  }
}
