import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

// Node 20 has no native WebSocket; mirrors the workaround in
// src/lib/supabase/admin.ts and every other live suite in this directory —
// without it, supabase-js's realtime client (constructed eagerly by
// createClient regardless of whether it's used) throws immediately.
function createClient(url: string, key: string, opts: Record<string, unknown> = {}): SupabaseClient {
  return createSupabaseClient(url, key, {
    ...opts,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: ws as any },
  }) as unknown as SupabaseClient;
}

/**
 * AR-12.1 — live, DB-level coverage for autoapply_queue_processor's
 * funder_not_found skip and its root cause: FunderDetail.tsx's delete button
 * deletes a funder with no awareness of pending submission_queue rows
 * pointing at it (submission_queue_funder_id_fkey is ON DELETE SET NULL, not
 * a block). Migration 200 adds a BEFORE DELETE trigger on `funders` that
 * cancels dependent submission_queue rows terminally and raises a
 * manual_review_required alert *before* the delete completes — this suite
 * exercises that trigger directly against production schema/RLS, the same
 * way DEMO_READINESS_AUDIT.md's live suites do, rather than mocking Postgres.
 *
 * No separate test Supabase project exists (`.env.test` points at a stack
 * that isn't running, matching every other suite here) — this runs against
 * the real database, scoped to disposable org/funder/queue rows cleaned up
 * in `afterAll`.
 */

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

// The exact column list worker/queue-processor.ts's processItem() selects
// from `funders` (line ~690) — kept in sync deliberately so this test proves
// the real lookup shape resolves, not a stand-in query.
const FUNDER_LOOKUP_COLUMNS = "id, name, giving_portal_url, contact_email, category, type, automation_level";

(CREDS_AVAILABLE ? describe : describe.skip)("AutoApply queue funder resolution (AR-12.1, live)", () => {
  let service: SupabaseClient;
  let anon: SupabaseClient;

  const orgIds: string[] = [];
  const funderIds: string[] = [];
  const queueItemIds: string[] = [];

  let orgId: string;
  let validFunderId: string;

  beforeAll(async () => {
    service = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    anon = createClient(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const tag = randomSuffix();

    const { data: org, error: orgErr } = await service
      .from("organizations")
      .insert({ name: `AR121_TEST_ORG_${tag}` })
      .select()
      .single();
    expect(orgErr, orgErr?.message).toBeNull();
    orgId = org!.id as string;
    orgIds.push(orgId);

    const { data: funder, error: funderErr } = await service
      .from("funders")
      .insert({
        organization_id: orgId,
        name: `AR121_TEST_FUNDER_${tag}`,
        category: "private_foundation",
        giving_portal_url: "https://httpbin.org/forms/post",
      })
      .select()
      .single();
    expect(funderErr, funderErr?.message).toBeNull();
    validFunderId = funder!.id as string;
    funderIds.push(validFunderId);
  }, 30000);

  afterAll(async () => {
    if (!service) return;

    // Best-effort, deepest-first — try/catch (not .catch()) per project
    // memory (benavora-integration-test-catch-bug-leaks-prod-rows): chaining
    // .catch() on this pinned supabase-js version's PostgrestFilterBuilder
    // throws synchronously instead of suppressing a rejection, aborting
    // cleanup partway through.
    if (queueItemIds.length > 0) {
      try {
        await service.from("submission_queue").delete().in("id", queueItemIds);
      } catch {
        // best-effort cleanup
      }
    }
    try {
      await service.from("alerts").delete().eq("organization_id", orgId);
    } catch {
      // best-effort cleanup
    }
    if (funderIds.length > 0) {
      try {
        await service.from("funders").delete().in("id", funderIds);
      } catch {
        // best-effort cleanup
      }
    }
    for (const id of orgIds) {
      try {
        await service.from("platform_config").delete().eq("organization_id", id);
      } catch {
        // best-effort cleanup
      }
      const { error } = await service.from("organizations").delete().match({ id });
      if (error) {
        // eslint-disable-next-line no-console
        console.warn(`[queue-funder-resolution.test] cleanup failed for org ${id}: ${error.message}`);
      }
    }
  }, 60000);

  it("a queue item with a valid funder_id resolves via the service-role lookup queue-processor.ts uses", async () => {
    const { data, error } = await service
      .from("funders")
      .select(FUNDER_LOOKUP_COLUMNS)
      .eq("id", validFunderId)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect((data as { id: string }).id).toBe(validFunderId);
    expect((data as { name: string | null }).name).toContain("AR121_TEST_FUNDER_");
  });

  it("deleting a funder with a pending queue item cancels it terminally (migration 200) instead of leaving it to retry forever", async () => {
    const tag = randomSuffix();
    const { data: doomedFunder, error: doomedFunderErr } = await service
      .from("funders")
      .insert({
        organization_id: orgId,
        name: `AR121_TEST_DOOMED_FUNDER_${tag}`,
        category: "private_foundation",
        giving_portal_url: "https://httpbin.org/forms/post",
      })
      .select()
      .single();
    expect(doomedFunderErr, doomedFunderErr?.message).toBeNull();
    const doomedFunderId = doomedFunder!.id as string;

    const { data: queueItem, error: queueItemErr } = await service
      .from("submission_queue")
      .insert({
        organization_id: orgId,
        funder_id: doomedFunderId,
        status: "pending",
      })
      .select()
      .single();
    expect(queueItemErr, queueItemErr?.message).toBeNull();
    const queueItemId = queueItem!.id as string;
    queueItemIds.push(queueItemId);

    // The moment of the bug this migration closes: deleting the funder while
    // its queue item is still 'pending'. No separate worker poll cycle is
    // needed — the BEFORE DELETE trigger runs synchronously as part of this
    // statement, so the queue row is already terminal by the time the delete
    // returns.
    const { error: deleteErr } = await service.from("funders").delete().eq("id", doomedFunderId);
    expect(deleteErr, deleteErr?.message).toBeNull();
    // Trigger already ran (BEFORE DELETE) — funderIds cleanup list must not
    // include this id, deleting it again in afterAll would be a harmless no-op
    // but there is nothing left to delete.

    const { data: settledItem, error: settledErr } = await service
      .from("submission_queue")
      .select("status, error_message, completed_at")
      .eq("id", queueItemId)
      .single();
    expect(settledErr, settledErr?.message).toBeNull();
    expect(settledItem!.status).toBe("skipped");
    expect(settledItem!.error_message).toContain("funder_deleted");
    expect(settledItem!.completed_at).not.toBeNull();

    // Must not retry: the worker's poll query only ever selects
    // status='pending' (worker/queue-processor.ts) — confirm this row no
    // longer matches that predicate.
    const { data: pendingMatch } = await service
      .from("submission_queue")
      .select("id")
      .eq("id", queueItemId)
      .eq("status", "pending")
      .maybeSingle();
    expect(pendingMatch).toBeNull();

    // And an operator-visible alert was raised, not just a silent DB flip.
    const { data: alertRow, error: alertErr } = await service
      .from("alerts")
      .select("type, severity, message, dedup_key")
      .eq("organization_id", orgId)
      .eq("dedup_key", `orchestration:manual_review_required:${queueItemId}`)
      .maybeSingle();
    expect(alertErr, alertErr?.message).toBeNull();
    expect(alertRow).not.toBeNull();
    expect(alertRow!.type).toBe("manual_review_required");
    expect(alertRow!.severity).toBe("warning");
    expect(alertRow!.message).toContain(queueItemId);
    expect(alertRow!.message).toContain(`AR121_TEST_DOOMED_FUNDER_${tag}`);
  }, 30000);

  it("an RLS-restricted read of a real funder returns empty, not an error — proving why the worker must use the service-role client", async () => {
    // Same row, same lookup shape as processItem() uses — but through the
    // anon key instead of service role. funders_org_isolation's RLS policy
    // (organization_id = current_org_id()) has no session to resolve
    // current_org_id() from here, so every row is filtered out: this must
    // come back empty, not an error — exactly the shape that, if the worker
    // ever used a non-admin client here, would be silently indistinguishable
    // from the funder genuinely not existing.
    const { data, error } = await anon
      .from("funders")
      .select(FUNDER_LOOKUP_COLUMNS)
      .eq("id", validFunderId)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).toBeNull();

    // The row genuinely exists — service role (the client queue-processor.ts
    // actually uses, via src/lib/supabase/admin.ts's createAdminClient())
    // still sees it. Same id, opposite result: the RLS-empty result above is
    // provably NOT the same fact as "this funder does not exist".
    const { data: adminData, error: adminError } = await service
      .from("funders")
      .select(FUNDER_LOOKUP_COLUMNS)
      .eq("id", validFunderId)
      .maybeSingle();
    expect(adminError).toBeNull();
    expect(adminData).not.toBeNull();
  });
});

if (!CREDS_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[queue-funder-resolution.test] skipped entirely — .env.local is missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );
}
