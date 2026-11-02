import { app, type BrowserWindow, type IpcMain } from "electron";
import { join } from "node:path";
import {
  configureLocalization,
  normalizeLocalization,
  type LocalizationPreferences,
} from "../shared/localization/index.ts";
import { readPreferences, writePreferences } from "./settings-file.ts";
export function registerLocalization(
  ipc: IpcMain,
  window: () => BrowserWindow | null,
): void {
  const file = join(app.getPath("userData"), "localization.json");
  let saved = readPreferences(file, normalizeLocalization);
  configureLocalization(saved);
  const local = (event: Electron.IpcMainInvokeEvent) =>
    event.sender === window()?.webContents &&
    event.senderFrame === window()?.webContents.mainFrame;
  ipc.handle("localization:get", (event) => {
    if (!local(event)) throw new Error("Invalid localization sender");
    return {
      saved,
      systemLocale:
        app.getLocale() || Intl.DateTimeFormat().resolvedOptions().locale,
    };
  });
  ipc.handle("localization:set", (event, input: LocalizationPreferences) => {
    if (!local(event)) throw new Error("Invalid localization sender");
    const next = normalizeLocalization(input);
    writePreferences(file, next);
    saved = next;
    configureLocalization(saved);
    return saved;
  });
}
