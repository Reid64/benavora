"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Layers,
  Loader2,
  Mail,
  Plus,
  Shield,
  ShieldCheck,
  Upload,
  Users,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge, Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

interface OrgDocument {
  id: string;
  document_type: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  file_size: number | null;
  expires_at: string | null;
  is_current: boolean;
  created_at: string;
}

interface ReadinessReport {
  ready: boolean;
  missing: string[];
  expired: string[];
  score: number;
}

type DocTypeConfig = {
  type: string;
  label: string;
  Icon: LucideIcon;
  required: boolean;
  description: string;
};

const DOC_CONFIGS: DocTypeConfig[] = [
  { type: "501c3_letter", label: "501(c)(3) Letter", Icon: ShieldCheck, required: true, description: "IRS tax exemption determination letter" },
  { type: "form_990", label: "Form 990", Icon: FileText, required: true, description: "Annual IRS information return" },
  { type: "board_list", label: "Board List", Icon: Users, required: false, description: "Current board of directors roster" },
  { type: "project_budget", label: "Project Budget", Icon: Calculator, required: false, description: "Budget for your funded programs" },
  { type: "financial_statements", label: "Financial Statements", Icon: BarChart3, required: false, description: "Most recent audited financials" },
  { type: "annual_report", label: "Annual Report", Icon: BookOpen, required: false, description: "Organization annual report" },
  { type: "organizational_chart", label: "Org Chart", Icon: Layers, required: false, description: "Organizational structure chart" },
  { type: "letters_of_support", label: "Letters of Support", Icon: Mail, required: false, description: "Partner or community support letters" },
  { type: "insurance_certificate", label: "Insurance Certificate", Icon: Shield, required: false, description: "Certificate of liability insurance" },
];

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isExpiringSoon(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return ms > 0 && ms < 30 * 24 * 60 * 60 * 1000;
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

export default function DocumentVaultPage() {
  const [documents, setDocuments] = useState<OrgDocument[]>([]);
  const [readiness, setReadiness] = useState<ReadinessReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadingTypes, setUploadingTypes] = useState<Set<string>>(new Set());
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());
  const [typeHistory, setTypeHistory] = useState<Record<string, OrgDocument[]>>({});
  const [loadingHistory, setLoadingHistory] = useState<Set<string>>(new Set());

  // Custom upload modal
  const [showCustomUpload, setShowCustomUpload] = useState(false);
  const [customTypeName, setCustomTypeName] = useState("");
  const [customFile, setCustomFile] = useState<File | null>(null);
  const [uploadingCustom, setUploadingCustom] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const customFileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadType = useRef<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [docsRes, readinessRes] = await Promise.all([
        fetch("/api/autoapply/documents"),
        fetch("/api/autoapply/documents/readiness"),
      ]);
      if (!docsRes.ok || !readinessRes.ok) {
        setError("Failed to load documents.");
        return;
      }
      const { documents: docs } = (await docsRes.json()) as { documents: OrgDocument[] };
      const report = (await readinessRes.json()) as ReadinessReport;
      setDocuments(docs);
      setReadiness(report);
    } catch {
      setError("Failed to load documents.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function triggerUpload(docType: string) {
    setUploadError(null);
    pendingUploadType.current = docType;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  }

  async function handleFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const docType = pendingUploadType.current;
    if (!file || !docType) return;

    setUploadingTypes((prev) => new Set(prev).add(docType));
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("document_type", docType);
      const res = await fetch("/api/autoapply/documents", { method: "POST", body: fd });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setUploadError(body.error ?? "Upload failed.");
        return;
      }
      await loadData();
    } catch {
      setUploadError("Upload failed. Please try again.");
    } finally {
      setUploadingTypes((prev) => {
        const next = new Set(prev);
        next.delete(docType);
        return next;
      });
    }
  }

  async function handleCustomUpload() {
    if (!customTypeName.trim() || !customFile) return;
    setUploadingCustom(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", customFile);
      fd.append("document_type", customTypeName.trim().toLowerCase().replace(/\s+/g, "_"));
      const res = await fetch("/api/autoapply/documents", { method: "POST", body: fd });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setUploadError(body.error ?? "Upload failed.");
        return;
      }
      setShowCustomUpload(false);
      setCustomTypeName("");
      setCustomFile(null);
      await loadData();
    } catch {
      setUploadError("Upload failed. Please try again.");
    } finally {
      setUploadingCustom(false);
    }
  }

  async function loadTypeHistory(docType: string) {
    setLoadingHistory((prev) => new Set(prev).add(docType));
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("org_documents")
        .select("*")
        .eq("document_type", docType)
        .eq("is_current", false)
        .order("created_at", { ascending: false })
        .limit(10);
      setTypeHistory((prev) => ({ ...prev, [docType]: (data ?? []) as OrgDocument[] }));
    } finally {
      setLoadingHistory((prev) => {
        const next = new Set(prev);
        next.delete(docType);
        return next;
      });
    }
  }

  function toggleHistory(docType: string) {
    const isCurrentlyExpanded = expandedTypes.has(docType);
    setExpandedTypes((prev) => {
      const next = new Set(prev);
      if (isCurrentlyExpanded) next.delete(docType);
      else next.add(docType);
      return next;
    });
    if (!isCurrentlyExpanded && !typeHistory[docType]) {
      void loadTypeHistory(docType);
    }
  }

  const docsByType = new Map<string, OrgDocument>();
  for (const doc of documents) {
    docsByType.set(doc.document_type, doc);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-navy-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">Document Vault</h1>
          <p className="mt-1 text-sm text-navy-500">
            Maintain your organization&apos;s documents for AutoApply form submissions. Required documents must be current.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setShowCustomUpload(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          Upload New Document
        </Button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {uploadError && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {uploadError}
        </div>
      )}

      {/* Readiness banner */}
      {readiness && (
        <div
          className={`rounded-xl border px-5 py-4 ${
            readiness.score >= 90
              ? "border-green-200 bg-green-50"
              : readiness.score >= 50
                ? "border-amber-200 bg-amber-50"
                : "border-red-200 bg-red-50"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p
                className={`text-sm font-semibold ${
                  readiness.score >= 90
                    ? "text-green-800"
                    : readiness.score >= 50
                      ? "text-amber-800"
                      : "text-red-800"
                }`}
              >
                Your organization is {readiness.score}% ready for AutoApply
                {readiness.ready && " — all required documents are current."}
              </p>
              {readiness.missing.length > 0 && (
                <p
                  className={`mt-1 text-xs ${
                    readiness.score >= 90
                      ? "text-green-700"
                      : readiness.score >= 50
                        ? "text-amber-700"
                        : "text-red-700"
                  }`}
                >
                  Missing:{" "}
                  {readiness.missing
                    .map((t) => DOC_CONFIGS.find((c) => c.type === t)?.label ?? t)
                    .join(", ")}
                </p>
              )}
              {readiness.expired.length > 0 && (
                <p className="mt-1 text-xs text-red-700">
                  Expired:{" "}
                  {readiness.expired
                    .map((t) => DOC_CONFIGS.find((c) => c.type === t)?.label ?? t)
                    .join(", ")}
                </p>
              )}
            </div>
            <div
              className={`flex-shrink-0 text-3xl font-bold tabular-nums ${
                readiness.score >= 90
                  ? "text-green-700"
                  : readiness.score >= 50
                    ? "text-amber-700"
                    : "text-red-700"
              }`}
            >
              {readiness.score}%
            </div>
          </div>
        </div>
      )}

      {/* Document type cards grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DOC_CONFIGS.map((config) => {
          const { type, label, Icon, required, description } = config;
          const doc = docsByType.get(type) ?? null;
          const docExpired = doc ? isExpired(doc.expires_at) : false;
          const docExpiring = doc && !docExpired ? isExpiringSoon(doc.expires_at) : false;
          const isUploading = uploadingTypes.has(type);
          const isExpanded = expandedTypes.has(type);
          const history = typeHistory[type] ?? [];
          const isLoadingHist = loadingHistory.has(type);

          let statusIcon: ReactNode = null;
          if (doc && !docExpired && !docExpiring) {
            statusIcon = <CheckCircle2 className="h-4 w-4 text-green-500" />;
          } else if (doc && docExpiring) {
            statusIcon = <AlertTriangle className="h-4 w-4 text-amber-500" />;
          } else if ((doc && docExpired) || (!doc && required)) {
            statusIcon = <XCircle className="h-4 w-4 text-red-500" />;
          }

          return (
            <div key={type} className="flex flex-col rounded-xl border border-border bg-white shadow-sm">
              <div className="flex-1 p-4">
                {/* Card header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <div className="flex-shrink-0 rounded-lg border border-navy-100 bg-navy-50 p-2">
                      <Icon className="h-4 w-4 text-navy-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium text-navy-900">{label}</span>
                        {required && <Badge color="red">Required</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-navy-400">{description}</p>
                    </div>
                  </div>
                  {statusIcon && <div className="flex-shrink-0 pt-0.5">{statusIcon}</div>}
                </div>

                {/* File info */}
                <div className="mt-3 border-t border-navy-100 pt-3">
                  {doc ? (
                    <div className="space-y-0.5">
                      <p className="truncate text-xs font-medium text-navy-700" title={doc.file_name}>
                        {doc.file_name}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-navy-400">
                        <span>Uploaded {formatDate(doc.created_at)}</span>
                        {doc.file_size ? (
                          <>
                            <span>·</span>
                            <span>{formatFileSize(doc.file_size)}</span>
                          </>
                        ) : null}
                      </div>
                      {doc.expires_at && (
                        <div
                          className={`flex items-center gap-1 text-xs ${
                            docExpired
                              ? "text-red-600"
                              : docExpiring
                                ? "font-medium text-amber-600"
                                : "text-navy-400"
                          }`}
                        >
                          <Clock className="h-3 w-3" />
                          {docExpired ? "Expired" : "Expires"} {formatDate(doc.expires_at)}
                          {docExpiring && " — renew soon"}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-navy-400">
                      {required ? "Required — not yet uploaded." : "Not uploaded."}
                    </p>
                  )}
                </div>
              </div>

              {/* Card footer actions */}
              <div className="flex items-center gap-2 border-t border-navy-100 px-4 py-2.5">
                <button
                  type="button"
                  onClick={() => triggerUpload(type)}
                  disabled={isUploading}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-navy-200 bg-white px-3 py-1.5 text-xs font-medium text-navy-700 transition-colors hover:bg-navy-50 disabled:opacity-50"
                >
                  {isUploading ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Upload className="h-3 w-3" />
                  )}
                  {doc ? "Replace" : "Upload"}
                </button>
                <button
                  type="button"
                  onClick={() => toggleHistory(type)}
                  className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-navy-400 transition-colors hover:bg-navy-50 hover:text-navy-600"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  History
                </button>
              </div>

              {/* Expandable history */}
              {isExpanded && (
                <div className="rounded-b-xl border-t border-navy-100 bg-navy-50 px-4 py-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-navy-500">
                    Previous Versions
                  </p>
                  {isLoadingHist ? (
                    <div className="flex items-center gap-2 py-1">
                      <Loader2 className="h-3 w-3 animate-spin text-navy-400" />
                      <span className="text-xs text-navy-400">Loading…</span>
                    </div>
                  ) : history.length === 0 ? (
                    <p className="text-xs text-navy-400">No previous versions.</p>
                  ) : (
                    <div className="divide-y divide-navy-100">
                      {history.map((h) => (
                        <div
                          key={h.id}
                          className="flex items-center justify-between gap-3 py-1.5 text-xs"
                        >
                          <span
                            className="min-w-0 truncate text-navy-600"
                            title={h.file_name}
                          >
                            {h.file_name}
                          </span>
                          <span className="flex-shrink-0 text-navy-400">
                            {formatDate(h.created_at)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Custom upload modal */}
      {showCustomUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-navy-900">Upload Custom Document</h2>
            <p className="mt-1 text-sm text-navy-500">
              Upload a document that doesn&apos;t fit a standard category.
            </p>
            <div className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="custom-type-name"
                  className="block text-xs font-medium text-navy-700"
                >
                  Document Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="custom-type-name"
                  type="text"
                  placeholder="e.g. Partnership Agreement"
                  value={customTypeName}
                  onChange={(e) => setCustomTypeName(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-navy-700">
                  File <span className="text-red-500">*</span>
                </label>
                <input
                  ref={customFileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => setCustomFile(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  onClick={() => customFileInputRef.current?.click()}
                  className="mt-1 flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-navy-300 bg-navy-50 px-4 py-3 text-sm text-navy-500 transition-colors hover:border-navy-400 hover:text-navy-700"
                >
                  <Upload className="h-4 w-4" />
                  {customFile ? customFile.name : "Choose file…"}
                </button>
              </div>
              {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowCustomUpload(false);
                  setCustomTypeName("");
                  setCustomFile(null);
                  setUploadError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void handleCustomUpload()}
                disabled={!customTypeName.trim() || !customFile || uploadingCustom}
                isLoading={uploadingCustom}
              >
                Upload
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden file input for standard type uploads */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        aria-hidden="true"
        onChange={(e) => void handleFileSelected(e)}
      />
    </div>
  );
}
