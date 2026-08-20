// PT-09-002 -- seeds a dedicated, non-Faith test org on the local
// pt05-local-stack for batch-1 agent execution proof (AG-01..AG-21).
// Separate org from pt05's Org A/B so this phase's writes never mix with
// PT-05's own tenant-isolation evidence.
//
// Usage: node scripts/audit/pt09-002-seed-env.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const OUT_DIR = path.join(REPO_ROOT, "test-evidence", "pt-09");

const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";
const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
const LOCAL_API_URL = "http://127.0.0.1:56321";
const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

function assertNotProduction(connectionString) {
  if (connectionString.includes(PRODUCTION_REF)) {
    throw new Error(`REFUSING: connection string contains production ref "${PRODUCTION_REF}".`);
  }
  const url = new URL(connectionString.replace(/^postgresql:/, "postgres:"));
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error(`REFUSING: host "${url.hostname}" is not a local target.`);
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
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`GoTrue admin createUser failed for ${email}: ${res.status} ${JSON.stringify(body)}`);
  }
  return body.id;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const url = assertNotProduction(LOCAL_DB_URL);

  const client = new Client({ connectionString: LOCAL_DB_URL });
  await client.connect();
  const dbInfo = await client.query(
    "select current_database() as db, inet_server_addr()::text as addr, inet_server_port() as port",
  );
  console.log("Connected:", dbInfo.rows[0]);
  if (String(dbInfo.rows[0].addr).includes(PRODUCTION_REF)) {
    throw new Error("Live connection reports a production-looking target. Aborting.");
  }

  // --- Org + owner user -------------------------------------------------
  const orgRes = await client.query(
    `insert into organizations
       (name, ein, mission_statement, service_area, onboarding_completed, onboarding_step,
        tax_status, vision_statement, founder_name, target_population, annual_budget,
        total_staff, total_volunteers)
     values ($1,$2,$3,$4,true,5,$5,$6,$7,$8,$9,$10,$11)
     returning id`,
    [
      "PT-09 Batch1 Test Org",
      "99-9999999",
      "PT-09 batch-1 dedicated test org, non-Faith, for agent execution proof.",
      "Central Texas",
      "501c3",
      "Provide housing and workforce services to underserved families in Central Texas.",
      "Jordan Rivera",
      "Low-income families and displaced workers",
      1250000,
      12,
      40,
    ],
  );
  const orgId = orgRes.rows[0].id;

  const email = "pt09-owner@benavora-pt09-test.local";
  const userId = await createAuthUser(email, "Pt09TestPassword!23");
  await client.query(
    `insert into profiles (id, organization_id, email, full_name, role)
     values ($1,$2,$3,$4,'owner')`,
    [userId, orgId, email, "PT-09 Test Owner"],
  );
  console.log(`Org created: id=${orgId}`);
  console.log(`Owner user created: id=${userId} email=${email}`);

  // --- Funders (varied categories, one with no giving page for cold_outreach) --
  const funders = [];
  const funderDefs = [
    ["PT-09 Community Foundation", "private_foundation", "https://givingportal.example/pt09-cf", true],
    ["PT-09 Federal Housing Program", "government_grant", null, false],
    ["PT-09 Regional Bank Giving", "corporate_donation", null, false],
  ];
  for (const [name, category, portalUrl, hasPage] of funderDefs) {
    const r = await client.query(
      `insert into funders (organization_id, name, category, description, has_giving_page, giving_portal_url, website)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [orgId, name, category, `Seed funder for PT-09 batch-1 execution proof.`, hasPage, portalUrl, "https://example.com"],
    );
    funders.push({ id: r.rows[0].id, name, category });
  }
  console.log(`Funders seeded: ${funders.length}`);

  // --- Opportunities (varied, some near-deadline, some funder-linked) ----
  const opportunities = [];
  for (let i = 0; i < 3; i++) {
    const f = funders[i % funders.length];
    const r = await client.query(
      `insert into opportunities
         (organization_id, funder_id, name, category, description, amount_min, amount_max, deadline,
          eligibility_requirements, required_documents, status)
       values ($1,$2,$3,$4,$5,15000,75000, current_date + ($6 || ' days')::interval,
               'Must be a registered 501(c)(3) serving Central Texas.', '{"Form 990","Board list"}', 'open')
       returning id`,
      [orgId, f.id, `PT-09 Test Opportunity ${i + 1}`, f.category, "Seed opportunity for PT-09 batch-1 execution proof.", String(10 + i * 20)],
    );
    opportunities.push({ id: r.rows[0].id, funderId: f.id, name: `PT-09 Test Opportunity ${i + 1}` });
  }
  console.log(`Opportunities seeded: ${opportunities.length}`);

  // --- Applications (linked to first 2 opportunities) ---------------------
  const applications = [];
  for (let i = 0; i < 2; i++) {
    const o = opportunities[i];
    const r = await client.query(
      `insert into applications (organization_id, opportunity_id, stage, assigned_user_id, requested_amount, notes)
       values ($1,$2,'drafting',$3,25000,$4) returning id`,
      [orgId, o.id, userId, "Seed application for PT-09 batch-1 execution proof."],
    );
    applications.push({ id: r.rows[0].id, opportunityId: o.id });
  }
  console.log(`Applications seeded: ${applications.length}`);

  // --- Deadlines ------------------------------------------------------------
  for (let i = 0; i < opportunities.length; i++) {
    const o = opportunities[i];
    const app = applications[i] ?? null;
    await client.query(
      `insert into deadlines (organization_id, application_id, opportunity_id, deadline_type, due_date, title)
       values ($1,$2,$3,'application_deadline', current_date + ($4 || ' days')::interval, $5)`,
      [orgId, app ? app.id : null, o.id, String(10 + i * 20), `Deadline for ${o.name}`],
    );
  }
  console.log(`Deadlines seeded: ${opportunities.length}`);

  // --- Board members (for relationship-builder / relationship-graph agents) --
  const boardMembers = [];
  for (const [name, title] of [
    ["Alex Chen", "Board Chair"],
    ["Priya Nair", "Treasurer"],
  ]) {
    const r = await client.query(
      `insert into board_members (organization_id, name, title, is_active)
       values ($1,$2,$3,true) returning id`,
      [orgId, name, title],
    );
    boardMembers.push(r.rows[0].id);
  }
  console.log(`Board members seeded: ${boardMembers.length}`);

  // --- Search profile (for AG-17 discovery) --------------------------------
  await client.query(
    `insert into search_profiles (organization_id, name, keywords, is_active)
     values ($1,'PT-09 Default Search Profile','{"housing","workforce development"}',true)`,
    [orgId],
  );
  console.log("Search profile seeded: 1");

  // --- Knowledge base rows (for draft-generation / budget-builder reads) --
  await client.query(
    `insert into knowledge_base (organization_id, category, content)
     values ($1,'mission',$2), ($1,'program_description',$3)`,
    [
      orgId,
      "PT-09 Batch1 Test Org provides transitional housing and workforce training to families in Central Texas.",
      "Our flagship program places 200 families per year into stable housing paired with job training.",
    ],
  );
  console.log("Knowledge base rows seeded: 2");

  // --- Corporate prospects (for EA-01/EA-08 enrichment agents) -------------
  const corporateProspects = [];
  const cpDefs = [
    ["Lonestar Manufacturing Co", "https://lonestar-mfg.example"],
    ["Hill Country Logistics LLC", "https://hillcountry-logistics.example"],
  ];
  for (const [legalName, website] of cpDefs) {
    const r = await client.query(
      `insert into corporate_prospects (legal_name, website) values ($1,$2) returning id`,
      [legalName, website],
    );
    corporateProspects.push(r.rows[0].id);
  }
  console.log(`Corporate prospects seeded: ${corporateProspects.length}`);

  // --- Foundation directory (for AG-13 foundation-enrichment scraper) -----
  const foundationDirectory = [];
  const fdDefs = [["PT-09 Seed Foundation", "78701"]];
  for (const [name, zip] of fdDefs) {
    const r = await client.query(
      `insert into foundation_directory (name, zip) values ($1,$2) returning id`,
      [name, zip],
    );
    foundationDirectory.push(r.rows[0].id);
  }
  console.log(`Foundation directory rows seeded: ${foundationDirectory.length}`);

  await client.end();

  const summary = {
    generated_at: new Date().toISOString(),
    target: {
      host: url.hostname,
      port: url.port,
      is_production: false,
      production_ref_for_comparison: PRODUCTION_REF,
      local_api_url: LOCAL_API_URL,
      env_override_for_agent_invocation: {
        NEXT_PUBLIC_SUPABASE_URL: LOCAL_API_URL,
        SUPABASE_SERVICE_ROLE_KEY: "see LOCAL_SERVICE_ROLE_KEY in this script (local-stack demo key, not a secret)",
      },
    },
    org: { orgId, userId, email },
    funders,
    opportunities,
    applications,
    boardMembers,
    corporateProspects,
    foundationDirectory,
  };
  fs.writeFileSync(path.join(OUT_DIR, "environment.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(`\nWrote ${path.join(OUT_DIR, "environment.json")}`);
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
