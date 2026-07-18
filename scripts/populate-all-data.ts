// ============================================================================
// BENAVORA — master data population orchestrator
//
// Runs the core Faith Foundation data population steps in sequence, in-process
// (no child process spawning), reusing the exact agent/library code each
// individual script calls so results match what running each script
// separately would produce:
//   1. Digital Twin rebuild for every onboarded org       (build-digital-twins.ts logic)
//   2. Intelligence Library corpus seed                   (seed-intelligence-corpus.ts logic)
//   3. Knowledge Engine patterns seed                      (seed-knowledge-patterns.ts logic)
//   4. Federal grants poll for Faith Foundation             (poll-federal-grants.ts logic, scoped)
//   5. Eligibility scoring for Faith Foundation opportunities (batch-score-eligibility.ts logic, scoped)
//   6. Morning digest for all orgs                          (run-morning-digest.ts logic)
//
// Each step logs its name and start time, and a failure in one step is caught
// and logged so the remaining steps still run. This is the fast, in-process
// path intended to finish well under 2 hours for Faith Foundation's current
// data volume — the long-running bulk jobs (IRS BMF import, ProPublica batch
// enrichment) are separate commands (pnpm ingest:bmf, pnpm enrich:propublica)
// and are intentionally not part of this script.
//
//   pnpm populate:all
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

import { buildDigitalTwin } from "../src/lib/intelligence/digital-twin-builder";
import { pollFederalSources } from "../src/lib/sources/federal-grants-poller";
import { sendMorningDigest } from "../src/lib/agents/morning-digest";
import { EligibilityScorer } from "../src/lib/agents/eligibility-scorer";
import { seedIntelligenceCorpus } from "./lib/seed-intelligence-corpus-data";
import { seedKnowledgePatterns } from "./lib/seed-knowledge-patterns-data";

const FAITH_FOUNDATION_ORG_ID = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";
const ELIGIBILITY_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

function stepHeader(step: number, name: string) {
  console.log(`\n[Step ${step}] ${name} — start ${new Date().toISOString()}`);
}

interface OrganizationRow {
  id: string;
  name: string;
}

// ----------------------------------------------------------------------------
// Step 1: Digital Twin rebuild for every onboarded org
// ----------------------------------------------------------------------------
async function runBuildDigitalTwins(admin: SupabaseClient): Promise<void> {
  const { data, error } = await admin
    .from("organizations")
    .select("id, name")
    .eq("onboarding_completed", true)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`could not query organizations: ${error.message}`);
  }

  const orgs = (data ?? []) as OrganizationRow[];
  console.log(`  Organizations to process: ${orgs.length}`);

  let succeeded = 0;
  let failed = 0;

  for (const org of orgs) {
    try {
      const twin = await buildDigitalTwin(org.id, admin);
      succeeded++;
      console.log(`  ✓ ${org.name}: completeness ${twin.twin_completeness_score}`);
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${org.name}: ${message}`);
    }
  }

  console.log(`  Done. succeeded=${succeeded} failed=${failed}`);
}

// ----------------------------------------------------------------------------
// Step 4: Federal grants poll, scoped to Faith Foundation
// ----------------------------------------------------------------------------
async function runPollFederalGrants(admin: SupabaseClient): Promise<void> {
  const results = await pollFederalSources(FAITH_FOUNDATION_ORG_ID, admin);
  let totalFound = 0;
  let totalMatched = 0;
  for (const result of results) {
    totalFound += result.found;
    totalMatched += result.matched;
    console.log(`  ✓ ${result.source}: found ${result.found}, matched ${result.matched}`);
  }
  console.log(`  Done. found=${totalFound} matched=${totalMatched}`);
}

// ----------------------------------------------------------------------------
// Step 5: Eligibility scoring, scoped to Faith Foundation
// ----------------------------------------------------------------------------
async function runScoreEligibility(admin: SupabaseClient): Promise<void> {
  const PAGE_SIZE = 1000;
  const rows: { id: string }[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await admin
      .from("opportunities")
      .select("id")
      .eq("organization_id", FAITH_FOUNDATION_ORG_ID)
      .is("eligibility_score", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`could not query opportunities: ${error.message}`);
    }

    const batch = (data ?? []) as { id: string }[];
    rows.push(...batch);

    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  console.log(`  Due for scoring: ${rows.length}`);

  let scored = 0;
  let failed = 0;

  for (const opp of rows) {
    try {
      const scorer = new EligibilityScorer({
        client: admin,
        organizationId: FAITH_FOUNDATION_ORG_ID,
        triggeredBy: null,
      });
      await scorer.run({ opportunityId: opp.id });
      scored++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ opportunity ${opp.id}: ${message}`);
    }

    await sleep(ELIGIBILITY_DELAY_MS);
  }

  console.log(`  Done. scored=${scored} failed=${failed}`);
}

// ----------------------------------------------------------------------------
// Step 6: Morning digest for all orgs
// ----------------------------------------------------------------------------
async function runMorningDigest(admin: SupabaseClient): Promise<void> {
  const { data, error } = await admin
    .from("organizations")
    .select("id, name")
    .eq("onboarding_completed", true)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`could not query organizations: ${error.message}`);
  }

  const orgs = (data ?? []) as OrganizationRow[];
  console.log(`  Organizations to process: ${orgs.length}`);

  let sent = 0;
  let failed = 0;

  for (const org of orgs) {
    try {
      await sendMorningDigest(org.id, admin);
      sent++;
      console.log(`  ✓ ${org.name}`);
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${org.name}: ${message}`);
    }
  }

  console.log(`  Done. sent=${sent} failed=${failed}`);
}

async function main() {
  const startedAt = Date.now();
  console.log("Master data population — Faith Foundation\n");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    fatal("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    // ws's WebSocket type isn't structurally identical to realtime-js's
    // WebSocketLikeConstructor (event handler signatures differ); runtime
    // behavior is unaffected. Same pattern as scripts/batch-score-opportunities.ts.
    realtime: { transport: ws as any },
  });

  const steps: Array<{ name: string; run: () => Promise<void> }> = [
    { name: "Build Digital Twins", run: () => runBuildDigitalTwins(admin) },
    { name: "Seed Intelligence Corpus", run: () => seedIntelligenceCorpus(admin) },
    { name: "Seed Knowledge Patterns", run: () => seedKnowledgePatterns(admin) },
    { name: "Poll Federal Grants (Faith Foundation)", run: () => runPollFederalGrants(admin) },
    { name: "Score Eligibility (Faith Foundation)", run: () => runScoreEligibility(admin) },
    { name: "Run Morning Digest (all orgs)", run: () => runMorningDigest(admin) },
  ];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    stepHeader(i + 1, step.name);
    try {
      await step.run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ Step failed: ${message}`);
    }
  }

  const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.log(`\nAll steps complete. Elapsed: ${elapsedMin} minutes.`);
}

main().catch((error) => {
  fatal(error instanceof Error ? error.message : String(error));
});
