// Auto-filler — Phase 3 browser automation (AGENTS.md Agent 16).
//
// Takes a Playwright Page, a FormSchema, and a FieldMapping produced by
// field-mapper and fills every auto-fillable field on the page. Handles text,
// email, phone, number, date, textarea, select, checkbox, and radio inputs.
// File inputs are intentionally skipped — those are handled by document-uploader.
//
// After filling each section a screenshot is captured and uploaded to the org
// bucket. Every action (fill, skip, screenshot) is logged to automation_steps so
// the session history reflects the full fill run.
//
// Dynamic forms: after filling interactive controls (select, checkbox, radio)
// the filler waits briefly for the DOM to settle so conditionally-revealed
// fields appear before the next iteration. Re-detection of newly-visible fields
// requires a follow-up detectFormSchema + mapFormFields pass by the caller.

import type { Page } from "playwright";
import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  FieldMapping,
  FormSchema,
  FormSchemaField,
  FormSchemaFieldType,
} from "@/types/automation";
import type { AutomationStepAction, AutomationStepStatus } from "@/types/automation";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AutoFillResult {
  filled: number;
  skipped: number;
  errors: Array<{ field_id: string; error: string }>;
  /** Storage paths of screenshots captured after each section. */
  screenshots: string[];
}

export interface AutoFillerOptions {
  client: SupabaseClient;
  sessionId: string;
  organizationId: string;
  /** Per-action timeout in ms. Defaults to 10 000. */
  actionTimeoutMs?: number;
  /** Step number offset so these steps don't collide with prior session steps. */
  stepNumberStart?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 10_000;
/** Brief pause after interactive controls so dynamic fields can render. */
const DYNAMIC_WAIT_MS = 600;
/** Max timeout when probing candidate selectors during resolution. */
const PROBE_TIMEOUT_MS = 2_000;

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Fill every mapped, non-file field in `schema` using the values in
 * `fieldMapping.mappings`. Fields in `requiresReview` and all file inputs are
 * skipped. Returns counts and per-section screenshot storage paths.
 */
export async function fillForm(
  page: Page,
  schema: FormSchema,
  fieldMapping: FieldMapping,
  options: AutoFillerOptions,
): Promise<AutoFillResult> {
  const {
    client,
    sessionId,
    organizationId,
    actionTimeoutMs = DEFAULT_TIMEOUT_MS,
    stepNumberStart = 1,
  } = options;

  const result: AutoFillResult = { filled: 0, skipped: 0, errors: [], screenshots: [] };

  // O(1) lookup: field_id → FieldMappingEntry
  const mappingByFieldId = new Map(fieldMapping.mappings.map((m) => [m.field_id, m]));
  let stepNum = stepNumberStart;

  for (const section of schema.sections) {
    let sectionHadFill = false;

    for (const field of section.fields) {
      // File inputs belong to document-uploader.
      if (field.type === "file") {
        result.skipped++;
        continue;
      }

      const mapping = mappingByFieldId.get(field.id);
      if (!mapping) {
        result.skipped++;
        await logStep(client, {
          sessionId,
          stepNumber: stepNum++,
          action: "fill_field",
          description: `Skipped unmapped field "${field.label}" (${field.id})`,
          status: "skipped",
          inputData: { field_id: field.id, section: section.name },
        });
        continue;
      }

      const startMs = Date.now();
      try {
        await fillField(page, field, mapping.value, actionTimeoutMs);
        sectionHadFill = true;
        result.filled++;

        const readBack = await readFieldValue(page, field).catch(() => null);

        await logStep(client, {
          sessionId,
          stepNumber: stepNum++,
          action: "fill_field",
          description: `Filled "${field.label}" (${field.id}) from ${mapping.source}`,
          status: "completed",
          inputData: { field_id: field.id, value: mapping.value, source: mapping.source },
          outputData: { read_back: readBack },
          durationMs: Date.now() - startMs,
        });

        // Wait for dynamic forms to settle after interactive controls.
        if (
          field.type === "select" ||
          field.type === "checkbox" ||
          field.type === "radio"
        ) {
          await page.waitForTimeout(DYNAMIC_WAIT_MS);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push({ field_id: field.id, error: msg });
        await logStep(client, {
          sessionId,
          stepNumber: stepNum++,
          action: "fill_field",
          description: `Failed to fill "${field.label}" (${field.id})`,
          status: "failed",
          inputData: { field_id: field.id, value: mapping.value },
          errorMessage: msg,
          durationMs: Date.now() - startMs,
        });
      }
    }

    // Capture section screenshot after any fills occurred.
    if (sectionHadFill) {
      try {
        const slug = section.name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
        const storagePath = `automation/${sessionId}/section_${slug}.png`;
        await captureAndUpload(page, client, organizationId, storagePath);
        result.screenshots.push(storagePath);
        await logStep(client, {
          sessionId,
          stepNumber: stepNum++,
          action: "screenshot",
          description: `Screenshot after filling section "${section.name}"`,
          status: "completed",
          outputData: { storage_path: storagePath },
        });
      } catch {
        // Screenshot failures are non-fatal.
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Field filling dispatch
// ---------------------------------------------------------------------------

async function fillField(
  page: Page,
  field: FormSchemaField,
  value: string,
  timeoutMs: number,
): Promise<void> {
  const selector = await resolveSelector(page, field);
  const type: FormSchemaFieldType = field.type;

  switch (type) {
    case "text":
    case "email":
    case "phone":
    case "number":
    case "textarea":
      await page.fill(selector, value, { timeout: timeoutMs });
      break;

    case "date":
      await page.fill(selector, formatDateValue(value), { timeout: timeoutMs });
      break;

    case "select":
      try {
        await page.selectOption(selector, { label: value }, { timeout: timeoutMs });
      } catch {
        // Value from mapping may already be the HTML option value attribute.
        await page.selectOption(selector, { value }, { timeout: timeoutMs });
      }
      break;

    case "checkbox": {
      const shouldCheck = /^(true|yes|1|on|checked)$/i.test(value.trim());
      if (shouldCheck) {
        await page.check(selector, { timeout: timeoutMs });
      } else {
        await page.uncheck(selector, { timeout: timeoutMs });
      }
      break;
    }

    case "radio": {
      // Prefer exact value attribute match; fall back to accessible name.
      const byValue = `input[type="radio"][name="${escAttr(field.id)}"][value="${escAttr(value)}"]`;
      const matchCount = await page.locator(byValue).count().catch(() => 0);
      if (matchCount > 0) {
        await page.click(byValue, { timeout: timeoutMs });
      } else {
        await page.getByRole("radio", { name: value }).click({ timeout: timeoutMs });
      }
      break;
    }

    case "file":
      throw new Error("File inputs must be handled by document-uploader");

    default: {
      const _exhaustive: never = type;
      throw new Error(`Unhandled field type: ${String(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Selector resolution
// ---------------------------------------------------------------------------

/**
 * Try candidate selectors in priority order, returning the first that resolves
 * to an element present in the DOM. Probes each candidate with a short timeout
 * to avoid blocking on portals where some candidates simply don't exist.
 */
async function resolveSelector(
  page: Page,
  field: FormSchemaField,
): Promise<string> {
  const { id, type } = field;

  const candidates: string[] = [];

  // By id attribute.
  if (isSimpleId(id)) {
    candidates.push(`#${id}`);
  } else {
    candidates.push(`[id="${escAttr(id)}"]`);
  }

  // By name attribute, type-narrowed.
  switch (type) {
    case "select":
      candidates.push(`select[name="${escAttr(id)}"]`);
      break;
    case "textarea":
      candidates.push(`textarea[name="${escAttr(id)}"]`);
      break;
    case "checkbox":
      candidates.push(`input[type="checkbox"][name="${escAttr(id)}"]`);
      break;
    case "radio":
      candidates.push(`input[type="radio"][name="${escAttr(id)}"]`);
      break;
    default:
      candidates.push(`input[name="${escAttr(id)}"]`);
      candidates.push(`[name="${escAttr(id)}"]`);
  }

  for (const sel of candidates) {
    try {
      await page.waitForSelector(sel, { timeout: PROBE_TIMEOUT_MS, state: "attached" });
      return sel;
    } catch {
      // try next candidate
    }
  }

  throw new Error(
    `Cannot locate field "${field.label}" (id="${id}"): tried ${candidates.join(", ")}`,
  );
}

// ---------------------------------------------------------------------------
// Read-back validation
// ---------------------------------------------------------------------------

/**
 * Read the current value of `field` from the DOM to verify the fill succeeded.
 * Returns null on any error — validation is best-effort.
 */
async function readFieldValue(
  page: Page,
  field: FormSchemaField,
): Promise<string | null> {
  const id = field.id;

  try {
    switch (field.type) {
      case "radio":
        return await page.$eval(
          `input[type="radio"][name="${escAttr(id)}"]:checked`,
          (el) => (el as HTMLInputElement).value,
        );

      case "checkbox": {
        const sel = `input[type="checkbox"][name="${escAttr(id)}"]`;
        return await page
          .$eval(sel, (el) => String((el as HTMLInputElement).checked))
          .catch(async () =>
            page.$eval(
              isSimpleId(id) ? `#${id}` : `[id="${escAttr(id)}"]`,
              (el) => String((el as HTMLInputElement).checked),
            ),
          );
      }

      case "select": {
        const sel = `select[name="${escAttr(id)}"]`;
        return await page
          .$eval(sel, (el) => (el as HTMLSelectElement).value)
          .catch(async () =>
            page.$eval(
              isSimpleId(id) ? `#${id}` : `[id="${escAttr(id)}"]`,
              (el) => (el as HTMLSelectElement).value,
            ),
          );
      }

      default: {
        const byName = `[name="${escAttr(id)}"]`;
        return await page
          .$eval(byName, (el) => (el as HTMLInputElement).value)
          .catch(async () =>
            page.$eval(
              isSimpleId(id) ? `#${id}` : `[id="${escAttr(id)}"]`,
              (el) => (el as HTMLInputElement).value,
            ),
          );
      }
    }
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Screenshot upload
// ---------------------------------------------------------------------------

async function captureAndUpload(
  page: Page,
  client: SupabaseClient,
  organizationId: string,
  storagePath: string,
): Promise<void> {
  let buffer: Buffer;
  try {
    buffer = await page.screenshot({ fullPage: true });
  } catch {
    buffer = await page.screenshot({ fullPage: false });
  }

  const { error } = await client.storage
    .from(`org-${organizationId}`)
    .upload(storagePath, buffer, { contentType: "image/png", upsert: true });

  if (error) throw new Error(`Screenshot upload failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Step logging
// ---------------------------------------------------------------------------

interface StepLogEntry {
  sessionId: string;
  stepNumber: number;
  action: AutomationStepAction;
  description: string;
  status: AutomationStepStatus;
  inputData?: Record<string, unknown>;
  outputData?: Record<string, unknown>;
  errorMessage?: string;
  durationMs?: number;
}

async function logStep(
  client: SupabaseClient,
  entry: StepLogEntry,
): Promise<void> {
  try {
    await client.from("automation_steps").insert({
      session_id: entry.sessionId,
      step_number: entry.stepNumber,
      action: entry.action,
      description: entry.description,
      status: entry.status,
      input_data: entry.inputData ?? null,
      output_data: entry.outputData ?? null,
      error_message: entry.errorMessage ?? null,
      duration_ms: entry.durationMs ?? null,
    });
  } catch {
    // Step logging must never abort the automation run.
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** True when `value` is safe to use as a bare CSS id selector (`#value`). */
function isSimpleId(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value);
}

/** Escape a value for use inside a CSS attribute selector `[attr="value"]`. */
function escAttr(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Normalize a date string for input into a form field.
 *
 * Outputs MM/DD/YYYY (most common in US grant portals). If the input already
 * matches that pattern it is returned as-is. ISO YYYY-MM-DD is converted.
 * Any other format is returned verbatim so HTML date inputs (which accept
 * YYYY-MM-DD) continue to work.
 */
function formatDateValue(value: string): string {
  const v = value.trim();

  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) return v;

  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[2]}/${iso[3]}/${iso[1]}`;

  const mdy = v.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (mdy) return `${mdy[1]}/${mdy[2]}/${mdy[3]}`;

  return v;
}
