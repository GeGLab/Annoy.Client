/** Coalesce the entire operation, including policy fetches before the updater's own lock. */
export function singleFlight<T>(operation: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (pending) return pending;
    pending = Promise.resolve()
      .then(operation)
      .finally(() => {
        pending = null;
      });
    return pending;
  };
}
