import type { SupabaseClient } from "@supabase/supabase-js";

import type { BadgeColor } from "@/components/ui";
import type {
  AutomationSession,
  AutomationStatus,
  AutomationStep,
  AutomationStepStatus,
  FormField,
  FormMapping,
  ScreenshotRecord,
} from "@/types/automation";

/**
 * Shared presentation + data logic for the browser-automation UI (BLUEPRINT
 * §Phase 3, AGENTS.md Agent 16, BEHAVIORAL_CONTRACTS §18).
 *
 * Single source of truth for status labels/colors, the field-report status
 * model, the stored-JSON parsers (the Phase 2-5 tables are not in the
 * hand-authored Database type, so `mapped_fields`/`unmapped_fields` arrive as
 * loose JSON), and the loaders the list and detail pages share. Reads are
 * RLS-scoped to the organization, so callers never send an organization_id.
 */

// --- status presentation -----------------------------------------------------

/** Display labels for each automation_status enum value. */
export const STATUS_LABEL: Record<AutomationStatus, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  awaiting_approval: "Awaiting Approval",
  approved: "Approved",
  submitted: "Submitted",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Badge color per status, grouping by lifecycle phase. */
export const STATUS_COLOR: Record<AutomationStatus, BadgeColor> = {
  pending: "gray",
  in_progress: "blue",
  awaiting_approval: "yellow",
  approved: "purple",
  submitted: "green",
  failed: "red",
  cancelled: "gray",
};

/** Statuses surfaced as filter options on the list page (plus "all"). */
export const STATUS_FILTERS: AutomationStatus[] = [
  "pending",
  "in_progress",
  "awaiting_approval",
  "submitted",
  "failed",
];

/** Labels for each automation_steps.status value. */
export const STEP_STATUS_LABEL: Record<AutomationStepStatus, string> = {
  pending: "Pending",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
};

/** Badge color per step status. */
export const STEP_STATUS_COLOR: Record<AutomationStepStatus, BadgeColor> = {
  pending: "gray",
  completed: "green",
  failed: "red",
  skipped: "yellow",
};

// --- field report model ------------------------------------------------------

/**
 * The three states a form field can be in for the field report (task spec):
 *  - filled: auto-filled from org data (green) — has a value + source
 *  - needs_input: unmapped, optional field awaiting human input (yellow)
 *  - required_missing: unmapped, required field that couldn't be filled (red)
 */
export type FieldReportStatus = "filled" | "needs_input" | "required_missing";

export const FIELD_STATUS_LABEL: Record<FieldReportStatus, string> = {
  filled: "Auto-filled",
  needs_input: "Needs input",
  required_missing: "Required — not filled",
};

export const FIELD_STATUS_COLOR: Record<FieldReportStatus, BadgeColor> = {
  filled: "green",
  needs_input: "yellow",
  required_missing: "red",
};

/** A unified row for the field report — either auto-filled or awaiting input. */
export interface FieldReportRow {
  /** Stable key for React + matching manual values to fields on the server. */
  selector: string;
  fieldName: string;
  fieldLabel: string;
  fieldType: FormField["fieldType"];
  required: boolean;
  status: FieldReportStatus;
  /** Auto-filled value, when status is "filled". */
  value: string | null;
  /** Provenance of the auto-filled value (e.g. "organization.name"). */
  source: string | null;
  options?: string[];
}

/**
 * Build the field report rows from a session's stored field split. Mapped
 * fields become "filled"; unmapped fields become "required_missing" when the
 * field is required, otherwise "needs_input".
 */
export function buildFieldReport(session: AutomationSession): FieldReportRow[] {
  const mapped = parseMappings(session.mapped_fields).map<FieldReportRow>(
    (m) => ({
      selector: m.field.selector,
      fieldName: m.field.fieldName,
      fieldLabel: m.field.fieldLabel || m.field.fieldName || m.field.selector,
      fieldType: m.field.fieldType,
      required: m.field.required,
      status: "filled",
      value: m.value,
      source: m.source,
      options: m.field.options,
    }),
  );

  const unmapped = parseFields(session.unmapped_fields).map<FieldReportRow>(
    (f) => ({
      selector: f.selector,
      fieldName: f.fieldName,
      fieldLabel: f.fieldLabel || f.fieldName || f.selector,
      fieldType: f.fieldType,
      required: f.required,
      status: f.required ? "required_missing" : "needs_input",
      value: null,
      source: null,
      options: f.options,
    }),
  );

  return [...mapped, ...unmapped];
}

// --- stored-JSON parsers (mirror the server-side parsers) --------------------

/** Re-hydrate FormMapping[] stored in automation_sessions.mapped_fields. */
export function parseMappings(value: unknown): FormMapping[] {
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

/** Re-hydrate FormField[] stored in automation_sessions.unmapped_fields. */
export function parseFields(value: unknown): FormField[] {
  if (!Array.isArray(value)) return [];
  const fields: FormField[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.selector === "string" && typeof obj.fieldType === "string") {
      fields.push(obj as unknown as FormField);
    }
  }
  return fields;
}

// --- list loader -------------------------------------------------------------

/** An automation session enriched with the related funder and opportunity names. */
export interface AutomationSessionListItem {
  id: string;
  status: AutomationStatus;
  applicationId: string | null;
  funderName: string | null;
  opportunityName: string | null;
  targetUrl: string | null;
  stepCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Load all automation sessions for the organization with their funder /
 * opportunity names and step counts. RLS scopes every read to the organization,
 * so no organization_id filter is applied client-side. Throws on the primary
 * query failure so callers can surface an error.
 */
export async function loadAutomationSessions(
  supabase: SupabaseClient,
): Promise<AutomationSessionListItem[]> {
  const { data: sessions, error } = await supabase
    .from("automation_sessions")
    .select(
      "id, status, application_id, opportunity_id, funder_id, target_url, created_at, updated_at",
    )
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (sessions ?? []) as Array<{
    id: string;
    status: AutomationStatus;
    application_id: string | null;
    opportunity_id: string | null;
    funder_id: string | null;
    target_url: string | null;
    created_at: string;
    updated_at: string;
  }>;

  if (rows.length === 0) return [];

  const funderIds = [...new Set(rows.map((r) => r.funder_id).filter(isString))];
  const opportunityIds = [
    ...new Set(rows.map((r) => r.opportunity_id).filter(isString)),
  ];
  const sessionIds = rows.map((r) => r.id);

  const [fundersRes, oppsRes, stepsRes] = await Promise.all([
    funderIds.length > 0
      ? supabase.from("funders").select("id, name").in("id", funderIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    opportunityIds.length > 0
      ? supabase
          .from("opportunities")
          .select("id, name")
          .in("id", opportunityIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    supabase
      .from("automation_steps")
      .select("session_id")
      .in("session_id", sessionIds),
  ]);

  const funderNames = new Map<string, string>();
  for (const f of (fundersRes.data ?? []) as { id: string; name: string }[]) {
    funderNames.set(f.id, f.name);
  }
  const opportunityNames = new Map<string, string>();
  for (const o of (oppsRes.data ?? []) as { id: string; name: string }[]) {
    opportunityNames.set(o.id, o.name);
  }
  const stepCounts = new Map<string, number>();
  for (const s of (stepsRes.data ?? []) as { session_id: string }[]) {
    stepCounts.set(s.session_id, (stepCounts.get(s.session_id) ?? 0) + 1);
  }

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    applicationId: r.application_id,
    funderName: r.funder_id ? (funderNames.get(r.funder_id) ?? null) : null,
    opportunityName: r.opportunity_id
      ? (opportunityNames.get(r.opportunity_id) ?? null)
      : null,
    targetUrl: r.target_url,
    stepCount: stepCounts.get(r.id) ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

function isString(value: string | null): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Full session detail bundle returned by the detail API route. */
export interface SessionDetailResponse {
  session: AutomationSession;
  steps: AutomationStep[];
  screenshots: ScreenshotRecord[];
}

/** A session is editable (fields/approval) only while awaiting approval. */
export function isAwaitingApproval(status: AutomationStatus): boolean {
  return status === "awaiting_approval";
}

/** Terminal statuses — no further action is possible. */
export function isTerminal(status: AutomationStatus): boolean {
  return status === "submitted" || status === "failed" || status === "cancelled";
}
