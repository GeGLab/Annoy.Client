import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const requiredWorkflows = [
  { file: "desktop-validation.yml", jobs: ["desktop (windows-latest, --win --x64, dist/win-unpacked/Annoy.exe)", "desktop (ubuntu-latest, --linux --x64, dist/Annoy-x86_64.AppImage)"] },
  { file: "security.yml", jobs: ["validation (ubuntu-latest)", "validation (windows-latest)"] },
];

export function validateRun(run, jobs, requiredJobs, sha) {
  if (!run || run.head_sha !== sha || run.status !== "completed" || run.conclusion !== "success")
    throw new Error(`CI must have completed successfully for ${sha}: ${run?.html_url ?? "no matching run"}`);
  for (const required of requiredJobs) {
    const job = jobs.find(item => item.name === required);
    if (!job || job.status !== "completed" || job.conclusion !== "success")
      throw new Error(`Required CI job is not green: ${required}`);
  }
  if (jobs.some(job => job.status !== "completed" || job.conclusion !== "success"))
    throw new Error("Every job in the validation workflow must pass");
}

export async function requireReleaseCI({ repository, sha, token, request = fetch }) {
  if (!repository || !/^[\da-f]{40}$/.test(sha ?? "") || !token) throw new Error("Provide repository, a full commit SHA and a GitHub token");
  const get = async path => {
    const response = await request(`https://api.github.com/repos/${repository}/${path}`, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } });
    if (!response.ok) throw new Error(`Cannot verify CI: GitHub returned ${response.status}`);
    return response.json();
  };
  for (const workflow of requiredWorkflows) {
    const { workflow_runs: runs } = await get(`actions/workflows/${workflow.file}/runs?head_sha=${sha}&per_page=100`);
    const run = runs.filter(item => item.head_sha === sha).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))[0];
    if (!run) throw new Error(`No ${workflow.file} validation for ${sha}`);
    const { jobs } = await get(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
    validateRun(run, jobs, workflow.jobs, sha);
    console.log(`Verified ${workflow.file}: ${run.html_url}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sha = execFileSync("git", ["rev-parse", `${process.argv[2] ?? "HEAD"}^{commit}`], { encoding: "utf8" }).trim();
  await requireReleaseCI({ repository: process.env.GITHUB_REPOSITORY ?? "GeGLab/Annoy.Client", sha, token: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN });
}
