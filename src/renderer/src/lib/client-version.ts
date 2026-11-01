import { version } from "../../../../package.json";
import { compareVersions } from "../../../shared/update.ts";
import type { InstanceInfo } from "@distopic/protocol";

/** This app's version, sent to servers so they can refuse clients older than they accept. */
export const CLIENT_VERSION: string = version;

/** True when the server accepts this client. A newer client than the server always passes. */
export const clientAccepted = (info: Pick<InstanceInfo, "minClientVersion">): boolean =>
  !info.minClientVersion || compareVersions(CLIENT_VERSION, info.minClientVersion) >= 0;

export const updateRequired = (info: Pick<InstanceInfo, "minClientVersion">): string =>
  `Atualize o Annoy: este servidor exige a versão ${info.minClientVersion} ou mais nova (você tem a ${CLIENT_VERSION}).`;
