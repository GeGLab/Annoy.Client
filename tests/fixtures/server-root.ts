import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Support the renamed sibling checkout and CI's explicit checkout directory. */
export function serverRoot(): string {
  const configured = process.env.ANNOY_SERVER_TEST_ROOT;
  const candidates = configured ? [configured] : ["../Annoy.Server", "../annoy-server"];
  const root = candidates.map((path) => resolve(path)).find((path) => existsSync(resolve(path, "tests/fixtures/crypto-desktop.ts")));
  if (!root) throw new Error("Annoy.Server test checkout missing; set ANNOY_SERVER_TEST_ROOT.");
  return root;
}
