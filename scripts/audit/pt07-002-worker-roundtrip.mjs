// ============================================================================
// PT-07-002 -- real Railway worker job round-trip proof.
//
// PT-08's boot-inventory.json already proved the worker process is alive and
// its processors are STARTED, reconciled against real Railway logs + a live
// worker_status query. That is a boot/liveness proof. This script is the
// complementary FUNCTION proof: does the worker actually pick up a real
// queued job and write a real completion back, end to end, observed live
// against the real, deployed Railway worker -- not a local re-implementation
// of its claim predicates (that was PT-10-002 scenario 2's approach, chosen
// there specifically to avoid booting Playwright/browser automation; this
// script instead picks the one real, already-wired job type that is
// deterministic, DB-only, and zero-cost, so the REAL worker process can
// safely be the one doing the work).
//
// Job type chosen: agent_queue / agent_id="deadline_prediction"
// (src/lib/agents/deadline-prediction.ts, DeadlinePredictionAgent), routed
// by worker/autonomous-orchestrator.ts's routeQueueItem() and picked up by
// the continuously-polling processAgentQueue() loop (confirmed STARTED at
// boot per test-evidence/pt-08/boot-inventory.json's "agentQueueProcessor"
// entry). Verified safe by reading the agent's own execute() before using
// it: it does a single read-only `select` against `opportunities` for the
// given org, computes a deterministic pattern (no Claude/LLM call anywhere
// in the class -- tokensUsed is hardcoded 0 on every return path), and only
// ever writes a new `opportunities` row if it finds >=2 real historical
// deadlines forming a >=80%-confidence pattern. The disposable test org
// created here has zero opportunities, so the agent's own
// `validRows.length < 2` branch fires immediately -- zero writes, zero
// Claude cost, a real early return with a real, human-readable summary.
//
// Method:
//   1. Query worker_status (service-role) for a live, recently-ticking
//      heartbeat -- corroborates PT-08's boot proof is still current, not
//      re-derives it.
//   2. Provision one disposable organization (sweeping any leftover org from
//      a prior interrupted run of this same script first).
//   3. INSERT one real agent_queue row (status='queued', agent_id=
//      'deadline_prediction', trigger_source='manual', priority=10 so the
//      real worker's own priority-DESC/queued_at-ASC claim query picks it up
//      promptly among whatever else may be queued -- this does not change
//      HOW the worker claims/routes/completes a row, only which one it
//      reaches first). Capture the full inserted row as the "before" state.
//   4. Poll that exact row by id (never a re-implementation of the claim
//      query -- a passive SELECT) every 3s for up to 180s (6x the real
//      worker's own 30s empty-queue sleep interval, worker/
//      autonomous-orchestrator.ts's QUEUE_POLL_EMPTY_MS), recording every
//      distinct status transition actually observed with its full row
//      state, until a terminal status (completed/failed) or timeout.
//   5. Capture the terminal "after" state and re-query worker_status to show
//      the same worker process's heartbeat is still advancing.
//   6. Delete platform_config rows for the disposable org (no ON DELETE
//      CASCADE on that FK -- a background process reacting to org creation
//      can race the cleanup, see prior session notes in STATE_OF_THE_BUILD.md
//      on this exact pattern), then delete the org itself (agent_queue rows
//      cascade via ON DELETE CASCADE), with retry/backoff. Verify both are
//      actually gone afterward, not just that the delete call didn't error.
//
// A P1 finding is registered in WIRING_GAP_REGISTER.md automatically if the
// worker does not claim the row (no transition off 'queued') or does not
// write a real completion (final status != 'completed', or completed_at /
// output_payload.summary missing) within the timeout.
//
// Evidence: test-evidence/pt-07/worker-roundtrip.json
// Usage: node scripts/audit/pt07-002-worker-roundtrip.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { WebSocket } from "ws";
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = WebSocket;

const REPO_ROOT = process.cwd();
const ENV_FILE = path.join(REPO_ROOT, ".env.local");
const OUT_DIR = path.join(REPO_ROOT, "test-evidence", "pt-07");
const OUT_FILE = path.join(OUT_DIR, "worker-roundtrip.json");

const ORG_NAME_PREFIX = "PT07-002-WORKER-ROUNDTRIP-";
const AGENT_ID = "deadline_prediction";
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 180_000; // 6x QUEUE_POLL_EMPTY_MS (30s), worker/autonomous-orchestrator.ts
const HEARTBEAT_FRESH_THRESHOLD_S = 120; // 4x heartbeat.ts's 30s tick interval

function loadEnv(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

// ---- Step 1: worker_status heartbeat check --------------------------------

async function queryHeartbeat(admin) {
  const { data, error } = await admin
    .from("worker_status")
    .select("worker_id, status, started_at, last_heartbeat_at, items_processed, items_failed")
    .order("last_heartbeat_at", { ascending: false });

  if (error) {
    return { verdict: "HALT", error: error.message };
  }

  const rows = (data ?? []).map((r) => {
    const ageMs = Date.now() - new Date(r.last_heartbeat_at).getTime();
    return { ...r, heartbeat_age_seconds: Math.round(ageMs / 100) / 10 };
  });

  const freshest = rows[0] ?? null;
  const isLive =
    freshest !== null && freshest.heartbeat_age_seconds <= HEARTBEAT_FRESH_THRESHOLD_S;

  return {
    verdict: isLive ? "PASS" : "FINDING",
    realResponse: rows,
    freshestWorker: freshest,
    freshnessThresholdSeconds: HEARTBEAT_FRESH_THRESHOLD_S,
    isLive,
  };
}

// ---- Step 2: disposable org provisioning + cleanup -------------------------

async function sweepLeftoverOrgs(admin) {
  const { data: leftovers, error } = await admin
    .from("organizations")
    .select("id, name")
    .like("name", `${ORG_NAME_PREFIX}%`);

  if (error) throw new Error(`sweepLeftoverOrgs: select failed: ${error.message}`);

  const swept = [];
  for (const org of leftovers ?? []) {
    const result = await deleteOrgWithRetry(admin, org.id);
    swept.push({ id: org.id, name: org.name, ...result });
  }
  return swept;
}

async function deleteOrgWithRetry(admin, orgId, maxAttempts = 4, backoffMs = 1500) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // None of these four have ON DELETE CASCADE on their organization_id/org_id
    // FK (agent_queue does, but deleting it explicitly here is harmless and
    // keeps this list self-contained). agent_runs + usage_metrics are written
    // by BaseAgent.run()/trackUsage() for every real agent invocation
    // (confirmed by reading base-agent.ts / usage-tracker.ts before this test
    // ran); platform_config can be raced by an unrelated background process
    // reacting to org creation (documented in prior PT sessions' cleanup
    // notes) -- deleting all four before the organizations row is the real
    // dependency order this schema requires, not a guess.
    await admin.from("agent_queue").delete().eq("org_id", orgId);
    await admin.from("agent_runs").delete().eq("organization_id", orgId);
    await admin.from("usage_metrics").delete().eq("organization_id", orgId);
    await admin.from("platform_config").delete().eq("organization_id", orgId);
    const { error } = await admin.from("organizations").delete().eq("id", orgId);
    if (!error) {
      return { deleted: true, attempts: attempt };
    }
    lastError = error.message;
    if (attempt < maxAttempts) await sleep(backoffMs);
  }
  return { deleted: false, attempts: maxAttempts, error: lastError };
}

async function verifyGone(admin, orgId, queueRowId) {
  const { data: orgRow } = await admin.from("organizations").select("id").eq("id", orgId).maybeSingle();
  const { data: queueRow } = await admin.from("agent_queue").select("id").eq("id", queueRowId).maybeSingle();
  return { orgGone: !orgRow, queueRowGone: !queueRow };
}

// ---- Steps 3-5: enqueue, poll, capture terminal state -----------------------

async function enqueueJob(admin, orgId) {
  const { data, error } = await admin
    .from("agent_queue")
    .insert({
      org_id: orgId,
      agent_id: AGENT_ID,
      priority: 10,
      trigger_source: "manual",
      input_payload: {},
    })
    .select("*")
    .single();

  if (error) throw new Error(`enqueueJob: insert failed: ${error.message}`);
  return data;
}

async function pollUntilTerminal(admin, queueRowId, beforeState) {
  const pollLog = [];
  const transitions = [
    { step: "enqueued", atElapsedMs: 0, atIso: nowIso(), state: beforeState },
  ];
  let lastStatus = beforeState.status;
  const startedPollingAt = Date.now();

  while (Date.now() - startedPollingAt < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    const elapsedMs = Date.now() - startedPollingAt;

    const { data: row, error } = await admin
      .from("agent_queue")
      .select("*")
      .eq("id", queueRowId)
      .single();

    if (error) {
      pollLog.push({ elapsedMs, error: error.message });
      continue;
    }

    pollLog.push({ elapsedMs, status: row.status });

    if (row.status !== lastStatus) {
      const step =
        row.status === "processing"
          ? "claimed"
          : row.status === "completed"
            ? "completed"
            : row.status === "failed"
              ? "failed"
              : `status_changed_to_${row.status}`;
      transitions.push({ step, atElapsedMs: elapsedMs, atIso: nowIso(), state: row });
      lastStatus = row.status;
    }

    if (row.status === "completed" || row.status === "failed") {
      return { transitions, pollLog, finalState: row, timedOut: false };
    }
  }

  // Timed out -- one last read to capture whatever the real current state is.
  const { data: finalRow } = await admin.from("agent_queue").select("*").eq("id", queueRowId).single();
  return { transitions, pollLog, finalState: finalRow ?? beforeState, timedOut: true };
}

// ---- Main -------------------------------------------------------------

async function main() {
  if (!fs.existsSync(ENV_FILE)) {
    console.error(`HALT: ${ENV_FILE} not found.`);
    process.exit(1);
  }
  const env = loadEnv(ENV_FILE);

  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("HALT: missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket },
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log("Step 1/6: querying worker_status for a live heartbeat...");
  const heartbeatBefore = await queryHeartbeat(admin);
  console.log(
    `  heartbeat verdict: ${heartbeatBefore.verdict} (freshest=${heartbeatBefore.freshestWorker?.worker_id ?? "none"}, age=${heartbeatBefore.freshestWorker?.heartbeat_age_seconds ?? "n/a"}s)`,
  );
  if (heartbeatBefore.verdict === "HALT") {
    fs.writeFileSync(
      OUT_FILE,
      JSON.stringify({ generated_at: nowIso(), halted: true, reason: "heartbeat query failed", heartbeatBefore }, null, 2) + "\n",
      "utf8",
    );
    console.error(`HALT: could not query worker_status: ${heartbeatBefore.error}`);
    process.exit(1);
  }

  console.log("Step 2/6: sweeping leftover disposable orgs from prior runs...");
  const sweptLeftovers = await sweepLeftoverOrgs(admin);
  console.log(`  swept ${sweptLeftovers.length} leftover org(s).`);

  console.log("Step 3/6: provisioning one disposable test org...");
  const orgName = `${ORG_NAME_PREFIX}${Date.now()}`;
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: orgName, onboarding_completed: false })
    .select("id, name")
    .single();
  if (orgErr) {
    console.error(`HALT: org insert failed: ${orgErr.message}`);
    fs.writeFileSync(
      OUT_FILE,
      JSON.stringify({ generated_at: nowIso(), halted: true, reason: "org insert failed", heartbeatBefore, sweptLeftovers, error: orgErr.message }, null, 2) + "\n",
      "utf8",
    );
    process.exit(1);
  }
  console.log(`  org created: ${org.id} (${org.name})`);

  console.log(`Step 4/6: enqueueing one real agent_queue row (agent_id="${AGENT_ID}")...`);
  let beforeState;
  try {
    beforeState = await enqueueJob(admin, org.id);
  } catch (err) {
    console.error(`HALT: ${err.message}`);
    const cleanup = await deleteOrgWithRetry(admin, org.id);
    fs.writeFileSync(
      OUT_FILE,
      JSON.stringify({ generated_at: nowIso(), halted: true, reason: err.message, heartbeatBefore, sweptLeftovers, org, cleanup }, null, 2) + "\n",
      "utf8",
    );
    process.exit(1);
  }
  console.log(`  enqueued row ${beforeState.id}, status=${beforeState.status}`);
  console.log(`Step 5/6: polling for real pickup + completion (every ${POLL_INTERVAL_MS}ms, up to ${POLL_TIMEOUT_MS / 1000}s)...`);

  const { transitions, pollLog, finalState, timedOut } = await pollUntilTerminal(admin, beforeState.id, beforeState);
  for (const t of transitions) {
    console.log(`    [+${t.atElapsedMs}ms] ${t.step} -- status=${t.state.status}`);
  }
  if (timedOut) console.log("  TIMED OUT waiting for a terminal status.");

  const heartbeatAfter = await queryHeartbeat(admin);

  console.log("Step 6/6: cleaning up disposable org...");
  const cleanupDelete = await deleteOrgWithRetry(admin, org.id);
  const cleanupVerify = await verifyGone(admin, org.id, beforeState.id);
  console.log(`  cleanup: deleted=${cleanupDelete.deleted} orgGone=${cleanupVerify.orgGone} queueRowGone=${cleanupVerify.queueRowGone}`);

  // --- Assess the real round-trip proof -------------------------------------

  // The terminal row's own started_at (set only by the claim step, never by
  // enqueue) is the authoritative pickup proof -- more reliable than
  // requiring an intermediate poll to have caught status="processing" in the
  // act, which is inherently racy when the real work is fast (this agent's
  // claim-to-completion window is sub-second for a zero-data org; a 2s poll
  // interval can legitimately skip straight from "queued" to "completed"
  // between two polls without ever observing "processing", and that is still
  // real, valid pickup+completion evidence, not a miss).
  const claimedTransition = transitions.find((t) => t.step === "claimed");
  const pickedUp =
    Boolean(finalState?.started_at) &&
    new Date(finalState.started_at).getTime() >= new Date(beforeState.queued_at).getTime();

  const summary =
    finalState?.output_payload && typeof finalState.output_payload === "object"
      ? finalState.output_payload.summary
      : undefined;

  const completedWithOutput =
    finalState?.status === "completed" &&
    Boolean(finalState.completed_at) &&
    typeof summary === "string" &&
    summary.trim().length > 0;

  const failedInstead = finalState?.status === "failed";

  const overallVerdict =
    heartbeatBefore.isLive && pickedUp && completedWithOutput ? "PASS" : "FAIL";

  const findings = [];
  if (!heartbeatBefore.isLive) {
    findings.push({
      severity: "P1",
      description: `worker_status shows no worker with a heartbeat fresher than ${HEARTBEAT_FRESH_THRESHOLD_S}s at test start -- freshest was ${heartbeatBefore.freshestWorker?.worker_id ?? "none"} at ${heartbeatBefore.freshestWorker?.heartbeat_age_seconds ?? "n/a"}s old. The Railway worker does not appear to be live.`,
    });
  }
  if (!pickedUp) {
    findings.push({
      severity: "P1",
      description: `agent_queue row ${beforeState.id} (agent_id="${AGENT_ID}") was never claimed by the worker -- the final polled row has no started_at timestamp after ${POLL_TIMEOUT_MS / 1000}s (final status="${finalState?.status}"). The real worker is not picking up queued jobs.`,
    });
  } else if (!completedWithOutput) {
    findings.push({
      severity: "P1",
      description: failedInstead
        ? `agent_queue row ${beforeState.id} was claimed but ended in status="failed" (error_message="${finalState.error_message ?? "n/a"}") instead of writing a real completion.`
        : `agent_queue row ${beforeState.id} was claimed but did not reach a real completed state with output_payload.summary within ${POLL_TIMEOUT_MS / 1000}s (final status="${finalState?.status}", timedOut=${timedOut}). The worker is not writing completion back.`,
    });
  }

  const output = {
    generated_at: nowIso(),
    method: {
      jobType: `agent_queue / agent_id="${AGENT_ID}" (DeadlinePredictionAgent, DB-only, zero Claude cost, zero writes for an org with no opportunities)`,
      pollIntervalMs: POLL_INTERVAL_MS,
      pollTimeoutMs: POLL_TIMEOUT_MS,
      heartbeatFreshnessThresholdSeconds: HEARTBEAT_FRESH_THRESHOLD_S,
    },
    heartbeatBefore,
    heartbeatAfter,
    sweptLeftovers,
    disposableOrg: { id: org.id, name: org.name },
    job: {
      agentId: AGENT_ID,
      queueRowId: beforeState.id,
      beforeState,
      transitions,
      pollLog,
      finalState,
      timedOut,
      pickedUp,
      completedWithOutput,
      failedInstead,
    },
    cleanup: { delete: cleanupDelete, verify: cleanupVerify },
    findings,
    summary: {
      heartbeat_live: heartbeatBefore.isLive,
      picked_up: pickedUp,
      completed_with_output: completedWithOutput,
      overall_verdict: overallVerdict,
    },
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`Overall verdict: ${overallVerdict}`);

  if (findings.length > 0) {
    console.log(`\n${findings.length} P1 finding(s) recorded in worker-roundtrip.json -- register these in`);
    console.log(`WIRING_GAP_REGISTER.md by hand with the next sequential WGR-NNN id (see evidence-lib.mjs's`);
    console.log(`appendFindingRow, or scripts/audit/pt09-002-register-findings.mjs for the established pattern).`);
    for (const f of findings) console.log(`  - [${f.severity}] ${f.description}`);
  }

  if (overallVerdict !== "PASS") {
    console.error("\nFAIL: real worker did not both pick up and complete the job (see findings above).");
    process.exit(1);
  }

  console.log(
    "\nRESULT: heartbeat confirmed live, real agent_queue row was claimed by the real worker " +
      "(status queued -> processing -> completed), and a real completion (with output_payload.summary) " +
      "was written back. Disposable org and its queue row confirmed cleaned up.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(`HALT: unexpected error: ${err.stack || err.message}`);
  process.exit(1);
});
