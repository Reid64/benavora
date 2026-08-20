// PT-08-003: exercise agent_queue's real lifecycle semantics against a disposable local Postgres
// database (BRANCH/LOCAL ONLY -- never production). Run via:
//   node --import tsx scripts/audit/pt08-003-queue-lifecycle.mjs
//
// Methodology, stated up front so the evidence file is self-explaining:
//
// 1. Claim/retry/completion state-machine logic (claimNextQueueItem-equivalent,
//    runQueueItem-equivalent below) is a faithful, line-by-line reimplementation of the REAL,
//    unmodified functions in worker/autonomous-orchestrator.ts:
//      - claimNextQueueItem (lines 2066-2090): SELECT the highest-priority queued row, then a
//        conditional UPDATE ... WHERE id=$1 AND status='queued' (a compare-and-swap claim).
//      - runQueueItem (lines 2092-2120): on success, UPDATE status='completed',
//        completed_at=now(), output_payload={summary}. On failure: retry_count += 1,
//        failedForGood = nextRetryCount >= maxRetries (maxRetries defaults to 3, matching
//        migration 080's DEFAULT 3), UPDATE status = failedForGood ? 'failed' : 'queued',
//        error_message=<the thrown message>, completed_at = failedForGood ? now() : null.
//    This is a reimplementation (not a live `import` of the two functions) because
//    claimNextQueueItem/runQueueItem are NOT exported from that module (only routeQueueItem,
//    AgentQueueRow, processAgentQueue, stopAgentQueueProcessor are), and because the real
//    functions are written against a Supabase-JS client (PostgREST transport), while this
//    disposable test DB is accessed directly via `pg` (no local PostgREST/Supabase stack was
//    stood up for this test -- see the "why raw pg, not a local Supabase stack" note below).
//    The observable state-machine behavior (which WHERE clauses gate the claim, what each branch
//    writes) is byte-identical between the two; only the SQL transport differs.
//
// 2. The one part of this test that is NOT a reimplementation, but the REAL, unmodified,
//    currently-shipping code, executed directly: routeQueueItem's default-case throw
//    (`throw new Error('Unknown agent_queue agent_id: "<id>"')`, worker/autonomous-orchestrator.ts
//    line 2061) is used as this test's "poison job" failure. It is imported live from the compiled
//    module (`worker/autonomous-orchestrator.ts`, loaded via tsx) and called with a real
//    AgentQueueRow-shaped object whose agent_id matches no case in the switch -- exactly the
//    pattern src/__tests__/integration/ag19-relationship-builder-flag.test.ts already uses to
//    exercise routeQueueItem's real dispatch logic without touching the shared production
//    agent_queue table. No real external network/API/agent-class code executes; the module's own
//    imports are all type-only or dynamic-per-switch-case (confirmed by reading the file), so
//    importing it has zero side effects until a specific case actually runs.
//
// 3. Why raw `pg`, not a local Supabase stack: none of routeQueueItem's real registered switch
//    cases (opportunity_discovery, eligibility_scoring, budget_builder, etc.) can complete without
//    live external Claude API calls and real org/opportunity/application data far beyond this
//    table's own schema -- unsuitable for an isolated, branch/local queue-semantics test. The
//    "good job" therefore uses a small local stand-in job runner that returns a summary string
//    synchronously, standing in for "an agent that did its work and returned a summary" the same
//    way routeQueueItem's own success branches do (`return \`... completed (...)\`` -- always a
//    plain string). This is explicit, not hidden: every scenario below states in its own
//    "jobRunnerKind" field whether it invoked the real routeQueueItem or the local stand-in.
//
// ASCII only. Node 20 compatible.

import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");
const outDir = path.join(repoRoot, "test-evidence", "pt-08");
const outPath = path.join(outDir, "queue-semantics.json");

const CONNECTION = {
  host: "localhost",
  port: 55432,
  user: "postgres",
  database: "benavora_queue_test",
};

function nowIso() {
  return new Date().toISOString();
}

// --- faithful reimplementation of worker/autonomous-orchestrator.ts's claim/run logic ----------

/** Mirrors claimNextQueueItem() (autonomous-orchestrator.ts:2066-2090). */
async function claimNextQueueItem(client) {
  const { rows: candidateRows } = await client.query(
    `SELECT id FROM agent_queue
       WHERE status = 'queued'
       ORDER BY priority DESC, queued_at ASC
       LIMIT 1`,
  );
  const candidate = candidateRows[0];
  if (!candidate) return null;

  const { rows: claimedRows } = await client.query(
    `UPDATE agent_queue
        SET status = 'processing', started_at = now()
      WHERE id = $1 AND status = 'queued'
      RETURNING id, org_id, agent_id, input_payload, retry_count, max_retries`,
    [candidate.id],
  );
  return claimedRows[0] ?? null;
}

/** Mirrors runQueueItem() (autonomous-orchestrator.ts:2092-2120). jobRunner(item) either
 * returns a summary string (success) or throws (failure) -- the exact contract
 * routeQueueItem() itself has (Promise<string>, throws on error). */
async function runQueueItem(client, item, jobRunner) {
  try {
    const summary = await jobRunner(item);
    await client.query(
      `UPDATE agent_queue
          SET status = 'completed', completed_at = now(), output_payload = $2
        WHERE id = $1`,
      [item.id, JSON.stringify({ summary })],
    );
    return { outcome: "completed", summary };
  } catch (err) {
    const nextRetryCount = (item.retry_count ?? 0) + 1;
    const maxRetries = item.max_retries ?? 3;
    const failedForGood = nextRetryCount >= maxRetries;
    const errorMessage = err instanceof Error ? err.message : String(err);
    await client.query(
      `UPDATE agent_queue
          SET status = $2, retry_count = $3, error_message = $4,
              completed_at = ${failedForGood ? "now()" : "NULL"}
        WHERE id = $1`,
      [item.id, failedForGood ? "failed" : "queued", nextRetryCount, errorMessage],
    );
    return { outcome: failedForGood ? "failed_terminal" : "retried", errorMessage, nextRetryCount, failedForGood };
  }
}

async function snapshot(client, id) {
  const { rows } = await client.query(`SELECT * FROM agent_queue WHERE id = $1`, [id]);
  const row = rows[0];
  if (!row) return null;
  // Normalize to plain JSON-serializable values (pg returns Date objects for timestamptz).
  return {
    id: row.id,
    org_id: row.org_id,
    agent_id: row.agent_id,
    priority: row.priority,
    status: row.status,
    trigger_source: row.trigger_source,
    input_payload: row.input_payload,
    output_payload: row.output_payload,
    error_message: row.error_message,
    queued_at: row.queued_at ? row.queued_at.toISOString() : null,
    started_at: row.started_at ? row.started_at.toISOString() : null,
    completed_at: row.completed_at ? row.completed_at.toISOString() : null,
    retry_count: row.retry_count,
    max_retries: row.max_retries,
  };
}

async function enqueue(client, orgId, { agentId, priority = 5, maxRetries = 3, triggerSource = "manual" }) {
  const { rows } = await client.query(
    `INSERT INTO agent_queue (org_id, agent_id, priority, trigger_source, max_retries)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [orgId, agentId, priority, triggerSource, maxRetries],
  );
  return rows[0].id;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const client = new pg.Client(CONNECTION);
  await client.connect();

  // Load the REAL, unmodified worker module (type-only + dynamic-per-case imports at module
  // level -- confirmed by reading the file -- so importing it here has zero side effects).
  const workerModuleUrl = pathToFileURL(path.join(repoRoot, "worker", "autonomous-orchestrator.ts")).href;
  const workerModule = await import(workerModuleUrl);
  // tsx's CJS/ESM interop shape differs depending on the calling context (observed: nested under
  // .default when the importing script itself is CJS-eval'd, flat when it's a genuine .mjs ESM
  // module) -- accept either so this script is robust to that, but fail loudly if neither shape
  // yields the real function.
  const realRouteQueueItem = workerModule.default?.routeQueueItem ?? workerModule.routeQueueItem;
  if (typeof realRouteQueueItem !== "function") {
    throw new Error(
      "Could not load the real routeQueueItem export from worker/autonomous-orchestrator.ts " +
        `(module keys: ${Object.keys(workerModule).join(", ")}; default keys: ${
          workerModule.default ? Object.keys(workerModule.default).join(", ") : "n/a"
        })`,
    );
  }

  const { rows: orgRows } = await client.query(
    `INSERT INTO organizations (name) VALUES ('PT-08 Queue Lifecycle Test Org') RETURNING id`,
  );
  const orgId = orgRows[0].id;

  const evidence = {
    testedAt: nowIso(),
    database: `local disposable Postgres 18.3, ${CONNECTION.host}:${CONNECTION.port}/${CONNECTION.database} (initdb'd fresh for this test, dropped after)`,
    branchOrLocalOnly: true,
    productionTouched: false,
    schemaSource:
      "src/supabase/migrations/080_autonomous_agent_infrastructure.sql lines 23-44 (agent_queue DDL, verbatim minus the RLS policy)",
    methodology: {
      claimAndRunLogic:
        "faithful reimplementation of claimNextQueueItem/runQueueItem (worker/autonomous-orchestrator.ts:2066-2120), same SQL predicates, against a raw pg client (no local PostgREST/Supabase stack stood up)",
      poisonJobRunner:
        "the REAL, unmodified routeQueueItem() (worker/autonomous-orchestrator.ts:1658-2062) imported live via tsx and invoked with an agent_id matching no switch case, hitting its real default-case throw (line 2061) -- not a test-only stand-in",
      goodJobRunner:
        "a local stand-in that returns a summary string synchronously, standing in for 'an agent that did its work and returned a summary' -- none of routeQueueItem's real registered cases can complete without live external Claude API calls and real business-table data, which is out of scope for an isolated branch/local queue-semantics test",
    },
    scenarios: {},
    findings: [],
  };

  // ---- Scenario A: full lifecycle, good job (enqueue -> claim -> completion with result) -------
  {
    const goodJobRunner = async (item) => `pt08 good job ${item.id} completed synchronously`;
    const id = await enqueue(client, orgId, { agentId: "pt08-good-job", priority: 5 });
    const enqueued = await snapshot(client, id);

    const claimed = await claimNextQueueItem(client);
    const afterClaim = await snapshot(client, id);

    const runResult = await runQueueItem(client, claimed, goodJobRunner);
    const afterRun = await snapshot(client, id);

    evidence.scenarios.A_full_lifecycle_success = {
      description:
        "enqueue a job, confirm a worker CLAIMS it (status transition captured), confirm it reaches COMPLETION with its result written",
      jobRunnerKind: "local stand-in (see methodology.goodJobRunner)",
      transitions: [
        { step: "enqueued", state: enqueued },
        { step: "claimed", claimReturnedThisRow: claimed?.id === id, state: afterClaim },
        { step: "completed", runResult, state: afterRun },
      ],
      assertions: {
        enqueuedStatusWasQueued: enqueued.status === "queued",
        claimSetStatusToProcessing: afterClaim.status === "processing",
        claimSetStartedAt: afterClaim.started_at !== null,
        completionSetStatusToCompleted: afterRun.status === "completed",
        completionSetCompletedAt: afterRun.completed_at !== null,
        completionWroteOutputPayloadSummary:
          typeof afterRun.output_payload?.summary === "string" && afterRun.output_payload.summary.length > 0,
      },
    };
  }

  // ---- Scenario B: retry recovery (fail once, requeued, reclaimed, succeeds) --------------------
  {
    let callCount = 0;
    const flakyThenGoodJobRunner = async (item) => {
      callCount += 1;
      if (callCount === 1) throw new Error("pt08 simulated transient failure on first attempt");
      return `pt08 flaky job ${item.id} succeeded on attempt ${callCount}`;
    };

    const id = await enqueue(client, orgId, { agentId: "pt08-flaky-job", priority: 5, maxRetries: 3 });
    const enqueued = await snapshot(client, id);

    const claim1 = await claimNextQueueItem(client);
    const afterClaim1 = await snapshot(client, id);
    const run1 = await runQueueItem(client, claim1, flakyThenGoodJobRunner);
    const afterRun1 = await snapshot(client, id);

    // Re-claim: the row was requeued (status back to 'queued'), so a fresh poll should pick it
    // straight back up since it is the only queued row.
    const claim2 = await claimNextQueueItem(client);
    const afterClaim2 = await snapshot(client, id);
    const run2 = await runQueueItem(client, claim2, flakyThenGoodJobRunner);
    const afterRun2 = await snapshot(client, id);

    evidence.scenarios.B_retry_then_recovery = {
      description:
        "simulate a failure and confirm RETRY behavior: the row is requeued (not terminal) with retry_count incremented and an error_message recorded, is reclaimable, and a subsequent successful attempt reaches COMPLETION",
      jobRunnerKind: "local stand-in, fails on call 1 then succeeds on call 2 (see methodology.goodJobRunner)",
      transitions: [
        { step: "enqueued", state: enqueued },
        { step: "claimed_attempt_1", claimReturnedThisRow: claim1?.id === id, state: afterClaim1 },
        { step: "failed_attempt_1_requeued", runResult: run1, state: afterRun1 },
        { step: "claimed_attempt_2", claimReturnedThisRow: claim2?.id === id, state: afterClaim2 },
        { step: "succeeded_attempt_2_completed", runResult: run2, state: afterRun2 },
      ],
      assertions: {
        firstFailureRequeuedNotTerminal: afterRun1.status === "queued",
        firstFailureIncrementedRetryCount: afterRun1.retry_count === 1,
        firstFailureRecordedErrorMessage:
          typeof afterRun1.error_message === "string" && afterRun1.error_message.length > 0,
        firstFailureLeftCompletedAtNull: afterRun1.completed_at === null,
        requeuedRowWasReclaimable: claim2?.id === id,
        secondAttemptReachedCompletion: afterRun2.status === "completed",
        secondAttemptWroteOutput: typeof afterRun2.output_payload?.summary === "string",
      },
    };
  }

  // ---- Scenario C: exhaust retries -> max-retries terminal state (real routeQueueItem throw) ----
  {
    const poisonAgentId = "pt08-poison-agent-does-not-exist-in-switch";
    const id = await enqueue(client, orgId, {
      agentId: poisonAgentId,
      priority: 5,
      maxRetries: 3,
    });
    const enqueued = await snapshot(client, id);

    // Exactly maxRetries claim/run cycles are expected to actually claim the row (it reaches the
    // terminal 'failed' state on the maxRetries-th failure and is never 'queued' again after
    // that) -- the separate fourthClaimAttempt check below independently confirms non-reclaim.
    const attempts = [];
    for (let attemptNum = 1; attemptNum <= 3; attemptNum += 1) {
      const claimed = await claimNextQueueItem(client);
      if (!claimed) {
        throw new Error(
          `Scenario C: expected the poison row to still be claimable on attempt ${attemptNum} of 3 ` +
            `(max_retries=3), but claimNextQueueItem() returned null early -- broken semantic, not a script bug.`,
        );
      }
      const runResult = await runQueueItem(client, claimed, (item) => realRouteQueueItem(null, item));
      const state = await snapshot(client, id);
      attempts.push({ step: `attempt_${attemptNum}`, attemptNum, claimed: true, runResult, state });
    }

    const finalState = await snapshot(client, id);
    const fourthClaimAttempt = await claimNextQueueItem(client); // should be null: row is terminal

    evidence.scenarios.C_exhaust_retries_max_terminal = {
      description:
        "a job whose work always fails is retried up to max_retries, then reaches the max-retries TERMINAL state ('failed', completed_at set) and is never reclaimed again",
      jobRunnerKind:
        "the REAL, unmodified routeQueueItem() default-case throw (see methodology.poisonJobRunner) -- agent_id matches no switch case, so every attempt genuinely throws production's real \"Unknown agent_queue agent_id\" error",
      maxRetries: 3,
      transitions: [{ step: "enqueued", state: enqueued }, ...attempts],
      finalState,
      fourthClaimAttemptReturnedNull: fourthClaimAttempt === null,
      assertions: {
        attemptCountMatchesMaxRetries: attempts.filter((a) => a.claimed).length === 3,
        finalStatusIsFailed: finalState.status === "failed",
        finalRetryCountEqualsMaxRetries: finalState.retry_count === 3,
        finalCompletedAtIsSet: finalState.completed_at !== null,
        finalErrorMessageIsRealThrow:
          typeof finalState.error_message === "string" &&
          finalState.error_message.includes(`Unknown agent_queue agent_id: "${poisonAgentId}"`),
        terminalRowNeverReclaimedAgain: fourthClaimAttempt === null,
      },
    };
  }

  // ---- Scenario D: failure isolation -- a poison job must not block a good job behind it --------
  {
    const poisonAgentId = "pt08-isolation-poison-agent-does-not-exist";
    const poisonId = await enqueue(client, orgId, { agentId: poisonAgentId, priority: 5, maxRetries: 3 });
    // Queued strictly after the poison job (later queued_at), same priority, so
    // claimNextQueueItem's ORDER BY priority DESC, queued_at ASC guarantees the poison job is
    // claimed first every time it is still 'queued' -- this is deliberately the worst case for
    // the good job: it sits directly behind a job that will fail 3 times before freeing the slot.
    await client.query("SELECT pg_sleep(0.01)"); // ensure a distinct, later queued_at
    const goodAgentId = "pt08-isolation-good-job";
    const goodId = await enqueue(client, orgId, { agentId: goodAgentId, priority: 5, maxRetries: 3 });

    const goodJobRunner = async (item) => `pt08 isolation good job ${item.id} completed`;
    const jobRunnerFor = (item) =>
      item.agent_id === poisonAgentId ? realRouteQueueItem(null, item) : goodJobRunner(item);

    const iterations = [];
    const MAX_ITERATIONS = 10; // safety cap; the real loop would run until queue is empty
    let goodJobCompleted = false;
    for (let i = 1; i <= MAX_ITERATIONS && !goodJobCompleted; i += 1) {
      const claimed = await claimNextQueueItem(client);
      if (!claimed) {
        iterations.push({ iteration: i, claimed: false, note: "queue empty" });
        break;
      }
      const runResult = await runQueueItem(client, claimed, jobRunnerFor);
      iterations.push({
        iteration: i,
        claimedAgentId: claimed.agent_id,
        claimedIsPoisonJob: claimed.agent_id === poisonAgentId,
        runResult,
      });
      if (claimed.agent_id === goodAgentId && runResult.outcome === "completed") {
        goodJobCompleted = true;
      }
    }

    const poisonFinal = await snapshot(client, poisonId);
    const goodFinal = await snapshot(client, goodId);

    const poisonIterationsBeforeGoodFirstClaimed = (() => {
      const goodFirstIdx = iterations.findIndex((it) => it.claimedAgentId === goodAgentId);
      if (goodFirstIdx === -1) return null;
      return iterations.slice(0, goodFirstIdx).filter((it) => it.claimedIsPoisonJob).length;
    })();

    evidence.scenarios.D_poison_job_does_not_block_queue = {
      description:
        "failure isolation: a poison job that always fails, enqueued strictly ahead of a good job (same priority, earlier queued_at -- guaranteeing it is always claimed first while queued), must not permanently block the good job -- the good job must still reach COMPLETION once the poison job's bounded retries are exhausted",
      jobRunnerKind:
        "poison agent_id routed through the REAL routeQueueItem() default throw; good agent_id routed through the local stand-in",
      poisonAgentId,
      goodAgentId,
      iterations,
      poisonFinalState: poisonFinal,
      goodFinalState: goodFinal,
      poisonJobAttemptsBeforeGoodJobFirstClaimed: poisonIterationsBeforeGoodFirstClaimed,
      assertions: {
        goodJobReachedCompletion: goodFinal.status === "completed" && goodJobCompleted,
        goodJobWroteOutput: typeof goodFinal.output_payload?.summary === "string",
        poisonJobReachedTerminalFailedState: poisonFinal.status === "failed",
        poisonJobWasClaimedBeforeGoodJobAtLeastOnce:
          poisonIterationsBeforeGoodFirstClaimed !== null && poisonIterationsBeforeGoodFirstClaimed > 0,
        totalIterationsUsed: iterations.length,
      },
    };
  }

  // ---- Ancillary observation: no queue-level timeout wraps a claimed item's execution -----------
  // Not a scenario this task asked to exercise (a hang, vs. a job that throws), but directly
  // relevant to "does a poison job block the queue": grepped worker/autonomous-orchestrator.ts for
  // timeout/Promise.race/setTimeout -- the only match is the sleep() helper used for the
  // empty-queue poll backoff (line 151). processAgentQueue()'s while-loop `await`s runQueueItem()
  // (which itself `await`s routeQueueItem()) to full completion before claiming the next item,
  // with no timeout wrapper at the queue-processor layer itself. A job that fails fast (throws) is
  // bounded by max_retries, as scenarios C/D demonstrate -- but a job whose work HANGS (never
  // resolves, never rejects -- e.g. an agent awaiting a dead external call with no timeout of its
  // own) would not be bounded by anything visible at this layer, and would block every other
  // queued item indefinitely. This is a real, distinct failure mode from what this task's
  // "simulate a failure" scenarios cover (a throw/reject), flagged here as an observation, not
  // independently reproduced (reproducing a true infinite hang would itself hang this test run).
  evidence.findings.push({
    id: "PENDING-WGR-ID",
    severity: "P1",
    layer: "Worker/Queue",
    description:
      "worker/autonomous-orchestrator.ts's processAgentQueue()/runQueueItem() has no per-item timeout wrapper (grepped for timeout/Promise.race/setTimeout: only match is the empty-poll sleep() helper at line 151). A claimed job that throws is correctly bounded by max_retries (scenarios C and D above both confirm this empirically), but a job whose work hangs (never resolves, never rejects) would block every other queued item indefinitely, since the while-loop fully awaits runQueueItem() before claiming the next candidate. Not independently reproduced here (a genuine infinite hang would hang this test run itself) -- recorded as a code-read observation surfaced directly by this test's own methodology, not live-verified against a real hang.",
    scopeTag: "UNVERIFIED",
  });

  // Compute an overall verdict: did any scenario's assertions come back false?
  const brokenSemantics = [];
  for (const [name, scenario] of Object.entries(evidence.scenarios)) {
    for (const [assertionName, value] of Object.entries(scenario.assertions ?? {})) {
      if (value === false) {
        brokenSemantics.push(`${name}.assertions.${assertionName}`);
      }
    }
  }
  evidence.overallVerdict = brokenSemantics.length === 0 ? "ALL_SEMANTICS_CORRECT" : "BROKEN_SEMANTICS_FOUND";
  evidence.brokenAssertions = brokenSemantics;

  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outPath}`);
  console.log(`Overall verdict: ${evidence.overallVerdict}`);
  if (brokenSemantics.length > 0) {
    console.log(`Broken assertions: ${brokenSemantics.join(", ")}`);
  }

  await client.end();
}

main().catch((err) => {
  console.error("PT-08-003 exercise script FAILED:", err);
  process.exit(1);
});
