"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Download,
  File,
  FileSpreadsheet,
  FileText,
  Link2,
  Loader2,
} from "lucide-react";

import { Badge, Button, Modal, SearchBar, Select } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import { DOCUMENT_CATEGORIES } from "@/lib/utils/constants";
import { formatDate, humanizeEnum } from "@/lib/utils/formatters";
import type { Tables, TablesInsert } from "@/types/database";

// Applications & Pipeline section treatment — PAGE_TREATMENT_PROTOCOL_V2.md.
// This component is only used by /documents, so it's safe to apply the
// section's Navy frame / Teal accent directly.
const FRAME_NAVY = "#2C4E3B";
const ACCENT_TEAL = "#2E6B66";
const CARD_BG = "#F8F5EE";

export type ApplicationOption = {
  id: string;
  label: string;
};

export type DocumentListProps = {
  documents: Tables<"documents">[];
  /** Tenant scope - Storage bucket is `org-{organizationId}`. */
  organizationId: string;
  /** Applications available to link a document to (BLUEPRINT §4.6). */
  applications: ApplicationOption[];
  /** document_id -> linked application labels, for the "Linked" column. */
  linksByDocument: Record<string, string[]>;
  /** Whether the current role may link documents (viewer is read-only). */
  editable: boolean;
  /** Refresh callback after a link is created. */
  onChanged: () => void;
  isLoading?: boolean;
};

const CATEGORY_FILTER_OPTIONS = [
  { value: "all", label: "All categories" },
  ...DOCUMENT_CATEGORIES.map((value) => ({
    value,
    label: humanizeEnum(value),
  })),
];

/** Format a byte count as a human-readable size. */
function formatBytes(bytes: number | null): string {
  if (bytes === null || Number.isNaN(bytes)) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/** True when an expiration date has passed (Behavioral Contracts §7). */
function isExpired(expiration: string | null): boolean {
  if (!expiration) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${expiration}T00:00:00`) < today;
}

type FileKind = "pdf" | "docx" | "xlsx" | "other";

/** Classifies a document by extension (falling back to MIME type) for the color-coded file icon. */
function fileKind(fileName: string, mimeType: string | null): FileKind {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf" || mimeType === "application/pdf") return "pdf";
  if (ext === "doc" || ext === "docx" || mimeType?.includes("word")) return "docx";
  if (
    ext === "xls" ||
    ext === "xlsx" ||
    mimeType?.includes("sheet") ||
    mimeType?.includes("excel")
  ) {
    return "xlsx";
  }
  return "other";
}

const FILE_ICON: Record<FileKind, { icon: typeof FileText; wrapperClass: string }> = {
  pdf: { icon: FileText, wrapperClass: "bg-[#FEE2E2] text-[#DC2626]" },
  docx: { icon: FileText, wrapperClass: "bg-[#DBEAFE] text-[#2563EB]" },
  xlsx: { icon: FileSpreadsheet, wrapperClass: "bg-[#DCFCE7] text-[#16A34A]" },
  other: { icon: File, wrapperClass: "bg-[rgba(44,78,59,0.08)] text-[#2C4E3B]" },
};

/** Color-coded file-type icon wrapper (Elevated Slate design system): PDF red, DOCX blue, XLSX green. */
function FileTypeIcon({
  fileName,
  mimeType,
}: {
  fileName: string;
  mimeType: string | null;
}) {
  const { icon: Icon, wrapperClass } = FILE_ICON[fileKind(fileName, mimeType)];
  return (
    <div
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
        wrapperClass,
      )}
    >
      <Icon className="h-5 w-5" aria-hidden />
    </div>
  );
}

/**
 * Categorized document list with search, a category filter, download links,
 * expiration warnings, and application linking (BLUEPRINT §4.6).
 *
 * Downloads use short-lived signed URLs minted by the session-bound client, so
 * Storage RLS still gates access. Linking writes to the application_documents
 * junction table (Behavioral Contracts §7).
 */
export function DocumentList({
  documents,
  organizationId,
  applications,
  linksByDocument,
  editable,
  onChanged,
  isLoading = false,
}: DocumentListProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Application-linking modal state.
  const [linkTarget, setLinkTarget] = useState<Tables<"documents"> | null>(null);
  const [selectedApplication, setSelectedApplication] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return documents.filter((doc) => {
      if (category !== "all" && doc.category !== category) return false;
      if (!q) return true;
      return (
        doc.file_name.toLowerCase().includes(q) ||
        (doc.description?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [documents, query, category]);

  // Most recently uploaded first, matching the previous table's default sort.
  const sorted = useMemo(
    () => [...filtered].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    [filtered],
  );

  async function handleDownload(doc: Tables<"documents">) {
    setError(null);
    setDownloadingId(doc.id);
    const supabase = createClient();
    const { data, error: signError } = await supabase.storage
      .from(`org-${organizationId}`)
      .createSignedUrl(doc.storage_path, 60, { download: doc.file_name });

    setDownloadingId(null);

    if (signError || !data?.signedUrl) {
      setError(`Could not generate a download link for "${doc.file_name}".`);
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  function openLinkModal(doc: Tables<"documents">) {
    setLinkTarget(doc);
    setSelectedApplication("");
    setLinkError(null);
  }

  async function handleLink() {
    if (!linkTarget) return;
    if (!selectedApplication) {
      setLinkError("Choose an application to link.");
      return;
    }

    setLinking(true);
    setLinkError(null);

    const supabase = createClient();
    const insert: TablesInsert<"application_documents"> = {
      application_id: selectedApplication,
      document_id: linkTarget.id,
    };
    const { error: linkInsertError } = await supabase
      .from("application_documents")
      .insert(insert);

    setLinking(false);

    if (linkInsertError) {
      // 23505 = unique_violation: the link already exists.
      if (linkInsertError.code === "23505") {
        setLinkError("This document is already linked to that application.");
      } else {
        setLinkError(`Could not link the document: ${linkInsertError.message}`);
      }
      return;
    }

    setLinkTarget(null);
    onChanged();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="sm:max-w-xs sm:flex-1">
          <SearchBar
            onSearch={setQuery}
            placeholder="Search documents..."
            aria-label="Search documents"
          />
        </div>
        <div className="sm:w-56">
          <Select
            aria-label="Filter by category"
            options={CATEGORY_FILTER_OPTIONS}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-xl border border-border bg-surface-sunken"
            />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div
          style={{ backgroundColor: FRAME_NAVY, borderRadius: "14px", padding: "4px" }}
          className="shadow-sm"
        >
          <div
            style={{ backgroundColor: CARD_BG, borderRadius: "11px" }}
            className="p-10 text-center text-sm text-slate-500"
          >
            No documents match your filters.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((doc) => {
            const links = linksByDocument[doc.id] ?? [];
            return (
              <div
                key={doc.id}
                style={{
                  backgroundColor: FRAME_NAVY,
                  borderRadius: "14px",
                  padding: "4px",
                  boxShadow: "0 4px 20px rgba(44,78,59,0.22)",
                }}
              >
              <div
                style={{ backgroundColor: CARD_BG, borderRadius: "11px" }}
                className="p-4"
              >
                <div className="flex items-start gap-3">
                  <FileTypeIcon fileName={doc.file_name} mimeType={doc.mime_type} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {doc.file_name}
                    </p>
                    {doc.description && (
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {doc.description}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Badge>{humanizeEnum(doc.category)}</Badge>
                  {doc.expiration_date && isExpired(doc.expiration_date) && (
                    <Badge color="red" withDot>
                      <AlertTriangle className="h-3 w-3" aria-hidden />
                      Expired {formatDate(doc.expiration_date)}
                    </Badge>
                  )}
                </div>

                <dl className="mt-3 space-y-1 text-xs text-slate-500">
                  <div className="flex items-center justify-between">
                    <dt>Size</dt>
                    <dd>{formatBytes(doc.file_size)}</dd>
                  </div>
                  {doc.expiration_date && !isExpired(doc.expiration_date) && (
                    <div className="flex items-center justify-between">
                      <dt>Expires</dt>
                      <dd>{formatDate(doc.expiration_date)}</dd>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <dt>Linked</dt>
                    <dd>
                      {links.length === 0
                        ? "None"
                        : links.length === 1
                          ? links[0]
                          : `${links.length} applications`}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt>Uploaded</dt>
                    <dd>{formatDate(doc.created_at)}</dd>
                  </div>
                </dl>

                <div className="mt-4 flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    isLoading={downloadingId === doc.id}
                    onClick={() => handleDownload(doc)}
                    style={{
                      border: `1.5px solid ${ACCENT_TEAL}`,
                      backgroundColor: "rgba(46,107,102,0.08)",
                      color: ACCENT_TEAL,
                    }}
                  >
                    <Download className="h-4 w-4" aria-hidden />
                    Download
                  </Button>
                  {editable && applications.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => openLinkModal(doc)} style={{ color: FRAME_NAVY }}>
                      <Link2 className="h-4 w-4" aria-hidden />
                      Link
                    </Button>
                  )}
                </div>
              </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={linkTarget !== null}
        onClose={() => setLinkTarget(null)}
        title="Link to application"
        description={
          linkTarget
            ? `Attach "${linkTarget.file_name}" to an application.`
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setLinkTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleLink} disabled={linking}>
              {linking && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              )}
              Link document
            </Button>
          </>
        }
      >
        <Select
          label="Application"
          required
          placeholder="Select an application"
          options={applications.map((app) => ({
            value: app.id,
            label: app.label,
          }))}
          value={selectedApplication}
          onChange={(e) => setSelectedApplication(e.target.value)}
        />
        {linkError && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {linkError}
          </p>
        )}
      </Modal>
    </div>
  );
}
