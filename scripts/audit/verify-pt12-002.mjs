// ============================================================================
// PT-12-002 verifier — concurrent-user load simulation evidence.
//
// Exits non-zero unless:
//   1. test-evidence/pt-12/load-results.json exists, is valid JSON, and its
//      `levels` array records MULTIPLE (>= 3) distinct concurrency steps --
//      a single-point measurement is not a ramp and cannot show a trend or
//      a breaking point.
//   2. Every recorded level has a strictly higher `concurrency` than the
//      one before it (a genuine ramp, not duplicate/out-of-order entries).
//   3. Every level records real latency percentiles -- `latencyMs.p50`,
//      `.p95`, and `.p99` must all be present, numeric, non-negative, and
//      non-decreasing in that order (p50 <= p95 <= p99, as percentiles of
//      the same distribution must be) -- and a real `errorRate` (a finite
//      number in [0, 1]) plus a positive `totalRequests` count (there must
//      have been real samples to compute percentiles from, not zero).
//   4. The evidence records an explicit non-production-target assertion
//      (target.isProductionTarget === false, and target.branchProjectRef
//      !== the production ref) -- this is a load test, and it must not
//      have run against production.
//   5. The evidence records a findings section with an explicit verdict on
//      whether a breaking point was reached in the tested range (a null
//      breakingPointConcurrency is legitimate -- "did not break within the
//      tested range" is itself a valid, honestly-reported finding -- but
//      the field must be present, not silently omitted).
//   6. test-evidence/pt-12/load-results.txt exists and is non-empty (the
//      human-readable companion the JSON's own writer always produces
//      alongside it).
//
// Usage: node scripts/audit/verify-pt12-002.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join("test-evidence", "pt-12");
const RESULTS_JSON = path.join(OUT_DIR, "load-results.json");
const RESULTS_TXT = path.join(OUT_DIR, "load-results.txt");

const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";
const MIN_LEVELS = 3;

let errors = 0;

function fail(message) {
  console.error(`FAIL: ${message}`);
  errors++;
}

function hardFail(message) {
  console.error(`HARD FAIL: ${message}`);
  errors++;
}

function isFiniteNonNegative(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

// --- 1. load-results.json exists and parses ---------------------------------

let data = null;
if (!fs.existsSync(RESULTS_JSON)) {
  hardFail(`${RESULTS_JSON} does not exist -- no load simulation was recorded.`);
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

if (data) {
  // --- 2. multiple, ordered concurrency levels -------------------------------
  if (!Array.isArray(data.levels)) {
    hardFail(`${RESULTS_JSON}.levels is not an array.`);
  } else if (data.levels.length < MIN_LEVELS) {
    hardFail(
      `${RESULTS_JSON}.levels has only ${data.levels.length} entries -- need at least ${MIN_LEVELS} ` +
        `distinct concurrency levels to show a ramp/trend, not a single-point measurement.`,
    );
  } else {
    let prevConcurrency = -Infinity;
    data.levels.forEach((level, i) => {
      if (typeof level.concurrency !== "number" || !Number.isFinite(level.concurrency) || level.concurrency <= 0) {
        fail(`levels[${i}].concurrency is not a positive number (got: ${JSON.stringify(level.concurrency)}).`);
        return;
      }
      if (level.concurrency <= prevConcurrency) {
        fail(
          `levels[${i}].concurrency (${level.concurrency}) is not strictly greater than the prior ` +
            `level's concurrency (${prevConcurrency}) -- levels must be a genuine increasing ramp.`,
        );
      }
      prevConcurrency = level.concurrency;

      // --- 3. real latency percentiles + error rate + request count ----------
      const lm = level.latencyMs;
      if (!lm || typeof lm !== "object") {
        fail(`levels[${i}] (concurrency=${level.concurrency}) is missing a "latencyMs" object.`);
      } else {
        for (const key of ["p50", "p95", "p99"]) {
          if (!isFiniteNonNegative(lm[key])) {
            fail(
              `levels[${i}] (concurrency=${level.concurrency}).latencyMs.${key} is not a finite, ` +
                `non-negative number (got: ${JSON.stringify(lm[key])}).`,
            );
          }
        }
        if (
          isFiniteNonNegative(lm.p50) &&
          isFiniteNonNegative(lm.p95) &&
          isFiniteNonNegative(lm.p99) &&
          !(lm.p50 <= lm.p95 && lm.p95 <= lm.p99)
        ) {
          fail(
            `levels[${i}] (concurrency=${level.concurrency}).latencyMs percentiles are not ` +
              `non-decreasing (p50=${lm.p50}, p95=${lm.p95}, p99=${lm.p99}) -- not a valid percentile set ` +
              `of one distribution.`,
          );
        }
      }

      if (typeof level.errorRate !== "number" || !Number.isFinite(level.errorRate) || level.errorRate < 0 || level.errorRate > 1) {
        fail(
          `levels[${i}] (concurrency=${level.concurrency}).errorRate must be a finite number in [0, 1] ` +
            `(got: ${JSON.stringify(level.errorRate)}).`,
        );
      }

      if (typeof level.totalRequests !== "number" || level.totalRequests <= 0) {
        fail(
          `levels[${i}] (concurrency=${level.concurrency}).totalRequests must be a positive number -- ` +
            `there must be real samples to have computed percentiles from ` +
            `(got: ${JSON.stringify(level.totalRequests)}).`,
        );
      }

      if (typeof level.throughputRps !== "number" || !Number.isFinite(level.throughputRps) || level.throughputRps < 0) {
        fail(
          `levels[${i}] (concurrency=${level.concurrency}).throughputRps must be a finite, non-negative ` +
            `number (got: ${JSON.stringify(level.throughputRps)}).`,
        );
      }
    });
  }

  // --- 4. explicit non-production-target assertion ----------------------------
  if (!data.target || typeof data.target !== "object") {
    hardFail(`${RESULTS_JSON}.target object is missing.`);
  } else {
    if (data.target.isProductionTarget !== false) {
      hardFail(
        `${RESULTS_JSON}.target.isProductionTarget is not explicitly false ` +
          `(got: ${JSON.stringify(data.target.isProductionTarget)}). HARD FAIL -- cannot confirm this ` +
          `load test did not run against production.`,
      );
    }
    if (data.target.branchProjectRef === PRODUCTION_REF) {
      hardFail(
        `${RESULTS_JSON}.target.branchProjectRef IS the production ref (${PRODUCTION_REF}). ` +
          `This load test ran against production. HARD FAIL.`,
      );
    }
    if (typeof data.target.supabaseUrl === "string" && data.target.supabaseUrl.includes(PRODUCTION_REF)) {
      hardFail(`${RESULTS_JSON}.target.supabaseUrl contains the production ref. HARD FAIL.`);
    }
  }

  // --- 5. findings section with an explicit breaking-point verdict ------------
  if (!data.findings || typeof data.findings !== "object") {
    fail(`${RESULTS_JSON}.findings object is missing.`);
  } else {
    if (!("breakingPointConcurrency" in data.findings)) {
      fail(`${RESULTS_JSON}.findings.breakingPointConcurrency key is missing (null is an acceptable value; absent is not).`);
    }
    if (!("degradationOnsetConcurrency" in data.findings)) {
      fail(`${RESULTS_JSON}.findings.degradationOnsetConcurrency key is missing.`);
    }
    if (typeof data.findings.note !== "string" || data.findings.note.trim().length === 0) {
      fail(`${RESULTS_JSON}.findings.note must be a non-empty explanatory string.`);
    }
  }
}

// --- 6. human-readable companion ---------------------------------------------

if (!fs.existsSync(RESULTS_TXT)) {
  fail(`${RESULTS_TXT} does not exist.`);
} else if (fs.readFileSync(RESULTS_TXT, "utf8").trim().length === 0) {
  fail(`${RESULTS_TXT} is empty.`);
}

// --- Verdict -------------------------------------------------------------------

if (errors > 0) {
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

console.log(
  `PASS: ${RESULTS_JSON} records ${data.levels.length} increasing concurrency levels, each with real ` +
    `latency percentiles (p50/p95/p99), error rate, throughput, and a positive request count.`,
);
console.log(`PASS: target is confirmed non-production (branch ref !== production ref).`);
console.log(`PASS: findings section records an explicit breaking-point verdict.`);
console.log(`PASS: ${RESULTS_TXT} exists and is non-empty.`);
process.exit(0);
