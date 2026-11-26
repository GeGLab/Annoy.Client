// Saved server accounts: the list lives in localStorage without credentials and, with the
// bearer tokens, in the encrypted secrets store. These rules keep a failed secrets read from
// wiping the tokens, and let an account that lost its token sign in again.

interface SavedAccount { token: string; pending?: string }

/**
 * What to restore at start. The secrets copy wins. Without it (a failed read, or an install
 * from before the secrets store), the localStorage list is used, but it is written back to
 * the secrets store only when it still carries tokens (the old format): a token-less list
 * written there would erase the real tokens the next time the read works.
 */
export function accountsToRestore<T extends SavedAccount>(saved: string | null | undefined, legacy: T[]): { accounts: T[]; persist: boolean } {
  if (saved) {
    try {
      const value = JSON.parse(saved) as unknown;
      if (Array.isArray(value)) return { accounts: value as T[], persist: true };
    } catch {
      /* unreadable copy: fall back to the list */
    }
  }
  return { accounts: legacy, persist: legacy.some((account) => !!account.token) };
}

/** An account that can connect: signed in (a token) and not a placeholder waiting for sign-in. */
export const usableAccount = (account: SavedAccount): boolean => !account.pending && !!account.token;
