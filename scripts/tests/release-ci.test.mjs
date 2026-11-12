import { test } from "node:test";
import assert from "node:assert/strict";
import { requireReleaseCI, requiredWorkflows, validateRun } from "../require-release-ci.mjs";

const sha = "a".repeat(40);
const passed = { head_sha: sha, status: "completed", conclusion: "success" };
const jobs = requiredWorkflows[0].jobs.map(name => ({ name, status: "completed", conclusion: "success" }));

test("release requires both operating systems from the exact validated commit", () => {
  assert.doesNotThrow(() => validateRun(passed, jobs, requiredWorkflows[0].jobs, sha));
  assert.throws(() => validateRun({ ...passed, head_sha: "b".repeat(40) }, jobs, requiredWorkflows[0].jobs, sha));
  assert.throws(() => validateRun(passed, jobs.slice(0, 1), requiredWorkflows[0].jobs, sha));
  for (const conclusion of ["failure", "cancelled", "skipped", "neutral", null]) {
    assert.throws(() => validateRun({ ...passed, conclusion }, jobs, requiredWorkflows[0].jobs, sha));
    assert.throws(() => validateRun(passed, [{ ...jobs[0], conclusion }, jobs[1]], requiredWorkflows[0].jobs, sha));
  }
  for (const status of ["queued", "in_progress"]) assert.throws(() => validateRun({ ...passed, status }, jobs, requiredWorkflows[0].jobs, sha));
});

test("release fails closed when GitHub is unavailable or there are no checks", async () => {
  const options = { repository: "example/client", sha, token: "test-token" };
  await assert.rejects(requireReleaseCI({ ...options, request: async () => ({ ok: false, status: 403 }) }), /Cannot verify/);
  await assert.rejects(requireReleaseCI({ ...options, request: async () => ({ ok: true, json: async () => ({ workflow_runs: [] }) }) }), /No .* validation/);
});
