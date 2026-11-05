import { t as translate } from "../../../../shared/localization/index.ts";
import { useCallback, useEffect, useRef, useState } from "react";

const SHOWN_MS = 2600;

/** Shows the saved notice for a moment after each successful save. */
export function useSavedNotice(): [boolean, () => void] {
  const [shownAt, setShownAt] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = useCallback(() => {
    clearTimeout(timer.current);
    setShownAt(Date.now());
    timer.current = setTimeout(() => setShownAt(null), SHOWN_MS);
  }, []);
  return [shownAt !== null, show];
}

/** Sits where the save bar was, inside the settings window. */
export function SavedNotice() {
  return (
    <div className="settings-savebar settings-saved" role="status">
      <svg className="saved-check" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
        <circle className="saved-check-circle" cx="12" cy="12" r="10.5" />
        <path className="saved-check-mark" d="M7.2 12.4l3.1 3.1 6.5-6.7" />
      </svg>
      <span>{translate("settings.733e6e6b42e7")}</span>
    </div>
  );
}
