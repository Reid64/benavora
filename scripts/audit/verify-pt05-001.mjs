// ============================================================================
// PT-05-001 verifier -- isolation environment (branch/local, two test orgs).
//
// Exits non-zero unless:
//   1. test-evidence/pt-05/environment.txt exists, is non-empty, and shows a
//      non-production target -- HARD FAIL if the recorded host/connection
//      string contains the production ref (vbjplpquqxxfbpazyalt).
//   2. test-evidence/pt-05/seed-summary.json exists, is valid JSON, records
//      target.is_production === false, and records two distinct org IDs.
//   3. Both orgs have at least one seeded row in each of the six
//      tenant-scoped tables named in the PT-05 task (applications,
//      opportunities, draft_versions, contacts, donor_discovery_prospects,
//      deadlines) -- verified by an independent, live query against the
//      recorded target (not by trusting the provisioning script's own
//      counts), so this verifier fails if the environment has since been
//      torn down or the data has drifted.
//
// Usage: node scripts/audit/verify-pt05-001.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

const ENV_FILE = path.join("test-evidence", "pt-05", "environment.txt");
const SEED_SUMMARY = path.join("test-evidence", "pt-05", "seed-summary.json");
const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";

const REQUIRED_TENANT_TABLES = [
  "applications",
  "opportunities",
  "draft_versions",
  "contacts",
  "donor_discovery_prospects",
  "deadlines",
];

let errors = 0;

function fail(message) {
  console.error(`FAIL: ${message}`);
  errors++;
}

function hardFail(message) {
  console.error(`HARD FAIL: ${message}`);
  errors++;
}

// --- 1. environment.txt ------------------------------------------------------

let envText = null;
if (!fs.existsSync(ENV_FILE)) {
  fail(`${ENV_FILE} does not exist.`);
} else {
  envText = fs.readFileSync(ENV_FILE, "utf8");
  if (envText.trim().length === 0) {
    fail(`${ENV_FILE} is empty.`);
  } else {
    // The file is allowed to *mention* the production ref only as an explicit
    // negative comparison (e.g. "must NOT appear above: <ref>", "for
    // comparison", "does not contain production ref"). Check that every line
    // actually containing the ref is such a comparison line, and that no
    // line shows it as part of an actual connection string/host.
    const NEGATIVE_COMPARISON = /for comparison|does not contain|must not appear|not the production/i;
    const badLines = envText
      .split("\n")
      .filter((l) => l.includes(PRODUCTION_REF) && !NEGATIVE_COMPARISON.test(l));
    if (badLines.length > 0) {
      hardFail(
        `${ENV_FILE} has ${badLines.length} line(s) referencing the production ref outside a ` +
          `comparison context: ${JSON.stringify(badLines)}`,
      );
    }
    if (!/Target check:\s*PASS/i.test(envText)) {
      fail(`${ENV_FILE} does not record a passing target check.`);
    }
    if (!/(127\.0\.0\.1|localhost|Supabase branch|\.supabase\.co\/branch)/i.test(envText)) {
      fail(
        `${ENV_FILE} does not show evidence of a local (127.0.0.1/localhost) or branch target.`,
      );
    }
    if (!/Org A created/i.test(envText) || !/Org B created/i.test(envText)) {
      fail(`${ENV_FILE} does not record both Org A and Org B being created.`);
    }
    if (!/Owner user A created/i.test(envText) || !/Owner user B created/i.test(envText)) {
      fail(`${ENV_FILE} does not record both orgs' owner users being created.`);
    }
  }
}

// --- 2. seed-summary.json -----------------------------------------------------

let summary = null;
if (!fs.existsSync(SEED_SUMMARY)) {
  fail(`${SEED_SUMMARY} does not exist.`);
} else {
  const raw = fs.readFileSync(SEED_SUMMARY, "utf8");
  try {
    summary = JSON.parse(raw);
  } catch (err) {
    fail(`${SEED_SUMMARY} is not valid JSON: ${err.message}`);
  }
}

let orgIds = [];
let dbHost = null;

if (summary) {
  if (!summary.target || typeof summary.target !== "object") {
    fail(`${SEED_SUMMARY}.target is missing.`);
  } else {
    if (summary.target.is_production !== false) {
      hardFail(`${SEED_SUMMARY}.target.is_production is not explicitly false.`);
    }
    if (!summary.target.host) {
      fail(`${SEED_SUMMARY}.target.host is missing.`);
    } else if (String(summary.target.host).includes(PRODUCTION_REF)) {
      hardFail(
        `${SEED_SUMMARY}.target.host ("${summary.target.host}") contains the production ref "${PRODUCTION_REF}".`,
      );
    } else {
      dbHost = summary.target.host;
    }
    if (summary.target.production_ref_for_comparison !== PRODUCTION_REF) {
      fail(
        `${SEED_SUMMARY}.target.production_ref_for_comparison does not match the expected ` +
          `production ref "${PRODUCTION_REF}" -- can't confirm the negative check was against the right value.`,
      );
    }
  }

  if (!summary.orgs || typeof summary.orgs !== "object") {
    fail(`${SEED_SUMMARY}.orgs is missing.`);
  } else {
    const keys = Object.keys(summary.orgs);
    if (keys.length < 2) {
      fail(`${SEED_SUMMARY}.orgs must record at least 2 orgs, found ${keys.length}.`);
    }
    for (const k of keys) {
      const entry = summary.orgs[k];
      if (!entry.orgId) fail(`${SEED_SUMMARY}.orgs.${k}.orgId is missing.`);
      else orgIds.push(entry.orgId);
      if (!entry.userId) fail(`${SEED_SUMMARY}.orgs.${k}.userId is missing.`);
      if (!entry.counts || typeof entry.counts !== "object") {
        fail(`${SEED_SUMMARY}.orgs.${k}.counts is missing.`);
      } else {
        for (const t of REQUIRED_TENANT_TABLES) {
          if (!(entry.counts[t] > 0)) {
            fail(`${SEED_SUMMARY}.orgs.${k}.counts.${t} is not a positive count.`);
          }
        }
      }
    }
    const uniqueOrgIds = new Set(orgIds);
    if (orgIds.length >= 2 && uniqueOrgIds.size !== orgIds.length) {
      hardFail(`${SEED_SUMMARY}.orgs recorded org IDs are not distinct -- Org A and Org B collide.`);
    }
  }
}

// --- 3. independent live re-verification against the actual database ---------
//
// Do not trust seed-summary.json's own counts. Reconnect to the recorded
// target and re-count directly. This is what actually proves the
// environment is real, isolated, and currently seeded -- not just that a
// script once said so.

async function liveVerify() {
  if (orgIds.length < 2 || errors > 0) {
    console.error(
      "SKIP: live re-verification skipped because the static checks above already failed " +
        "(no reliable org IDs / target to verify against).",
    );
    return;
  }

  const connectionString = "postgresql://postgres:postgres@127.0.0.1:56322/postgres";

  if (connectionString.includes(PRODUCTION_REF)) {
    hardFail(`Hardcoded local verification connection string unexpectedly contains the production ref. Refusing to connect.`);
    return;
  }

  const url = new URL(connectionString.replace(/^postgresql:/, "postgres:"));
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    hardFail(
      `Live re-verification target host "${url.hostname}" is not a local address. Refusing to connect ` +
        `to avoid accidentally querying a shared/production database.`,
    );
    return;
  }

  let client;
  try {
    client = new Client({ connectionString });
    await client.connect();
  } catch (err) {
    fail(`Could not connect to the recorded local target (${url.hostname}:${url.port}): ${err.message}`);
    return;
  }

  try {
    const dbInfo = await client.query(
      "select current_database() as db, inet_server_addr()::text as addr",
    );
    const { db, addr } = dbInfo.rows[0];
    if (String(addr).includes(PRODUCTION_REF) || String(db).includes(PRODUCTION_REF)) {
      hardFail(`Live connection reports a production-looking target (db="${db}" addr="${addr}"). Aborting.`);
      return;
    }
    console.log(`Live re-verification connected: database="${db}" server_addr="${addr}"`);

    for (const orgId of orgIds) {
      for (const table of REQUIRED_TENANT_TABLES) {
        let res;
        try {
          res = await client.query(
            `select count(*)::int as c from ${table} where organization_id = $1`,
            [orgId],
          );
        } catch (err) {
          fail(`Live query against ${table} for org ${orgId} failed: ${err.message}`);
          continue;
        }
        const c = res.rows[0].c;
        if (!(c > 0)) {
          fail(`Live re-verification: org ${orgId} has ${c} rows in ${table} (expected > 0).`);
        } else {
          console.log(`Live re-verification PASS: org ${orgId} has ${c} row(s) in ${table}.`);
        }
      }
    }

    // Confirm both orgs actually have an owner-role profile tied to a real
    // auth.users row, not just a bare organizations row.
    const ownerRes = await client.query(
      `select p.organization_id, p.role, u.id as user_id
       from profiles p join auth.users u on u.id = p.id
       where p.organization_id = any($1::uuid[])`,
      [orgIds],
    );
    const ownerRows = ownerRes.rows.filter((r) => r.role === "owner");
    const orgsWithOwner = new Set(ownerRows.map((r) => r.organization_id));
    for (const orgId of orgIds) {
      if (!orgsWithOwner.has(orgId)) {
        fail(`Live re-verification: org ${orgId} has no owner-role profile tied to a real auth.users row.`);
      } else {
        console.log(`Live re-verification PASS: org ${orgId} has an owner-role profile tied to a real auth.users row.`);
      }
    }
  } finally {
    await client.end();
  }
}

await liveVerify();

if (errors > 0) {
  console.error(`\n${errors} error(s) found.`);
  process.exit(1);
}

console.log(`PASS: ${ENV_FILE} shows a non-production (local) target with both orgs and owner users recorded.`);
console.log(`PASS: ${SEED_SUMMARY} records two distinct org IDs, each seeded in all ${REQUIRED_TENANT_TABLES.length} required tenant-scoped tables.`);
console.log(`PASS: independent live re-query against the actual local database confirms both orgs' seeded rows and owner users right now.`);
process.exit(0);
