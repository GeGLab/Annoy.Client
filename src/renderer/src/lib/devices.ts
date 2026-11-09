// Saved microphone, speaker and camera choices.
//
// Chromium device IDs are not stable: they change when the app's storage or
// its device salt changes. The choice is saved with the device name too, so
// the same device is found again under its new ID. The saved choice itself is
// never changed here.
import { getState, setState, type Settings } from "../store.ts";
import { SCREEN_AUDIO_DEVICE } from "../media-profiles.ts";

/** Devices to offer: Annoy's own screen-share microphone (Linux) is not one. */
export const selectableDevices = (list: readonly MediaDeviceInfo[]) => list.filter((d) => d.label !== SCREEN_AUDIO_DEVICE);

export type DeviceSlot = "input" | "output" | "camera";

const KIND: Record<DeviceSlot, MediaDeviceKind> = { input: "audioinput", output: "audiooutput", camera: "videoinput" };
const ID_KEY = { input: "inputDeviceId", output: "outputDeviceId", camera: "cameraDeviceId" } as const;
const LABEL_KEY = { input: "inputDeviceLabel", output: "outputDeviceLabel", camera: "cameraDeviceLabel" } as const;

/** Settings fields for a chosen device: its ID and its name. */
export function deviceChoice(slot: DeviceSlot, id: string, devices: readonly MediaDeviceInfo[]): Partial<Settings> {
  const label = id === "default" ? "" : (devices.find((d) => d.kind === KIND[slot] && d.deviceId === id)?.label ?? "");
  return { [ID_KEY[slot]]: id, [LABEL_KEY[slot]]: label };
}

/**
 * The current ID of a saved device: the saved ID when it still exists, else the
 * device with the saved name. Undefined means the system default (also when the
 * device is not connected right now).
 */
export async function resolveDevice(slot: DeviceSlot, id: string, label: string): Promise<string | undefined> {
  if (!id || id === "default") return undefined;
  let devices: MediaDeviceInfo[];
  try {
    devices = selectableDevices(await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === KIND[slot] && d.deviceId !== "default");
  } catch {
    return id;
  }
  const same = devices.find((d) => d.deviceId === id);
  if (same) {
    // Choices saved before names were kept: remember the name of the same device.
    if (!label && same.label) {
      const settings = getState().settings;
      if (settings[ID_KEY[slot]] === id && !settings[LABEL_KEY[slot]]) setState((s) => { s.settings[LABEL_KEY[slot]] = same.label; });
    }
    return id;
  }
  return label ? devices.find((d) => d.label === label)?.deviceId : undefined;
}

/** resolveDevice for the device saved in the settings. */
export function savedDevice(slot: DeviceSlot, settings: Settings = getState().settings): Promise<string | undefined> {
  return resolveDevice(slot, settings[ID_KEY[slot]], settings[LABEL_KEY[slot]]);
}

/** Which entry of a device list shows as selected: the saved ID, or the device with the saved name. */
export function shownDevice(id: string, label: string, devices: readonly MediaDeviceInfo[]): string {
  if (id === "default" || devices.some((d) => d.deviceId === id)) return id;
  return (label && devices.find((d) => d.label === label)?.deviceId) || id;
}
