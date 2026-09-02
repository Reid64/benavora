// Browser Automation Agent - AGENTS.md Agent 16 (Phase 3),
// BEHAVIORAL_CONTRACTS §18.
//
// Drives a headless browser to pre-fill a funder's online donation/grant
// application form, then STOPS at `awaiting_approval`. It never submits on its
// own - a human must approve, after which `submitApproved()` resumes, clicks
// submit, and captures the confirmation (BEHAVIORAL_CONTRACTS §18: "Automation
// NEVER auto-submits forms").
//
// Division of labour (BLUEPRINT §Phase 3):
//   - BrowserEngine       - Playwright transport: launch, navigate, screenshot,
//                           file download/upload, clean shutdown.
//   - form-detector        - read the page's controls, map them to org data.
//   - form-filler          - type/select/check/upload the mapped values.
//   - AutomationSessionManager - all DB bookkeeping (session/steps/screenshots)
//                           and the status lifecycle, including the
//                           approve→submit guard.
// This file orchestrates them and adds the safety detections the spec calls for
// (portal login walls, CAPTCHAs, missing forms).
//
// TIMEOUT NOTE: the initial automated pass runs through BaseAgent.run(), whose
// 60s ceiling (AGENTS.md §15) is the right bound for "fill what we can and
// pause". The §18 5-minute session budget governs the WHOLE lifecycle through
// human approval; the submit phase therefore runs via submitApproved(), called
// directly by the approve route - NOT through run() - so it is not killed by the
// per-run timeout.

import type { Page } from "playwright";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AgentError,
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
} from "@/lib/agents/base-agent";
import { BrowserEngine } from "@/lib/automation/browser-engine";
import { detectAndMapFields } from "@/lib/automation/form-detector";
import { fillForm } from "@/lib/automation/form-filler";
import {
  AutomationSessionManager,
  AutomationSessionError,
} from "@/lib/automation/session-manager";
import { applicationSubmitted } from "@/lib/observability/metrics";
import type { AgentType } from "@/types/agents";
import type {
  AutofillContext,
  AutomationStatus,
  FormField,
  FormMapping,
  ScreenshotCapture,
} from "@/types/automation";

// --- public input / output shapes -------------------------------------------

export interface BrowserAutomationInput {
  /** Application whose opportunity portal we are filling. Required. */
  applicationId: string;
  /**
   * An `automation_sessions` row already created for this run (status
   * 'pending') - e.g. by the enqueue route, before the worker picked the job
   * up. When set, execute() resumes this session instead of creating a new
   * one, so the id returned to the caller at enqueue time is the same id the
   * worker updates as it runs.
   */
  sessionId?: string;
  /**
   * How the worker should behave after filling:
   *   supervised        — pause for human approval (default, all tiers).
   *   semi_autonomous   — auto-submit when all mapped fields have confidence ≥ 0.9
   *                       and no required fields are unmapped; else pause.
   *   autonomous        — always auto-submit without pause.
   * BEHAVIORAL_CONTRACTS §23-§24; tier gates enforced at the queue API.
   */
  automationLevel?: "supervised" | "semi_autonomous" | "autonomous";
}

/** Why the automation paused for a human. */
export type BrowserAutomationPause =
  | "login_required"
  | "captcha_detected"
  | "no_form"
  | "form_filled";

export interface BrowserAutomationResult {
  sessionId: string;
  /** Terminal state of the initial pass: awaiting_approval or failed. */
  status: AutomationStatus;
  /** Reason the pass paused, or null when it failed before reaching a pause. */
  pause: BrowserAutomationPause | null;
  targetUrl: string | null;
  /** Count of fields auto-filled from org data (excludes file uploads). */
  mappedFieldCount: number;
  /** Labels of REQUIRED fields left for human input. */
  unmappedRequiredFields: string[];
  /** Storage paths of every screenshot captured this pass. */
  screenshots: string[];
  notes: string | null;
}

export interface BrowserSubmitResult {
  sessionId: string;
  status: AutomationStatus; // submitted | failed
  confirmationNumber: string | null;
  confirmationScreenshot: string | null;
  applicationStageUpdated: boolean;
}

export interface BrowserAutomationOptions extends BaseAgentOptions {
  /** Run the browser headless. Defaults to true; false for debugging. */
  headless?: boolean;
}

// --- internal record shapes --------------------------------------------------

/** What the agent resolves before touching the browser. */
interface AutomationContext {
  applicationId: string;
  opportunityId: string | null;
  funderId: string | null;
  targetUrl: string;
  autofill: AutofillContext;
  /** Documents already uploaded for this application, for file inputs. */
  documents: ApplicationDocument[];
}

interface ApplicationDocument {
  storagePath: string;
  fileName: string;
  category: string | null;
}

export class BrowserAutomationAgent extends BaseAgent<
  BrowserAutomationInput,
  BrowserAutomationResult
> {
  readonly agentType: AgentType = "browser_automation";

  private readonly headless: boolean;
  private readonly sessions: AutomationSessionManager;

  constructor(options: BrowserAutomationOptions) {
    super(options);
    this.headless = options.headless ?? true;
    this.sessions = new AutomationSessionManager({
      client: this.client,
      organizationId: this.organizationId,
    });
  }

  // --- initial automated pass (via BaseAgent.run) ----------------------------

  protected async execute(
    input: BrowserAutomationInput,
  ): Promise<AgentExecution<BrowserAutomationResult>> {
    const applicationId = (input.applicationId ?? "").trim();
    if (applicationId === "") {
      throw new AgentError(
        "applicationId is required.",
        "invalid_input",
        400,
      );
    }

    const context = await this.loadContext(applicationId);

    // Resume a session the caller already created (queued run), or create one
    // up front so the run is inspectable even if the browser work fails
    // (BEHAVIORAL_CONTRACTS §15 - never silently fail).
    const sessionId = input.sessionId
      ? (await this.sessions.getSession(input.sessionId)).id
      : (
          await this.sessions.createSession({
            applicationId: context.applicationId,
            opportunityId: context.opportunityId,
            funderId: context.funderId,
            targetUrl: context.targetUrl,
            startedBy: this.triggeredBy,
          })
        ).id;

    const engine = new BrowserEngine({
      client: this.client,
      organizationId: this.organizationId,
      sessionId,
      headless: this.headless,
    });

    const screenshots: string[] = [];
    let step = 0;

    try {
      await this.sessions.start(sessionId);
      await engine.launch();

      // --- navigate + landing screenshot -----------------------------------
      await this.sessions.recordStep(sessionId, {
        stepNumber: ++step,
        action: "navigate",
        description: `Navigate to ${context.targetUrl}`,
        status: "pending",
      });
      await engine.navigate(context.targetUrl);
      await this.capture(engine, sessionId, "landing", screenshots);

      // --- login wall ------------------------------------------------------
      if (await detectLoginRequired(engine.page)) {
        return await this.pause(
          sessionId,
          "login_required",
          "Portal requires login - a human must sign in before this application can be filled. Portal credentials are never stored.",
          context.targetUrl,
          0,
          [],
          screenshots,
        );
      }

      // --- CAPTCHA ---------------------------------------------------------
      const captcha = await detectCaptcha(engine.page);
      if (captcha) {
        return await this.pause(
          sessionId,
          "captcha_detected",
          `CAPTCHA detected (${captcha}) - requires human intervention. The automation will not attempt to solve it.`,
          context.targetUrl,
          0,
          [],
          screenshots,
        );
      }

      // --- detect + map the form -------------------------------------------
      await this.sessions.recordStep(sessionId, {
        stepNumber: ++step,
        action: "detect_form",
        description: "Detect and map application form fields",
        status: "pending",
      });
      const { mappedFields, unmappedFields, fields } = await detectAndMapFields(
        engine.page,
        context.autofill,
      );

      if (fields.length === 0) {
        return await this.pause(
          sessionId,
          "no_form",
          "No application form detected - may require manual navigation to the application page.",
          context.targetUrl,
          0,
          [],
          screenshots,
        );
      }

      // Split out file inputs - these are filled from the application's
      // documents, not the org profile.
      const fileFields = unmappedFields.filter((f) => f.fieldType === "file");
      const humanFields = unmappedFields.filter((f) => f.fieldType !== "file");

      // --- fill the text/select/etc. fields --------------------------------
      if (mappedFields.length > 0) {
        await this.sessions.recordStep(sessionId, {
          stepNumber: ++step,
          action: "fill_field",
          description: `Fill ${mappedFields.length} mapped field(s)`,
          status: "pending",
          inputData: { count: mappedFields.length },
        });
        const fill = await fillForm(engine, mappedFields, {
          filledScreenshotLabel: "filled-form",
        });
        await this.recordCaptures(sessionId, fill.screenshots, screenshots);
      } else {
        // Still snapshot the (unfilled) form so the reviewer sees the page.
        await this.capture(engine, sessionId, "filled-form", screenshots);
      }

      // --- handle file uploads ---------------------------------------------
      const fileMappings = this.matchDocumentsToFileFields(
        fileFields,
        context.documents,
      );
      if (fileMappings.length > 0) {
        await this.sessions.recordStep(sessionId, {
          stepNumber: ++step,
          action: "upload_file",
          description: `Upload ${fileMappings.length} document(s)`,
          status: "pending",
          inputData: {
            files: fileMappings.map((m) => m.source),
          },
        });
        const upload = await fillForm(engine, fileMappings, {
          filledScreenshotLabel: "after-uploads",
        });
        await this.recordCaptures(sessionId, upload.screenshots, screenshots);
      }

      // --- persist the field split -----------------------------------------
      // mapped_fields carries everything we auto-handled (text + uploads) so the
      // approval replay can re-apply it; unmapped_fields carries what a human
      // still has to provide.
      const savedMapped = [...mappedFields, ...fileMappings];
      await this.sessions.saveFieldMapping(sessionId, savedMapped, humanFields);

      const unmappedRequired = humanFields
        .filter((f) => f.required)
        .map((f) => f.fieldLabel || f.fieldName);

      const note = buildFormFilledNote(
        mappedFields.length,
        fileMappings.length,
        unmappedRequired,
      );

      // --- decide: pause for approval, or auto-submit ----------------------
      const level = input.automationLevel ?? "supervised";

      const lowConfidenceFields = savedMapped.filter(
        (m) => (m.confidence ?? 0.95) < 0.9,
      );
      const allHighConfidence = lowConfidenceFields.length === 0;

      const shouldAutoSubmit =
        level === "autonomous" ||
        (level === "semi_autonomous" &&
          allHighConfidence &&
          unmappedRequired.length === 0);

      if (shouldAutoSubmit) {
        const submitResult = await this.submitCurrentPage(
          engine,
          sessionId,
          ++step,
          level,
        );

        if (submitResult.submitted) {
          if (submitResult.screenshot) screenshots.push(submitResult.screenshot);

          const autoNote = submitResult.confirmationNumber
            ? `Auto-submitted (${level}). Confirmation: ${submitResult.confirmationNumber}`
            : `Auto-submitted (${level}). No confirmation number captured.`;

          const fieldScoreLog = savedMapped
            .map(
              (m) =>
                `${m.field.fieldLabel || m.field.fieldName}=${(m.confidence ?? 0.95).toFixed(2)}`,
            )
            .join(", ");

          await this.sessions.markAutoSubmitted(
            sessionId,
            level,
            submitResult.confirmationNumber,
          );
          await this.advanceApplicationToSubmitted(
            context.applicationId,
            this.triggeredBy ?? "system",
            submitResult.confirmationNumber,
          );

          return {
            data: {
              sessionId,
              status: "submitted",
              pause: null,
              targetUrl: context.targetUrl,
              mappedFieldCount: mappedFields.length,
              unmappedRequiredFields: unmappedRequired,
              screenshots,
              notes: autoNote,
            },
            outputSummary: `${autoNote} | field_scores: ${fieldScoreLog}`,
            itemsFound: mappedFields.length,
            itemsProcessed: mappedFields.length,
          };
        }
        // No submit button found — fall through to supervised pause below.
      }

      // Annotate pause note for semi_autonomous when we couldn't auto-submit.
      let pauseNote = note;
      if (level === "semi_autonomous") {
        const reasons: string[] = [];
        if (!allHighConfidence) {
          reasons.push(
            `${lowConfidenceFields.length} field(s) below 90% confidence: ${lowConfidenceFields.map((m) => m.field.fieldLabel || m.field.fieldName).join(", ")}`,
          );
        }
        if (unmappedRequired.length > 0) {
          reasons.push(
            `${unmappedRequired.length} required field(s) need input: ${unmappedRequired.join(", ")}`,
          );
        }
        if (reasons.length > 0) {
          pauseNote = `Semi-autonomous paused — ${reasons.join("; ")}. ${note}`;
        }
      }

      return await this.pause(
        sessionId,
        "form_filled",
        pauseNote,
        context.targetUrl,
        mappedFields.length,
        unmappedRequired,
        screenshots,
      );
    } catch (err) {
      // A browser-level failure is recorded on the session (with an error
      // screenshot when possible) and returned as a `failed` result, so the
      // caller still gets a sessionId to inspect rather than an opaque throw.
      const message = errorMessage(err);
      const errorShot = await engine
        .captureErrorScreenshot("automation-error")
        .catch(() => null);
      if (errorShot) {
        screenshots.push(errorShot.storagePath);
        await this.sessions
          .recordScreenshot(sessionId, errorShot, {
            description: "Error state",
          })
          .catch(() => undefined);
      }
      await this.sessions
        .recordStep(sessionId, {
          stepNumber: ++step,
          action: "screenshot",
          description: "Automation failed",
          status: "failed",
          errorMessage: message,
        })
        .catch(() => undefined);
      await this.sessions.markFailed(sessionId, message).catch(() => undefined);

      return {
        data: {
          sessionId,
          status: "failed",
          pause: null,
          targetUrl: context.targetUrl,
          mappedFieldCount: 0,
          unmappedRequiredFields: [],
          screenshots,
          notes: message,
        },
        outputSummary: `Browser automation failed for application ${applicationId}: ${message}`,
        itemsFound: 0,
        itemsProcessed: 0,
      };
    } finally {
      await engine.close();
    }
  }

  // --- approved submission (called directly, NOT via run()) ------------------

  /**
   * Resume an approved session, submit the form, and capture the confirmation.
   * The session MUST already be in `approved` status (a human approved it via
   * AutomationSessionManager.approve) - markSubmitted enforces this, so this
   * method can never effect an unapproved submission.
   *
   * Because browsers do not survive across serverless requests, this re-launches
   * a fresh engine, re-navigates to the portal, and replays the stored
   * mapped_fields (org values + uploads + any human-entered values merged in by
   * the PUT route) rather than relying on a still-live page.
   */
  async submitApproved(
    sessionId: string,
    approvedBy: string,
  ): Promise<BrowserSubmitResult> {
    const session = await this.sessions.getSession(sessionId);
    if (session.status !== "approved") {
      throw new AgentError(
        `Session ${sessionId} is "${session.status}"; it must be approved before submission.`,
        "submission_requires_approval",
        409,
      );
    }
    if (!session.target_url) {
      throw new AgentError(
        "Session has no target URL to submit to.",
        "no_target_url",
        422,
      );
    }

    const engine = new BrowserEngine({
      client: this.client,
      organizationId: this.organizationId,
      sessionId,
      headless: this.headless,
    });

    let step = 1000; // distinct band from the initial pass's step numbers
    try {
      await engine.launch();
      await engine.navigate(session.target_url);

      // A login wall or CAPTCHA appearing at submit time blocks us - fail
      // loudly rather than half-submit.
      if (await detectLoginRequired(engine.page)) {
        throw new AgentError(
          "Portal now requires login; cannot submit unattended.",
          "login_required",
          409,
        );
      }
      const captcha = await detectCaptcha(engine.page);
      if (captcha) {
        throw new AgentError(
          `CAPTCHA (${captcha}) present at submit time; cannot submit unattended.`,
          "captcha_detected",
          409,
        );
      }

      // Replay the stored mappings into the freshly loaded page.
      const mappings = parseStoredMappings(session.mapped_fields);
      if (mappings.length > 0) {
        await fillForm(engine, mappings, { screenshotFilledForm: false });
      }

      // Submit.
      await this.sessions.recordStep(sessionId, {
        stepNumber: ++step,
        action: "submit",
        description: "Click submit (human-approved)",
        status: "pending",
      });
      const submitted = await clickSubmit(engine.page);
      if (!submitted) {
        throw new AgentError(
          "No submit control could be located on the form.",
          "submit_not_found",
          422,
        );
      }
      await waitForSettle(engine.page);

      // Confirmation screenshot + number.
      const shot = await engine.screenshot("confirmation");
      await this.sessions.recordScreenshot(sessionId, shot, {
        description: "Confirmation page",
      });
      const pageText = await safePageText(engine.page);
      const confirmationNumber = extractConfirmationNumber(pageText);

      // markSubmitted refuses unless status is `approved` (the guard).
      await this.sessions.markSubmitted(sessionId, confirmationNumber);

      // Advance the application to `submitted` and record the transition.
      const applicationStageUpdated = await this.advanceApplicationToSubmitted(
        session.application_id,
        approvedBy,
        confirmationNumber,
      );

      return {
        sessionId,
        status: "submitted",
        confirmationNumber,
        confirmationScreenshot: shot.storagePath,
        applicationStageUpdated,
      };
    } catch (err) {
      const message = errorMessage(err);
      await engine
        .captureErrorScreenshot("submit-error")
        .then((shot) =>
          shot
            ? this.sessions.recordScreenshot(sessionId, shot, {
                description: "Submit error state",
              })
            : undefined,
        )
        .catch(() => undefined);
      await this.sessions.markFailed(sessionId, message).catch(() => undefined);
      throw err instanceof AgentError
        ? err
        : new AgentError(message, "submit_failed", 500);
    } finally {
      await engine.close();
    }
  }

  // --- helpers ---------------------------------------------------------------

  /** Capture a screenshot, persist its record, and track its path. */
  private async capture(
    engine: BrowserEngine,
    sessionId: string,
    label: string,
    sink: string[],
  ): Promise<void> {
    const shot = await engine.screenshot(label);
    await this.sessions.recordScreenshot(sessionId, shot, {
      description: label,
    });
    sink.push(shot.storagePath);
  }

  /** Persist screenshot records produced by the form filler. */
  private async recordCaptures(
    sessionId: string,
    captures: ScreenshotCapture[],
    sink: string[],
  ): Promise<void> {
    for (const shot of captures) {
      await this.sessions.recordScreenshot(sessionId, shot, {
        description: shot.label,
      });
      sink.push(shot.storagePath);
    }
  }

  /**
   * Submit the form from the CURRENT live page (no re-navigation).
   * Used by autonomous / semi_autonomous modes immediately after form fill.
   * Returns whether a submit button was found, plus the confirmation number
   * and screenshot path when submission succeeded.
   */
  private async submitCurrentPage(
    engine: BrowserEngine,
    sessionId: string,
    stepNumber: number,
    automationLevel: string,
  ): Promise<{
    submitted: boolean;
    confirmationNumber: string | null;
    screenshot: string | null;
  }> {
    await this.sessions.recordStep(sessionId, {
      stepNumber,
      action: "submit",
      description: `Auto-submit (${automationLevel})`,
      status: "pending",
    });

    const clicked = await clickSubmit(engine.page);
    if (!clicked) {
      await this.sessions.recordStep(sessionId, {
        stepNumber: stepNumber + 1,
        action: "submit",
        description: "Auto-submit: no submit button found",
        status: "failed",
      });
      return { submitted: false, confirmationNumber: null, screenshot: null };
    }

    await waitForSettle(engine.page);

    const shot = await engine.screenshot("confirmation");
    await this.sessions.recordScreenshot(sessionId, shot, {
      description: "Confirmation page (auto-submitted)",
    });

    const pageText = await safePageText(engine.page);
    const confirmationNumber = extractConfirmationNumber(pageText);

    return {
      submitted: true,
      confirmationNumber,
      screenshot: shot.storagePath,
    };
  }

  /** Drive the session to awaiting_approval and shape the result. */
  private async pause(
    sessionId: string,
    pause: BrowserAutomationPause,
    note: string,
    targetUrl: string,
    mappedFieldCount: number,
    unmappedRequiredFields: string[],
    screenshots: string[],
  ): Promise<AgentExecution<BrowserAutomationResult>> {
    await this.sessions.markAwaitingApproval(sessionId, note);
    return {
      data: {
        sessionId,
        status: "awaiting_approval",
        pause,
        targetUrl,
        mappedFieldCount,
        unmappedRequiredFields,
        screenshots,
        notes: note,
      },
      outputSummary: note,
      itemsFound: mappedFieldCount,
      itemsProcessed: mappedFieldCount,
    };
  }

  /**
   * Load the application, its opportunity + funder (for the target URL), the
   * org/profile autofill context, and the application's uploaded documents.
   * Every query is scoped by organization_id (BEHAVIORAL_CONTRACTS §2).
   */
  private async loadContext(
    applicationId: string,
  ): Promise<AutomationContext> {
    const { data: application, error: appError } = await this.client
      .from("applications")
      .select("id, organization_id, opportunity_id, requested_amount")
      .eq("id", applicationId)
      .eq("organization_id", this.organizationId)
      .single();
    if (appError || !application) {
      throw new AgentError("Application not found.", "not_found", 404);
    }

    const opportunityId = (application.opportunity_id as string | null) ?? null;
    let funderId: string | null = null;
    let opportunityUrl: string | null = null;

    if (opportunityId) {
      const { data: opportunity } = await this.client
        .from("opportunities")
        .select("id, url, funder_id")
        .eq("id", opportunityId)
        .eq("organization_id", this.organizationId)
        .maybeSingle();
      opportunityUrl = (opportunity?.url as string | null) ?? null;
      funderId = (opportunity?.funder_id as string | null) ?? null;
    }

    let portalUrl: string | null = null;
    if (funderId) {
      const { data: funder } = await this.client
        .from("funders")
        .select("id, giving_portal_url")
        .eq("id", funderId)
        .eq("organization_id", this.organizationId)
        .maybeSingle();
      portalUrl = (funder?.giving_portal_url as string | null) ?? null;
    }

    const targetUrl = normalizeUrl(opportunityUrl) ?? normalizeUrl(portalUrl);
    if (!targetUrl) {
      throw new AgentError(
        "No portal URL: the opportunity has no application URL and the funder has no giving portal URL.",
        "no_target_url",
        422,
      );
    }

    const autofill = await this.loadAutofillContext(
      (application.requested_amount as number | null) ?? null,
    );
    const documents = await this.loadApplicationDocuments(applicationId);

    return {
      applicationId,
      opportunityId,
      funderId,
      targetUrl,
      autofill,
      documents,
    };
  }

  /** Build the org/profile/application autofill context. */
  private async loadAutofillContext(
    requestedAmount: number | null,
  ): Promise<AutofillContext> {
    const { data: organization } = await this.client
      .from("organizations")
      .select(
        "name, ein, address_line1, city, state, zip, mission_statement, phone, website, email",
      )
      .eq("id", this.organizationId)
      .maybeSingle();

    let profile: AutofillContext["profile"] = {};
    if (this.triggeredBy) {
      const { data: profileRow } = await this.client
        .from("profiles")
        .select("full_name, email")
        .eq("id", this.triggeredBy)
        .eq("organization_id", this.organizationId)
        .maybeSingle();
      if (profileRow) {
        profile = {
          full_name: (profileRow.full_name as string | null) ?? null,
          email: (profileRow.email as string | null) ?? null,
        };
      }
    }

    return {
      organization: (organization ?? {}) as AutofillContext["organization"],
      profile,
      application: { requested_amount: requestedAmount },
    };
  }

  /** Load the documents linked to this application, for file inputs. */
  private async loadApplicationDocuments(
    applicationId: string,
  ): Promise<ApplicationDocument[]> {
    const { data } = await this.client
      .from("application_documents")
      .select("documents(storage_path, file_name, category)")
      .eq("application_id", applicationId);

    // The PostgREST select-string parser infers the embedded `documents`
    // relation as an array (it can't see the to-one FK under the untyped
    // client), so a direct cast to the single-row shape is rejected as a
    // non-overlapping conversion. Route it through `unknown` - the runtime shape
    // is one document row (or null) per application_documents row.
    const rows = (data ?? []) as unknown as Array<{
      documents:
        | {
            storage_path: string | null;
            file_name: string | null;
            category: string | null;
          }
        | null;
    }>;

    const docs: ApplicationDocument[] = [];
    for (const row of rows) {
      const doc = row.documents;
      if (doc?.storage_path) {
        docs.push({
          storagePath: doc.storage_path,
          fileName: doc.file_name ?? doc.storage_path,
          category: doc.category ?? null,
        });
      }
    }
    return docs;
  }

  /**
   * Assign uploaded documents to the form's file inputs. Each file input is
   * matched to the best document by label/category keyword overlap; unmatched
   * inputs fall back to documents in order so a single-attachment form still
   * gets its file. A document is used at most once.
   */
  private matchDocumentsToFileFields(
    fileFields: FormField[],
    documents: ApplicationDocument[],
  ): FormMapping[] {
    if (fileFields.length === 0 || documents.length === 0) return [];

    const remaining = [...documents];
    const mappings: FormMapping[] = [];

    for (const field of fileFields) {
      if (remaining.length === 0) break;
      const haystack = `${field.fieldLabel} ${field.fieldName}`.toLowerCase();

      let pickIndex = remaining.findIndex((doc) => {
        const name = doc.fileName.toLowerCase();
        const category = (doc.category ?? "").replace(/_/g, " ").toLowerCase();
        return (
          (category && haystack.includes(category)) ||
          tokenOverlap(haystack, name)
        );
      });
      if (pickIndex === -1) pickIndex = 0; // fall back to next available doc

      const [doc] = remaining.splice(pickIndex, 1);
      if (!doc) continue;
      mappings.push({
        field,
        value: doc.storagePath,
        source: `document:${doc.fileName}`,
      });
    }

    return mappings;
  }

  /**
   * Move the application to `submitted`, stamp submitted_at, append the
   * confirmation to its notes, and log the pipeline transition
   * (BEHAVIORAL_CONTRACTS §6 - every stage change creates a pipeline_history
   * row). Returns false if there is no application linked to the session.
   */
  private async advanceApplicationToSubmitted(
    applicationId: string | null,
    changedBy: string,
    confirmationNumber: string | null,
  ): Promise<boolean> {
    if (!applicationId) return false;

    const { data: rawApplication } = await this.client
      .from("applications")
      .select("id, stage, notes, draft_template_type, opportunity:opportunities(category)")
      .eq("id", applicationId)
      .eq("organization_id", this.organizationId)
      .maybeSingle();
    if (!rawApplication) return false;

    const application = rawApplication as unknown as {
      id: string;
      stage: string | null;
      notes: string | null;
      draft_template_type: string | null;
      opportunity: { category: string | null } | null;
    };

    const fromStage = (application.stage as string | null) ?? null;
    const submittedAt = new Date().toISOString();
    const confirmationLine = confirmationNumber
      ? `[${submittedAt}] Submitted via browser automation. Confirmation: ${confirmationNumber}.`
      : `[${submittedAt}] Submitted via browser automation (no confirmation number captured).`;
    const existingNotes = (application.notes as string | null) ?? "";
    const notes = existingNotes
      ? `${existingNotes}\n${confirmationLine}`
      : confirmationLine;

    await this.client
      .from("applications")
      .update({
        stage: "submitted",
        submitted_at: submittedAt,
        notes,
        updated_at: submittedAt,
      })
      .eq("id", applicationId)
      .eq("organization_id", this.organizationId);

    await this.client.from("pipeline_history").insert({
      organization_id: this.organizationId,
      application_id: applicationId,
      from_stage: fromStage,
      to_stage: "submitted",
      changed_by: changedBy,
      notes: confirmationLine,
    });

    applicationSubmitted
      .labels(
        application.opportunity?.category ?? "unknown",
        application.draft_template_type ?? "unknown",
        "true",
      )
      .inc();

    return true;
  }
}

// --- approval orchestration --------------------------------------------------

export interface ApproveAndSubmitParams {
  client: SupabaseClient;
  organizationId: string;
  /** Session to approve and submit. */
  sessionId: string;
  /** Profile id of the approving (owner/admin) user. Required. */
  approvedBy: string;
  headless?: boolean;
}

/**
 * The single approved-submission path, shared by the PUT and approve routes:
 * record the human approval (awaiting_approval → approved), then resume the
 * browser and submit. There is intentionally no way to do one without the other
 * out of order - AutomationSessionManager.approve refuses a non-pending session
 * and submitApproved refuses a non-approved one.
 */
export async function approveAndSubmit(
  params: ApproveAndSubmitParams,
): Promise<BrowserSubmitResult> {
  const { client, organizationId, sessionId, approvedBy, headless } = params;
  const sessions = new AutomationSessionManager({ client, organizationId });
  await sessions.approve(sessionId, approvedBy);

  const agent = new BrowserAutomationAgent({
    client,
    organizationId,
    triggeredBy: approvedBy,
    headless,
  });
  return agent.submitApproved(sessionId, approvedBy);
}

// --- session-side detections (operate on a live Page) ------------------------

/**
 * Heuristically decide whether the page is a login wall: a password field
 * present together with sign-in affordances, and without a substantial
 * application form already on the page.
 */
export async function detectLoginRequired(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const hasPassword = !!document.querySelector('input[type="password"]');
    if (!hasPassword) return false;

    const text = (document.body.innerText || "").toLowerCase();
    const loginCues = [
      "sign in",
      "log in",
      "login",
      "username",
      "forgot password",
    ];
    const mentionsLogin = loginCues.some((cue) => text.includes(cue));

    // If there is a rich form (many non-auth fields), treat it as the
    // application itself rather than a pure login wall.
    const inputs = Array.from(
      document.querySelectorAll("input, textarea, select"),
    ).filter((el) => {
      const type = (el.getAttribute("type") || "").toLowerCase();
      return !["hidden", "submit", "button", "password"].includes(type);
    });

    return mentionsLogin && inputs.length <= 3;
  });
}

/**
 * Detect a CAPTCHA widget. Returns the kind ("reCAPTCHA" | "hCaptcha" |
 * "CAPTCHA") or null. Looks for the canonical iframes and container classes.
 */
export async function detectCaptcha(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const iframeSrc = Array.from(document.querySelectorAll("iframe"))
      .map((f) => (f.getAttribute("src") || "").toLowerCase())
      .join(" ");

    if (
      document.querySelector(".g-recaptcha") ||
      document.querySelector("iframe[src*='recaptcha']") ||
      iframeSrc.includes("recaptcha") ||
      iframeSrc.includes("google.com/recaptcha")
    ) {
      return "reCAPTCHA";
    }
    if (
      document.querySelector(".h-captcha") ||
      document.querySelector("iframe[src*='hcaptcha']") ||
      iframeSrc.includes("hcaptcha")
    ) {
      return "hCaptcha";
    }
    if (
      document.querySelector("[class*='captcha'], [id*='captcha']") ||
      iframeSrc.includes("captcha")
    ) {
      return "CAPTCHA";
    }
    return null;
  });
}

/**
 * Click the form's submit control. Tries explicit submit inputs/buttons first,
 * then buttons whose text reads like a submit action. Returns true if a control
 * was clicked.
 */
export async function clickSubmit(page: Page): Promise<boolean> {
  const directSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
  ];
  for (const selector of directSelectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) {
      try {
        await locator.scrollIntoViewIfNeeded();
        await locator.click();
        return true;
      } catch {
        /* try the next strategy */
      }
    }
  }

  // Text-based fallback for buttons/links that submit without type=submit.
  const labels = ["submit", "apply", "send", "send request", "submit application"];
  for (const label of labels) {
    const locator = page
      .locator("button, a, input[type='button']")
      .filter({ hasText: new RegExp(`^\\s*${label}\\s*$`, "i") })
      .first();
    if ((await locator.count()) > 0) {
      try {
        await locator.scrollIntoViewIfNeeded();
        await locator.click();
        return true;
      } catch {
        /* keep trying */
      }
    }
  }

  return false;
}

// --- pure helpers ------------------------------------------------------------

/** Wait briefly for the page to settle after a submit click. Best-effort. */
async function waitForSettle(page: Page): Promise<void> {
  try {
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
  } catch {
    // Networkidle can never arrive on long-polling pages; the confirmation
    // screenshot is still captured from the current state.
  }
}

/** Read the page's text for confirmation parsing. Empty string on failure. */
async function safePageText(page: Page): Promise<string> {
  try {
    return await page.evaluate(() => document.body.innerText || "");
  } catch {
    return "";
  }
}

/**
 * Pull a confirmation/reference number out of a confirmation page's text.
 * Matches common phrasings ("Confirmation number: ABC-123", "Reference #:
 * 12345"). Returns null when nothing convincing is found.
 */
export function extractConfirmationNumber(text: string): string | null {
  if (!text) return null;
  const patterns = [
    /confirmation\s*(?:number|no\.?|#|id)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})/i,
    /reference\s*(?:number|no\.?|#|id)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})/i,
    /(?:tracking|application)\s*(?:number|no\.?|#|id)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && match[1]) return match[1].trim();
  }
  return null;
}

/** Re-hydrate FormMapping[] stored in automation_sessions.mapped_fields. */
export function parseStoredMappings(value: unknown): FormMapping[] {
  if (!Array.isArray(value)) return [];
  const mappings: FormMapping[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const field = obj.field as FormField | undefined;
    const val = obj.value;
    if (
      field &&
      typeof field === "object" &&
      typeof field.selector === "string" &&
      typeof val === "string"
    ) {
      mappings.push({
        field,
        value: val,
        source: typeof obj.source === "string" ? obj.source : "unknown",
      });
    }
  }
  return mappings;
}

function buildFormFilledNote(
  mappedCount: number,
  uploadCount: number,
  unmappedRequired: string[],
): string {
  const parts: string[] = [
    `Auto-filled ${mappedCount} field${mappedCount === 1 ? "" : "s"}` +
      (uploadCount > 0
        ? ` and attached ${uploadCount} document${uploadCount === 1 ? "" : "s"}`
        : "") +
      ".",
  ];
  if (unmappedRequired.length > 0) {
    parts.push(
      `Needs human input for ${unmappedRequired.length} required field${
        unmappedRequired.length === 1 ? "" : "s"
      }: ${unmappedRequired.join(", ")}.`,
    );
  }
  parts.push("Review and approve to submit.");
  return parts.join(" ");
}

/** Add a scheme to a bare host; null/empty stays null. */
function normalizeUrl(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** Loose token overlap test between a haystack and a filename. */
function tokenOverlap(haystack: string, fileName: string): boolean {
  const tokens = fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length >= 4);
  return tokens.some((t) => haystack.includes(t.toLowerCase()));
}

function errorMessage(err: unknown): string {
  if (err instanceof AgentError || err instanceof AutomationSessionError) {
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
