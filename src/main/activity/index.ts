import type { BrowserWindow, IpcMain } from "electron";
import type { ActivityPreferences, DesktopActivitySnapshot } from "../../shared/activity.ts";
import { probeWindows } from "./windows.ts";
import { probeLinux } from "./linux.ts";
/** Main-process boundary: local OS details never cross preload. Detection runs only while opted in. */
export function registerActivity(ipc: IpcMain, window: () => BrowserWindow | null) {
  let preferences: ActivityPreferences = { games: false, music: false };
  const supported = process.platform === "win32" || process.platform === "linux";
  let snapshot: DesktopActivitySnapshot = { supported, activities: [], error: null };
  let timer: ReturnType<typeof setTimeout> | null = null,
    generation = 0;
  let controller: AbortController | null = null;
  const publish = () => window()?.webContents.send("activity:snapshot", snapshot);
  const poll = async (version: number) => {
    try {
      controller = new AbortController();
      const next = await (process.platform === "linux" ? probeLinux : probeWindows)(preferences, controller.signal);
      if (version !== generation) return;
      next.activities = next.activities.map((item) => {
        const old = snapshot.activities.find(
          (a) => a.kind === item.kind && a.name === item.name && a.appId === item.appId && a.artist === item.artist,
        );
        return { ...item, startedAt: old?.startedAt ?? Date.now() };
      });
      snapshot = next;
    } catch {
      if (version !== generation) return;
      snapshot = {
        supported: true,
        activities: [],
        error: "Não foi possível ler a atividade. A leitura será tentada novamente.",
      };
    }
    publish();
    if (version === generation) timer = setTimeout(() => void poll(version), 15_000);
  };
  ipc.handle("activity:configure", (event, input: unknown) => {
    if (event.sender !== window()?.webContents || event.senderFrame !== window()?.webContents.mainFrame)
      throw new Error("Invalid activity sender");
    const values = input as Partial<ActivityPreferences> | null;
    preferences = { games: values?.games === true, music: values?.music === true, development: values?.development === true };
    ++generation;
    controller?.abort();
    if (timer) clearTimeout(timer);
    timer = null;
    snapshot = { supported, activities: [], error: null };
    publish();
    if (snapshot.supported && (preferences.games || preferences.music || preferences.development)) void poll(generation);
    return snapshot;
  });
  ipc.handle("activity:get", (event) => {
    if (event.sender !== window()?.webContents || event.senderFrame !== window()?.webContents.mainFrame)
      throw new Error("Invalid activity sender");
    return snapshot;
  });
  return () => {
    ++generation;
    controller?.abort();
    if (timer) clearTimeout(timer);
  };
}
