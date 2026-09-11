import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

import { FunderRelationshipAgent } from "@/lib/agents/funder-relationship";
import { RelationshipBuilderAgent } from "@/lib/agents/relationship-builder-agent";
import { computeRelationshipScore } from "@/lib/intelligence/relationship-scorer";

/**
 * Live verification that the relationship-scoring consolidation actually
 * eliminates the "three conflicting formulas" bug: creates 5 funders with an
 * identical funder_relationship_events history, runs Agent 23
 * (FunderRelationshipAgent) and AG-19 (RelationshipBuilderAgent) against
 * them, and asserts every funder gets the exact same score from both agents
 * — matching the canonical relationship-scorer.ts formula computed
 * independently. (relationship-graph-builder-agent.ts / AG-32 is excluded —
 * confirmed by source audit to compute no relationship score at all; see its
 * file header and BEHAVIORAL_CONTRACTS.md's "Relationship Scoring" contract.)
 *
 * Node 20 has no native WebSocket; mirrors the workaround already used by
 * every other live-DB suite in this directory (e.g.
 * ag19-relationship-builder-flag.test.ts).
 */
function createClient(url: string, key: string, opts: Record<string, unknown> = {}): SupabaseClient {
  return createSupabaseClient(url, key, {
    ...opts,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: ws as any },
  }) as unknown as SupabaseClient;
}

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

const FUNDER_COUNT = 5;
// A single 'meeting' event per funder scores 15 (see relationship-scorer.ts's
// EVENT_WEIGHTS) — comfortably below the default auto_draft_threshold (70,
// autonomous-base.ts's DEFAULT_ORG_CONFIG), so RelationshipBuilderAgent's
// Phase A never calls Claude for these disposable test funders.
const EXPECTED_SCORE = 15;

(CREDS_AVAILABLE ? describe : describe.skip)(
  "Relationship scoring consolidation: Agent 23, AG-19, and the canonical scorer agree",
  () => {
    let service: SupabaseClient;
    let testOrgId: string;
    let funderIds: string[] = [];

    beforeAll(async () => {
      service = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const tag = randomSuffix();

      const { data: org, error: orgError } = await service
        .from("organizations")
        .insert({ name: `RELSCORE_TEST_ORG_${tag}`, onboarding_progress: {} })
        .select("id")
        .single();
      expect(orgError, orgError?.message).toBeNull();
      testOrgId = org!.id as string;

      for (let i = 0; i < FUNDER_COUNT; i++) {
        const { data: funder, error: funderError } = await service
          .from("funders")
          .insert({
            organization_id: testOrgId,
            name: `RelScore Test Funder ${tag}-${i}`,
            category: "private_foundation",
          })
          .select("id")
          .single();
        expect(funderError, funderError?.message).toBeNull();
        funderIds.push(funder!.id as string);
      }

      // Identical event history for every funder: one 'meeting' event each.
      for (const funderId of funderIds) {
        const { error: eventError } = await service.from("funder_relationship_events").insert({
          organization_id: testOrgId,
          funder_id: funderId,
          event_type: "meeting",
        });
        expect(eventError, eventError?.message).toBeNull();
      }
    }, 30_000);

    afterAll(async () => {
      if (!service || !testOrgId) return;
      // Best-effort, dependency-ordered cleanup for exactly what this suite
      // touches (mirrors the try/catch convention in
      // ag19-relationship-builder-flag.test.ts's fuller sweep).
      const cleanupTables: Array<[table: string, column: string]> = [
        ["agent_decisions", "org_id"],
        ["relationship_recommendations", "org_id"],
        ["relationship_memory", "org_id"],
        ["funder_relationship_events", "organization_id"],
        ["funder_relationship_scores", "organization_id"],
        ["agent_runs", "organization_id"],
        ["funders", "organization_id"],
      ];
      for (const [table, column] of cleanupTables) {
        try {
          await service.from(table).delete().eq(column, testOrgId);
        } catch {
          // best-effort — see cited convention above.
        }
      }
      await service.from("organizations").delete().eq("id", testOrgId);
    }, 60_000);

    it("Agent 23 (FunderRelationshipAgent) scores every funder identically via the canonical formula", async () => {
      for (const funderId of funderIds) {
        const agent = new FunderRelationshipAgent({
          client: service,
          organizationId: testOrgId,
          triggeredBy: null,
        });
        // 'note_added' has no canonical event_type (see EVENT_TO_CANONICAL_TYPE)
        // so this call recomputes from the pre-seeded history without adding a
        // new scored event.
        const outcome = await agent.run({ funderId, event: "note_added" });
        expect(outcome.data.relationshipScore).toBe(EXPECTED_SCORE);
      }

      const { data: rows, error } = await service
        .from("funder_relationship_scores")
        .select("funder_id, relationship_score, score, trend")
        .eq("organization_id", testOrgId);
      expect(error, error?.message).toBeNull();
      expect(rows).toHaveLength(FUNDER_COUNT);
      for (const row of rows!) {
        expect(row.relationship_score).toBe(EXPECTED_SCORE);
        // Written into both live column families so no reader disagrees.
        expect(row.score).toBe(EXPECTED_SCORE);
      }
    }, 60_000);

    it("AG-19 (RelationshipBuilderAgent) Phase A scores every funder identically, matching Agent 23", async () => {
      const agent = new RelationshipBuilderAgent(testOrgId, service);
      const result = await agent.run("manual");
      expect(result.success, JSON.stringify(result.errors)).toBe(true);

      const { data: rows, error } = await service
        .from("funder_relationship_scores")
        .select("funder_id, relationship_score, score, trend")
        .eq("organization_id", testOrgId);
      expect(error, error?.message).toBeNull();
      expect(rows).toHaveLength(FUNDER_COUNT);

      const scores = new Set(rows!.map((r) => r.relationship_score as number));
      const trends = new Set(rows!.map((r) => r.trend as string));
      // All 5 funders had identical event histories, so both the score and
      // the derived trend must be identical across every funder.
      expect(scores.size).toBe(1);
      expect(trends.size).toBe(1);
      for (const row of rows!) {
        expect(row.relationship_score).toBe(EXPECTED_SCORE);
        expect(row.score).toBe(EXPECTED_SCORE);
      }
    }, 60_000);

    it("matches the canonical scorer computed independently for every funder", async () => {
      for (const funderId of funderIds) {
        const result = await computeRelationshipScore(funderId, testOrgId, service);
        expect(result.score).toBe(EXPECTED_SCORE);
      }
    }, 30_000);
  },
);

if (!CREDS_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[relationship-scoring-consolidation.test] skipped entirely — .env.local is missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
  );
}
