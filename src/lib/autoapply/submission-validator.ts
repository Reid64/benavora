import Anthropic from "@anthropic-ai/sdk";
import type { FormField } from "@/types/automation";

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export interface ReadinessReport {
  ready: boolean;
  score: number;
  missing_required: string[];
  missing_recommended: string[];
  blockers: string[];
}

const EIN_RE = /^\d{2}-\d{7}$/;
const DIGITS_RE = /\D/g;
const ZIP5_RE = /^\d{5}$/;
const ZIP9_RE = /^\d{9}$/;

function labelContains(field: FormField, ...terms: string[]): boolean {
  const haystack = `${field.fieldLabel} ${field.fieldName}`.toLowerCase();
  return terms.some((t) => haystack.includes(t));
}

function validateFieldFormat(
  field: FormField,
  value: string,
): { error?: string; warning?: string } {
  const v = value.trim();

  if (labelContains(field, "ein", "employer identification", "tax id", "tax-id", "taxid")) {
    if (!EIN_RE.test(v)) {
      return { error: "EIN must be in XX-XXXXXXX format (e.g. 12-3456789)" };
    }
  }

  if (labelContains(field, "phone", "tel", "telephone", "mobile", "cell", "fax")) {
    const digits = v.replace(DIGITS_RE, "");
    if (digits.length < 10) {
      return { error: "Phone number must contain at least 10 digits" };
    }
  }

  if (
    field.fieldName.toLowerCase().includes("email") ||
    labelContains(field, "email", "e-mail")
  ) {
    if (!v.includes("@") || !v.includes(".")) {
      return { error: "Email address must contain @ and a domain (e.g. name@example.org)" };
    }
  }

  if (labelContains(field, "url", "website", "web site", "homepage", "portal")) {
    if (!v.startsWith("http://") && !v.startsWith("https://")) {
      return { error: "URL must start with http:// or https://" };
    }
  }

  if (labelContains(field, "zip", "postal", "zip code", "zipcode")) {
    const digits = v.replace(DIGITS_RE, "");
    if (!ZIP5_RE.test(digits) && !ZIP9_RE.test(digits)) {
      return { error: "ZIP code must be 5 or 9 digits (e.g. 78701 or 787014321)" };
    }
  }

  if (
    labelContains(field, "date", "deadline", "due date", "expir", "effective") &&
    !labelContains(field, "update", "created")
  ) {
    const d = new Date(v);
    if (isNaN(d.getTime())) {
      return { error: `"${v}" is not a valid date` };
    }
  }

  return {};
}

let _client: Anthropic | null = null;

function getClaude(): Anthropic {
  if (!_client) {
    const apiKey = process.env["ANTHROPIC_API_KEY"];
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export class SubmissionValidator {
  async validateFormData(
    formFields: FormField[],
    fieldValues: Record<string, string>,
    _orgData: unknown,
  ): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    for (const field of formFields) {
      const value = fieldValues[field.fieldName] ?? fieldValues[field.selector] ?? "";

      if (field.required && value.trim() === "") {
        errors.push({
          field: field.fieldLabel || field.fieldName,
          message: `"${field.fieldLabel || field.fieldName}" is required`,
        });
        continue;
      }

      if (value.trim() === "") continue;

      const { error, warning } = validateFieldFormat(field, value);
      if (error) {
        errors.push({ field: field.fieldLabel || field.fieldName, message: error });
      } else if (warning) {
        warnings.push({ field: field.fieldLabel || field.fieldName, message: warning });
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async checkOrgReadiness(orgId: string, supabase: any): Promise<ReadinessReport> {
    const missing_required: string[] = [];
    const missing_recommended: string[] = [];
    const blockers: string[] = [];

    // --- KB completeness: query organizations table ---
    // NOTE: `organizations` has no `contact_name` column (never has, in any
    // migration) — that column only exists on unrelated tables like
    // outreach_contacts/prospects. Selecting it here used to make this whole
    // query error out, so every KB field silently registered as missing
    // regardless of real data. `founder_name` is the closest real column for
    // "who to list as the org's primary contact."
    const { data: org } = await supabase
      .from("organizations")
      .select("mission_statement, ein, address_line1, founder_name, contact_email, phone")
      .eq("id", orgId)
      .single();

    const kbRequired: Array<[string, string]> = [
      ["mission_statement", "Mission statement"],
      ["ein", "EIN (Employer Identification Number)"],
      ["address_line1", "Organization address"],
      ["founder_name", "Primary contact name"],
      ["contact_email", "Primary contact email"],
    ];

    const kbRecommended: Array<[string, string]> = [
      ["phone", "Organization phone number"],
    ];

    const orgRow = (org ?? {}) as Record<string, unknown>;

    for (const [key, label] of kbRequired) {
      const val = orgRow[key];
      if (!val || String(val).trim() === "") {
        missing_required.push(label);
      }
    }

    for (const [key, label] of kbRecommended) {
      const val = orgRow[key];
      if (!val || String(val).trim() === "") {
        missing_recommended.push(label);
      }
    }

    // Check programs (recommended)
    const { data: programs } = await supabase
      .from("programs")
      .select("id")
      .eq("organization_id", orgId);

    if (!programs || (programs as unknown[]).length === 0) {
      missing_recommended.push("Program descriptions");
    }

    // --- Document vault check ---
    const { data: docs } = await supabase
      .from("org_documents")
      .select("document_type")
      .eq("organization_id", orgId)
      .eq("is_current", true);

    const presentDocs = new Set(
      ((docs ?? []) as Array<{ document_type: string }>).map((d) => d.document_type),
    );

    const docRequired: Array<[string, string]> = [
      ["501c3_letter", "501(c)(3) determination letter"],
      ["form_990", "IRS Form 990"],
    ];

    const docRecommended: Array<[string, string]> = [
      ["board_list", "Board member list"],
    ];

    for (const [type, label] of docRequired) {
      if (!presentDocs.has(type)) {
        missing_required.push(label);
      }
    }

    for (const [type, label] of docRecommended) {
      if (!presentDocs.has(type)) {
        missing_recommended.push(label);
      }
    }

    // --- Active request profiles ---
    const { data: profiles } = await supabase
      .from("request_profiles")
      .select("id")
      .eq("organization_id", orgId)
      .eq("active", true);

    if (!profiles || profiles.length === 0) {
      missing_required.push("At least one active request profile");
      blockers.push("No active request profiles — AutoApply cannot determine what to request from funders");
    }

    // Required KB or doc gaps are also blockers
    if (missing_required.some((m) => m !== "At least one active request profile")) {
      blockers.push("Required organization information is incomplete — form filling will produce inaccurate submissions");
    }

    const ready = missing_required.length === 0;

    // Score: required items worth 70 pts, recommended worth 30 pts
    const totalRequired = kbRequired.length + docRequired.length + 1; // +1 for profiles
    const totalRecommended = kbRecommended.length + 1 + docRecommended.length; // +1 for programs

    const metRequired = totalRequired - missing_required.length;
    const metRecommended = totalRecommended - missing_recommended.length;

    const score = Math.round(
      (metRequired / totalRequired) * 70 + (metRecommended / totalRecommended) * 30,
    );

    return {
      ready,
      score: Math.max(0, Math.min(100, score)),
      missing_required,
      missing_recommended,
      blockers,
    };
  }

  /**
   * Mutual-exclusion check against the *other* AutoApply implementation —
   * "Agent 16" (`/api/agents/automation`, `automation_sessions` table,
   * browser-automation with human approval) — for the same org+funder pair.
   * These two pipelines (this one via `submission_queue`, the other via
   * `automation_sessions`) have no shared lock otherwise and could
   * independently target the same funder's portal at the same time.
   *
   * Deliberately NOT folded into checkOrgReadiness(): readiness is cached
   * per-org (see queue-processor.ts's orgReadinessCache) and reused across
   * every queue item for that org regardless of funder, so a per-funder
   * check can't live inside it without stale-caching a conflict (or lack of
   * one) from a different funder onto every other item for the same org.
   */
  async checkConcurrentAutomation(
    organizationId: string,
    funderId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any,
  ): Promise<{ conflict: boolean; sessionId?: string }> {
    const { data } = await supabase
      .from("automation_sessions")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("funder_id", funderId)
      // Every automation_status value except the terminal ones (submitted /
      // failed / cancelled) — mirrors the enum in migration 002_phases_2_5.sql.
      .in("status", ["pending", "in_progress", "awaiting_approval", "approved"])
      .limit(1)
      .maybeSingle();

    return data ? { conflict: true, sessionId: (data as { id: string }).id } : { conflict: false };
  }

  /**
   * The mirror-image check, used by the *other* direction: before
   * `/api/agents/automation` starts a new browser-automation session, is
   * this org+funder already active in the `submission_queue` pipeline? Same
   * org+funder scope as checkConcurrentAutomation() above, opposite table.
   */
  async checkConcurrentSubmissionQueue(
    organizationId: string,
    funderId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any,
  ): Promise<{ conflict: boolean; queueItemId?: string }> {
    const { data } = await supabase
      .from("submission_queue")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("funder_id", funderId)
      .in("status", ["pending", "processing"])
      .limit(1)
      .maybeSingle();

    return data ? { conflict: true, queueItemId: (data as { id: string }).id } : { conflict: false };
  }

  async detectExistingSubmission(
    page: unknown,
  ): Promise<{ hasPending: boolean; message?: string }> {
    const p = page as { evaluate: (fn: () => string) => Promise<string> };

    let pageText = "";
    try {
      pageText = await p.evaluate(() => document.body?.innerText ?? "");
    } catch {
      return { hasPending: false };
    }

    if (!pageText.trim()) {
      return { hasPending: false };
    }

    const claude = getClaude();

    const response = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: `Does the following web page text show any indication that a donation or grant request from this organization is already pending, under review, or has already been submitted? Look for phrases like "You have a pending request", "Already submitted", "Your application is under review", "Duplicate submission detected", or similar.

Respond with JSON only: { "hasPending": true/false, "message": "<the exact phrase found, or null>" }

Page text:
${pageText.slice(0, 4000)}`,
        },
      ],
    });

    const raw = response.content[0]?.type === "text" ? response.content[0].text : "";

    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return { hasPending: false };
      const parsed = JSON.parse(jsonMatch[0]) as { hasPending?: boolean; message?: string | null };
      return {
        hasPending: parsed.hasPending === true,
        message: parsed.message ?? undefined,
      };
    } catch {
      return { hasPending: false };
    }
  }
}
