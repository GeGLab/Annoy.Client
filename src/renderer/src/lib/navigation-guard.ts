type Action = () => void;
type Guard = { run: (action: Action) => void };
const guards: Guard[] = [];
export function requestNavigation(action: Action) {
  const pending = [...guards];
  const next = (index: number): void => {
    const guard = pending[index];
    if (!guard) {
      action();
      return;
    }
    if (!guards.includes(guard)) {
      next(index - 1);
      return;
    }
    guard.run(() => next(index - 1));
  };
  next(pending.length - 1);
}
export function registerNavigationGuard(next: (action: Action) => void) {
  const guard = { run: next };
  guards.push(guard);
  return () => {
    const index = guards.indexOf(guard);
    if (index >= 0) guards.splice(index, 1);
  };
}
