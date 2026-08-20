// ============================================================================
// PT-12-001 verifier — dedicated load-test branch, confirmed non-production.
//
// Exits non-zero unless:
//   1. test-evidence/pt-12/branch.txt exists, is non-empty, and records a
//      real branch ID (a UUID) whose project_ref is DISTINCT from the
//      production ref (vbjplpquqxxfbpazyalt) -- HARD FAIL if the recorded
//      target is production.
//   2. branch.txt also records that the branch's parent_project_ref IS the
//      production ref (proving it is genuinely a branch of prod, not an
//      unrelated project standing in for one).
//   3. branch.txt records a seeded/cloned data volume greater than zero
//      rows across the sampled tables.
//   4. test-evidence/pt-12/branch-seed-counts.json exists, is valid JSON,
//      and independently confirms the same non-production assertion plus a
//      non-zero totalCounted -- so the verifier does not rely on branch.txt
//      prose alone, it cross-checks against the machine-readable record.
//   5. A live re-check: re-derives the branch by name via
//      `supabase branches list` and confirms the CURRENTLY live branch
//      still has project_ref !== production ref (catches a stale/deleted
//      evidence file describing a branch that no longer exists, or one
//      that has since been merged/pointed at prod).
//
// Usage: node scripts/audit/verify-pt12-001.mjs
// ============================================================================

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join("test-evidence", "pt-12");
const BRANCH_TXT = path.join(OUT_DIR, "branch.txt");
const COUNTS_JSON = path.join(OUT_DIR, "branch-seed-counts.json");

const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";
const BRANCH_NAME = "pt12-load-test";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let errors = 0;

function fail(message) {
  console.error(`FAIL: ${message}`);
  errors++;
}

function hardFail(message) {
  console.error(`HARD FAIL: ${message}`);
  errors++;
}

// --- 1/2/3. branch.txt -------------------------------------------------------

let branchTxt = "";
if (!fs.existsSync(BRANCH_TXT)) {
  hardFail(`${BRANCH_TXT} does not exist -- no branch was recorded.`);
} else {
  branchTxt = fs.readFileSync(BRANCH_TXT, "utf8");
  if (branchTxt.trim().length === 0) {
    hardFail(`${BRANCH_TXT} is empty.`);
  } else {
    const idMatch = branchTxt.match(/branch_id:\s*(\S+)/);
    const projectRefMatch = branchTxt.match(/branch_project_ref:\s*(\S+)/);
    const parentRefMatch = branchTxt.match(/parent_project_ref:\s*(\S+)/);
    const totalMatch = branchTxt.match(/TOTAL \(sampled tables, excluding errored ones\):\s*(\d+)\s*rows/);
    // Matches only a standalone "RESULT: <word>" line (e.g. the trailing verdict line),
    // not the "RESULT: branch host is CONFIRMED DISTINCT..." prose line earlier in the
    // file -- both start with "RESULT:" so a bare /RESULT:\s*(\S+)/ would wrongly match
    // the first occurrence.
    const resultMatch = branchTxt.match(/^RESULT:\s*(\S+)\s*$/m);

    if (!idMatch) {
      fail(`${BRANCH_TXT} does not record a "branch_id:" line.`);
    } else if (!UUID_RE.test(idMatch[1])) {
      fail(`${BRANCH_TXT}'s recorded branch_id ("${idMatch[1]}") is not a real UUID.`);
    }

    if (!projectRefMatch) {
      hardFail(`${BRANCH_TXT} does not record a "branch_project_ref:" line -- cannot confirm target host.`);
    } else {
      const branchRef = projectRefMatch[1];
      if (!branchRef || branchRef.length < 10) {
        fail(`${BRANCH_TXT}'s recorded branch_project_ref ("${branchRef}") does not look like a real project ref.`);
      }
      if (branchRef === PRODUCTION_REF) {
        hardFail(
          `${BRANCH_TXT} records branch_project_ref === production ref (${PRODUCTION_REF}). ` +
            `This means the load target IS production. HARD FAIL.`,
        );
      }
    }

    if (!parentRefMatch) {
      fail(`${BRANCH_TXT} does not record a "parent_project_ref:" line.`);
    } else if (parentRefMatch[1] !== PRODUCTION_REF) {
      fail(
        `${BRANCH_TXT}'s recorded parent_project_ref ("${parentRefMatch[1]}") is not the production ` +
          `ref (${PRODUCTION_REF}) -- this does not look like a genuine branch of prod.`,
      );
    }

    if (!totalMatch) {
      fail(`${BRANCH_TXT} does not record a sampled-table row total.`);
    } else if (Number(totalMatch[1]) <= 0) {
      fail(
        `${BRANCH_TXT} records a sampled-table row total of ${totalMatch[1]} -- branch has no ` +
          `realistic data volume for a load test.`,
      );
    }

    if (!resultMatch || resultMatch[1] !== "PASS") {
      fail(`${BRANCH_TXT} does not record an overall RESULT: PASS line.`);
    }

    if (!/RESULT: branch host is CONFIRMED DISTINCT from the production ref/.test(branchTxt)) {
      fail(`${BRANCH_TXT} does not contain the explicit non-production-host confirmation statement.`);
    }
  }
}

// --- 4. branch-seed-counts.json ----------------------------------------------

let countsData = null;
if (!fs.existsSync(COUNTS_JSON)) {
  hardFail(`${COUNTS_JSON} does not exist.`);
} else {
  const raw = fs.readFileSync(COUNTS_JSON, "utf8");
  if (raw.trim().length === 0) {
    hardFail(`${COUNTS_JSON} is empty.`);
  } else {
    try {
      countsData = JSON.parse(raw);
    } catch (err) {
      hardFail(`${COUNTS_JSON} is not valid JSON: ${err.message}`);
    }
  }
}

if (countsData) {
  if (!countsData.branch || typeof countsData.branch !== "object") {
    fail(`${COUNTS_JSON}.branch object is missing.`);
  } else {
    if (countsData.branch.project_ref === PRODUCTION_REF) {
      hardFail(
        `${COUNTS_JSON} records branch.project_ref === production ref. HARD FAIL -- ` +
          `load target is production.`,
      );
    }
    if (countsData.branch.parent_project_ref !== PRODUCTION_REF) {
      fail(
        `${COUNTS_JSON} records branch.parent_project_ref ("${countsData.branch.parent_project_ref}") ` +
          `!== production ref -- not a genuine branch of prod.`,
      );
    }
    if (countsData.branch.with_data !== true) {
      fail(
        `${COUNTS_JSON} records branch.with_data !== true -- branch was not created with a ` +
          `production data clone (a separate seeding step would be required and is not recorded here).`,
      );
    }
  }

  if (countsData.isProductionTarget !== false) {
    hardFail(`${COUNTS_JSON}.isProductionTarget is not explicitly false. HARD FAIL.`);
  }

  if (typeof countsData.totalCounted !== "number" || countsData.totalCounted <= 0) {
    fail(`${COUNTS_JSON}.totalCounted must be a positive number (got: ${countsData.totalCounted}).`);
  }

  if (!countsData.counts || typeof countsData.counts !== "object" || Object.keys(countsData.counts).length === 0) {
    fail(`${COUNTS_JSON}.counts must be a non-empty object of per-table row counts.`);
  }
}

// Cross-check branch.txt and branch-seed-counts.json agree on identity.
if (countsData && branchTxt) {
  const idMatch = branchTxt.match(/branch_id:\s*(\S+)/);
  if (idMatch && countsData.branch && idMatch[1] !== countsData.branch.id) {
    fail(
      `branch.txt's branch_id ("${idMatch[1]}") does not match branch-seed-counts.json's ` +
        `branch.id ("${countsData.branch.id}") -- evidence files describe different branches.`,
    );
  }
}

// --- 5. Live re-check: the branch still exists and is still non-production ---

try {
  const listRaw = execSync(
    `supabase branches list --project-ref ${PRODUCTION_REF} --output-format json`,
    { encoding: "utf8", maxBuffer: 1024 * 1024 * 16 },
  );
  const listData = JSON.parse(listRaw);
  const liveBranch = (listData.branches || []).find((b) => b.name === BRANCH_NAME);

  if (!liveBranch) {
    fail(
      `Live re-check: no branch named "${BRANCH_NAME}" currently exists under project ` +
        `${PRODUCTION_REF} -- the branch described in evidence may have been deleted.`,
    );
  } else {
    if (liveBranch.project_ref === PRODUCTION_REF) {
      hardFail(`Live re-check: the current "${BRANCH_NAME}" branch's project_ref IS production. HARD FAIL.`);
    }
    if (liveBranch.parent_project_ref !== PRODUCTION_REF) {
      fail(`Live re-check: the current "${BRANCH_NAME}" branch's parent_project_ref is not production.`);
    }
    if (countsData && countsData.branch && liveBranch.id !== countsData.branch.id) {
      console.warn(
        `WARN: live branch id ("${liveBranch.id}") differs from the recorded evidence's branch id ` +
          `("${countsData.branch.id}") -- the branch was likely recreated since evidence was recorded. ` +
          `Not treated as a failure (the live branch is still confirmed non-production), but evidence ` +
          `should be re-recorded via pt12-001-record-load-branch.mjs.`,
      );
    }
  }
} catch (err) {
  fail(`Live re-check via \`supabase branches list\` failed: ${err.message}`);
}

// --- Verdict -------------------------------------------------------------------

if (errors > 0) {
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

console.log(`PASS: ${BRANCH_TXT} records a real, non-production load-test branch with a positive row volume.`);
console.log(`PASS: ${COUNTS_JSON} independently confirms isProductionTarget=false and a positive totalCounted.`);
console.log(`PASS: live re-check confirms the "${BRANCH_NAME}" branch currently exists and is non-production.`);
process.exit(0);
