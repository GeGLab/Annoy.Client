// Update state shared by the main process (owner) and the renderer (display).

export interface Advisory {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  /** First version that is no longer affected. */
  fixedIn: string;
  summary: string;
  url?: string;
}

export type UpdateState =
  /** Development builds and unsupported packages never update themselves. */
  | { status: "disabled"; currentVersion: string }
  | { status: "idle" | "checking" | "none"; currentVersion: string }
  | { status: "available"; currentVersion: string; version: string; mandatory: boolean; advisory: Advisory | null; releaseUrl: string }
  | { status: "downloading"; currentVersion: string; version: string; mandatory: boolean; advisory: Advisory | null; percent: number; releaseUrl: string }
  | { status: "ready"; currentVersion: string; version: string; mandatory: boolean; advisory: Advisory | null; releaseUrl: string }
  /**
   * A critical advisory affects this version, but no installable update was
   * found (for example, release assets are still uploading).
   */
  | { status: "blocked"; currentVersion: string; advisory: Advisory; releaseUrl: string }
  | { status: "error"; currentVersion: string; message: string; mandatory: boolean; advisory: Advisory | null; releaseUrl: string };

export const RELEASES_URL = "https://github.com/GeGLab/annoy-client/releases";

/**
 * Semver precedence: numeric x.y.z, a pre-release sorts before its release,
 * and pre-release identifiers compare one by one (numbers numerically, so
 * alpha.10 > alpha.9; numbers before words; alpha < beta < nightly).
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const plain = v.replace(/^v/, "").split("+", 1)[0]!;
    const dash = plain.indexOf("-");
    const core = dash < 0 ? plain : plain.slice(0, dash);
    const pre = dash < 0 ? [] : plain.slice(dash + 1).split(".");
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  if (x.pre.length && !y.pre.length) return -1;
  if (!x.pre.length && y.pre.length) return 1;
  const numeric = /^\d+$/;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = numeric.test(p);
    const qn = numeric.test(q);
    if (pn && qn) return Math.sign(Number(p) - Number(q));
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

/** The most urgent critical advisory that still affects `version`, if any. */
export function blockingAdvisory(advisories: readonly Advisory[], version: string): Advisory | null {
  const open = advisories.filter((a) => a.severity === "critical" && compareVersions(version, a.fixedIn) < 0);
  open.sort((a, b) => compareVersions(b.fixedIn, a.fixedIn));
  return open[0] ?? null;
}
