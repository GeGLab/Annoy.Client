// Reproducible, deliberately curated catalog. Never import private/provider packs.
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../src/renderer/public/expression/", import.meta.url);
const revision = "66e17da0f2d4347f64ee9d78c367fc5234283863"; // OpenMoji 16.0.0
const origin = `https://raw.githubusercontent.com/hfg-gmuend/openmoji/${revision}/`;
const definitions = [
  ["openmoji-animals", "Bichos do OpenMoji", "animals", [["1F431", "Gato"], ["1F436", "Cachorro"], ["1F438", "Sapo"], ["1F98A", "Raposa"], ["1F43C", "Panda"], ["1F984", "Unicórnio"]]],
  ["openmoji-faces", "Sorrisos do OpenMoji", "reactions", [["1F600", "Sorriso feliz"], ["1F602", "Chorando de rir"], ["1F60D", "Apaixonado"], ["1F60E", "Óculos legal"], ["1F914", "Pensando"], ["1F62D", "Chorando"]]],
  ["openmoji-food", "Sabores do OpenMoji", "food", [["1F355", "Pizza"], ["1F354", "Hambúrguer"], ["1F34E", "Maçã"], ["1F353", "Morango"], ["1F366", "Sorvete"], ["2615", "Café"]]],
  ["openmoji-nature", "Natureza do OpenMoji", "nature", [["1F308", "Arco-íris"], ["1F319", "Lua"], ["2B50", "Estrela"], ["1F33B", "Girassol"], ["1F332", "Árvore"], ["1F335", "Cacto"]]],
  ["openmoji-celebration", "Festa do OpenMoji", "reactions", [["1F389", "Festa"], ["1F388", "Balão"], ["1F381", "Presente"], ["1F382", "Bolo"], ["1F3C6", "Troféu"], ["1F386", "Fogos"]]],
  ["openmoji-play", "Diversão do OpenMoji", "activities", [["1F3AE", "Jogo"], ["1F680", "Foguete"], ["1F3B5", "Música"], ["26BD", "Futebol"], ["1F3B2", "Dado"], ["1F3A8", "Arte"]]],
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
await mkdir(new URL("catalog/1/", root), { recursive: true });
async function download(path, target) {
  const response = await fetch(origin + path, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`OpenMoji ${path}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(new URL(target, root), bytes);
  return bytes;
}
await download("LICENSE.txt", "openmoji/LICENSE.txt");
const packs = [];
for (const [id, name, category, entries] of definitions) {
  const items = [];
  for (const [code, name] of entries) {
    const bytes = await download(`color/618x618/${code}.png`, `openmoji/${code}.png`);
    items.push({ id: code, name, kind: "sticker", url: `openmoji/${code}.png`, sha256: digest(bytes) });
  }
  const pack = { id, name, category, author: "OpenMoji", version: "16.0.0", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/", source: `https://github.com/hfg-gmuend/openmoji/tree/${revision}/color/618x618`, credits: "All emojis designed by OpenMoji, the open-source emoji and icon project. HfG Schwäbisch Gmünd, Benedikt Groß, Daniel Utz, students and external contributors. Unmodified PNG artwork.", items };
  packs.push(pack);
}
const index = { schemaVersion: 1, version: "1", packs: [] };
for (let offset = 0; offset < packs.length; offset += 2) {
  const page = `catalog/1/page-${offset / 2 + 1}.json`;
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, version: "1", packs: packs.slice(offset, offset + 2) }, null, 2) + "\n");
  await writeFile(new URL(page, root), bytes);
  for (const pack of packs.slice(offset, offset + 2)) index.packs.push({ id: pack.id, name: pack.name, category: pack.category, search: pack.items.map((item) => item.name).join(" "), page, sha256: digest(bytes) });
}
await writeFile(new URL("catalog/index.json", root), JSON.stringify(index, null, 2) + "\n");
await writeFile(new URL("openmoji/ATTRIBUTION.md", root), `# OpenMoji 16.0.0\n\nAll emojis designed by OpenMoji, the open-source emoji and icon project.\nHfG Schwäbisch Gmünd, Benedikt Groß, Daniel Utz, students and external contributors.\n\nUnmodified PNG artwork from https://github.com/hfg-gmuend/openmoji/tree/${revision}/color/618x618.\nLicensed CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/.\nFull license: [LICENSE.txt](LICENSE.txt).\n\nDistributed assets and SHA-256 hashes: [catalog pages](../catalog/1/page-1.json),\n[page 2](../catalog/1/page-2.json), [page 3](../catalog/1/page-3.json).\n`);
console.log(`Prepared ${packs.length} packs with ${packs.reduce((sum, pack) => sum + pack.items.length, 0)} licensed assets.`);
