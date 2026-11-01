import type { MediaKind } from "./library.ts";

const pickers = new Set<(kind: MediaKind) => void>();
const listeners = new Set<() => void>();
export const hasMediaPicker = () => pickers.size > 0;
export function subscribeMediaPicker(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function registerMediaPicker(picker: (kind: MediaKind) => void) {
  pickers.add(picker);
  listeners.forEach((listener) => listener());
  return () => { pickers.delete(picker); listeners.forEach((listener) => listener()); };
}
export function openMediaPicker(kind: MediaKind) {
  pickers.forEach((picker) => picker(kind));
}
