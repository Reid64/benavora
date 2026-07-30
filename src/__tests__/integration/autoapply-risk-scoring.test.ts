import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { assessSubmissionRisk, type RiskAssessment } from "@/lib/autoapply/risk-engine";

/**
 * Verifies src/lib/autoapply/risk-engine.ts (the Submission Risk Engine
 * documented in AUTOAPPLY_ARCHITECTURE_V2.md §8A) on two axes DEMO_READINESS_AUDIT.md
 * never actually tested:
 *
 *   1. That assessSubmissionRisk() produces sensible, correctly-banded scores
 *      across varied risk profiles (low/medium/high/critical), that points
 *      stack additively, and that the 0-100 clamp works.
 *   2. That submission_queue.risk_score / risk_factors — the columns
 *      migration 052_governance_layer.sql adds via
 *      `ALTER TABLE submission_queue ADD COLUMN IF NOT EXISTS risk_score/risk_factors`
 *      — are actually queryable and writable on the LIVE production
 *      database, not just present in the migration file. worker/queue-processor.ts
 *      (lines ~916-924) writes these columns only on the 'manual' recommendation
 *      path; this suite performs that exact write against a real row and reads
 *      it back, rather than trusting that the migration ran.
 *
 * Part 1 uses a fake Supabase client (no network) so scoring-logic assertions
 * are fast and deterministic. Part 2 is a live integration test against the
 * real production database via the service-role key, matching the method
 * DEMO_READINESS_AUDIT.md §2/§5/§7 used for its own verification passes.
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

// Node 20 has no native WebSocket; mirrors the workaround used throughout
// src/__tests__/integration/*.test.ts — supabase-js's realtime client is
// constructed eagerly by createClient regardless of whether it's used.
function createClient(url: string, key: string): SupabaseClient {
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: ws as any },
  }) as unknown as SupabaseClient;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ---------------------------------------------------------------------------
// Part 1: fake Supabase client — reproduces the exact call shapes
// risk-engine.ts issues (funder_relationships.maybeSingle(), a bare-awaited
// funder_giving_history chain, and a bare-awaited head-count on
// autoapply_submissions) so scenario scores are deterministic and don't
// depend on live data drifting between test runs.
// ---------------------------------------------------------------------------

interface FakeQueryResult {
  data?: unknown;
  error?: unknown;
  count?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeBuilder(awaitResult: FakeQueryResult, maybeSingleResult: FakeQueryResult): any {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => maybeSingleResult,
    then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      Promise.resolve(awaitResult).then(resolve, reject),
  };
  return builder;
}

interface FakeSupabaseConfig {
  funderRelationships?: FakeQueryResult; // used for BOTH maybeSingle() reads on that table
  givingHistory?: FakeQueryResult;
  priorSubmissions?: FakeQueryResult;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createFakeSupabase(cfg: FakeSupabaseConfig): any {
  return {
    from(table: string) {
      switch (table) {
        case "funder_relationships":
          return makeBuilder(
            { data: null, error: null },
            cfg.funderRelationships ?? { data: null, error: null },
          );
        case "funder_giving_history":
          return makeBuilder(cfg.givingHistory ?? { data: [], error: null }, { data: null, error: null });
        case "autoapply_submissions":
          return makeBuilder(cfg.priorSubmissions ?? { count: 0, error: null }, { data: null, error: null });
        default:
          return makeBuilder({ data: null, error: null, count: 0 }, { data: null, error: null });
      }
    },
  };
}

describe("assessSubmissionRisk() — score banding across varied risk profiles (offline, no live DB)", () => {
  it("low-risk profile: safe portal, complete org, prior relationship — score 0, classification 'low', recommendation 'auto'", async () => {
    const supabase = createFakeSupabase({
      funderRelationships: { data: { id: "rel-low", max_ask_amount: 10000, total_submissions: 5 }, error: null },
    });

    const result = await assessSubmissionRisk({
      funder: { id: "funder-low", name: "Friendly Foundation", automation_level: "assisted" },
      requestProfile: { request_type: "monetary", min_value: 1000, max_value: 2000 },
      formTemplate: {
        field_count: 12,
        has_file_uploads: false,
        requires_login: false,
        form_structure: [
          { fieldLabel: "Organization Name", fieldName: "org_name", fieldType: "text" },
          { fieldLabel: "Amount Requested", fieldName: "amount", fieldType: "number" },
        ],
      },
      orgReadiness: { ready: true, missing_required: [] },
      crossClientBlocked: false,
      supabase,
    });

    expect(result.score).toBe(0);
    expect(result.factors).toEqual([]);
    expect(result.classification).toBe("low");
    expect(result.recommendation).toBe("auto");
    expect(result.shouldNotify).toBe(false);
  });

  it("medium-risk profile: thin form template + first-time funder — score 30, classification 'medium', recommendation 'assisted'", async () => {
    const supabase = createFakeSupabase({
      funderRelationships: { data: null, error: null },
      givingHistory: { data: [], error: null },
      priorSubmissions: { count: 0, error: null },
    });

    const result = await assessSubmissionRisk({
      funder: { id: "funder-medium", name: "New Regional Foundation", automation_level: "assisted" },
      requestProfile: { request_type: "monetary", min_value: 1000, max_value: 2000 },
      formTemplate: { field_count: 2, has_file_uploads: false, requires_login: false, form_structure: [] },
      orgReadiness: { ready: true, missing_required: [] },
      crossClientBlocked: false,
      supabase,
    });

    expect(result.score).toBe(30);
    expect(result.factors.map((f) => f.name).sort()).toEqual(["first_submission", "low_template_confidence"]);
    expect(result.classification).toBe("medium");
    expect(result.recommendation).toBe("assisted");
    expect(result.shouldNotify).toBe(false);
  });

  it("high-risk profile: login-gated portal, incomplete org, first contact — score 70, classification 'high', recommendation 'manual'", async () => {
    const supabase = createFakeSupabase({
      funderRelationships: { data: null, error: null },
      givingHistory: { data: [], error: null },
      priorSubmissions: { count: 0, error: null },
    });

    const result = await assessSubmissionRisk({
      funder: { id: "funder-high", name: "Locked Portal Corp", automation_level: "assisted" },
      requestProfile: { request_type: "monetary", min_value: 1000, max_value: 2000 },
      formTemplate: { field_count: 2, has_file_uploads: false, requires_login: true, form_structure: [] },
      orgReadiness: { ready: false, missing_required: ["Board member list"] },
      crossClientBlocked: false,
      supabase,
    });

    expect(result.score).toBe(70);
    expect(result.factors.map((f) => f.name).sort()).toEqual([
      "first_submission",
      "low_template_confidence",
      "org_not_ready",
      "requires_login",
    ]);
    expect(result.classification).toBe("high");
    expect(result.recommendation).toBe("manual");
    expect(result.shouldNotify).toBe(true);
  });

  it("critical-risk profile: every factor stacked — raw sum 205 clamps to 100, classification 'critical', recommendation 'manual'", async () => {
    const supabase = createFakeSupabase({
      funderRelationships: { data: null, error: null },
      givingHistory: { data: [{ amount: 5000 }, { amount: 2000 }], error: null },
      priorSubmissions: { count: 0, error: null },
    });

    const result = await assessSubmissionRisk({
      funder: { id: "funder-critical", name: "Manual-Only Corp", automation_level: "manual_only" },
      requestProfile: { request_type: "monetary", min_value: 1000, max_value: 100000 },
      formTemplate: {
        field_count: 1,
        has_file_uploads: true,
        requires_login: true,
        form_structure: [
          { fieldLabel: "reCAPTCHA verification", fieldName: "captcha_token", fieldType: "text" },
          { fieldLabel: "I certify and agree to terms", fieldName: "certify_agree", fieldType: "checkbox" },
        ],
      },
      orgReadiness: { ready: false, missing_required: ["501(c)(3) determination letter", "IRS Form 990"] },
      crossClientBlocked: true,
      supabase,
    });

    const rawSum = result.factors.reduce((sum, f) => sum + f.points, 0);
    expect(rawSum).toBe(205); // proves the clamp actually did something, not a coincidental 100
    expect(result.score).toBe(100);
    expect(result.factors.map((f) => f.name).sort()).toEqual([
      "ask_exceeds_historical_max",
      "captcha_in_template",
      "cross_client_collision",
      "first_submission",
      "legal_attestation_required",
      "low_template_confidence",
      "manual_only_portal",
      "missing_required_documents",
      "org_not_ready",
      "requires_login",
    ]);
    expect(result.classification).toBe("critical");
    expect(result.recommendation).toBe("manual");
    expect(result.shouldNotify).toBe(true);
  });

  it("scores are monotonically increasing across the four profiles (sanity check the banding isn't accidental)", async () => {
    const low = await assessSubmissionRisk({
      funder: { id: "m-low", name: "F", automation_level: "assisted" },
      requestProfile: { request_type: "monetary", max_value: 1000 },
      formTemplate: { field_count: 10, form_structure: [] },
      orgReadiness: { ready: true, missing_required: [] },
      crossClientBlocked: false,
      supabase: createFakeSupabase({
        funderRelationships: { data: { id: "r", max_ask_amount: 5000, total_submissions: 2 }, error: null },
      }),
    });
    const medium = await assessSubmissionRisk({
      funder: { id: "m-medium", name: "F", automation_level: "assisted" },
      requestProfile: { request_type: "monetary", max_value: 1000 },
      formTemplate: { field_count: 1, form_structure: [] },
      orgReadiness: { ready: true, missing_required: [] },
      crossClientBlocked: false,
      supabase: createFakeSupabase({}),
    });
    const high = await assessSubmissionRisk({
      funder: { id: "m-high", name: "F", automation_level: "assisted" },
      requestProfile: { request_type: "monetary", max_value: 1000 },
      formTemplate: { field_count: 1, requires_login: true, form_structure: [] },
      orgReadiness: { ready: false, missing_required: ["x"] },
      crossClientBlocked: false,
      supabase: createFakeSupabase({}),
    });
    const critical = await assessSubmissionRisk({
      funder: { id: "m-critical", name: "F", automation_level: "manual_only" },
      requestProfile: { request_type: "monetary", max_value: 1000 },
      formTemplate: { field_count: 1, requires_login: true, form_structure: [] },
      orgReadiness: { ready: false, missing_required: ["x"] },
      crossClientBlocked: true,
      supabase: createFakeSupabase({}),
    });

    expect(low.score).toBeLessThan(medium.score);
    expect(medium.score).toBeLessThan(high.score);
    expect(high.score).toBeLessThan(critical.score);
  });
});

// ---------------------------------------------------------------------------
// Part 2: live persistence check against the real production database.
// Reproduces worker/queue-processor.ts's exact write (lines ~916-924): on a
// 'manual' recommendation it updates submission_queue.risk_score and
// .risk_factors directly. queue-processor.ts never checks that update's
// `error` field — this test does, so a missing column shows up as a real
// test failure instead of a silent no-op in production.
// ---------------------------------------------------------------------------

(CREDS_AVAILABLE ? describe : describe.skip)(
  "submission_queue.risk_score / risk_factors — live production persistence",
  () => {
    let service: SupabaseClient;
    const orgIds: string[] = [];
    const funderIds: string[] = [];
    const queueItemIds: string[] = [];

    beforeAll(async () => {
      service = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!);
    });

    afterAll(async () => {
      if (!service) return;
      if (queueItemIds.length > 0) {
        try {
          await service.from("submission_queue").delete().in("id", queueItemIds);
        } catch {
          // best-effort cleanup
        }
      }
      if (funderIds.length > 0) {
        try {
          await service.from("funders").delete().in("id", funderIds);
        } catch {
          // best-effort cleanup
        }
      }
      for (const orgId of orgIds) {
        try {
          await service.from("organizations").delete().eq("id", orgId);
        } catch {
          // best-effort cleanup
        }
      }
    });

    it("submission_queue.risk_score and .risk_factors columns exist and are readable", async () => {
      const { error } = await service
        .from("submission_queue")
        .select("id, risk_score, risk_factors")
        .limit(1);

      expect(
        error,
        error
          ? `submission_queue.risk_score/.risk_factors are not queryable on production ` +
            `(${JSON.stringify(error)}). Per migration 052_governance_layer.sql these columns ` +
            `should exist — this means that migration's ALTER TABLE statements for ` +
            `submission_queue were not applied to production, the same gap DEMO_READINESS_AUDIT.md ` +
            `found (and fixed) for funders.automation_level.`
          : undefined,
      ).toBeNull();
    });

    it(
      "a real 'manual' risk assessment, written the way queue-processor.ts writes it, round-trips through the live database",
      async () => {
        const tag = randomSuffix();

        const { data: org, error: orgErr } = await service
          .from("organizations")
          .insert({ name: `AUTOAPPLY_RISK_TEST_${tag}`, onboarding_progress: {} })
          .select()
          .single();
        expect(orgErr, orgErr?.message).toBeNull();
        const orgId = org!.id as string;
        orgIds.push(orgId);

        const { data: funder, error: funderErr } = await service
          .from("funders")
          .insert({
            organization_id: orgId,
            name: `AUTOAPPLY_RISK_TEST_FUNDER_${tag}`,
            category: "private_foundation",
            giving_portal_url: "https://httpbin.org/forms/post",
            automation_level: "manual_only",
          })
          .select()
          .single();
        expect(funderErr, funderErr?.message).toBeNull();
        const funderId = funder!.id as string;
        funderIds.push(funderId);

        const { data: queueItem, error: queueErr } = await service
          .from("submission_queue")
          .insert({ organization_id: orgId, funder_id: funderId, status: "pending" })
          .select()
          .single();
        expect(queueErr, queueErr?.message).toBeNull();
        const queueItemId = queueItem!.id as string;
        queueItemIds.push(queueItemId);

        // Real risk assessment against the real live client — exercises the
        // real (missing) funder_relationships table and the real
        // funder_giving_history / autoapply_submissions tables, proving the
        // engine degrades gracefully against production's actual schema
        // rather than throwing.
        const riskAssessment: RiskAssessment = await assessSubmissionRisk({
          funder: {
            id: funderId,
            name: funder!.name as string,
            automation_level: "manual_only",
            giving_portal_url: "https://httpbin.org/forms/post",
          },
          requestProfile: { request_type: "monetary", min_value: 1000, max_value: 2000 },
          formTemplate: null,
          orgReadiness: { ready: false, missing_required: ["501(c)(3) determination letter"] },
          crossClientBlocked: false,
          supabase: service,
        });

        expect(riskAssessment.recommendation).toBe("manual");
        expect(riskAssessment.score).toBeGreaterThan(0);
        expect(riskAssessment.factors.length).toBeGreaterThan(0);

        // The exact write queue-processor.ts performs on the 'manual' route.
        const { error: writeErr } = await service
          .from("submission_queue")
          .update({
            automation_mode: "manual",
            status: "pending_manual",
            risk_score: riskAssessment.score,
            risk_factors: riskAssessment.factors,
          })
          .eq("id", queueItemId);

        expect(
          writeErr,
          writeErr
            ? `writing risk_score/risk_factors to submission_queue failed on production: ` +
              `${JSON.stringify(writeErr)}. This is the exact write worker/queue-processor.ts ` +
              `performs at its 'manual' route (queue-processor.ts:916-924) — that code never checks ` +
              `this error, so in production this failure is currently silent.`
            : undefined,
        ).toBeNull();

        // Read back from a fresh query — proves persistence, not just that
        // the update call returned 200 with a stale/cached body.
        const { data: reread, error: rereadErr } = await service
          .from("submission_queue")
          .select("risk_score, risk_factors, status, automation_mode")
          .eq("id", queueItemId)
          .single();

        expect(rereadErr, rereadErr?.message).toBeNull();
        expect(reread!.risk_score).toBe(riskAssessment.score);
        expect(reread!.risk_factors).toEqual(riskAssessment.factors);
        expect(reread!.status).toBe("pending_manual");
        expect(reread!.automation_mode).toBe("manual");
      },
      30000,
    );
  },
);

if (!CREDS_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[autoapply-risk-scoring.test] live persistence suite skipped — .env.local is missing " +
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
  );
}
