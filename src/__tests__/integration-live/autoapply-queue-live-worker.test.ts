import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

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
 * WGR-157: moved out of src/__tests__/integration/autoapply-queue.test.ts
 * (excluded from the default `npx vitest run` via vitest.config.ts's
 * `exclude: [..., "src/__tests__/integration-live/**"]`) — these 2 tests
 * require the real, separately-deployed Railway worker (benavora-worker) to
 * be actively polling the real production `submission_queue` table within
 * 90-180s, a genuine live-external-system dependency the default suite
 * (and this repo's pre-push build gate) cannot assume is running. Run
 * explicitly via `pnpm run test:integration`.
 *
 * A deterministic, mock-based replacement for the org-readiness gating
 * decision this suite exercises lives at
 * src/__tests__/unit/autoapply-queue-gating.test.ts (exercises
 * QueueProcessor.processItem() directly, fully mocked, no live worker) —
 * that one runs in the default suite and stays green regardless of whether
 * the real worker happens to be up when CI runs.
 *
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
  error_message: string | null;
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
      .select("id, status, started_at, completed_at, error_message")
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

(CREDS_AVAILABLE ? describe : describe.skip)("AutoApply submission_queue pipeline (live, requires the real Railway worker)", () => {
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
    // required documents present — checkOrgReadiness() must report ready and
    // the pipeline must proceed past the org_not_ready gate.
    //
    // Writes to `documents` (the real, live document vault table), not
    // `org_documents` — fixed 2026-08-05 alongside submission-validator.ts's
    // own checkOrgReadiness() fix: `org_documents` was confirmed to have zero
    // rows platform-wide, for every org, ever; the real upload path
    // (DocumentUploader.tsx) writes to `documents` with a coarse `category`
    // (DOCUMENT_CATEGORIES) instead of a fine-grained `document_type`, so
    // checkOrgReadiness() now does a filename-keyword match within the
    // `tax_documents` category. This fixture matches that real contract.
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

    const { error: docsErr } = await service.from("documents").insert([
      {
        organization_id: orgReadyId,
        category: "tax_documents",
        storage_path: `test/${tag}/501c3-determination-letter.pdf`,
        file_name: "501c3-determination-letter.pdf",
      },
      {
        organization_id: orgReadyId,
        category: "tax_documents",
        storage_path: `test/${tag}/irs-form-990.pdf`,
        file_name: "irs-form-990.pdf",
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
        await service.from("documents").delete().eq("organization_id", orgId);
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
        console.warn(`[autoapply-queue-live-worker.test] cleanup failed for org ${orgId}: ${error.message}`);
      }
    }
  }, 60000);

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
      //
      // Phase 5.5 (2026-09-15): added a 4th proof. checkCrossClientDedup()
      // (queue-processor.ts:749, throwing SkipError('cross_client_blocked: ...'))
      // runs strictly AFTER checkOrgReadiness() (line 701) in processItem() —
      // confirmed by reading the file directly. This test's fixed TARGET_URL
      // (httpbin.org/forms/post) is a shared public target reused across every
      // run of this suite (and by hand while diagnosing this very test), so
      // once any org has submitted to it within the 7-day dedup window, every
      // subsequent "ready org" run legitimately gets skipped here instead of
      // reaching automation_sessions/autoapply_submissions — that is the guard
      // correctly doing its job, not a readiness-gate failure, and is just as
      // valid a proof of passing org_not_ready as the other three outcomes.
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
        (submissions?.length ?? 0) > 0 ||
        (row.status === "skipped" && (row.error_message ?? "").startsWith("cross_client_blocked"));

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
});

if (!CREDS_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[autoapply-queue-live-worker.test] skipped entirely — .env.local is missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
  );
}
