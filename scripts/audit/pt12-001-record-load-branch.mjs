// ============================================================================
// PT-12-001 — record the state of the dedicated load-test Supabase branch.
//
// This does NOT create the branch (that is a one-time, already-performed
// action: `supabase branches create pt12-load-test --project-ref
// vbjplpquqxxfbpazyalt --with-data --yes`, run interactively this session).
// This script re-derives the branch's identity and current state
// independently -- by name, not by trusting a hardcoded ID -- and writes
// the evidence the verifier checks:
//
//   1. Resolves the branch by name ("pt12-load-test") via
//      `supabase branches list`, not a hardcoded ID -- so a re-run after
//      the branch is recreated still finds the right one.
//   2. HARD FAILS (refuses to write branch.txt, exits non-zero) unless the
//      resolved branch's project_ref is different from the production ref
//      (vbjplpquqxxfbpazyalt) AND its parent_project_ref IS the production
//      ref (proving it is genuinely a branch of prod, not an unrelated
//      project).
//   3. Fetches full connection detail via `supabase branches get` (Supabase
//      keys + Postgres URLs -- the CLI masks the raw DB password in all
//      output formats, so POSTGRES_URL/POSTGRES_URL_NON_POOLING are
//      recorded with the password redacted; the anon/service-role JWTs and
//      SUPABASE_URL are recorded in full since those are the real,
//      functional connection credentials this script and any load-test
//      tooling actually use).
//   4. Queries the branch's own PostgREST endpoint (SUPABASE_URL +
//      SUPABASE_SERVICE_ROLE_KEY, i.e. the branch's own credentials, never
//      the production ones) via `Prefer: count=exact` for a fixed set of
//      representative tables, to (a) prove the branch's data volume is
//      real and populated, not empty, and (b) record it for the load test
//      to plan against.
//   5. Writes test-evidence/pt-12/branch.txt (human-readable, the primary
//      artifact the verifier reads) and
//      test-evidence/pt-12/branch-seed-counts.json (machine-readable row
//      counts).
//
// Usage: node scripts/audit/pt12-001-record-load-branch.mjs
// ============================================================================

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const OUT_DIR = path.join(REPO_ROOT, "test-evidence", "pt-12");
const BRANCH_TXT = path.join(OUT_DIR, "branch.txt");
const COUNTS_JSON = path.join(OUT_DIR, "branch-seed-counts.json");

const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";
const BRANCH_NAME = "pt12-load-test";

// Representative tables to size the branch's cloned data volume by. Chosen
// to span the platform's largest tables (nonprofits, foundation_directory),
// a mid-size operational table (agent_runs), and core tenant tables
// (organizations, opportunities, applications) -- not an exhaustive list of
// all ~160 tables, which would make this script slow and isn't needed to
// prove "realistic load volume."
const SAMPLE_TABLES = [
  "organizations",
  "opportunities",
  "applications",
  "nonprofits",
  "foundation_directory",
  "agent_runs",
  "submission_queue",
];

function run(cmd) {
  return execSync(cmd, { encoding: "utf8", maxBuffer: 1024 * 1024 * 16 });
}

function fail(message) {
  console.error(`HARD FAIL: ${message}`);
  process.exit(1);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // --- 1. Resolve the branch by name, not by a hardcoded ID ------------------
  let listRaw;
  try {
    listRaw = run(
      `supabase branches list --project-ref ${PRODUCTION_REF} --output-format json`,
    );
  } catch (err) {
    fail(`\`supabase branches list\` failed: ${err.message}`);
  }

  let listData;
  try {
    listData = JSON.parse(listRaw);
  } catch (err) {
    fail(`\`supabase branches list\` did not return valid JSON: ${err.message}\nRaw: ${listRaw}`);
  }

  const branch = (listData.branches || []).find((b) => b.name === BRANCH_NAME);
  if (!branch) {
    fail(
      `No branch named "${BRANCH_NAME}" found under project ${PRODUCTION_REF}. ` +
        `Create it first: supabase branches create ${BRANCH_NAME} --project-ref ${PRODUCTION_REF} --with-data --yes`,
    );
  }

  // --- 2. HARD FAIL unless this is genuinely a non-prod branch OF prod -------
  if (branch.project_ref === PRODUCTION_REF) {
    fail(
      `Resolved branch's project_ref IS the production ref (${PRODUCTION_REF}). ` +
        `Refusing to treat this as a load-test target.`,
    );
  }
  if (branch.parent_project_ref !== PRODUCTION_REF) {
    fail(
      `Resolved branch's parent_project_ref is "${branch.parent_project_ref}", not the ` +
        `production ref (${PRODUCTION_REF}). This does not look like a genuine branch of prod.`,
    );
  }
  if (branch.preview_project_status !== "ACTIVE_HEALTHY") {
    fail(
      `Branch preview_project_status is "${branch.preview_project_status}", not ACTIVE_HEALTHY. ` +
        `Wait for provisioning to finish before recording evidence.`,
    );
  }

  // --- 3. Fetch full connection detail ---------------------------------------
  let getRaw;
  try {
    getRaw = run(
      `supabase branches get ${branch.id} --project-ref ${PRODUCTION_REF} --output-format json`,
    );
  } catch (err) {
    fail(`\`supabase branches get ${branch.id}\` failed: ${err.message}`);
  }

  let conn;
  try {
    conn = JSON.parse(getRaw);
  } catch (err) {
    fail(`\`supabase branches get\` did not return valid JSON: ${err.message}\nRaw: ${getRaw}`);
  }

  if (!conn.SUPABASE_URL || !conn.SUPABASE_URL.includes(branch.project_ref)) {
    fail(
      `SUPABASE_URL from \`branches get\` ("${conn.SUPABASE_URL}") does not contain the ` +
        `branch's own project_ref ("${branch.project_ref}") -- cannot confirm target identity.`,
    );
  }
  if (conn.SUPABASE_URL.includes(PRODUCTION_REF)) {
    fail(`SUPABASE_URL from \`branches get\` contains the production ref. Refusing to proceed.`);
  }

  // --- 4. Query row counts via the branch's OWN PostgREST + service key ------
  const counts = {};
  const errors = {};
  for (const table of SAMPLE_TABLES) {
    try {
      const res = await fetch(
        `${conn.SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`,
        {
          method: "HEAD",
          headers: {
            apikey: conn.SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${conn.SUPABASE_SERVICE_ROLE_KEY}`,
            Prefer: "count=exact",
          },
        },
      );
      const contentRange = res.headers.get("content-range"); // e.g. "0-0/1978526"
      if (!res.ok && res.status !== 206) {
        errors[table] = `HTTP ${res.status}`;
        continue;
      }
      const total = contentRange ? contentRange.split("/")[1] : null;
      counts[table] = total === null || total === "*" ? null : Number(total);
    } catch (err) {
      errors[table] = err.message;
    }
  }

  const totalCounted = Object.values(counts)
    .filter((v) => typeof v === "number")
    .reduce((a, b) => a + b, 0);

  if (totalCounted === 0) {
    fail(
      `All sampled tables on the branch returned zero or unreadable rows. ` +
        `Branch data volume is not realistic for a load test. Errors: ${JSON.stringify(errors)}`,
    );
  }

  // --- 5. Write evidence -------------------------------------------------------
  const nowIso = new Date().toISOString();

  const redactedPooled = (conn.POSTGRES_URL || "").replace(/:[^:@]*@/, ":***@");
  const redactedDirect = (conn.POSTGRES_URL_NON_POOLING || "").replace(/:[^:@]*@/, ":***@");

  const lines = [
    `PT-12-001 — Dedicated Load-Test Branch — Recorded ${nowIso}`,
    ``,
    `=== IDENTITY ===`,
    `branch_id:            ${branch.id}`,
    `branch_name:          ${branch.name}`,
    `branch_project_ref:   ${branch.project_ref}`,
    `parent_project_ref:   ${branch.parent_project_ref}`,
    `is_default:           ${branch.is_default}`,
    `with_data:            ${branch.with_data}`,
    `status:               ${branch.status}`,
    `preview_project_status: ${branch.preview_project_status}`,
    `created_at:           ${branch.created_at}`,
    `updated_at:           ${branch.updated_at}`,
    ``,
    `=== ASSERTION: TARGET IS NOT PRODUCTION ===`,
    `production_ref:       ${PRODUCTION_REF}`,
    `branch_project_ref === production_ref?  ${branch.project_ref === PRODUCTION_REF ? "TRUE -- WOULD BE A FATAL ERROR" : "false (correct -- distinct host)"}`,
    `parent_project_ref === production_ref?  ${branch.parent_project_ref === PRODUCTION_REF ? "true (correct -- genuinely a branch of prod)" : "FALSE -- WOULD BE A FATAL ERROR"}`,
    `RESULT: branch host is CONFIRMED DISTINCT from the production ref. Load tests against ` +
      `this branch cannot touch production data.`,
    ``,
    `=== CONNECTION DETAILS (branch's own, never production's) ===`,
    `SUPABASE_URL:              ${conn.SUPABASE_URL}`,
    `SUPABASE_ANON_KEY:         ${conn.SUPABASE_ANON_KEY}`,
    `SUPABASE_SERVICE_ROLE_KEY: ${conn.SUPABASE_SERVICE_ROLE_KEY}`,
    `POSTGRES_URL (pooled, password redacted):        ${redactedPooled}`,
    `POSTGRES_URL_NON_POOLING (direct, password redacted): ${redactedDirect}`,
    `note: the Supabase CLI masks the raw database password in all output formats ` +
      `(text/json/env) for this command; the pooled/direct Postgres URLs above are ` +
      `structurally real (correct host, port, user) but the password segment is ` +
      `redacted by the CLI itself, not by this script. The Supabase URL + ` +
      `service-role key above are the real, unredacted, functional credentials used ` +
      `to query this branch (see SEEDED VOLUME below, fetched live via this exact ` +
      `SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY pair).`,
    ``,
    `=== SEEDED VOLUME (confirmed via live PostgREST query against the branch, ` +
      `${nowIso}) ===`,
    `with_data flag (branch cloned from production at creation time): ${branch.with_data}`,
    ...SAMPLE_TABLES.map((t) => {
      if (t in errors) return `  ${t}: ERROR (${errors[t]})`;
      return `  ${t}: ${counts[t]} rows`;
    }),
    `  TOTAL (sampled tables, excluding errored ones): ${totalCounted} rows`,
    ``,
    `RESULT: PASS`,
  ];

  fs.writeFileSync(BRANCH_TXT, lines.join("\n") + "\n", "utf8");
  fs.writeFileSync(
    COUNTS_JSON,
    JSON.stringify(
      {
        recordedAt: nowIso,
        branch: {
          id: branch.id,
          name: branch.name,
          project_ref: branch.project_ref,
          parent_project_ref: branch.parent_project_ref,
          with_data: branch.with_data,
          status: branch.status,
          preview_project_status: branch.preview_project_status,
        },
        productionRef: PRODUCTION_REF,
        isProductionTarget: branch.project_ref === PRODUCTION_REF,
        counts,
        errors,
        totalCounted,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`PASS: wrote ${BRANCH_TXT}`);
  console.log(`PASS: wrote ${COUNTS_JSON}`);
  console.log(`Branch project_ref: ${branch.project_ref} (production ref: ${PRODUCTION_REF})`);
  console.log(`Sampled row total: ${totalCounted}`);
}

main().catch((err) => {
  console.error(`FATAL: ${err.stack || err.message}`);
  process.exit(1);
});
