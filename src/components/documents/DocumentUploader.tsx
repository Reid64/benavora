"use client";

import { useRef, useState } from "react";
import type { DragEvent } from "react";
import { FileUp, Loader2, UploadCloud, X } from "lucide-react";

import { recordAudit } from "@/lib/audit/client";
import { createClient } from "@/lib/supabase/client";
import { DOCUMENT_CATEGORIES, MAX_UPLOAD_BYTES } from "@/lib/utils/constants";
import { humanizeEnum } from "@/lib/utils/formatters";
import { validateUpload } from "@/lib/utils/validators";
import type { Enums, TablesInsert } from "@/types/database";

type DocumentCategory = Enums<"document_category">;

export type DocumentUploaderProps = {
  /** Tenant scope - bucket is `org-{organizationId}` (Behavioral Contracts §7). */
  organizationId: string;
  /** Authenticated user id, recorded as documents.uploaded_by. */
  uploadedBy: string;
  /** Called after a successful upload so the parent can refresh the list. */
  onUploaded: () => void;
  /** Upload button fill — defaults to the app-wide primary blue. */
  accentColor?: string;
};

const CATEGORY_OPTIONS = DOCUMENT_CATEGORIES.map((value) => ({
  value,
  label: humanizeEnum(value),
}));

/**
 * Replace characters that are awkward in a storage key while preserving the
 * extension. The original, unmodified name is stored in documents.file_name.
 */
function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

/**
 * Compact drag-and-drop document upload (BLUEPRINT §4.6, Behavioral Contracts §7).
 *
 * Uploads go to the org's Storage bucket `org-{organizationId}` at
 * `{category}/{timestamp}_{filename}` using the session-bound browser client,
 * so Storage RLS enforces tenant isolation - the service-role client is never
 * used from a user-facing path. File type and size are validated client-side
 * before any network call.
 */
export function DocumentUploader({
  organizationId,
  uploadedBy,
  onUploaded,
  accentColor = "#0077B6",
}: DocumentUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<DocumentCategory | "">("");
  const [description, setDescription] = useState("");
  const [expirationDate, setExpirationDate] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function selectFile(next: File | null) {
    setError(null);
    if (!next) {
      setFile(null);
      return;
    }
    const result = validateUpload({ name: next.name, size: next.size });
    if (!result.ok) {
      setFile(null);
      setError(result.error);
      return;
    }
    setFile(next);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    const dropped = event.dataTransfer.files?.[0] ?? null;
    selectFile(dropped);
  }

  function reset() {
    setFile(null);
    setCategory("");
    setDescription("");
    setExpirationDate("");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleUpload() {
    if (!file) {
      setError("Choose a file to upload.");
      return;
    }
    if (!category) {
      setError("Select a category for this document.");
      return;
    }

    // Re-validate immediately before upload (guards against state drift).
    const valid = validateUpload({ name: file.name, size: file.size });
    if (!valid.ok) {
      setError(valid.error);
      return;
    }

    setUploading(true);
    setError(null);

    // Storage quota pre-flight (Behavioral Contracts §25). Enforced server-side
    // so the limit can't be bypassed by uploading straight to Storage.
    try {
      const quotaRes = await fetch("/api/documents/quota", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileSize: file.size }),
      });
      if (quotaRes.status === 429) {
        setUploading(false);
        setError(
          "Storage limit reached for your plan. Upgrade in Billing to upload more.",
        );
        return;
      }
      if (!quotaRes.ok) {
        setUploading(false);
        setError("Could not verify your storage quota. Please try again.");
        return;
      }
    } catch {
      setUploading(false);
      setError("Could not verify your storage quota. Please try again.");
      return;
    }

    const supabase = createClient();
    const bucket = `org-${organizationId}`;
    const storagePath = `${category}/${Date.now()}_${sanitizeFileName(
      file.name,
    )}`;

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(storagePath, file, {
        contentType: file.type || undefined,
        upsert: false,
      });

    if (uploadError) {
      setUploading(false);
      setError(`Upload failed: ${uploadError.message}`);
      return;
    }

    // organization_id is set server-trusted from the session profile, never from
    // a form field (Behavioral Contracts §2). RLS is the second barrier.
    const insert: TablesInsert<"documents"> = {
      organization_id: organizationId,
      file_name: file.name,
      storage_path: storagePath,
      file_size: file.size,
      mime_type: file.type || null,
      category,
      description: description.trim() || null,
      expiration_date: expirationDate || null,
      uploaded_by: uploadedBy,
    };

    const { data: inserted, error: insertError } = await supabase
      .from("documents")
      .insert(insert)
      .select("id")
      .single();

    if (insertError) {
      // Roll back the orphaned object so storage and the table stay consistent.
      await supabase.storage.from(bucket).remove([storagePath]);
      setUploading(false);
      setError(`Could not save the document: ${insertError.message}`);
      return;
    }

    // Audit the upload (Behavioral Contracts §24).
    void recordAudit({
      action: "create",
      entityType: "document",
      entityId: (inserted as { id: string } | null)?.id,
      details: { file_name: file.name, category, file_size: file.size },
    });

    setUploading(false);
    reset();
    onUploaded();
  }

  const maxMb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

  return (
    <div className="space-y-2">
      {/* Compact drag-drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={[
          "flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed px-4 py-3 transition",
          isDragging
            ? "border-teal-400 bg-teal-50"
            : "border-navy-300 bg-navy-50/50 hover:border-navy-400",
        ].join(" ")}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy-100">
          {file ? (
            <FileUp className="h-4 w-4 text-teal-500" aria-hidden />
          ) : (
            <UploadCloud className="h-4 w-4 text-navy-400" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1">
          {file ? (
            <p className="truncate text-sm font-medium text-navy-900">
              {file.name}
            </p>
          ) : (
            <>
              <p className="text-sm font-medium text-navy-900">
                Drag &amp; drop or click to browse
              </p>
              <p className="text-xs text-navy-500">
                PDF, DOC, DOCX, JPG, PNG, XLS, XLSX, TXT · up to {maxMb} MB
              </p>
            </>
          )}
        </div>
        {file && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              selectFile(null);
            }}
            className="shrink-0 rounded p-1 text-navy-400 hover:bg-navy-100 hover:text-navy-600"
            aria-label="Remove selected file"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xls,.xlsx,.txt"
          onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
        />
      </div>

      {/* Controls row: category | expiration | description | upload */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as DocumentCategory)}
          aria-label="Category"
          className="rounded-md border border-navy-200 bg-surface px-2.5 py-1.5 text-xs text-navy-700 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
        >
          <option value="">Category *</option>
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={expirationDate}
          onChange={(e) => setExpirationDate(e.target.value)}
          aria-label="Expiration date"
          title="Expiration date (optional)"
          className="rounded-md border border-navy-200 bg-surface px-2.5 py-1.5 text-xs text-navy-700 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
        />
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional note"
          className="min-w-0 flex-1 rounded-md border border-navy-200 bg-surface px-2.5 py-1.5 text-xs text-navy-700 placeholder:text-navy-400 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
        />
        <button
          type="button"
          onClick={() => void handleUpload()}
          disabled={uploading || !file}
          style={{ backgroundColor: accentColor }}
          className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60"
        >
          {uploading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <UploadCloud className="h-3.5 w-3.5" aria-hidden />
          )}
          Upload
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
        >
          {error}
        </div>
      )}
    </div>
  );
}
