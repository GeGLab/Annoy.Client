import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
export function readPreferences<T>(
  file: string,
  normalize: (value: unknown) => T,
): T {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (
      parsed &&
      typeof parsed === "object" &&
      "version" in parsed &&
      parsed.version === 1 &&
      "values" in parsed
    )
      return normalize(parsed.values);
  } catch {}
  return normalize(null);
}
/** Rename commits the complete document; a failed write never replaces the last saved preferences. */
export function writePreferences<T>(file: string, values: T): void {
  mkdirSync(dirname(file), { recursive: true });
  const staged = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(staged, JSON.stringify({ version: 1, values }), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    renameSync(staged, file);
  } finally {
    if (existsSync(staged))
      try {
        unlinkSync(staged);
      } catch {}
  }
}
