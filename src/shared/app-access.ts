export interface AppAccessState {
  allowed: boolean;
  global: boolean;
  localAccounts: string[];
}

export const LOCKED_ACCESS: AppAccessState = { allowed: false, global: false, localAccounts: [] };
