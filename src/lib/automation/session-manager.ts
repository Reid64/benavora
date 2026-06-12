// Automation session manager — Phase 3 (AGENTS.md Agent 16, SCHEMA_REGISTRY
// automation_sessions / automation_steps / automation_screenshots,
// BEHAVIORAL_CONTRACTS §18).
//
// Owns the database side of a browser-automation run: it creates the session
// row, records each step and screenshot, and drives the status lifecycle. The
// BrowserEngine handles the browser; this class handles the bookkeeping.
//
// The Phase 2-5 tables are not in the hand-authored Database type yet, so this
// talks to them through the untyped base SupabaseClient (the same client agents
// already use). Every write is scoped by organization_id — under the service
// role client RLS does not protect us (BEHAVIORAL_CONTRACTS §2).
//
// PAUSE-FOR-APPROVAL INVARIANT (BEHAVIORAL_CONTRACTS §18): the automation drives
// the session to `awaiting_approval` and STOPS. The only path to `submitted`
// runs through `approve()` then `markSubmitted()`, and `markSubmitted()` refuses
// unless a human has already approved. There is intentionally no method that
// approves-and-submits in one step.

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AutomationSession,
  AutomationStatus,
  AutomationStep,
  AutomationStepAction,
  AutomationStepStatus,
  FormField,
  FormMapping,
  ScreenshotCapture,
  ScreenshotRecord,
} from "@/types/automation";

/** Raised for session bookkeeping failures and illegal status transitions. */
export class AutomationSessionError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "AutomationSessionError";
    this.code = code;
  }
}

export interface SessionManagerOptions {
  /** Supabase client. Service role for scheduled/agent runs. */
  client: SupabaseClient;
  /** Tenant scope applied to every write. */
  organizationId: string;
}

export interface CreateSessionInput {
  applicationId?: string | null;
  opportunityId?: string | null;
  funderId?: string | null;
  targetUrl?: string | null;
  /** Profile id of the user who started the run; null for automated. */
  startedBy?: string | null;
  notes?: string | null;
}

export interface RecordStepInput {
  stepNumber: number;
  action: AutomationStepAction;
  description?: string | null;
  status?: AutomationStepStatus;
  inputData?: unknown;
  outputData?: unknown;
  errorMessage?: string | null;
  durationMs?: number | null;
}

export class AutomationSessionManager {
  private readonly client: SupabaseClient;
  private readonly organizationId: string;

  constructor(options: SessionManagerOptions) {
    this.client = options.client;
    this.organizationId = options.organizationId;
  }

  // --- session creation ------------------------------------------------------

  /** Create a new automation_sessions row in `pending` status. */
  async createSession(
    input: CreateSessionInput = {},
  ): Promise<AutomationSession> {
    const { data, error } = await this.client
      .from("automation_sessions")
      .insert({
        organization_id: this.organizationId,
        application_id: input.applicationId ?? null,
        opportunity_id: input.opportunityId ?? null,
        funder_id: input.funderId ?? null,
        status: "pending" satisfies AutomationStatus,
        target_url: input.targetUrl ?? null,
        mapped_fields: [],
        unmapped_fields: [],
        started_by: input.startedBy ?? null,
        notes: input.notes ?? null,
      })
      .select("*")
      .single();

    if (error || !data) {
      throw new AutomationSessionError(
        `Failed to create automation session: ${
          error?.message ?? "no row returned"
        }`,
        "create_failed",
      );
    }
    return data as AutomationSession;
  }

  // --- steps -----------------------------------------------------------------

  /** Record a single automation_steps row. */
  async recordStep(
    sessionId: string,
    input: RecordStepInput,
  ): Promise<AutomationStep> {
    const { data, error } = await this.client
      .from("automation_steps")
      .insert({
        session_id: sessionId,
        step_number: input.stepNumber,
        action: input.action,
        description: input.description ?? null,
        status: input.status ?? "pending",
        input_data: toJson(input.inputData),
        output_data: toJson(input.outputData),
        error_message: input.errorMessage ?? null,
        duration_ms: input.durationMs ?? null,
      })
      .select("*")
      .single();

    if (error || !data) {
      throw new AutomationSessionError(
        `Failed to record automation step: ${
          error?.message ?? "no row returned"
        }`,
        "step_failed",
      );
    }
    return data as AutomationStep;
  }

  // --- screenshots -----------------------------------------------------------

  /**
   * Persist an automation_screenshots row for a screenshot the BrowserEngine
   * already uploaded to Supabase Storage.
   */
  async recordScreenshot(
    sessionId: string,
    capture: ScreenshotCapture,
    options: { stepId?: string | null; description?: string | null } = {},
  ): Promise<ScreenshotRecord> {
    const { data, error } = await this.client
      .from("automation_screenshots")
      .insert({
        session_id: sessionId,
        step_id: options.stepId ?? null,
        storage_path: capture.storagePath,
        description: options.description ?? capture.label,
        page_url: capture.pageUrl,
      })
      .select("*")
      .single();

    if (error || !data) {
      throw new AutomationSessionError(
        `Failed to record screenshot: ${error?.message ?? "no row returned"}`,
        "screenshot_record_failed",
      );
    }
    return data as ScreenshotRecord;
  }

  // --- status lifecycle ------------------------------------------------------

  /** Move the session into `in_progress` and stamp started_at. */
  async start(sessionId: string): Promise<void> {
    await this.update(sessionId, {
      status: "in_progress",
      started_at: new Date().toISOString(),
    });
  }

  /**
   * Persist the detected field split. Called once detection + mapping run so the
   * approval UI can show what was auto-filled vs. what needs human input.
   */
  async saveFieldMapping(
    sessionId: string,
    mappedFields: FormMapping[],
    unmappedFields: FormField[],
  ): Promise<void> {
    await this.update(sessionId, {
      mapped_fields: toJson(mappedFields) ?? [],
      unmapped_fields: toJson(unmappedFields) ?? [],
    });
  }

  /**
   * The pause point. The automation reaches `awaiting_approval` and stops here;
   * nothing in this class advances past it without an explicit human approve()
   * (BEHAVIORAL_CONTRACTS §18).
   */
  async markAwaitingApproval(
    sessionId: string,
    notes?: string | null,
  ): Promise<void> {
    await this.update(sessionId, {
      status: "awaiting_approval",
      ...(notes !== undefined ? { notes } : {}),
    });
  }

  /**
   * Record a human's approval to submit. `approvedBy` is the approving profile
   * id and is required — approval is never anonymous or automated.
   */
  async approve(sessionId: string, approvedBy: string): Promise<void> {
    if (!approvedBy) {
      throw new AutomationSessionError(
        "Approval requires the approving user's profile id.",
        "approval_requires_user",
      );
    }
    const session = await this.getSession(sessionId);
    if (session.status !== "awaiting_approval") {
      throw new AutomationSessionError(
        `Cannot approve a session in status "${session.status}"; it must be awaiting_approval.`,
        "invalid_transition",
      );
    }
    await this.update(sessionId, {
      status: "approved",
      approved_by: approvedBy,
    });
  }

  /**
   * Record that the (human-approved) submission completed. Refuses unless the
   * session has already been approved — this is the guard that makes
   * auto-submission impossible through this manager.
   */
  async markSubmitted(
    sessionId: string,
    confirmationNumber?: string | null,
  ): Promise<void> {
    const session = await this.getSession(sessionId);
    if (session.status !== "approved") {
      throw new AutomationSessionError(
        `Cannot submit a session in status "${session.status}"; a human must approve() it first.`,
        "submission_requires_approval",
      );
    }
    await this.update(sessionId, {
      status: "submitted",
      confirmation_number: confirmationNumber ?? null,
      completed_at: new Date().toISOString(),
    });
  }

  /** Mark the session failed with a reason. Terminal. */
  async markFailed(sessionId: string, errorMessage: string): Promise<void> {
    await this.update(sessionId, {
      status: "failed",
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    });
  }

  /** Mark the session cancelled (e.g. user aborted). Terminal. */
  async markCancelled(
    sessionId: string,
    notes?: string | null,
  ): Promise<void> {
    await this.update(sessionId, {
      status: "cancelled",
      completed_at: new Date().toISOString(),
      ...(notes !== undefined ? { notes } : {}),
    });
  }

  // --- reads -----------------------------------------------------------------

  /** Fetch a session row, scoped to this organization. */
  async getSession(sessionId: string): Promise<AutomationSession> {
    const { data, error } = await this.client
      .from("automation_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("organization_id", this.organizationId)
      .single();

    if (error || !data) {
      throw new AutomationSessionError(
        `Automation session ${sessionId} not found.`,
        "not_found",
      );
    }
    return data as AutomationSession;
  }

  // --- internal --------------------------------------------------------------

  /** Patch a session row, always re-scoped by organization_id, bump updated_at. */
  private async update(
    sessionId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await this.client
      .from("automation_sessions")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", sessionId)
      .eq("organization_id", this.organizationId);

    if (error) {
      throw new AutomationSessionError(
        `Failed to update automation session ${sessionId}: ${error.message}`,
        "update_failed",
      );
    }
  }
}

/** Serialize arbitrary data for a jsonb column; undefined → null. */
function toJson(value: unknown): unknown {
  return value === undefined ? null : value;
}
