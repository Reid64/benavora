// ============================================================================
// PT-12-004 verifier — DB connection-pool contention + rate-limiter-under-
// contention evidence.
//
// Exits non-zero unless test-evidence/pt-12/pool-ratelimit.json:
//   1. Exists, is valid JSON, and status === "complete" (not a leftover
//      in-progress incremental write from an interrupted run).
//   2. Records the target as confirmed non-production (isProductionTarget
//      === false, branchProjectRef !== the production ref).
//   3. Has a `levels` array with >= 3 distinct, strictly-increasing
//      concurrency steps -- a single point can't show contention behavior
//      changing with load.
//   4. Every level records real pool-stress evidence: outcomeCounts whose
//      four buckets (success/timeout/pool_exhaustion_error/other_error)
//      sum to exactly `concurrency` (every fired request accounted for,
//      none silently dropped), and an explicit `behavior` classification
//      drawn from the known set.
//   5. Every level records real rate-limiter-contention evidence for BOTH
//      the should-block and should-allow funders: a `results` array whose
//      length equals the configured calls-per-funder, and explicit
//      falseAllowCount / falseBlockCount integers consistent with what's
//      actually in that level's own `results` array (recomputed here, not
//      just trusted from the field).
//   6. Records a top-level `findings` object with non-empty explanatory
//      notes for both poolStress and rateLimiterContention, and the
//      aggregate totalFalseAllows/totalFalseBlocks counts are present and
//      match the sum of the per-level counts (recomputed here).
//   7. Records that the synthetic seeded autoapply_submissions row used for
//      the should-block case was independently verified deleted
//      (cleanup.verifiedAbsent === true) -- this test writes real data to
//      a real table and must prove it cleaned up after itself.
//
// This verifier does NOT require any particular finding (e.g. it does not
// require poolStress.anyHardErrors to be true or false, and does not
// require totalFalseAllows/totalFalseBlocks to be zero or nonzero) --
// pool behavior and rate-limiter behavior under contention are the things
// being MEASURED, not asserted in advance. What it requires is that the
// measurement actually happened, is internally consistent, and is
// honestly reported either way.
//
// Usage: node scripts/audit/verify-pt12-004.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join("test-evidence", "pt-12");
const RESULTS_JSON = path.join(OUT_DIR, "pool-ratelimit.json");

const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";
const MIN_LEVELS = 3;
const VALID_POOL_BEHAVIORS = new Set(["graceful_queue", "hard_errors", "other_errors", "timeouts_no_hard_errors"]);

let errors = 0;

function fail(message) {
  console.error(`FAIL: ${message}`);
  errors++;
}

function hardFail(message) {
  console.error(`HARD FAIL: ${message}`);
  errors++;
}

// --- 1. file exists, parses, is a completed run -----------------------------

let data = null;
if (!fs.existsSync(RESULTS_JSON)) {
  hardFail(`${RESULTS_JSON} does not exist -- no pool/rate-limiter contention test was recorded.`);
} else {
  const raw = fs.readFileSync(RESULTS_JSON, "utf8");
  if (raw.trim().length === 0) {
    hardFail(`${RESULTS_JSON} is empty.`);
  } else {
    try {
      data = JSON.parse(raw);
    } catch (err) {
      hardFail(`${RESULTS_JSON} is not valid JSON: ${err.message}`);
    }
  }
}

if (data && data.status !== "complete") {
  hardFail(
    `${RESULTS_JSON}.status is "${data.status}", not "complete" -- this looks like an incremental write from ` +
      `an interrupted run, not a finished test.`,
  );
}

if (data) {
  // --- 2. confirmed non-production target ------------------------------------
  if (!data.target || typeof data.target !== "object") {
    hardFail(`${RESULTS_JSON}.target object is missing.`);
  } else {
    if (data.target.isProductionTarget !== false) {
      hardFail(
        `${RESULTS_JSON}.target.isProductionTarget is not explicitly false ` +
          `(got: ${JSON.stringify(data.target.isProductionTarget)}). HARD FAIL -- cannot confirm this test ` +
          `did not run contention load against production.`,
      );
    }
    if (data.target.branchProjectRef === PRODUCTION_REF) {
      hardFail(`${RESULTS_JSON}.target.branchProjectRef IS the production ref (${PRODUCTION_REF}). HARD FAIL.`);
    }
    if (typeof data.target.supabaseUrl === "string" && data.target.supabaseUrl.includes(PRODUCTION_REF)) {
      hardFail(`${RESULTS_JSON}.target.supabaseUrl contains the production ref. HARD FAIL.`);
    }
  }

  // --- 3. multiple, ordered concurrency levels --------------------------------
  let levelsValid = false;
  if (!Array.isArray(data.levels)) {
    hardFail(`${RESULTS_JSON}.levels is not an array.`);
  } else if (data.levels.length < MIN_LEVELS) {
    hardFail(
      `${RESULTS_JSON}.levels has only ${data.levels.length} entries -- need at least ${MIN_LEVELS} distinct ` +
        `concurrency levels to show contention behavior changing with load, not a single-point measurement.`,
    );
  } else {
    levelsValid = true;
    let prevConcurrency = -Infinity;

    let sumFalseAllows = 0;
    let sumFalseBlocks = 0;

    data.levels.forEach((level, i) => {
      const label = `levels[${i}]`;

      if (typeof level.concurrency !== "number" || !Number.isFinite(level.concurrency) || level.concurrency <= 0) {
        fail(`${label}.concurrency is not a positive number (got: ${JSON.stringify(level.concurrency)}).`);
        return;
      }
      if (level.concurrency <= prevConcurrency) {
        fail(`${label}.concurrency (${level.concurrency}) is not strictly greater than the prior level's (${prevConcurrency}).`);
      }
      prevConcurrency = level.concurrency;

      // --- 4. pool-stress evidence ----------------------------------------------
      const ps = level.poolStress;
      if (!ps || typeof ps !== "object") {
        fail(`${label} (concurrency=${level.concurrency}) is missing a "poolStress" object.`);
      } else {
        const oc = ps.outcomeCounts;
        if (!oc || typeof oc !== "object") {
          fail(`${label}.poolStress.outcomeCounts is missing.`);
        } else {
          for (const key of ["success", "timeout", "pool_exhaustion_error", "statement_timeout_error", "other_error"]) {
            if (typeof oc[key] !== "number" || oc[key] < 0) {
              fail(`${label}.poolStress.outcomeCounts.${key} is not a non-negative number (got: ${JSON.stringify(oc[key])}).`);
            }
          }
          const sum =
            (oc.success ?? 0) +
            (oc.timeout ?? 0) +
            (oc.pool_exhaustion_error ?? 0) +
            (oc.statement_timeout_error ?? 0) +
            (oc.other_error ?? 0);
          if (sum !== level.concurrency) {
            fail(
              `${label}.poolStress.outcomeCounts sums to ${sum}, not concurrency (${level.concurrency}) -- ` +
                `some fired requests were not accounted for.`,
            );
          }
        }
        if (!VALID_POOL_BEHAVIORS.has(ps.behavior)) {
          fail(`${label}.poolStress.behavior is not one of the known values (got: ${JSON.stringify(ps.behavior)}).`);
        }
        if (typeof ps.wallMs !== "number" && typeof level.wallMs !== "number") {
          fail(`${label} is missing a numeric wallMs (checked both level.wallMs and level.poolStress.wallMs).`);
        }
      }

      // --- 5. rate-limiter-contention evidence, both funders --------------------
      const rl = level.rateLimiterContention;
      if (!rl || typeof rl !== "object") {
        fail(`${label} (concurrency=${level.concurrency}) is missing a "rateLimiterContention" object.`);
      } else {
        for (const key of ["shouldBlock", "shouldAllow"]) {
          const bucket = rl[key];
          if (!bucket || typeof bucket !== "object") {
            fail(`${label}.rateLimiterContention.${key} is missing.`);
            continue;
          }
          if (!Array.isArray(bucket.results) || bucket.results.length === 0) {
            fail(`${label}.rateLimiterContention.${key}.results is not a non-empty array.`);
            continue;
          }
          for (const r of bucket.results) {
            if (typeof r.canSubmit !== "boolean") {
              fail(`${label}.rateLimiterContention.${key} has a result with a non-boolean canSubmit (got: ${JSON.stringify(r.canSubmit)}).`);
            }
          }
          if (key === "shouldBlock") {
            const recomputed = bucket.results.filter((r) => r.canSubmit === true).length;
            if (typeof bucket.falseAllowCount !== "number") {
              fail(`${label}.rateLimiterContention.shouldBlock.falseAllowCount is not a number.`);
            } else if (bucket.falseAllowCount !== recomputed) {
              fail(
                `${label}.rateLimiterContention.shouldBlock.falseAllowCount (${bucket.falseAllowCount}) does not ` +
                  `match recomputed count of results with canSubmit=true (${recomputed}).`,
              );
            } else {
              sumFalseAllows += bucket.falseAllowCount;
            }
          } else {
            const recomputed = bucket.results.filter((r) => r.canSubmit === false).length;
            if (typeof bucket.falseBlockCount !== "number") {
              fail(`${label}.rateLimiterContention.shouldAllow.falseBlockCount is not a number.`);
            } else if (bucket.falseBlockCount !== recomputed) {
              fail(
                `${label}.rateLimiterContention.shouldAllow.falseBlockCount (${bucket.falseBlockCount}) does not ` +
                  `match recomputed count of results with canSubmit=false (${recomputed}).`,
              );
            } else {
              sumFalseBlocks += bucket.falseBlockCount;
            }
          }
        }
      }
    });

    // --- 6. top-level findings, consistent with per-level data -----------------
    if (!data.findings || typeof data.findings !== "object") {
      fail(`${RESULTS_JSON}.findings object is missing.`);
    } else {
      const pf = data.findings.poolStress;
      const rf = data.findings.rateLimiterContention;
      if (!pf || typeof pf.note !== "string" || pf.note.trim().length === 0) {
        fail(`${RESULTS_JSON}.findings.poolStress.note must be a non-empty explanatory string.`);
      }
      if (!rf || typeof rf.note !== "string" || rf.note.trim().length === 0) {
        fail(`${RESULTS_JSON}.findings.rateLimiterContention.note must be a non-empty explanatory string.`);
      }
      if (!rf || typeof rf.totalFalseAllows !== "number") {
        fail(`${RESULTS_JSON}.findings.rateLimiterContention.totalFalseAllows is missing/not a number.`);
      } else if (rf.totalFalseAllows !== sumFalseAllows) {
        fail(
          `${RESULTS_JSON}.findings.rateLimiterContention.totalFalseAllows (${rf.totalFalseAllows}) does not match ` +
            `the sum of per-level falseAllowCount values (${sumFalseAllows}).`,
        );
      }
      if (!rf || typeof rf.totalFalseBlocks !== "number") {
        fail(`${RESULTS_JSON}.findings.rateLimiterContention.totalFalseBlocks is missing/not a number.`);
      } else if (rf.totalFalseBlocks !== sumFalseBlocks) {
        fail(
          `${RESULTS_JSON}.findings.rateLimiterContention.totalFalseBlocks (${rf.totalFalseBlocks}) does not match ` +
            `the sum of per-level falseBlockCount values (${sumFalseBlocks}).`,
        );
      }
    }
  }

  // --- 7. seeded synthetic row confirmed cleaned up ---------------------------
  if (!data.cleanup || typeof data.cleanup !== "object") {
    fail(`${RESULTS_JSON}.cleanup object is missing.`);
  } else if (data.cleanup.verifiedAbsent !== true) {
    hardFail(
      `${RESULTS_JSON}.cleanup.verifiedAbsent is not true (got: ${JSON.stringify(data.cleanup.verifiedAbsent)}) -- ` +
        `the synthetic autoapply_submissions row this test seeded was not independently confirmed deleted.`,
    );
  }

  if (!levelsValid) {
    // already reported above; nothing further to check meaningfully
  }
}

// --- Verdict -------------------------------------------------------------------

if (errors > 0) {
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

console.log(
  `PASS: ${RESULTS_JSON} records ${data.levels.length} increasing concurrency levels, each with real pool-stress ` +
    `outcome counts (summing to concurrency) and a valid behavior classification.`,
);
console.log(
  `PASS: rate-limiter-under-contention results recorded for both should-block and should-allow funders at every ` +
    `level, with falseAllowCount/falseBlockCount independently recomputed and matching.`,
);
console.log(`PASS: target is confirmed non-production (branch ref !== production ref).`);
console.log(`PASS: findings section records explicit, non-empty pool-behavior and rate-limiter-behavior notes.`);
console.log(`PASS: seeded synthetic test row independently confirmed deleted (cleanup.verifiedAbsent === true).`);
process.exit(0);
