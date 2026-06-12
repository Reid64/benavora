// Form detector — Phase 3 browser automation (AGENTS.md Agent 16).
//
// Two responsibilities:
//   1. detectFields(page): read a page's form controls into structured
//      FormField descriptors via page.$$eval (one in-browser pass, serializable
//      output). Supports text inputs, textareas, selects, checkboxes, radio
//      buttons, and file uploads.
//   2. mapFields(fields, context): match each detected field against the
//      organization profile / acting user / application, returning the fields we
//      can auto-fill (mappedFields) and those that still need human input
//      (unmappedFields) — exactly the split persisted to
//      automation_sessions.mapped_fields / unmapped_fields.
//
// No value is ever fabricated: a field maps only when the context actually holds
// a non-empty value for it (mirrors the AI no-fabrication rule for drafting).

import type { Page } from "playwright";

import type {
  AutofillContext,
  FormField,
  FormFieldType,
  FormMapping,
  FormMappingResult,
} from "@/types/automation";

// --- detection ---------------------------------------------------------------

/**
 * Read every fillable control on the page into a FormField[]. Runs a single
 * $$eval so all DOM access happens in-browser and only plain data crosses back.
 * Hidden inputs and buttons are ignored.
 */
export async function detectFields(page: Page): Promise<FormField[]> {
  return page.$$eval(
    "input, textarea, select",
    (elements) => {
      // NOTE: everything in this callback runs in the browser. It must be
      // self-contained (no outside references) and return serializable data.
      const IGNORED_INPUT_TYPES = new Set([
        "hidden",
        "submit",
        "button",
        "image",
        "reset",
      ]);

      // Track how many of each tag we've seen, for an nth-of-type fallback
      // selector when an element has neither id nor name.
      const tagCounts: Record<string, number> = {};

      function cssEscape(value: string): string {
        // CSS.escape exists in all modern browsers Playwright drives.
        return typeof CSS !== "undefined" && CSS.escape
          ? CSS.escape(value)
          : value.replace(/["\\]/g, "\\$&");
      }

      function attrSelector(tag: string, attr: string, value: string): string {
        return `${tag}[${attr}="${value.replace(/["\\]/g, "\\$&")}"]`;
      }

      function labelFor(el: Element): string {
        const labelable = el as HTMLInputElement;
        // 1. Associated <label> elements (for=, or wrapping).
        const labels = labelable.labels;
        if (labels && labels.length > 0) {
          const text = Array.from(labels)
            .map((l) => (l.textContent ?? "").trim())
            .filter(Boolean)
            .join(" ");
          if (text) return text;
        }
        // 2. aria-label / aria-labelledby.
        const aria = el.getAttribute("aria-label");
        if (aria && aria.trim()) return aria.trim();
        const labelledBy = el.getAttribute("aria-labelledby");
        if (labelledBy) {
          const parts = labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
            .filter(Boolean)
            .join(" ");
          if (parts) return parts;
        }
        // 3. placeholder, then title.
        const placeholder = el.getAttribute("placeholder");
        if (placeholder && placeholder.trim()) return placeholder.trim();
        const title = el.getAttribute("title");
        if (title && title.trim()) return title.trim();
        // 4. Fall back to the name attribute.
        return el.getAttribute("name") ?? "";
      }

      const result: Array<{
        fieldType: string;
        fieldName: string;
        fieldLabel: string;
        selector: string;
        required: boolean;
        options?: string[];
      }> = [];

      for (const el of Array.from(elements)) {
        const tag = el.tagName.toLowerCase();
        const rawType = (el.getAttribute("type") ?? "").toLowerCase();

        if (tag === "input" && IGNORED_INPUT_TYPES.has(rawType)) continue;

        let fieldType: string;
        if (tag === "textarea") fieldType = "textarea";
        else if (tag === "select") fieldType = "select";
        else if (rawType === "checkbox") fieldType = "checkbox";
        else if (rawType === "radio") fieldType = "radio";
        else if (rawType === "file") fieldType = "file";
        else fieldType = "text"; // text, email, tel, url, number, password, ...

        const name = el.getAttribute("name") ?? "";
        const id = el.id ?? "";
        const value = el.getAttribute("value") ?? "";

        // Build the most specific stable selector available.
        let selector: string;
        const idx = (tagCounts[tag] = (tagCounts[tag] ?? 0) + 1);
        if (id) {
          selector = `#${cssEscape(id)}`;
        } else if ((fieldType === "radio" || fieldType === "checkbox") && name && value) {
          selector = `${attrSelector(tag, "name", name)}[value="${value.replace(
            /["\\]/g,
            "\\$&",
          )}"]`;
        } else if (name) {
          selector = attrSelector(tag, "name", name);
        } else {
          selector = `${tag}:nth-of-type(${idx})`;
        }

        const required =
          (el as HTMLInputElement).required ||
          el.getAttribute("aria-required") === "true";

        const field: {
          fieldType: string;
          fieldName: string;
          fieldLabel: string;
          selector: string;
          required: boolean;
          options?: string[];
        } = {
          fieldType,
          fieldName: name || id || labelFor(el) || `${tag}-${idx}`,
          fieldLabel: labelFor(el) || name || id,
          selector,
          required,
        };

        if (tag === "select") {
          const opts = Array.from((el as HTMLSelectElement).options)
            .map((o) => (o.textContent ?? "").trim())
            .filter(Boolean);
          if (opts.length > 0) field.options = opts;
        } else if (fieldType === "radio") {
          field.options = [labelFor(el) || value].filter(Boolean);
        }

        result.push(field);
      }

      return result;
    },
  ) as Promise<FormField[]>;
}

// --- mapping -----------------------------------------------------------------

/**
 * One mapping rule: if any keyword appears in the field's label or name, resolve
 * a value from the autofill context. A null/empty resolution means "no data" —
 * the field stays unmapped rather than being filled with a blank.
 */
interface MappingRule {
  keywords: string[];
  source: string;
  resolve: (ctx: AutofillContext) => string | null;
}

/**
 * Rules in priority order — the FIRST rule whose keyword matches wins, so more
 * specific phrases must precede generic ones (e.g. "amount requested" before a
 * bare "amount", "organization name" before "name"). Mirrors the field map in
 * the task spec.
 */
const MAPPING_RULES: MappingRule[] = [
  {
    keywords: ["amount requested", "requested amount", "request amount", "funding amount", "grant amount"],
    source: "application.requested_amount",
    resolve: (ctx) => numberOrNull(ctx.application?.requested_amount),
  },
  {
    keywords: ["organization name", "company name", "legal name", "org name", "organisation name"],
    source: "organization.name",
    resolve: (ctx) => textOrNull(ctx.organization.name),
  },
  {
    keywords: ["ein", "tax id", "tax identification", "federal tax", "employer identification"],
    source: "organization.ein",
    resolve: (ctx) => textOrNull(ctx.organization.ein),
  },
  {
    keywords: ["contact name", "your name", "full name", "applicant name", "primary contact"],
    source: "profile.full_name",
    resolve: (ctx) => textOrNull(ctx.profile.full_name),
  },
  {
    keywords: ["mission", "purpose", "about your organization"],
    source: "organization.mission_statement",
    resolve: (ctx) => textOrNull(ctx.organization.mission_statement),
  },
  {
    keywords: ["city"],
    source: "organization.city",
    resolve: (ctx) => textOrNull(ctx.organization.city),
  },
  {
    keywords: ["state", "province"],
    source: "organization.state",
    resolve: (ctx) => textOrNull(ctx.organization.state),
  },
  {
    keywords: ["zip", "postal", "postcode"],
    source: "organization.zip",
    resolve: (ctx) => textOrNull(ctx.organization.zip),
  },
  {
    keywords: ["address", "street"],
    source: "organization.address_line1",
    resolve: (ctx) => textOrNull(ctx.organization.address_line1),
  },
  {
    keywords: ["email", "e-mail"],
    source: "profile.email",
    resolve: (ctx) =>
      textOrNull(ctx.profile.email) ?? textOrNull(ctx.organization.email),
  },
  {
    keywords: ["phone", "telephone", "mobile", "cell"],
    source: "organization.phone",
    resolve: (ctx) => textOrNull(ctx.organization.phone),
  },
  {
    keywords: ["website", "web site", "url", "homepage"],
    source: "organization.website",
    resolve: (ctx) => textOrNull(ctx.organization.website),
  },
];

/**
 * Split detected fields into ones we can auto-fill from the org's data and ones
 * needing human input. File inputs are always left unmapped — documents are
 * attached deliberately, not auto-resolved from the profile.
 */
export function mapFields(
  fields: FormField[],
  context: AutofillContext,
): FormMappingResult {
  const mappedFields: FormMapping[] = [];
  const unmappedFields: FormField[] = [];

  for (const field of fields) {
    if (field.fieldType === "file") {
      unmappedFields.push(field);
      continue;
    }

    const haystack = `${field.fieldLabel} ${field.fieldName}`.toLowerCase();
    const rule = MAPPING_RULES.find((r) =>
      r.keywords.some((kw) => haystack.includes(kw)),
    );
    const value = rule ? rule.resolve(context) : null;

    if (rule && value !== null) {
      mappedFields.push({ field, value, source: rule.source });
    } else {
      unmappedFields.push(field);
    }
  }

  return { mappedFields, unmappedFields };
}

/**
 * Convenience: detect a page's fields and immediately map them against the
 * given organizational context.
 */
export async function detectAndMapFields(
  page: Page,
  context: AutofillContext,
): Promise<FormMappingResult & { fields: FormField[] }> {
  const fields = await detectFields(page);
  const mapping = mapFields(fields, context);
  return { ...mapping, fields };
}

// --- value coercion ----------------------------------------------------------

function textOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function numberOrNull(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return String(value);
}

/** Coarse type guard re-exported for callers that build fields by hand. */
export function isFillableType(type: string): type is FormFieldType {
  return (
    type === "text" ||
    type === "textarea" ||
    type === "select" ||
    type === "checkbox" ||
    type === "radio" ||
    type === "file"
  );
}
