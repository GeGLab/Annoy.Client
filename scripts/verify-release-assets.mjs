import assert from 'node:assert/strict';
import { readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { authenticateUpdate, matchUpdateMetadata, verifyUpdateFile } from '../src/main/update-signature.ts';
import { UPDATE_TRUST, UPDATE_KEY_CHANNELS } from '../src/main/update-trust.ts';
import { parseReleaseVersion } from './lib/release-plan.mjs';
const { load } = createRequire(import.meta.url)('js-yaml');

export async function verifyReleaseAssets(directory, version) {
  parseReleaseVersion(version);
  const files = ['Annoy-Setup-x64.exe.blockmap'];
  assert.ok((await lstat(join(directory, files[0]))).size > 0);
  for (const [platform, suffix] of [['win32', ''], ['linux', '-linux']]) {
    const name = `annoy-${platform}-x64-${version}.signed.json`;
    const manifest = authenticateUpdate(JSON.parse(await readFile(join(directory, name), 'utf8')), UPDATE_TRUST, { version, platform, arch: 'x64' }, UPDATE_KEY_CHANNELS);
    const texts = await Promise.all(['latest', 'alpha'].map(channel => readFile(join(directory, `${channel}${suffix}.yml`), 'utf8')));
    assert.equal(texts[0], texts[1], 'Main-line update feeds must match');
    matchUpdateMetadata(manifest, load(texts[0]));
    await verifyUpdateFile(join(directory, manifest.filename), manifest);
    files.push(name, manifest.filename, `latest${suffix}.yml`, `alpha${suffix}.yml`);
    console.log(`${platform}: pinned signature, installer hash and metadata verified`);
  }
  return files;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await verifyReleaseAssets(process.argv[2], process.argv[3]);
