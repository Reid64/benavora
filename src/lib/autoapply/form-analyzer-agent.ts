// Analyzes a funder's giving portal, extracts form structure via Claude, and
// persists a reusable form_template record.
//
// This ports the logic in src/lib/agents/form-analyzer.ts (the BaseAgent-
// driven implementation used by the Vercel API route), adapted to operate on
// an already-open Playwright `page` supplied by the caller — the AutoApply
// worker reuses one browser session across analyze + fill for a funder,
// rather than each agent launching its own browser. The logic is duplicated
// here rather than imported because this file is compiled as part of the
// standalone AutoApply worker build, whose tsconfig only includes
// src/lib/autoapply/** and src/lib/supabase/** (see worker/tsconfig.json) —
// src/lib/agents/form-analyzer.ts and its @/lib/ai/claude dependency are out
// of that build's scope.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Page } from 'playwright';
import Anthropic from '@anthropic-ai/sdk';

const MAX_HTML_CHARS = 80_000;
const MAX_PAGE_TEXT_CHARS = 20_000;
const AUTOMATION_CONFIDENCE_THRESHOLD = 0.7;

export interface AnalyzeOptions {
  page: Page;
  portalUrl: string;
  funderId: string;
  organizationId: string;
}

interface FormField {
  name: string;
  label: string;
  type: string;
  required: boolean;
  validation: string | null;
}

interface FormAnalysis {
  fields: FormField[];
  isMultiStep: boolean;
  requiresLogin: boolean;
  requiresFileUpload: boolean;
  formAction: string;
}

interface AutomationAssessment {
  prohibits_automation: boolean;
  relevant_text: string | null;
  confidence: number;
  scanned_at: string;
  /** Non-null when the Claude scan itself was skipped (e.g. no page text to scan), as opposed to run and finding nothing. */
  scan_skipped_reason: string | null;
}

type KbMapping =
  | 'organizations.name'
  | 'organizations.ein'
  | 'organizations.mission_statement'
  | 'organizations.email'
  | 'organizations.phone'
  | 'organizations.address_line1'
  | 'organizations.city'
  | 'organizations.state'
  | 'organizations.zip'
  | 'organizations.website'
  | 'request.amount'
  | 'request.description'
  | 'manual_review_required';

interface FieldMappingEntry {
  fieldName: string;
  fieldLabel: string;
  fieldType: string;
  required: boolean;
  kbMapping: KbMapping;
  manualReviewRequired: boolean;
}

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

const AUTOMATION_SCAN_SYSTEM = `You are a compliance analyst. Scan the provided page text for any language that prohibits automated submissions, bot usage, or requires manual human entry.

Look for phrases such as: "automated submissions prohibited", "no bot submissions", "must be completed manually", "no automated access", "human review required", "do not use scripts or bots", "automated tools not permitted", "terms of use prohibiting automated access".

Return ONLY valid JSON — no prose, no markdown fences:
{"prohibits_automation": boolean, "relevant_text": string | null, "confidence": number}

Rules:
- prohibits_automation: true only if you find clear language that prohibits automation.
- relevant_text: the exact sentence(s) from the page that indicate the prohibition, or null if none found.
- confidence: 0.0 to 1.0. Use 0.0 when no prohibition language is found. Use 0.9+ only for explicit, unambiguous statements.`;

function parseAnalysisResponse(text: string): FormAnalysis {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('Form analysis model returned an unreadable response.');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('Form analysis model returned malformed JSON.');
  }

  const obj = (raw ?? {}) as Record<string, unknown>;
  const rawFields = Array.isArray(obj.fields) ? obj.fields : [];

  const fields: FormField[] = rawFields.map((f) => {
    const field = (f ?? {}) as Record<string, unknown>;
    return {
      name: typeof field.name === 'string' ? field.name : '',
      label: typeof field.label === 'string' ? field.label : '',
      type: typeof field.type === 'string' ? field.type : 'text',
      required: field.required === true,
      validation: typeof field.validation === 'string' ? field.validation : null,
    };
  });

  return {
    fields,
    isMultiStep: obj.isMultiStep === true,
    requiresLogin: obj.requiresLogin === true,
    requiresFileUpload: obj.requiresFileUpload === true,
    formAction: typeof obj.formAction === 'string' ? obj.formAction : '',
  };
}

function parseAutomationResponse(text: string): AutomationAssessment {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  const fallback: AutomationAssessment = {
    prohibits_automation: false,
    relevant_text: null,
    confidence: 0,
    scanned_at: new Date().toISOString(),
    scan_skipped_reason: null,
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
    relevant_text: typeof obj.relevant_text === 'string' ? obj.relevant_text : null,
    confidence: typeof obj.confidence === 'number' ? obj.confidence : 0,
    scanned_at: new Date().toISOString(),
    scan_skipped_reason: null,
  };
}

function mapLabel(label: string): KbMapping {
  const l = label.toLowerCase();

  if (/organization|company/.test(l) && /name/.test(l)) return 'organizations.name';
  if (/^name$|^org name|^organization name|^company name/.test(l)) return 'organizations.name';
  if (/\bein\b|tax\s*id|employer\s*id/.test(l)) return 'organizations.ein';
  if (/mission|vision/.test(l)) return 'organizations.mission_statement';
  if (/email/.test(l)) return 'organizations.email';
  if (/phone|tel(ephone)?/.test(l)) return 'organizations.phone';
  if (/address/.test(l) && !/city|state|zip/.test(l)) return 'organizations.address_line1';
  if (/\bcity\b/.test(l)) return 'organizations.city';
  if (/\bstate\b/.test(l)) return 'organizations.state';
  if (/\bzip\b|postal/.test(l)) return 'organizations.zip';
  if (/website|url|web\s*address/.test(l)) return 'organizations.website';
  if (/amount|request|grant\s*ask|funding\s*request/.test(l)) return 'request.amount';
  if (/describe|description|purpose|project|program|narrative/.test(l)) return 'request.description';

  return 'manual_review_required';
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
      manualReviewRequired: kbMapping === 'manual_review_required',
    };
  });
}

export class FormAnalyzerAgent {
  private readonly claude: Anthropic;

  constructor(private readonly supabase: SupabaseClient) {
    this.claude = new Anthropic();
  }

  async analyzeAndStore(options: AnalyzeOptions): Promise<{ id: string; fieldCount: number }> {
    const { page, portalUrl, funderId, organizationId } = options;

    const { formsHtml, pageText } = await this.extractPageContent(page);

    // Anthropic rejects a user message with empty content (400
    // invalid_request_error: "messages.0: user messages must have
    // non-empty content"). pageText can legitimately come back empty
    // (extractPageContent's own `.catch(() => '')` on a failed evaluate, or
    // a portal whose visible body text really is empty at analysis time),
    // so the automation-prohibition scan is skipped rather than sent as an
    // empty-content request — the caller still gets a real form_templates
    // row with a clearly-reasoned default assessment instead of the whole
    // analysis crashing. The form-structure scan below always has non-empty
    // content (buildFormPrompt always includes the portal URL), so it needs
    // no equivalent guard.
    const [analysisText, automationText] = await Promise.all([
      this.callClaude(SYSTEM_PROMPT, this.buildFormPrompt(portalUrl, formsHtml), 4096),
      pageText.trim() === ''
        ? Promise.resolve<string | null>(null)
        : this.callClaude(AUTOMATION_SCAN_SYSTEM, pageText, 300),
    ]);

    const analysis = parseAnalysisResponse(analysisText);
    const fieldMapping = buildFieldMapping(analysis.fields);
    const automationAssessment: AutomationAssessment =
      automationText === null
        ? {
            prohibits_automation: false,
            relevant_text: null,
            confidence: 0,
            scanned_at: new Date().toISOString(),
            scan_skipped_reason:
              'No visible page text extracted from the portal — automation-prohibition scan skipped to avoid sending Claude an empty message.',
          }
        : parseAutomationResponse(automationText);

    const now = new Date().toISOString();
    const { data: row, error } = await this.supabase
      .from('form_templates')
      .insert({
        organization_id: organizationId,
        funder_id: funderId,
        portal_url: portalUrl,
        form_structure: analysis,
        field_mapping: fieldMapping,
        is_multi_step: analysis.isMultiStep,
        requires_login: analysis.requiresLogin,
        requires_file_upload: analysis.requiresFileUpload,
        automation_assessment: automationAssessment,
        last_verified_at: now,
        updated_at: now,
      })
      .select('id')
      .single();

    if (error || !row) {
      throw new Error(`Failed to save form template: ${error?.message ?? 'no row returned'}`);
    }

    // If automation is prohibited with sufficient confidence, mark the funder
    // as manual_only so the queue processor knows not to auto-submit.
    if (
      automationAssessment.prohibits_automation &&
      automationAssessment.confidence > AUTOMATION_CONFIDENCE_THRESHOLD
    ) {
      await this.supabase
        .from('funders')
        .update({
          automation_level: 'manual_only',
          automation_notes:
            automationAssessment.relevant_text ??
            'Automated submissions detected as prohibited on this portal.',
          updated_at: now,
        })
        .eq('id', funderId)
        .eq('organization_id', organizationId);
    }

    return { id: row.id as string, fieldCount: analysis.fields.length };
  }

  private async callClaude(system: string, prompt: string, maxTokens: number): Promise<string> {
    const message = await this.claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = message.content[0];
    return block?.type === 'text' ? block.text : '';
  }

  private buildFormPrompt(portalUrl: string, html: string): string {
    return `Portal URL: ${portalUrl}\n\nHTML:\n${html.slice(0, MAX_HTML_CHARS)}`;
  }

  private async extractPageContent(page: Page): Promise<{ formsHtml: string; pageText: string }> {
    const formsHtml = await page
      .evaluate(() => {
        const out: string[] = [];
        document.querySelectorAll('form').forEach((form) => out.push(form.outerHTML));
        return out.join('\n\n<!-- FORM SEPARATOR -->\n\n');
      })
      .catch(() => '');

    const pageText = await page
      .evaluate(
        (maxChars: number) => (document.body?.innerText ?? '').slice(0, maxChars),
        MAX_PAGE_TEXT_CHARS,
      )
      .catch(() => '');

    if (formsHtml.trim() === '') {
      const html = await page.content().catch(() => '');
      return { formsHtml: html.slice(0, MAX_HTML_CHARS), pageText };
    }

    return { formsHtml, pageText };
  }
}
