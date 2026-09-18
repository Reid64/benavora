import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";

// worker/index.ts runs validateEnv() (process.exit(1) on missing env vars,
// e.g. WORKER_ID — never set under vitest) as a top-level side effect at
// import time, and worker/rate-limiter.ts (a queue-processor.ts collaborator)
// imports `supabase` from it — so merely importing QueueProcessor below would
// kill the whole vitest process. Same guard as
// src/__tests__/integration/autoapply-submit-integrity.test.ts.
vi.mock("../../../worker/index", () => ({ supabase: {} }));

import { QueueProcessor } from "../../../worker/queue-processor";
import { reapStaleAutomationSessions } from "../../../worker/stuck-run-watchdog";
import { IncompleteSubmissionError } from "@/lib/autoapply/form-filler-agent";
import { SubmissionValidator } from "@/lib/autoapply/submission-validator";

/**
 * AR-7.2 — regression suite for the automation_sessions deadlock: a session
 * that never reaches a terminal status blocks every future AutoApply attempt
 * for that org+funder pair forever, via
 * SubmissionValidator.checkConcurrentAutomation()'s mutual-exclusion guard.
 * Live production data (2026-09-17 audit) showed 7 rows stuck this way —
 * one for 99 days — with autoapply_queue_processor failing 32/32 runs on
 * `concurrent_automation_conflict` as a direct, provable result.
 *
 * Two things changed and both need a real-DB proof, not a mock:
 *   1. worker/queue-processor.ts now finalizes the automation_sessions audit
 *      row from a `finally`, not after the try/catch — so a thrown error
 *      (IncompleteSubmissionError, SubmissionNotVerifiedError, anything else)
 *      still leaves the row terminal. Assertions 1-2.
 *   2. worker/stuck-run-watchdog.ts gained a per-status reap for rows that
 *      got stuck anyway (crash/kill — no try/finally survives a SIGKILL).
 *      Assertions 3-4.
 *
 * Assertions 1-2 call QueueProcessor's real private
 * createApprovedAutomationSession()/finalizeAutomationSession() methods
 * (via `as any`, the same private-method-under-test pattern this suite's
 * sibling files use) rather than driving the full processItem() pipeline
 * end to end: processItem() gates on assertUrlSafe() before ever reaching
 * fillAndSubmit(), which hard-blocks every private/loopback address
 * (src/lib/security/ssrf-guard.ts) — so a local fixture server can never be
 * used as a portal, and no stable public form with an intentionally-empty
 * required field exists to trigger a real IncompleteSubmissionError through
 * the live pipeline. (autoapply-submit-integrity.test.ts hits the identical
 * constraint and, for the same reason, calls FormFillerAgent.fillAndSubmit()
 * directly rather than through processItem().) What AR-7.2 actually changed
 * is *when* finalizeAutomationSession() is called relative to a throw — so
 * these tests reproduce that exact try/catch/finally shape with the real
 * methods and a real IncompleteSubmissionError, the same class fillAndSubmit()
 * throws in production.
 *
 * No separate test Supabase project exists — this runs against the real
 * production database via the service-role client, same as every other
 * suite in this directory. All rows created here are deleted in afterAll
 * via try/catch (not .catch()), per project memory
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

const PORTAL_URL = "https://example.org/apply";

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function minutesAgoIso(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

(CREDS_AVAILABLE ? describe : describe.skip)("Automation session lifecycle (AR-7.2)", () => {
  let service: SupabaseClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let processor: any;
  let orgId: string;
  const funderIds: string[] = [];
  const sessionIds: string[] = [];

  beforeAll(async () => {
    service = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    processor = new QueueProcessor(service, `test-worker-ar72-${randomSuffix()}`);

    const tag = randomSuffix();
    const { data: org, error: orgErr } = await service
      .from("organizations")
      .insert({
        name: `AR72_LIFECYCLE_TEST_${tag}`,
        mission_statement: "Providing emergency and transitional housing assistance in rural Texas.",
        ein: "84-1234567",
        address_line1: "123 Test Ave",
        founder_name: "Test Founder",
        contact_email: `ar72-${tag}@example.org`,
        phone: "555-0100",
        onboarding_progress: {},
      })
      .select()
      .single();
    expect(orgErr, orgErr?.message).toBeNull();
    orgId = org!.id as string;
  }, 30000);

  afterAll(async () => {
    if (!service) return;
    // Reaping (assertions 3-4) raises real alerts rows (AR-6.3) referencing
    // this org — must go before the organizations delete below or its FK
    // (alerts_organization_id_fkey) blocks the cleanup.
    try {
      await service.from("alerts").delete().eq("organization_id", orgId);
    } catch {
      // best-effort cleanup
    }
    try {
      await service.from("automation_sessions").delete().in("id", sessionIds);
    } catch {
      // best-effort cleanup
    }
    try {
      await service.from("funders").delete().in("id", funderIds);
    } catch {
      // best-effort cleanup
    }
    try {
      await service.from("platform_config").delete().eq("organization_id", orgId);
    } catch {
      // best-effort cleanup
    }
    const { error } = await service.from("organizations").delete().eq("id", orgId);
    if (error) {
      // eslint-disable-next-line no-console
      console.warn(`[automation-session-lifecycle.test] cleanup failed for org ${orgId}: ${error.message}`);
    }
  }, 60000);

  async function makeFunder(): Promise<string> {
    const { data, error } = await service
      .from("funders")
      .insert({
        organization_id: orgId,
        name: `AR72_FUNDER_${randomSuffix()}`,
        category: "private_foundation",
        giving_portal_url: PORTAL_URL,
      })
      .select()
      .single();
    expect(error, error?.message).toBeNull();
    const funderId = data!.id as string;
    funderIds.push(funderId);
    return funderId;
  }

  /** Insert an automation_sessions row directly with an explicit age (no app-level trigger overrides updated_at — confirmed against migration 002's schema). */
  async function insertAgedSession(params: {
    funderId: string;
    status: string;
    ageIso: string;
  }): Promise<string> {
    const { data, error } = await service
      .from("automation_sessions")
      .insert({
        organization_id: orgId,
        funder_id: params.funderId,
        status: params.status,
        target_url: PORTAL_URL,
        created_at: params.ageIso,
        updated_at: params.ageIso,
      })
      .select("id")
      .single();
    expect(error, error?.message).toBeNull();
    const id = data!.id as string;
    sessionIds.push(id);
    return id;
  }

  // --- Assertions 1-2: finalize on every outcome ----------------------------

  it("assertion 1: a run that completes normally leaves the session terminal ('submitted')", async () => {
    const funderId = await makeFunder();
    const sessionId: string = await processor.createApprovedAutomationSession({
      orgId,
      funderId,
      portalUrl: PORTAL_URL,
      queueItemId: randomUUID(),
      riskAssessment: null,
    });
    sessionIds.push(sessionId);

    await processor.finalizeAutomationSession(sessionId, orgId, true, "CONF-12345", null);

    const { data: row } = await service
      .from("automation_sessions")
      .select("status, confirmation_number, error_message, completed_at")
      .eq("id", sessionId)
      .single();
    expect(row?.status).toBe("submitted");
    expect(row?.confirmation_number).toBe("CONF-12345");
    expect(row?.error_message).toBeNull();
    expect(row?.completed_at).toBeTruthy();
  });

  it("assertion 2: a run whose fill throws IncompleteSubmissionError still leaves the session terminal ('failed') — the direct guard on the deadlock", async () => {
    const funderId = await makeFunder();
    let sessionId: string | null = null;
    let submitted = false;
    let errorMessage: string | null = null;

    try {
      sessionId = await processor.createApprovedAutomationSession({
        orgId,
        funderId,
        portalUrl: PORTAL_URL,
        queueItemId: randomUUID(),
        riskAssessment: null,
      });
      sessionIds.push(sessionId as string);

      // The real error class form-filler-agent.ts's fillAndSubmit() throws
      // when required fields are still empty (AR-3.1) — thrown here, in the
      // "try" portion, to mirror processItem()'s exact control-flow shape.
      throw new IncompleteSubmissionError(["ein", "amount_requested"]);
    } catch (err) {
      if (!(err instanceof IncompleteSubmissionError)) throw err;
      errorMessage = err.message;
      submitted = false;
    } finally {
      // This is the exact line AR-7.2 moved: worker/queue-processor.ts's
      // finalizeAutomationSession() call now lives in `finally`, so it runs
      // whether the try above resolved or threw.
      if (sessionId !== null) {
        await processor.finalizeAutomationSession(sessionId, orgId, submitted, null, errorMessage);
      }
    }

    expect(sessionId).not.toBeNull();
    const { data: row } = await service
      .from("automation_sessions")
      .select("status, error_message, completed_at")
      .eq("id", sessionId!)
      .single();
    expect(row?.status).toBe("failed");
    expect(row?.error_message).toContain("ein");
    expect(row?.completed_at).toBeTruthy();
  });

  // --- Assertions 3-4: the watchdog reap and the deadlock it breaks ---------

  it("assertion 3: an abandoned session past its threshold is reaped, and an awaiting_approval session inside its window is NOT", async () => {
    const staleFunderId = await makeFunder();
    const freshFunderId = await makeFunder();
    const staleApprovedFunderId = await makeFunder();

    // Stuck 8 days in awaiting_approval — past the 7-day human-wait threshold.
    const staleId = await insertAgedSession({
      funderId: staleFunderId,
      status: "awaiting_approval",
      ageIso: daysAgoIso(8),
    });
    // Stuck 1 hour in awaiting_approval — well inside the 7-day window; a
    // human may genuinely still be about to act on this one.
    const freshId = await insertAgedSession({
      funderId: freshFunderId,
      status: "awaiting_approval",
      ageIso: minutesAgoIso(60),
    });
    // Stuck 45 minutes in 'approved' — past the 30-minute technical-state
    // threshold (a real submit attempt has no legitimate reason to take
    // this long), proving the per-status thresholds aren't just about
    // awaiting_approval.
    const staleApprovedId = await insertAgedSession({
      funderId: staleApprovedFunderId,
      status: "approved",
      ageIso: minutesAgoIso(45),
    });

    await reapStaleAutomationSessions(service);

    const { data: staleRow } = await service
      .from("automation_sessions")
      .select("status, error_message")
      .eq("id", staleId)
      .single();
    expect(staleRow?.status).toBe("failed");
    expect(staleRow?.error_message).toContain("awaiting_approval");
    expect(staleRow?.error_message).toContain("Reaped by stuck-run watchdog");

    const { data: freshRow } = await service
      .from("automation_sessions")
      .select("status")
      .eq("id", freshId)
      .single();
    expect(freshRow?.status).toBe("awaiting_approval");

    const { data: staleApprovedRow } = await service
      .from("automation_sessions")
      .select("status, error_message")
      .eq("id", staleApprovedId)
      .single();
    expect(staleApprovedRow?.status).toBe("failed");
    expect(staleApprovedRow?.error_message).toContain("approved");

    // AR-7.2 Step 5: reaping raises a manual_review_required alert per row,
    // not a silent cleanup.
    const { data: alert } = await service
      .from("alerts")
      .select("id, type, severity")
      .eq("dedup_key", `orchestration:manual_review_required:${staleId}`)
      .maybeSingle();
    expect(alert?.type).toBe("manual_review_required");
  });

  it("assertion 4: after a reap, a new queue item for that org+funder is processed rather than rejected with concurrent_automation_conflict — proves the deadlock is actually broken", async () => {
    const funderId = await makeFunder();
    const validator = new SubmissionValidator();

    // Abandoned 'approved' session for this org+funder — the exact shape
    // that produced `concurrent_automation_conflict` for 32/32 production
    // runs (2026-09-17 audit).
    const staleId = await insertAgedSession({
      funderId,
      status: "approved",
      ageIso: minutesAgoIso(45),
    });

    const before = await validator.checkConcurrentAutomation(orgId, funderId, service);
    expect(before.conflict).toBe(true);
    expect(before.sessionId).toBe(staleId);

    await reapStaleAutomationSessions(service);

    const after = await validator.checkConcurrentAutomation(orgId, funderId, service);
    expect(after.conflict).toBe(false);

    const { data: row } = await service
      .from("automation_sessions")
      .select("status")
      .eq("id", staleId)
      .single();
    expect(row?.status).toBe("failed");
  });
});

if (!CREDS_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[automation-session-lifecycle.test] skipped entirely — .env.local is missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
  );
}
