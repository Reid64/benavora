// Submission verification - Phase 3 browser automation.
//
// After a form is submitted and approved, monitors the page for up to 60 s
// watching for success or failure indicators. Captures a full-page screenshot,
// uses Claude to extract any confirmation number, and updates the application
// record. Returns a SubmissionResult (BEHAVIORAL_CONTRACTS Â§18).

import type { Page } from "playwright";
import type { SupabaseClient } from "@supabase/supabase-js";

import { callClaude } from "@/lib/ai/claude";

// --- public types ------------------------------------------------------------

export interface SubmissionResult {
  success: boolean;
  confirmation_number: string | null;
  /** Supabase Storage path of the result screenshot. */
  screenshot: string;
  /** Visible page text at verification time (first 5 000 chars). */
  page_text: string;
  error: string | null;
}

export interface VerifySubmissionOptions {
  page: Page;
  client: SupabaseClient;
  sessionId: string;
  applicationId: string | null;
  organizationId: string;
  /** Monitoring window in ms. Defaults to 60 000. */
  timeoutMs?: number;
}

// --- detection vocabulary ----------------------------------------------------

const SUCCESS_SELECTORS = [
  "[class*='confirmation']",
  "[class*='success']",
  "[id*='confirmation']",
  "[id*='success']",
  "[class*='thank']",
  "[data-testid*='confirmation']",
  "[data-testid*='success']",
];

const FAILURE_SELECTORS = [
  "[class*='error-message']",
  "[class*='form-error']",
  "[class*='alert-danger']",
  "[class*='validation-error']",
];

const SUCCESS_PHRASES = [
  "thank you",
  "submission received",
  "successfully submitted",
  "application submitted",
  "submission complete",
  "we have received your",
  "your application has been submitted",
  "confirmation number",
  "reference number",
  "submission id",
  "confirmation #",
];

const FAILURE_PHRASES = [
  "submission failed",
  "could not submit",
  "unable to submit",
  "please correct the following",
  "please fix the errors",
  "validation failed",
  "there was an error",
];

// --- main export -------------------------------------------------------------

/**
 * Monitor the page after form submission for up to `timeoutMs` (default 60 s).
 * Polls every 2 s for success/failure signals. On success, uses Claude to
 * extract any confirmation number and updates the application record.
 */
export async function verifySubmission(
  options: VerifySubmissionOptions,
): Promise<SubmissionResult> {
  const {
    page,
    client,
    sessionId,
    applicationId,
    organizationId,
    timeoutMs = 60_000,
  } = options;

  const POLL_MS = 2_000;
  const deadline = Date.now() + timeoutMs;

  let pageText = "";
  let outcomeSuccess = false;
  let outcomeError: string | null = null;

  // --- monitoring loop -------------------------------------------------------
  while (Date.now() < deadline) {
    try {
      const scan = await page.evaluate(
        ({
          successSels,
          failureSels,
          successPhrases,
          failurePhrases,
        }: {
          successSels: string[];
          failureSels: string[];
          successPhrases: string[];
          failurePhrases: string[];
        }) => {
          const body = document.body?.innerText?.toLowerCase() ?? "";
          const url = window.location.href.toLowerCase();

          const hasSuccessEl = successSels.some((sel) => {
            try {
              return !!document.querySelector(sel);
            } catch {
              return false;
            }
          });

          const hasFailureEl = failureSels.some((sel) => {
            try {
              return !!document.querySelector(sel);
            } catch {
              return false;
            }
          });

          const successByPhrase = successPhrases.some((p) => body.includes(p));
          const failureByPhrase = failurePhrases.some((p) => body.includes(p));

          // Redirect to a dashboard or confirmation page is a strong success signal.
          const isDashboardRedirect =
            url.includes("/dashboard") ||
            url.includes("/portal/home") ||
            url.includes("/application/status") ||
            url.includes("/confirmation");

          return {
            success: hasSuccessEl || successByPhrase || isDashboardRedirect,
            failure:
              !hasSuccessEl && !successByPhrase && (hasFailureEl || failureByPhrase),
            bodyText: document.body?.innerText?.slice(0, 5000) ?? "",
          };
        },
        {
          successSels: SUCCESS_SELECTORS,
          failureSels: FAILURE_SELECTORS,
          successPhrases: SUCCESS_PHRASES,
          failurePhrases: FAILURE_PHRASES,
        },
      );

      pageText = scan.bodyText;

      if (scan.success) {
        outcomeSuccess = true;
        break;
      }

      if (scan.failure) {
        outcomeError = "Form submission failed. See screenshot for details.";
        break;
      }
    } catch {
      // Page is mid-navigation - wait and retry.
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(POLL_MS, remaining));
  }

  // Timed out with no definitive signal.
  if (!outcomeSuccess && !outcomeError) {
    outcomeError =
      "Verification timed out after 60 seconds. The submission status is unknown.";
    try {
      pageText =
        (await page.evaluate(
          () => document.body?.innerText?.slice(0, 5000) ?? "",
        )) ?? "";
    } catch {
      // ignore
    }
  }

  // --- screenshot -----------------------------------------------------------
  const screenshotPath = await captureScreenshot(
    page,
    client,
    organizationId,
    sessionId,
  );

  // --- confirmation number --------------------------------------------------
  let confirmationNumber: string | null = null;
  if (outcomeSuccess && pageText) {
    confirmationNumber = await extractConfirmationNumber(pageText);
  }

  // --- database updates -----------------------------------------------------
  if (applicationId) {
    await updateApplication(client, applicationId, outcomeSuccess, confirmationNumber);
  }
  await updateSession(
    client,
    sessionId,
    organizationId,
    outcomeSuccess,
    confirmationNumber,
    outcomeError,
  );

  return {
    success: outcomeSuccess,
    confirmation_number: confirmationNumber,
    screenshot: screenshotPath,
    page_text: pageText,
    error: outcomeError,
  };
}

// --- helpers -----------------------------------------------------------------

async function captureScreenshot(
  page: Page,
  client: SupabaseClient,
  organizationId: string,
  sessionId: string,
): Promise<string> {
  const storagePath = `automation/${sessionId}/verification_result.png`;
  try {
    const buffer = await page.screenshot({ fullPage: true });
    await client.storage
      .from(`org-${organizationId}`)
      .upload(storagePath, buffer, { contentType: "image/png", upsert: true });
  } catch {
    // Screenshot failure must never mask the verification outcome.
  }
  return storagePath;
}

async function extractConfirmationNumber(
  pageText: string,
): Promise<string | null> {
  try {
    const { text } = await callClaude({
      prompt: `Extract any confirmation number, reference number, or submission ID from this page text: ${pageText}`,
      maxTokens: 128,
      temperature: 0,
    });

    const trimmed = text.trim();
    const lower = trimmed.toLowerCase();
    if (
      lower.includes("no confirmation") ||
      lower.includes("not found") ||
      lower === "none" ||
      trimmed === ""
    ) {
      return null;
    }
    return trimmed.split("\n")[0]?.trim() || null;
  } catch {
    return null;
  }
}

async function updateApplication(
  client: SupabaseClient,
  applicationId: string,
  success: boolean,
  confirmationNumber: string | null,
): Promise<void> {
  if (!success) return;
  try {
    const update: Record<string, unknown> = {
      stage: "submitted",
      submitted_at: new Date().toISOString(),
    };

    if (confirmationNumber) {
      const { data: existing } = await client
        .from("applications")
        .select("notes")
        .eq("id", applicationId)
        .single();

      const prior = (existing as { notes?: string | null } | null)?.notes ?? "";
      const confirmLine = `Confirmation number: ${confirmationNumber}`;
      update.notes = prior ? `${prior}\n${confirmLine}` : confirmLine;
    }

    await client.from("applications").update(update).eq("id", applicationId);
  } catch {
    // Non-fatal - submission result is still returned to the caller.
  }
}

async function updateSession(
  client: SupabaseClient,
  sessionId: string,
  organizationId: string,
  success: boolean,
  confirmationNumber: string | null,
  errorMessage: string | null,
): Promise<void> {
  try {
    await client
      .from("automation_sessions")
      .update({
        status: success ? "submitted" : "failed",
        confirmation_number: confirmationNumber,
        error_message: errorMessage,
        completed_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("organization_id", organizationId);
  } catch {
    // Non-fatal.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

