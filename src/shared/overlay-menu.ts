/** A context menu described as data, so the overlay layer above native views can draw it. */
export type OverlayMenuEntry =
  | { kind: "label"; text: string }
  | { kind: "separator" }
  | { kind: "item"; id: string; text: string; icon?: string; destructive?: boolean; disabled?: boolean }
  | { kind: "radio"; id: string; value: string; options: { value: string; text: string }[] };

/** The page's theme, copied to the overlay so the menu looks the same. */
export interface OverlayMenuTheme { theme: string; className: string; style: string; lang: string }

export interface OverlayMenuSpec { x: number; y: number; label: string; entries: OverlayMenuEntry[]; theme: OverlayMenuTheme }
export interface OverlayMenuPick { id: string; value?: string }

const MAX_SPEC_BYTES = 64 * 1024;
const text = (value: unknown, max = 500): value is string => typeof value === "string" && value.length <= max;

/** Main-process check of a spec coming from the renderer. */
export function parseOverlayMenuSpec(raw: unknown): OverlayMenuSpec | null {
  try { if (JSON.stringify(raw).length > MAX_SPEC_BYTES) return null; } catch { return null; }
  const spec = raw as Partial<OverlayMenuSpec>;
  if (!spec || typeof spec !== "object" || !Number.isFinite(spec.x) || !Number.isFinite(spec.y) || !text(spec.label) || !Array.isArray(spec.entries) || spec.entries.length > 100) return null;
  const theme = spec.theme as Partial<OverlayMenuTheme> | undefined;
  if (!theme || !text(theme.theme, 40) || !text(theme.className, 500) || !text(theme.style, 8000) || !text(theme.lang, 40)) return null;
  for (const entry of spec.entries as Partial<OverlayMenuEntry & { text: unknown; id: unknown; options: unknown }>[]) {
    if (entry.kind === "separator") continue;
    if (entry.kind === "label" && text(entry.text)) continue;
    if (entry.kind === "item" && text(entry.id, 100) && text(entry.text)) continue;
    if (entry.kind === "radio" && text(entry.id, 100) && Array.isArray(entry.options) && entry.options.length <= 20 && entry.options.every((o: { value?: unknown; text?: unknown }) => text(o?.value, 100) && text(o?.text))) continue;
    return null;
  }
  return { x: spec.x!, y: spec.y!, label: spec.label!, entries: spec.entries as OverlayMenuEntry[], theme: theme as OverlayMenuTheme };
}

export function parseOverlayMenuPick(raw: unknown): OverlayMenuPick | null {
  const pick = raw as Partial<OverlayMenuPick> | null;
  if (!pick || !text(pick.id, 100) || (pick.value !== undefined && !text(pick.value, 100))) return null;
  return pick.value === undefined ? { id: pick.id } : { id: pick.id, value: pick.value };
}
