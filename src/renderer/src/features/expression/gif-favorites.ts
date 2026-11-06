// GIPHY GIFs starred by the Annoy account. They live in usersannoy, so every
// device signed in to the account sees the same list (newest first).
import { useSyncExternalStore } from "react";
import { cloud } from "../../social/cloud.ts";
import { getState } from "../../store.ts";

let ids: readonly string[] = [];
let loading: Promise<readonly string[]> | null = null;
const listeners = new Set<() => void>();

function set(next: string[]): readonly string[] {
  if (next.length === ids.length && next.every((id, i) => id === ids[i])) return ids;
  ids = next;
  for (const listener of listeners) listener();
  return ids;
}

/** Favorites need the Annoy account; servers without it have none. */
export const gifFavoritesAvailable = () => getState().access.global;

/** Reads the list from the account again. */
export function loadGifFavorites(): Promise<readonly string[]> {
  if (!gifFavoritesAvailable()) return Promise.resolve(set([]));
  loading ??= cloud<{ ids: string[] }>("users", "/v1/users/@me/gif-favorites")
    .then((result) => set(result.ids))
    .finally(() => { loading = null; });
  return loading;
}

export async function toggleGifFavorite(id: string): Promise<void> {
  const result = await cloud<{ ids: string[] }>("users", `/v1/users/@me/gif-favorites/${encodeURIComponent(id)}`, { method: ids.includes(id) ? "DELETE" : "PUT" });
  set(result.ids);
}

let firstLoad = false;
export function useGifFavorites(): readonly string[] {
  if (!firstLoad && gifFavoritesAvailable()) {
    firstLoad = true;
    void loadGifFavorites().catch(() => { firstLoad = false; });
  }
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => ids,
  );
}
