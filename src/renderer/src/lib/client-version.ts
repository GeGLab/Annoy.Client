import {t as translate} from "../../../shared/localization/index.ts";
import { version } from "../../../../package.json";
import { compareVersions } from "../../../shared/update.ts";
import type { InstanceInfo } from "@annoy/protocol";

/** This app's version, sent to servers so they can refuse clients older than they accept. */
export const CLIENT_VERSION: string = version;

/** True when the server accepts this client. A newer client than the server always passes. */
export const clientAccepted = (info: Pick<InstanceInfo, "minClientVersion">): boolean =>
  !info.minClientVersion || compareVersions(CLIENT_VERSION, info.minClientVersion) >= 0;

export const updateRequired = (info: Pick<InstanceInfo, "minClientVersion">): string =>
  translate("common.b7fc2e9eddb1",{p0:(info.minClientVersion),p1:(CLIENT_VERSION)});
