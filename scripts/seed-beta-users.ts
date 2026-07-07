// ============================================================================
// BENAVORA — Beta user seed script
//
// Creates 3 beta auth users, each with their own organization (admin role),
// and copies sample opportunity + funder data from a reference org into each
// new org so beta testers have something to look at immediately.
//
// NOTE ON SCHEMA MAPPING: the live schema (supabase/migrations/) has no
// `org_members`, `grants`, or `foundations` tables. Org membership is 1:1 via
// `profiles.organization_id` + `profiles.role` (enum: owner/admin/writer/
// viewer), "grants" are rows in `opportunities`, and "foundations" are rows
// in `funders` (the only per-org table shaped like a foundation/funder
// record — `foundation_directory` is shared IRS reference data with no
// org_id and isn't tenant-scoped, so it can't be "copied per org").
//
//   pnpm seed:beta
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import ws from "ws";

dotenv.config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws as unknown as typeof WebSocket },
});

const SOURCE_ORG_ID = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";
const PASSWORD = "BetaTest2026";

const BETA_USERS = [
  { email: "beta1@benavora-test.com", orgName: "Beta Org 1" },
  { email: "beta2@benavora-test.com", orgName: "Beta Org 2" },
  { email: "beta3@benavora-test.com", orgName: "Beta Org 3" },
];

function ok(step: string, detail: string) {
  console.log(`  ✓ ${step}: ${detail}`);
}

function fail(step: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`  ✗ ${step}: ${message}`);
}

// ----------------------------------------------------------------------------
// Copy every funders row from SOURCE_ORG_ID into newOrgId, with new UUIDs.
// Returns a map of old funder id -> new funder id (needed to remap the
// funder_id FK on copied opportunities).
// ----------------------------------------------------------------------------
async function copyFunders(newOrgId: string): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();

  const { data, error } = await admin
    .from("funders")
    .select("*")
    .eq("organization_id", SOURCE_ORG_ID);

  if (error) {
    fail("copy foundations (funders)", error);
    return idMap;
  }
  if (!data || data.length === 0) {
    ok("copy foundations (funders)", "0 source rows found, nothing to copy");
    return idMap;
  }

  const rows = data.map((row) => {
    const newId = randomUUID();
    idMap.set(row.id, newId);
    const { id, organization_id, created_at, updated_at, ...rest } = row;
    return { id: newId, organization_id: newOrgId, ...rest };
  });

  const { error: insertError } = await admin.from("funders").insert(rows);
  if (insertError) {
    fail("copy foundations (funders)", insertError);
    return idMap;
  }
  ok("copy foundations (funders)", `${rows.length} row(s) copied`);
  return idMap;
}

// ----------------------------------------------------------------------------
// Copy every opportunities row ("grants") from SOURCE_ORG_ID into newOrgId,
// with new UUIDs and funder_id remapped to the newly copied funder rows.
// ----------------------------------------------------------------------------
async function copyOpportunities(newOrgId: string, funderIdMap: Map<string, string>) {
  const { data, error } = await admin
    .from("opportunities")
    .select("*")
    .eq("organization_id", SOURCE_ORG_ID);

  if (error) {
    fail("copy grants (opportunities)", error);
    return;
  }
  if (!data || data.length === 0) {
    ok("copy grants (opportunities)", "0 source rows found, nothing to copy");
    return;
  }

  const rows = data.map((row) => {
    const { id, organization_id, funder_id, created_at, updated_at, ...rest } = row;
    return {
      id: randomUUID(),
      organization_id: newOrgId,
      funder_id: funder_id ? funderIdMap.get(funder_id) ?? null : null,
      ...rest,
    };
  });

  const { error: insertError } = await admin.from("opportunities").insert(rows);
  if (insertError) {
    fail("copy grants (opportunities)", insertError);
    return;
  }
  ok("copy grants (opportunities)", `${rows.length} row(s) copied`);
}

async function seedBetaUser(email: string, orgName: string) {
  console.log(`\n${orgName} (${email})`);

  // 1. Auth user ---------------------------------------------------------
  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (userError || !userData?.user) {
    fail("create auth user", userError ?? new Error("no user returned"));
    return;
  }
  ok("create auth user", userData.user.id);

  // 2. Organization --------------------------------------------------------
  const { data: orgData, error: orgError } = await admin
    .from("organizations")
    .insert({ name: orgName })
    .select("id")
    .single();
  if (orgError || !orgData) {
    fail("create organization", orgError ?? new Error("no organization returned"));
    return;
  }
  ok("create organization", orgData.id);

  // 3. Membership (profiles.organization_id + role) -------------------------
  const { error: profileError } = await admin.from("profiles").insert({
    id: userData.user.id,
    organization_id: orgData.id,
    email,
    role: "admin",
  });
  if (profileError) {
    fail("add org membership (profiles)", profileError);
    return;
  }
  ok("add org membership (profiles)", "role=admin");

  // 4 & 5. Copy sample data --------------------------------------------------
  const funderIdMap = await copyFunders(orgData.id);
  await copyOpportunities(orgData.id, funderIdMap);
}

async function main() {
  console.log(`Seeding ${BETA_USERS.length} beta users from source org ${SOURCE_ORG_ID} ...`);
  for (const { email, orgName } of BETA_USERS) {
    await seedBetaUser(email, orgName);
  }
  console.log("\nDone.");
}

main();
