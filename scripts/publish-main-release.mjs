import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { githubApi, requireMergedMain } from './lib/github-api.mjs';
import { verifyReleaseAssets } from './verify-release-assets.mjs';

const [directory, version] = process.argv.slice(2), sha = process.env.GITHUB_SHA, repository = process.env.GITHUB_REPOSITORY;
const api = githubApi(), tag = `v${version}`;
await requireMergedMain(api, sha);
const files = await verifyReleaseAssets(directory, version);
const reference = await api(`/git/ref/tags/${tag}`, { missing: true });
if (reference && reference.object.sha !== sha) throw new Error('Published/existing tags are immutable');
if (!reference) await api('/git/refs', { method: 'POST', body: { ref: `refs/tags/${tag}`, sha } });
const gh = args => execFileSync('gh', [...args, '--repo', repository], { stdio: 'inherit' });
const existing = await api(`/releases/tags/${tag}`, { missing: true });
if (existing && !existing.draft) throw new Error('Refusing to overwrite a published release');
if (!existing) gh(['release', 'create', tag, '--verify-tag', '--target', sha, '--draft', '--prerelease=false', '--title', `Annoy ${version}`, '--generate-notes']);
gh(['release', 'upload', tag, ...files.map(name => resolve(directory, name)), '--clobber']);
const downloaded = await mkdtemp(join(tmpdir(), 'annoy-release-verify-'));
try {
  gh(['release', 'download', tag, '--dir', downloaded]);
  await verifyReleaseAssets(downloaded, version);
  await requireMergedMain(api, sha);
  gh(['release', 'edit', tag, '--draft=false', '--latest', '--prerelease=false', '--verify-tag']);
} finally { await rm(downloaded, { recursive: true, force: true }); }
console.log(`Published ${tag} only after merged-main validation and verified signed artifacts`);
