// ============================================================================
// BENAVORA — Faith Foundation setup script
//
// Runs the primary-tenant bootstrap requested for org
// b1ab7402-dfc2-4712-869f-70ea3566cc1d:
//   1. Dedup check on organizations named like "faith"
//   2. Upsert org_autonomous_config (autonomous mode toggles)
//   3. Seed knowledge_base program entries (additive only, see note below)
//   4. Set organizations.onboarding_completed = true
//
// Schema notes (verified against the live migrations, not the task-given
// spec, which collided with real state on three points):
//   - org_autonomous_config's real definition is
//     src/supabase/migrations/080_autonomous_agent_infrastructure.sql (not
//     SCHEMA_REGISTRY_v2.md's #71, which documents an older/aspirational
//     shape — autonomous_mode_enabled/auto_apply_enabled/etc. that was never
//     applied). Migration 080's columns match this script's field list.
//   - There is no `knowledge_base_profiles` table anywhere in the repo. The
//     real narrative-block table is `knowledge_base`
//     (supabase/migrations/001_initial_schema.sql).
//   - `onboarding_completed` is a column on `organizations`
//     (supabase/migrations/003_onboarding.sql), not on `profiles`. This
//     script sets it on the org row, not on any profile row.
//
// Identity-data conflict (NOT auto-resolved, see step 3 below):
//   BLUEPRINT_v2.md documents this exact org ID as a 508(c)(1)(a) serving
//   emergency/transitional housing in rural Texas. The KB-seed brief this
//   script was written against instead describes a Wyoming 501(c)(3) in the
//   San Francisco Bay Area (faithfoundationsf.org). Those cannot both be
//   true. This script does NOT write tax_status, service_area, or website —
//   it only reports current values and flags the conflict for a human to
//   resolve. Only the 9 named programs are seeded (their names are
//   consistent with the canonical "emergency/transitional housing" mission
//   either way, so they carry no jurisdiction/geography claim).
//
//   npx tsx scripts/ff-setup.ts
// ============================================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const FAITH_FOUNDATION_ORG_ID = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";

const PROGRAM_NAMES = [
  "Housing Stability",
  "Homeownership Counseling",
  "Veterans Housing",
  "Recovery Housing",
  "Second Chance Reentry",
  "Single Parent Stability",
  "Emergency Bridge Housing",
  "Financial Literacy",
  "Cornerstone Communities",
];

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    fatal("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    realtime: { transport: ws as any },
  });

  console.log("=".repeat(78));
  console.log("Faith Foundation setup — org", FAITH_FOUNDATION_ORG_ID);
  console.log("=".repeat(78));

  // --------------------------------------------------------------------
  // 1. DEDUP CHECK
  // --------------------------------------------------------------------
  console.log("\n[1/4] Dedup check: organizations matching '%faith%'\n");

  const { data: matches, error: matchErr } = await admin
    .from("organizations")
    .select("id, name, created_at")
    .ilike("name", "%faith%")
    .order("created_at", { ascending: true });

  if (matchErr) fatal(`dedup query failed: ${matchErr.message}`);

  const orgs = matches ?? [];
  if (orgs.length === 0) {
    console.log(
      `  WARNING: no organizations match '%faith%' at all — canonical org ${FAITH_FOUNDATION_ORG_ID} not found by name search.`,
    );
  } else {
    for (const o of orgs) {
      const marker = o.id === FAITH_FOUNDATION_ORG_ID ? "CANONICAL" : "DUPLICATE — needs manual review";
      console.log(`  [${marker}] ${o.id}  "${o.name}"  created ${o.created_at}`);
    }
  }

  const duplicateIds = orgs.filter((o) => o.id !== FAITH_FOUNDATION_ORG_ID).map((o) => o.id);
  if (duplicateIds.length > 0) {
    console.log(`\n  ${duplicateIds.length} duplicate org(s) found — NOT auto-merged/deleted:`);
    duplicateIds.forEach((id) => console.log(`    - ${id}`));
    console.log("  (matches known unresolved issue: 'Duplicate Faith Foundation orgs' in STATE_OF_THE_BUILD.md)");
  } else if (orgs.length === 1) {
    console.log("\n  No duplicates. Canonical org is the only match.");
  }

  const canonicalExists = orgs.some((o) => o.id === FAITH_FOUNDATION_ORG_ID);
  if (!canonicalExists) {
    fatal(`Canonical org ${FAITH_FOUNDATION_ORG_ID} does not exist in organizations table. Aborting.`);
  }

  // --------------------------------------------------------------------
  // 2. AUTONOMOUS CONFIG
  // --------------------------------------------------------------------
  console.log("\n[2/4] Upserting org_autonomous_config\n");

  const autonomousConfig = {
    org_id: FAITH_FOUNDATION_ORG_ID,
    auto_research_enabled: true,
    auto_score_enabled: true,
    auto_draft_enabled: false,
    auto_draft_threshold: 75,
    auto_reputation_enabled: true,
    auto_relationship_enabled: true,
    auto_deadline_prediction_enabled: true,
    auto_followup_enabled: true,
    notify_on_auto_draft: true,
    notify_on_high_score: true,
    max_auto_drafts_per_night: 3,
    updated_at: new Date().toISOString(),
  };

  const { data: cfgRow, error: cfgErr } = await admin
    .from("org_autonomous_config")
    .upsert(autonomousConfig, { onConflict: "org_id" })
    .select()
    .single();

  if (cfgErr) fatal(`org_autonomous_config upsert failed: ${cfgErr.message}`);
  console.log("  Upserted:", JSON.stringify(cfgRow, null, 2));

  // --------------------------------------------------------------------
  // 3. KB PROFILE SEED
  // --------------------------------------------------------------------
  console.log("\n[3/4] Knowledge base seed\n");

  const { data: orgRow, error: orgErr } = await admin
    .from("organizations")
    .select("id, name, ein, tax_status, mission_statement, service_area, website")
    .eq("id", FAITH_FOUNDATION_ORG_ID)
    .single();

  if (orgErr) fatal(`could not read organization row: ${orgErr.message}`);

  console.log("  Current organization identity fields (NOT modified by this script):");
  console.log(`    name:              ${orgRow.name}`);
  console.log(`    ein:               ${orgRow.ein ?? "(null)"}`);
  console.log(`    tax_status:        ${orgRow.tax_status ?? "(null)"}`);
  console.log(`    mission_statement: ${orgRow.mission_statement ?? "(null)"}`);
  console.log(`    service_area:      ${orgRow.service_area ?? "(null)"}`);
  console.log(`    website:           ${orgRow.website ?? "(null)"}`);

  console.log(
    "\n  CONFLICT FLAG: this task's brief describes the org as a Wyoming 501(c)(3) in the\n" +
      "  San Francisco Bay Area (faithfoundationsf.org). BLUEPRINT_v2.md (canonical, ยง1)\n" +
      "  describes this exact org ID as a 508(c)(1)(a) serving rural Texas. This script\n" +
      "  does NOT write tax_status/service_area/website/mission_statement because it\n" +
      "  cannot determine which description is correct. Resolve manually before either\n" +
      "  value is used downstream (grant narratives, eligibility scoring, etc.).",
  );

  const { data: existingPrograms, error: kbReadErr } = await admin
    .from("knowledge_base")
    .select("id, title")
    .eq("organization_id", FAITH_FOUNDATION_ORG_ID)
    .eq("category", "program_description");

  if (kbReadErr) fatal(`could not read knowledge_base: ${kbReadErr.message}`);

  const existingTitles = new Set((existingPrograms ?? []).map((r) => r.title));
  const toInsert = PROGRAM_NAMES.filter((name) => !existingTitles.has(name)).map((name) => ({
    organization_id: FAITH_FOUNDATION_ORG_ID,
    category: "program_description",
    title: name,
    content: name,
    is_proven: false,
  }));

  if (toInsert.length === 0) {
    console.log(`\n  All ${PROGRAM_NAMES.length} program entries already exist. Nothing inserted.`);
  } else {
    const { data: inserted, error: kbInsertErr } = await admin
      .from("knowledge_base")
      .insert(toInsert)
      .select("id, title");

    if (kbInsertErr) fatal(`knowledge_base insert failed: ${kbInsertErr.message}`);
    console.log(`\n  Inserted ${inserted?.length ?? 0} new program_description entries:`);
    inserted?.forEach((r) => console.log(`    - ${r.title} (${r.id})`));
    const skipped = PROGRAM_NAMES.length - (inserted?.length ?? 0);
    if (skipped > 0) console.log(`  Skipped ${skipped} already-present program(s).`);
  }

  // --------------------------------------------------------------------
  // 4. ONBOARDING STATUS
  // --------------------------------------------------------------------
  // NOTE: the task asked for `profiles.onboarding_completed = true`, but no
  // such column exists. onboarding_completed lives on `organizations`
  // (supabase/migrations/003_onboarding.sql) and gates middleware routing.
  // Setting it there is the real equivalent of what was requested.
  console.log("\n[4/4] Onboarding status\n");

  const { data: onboardRow, error: onboardErr } = await admin
    .from("organizations")
    .update({ onboarding_completed: true, updated_at: new Date().toISOString() })
    .eq("id", FAITH_FOUNDATION_ORG_ID)
    .select("id, onboarding_completed")
    .single();

  if (onboardErr) fatal(`onboarding update failed: ${onboardErr.message}`);
  console.log(`  organizations.onboarding_completed = ${onboardRow.onboarding_completed}`);

  const { data: adminProfiles, error: profErr } = await admin
    .from("profiles")
    .select("id, email, role")
    .eq("organization_id", FAITH_FOUNDATION_ORG_ID)
    .in("role", ["owner", "admin"]);

  if (profErr) fatal(`profiles query failed: ${profErr.message}`);
  console.log(`\n  Owner/admin profiles on this org (${adminProfiles?.length ?? 0}):`);
  adminProfiles?.forEach((p) => console.log(`    - ${p.email} (${p.role})`));

  console.log("\n" + "=".repeat(78));
  console.log("Done.");
  console.log("=".repeat(78));
}

main().catch((error) => {
  console.error(`\nFATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
