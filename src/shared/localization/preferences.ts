/** Text size in px for the whole interface (Settings → Language and accessibility). */
export const FONT_SIZE = { min: 10, max: 20, default: 14 } as const;
export const LANGUAGES = [
  "pt-BR",
  "en",
  "es",
  "fr",
  "it",
  "ja",
  "zh-Hans",
] as const;
export type Language = (typeof LANGUAGES)[number];
export interface LocalizationPreferences {
  language: Language;
  previousLanguage: Language | null;
  region: string;
  hourCycle: "h12" | "h23";
  fontSize: number;
  underlineLinks: boolean;
}
export const LANGUAGE_NAMES: Record<Language, string> = {
  "pt-BR": "Português (Brasil)",
  en: "English",
  es: "Español",
  fr: "Français",
  it: "Italiano",
  ja: "日本語",
  "zh-Hans": "简体中文",
};
export const validLanguage = (value: unknown): value is Language =>
  typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
export function validRegion(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  try {
    return (
      !!new Intl.Locale(value).region &&
      Intl.DateTimeFormat.supportedLocalesOf([value]).length === 1
    );
  } catch {
    return false;
  }
}
export function defaultLocalization(
  systemLocale = "pt-BR",
): LocalizationPreferences {
  const region = validRegion(systemLocale)
    ? Intl.getCanonicalLocales(systemLocale)[0]!
    : "pt-BR";
  const cycle = new Intl.DateTimeFormat(region, {
    hour: "numeric",
  }).resolvedOptions().hourCycle;
  return {
    language: "pt-BR",
    previousLanguage: null,
    region,
    hourCycle: cycle === "h11" || cycle === "h12" ? "h12" : "h23",
    fontSize: FONT_SIZE.default,
    underlineLinks: true,
  };
}
export function normalizeLocalization(
  value: unknown,
  systemLocale = "pt-BR",
): LocalizationPreferences {
  const defaults = defaultLocalization(systemLocale),
    input =
      value && typeof value === "object"
        ? (value as Partial<LocalizationPreferences>)
        : {};
  return {
    language: validLanguage(input.language)
      ? input.language
      : defaults.language,
    previousLanguage: validLanguage(input.previousLanguage)
      ? input.previousLanguage
      : null,
    region: validRegion(input.region)
      ? Intl.getCanonicalLocales(input.region)[0]!
      : defaults.region,
    hourCycle:
      input.hourCycle === "h12" || input.hourCycle === "h23"
        ? input.hourCycle
        : defaults.hourCycle,
    fontSize:
      typeof input.fontSize === "number" && Number.isFinite(input.fontSize)
        ? Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, Math.round(input.fontSize)))
        : FONT_SIZE.default,
    underlineLinks:
      typeof input.underlineLinks === "boolean" ? input.underlineLinks : true,
  };
}
