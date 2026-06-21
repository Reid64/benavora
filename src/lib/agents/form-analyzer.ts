// Form Analyzer Agent - visits a funder's giving portal via Playwright,
// sends the HTML to Claude to extract form structure, builds a field mapping
// to Benavora KB columns, and inserts the result into form_templates.
//
// Also scans the full page text for anti-automation language (AUTOAPPLY_ARCHITECTURE_V2 §8C).
// If the portal prohibits automated submissions with confidence > 0.7 the funder
// record is updated to automation_level = 'manual_only' and the finding is
// stored in the form_template's automation_assessment column.
//
// NOTE: Playwright requires a Chromium binary installed at runtime. This agent
// runs correctly in local Node.js and on the dedicated AutoApply worker. It
// will not run in Vercel serverless (no binary). The /api/agents/form-analyzer
// route is for development and worker-proxied use only.

import { StealthBrowser } from "@/lib/autoapply/stealth-browser";
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
const MAX_PAGE_TEXT_CHARS = 20_000;
const PLAYWRIGHT_TIMEOUT_MS = 30_000;
const AUTOMATION_CONFIDENCE_THRESHOLD = 0.7;

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

export interface AutomationAssessment {
  prohibits_automation: boolean;
  relevant_text: string | null;
  confidence: number;
  scanned_at: string;
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
  automationAssessment: AutomationAssessment;
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

    const { formsHtml, pageText } = await fetchPageContent(portalUrl);

    // Run form analysis and automation scan in parallel.
    const [analysisResponse, automationResponse] = await Promise.all([
      callClaude({
        system: SYSTEM_PROMPT,
        prompt: buildFormPrompt(portalUrl, formsHtml),
        model: this.model,
        maxTokens: this.maxTokens,
      }),
      callClaude({
        system: AUTOMATION_SCAN_SYSTEM,
        prompt: pageText,
        model: this.model,
        maxTokens: 300,
      }),
    ]);

    const analysis = parseAnalysisResponse(analysisResponse.text);
    const fieldMapping = buildFieldMapping(analysis.fields);
    const automationAssessment = parseAutomationResponse(
      automationResponse.text,
    );

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
        automation_assessment: automationAssessment as unknown as Json,
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

    // If automation is prohibited with sufficient confidence, mark the funder
    // as manual_only so the queue processor knows not to auto-submit.
    if (
      automationAssessment.prohibits_automation &&
      automationAssessment.confidence > AUTOMATION_CONFIDENCE_THRESHOLD
    ) {
      const notes =
        automationAssessment.relevant_text ??
        "Automated submissions detected as prohibited on this portal.";

      await this.client
        .from("funders")
        .update({
          automation_level: "manual_only",
          automation_notes: notes,
          updated_at: now,
        })
        .eq("id", input.funderId)
        .eq("organization_id", this.organizationId);
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
        automationAssessment,
      },
      outputSummary: `Analyzed "${funder.name as string}" portal: ${analysis.fields.length} fields found, ${manualCount} require manual review. Multi-step: ${analysis.isMultiStep}. Login required: ${analysis.requiresLogin}. Automation prohibited: ${automationAssessment.prohibits_automation} (confidence ${automationAssessment.confidence}).`,
      itemsFound: analysis.fields.length,
      itemsProcessed: analysis.fields.length,
      tokensUsed:
        analysisResponse.usage.totalTokens +
        automationResponse.usage.totalTokens,
    };
  }
}

// --- form analysis prompt ----------------------------------------------------

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

function buildFormPrompt(portalUrl: string, html: string): string {
  const truncated = html.slice(0, MAX_HTML_CHARS);
  return `Portal URL: ${portalUrl}\n\nHTML:\n${truncated}`;
}

// --- automation scan prompt --------------------------------------------------

const AUTOMATION_SCAN_SYSTEM = `You are a compliance analyst. Scan the provided page text for any language that prohibits automated submissions, bot usage, or requires manual human entry.

Look for phrases such as: "automated submissions prohibited", "no bot submissions", "must be completed manually", "no automated access", "human review required", "do not use scripts or bots", "automated tools not permitted", "terms of use prohibiting automated access".

Return ONLY valid JSON — no prose, no markdown fences:
{"prohibits_automation": boolean, "relevant_text": string | null, "confidence": number}

Rules:
- prohibits_automation: true only if you find clear language that prohibits automation.
- relevant_text: the exact sentence(s) from the page that indicate the prohibition, or null if none found.
- confidence: 0.0 to 1.0. Use 0.0 when no prohibition language is found. Use 0.9+ only for explicit, unambiguous statements.`;

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

function parseAutomationResponse(text: string): AutomationAssessment {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  const fallback: AutomationAssessment = {
    prohibits_automation: false,
    relevant_text: null,
    confidence: 0,
    scanned_at: new Date().toISOString(),
  };

  if (start === -1 || end <= start) return fallback;

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return fallback;
  }

  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    prohibits_automation: obj.prohibits_automation === true,
    relevant_text:
      typeof obj.relevant_text === "string" ? obj.relevant_text : null,
    confidence: typeof obj.confidence === "number" ? obj.confidence : 0,
    scanned_at: new Date().toISOString(),
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

interface PageContent {
  formsHtml: string;
  pageText: string;
}

async function fetchPageContent(url: string): Promise<PageContent> {
  // StealthBrowser handles the user-agent, fingerprint randomization, and
  // anti-bot hardening. The Chromium binary must be installed on the host:
  // npx playwright install chromium.
  const stealth = new StealthBrowser({ headless: true });
  const { browser, page } = await stealth.launch().catch(
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
    await page.goto(url, {
      timeout: PLAYWRIGHT_TIMEOUT_MS,
      waitUntil: "domcontentloaded",
    });

    // Some portals gate the real page behind a JS bot-challenge interstitial
    // that reloads into the actual content after a moment, and WordPress form
    // plugins inject forms incrementally (trivial search forms first, the real
    // donation form later). networkidle can settle on the challenge screen, and
    // breaking on the first <form> grabs only the search forms. So poll the
    // total form markup length and wait for it to STABILIZE - re-evaluating each
    // tick so it survives the challenge's navigation - before extracting.
    const deadline = Date.now() + PLAYWRIGHT_TIMEOUT_MS;
    let prevLen = -1;
    let stableTicks = 0;
    while (Date.now() < deadline) {
      const len = await page
        .evaluate(() => {
          let total = 0;
          document.querySelectorAll("form").forEach((form) => {
            total += form.outerHTML.length;
          });
          return total;
        })
        .catch(() => 0);
      if (len > 0 && len === prevLen) {
        // ~2s of no change => forms have finished injecting.
        if (++stableTicks >= 2) break;
      } else {
        stableTicks = 0;
      }
      prevLen = len;
      await page.waitForTimeout(1000);
    }

    // Extract form HTML for field analysis.
    const formsHtml = await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll("form").forEach((form) => {
        out.push(form.outerHTML);
      });
      return out.join("\n\n<!-- FORM SEPARATOR -->\n\n");
    });

    // Extract visible page text for the automation prohibition scan.
    // innerText gives rendered text (skips hidden elements) which captures
    // ToS notices, footer policy text, and inline warnings — the locations
    // where anti-automation language typically appears.
    const pageText = await page.evaluate(
      (maxChars: number) =>
        (document.body?.innerText ?? "").slice(0, maxChars),
      MAX_PAGE_TEXT_CHARS,
    );

    // Fall back to truncated page HTML if no forms were found.
    if (formsHtml.trim() === "") {
      const html = await page.content();
      return { formsHtml: html.slice(0, MAX_HTML_CHARS), pageText };
    }

    return { formsHtml, pageText };
  } finally {
    await browser.close();
  }
}
