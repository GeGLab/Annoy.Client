// Release channels (TODO item 6). Every version carries its channel as the
// semver pre-release name: 0.10.0-alpha.1, 0.10.1-nightly.202611040300.
//
// - alpha: the default. Follows alpha, then beta, then stable releases (the
//   updater moves alpha → beta → stable by itself, never back).
// - unstable: manual test builds of a branch.
// - nightly: one build a day from main.
//
// Channels listed in LAUNCHED_CHANNELS are offered in Settings → Updates
// (all three since 0.10.0-alpha.1). docs/releases/CHANNELS.md has the details.

export const UPDATE_CHANNELS = ["alpha", "unstable", "nightly"] as const;
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

export const DEFAULT_CHANNEL: UpdateChannel = "alpha";

/** What the settings screen shows about channels. */
export interface UpdateChannelInfo {
  channel: UpdateChannel;
  launched: readonly UpdateChannel[];
  /** The running build is not part of `channel` (e.g. a nightly after choosing alpha). */
  outside: boolean;
  buildChannel: UpdateChannel;
  /** The user chose to go to `channel` now, even to an older version. */
  leaving: boolean;
}
export const LAUNCHED_CHANNELS: readonly UpdateChannel[] = ["alpha", "unstable", "nightly"];

/** Pre-release names the alpha channel accepts; "" is a stable release. */
const MAIN_LINE = new Set(["", "alpha", "beta"]);

export function isUpdateChannel(value: unknown): value is UpdateChannel {
  return typeof value === "string" && (UPDATE_CHANNELS as readonly string[]).includes(value);
}

/** "alpha", "beta", "nightly"…, or "" for a stable version. */
export function versionChannel(version: string): string {
  const pre = version.replace(/^v/, "").split("+", 1)[0]!.split("-").slice(1).join("-");
  return pre.split(".", 1)[0]!.toLowerCase();
}

/** The channel a build belongs to, from its own version. */
export function channelOfVersion(version: string): UpdateChannel {
  const name = versionChannel(version);
  return isUpdateChannel(name) && name !== "alpha" ? name : DEFAULT_CHANNEL;
}

/** Whether a release of `version` is offered to someone on `channel`. */
export function channelAccepts(channel: UpdateChannel, version: string): boolean {
  const name = versionChannel(version);
  return channel === DEFAULT_CHANNEL ? MAIN_LINE.has(name) : name === channel;
}

/**
 * The channel to follow: the saved choice when it is launched, otherwise the
 * build's own channel when that is launched, otherwise the default.
 */
export function effectiveChannel(saved: unknown, currentVersion: string, launched: readonly UpdateChannel[] = LAUNCHED_CHANNELS): UpdateChannel {
  if (isUpdateChannel(saved) && launched.includes(saved)) return saved;
  const own = channelOfVersion(currentVersion);
  return launched.includes(own) ? own : DEFAULT_CHANNEL;
}
