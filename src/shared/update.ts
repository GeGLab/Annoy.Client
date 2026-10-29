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

export const RELEASES_URL = "https://github.com/GustavoHSCruz/annoy-client/releases";

/** Numeric x.y.z comparison; a pre-release sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = "", pre] = v.replace(/^v/, "").split("-", 2);
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  if (x.pre && !y.pre) return -1;
  if (!x.pre && y.pre) return 1;
  return (x.pre ?? "").localeCompare(y.pre ?? "");
}

/** The most urgent critical advisory that still affects `version`, if any. */
export function blockingAdvisory(advisories: readonly Advisory[], version: string): Advisory | null {
  const open = advisories.filter((a) => a.severity === "critical" && compareVersions(version, a.fixedIn) < 0);
  open.sort((a, b) => compareVersions(b.fixedIn, a.fixedIn));
  return open[0] ?? null;
}
