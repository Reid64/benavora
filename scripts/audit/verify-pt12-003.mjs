// ============================================================================
// PT-12-003 verifier — sustained soak + memory-growth (leak) tracking
// evidence.
//
// Exits non-zero unless:
//   1. test-evidence/pt-12/soak-memory.json exists, is valid JSON.
//   2. The evidence records an explicit non-production-target assertion
//      (target.isProductionTarget === false, and target.branchProjectRef
//      !== the production ref) -- this soak must not have run against
//      production.
//   3. `memorySeries.next` and `memorySeries.worker` are BOTH present arrays
//      with at least MIN_SAMPLES entries each -- a real time series, not a
//      single before/after point (a leak is a trend, not a two-point diff).
//   4. Every sample in both series has a numeric, non-negative `t` (ms since
//      soak start) and `t` is non-decreasing across the series (a real
//      ordered time series), and at least MIN_USABLE_FRACTION of the samples
//      in each series have a real numeric `rssBytes` (a series that's mostly
//      null/dead-process readings recorded nothing useful).
//   5. `analysis.next.verdict` and `analysis.worker.verdict` are each
//      present and are exactly "flat" or "climbing" -- not missing, and not
//      "insufficient_data" (that would mean the soak did not actually run
//      long enough to reach a verdict, which is a failure of this audit
//      step, not a legitimate finding). Both verdicts are equally valid
//      PASS outcomes for the verifier -- "climbing" is a real, correctly-
//      recorded P1 finding, not a script failure; the verifier's job is to
//      confirm the soak produced an honest verdict, not to require "flat".
//   6. `findings.overallVerdict` is present and is exactly "PASS_NO_LEAK" or
//      "LEAK_FOUND", consistent with the two per-process verdicts above.
//   7. test-evidence/pt-12/soak-memory.txt exists and is non-empty.
//
// Usage: node scripts/audit/verify-pt12-003.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join("test-evidence", "pt-12");
const RESULTS_JSON = path.join(OUT_DIR, "soak-memory.json");
const RESULTS_TXT = path.join(OUT_DIR, "soak-memory.txt");

const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";
const MIN_SAMPLES = 4;
const MIN_USABLE_FRACTION = 0.8;

let errors = 0;

function fail(message) {
  console.error(`FAIL: ${message}`);
  errors++;
}

function hardFail(message) {
  console.error(`HARD FAIL: ${message}`);
  errors++;
}

// --- 1. soak-memory.json exists and parses -----------------------------------

let data = null;
if (!fs.existsSync(RESULTS_JSON)) {
  hardFail(`${RESULTS_JSON} does not exist -- no soak was recorded.`);
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
  // --- 2. explicit non-production-target assertion ---------------------------
  if (!data.target || typeof data.target !== "object") {
    hardFail(`${RESULTS_JSON}.target object is missing.`);
  } else {
    if (data.target.isProductionTarget !== false) {
      hardFail(
        `${RESULTS_JSON}.target.isProductionTarget is not explicitly false ` +
          `(got: ${JSON.stringify(data.target.isProductionTarget)}). HARD FAIL -- cannot confirm this ` +
          `soak did not run against production.`,
      );
    }
    if (data.target.branchProjectRef === PRODUCTION_REF) {
      hardFail(
        `${RESULTS_JSON}.target.branchProjectRef IS the production ref (${PRODUCTION_REF}). ` +
          `This soak ran against production. HARD FAIL.`,
      );
    }
    if (typeof data.target.supabaseUrl === "string" && data.target.supabaseUrl.includes(PRODUCTION_REF)) {
      hardFail(`${RESULTS_JSON}.target.supabaseUrl contains the production ref. HARD FAIL.`);
    }
  }

  // --- 3/4. real time series for both processes -------------------------------
  function checkSeries(name, series) {
    if (!Array.isArray(series)) {
      fail(`${RESULTS_JSON}.memorySeries.${name} is not an array.`);
      return;
    }
    if (series.length < MIN_SAMPLES) {
      fail(
        `${RESULTS_JSON}.memorySeries.${name} has only ${series.length} sample(s) -- need at least ` +
          `${MIN_SAMPLES} to be a real time series, not a single before/after point.`,
      );
      return;
    }

    let prevT = -Infinity;
    let usableCount = 0;
    series.forEach((s, i) => {
      if (typeof s.t !== "number" || !Number.isFinite(s.t) || s.t < 0) {
        fail(`memorySeries.${name}[${i}].t is not a finite, non-negative number (got: ${JSON.stringify(s.t)}).`);
      } else if (s.t < prevT) {
        fail(`memorySeries.${name}[${i}].t (${s.t}) is less than the prior sample's t (${prevT}) -- not ordered.`);
      } else {
        prevT = s.t;
      }
      if (typeof s.atIso !== "string" || s.atIso.trim().length === 0) {
        fail(`memorySeries.${name}[${i}].atIso is missing or empty.`);
      }
      if (typeof s.rssBytes === "number" && Number.isFinite(s.rssBytes) && s.rssBytes >= 0) {
        usableCount++;
      } else if (s.rssBytes !== null) {
        fail(
          `memorySeries.${name}[${i}].rssBytes must be a finite, non-negative number or explicit null ` +
            `(got: ${JSON.stringify(s.rssBytes)}).`,
        );
      }
    });

    const usableFraction = series.length > 0 ? usableCount / series.length : 0;
    if (usableFraction < MIN_USABLE_FRACTION) {
      fail(
        `${RESULTS_JSON}.memorySeries.${name}: only ${usableCount}/${series.length} samples ` +
          `(${(usableFraction * 100).toFixed(0)}%) have a real rssBytes reading -- need at least ` +
          `${(MIN_USABLE_FRACTION * 100).toFixed(0)}% (the process must have stayed measurable for most of ` +
          `the soak for the series to be meaningful).`,
      );
    }
  }

  if (!data.memorySeries || typeof data.memorySeries !== "object") {
    hardFail(`${RESULTS_JSON}.memorySeries object is missing.`);
  } else {
    checkSeries("next", data.memorySeries.next);
    checkSeries("worker", data.memorySeries.worker);
  }

  // --- 5. explicit flat-vs-climbing verdict per process ------------------------
  const VALID_VERDICTS = new Set(["flat", "climbing"]);
  function checkVerdict(name, analysis) {
    if (!analysis || typeof analysis !== "object") {
      fail(`${RESULTS_JSON}.analysis.${name} object is missing.`);
      return;
    }
    if (!VALID_VERDICTS.has(analysis.verdict)) {
      fail(
        `${RESULTS_JSON}.analysis.${name}.verdict must be exactly "flat" or "climbing" ` +
          `(got: ${JSON.stringify(analysis.verdict)}). "insufficient_data" means the soak did not run long ` +
          `enough to reach a real verdict -- that is a failure of this audit step, not an acceptable result.`,
      );
    }
    if (typeof analysis.note !== "string" || analysis.note.trim().length === 0) {
      fail(`${RESULTS_JSON}.analysis.${name}.note must be a non-empty explanatory string.`);
    }
  }

  if (!data.analysis || typeof data.analysis !== "object") {
    hardFail(`${RESULTS_JSON}.analysis object is missing.`);
  } else {
    checkVerdict("next", data.analysis.next);
    checkVerdict("worker", data.analysis.worker);
  }

  // --- 6. findings section with an explicit overall verdict --------------------
  const VALID_OVERALL = new Set(["PASS_NO_LEAK", "LEAK_FOUND"]);
  if (!data.findings || typeof data.findings !== "object") {
    fail(`${RESULTS_JSON}.findings object is missing.`);
  } else {
    if (!VALID_OVERALL.has(data.findings.overallVerdict)) {
      fail(
        `${RESULTS_JSON}.findings.overallVerdict must be exactly "PASS_NO_LEAK" or "LEAK_FOUND" ` +
          `(got: ${JSON.stringify(data.findings.overallVerdict)}).`,
      );
    }
    if (
      data.analysis &&
      data.analysis.next &&
      data.analysis.worker &&
      VALID_VERDICTS.has(data.analysis.next.verdict) &&
      VALID_VERDICTS.has(data.analysis.worker.verdict)
    ) {
      const expectClimb = data.analysis.next.verdict === "climbing" || data.analysis.worker.verdict === "climbing";
      const expected = expectClimb ? "LEAK_FOUND" : "PASS_NO_LEAK";
      if (data.findings.overallVerdict !== expected) {
        fail(
          `${RESULTS_JSON}.findings.overallVerdict ("${data.findings.overallVerdict}") is inconsistent with ` +
            `the per-process verdicts (next=${data.analysis.next.verdict}, worker=${data.analysis.worker.verdict}) -- ` +
            `expected "${expected}".`,
        );
      }
    }
    if (typeof data.findings.note !== "string" || data.findings.note.trim().length === 0) {
      fail(`${RESULTS_JSON}.findings.note must be a non-empty explanatory string.`);
    }
  }
}

// --- 7. human-readable companion ---------------------------------------------

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
  `PASS: ${RESULTS_JSON} records a real memory-over-time series for both the Next.js server ` +
    `(${data.memorySeries.next.length} samples) and the worker (${data.memorySeries.worker.length} samples).`,
);
console.log(`PASS: target is confirmed non-production (branch ref !== production ref).`);
console.log(
  `PASS: both processes have an explicit flat-vs-climbing verdict (next=${data.analysis.next.verdict}, ` +
    `worker=${data.analysis.worker.verdict}) -- overallVerdict=${data.findings.overallVerdict}.`,
);
console.log(`PASS: ${RESULTS_TXT} exists and is non-empty.`);
process.exit(0);
