// Document uploader — Phase 3 browser automation (AGENTS.md Agent 16).
//
// Downloads application documents from Supabase Storage to a temp directory,
// matches each document to the best-fitting file-input field on the page by
// category / filename keyword matching, uploads via Playwright setInputFiles,
// verifies that each upload registered (filename visible, or a success indicator
// appeared), then cleans up all temp files.
//
// Every action (download, upload, verify, skip, error) is logged to
// automation_steps so the session history is complete.

import fs from "fs/promises";
import os from "os";
import path from "path";

import type { Page } from "playwright";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { FormSchemaField } from "@/types/automation";
import type { AutomationStepAction, AutomationStepStatus } from "@/types/automation";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A document available in the org's Supabase Storage bucket. */
export interface DocumentInfo {
  /** Storage path inside `org-{organizationId}`, e.g. "documents/501c3.pdf". */
  storagePath: string;
  /** Original filename with extension, e.g. "determination_letter.pdf". */
  fileName: string;
  /**
   * Category tag that describes what the document is, e.g. "501c3", "audit",
   * "financial_statement", "board_list", "resume", "project_budget".
   */
  category: string;
  /** MIME type for the upload. Defaults to "application/octet-stream". */
  mimeType?: string;
}

export interface DocumentUploadResult {
  uploaded: number;
  skipped: number;
  errors: Array<{
    field_id: string;
    storagePath: string;
    error: string;
  }>;
}

export interface DocumentUploaderOptions {
  client: SupabaseClient;
  sessionId: string;
  organizationId: string;
  /** Per-action timeout in ms. Defaults to 30 000. */
  actionTimeoutMs?: number;
  /** Step number offset so these steps don't collide with prior session steps. */
  stepNumberStart?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;
/** After setInputFiles, wait this long for portal-side upload UI to appear. */
const UPLOAD_SETTLE_MS = 1_500;

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * For each file-input field in `fileFields`, find a matching document from
 * `documents`, download it to a temp file, upload it via the file input, verify
 * success, and clean up. Unmatched fields are skipped.
 */
export async function uploadDocuments(
  page: Page,
  fileFields: FormSchemaField[],
  documents: DocumentInfo[],
  options: DocumentUploaderOptions,
): Promise<DocumentUploadResult> {
  const {
    client,
    sessionId,
    organizationId,
    actionTimeoutMs = DEFAULT_TIMEOUT_MS,
    stepNumberStart = 1,
  } = options;

  const result: DocumentUploadResult = { uploaded: 0, skipped: 0, errors: [] };
  const tmpPaths: string[] = [];
  let stepNum = stepNumberStart;

  try {
    for (const field of fileFields) {
      if (field.type !== "file") continue;

      const doc = matchDocumentToField(field, documents);

      if (!doc) {
        result.skipped++;
        await logStep(client, {
          sessionId,
          stepNumber: stepNum++,
          action: "upload_file",
          description: `Skipped file field "${field.label}" (${field.id}): no matching document`,
          status: "skipped",
          inputData: { field_id: field.id },
        });
        continue;
      }

      const startMs = Date.now();
      let tmpPath: string | null = null;

      try {
        // 1. Download to temp directory.
        tmpPath = await downloadToTemp(client, organizationId, doc);
        tmpPaths.push(tmpPath);

        // 2. Locate the file input.
        const selector = await resolveFileInputSelector(page, field);

        // 3. Upload via Playwright.
        await page.setInputFiles(selector, tmpPath, { timeout: actionTimeoutMs });

        // 4. Wait for portal upload UI to settle.
        await page.waitForTimeout(UPLOAD_SETTLE_MS);

        // 5. Verify upload registered.
        const confirmed = await verifyUpload(page, doc);

        result.uploaded++;
        await logStep(client, {
          sessionId,
          stepNumber: stepNum++,
          action: "upload_file",
          description: `Uploaded "${doc.fileName}" to field "${field.label}" (${field.id})`,
          status: "completed",
          inputData: { field_id: field.id, storage_path: doc.storagePath, category: doc.category },
          outputData: { confirmed, tmp_path: tmpPath },
          durationMs: Date.now() - startMs,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push({ field_id: field.id, storagePath: doc.storagePath, error: msg });
        await logStep(client, {
          sessionId,
          stepNumber: stepNum++,
          action: "upload_file",
          description: `Failed to upload "${doc.fileName}" to field "${field.label}" (${field.id})`,
          status: "failed",
          inputData: { field_id: field.id, storage_path: doc.storagePath },
          errorMessage: msg,
          durationMs: Date.now() - startMs,
        });
      }
    }
  } finally {
    // Clean up all temp files regardless of success/failure.
    await cleanupTempFiles(tmpPaths);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Document ↔ field matching
// ---------------------------------------------------------------------------

/**
 * Keyword rules: each entry describes which field-label keywords map to which
 * document category tokens. The first rule whose field keywords AND doc tokens
 * both match wins.
 */
const MATCH_RULES: Array<{
  fieldKeywords: string[];
  docTokens: string[];
}> = [
  {
    fieldKeywords: ["501c3", "501(c)(3)", "determination letter", "tax exempt", "irs letter"],
    docTokens: ["501c3", "tax_exempt", "determination", "irs"],
  },
  {
    fieldKeywords: ["audit", "audited financial"],
    docTokens: ["audit", "audited"],
  },
  {
    fieldKeywords: ["financial statement", "balance sheet", "income statement", "financials"],
    docTokens: ["financial_statement", "financials", "balance_sheet", "income"],
  },
  {
    fieldKeywords: ["budget", "project budget", "expense"],
    docTokens: ["budget", "project_budget"],
  },
  {
    fieldKeywords: ["board", "board list", "board members", "directors"],
    docTokens: ["board_list", "board", "directors"],
  },
  {
    fieldKeywords: ["resume", "biography", "bio", "executive director", "staff bio"],
    docTokens: ["resume", "bio", "biography", "cv"],
  },
  {
    fieldKeywords: ["letter of support", "support letter", "partner letter"],
    docTokens: ["letter_of_support", "support_letter", "letter"],
  },
  {
    fieldKeywords: ["project narrative", "project description", "narrative", "program description"],
    docTokens: ["narrative", "project_narrative", "description"],
  },
  {
    fieldKeywords: ["w-9", "w9", "tax form"],
    docTokens: ["w9", "w-9", "tax_form"],
  },
];

function matchDocumentToField(
  field: FormSchemaField,
  documents: DocumentInfo[],
): DocumentInfo | undefined {
  const fieldHaystack = `${field.label} ${field.id}`.toLowerCase();

  for (const rule of MATCH_RULES) {
    const fieldMatches = rule.fieldKeywords.some((kw) => fieldHaystack.includes(kw));
    if (!fieldMatches) continue;

    const doc = documents.find((d) => {
      const docHaystack = `${d.category} ${d.fileName}`.toLowerCase();
      return rule.docTokens.some((token) => docHaystack.includes(token));
    });

    if (doc) return doc;
  }

  // Fallback: any document whose category or filename words appear in the field label.
  return documents.find((d) => {
    const words = `${d.category} ${d.fileName}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3);
    return words.some((w) => fieldHaystack.includes(w));
  });
}

// ---------------------------------------------------------------------------
// Temp file lifecycle
// ---------------------------------------------------------------------------

async function downloadToTemp(
  client: SupabaseClient,
  organizationId: string,
  doc: DocumentInfo,
): Promise<string> {
  const { data, error } = await client.storage
    .from(`org-${organizationId}`)
    .download(doc.storagePath);

  if (error || !data) {
    throw new Error(
      `Failed to download "${doc.storagePath}": ${error?.message ?? "no data returned"}`,
    );
  }

  const arrayBuffer = await data.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Build a safe temp filename: timestamp prefix avoids collisions; original
  // extension is preserved so portals that check the filename accept the file.
  const safeBase = path.basename(doc.fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
  const tmpPath = path.join(os.tmpdir(), `bvr_${Date.now()}_${safeBase}`);

  await fs.writeFile(tmpPath, buffer);
  return tmpPath;
}

async function cleanupTempFiles(paths: string[]): Promise<void> {
  await Promise.allSettled(
    paths.map((p) => fs.unlink(p).catch(() => { /* non-fatal */ })),
  );
}

// ---------------------------------------------------------------------------
// File input selector resolution
// ---------------------------------------------------------------------------

async function resolveFileInputSelector(
  page: Page,
  field: FormSchemaField,
): Promise<string> {
  const { id } = field;
  const PROBE_MS = 2_000;

  const candidates: string[] = [
    `input[type="file"][name="${escAttr(id)}"]`,
  ];

  if (isSimpleId(id)) {
    candidates.push(`input[type="file"]#${id}`);
  } else {
    candidates.push(`input[type="file"][id="${escAttr(id)}"]`);
  }

  // Last resort: if exactly one file input exists on the page.
  candidates.push(`input[type="file"]`);

  for (const sel of candidates) {
    try {
      await page.waitForSelector(sel, { timeout: PROBE_MS, state: "attached" });
      // For the generic fallback, confirm exactly one matches.
      if (sel === `input[type="file"]`) {
        const count = await page.locator(sel).count();
        if (count !== 1) continue;
      }
      return sel;
    } catch {
      // try next
    }
  }

  throw new Error(
    `Cannot locate file input for field "${field.label}" (id="${id}"): tried ${candidates.join(", ")}`,
  );
}

// ---------------------------------------------------------------------------
// Upload verification
// ---------------------------------------------------------------------------

/**
 * Heuristically check whether the portal registered the file upload.
 * Looks for the filename in the page body and for common upload-confirmation
 * selectors. Returns false rather than throwing on any error.
 */
async function verifyUpload(page: Page, doc: DocumentInfo): Promise<boolean> {
  try {
    const nameWithoutExt = path.basename(doc.fileName).replace(/\.[^.]+$/, "");

    // 1. Filename text appears anywhere on the page.
    const bodyText = (await page.textContent("body").catch(() => "")) ?? "";
    if (
      nameWithoutExt.length > 3 &&
      bodyText.toLowerCase().includes(nameWithoutExt.toLowerCase())
    ) {
      return true;
    }

    // 2. Generic upload-success indicators.
    const successSelectors = [
      `[class*="upload-success"]`,
      `[class*="file-preview"]`,
      `[class*="file-name"]`,
      `[class*="uploaded"]`,
      `[aria-label*="remove file"]`,
      `[aria-label*="delete file"]`,
      `[data-filename]`,
      `.file-upload-complete`,
      `.attached-file`,
    ];

    for (const sel of successSelectors) {
      const count = await page.locator(sel).count().catch(() => 0);
      if (count > 0) return true;
    }

    return false;
  } catch {
    return false;
  }
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

function isSimpleId(value: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(value);
}

function escAttr(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
