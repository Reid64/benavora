// Browser-automation types - Phase 3 (BLUEPRINT §Phase 3, AGENTS.md Agent 16,
// BEHAVIORAL_CONTRACTS §18).
//
// These mirror the automation_sessions / automation_steps /
// automation_screenshots tables in SCHEMA_REGISTRY.md (Migration 002) and the
// in-memory shapes the automation library passes around (detected form fields,
// field→data mappings, captured screenshots).
//
// The hand-authored Database type (src/types/database.ts) does not yet include
// the Phase 2-5 tables, so the library talks to those tables through the
// untyped base SupabaseClient. The row interfaces here are the typed contract
// the library and its callers use in their place.

import type { Json } from "@/types/database";

// --- session status ----------------------------------------------------------

/**
 * Lifecycle of one browser-automation session. Mirrors the `automation_status`
 * enum. The automation NEVER advances past `awaiting_approval` on its own - a
 * human must approve before `approved` → `submitted` (BEHAVIORAL_CONTRACTS §18).
 */
export type AutomationStatus =
  | "pending"
  | "in_progress"
  | "awaiting_approval"
  | "approved"
  | "submitted"
  | "failed"
  | "cancelled";

/** Status of a single step within a session. Mirrors automation_steps.status. */
export type AutomationStepStatus =
  | "pending"
  | "completed"
  | "failed"
  | "skipped";

/** The actions a step can represent. Mirrors automation_steps.action. */
export type AutomationStepAction =
  | "navigate"
  | "detect_form"
  | "fill_field"
  | "upload_file"
  | "screenshot"
  | "submit"
  | "detect_challenge";

/** The kind of challenge the detector found on the page. */
export type ChallengeType =
  | "captcha"
  | "mfa"
  | "account_creation"
  | "login_required"
  | "none";

/** Result returned by ChallengeDetector.detect() and stored in step output_data. */
export interface ChallengeResult {
  detected: boolean;
  type: ChallengeType;
  /** Storage path of the challenge screenshot within the org bucket. */
  screenshot: string;
  /** Human-readable operator instructions. */
  instructions: string;
}

// --- database row shapes -----------------------------------------------------

/** A row of automation_sessions. */
export interface AutomationSession {
  id: string;
  organization_id: string;
  application_id: string | null;
  opportunity_id: string | null;
  funder_id: string | null;
  status: AutomationStatus;
  target_url: string | null;
  /** Fields the engine auto-filled. Stored as JSON; FormMapping[] in practice. */
  mapped_fields: Json;
  /** Fields that need human input. Stored as JSON; FormField[] in practice. */
  unmapped_fields: Json;
  confirmation_number: string | null;
  error_message: string | null;
  notes: string | null;
  started_by: string | null;
  approved_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A row of automation_steps. */
export interface AutomationStep {
  id: string;
  session_id: string;
  step_number: number;
  action: AutomationStepAction;
  description: string | null;
  status: AutomationStepStatus;
  input_data: Json | null;
  output_data: Json | null;
  error_message: string | null;
  duration_ms: number | null;
  created_at: string;
}

/** A row of automation_screenshots. */
export interface ScreenshotRecord {
  id: string;
  session_id: string;
  step_id: string | null;
  /** Path inside the org's Supabase Storage bucket (`org-{org_id}`). */
  storage_path: string;
  description: string | null;
  page_url: string | null;
  captured_at: string;
}

// --- form detection / filling ------------------------------------------------

/** The kinds of form control the detector and filler understand. */
export type FormFieldType =
  | "text"
  | "textarea"
  | "select"
  | "checkbox"
  | "radio"
  | "file";

/** A single form control discovered on a page by the form detector. */
export interface FormField {
  /** Coarse control type the filler dispatches on. */
  fieldType: FormFieldType;
  /** Best machine identifier - the element's name, falling back to its id. */
  fieldName: string;
  /** Human-readable label resolved from <label>, aria-label, or placeholder. */
  fieldLabel: string;
  /** CSS selector that uniquely locates the control on the page. */
  selector: string;
  /** Whether the control is marked required (required attr / aria-required). */
  required: boolean;
  /** Visible option labels, for `select` and `radio` groups. */
  options?: string[];
}

/**
 * A detected field paired with the organizational value that should fill it,
 * plus the provenance of that value (e.g. `organization.name`). For file
 * fields, `value` is a Supabase Storage path the filler downloads and uploads.
 */
export interface FormMapping {
  field: FormField;
  value: string;
  /** Dotted path describing where `value` came from, for the transparency UI. */
  source: string;
  /** 0-1 mapping confidence. Keyword-matched fields default to 0.95. Below 0.9
   *  triggers a pause in semi_autonomous mode (BEHAVIORAL_CONTRACTS §24). */
  confidence?: number;
}

/**
 * Result of mapping detected fields against organizational data:
 * `mappedFields` can be auto-filled; `unmappedFields` need human input
 * (SCHEMA_REGISTRY automation_sessions.mapped_fields / unmapped_fields).
 */
export interface FormMappingResult {
  mappedFields: FormMapping[];
  unmappedFields: FormField[];
}

/** A screenshot the engine captured and uploaded to Supabase Storage. */
export interface ScreenshotCapture {
  /** Path within the org bucket, e.g. `automation/{sessionId}/landing.png`. */
  storagePath: string;
  /** The page URL at capture time, for the screenshot record. */
  pageUrl: string | null;
  /** A short label describing the capture point (landing, filled, etc.). */
  label: string;
}

/** Outcome of a fill run (form-filler). Never includes a submit. */
export interface FillResult {
  /** Fields successfully filled. */
  filledFields: FormMapping[];
  /** Fields that were skipped, each with the reason. */
  skippedFields: Array<{ field: FormField; reason: string }>;
  /** Screenshots captured during the fill (e.g. the filled-form snapshot). */
  screenshots: ScreenshotCapture[];
}

/**
 * Organizational data the form detector maps fields against. Pulled from the
 * organization profile, the acting user's profile, and the application being
 * submitted. All optional - missing values simply leave fields unmapped.
 */
export interface AutofillContext {
  organization: {
    name?: string | null;
    ein?: string | null;
    address_line1?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    mission_statement?: string | null;
    phone?: string | null;
    website?: string | null;
    email?: string | null;
  };
  profile: {
    full_name?: string | null;
    email?: string | null;
  };
  application?: {
    requested_amount?: number | null;
  };
}

// --- FormSchema (detectFormSchema / field-mapper) ----------------------------

/** Richer input-type vocabulary used by detectFormSchema and field-mapper. */
export type FormSchemaFieldType =
  | "text"
  | "email"
  | "phone"
  | "number"
  | "date"
  | "file"
  | "select"
  | "textarea"
  | "checkbox"
  | "radio";

/** A single form control in the structured schema returned by detectFormSchema. */
export interface FormSchemaField {
  /** Stable identifier - HTML id, then name, then label slug. */
  id: string;
  /** Human-readable label resolved from <label>, aria-label, or placeholder. */
  label: string;
  type: FormSchemaFieldType;
  required: boolean;
  /** Visible option labels for select / radio. */
  options?: string[];
  placeholder?: string;
  /** HTML pattern attribute, if present. */
  pattern?: string;
}

/** A logical group of fields (e.g. "Contact Info", "Budget"). */
export interface FormSection {
  name: string;
  fields: FormSchemaField[];
}

/** Full structured representation of a giving portal's form. */
export interface FormSchema {
  url: string;
  title: string;
  sections: FormSection[];
  isMultiStep: boolean;
  /** Number of visible steps (1 when not multi-step). */
  stepCount: number;
  /** Visible step labels, e.g. ["Organization", "Project", "Budget"]. */
  stepIndicators: string[];
}

// --- FieldMapping (field-mapper) ---------------------------------------------

/** One field→value pairing produced by the AI mapper. */
export interface FieldMappingEntry {
  field_id: string;
  value: string;
  /** Dotted path of the data source, e.g. "organization.name". */
  source: string;
  /** 0-1 confidence score. Below 0.7 → requiresReview. */
  confidence: number;
}

/** Result of mapFormFields - split into auto-fillable and review-required. */
export interface FieldMapping {
  /** Mappings with confidence ≥ 0.7; safe to auto-fill. */
  mappings: FieldMappingEntry[];
  /** Mappings with confidence < 0.7; need human review before filling. */
  requiresReview: FieldMappingEntry[];
}

/** Full organizational context passed to field-mapper. Superset of AutofillContext. */
export interface FieldMapperContext {
  organization: {
    name?: string | null;
    dba?: string | null;
    ein?: string | null;
    tax_status?: string | null;
    mission_statement?: string | null;
    vision_statement?: string | null;
    founding_date?: string | null;
    service_area?: string | null;
    target_population?: string | null;
    annual_budget?: number | null;
    total_staff?: number | null;
    address_line1?: string | null;
    address_line2?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
  };
  profile: {
    full_name?: string | null;
    email?: string | null;
  };
  application?: {
    requested_amount?: number | null;
    notes?: string | null;
  };
  opportunity?: {
    name?: string | null;
    description?: string | null;
    amount_min?: number | null;
    amount_max?: number | null;
  };
}
