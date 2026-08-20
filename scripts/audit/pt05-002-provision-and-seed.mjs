// ============================================================================
// PT-05-002 (support step) -- apply the schema extension (RLS on the 7
// PT-05-001 tables + 13 new tenant_fk_gap tables) to the existing PT-05
// local stack, then seed one row per org into each of the 13 new tables
// (the 7 original tables already have their PT-05-001 seed rows).
//
// Reuses the exact orgs/users PT-05-001 already created (read from
// test-evidence/pt-05/seed-summary.json) -- does not create new orgs.
//
// Writes test-evidence/pt-05/cross-tenant-seed-ids.json: for all 20
// live-tested tables, Org A's and Org B's real seeded row id, needed by
// pt05-002-cross-tenant-read.mjs to attempt "read Org B's known row" as
// Org A.
//
// Usage: node scripts/audit/pt05-002-provision-and-seed.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";
const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
const OUT_DIR = path.join("test-evidence", "pt-05");
const SEED_SUMMARY_PATH = path.join(OUT_DIR, "seed-summary.json");
const EXTENSION_SQL_PATH = path.join("scripts", "audit", "pt05-002-schema-extension.sql");

function assertNotProduction(connectionString) {
  if (connectionString.includes(PRODUCTION_REF)) {
    throw new Error(`REFUSING: connection string contains production ref "${PRODUCTION_REF}".`);
  }
  const url = new URL(connectionString.replace(/^postgresql:/, "postgres:"));
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error(`REFUSING: host "${url.hostname}" does not look local.`);
  }
  return url;
}

async function main() {
  const url = assertNotProduction(LOCAL_DB_URL);
  const seedSummary = JSON.parse(fs.readFileSync(SEED_SUMMARY_PATH, "utf8"));
  const orgA = seedSummary.orgs.A;
  const orgB = seedSummary.orgs.B;

  const client = new Client({ connectionString: LOCAL_DB_URL });
  await client.connect();

  const dbInfo = await client.query(
    "select current_database() as db, inet_server_addr()::text as addr",
  );
  console.log(`Target check: local host="${url.hostname}" db="${dbInfo.rows[0].db}" addr="${dbInfo.rows[0].addr}"`);
  if (String(dbInfo.rows[0].addr).includes(PRODUCTION_REF)) {
    throw new Error("Live connection reports a production-looking target. Aborting.");
  }

  console.log(`Applying schema extension: ${EXTENSION_SQL_PATH}`);
  const extSql = fs.readFileSync(EXTENSION_SQL_PATH, "utf8");
  await client.query(extSql);
  console.log("Schema extension applied: current_org_id() + RLS on 7 tables + 13 new tenant_fk_gap tables.");

  const seedIds = { generated_at: new Date().toISOString(), orgs: { A: orgA.orgId, B: orgB.orgId }, tables: {} };

  // --- Row IDs already seeded by PT-05-001 (7 original tables) ------------
  const originalTables = [
    "funders",
    "opportunities",
    "applications",
    "draft_versions",
    "contacts",
    "donor_discovery_prospects",
    "deadlines",
  ];
  for (const table of originalTables) {
    const rowA = await client.query(
      `select id from ${table} where organization_id = $1 limit 1`,
      [orgA.orgId],
    );
    const rowB = await client.query(
      `select id from ${table} where organization_id = $1 limit 1`,
      [orgB.orgId],
    );
    seedIds.tables[table] = {
      tenant_column: "organization_id",
      A: rowA.rows[0]?.id ?? null,
      B: rowB.rows[0]?.id ?? null,
      seeded_by: "pt05-001-provision-isolation-env.mjs",
    };
    console.log(`Existing seed rows -- ${table}: A=${seedIds.tables[table].A} B=${seedIds.tables[table].B}`);
  }

  // --- Look up per-org funder_id / opportunity_id for FK targets ----------
  const funderIdA = seedIds.tables.funders.A;
  const funderIdB = seedIds.tables.funders.B;
  const oppIdA = seedIds.tables.opportunities.A;
  const oppIdB = seedIds.tables.opportunities.B;

  // --- Seed one row per org into each of the 13 new tenant_fk_gap tables --
  async function seedRow(table, tenantCol, sql, paramsA, paramsB) {
    const rA = await client.query(sql, paramsA);
    const rB = await client.query(sql, paramsB);
    seedIds.tables[table] = {
      tenant_column: tenantCol,
      A: rA.rows[0].id,
      B: rB.rows[0].id,
      seeded_by: "pt05-002-provision-and-seed.mjs",
    };
    console.log(`New seed rows -- ${table}: A=${rA.rows[0].id} B=${rB.rows[0].id}`);
  }

  await seedRow(
    "adapter_usage_log",
    "organization_id",
    `insert into adapter_usage_log (organization_id, adapter_name, api_cost_cents, records_returned, cache_hit)
     values ($1, 'pt05_test_adapter', 5, 3, false) returning id`,
    [orgA.orgId],
    [orgB.orgId],
  );

  await seedRow(
    "agent_configurations",
    "organization_id",
    `insert into agent_configurations (organization_id, agent_id, enabled)
     values ($1, 'pt05-test-agent', true) returning id`,
    [orgA.orgId],
    [orgB.orgId],
  );

  await seedRow(
    "autoapply_review_queue",
    "organization_id",
    `insert into autoapply_review_queue (organization_id, funder_id, reason)
     values ($1, $2, 'PT-05-002 seed row for cross-tenant read test') returning id`,
    [orgA.orgId, funderIdA],
    [orgB.orgId, funderIdB],
  );

  await seedRow(
    "board_meetings",
    "org_id",
    `insert into board_meetings (org_id, meeting_date, agenda)
     values ($1, current_date + interval '14 days', 'PT-05-002 seed board meeting') returning id`,
    [orgA.orgId],
    [orgB.orgId],
  );

  const bmA = seedIds.tables.board_meetings.A;
  const bmB = seedIds.tables.board_meetings.B;
  await seedRow(
    "board_meeting_packets",
    "org_id",
    `insert into board_meeting_packets (org_id, meeting_id, packet_content)
     values ($1, $2, '{"seed":"pt05-002"}'::jsonb) returning id`,
    [orgA.orgId, bmA],
    [orgB.orgId, bmB],
  );

  await seedRow(
    "discovery_matches",
    "org_id",
    `insert into discovery_matches (org_id, opportunity_id, external_title, external_source)
     values ($1, $2, 'PT-05-002 seed discovery match', 'pt05-test') returning id`,
    [orgA.orgId, oppIdA],
    [orgB.orgId, oppIdB],
  );

  await seedRow(
    "funding_forecasts",
    "org_id",
    `insert into funding_forecasts (org_id, forecast_date, forecast_period)
     values ($1, current_date, '90_day') returning id`,
    [orgA.orgId],
    [orgB.orgId],
  );

  await seedRow(
    "impact_simulations",
    "org_id",
    `insert into impact_simulations (org_id, scenario_type, scenario_params)
     values ($1, 'lose_funder', '{"funderId":"seed"}'::jsonb) returning id`,
    [orgA.orgId],
    [orgB.orgId],
  );

  await seedRow(
    "knowledge_queries",
    "org_id",
    `insert into knowledge_queries (org_id, query_text)
     values ($1, 'PT-05-002 seed query') returning id`,
    [orgA.orgId],
    [orgB.orgId],
  );

  await seedRow(
    "opportunity_probability_scores",
    "organization_id",
    `insert into opportunity_probability_scores (opportunity_id, organization_id, overall_score)
     values ($1, $2, 55) returning id`,
    [oppIdA, orgA.orgId],
    [oppIdB, orgB.orgId],
  );

  await seedRow(
    "organizational_digital_twins",
    "organization_id",
    `insert into organizational_digital_twins (organization_id, mission)
     values ($1, 'PT-05-002 seed mission statement') returning id`,
    [orgA.orgId],
    [orgB.orgId],
  );

  await seedRow(
    "pitch_cache",
    "organization_id",
    `insert into pitch_cache (organization_id, funder_id, personalized_pitch, pitch_hash)
     values ($1, $2, 'PT-05-002 seed pitch', 'pt05-seed-hash') returning id`,
    [orgA.orgId, funderIdA],
    [orgB.orgId, funderIdB],
  );

  await seedRow(
    "submission_receipts",
    "organization_id",
    `insert into submission_receipts (organization_id, receipt_data)
     values ($1, '{"seed":"pt05-002"}'::jsonb) returning id`,
    [orgA.orgId],
    [orgB.orgId],
  );

  await client.end();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, "cross-tenant-seed-ids.json");
  fs.writeFileSync(outPath, JSON.stringify(seedIds, null, 2), "utf8");
  console.log(`\nWrote ${outPath} -- ${Object.keys(seedIds.tables).length} tables.`);
}

main().catch((err) => {
  console.error(`HALT: ${err.stack || err.message}`);
  process.exit(1);
});
