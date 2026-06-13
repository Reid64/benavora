"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Download, Link2, Loader2 } from "lucide-react";

import {
  Badge,
  Button,
  Modal,
  SearchBar,
  Select,
  Table,
} from "@/components/ui";
import type { TableColumn } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { DOCUMENT_CATEGORIES } from "@/lib/utils/constants";
import { formatDate, humanizeEnum } from "@/lib/utils/formatters";
import type { Tables, TablesInsert } from "@/types/database";

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

  const columns: TableColumn<Tables<"documents">>[] = [
    {
      key: "file_name",
      header: "Name",
      sortable: true,
      sortValue: (row) => row.file_name.toLowerCase(),
      render: (row) => (
        <div>
          <span className="font-medium text-navy-900">{row.file_name}</span>
          {row.description && (
            <span className="mt-0.5 block text-xs text-navy-500">
              {row.description}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      sortable: true,
      sortValue: (row) => row.category,
      render: (row) => <Badge>{humanizeEnum(row.category)}</Badge>,
    },
    {
      key: "size",
      header: "Size",
      render: (row) => (
        <span className="text-navy-500">{formatBytes(row.file_size)}</span>
      ),
    },
    {
      key: "expiration",
      header: "Expiration",
      sortable: true,
      sortValue: (row) => row.expiration_date ?? "",
      render: (row) => {
        if (!row.expiration_date)
          return <span className="text-navy-400">-</span>;
        if (isExpired(row.expiration_date)) {
          return (
            <Badge color="red" withDot>
              <AlertTriangle className="h-3 w-3" aria-hidden />
              Expired {formatDate(row.expiration_date)}
            </Badge>
          );
        }
        return (
          <span className="text-navy-600">
            {formatDate(row.expiration_date)}
          </span>
        );
      },
    },
    {
      key: "linked",
      header: "Linked applications",
      render: (row) => {
        const links = linksByDocument[row.id] ?? [];
        if (links.length === 0)
          return <span className="text-navy-400">None</span>;
        return (
          <span className="text-navy-600">
            {links.length === 1 ? links[0] : `${links.length} applications`}
          </span>
        );
      },
    },
    {
      key: "uploaded",
      header: "Uploaded",
      sortable: true,
      sortValue: (row) => row.created_at,
      render: (row) => formatDate(row.created_at),
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            isLoading={downloadingId === row.id}
            onClick={() => handleDownload(row)}
          >
            <Download className="h-4 w-4" aria-hidden />
            Download
          </Button>
          {editable && applications.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openLinkModal(row)}
            >
              <Link2 className="h-4 w-4" aria-hidden />
              Link
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="sm:max-w-xs sm:flex-1">
          <SearchBar
            onSearch={setQuery}
            placeholder="Search documents…"
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

      <Table
        columns={columns}
        data={filtered}
        rowKey={(row) => row.id}
        isLoading={isLoading}
        initialSort={{ key: "uploaded", direction: "desc" }}
        emptyMessage="No documents match your filters."
      />

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
