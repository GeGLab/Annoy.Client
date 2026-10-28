// The wire protocol is owned by distopic-server; this copies it from a sibling checkout.
import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const source = resolve(process.argv[2] ?? "../distopic-server/packages/protocol/src");
if (!existsSync(source)) {
  console.error(`Protocol source not found: ${source}\nUsage: npm run sync:protocol -- <path to distopic-server/packages/protocol/src>`);
  process.exit(1);
}
cpSync(source, resolve("packages/protocol/src"), { recursive: true });
console.log(`Synced protocol from ${source}`);
