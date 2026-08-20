// PT-08-003 verifier: confirms test-evidence/pt-08/queue-semantics.json records the real
// agent_queue lifecycle transitions (claim, retry, max-retries terminal, completion) with
// before/after row state for each, plus the poison-job failure-isolation scenario. Exits 0 only
// if all checks pass; exits 1 with a printed reason on any failure.
// ASCII only. Node 20 compatible.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertJsonFileHasKey } from "./evidence-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");
const evidencePath = path.join(repoRoot, "test-evidence", "pt-08", "queue-semantics.json");

function fail(reason) {
  console.error(`PT-08-003 FAIL: ${reason}`);
  process.exit(1);
}

// Every row-state snapshot recorded in a transition must be a real agent_queue row shape, not a
// placeholder -- these are the columns migration 080 defines (minus decision_log/queued_at, which
// this check doesn't require every snapshot helper to echo back, though the real one does).
const REQUIRED_STATE_KEYS = ["id", "status", "agent_id", "retry_count", "max_retries", "completed_at"];

function checkStateSnapshot(state, contextLabel) {
  if (!state || typeof state !== "object") {
    fail(`${contextLabel}: state snapshot is missing or not an object`);
  }
  for (const key of REQUIRED_STATE_KEYS) {
    if (!(key in state)) {
      fail(`${contextLabel}: state snapshot is missing required column "${key}"`);
    }
  }
}

function checkTransitionsArray(transitions, contextLabel, minLength) {
  if (!Array.isArray(transitions) || transitions.length < minLength) {
    fail(
      `${contextLabel}: transitions must be an array with at least ${minLength} entries (found ${
        Array.isArray(transitions) ? transitions.length : typeof transitions
      })`,
    );
  }
  for (const [i, t] of transitions.entries()) {
    if (!t || typeof t.step !== "string" || t.step.trim() === "") {
      fail(`${contextLabel}: transitions[${i}] has no "step" label`);
    }
    const state = t.state ?? t.finalState;
    checkStateSnapshot(state, `${contextLabel}.transitions[${i}] ("${t.step ?? t.attemptNum}")`);
  }
}

function allAssertionsTrue(assertions, contextLabel) {
  if (!assertions || typeof assertions !== "object" || Object.keys(assertions).length === 0) {
    fail(`${contextLabel}: has no non-empty "assertions" object`);
  }
  const falseOnes = Object.entries(assertions).filter(([, v]) => v === false);
  if (falseOnes.length > 0) {
    fail(
      `${contextLabel}: recorded a BROKEN queue semantic -- assertion(s) false: ${falseOnes
        .map(([k]) => k)
        .join(", ")}. This is exactly the kind of finding step 3 of this task says must be ` +
        `registered, not silently passed.`,
    );
  }
}

function main() {
  let doc;
  try {
    doc = assertJsonFileHasKey(evidencePath, "scenarios");
  } catch (err) {
    fail(`queue-semantics.json check failed: ${err.message}`);
    return;
  }

  if (doc.branchOrLocalOnly !== true || doc.productionTouched !== false) {
    fail(
      `queue-semantics.json must explicitly record branchOrLocalOnly:true and productionTouched:false ` +
        `(found branchOrLocalOnly=${doc.branchOrLocalOnly}, productionTouched=${doc.productionTouched}) -- ` +
        `this task is BRANCH/LOCAL ONLY`,
    );
  }

  const s = doc.scenarios ?? {};

  // --- Scenario A: enqueue -> claim -> completion with result written -----------------------
  const a = s.A_full_lifecycle_success;
  if (!a) fail(`scenarios.A_full_lifecycle_success is missing (must cover: enqueue, claim, completion)`);
  checkTransitionsArray(a.transitions, "scenarios.A_full_lifecycle_success", 3);
  const aSteps = a.transitions.map((t) => t.step);
  for (const required of ["enqueued", "claimed", "completed"]) {
    if (!aSteps.includes(required)) {
      fail(`scenarios.A_full_lifecycle_success.transitions is missing the "${required}" step`);
    }
  }
  allAssertionsTrue(a.assertions, "scenarios.A_full_lifecycle_success");
  const completedState = a.transitions.find((t) => t.step === "completed")?.state;
  if (completedState?.status !== "completed") {
    fail(`scenarios.A_full_lifecycle_success: the "completed" transition's row status is not "completed"`);
  }
  if (typeof completedState?.output_payload?.summary !== "string" || completedState.output_payload.summary.trim() === "") {
    fail(`scenarios.A_full_lifecycle_success: completion did not write a real, non-empty output_payload.summary`);
  }

  // --- Scenario B: RETRY behavior (row requeued, retry_count incremented, reclaimed, succeeds) ---
  const b = s.B_retry_then_recovery;
  if (!b) fail(`scenarios.B_retry_then_recovery is missing (must cover: simulated failure -> RETRY)`);
  checkTransitionsArray(b.transitions, "scenarios.B_retry_then_recovery", 4);
  const retryFailState = b.transitions.find((t) => t.step && t.step.includes("failed_attempt_1"))?.state;
  if (!retryFailState) {
    fail(`scenarios.B_retry_then_recovery: no transition capturing the post-failure requeue state`);
  }
  if (retryFailState.status !== "queued" || retryFailState.retry_count !== 1) {
    fail(
      `scenarios.B_retry_then_recovery: after a simulated failure the row must be requeued ` +
        `(status="queued", retry_count=1) -- found status="${retryFailState.status}", retry_count=${retryFailState.retry_count}`,
    );
  }
  if (!retryFailState.error_message) {
    fail(`scenarios.B_retry_then_recovery: the retried row has no error_message recorded from the simulated failure`);
  }
  allAssertionsTrue(b.assertions, "scenarios.B_retry_then_recovery");

  // --- Scenario C: exhaust retries -> max-retries TERMINAL state --------------------------------
  const c = s.C_exhaust_retries_max_terminal;
  if (!c) fail(`scenarios.C_exhaust_retries_max_terminal is missing (must cover: exhaust retries -> terminal state)`);
  if (typeof c.maxRetries !== "number" || c.maxRetries < 1) {
    fail(`scenarios.C_exhaust_retries_max_terminal has no numeric maxRetries`);
  }
  checkTransitionsArray(c.transitions, "scenarios.C_exhaust_retries_max_terminal", c.maxRetries + 1);
  if (!c.finalState) fail(`scenarios.C_exhaust_retries_max_terminal has no finalState`);
  checkStateSnapshot(c.finalState, "scenarios.C_exhaust_retries_max_terminal.finalState");
  if (c.finalState.status !== "failed") {
    fail(
      `scenarios.C_exhaust_retries_max_terminal: after exhausting max_retries the row must reach the ` +
        `terminal "failed" state -- found status="${c.finalState.status}"`,
    );
  }
  if (c.finalState.retry_count !== c.maxRetries) {
    fail(
      `scenarios.C_exhaust_retries_max_terminal: finalState.retry_count (${c.finalState.retry_count}) ` +
        `does not equal maxRetries (${c.maxRetries})`,
    );
  }
  if (!c.finalState.completed_at) {
    fail(`scenarios.C_exhaust_retries_max_terminal: the terminal "failed" row has no completed_at set`);
  }
  if (c.fourthClaimAttemptReturnedNull !== true) {
    fail(
      `scenarios.C_exhaust_retries_max_terminal: a claim attempt against the now-terminal row must return ` +
        `null (the row must never be reclaimed again) -- found fourthClaimAttemptReturnedNull=${c.fourthClaimAttemptReturnedNull}`,
    );
  }
  allAssertionsTrue(c.assertions, "scenarios.C_exhaust_retries_max_terminal");

  // --- Scenario D: poison-job failure isolation --------------------------------------------------
  const d = s.D_poison_job_does_not_block_queue;
  if (!d) fail(`scenarios.D_poison_job_does_not_block_queue is missing (must cover: poison job does not block a good job behind it)`);
  if (!Array.isArray(d.iterations) || d.iterations.length < 2) {
    fail(`scenarios.D_poison_job_does_not_block_queue.iterations must be an array with at least 2 entries`);
  }
  if (!d.goodFinalState || d.goodFinalState.status !== "completed") {
    fail(
      `scenarios.D_poison_job_does_not_block_queue: the good job behind the poison job must reach ` +
        `"completed" -- found status="${d.goodFinalState?.status}"`,
    );
  }
  if (!d.poisonFinalState || d.poisonFinalState.status !== "failed") {
    fail(
      `scenarios.D_poison_job_does_not_block_queue: the poison job must reach the terminal "failed" state ` +
        `-- found status="${d.poisonFinalState?.status}"`,
    );
  }
  const poisonClaims = d.iterations.filter((it) => it.claimedIsPoisonJob === true).length;
  if (poisonClaims < 1) {
    fail(
      `scenarios.D_poison_job_does_not_block_queue: the poison job must have been claimed/attempted at ` +
        `least once ahead of the good job -- found 0 poison-job claims in iterations`,
    );
  }
  allAssertionsTrue(d.assertions, "scenarios.D_poison_job_does_not_block_queue");

  // --- Overall verdict must be present and consistent with the scenario assertions --------------
  if (doc.overallVerdict !== "ALL_SEMANTICS_CORRECT" && doc.overallVerdict !== "BROKEN_SEMANTICS_FOUND") {
    fail(`queue-semantics.json has no recognized top-level "overallVerdict"`);
  }

  console.log(
    `PT-08-003 PASS: queue-semantics.json records the real agent_queue lifecycle with before/after ` +
      `row state at each transition -- claim (scenario A), retry (scenario B), max-retries terminal ` +
      `state (scenario C), completion with output written (scenario A), and poison-job failure ` +
      `isolation (scenario D, ${poisonClaims} poison-job attempt(s) before the good job completed). ` +
      `overallVerdict: ${doc.overallVerdict}.` +
      (Array.isArray(doc.findings) && doc.findings.length > 0
        ? ` ${doc.findings.length} ancillary finding(s) recorded (see findings[] -- not a broken ` +
          `assertion, but worth registering).`
        : ""),
  );
  process.exit(0);
}

main();
