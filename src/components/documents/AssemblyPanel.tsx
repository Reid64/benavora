"use client";

import { useState } from "react";
import { CheckCircle2, Download, Package, XCircle } from "lucide-react";

import { Button, Card, EmptyState, LoadingSpinner } from "@/components/ui";

interface ChecklistEntry {
  document_name: string;
  status: "attached" | "missing";
  file_path: string | null;
}

interface AssembleResponse {
  checklist: ChecklistEntry[];
  allPresent: boolean;
  downloadUrl: string | null;
  zipPath: string | null;
}

export type AssemblyPanelProps = {
  applicationId: string;
};

/**
 * Calls /api/documents/assemble to compare required vs attached documents,
 * shows a green/red checklist, and provides a Download Package button when
 * all required documents are present and the ZIP has been assembled.
 */
export function AssemblyPanel({ applicationId }: AssemblyPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AssembleResponse | null>(null);

  async function handleAssemble() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/documents/assemble", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ application_id: applicationId }),
      });

      const data = (await res.json()) as AssembleResponse & {
        error?: string;
      };

      if (!res.ok) {
        setError(data.error ?? "Assembly failed. Please try again.");
        return;
      }

      setResult(data);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-navy-800">
              Document Assembly
            </h3>
            <p className="mt-0.5 text-sm text-navy-500">
              Verify required documents are attached and download a submission
              package.
            </p>
          </div>
          <Button
            onClick={handleAssemble}
            isLoading={loading}
            disabled={loading}
          >
            <Package className="h-4 w-4" aria-hidden />
            {result ? "Re-check" : "Check & Assemble"}
          </Button>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}
      </Card>

      {loading && <LoadingSpinner center label="Checking documents…" />}

      {!loading && result && (
        <>
          {result.checklist.length === 0 ? (
            <EmptyState
              icon={Package}
              title="No documents to check"
              description="No required documents are defined for this opportunity and none are attached to this application."
            />
          ) : (
            <Card title="Submission Checklist">
              <ul className="divide-y divide-navy-100">
                {result.checklist.map((item: ChecklistEntry, i: number) => (
                  <li key={i} className="flex items-center gap-3 py-3">
                    {item.status === "attached" ? (
                      <CheckCircle2
                        className="h-5 w-5 shrink-0 text-emerald-500"
                        aria-label="Attached"
                      />
                    ) : (
                      <XCircle
                        className="h-5 w-5 shrink-0 text-red-500"
                        aria-label="Missing"
                      />
                    )}
                    <span
                      className={
                        "text-sm " +
                        (item.status === "missing"
                          ? "text-red-700"
                          : "text-navy-800")
                      }
                    >
                      {item.document_name}
                    </span>
                    {item.status === "missing" && (
                      <span className="ml-auto text-xs font-medium text-red-500">
                        Missing
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {result.allPresent && result.downloadUrl && (
            <Card>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-emerald-700">
                    All required documents attached
                  </p>
                  <p className="mt-0.5 text-xs text-navy-500">
                    Submission package ready — link expires in 1 hour.
                  </p>
                </div>
                <a
                  href={result.downloadUrl}
                  download
                  rel="noopener noreferrer"
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-accent bg-[length:200%_100%] bg-left px-4 text-sm font-medium text-white shadow-glow-blue transition hover:bg-right hover:shadow-glow focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2"
                >
                  <Download className="h-4 w-4" aria-hidden />
                  Download Package
                </a>
              </div>
            </Card>
          )}

          {result.allPresent && !result.downloadUrl && result.checklist.length > 0 && (
            <div className="rounded-lg border border-navy-200 bg-navy-50 px-4 py-3 text-sm text-navy-600">
              All requirements satisfied but no files are attached to bundle.
              Attach documents to generate a downloadable package.
            </div>
          )}

          {!result.allPresent && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Attach all missing documents to generate the submission package.
            </div>
          )}
        </>
      )}
    </div>
  );
}
