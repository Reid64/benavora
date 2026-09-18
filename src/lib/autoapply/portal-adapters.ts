// Typed adapter system for corporate/foundation donation portal types.
//
// Each PortalAdapter turns a portal's raw HTML into a structured
// SubmissionPayload the AutoApply worker (worker/queue-processor.ts via
// form-filler-agent.ts) can drive a fill-and-submit pass from. This file only
// classifies and maps — consistent with AUTONOMOUS_HARD_LIMITS.NEVER_SUBMIT_
// EXTERNALLY (AGENTS_v2.md §0), nothing here ever opens a browser page or
// clicks submit.
//
// Real-schema note: `funders.portal_type` (migration 095) already classifies
// a funder's portal by vendor domain via worker/autoapply-autonomous-
// orchestrator.ts's classifyPortalType(), reusing the vendor-domain list from
// submission-controls.ts's SHARED_PLATFORMS. PortalType below reuses that
// same vocabulary so a funders.portal_type value maps directly onto an
// adapter via resolvePortalAdapter() without a second, conflicting taxonomy.

import * as cheerio from 'cheerio';
import Anthropic from '@anthropic-ai/sdk';
import { createTrackedAnthropic } from "@/lib/ai/tracked-anthropic";
import type { OrgProfile, SubmissionProfile } from './org-profile-mapper';

export type { OrgProfile } from './org-profile-mapper';

export type PortalType =
  | 'cybergrants'
  | 'benevity'
  | 'yourcause'
  | 'blackbaud'
  | 'smartsimple'
  | 'submittable'
  | 'fluxx'
  | 'grantinterface'
  | 'salesforce_npsp'
  | 'generic'
  | 'unknown';

export interface FormField {
  name: string;
  label: string;
  type: string;
  required: boolean;
  validation: string | null;
}

// The standardized profile built from KB data by org-profile-mapper.ts. Named
// KnowledgeBaseProfile here to match this task's PortalAdapter signature —
// it's the same shape as SubmissionProfile, not a separate type.
export type KnowledgeBaseProfile = SubmissionProfile;

export interface SubmissionPayload {
  portalType: PortalType;
  // Keyed by the FormField.name each value was mapped to.
  fieldValues: Record<string, string>;
  // Names of required fields (per the `fields` passed to buildSubmissionPayload)
  // that had no available profile value to map — carried on the payload so
  // validateSubmission doesn't need the original FormField[] again.
  requiredFieldNames: string[];
  notes: string[];
}

export interface ValidationResult {
  valid: boolean;
  missingRequiredFields: string[];
  errors: string[];
}

export interface PortalAdapter {
  portalType: PortalType;
  detectPortal(url: string, html: string): boolean;
  extractFormFields(html: string): Promise<FormField[]>;
  buildSubmissionPayload(
    org: OrgProfile,
    kb: KnowledgeBaseProfile,
    fields: FormField[],
  ): Promise<SubmissionPayload>;
  validateSubmission(payload: SubmissionPayload): ValidationResult;
}

// --- shared helpers -----------------------------------------------------------

const MAX_HTML_CHARS = 80_000;

function validatePayload(payload: SubmissionPayload): ValidationResult {
  const missingRequiredFields = payload.requiredFieldNames.filter((name) => {
    const value = payload.fieldValues[name];
    return !value || value.trim() === '';
  });
  return {
    valid: missingRequiredFields.length === 0,
    missingRequiredFields,
    errors: missingRequiredFields.map((name) => `Required field "${name}" has no mapped value.`),
  };
}

interface RawField {
  selector: string;
  label: string;
  type: string;
  required: boolean;
}

function extractRawFields(html: string): RawField[] {
  const $ = cheerio.load(html);
  const results: RawField[] = [];

  $('input, select, textarea').each((_i, el) => {
    const $el = $(el);
    const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? '';
    const type = tag === 'input' ? ($el.attr('type') ?? 'text').toLowerCase() : tag;
    if (['hidden', 'submit', 'button', 'image', 'reset'].includes(type)) return;

    const id = $el.attr('id');
    const name = $el.attr('name');
    const selector = name || id || '';
    if (!selector) return;

    const labelEl = id ? $(`label[for="${id}"]`) : null;
    const label =
      (labelEl && labelEl.length > 0 ? labelEl.text().trim() : '') ||
      $el.attr('aria-label') ||
      $el.attr('placeholder') ||
      name ||
      '';

    const required = $el.attr('required') !== undefined || $el.attr('aria-required') === 'true';

    results.push({ selector, label: label.trim(), type, required });
  });

  return results;
}

function toFormFields(raw: RawField[]): FormField[] {
  return raw.map((f) => ({
    name: f.selector,
    label: f.label,
    type: f.type,
    required: f.required,
    validation: null,
  }));
}

// --- CyberGrants ----------------------------------------------------------------

type CyberGrantsKey =
  | 'organization_name'
  | 'ein'
  | 'mission'
  | 'program_description'
  | 'requested_amount'
  | 'budget_narrative';

function classifyCyberGrantsField(labelOrName: string): CyberGrantsKey | null {
  const l = labelOrName.toLowerCase();
  if (/\bein\b|tax\s*id|employer\s*identification/.test(l)) return 'ein';
  if (/(organization|company|org)(\s*legal)?\s*name|^name$/.test(l)) return 'organization_name';
  if (/\bmission\b/.test(l)) return 'mission';
  if (/program\s*(description|summary|overview)/.test(l)) return 'program_description';
  if (/(requested|grant|funding)\s*amount|amount\s*requested/.test(l)) return 'requested_amount';
  if (/budget\s*(narrative|justification|summary)/.test(l)) return 'budget_narrative';
  return null;
}

export class CyberGrantsAdapter implements PortalAdapter {
  readonly portalType: PortalType = 'cybergrants';

  detectPortal(url: string, html: string): boolean {
    return url.toLowerCase().includes('cybergrants.com') || /cybergrants/i.test(html);
  }

  async extractFormFields(html: string): Promise<FormField[]> {
    const raw = extractRawFields(html).filter((f) => classifyCyberGrantsField(`${f.label} ${f.selector}`));
    return toFormFields(raw);
  }

  async buildSubmissionPayload(
    org: OrgProfile,
    kb: KnowledgeBaseProfile,
    fields: FormField[],
  ): Promise<SubmissionPayload> {
    const valuesByKey: Record<CyberGrantsKey, string> = {
      organization_name: kb.legal_name || org.dba || org.name || '',
      ein: kb.ein || org.ein || '',
      mission: kb.mission_statement || org.mission_statement || '',
      program_description: kb.program_description,
      requested_amount: kb.requested_amount ? String(kb.requested_amount) : '',
      budget_narrative: kb.budget_narrative,
    };

    const fieldValues: Record<string, string> = {};
    const requiredFieldNames: string[] = [];
    const notes: string[] = [];

    for (const field of fields) {
      if (field.required) requiredFieldNames.push(field.name);
      const key = classifyCyberGrantsField(`${field.label} ${field.name}`);
      const value = key ? valuesByKey[key] : '';
      if (value) {
        fieldValues[field.name] = value;
      } else if (field.required) {
        notes.push(`No profile value available for required field "${field.label || field.name}".`);
      }
    }

    return { portalType: this.portalType, fieldValues, requiredFieldNames, notes };
  }

  validateSubmission(payload: SubmissionPayload): ValidationResult {
    return validatePayload(payload);
  }
}

// --- Benevity ---------------------------------------------------------------------

type BenevityKey =
  | 'organization_name'
  | 'ein'
  | 'mission'
  | 'website'
  | 'contact_name'
  | 'contact_email'
  | 'phone'
  | 'address'
  | 'city'
  | 'state'
  | 'zip';

function classifyBenevityField(labelOrName: string): BenevityKey | null {
  const l = labelOrName.toLowerCase();
  if (/\bein\b|tax\s*id|employer\s*identification/.test(l)) return 'ein';
  if (/(organization|nonprofit|company)(\s*legal)?\s*name|^name$/.test(l)) return 'organization_name';
  if (/\bmission\b/.test(l)) return 'mission';
  if (/website|\burl\b/.test(l)) return 'website';
  if (/contact\s*email|^email$/.test(l)) return 'contact_email';
  if (/contact\s*name|primary\s*contact|authorized\s*representative/.test(l)) return 'contact_name';
  if (/phone|telephone/.test(l)) return 'phone';
  if (/\bcity\b/.test(l)) return 'city';
  if (/\bstate\b|province/.test(l)) return 'state';
  if (/\bzip\b|postal/.test(l)) return 'zip';
  if ((/street|address/.test(l)) && !/city|state|zip/.test(l)) return 'address';
  return null;
}

export class BenevityAdapter implements PortalAdapter {
  readonly portalType: PortalType = 'benevity';

  detectPortal(url: string, html: string): boolean {
    const u = url.toLowerCase();
    return u.includes('benevity.org') || u.includes('benevity.com') || /benevity/i.test(html);
  }

  async extractFormFields(html: string): Promise<FormField[]> {
    const raw = extractRawFields(html).filter((f) => classifyBenevityField(`${f.label} ${f.selector}`));
    return toFormFields(raw);
  }

  async buildSubmissionPayload(
    org: OrgProfile,
    kb: KnowledgeBaseProfile,
    fields: FormField[],
  ): Promise<SubmissionPayload> {
    const valuesByKey: Record<BenevityKey, string> = {
      organization_name: kb.legal_name || org.dba || org.name || '',
      ein: kb.ein || org.ein || '',
      mission: kb.mission_statement || org.mission_statement || '',
      website: kb.website || org.website || '',
      contact_name: kb.executive_director_name,
      contact_email: kb.executive_director_email || org.email || '',
      phone: kb.phone || org.phone || '',
      address: kb.address || org.address_line1 || '',
      city: kb.city || org.city || '',
      state: kb.state || org.state || '',
      zip: kb.zip || org.zip || '',
    };

    const fieldValues: Record<string, string> = {};
    const requiredFieldNames: string[] = [];
    const notes: string[] = [];

    for (const field of fields) {
      if (field.required) requiredFieldNames.push(field.name);
      const key = classifyBenevityField(`${field.label} ${field.name}`);
      const value = key ? valuesByKey[key] : '';
      if (value) {
        fieldValues[field.name] = value;
      } else if (field.required) {
        notes.push(`No profile value available for required field "${field.label || field.name}".`);
      }
    }

    return { portalType: this.portalType, fieldValues, requiredFieldNames, notes };
  }

  validateSubmission(payload: SubmissionPayload): ValidationResult {
    return validatePayload(payload);
  }
}

// --- Generic (Claude-driven fallback) --------------------------------------------

const FIELD_EXTRACTION_SYSTEM = `You are a web form analyst. Analyze HTML from a corporate/foundation donation portal and extract every visible input field. Return ONLY valid JSON — no prose, no markdown fences.

Schema: {"fields": [{"name": "string (field name or id attribute)", "label": "string (from label, aria-label, or placeholder)", "type": "string (text|email|tel|textarea|select|file|checkbox|radio|number|date|url)", "required": boolean}]}

Rules:
- Include every visible, fillable field. Exclude hidden/submit/button fields.
- name must be the field's actual name or id attribute value, never invented.`;

const FIELD_MAPPING_SYSTEM = `You are matching a nonprofit organization's profile data to a donation portal's form fields. Return ONLY valid JSON — no prose, no markdown fences.

Schema: {"mappings": [{"name": "string (must exactly match one of the given field names)", "value": "string"}]}

Rules:
- Only include a field if you have a genuinely relevant profile value for it.
- Never invent a value not present in the profile data.
- Skip file, checkbox, and radio fields entirely.`;

function extractFormsHtml(html: string): string {
  const $ = cheerio.load(html);
  const forms: string[] = [];
  $('form').each((_i, el) => {
    forms.push($.html(el));
  });
  const combined = forms.length > 0 ? forms.join('\n\n<!-- FORM SEPARATOR -->\n\n') : html;
  return combined.slice(0, MAX_HTML_CHARS);
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export class GenericAdapter implements PortalAdapter {
  readonly portalType: PortalType = 'generic';
  private readonly claude: Anthropic;

  constructor() {
    this.claude = createTrackedAnthropic({}, "portal-adapters");
  }

  // Always false — this adapter is the fallback used when no other adapter
  // matches, never selected by its own detection.
  detectPortal(): boolean {
    return false;
  }

  async extractFormFields(html: string): Promise<FormField[]> {
    const formsHtml = extractFormsHtml(html);

    const message = await this.claude.messages
      .create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: FIELD_EXTRACTION_SYSTEM,
        messages: [{ role: 'user', content: formsHtml }],
      })
      .catch(() => null);

    if (!message) return [];
    const block = message.content[0];
    const text = block?.type === 'text' ? block.text : '';
    const parsed = parseJsonObject(text);
    const rawFields = Array.isArray(parsed?.fields) ? (parsed.fields as unknown[]) : [];

    return rawFields.map((f) => {
      const field = (f ?? {}) as Record<string, unknown>;
      return {
        name: typeof field.name === 'string' ? field.name : '',
        label: typeof field.label === 'string' ? field.label : '',
        type: typeof field.type === 'string' ? field.type : 'text',
        required: field.required === true,
        validation: null,
      };
    }).filter((f) => f.name !== '');
  }

  async buildSubmissionPayload(
    org: OrgProfile,
    kb: KnowledgeBaseProfile,
    fields: FormField[],
  ): Promise<SubmissionPayload> {
    const requiredFieldNames = fields.filter((f) => f.required).map((f) => f.name);
    const mappableFields = fields.filter((f) => !['file', 'checkbox', 'radio'].includes(f.type));

    if (mappableFields.length === 0) {
      return { portalType: this.portalType, fieldValues: {}, requiredFieldNames, notes: [] };
    }

    const profileContext = JSON.stringify({ ...org, ...kb });
    const fieldContext = JSON.stringify(
      mappableFields.map((f) => ({ name: f.name, label: f.label, type: f.type, required: f.required })),
    );

    const message = await this.claude.messages
      .create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: FIELD_MAPPING_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `Organization profile data:\n${profileContext}\n\nForm fields:\n${fieldContext}`,
          },
        ],
      })
      .catch(() => null);

    const fieldValues: Record<string, string> = {};
    const notes: string[] = [];

    if (message) {
      const block = message.content[0];
      const text = block?.type === 'text' ? block.text : '';
      const parsed = parseJsonObject(text);
      const rawMappings = Array.isArray(parsed?.mappings) ? (parsed.mappings as unknown[]) : [];
      const validNames = new Set(mappableFields.map((f) => f.name));

      for (const m of rawMappings) {
        const mapping = (m ?? {}) as Record<string, unknown>;
        const name = typeof mapping.name === 'string' ? mapping.name : '';
        const value = typeof mapping.value === 'string' ? mapping.value : '';
        if (name && value && validNames.has(name)) {
          fieldValues[name] = value;
        }
      }
    } else {
      notes.push('Claude field-mapping call failed — no fields were mapped.');
    }

    for (const name of requiredFieldNames) {
      if (!fieldValues[name]) {
        notes.push(`No mapped value for required field "${name}".`);
      }
    }

    return { portalType: this.portalType, fieldValues, requiredFieldNames, notes };
  }

  validateSubmission(payload: SubmissionPayload): ValidationResult {
    return validatePayload(payload);
  }
}

// --- resolver -------------------------------------------------------------------

// Order matters: specific vendor adapters are tried before the generic
// fallback. Mirrors the vendor-domain vocabulary already classified onto
// funders.portal_type by worker/autoapply-autonomous-orchestrator.ts's
// classifyPortalType() (migration 095) — yourcause/blackbaud/smartsimple/
// submittable/fluxx/grantinterface/salesforce_npsp are recognized portal_type
// values on that column but have no dedicated adapter yet, so they fall
// through to GenericAdapter here, same as 'unknown'.
export const PORTAL_ADAPTERS: PortalAdapter[] = [new CyberGrantsAdapter(), new BenevityAdapter()];

const GENERIC_ADAPTER = new GenericAdapter();

export function resolvePortalAdapter(url: string, html: string): PortalAdapter {
  for (const adapter of PORTAL_ADAPTERS) {
    if (adapter.detectPortal(url, html)) return adapter;
  }
  return GENERIC_ADAPTER;
}
