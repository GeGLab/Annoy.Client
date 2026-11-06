// 0.10 renamed the remaining "distopic.*" storage keys to "annoy.*". Move saved data once,
// before any module reads it. Imported first by store.ts and main.tsx: a split bundle can evaluate
// the store chunk before main.tsx's own code (0.10.0-alpha.5 reset everyone's settings that way).
const OLD = "distopic.";
const NEW = "annoy.";

try {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(OLD)) keys.push(key);
  }
  for (const key of keys) {
    const value = localStorage.getItem(key);
    const target = NEW + key.slice(OLD.length);
    if (value !== null && localStorage.getItem(target) === null) localStorage.setItem(target, value);
    localStorage.removeItem(key);
  }
} catch {
  // Storage unavailable: nothing to move.
}

export {};
