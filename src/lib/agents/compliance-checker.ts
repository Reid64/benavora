// Compliance Check Agent - AGENTS.md Agent 07.
//
// Verifies an application package is complete before submission. Combines
// deterministic checks with an optional AI content review:
//   - Required documents (opportunity.required_documents) are matched against the
//     documents actually attached via application_documents - the core check.
//   - The draft is scanned for unresolved [NEEDS INPUT: ...] flags.
//   - The organization profile is checked for the essentials (EIN, tax status).
//   - When a draft exists, Claude analyzes it for completeness, length, and
//     prohibited content; these are advisory findings, not blockers.
//
// readyToSubmit reflects the deterministic completeness checks only - those are
// the gate for ready_for_review -> submitted (BEHAVIORAL_CONTRACTS §6). The AI
// findings inform the reviewer without silently blocking submission.

import { callClaude, DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import {
  AgentError,
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";
import type { Enums } from "@/types/database";

type DocumentCategory = Enums<"document_category">;

export interface ComplianceInput {
  applicationId: string;
}

export interface MissingDocument {
  required: string;
  suggestedCategory: DocumentCategory | null;
}

export interface FailedCheck {
  check: string;
  detail: string;
}

export interface ComplianceResult {
  applicationId: string;
  readyToSubmit: boolean;
  passed: string[];
  failed: FailedCheck[];
  missingDocuments: MissingDocument[];
  /** Advisory issues from the AI content review (do not block submission). */
  aiFindings: string[];
}

export interface ComplianceCheckerOptions extends BaseAgentOptions {
  model?: string;
  maxTokens?: number;
}

export class ComplianceChecker extends BaseAgent<
  ComplianceInput,
  ComplianceResult
> {
  readonly agentType: AgentType = "compliance_check";

  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: ComplianceCheckerOptions) {
    super({ ...options, timeoutMs: options.timeoutMs ?? 180_000 });
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  protected async execute(
    input: ComplianceInput,
  ): Promise<AgentExecution<ComplianceResult>> {
    const applicationId = input.applicationId;

    const { data: app, error } = await this.client
      .from("applications")
      .select("id, opportunity_id, draft_content")
      .eq("id", applicationId)
      .eq("organization_id", this.organizationId)
      .single();

    if (error || !app) {
      throw new AgentError("Application not found.", "not_found", 404);
    }

    const draft = (app.draft_content as string | null) ?? "";

    const [oppRes, linkRes, orgRes] = await Promise.all([
      this.client
        .from("opportunities")
        .select("name, required_documents")
        .eq("id", app.opportunity_id)
        .eq("organization_id", this.organizationId)
        .single(),
      this.client
        .from("application_documents")
        .select("document_id")
        .eq("application_id", applicationId),
      this.client
        .from("organizations")
        .select("ein, tax_status")
        .eq("id", this.organizationId)
        .single(),
    ]);

    const oppName = (oppRes.data?.name as string | undefined) ?? "application";
    const requiredDocs = (
      (oppRes.data?.required_documents as string[] | null) ?? []
    ).filter((d) => typeof d === "string" && d.trim() !== "");

    // Resolve the attached documents' metadata (validate required vs attached).
    const documentIds = (linkRes.data ?? []).map((r) => r.document_id as string);
    let attachedDocs: { file_name: string; description: string | null; category: string }[] =
      [];
    if (documentIds.length > 0) {
      const { data: docs } = await this.client
        .from("documents")
        .select("file_name, description, category")
        .eq("organization_id", this.organizationId)
        .in("id", documentIds);
      attachedDocs = (docs ?? []).map((d) => ({
        file_name: d.file_name as string,
        description: (d.description as string | null) ?? null,
        category: d.category as string,
      }));
    }

    const passed: string[] = [];
    const failed: FailedCheck[] = [];
    const missingDocuments: MissingDocument[] = [];

    // --- Required documents check (the core of this agent) -------------------
    const haystacks = attachedDocs.map((d) =>
      `${d.file_name} ${d.description ?? ""} ${d.category}`.toLowerCase(),
    );
    for (const required of requiredDocs) {
      if (isDocumentAttached(required, haystacks)) {
        passed.push(`Required document present: "${required}".`);
      } else {
        missingDocuments.push({
          required,
          suggestedCategory: guessCategory(required),
        });
        failed.push({
          check: "required_document",
          detail: `Missing required document: "${required}".`,
        });
      }
    }
    if (requiredDocs.length === 0) {
      passed.push("No required documents are specified for this opportunity.");
    }

    // --- Draft completeness check -------------------------------------------
    if (draft.trim() === "") {
      failed.push({
        check: "draft_content",
        detail: "The application has no draft content.",
      });
    } else {
      const needsInput = (draft.match(/\[NEEDS INPUT/gi) ?? []).length;
      if (needsInput > 0) {
        failed.push({
          check: "needs_input",
          detail: `The draft has ${needsInput} unresolved [NEEDS INPUT] placeholder(s).`,
        });
      } else {
        passed.push("Draft has no unresolved [NEEDS INPUT] placeholders.");
      }
    }

    // --- Organization profile completeness ----------------------------------
    if (!toStr(orgRes.data?.ein)) {
      failed.push({
        check: "org_profile",
        detail: "Organization EIN is missing from the profile.",
      });
    } else {
      passed.push("Organization EIN is on file.");
    }
    if (!toStr(orgRes.data?.tax_status)) {
      failed.push({
        check: "org_profile",
        detail: "Organization tax status is missing from the profile.",
      });
    } else {
      passed.push("Organization tax status is on file.");
    }

    // --- AI content review (advisory) ---------------------------------------
    let aiFindings: string[] = [];
    let tokensUsed = 0;
    if (draft.trim() !== "") {
      const { system, prompt } = buildComplianceContentPrompt(oppName, draft);
      const response = await callClaude({
        system,
        prompt,
        model: this.model,
        maxTokens: this.maxTokens,
      });
      aiFindings = parseFindings(response.text);
      tokensUsed = response.usage.totalTokens;
    }

    const readyToSubmit = failed.length === 0;

    return {
      data: {
        applicationId,
        readyToSubmit,
        passed,
        failed,
        missingDocuments,
        aiFindings,
      },
      outputSummary: readyToSubmit
        ? `"${oppName}" passed compliance (${passed.length} checks).`
        : `"${oppName}" failed compliance: ${failed.length} issue(s), ${missingDocuments.length} missing document(s).`,
      itemsFound: passed.length + failed.length,
      itemsProcessed: failed.length,
      tokensUsed,
    };
  }
}

// --- document matching -------------------------------------------------------

/** Significant words (length >= 4) used to match a required doc name. */
function significantTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4);
}

/**
 * A required document counts as attached when an attached document's name,
 * description, or category contains the full required string or any significant
 * word from it. Heuristic by necessity (free-text names), and deliberately
 * lenient - a false "present" is caught at human review, a false "missing" is
 * just a prompt to double-check.
 */
function isDocumentAttached(required: string, haystacks: string[]): boolean {
  const needle = required.toLowerCase().trim();
  if (haystacks.some((h) => h.includes(needle))) return true;
  const tokens = significantTokens(required);
  if (tokens.length === 0) return false;
  return haystacks.some((h) => tokens.some((t) => h.includes(t)));
}

/** Best-guess document category for a missing required doc, for the UI hint. */
function guessCategory(name: string): DocumentCategory | null {
  const n = name.toLowerCase();
  if (/\b(990|tax|w-?9|ein|determination)\b/.test(n)) return "tax_documents";
  if (/\b(bylaw|articles|incorporation|legal|501)\b/.test(n))
    return "legal_documents";
  if (/\b(budget|financ|audit|statement|balance)\b/.test(n))
    return "financial_documents";
  if (/\b(program|project|plan|proposal)\b/.test(n)) return "program_documents";
  if (/\b(support|reference|endorsement|recommendation)\b/.test(n))
    return "letters_of_support";
  if (/\b(photo|image|picture)\b/.test(n)) return "photos";
  if (/\b(brochure|flyer|marketing)\b/.test(n)) return "marketing_materials";
  return null;
}

// --- AI content prompt + parsing --------------------------------------------

function buildComplianceContentPrompt(
  opportunityName: string,
  draft: string,
): { system: string; prompt: string } {
  const system = [
    "You are a grant compliance reviewer checking an application draft for submission readiness.",
    "",
    "RULES:",
    "1. Report only concrete problems: incomplete sections, content that exceeds a stated word/page limit, or prohibited content (e.g. salary costs in an equipment-only request).",
    "2. Be specific and brief. Do not rewrite the draft.",
    "3. Respond with ONLY a single JSON object, no prose or code fences:",
    JSON.stringify({ findings: ["<one specific compliance issue>"] }),
    'If the draft has no compliance problems, return {"findings": []}.',
  ].join("\n");

  const prompt = [
    `# Draft for "${opportunityName}"`,
    draft.trim(),
    "",
    "Return ONLY the JSON object described above.",
  ].join("\n");

  return { system, prompt };
}

function parseFindings(text: string): string[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as {
      findings?: unknown;
    };
    if (!Array.isArray(obj.findings)) return [];
    return obj.findings
      .map((f) => (typeof f === "string" ? f.trim() : ""))
      .filter((f) => f !== "");
  } catch {
    return [];
  }
}

function toStr(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
