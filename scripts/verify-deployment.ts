// ============================================================================
// BENAVORA — deploy-verification gate (Vercel + Railway)
//
// Per STANDING_DIRECTIVES.md DIRECTIVE-019: on 2026-08-11, an audit found 37
// of the last 40 Vercel production deployments in `Error` state, with
// production serving a build 21 commits stale for 8+ hours while nothing in
// the pipeline noticed. The pre-push build gate (.githooks/pre-push) stops a
// *broken* build from reaching `main`, but it cannot catch the case where a
// push succeeds, `main` is green, and a production surface simply never
// redeploys, fails silently, or is still serving an older commit.
//
// AR-18.2 (2026-09-19) extended this from Vercel-only to both production
// surfaces after discovering (from a screenshot, not from any check this
// programme had run) that the Railway worker auto-deploys from GitHub
// independently of Vercel and can silently sit on stale code — Railway's own
// deploy history shows entries marked SKIPPED ("No changes to watched
// files"), which is *correct* behavior (see WATCHED PATHS below) but had
// never been distinguished from a worker that's actually behind. Nine
// consecutive FORGE queues (2026-09-17 through 2026-09-19) ended with
// `verify-deployment: INDETERMINATE` because VERCEL_TOKEN/VERCEL_PROJECT_ID
// were never set — production drift was never actually checked in that
// window. This revision closes both gaps at once.
//
// THREE OUTCOMES PER SURFACE — never collapse to a binary pass/fail:
//   CONFIRMED     surface is verifiably serving local HEAD (or, for Railway,
//                 verifiably serving the most recent commit that touched a
//                 watched path — see below)
//   DRIFTED       surface is reachable and checkable, but is NOT on the
//                 expected commit (stale, errored, or crashed deployment)
//   INDETERMINATE could not reach a verdict at all (missing credentials, CLI
//                 unavailable, network/auth failure, no deployments found)
//
// WATCHED PATHS (Railway only): railway.json's build.watchPatterns means
// Railway deliberately skips redeploying on commits that don't touch worker
// code. Comparing Railway's deployed commit SHA to local HEAD by string
// equality would therefore report false DRIFTED on almost every push (docs,
// UI, marketing copy, etc. never touch worker/**). Railway is honestly
// CONFIRMED when `git log <deployedSha>..HEAD -- <watchPatterns>` is empty —
// i.e. nothing it should have redeployed for has landed since — and honestly
// DRIFTED only when that range is non-empty.
//
// CREDENTIALS — CLI-first, by design:
// Both checks prefer the `vercel` and `railway` CLIs already installed and
// authenticated on this machine (confirmed live 2026-09-19: `vercel whoami`
// -> reid-9664 with real access to the `reids-projects-b3405b97` team that
// owns this project — the 2026-09-15 "wrong team" blocker recorded in
// STANDING_DIRECTIVES.md/.env.local.example no longer holds; `railway
// whoami` -> reid@repvg.com with this directory already linked to the real
// benavora-worker project/service). Non-interactive, no token needed on this
// machine. VERCEL_TOKEN/VERCEL_PROJECT_ID/VERCEL_TEAM_ID and RAILWAY_TOKEN
// remain as documented fallbacks in .env.local.example for any environment
// (CI, a fresh machine) where the CLI itself isn't already logged in — both
// CLIs read those variables natively; this script never invents, guesses, or
// hardcodes a credential, and reports INDETERMINATE honestly when neither
// path is available.
//
// Usage: tsx scripts/verify-deployment.ts
//
// Exit codes (this script's own contract — verify against whatever the
// calling orchestrator expects before wiring it into an automated gate):
//   0 = CONFIRMED      both surfaces verifiably on the expected commit
//   1 = DRIFTED         at least one surface is confirmed behind/broken
//   3 = INDETERMINATE   neither surface drifted, but at least one could not
//                       be checked at all
// ============================================================================

import { execFileSync, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

type Verdict = "CONFIRMED" | "DRIFTED" | "INDETERMINATE";

interface SurfaceResult {
  surface: string;
  verdict: Verdict;
  detail: string;
}

const RUNNING_STATES = new Set(["QUEUED", "BUILDING", "INITIALIZING", "DEPLOYING"]);
const BROKEN_STATES = new Set(["ERROR", "CANCELED", "FAILED", "CRASHED", "REMOVED"]);

function getLocalCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

// Defensive: some sandboxed shells (e.g. this session's Claude Code plugin
// wrapper) prepend a non-JSON hint line before a CLI's real JSON output.
// Parsing from the first `{` makes this robust regardless of the cause.
function extractJson(stdout: string): any {
  const start = stdout.indexOf("{");
  if (start === -1) throw new Error(`no JSON object found in output: ${stdout.slice(0, 300)}`);
  return JSON.parse(stdout.slice(start));
}

function runCli(
  command: string,
  args: string[],
  opts: { timeoutMs?: number } = {}
): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: true,
    timeout: opts.timeoutMs ?? 30000,
    env: process.env,
  });
  if (result.error) {
    return { ok: false, stdout: "", stderr: result.error.message };
  }
  return { ok: result.status === 0, stdout: result.stdout || "", stderr: result.stderr || "" };
}

// ----------------------------------------------------------------------------
// Vercel
// ----------------------------------------------------------------------------

async function checkVercelViaRestApi(localCommit: string): Promise<SurfaceResult> {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT_NAME;
  const teamId = process.env.VERCEL_TEAM_ID;

  if (!token || !projectId) {
    return {
      surface: "Vercel",
      verdict: "INDETERMINATE",
      detail:
        "vercel CLI unavailable/unauthenticated AND VERCEL_TOKEN/VERCEL_PROJECT_ID are not set — " +
        "cannot query production deployment state by either path.",
    };
  }

  const params = new URLSearchParams({ projectId, target: "production", limit: "1" });
  if (teamId) params.set("teamId", teamId);

  let body: { deployments?: any[] };
  try {
    const res = await fetch(`https://api.vercel.com/v6/deployments?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      return {
        surface: "Vercel",
        verdict: "INDETERMINATE",
        detail: `Vercel REST API returned ${res.status} ${res.statusText}: ${await res.text()}`,
      };
    }
    body = (await res.json()) as { deployments?: any[] };
  } catch (err) {
    return { surface: "Vercel", verdict: "INDETERMINATE", detail: `Vercel REST API request failed: ${(err as Error).message}` };
  }

  const deployment = body.deployments?.[0];
  if (!deployment) {
    return { surface: "Vercel", verdict: "INDETERMINATE", detail: "Vercel REST API returned no production deployments for this project." };
  }

  return evaluateVercelDeployment(deployment, localCommit, "REST API");
}

function evaluateVercelDeployment(deployment: any, localCommit: string, via: string): SurfaceResult {
  const state = (deployment.readyState || deployment.state || "").toUpperCase();
  const id = deployment.uid || deployment.url || "(unknown)";

  if (RUNNING_STATES.has(state)) {
    return { surface: "Vercel", verdict: "INDETERMINATE", detail: `latest production deployment ${id} is still ${state} (via ${via}) — not yet verifiable.` };
  }
  if (BROKEN_STATES.has(state)) {
    return {
      surface: "Vercel",
      verdict: "DRIFTED",
      detail: `latest production deployment ${id} is in state ${state} (via ${via}) — production is not confirmed serving any known-good commit.`,
    };
  }

  const remoteCommit: string | undefined =
    deployment.meta?.githubCommitSha ||
    deployment.meta?.gitlabCommitSha ||
    deployment.meta?.bitbucketCommitSha ||
    deployment.meta?.commitSha;

  if (!remoteCommit) {
    return { surface: "Vercel", verdict: "INDETERMINATE", detail: `latest production deployment ${id} is ${state} (via ${via}) but has no git commit sha in its metadata.` };
  }

  if (remoteCommit === localCommit) {
    return { surface: "Vercel", verdict: "CONFIRMED", detail: `production (${id}, via ${via}) matches local HEAD (${localCommit}).` };
  }
  return {
    surface: "Vercel",
    verdict: "DRIFTED",
    detail: `production (${id}, via ${via}) is on ${remoteCommit}, local HEAD is ${localCommit}.`,
  };
}

async function checkVercel(localCommit: string): Promise<SurfaceResult> {
  let projectName = process.env.VERCEL_PROJECT_NAME;
  if (!projectName) {
    try {
      const projectJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".vercel", "project.json"), "utf8"));
      projectName = projectJson.projectName;
    } catch {
      // fall through — no linked project file, CLI path will fail below
    }
  }

  if (projectName) {
    const args = ["ls", projectName, "--prod", "--format", "json"];
    if (process.env.VERCEL_TOKEN) args.push("--token", process.env.VERCEL_TOKEN);
    if (process.env.VERCEL_TEAM_ID) args.push("--scope", process.env.VERCEL_TEAM_ID);

    const result = runCli("vercel", args);
    if (result.ok) {
      try {
        const parsed = extractJson(result.stdout);
        const deployment = parsed.deployments?.[0];
        if (!deployment) {
          return { surface: "Vercel", verdict: "INDETERMINATE", detail: "vercel CLI returned no production deployments for this project." };
        }
        return evaluateVercelDeployment(
          { ...deployment, readyState: deployment.state },
          localCommit,
          "vercel CLI"
        );
      } catch (err) {
        // CLI ran but output wasn't parseable JSON — fall through to REST fallback below
        return checkVercelViaRestApi(localCommit).then((rest) =>
          rest.verdict === "INDETERMINATE"
            ? { surface: "Vercel", verdict: "INDETERMINATE", detail: `vercel CLI output unparseable (${(err as Error).message}); REST fallback: ${rest.detail}` }
            : rest
        );
      }
    }
    // CLI invocation itself failed (not installed, not logged in, wrong team, etc.) — try REST fallback
    const rest = await checkVercelViaRestApi(localCommit);
    if (rest.verdict !== "INDETERMINATE") return rest;
    return {
      surface: "Vercel",
      verdict: "INDETERMINATE",
      detail: `vercel CLI failed (${result.stderr.trim().split("\n")[0] || "unknown error"}); REST fallback: ${rest.detail}`,
    };
  }

  return checkVercelViaRestApi(localCommit);
}

// ----------------------------------------------------------------------------
// Railway
// ----------------------------------------------------------------------------

function getWatchPatterns(): string[] {
  try {
    const railwayJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "railway.json"), "utf8"));
    const patterns = railwayJson?.build?.watchPatterns;
    return Array.isArray(patterns) && patterns.length > 0 ? patterns : [];
  } catch {
    return [];
  }
}

function findRailwayDeployment(status: any): any {
  const envEdges = status?.environments?.edges || [];
  for (const envEdge of envEdges) {
    const svcEdges = envEdge?.node?.serviceInstances?.edges || [];
    for (const svcEdge of svcEdges) {
      const node = svcEdge?.node;
      const deployment = node?.latestDeployment || node?.activeDeployments?.[0];
      if (deployment) return deployment;
    }
  }
  return null;
}

function checkRailway(localCommit: string): SurfaceResult {
  const result = runCli("railway", ["status", "--json"]);
  if (!result.ok) {
    return {
      surface: "Railway",
      verdict: "INDETERMINATE",
      detail: `railway CLI failed (${result.stderr.trim().split("\n")[0] || "unknown error"}) — set RAILWAY_TOKEN (project token, https://docs.railway.app/reference/cli-api#environment-variables) or run 'railway login' on this machine.`,
    };
  }

  let status: any;
  try {
    status = extractJson(result.stdout);
  } catch (err) {
    return { surface: "Railway", verdict: "INDETERMINATE", detail: `railway CLI output unparseable: ${(err as Error).message}` };
  }

  const deployment = findRailwayDeployment(status);
  if (!deployment) {
    return { surface: "Railway", verdict: "INDETERMINATE", detail: "railway CLI returned no active deployment for the linked service." };
  }

  const state = (deployment.status || "").toUpperCase();
  const id = deployment.id || "(unknown)";

  if (deployment.deploymentStopped) {
    return { surface: "Railway", verdict: "DRIFTED", detail: `latest Railway deployment ${id} is stopped — worker is not running any commit.` };
  }
  if (RUNNING_STATES.has(state)) {
    return { surface: "Railway", verdict: "INDETERMINATE", detail: `latest Railway deployment ${id} is still ${state} — not yet verifiable.` };
  }
  if (BROKEN_STATES.has(state)) {
    return { surface: "Railway", verdict: "DRIFTED", detail: `latest Railway deployment ${id} is in status ${state} — not confirmed running known-good code.` };
  }

  const deployedSha: string | undefined = deployment.meta?.commitHash;
  if (!deployedSha) {
    return { surface: "Railway", verdict: "INDETERMINATE", detail: `latest Railway deployment ${id} is ${state || "unknown status"} but has no commit hash in its metadata.` };
  }

  if (deployedSha === localCommit) {
    return { surface: "Railway", verdict: "CONFIRMED", detail: `worker (${id}) is directly on local HEAD (${deployedSha}).` };
  }

  const watchPatterns = getWatchPatterns();
  let behindCount: number;
  try {
    behindCount = parseInt(execFileSync("git", ["rev-list", "--count", `${deployedSha}..HEAD`], { encoding: "utf8" }).trim(), 10);
  } catch {
    return {
      surface: "Railway",
      verdict: "INDETERMINATE",
      detail: `Railway reports commit ${deployedSha}, which is not found in local git history (shallow clone or force-push?) — cannot compute drift.`,
    };
  }

  if (watchPatterns.length === 0) {
    // No watch-pattern config found — fall back to a direct comparison rather than silently assuming CONFIRMED.
    return {
      surface: "Railway",
      verdict: "DRIFTED",
      detail: `worker (${id}) is on ${deployedSha}, ${behindCount} commit(s) behind local HEAD (${localCommit}); railway.json watchPatterns unreadable so path-scoped comparison could not be applied.`,
    };
  }

  let watchedTouched: string;
  try {
    watchedTouched = execFileSync(
      "git",
      ["log", `${deployedSha}..HEAD`, "--oneline", "--", ...watchPatterns],
      { encoding: "utf8" }
    ).trim();
  } catch (err) {
    return { surface: "Railway", verdict: "INDETERMINATE", detail: `git log against watched paths failed: ${(err as Error).message}` };
  }

  if (watchedTouched === "") {
    return {
      surface: "Railway",
      verdict: "CONFIRMED",
      detail: `worker (${id}) is on ${deployedSha}, ${behindCount} commit(s) behind HEAD, but none touched watched paths (${watchPatterns.join(", ")}) — correctly SKIPPED, not drifted.`,
    };
  }

  const mostRecentWatched = watchedTouched.split("\n")[0];
  const watchedCount = watchedTouched.split("\n").length;
  return {
    surface: "Railway",
    verdict: "DRIFTED",
    detail: `worker (${id}) is on ${deployedSha}, ${behindCount} commit(s) behind HEAD; ${watchedCount} of those touched watched paths and have NOT been picked up (most recent: ${mostRecentWatched}). Check Railway's deploy history for a SKIPPED entry that should have built.`,
  };
}

// ----------------------------------------------------------------------------

async function main() {
  const localCommit = getLocalCommit();
  console.log(`verify-deployment: local HEAD is ${localCommit}`);

  const [vercelResult, railwayResult] = [await checkVercel(localCommit), checkRailway(localCommit)];

  for (const r of [vercelResult, railwayResult]) {
    console.log(`verify-deployment: ${r.surface} — ${r.verdict}: ${r.detail}`);
  }

  const results = [vercelResult, railwayResult];
  if (results.some((r) => r.verdict === "DRIFTED")) {
    process.exit(1);
  }
  if (results.some((r) => r.verdict === "INDETERMINATE")) {
    process.exit(3);
  }
  process.exit(0);
}

main().catch((err) => {
  console.log(`verify-deployment: INDETERMINATE — unexpected error: ${(err as Error).message}`);
  process.exit(3);
});
