// ============================================================================
// PT-12-005 verifier — load-test branch teardown + PT-12 v2 closing artifacts.
//
// Exits non-zero unless:
//   1. test-evidence/pt-12/teardown.txt exists, is non-empty, and records
//      an explicit "RESULT: PASS" confirming the pt12-load-test branch is
//      GONE -- and, separately, an explicit count of zero matches for the
//      branch name in the recorded post-delete `supabase branches list`
//      output (belt-and-suspenders: the verdict line AND the raw count it
//      was derived from must both be present and must both say "gone").
//   2. A LIVE re-check (`supabase branches list --project-ref
//      <production_ref> --output-format json`) independently confirms no
//      branch named "pt12-load-test" currently exists -- this is the real
//      HARD requirement: teardown.txt describing a deletion that happened
//      once is not sufficient if the branch has since been recreated and
//      is billing again.
//   3. test-evidence/pt-12/PHASE-12-SUMMARY.md exists and is non-trivially
//      non-empty (a real word-count floor, not just "file exists").
//   4. test-evidence/pt-12/REVIEW-PACK.md exists and is non-trivially
//      non-empty.
//   5. test-evidence/_register/WIRING_GAP_REGISTER.md's total WGR-row
//      count is STRICTLY GREATER than the pre-PT-12-005 baseline (148) --
//      i.e. the register genuinely grew from this phase's findings, not
//      just referenced pre-existing rows.
//
// Usage: node scripts/audit/verify-pt12-005.mjs
// ============================================================================

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join("test-evidence", "pt-12");
const TEARDOWN_TXT = path.join(OUT_DIR, "teardown.txt");
const SUMMARY_MD = path.join(OUT_DIR, "PHASE-12-SUMMARY.md");
const REVIEW_PACK_MD = path.join(OUT_DIR, "REVIEW-PACK.md");
const REGISTER_MD = path.join("test-evidence", "_register", "WIRING_GAP_REGISTER.md");

const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";
const BRANCH_NAME = "pt12-load-test";

// The register's real WGR-row count immediately BEFORE this phase's rows
// were added (confirmed by grep before writing anything: last row was
// WGR-148). This phase must add at least one row on top of that.
const REGISTER_BASELINE_COUNT = 148;

// Minimum word counts -- real evidence documents in this repo run into the
// hundreds/thousands of words; a floor this low only exists to catch a
// literal stub/empty-with-a-title file, not to demand a specific length.
const MIN_SUMMARY_WORDS = 200;
const MIN_REVIEW_PACK_WORDS = 150;

let errors = 0;

function fail(message) {
  console.error(`FAIL: ${message}`);
  errors++;
}

function hardFail(message) {
  console.error(`HARD FAIL: ${message}`);
  errors++;
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// --- 1. teardown.txt -----------------------------------------------------

let teardownTxt = "";
if (!fs.existsSync(TEARDOWN_TXT)) {
  hardFail(`${TEARDOWN_TXT} does not exist -- no teardown was recorded.`);
} else {
  teardownTxt = fs.readFileSync(TEARDOWN_TXT, "utf8");
  if (teardownTxt.trim().length === 0) {
    hardFail(`${TEARDOWN_TXT} is empty.`);
  } else {
    // Explicit "RESULT: PASS" verdict line (mirrors PT-12-001's verifier
    // convention). teardown.txt writes this line twice in different
    // sections (delete-command header and final verdict) -- both are
    // acceptable, we just need at least one.
    if (!/^RESULT:\s*PASS\s*$/m.test(teardownTxt)) {
      hardFail(`${TEARDOWN_TXT} does not contain an explicit "RESULT: PASS" verdict line.`);
    }

    if (!/CONFIRMED GONE/.test(teardownTxt)) {
      hardFail(`${TEARDOWN_TXT} does not explicitly state the branch is CONFIRMED GONE.`);
    }

    const countMatch = teardownTxt.match(
      /branches matching name '?"?pt12-load-test'?"? in post-delete list:\s*(\d+)/,
    );
    if (!countMatch) {
      fail(
        `${TEARDOWN_TXT} does not record an explicit post-delete match-count for the branch name ` +
          `-- cannot independently confirm zero from the recorded evidence alone.`,
      );
    } else if (Number(countMatch[1]) !== 0) {
      hardFail(
        `${TEARDOWN_TXT} records ${countMatch[1]} post-delete match(es) for "${BRANCH_NAME}" -- ` +
          `the branch was NOT confirmed gone. HARD FAIL.`,
      );
    }

    if (!/delete_command_exit_code:\s*0/.test(teardownTxt)) {
      fail(`${TEARDOWN_TXT} does not record a delete_command_exit_code of 0.`);
    }
  }
}

// --- 2. Live re-check: the branch must be gone RIGHT NOW, not just once ----

try {
  const listRaw = execSync(
    `supabase branches list --project-ref ${PRODUCTION_REF} --output-format json`,
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 16 },
  );
  const listData = JSON.parse(listRaw);
  const liveBranch = (listData.branches || []).find((b) => b.name === BRANCH_NAME);

  if (liveBranch) {
    hardFail(
      `Live re-check: a branch named "${BRANCH_NAME}" (id: ${liveBranch.id}, project_ref: ` +
        `${liveBranch.project_ref}) CURRENTLY EXISTS under project ${PRODUCTION_REF}. It is ` +
        `either still billing or was recreated since teardown.txt was recorded. HARD FAIL -- ` +
        `this must not be left silently billing.`,
    );
  } else {
    console.log(`OK: live re-check confirms no branch named "${BRANCH_NAME}" currently exists.`);
  }
} catch (err) {
  hardFail(
    `Live re-check via \`supabase branches list\` failed: ${err.message} -- cannot independently ` +
      `confirm the branch is gone right now. Treating as a failure rather than assuming success.`,
  );
}

// --- 3. PHASE-12-SUMMARY.md -------------------------------------------------

if (!fs.existsSync(SUMMARY_MD)) {
  hardFail(`${SUMMARY_MD} does not exist.`);
} else {
  const summary = fs.readFileSync(SUMMARY_MD, "utf8");
  const words = wordCount(summary);
  if (words < MIN_SUMMARY_WORDS) {
    fail(`${SUMMARY_MD} has only ${words} words -- below the ${MIN_SUMMARY_WORDS}-word floor for real evidence.`);
  }
  const requiredTopics = [
    { label: "breaking point", re: /breaking point/i },
    { label: "latency percentiles", re: /p95|p99/i },
    { label: "soak / memory verdict", re: /leak|soak|memory/i },
    { label: "pool / rate-limit behavior", re: /pool|rate.?limit/i },
  ];
  for (const topic of requiredTopics) {
    if (!topic.re.test(summary)) {
      fail(`${SUMMARY_MD} does not appear to cover "${topic.label}".`);
    }
  }
  // Every number should cite its evidence file per task instruction -- spot-check
  // that the summary actually references real evidence paths, not just prose claims.
  if (!/test-evidence\/pt-12\//.test(summary)) {
    fail(`${SUMMARY_MD} does not cite any test-evidence/pt-12/ evidence file paths.`);
  }
}

// --- 4. REVIEW-PACK.md ------------------------------------------------------

if (!fs.existsSync(REVIEW_PACK_MD)) {
  hardFail(`${REVIEW_PACK_MD} does not exist.`);
} else {
  const reviewPack = fs.readFileSync(REVIEW_PACK_MD, "utf8");
  const words = wordCount(reviewPack);
  if (words < MIN_REVIEW_PACK_WORDS) {
    fail(`${REVIEW_PACK_MD} has only ${words} words -- below the ${MIN_REVIEW_PACK_WORDS}-word floor for real evidence.`);
  }
  const requiredTopics = [
    { label: "concurrent load handling", re: /concurrent load/i },
    { label: "breaking point", re: /breaking point/i },
    { label: "leak verdict", re: /leak/i },
    { label: "highest-severity finding", re: /highest.?severity/i },
    { label: "PT-15 handoff", re: /PT-15/i },
  ];
  for (const topic of requiredTopics) {
    if (!topic.re.test(reviewPack)) {
      fail(`${REVIEW_PACK_MD} does not appear to cover "${topic.label}".`);
    }
  }
}

// --- 5. WIRING_GAP_REGISTER.md grew ------------------------------------------

if (!fs.existsSync(REGISTER_MD)) {
  hardFail(`${REGISTER_MD} does not exist.`);
} else {
  const register = fs.readFileSync(REGISTER_MD, "utf8");
  const rowMatches = [...register.matchAll(/^\|\s*WGR-(\d+)\s*\|/gm)];
  const ids = rowMatches.map((m) => Number(m[1]));
  const rowCount = ids.length;
  const maxId = ids.length > 0 ? Math.max(...ids) : 0;

  if (rowCount <= REGISTER_BASELINE_COUNT) {
    hardFail(
      `${REGISTER_MD} has ${rowCount} WGR rows -- not strictly greater than the pre-PT-12-005 ` +
        `baseline of ${REGISTER_BASELINE_COUNT}. Register did not grow.`,
    );
  } else {
    console.log(`OK: register grew from ${REGISTER_BASELINE_COUNT} to ${rowCount} WGR rows (max id: WGR-${maxId}).`);
  }

  // Findings from this specific phase should actually be present and reference
  // PT-12 evidence, not just any 4 unrelated new rows.
  const pt12Rows = [...register.matchAll(/^\|\s*WGR-\d+\s*\|[^\n]*\|[^\n]*\|[^\n]*test-evidence\/pt-12\/[^\n]*$/gm)];
  if (pt12Rows.length === 0) {
    fail(`${REGISTER_MD} has new rows but none appear to reference test-evidence/pt-12/ evidence.`);
  }
}

// --- Verdict -----------------------------------------------------------------

if (errors > 0) {
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

console.log(`\nPASS: ${TEARDOWN_TXT} confirms the "${BRANCH_NAME}" branch is deleted, both on record and live.`);
console.log(`PASS: ${SUMMARY_MD} and ${REVIEW_PACK_MD} both exist and are non-trivially non-empty.`);
console.log(`PASS: ${REGISTER_MD} grew past the pre-PT-12-005 baseline of ${REGISTER_BASELINE_COUNT} rows.`);
process.exit(0);
