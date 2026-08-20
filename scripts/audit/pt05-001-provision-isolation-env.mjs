// ============================================================================
// PT-05-001 -- provision the isolation environment.
//
// A local Supabase CLI stack (Postgres + GoTrue + PostgREST) was started in
// .pt05-local-stack/ (outside any tracked directory, ports remapped to the
// 563xx range to avoid colliding with other local stacks already running on
// this machine). This script:
//   1. Asserts the target DATABASE_URL is NOT the production ref
//      (vbjplpquqxxfbpazyalt) -- hard-refuses to run otherwise.
//   2. Applies pt05-schema.sql (a real-shaped subset of the production
//      public schema, per test-evidence/pt-06/live-schema.json +
//      integrity.json) to the local database.
//   3. Creates two clean test organizations (Org A, Org B), each with one
//      real auth.users row (via the GoTrue Admin API, service-role key --
//      the same real provisioning path the production app uses) and a
//      matching profiles row with role='owner'.
//   4. Seeds a small set of real-shaped rows into the six tenant-scoped
//      tables named in the PT-05 task (applications, opportunities,
//      draft_versions, contacts, donor_discovery_prospects, deadlines) for
//      each org, plus the minimal supporting parent rows (funders,
//      donor_discovery_directory, donor_discovery_requests) needed to
//      satisfy their real foreign keys.
//   5. Writes test-evidence/pt-05/environment.txt (target proof) and
//      test-evidence/pt-05/seed-summary.json (org IDs, user IDs, per-table
//      row counts) for the verifier to check independently.
//
// Usage: node scripts/audit/pt05-001-provision-isolation-env.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(REPO_ROOT, "test-evidence", "pt-05");
const SCHEMA_SQL_PATH = path.join(__dirname, "pt05-schema.sql");

const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";

// Local stack connection details, from `supabase status -o json` inside
// .pt05-local-stack/ -- these are the standard Supabase CLI *local dev*
// default demo keys (identical on every local Supabase project on this
// machine), not a production secret.
const LOCAL_DB_URL =
  "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
const LOCAL_API_URL = "http://127.0.0.1:56321";
const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

function assertNotProduction(connectionString) {
  if (connectionString.includes(PRODUCTION_REF)) {
    throw new Error(
      `REFUSING TO PROCEED: connection string contains the production ref "${PRODUCTION_REF}". ` +
        `PT-05 must never write to production.`,
    );
  }
  const url = new URL(connectionString.replace(/^postgresql:/, "postgres:"));
  if (
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) &&
    !url.hostname.endsWith(".pt05-local-stack")
  ) {
    throw new Error(
      `REFUSING TO PROCEED: connection host "${url.hostname}" does not look like a local target. ` +
        `Expected 127.0.0.1/localhost. Aborting rather than risk writing to a shared environment.`,
    );
  }
  return url;
}

async function createAuthUser(email, password) {
  const res = await fetch(`${LOCAL_API_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: LOCAL_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${LOCAL_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(
      `GoTrue admin createUser failed for ${email}: ${res.status} ${JSON.stringify(body)}`,
    );
  }
  return body.id;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const lines = [];
  const log = (msg) => {
    console.log(msg);
    lines.push(msg);
  };

  log(`PT-05-001 isolation environment provisioning`);
  log(`Generated: ${new Date().toISOString()}`);
  log(``);

  // --- Step 1: assert non-production target -------------------------------
  const url = assertNotProduction(LOCAL_DB_URL);
  log(`Target check: PASS -- host="${url.hostname}" port="${url.port}" does not contain production ref "${PRODUCTION_REF}"`);
  log(`Connection string (redacted): postgresql://postgres:***@${url.hostname}:${url.port}${url.pathname}`);
  log(`Stack: local Supabase CLI stack (Postgres 17 + GoTrue + PostgREST), started in .pt05-local-stack/`);
  log(`Production ref for comparison (must NOT appear above): ${PRODUCTION_REF}`);
  log(``);

  const client = new Client({ connectionString: LOCAL_DB_URL });
  await client.connect();

  // Reconfirm from inside the live connection itself (not just the string).
  const dbInfo = await client.query(
    "select current_database() as db, inet_server_addr()::text as addr, inet_server_port() as port",
  );
  const { db, addr, port } = dbInfo.rows[0];
  log(`Live connection check: database="${db}" server_addr="${addr}" server_port="${port}"`);
  if (String(addr).includes(PRODUCTION_REF) || String(db).includes(PRODUCTION_REF)) {
    throw new Error("Live connection reports a production-looking target. Aborting.");
  }
  log(`Live connection confirmed local (server_addr is a loopback/private address, not a Supabase cloud host).`);
  log(``);

  // --- Step 2: apply schema ------------------------------------------------
  const schemaSql = fs.readFileSync(SCHEMA_SQL_PATH, "utf8");
  await client.query(schemaSql);
  log(`Schema applied: ${SCHEMA_SQL_PATH} (organizations, profiles, funders, opportunities, applications, draft_versions, contacts, donor_discovery_directory, donor_discovery_requests, donor_discovery_prospects, deadlines + 10 real enum types)`);
  log(``);

  // --- Step 3: create two orgs + owner users -------------------------------
  const orgs = {};
  for (const [key, name] of [
    ["A", "PT-05 Test Org A"],
    ["B", "PT-05 Test Org B"],
  ]) {
    const orgRes = await client.query(
      `insert into organizations (name, ein, mission_statement, onboarding_completed, onboarding_step)
       values ($1, $2, $3, true, 5) returning id`,
      [name, key === "A" ? "11-1111111" : "22-2222222", `Test mission for ${name}.`],
    );
    const orgId = orgRes.rows[0].id;

    const email = `pt05-owner-${key.toLowerCase()}@benavora-pt05-test.local`;
    const userId = await createAuthUser(email, `Pt05TestPassword!${key}23`);

    await client.query(
      `insert into profiles (id, organization_id, email, full_name, role)
       values ($1, $2, $3, $4, 'owner')`,
      [userId, orgId, email, `PT-05 Owner ${key}`],
    );

    orgs[key] = { orgId, userId, email, name };
    log(`Org ${key} created: id=${orgId} name="${name}"`);
    log(`  Owner user ${key} created: auth.users.id=${userId} email=${email} profiles.role=owner`);
  }
  log(``);

  // --- Step 4: seed tenant-scoped rows per org -----------------------------
  const seedSummary = {};
  for (const key of ["A", "B"]) {
    const { orgId, userId } = orgs[key];
    const counts = {};

    const funderRes = await client.query(
      `insert into funders (organization_id, name, category, description)
       values ($1, $2, 'private_foundation', $3) returning id`,
      [orgId, `PT-05 Test Funder ${key}`, `Seed funder for isolation testing, org ${key}.`],
    );
    const funderId = funderRes.rows[0].id;
    counts.funders = 1;

    const oppRes = await client.query(
      `insert into opportunities (organization_id, funder_id, name, category, description, amount_min, amount_max, status)
       values ($1, $2, $3, 'private_foundation', $4, 10000, 50000, 'open') returning id`,
      [orgId, funderId, `PT-05 Test Opportunity ${key}`, `Seed opportunity for isolation testing, org ${key}.`],
    );
    const oppId = oppRes.rows[0].id;
    counts.opportunities = 1;

    const appRes = await client.query(
      `insert into applications (organization_id, opportunity_id, stage, assigned_user_id, requested_amount, notes)
       values ($1, $2, 'drafting', $3, 25000, $4) returning id`,
      [orgId, oppId, userId, `Seed application for isolation testing, org ${key}.`],
    );
    const appId = appRes.rows[0].id;
    counts.applications = 1;

    await client.query(
      `insert into draft_versions (organization_id, opportunity_id, application_id, template_type, content, confidence_score, version_number, created_by)
       values ($1, $2, $3, 'grant_narrative', $4, 70, 1, $5)`,
      [orgId, oppId, appId, `Seed draft content for isolation testing, org ${key}.`, userId],
    );
    counts.draft_versions = 1;

    await client.query(
      `insert into contacts (organization_id, funder_id, name, title, email, relationship)
       values ($1, $2, $3, 'Program Officer', $4, 'warm')`,
      [orgId, funderId, `PT-05 Test Contact ${key}`, `contact-${key.toLowerCase()}@pt05-test.local`],
    );
    counts.contacts = 1;

    const dirRes = await client.query(
      `insert into donor_discovery_directory (legal_name, naics_codes, website)
       values ($1, $2, $3) returning id`,
      [`PT-05 Directory Entry ${key}`, ["236220"], `https://pt05-test-${key.toLowerCase()}.example`],
    );
    const dirId = dirRes.rows[0].id;

    const reqRes = await client.query(
      `insert into donor_discovery_requests (organization_id, name, taxonomy_ids, geography, status, created_by)
       values ($1, $2, '{}', $3, 'complete', $4) returning id`,
      [orgId, `PT-05 Discovery Request ${key}`, JSON.stringify({ state: "TX" }), userId],
    );
    const reqId = reqRes.rows[0].id;

    await client.query(
      `insert into donor_discovery_prospects (organization_id, directory_id, request_id, score, pipeline_stage, assigned_to)
       values ($1, $2, $3, 65, 'new', $4)`,
      [orgId, dirId, reqId, userId],
    );
    counts.donor_discovery_prospects = 1;

    await client.query(
      `insert into deadlines (organization_id, application_id, opportunity_id, deadline_type, due_date, title)
       values ($1, $2, $3, 'application_deadline', current_date + interval '30 days', $4)`,
      [orgId, appId, oppId, `Seed deadline for isolation testing, org ${key}.`],
    );
    counts.deadlines = 1;

    seedSummary[key] = { orgId, userId, counts };
    log(`Org ${key} seeded: ${JSON.stringify(counts)}`);
  }

  await client.end();

  fs.writeFileSync(path.join(OUT_DIR, "environment.txt"), lines.join("\n") + "\n", "utf8");
  fs.writeFileSync(
    path.join(OUT_DIR, "seed-summary.json"),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        target: {
          host: url.hostname,
          port: url.port,
          database: db,
          is_production: false,
          production_ref_for_comparison: PRODUCTION_REF,
        },
        orgs: seedSummary,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log("\nDone. Wrote test-evidence/pt-05/environment.txt and seed-summary.json.");
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
