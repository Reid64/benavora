import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { SubmissionValidator } from "@/lib/autoapply/submission-validator";
import { assessSubmissionRisk } from "@/lib/autoapply/risk-engine";

// Node 20 has no native WebSocket; mirrors the workaround in
// src/lib/supabase/admin.ts and the other suites in this directory — without
// it, supabase-js's realtime client (constructed eagerly by createClient
// regardless of whether it's used) throws immediately.
function createClient(url: string, key: string, opts: Record<string, unknown> = {}): SupabaseClient {
  return createSupabaseClient(url, key, {
    ...opts,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: ws as any },
  }) as unknown as SupabaseClient;
}

/**
 * Live end-to-end test of the AutoApply submission_queue pipeline
 * (worker/queue-processor.ts). Per DEMO_READINESS_AUDIT.md, this pipeline had
 * never been exercised by any automated test — e2e/autoapply-dashboard.spec.ts
 * only checks that dashboard pages render, never that a queued item is
 * actually picked up, processed, or correctly gated.
 *
 * There is no local/mocked worker here. The pending -> processing -> terminal
 * transition is driven entirely by the real, long-running Railway worker
 * (benavora-worker) polling the real production `submission_queue` table
 * every 15s (`SLEEP_MS` in queue-processor.ts). This suite inserts rows via
 * the service-role client — the same method DEMO_READINESS_AUDIT.md's §2/§5/§7
 * used for its own live verification passes — and polls for the resulting
 * state change. It does not import or invoke queue-processor.ts directly
 * (it isn't structured for that — `QueueProcessor` owns a private poll loop
 * over the real client, not an injectable single-item entry point).
 *
 * Safe, non-live target: https://httpbin.org/forms/post — the same public
 * dummy-form endpoint the audit used specifically so a real submission never
 * reaches an actual foundation's live donation portal.
 *
 * There is no separate test Supabase project (`.env.test` points at a stack
 * that isn't running, matching every other suite in this directory). Every
 * row this suite creates — directly or as a worker side effect — is deleted
 * in `afterAll`, scoped by the test orgs'/funders' generated ids.
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

/**
 * Polls submission_queue.status for a given row until it leaves
 * pending/processing, matching the set of terminal states
 * queue-processor.ts's poll loop actually writes (see its catch blocks for
 * AccountSetupRequiredError / SkipError / generic Error, plus the
 * risk-engine 'manual' route which writes 'pending_manual' directly inside
 * processItem() rather than via the loop's own catch).
 */
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

(CREDS_AVAILABLE ? describe : describe.skip)("AutoApply submission_queue pipeline (live)", () => {
  let service: SupabaseClient;

  const orgIds: string[] = [];
  const funderIds: string[] = [];
  const queueItemIds: string[] = [];

  let orgIncompleteId: string;
  let orgReadyId: string;
  let funderIncompleteId: string;
  let funderReadyId: string;

  beforeAll(async () => {
    service = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const tag = randomSuffix();

    // Org with no KB fields, no active request_profiles, no org_documents —
    // checkOrgReadiness() must report NOT ready and queue-processor.ts must
    // block it with SkipError('org_not_ready: ...') before any browser work.
    const { data: orgIncomplete, error: orgIncompleteErr } = await service
      .from("organizations")
      .insert({ name: `AUTOAPPLY_TEST_INCOMPLETE_${tag}`, onboarding_progress: {} })
      .select()
      .single();
    expect(orgIncompleteErr, orgIncompleteErr?.message).toBeNull();
    orgIncompleteId = orgIncomplete!.id as string;
    orgIds.push(orgIncompleteId);

    // Org with every KB field, one active request_profiles row, and both
    // required org_documents types present — checkOrgReadiness() must report
    // ready and the pipeline must proceed past the org_not_ready gate.
    const { data: orgReady, error: orgReadyErr } = await service
      .from("organizations")
      .insert({
        name: `AUTOAPPLY_TEST_READY_${tag}`,
        mission_statement:
          "Providing emergency and transitional housing assistance in rural Texas.",
        ein: "84-1234567",
        address_line1: "123 Test Ave",
        founder_name: "Test Founder",
        contact_email: `ready-${tag}@example.org`,
        phone: "555-0100",
        onboarding_progress: {},
      })
      .select()
      .single();
    expect(orgReadyErr, orgReadyErr?.message).toBeNull();
    orgReadyId = orgReady!.id as string;
    orgIds.push(orgReadyId);

    const { error: profileErr } = await service.from("request_profiles").insert({
      organization_id: orgReadyId,
      name: `Test Operating Support ${tag}`,
      request_type: "monetary",
      needs_description: "General operating support for testing the AutoApply pipeline.",
      active: true,
      min_value: 1000,
      max_value: 5000,
    });
    expect(profileErr, profileErr?.message).toBeNull();

    const { error: docsErr } = await service.from("org_documents").insert([
      {
        organization_id: orgReadyId,
        document_type: "501c3_letter",
        display_name: "501(c)(3) Determination Letter",
        storage_path: `test/${tag}/501c3.pdf`,
        file_name: "501c3.pdf",
        is_current: true,
      },
      {
        organization_id: orgReadyId,
        document_type: "form_990",
        display_name: "IRS Form 990",
        storage_path: `test/${tag}/990.pdf`,
        file_name: "990.pdf",
        is_current: true,
      },
    ]);
    expect(docsErr, docsErr?.message).toBeNull();

    const { data: funderIncomplete, error: funderIncompleteErr } = await service
      .from("funders")
      .insert({
        organization_id: orgIncompleteId,
        name: `AUTOAPPLY_TEST_FUNDER_INCOMPLETE_${tag}`,
        category: "private_foundation",
        giving_portal_url: TARGET_URL,
      })
      .select()
      .single();
    expect(funderIncompleteErr, funderIncompleteErr?.message).toBeNull();
    funderIncompleteId = funderIncomplete!.id as string;
    funderIds.push(funderIncompleteId);

    const { data: funderReady, error: funderReadyErr } = await service
      .from("funders")
      .insert({
        organization_id: orgReadyId,
        name: `AUTOAPPLY_TEST_FUNDER_READY_${tag}`,
        category: "private_foundation",
        giving_portal_url: TARGET_URL,
      })
      .select()
      .single();
    expect(funderReadyErr, funderReadyErr?.message).toBeNull();
    funderReadyId = funderReady!.id as string;
    funderIds.push(funderReadyId);
  }, 30000);

  afterAll(async () => {
    if (!service) return;

    // Deepest-first, best-effort cleanup of everything scoped to our test
    // orgs/funders — including worker side-effect rows (autoapply_submissions,
    // automation_sessions, form_templates, autoapply_screenshots), since a
    // "ready" queue item can genuinely trigger real browser-automation writes.
    // Uses try/catch, not .catch() — per project memory
    // (benavora-integration-test-catch-bug-leaks-prod-rows), chaining .catch()
    // on this pinned supabase-js version's PostgrestFilterBuilder throws
    // synchronously instead of suppressing a rejection, which would abort
    // cleanup partway through.
    for (const funderId of funderIds) {
      try {
        const { data: subs } = await service
          .from("autoapply_submissions")
          .select("id")
          .eq("funder_id", funderId);
        const subIds = ((subs ?? []) as Array<{ id: string }>).map((s) => s.id);
        if (subIds.length > 0) {
          try {
            await service.from("autoapply_screenshots").delete().in("submission_id", subIds);
          } catch {
            // best-effort cleanup
          }
          try {
            await service.from("session_recordings").delete().in("submission_id", subIds);
          } catch {
            // best-effort cleanup
          }
        }
      } catch {
        // best-effort cleanup
      }
      try {
        await service.from("autoapply_submissions").delete().eq("funder_id", funderId);
      } catch {
        // best-effort cleanup
      }
      try {
        await service.from("automation_sessions").delete().eq("funder_id", funderId);
      } catch {
        // best-effort cleanup
      }
      try {
        await service.from("form_templates").delete().eq("funder_id", funderId);
      } catch {
        // best-effort cleanup
      }
      try {
        await service.from("autoapply_review_queue").delete().eq("funder_id", funderId);
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

    for (const orgId of orgIds) {
      try {
        await service.from("request_profiles").delete().eq("organization_id", orgId);
      } catch {
        // best-effort cleanup
      }
      try {
        await service.from("org_documents").delete().eq("organization_id", orgId);
      } catch {
        // best-effort cleanup
      }
      try {
        await service.from("platform_config").delete().eq("organization_id", orgId);
      } catch {
        // best-effort cleanup
      }
      const { error } = await service.from("organizations").delete().match({ id: orgId });
      if (error) {
        // eslint-disable-next-line no-console
        console.warn(`[autoapply-queue.test] cleanup failed for org ${orgId}: ${error.message}`);
      }
    }
  }, 60000);

  it("checkOrgReadiness() reports NOT ready when request_profiles/org_documents/KB fields are missing", async () => {
    const validator = new SubmissionValidator();
    const report = await validator.checkOrgReadiness(orgIncompleteId, service);

    expect(report.ready).toBe(false);
    expect(report.missing_required.length).toBeGreaterThan(0);
    expect(report.missing_required).toContain("At least one active request profile");
    expect(report.missing_required).toContain("501(c)(3) determination letter");
    expect(report.missing_required).toContain("IRS Form 990");
    expect(
      report.blockers.some((b) => b.includes("No active request profiles")),
    ).toBe(true);
  });

  it("checkOrgReadiness() reports ready when an active profile and both required documents are present", async () => {
    const validator = new SubmissionValidator();
    const report = await validator.checkOrgReadiness(orgReadyId, service);

    expect(report.ready).toBe(true);
    expect(report.missing_required).toEqual([]);
    expect(report.blockers).toEqual([]);
    expect(report.score).toBeGreaterThanOrEqual(70);
  });

  it(
    "real queue item for an unready org: pending -> processing -> skipped, blocked by org_not_ready near-instantly",
    async () => {
      const { data: item, error } = await service
        .from("submission_queue")
        .insert({
          organization_id: orgIncompleteId,
          funder_id: funderIncompleteId,
          status: "pending",
        })
        .select()
        .single();
      expect(error, error?.message).toBeNull();
      expect(item!.status).toBe("pending");
      queueItemIds.push(item!.id as string);

      const { row, sawProcessing } = await waitForTerminal(service, item!.id as string, {
        timeoutMs: 90000,
        pollMs: 2000,
      });

      // Real state transition proof: it left pending (either observed
      // 'processing' directly, or started_at was stamped by dequeue()'s
      // claim UPDATE before this poll caught up) and landed on a terminal
      // status recognized by the worker's own catch blocks.
      expect(sawProcessing).toBe(true);
      expect(row.started_at).toBeTruthy();
      expect(row.completed_at).toBeTruthy();
      expect(row.status).toBe("skipped");

      // org_not_ready throws before any browser/Claude work runs — matches
      // DEMO_READINESS_AUDIT.md §5/§7's live finding of a ~1-2s skip. A
      // multi-second gap here would mean it did NOT hit the early gate.
      const durationMs =
        new Date(row.completed_at as string).getTime() - new Date(row.started_at as string).getTime();
      expect(durationMs).toBeLessThan(15000);
    },
    120000,
  );

  it(
    "real queue item for a ready org: proceeds past org_not_ready into real submission logic",
    async () => {
      const { data: item, error } = await service
        .from("submission_queue")
        .insert({
          organization_id: orgReadyId,
          funder_id: funderReadyId,
          status: "pending",
        })
        .select()
        .single();
      expect(error, error?.message).toBeNull();
      queueItemIds.push(item!.id as string);

      const { row } = await waitForTerminal(service, item!.id as string, {
        timeoutMs: 180000,
        pollMs: 3000,
      });

      expect(row.started_at).toBeTruthy();
      expect(row.completed_at).toBeTruthy();

      // Distinguish "reached real form-fill/submission logic" from "blocked
      // at the gate": queue-processor.ts's processItem() only reaches the
      // automation_sessions insert (createApprovedAutomationSession) or the
      // autoapply_submissions insert AFTER checkOrgReadiness() passes and the
      // risk engine has run — a 'pending_manual' status is itself written by
      // the risk-engine 'manual' route, which also only runs after the
      // org-readiness gate. Any one of these is proof this item was not
      // stopped by org_not_ready.
      const { data: sessions } = await service
        .from("automation_sessions")
        .select("id, status")
        .eq("funder_id", funderReadyId);
      const { data: submissions } = await service
        .from("autoapply_submissions")
        .select("id, status")
        .eq("funder_id", funderReadyId);

      const reachedRealPipeline =
        row.status === "pending_manual" ||
        (sessions?.length ?? 0) > 0 ||
        (submissions?.length ?? 0) > 0;

      expect(
        reachedRealPipeline,
        `expected the ready org to progress past org_not_ready into real submission logic; ` +
          `final queue status was "${row.status}" with no automation_sessions/autoapply_submissions rows created`,
      ).toBe(true);

      // Also verify by contrast: this took meaningfully longer than the
      // unready org's near-instant skip, consistent with real browser/Claude
      // work having actually run (not a second early-gate rejection).
      const durationMs =
        new Date(row.completed_at as string).getTime() - new Date(row.started_at as string).getTime();
      expect(durationMs).toBeGreaterThan(1000);
    },
    200000,
  );

  // --- automation_level gating (risk-engine.ts) -----------------------------
  //
  // AUTOAPPLY_ARCHITECTURE_V2.md §8C documents three automation levels —
  // full_auto / assisted / manual_only — as a graduated three-tier gate.
  // assessSubmissionRisk() (src/lib/autoapply/risk-engine.ts), the only place
  // funders.automation_level is actually read at submission time, does not
  // implement that: it special-cases 'manual_only' only (+40 risk points,
  // routing recommendation toward 'manual'), and form-filler-agent.ts never
  // reads automation_level at all. These tests verify the REAL current
  // behavior rather than the documented aspiration — 'assisted' and
  // 'full_auto' currently produce identical risk assessments; only
  // 'manual_only' changes anything.
  it("assessSubmissionRisk(): 'assisted' and 'full_auto' currently produce identical scores (no coded distinction)", async () => {
    const baseParams = {
      requestProfile: { request_type: "monetary", min_value: 1000, max_value: 5000 },
      formTemplate: null,
      orgReadiness: { ready: true, missing_required: [] as string[] },
      crossClientBlocked: false,
      supabase: service,
    };

    const assistedFunderId = `test-risk-assisted-${randomSuffix()}`;
    const fullAutoFunderId = `test-risk-full-auto-${randomSuffix()}`;

    const assisted = await assessSubmissionRisk({
      ...baseParams,
      funder: { id: assistedFunderId, name: "Test Funder (assisted)", automation_level: "assisted" },
    });
    const fullAuto = await assessSubmissionRisk({
      ...baseParams,
      funder: { id: fullAutoFunderId, name: "Test Funder (full_auto)", automation_level: "full_auto" },
    });

    expect(assisted.score).toBe(fullAuto.score);
    expect(assisted.classification).toBe(fullAuto.classification);
    expect(assisted.recommendation).toBe(fullAuto.recommendation);
    expect(assisted.factors.some((f) => f.name === "manual_only_portal")).toBe(false);
    expect(fullAuto.factors.some((f) => f.name === "manual_only_portal")).toBe(false);
  });

  it("assessSubmissionRisk(): 'manual_only' adds a real +40 point risk factor and forces a manual route", async () => {
    const baseParams = {
      requestProfile: { request_type: "monetary", min_value: 1000, max_value: 5000 },
      formTemplate: null,
      orgReadiness: { ready: true, missing_required: [] as string[] },
      crossClientBlocked: false,
      supabase: service,
    };

    const assistedFunderId = `test-risk-assisted-${randomSuffix()}`;
    const manualOnlyFunderId = `test-risk-manual-only-${randomSuffix()}`;

    const assisted = await assessSubmissionRisk({
      ...baseParams,
      funder: { id: assistedFunderId, name: "Test Funder (assisted)", automation_level: "assisted" },
    });
    const manualOnly = await assessSubmissionRisk({
      ...baseParams,
      funder: { id: manualOnlyFunderId, name: "Test Funder (manual_only)", automation_level: "manual_only" },
    });

    const manualOnlyFactor = manualOnly.factors.find((f) => f.name === "manual_only_portal");
    expect(manualOnlyFactor).toBeTruthy();
    expect(manualOnlyFactor!.points).toBe(40);
    expect(manualOnly.score).toBe(assisted.score + 40);
    expect(manualOnly.recommendation).toBe("manual");
  });
});

if (!CREDS_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[autoapply-queue.test] skipped entirely — .env.local is missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
  );
}
