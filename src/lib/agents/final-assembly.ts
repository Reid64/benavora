// Final Assembly Agent - AGENTS.md Agent 09.
//
// Assembles the complete application package. It orders the attached documents to
// match the opportunity's stated requirements, builds a submission checklist,
// compiles a package summary (applicant + contact info, amount requested,
// document list), and optionally drafts a cover letter with Claude. Documents
// themselves stay in Supabase Storage - this agent organizes references, not
// files (AGENTS.md Agent 09).

import { callClaude, DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import { formatCurrency } from "@/lib/utils/formatters";
import {
  AgentError,
  BaseAgent,
  causeOf,
  withCause,
  type AgentExecution,
  type BaseAgentOptions,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";

export interface FinalAssemblyInput {
  applicationId: string;
  /** Whether to draft a cover letter (default true). */
  generateCoverLetter?: boolean;
}

export interface OrderedDocument {
  fileName: string;
  category: string;
  /** The required-document slot this fills, or null when it's a supplemental doc. */
  fulfills: string | null;
}

export interface ChecklistItem {
  item: string;
  complete: boolean;
}

export interface FinalAssemblyResult {
  applicationId: string;
  orderedDocuments: OrderedDocument[];
  checklist: ChecklistItem[];
  coverLetter: string | null;
  summary: string;
}

export interface FinalAssemblyAgentOptions extends BaseAgentOptions {
  model?: string;
  maxTokens?: number;
}

export class FinalAssemblyAgent extends BaseAgent<
  FinalAssemblyInput,
  FinalAssemblyResult
> {
  readonly agentType: AgentType = "final_assembly";

  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: FinalAssemblyAgentOptions) {
    super({ ...options, timeoutMs: options.timeoutMs ?? 300_000 });
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  protected async execute(
    input: FinalAssemblyInput,
  ): Promise<AgentExecution<FinalAssemblyResult>> {
    const applicationId = input.applicationId;

    const { data: app, error } = await this.client
      .from("applications")
      .select("id, opportunity_id, draft_content, requested_amount")
      .eq("id", applicationId)
      .eq("organization_id", this.organizationId)
      .single();

    if (error) {
      console.error(
        `[FinalAssemblyAgent] application fetch failed for applicationId=${applicationId}: ${causeOf(error)}`,
      );
      throw new AgentError(
        withCause("Failed to load the application.", error),
        "db_error",
      );
    }
    if (!app) {
      throw new AgentError("Application not found.", "not_found", 404);
    }

    const draft = (app.draft_content as string | null) ?? "";

    const [oppRes, linkRes, orgRes] = await Promise.all([
      this.client
        .from("opportunities")
        .select("name, funder_id, required_documents, application_method")
        .eq("id", app.opportunity_id)
        .eq("organization_id", this.organizationId)
        .single(),
      this.client
        .from("application_documents")
        .select("document_id")
        .eq("application_id", applicationId),
      this.client
        .from("organizations")
        .select("name, ein, tax_status, email, phone, mission_statement")
        .eq("id", this.organizationId)
        .single(),
    ]);

    if (oppRes.error) {
      console.error(
        `[FinalAssemblyAgent] opportunity fetch failed for opportunityId=${app.opportunity_id}: ${causeOf(oppRes.error)}`,
      );
      throw new AgentError(
        withCause("Failed to load the opportunity.", oppRes.error),
        "db_error",
      );
    }
    if (!oppRes.data) {
      throw new AgentError("Opportunity not found.", "not_found", 404);
    }
    const opp = oppRes.data;
    const oppName = opp.name as string;
    const requiredDocs = (
      (opp.required_documents as string[] | null) ?? []
    ).filter((d) => typeof d === "string" && d.trim() !== "");

    // Attached documents' metadata.
    const documentIds = (linkRes.data ?? []).map((r) => r.document_id as string);
    let attached: { fileName: string; category: string }[] = [];
    if (documentIds.length > 0) {
      const { data: docs } = await this.client
        .from("documents")
        .select("file_name, category, description")
        .eq("organization_id", this.organizationId)
        .in("id", documentIds);
      attached = (docs ?? []).map((d) => ({
        fileName: d.file_name as string,
        category: d.category as string,
      }));
    }

    // Order documents to match the required-documents order, then append extras.
    const { ordered, missing } = orderDocuments(requiredDocs, attached);

    // Submission checklist.
    const needsInput = (draft.match(/\[NEEDS INPUT/gi) ?? []).length;
    const checklist: ChecklistItem[] = [
      { item: "Draft narrative present", complete: draft.trim() !== "" },
      {
        item: "Draft has no unresolved [NEEDS INPUT] placeholders",
        complete: draft.trim() !== "" && needsInput === 0,
      },
      ...requiredDocs.map((req) => ({
        item: `Required document: ${req}`,
        complete: !missing.includes(req),
      })),
    ];

    const org = orgRes.data;

    // Optional cover letter.
    let coverLetter: string | null = null;
    let tokensUsed = 0;
    const wantsCover = input.generateCoverLetter !== false;
    if (wantsCover) {
      const funderRes = opp.funder_id
        ? await this.client
            .from("funders")
            .select("name")
            .eq("id", opp.funder_id)
            .eq("organization_id", this.organizationId)
            .single()
        : { data: null };
      const { system, prompt } = buildCoverLetterPrompt({
        orgName: (org?.name as string | undefined) ?? "the organization",
        mission: (org?.mission_statement as string | null | undefined) ?? null,
        funderName: (funderRes.data?.name as string | null | undefined) ?? null,
        opportunityName: oppName,
        requestedAmount: (app.requested_amount as number | null) ?? null,
      });
      const response = await callClaude({
        system,
        prompt,
        model: this.model,
        maxTokens: this.maxTokens,
      });
      coverLetter = response.text.trim();
      tokensUsed = response.usage.totalTokens;
      checklist.push({ item: "Cover letter drafted", complete: true });
    }

    const summary = buildPackageSummary({
      orgName: (org?.name as string | undefined) ?? "the organization",
      ein: (org?.ein as string | null | undefined) ?? null,
      taxStatus: (org?.tax_status as string | null | undefined) ?? null,
      email: (org?.email as string | null | undefined) ?? null,
      phone: (org?.phone as string | null | undefined) ?? null,
      opportunityName: oppName,
      applicationMethod: (opp.application_method as string | null) ?? null,
      requestedAmount: (app.requested_amount as number | null) ?? null,
      orderedDocuments: ordered,
    });

    // Persist the assembly summary as a note (best effort).
    await this.client.from("notes").insert({
      organization_id: this.organizationId,
      application_id: applicationId,
      content: `**Package Assembly**\n\n${summary}`,
      author_id: this.triggeredBy,
    });

    return {
      data: {
        applicationId,
        orderedDocuments: ordered,
        checklist,
        coverLetter,
        summary,
      },
      outputSummary: `Assembled package for "${oppName}": ${ordered.length} document(s), ${missing.length} missing.`,
      itemsFound: ordered.length,
      itemsProcessed: ordered.length,
      tokensUsed,
    };
  }
}

// --- document ordering -------------------------------------------------------

function significantTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4);
}

function matches(required: string, doc: { fileName: string; category: string }): boolean {
  const hay = `${doc.fileName} ${doc.category}`.toLowerCase();
  const needle = required.toLowerCase().trim();
  if (hay.includes(needle)) return true;
  const tokens = significantTokens(required);
  return tokens.length > 0 && tokens.some((t) => hay.includes(t));
}

/**
 * Order attached documents to mirror the opportunity's required-documents list,
 * then append any attached documents that don't map to a requirement. Returns
 * the ordered list plus the required documents that no attachment satisfied.
 */
function orderDocuments(
  requiredDocs: string[],
  attached: { fileName: string; category: string }[],
): { ordered: OrderedDocument[]; missing: string[] } {
  const ordered: OrderedDocument[] = [];
  const missing: string[] = [];
  // Pool of not-yet-placed documents; matched ones are spliced out as we go.
  const remaining = [...attached];

  for (const req of requiredDocs) {
    const idx = remaining.findIndex((d) => matches(req, d));
    if (idx === -1) {
      missing.push(req);
      continue;
    }
    const [doc] = remaining.splice(idx, 1);
    if (doc) {
      ordered.push({
        fileName: doc.fileName,
        category: doc.category,
        fulfills: req,
      });
    }
  }

  // Any leftover attachments are supplemental, appended after the required ones.
  for (const doc of remaining) {
    ordered.push({ fileName: doc.fileName, category: doc.category, fulfills: null });
  }

  return { ordered, missing };
}

// --- package summary ---------------------------------------------------------

function buildPackageSummary(args: {
  orgName: string;
  ein: string | null;
  taxStatus: string | null;
  email: string | null;
  phone: string | null;
  opportunityName: string;
  applicationMethod: string | null;
  requestedAmount: number | null;
  orderedDocuments: OrderedDocument[];
}): string {
  const lines: string[] = [
    `Applicant: ${args.orgName}`,
  ];
  if (args.ein) lines.push(`EIN: ${args.ein}`);
  if (args.taxStatus) lines.push(`Tax status: ${args.taxStatus}`);
  const contact = [args.email, args.phone].filter(Boolean).join(" · ");
  if (contact) lines.push(`Contact: ${contact}`);
  lines.push(`Opportunity: ${args.opportunityName}`);
  if (args.applicationMethod) {
    lines.push(`Submission method: ${args.applicationMethod}`);
  }
  lines.push(`Amount requested: ${formatCurrency(args.requestedAmount)}`);
  lines.push("");
  lines.push("Documents (in submission order):");
  if (args.orderedDocuments.length === 0) {
    lines.push("- (none attached)");
  } else {
    args.orderedDocuments.forEach((d, i) => {
      const tag = d.fulfills ? ` - fulfills "${d.fulfills}"` : " - supplemental";
      lines.push(`${i + 1}. ${d.fileName} [${d.category}]${tag}`);
    });
  }
  return lines.join("\n");
}

// --- cover letter prompt -----------------------------------------------------

function buildCoverLetterPrompt(args: {
  orgName: string;
  mission: string | null;
  funderName: string | null;
  opportunityName: string;
  requestedAmount: number | null;
}): { system: string; prompt: string } {
  const system = [
    `You are writing a cover letter for ${args.orgName}'s grant application.`,
    "",
    "RULES:",
    "1. Use ONLY the facts provided. Never invent figures, partnerships, or outcomes.",
    "2. If a fact you need is missing, mark it with [NEEDS INPUT: ...]. Do not guess.",
    "3. Keep it to a concise, professional one-page letter.",
  ].join("\n");

  const facts: string[] = [`- Organization: ${args.orgName}`];
  if (args.mission) facts.push(`- Mission: ${args.mission}`);
  facts.push(`- Funder: ${args.funderName ?? "the funder"}`);
  facts.push(`- Opportunity: ${args.opportunityName}`);
  if (args.requestedAmount != null) {
    facts.push(`- Amount requested: ${formatCurrency(args.requestedAmount)}`);
  }

  const prompt = [
    "# Task",
    `Write a cover letter to ${args.funderName ?? "the funder"} for "${args.opportunityName}".`,
    "",
    "## Verified facts (the only facts you may use)",
    facts.join("\n"),
    "",
    "## Output",
    "Return only the finished letter text.",
  ].join("\n");

  return { system, prompt };
}
