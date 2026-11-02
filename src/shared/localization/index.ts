import pt from "./catalogs/pt-BR.json" with { type: "json" };
import en from "./catalogs/en.json" with { type: "json" };
import es from "./catalogs/es.json" with { type: "json" };
import fr from "./catalogs/fr.json" with { type: "json" };
import it from "./catalogs/it.json" with { type: "json" };
import ja from "./catalogs/ja.json" with { type: "json" };
import zh from "./catalogs/zh-Hans.json" with { type: "json" };
import {
  defaultLocalization,
  normalizeLocalization,
  type Language,
  type LocalizationPreferences,
} from "./preferences.ts";
export * from "./preferences.ts";
export type MessageKey = keyof typeof pt;
export type MessageValues = Record<string, string | number | undefined | null>;
export const catalogs: Record<
  Language,
  Readonly<Partial<Record<MessageKey, string>>>
> = { "pt-BR": pt, en, es, fr, it, ja, "zh-Hans": zh };
let preferences = defaultLocalization();
let revision = 0;
const listeners = new Set<() => void>();
export const localizationPreferences = () => preferences;
export const localizationRevision = () => revision;
export const onLocalizationChange = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function configureLocalization(input: unknown): void {
  const next = normalizeLocalization(input);
  if (JSON.stringify(next) === JSON.stringify(preferences)) return;
  preferences = next;
  revision++;
  for (const listener of listeners) listener();
}
export function messageTemplate(
  key: MessageKey,
  language: Language = preferences.language,
): string {
  return catalogs[language]?.[key] ?? pt[key] ?? String(key);
}
export function t(key: MessageKey, values: MessageValues = {}): string {
  return messageTemplate(key).replace(
    /\{([a-zA-Z]\w*)\}/g,
    (token, name: string) =>
      !(name in values)
        ? token
        : typeof values[name] === "number"
          ? number(values[name])
          : String(values[name] ?? ""),
  );
}
export function plural(
  keys: Partial<Record<Intl.LDMLPluralRule, MessageKey>> & {
    other: MessageKey;
  },
  count: number,
  values: MessageValues = {},
): string {
  const category = new Intl.PluralRules(preferences.language).select(count);
  return t(keys[category] ?? keys.other, { ...values, count: number(count) });
}
export const counted = (count: number, one: MessageKey, other: MessageKey) =>
  plural({ one, other }, count);
export const number = (value: number, options: Intl.NumberFormatOptions = {}) =>
  new Intl.NumberFormat(preferences.region, options).format(value);
export const compareText = (a: string, b: string) =>
  new Intl.Collator(preferences.region, {
    numeric: true,
    sensitivity: "base",
  }).compare(a, b);
export const date = (
  value: Date | number | string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "short" },
) =>
  new Intl.DateTimeFormat(preferences.region, options).format(new Date(value));
export const time = (
  value: Date | number | string,
  options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" },
) => date(value, { ...options, hourCycle: preferences.hourCycle });
export const dateTime = (value: Date | number | string) =>
  date(value, {
    dateStyle: "short",
    timeStyle: "short",
    hourCycle: preferences.hourCycle,
  });
export function textForError(value: unknown): string {
  const source = value instanceof Error ? value.message : String(value ?? "");
  const entry = Object.entries(pt).find(([, text]) => text === source);
  return entry ? t(entry[0] as MessageKey) : source;
}
