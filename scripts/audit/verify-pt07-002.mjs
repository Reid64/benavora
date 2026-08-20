// ============================================================================
// PT-07-002 verifier -- real Railway worker job round-trip.
//
// Exits non-zero unless test-evidence/pt-07/worker-roundtrip.json exists, is
// valid JSON, and records all three of:
//   1. A real, live worker_status heartbeat check (heartbeatBefore.isLive
//      true, with a real captured worker row).
//   2. A real agent_queue job the worker itself claimed (a "claimed"
//      transition with status="processing" and a real started_at, distinct
//      from the "enqueued" before-state).
//   3. A real completion write-back (finalState.status="completed",
//      completed_at set, and a non-empty output_payload.summary).
//
// Per the task's own instruction, the worker failing to pick up the job or
// failing to write completion is a P1 finding, not a script bug -- so this
// verifier intentionally fails loudly on that case (does not downgrade it to
// a soft "FINDING" the way PT-07-001's storage/realtime probes do), matching
// step 3's explicit requirement.
//
// Usage: node scripts/audit/verify-pt07-002.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";

const STATE_FILE = path.join("test-evidence", "pt-07", "worker-roundtrip.json");

let errors = 0;
function fail(message) {
  console.error(`FAIL: ${message}`);
  errors++;
}
function ok(message) {
  console.log(`OK: ${message}`);
}

if (!fs.existsSync(STATE_FILE)) {
  fail(`${STATE_FILE} does not exist.`);
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

const raw = fs.readFileSync(STATE_FILE, "utf8");
if (raw.trim().length === 0) {
  fail(`${STATE_FILE} is empty.`);
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(raw);
} catch (err) {
  fail(`${STATE_FILE} is not valid JSON: ${err.message}`);
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

if (data.halted) {
  fail(`worker-roundtrip.json recorded halted=true (reason: ${data.reason ?? "n/a"}) -- the round-trip never ran to completion.`);
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

// --- Check 1: real, live heartbeat -----------------------------------------

const hb = data.heartbeatBefore;
if (!hb) {
  fail(`heartbeatBefore is missing.`);
} else {
  if (!Array.isArray(hb.realResponse) || hb.realResponse.length === 0) {
    fail(`heartbeatBefore.realResponse is missing or empty -- no real worker_status rows were captured.`);
  }
  if (!hb.freshestWorker || typeof hb.freshestWorker.heartbeat_age_seconds !== "number") {
    fail(`heartbeatBefore.freshestWorker is missing a real numeric heartbeat_age_seconds.`);
  }
  if (hb.isLive !== true) {
    fail(
      `heartbeatBefore.isLive is not true (freshest worker "${hb.freshestWorker?.worker_id ?? "none"}" was ` +
        `${hb.freshestWorker?.heartbeat_age_seconds ?? "n/a"}s old, threshold ${hb.freshnessThresholdSeconds ?? "n/a"}s) -- ` +
        `the Railway worker does not appear to be live.`,
    );
  } else {
    ok(`Heartbeat confirmed live: worker "${hb.freshestWorker.worker_id}" ticked ${hb.freshestWorker.heartbeat_age_seconds}s ago.`);
  }
}

// --- Check 2: real job pickup ------------------------------------------------
//
// Pickup is proven by the terminal row's own started_at timestamp (set only
// by the worker's claim step, never by enqueue) being present and >= the
// original queued_at -- this is authoritative regardless of whether an
// intermediate poll happened to catch a transient status="processing" row
// (a fast, deterministic job can go straight from "queued" to "completed"
// between two polls; that is still real pickup, not a miss). If a
// "claimed" transition WAS captured, its own state is cross-checked too, as
// corroborating (not required) evidence.

const job = data.job;
if (!job) {
  fail(`job is missing.`);
} else {
  if (!job.beforeState || job.beforeState.status !== "queued" || !job.beforeState.queued_at) {
    fail(`job.beforeState is missing, its status is not "queued", or it has no queued_at -- no real enqueue was captured.`);
  }
  if (!job.finalState) {
    fail(`job.finalState is missing -- no real terminal row was captured.`);
  } else if (!job.finalState.started_at) {
    fail(
      `job.finalState.started_at is not set (final status="${job.finalState.status}") -- the worker never claimed ` +
        `agent_queue row ${job.queueRowId} (agentId="${job.agentId}"). This is the P1 finding case: the real ` +
        `worker is not picking up queued jobs.`,
    );
  } else if (job.beforeState?.queued_at && new Date(job.finalState.started_at).getTime() < new Date(job.beforeState.queued_at).getTime()) {
    fail(`job.finalState.started_at (${job.finalState.started_at}) is before job.beforeState.queued_at (${job.beforeState.queued_at}) -- not a real claim.`);
  } else {
    if (job.pickedUp !== true) {
      fail(`job.pickedUp is not true despite finalState.started_at being a valid post-enqueue timestamp -- inconsistent evidence.`);
    } else {
      ok(`Real pickup confirmed: queue row ${job.queueRowId} claimed at started_at=${job.finalState.started_at} (queued_at=${job.beforeState.queued_at}).`);
    }
  }

  if (Array.isArray(job.transitions)) {
    const claimed = job.transitions.find((t) => t.step === "claimed");
    if (claimed) {
      if (claimed.state?.status !== "processing") {
        fail(`job.transitions "claimed" step's state.status is "${claimed.state?.status}", expected "processing".`);
      } else {
        ok(`Corroborating: an intermediate poll caught status="processing" at +${claimed.atElapsedMs}ms.`);
      }
    }
  } else {
    fail(`job.transitions is not an array.`);
  }
}

// --- Check 3: real completion write-back --------------------------------------

if (job) {
  const finalState = job.finalState;
  if (!finalState) {
    fail(`job.finalState is missing.`);
  } else {
    if (finalState.status === "failed") {
      fail(
        `job.finalState.status is "failed" (error_message="${finalState.error_message ?? "n/a"}") -- the worker ` +
          `claimed the job but did not write a successful completion. This is the P1 finding case: the ` +
          `worker is not completing jobs it claims.`,
      );
    } else if (finalState.status !== "completed") {
      fail(
        `job.finalState.status is "${finalState.status}", expected "completed" (timedOut=${job.timedOut}) -- no ` +
          `real completion write-back was observed within the poll window. This is the P1 finding case: the ` +
          `worker is not writing completion back.`,
      );
    } else {
      if (!finalState.completed_at) {
        fail(`job.finalState.status is "completed" but completed_at is not set.`);
      }
      const summary = finalState.output_payload && typeof finalState.output_payload === "object"
        ? finalState.output_payload.summary
        : undefined;
      if (typeof summary !== "string" || summary.trim().length === 0) {
        fail(`job.finalState.output_payload.summary is missing or empty -- no real output was written back.`);
      } else {
        ok(`Real completion confirmed: queue row ${job.queueRowId} completed at ${finalState.completed_at} with output_payload.summary="${summary}".`);
      }
      if (job.completedWithOutput !== true) {
        fail(`job.completedWithOutput is not true despite a completed finalState with a real summary -- inconsistent evidence.`);
      }
    }
  }
}

// --- Check 4: cleanup actually verified ----------------------------------------

if (!data.cleanup || !data.cleanup.verify) {
  fail(`cleanup.verify is missing -- disposable org/queue-row cleanup was not confirmed.`);
} else {
  if (data.cleanup.verify.orgGone !== true) {
    fail(`cleanup.verify.orgGone is not true -- the disposable test org was not confirmed deleted.`);
  }
  if (data.cleanup.verify.queueRowGone !== true) {
    fail(`cleanup.verify.queueRowGone is not true -- the test agent_queue row was not confirmed deleted.`);
  }
  if (data.cleanup.verify.orgGone === true && data.cleanup.verify.queueRowGone === true) {
    ok(`Disposable test org and queue row confirmed cleaned up.`);
  }
}

// --- Overall summary consistency ------------------------------------------------

if (!data.summary || data.summary.overall_verdict !== "PASS") {
  fail(`data.summary.overall_verdict is "${data.summary?.overall_verdict}", expected "PASS".`);
}

if (Array.isArray(data.findings) && data.findings.length > 0) {
  fail(
    `worker-roundtrip.json recorded ${data.findings.length} finding(s) -- per this task, a worker that does ` +
      `not pick up jobs or does not write completion is a P1 finding, and this verifier must fail on it: ` +
      data.findings.map((f) => `[${f.severity}] ${f.description}`).join(" | "),
  );
}

if (errors > 0) {
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

console.log(
  `\nPASS: ${STATE_FILE} records a live worker heartbeat, a real agent_queue job claimed by the real ` +
    `worker, and a real completion written back with output_payload.summary.`,
);
process.exit(0);
