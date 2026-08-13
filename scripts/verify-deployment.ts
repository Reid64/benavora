// ============================================================================
// BENAVORA — deploy-verification gate
//
// Per STANDING_DIRECTIVES.md DIRECTIVE-019: on 2026-08-11, an audit found 37
// of the last 40 Vercel production deployments in `Error` state, with
// production serving a build 21 commits stale for 8+ hours while nothing in
// the pipeline noticed. The pre-push build gate (.githooks/pre-push) stops a
// *broken* build from reaching `main`, but it cannot catch the case where a
// push succeeds, `main` is green, and Vercel's production deployment simply
// never happens, fails silently, or is still serving an older commit. This
// script closes that gap: it compares the local repo's current HEAD against
// whatever commit Vercel actually has live in production, so drift is
// reported explicitly instead of discovered hours later.
//
// Usage: tsx scripts/verify-deployment.ts
//
// Requires VERCEL_TOKEN + VERCEL_PROJECT_ID (VERCEL_TEAM_ID optional, only
// needed if the project lives under a team). Deliberately uses the Vercel
// REST API rather than the `vercel` CLI or the Vercel MCP connector: per
// project history (AGENT_VERIFICATION_LOG.md), the CLI's `vercel inspect`
// requires an interactive-login session and has a known hang-after-finish
// quirk on this machine, and the connected Vercel MCP is authenticated to an
// unrelated account (403 against benavora's real team) — a plain token-based
// API call is the only path that's both non-interactive and reliable enough
// to gate on.
//
// Exit codes (this script's own contract — verify against whatever the
// calling orchestrator expects before wiring it into an automated gate):
//   0 = PASS       production's live commit matches local HEAD
//   1 = FAIL       production is live but on a different commit (drift), or
//                  the production deployment itself errored/was canceled
//   2 = PENDING    production's latest deployment is still building/queued —
//                  not yet a verifiable pass or fail, reported distinctly so
//                  it is never conflated with a genuine mismatch
//   3 = INDETERMINATE   couldn't reach a verdict at all (missing config,
//                  network/auth failure, no deployments found)
// ============================================================================

import { execSync } from "child_process";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT_NAME;
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID;

const PENDING_STATES = new Set(["QUEUED", "BUILDING", "INITIALIZING"]);
const FAILED_STATES = new Set(["ERROR", "CANCELED"]);

function getLocalCommit(): string {
  return execSync("git rev-parse HEAD").toString().trim();
}

interface VercelDeployment {
  uid: string;
  url: string;
  state?: string;
  readyState?: string;
  meta?: Record<string, string>;
}

async function getLatestProductionDeployment(): Promise<VercelDeployment> {
  const params = new URLSearchParams({
    projectId: VERCEL_PROJECT_ID as string,
    target: "production",
    limit: "1",
  });
  if (VERCEL_TEAM_ID) params.set("teamId", VERCEL_TEAM_ID);

  const res = await fetch(`https://api.vercel.com/v6/deployments?${params.toString()}`, {
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
  });

  if (!res.ok) {
    throw new Error(`Vercel API returned ${res.status} ${res.statusText}: ${await res.text()}`);
  }

  const body = (await res.json()) as { deployments?: VercelDeployment[] };
  if (!body.deployments || body.deployments.length === 0) {
    throw new Error("Vercel API returned no production deployments for this project");
  }
  return body.deployments[0];
}

function extractCommitSha(deployment: VercelDeployment): string | undefined {
  const meta = deployment.meta || {};
  return (
    meta.githubCommitSha ||
    meta.gitlabCommitSha ||
    meta.bitbucketCommitSha ||
    meta.commitSha
  );
}

async function main() {
  const localCommit = getLocalCommit();
  console.log(`verify-deployment: local HEAD is ${localCommit}`);

  if (!VERCEL_TOKEN || !VERCEL_PROJECT_ID) {
    console.log(
      "verify-deployment: INDETERMINATE — VERCEL_TOKEN and/or VERCEL_PROJECT_ID " +
        "are not set, cannot query production deployment state."
    );
    process.exit(3);
  }

  let deployment: VercelDeployment;
  try {
    deployment = await getLatestProductionDeployment();
  } catch (err) {
    console.log(`verify-deployment: INDETERMINATE — failed to query Vercel API: ${(err as Error).message}`);
    process.exit(3);
    return;
  }

  const state = (deployment.readyState || deployment.state || "").toUpperCase();

  if (PENDING_STATES.has(state)) {
    console.log(
      `verify-deployment: PENDING — production deployment ${deployment.uid} is still ${state}, ` +
        "not yet ready to compare against local HEAD. This is not a mismatch — check again once it finishes."
    );
    process.exit(2);
    return;
  }

  if (FAILED_STATES.has(state)) {
    console.log(
      `verify-deployment: FAIL — production deployment ${deployment.uid} is in state ${state} ` +
        "(the deployment itself errored or was canceled, independent of which commit it targeted)."
    );
    process.exit(1);
    return;
  }

  const remoteCommit = extractCommitSha(deployment);
  if (!remoteCommit) {
    console.log(
      `verify-deployment: INDETERMINATE — production deployment ${deployment.uid} is ${state} but ` +
        "no git commit sha was present in its metadata."
    );
    process.exit(3);
    return;
  }

  if (remoteCommit === localCommit) {
    console.log(`verify-deployment: PASS — production (${deployment.uid}) matches local HEAD (${localCommit}).`);
    process.exit(0);
  } else {
    console.log(
      `verify-deployment: FAIL — production (${deployment.uid}) is on ${remoteCommit}, ` +
        `local HEAD is ${localCommit}. Production has drifted from HEAD.`
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.log(`verify-deployment: INDETERMINATE — unexpected error: ${(err as Error).message}`);
  process.exit(3);
});
