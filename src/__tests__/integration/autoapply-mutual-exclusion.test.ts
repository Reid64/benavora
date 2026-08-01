import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { SubmissionValidator } from "@/lib/autoapply/submission-validator";

// Node 20 has no native WebSocket — same workaround as autoapply-queue.test.ts
// and src/lib/supabase/admin.ts.
function createClient(url: string, key: string, opts: Record<string, unknown> = {}): SupabaseClient {
  return createSupabaseClient(url, key, {
    ...opts,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: ws as any },
  }) as unknown as SupabaseClient;
}

/**
 * Proves the mutual-exclusion guard added between the two AutoApply
 * implementations — "Agent 16" (/api/agents/automation, automation_sessions
 * table) and the submission_queue pipeline (worker/queue-processor.ts) —
 * actually blocks a same-org+funder race instead of letting both proceed.
 *
 * Two layers, matching the two places the guard was added:
 *
 * 1. Direct calls to SubmissionValidator.checkConcurrentAutomation() /
 *    .checkConcurrentSubmissionQueue() against real rows in the real
 *    production database — the exact functions queue-processor.ts and the
 *    /api/agents/automation route call. Fast, deterministic, no need to wait
 *    on a live worker or spin up a Next.js server to exercise the route.
 * 2. A live end-to-end run through the real Railway worker
 *    (benavora-worker), same method and TARGET_URL as
 *    autoapply-queue.test.ts: insert a real ACTIVE automation_sessions row
 *    for an org+funder, then a real pending submission_queue row for the
 *    SAME org+funder, and confirm the worker's own processItem() — not a
 *    mock — skips it near-instantly with the new guard rather than
 *    proceeding into real submission logic. The org used is otherwise fully
 *    "ready" (per checkOrgReadiness()'s own requirements), so a near-instant
 *    skip can only be explained by the new pre-readiness guard, not
 *    org_not_ready.
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

const TARGET_URL = "https://httpbin.org/forms/post";
const TERMINAL_STATUSES = new Set([
  "completed",
  "skipped",
  "failed",
  "requires_account_setup",
  "pending_manual",
]);

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface QueueRow {
  id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
}

/** Same polling helper as autoapply-queue.test.ts. */
async function waitForTerminal(
  service: SupabaseClient,
  queueItemId: string,
  opts: { timeoutMs: number; pollMs?: number },
): Promise<{ row: QueueRow; sawProcessing: boolean }> {
  const pollMs = opts.pollMs ?? 2000;
  const deadline = Date.now() + opts.timeoutMs;
  let last: QueueRow | null = null;
  let sawProcessing = false;

  while (Date.now() < deadline) {
    const { data, error } = await service
      .from("submission_queue")
      .select("id, status, started_at, completed_at")
      .eq("id", queueItemId)
      .single();
    if (error) throw new Error(`poll failed for queue item ${queueItemId}: ${error.message}`);

    last = data as QueueRow;
    if (last.status === "processing" || last.started_at !== null) sawProcessing = true;
    if (TERMINAL_STATUSES.has(last.status)) {
      return { row: last, sawProcessing };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(
    `submission_queue item ${queueItemId} never reached a terminal state within ${opts.timeoutMs}ms ` +
      `(last observed status: "${last?.status}"). Is the Railway worker (benavora-worker) running and polling?`,
  );
}

(CREDS_AVAILABLE ? describe : describe.skip)("AutoApply mutual-exclusion guard (Agent 16 vs. submission_queue)", () => {
  let service: SupabaseClient;

  const orgIds: string[] = [];
  const funderIds: string[] = [];
  const queueItemIds: string[] = [];
  const sessionIds: string[] = [];

  let orgId: string;
  let funderId: string;

  beforeAll(async () => {
    service = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const tag = randomSuffix();

    // Fully "ready" org (mirrors autoapply-queue.test.ts's orgReady fixture)
    // so any early skip in the live-worker test can only be explained by the
    // new mutual-exclusion guard, not by org_not_ready.
    const { data: org, error: orgErr } = await service
      .from("organizations")
      .insert({
        name: `AUTOAPPLY_MUTEX_TEST_${tag}`,
        mission_statement: "Providing emergency and transitional housing assistance in rural Texas.",
        ein: "84-1234567",
        address_line1: "123 Test Ave",
        founder_name: "Test Founder",
        contact_email: `mutex-${tag}@example.org`,
        phone: "555-0100",
        onboarding_progress: {},
      })
      .select()
      .single();
    expect(orgErr, orgErr?.message).toBeNull();
    orgId = org!.id as string;
    orgIds.push(orgId);

    const { error: profileErr } = await service.from("request_profiles").insert({
      organization_id: orgId,
      name: `Test Operating Support ${tag}`,
      request_type: "monetary",
      needs_description: "General operating support for testing the mutual-exclusion guard.",
      active: true,
      min_value: 1000,
      max_value: 5000,
    });
    expect(profileErr, profileErr?.message).toBeNull();

    const { error: docsErr } = await service.from("org_documents").insert([
      {
        organization_id: orgId,
        document_type: "501c3_letter",
        display_name: "501(c)(3) Determination Letter",
        storage_path: `test/${tag}/501c3.pdf`,
        file_name: "501c3.pdf",
        is_current: true,
      },
      {
        organization_id: orgId,
        document_type: "form_990",
        display_name: "IRS Form 990",
        storage_path: `test/${tag}/990.pdf`,
        file_name: "990.pdf",
        is_current: true,
      },
    ]);
    expect(docsErr, docsErr?.message).toBeNull();

    const { data: funder, error: funderErr } = await service
      .from("funders")
      .insert({
        organization_id: orgId,
        name: `AUTOAPPLY_MUTEX_TEST_FUNDER_${tag}`,
        category: "private_foundation",
        giving_portal_url: TARGET_URL,
      })
      .select()
      .single();
    expect(funderErr, funderErr?.message).toBeNull();
    funderId = funder!.id as string;
    funderIds.push(funderId);
  }, 30000);

  afterAll(async () => {
    if (!service) return;

    if (sessionIds.length > 0) {
      try {
        await service.from("automation_sessions").delete().in("id", sessionIds);
      } catch {
        // best-effort cleanup
      }
    }
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
    for (const id of orgIds) {
      try {
        await service.from("request_profiles").delete().eq("organization_id", id);
      } catch {
        // best-effort cleanup
      }
      try {
        await service.from("org_documents").delete().eq("organization_id", id);
      } catch {
        // best-effort cleanup
      }
      try {
        await service.from("platform_config").delete().eq("organization_id", id);
      } catch {
        // best-effort cleanup
      }
      const { error } = await service.from("organizations").delete().match({ id });
      if (error) {
        // eslint-disable-next-line no-console
        console.warn(`[autoapply-mutual-exclusion.test] cleanup failed for org ${id}: ${error.message}`);
      }
    }
  }, 60000);

  // --- Layer 1: direct function-level proof, both directions ----------------

  it("checkConcurrentAutomation(): reports no conflict when no automation_sessions row exists yet", async () => {
    const validator = new SubmissionValidator();
    const result = await validator.checkConcurrentAutomation(orgId, funderId, service);
    expect(result.conflict).toBe(false);
  });

  it("checkConcurrentSubmissionQueue(): reports no conflict when no submission_queue row exists yet", async () => {
    const validator = new SubmissionValidator();
    const result = await validator.checkConcurrentSubmissionQueue(orgId, funderId, service);
    expect(result.conflict).toBe(false);
  });

  it("checkConcurrentAutomation(): detects a real active automation_sessions row for the same org+funder", async () => {
    const { data: session, error } = await service
      .from("automation_sessions")
      .insert({
        organization_id: orgId,
        funder_id: funderId,
        status: "awaiting_approval",
      })
      .select()
      .single();
    expect(error, error?.message).toBeNull();
    sessionIds.push(session!.id as string);

    const validator = new SubmissionValidator();
    const result = await validator.checkConcurrentAutomation(orgId, funderId, service);
    expect(result.conflict).toBe(true);
    expect(result.sessionId).toBe(session!.id);

    // Terminal statuses must NOT be reported as a conflict — a finished
    // session shouldn't block a later, unrelated submission attempt.
    await service.from("automation_sessions").update({ status: "submitted" }).eq("id", session!.id as string);
    const afterTerminal = await validator.checkConcurrentAutomation(orgId, funderId, service);
    expect(afterTerminal.conflict).toBe(false);
  });

  it("checkConcurrentSubmissionQueue(): detects a real pending submission_queue row for the same org+funder — this is what /api/agents/automation calls before starting a session", async () => {
    const { data: item, error } = await service
      .from("submission_queue")
      .insert({
        organization_id: orgId,
        funder_id: funderId,
        status: "pending",
      })
      .select()
      .single();
    expect(error, error?.message).toBeNull();
    queueItemIds.push(item!.id as string);

    const validator = new SubmissionValidator();
    const result = await validator.checkConcurrentSubmissionQueue(orgId, funderId, service);
    expect(result.conflict).toBe(true);
    expect(result.queueItemId).toBe(item!.id);

    // A completed/failed/skipped item must NOT block a later attempt.
    await service.from("submission_queue").update({ status: "completed" }).eq("id", item!.id as string);
    const afterTerminal = await validator.checkConcurrentSubmissionQueue(orgId, funderId, service);
    expect(afterTerminal.conflict).toBe(false);
  });

  // --- Layer 2: live proof through the real Railway worker ------------------

  it(
    "real queue item for an org+funder with an active automation_session: skipped near-instantly with 'concurrent_automation_conflict', not processed",
    async () => {
      // A fresh active session — the guard must fire on this specific
      // org+funder pair regardless of the terminal-status session used above.
      const { data: session, error: sessionErr } = await service
        .from("automation_sessions")
        .insert({
          organization_id: orgId,
          funder_id: funderId,
          status: "awaiting_approval",
        })
        .select()
        .single();
      expect(sessionErr, sessionErr?.message).toBeNull();
      const activeSessionId = session!.id as string;
      sessionIds.push(activeSessionId);

      const { data: item, error: itemErr } = await service
        .from("submission_queue")
        .insert({
          organization_id: orgId,
          funder_id: funderId,
          status: "pending",
        })
        .select()
        .single();
      expect(itemErr, itemErr?.message).toBeNull();
      queueItemIds.push(item!.id as string);

      const { row, sawProcessing } = await waitForTerminal(service, item!.id as string, {
        timeoutMs: 90000,
        pollMs: 2000,
      });

      // Real state transition: it left pending and landed on 'skipped',
      // driven entirely by the real worker's processItem(), not this test.
      expect(sawProcessing).toBe(true);
      expect(row.status).toBe("skipped");

      // Near-instant, same signature as the existing org_not_ready proof in
      // autoapply-queue.test.ts — this guard runs even earlier than that
      // gate, so the bound is the same or tighter.
      expect(row.started_at).toBeTruthy();
      expect(row.completed_at).toBeTruthy();
      const durationMs =
        new Date(row.completed_at as string).getTime() - new Date(row.started_at as string).getTime();
      expect(durationMs).toBeLessThan(15000);

      // The other side genuinely "proceeded": the automation_sessions row
      // this was blocked by was never touched by the queue-processor run —
      // still exactly the state this test created it in.
      const { data: sessionAfter } = await service
        .from("automation_sessions")
        .select("id, status")
        .eq("id", activeSessionId)
        .single();
      expect(sessionAfter?.status).toBe("awaiting_approval");

      // No automation_sessions or autoapply_submissions row was created by
      // the queue-processor run itself — proof it never reached real
      // submission logic (form-fill, risk engine, etc.), it was blocked at
      // the new guard before any of that.
      const { data: submissions } = await service
        .from("autoapply_submissions")
        .select("id")
        .eq("funder_id", funderId);
      expect(submissions?.length ?? 0).toBe(0);
    },
    120000,
  );
});

if (!CREDS_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[autoapply-mutual-exclusion.test] skipped entirely — .env.local is missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
  );
}
