import { compareVersions, RELEASES_URL, type Advisory, type UpdateState } from "../shared/update.ts";

interface UpdateIO {
  currentVersion: string;
  updatable(): boolean;
  loadAdvisory(): Promise<Advisory | null>;
  checkForUpdates(): Promise<string | null>;
  downloadUpdate(): Promise<unknown>;
  install(): void | Promise<void>;
  publish(state: UpdateState): void;
}

/** Platform-independent state machine; electron-updater owns file verification/install. */
export function createUpdateController(io: UpdateIO) {
  let state: UpdateState = { status: "idle", currentVersion: io.currentVersion };
  let advisory: Advisory | null = null;
  let pendingVersion: string | null = null;
  let checking = false;
  let installing = false;
  const releaseUrl = (version: string) => `${RELEASES_URL}/tag/v${version}`;
  const publish = (next: UpdateState) => { state = next; io.publish(next); };
  const mandatory = () => advisory !== null;
  function error(err: unknown) {
    installing = false;
    publish({ status: "error", currentVersion: io.currentVersion, message: err instanceof Error ? err.message : String(err), mandatory: mandatory(), advisory, releaseUrl: RELEASES_URL });
  }
  async function download() {
    if (!pendingVersion || state.status === "downloading" || state.status === "ready") return;
    if (advisory && compareVersions(pendingVersion, advisory.fixedIn) < 0) return;
    publish({ status: "downloading", currentVersion: io.currentVersion, version: pendingVersion, mandatory: mandatory(), advisory, percent: 0, releaseUrl: releaseUrl(pendingVersion) });
    try { await io.downloadUpdate(); } catch (err) { error(err); }
  }
  async function check(options:{policyOnly?:boolean}={}) {
    if (!io.updatable()) return publish({ status: "disabled", currentVersion: io.currentVersion });
    if (checking || installing) return;
    checking = true;
    // Keep a known critical advisory through network outages and retries.
    if (!options.policyOnly&&!advisory && state.status !== "downloading" && state.status !== "ready") publish({ status: "checking", currentVersion: io.currentVersion });
    try {
      const loaded = await io.loadAdvisory();
      if (loaded && (!advisory || compareVersions(loaded.fixedIn, advisory.fixedIn) >= 0)) advisory = loaded;
      if(options.policyOnly&&!advisory)return;
      // Block as soon as the advisory is known, even while the feed is slow.
      if (advisory && state.status !== "ready" && state.status !== "downloading") {
        publish({ status: "blocked", currentVersion: io.currentVersion, advisory, releaseUrl: RELEASES_URL });
      }
      // A regular update may already be cached when a critical advisory arrives.
      if (state.status === "downloading") {
        if (advisory) publish({ ...state, mandatory: true, advisory });
        return;
      }
      if (state.status === "ready") {
        if (!advisory) return;
        if (compareVersions(state.version, advisory.fixedIn) >= 0) {
          publish({ ...state, mandatory: true, advisory });
          install();
          return;
        }
        publish({ status: "blocked", currentVersion: io.currentVersion, advisory, releaseUrl: RELEASES_URL });
      }
      const version = await io.checkForUpdates();
      pendingVersion = version && compareVersions(version, io.currentVersion) > 0 ? version : null;
      if (!pendingVersion || (advisory && compareVersions(pendingVersion, advisory.fixedIn) < 0)) {
        if (advisory) publish({ status: "blocked", currentVersion: io.currentVersion, advisory, releaseUrl: RELEASES_URL });
        else publish({ status: "none", currentVersion: io.currentVersion });
        return;
      }
      publish({ status: "available", currentVersion: io.currentVersion, version: pendingVersion, mandatory: mandatory(), advisory, releaseUrl: releaseUrl(pendingVersion) });
      if (mandatory()) await download();
    } catch (err) { error(err); }
    finally { checking = false; }
  }
  function downloaded(version: string) {
    if (advisory && compareVersions(version, advisory.fixedIn) < 0) {
      publish({ status: "blocked", currentVersion: io.currentVersion, advisory, releaseUrl: RELEASES_URL });
      return;
    }
    if(!pendingVersion||version!==pendingVersion||compareVersions(version,io.currentVersion)<=0){
      error(new Error('Downloaded update does not match the requested newer version'));
      return;
    }
    publish({ status: "ready", currentVersion: io.currentVersion, version, mandatory: mandatory(), advisory, releaseUrl: releaseUrl(version) });
    // Security releases restart immediately after the verified download finishes.
    if (mandatory()) install();
  }
  async function install() {
    if (state.status !== "ready" || installing) return;
    installing = true;
    try { await io.install(); } catch (err) { error(err); }
  }
  return { check, download, downloaded, install, error, getState: () => state,
    progress(percent: number) { if (state.status === "downloading") publish({ ...state, percent: Math.round(percent) }); },
  };
}
