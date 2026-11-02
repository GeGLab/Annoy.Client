import {
  Fragment,
  createElement,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  messageTemplate,
  type MessageKey,
  number,
} from "../../../shared/localization/index.ts";
/** Text stays React text; slots can be reordered without HTML injection or translating user content. */
export function rich(
  key: MessageKey,
  values: Record<string, ReactNode>,
): ReactNode {
  return messageTemplate(key)
    .split(/(\{[a-zA-Z]\w*\})/g)
    .map((part, index) => {
      const value = values[part.slice(1, -1)];
      return /^\{\w+\}$/.test(part) && part.slice(1, -1) in values
        ? createElement(
            Fragment,
            { key: index },
            typeof value === "number" ? number(value) : value,
          )
        : part;
    });
}
import {
  localizationPreferences,
  localizationRevision,
  onLocalizationChange,
  type LocalizationPreferences,
} from "../../../shared/localization/index.ts";
export function useLocalization() {
  useSyncExternalStore(onLocalizationChange, localizationRevision);
  return localizationPreferences();
}
export function applyTextPreferences(
  preferences: LocalizationPreferences,
): void {
  document.documentElement.lang = preferences.language;
  document.documentElement.style.fontSize = `${preferences.fontSize}px`;
  document.documentElement.style.setProperty(
    "--ui-scale",
    String(preferences.fontSize / 16),
  );
  document.documentElement.dataset.underlineLinks = String(
    preferences.underlineLinks,
  );
}
