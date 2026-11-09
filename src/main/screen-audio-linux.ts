import { execFile, spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Screen-share sound on Linux. Chromium's "loopback" there records the whole
 * output, Annoy's own playback included, so viewers would hear the call back.
 * Instead a virtual microphone is fed with every app's playback except
 * Annoy's (PipeWire links; the apps keep playing to the speakers as before).
 * Needs PipeWire with pactl and pw-link, which every PipeWire desktop ships.
 */

const SOURCE = "annoy-screen-audio";
/** The device name the renderer looks for in its microphone list. */
export const SCREEN_AUDIO_LABEL = "Annoy screen audio";

const run = (command: string, args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 5000 }, (error, stdout) => (error ? reject(error) : resolve(stdout))),
  );

interface PwObject {
  id: number;
  type: string;
  info?: { direction?: string; props?: Record<string, unknown> };
}

/** Speaker channel of the virtual microphone each playback channel goes to. */
const LEFT = new Set(["FL", "FLC", "RL", "SL", "TFL", "TRL", "AUX0", "MONO", "FC"]);
const RIGHT = new Set(["FR", "FRC", "RR", "SR", "TFR", "TRR", "AUX1", "MONO", "FC"]);

function parentOf(pid: number): number {
  try {
    // Field 4 of /proc/<pid>/stat, after the command name in parentheses.
    return Number(readFileSync(`/proc/${pid}/stat`, "utf8").replace(/^.*\) /s, "").split(" ")[1]) || 0;
  } catch {
    return 0;
  }
}

/** True for Annoy's own processes (Chromium plays sound from a child process). */
function ownProcess(pid: number): boolean {
  for (let current = pid, depth = 0; current > 1 && depth < 64; depth++) {
    if (current === process.pid) return true;
    current = parentOf(current);
  }
  return false;
}

let moduleId: string | null = null;
let watcher: ChildProcess | null = null;
let relinkTimers: NodeJS.Timeout[] = [];
let linking: Promise<void> = Promise.resolve();

async function linkAll(): Promise<void> {
  const objects = JSON.parse(await run("pw-dump", [])) as PwObject[];
  const ports = objects.filter((o) => o.type === "PipeWire:Interface:Port" && o.info?.props);
  const target = objects.find((o) => o.type === "PipeWire:Interface:Node" && o.info?.props?.["node.name"] === SOURCE);
  if (!target) return;
  const inputs = ports.filter((p) => p.info!.props!["node.id"] === target.id && p.info!.direction === "input");
  const left = inputs.find((p) => p.info!.props!["audio.channel"] === "FL");
  const right = inputs.find((p) => p.info!.props!["audio.channel"] === "FR");
  if (!left || !right) return;
  const links = new Set(
    objects.filter((o) => o.type === "PipeWire:Interface:Link").map((o) => `${o.info?.props?.["link.output.port"]}>${o.info?.props?.["link.input.port"]}`),
  );
  const pending: Promise<unknown>[] = [];
  for (const node of objects) {
    const props = node.info?.props;
    if (node.type !== "PipeWire:Interface:Node" || props?.["media.class"] !== "Stream/Output/Audio") continue;
    if (ownProcess(Number(props["application.process.id"]))) continue;
    for (const port of ports) {
      const p = port.info!.props!;
      if (p["node.id"] !== node.id || port.info!.direction !== "output" || p["port.monitor"] === true || p["port.monitor"] === "true") continue;
      const channel = String(p["audio.channel"] ?? "");
      for (const input of [LEFT.has(channel) ? left : null, RIGHT.has(channel) ? right : null]) {
        if (input && !links.has(`${port.id}>${input.id}`)) pending.push(run("pw-link", [String(port.id), String(input.id)]).catch(() => undefined));
      }
    }
  }
  await Promise.all(pending);
}

/** Links run one at a time; ports of a new stream show up shortly after the stream. */
function scheduleRelink(): void {
  for (const timer of relinkTimers) clearTimeout(timer);
  relinkTimers = [300, 1500].map((delay) =>
    setTimeout(() => {
      linking = linking.then(() => (moduleId ? linkAll() : undefined)).catch(() => undefined);
    }, delay),
  );
}

/** Removes a virtual microphone left by an Annoy that closed without cleaning up. */
async function unloadLeftovers(): Promise<void> {
  const modules = await run("pactl", ["list", "short", "modules"]).catch(() => "");
  for (const line of modules.split("\n")) {
    const [id, name, args] = line.split("\t");
    if (id && name === "module-null-sink" && args?.includes(`sink_name=${SOURCE}`)) await run("pactl", ["unload-module", id]).catch(() => undefined);
  }
}

/** Creates the virtual microphone and keeps it fed; returns its device name, or null when the system can't. */
export async function startScreenAudio(): Promise<string | null> {
  if (process.platform !== "linux") return null;
  if (moduleId) return SCREEN_AUDIO_LABEL;
  try {
    await unloadLeftovers();
    moduleId = (
      await run("pactl", [
        "load-module",
        "module-null-sink",
        `media.class=Audio/Source/Virtual sink_name=${SOURCE} channel_map=front-left,front-right sink_properties="device.description=\\"${SCREEN_AUDIO_LABEL}\\" priority.session=0 priority.driver=0"`,
      ])
    ).trim();
    await linkAll();
    // New players (a game started later, the next video) are linked as they appear.
    watcher = spawn("pactl", ["subscribe"], { stdio: ["ignore", "pipe", "ignore"] });
    watcher.stdout?.setEncoding("utf8");
    watcher.stdout?.on("data", (chunk: string) => {
      if (/'new' on sink-input/.test(chunk)) scheduleRelink();
    });
    watcher.on("error", () => undefined);
    return SCREEN_AUDIO_LABEL;
  } catch (error) {
    console.warn("screen audio unavailable", error);
    await stopScreenAudio();
    return null;
  }
}

export async function stopScreenAudio(): Promise<void> {
  for (const timer of relinkTimers) clearTimeout(timer);
  relinkTimers = [];
  watcher?.kill();
  watcher = null;
  const id = moduleId;
  moduleId = null;
  if (id) await run("pactl", ["unload-module", id]).catch(() => undefined);
}

/** For app exit: the module outlives Annoy otherwise. */
export function stopScreenAudioNow(): void {
  watcher?.kill();
  watcher = null;
  if (moduleId) spawn("pactl", ["unload-module", moduleId], { stdio: "ignore", detached: true }).unref();
  moduleId = null;
}
