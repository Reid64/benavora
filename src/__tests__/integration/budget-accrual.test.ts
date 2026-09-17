import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

import { checkBudget, BudgetExceededError } from "@/lib/pil/cost";

/**
 * AR-5.2: budget enforcement was decorative -- cost_budgets.spent_usd (the
 * table was pil_cost_budgets before migration 187) was READ by checkBudget()
 * and two agents but WRITTEN by nothing, so remaining was always the full
 * limit and hard_stop could never fire. Migration 187 adds
 * ai_usage_log_accrue_cost_budget, an AFTER INSERT trigger on ai_usage_log
 * (the single cost ledger as of migration 185/186) that increments the
 * matching org-scope budget row's spent_usd. This suite asserts that trigger
 * actually fires against the real, live database -- not a mock.
 *
 * Runs against the real project configured in `.env.local` (no separate test
 * Supabase project -- matches every other suite in this directory).
 * `tests/setup.ts` loads `.env.test` globally for the default suite, which
 * points `NEXT_PUBLIC_SUPABASE_URL` at `http://localhost:54321` and carries
 * no service-role key -- wrong for both this file's own Supabase client and
 * for checkBudget()'s internal `createAdminClient()` call (which reads
 * `process.env` directly). Both are overridden below from `.env.local`
 * before any test runs, the same pattern
 * `autoapply-submit-integrity.test.ts` uses for `ANTHROPIC_API_KEY`.
 *
 * Every row created here is deleted in `afterAll` via try/catch (not
 * `.catch()`), per project memory
 * (benavora-integration-test-catch-bug-leaks-prod-rows).
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

// checkBudget() -> getPilClient() -> createAdminClient() reads
// SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from
// process.env directly, which tests/setup.ts has already pointed at
// .env.test's local-Supabase placeholder by the time this file runs.
if (SUPABASE_URL) process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
if (SERVICE_ROLE_KEY) process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

(CREDS_AVAILABLE ? describe : describe.skip)(
  "Budget accrual (AR-5.2) — real ai_usage_log -> cost_budgets trigger, real checkBudget()",
  () => {
    let service: SupabaseClient;
    const tag = randomSuffix();
    const orgIds: string[] = [];

    beforeAll(() => {
      service = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    });

    afterAll(async () => {
      if (!service || orgIds.length === 0) return;
      // ai_usage_log.organization_id has no ON DELETE CASCADE (migration 056)
      // -- must be cleared before the parent organizations rows, unlike
      // cost_budgets (ON DELETE CASCADE, migration 158), which is deleted
      // explicitly anyway rather than relying on the cascade. platform_config
      // is auto-inserted by a DB trigger on organizations insert (discovered
      // live: deleting organizations first fails with
      // platform_config_organization_id_fkey) and likewise has no cascade.
      try {
        await service.from("ai_usage_log").delete().in("organization_id", orgIds);
      } catch {
        // best-effort cleanup
      }
      try {
        await service.from("platform_config").delete().in("organization_id", orgIds);
      } catch {
        // best-effort cleanup
      }
      try {
        await service.from("cost_budgets").delete().in("organization_id", orgIds);
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
        .insert({
          name,
          mission_statement: "Providing emergency and transitional housing assistance in rural Texas.",
          onboarding_progress: {},
        })
        .select()
        .single();
      expect(error, error?.message).toBeNull();
      const id = data!.id as string;
      orgIds.push(id);
      return id;
    }

    it(
      "ASSERTION 1: inserting a cost row raises spent_usd on the matching budget row by exactly the cost amount",
      async () => {
        const orgId = await createOrg(`BUDGET_ACCRUAL_1_${tag}`);

        const { error: budgetErr } = await service.from("cost_budgets").insert({
          organization_id: orgId,
          scope_type: "org",
          scope_id: orgId,
          budget_period: "monthly",
          budget_limit_usd: 100,
          spent_usd: 0,
          hard_stop: false,
        });
        expect(budgetErr, budgetErr?.message).toBeNull();

        const { error: costErr } = await service.from("ai_usage_log").insert({
          organization_id: orgId,
          model: "claude-test",
          endpoint: "model_tokens",
          cost_usd: 12.34,
        });
        expect(costErr, costErr?.message).toBeNull();

        const { data: budget, error: readErr } = await service
          .from("cost_budgets")
          .select("spent_usd")
          .eq("organization_id", orgId)
          .eq("scope_type", "org")
          .eq("scope_id", orgId)
          .single();
        expect(readErr, readErr?.message).toBeNull();
        expect(Number(budget!.spent_usd)).toBeCloseTo(12.34, 6);
      },
      30000,
    );

    it(
      "ASSERTION 2: with hard_stop true and the limit exhausted, checkBudget throws BudgetExceededError",
      async () => {
        const orgId = await createOrg(`BUDGET_ACCRUAL_2_${tag}`);

        const { error: budgetErr } = await service.from("cost_budgets").insert({
          organization_id: orgId,
          scope_type: "org",
          scope_id: orgId,
          budget_period: "monthly",
          budget_limit_usd: 10,
          spent_usd: 0,
          hard_stop: true,
        });
        expect(budgetErr, budgetErr?.message).toBeNull();

        const { error: costErr } = await service.from("ai_usage_log").insert({
          organization_id: orgId,
          model: "claude-test",
          endpoint: "model_tokens",
          cost_usd: 15,
        });
        expect(costErr, costErr?.message).toBeNull();

        await expect(checkBudget(orgId)).rejects.toBeInstanceOf(BudgetExceededError);
      },
      30000,
    );

    it(
      "ASSERTION 3: a cost row for an org with no budget row inserts cleanly and raises nothing",
      async () => {
        const orgId = await createOrg(`BUDGET_ACCRUAL_3_${tag}`);

        const { error: costErr } = await service.from("ai_usage_log").insert({
          organization_id: orgId,
          model: "claude-test",
          endpoint: "model_tokens",
          cost_usd: 5,
        });
        expect(costErr, costErr?.message).toBeNull();

        const { data: budgets, error: readErr } = await service
          .from("cost_budgets")
          .select("*")
          .eq("organization_id", orgId);
        expect(readErr, readErr?.message).toBeNull();
        expect(budgets).toEqual([]);

        const result = await checkBudget(orgId);
        expect(result).toEqual({ allowed: true, remaining_usd: Infinity, hard_stop: false });
      },
      30000,
    );

    it(
      "ASSERTION 4: an 'orchestration' scope budget can be created and checked",
      async () => {
        const orgId = await createOrg(`BUDGET_ACCRUAL_4_${tag}`);
        const scopeId = `orchestration-run-${tag}`;

        const { error: budgetErr } = await service.from("cost_budgets").insert({
          organization_id: orgId,
          scope_type: "orchestration",
          scope_id: scopeId,
          budget_period: "per_run",
          budget_limit_usd: 5,
          spent_usd: 4.99,
          hard_stop: true,
        });
        expect(budgetErr, budgetErr?.message).toBeNull();

        const result = await checkBudget(orgId, "orchestration", scopeId);
        expect(result.allowed).toBe(true);
        expect(result.hard_stop).toBe(true);
        expect(result.remaining_usd).toBeCloseTo(0.01, 6);

        // The trigger only accrues the 'org' scope (per AR-5.2's spec) -- an
        // 'orchestration' row never receives ai_usage_log spend automatically,
        // so a mismatched scope_id must still read as unconfigured, not as
        // this org's real orchestration budget.
        const unconfigured = await checkBudget(orgId, "orchestration", "no-such-scope");
        expect(unconfigured).toEqual({ allowed: true, remaining_usd: Infinity, hard_stop: false });
      },
      30000,
    );
  },
);

if (!CREDS_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[budget-accrual.test] skipped entirely — .env.local is missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
  );
}
