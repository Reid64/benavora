import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

import { logOrchestrationStep } from "@/lib/orchestration/orchestration-log";

/**
 * AR-6.2: orchestration_logs (migration 190) is the execution-facts table
 * for one step of one orchestration run — org-scoped via organization_id
 * (this platform has 146 organization_id columns and zero company_id; see
 * the migration header). This suite exercises the real, live database, the
 * same pattern every other file in this directory already uses (no separate
 * test Supabase project — .env.test points at a stack that isn't running).
 * Assertion 4 (RLS) is explicitly required to run against the real DB, not
 * a mock — mirrors rls.test.ts's real-auth-user approach.
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

(CREDS_AVAILABLE ? describe : describe.skip)(
  "orchestration_logs (AR-6.2) — real writer, real RLS",
  () => {
    let service: SupabaseClient;
    const tag = randomSuffix();
    const orgIds: string[] = [];
    const userIds: string[] = [];
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
      for (const userId of userIds) {
        try {
          await service.from("profiles").delete().match({ id: userId });
        } catch {
          // best-effort cleanup
        }
        try {
          await service.auth.admin.deleteUser(userId);
        } catch {
          // best-effort cleanup
        }
      }
      for (const orgId of orgIds) {
        try {
          await service.from("platform_config").delete().match({ organization_id: orgId });
        } catch {
          // best-effort cleanup
        }
        try {
          await service.from("organizations").delete().match({ id: orgId });
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

    it(
      "ASSERTION 1: logOrchestrationStep() writes a row with the correct organization_id and a resolvable orchestration_id",
      async () => {
        const orgId = await createOrg(`ORCH_LOG_1_${tag}`);
        const orchestrationId = crypto.randomUUID();

        const result = await logOrchestrationStep(service, {
          organizationId: orgId,
          orchestrationId,
          taskId: "discovery",
          agentType: "opportunity_discovery",
          status: "completed",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          itemsExpected: 5,
          itemsProcessed: 5,
          schemaValidationPassed: true,
        });
        expect(result.ok, JSON.stringify(result)).toBe(true);
        if (!result.ok) return;
        logRowIds.push(result.id);

        const { data: row, error } = await service
          .from("orchestration_logs")
          .select("*")
          .eq("id", result.id)
          .single();
        expect(error, error?.message).toBeNull();
        expect(row!.organization_id).toBe(orgId);
        expect(row!.orchestration_id).toBe(orchestrationId);
        expect(row!.task_id).toBe("discovery");
        expect(row!.status).toBe("completed");
      },
      30000,
    );

    it(
      "ASSERTION 2: a step that fails records status plus error_code, and schema_validation_passed is false — not null",
      async () => {
        const orgId = await createOrg(`ORCH_LOG_2_${tag}`);
        const orchestrationId = crypto.randomUUID();

        const result = await logOrchestrationStep(service, {
          organizationId: orgId,
          orchestrationId,
          taskId: "draft_generation",
          status: "failed",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          errorCode: "step_error",
          errorMessage: "Claude API returned 529 after 3 retries.",
          schemaValidationPassed: false,
        });
        expect(result.ok, JSON.stringify(result)).toBe(true);
        if (!result.ok) return;
        logRowIds.push(result.id);

        const { data: row, error } = await service
          .from("orchestration_logs")
          .select("*")
          .eq("id", result.id)
          .single();
        expect(error, error?.message).toBeNull();
        expect(row!.status).toBe("failed");
        expect(row!.error_code).toBe("step_error");
        expect(row!.schema_validation_passed).toBe(false);
        expect(row!.schema_validation_passed).not.toBeNull();
      },
      30000,
    );

    it(
      "ASSERTION 3: an error_message containing a value shaped like an API key is persisted redacted",
      async () => {
        const orgId = await createOrg(`ORCH_LOG_3_${tag}`);
        const orchestrationId = crypto.randomUUID();
        const fakeKey = "sk-ant-api03-THIS_IS_A_FAKE_TEST_KEY_1234567890abcdefgh";
        const rawMessage = `Anthropic call failed: invalid key ${fakeKey} rejected by upstream.`;

        const result = await logOrchestrationStep(service, {
          organizationId: orgId,
          orchestrationId,
          taskId: "reputation",
          status: "failed",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          errorCode: "step_error",
          errorMessage: rawMessage,
          schemaValidationPassed: false,
        });
        expect(result.ok, JSON.stringify(result)).toBe(true);
        if (!result.ok) return;
        logRowIds.push(result.id);

        const { data: row, error } = await service
          .from("orchestration_logs")
          .select("error_message")
          .eq("id", result.id)
          .single();
        expect(error, error?.message).toBeNull();
        expect(row!.error_message as string).not.toContain(fakeKey);
        expect(row!.error_message as string).toContain("[REDACTED]");
      },
      30000,
    );

    it(
      "ASSERTION 4: RLS blocks reading another organization's orchestration_logs rows",
      async () => {
        const orgAId = await createOrg(`ORCH_LOG_4A_${tag}`);
        const orgBId = await createOrg(`ORCH_LOG_4B_${tag}`);

        const passwordA = `OrchTest_${randomSuffix()}_Aa1!`;
        const emailA = `orch-log-test-${tag}@benavora-rls-test.local`;

        const { data: authA, error: authAErr } = await service.auth.admin.createUser({
          email: emailA,
          password: passwordA,
          email_confirm: true,
        });
        expect(authAErr, authAErr?.message).toBeNull();
        const userAId = authA!.user!.id;
        userIds.push(userAId);

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

        const orchestrationId = crypto.randomUUID();
        const result = await logOrchestrationStep(service, {
          organizationId: orgBId,
          orchestrationId,
          taskId: "discovery",
          status: "completed",
          startedAt: new Date().toISOString(),
          schemaValidationPassed: true,
        });
        expect(result.ok, JSON.stringify(result)).toBe(true);
        if (!result.ok) return;
        logRowIds.push(result.id);

        // Service role (bypasses RLS) can see it -- sanity check the row is real.
        const { data: viaService } = await service
          .from("orchestration_logs")
          .select("id")
          .eq("id", result.id)
          .maybeSingle();
        expect(viaService?.id).toBe(result.id);

        // User A (org A) must NOT see org B's row.
        const { data: viaUserA, error: userAReadErr } = await userAClient
          .from("orchestration_logs")
          .select("id")
          .eq("id", result.id);
        expect(userAReadErr, userAReadErr?.message).toBeNull();
        expect((viaUserA ?? []).length).toBe(0);
      },
      30000,
    );
  },
);

if (!CREDS_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[orchestration-logs.test] skipped entirely — .env.local is missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );
}
