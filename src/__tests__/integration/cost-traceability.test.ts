import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

import {
  priceUsage,
  computeCostUsd,
  priceApiCall,
  pilBlendedTokenRateUsd,
  PIL_AGENT_MODEL,
} from "@/lib/pil/model-pricing";
import { recordCost } from "@/lib/pil/cost";

/**
 * AR-10.1 — proves the closing gap in AR-6.4/AR-9.2's cost work: a dollar
 * figure recorded in ai_usage_log must trace back to a dated, sourced
 * model_cost_reference row, not a hardcoded per-file constant. Runs against
 * the real project in `.env.local`, same pattern as alert-delivery.test.ts
 * (no separate test Supabase project). Rows created here are deleted in
 * `afterAll` via try/catch (not `.catch()`), per project memory
 * (benavora-integration-test-catch-bug-leaks-prod-rows).
 *
 * priceUsage()/computeCostUsd()/pilBlendedTokenRateUsd() call
 * createAdminClient() internally, which reads SUPABASE_URL/
 * NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY from process.env
 * directly -- tests/setup.ts has already pointed those at .env.test's
 * local-Supabase placeholder by the time this file runs, same as
 * budget-accrual.test.ts's checkBudget() dependency. Overridden from
 * .env.local below before any test runs.
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

if (SUPABASE_URL) process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
if (SERVICE_ROLE_KEY) process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

const UNSEEDED_MODEL = `ar-10-1-test-unseeded-model-${randomSuffix()}`;
const UNSEEDED_CONNECTOR = `ar-10-2-test-unseeded-connector-${randomSuffix()}`;

(CREDS_AVAILABLE ? describe : describe.skip)(
  "Cost traceability (AR-10.1) — ai_usage_log rows trace to a dated, sourced rate",
  () => {
    let service: SupabaseClient;
    const orgIds: string[] = [];

    beforeAll(() => {
      service = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    });

    afterAll(async () => {
      if (!service || orgIds.length === 0) return;
      try {
        await service.from("ai_usage_log").delete().in("organization_id", orgIds);
      } catch {
        // best-effort cleanup
      }
      try {
        await service.from("organizations").delete().in("id", orgIds);
      } catch {
        // best-effort cleanup
      }
    });

    async function createOrg(name: string): Promise<string> {
      const { data, error } = await service
        .from("organizations")
        .insert({ name, onboarding_progress: {} })
        .select()
        .single();
      expect(error, error?.message).toBeNull();
      const id = data!.id as string;
      orgIds.push(id);
      return id;
    }

    it("resolves a seeded model's rate directly from model_cost_reference (not a hardcoded constant)", async () => {
      const { data, error } = await service
        .from("model_cost_reference")
        .select("input_usd_per_mtok, output_usd_per_mtok, effective_from, source")
        .eq("model", "claude-sonnet-4-6")
        .single();
      expect(error, error?.message).toBeNull();
      expect(data!.effective_from).toBeTruthy();
      expect(data!.source).toBeTruthy();

      const result = await priceUsage("claude-sonnet-4-6", 1_000_000, 1_000_000);
      expect(result.priced).toBe(true);
      if (!result.priced) throw new Error("unreachable");
      expect(result.effectiveFrom).toBe(data!.effective_from);
      expect(result.source).toBe(data!.source);
      expect(result.costUsd).toBeCloseTo(
        Number(data!.input_usd_per_mtok) + Number(data!.output_usd_per_mtok),
        6,
      );
    });

    it("a recorded ai_usage_log row's cost matches the resolver's live computation for the same tokens, and traces to the rate card's effective_from/source", async () => {
      const orgId = await createOrg(`AR-10.1 traceability ${randomSuffix()}`);
      const inputTokens = 200_000;
      const outputTokens = 50_000;

      const priced = await priceUsage("claude-sonnet-4-6", inputTokens, outputTokens);
      expect(priced.priced).toBe(true);
      if (!priced.priced) throw new Error("unreachable");

      await recordCost({
        organization_id: orgId,
        model: "claude-sonnet-4-6",
        endpoint: "cost-traceability-test",
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
        cost_usd: priced.costUsd,
        duration_ms: 1000,
        agent_type: null,
        agent_run_id: null,
        pil_agent_run_id: null,
        provider: "anthropic",
        billing_path: "api",
      });

      const { data: row, error } = await service
        .from("ai_usage_log")
        .select("model, cost_usd, input_tokens, output_tokens")
        .eq("organization_id", orgId)
        .eq("endpoint", "cost-traceability-test")
        .single();
      expect(error, error?.message).toBeNull();

      const { data: rateRow, error: rateError } = await service
        .from("model_cost_reference")
        .select("input_usd_per_mtok, output_usd_per_mtok, effective_from, source")
        .eq("model", row!.model)
        .single();
      expect(rateError, rateError?.message).toBeNull();

      const expectedCost =
        (row!.input_tokens / 1_000_000) * Number(rateRow!.input_usd_per_mtok) +
        (row!.output_tokens / 1_000_000) * Number(rateRow!.output_usd_per_mtok);
      expect(Number(row!.cost_usd)).toBeCloseTo(expectedCost, 6);
      expect(rateRow!.effective_from).toBeTruthy();
      expect(rateRow!.source).toBeTruthy();
    });

    it("an unknown model never resolves to a silent 0 — computeCostUsd returns null and priceUsage returns priced:false", async () => {
      const cost = await computeCostUsd(UNSEEDED_MODEL, 1000, 1000);
      expect(cost).toBeNull();

      const result = await priceUsage(UNSEEDED_MODEL, 1000, 1000);
      expect(result.priced).toBe(false);
      expect(result.costUsd).toBeNull();
    });

    it("an ai_usage_log row for an unpriced model carries cost_usd: null, never a fabricated 0", async () => {
      const orgId = await createOrg(`AR-10.1 unpriced ${randomSuffix()}`);
      const costUsd = await computeCostUsd(UNSEEDED_MODEL, 5000, 5000);
      expect(costUsd).toBeNull();

      await recordCost({
        organization_id: orgId,
        model: UNSEEDED_MODEL,
        endpoint: "cost-traceability-test-unpriced",
        input_tokens: 5000,
        output_tokens: 5000,
        total_tokens: 10000,
        cost_usd: costUsd,
        duration_ms: 500,
        agent_type: null,
        agent_run_id: null,
        pil_agent_run_id: null,
        provider: "anthropic",
        billing_path: "api",
      });

      const { data: row, error } = await service
        .from("ai_usage_log")
        .select("cost_usd")
        .eq("organization_id", orgId)
        .eq("endpoint", "cost-traceability-test-unpriced")
        .single();
      expect(error, error?.message).toBeNull();
      expect(row!.cost_usd).toBeNull();
    });

    it("the PIL agent framework's blended token rate resolves from the same table as the precise resolver (no second hardcoded constant)", async () => {
      const { data: rateRow, error } = await service
        .from("model_cost_reference")
        .select("input_usd_per_mtok, output_usd_per_mtok")
        .eq("model", PIL_AGENT_MODEL)
        .single();
      expect(error, error?.message).toBeNull();

      const blended = await pilBlendedTokenRateUsd();
      expect(blended).not.toBeNull();
      const expected =
        (Number(rateRow!.input_usd_per_mtok) + Number(rateRow!.output_usd_per_mtok)) / 2 / 1_000_000;
      expect(blended!).toBeCloseTo(expected, 10);
    });

    it("AR-10.2: prices a non-LLM connector call via model_cost_reference's pricing_unit='call' rows, and the recorded ai_usage_log row traces to it", async () => {
      const { data: rateRow, error } = await service
        .from("model_cost_reference")
        .select("pricing_unit, usd_per_call, effective_from, source")
        .eq("model", "google_places")
        .single();
      expect(error, error?.message).toBeNull();
      expect(rateRow!.pricing_unit).toBe("call");
      expect(Number(rateRow!.usd_per_call)).toBeGreaterThan(0);

      const requestsMade = 3;
      const priced = await priceApiCall("google_places", requestsMade);
      expect(priced.priced).toBe(true);
      if (!priced.priced) throw new Error("unreachable");
      expect(priced.costUsd).toBeCloseTo(requestsMade * Number(rateRow!.usd_per_call), 6);
      expect(priced.effectiveFrom).toBe(rateRow!.effective_from);
      expect(priced.source).toBe(rateRow!.source);

      const orgId = await createOrg(`AR-10.2 connector-call ${randomSuffix()}`);
      await recordCost({
        organization_id: orgId,
        model: "google_places",
        endpoint: "cost-traceability-test-connector-call",
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        cost_usd: priced.costUsd,
        duration_ms: null,
        agent_type: null,
        agent_run_id: null,
        pil_agent_run_id: null,
        provider: "google_places",
        billing_path: "api",
      });

      const { data: row, error: rowError } = await service
        .from("ai_usage_log")
        .select("cost_usd, provider, input_tokens, output_tokens")
        .eq("organization_id", orgId)
        .eq("endpoint", "cost-traceability-test-connector-call")
        .single();
      expect(rowError, rowError?.message).toBeNull();
      expect(row!.input_tokens).toBe(0);
      expect(row!.output_tokens).toBe(0);
      expect(row!.provider).toBe("google_places");
      expect(Number(row!.cost_usd)).toBeCloseTo(requestsMade * Number(rateRow!.usd_per_call), 6);
    });

    it("AR-10.2: a connector with no model_cost_reference row (Apollo/Hunter today) resolves to an explicit unpriced null, never a fabricated $0", async () => {
      const priced = await priceApiCall(UNSEEDED_CONNECTOR, 1);
      expect(priced.priced).toBe(false);
      expect(priced.costUsd).toBeNull();
    });

    it("the resolver's cached value matches the table on repeated calls (per-process cache, not a re-fetch mismatch)", async () => {
      const first = await priceUsage("claude-sonnet-4-6", 100_000, 100_000);
      const second = await priceUsage("claude-sonnet-4-6", 100_000, 100_000);
      expect(first.priced && second.priced).toBe(true);
      if (!first.priced || !second.priced) throw new Error("unreachable");
      expect(second.costUsd).toBeCloseTo(first.costUsd, 10);
      expect(second.effectiveFrom).toBe(first.effectiveFrom);
      expect(second.source).toBe(first.source);
    });
  },
);
