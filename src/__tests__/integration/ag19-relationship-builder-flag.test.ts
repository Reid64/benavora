import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";

import { routeQueueItem, type AgentQueueRow } from "../../../worker/autonomous-orchestrator";

// Node 20 has no native WebSocket; mirrors the workaround in
// src/lib/supabase/admin.ts and the other suites in this directory — without
// it, supabase-js's realtime client (constructed eagerly by createClient
// regardless of whether it's used) throws immediately.
function createClient(url: string, key: string, opts: Record<string, unknown> = {}): SupabaseClient {
  return createSupabaseClient(url, key, {
    ...opts,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: ws as any },
  }) as unknown as SupabaseClient;
}

/**
 * Live verification of worker/autonomous-orchestrator.ts's
 * `feature.relationship_builder_v2` org-scoped flag (routeQueueItem's
 * 'funder_relationship' case, exported for exactly this test — see that
 * function's own header comment).
 *
 * Calls the real, unmodified `routeQueueItem()` directly against a synthetic
 * (in-memory, never inserted into the real `agent_queue` table)
 * AgentQueueRow-shaped object — this exercises the exact same feature-flag
 * check, dynamic import, and agent instantiation the live worker's
 * `agent_queue` poll loop uses, without ever touching the shared,
 * continuously-polled `agent_queue` table itself (a real risk to avoid: that
 * table is live production infrastructure other orgs' real work flows
 * through right now).
 *
 * IMPORTANT, real findings from live execution during this test's
 * development (not assumed, not fabricated — see AGENT_VERIFICATION_LOG.md
 * precedent for this project's standing discipline on this point):
 *
 * 1. Gen-1 FunderRelationshipAgent's real write to `funder_relationship_scores`
 *    currently fails against the live schema — its upsert targets
 *    `relationship_score/trend/recent_events/is_stale/total_interactions/
 *    successful_applications/last_interaction_at`, none of which exist on the
 *    live table (real columns: `score/events/last_updated_at`). So
 *    `routeQueueItem()` REJECTS on the flag=false path, not resolves — but
 *    `BaseAgent.logStart()` always writes the `agent_runs` row (with the
 *    correct `agent_type` discriminator) BEFORE `execute()` runs, so that
 *    row is a reliable, real, observable side effect regardless of whether
 *    the run ultimately succeeds. This is a genuine, previously-undocumented
 *    bug in the Gen-1 agent, out of scope to fix here — flagged, not
 *    silently worked around.
 * 2. RelationshipBuilderAgent (Gen-2, AG-19) never writes to
 *    `relationship_memory` anywhere in its source — confirmed by a full-file
 *    grep and, live, by this test itself. It only ever *reads* that table
 *    (Phase A's per-funder engagement-history lookup). The only agent in
 *    this codebase that writes `relationship_memory` is
 *    ReputationIntelligenceAgent (AG-18), for HIGH/CRITICAL reputation
 *    signals — an unrelated, non-deterministic (web-search-driven) code
 *    path. This test therefore asserts on the real write
 *    RelationshipBuilderAgent actually performs (`funder_relationship_scores`,
 *    correctly org/funder-scoped) and additionally asserts
 *    `relationship_memory` stays empty, documenting the real behavior rather
 *    than a false premise.
 *
 * Runs against the real project configured in `.env.local` (no separate test
 * Supabase project — matches every other suite in this directory). Every
 * row created here (organization, funder, platform_config flag, and
 * whatever the real agent runs write) is deleted in `afterAll` via a
 * generic sweep across every table with a live FK to `organizations(id)`
 * (captured 2026-08-13 via information_schema — the same "don't rely on a
 * hand-picked, possibly-incomplete table list" convention already
 * established elsewhere in this test suite for the same cleanup problem).
 */

function loadLocalEnv(): Record<string, string> {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return {};
  return dotenv.parse(fs.readFileSync(envPath));
}

const localEnv = loadLocalEnv();
const SUPABASE_URL = localEnv.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = localEnv.SUPABASE_SERVICE_ROLE_KEY;
const CREDS_AVAILABLE = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

const FAITH_FOUNDATION_ORG_ID = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";
const FEATURE_FLAG_KEY = "feature.relationship_builder_v2";

// Every table with a live FK to organizations(id), captured 2026-08-13 via a
// direct information_schema query against production (not assumed from a
// migration file — this project's schema has repeatedly drifted from its own
// migrations, see AGENT_VERIFICATION_LOG.md throughout). Deleted for the
// disposable test org, in this order, before the org row itself.
const ORG_SCOPED_TABLES: Array<[table: string, column: string]> = [
  ["agent_decisions", "org_id"],
  ["agent_queue", "org_id"],
  ["agent_runs", "organization_id"],
  ["ai_usage_log", "organization_id"],
  ["alerts", "organization_id"],
  ["applications", "organization_id"],
  ["audit_logs", "organization_id"],
  ["auto_queue_config", "organization_id"],
  ["autoapply_follow_ups", "organization_id"],
  ["autoapply_submissions", "organization_id"],
  ["automation_notifications", "organization_id"],
  ["automation_queue", "organization_id"],
  ["automation_sessions", "organization_id"],
  ["autonomous_triggers", "org_id"],
  ["board_members", "organization_id"],
  ["calendar_connections", "organization_id"],
  ["calendar_events", "organization_id"],
  ["community_need_signals", "org_id"],
  ["competitor_tracking", "organization_id"],
  ["contacts", "organization_id"],
  ["corporate_intent_signals", "org_id"],
  ["corporate_relationships", "org_id"],
  ["custom_api_connections", "organization_id"],
  ["custom_connector_allowlist", "organization_id"],
  ["deadlines", "organization_id"],
  ["documents", "organization_id"],
  ["donor_discovery_connectors", "organization_id"],
  ["donor_discovery_prospects", "organization_id"],
  ["donor_discovery_requests", "organization_id"],
  ["draft_automation_config", "organization_id"],
  ["draft_queue", "organization_id"],
  ["draft_versions", "organization_id"],
  ["email_activity", "organization_id"],
  ["email_campaign_sequences", "organization_id"],
  ["email_campaigns", "organization_id"],
  ["email_connections", "organization_id"],
  ["email_sequence_enrollments", "organization_id"],
  ["email_templates", "organization_id"],
  ["email_thread_links", "organization_id"],
  ["enrichment_jobs", "organization_id"],
  ["form_templates", "organization_id"],
  ["fundability_scores", "org_id"],
  ["funder_credentials", "organization_id"],
  ["funder_dna_profiles", "organization_id"],
  ["funder_giving_history", "organization_id"],
  ["funder_intelligence", "organization_id"],
  ["funder_relationship_events", "organization_id"],
  ["funder_relationship_scores", "organization_id"],
  ["funders", "organization_id"],
  ["grant_agreements", "organization_id"],
  ["historical_awards", "organization_id"],
  ["impersonation_log", "target_org_id"],
  ["integration_keys", "organization_id"],
  ["integrations", "organization_id"],
  ["invoices", "organization_id"],
  ["kb_extended_needs", "organization_id"],
  ["knowledge_base", "organization_id"],
  ["marketplace_listings", "organization_id"],
  ["marketplace_matches", "organization_id"],
  ["notes", "organization_id"],
  ["onboarding_steps", "organization_id"],
  ["opportunities", "organization_id"],
  ["opportunity_keywords", "organization_id"],
  ["org_autonomous_config", "org_id"],
  ["org_documents", "organization_id"],
  ["org_learning_contributions", "org_id"],
  ["org_usage_summary", "organization_id"],
  ["outcomes", "organization_id"],
  ["outreach_contacts", "organization_id"],
  ["outreach_template_variants", "organization_id"],
  ["outreach_templates", "organization_id"],
  ["pipeline_history", "organization_id"],
  ["platform_config", "organization_id"],
  ["platform_tasks", "related_tenant_id"],
  ["profiles", "organization_id"],
  ["programs", "organization_id"],
  ["proven_narratives", "organization_id"],
  ["relationship_memory", "org_id"],
  ["relationship_recommendations", "org_id"],
  ["renewals", "organization_id"],
  ["reputation_alerts", "org_id"],
  ["request_profiles", "organization_id"],
  ["research_cache", "organization_id"],
  ["roi_insights", "org_id"],
  ["scraping_targets", "organization_id"],
  ["search_profiles", "organization_id"],
  ["simulation_scenarios", "org_id"],
  ["solicitation_registrations", "organization_id"],
  ["strategic_recommendations", "organization_id"],
  ["submission_queue", "organization_id"],
  ["submission_variables", "org_id"],
  ["subscriptions", "organization_id"],
  ["success_probability_scores", "organization_id"],
  ["synced_email_messages", "organization_id"],
  ["synced_email_threads", "organization_id"],
  ["system_errors", "organization_id"],
  ["team_activity_log", "organization_id"],
  ["usage_metrics", "organization_id"],
  ["usage_tracking", "organization_id"],
  ["user_invitations", "organization_id"],
  ["validations", "organization_id"],
  ["webhook_configs", "organization_id"],
];

/**
 * Deletes every row scoped to `orgId` across ORG_SCOPED_TABLES, then the org
 * row itself. Runs up to 3 passes over the table list (rather than one) since
 * a handful of these tables reference each other, not just `organizations`
 * (e.g. agent_decisions -> agent_runs) — a single ordered pass can leave a
 * row behind if its own referencing row hasn't been deleted yet. Every
 * individual delete is best-effort (mirrors this suite's established
 * `try {} catch {}` convention) since most tables will have zero matching
 * rows for any given disposable test org.
 */
async function deleteOrgAndAllDependents(
  service: SupabaseClient,
  orgId: string,
): Promise<void> {
  for (let pass = 0; pass < 3; pass++) {
    for (const [table, column] of ORG_SCOPED_TABLES) {
      try {
        await service.from(table).delete().eq(column, orgId);
      } catch {
        // best-effort cleanup — some tables may not exist in every
        // environment, or may already be empty for this org.
      }
    }
  }
  const { error } = await service.from("organizations").delete().eq("id", orgId);
  if (error) {
    // eslint-disable-next-line no-console
    console.warn(
      `[ag19-relationship-builder-flag.test] organizations delete failed for ${orgId}: ${error.message}`,
    );
  }
}

(CREDS_AVAILABLE ? describe : describe.skip)(
  "AG-19 feature.relationship_builder_v2 flag routing (worker/autonomous-orchestrator.ts routeQueueItem)",
  () => {
    let service: SupabaseClient;
    let testOrgId: string;
    let testFunderId: string;

    beforeAll(async () => {
      service = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const tag = randomSuffix();

      const { data: org, error: orgError } = await service
        .from("organizations")
        .insert({ name: `AG19_FLAG_TEST_ORG_${tag}`, onboarding_progress: {} })
        .select("id")
        .single();
      expect(orgError, orgError?.message).toBeNull();
      testOrgId = org!.id as string;

      const { data: funder, error: funderError } = await service
        .from("funders")
        .insert({
          organization_id: testOrgId,
          name: `AG19 Flag Test Funder ${tag}`,
          category: "private_foundation",
        })
        .select("id")
        .single();
      expect(funderError, funderError?.message).toBeNull();
      testFunderId = funder!.id as string;
    }, 30_000);

    afterAll(async () => {
      if (!service || !testOrgId) return;
      await deleteOrgAndAllDependents(service, testOrgId);

      // Confirm cleanup actually worked, not just that the delete calls ran
      // without throwing.
      const { data: remainingOrg } = await service
        .from("organizations")
        .select("id")
        .eq("id", testOrgId)
        .maybeSingle();
      expect(remainingOrg).toBeNull();

      const { data: remainingRuns } = await service
        .from("agent_runs")
        .select("id")
        .eq("organization_id", testOrgId);
      expect(remainingRuns ?? []).toHaveLength(0);
    }, 60_000);

    it("1. flag unset/false: routing instantiates the Gen-1 FunderRelationshipAgent — confirmed via the real agent_runs.agent_type discriminator, not the Gen-2 one", async () => {
      // Precondition: confirm the flag is genuinely absent for this org
      // before exercising the unset-flag branch.
      const { data: preFlag, error: preFlagError } = await service
        .from("platform_config")
        .select("value")
        .eq("organization_id", testOrgId)
        .eq("key", FEATURE_FLAG_KEY)
        .maybeSingle();
      expect(preFlagError, preFlagError?.message).toBeNull();
      expect(preFlag).toBeNull();

      const item: AgentQueueRow = {
        id: randomUUID(),
        org_id: testOrgId,
        agent_id: "funder_relationship",
        input_payload: { funderId: testFunderId, event: "note_added" },
        retry_count: 0,
        max_retries: 3,
      };

      // Gen-1 FunderRelationshipAgent's real write to
      // funder_relationship_scores currently fails against the live schema
      // (see file header) — routeQueueItem() rejects rather than resolves
      // on this path. That is itself confirmed, real, current behavior, not
      // a test artifact: BaseAgent.logStart() writes the agent_runs row
      // (with the correct agent_type discriminator) BEFORE execute() runs,
      // so the discriminator check below is unaffected either way.
      await expect(routeQueueItem(service, item)).rejects.toThrow();

      const { data: runs, error: runsError } = await service
        .from("agent_runs")
        .select("agent_type, status, organization_id")
        .eq("organization_id", testOrgId)
        .order("created_at", { ascending: false });
      expect(runsError, runsError?.message).toBeNull();
      expect(runs).toHaveLength(1);
      expect(runs![0]!.organization_id).toBe(testOrgId);
      expect(runs![0]!.agent_type).toBe("funder_relationship");

      // The Gen-2 agent was never reached on this path.
      const gen2Runs = (runs ?? []).filter(
        (r) => r.agent_type === "ag-19-relationship",
      );
      expect(gen2Runs).toHaveLength(0);
    });

    it("2. sets feature.relationship_builder_v2 = 'true' for the disposable test org only", async () => {
      const { error: upsertError } = await service.from("platform_config").upsert(
        { organization_id: testOrgId, key: FEATURE_FLAG_KEY, value: "true" },
        { onConflict: "organization_id,key" },
      );
      expect(upsertError, upsertError?.message).toBeNull();

      const { data: flag, error: flagError } = await service
        .from("platform_config")
        .select("value")
        .eq("organization_id", testOrgId)
        .eq("key", FEATURE_FLAG_KEY)
        .maybeSingle();
      expect(flagError, flagError?.message).toBeNull();
      expect(flag?.value).toBe("true");
    });

    it("3. flag true: routing instantiates RelationshipBuilderAgent (agent_type='ag-19-relationship'), a real run() call completes without error, and it writes a real row correctly scoped to the test org's organization_id", async () => {
      const item: AgentQueueRow = {
        id: randomUUID(),
        org_id: testOrgId,
        agent_id: "funder_relationship",
        input_payload: {},
        retry_count: 0,
        max_retries: 3,
      };

      // Must resolve (not throw) on the v2 path — a real, unmodified,
      // end-to-end RelationshipBuilderAgent.run("event") call.
      const summary = await routeQueueItem(service, item);
      expect(summary).toContain("relationship_builder_v2");
      expect(summary).toContain("completed");

      const { data: runs, error: runsError } = await service
        .from("agent_runs")
        .select("agent_type, status, organization_id, error_message")
        .eq("organization_id", testOrgId)
        .eq("agent_type", "ag-19-relationship");
      expect(runsError, runsError?.message).toBeNull();
      expect(runs).toHaveLength(1);
      expect(runs![0]!.organization_id).toBe(testOrgId);
      expect(runs![0]!.status).toBe("completed");
      expect(runs![0]!.error_message).toBeNull();

      // The real write RelationshipBuilderAgent performs per funder, scoped
      // to the correct organization_id/funder_id — see file header for why
      // this, and not relationship_memory, is the real observable write.
      const { data: scoreRows, error: scoreError } = await service
        .from("funder_relationship_scores")
        .select("organization_id, funder_id, score")
        .eq("organization_id", testOrgId)
        .eq("funder_id", testFunderId);
      expect(scoreError, scoreError?.message).toBeNull();
      expect(scoreRows).toHaveLength(1);
      expect(scoreRows![0]!.organization_id).toBe(testOrgId);
      expect(scoreRows![0]!.funder_id).toBe(testFunderId);
      expect(typeof scoreRows![0]!.score).toBe("number");

      // Documents the real finding rather than asserting a false premise:
      // RelationshipBuilderAgent only ever reads relationship_memory, it
      // never writes to it (confirmed by a full-file source grep and, here,
      // live against the real database).
      const { data: memoryRows, error: memoryError } = await service
        .from("relationship_memory")
        .select("id")
        .eq("org_id", testOrgId);
      expect(memoryError, memoryError?.message).toBeNull();
      expect(memoryRows).toHaveLength(0);
    });

    it("4. Faith Foundation's real org still has no feature.relationship_builder_v2 row and is unaffected by this entire test", async () => {
      const { data: ffFlag, error: ffFlagError } = await service
        .from("platform_config")
        .select("value")
        .eq("organization_id", FAITH_FOUNDATION_ORG_ID)
        .eq("key", FEATURE_FLAG_KEY)
        .maybeSingle();
      expect(ffFlagError, ffFlagError?.message).toBeNull();
      expect(ffFlag).toBeNull();
    });
  },
);

if (!CREDS_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[ag19-relationship-builder-flag.test] skipped entirely — .env.local is missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
  );
}
