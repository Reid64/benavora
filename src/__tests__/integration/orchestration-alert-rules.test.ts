import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import dotenv from "dotenv";

/**
 * AR-6.3: deterministic Postgres triggers (migration 191) that raise
 * public.alerts rows off real orchestration_logs / cost_budgets writes — no
 * meta-agent, no LLM call, no interpretive summary anywhere in the path.
 * This suite exercises the real, live triggers against the real database,
 * the same pattern every other file in this directory already uses (no
 * separate test Supabase project — .env.test points at a stack that is not
 * running). Every row created here is deleted in afterAll via try/catch
 * (not `.catch()`), per project memory
 * (benavora-integration-test-catch-bug-leaks-prod-rows).
 *
 * ASSERTION 4's negative case and ASSERTION 6 are the two the AR-6.3 prompt
 * explicitly warned are the most likely to be quietly dropped — both are
 * kept:
 *   - 4b proves Rule 4 (state_drift) was built as a DB-reconciliation check,
 *     not as the spec-section-8 STATE_OF_THE_BUILD.md diff — a governance
 *     markdown file changing raises nothing, because nothing in this
 *     trigger stack ever reads a file.
 *   - 6 proves the blast-radius contract: an unexpected condition inside a
 *     rule's own trigger function (a non-numeric retry_count) is swallowed,
 *     not propagated — the INSERT that fired it must still succeed.
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

(CREDS_AVAILABLE ? describe : describe.skip)(
  "Orchestration alert rules (AR-6.3) — real Postgres triggers, one case per rule",
  () => {
    let service: SupabaseClient;
    const tag = randomSuffix();
    const orgIds: string[] = [];
    const logRowIds: string[] = [];

    beforeAll(() => {
      service = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    });

    afterAll(async () => {
      if (!service) return;
      if (logRowIds.length > 0) {
        try {
          await service.from("orchestration_logs").delete().in("id", logRowIds);
        } catch {
          // best-effort cleanup
        }
      }
      if (orgIds.length > 0) {
        // ai_usage_log and alerts have no ON DELETE CASCADE from
        // organizations — must be cleared before the parent row, same as
        // budget-accrual.test.ts. cost_budgets and orchestration_logs do
        // cascade (migrations 158/190) but are deleted explicitly above/
        // below anyway rather than relying on it.
        try {
          await service.from("ai_usage_log").delete().in("organization_id", orgIds);
        } catch {
          // best-effort cleanup
        }
        try {
          await service.from("alerts").delete().in("organization_id", orgIds);
        } catch {
          // best-effort cleanup
        }
        try {
          await service.from("cost_budgets").delete().in("organization_id", orgIds);
        } catch {
          // best-effort cleanup
        }
        try {
          await service.from("platform_config").delete().in("organization_id", orgIds);
        } catch {
          // best-effort cleanup
        }
        try {
          await service.from("organizations").delete().in("id", orgIds);
        } catch {
          // best-effort cleanup
        }
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

    async function insertLog(row: Record<string, unknown>) {
      const { data, error } = await service
        .from("orchestration_logs")
        .insert(row)
        .select("id")
        .single();
      if (data?.id) logRowIds.push(data.id as string);
      return { data, error };
    }

    async function alertsFor(orgId: string, type: string) {
      const { data, error } = await service
        .from("alerts")
        .select("id, type, severity, dedup_key, orchestration_id")
        .eq("organization_id", orgId)
        .eq("type", type);
      expect(error, error?.message).toBeNull();
      return data ?? [];
    }

    it(
      "ASSERTION 1: Rule 1 raises exactly one task_failed alert on a terminal failure; a second identical failure does not duplicate it (uq_alerts_org_dedup proof)",
      async () => {
        const orgId = await createOrg(`ALERT_RULE1_${tag}`);
        const orchestrationId = crypto.randomUUID();

        const failedRow = {
          organization_id: orgId,
          orchestration_id: orchestrationId,
          task_id: "draft_generation",
          agent_type: "draft_generation",
          status: "failed",
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          error_code: "step_error",
          error_message: "Claude API returned 529 after 3 retries.",
          schema_validation_passed: false,
        };

        const { error: err1 } = await insertLog(failedRow);
        expect(err1, err1?.message).toBeNull();

        // A second, independent failure event for the same orchestration +
        // agent — e.g. a retry that also failed — must dedup to the same
        // alert row, not create a second one.
        const { error: err2 } = await insertLog(failedRow);
        expect(err2, err2?.message).toBeNull();

        const alerts = await alertsFor(orgId, "task_failed");
        expect(alerts.length).toBe(1);
        expect(alerts[0]!.severity).toBe("critical"); // no retry context -> always the last (only) attempt
      },
      30000,
    );

    it(
      "ASSERTION 2: Rule 2 raises cost_overage at the limit ('warning'), and 'critical' when hard_stop",
      async () => {
        const orgWarn = await createOrg(`ALERT_RULE2_WARN_${tag}`);
        const { error: budgetWarnErr } = await service.from("cost_budgets").insert({
          organization_id: orgWarn,
          scope_type: "org",
          scope_id: orgWarn,
          budget_period: "monthly",
          budget_limit_usd: 10,
          spent_usd: 0,
          hard_stop: false,
        });
        expect(budgetWarnErr, budgetWarnErr?.message).toBeNull();

        const { error: costWarnErr } = await service.from("ai_usage_log").insert({
          organization_id: orgWarn,
          model: "claude-test",
          endpoint: "model_tokens",
          cost_usd: 10, // exactly at the limit
        });
        expect(costWarnErr, costWarnErr?.message).toBeNull();

        const warnAlerts = await alertsFor(orgWarn, "cost_overage");
        expect(warnAlerts.length).toBe(1);
        expect(warnAlerts[0]!.severity).toBe("warning");

        const orgCrit = await createOrg(`ALERT_RULE2_CRIT_${tag}`);
        const { error: budgetCritErr } = await service.from("cost_budgets").insert({
          organization_id: orgCrit,
          scope_type: "org",
          scope_id: orgCrit,
          budget_period: "monthly",
          budget_limit_usd: 5,
          spent_usd: 0,
          hard_stop: true,
        });
        expect(budgetCritErr, budgetCritErr?.message).toBeNull();

        const { error: costCritErr } = await service.from("ai_usage_log").insert({
          organization_id: orgCrit,
          model: "claude-test",
          endpoint: "model_tokens",
          cost_usd: 6,
        });
        expect(costCritErr, costCritErr?.message).toBeNull();

        const critAlerts = await alertsFor(orgCrit, "cost_overage");
        expect(critAlerts.length).toBe(1);
        expect(critAlerts[0]!.severity).toBe("critical");
      },
      30000,
    );

    it(
      "ASSERTION 3: Rule 3 raises schema_mismatch (critical) on schema_validation_passed = false",
      async () => {
        const orgId = await createOrg(`ALERT_RULE3_${tag}`);
        const orchestrationId = crypto.randomUUID();

        const { error } = await insertLog({
          organization_id: orgId,
          orchestration_id: orchestrationId,
          task_id: "opportunity_discovery",
          agent_type: "opportunity_discovery",
          status: "completed",
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          schema_validation_passed: false,
        });
        expect(error, error?.message).toBeNull();

        const alerts = await alertsFor(orgId, "schema_mismatch");
        expect(alerts.length).toBe(1);
        expect(alerts[0]!.severity).toBe("critical");
      },
      30000,
    );

    it(
      "ASSERTION 4a: Rule 4 raises state_drift when a completed step's items_processed disagrees with the rows actually present",
      async () => {
        const orgId = await createOrg(`ALERT_RULE4A_${tag}`);
        const orchestrationId = crypto.randomUUID();

        // items_processed > items_expected is structurally incoherent no
        // matter the business logic (you cannot act on more candidates than
        // were ever found) — unlike items_processed < items_expected, which
        // is the ordinary, healthy shape all over
        // worker/autonomous-orchestrator.ts ("12/50 opportunity(ies)
        // scored") and must NOT raise this alert (see the sibling
        // "healthy under-processing" case below).
        const { error } = await insertLog({
          organization_id: orgId,
          orchestration_id: orchestrationId,
          task_id: "donor_enrichment",
          agent_type: "donor_enrichment",
          status: "completed",
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          schema_validation_passed: true,
          items_expected: 5,
          items_processed: 9, // more than were ever found
        });
        expect(error, error?.message).toBeNull();

        const alerts = await alertsFor(orgId, "state_drift");
        expect(alerts.length).toBe(1);
        expect(alerts[0]!.severity).toBe("critical");
      },
      30000,
    );

    it(
      "ASSERTION 4a-negative: Rule 4 raises NOTHING when a completed step processes fewer items than were found — the ordinary, healthy shape",
      async () => {
        const orgId = await createOrg(`ALERT_RULE4A_NEG_${tag}`);
        const orchestrationId = crypto.randomUUID();

        const { error } = await insertLog({
          organization_id: orgId,
          orchestration_id: orchestrationId,
          task_id: "fundability_scorer",
          agent_type: "fundability_scorer",
          status: "completed",
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          schema_validation_passed: true,
          items_expected: 50, // candidates found
          items_processed: 12, // candidates actually scored — the rest already handled/filtered
        });
        expect(error, error?.message).toBeNull();

        const alerts = await alertsFor(orgId, "state_drift");
        expect(alerts.length).toBe(0);
      },
      30000,
    );

    it(
      "ASSERTION 4b: Rule 4 raises NOTHING when a governance markdown file changes — proves it was not built as the spec's STATE_OF_THE_BUILD.md diff",
      async () => {
        const orgId = await createOrg(`ALERT_RULE4B_${tag}`);
        const orchestrationId = crypto.randomUUID();

        // Simulate the exact scenario spec section 8 would have flagged as
        // drift: a governance doc changing "around" a task's execution.
        // Uses a throwaway fixture file, not the repo's real
        // STATE_OF_THE_BUILD.md, so this test has no side effect on it.
        const fixturePath = path.join(os.tmpdir(), `benavora-ar63-governance-fixture-${tag}.md`);
        fs.writeFileSync(fixturePath, "# STATE OF THE BUILD (before)\n");
        const before = fs.readFileSync(fixturePath, "utf8");

        fs.writeFileSync(fixturePath, "# STATE OF THE BUILD (after)\n\nA build agent recorded a legitimate governance update here.\n");
        const after = fs.readFileSync(fixturePath, "utf8");
        expect(after).not.toBe(before); // the file genuinely changed

        try {
          // A normal, non-contradictory completion recorded around that
          // same file change.
          const { error } = await insertLog({
            organization_id: orgId,
            orchestration_id: orchestrationId,
            task_id: "governance_update",
            agent_type: "governance_update",
            status: "completed",
            started_at: new Date().toISOString(),
            finished_at: new Date().toISOString(),
            schema_validation_passed: true,
            items_expected: 1,
            items_processed: 1,
          });
          expect(error, error?.message).toBeNull();

          const alerts = await alertsFor(orgId, "state_drift");
          expect(alerts.length).toBe(0);
        } finally {
          fs.unlinkSync(fixturePath);
        }
      },
      30000,
    );

    it(
      "ASSERTION 5: Rule 5 raises timeout (warning) on a step whose duration_ms exceeds the 60s threshold",
      async () => {
        const orgId = await createOrg(`ALERT_RULE5_${tag}`);
        const orchestrationId = crypto.randomUUID();

        const { error } = await insertLog({
          organization_id: orgId,
          orchestration_id: orchestrationId,
          task_id: "reputation_scan",
          agent_type: "reputation_scan",
          status: "completed",
          started_at: new Date(Date.now() - 90_000).toISOString(),
          finished_at: new Date().toISOString(),
          duration_ms: 90_000, // > 60_000ms AGENT_TIMEOUT_MS
          schema_validation_passed: true,
        });
        expect(error, error?.message).toBeNull();

        const alerts = await alertsFor(orgId, "timeout");
        expect(alerts.length).toBe(1);
        expect(alerts[0]!.severity).toBe("warning");
      },
      30000,
    );

    it(
      "ASSERTION 6: a trigger hitting an unexpected condition does not fail the underlying INSERT (blast-radius proof)",
      async () => {
        const orgId = await createOrg(`ALERT_RULE6_${tag}`);
        const orchestrationId = crypto.randomUUID();

        // state_delta.retry_count is deliberately non-numeric — Rule 1's
        // `NULLIF(state_delta->>'retry_count','')::int` cast throws inside
        // the trigger. If the trigger's EXCEPTION WHEN OTHERS handler is
        // ever removed, this INSERT starts failing.
        const { data, error } = await insertLog({
          organization_id: orgId,
          orchestration_id: orchestrationId,
          task_id: "malformed_retry_context",
          agent_type: "malformed_retry_context",
          status: "failed",
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          error_code: "step_error",
          error_message: "boom",
          schema_validation_passed: false,
          state_delta: { retry_count: "not-a-number", max_retries: 3 },
        });

        expect(error, error?.message).toBeNull();
        expect(data?.id).toBeTruthy();
      },
      30000,
    );
  },
);

if (!CREDS_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[orchestration-alert-rules.test] skipped entirely — .env.local is missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
  );
}
