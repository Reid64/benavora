// Form detector - Phase 3 browser automation (AGENTS.md Agent 16).
//
// Two responsibilities:
//   1. detectFields(page): read a page's form controls into structured
//      FormField descriptors via page.$$eval (one in-browser pass, serializable
//      output). Supports text inputs, textareas, selects, checkboxes, radio
//      buttons, and file uploads.
//   2. mapFields(fields, context): match each detected field against the
//      organization profile / acting user / application, returning the fields we
//      can auto-fill (mappedFields) and those that still need human input
//      (unmappedFields) - exactly the split persisted to
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
  FormSchema,
  FormSchemaField,
  FormSchemaFieldType,
  FormSection,
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
 * a value from the autofill context. A null/empty resolution means "no data" -
 * the field stays unmapped rather than being filled with a blank.
 */
interface MappingRule {
  keywords: string[];
  source: string;
  resolve: (ctx: AutofillContext) => string | null;
}

/**
 * Rules in priority order - the FIRST rule whose keyword matches wins, so more
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
 * needing human input. File inputs are always left unmapped - documents are
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
      mappedFields.push({ field, value, source: rule.source, confidence: 0.95 });
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

// --- structured FormSchema detection -----------------------------------------

/**
 * Richer form detection that returns a FormSchema with logical sections,
 * multi-step indicators, and the full field vocabulary (email, phone, date,
 * number, etc.). Handles JS-rendered portals by waiting for networkidle and
 * a form element to appear before scanning the DOM.
 *
 * Existing detectFields / mapFields exports are unchanged; this is additive.
 */
export async function detectFormSchema(
  page: Page,
  url: string,
): Promise<FormSchema> {
  // Wait for JS-rendered content - many grant portals hydrate after DOMContentLoaded.
  try {
    await page.waitForLoadState("networkidle", { timeout: 10_000 });
  } catch {
    // networkidle may never fire on pages with long-polling; fall through.
  }

  // Ensure at least one form control is visible before scanning.
  try {
    await page.waitForSelector("input, textarea, select", { timeout: 5_000 });
  } catch {
    // Return empty schema if the page has no detectable form controls.
    return { url, title: await page.title(), sections: [], isMultiStep: false, stepCount: 1, stepIndicators: [] };
  }

  // Single in-browser pass - returns only serializable plain objects.
  const raw = await page.evaluate(() => {
    const IGNORE_TYPES = new Set([
      "hidden", "submit", "button", "image", "reset", "search",
    ]);

    function resolveLabel(el: Element): string {
      const inp = el as HTMLInputElement;
      if (inp.labels && inp.labels.length > 0) {
        const text = Array.from(inp.labels)
          .map((l) => (l.textContent ?? "").trim())
          .filter(Boolean)
          .join(" ");
        if (text) return text;
      }
      const aria = el.getAttribute("aria-label");
      if (aria?.trim()) return aria.trim();
      const labelledBy = el.getAttribute("aria-labelledby");
      if (labelledBy) {
        const parts = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
          .filter(Boolean)
          .join(" ");
        if (parts) return parts;
      }
      const placeholder = el.getAttribute("placeholder");
      if (placeholder?.trim()) return placeholder.trim();
      const title = el.getAttribute("title");
      if (title?.trim()) return title.trim();
      return el.getAttribute("name") ?? "";
    }

    function nearestFieldsetLegend(el: Element): string {
      let parent = el.parentElement;
      while (parent) {
        if (parent.tagName === "FIELDSET") {
          const legend = parent.querySelector("legend");
          if (legend) return (legend.textContent ?? "").trim();
        }
        parent = parent.parentElement;
      }
      return "";
    }

    const tagCounts: Record<string, number> = {};
    const rawFields: Array<{
      fieldId: string;
      label: string;
      htmlType: string;
      required: boolean;
      placeholder: string;
      pattern: string;
      options: string[];
      fieldsetLegend: string;
    }> = [];

    for (const el of Array.from(document.querySelectorAll("input, textarea, select"))) {
      const tag = el.tagName.toLowerCase();
      const htmlType = (el.getAttribute("type") ?? "").toLowerCase();

      if (tag === "input" && IGNORE_TYPES.has(htmlType)) continue;

      const id = el.id ?? "";
      const name = el.getAttribute("name") ?? "";
      const label = resolveLabel(el);
      const idx = (tagCounts[tag] = (tagCounts[tag] ?? 0) + 1);

      // Prefer id, then name, then a slug derived from the label, then positional fallback.
      let fieldId: string;
      if (id) {
        fieldId = id;
      } else if (name) {
        fieldId = name;
      } else if (label) {
        fieldId = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
      } else {
        fieldId = `${tag}_${idx}`;
      }

      const required =
        (el as HTMLInputElement).required ||
        el.getAttribute("aria-required") === "true";

      const options: string[] = [];
      if (tag === "select") {
        for (const opt of Array.from((el as HTMLSelectElement).options)) {
          const text = (opt.textContent ?? "").trim();
          if (text) options.push(text);
        }
      } else if (htmlType === "radio") {
        const val = (el as HTMLInputElement).value;
        if (val) options.push(val);
      }

      rawFields.push({
        fieldId,
        label,
        htmlType: tag === "textarea" ? "textarea" : tag === "select" ? "select" : htmlType || "text",
        required,
        placeholder: el.getAttribute("placeholder") ?? "",
        pattern: el.getAttribute("pattern") ?? "",
        options,
        fieldsetLegend: nearestFieldsetLegend(el),
      });
    }

    // Multi-step detection - look for navigation buttons and step indicators.
    const allButtons = Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit']"));
    const hasNextBtn = allButtons.some((b) => {
      const text = ((b.textContent ?? "") + " " + (b.getAttribute("value") ?? "")).toLowerCase();
      return /\b(next|continue|proceed|next step)\b/.test(text);
    });

    const stepEls = Array.from(document.querySelectorAll(
      "[class*='step'], [role='progressbar'], [aria-current='step'], [class*='wizard'], [class*='progress-step']",
    ));
    const stepLabels = stepEls
      .map((el) => (el.textContent ?? "").trim())
      .filter(Boolean)
      .slice(0, 10);

    return {
      pageTitle: document.title,
      rawFields,
      multiStep: {
        detected: hasNextBtn || stepEls.length > 1,
        stepLabels,
        stepCount: stepEls.length > 1 ? stepEls.length : hasNextBtn ? 2 : 1,
      },
    };
  });

  const fields = raw.rawFields.map((rf) => schemaFieldFromRaw(rf));
  const sections = groupIntoSections(fields, raw.rawFields);

  return {
    url,
    title: raw.pageTitle || (await page.title()),
    sections,
    isMultiStep: raw.multiStep.detected,
    stepCount: raw.multiStep.stepCount,
    stepIndicators: raw.multiStep.stepLabels,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers for detectFormSchema
// ---------------------------------------------------------------------------

interface RawFieldData {
  fieldId: string;
  label: string;
  htmlType: string;
  required: boolean;
  placeholder: string;
  pattern: string;
  options: string[];
  fieldsetLegend: string;
}

function toFormSchemaFieldType(htmlType: string): FormSchemaFieldType {
  switch (htmlType) {
    case "email": return "email";
    case "tel": return "phone";
    case "number":
    case "range": return "number";
    case "date":
    case "datetime-local":
    case "time":
    case "month":
    case "week": return "date";
    case "file": return "file";
    case "checkbox": return "checkbox";
    case "radio": return "radio";
    case "textarea": return "textarea";
    case "select": return "select";
    default: return "text";
  }
}

function schemaFieldFromRaw(rf: RawFieldData): FormSchemaField {
  const field: FormSchemaField = {
    id: rf.fieldId,
    label: rf.label,
    type: toFormSchemaFieldType(rf.htmlType),
    required: rf.required,
  };
  if (rf.options.length > 0) field.options = rf.options;
  if (rf.placeholder) field.placeholder = rf.placeholder;
  if (rf.pattern) field.pattern = rf.pattern;
  return field;
}

const SECTION_DEFS: Array<{ name: string; keywords: string[] }> = [
  {
    name: "Contact Info",
    keywords: ["name", "email", "phone", "contact", "address", "city", "state", "zip", "postal", "title", "first", "last", "director", "position", "role", "street", "mobile", "tel"],
  },
  {
    name: "Organization Info",
    keywords: ["organization", "org", "ein", "tax", "mission", "vision", "founding", "founded", "website", "nonprofit", "501c", "staff", "volunteer", "service area", "annual budget", "legal name"],
  },
  {
    name: "Project Details",
    keywords: ["project", "program", "description", "purpose", "activities", "goals", "objective", "outcome", "impact", "narrative", "overview", "plan", "timeline", "implementation", "summary", "scope"],
  },
  {
    name: "Budget",
    keywords: ["amount", "budget", "cost", "funding", "requested", "award", "grant", "match", "expense", "financial", "dollar", "total project"],
  },
  {
    name: "Attachments",
    keywords: ["upload", "file", "attach", "document", "letter", "exempt", "audit", "report", "pdf", "501c3", "irs", "financial statement", "resume"],
  },
];

function assignSectionName(field: FormSchemaField, raw: RawFieldData): string {
  // Fieldset legend takes priority - it's the author's own grouping.
  if (raw.fieldsetLegend) return raw.fieldsetLegend;

  const haystack = `${field.label} ${field.id}`.toLowerCase();
  let best = "Other";
  let bestScore = 0;

  for (const def of SECTION_DEFS) {
    const score = def.keywords.filter((kw) => haystack.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      best = def.name;
    }
  }

  return best;
}

function groupIntoSections(fields: FormSchemaField[], raws: RawFieldData[]): FormSection[] {
  const map = new Map<string, FormSchemaField[]>();

  for (let i = 0; i < fields.length; i++) {
    const sectionName = assignSectionName(fields[i]!, raws[i]!);
    const existing = map.get(sectionName);
    if (existing) {
      existing.push(fields[i]!);
    } else {
      map.set(sectionName, [fields[i]!]);
    }
  }

  // Preserve insertion order; "Other" goes last.
  const sections: FormSection[] = [];
  let otherSection: FormSection | undefined;

  for (const [name, sectionFields] of map.entries()) {
    const section = { name, fields: sectionFields };
    if (name === "Other") {
      otherSection = section;
    } else {
      sections.push(section);
    }
  }

  if (otherSection) sections.push(otherSection);
  return sections;
}

