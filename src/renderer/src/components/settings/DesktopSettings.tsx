import { t } from "../../../../shared/localization/index.ts";
import type {
  DesktopPreferences,
  DesktopSnapshot,
} from "../../../../shared/desktop.ts";
import { Switch } from "../ui/switch.tsx";
import { Button } from "../ui/button.tsx";
import { requestNavigation } from "../../lib/navigation-guard.ts";
import { flushChatState } from "../../chat-state.ts";
import { toast } from "../../store.ts";
export function DesktopSettings({
  status,
  draft,
  onChange,
  disabled,
  loadError,
  refresh,
}: {
  status: DesktopSnapshot | null;
  draft: DesktopPreferences | null;
  onChange: (patch: Partial<DesktopPreferences>) => void;
  disabled: boolean;
  loadError: boolean;
  refresh: () => void;
}) {
  const api = window.annoy?.desktop;
  const restart = () =>
    requestNavigation(() => {
      flushChatState();
      void api?.restart().catch(() => toast(t("desktop.restartError")));
    });
  return (
    <section className="settings-section desktop-settings">
      <h3>{t("desktop.title")}</h3>
      <p className="muted">{t("desktop.description")}</p>
      {!api ? (
        <p role="status">{t("desktop.unsupported")}</p>
      ) : !status || !draft ? (
        <>
          <p role={loadError ? "alert" : "status"}>
            {t(loadError ? "desktop.loadError" : "desktop.loading")}
          </p>
          {loadError && (
            <Button onClick={refresh}>{t("desktop.refresh")}</Button>
          )}
        </>
      ) : (
        <>
          {(
            [
              "hardwareAcceleration",
              "startAtLogin",
              "startMinimized",
              "closeToTray",
            ] as const
          ).map((key) => {
            const labels = {
              hardwareAcceleration: "desktop.acceleration",
              startAtLogin: "desktop.startAtLogin",
              startMinimized: "desktop.startMinimized",
              closeToTray: "desktop.closeToTray",
            } as const;
            const hints = {
              hardwareAcceleration: "desktop.accelerationHint",
              startAtLogin: "desktop.startAtLoginHint",
              startMinimized: "desktop.startMinimizedHint",
              closeToTray: "desktop.closeToTrayHint",
            } as const;
            return (
              <div key={key}>
                <label className="switch-setting">
                  <span>
                    <strong>{t(labels[key])}</strong>
                    <small>{t(hints[key])}</small>
                  </span>
                  <Switch
                    aria-label={t(labels[key])}
                    checked={draft[key]}
                    disabled={disabled || !status.supported[key]}
                    onCheckedChange={(checked) => onChange({ [key]: checked })}
                  />
                </label>
                <p className="muted small">
                  {t(
                    status.saved[key] ? "desktop.savedOn" : "desktop.savedOff",
                  )}
                </p>
              </div>
            );
          })}
          <p role="status">
            {t(
              status.applied.hardwareAcceleration
                ? "desktop.appliedOn"
                : "desktop.appliedOff",
            )}
          </p>
          {status.restartRequired && (
            <div className="localization-notice" role="status">
              <p>{t("desktop.restartRequired")}</p>
              <Button disabled={disabled} onClick={restart}>
                {t("desktop.restart")}
              </Button>
            </div>
          )}
          {!status.supported.startAtLogin && (
            <p className="muted">{t("desktop.autostartUnavailable")}</p>
          )}
          {status.externalAutostartDisabled && (
            <p role="status">{t("desktop.externalDisabled")}</p>
          )}
          {!status.supported.closeToTray && (
            <p className="muted">{t("desktop.trayUnavailable")}</p>
          )}
          {status.error && <p role="alert">{t("desktop.autostartError")}</p>}
          <Button variant="ghost" disabled={disabled} onClick={refresh}>
            {t("desktop.refresh")}
          </Button>
        </>
      )}
    </section>
  );
}
