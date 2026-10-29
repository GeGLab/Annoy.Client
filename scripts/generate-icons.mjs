import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";
import pngToIco from "png-to-ico";

// The authored vector is the single source for renderer, taskbar and installer.
const svg = await readFile(new URL("../src/renderer/src/assets/distopic.svg", import.meta.url));
const render = width => Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng());
await mkdir(new URL("../src/renderer/public/", import.meta.url), { recursive: true });
await Promise.all([
  writeFile(new URL("../build/icon.svg", import.meta.url), svg),
  writeFile(new URL("../build/icon.png", import.meta.url), render(512)),
  writeFile(new URL("../build/icon.ico", import.meta.url), await pngToIco([16, 24, 32, 48, 64, 128, 256].map(render))),
  writeFile(new URL("../src/renderer/public/favicon.svg", import.meta.url), svg),
  writeFile(new URL("../src/renderer/public/icon.png", import.meta.url), render(512)),
]);
console.log("Distopic icons generated from src/renderer/src/assets/distopic.svg");
