// Form filler - Phase 3 browser automation (AGENTS.md Agent 16,
// BEHAVIORAL_CONTRACTS §18).
//
// Takes the mapped fields produced by form-detector and types/selects/checks
// them into the live page with human-like timing. File inputs are filled by
// downloading the referenced document from Supabase Storage and feeding the
// bytes to the <input type=file> directly.
//
// HARD RULE: this module NEVER submits. It fills, snapshots the filled form, and
// returns. Submission only ever happens after a human approves the session
// (BEHAVIORAL_CONTRACTS §18 - "Automation NEVER auto-submits forms"). There is
// deliberately no code path here that clicks a submit control.

import type { Page } from "playwright";

import type { BrowserEngine } from "@/lib/automation/browser-engine";
import type {
  FillResult,
  FormMapping,
  ScreenshotCapture,
} from "@/types/automation";

/** Per-character typing delay range, for realistic input (task spec 50-100ms). */
const TYPE_DELAY_MIN_MS = 50;
const TYPE_DELAY_MAX_MS = 100;

export interface FillOptions {
  /** Capture a screenshot of the filled form before returning. Default true. */
  screenshotFilledForm?: boolean;
  /** Label for the filled-form screenshot. Default "filled-form". */
  filledScreenshotLabel?: string;
}

/**
 * Fill every mapped field on the engine's current page, then snapshot the
 * result. Returns which fields were filled, which were skipped (and why), and
 * any screenshots captured. Does NOT submit.
 */
export async function fillForm(
  engine: BrowserEngine,
  mappings: FormMapping[],
  options: FillOptions = {},
): Promise<FillResult> {
  const page = engine.page;
  const filledFields: FormMapping[] = [];
  const skippedFields: FillResult["skippedFields"] = [];
  const screenshots: ScreenshotCapture[] = [];

  for (const mapping of mappings) {
    const { field, value } = mapping;
    try {
      const handled = await fillOne(engine, page, mapping);
      if (handled) {
        filledFields.push(mapping);
      } else {
        skippedFields.push({
          field,
          reason: `Unsupported or unfillable field type "${field.fieldType}".`,
        });
      }
    } catch (err) {
      // One bad field never aborts the rest of the form - record and continue.
      skippedFields.push({
        field,
        reason: `Failed to fill (${describeValue(value)}): ${errorMessage(err)}`,
      });
    }
  }

  if (options.screenshotFilledForm ?? true) {
    const shot = await engine.screenshot(
      options.filledScreenshotLabel ?? "filled-form",
    );
    screenshots.push(shot);
  }

  return { filledFields, skippedFields, screenshots };
}

// --- per-field dispatch ------------------------------------------------------

/** Fill a single mapped field. Returns false for an unhandled field type. */
async function fillOne(
  engine: BrowserEngine,
  page: Page,
  mapping: FormMapping,
): Promise<boolean> {
  const { field, value } = mapping;
  const locator = page.locator(field.selector).first();

  switch (field.fieldType) {
    case "text":
    case "textarea": {
      await locator.scrollIntoViewIfNeeded();
      await locator.click();
      await locator.fill(""); // clear any prefilled content first
      await locator.pressSequentially(value, { delay: typeDelay() });
      return true;
    }
    case "select": {
      // Prefer matching the visible option text; fall back to the raw value.
      try {
        await locator.selectOption({ label: value });
      } catch {
        await locator.selectOption(value);
      }
      return true;
    }
    case "checkbox": {
      const shouldCheck = isTruthy(value);
      await locator.setChecked(shouldCheck);
      return true;
    }
    case "radio": {
      // The detector targets the specific radio input by value; just check it.
      await locator.check();
      return true;
    }
    case "file": {
      await fillFileInput(engine, locator, value, field.fieldName);
      return true;
    }
    default:
      return false;
  }
}

/**
 * Fill a file input: download the document from Supabase Storage (the mapping
 * value is its storage path) and hand the bytes to Playwright's setInputFiles
 * as an in-memory payload - no temp files on disk.
 */
async function fillFileInput(
  engine: BrowserEngine,
  locator: ReturnType<Page["locator"]>,
  storagePath: string,
  fieldName: string,
): Promise<void> {
  const buffer = await engine.downloadFile(storagePath);
  const name = fileNameFromPath(storagePath) || `${fieldName || "upload"}.bin`;
  await locator.setInputFiles({
    name,
    mimeType: guessMimeType(name),
    buffer,
  });
}

// --- helpers -----------------------------------------------------------------

/** A random typing delay in the realistic range, per character. */
function typeDelay(): number {
  const span = TYPE_DELAY_MAX_MS - TYPE_DELAY_MIN_MS;
  return TYPE_DELAY_MIN_MS + Math.floor(Math.random() * (span + 1));
}

function isTruthy(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "true" || v === "yes" || v === "on" || v === "1" || v === "checked";
}

function describeValue(value: string): string {
  const v = value.length > 40 ? `${value.slice(0, 37)}...` : value;
  return v.replace(/\s+/g, " ");
}

function fileNameFromPath(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1] ?? "";
}

function guessMimeType(name: string): string {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "doc":
      return "application/msword";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xls":
      return "application/vnd.ms-excel";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "txt":
      return "text/plain";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
