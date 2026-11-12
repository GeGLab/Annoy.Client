import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { planRelease, requireMergedPullRequest } from '../lib/release-plan.mjs';
import { requireMergedMain } from '../lib/github-api.mjs';
import { readyToMerge, requiredChecks } from '../lib/approved-merge.mjs';
const sha = 'a'.repeat(40), other = 'b'.repeat(40);
const release = (version, extra = {}) => ({ tag_name: `v${version}`, draft: false, prerelease: false, commit: other, ...extra });

test('accepted changes get the next alpha automatically, while explicit higher versions are respected', () => {
  assert.equal(planRelease('0.12.0-alpha.5', [release('0.12.0-alpha.5')], sha).version, '0.12.0-alpha.6');
  assert.equal(planRelease('0.12.0-alpha.5', [release('0.12.0-alpha.9')], sha).version, '0.12.0-alpha.10');
  assert.equal(planRelease('0.13.0-beta.1', [release('0.12.0-alpha.5')], sha).version, '0.13.0-beta.1');
  assert.equal(planRelease('1.0.0', [release('1.0.2')], sha).version, '1.0.3');
});
test('retrying one merged commit resumes its draft or skips its public release without a second version', () => {
  assert.deepEqual(planRelease('0.12.0-alpha.5', [release('0.12.0-alpha.6', { commit: sha })], sha), { version: '0.12.0-alpha.6', publish: false, resume: true });
  assert.deepEqual(planRelease('0.12.0-alpha.5', [release('0.12.0-alpha.6', { commit: sha, draft: true })], sha), { version: '0.12.0-alpha.6', publish: true, resume: true });
});
test('failed drafts and orphan tags belonging to another revision never get overwritten', () => {
  assert.equal(planRelease('0.12.0-alpha.5', [release('0.12.0-alpha.5'), release('0.12.0-alpha.6', { draft: true })], sha).version, '0.12.0-alpha.7');
  assert.throws(() => planRelease('0.12.0-nightly.20261112', [], sha));
});
test('release requires an actual merge of this exact commit into main', async () => {
  const merged = { merged_at: 'today', merge_commit_sha: sha, base: { ref: 'main' } };
  assert.equal(requireMergedPullRequest([merged], sha), merged);
  for (const changed of [{ ...merged, merged_at: null }, { ...merged, merge_commit_sha: other }, { ...merged, base: { ref: 'experimental' } }]) assert.throws(() => requireMergedPullRequest([changed], sha));
  await assert.rejects(requireMergedMain(async () => ({ status: 'diverged', base_commit: { sha } }), sha), /not part of main/);
  const api = async path => path.startsWith('/compare/') ? { status: 'ahead', base_commit: { sha } } : [merged];
  assert.equal(await requireMergedMain(api, sha), merged);
});
test('automatic merge needs a trusted approval on the current head and four genuine green checks', () => {
  const pull = { state: 'open', draft: false, base: { ref: 'main' }, head: { sha }, mergeable: true, mergeable_state: 'clean' };
  const review = { user: { login: 'owner' }, state: 'APPROVED', commit_id: sha };
  const checks = requiredChecks.map(name => ({ name, app: { id: 15368 }, status: 'completed', conclusion: 'success', head_sha: sha }));
  const trusted = new Set(['owner']);
  assert.equal(readyToMerge(pull, [review], checks, trusted), true);
  for (const changes of [{ draft: true }, { mergeable: false }, { mergeable_state: 'behind' }]) assert.equal(readyToMerge({ ...pull, ...changes }, [review], checks, trusted), false);
  assert.equal(readyToMerge(pull, [], checks, trusted), false);
  assert.equal(readyToMerge(pull, [review], checks, new Set()), false);
  assert.equal(readyToMerge(pull, [{ ...review, commit_id: other }], checks, trusted), false);
  for (const changed of [{ conclusion: 'failure' }, { conclusion: 'skipped' }, { status: 'in_progress' }, { app: { id: 99 } }, { head_sha: other }]) assert.equal(readyToMerge(pull, [review], [{ ...checks[0], ...changed }, ...checks.slice(1)], trusted), false);
  assert.equal(readyToMerge(pull, [review, { ...review, state: 'CHANGES_REQUESTED' }], checks, trusted), false);
});
test('release workflow validates the stamped version on both platforms before exposing the signing key', async () => {
  const { load } = createRequire(import.meta.url)('js-yaml');
  const workflow = load(await readFile(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8'));
  assert.deepEqual(workflow.on.push.branches, ['main']);
  assert.equal(workflow.on.release, undefined);
  assert.deepEqual(workflow.jobs.publish.needs, ['prepare', 'desktop', 'security']);
  assert.equal(workflow.jobs.desktop.with.release_version, workflow.jobs.security.with.release_version);
  assert.ok(workflow.jobs.prepare.if.includes("refs/heads/main"));
  const merge = load(await readFile(new URL('../../.github/workflows/approved-pr-merge.yml', import.meta.url), 'utf8'));
  assert.equal(merge.jobs.merge.steps[0].with.ref, 'main', 'Privileged merge automation must never execute a fork checkout');
  assert.ok(merge.on.workflow_run.workflows.includes('pr-review'));
});
