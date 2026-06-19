// Form Analyzer Agent - visits a funder's giving portal via Playwright,
// sends the HTML to Claude to extract form structure, builds a field mapping
// to Benavora KB columns, and inserts the result into form_templates.
//
// NOTE: Playwright requires a Chromium binary installed at runtime. This agent
// runs correctly in local Node.js and on the dedicated AutoApply worker. It
// will not run in Vercel serverless (no binary). The /api/agents/form-analyzer
// route is for development and worker-proxied use only.

import { chromium } from "playwright";

import { callClaude, DEFAULT_MAX_TOKENS, DEFAULT_MODEL } from "@/lib/ai/claude";
import {
  AgentError,
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";
import type { Json } from "@/types/database";

const MAX_HTML_CHARS = 80_000;
const PLAYWRIGHT_TIMEOUT_MS = 30_000;

export interface FormAnalyzerInput {
  funderId: string;
}

export interface FormField {
  name: string;
  label: string;
  type: string;
  required: boolean;
  validation: string | null;
}

export interface FormAnalysis {
  fields: FormField[];
  isMultiStep: boolean;
  requiresLogin: boolean;
  requiresFileUpload: boolean;
  formAction: string;
}

export interface FieldMappingEntry {
  fieldName: string;
  fieldLabel: string;
  fieldType: string;
  required: boolean;
  kbMapping: string;
  manualReviewRequired: boolean;
}

export interface FormAnalyzerResult {
  formTemplateId: string;
  funderId: string;
  portalUrl: string;
  fieldsFound: number;
  isMultiStep: boolean;
  requiresLogin: boolean;
  requiresFileUpload: boolean;
  fieldMapping: FieldMappingEntry[];
}

export interface FormAnalyzerAgentOptions extends BaseAgentOptions {
  model?: string;
  maxTokens?: number;
}

export class FormAnalyzerAgent extends BaseAgent<
  FormAnalyzerInput,
  FormAnalyzerResult
> {
  readonly agentType: AgentType = "form_analyzer";

  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: FormAnalyzerAgentOptions) {
    super(options);
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  protected async execute(
    input: FormAnalyzerInput,
  ): Promise<AgentExecution<FormAnalyzerResult>> {
    const { data: funder, error: funderError } = await this.client
      .from("funders")
      .select("id, name, giving_portal_url")
      .eq("id", input.funderId)
      .eq("organization_id", this.organizationId)
      .single();

    if (funderError || !funder) {
      throw new AgentError("Funder not found.", "not_found", 404);
    }

    const portalUrl = funder.giving_portal_url as string | null;
    if (!portalUrl || portalUrl.trim() === "") {
      throw new AgentError(
        "This funder has no giving portal URL. Add one before running form analysis.",
        "no_portal_url",
        422,
      );
    }

    const html = await fetchPageHtml(portalUrl);

    const response = await callClaude({
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(portalUrl, html),
      model: this.model,
      maxTokens: this.maxTokens,
    });

    const analysis = parseAnalysisResponse(response.text);
    const fieldMapping = buildFieldMapping(analysis.fields);

    const now = new Date().toISOString();
    const { data: row, error: insertError } = await this.client
      .from("form_templates")
      .insert({
        organization_id: this.organizationId,
        funder_id: input.funderId,
        portal_url: portalUrl,
        form_structure: analysis as unknown as Json,
        field_mapping: fieldMapping as unknown as Json,
        is_multi_step: analysis.isMultiStep,
        requires_login: analysis.requiresLogin,
        requires_file_upload: analysis.requiresFileUpload,
        last_verified_at: now,
        updated_at: now,
      })
      .select("id")
      .single();

    if (insertError || !row) {
      throw new AgentError(
        "Failed to save form template.",
        "write_failed",
      );
    }

    const manualCount = fieldMapping.filter((f) => f.manualReviewRequired).length;

    return {
      data: {
        formTemplateId: row.id as string,
        funderId: input.funderId,
        portalUrl,
        fieldsFound: analysis.fields.length,
        isMultiStep: analysis.isMultiStep,
        requiresLogin: analysis.requiresLogin,
        requiresFileUpload: analysis.requiresFileUpload,
        fieldMapping,
      },
      outputSummary: `Analyzed "${funder.name as string}" portal: ${analysis.fields.length} fields found, ${manualCount} require manual review. Multi-step: ${analysis.isMultiStep}. Login required: ${analysis.requiresLogin}.`,
      itemsFound: analysis.fields.length,
      itemsProcessed: analysis.fields.length,
      tokensUsed: response.usage.totalTokens,
    };
  }
}

// --- prompt ------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a web form analyst. Analyze HTML from a grant/donation portal and extract all form elements. Return ONLY valid JSON — no prose, no markdown fences.

Schema:
{
  "fields": [
    {
      "name": "string (field name or id attribute)",
      "label": "string (from label element, aria-label, or placeholder)",
      "type": "string (text|email|tel|textarea|select|file|checkbox|radio|number|date|url|hidden|submit)",
      "required": boolean,
      "validation": "string|null (e.g. 'max 500 chars', 'must be EIN format', or null)"
    }
  ],
  "isMultiStep": boolean,
  "requiresLogin": boolean,
  "requiresFileUpload": boolean,
  "formAction": "string (form action URL or empty string)"
}

Rules:
- Include every visible input field. Exclude hidden/submit fields from the fields array unless they carry data.
- isMultiStep: true if the page has multiple steps, pages, or sections with Next/Continue buttons.
- requiresLogin: true if the page prompts for account creation or login before reaching the form.
- requiresFileUpload: true if any field has type=file or the page requests document uploads.
- formAction: the action attribute of the main form element, or empty string if absent.`;

function buildPrompt(portalUrl: string, html: string): string {
  const truncated = html.slice(0, MAX_HTML_CHARS);
  return `Portal URL: ${portalUrl}\n\nHTML:\n${truncated}`;
}

// --- response parsing --------------------------------------------------------

function parseAnalysisResponse(text: string): FormAnalysis {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new AgentError(
      "Form analysis model returned an unreadable response.",
      "bad_model_output",
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AgentError(
      "Form analysis model returned malformed JSON.",
      "bad_model_output",
    );
  }

  const obj = (raw ?? {}) as Record<string, unknown>;
  const rawFields = Array.isArray(obj.fields) ? obj.fields : [];

  const fields: FormField[] = rawFields.map((f) => {
    const field = (f ?? {}) as Record<string, unknown>;
    return {
      name: typeof field.name === "string" ? field.name : "",
      label: typeof field.label === "string" ? field.label : "",
      type: typeof field.type === "string" ? field.type : "text",
      required: field.required === true,
      validation:
        typeof field.validation === "string" ? field.validation : null,
    };
  });

  return {
    fields,
    isMultiStep: obj.isMultiStep === true,
    requiresLogin: obj.requiresLogin === true,
    requiresFileUpload: obj.requiresFileUpload === true,
    formAction: typeof obj.formAction === "string" ? obj.formAction : "",
  };
}

// --- field mapping -----------------------------------------------------------

type KbMapping =
  | "organizations.name"
  | "organizations.ein"
  | "organizations.mission_statement"
  | "organizations.email"
  | "organizations.phone"
  | "organizations.address_line1"
  | "organizations.city"
  | "organizations.state"
  | "organizations.zip"
  | "organizations.website"
  | "request.amount"
  | "request.description"
  | "manual_review_required";

function mapLabel(label: string): KbMapping {
  const l = label.toLowerCase();

  if (/organization|company/.test(l) && /name/.test(l)) return "organizations.name";
  if (/^name$|^org name|^organization name|^company name/.test(l)) return "organizations.name";
  if (/\bein\b|tax\s*id|employer\s*id/.test(l)) return "organizations.ein";
  if (/mission|vision/.test(l)) return "organizations.mission_statement";
  if (/email/.test(l)) return "organizations.email";
  if (/phone|tel(ephone)?/.test(l)) return "organizations.phone";
  if (/address/.test(l) && !/city|state|zip/.test(l)) return "organizations.address_line1";
  if (/\bcity\b/.test(l)) return "organizations.city";
  if (/\bstate\b/.test(l)) return "organizations.state";
  if (/\bzip\b|postal/.test(l)) return "organizations.zip";
  if (/website|url|web\s*address/.test(l)) return "organizations.website";
  if (/amount|request|grant\s*ask|funding\s*request/.test(l)) return "request.amount";
  if (/describe|description|purpose|project|program|narrative/.test(l)) return "request.description";

  return "manual_review_required";
}

function buildFieldMapping(fields: FormField[]): FieldMappingEntry[] {
  return fields.map((field) => {
    const searchText = `${field.label} ${field.name}`.trim();
    const kbMapping = mapLabel(searchText);
    return {
      fieldName: field.name,
      fieldLabel: field.label,
      fieldType: field.type,
      required: field.required,
      kbMapping,
      manualReviewRequired: kbMapping === "manual_review_required",
    };
  });
}

// --- browser -----------------------------------------------------------------

async function fetchPageHtml(url: string): Promise<string> {
  // chromium is imported at module level but the binary must be installed
  // separately via: npx playwright install chromium
  const browser = await chromium.launch({ headless: true }).catch(
    (launchErr: unknown) => {
      const msg =
        launchErr instanceof Error ? launchErr.message : "launch failed";
      throw new AgentError(
        `Playwright could not launch Chromium: ${msg}. Run npx playwright install chromium on the worker host.`,
        "playwright_unavailable",
        503,
      );
    },
  );

  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    await page.goto(url, {
      timeout: PLAYWRIGHT_TIMEOUT_MS,
      // WordPress donation plugins inject the form via JS after DOM ready, so
      // wait for network to settle rather than just DOMContentLoaded.
      waitUntil: "networkidle",
    });

    // A portal's <form> can sit far down a 400K+ char page; sending the whole
    // page truncates at MAX_HTML_CHARS and misses late forms entirely. Extract
    // just the form elements' outerHTML instead - concentrated and small enough
    // to survive truncation. (Manual meadetractor.com test: form outerHTML found
    // all 10 fields; full-page HTML found 0.) Fall back to truncated page content
    // only when the page has no <form> elements at all.
    const formsHtml = await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll("form").forEach((form) => {
        out.push(form.outerHTML);
      });
      return out.join("\n\n<!-- FORM SEPARATOR -->\n\n");
    });

    if (formsHtml.trim() !== "") {
      return formsHtml;
    }

    const html = await page.content();
    return html.slice(0, MAX_HTML_CHARS);
  } finally {
    await browser.close();
  }
}
