import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

import { pollOnce, formatSlackMessage } from "../../../worker/alert-notifier";

/**
 * AR-6.4 Part A/C — worker-side Slack delivery for critical alerts, and the
 * five RLS-safe dashboard views (migration 193).
 *
 * Runs against the real project in `.env.local`, the same pattern every
 * other suite in this directory uses (no separate test Supabase project).
 * Every row created here is deleted in `afterAll` via try/catch (not
 * `.catch()`), per project memory
 * (benavora-integration-test-catch-bug-leaks-prod-rows).
 *
 * FORGE_SLACK_WEBHOOK and global fetch are stubbed per-test (never a real
 * network call to Slack) — delivery-idempotency logic (notified_at) is real
 * against the live `alerts` table; only the outbound HTTP leg is mocked.
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
const ANON_KEY = localEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const CREDS_AVAILABLE = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && ANON_KEY);

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

// supabase-js's own PostgREST/GoTrue calls also go through global fetch, so a
// blanket fetch mock breaks the service client the test itself depends on
// (and, worse, a single reused Response object gets its body consumed twice
// across the two callers). This wraps global fetch, answering only requests
// to `webhookUrl` from `handler` and passing every other request through to
// the real fetch untouched.
function mockWebhookFetch(
  webhookUrl: string,
  handler: (init: RequestInit | undefined) => Response | Promise<Response>,
): { spy: ReturnType<typeof vi.spyOn>; callCount: () => number } {
  const realFetch = globalThis.fetch.bind(globalThis);
  let calls = 0;
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
    if (url === webhookUrl) {
      calls += 1;
      return handler(init);
    }
    return realFetch(input as Parameters<typeof fetch>[0], init);
  });
  return { spy, callCount: () => calls };
}

(CREDS_AVAILABLE ? describe : describe.skip)(
  "Alert delivery (AR-6.4) — worker Slack notifier + dashboard view RLS",
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
      try {
        await service.from("orchestration_logs").delete().in("organization_id", orgIds);
      } catch {
        // best-effort cleanup
      }
      try {
        await service.from("ai_usage_log").delete().in("organization_id", orgIds);
      } catch {
        // best-effort cleanup
      }
      try {
        await service.from("cost_budgets").delete().in("organization_id", orgIds);
      } catch {
        // best-effort cleanup
      }
      try {
        await service.from("alerts").delete().in("organization_id", orgIds);
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

    async function insertCriticalAlert(orgId: string, message: string): Promise<string> {
      const { data, error } = await service
        .from("alerts")
        .insert({
          organization_id: orgId,
          type: "system",
          severity: "critical",
          message,
          dedup_key: `alert-delivery-test-${tag}-${randomSuffix()}`,
        })
        .select("id")
        .single();
      expect(error, error?.message).toBeNull();
      return data!.id as string;
    }

    async function notifiedAtOf(alertId: string): Promise<string | null> {
      const { data, error } = await service
        .from("alerts")
        .select("notified_at")
        .eq("id", alertId)
        .single();
      expect(error, error?.message).toBeNull();
      return (data!.notified_at as string | null) ?? null;
    }

    describe("Slack delivery", () => {
      const ORIGINAL_WEBHOOK = process.env.FORGE_SLACK_WEBHOOK;

      beforeEach(() => {
        vi.restoreAllMocks();
      });

      afterEach(() => {
        if (ORIGINAL_WEBHOOK === undefined) {
          delete process.env.FORGE_SLACK_WEBHOOK;
        } else {
          process.env.FORGE_SLACK_WEBHOOK = ORIGINAL_WEBHOOK;
        }
      });

      it(
        "ASSERTION 1: with FORGE_SLACK_WEBHOOK unset, the notifier no-ops and sets no notified_at",
        async () => {
          const orgId = await createOrg(`ALERT_DELIVERY_1_${tag}`);
          const alertId = await insertCriticalAlert(orgId, "unset-webhook case");

          delete process.env.FORGE_SLACK_WEBHOOK;
          const fetchSpy = vi.spyOn(globalThis, "fetch");

          await pollOnce(service, { organizationId: orgId });

          expect(fetchSpy).not.toHaveBeenCalled();
          expect(await notifiedAtOf(alertId)).toBeNull();
        },
        30000,
      );

      it(
        "ASSERTION 2: a non-2xx response leaves notified_at NULL so the alert retries",
        async () => {
          const orgId = await createOrg(`ALERT_DELIVERY_2_${tag}`);
          const alertId = await insertCriticalAlert(orgId, "non-2xx case");

          const webhookUrl = "https://hooks.slack.test/services/FAKE";
          process.env.FORGE_SLACK_WEBHOOK = webhookUrl;
          mockWebhookFetch(webhookUrl, () => new Response("server error", { status: 500 }));

          await pollOnce(service, { organizationId: orgId });

          expect(await notifiedAtOf(alertId)).toBeNull();

          // Must also survive a second poll pass unchanged — this is the
          // one that keeps AR-6.4 from losing alerts: a transient Slack
          // outage must never look like "delivered".
          await pollOnce(service, { organizationId: orgId });
          expect(await notifiedAtOf(alertId)).toBeNull();
        },
        30000,
      );

      it(
        "ASSERTION 3: a 2xx response sets notified_at exactly once, and a second poll sends nothing",
        async () => {
          const orgId = await createOrg(`ALERT_DELIVERY_3_${tag}`);
          const alertId = await insertCriticalAlert(orgId, "success case");

          const webhookUrl = "https://hooks.slack.test/services/FAKE";
          process.env.FORGE_SLACK_WEBHOOK = webhookUrl;
          const { callCount } = mockWebhookFetch(webhookUrl, () => new Response("ok", { status: 200 }));

          await pollOnce(service, { organizationId: orgId });

          const firstNotifiedAt = await notifiedAtOf(alertId);
          expect(firstNotifiedAt).not.toBeNull();
          expect(callCount()).toBe(1);

          await pollOnce(service, { organizationId: orgId });

          expect(callCount()).toBe(1); // no second send
          expect(await notifiedAtOf(alertId)).toBe(firstNotifiedAt); // unchanged
        },
        30000,
      );

      it(
        "ASSERTION 4: a message containing an API-key-shaped value is posted redacted",
        async () => {
          const orgId = await createOrg(`ALERT_DELIVERY_4_${tag}`);
          const secret = "sk-ant-api03-THISLOOKSLIKEALIVEKEY1234567890abcdEFGH";
          const alertId = await insertCriticalAlert(
            orgId,
            `Claude call failed with key ${secret} rejected by upstream`,
          );

          const webhookUrl = "https://hooks.slack.test/services/FAKE";
          process.env.FORGE_SLACK_WEBHOOK = webhookUrl;
          let postedBody = "";
          mockWebhookFetch(webhookUrl, (init) => {
            postedBody = String(init?.body ?? "");
            return new Response("ok", { status: 200 });
          });

          await pollOnce(service, { organizationId: orgId });

          expect(await notifiedAtOf(alertId)).not.toBeNull();
          expect(postedBody).not.toContain(secret);
          expect(postedBody).toContain("[REDACTED]");
        },
        30000,
      );

      it("formatSlackMessage redacts secrets independent of delivery (unit-level sanity check)", () => {
        const secret = "sk-ant-api03-anothersecretvalue1234567890";
        const text = formatSlackMessage({
          id: "x",
          organization_id: "org-1",
          type: "system",
          severity: "critical",
          message: `token=${secret}`,
          link: null,
          orchestration_id: null,
          created_at: new Date().toISOString(),
        });
        expect(text).not.toContain(secret);
        expect(text).toContain("[REDACTED]");
      });
    });

    describe("Rate card freshness (migration 192)", () => {
      it("no seeded model_cost_reference row is older than 180 days — a stale rate card is worse than none, because it gets trusted", async () => {
        const { data, error } = await service
          .from("model_cost_reference")
          .select("model, effective_from");
        expect(error, error?.message).toBeNull();
        expect(data!.length).toBeGreaterThan(0);

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 180);

        for (const row of data as { model: string; effective_from: string }[]) {
          const effectiveFrom = new Date(row.effective_from);
          expect(
            effectiveFrom.getTime(),
            `${row.model}: effective_from ${row.effective_from} is older than 180 days`,
          ).toBeGreaterThanOrEqual(cutoff.getTime());
        }
      });
    });

    describe("Dashboard view RLS (migration 193)", () => {
      const VIEWS = [
        "v_orchestration_run_summary",
        "v_orchestration_daily_cost",
        "v_alert_activity_summary",
        "v_budget_utilization",
        "v_agent_reliability",
      ] as const;

      it(
        "ASSERTION 5: each dashboard view is declared security_invoker = true, and returns zero rows for a different organization",
        async () => {
          // --- declaration check, via the service-role-only introspection
          // RPC (migration 194) — PostgREST exposes no pg_catalog access,
          // and this suite may not open a raw DATABASE_URL connection.
          for (const view of VIEWS) {
            const { data, error } = await service.rpc("debug_view_is_security_invoker", {
              p_view_name: view,
            });
            expect(error, `${view}: ${error?.message}`).toBeNull();
            expect(data, `${view} must be security_invoker = true`).toBe(true);
          }

          // --- behavioral cross-tenant check: seed real rows in org B's
          // underlying tables, then read the views as an authenticated user
          // who belongs to org A only, filtered to org B's id. A
          // security_definer view (the PG15+ default) would leak these rows
          // straight through; security_invoker = true makes each base
          // table's own RLS policy apply per-row instead.
          const orgAId = await createOrg(`ALERT_DELIVERY_RLS_A_${tag}`);
          const orgBId = await createOrg(`ALERT_DELIVERY_RLS_B_${tag}`);

          const emailA = `alert-delivery-rls-a-${tag}@benavora-rls-test.local`;
          const passwordA = `AlertRls_${randomSuffix()}_Aa1!`;
          const { data: authA, error: authAErr } = await service.auth.admin.createUser({
            email: emailA,
            password: passwordA,
            email_confirm: true,
          });
          expect(authAErr, authAErr?.message).toBeNull();
          const userAId = authA!.user!.id;

          const { error: profAErr } = await service
            .from("profiles")
            .upsert({ id: userAId, organization_id: orgAId, email: emailA, role: "owner" });
          expect(profAErr, profAErr?.message).toBeNull();

          const userAClient = createClient(SUPABASE_URL!, ANON_KEY!, {
            auth: { autoRefreshToken: false, persistSession: false },
          });
          const { error: signInErr } = await userAClient.auth.signInWithPassword({
            email: emailA,
            password: passwordA,
          });
          expect(signInErr, signInErr?.message).toBeNull();

          try {
            const orchestrationId = crypto.randomUUID();
            const { error: logErr } = await service.from("orchestration_logs").insert({
              organization_id: orgBId,
              orchestration_id: orchestrationId,
              task_id: "rls_view_probe",
              agent_type: "rls_view_probe",
              status: "completed",
              started_at: new Date().toISOString(),
              finished_at: new Date().toISOString(),
              duration_ms: 500,
              schema_validation_passed: true,
            });
            expect(logErr, logErr?.message).toBeNull();

            const { error: budgetErr } = await service.from("cost_budgets").insert({
              organization_id: orgBId,
              scope_type: "org",
              scope_id: orgBId,
              budget_period: "monthly",
              budget_limit_usd: 100,
              spent_usd: 0,
              hard_stop: false,
            });
            expect(budgetErr, budgetErr?.message).toBeNull();

            const { error: usageErr } = await service.from("ai_usage_log").insert({
              organization_id: orgBId,
              model: "claude-test",
              endpoint: "model_tokens",
              cost_usd: 5,
              input_tokens: 100,
              output_tokens: 50,
              agent_type: "rls_view_probe",
            });
            expect(usageErr, usageErr?.message).toBeNull();

            const { error: alertErr } = await service.from("alerts").insert({
              organization_id: orgBId,
              type: "system",
              severity: "warning",
              message: "rls view probe",
              dedup_key: `alert-delivery-rls-view-${tag}`,
            });
            expect(alertErr, alertErr?.message).toBeNull();

            // Sanity: service role (bypasses RLS) really does see the rows —
            // otherwise a zero-rows result below would prove nothing.
            const { data: serviceCheck, error: serviceCheckErr } = await service
              .from("v_orchestration_run_summary")
              .select("orchestration_id")
              .eq("organization_id", orgBId);
            expect(serviceCheckErr, serviceCheckErr?.message).toBeNull();
            expect(serviceCheck!.length).toBeGreaterThan(0);

            for (const view of VIEWS) {
              const { data, error } = await userAClient
                .from(view)
                .select("organization_id")
                .eq("organization_id", orgBId);
              expect(error, `${view}: ${error?.message}`).toBeNull();
              expect(data, `${view} must return zero rows for a foreign org`).toEqual([]);
            }
          } finally {
            try {
              await service.from("profiles").delete().eq("id", userAId);
            } catch {
              // best-effort cleanup
            }
            try {
              await service.auth.admin.deleteUser(userAId);
            } catch {
              // best-effort cleanup
            }
          }
        },
        60000,
      );
    });
  },
);

if (!CREDS_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[alert-delivery.test] skipped entirely — .env.local is missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );
}
