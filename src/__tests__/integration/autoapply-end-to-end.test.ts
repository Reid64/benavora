import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import dotenv from "dotenv";

// tests/setup.ts globally mocks @anthropic-ai/sdk for every vitest file so
// ordinary unit tests never make a real network call. This suite needs real
// Claude output at every stage (FormAnalyzerAgent's field extraction,
// FormFillerAgent's confirmation-page parse, SubmissionValidator) — the whole
// point is proving the real chain, not a stand-in for it. vi.mock/vi.unmock
// calls are hoisted by Vitest's transform, so this must run before the
// imports below are evaluated.
vi.unmock("@anthropic-ai/sdk");

// worker/index.ts runs validateEnv() (process.exit(1) on missing env vars,
// e.g. WORKER_ID — never set under vitest) as a top-level side effect at
// import time, and worker/rate-limiter.ts (a queue-processor.ts collaborator)
// imports `supabase` from it — so merely importing QueueProcessor/
// mapFillOutcomeToStatus below would kill the whole vitest process. Same
// guard as autoapply-submit-integrity.test.ts / automation-session-lifecycle.test.ts.
vi.mock("../../../worker/index", () => ({ supabase: {} }));

import { QueueProcessor, mapFillOutcomeToStatus } from "../../../worker/queue-processor";
import { StealthBrowser } from "@/lib/autoapply/stealth-browser";
import { FormAnalyzerAgent } from "@/lib/autoapply/form-analyzer-agent";
import {
  FormFillerAgent,
  IncompleteSubmissionError,
  type RequestProfile,
} from "@/lib/autoapply/form-filler-agent";
import { SubmissionValidator } from "@/lib/autoapply/submission-validator";
import { ScreenshotManager } from "@/lib/autoapply/screenshot-manager";
import type { FormField } from "@/types/automation";

/**
 * AR-9.3 — full-chain proof that AutoApply's pieces, wired together the same
 * way worker/queue-processor.ts's processItem() wires them, actually produce
 * a real submission (or an honest non-submission) start to finish. AR-3.1,
 * AR-7.1, AR-7.2 and AR-9.2 each proved one link in this chain in isolation;
 * this suite is the first to run all of them together against a form that
 * can actually catch a regression — a local, self-hosted portal with real
 * HTML5 `required` attributes (the pre-existing form-analyzer-filler.test.ts
 * targets httpbin.org/forms/post, which has none, so a 2-of-4-filled form
 * still POSTs "successfully" there — exactly the class of bug AR-3.1 fixed).
 *
 * WHAT THIS PROVES (every step below calls the real, unmodified production
 * code — nothing in the chain itself is mocked or stubbed):
 *   1. SubmissionValidator.checkConcurrentAutomation() — the AR-9.2 mutual-
 *      exclusion guard — runs against real automation_sessions rows and
 *      reports no conflict for a fresh org+funder pair.
 *   2. StealthBrowser.launch() — real Playwright, via the AR-7.1
 *      launchChromium()/resolveChromiumExecutablePath() launcher.
 *   3. FormAnalyzerAgent.analyzeAndStore() — real Claude call against the
 *      fixture portal's live DOM, producing the real array-shaped
 *      field_mapping this worker persists.
 *   4. SubmissionValidator.validateFormData() — real format-level validation
 *      of the values about to be submitted.
 *   5. QueueProcessor.createApprovedAutomationSession() /
 *      finalizeAutomationSession() (private methods, exercised via `as any`
 *      reflection — the same pattern automation-session-lifecycle.test.ts
 *      already uses) — the real session audit trail.
 *   6. FormFillerAgent.fillAndSubmit() — real field mapping (extractFieldMapping,
 *      AR-3.1 CAUSE 1's fix), real fill, real submitForm() verification race
 *      (navigation vs. POST response, AR-3.1 CAUSE 2's fix), real discriminated
 *      FillOutcome (never inferring success from the absence of a thrown error,
 *      AR-3.1 CAUSE 3's fix).
 *   7. mapFillOutcomeToStatus() — the exact status-mapping function
 *      worker/queue-processor.ts calls.
 *   8. A real autoapply_submissions insert, using the same column shape
 *      worker/queue-processor.ts's processItem() writes.
 *
 * THE NAMED GAP — what this suite deliberately does NOT drive, and why:
 * worker/queue-processor.ts's processItem() itself is never called end to
 * end. Two independent reasons, both confirmed by reading the source before
 * writing this suite:
 *   (a) processItem() calls assertUrlSafe(portalUrl) (src/lib/security/
 *       ssrf-guard.ts) before ever touching the browser, and that guard
 *       unconditionally rejects every private/loopback address, including
 *       127.0.0.1 and localhost — so a local fixture server (required, per
 *       this task, to avoid depending on any external host) can never reach
 *       fillAndSubmit() through processItem() itself. This is the same
 *       constraint autoapply-submit-integrity.test.ts and
 *       automation-session-lifecycle.test.ts hit and documented before this
 *       suite existed.
 *   (b) Even with that guard bypassed, processItem() also gates on ~10
 *       unrelated business rules this task does not ask this suite to prove
 *       or regression-guard — the queue control plane, org-readiness
 *       scoring, usage-tier allowance, velocity/cross-client/domain
 *       throttles, relationship contact rules, the risk engine's
 *       manual-review routing, registration/login-gating, a live portal
 *       health check (a real HEAD/GET request to the target URL), pitch
 *       personalization, and A/B variant selection. None of those are part
 *       of the AR-3.1/AR-7.1/AR-7.2/AR-9.2 chain this task names, and each
 *       is an independent source of test flakiness unrelated to the thing
 *       under test. This suite instead drives the exact sequence of real
 *       production calls processItem() makes for the segment this task
 *       names (mutex guard -> browser -> analyzer -> validator -> filler ->
 *       status mapping -> submission row -> session finalization), in the
 *       same order, using the same functions/classes/private methods —
 *       gluing them together in the test rather than through processItem()'s
 *       wrapper. This is a real, load-bearing gap: it does NOT prove
 *       processItem()'s outer orchestration (its many upstream/downstream
 *       gates) is wired correctly, only that the submission chain itself is.
 *
 * No separate test Supabase project exists — this runs against the real
 * production database via the service-role client, same as every other
 * suite in this directory. All rows created here are deleted in afterAll via
 * try/catch (not .catch()), per project memory
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
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || localEnv.ANTHROPIC_API_KEY;
if (ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) {
  process.env.ANTHROPIC_API_KEY = ANTHROPIC_API_KEY;
}
const CREDS_AVAILABLE = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && ANTHROPIC_API_KEY);

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

// --- Local fixture portal ----------------------------------------------------
//
// Serves two pages, neither reachable from outside this process:
//  - /apply: a 4-field application form (org name, EIN, contact email,
//    project description), every field carrying a real HTML5 `required`
//    attribute. A real submit POSTs to /submit, which echoes the body back
//    (recorded server-side) and renders a confirmation page with a
//    confirmation number.
//  - /apply-unverified: identical fields, but onsubmit="return false" blocks
//    the browser's real navigation/POST — simulating a client-side handler
//    that silently swallows the submit (the exact ambiguity
//    SubmissionNotVerifiedError exists to catch).

interface PostRecord {
  path: string;
  body: Record<string, string>;
}

interface FixturePortal {
  baseUrl: string;
  posts: PostRecord[];
  close: () => Promise<void>;
}

function renderApplicationForm(blockSubmit: boolean): string {
  return `<!doctype html>
<html><body>
<h1>Community Grant Application</h1>
<form action="/submit" method="POST"${blockSubmit ? ' onsubmit="return false;"' : ""}>
  <label for="org_name">Organization Name</label>
  <input type="text" id="org_name" name="org_name" required />

  <label for="ein">EIN (Tax ID)</label>
  <input type="text" id="ein" name="ein" required />

  <label for="contact_email">Contact Email</label>
  <input type="email" id="contact_email" name="contact_email" required />

  <label for="description">Project Description</label>
  <textarea id="description" name="description" required></textarea>

  <button type="submit">Submit Application</button>
</form>
</body></html>`;
}

function startFixturePortal(): Promise<FixturePortal> {
  const posts: PostRecord[] = [];

  const server = http.createServer((req, res) => {
    const urlPath = (req.url ?? "/").split("?")[0];

    if (req.method === "GET" && urlPath === "/apply") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(renderApplicationForm(false));
      return;
    }

    if (req.method === "GET" && urlPath === "/apply-unverified") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(renderApplicationForm(true));
      return;
    }

    if (req.method === "POST" && urlPath === "/submit") {
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += chunk.toString("utf8");
      });
      req.on("end", () => {
        const body = Object.fromEntries(new URLSearchParams(raw));
        posts.push({ path: urlPath, body });
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          `<!doctype html><html><body><h1>Thank you for your application!</h1>` +
            `<p>Your confirmation number is CONF-${body["org_name"] ?? "UNKNOWN"}.</p>` +
            `<p>We will respond within 6 to 8 weeks.</p></body></html>`,
        );
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        posts,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

(CREDS_AVAILABLE ? describe : describe.skip)(
  "AutoApply end-to-end proof (AR-9.3) — local required-field portal, real Playwright + real Claude, full chain",
  () => {
    let service: SupabaseClient;
    let portal: FixturePortal;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let processor: any;
    const validator = new SubmissionValidator();
    const tag = randomSuffix();

    const orgIds: string[] = [];
    const funderIds: string[] = [];
    const requestProfileIds: string[] = [];
    const formTemplateIds: string[] = [];
    const automationSessionIds: string[] = [];
    const submissionQueueIds: string[] = [];
    const submissionIds: string[] = [];

    let orgCompleteId: string;
    let funderHappyId: string;
    let funderUnverifiedId: string;
    let requestProfileCompleteId: string;

    let orgIncompleteId: string;
    let funderIncompleteId: string;
    let requestProfileIncompleteId: string;

    // Set by ASSERTION 1 (happy path) and reused by ASSERTION 4 (array
    // mapping) — the same real analyzer output actually used to produce the
    // real successful submission, not a freshly re-run analysis.
    let happyFormTemplateId: string;

    beforeAll(async () => {
      portal = await startFixturePortal();

      service = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      processor = new QueueProcessor(service, `test-worker-ar93-${tag}`);

      // --- Complete org: has every field the fixture form's fields need,
      // read directly off the real `organizations` columns (see the AR-9.3
      // buildFillData() fix in form-filler-agent.ts — the knowledge_base
      // table's category enum has no 'ein'/'contact_email' member, so those
      // values can never come from a knowledge_base row). ---------------
      const { data: orgComplete, error: orgCompleteErr } = await service
        .from("organizations")
        .insert({
          name: `AUTOAPPLY_E2E_COMPLETE_${tag}`,
          mission_statement: "Providing emergency and transitional housing assistance in rural Texas.",
          ein: "84-1234567",
          contact_email: `grants-${tag}@testorg.example.org`,
          onboarding_progress: {},
        })
        .select()
        .single();
      expect(orgCompleteErr, orgCompleteErr?.message).toBeNull();
      orgCompleteId = orgComplete!.id as string;
      orgIds.push(orgCompleteId);

      const { data: funderHappy, error: funderHappyErr } = await service
        .from("funders")
        .insert({
          organization_id: orgCompleteId,
          name: `AUTOAPPLY_E2E_FUNDER_HAPPY_${tag}`,
          category: "private_foundation",
          giving_portal_url: `${portal.baseUrl}/apply`,
        })
        .select()
        .single();
      expect(funderHappyErr, funderHappyErr?.message).toBeNull();
      funderHappyId = funderHappy!.id as string;
      funderIds.push(funderHappyId);

      const { data: funderUnverified, error: funderUnverifiedErr } = await service
        .from("funders")
        .insert({
          organization_id: orgCompleteId,
          name: `AUTOAPPLY_E2E_FUNDER_UNVERIFIED_${tag}`,
          category: "private_foundation",
          giving_portal_url: `${portal.baseUrl}/apply-unverified`,
        })
        .select()
        .single();
      expect(funderUnverifiedErr, funderUnverifiedErr?.message).toBeNull();
      funderUnverifiedId = funderUnverified!.id as string;
      funderIds.push(funderUnverifiedId);

      const { data: reqProfileComplete, error: reqProfileCompleteErr } = await service
        .from("request_profiles")
        .insert({
          organization_id: orgCompleteId,
          name: `E2E Complete Request ${tag}`,
          request_type: "monetary",
          needs_description: `General operating support for our emergency shelter program ${tag}`,
        })
        .select()
        .single();
      expect(reqProfileCompleteErr, reqProfileCompleteErr?.message).toBeNull();
      requestProfileCompleteId = reqProfileComplete!.id as string;
      requestProfileIds.push(requestProfileCompleteId);

      // --- Incomplete org: deliberately has no `ein` column value, so the
      // form's required EIN field can never be filled --------------------
      const { data: orgIncomplete, error: orgIncompleteErr } = await service
        .from("organizations")
        .insert({
          name: `AUTOAPPLY_E2E_INCOMPLETE_${tag}`,
          mission_statement: "Youth mentorship and after-school programming.",
          contact_email: `grants-incomplete-${tag}@testorg.example.org`,
          onboarding_progress: {},
        })
        .select()
        .single();
      expect(orgIncompleteErr, orgIncompleteErr?.message).toBeNull();
      orgIncompleteId = orgIncomplete!.id as string;
      orgIds.push(orgIncompleteId);

      const { data: funderIncomplete, error: funderIncompleteErr } = await service
        .from("funders")
        .insert({
          organization_id: orgIncompleteId,
          name: `AUTOAPPLY_E2E_FUNDER_INCOMPLETE_${tag}`,
          category: "private_foundation",
          giving_portal_url: `${portal.baseUrl}/apply`,
        })
        .select()
        .single();
      expect(funderIncompleteErr, funderIncompleteErr?.message).toBeNull();
      funderIncompleteId = funderIncomplete!.id as string;
      funderIds.push(funderIncompleteId);

      const { data: reqProfileIncomplete, error: reqProfileIncompleteErr } = await service
        .from("request_profiles")
        .insert({
          organization_id: orgIncompleteId,
          name: `E2E Incomplete Request ${tag}`,
          request_type: "monetary",
          needs_description: `Incomplete-submission regression test ${tag}`,
        })
        .select()
        .single();
      expect(reqProfileIncompleteErr, reqProfileIncompleteErr?.message).toBeNull();
      requestProfileIncompleteId = reqProfileIncomplete!.id as string;
      requestProfileIds.push(requestProfileIncompleteId);
    }, 30000);

    afterAll(async () => {
      if (portal) await portal.close();
      if (!service) return;
      try {
        await service.from("autoapply_screenshots").delete().in("submission_id", submissionIds);
      } catch {
        // best-effort cleanup
      }
      try {
        await service.from("autoapply_submissions").delete().in("id", submissionIds);
      } catch {
        // best-effort cleanup
      }
      try {
        await service.from("submission_queue").delete().in("id", submissionQueueIds);
      } catch {
        // best-effort cleanup
      }
      try {
        await service.from("automation_sessions").delete().in("id", automationSessionIds);
      } catch {
        // best-effort cleanup
      }
      try {
        await service.from("form_templates").delete().in("id", formTemplateIds);
      } catch {
        // best-effort cleanup
      }
      try {
        await service.from("request_profiles").delete().in("id", requestProfileIds);
      } catch {
        // best-effort cleanup
      }
      try {
        await service.from("funders").delete().in("id", funderIds);
      } catch {
        // best-effort cleanup
      }
      for (const id of orgIds) {
        try {
          await service.from("organizations").delete().eq("id", id);
        } catch {
          // best-effort cleanup
        }
      }
    }, 60000);

    /**
     * Mirrors, using the real production functions/classes/private methods in
     * the same order, the exact segment of worker/queue-processor.ts's
     * processItem() this task names — see the suite header for exactly what
     * is and is not exercised this way.
     */
    async function runPipelineItem(params: {
      orgId: string;
      funderId: string;
      portalUrl: string;
      requestProfileId: string;
      requestProfile: RequestProfile;
    }): Promise<{
      queueItemId: string;
      sessionId: string;
      submissionId: string;
      outcome: string;
      status: string;
      confirmationNumber: string | null;
      confirmationScreenshotUrl: string | null;
      errorMessage: string | null;
      postsToPortal: number;
      mutexConflict: boolean;
      validation: { valid: boolean; errors: Array<{ field: string; message: string }> };
    }> {
      const { orgId, funderId, portalUrl, requestProfileId, requestProfile } = params;

      // --- "queue item" -----------------------------------------------------
      const { data: queueRow, error: queueErr } = await service
        .from("submission_queue")
        .insert({
          organization_id: orgId,
          funder_id: funderId,
          status: "pending",
          automation_mode: "autonomous",
          request_profile_id: requestProfileId,
        })
        .select("id")
        .single();
      expect(queueErr, queueErr?.message).toBeNull();
      const queueItemId = queueRow!.id as string;
      submissionQueueIds.push(queueItemId);

      // --- "mutual-exclusion guard" (AR-9.2) --------------------------------
      const mutex = await validator.checkConcurrentAutomation(orgId, funderId, service);

      const postsBefore = portal.posts.length;

      let sessionId: string | null = null;
      let submissionStatus = "failed";
      let confirmationNumber: string | null = null;
      let errorMessage: string | null = null;
      let confirmationScreenshotUrl: string | null = null;
      let outcome = "not_submitted";
      let formTemplateId: string | null = null;
      let validation: { valid: boolean; errors: Array<{ field: string; message: string }> } = {
        valid: true,
        errors: [],
      };
      const screenshotManager = new ScreenshotManager();

      // --- "StealthBrowser via the AR-7.1 launcher" -------------------------
      const stealthBrowser = new StealthBrowser({ headless: true });
      const { browser, page, context } = await stealthBrowser.launch();

      try {
        await page.goto(portalUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

        // --- "FormAnalyzerAgent" ---------------------------------------------
        const analyzer = new FormAnalyzerAgent(service);
        const analyzed = await analyzer.analyzeAndStore({
          page,
          portalUrl,
          funderId,
          organizationId: orgId,
        });
        formTemplateId = analyzed.id;
        formTemplateIds.push(analyzed.id);

        const { data: templateRow, error: templateErr } = await service
          .from("form_templates")
          .select("*")
          .eq("id", analyzed.id)
          .single();
        expect(templateErr, templateErr?.message).toBeNull();
        const template = templateRow as Record<string, unknown>;

        // --- "SubmissionValidator" (format-level pre-submit validation) -----
        // form_structure.fields is FormAnalyzerAgent's own internal FormField
        // shape (name/label/type/required) — distinct from, and not to be
        // confused with, @/types/automation's FormField (fieldName/fieldLabel)
        // that SubmissionValidator.validateFormData() expects. Adapt one to
        // the other explicitly rather than casting across the mismatch.
        interface AnalyzedField {
          name: string;
          label: string;
          required: boolean;
        }
        const formStructure = template["form_structure"] as { fields?: AnalyzedField[] } | null;
        const analyzedFields = Array.isArray(formStructure?.fields) ? formStructure!.fields! : [];
        const validatorFields: FormField[] = analyzedFields.map((f) => ({
          fieldType: "text",
          fieldName: f.name,
          fieldLabel: f.label,
          selector: `[name="${f.name}"]`,
          required: f.required,
        }));
        const { data: orgRowForValidation } = await service
          .from("organizations")
          .select("name, ein, contact_email")
          .eq("id", orgId)
          .single();
        const fieldValues: Record<string, string> = {
          org_name: (orgRowForValidation?.name as string) ?? "",
          ein: (orgRowForValidation?.ein as string) ?? "",
          contact_email: (orgRowForValidation?.contact_email as string) ?? "",
          description: requestProfile.needs_description,
        };
        validation = await validator.validateFormData(validatorFields, fieldValues, null);

        // --- "session finalization" setup: create + auto-approve the real
        // automation_sessions audit row via QueueProcessor's real private
        // method (same reflection pattern as automation-session-lifecycle.test.ts) --
        sessionId = await processor.createApprovedAutomationSession({
          orgId,
          funderId,
          portalUrl,
          queueItemId,
          riskAssessment: null,
        });
        automationSessionIds.push(sessionId as string);

        // --- "FormFillerAgent" + "submit verification" ------------------------
        const filler = new FormFillerAgent(service, stealthBrowser);
        const fillResult = await filler.fillAndSubmit({
          page,
          template,
          organizationId: orgId,
          funderId,
          requestProfile,
          sessionId: sessionId as string,
        });

        outcome = fillResult.outcome;
        confirmationNumber = fillResult.confirmationNumber;
        // --- "status mapping" ------------------------------------------------
        submissionStatus = mapFillOutcomeToStatus(fillResult.outcome);
        if (fillResult.outcome !== "submitted") {
          errorMessage = fillResult.submitFailureReason ?? `submission outcome: ${fillResult.outcome}`;
        }

        if (fillResult.confirmationScreenshot) {
          confirmationScreenshotUrl = await screenshotManager.uploadAndRecord(
            fillResult.confirmationScreenshot,
            "confirmation",
            { orgId, funderId, submissionId: null, supabase: service },
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errorMessage = message;
        submissionStatus = "failed";
        outcome = err instanceof IncompleteSubmissionError ? "incomplete" : "error";
      } finally {
        // --- "session finalization" -------------------------------------------
        if (sessionId !== null) {
          await processor.finalizeAutomationSession(
            sessionId,
            orgId,
            submissionStatus === "submitted",
            confirmationNumber,
            errorMessage,
          );
        }
        await context.close().catch(() => null);
        await browser.close().catch(() => null);
      }

      // --- "autoapply_submissions row" ----------------------------------------
      const { data: submissionRow, error: submissionErr } = await service
        .from("autoapply_submissions")
        .insert({
          organization_id: orgId,
          funder_id: funderId,
          form_template_id: formTemplateId,
          request_profile_id: requestProfileId,
          status: submissionStatus,
          request_description: requestProfile.needs_description,
          confirmation_screenshot_url: confirmationScreenshotUrl,
          confirmation_number: confirmationNumber,
          error_message: errorMessage,
          retry_count: 0,
          submitted_at: submissionStatus === "submitted" ? new Date().toISOString() : null,
        })
        .select("*")
        .single();
      expect(submissionErr, submissionErr?.message).toBeNull();
      const submissionId = submissionRow!.id as string;
      submissionIds.push(submissionId);

      if (confirmationScreenshotUrl) {
        await screenshotManager.linkToSubmission(submissionId, service);
      }

      await service
        .from("submission_queue")
        .update({
          status: submissionStatus === "submitted" ? "completed" : "failed",
          error_message: submissionStatus === "submitted" ? null : errorMessage,
          completed_at: new Date().toISOString(),
          submission_id: submissionId,
        })
        .eq("id", queueItemId);

      return {
        queueItemId,
        sessionId: sessionId as string,
        submissionId,
        outcome,
        status: submissionStatus,
        confirmationNumber,
        confirmationScreenshotUrl,
        errorMessage,
        postsToPortal: portal.posts.length - postsBefore,
        mutexConflict: mutex.conflict,
        validation,
      };
    }

    it(
      "ASSERTION 1 (HAPPY PATH): complete data produces exactly one POST with every required field non-empty, outcome==='submitted', a confirmation number AND a screenshot path, and a terminal session",
      async () => {
        const requestProfile: RequestProfile = {
          request_type: "monetary",
          name: `E2E Complete Request ${tag}`,
          needs_description: `General operating support for our emergency shelter program ${tag}`,
        };

        const run = await runPipelineItem({
          orgId: orgCompleteId,
          funderId: funderHappyId,
          portalUrl: `${portal.baseUrl}/apply`,
          requestProfileId: requestProfileCompleteId,
          requestProfile,
        });

        expect(run.mutexConflict, "mutual-exclusion guard incorrectly reported a conflict for a fresh org+funder").toBe(
          false,
        );
        expect(run.validation.valid, `SubmissionValidator rejected well-formed data: ${JSON.stringify(run.validation.errors)}`).toBe(
          true,
        );

        expect(run.postsToPortal, "exactly one POST must reach the portal").toBe(1);
        const posted = portal.posts[portal.posts.length - 1]!.body;
        expect(posted["org_name"], `org_name was empty: ${JSON.stringify(posted)}`).toBeTruthy();
        expect(posted["ein"], `ein was empty: ${JSON.stringify(posted)}`).toBeTruthy();
        expect(posted["contact_email"], `contact_email was empty: ${JSON.stringify(posted)}`).toBeTruthy();
        expect(posted["description"], `description was empty: ${JSON.stringify(posted)}`).toBeTruthy();
        expect(posted["description"]).toContain(tag);

        expect(run.outcome).toBe("submitted");
        expect(run.status).toBe("submitted");
        expect(run.confirmationNumber, "no confirmation number was recorded").toBeTruthy();
        expect(run.confirmationScreenshotUrl, "no screenshot path was recorded").toBeTruthy();

        const { data: submissionRow } = await service
          .from("autoapply_submissions")
          .select("status, confirmation_number, confirmation_screenshot_url")
          .eq("id", run.submissionId)
          .single();
        expect(submissionRow?.status).toBe("submitted");
        expect(submissionRow?.confirmation_number).toBeTruthy();
        expect(submissionRow?.confirmation_screenshot_url).toBeTruthy();

        const { data: sessionRow } = await service
          .from("automation_sessions")
          .select("status, completed_at")
          .eq("id", run.sessionId)
          .single();
        expect(["submitted", "failed"], "session must end terminal").toContain(sessionRow?.status);
        expect(sessionRow?.status).toBe("submitted");
        expect(sessionRow?.completed_at).toBeTruthy();

        happyFormTemplateId = (
          await service.from("autoapply_submissions").select("form_template_id").eq("id", run.submissionId).single()
        ).data?.form_template_id as string;
      },
      150000,
    );

    it(
      "ASSERTION 2 (INCOMPLETE): data missing a required field (EIN) throws IncompleteSubmissionError, zero POSTs reach the portal, status is not 'submitted', and the session still ends terminal",
      async () => {
        const requestProfile: RequestProfile = {
          request_type: "monetary",
          name: `E2E Incomplete Request ${tag}`,
          needs_description: `Incomplete-submission regression test ${tag}`,
        };

        const run = await runPipelineItem({
          orgId: orgIncompleteId,
          funderId: funderIncompleteId,
          portalUrl: `${portal.baseUrl}/apply`,
          requestProfileId: requestProfileIncompleteId,
          requestProfile,
        });

        expect(run.outcome).toBe("incomplete");
        expect(run.errorMessage, "no error was recorded for the incomplete submission").toBeTruthy();
        expect(run.errorMessage).toMatch(/ein/i);
        expect(run.postsToPortal, "the portal must never receive a POST for a known-incomplete submission").toBe(0);

        expect(run.status).not.toBe("submitted");
        expect(run.confirmationNumber).toBeNull();

        const { data: submissionRow } = await service
          .from("autoapply_submissions")
          .select("status, confirmation_number, error_message")
          .eq("id", run.submissionId)
          .single();
        expect(submissionRow?.status).not.toBe("submitted");
        expect(submissionRow?.confirmation_number).toBeNull();
        expect(submissionRow?.error_message, "row must record why no submission happened").toBeTruthy();

        const { data: sessionRow } = await service
          .from("automation_sessions")
          .select("status, completed_at")
          .eq("id", run.sessionId)
          .single();
        expect(["submitted", "failed"], "session must end terminal even on a thrown IncompleteSubmissionError").toContain(
          sessionRow?.status,
        );
        expect(sessionRow?.status).toBe("failed");
        expect(sessionRow?.completed_at).toBeTruthy();

        const { data: queueRow } = await service
          .from("submission_queue")
          .select("status")
          .eq("id", run.queueItemId)
          .single();
        expect(queueRow?.status).toBe("failed");
      },
      150000,
    );

    it(
      "ASSERTION 3 (UNVERIFIED): a submit producing no navigation/POST yields outcome 'unverified', which maps to 'submit_unverified' — never 'submitted'",
      async () => {
        const requestProfile: RequestProfile = {
          request_type: "monetary",
          name: `E2E Unverified Request ${tag}`,
          needs_description: `Unverified-submission regression test ${tag}`,
        };

        const run = await runPipelineItem({
          orgId: orgCompleteId,
          funderId: funderUnverifiedId,
          portalUrl: `${portal.baseUrl}/apply-unverified`,
          requestProfileId: requestProfileCompleteId,
          requestProfile,
        });

        expect(run.outcome).toBe("unverified");
        expect(run.postsToPortal, "onsubmit=false must block the real POST").toBe(0);
        expect(run.errorMessage).toBeTruthy();

        expect(mapFillOutcomeToStatus("unverified")).toBe("submit_unverified");
        expect(run.status).toBe("submit_unverified");
        expect(run.status).not.toBe("submitted");
        expect(run.confirmationNumber).toBeNull();

        const { data: submissionRow } = await service
          .from("autoapply_submissions")
          .select("status, confirmation_number")
          .eq("id", run.submissionId)
          .single();
        expect(submissionRow?.status).toBe("submit_unverified");
        expect(submissionRow?.status).not.toBe("submitted");
        expect(submissionRow?.confirmation_number).toBeNull();

        const { data: sessionRow } = await service
          .from("automation_sessions")
          .select("status, completed_at")
          .eq("id", run.sessionId)
          .single();
        expect(sessionRow?.status).toBe("failed");
        expect(sessionRow?.completed_at).toBeTruthy();
      },
      150000,
    );

    it(
      "ASSERTION 4 (ARRAY MAPPING): the real FormAnalyzerAgent output used in ASSERTION 1's actual successful submission is array-shaped and produces a non-empty filler map (AR-3.1 CAUSE 1 regression guard)",
      async () => {
        expect(happyFormTemplateId, "ASSERTION 1 must run first and populate this").toBeTruthy();

        const { data: templateRow, error } = await service
          .from("form_templates")
          .select("field_mapping")
          .eq("id", happyFormTemplateId)
          .single();
        expect(error, error?.message).toBeNull();

        const realFieldMapping = templateRow!.field_mapping;
        expect(Array.isArray(realFieldMapping), "FormAnalyzerAgent always stores an array").toBe(true);
        expect((realFieldMapping as unknown[]).length).toBeGreaterThan(0);

        // extractFieldMapping is private — the exact adapter AR-3.1 CAUSE 1
        // broke (it used to discard any array unconditionally and return {}
        // every time, so fillPageFields() iterated zero fields on every real
        // run). Reflection is the only way to exercise it directly.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const filler = new FormFillerAgent(service, {} as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const extracted = (filler as any).extractFieldMapping({
          field_mapping: realFieldMapping,
        }) as Record<string, string>;

        expect(
          Object.keys(extracted).length,
          `extractFieldMapping() must not discard a real array field_mapping; got: ${JSON.stringify(extracted)}`,
        ).toBeGreaterThan(0);
        expect(extracted["organization.name"], JSON.stringify(extracted)).toMatch(/org_name/);
        expect(extracted["organization.ein"], JSON.stringify(extracted)).toMatch(/ein/);
        expect(extracted["organization.contact_email"], JSON.stringify(extracted)).toMatch(/contact_email/);
        expect(extracted["request.description"], JSON.stringify(extracted)).toMatch(/description/);
      },
      30000,
    );

    it(
      "ASSERTION 5 (NO FALSE SUCCESS): every autoapply_submissions row created by this suite either has a confirmation number, or an explicit recorded reason for its absence — never neither",
      async () => {
        expect(submissionIds.length, "prior assertions must have run and created rows").toBeGreaterThan(0);

        const { data: rows, error } = await service
          .from("autoapply_submissions")
          .select("id, status, confirmation_number, error_message")
          .in("id", submissionIds);
        expect(error, error?.message).toBeNull();
        expect(rows?.length).toBe(submissionIds.length);

        for (const row of rows ?? []) {
          if (row.status === "submitted") {
            expect(
              row.confirmation_number,
              `row ${row.id} claims status='submitted' with no confirmation number — exactly the original P0`,
            ).toBeTruthy();
          } else {
            expect(
              row.error_message,
              `row ${row.id} has status='${row.status}' (not submitted) but no recorded reason why`,
            ).toBeTruthy();
          }
          // The invariant this whole suite exists to prove, stated directly:
          // a row can never claim success with neither evidence nor an excuse.
          const hasEvidence = Boolean(row.confirmation_number);
          const hasExcuse = Boolean(row.error_message);
          expect(
            hasEvidence || hasExcuse,
            `row ${row.id} (status='${row.status}') has neither a confirmation number nor a recorded reason`,
          ).toBe(true);
        }
      },
      30000,
    );
  },
);

if (!CREDS_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[autoapply-end-to-end.test] skipped entirely — .env.local is missing NEXT_PUBLIC_SUPABASE_URL / " +
      "SUPABASE_SERVICE_ROLE_KEY / ANTHROPIC_API_KEY",
  );
}
