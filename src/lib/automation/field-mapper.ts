// Field mapper - Phase 3 browser automation (AGENTS.md Agent 16).
//
// Takes a FormSchema produced by detectFormSchema and an organization's profile
// data, calls the Claude API to intelligently map each field to the best
// matching organizational value, and returns a FieldMapping split into
// auto-fillable entries (confidence ≥ 0.7) and ones that need human review.
//
// No value is ever fabricated: Claude is explicitly instructed to omit fields
// it cannot confidently match. Only concrete, non-empty values from the context
// are submitted back (mirrors BEHAVIORAL_CONTRACTS §16 - no hallucinated data).

import { callClaude } from "@/lib/ai/claude";
import type {
  FieldMapperContext,
  FieldMapping,
  FieldMappingEntry,
  FormSchema,
  FormSchemaField,
} from "@/types/automation";

const CONFIDENCE_REVIEW_THRESHOLD = 0.7;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Map every field in `schema` to the best available value from `context` by
 * asking Claude to perform the matching. Fields Claude cannot match with
 * confidence ≥ 0.7 are placed in `requiresReview` rather than `mappings`.
 */
export async function mapFormFields(
  schema: FormSchema,
  context: FieldMapperContext,
): Promise<FieldMapping> {
  const allFields = schema.sections.flatMap((s) => s.fields);

  if (allFields.length === 0) {
    return { mappings: [], requiresReview: [] };
  }

  const raw = await callMappingApi(schema, allFields, context);
  return splitByConfidence(raw);
}

// ---------------------------------------------------------------------------
// Claude API call
// ---------------------------------------------------------------------------

async function callMappingApi(
  schema: FormSchema,
  fields: FormSchemaField[],
  context: FieldMapperContext,
): Promise<FieldMappingEntry[]> {
  const fieldList = fields.map((f) => ({
    id: f.id,
    label: f.label,
    type: f.type,
    required: f.required,
    ...(f.options ? { options: f.options } : {}),
    ...(f.placeholder ? { placeholder: f.placeholder } : {}),
  }));

  const orgData = stripNulls({
    organization: {
      name: context.organization.name,
      dba: context.organization.dba,
      ein: context.organization.ein,
      tax_status: context.organization.tax_status,
      mission_statement: context.organization.mission_statement,
      vision_statement: context.organization.vision_statement,
      founding_date: context.organization.founding_date,
      service_area: context.organization.service_area,
      target_population: context.organization.target_population,
      annual_budget: context.organization.annual_budget,
      total_staff: context.organization.total_staff,
      address_line1: context.organization.address_line1,
      address_line2: context.organization.address_line2,
      city: context.organization.city,
      state: context.organization.state,
      zip: context.organization.zip,
      phone: context.organization.phone,
      email: context.organization.email,
      website: context.organization.website,
    },
    contact: {
      full_name: context.profile.full_name,
      email: context.profile.email,
    },
    ...(context.application
      ? {
          application: {
            requested_amount: context.application.requested_amount,
            notes: context.application.notes,
          },
        }
      : {}),
    ...(context.opportunity
      ? {
          opportunity: {
            name: context.opportunity.name,
            description: context.opportunity.description,
            amount_min: context.opportunity.amount_min,
            amount_max: context.opportunity.amount_max,
          },
        }
      : {}),
  } as Record<string, unknown>);

  const prompt = `Given this form structure and this organization data, map each form field to the best matching data from the organization profile, application, or opportunity. Return JSON mapping of field_id to value.

Form title: ${schema.title}
Form URL: ${schema.url}

Form fields:
${JSON.stringify(fieldList, null, 2)}

Organization data:
${JSON.stringify(orgData, null, 2)}

Return a JSON array where each element has exactly these keys:
- "field_id": the field's id string (must match one of the ids above)
- "value": the string value to fill (must be a non-empty string from the organization data above - do NOT invent values)
- "source": dotted path describing the data origin, e.g. "organization.name" or "contact.email"
- "confidence": a float from 0.0 to 1.0 (1.0 = certain exact match, 0.5 = plausible but uncertain)

Rules:
- Only include fields you can match to real data from the organization data above.
- Omit fields where no relevant data exists in the organization data.
- Never invent or guess a value - only use data explicitly present above.
- For select/radio fields, match the value to the closest available option label.
- Return ONLY the JSON array, no prose, no markdown fences.`;

  const response = await callClaude({
    prompt,
    model: "claude-haiku-4-5-20251001",
    maxTokens: 2048,
    temperature: 0,
  });

  return parseClaudeResponse(response.text, fields);
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

function parseClaudeResponse(
  text: string,
  fields: FormSchemaField[],
): FieldMappingEntry[] {
  const validIds = new Set(fields.map((f) => f.id));

  // Extract the JSON array - Claude may include surrounding whitespace.
  const jsonText = extractJsonArray(text);
  if (!jsonText) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const entries: FieldMappingEntry[] = [];

  for (const item of parsed) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as Record<string, unknown>).field_id !== "string" ||
      typeof (item as Record<string, unknown>).value !== "string" ||
      typeof (item as Record<string, unknown>).source !== "string" ||
      typeof (item as Record<string, unknown>).confidence !== "number"
    ) {
      continue;
    }

    const entry = item as FieldMappingEntry;

    // Reject unknown field ids and empty values.
    if (!validIds.has(entry.field_id)) continue;
    if (!entry.value.trim()) continue;

    // Clamp confidence to [0, 1].
    const confidence = Math.max(0, Math.min(1, entry.confidence));

    entries.push({ ...entry, confidence });
  }

  return entries;
}

/** Pull the first JSON array out of a string (handles accidental prose wrapping). */
function extractJsonArray(text: string): string | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

// ---------------------------------------------------------------------------
// Split by confidence
// ---------------------------------------------------------------------------

function splitByConfidence(entries: FieldMappingEntry[]): FieldMapping {
  const mappings: FieldMappingEntry[] = [];
  const requiresReview: FieldMappingEntry[] = [];

  for (const entry of entries) {
    if (entry.confidence >= CONFIDENCE_REVIEW_THRESHOLD) {
      mappings.push(entry);
    } else {
      requiresReview.push(entry);
    }
  }

  return { mappings, requiresReview };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Remove null/undefined leaves so the prompt stays concise. */
function stripNulls(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === null || val === undefined) continue;
    if (typeof val === "object" && !Array.isArray(val)) {
      const nested = stripNulls(val as Record<string, unknown>);
      if (Object.keys(nested).length > 0) result[key] = nested;
    } else {
      result[key] = val;
    }
  }
  return result;
}
