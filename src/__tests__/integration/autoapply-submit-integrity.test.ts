import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import dotenv from "dotenv";

// tests/setup.ts globally mocks @anthropic-ai/sdk for every vitest file so
// ordinary unit tests never make a real network call. Assertion 4 below
// needs a real FormAnalyzerAgent run (real Claude output) to regression-guard
// the real production field_mapping shape, so this restores the real module
// before any of the imports below are evaluated (vi.mock/vi.unmock calls are
// hoisted by Vitest's transform).
vi.unmock("@anthropic-ai/sdk");

// worker/index.ts runs validateEnv() (process.exit(1) on missing env vars,
// e.g. WORKER_ID — never set under vitest) as a top-level side effect at
// import time, and worker/rate-limiter.ts (a queue-processor.ts collaborator)
// imports `supabase` from it — so merely importing mapFillOutcomeToStatus
// from worker/queue-processor.ts below would kill the whole vitest process.
// Same guard as src/__tests__/unit/autoapply-queue-gating.test.ts.
vi.mock("../../../worker/index", () => ({ supabase: {} }));

import { StealthBrowser } from "@/lib/autoapply/stealth-browser";
import { FormAnalyzerAgent } from "@/lib/autoapply/form-analyzer-agent";
import {
  FormFillerAgent,
  IncompleteSubmissionError,
  type RequestProfile,
} from "@/lib/autoapply/form-filler-agent";
import { mapFillOutcomeToStatus } from "../../../worker/queue-processor";

/**
 * AR-3.1: regression suite for the three root causes behind AutoApply
 * reporting a submission it never made (see BENAVORA_AGENT_AUDIT /
 * governance docs for the full incident writeup):
 *
 *   CAUSE 1 — extractFieldMapping() silently discarded FormAnalyzerAgent's
 *   real array-shaped field_mapping, so fillPageFields() iterated zero
 *   fields on every real run.
 *   CAUSE 2 — submitForm() clicked and returned without ever checking
 *   whether the click actually produced a submission.
 *   CAUSE 3 — fillAndSubmit()'s empty catch swallowed submit failures, and
 *   the caller (worker/queue-processor.ts) set status='submitted'
 *   unconditionally on return.
 *
 * Deliberately does NOT depend on any external host (unlike the sibling
 * form-analyzer-filler.test.ts, which uses httpbin.org/forms/post — a page
 * with no `required` attributes, which is exactly why it could not have
 * caught any of the three causes above). This suite serves its own local
 * HTTP form with real HTML5 `required` attributes on every field.
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
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || localEnv.ANTHROPIC_API_KEY;
if (ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY) {
  process.env.ANTHROPIC_API_KEY = ANTHROPIC_API_KEY;
}
const CREDS_AVAILABLE = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY && ANTHROPIC_API_KEY);

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface ReceivedPost {
  body: Record<string, string>;
}

interface LocalFormServer {
  baseUrl: string;
  posts: ReceivedPost[];
  close: () => Promise<void>;
}

/**
 * Serves three pages, none reachable from outside this process:
 *  - /form-incomplete: org_name (required text, mappable) + attachment
 *    (required file — deliberately never attached by any test here, and
 *    excluded from both the direct-mapping and Claude-fallback fill paths
 *    by construction, so it stays empty deterministically).
 *  - /form-complete: org_name + message, both required and both mapped —
 *    a real submit POSTs to /post, which echoes the body back and is also
 *    recorded server-side for assertion.
 *  - /form-unverified: identical fields to /form-complete, but
 *    onsubmit="return false" blocks the browser's real navigation/POST,
 *    simulating a client-side handler silently swallowing the submit.
 */
function startLocalFormServer(): Promise<LocalFormServer> {
  const posts: ReceivedPost[] = [];

  const page = (formAction: string, blockSubmit: boolean, includeFileField: boolean) => `<!doctype html>
<html><body>
<form action="${formAction}" method="POST"${blockSubmit ? ' onsubmit="return false;"' : ""}>
  <label for="org_name">Organization Name</label>
  <input type="text" id="org_name" name="org_name" required />
  ${
    includeFileField
      ? '<label for="attachment">Required Attachment</label><input type="file" id="attachment" name="attachment" required />'
      : '<label for="message">Project Description</label><textarea id="message" name="message" required></textarea>'
  }
  <button type="submit">Submit</button>
</form>
</body></html>`;

  const server = http.createServer((req, res) => {
    const urlPath = (req.url ?? "/").split("?")[0];

    if (req.method === "GET" && urlPath === "/form-incomplete") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(page("/post", false, true));
      return;
    }

    if (req.method === "GET" && urlPath === "/form-complete") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(page("/post", false, false));
      return;
    }

    if (req.method === "GET" && urlPath === "/form-unverified") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(page("/post", true, false));
      return;
    }

    if (req.method === "POST" && urlPath === "/post") {
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += chunk.toString("utf8");
      });
      req.on("end", () => {
        const parsedBody = Object.fromEntries(new URLSearchParams(raw));
        posts.push({ body: parsedBody });
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          `<!doctype html><html><body><h1>Thank you</h1><p>Reference: TEST-CONFIRM-${
            parsedBody["org_name"] ?? ""
          }</p></body></html>`,
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
  "AutoApply submit integrity (AR-3.1) — local required-field form, real Playwright + real Claude",
  () => {
    let service: SupabaseClient;
    let formServer: LocalFormServer;
    const tag = randomSuffix();
    const orgIds: string[] = [];
    const funderIds: string[] = [];
    const formTemplateIds: string[] = [];
    const automationSessionIds: string[] = [];

    let orgId: string;
    let funderId: string;

    beforeAll(async () => {
      formServer = await startLocalFormServer();

      service = createClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data: org, error: orgErr } = await service
        .from("organizations")
        .insert({
          name: `AUTOAPPLY_SUBMIT_INTEGRITY_${tag}`,
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
          name: `AUTOAPPLY_SUBMIT_INTEGRITY_FUNDER_${tag}`,
          category: "private_foundation",
          giving_portal_url: `${formServer.baseUrl}/form-complete`,
        })
        .select()
        .single();
      expect(funderErr, funderErr?.message).toBeNull();
      funderId = funder!.id as string;
      funderIds.push(funderId);
    }, 30000);

    afterAll(async () => {
      if (formServer) await formServer.close();
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

    async function createApprovedSession(targetUrl: string): Promise<string> {
      const { data: session, error } = await service
        .from("automation_sessions")
        .insert({
          organization_id: orgId,
          funder_id: funderId,
          target_url: targetUrl,
          session_type: "form_fill",
          status: "approved",
          mapped_fields: [],
          unmapped_fields: [],
          started_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      expect(error, error?.message).toBeNull();
      const id = session!.id as string;
      automationSessionIds.push(id);
      return id;
    }

    it(
      "ASSERTION 1: incomplete fill data throws IncompleteSubmissionError and the server receives zero POST requests",
      async () => {
        const stealthBrowser = new StealthBrowser({ headless: true });
        const { browser, page, context } = await stealthBrowser.launch();
        try {
          await page.goto(`${formServer.baseUrl}/form-incomplete`, { waitUntil: "domcontentloaded" });

          const sessionId = await createApprovedSession(`${formServer.baseUrl}/form-incomplete`);
          const postsBefore = formServer.posts.length;

          // Only org_name is mapped — the required file-upload field is
          // deliberately left with no matching document anywhere in this
          // test, and is excluded by construction from both the direct
          // field_mapping path and the Claude-driven unmapped-field
          // fallback (file inputs are filtered out of both), so it is
          // guaranteed to stay empty regardless of any AI behavior.
          const template = {
            field_mapping: {
              "organization.name": '[name="org_name"]',
            },
          };
          const requestProfile: RequestProfile = {
            request_type: "monetary",
            name: `Incomplete Test ${tag}`,
            needs_description: `incomplete-submission test ${tag}`,
          };

          const filler = new FormFillerAgent(service, stealthBrowser);
          let thrown: unknown = null;
          try {
            await filler.fillAndSubmit({
              page,
              template,
              organizationId: orgId,
              funderId,
              requestProfile,
              sessionId,
            });
          } catch (err) {
            thrown = err;
          }

          expect(thrown).toBeInstanceOf(IncompleteSubmissionError);
          expect((thrown as Error).message).toMatch(/attachment/i);
          expect(
            formServer.posts.length,
            "the local server must never receive a POST for a known-incomplete submission",
          ).toBe(postsBefore);
        } finally {
          await context.close().catch(() => null);
          await browser.close().catch(() => null);
        }
      },
      90000,
    );

    it(
      "ASSERTION 2: complete fill data produces exactly one POST with every required field non-empty and outcome==='submitted'",
      async () => {
        const stealthBrowser = new StealthBrowser({ headless: true });
        const { browser, page, context } = await stealthBrowser.launch();
        try {
          await page.goto(`${formServer.baseUrl}/form-complete`, { waitUntil: "domcontentloaded" });

          const sessionId = await createApprovedSession(`${formServer.baseUrl}/form-complete`);
          const postsBefore = formServer.posts.length;

          const template = {
            field_mapping: {
              "organization.name": '[name="org_name"]',
              "request.description": '[name="message"]',
            },
          };
          const uniqueDescription = `General operating support ${tag}`;
          const requestProfile: RequestProfile = {
            request_type: "monetary",
            name: `Complete Test ${tag}`,
            needs_description: uniqueDescription,
          };

          const filler = new FormFillerAgent(service, stealthBrowser);
          const result = await filler.fillAndSubmit({
            page,
            template,
            organizationId: orgId,
            funderId,
            requestProfile,
            sessionId,
          });

          expect(result.outcome).toBe("submitted");
          expect(formServer.posts.length).toBe(postsBefore + 1);

          const posted = formServer.posts[formServer.posts.length - 1]!.body;
          expect(posted["org_name"], `org_name was empty in: ${JSON.stringify(posted)}`).toBeTruthy();
          expect(posted["message"], `message was empty in: ${JSON.stringify(posted)}`).toBeTruthy();
          expect(posted["org_name"]).toContain(tag);
          expect(posted["message"]).toContain(tag);
        } finally {
          await context.close().catch(() => null);
          await browser.close().catch(() => null);
        }
      },
      90000,
    );

    it(
      "ASSERTION 3: a submit with no navigation/response yields outcome 'unverified', which queue-processor maps to 'submit_unverified' (not 'submitted')",
      async () => {
        const stealthBrowser = new StealthBrowser({ headless: true });
        const { browser, page, context } = await stealthBrowser.launch();
        try {
          await page.goto(`${formServer.baseUrl}/form-unverified`, { waitUntil: "domcontentloaded" });

          const sessionId = await createApprovedSession(`${formServer.baseUrl}/form-unverified`);
          const postsBefore = formServer.posts.length;

          const template = {
            field_mapping: {
              "organization.name": '[name="org_name"]',
              "request.description": '[name="message"]',
            },
          };
          const requestProfile: RequestProfile = {
            request_type: "monetary",
            name: `Unverified Test ${tag}`,
            needs_description: `unverified-submission test ${tag}`,
          };

          const filler = new FormFillerAgent(service, stealthBrowser);
          const result = await filler.fillAndSubmit({
            page,
            template,
            organizationId: orgId,
            funderId,
            requestProfile,
            sessionId,
          });

          expect(result.outcome).toBe("unverified");
          expect(result.submitFailureReason).toBeTruthy();
          expect(formServer.posts.length, "onsubmit=false must block the real POST").toBe(postsBefore);

          // Direct regression guard on the queue processor's status mapping —
          // this is the exact function worker/queue-processor.ts calls to
          // decide what status to persist from fillResult.outcome.
          expect(mapFillOutcomeToStatus(result.outcome)).toBe("submit_unverified");
          expect(mapFillOutcomeToStatus(result.outcome)).not.toBe("submitted");
        } finally {
          await context.close().catch(() => null);
          await browser.close().catch(() => null);
        }
      },
      45000,
    );

    it(
      "ASSERTION 4: an array-shaped field_mapping from the real FormAnalyzerAgent output produces a non-empty filler map (CAUSE 1 regression guard)",
      async () => {
        const stealthBrowser = new StealthBrowser({ headless: true });
        const { browser, page, context } = await stealthBrowser.launch();
        try {
          await page.goto(`${formServer.baseUrl}/form-complete`, { waitUntil: "domcontentloaded" });

          const analyzer = new FormAnalyzerAgent(service);
          const analyzed = await analyzer.analyzeAndStore({
            page,
            portalUrl: `${formServer.baseUrl}/form-complete`,
            funderId,
            organizationId: orgId,
          });
          formTemplateIds.push(analyzed.id);

          const { data: templateRow, error } = await service
            .from("form_templates")
            .select("field_mapping")
            .eq("id", analyzed.id)
            .single();
          expect(error, error?.message).toBeNull();

          const realFieldMapping = templateRow!.field_mapping;
          // eslint-disable-next-line no-console
          console.log(
            "[autoapply-submit-integrity.test] real FormAnalyzerAgent field_mapping:",
            JSON.stringify(realFieldMapping, null, 2),
          );
          expect(Array.isArray(realFieldMapping), "FormAnalyzerAgent always stores an array").toBe(true);

          const filler = new FormFillerAgent(service, stealthBrowser);
          // extractFieldMapping is private — this is the exact adapter CAUSE 1
          // broke (it previously discarded any array unconditionally and
          // returned {} every time). Reflection is the only way to exercise
          // it directly against the real analyzer output without re-running
          // the entire fill/submit pipeline just to prove this one function
          // stopped being a silent no-op.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const extracted = (filler as any).extractFieldMapping({
            field_mapping: realFieldMapping,
          }) as Record<string, string>;

          expect(
            Object.keys(extracted).length,
            `extractFieldMapping() must not discard a real array field_mapping; got: ${JSON.stringify(extracted)}`,
          ).toBeGreaterThan(0);
          expect(extracted["organization.name"], JSON.stringify(extracted)).toMatch(/org_name/);
          expect(extracted["request.description"], JSON.stringify(extracted)).toMatch(/message/);
        } finally {
          await context.close().catch(() => null);
          await browser.close().catch(() => null);
        }
      },
      120000,
    );
  },
);

if (!CREDS_AVAILABLE) {
  // eslint-disable-next-line no-console
  console.warn(
    "[autoapply-submit-integrity.test] skipped entirely — .env.local is missing NEXT_PUBLIC_SUPABASE_URL / " +
      "SUPABASE_SERVICE_ROLE_KEY / ANTHROPIC_API_KEY",
  );
}
