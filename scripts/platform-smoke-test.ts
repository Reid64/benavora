// ============================================================================
// BENAVORA — platform smoke test
//
// Verifies core platform functionality against the REAL database and REAL
// agent classes: table connectivity + row counts, agent class construction,
// Faith Foundation org data, Intelligence Library data quality, and platform
// learning patterns. Every check is independently try/caught and reports
// PASS/WARN/FAIL with the real error or count — nothing here is fabricated
// (CLAUDE.md Iron Law #3).
//
// Ground-truth deviations from the literal task spec, checked against the
// actual codebase before writing this (not assumed):
//   - Every agent class below except SelfImprovementAgent takes a
//     constructor of (orgId: string, supabase: SupabaseClient) — not
//     (supabase) alone. SelfImprovementAgent is org-agnostic and takes only
//     (supabase). The real ROI agent export is `RoiOptimizerAgent`, not
//     `ROIOptimizerAgent`.
//   - `knowledge_base_profiles` does not exist anywhere in the repo — not
//     even in the unapplied duplicate migrations directory. Every real agent
//     that reads an org's KB completeness reads
//     `organizational_digital_twins.twin_completeness_score` instead (see
//     e.g. src/lib/intelligence/twin-auto-populate.ts). This script checks
//     the literal table (expected miss) AND the real analog, both labeled.
//   - agent_runs.organization_id (not org_id) is the real, NOT NULL column.
//   - platform_learning_patterns, strategic_recommendations,
//     fundability_scores, and org_autonomous_config have CREATE TABLE
//     statements only in src/supabase/migrations/ (a directory multiple
//     migration file headers describe as never applied to the live DB —
//     e.g. supabase/migrations/093_digital_twins.sql). Whether each is
//     actually live is unresolved by static file analysis alone (an existing
//     script, scripts/ff-agent-test.ts, queries several of them directly as
//     if they exist) — this script queries the real database directly and
//     reports the true, current state rather than assuming either way.
//
//   npx tsx scripts/platform-smoke-test.ts
// ============================================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

import { OpportunityDiscoveryAgent } from "../src/lib/agents/opportunity-discovery-agent";
import { ProbabilityScoringAgent } from "../src/lib/agents/probability-scoring-agent";
import { DraftGenerationAgent } from "../src/lib/agents/draft-generation-agent";
import { FundabilityScorerAgent } from "../src/lib/agents/fundability-scorer-agent";
import { DonorIntentMonitorAgent } from "../src/lib/agents/donor-intent-monitor-agent";
import { CommunityNeedPredictorAgent } from "../src/lib/agents/community-need-predictor-agent";
import { StrategicAdvisorAgent } from "../src/lib/agents/strategic-advisor-agent";
import { SelfImprovementAgent } from "../src/lib/agents/self-improvement-agent";
import { RoiOptimizerAgent } from "../src/lib/agents/roi-optimizer-agent";

const FAITH_FOUNDATION_ORG_ID =
  process.env.FAITH_FOUNDATION_ORG_ID || "b1ab7402-dfc2-4712-869f-70ea3566cc1d";

type Status = "PASS" | "WARN" | "FAIL";

interface Result {
  name: string;
  status: Status;
  detail: string;
}

const results: Result[] = [];

function record(name: string, status: Status, detail: string): void {
  results.push({ name, status, detail });
  console.log(`[${status}] ${name} — ${detail}`);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function section(title: string): void {
  console.log("\n" + "=".repeat(78));
  console.log(title);
  console.log("=".repeat(78));
}

async function countTable(
  admin: SupabaseClient,
  table: string,
  eq?: [string, string],
): Promise<{ count: number | null; error: string | null }> {
  let query = admin.from(table).select("*", { count: "exact", head: true });
  if (eq) query = query.eq(eq[0], eq[1]);
  const { count, error } = await query;
  return { count: count ?? null, error: error?.message ?? null };
}

async function main(): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "\nFATAL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local",
    );
    process.exit(1);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    realtime: { transport: ws as any },
  });

  console.log("=".repeat(78));
  console.log("BENAVORA — Platform Smoke Test");
  console.log("=".repeat(78));

  // --------------------------------------------------------------------
  // 1. DATABASE CONNECTIVITY
  // --------------------------------------------------------------------
  section("1. DATABASE CONNECTIVITY");
  const tableChecks: Array<{ table: string; min?: number }> = [
    { table: "organizations" },
    { table: "opportunities" },
    { table: "applications" },
    { table: "intelligence_funded_proposals", min: 100 },
    { table: "platform_learning_patterns", min: 1 },
    { table: "agent_runs" },
    { table: "strategic_recommendations" },
    { table: "fundability_scores" },
  ];
  for (const { table, min } of tableChecks) {
    try {
      const { count, error } = await countTable(admin, table);
      if (error) {
        record(`table:${table}`, "FAIL", error);
      } else if (min !== undefined && (count ?? 0) < min) {
        record(`table:${table}`, "WARN", `count=${count} (expected >= ${min})`);
      } else {
        record(`table:${table}`, "PASS", `count=${count}`);
      }
    } catch (err) {
      record(`table:${table}`, "FAIL", errMsg(err));
    }
  }

  // --------------------------------------------------------------------
  // 2. AGENT IMPORT VERIFICATION
  // --------------------------------------------------------------------
  section("2. AGENT IMPORT VERIFICATION");
  const agentFactories: Array<{ name: string; factory: () => unknown }> = [
    {
      name: "OpportunityDiscoveryAgent",
      factory: () => new OpportunityDiscoveryAgent(FAITH_FOUNDATION_ORG_ID, admin),
    },
    {
      name: "ProbabilityScoringAgent",
      factory: () => new ProbabilityScoringAgent(FAITH_FOUNDATION_ORG_ID, admin),
    },
    {
      name: "DraftGenerationAgent",
      factory: () => new DraftGenerationAgent(FAITH_FOUNDATION_ORG_ID, admin),
    },
    {
      name: "FundabilityScorerAgent",
      factory: () => new FundabilityScorerAgent(FAITH_FOUNDATION_ORG_ID, admin),
    },
    {
      name: "DonorIntentMonitorAgent",
      factory: () => new DonorIntentMonitorAgent(FAITH_FOUNDATION_ORG_ID, admin),
    },
    {
      name: "CommunityNeedPredictorAgent",
      factory: () => new CommunityNeedPredictorAgent(FAITH_FOUNDATION_ORG_ID, admin),
    },
    {
      name: "StrategicAdvisorAgent",
      factory: () => new StrategicAdvisorAgent(FAITH_FOUNDATION_ORG_ID, admin),
    },
    {
      // Org-agnostic — real constructor takes only (supabase), see header note.
      name: "SelfImprovementAgent",
      factory: () => new SelfImprovementAgent(admin),
    },
    {
      // Real export is `RoiOptimizerAgent` — task spec spelled it `ROIOptimizerAgent`.
      name: "RoiOptimizerAgent",
      factory: () => new RoiOptimizerAgent(FAITH_FOUNDATION_ORG_ID, admin),
    },
  ];
  for (const { name, factory } of agentFactories) {
    try {
      factory();
      record(`agent:${name}`, "PASS", "instantiated");
    } catch (err) {
      record(`agent:${name}`, "FAIL", errMsg(err));
    }
  }

  // --------------------------------------------------------------------
  // 3. FAITH FOUNDATION DATA CHECK
  // --------------------------------------------------------------------
  section("3. FAITH FOUNDATION DATA CHECK");

  try {
    const { data, error } = await admin
      .from("organizations")
      .select("id, name")
      .eq("id", FAITH_FOUNDATION_ORG_ID)
      .maybeSingle();
    if (error || !data) record("ff:organizations", "FAIL", error?.message ?? "not found");
    else record("ff:organizations", "PASS", `name=${(data as any).name}`);
  } catch (err) {
    record("ff:organizations", "FAIL", errMsg(err));
  }

  // Literal ask: knowledge_base_profiles.completeness_score — expected miss,
  // this table does not exist anywhere in the repo (see header note).
  try {
    const { error } = await admin
      .from("knowledge_base_profiles")
      .select("completeness_score")
      .eq("organization_id", FAITH_FOUNDATION_ORG_ID)
      .maybeSingle();
    if (error) record("ff:knowledge_base_profiles (literal, expected miss)", "FAIL", error.message);
    else record("ff:knowledge_base_profiles (literal, expected miss)", "PASS", "row found");
  } catch (err) {
    record("ff:knowledge_base_profiles (literal, expected miss)", "FAIL", errMsg(err));
  }

  // Real analog: organizational_digital_twins.twin_completeness_score
  try {
    const { data, error } = await admin
      .from("organizational_digital_twins")
      .select("twin_completeness_score")
      .eq("organization_id", FAITH_FOUNDATION_ORG_ID)
      .maybeSingle();
    if (error) record("ff:organizational_digital_twins (real analog)", "FAIL", error.message);
    else if (!data) record("ff:organizational_digital_twins (real analog)", "WARN", "no row for FF org");
    else
      record(
        "ff:organizational_digital_twins (real analog)",
        "PASS",
        `twin_completeness_score=${(data as any).twin_completeness_score}`,
      );
  } catch (err) {
    record("ff:organizational_digital_twins (real analog)", "FAIL", errMsg(err));
  }

  try {
    const { data, error } = await admin
      .from("org_autonomous_config")
      .select("*")
      .eq("org_id", FAITH_FOUNDATION_ORG_ID)
      .maybeSingle();
    if (error) record("ff:org_autonomous_config", "FAIL", error.message);
    else record("ff:org_autonomous_config", data ? "PASS" : "WARN", data ? "row present" : "no row for FF org");
  } catch (err) {
    record("ff:org_autonomous_config", "FAIL", errMsg(err));
  }

  try {
    const { count, error } = await countTable(admin, "opportunities", [
      "organization_id",
      FAITH_FOUNDATION_ORG_ID,
    ]);
    if (error) record("ff:opportunities count", "FAIL", error);
    else record("ff:opportunities count", "PASS", `count=${count}`);
  } catch (err) {
    record("ff:opportunities count", "FAIL", errMsg(err));
  }

  try {
    // Real column is organization_id, not org_id (task spec used org_id).
    const { count, error } = await countTable(admin, "agent_runs", [
      "organization_id",
      FAITH_FOUNDATION_ORG_ID,
    ]);
    if (error) record("ff:agent_runs count", "FAIL", error);
    else record("ff:agent_runs count", "PASS", `count=${count}`);
  } catch (err) {
    record("ff:agent_runs count", "FAIL", errMsg(err));
  }

  // --------------------------------------------------------------------
  // 4. INTELLIGENCE LIBRARY CHECK
  // --------------------------------------------------------------------
  section("4. INTELLIGENCE LIBRARY CHECK");
  try {
    const { data, error } = await admin
      .from("intelligence_funded_proposals")
      .select("category, full_text, reviewer_comments");
    if (error) {
      record("lib:intelligence_funded_proposals", "FAIL", error.message);
    } else {
      const rows = (data ?? []) as Array<{
        category: string[] | null;
        full_text: string | null;
        reviewer_comments: string | null;
      }>;
      const byCategory = new Map<string, number>();
      for (const row of rows) {
        const cats = row.category && row.category.length > 0 ? row.category : ["(uncategorized)"];
        for (const c of cats) byCategory.set(c, (byCategory.get(c) ?? 0) + 1);
      }
      record(
        "lib:category breakdown",
        rows.length > 0 ? "PASS" : "WARN",
        JSON.stringify(Object.fromEntries(byCategory)),
      );

      const wordCount = (t: string | null) => (t ? t.trim().split(/\s+/).filter(Boolean).length : 0);
      const longEnough = rows.filter((r) => wordCount(r.full_text) >= 200).length;
      const pct = rows.length > 0 ? (longEnough / rows.length) * 100 : 0;
      record(
        "lib:full_text >= 200 words",
        rows.length > 0 && pct >= 80 ? "PASS" : "WARN",
        `${longEnough}/${rows.length} rows (${pct.toFixed(1)}%, want >= 80%)`,
      );

      // Table has no dedicated success_factors column — reviewer_comments is
      // the closest real field (see supabase/migrations/048_grant_intelligence.sql).
      const withComments = rows.filter(
        (r) => r.reviewer_comments && r.reviewer_comments.trim().length > 0,
      ).length;
      record(
        "lib:reviewer_comments populated (no success_factors column exists)",
        "PASS",
        `${withComments}/${rows.length} rows`,
      );
    }
  } catch (err) {
    record("lib:intelligence_funded_proposals", "FAIL", errMsg(err));
  }

  // --------------------------------------------------------------------
  // 5. PLATFORM LEARNING PATTERNS
  // --------------------------------------------------------------------
  section("5. PLATFORM LEARNING PATTERNS");
  try {
    const { data, error } = await admin
      .from("platform_learning_patterns")
      .select("success_rate, pattern_content");
    if (error) {
      record("plp:platform_learning_patterns", "FAIL", error.message);
    } else {
      const rows = (data ?? []) as Array<{
        success_rate: number | null;
        pattern_content: string | null;
      }>;
      const withSuccessRate = rows.filter(
        (r) => r.success_rate !== null && r.success_rate !== undefined,
      ).length;
      const withContent = rows.filter(
        (r) => r.pattern_content && r.pattern_content.trim().length > 0,
      ).length;
      record("plp:count", rows.length > 0 ? "PASS" : "WARN", `count=${rows.length}`);
      record("plp:success_rate populated", "PASS", `${withSuccessRate}/${rows.length} rows`);
      record("plp:pattern_content populated", "PASS", `${withContent}/${rows.length} rows`);
    }
  } catch (err) {
    record("plp:platform_learning_patterns", "FAIL", errMsg(err));
  }

  // --------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------
  section("SUMMARY");
  const passCount = results.filter((r) => r.status === "PASS").length;
  const warnCount = results.filter((r) => r.status === "WARN").length;
  const failCount = results.filter((r) => r.status === "FAIL").length;
  console.log(`PASS: ${passCount}  WARN: ${warnCount}  FAIL: ${failCount}  TOTAL: ${results.length}`);

  if (failCount > 0) {
    console.log("\nFailures:");
    for (const r of results.filter((r) => r.status === "FAIL")) console.log(`  - ${r.name}: ${r.detail}`);
  }
  if (warnCount > 0) {
    console.log("\nWarnings:");
    for (const r of results.filter((r) => r.status === "WARN")) console.log(`  - ${r.name}: ${r.detail}`);
  }

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`\nFATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
