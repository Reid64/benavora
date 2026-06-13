import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

// Bucket that stores all org documents. Override via env if your Supabase
// project uses a different name.
const STORAGE_BUCKET = process.env.STORAGE_DOCUMENTS_BUCKET ?? "documents";

export interface ChecklistEntry {
  document_name: string;
  status: "attached" | "missing";
  file_path: string | null;
}

export interface AssembleResponse {
  checklist: ChecklistEntry[];
  allPresent: boolean;
  downloadUrl: string | null;
  zipPath: string | null;
}

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.", "invalid_body", 400);
  }

  const { application_id } = (body ?? {}) as { application_id?: unknown };
  if (typeof application_id !== "string" || !application_id.trim()) {
    return jsonError("application_id is required.", "invalid_input", 400);
  }

  // Load application — RLS keeps this org-scoped automatically.
  const { data: app, error: appError } = await supabase
    .from("applications")
    .select("id, opportunity_id")
    .eq("id", application_id)
    .eq("organization_id", organizationId)
    .single();

  if (appError || !app) {
    return jsonError("Application not found.", "not_found", 404);
  }

  // Load opportunity so we can read required_documents.
  const { data: opportunity, error: oppError } = await supabase
    .from("opportunities")
    .select("required_documents")
    .eq("id", app.opportunity_id)
    .eq("organization_id", organizationId)
    .single();

  if (oppError || !opportunity) {
    return jsonError("Linked opportunity not found.", "not_found", 404);
  }

  const requiredDocs: string[] = Array.isArray(opportunity.required_documents)
    ? (opportunity.required_documents as unknown[]).filter(
        (d): d is string => typeof d === "string" && d.trim() !== "",
      )
    : [];

  // Load every document linked to this application.
  const { data: linkRows } = await supabase
    .from("application_documents")
    .select("document_id")
    .eq("application_id", application_id);

  const documentIds = (linkRows ?? []).map((r) => r.document_id as string);

  type DocRow = {
    id: string;
    file_name: string;
    storage_path: string;
    category: string;
  };
  let attachedDocs: DocRow[] = [];

  if (documentIds.length > 0) {
    const { data: docs } = await supabase
      .from("documents")
      .select("id, file_name, storage_path, category")
      .eq("organization_id", organizationId)
      .in("id", documentIds);
    attachedDocs = (docs ?? []) as DocRow[];
  }

  // Build checklist: match each required document to an attached doc, then
  // append any supplemental attached docs that don't map to a requirement.
  const checklist: ChecklistEntry[] = [];
  const unmatched = [...attachedDocs];

  for (const req of requiredDocs) {
    const idx = unmatched.findIndex((d) => docMatchesRequirement(req, d));
    if (idx !== -1) {
      const [doc] = unmatched.splice(idx, 1);
      checklist.push({
        document_name: req,
        status: "attached",
        file_path: doc!.storage_path,
      });
    } else {
      checklist.push({ document_name: req, status: "missing", file_path: null });
    }
  }

  // Supplemental docs (attached but not required).
  for (const doc of unmatched) {
    checklist.push({
      document_name: doc.file_name,
      status: "attached",
      file_path: doc.storage_path,
    });
  }

  const allPresent = !checklist.some((c) => c.status === "missing");

  // If any required docs are missing we return the checklist without a ZIP.
  if (!allPresent) {
    return NextResponse.json({
      checklist,
      allPresent: false,
      downloadUrl: null,
      zipPath: null,
    });
  }

  // Edge case: nothing to zip (no requirements + no attached docs).
  if (attachedDocs.length === 0) {
    return NextResponse.json({
      checklist,
      allPresent: true,
      downloadUrl: null,
      zipPath: null,
    });
  }

  // Download each file from storage so we can bundle them.
  const fileBuffers: Array<{ name: string; buffer: Buffer }> = [];
  for (const doc of attachedDocs) {
    const { data: blob, error: dlErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(doc.storage_path);
    if (!dlErr && blob) {
      const ab = await blob.arrayBuffer();
      fileBuffers.push({ name: doc.file_name, buffer: Buffer.from(ab) });
    }
  }

  const zipBuffer = await buildZip(fileBuffers);

  // Store the ZIP under the org's assembled/ prefix to keep data isolated.
  const timestamp = Date.now();
  const zipName = `${application_id}_${timestamp}.zip`;
  const zipPath = `${organizationId}/assembled/${zipName}`;

  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(zipPath, zipBuffer, { contentType: "application/zip", upsert: true });

  if (uploadErr) {
    return jsonError(
      "Failed to store the assembled package.",
      "storage_error",
      500,
    );
  }

  // Signed URL valid for one hour.
  const { data: signed, error: signErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(zipPath, 3600);

  if (signErr || !signed?.signedUrl) {
    return jsonError("Failed to generate download URL.", "url_error", 500);
  }

  return NextResponse.json({
    checklist,
    allPresent: true,
    downloadUrl: signed.signedUrl,
    zipPath,
  });
}

// --- helpers -----------------------------------------------------------------

function docMatchesRequirement(
  required: string,
  doc: { file_name: string; category: string },
): boolean {
  const hay = `${doc.file_name} ${doc.category}`.toLowerCase();
  const needle = required.toLowerCase().trim();
  if (hay.includes(needle)) return true;
  const tokens = needle
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  return tokens.length > 0 && tokens.some((t) => hay.includes(t));
}

async function buildZip(
  files: Array<{ name: string; buffer: Buffer }>,
): Promise<Buffer> {
  const { ZipArchive } = await import("archiver");
  const { PassThrough } = await import("stream");

  return new Promise<Buffer>((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const passThrough = new PassThrough();
    const chunks: Buffer[] = [];

    passThrough.on("data", (chunk: Buffer) => chunks.push(chunk));
    passThrough.on("end", () => resolve(Buffer.concat(chunks)));
    passThrough.on("error", reject);

    archive.on("error", reject);
    archive.on("warning", (err) => {
      if (err.code !== "ENOENT") reject(err);
    });

    archive.pipe(passThrough);

    for (const file of files) {
      archive.append(file.buffer, { name: file.name });
    }

    void archive.finalize();
  });
}
