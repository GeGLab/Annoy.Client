import { useSyncExternalStore } from "react";
import { getState, setState } from "../store.ts";
const bindings = new Set<{ accountId: string; userId: string; audio: HTMLMediaElement }>();
const listeners = new Set<() => void>();
export const volumeKey = (accountId: string, userId: string) => JSON.stringify([accountId, userId]);
export function userVolume(accountId: string, userId: string): number {
  const value = getState().settings.userVolumes?.[volumeKey(accountId, userId)];
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 100;
}
export function setUserVolume(accountId: string, userId: string, value: number): void {
  if (!Number.isFinite(value)) return;
  const volume = Math.max(0, Math.min(100, value));
  setState((s) => { s.settings.userVolumes ??= {}; s.settings.userVolumes[volumeKey(accountId, userId)] = volume; });
  for (const binding of bindings) if (binding.accountId === accountId && binding.userId === userId) binding.audio.volume = volume / 100;
  listeners.forEach((listener) => listener());
}
export function bindUserVolume(audio: HTMLMediaElement, accountId: string, userId: string): () => void {
  const binding = { audio, accountId, userId };
  bindings.add(binding);
  audio.volume = userVolume(accountId, userId) / 100;
  return () => { bindings.delete(binding); };
}
export function useUserVolume(accountId: string, userId: string): number {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => userVolume(accountId, userId));
}
