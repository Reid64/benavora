import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import type { Page } from "playwright";

// tests/setup.ts globally mocks @anthropic-ai/sdk for every vitest file so
// ordinary unit tests never make a real network call. This suite exists
// specifically to prove the real Claude-driven field analysis and field
// filling actually work, so it needs the real SDK, not the mock. vi.mock /
// vi.unmock calls are hoisted by Vitest's transform, so this restores the
// real module for this file's module graph before any of the imports below
// (which transitively import '@anthropic-ai/sdk') are evaluated.
vi.unmock("@anthropic-ai/sdk");

import { StealthBrowser } from "@/lib/autoapply/stealth-browser";
import { FormAnalyzerAgent } from "@/lib/autoapply/form-analyzer-agent";
import { FormFillerAgent, type RequestProfile } from "@/lib/autoapply/form-filler-agent";

/**
 * Live, non-mocked end-to-end test of FormAnalyzerAgent (src/lib/autoapply/
 * form-analyzer-agent.ts) and FormFillerAgent (src/lib/autoapply/
 * form-filler-agent.ts) — the two agents AUTOAPPLY_ARCHITECTURE_V2.md and
 * worker/queue-processor.ts wire together to analyze a funder portal and
 * fill/submit its form. Nothing here is mocked: a real Chromium browser via
 * StealthBrowser, real calls to the Anthropic API, and a real HTTP POST to a
 * safe public target (https://httpbin.org/forms/post — the same dummy-form
 * endpoint DEMO_READINESS_AUDIT.md §2/§5/§7 and autoapply-queue.test.ts use,
 * specifically so a real submission never reaches an actual foundation's
 * live donation portal). httpbin echoes back whatever was POSTed as JSON at
 * https://httpbin.org/post, which this suite parses to verify the actual
 * values Playwright typed into the DOM actually made it into the request —
 * not just that no exception was thrown.
 *
 * Real bug found and verified live while building this suite (see the first
 * test below): worker/queue-processor.ts calls
 * `stealthBrowser.launch()` (which returns a fresh page on about:blank) and
 * then, on the fresh-analysis branch, calls `analyzer.analyzeAndStore()`
 * DIRECTLY — there is exactly one `page.goto()` call in the entire file
 * (queue-processor.ts:1120), and it is gated behind `if (!needsReanalysis)`,
 * i.e. the CACHED-template branch that skips the analyzer entirely. The
 * fresh-analysis branch that actually calls FormAnalyzerAgent never
 * navigates the page to the funder's portal first. FormAnalyzerAgent itself
 * never navigates either — analyzeAndStore() only reads whatever the page's
 * current DOM already is. So in production, every FIRST-TIME (or
 * stale-template-refresh) form analysis runs against a blank page, not the
 * real portal.
 *
 * No separate test Supabase project exists (.env.test isn't running, same
 * as every other suite in this directory) — this runs against the real
 * production database via the service-role client. All rows created here
 * are deleted in afterAll via try/catch (not .catch()), per project memory
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
// Anthropic() (used by FormAnalyzerAgent, FormFillerAgent, confirmation-parser.ts)
// reads process.env directly rather than taking a key parameter — mirror it in.
if (ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) {
  process.env.ANTHROPIC_API_KEY = ANTHROPIC_API_KEY;
}
const CREDS_AVAILABLE = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && ANTHROPIC_API_KEY);

const FORM_URL = "https://httpbin.org/forms/post";
const POST_ECHO_URL = "https://httpbin.org/post";

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * httpbin.org is a free public service with known intermittent 503s. Retries
 * with backoff rather than masking a real failure — if it's still down after
 * all attempts, the thrown error is the real, specific reason this suite
 * failed, not a silent pass.
 */
async function gotoWithRetry(page: Page, url: string, attempts = 4): Promise<void> {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      const status = resp?.status() ?? 0;
      if (status >= 500) {
        lastErr = new Error(`HTTP ${status} from ${url}`);
      } else {
        return;
      }
    } catch (e) {
      lastErr = e;
    }
    await new Promise((resolve) => setTimeout(resolve, 4000 * (i + 1)));
  }
  throw new Error(
    `gotoWithRetry: ${url} did not load after ${attempts} attempts: ` +
      `${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

interface FieldMappingEntry {
  fieldName: string;
  fieldLabel: string;
  fieldType: string;
  kbMapping: string;
  manualReviewRequired: boolean;
}

(CREDS_AVAILABLE ? describe : describe.skip)(
  "FormAnalyzerAgent + FormFillerAgent (live, real Playwright + real Claude)",
  () => {
    let service: SupabaseClient;
    const tag = randomSuffix();
    const orgIds: string[] = [];
    const funderIds: string[] = [];
    const formTemplateIds: string[] = [];
    const automationSessionIds: string[] = [];

    let orgId: string;
    let funderId: string;

    beforeAll(async () => {
      service = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data: org, error: orgErr } = await service
        .from("organizations")
        .insert({
          name: `AUTOAPPLY_TEST_FORM_FILLER_${tag}`,
          mission_statement: "Providing emergency and transitional housing assistance in rural Texas.",
          onboarding_progress: {},
        })
        .select()
        .single();
      expect(orgErr, orgErr?.message).toBeNull();
      orgId = org!.id as string;
      orgIds.push(orgId);

      const { data: funder, error: funderErr } = await service
        .from("funders")
        .insert({
          organization_id: orgId,
          name: `AUTOAPPLY_TEST_FUNDER_${tag}`,
          category: "private_foundation",
          giving_portal_url: FORM_URL,
        })
        .select()
        .single();
      expect(funderErr, funderErr?.message).toBeNull();
      funderId = funder!.id as string;
      funderIds.push(funderId);
    }, 30000);

    afterAll(async () => {
      if (!service) return;
      for (const id of automationSessionIds) {
        try {
          await service.from("automation_sessions").delete().eq("id", id);
        } catch {
          // best-effort cleanup
        }
      }
      for (const id of formTemplateIds) {
        try {
          await service.from("form_templates").delete().eq("id", id);
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
          await service.from("organizations").delete().match({ id });
        } catch {
          // best-effort cleanup
        }
      }
    }, 30000);

    it(
      "REAL PRODUCTION CALL PATTERN: FormAnalyzerAgent invoked on a fresh page exactly like " +
        "queue-processor.ts's fresh-analysis branch (no page.goto before it) — documents whether " +
        "this actually reaches the funder's form",
      async () => {
        const stealthBrowser = new StealthBrowser({ headless: true });
        const { browser, page, context } = await stealthBrowser.launch();
        try {
          // Deliberately NOT navigating — this mirrors worker/queue-processor.ts's
          // fresh-analysis branch (needsReanalysis === true), where
          // analyzer.analyzeAndStore() is called immediately after
          // stealthBrowser.launch() with no intervening page.goto(portalUrl).
          expect(page.url()).toBe("about:blank");

          const analyzer = new FormAnalyzerAgent(service);
          const result = await analyzer.analyzeAndStore({
            page,
            portalUrl: FORM_URL,
            funderId,
            organizationId: orgId,
          });
          formTemplateIds.push(result.id);

          const { data: row } = await service
            .from("form_templates")
            .select("*")
            .eq("id", result.id)
            .single();

          // eslint-disable-next-line no-console
          console.log(
            "[form-analyzer-filler.test] REAL production call pattern (no goto) result:",
            JSON.stringify(
              { fieldCount: result.fieldCount, formStructure: row?.form_structure, formAction: (row?.form_structure as { formAction?: string } | null)?.formAction },
              null,
              2,
            ),
          );

          // Real finding, verified live: with no navigation, the page is still
          // about:blank when analyzed, so the real funder form (custname,
          // custtel, custemail, size, topping, delivery, comments — 7 real
          // fields) cannot be found. This assertion documents the actual
          // observed production behavior rather than asserting an aspirational
          // "it works" that the real call site does not currently deliver.
          expect(result.fieldCount).toBeLessThan(5);
        } finally {
          await context.close().catch(() => null);
          await browser.close().catch(() => null);
        }
      },
      120000,
    );

    it(
      "FormAnalyzerAgent correctly identifies real form fields and KB mappings when given a loaded page",
      async () => {
        const stealthBrowser = new StealthBrowser({ headless: true });
        const { browser, page, context } = await stealthBrowser.launch();
        try {
          await gotoWithRetry(page, FORM_URL);
          expect(page.url()).toBe(FORM_URL);

          const analyzer = new FormAnalyzerAgent(service);
          const result = await analyzer.analyzeAndStore({
            page,
            portalUrl: FORM_URL,
            funderId,
            organizationId: orgId,
          });
          formTemplateIds.push(result.id);

          const { data: row, error } = await service
            .from("form_templates")
            .select("*")
            .eq("id", result.id)
            .single();
          expect(error, error?.message).toBeNull();
          expect(row).toBeTruthy();

          const fieldMapping = (row!.field_mapping as FieldMappingEntry[]) ?? [];

          // eslint-disable-next-line no-console
          console.log(
            "[form-analyzer-filler.test] Real field-mapping result for httpbin.org/forms/post:\n" +
              JSON.stringify(fieldMapping, null, 2),
          );
          // eslint-disable-next-line no-console
          console.log(
            "[form-analyzer-filler.test] automation_assessment:",
            JSON.stringify(row!.automation_assessment, null, 2),
          );

          // The real portal has 7 named input elements (custname, custtel,
          // custemail, size x3 radios, topping x4 checkboxes, delivery,
          // comments) grouped into some number of distinct fields >= 5 by any
          // reasonable extraction. This is the real Claude response, not a
          // fixture — asserting a floor rather than an exact count avoids
          // over-fitting to one run's exact phrasing while still proving real
          // extraction happened (a bug/blank page produces 0-2 fields, as
          // shown by the previous test).
          expect(result.fieldCount).toBeGreaterThanOrEqual(5);
          expect(fieldMapping.length).toBe(result.fieldCount);

          // Deterministic, code-level (not LLM-phrasing-dependent) checks: our
          // own mapLabel() regex in form-analyzer-agent.ts matches on
          // "email"/"phone|tel" substrings in `${label} ${name}`. httpbin's
          // real `name="custemail"` and `name="custtel"` attributes contain
          // those substrings regardless of how Claude phrases the label, so
          // these should reliably map correctly if field extraction worked.
          const emailField = fieldMapping.find(
            (f) => /email/i.test(f.fieldName) || /email/i.test(f.fieldLabel),
          );
          expect(emailField, `no email-like field found in: ${JSON.stringify(fieldMapping)}`).toBeTruthy();
          expect(emailField!.kbMapping).toBe("organizations.email");

          const phoneField = fieldMapping.find(
            (f) => /tel|phone/i.test(f.fieldName) || /tel|phone/i.test(f.fieldLabel),
          );
          expect(phoneField, `no phone/tel-like field found in: ${JSON.stringify(fieldMapping)}`).toBeTruthy();
          expect(phoneField!.kbMapping).toBe("organizations.phone");

          // Deterministic from the real, static HTML (no login wall, no file
          // upload field, single page) — not LLM-phrasing-dependent.
          expect(row!.is_multi_step).toBe(false);
          expect(row!.requires_login).toBe(false);
          expect(row!.requires_file_upload).toBe(false);

          // No ToS/anti-automation language exists anywhere on this page.
          const assessment = row!.automation_assessment as { prohibits_automation: boolean };
          expect(assessment.prohibits_automation).toBe(false);
        } finally {
          await context.close().catch(() => null);
          await browser.close().catch(() => null);
        }
      },
      120000,
    );

    it(
      "FormFillerAgent fills real values and completes a real submission verified via httpbin's echo response",
      async () => {
        const stealthBrowser = new StealthBrowser({ headless: true });
        const { browser, page, context } = await stealthBrowser.launch();
        try {
          await gotoWithRetry(page, FORM_URL);

          // Use the REAL stored template from the previous test's analyzer run
          // if available (same shape queue-processor.ts loads via `SELECT *
          // FROM form_templates`), otherwise analyze fresh — either way this
          // exercises the real template shape FormFillerAgent receives in
          // production (field_mapping stored as an ARRAY of
          // {fieldName,fieldLabel,...} objects by FormAnalyzerAgent).
          let templateId = formTemplateIds[formTemplateIds.length - 1];
          if (!templateId) {
            const analyzer = new FormAnalyzerAgent(service);
            const analyzed = await analyzer.analyzeAndStore({
              page,
              portalUrl: FORM_URL,
              funderId,
              organizationId: orgId,
            });
            templateId = analyzed.id;
            formTemplateIds.push(templateId);
          }
          const { data: templateRow, error: templateErr } = await service
            .from("form_templates")
            .select("*")
            .eq("id", templateId)
            .single();
          expect(templateErr, templateErr?.message).toBeNull();
          const template = templateRow as Record<string, unknown>;

          // Real finding, verified by direct code read of form-filler-agent.ts's
          // extractFieldMapping(): it only accepts template.field_mapping when
          // it is a plain, non-array object (`Record<string, string>` of
          // benavoraField -> CSS selector). FormAnalyzerAgent always stores
          // field_mapping as an ARRAY (FieldMappingEntry[]), so
          // extractFieldMapping()'s own `!Array.isArray(raw)` check discards
          // it every time and starts from an empty mapping. Confirmed here
          // against the REAL row just read back from the database, not a
          // hypothetical.
          expect(Array.isArray(template["field_mapping"])).toBe(true);

          // Approve the automation_sessions row up front, mirroring
          // createApprovedAutomationSession() in queue-processor.ts — the real
          // gate fillAndSubmit() enforces per BEHAVIORAL_CONTRACTS §18.
          const { data: session, error: sessionErr } = await service
            .from("automation_sessions")
            .insert({
              organization_id: orgId,
              funder_id: funderId,
              target_url: FORM_URL,
              session_type: "form_fill",
              status: "approved",
              mapped_fields: [],
              unmapped_fields: [],
              started_at: new Date().toISOString(),
            })
            .select("id")
            .single();
          expect(sessionErr, sessionErr?.message).toBeNull();
          const sessionId = session!.id as string;
          automationSessionIds.push(sessionId);

          const uniqueDescription = `General operating support for AutoApply pipeline integration test ${tag}.`;
          const requestProfile: RequestProfile = {
            request_type: "monetary",
            name: `Test Operating Support ${tag}`,
            needs_description: uniqueDescription,
            pitch_template: null,
            form_field_overrides: {},
          };

          const filler = new FormFillerAgent(service, stealthBrowser);
          const fillResult = await filler.fillAndSubmit({
            page,
            template,
            organizationId: orgId,
            funderId,
            requestProfile,
            sessionId,
          });

          // eslint-disable-next-line no-console
          console.log(
            "[form-analyzer-filler.test] fillAndSubmit() result:",
            JSON.stringify(fillResult, null, 2),
          );
          // eslint-disable-next-line no-console
          console.log("[form-analyzer-filler.test] post-submit page URL:", page.url());

          // Real proof of a real submission: httpbin's <form action> posts to
          // /post, which the browser navigates to on submit and which echoes
          // the exact posted body back as JSON. If the submit button click
          // never fired (silent failure), the URL would still be
          // httpbin.org/forms/post.
          expect(page.url()).toBe(POST_ECHO_URL);

          const bodyText = await page.evaluate(() => document.body.innerText);
          let echoed: { form?: Record<string, string> };
          try {
            echoed = JSON.parse(bodyText) as { form?: Record<string, string> };
          } catch {
            throw new Error(
              `httpbin /post response was not valid JSON — submission may not have completed. Body: ${bodyText.slice(0, 500)}`,
            );
          }
          const submittedForm = echoed.form ?? {};

          // eslint-disable-next-line no-console
          console.log(
            "[form-analyzer-filler.test] httpbin echoed submitted form fields:",
            JSON.stringify(submittedForm, null, 2),
          );

          // The org's real name and the request's unique description are the
          // two values FormFillerAgent had genuine data for (buildFillData()
          // only populates 'organization.name', the hardcoded tax_status
          // default, and request.* from the passed requestProfile — its KB
          // lookup queries the nonexistent 'knowledge_base_entries' table,
          // confirmed separately, so every other KB-sourced field is empty).
          // Both are tagged with the unique test suffix so a real Claude copy
          // (not a coincidental partial string) is required to pass.
          const custname = submittedForm["custname"] ?? "";
          const comments = submittedForm["comments"] ?? "";

          expect(
            custname.includes(tag),
            `expected httpbin's echoed custname field to contain the test org name (tag "${tag}"); got: "${custname}"`,
          ).toBe(true);
          expect(
            comments.includes(tag),
            `expected httpbin's echoed comments field to contain the test request description (tag "${tag}"); got: "${comments}"`,
          ).toBe(true);
        } finally {
          await context.close().catch(() => null);
          await browser.close().catch(() => null);
        }
      },
      180000,
    );

    it(
      "FormFillerAgent reports a specific failure reason (not a silent skip) when the automation session isn't approved",
      async () => {
        const stealthBrowser = new StealthBrowser({ headless: true });
        const { browser, page, context } = await stealthBrowser.launch();
        try {
          await gotoWithRetry(page, FORM_URL);

          const { data: session, error: sessionErr } = await service
            .from("automation_sessions")
            .insert({
              organization_id: orgId,
              funder_id: funderId,
              target_url: FORM_URL,
              session_type: "form_fill",
              status: "pending", // never approved
              mapped_fields: [],
              unmapped_fields: [],
              started_at: new Date().toISOString(),
            })
            .select("id")
            .single();
          expect(sessionErr, sessionErr?.message).toBeNull();
          const unapprovedSessionId = session!.id as string;
          automationSessionIds.push(unapprovedSessionId);

          const filler = new FormFillerAgent(service, stealthBrowser);

          await expect(
            filler.fillAndSubmit({
              page,
              template: { field_mapping: {} },
              organizationId: orgId,
              funderId,
              requestProfile: {
                request_type: "monetary",
                name: "Test",
                needs_description: `unapproved-session test ${tag}`,
              },
              sessionId: unapprovedSessionId,
            }),
          ).rejects.toThrow("Submission blocked: session not approved");

          // Also verify the omitted-sessionId path throws the same specific,
          // non-silent error rather than defaulting to "submit anyway".
          await expect(
            filler.fillAndSubmit({
              page,
              template: { field_mapping: {} },
              organizationId: orgId,
              funderId,
              requestProfile: {
                request_type: "monetary",
                name: "Test",
                needs_description: `no-session test ${tag}`,
              },
            }),
          ).rejects.toThrow("Submission blocked: session not approved");

          // Prove this was a governance block, not a real submission: the page
          // never left the form (no navigation to /post occurred).
          expect(page.url()).toBe(FORM_URL);
        } finally {
          await context.close().catch(() => null);
          await browser.close().catch(() => null);
        }
      },
      90000,
    );
  },
);

if (!CREDS_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[form-analyzer-filler.test] skipped entirely — .env.local is missing NEXT_PUBLIC_SUPABASE_URL / " +
      "SUPABASE_SERVICE_ROLE_KEY / ANTHROPIC_API_KEY",
  );
}
