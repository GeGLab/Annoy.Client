// `npm run dev:isolated`: the development app with its own profile, so it runs next to the
// installed Annoy (separate single-instance lock, cache, sign-in and preferences).
// Arguments go straight to electron-vite as an array: no shell can swallow the "--" separator.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const name = process.env.ANNOY_DEV_PROFILE || "Annoy-Dev";
const base = process.platform === "win32" ? process.env.APPDATA || join(homedir(), "AppData", "Roaming")
  : process.platform === "darwin" ? join(homedir(), "Library", "Application Support")
  : process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const profile = resolve(base, name);

const cli = join(dirname(require.resolve("electron-vite/package.json")), "bin", "electron-vite.js");
console.log(`Annoy dev profile: ${profile}`);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // Set by VS Code's terminal; it would start Electron as plain Node.
const child = spawn(process.execPath, [cli, "dev", "--watch", ...process.argv.slice(2), "--", `--user-data-dir=${profile}`], { stdio: "inherit", env });
child.on("exit", (code, signal) => process.exit(signal ? 1 : code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
