type Action = () => void;
let guard: ((action: Action) => void) | null = null;
export function requestNavigation(action: Action) { if (guard) guard(action); else action(); }
export function registerNavigationGuard(next: (action: Action) => void) {
  guard = next; return () => { if (guard === next) guard = null; };
}
