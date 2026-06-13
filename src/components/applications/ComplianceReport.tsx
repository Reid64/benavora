"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { Button, Card } from "@/components/ui";

type CheckStatus = "pass" | "fail" | "warn";

type ComplianceCheck = {
  name: string;
  status: CheckStatus;
  details: string;
};

export type ComplianceReportData = {
  application_id: string;
  passed: boolean;
  checks: ComplianceCheck[];
  blocking_issues: string[];
  warnings: string[];
  checked_at: string;
};

export type ComplianceReportProps = {
  applicationId: string;
};

function StatusIcon({ status }: { status: CheckStatus }) {
  if (status === "pass")
    return <CheckCircle className="h-4 w-4 shrink-0 text-green-500" />;
  if (status === "fail")
    return <XCircle className="h-4 w-4 shrink-0 text-red-500" />;
  return <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-500" />;
}

/**
 * Runs and renders the compliance check for an application (BEHAVIORAL_CONTRACTS §6).
 * Auto-fetches on mount. The passed/failed/warned state maps directly to the
 * compliance_report shape returned by POST /api/compliance/check.
 */
export function ComplianceReport({ applicationId }: ComplianceReportProps) {
  const [data, setData] = useState<ComplianceReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const runCheck = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/compliance/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ application_id: applicationId }),
      });
      const json = (await res.json()) as {
        data?: ComplianceReportData;
        error?: string;
      };
      if (!res.ok || !json.data) {
        setFetchError(json.error ?? "Compliance check failed.");
      } else {
        setData(json.data);
      }
    } catch {
      setFetchError("Could not reach the compliance check service.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void runCheck();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  return (
    <Card title="Compliance Check" className="lg:col-span-2">
      {loading && !data && (
        <div className="flex items-center gap-2 text-sm text-navy-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Running compliance check...
        </div>
      )}

      {fetchError && !data && (
        <div className="space-y-3">
          <p className="text-sm text-red-600">{fetchError}</p>
          <Button variant="secondary" onClick={runCheck} disabled={loading}>
            Retry
          </Button>
        </div>
      )}

      {data && (
        <div className="space-y-4">
          {/* Overall status */}
          <div
            className={
              "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium " +
              (data.passed
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-red-200 bg-red-50 text-red-800")
            }
          >
            {data.passed ? (
              <CheckCircle className="h-4 w-4 shrink-0 text-green-600" aria-hidden />
            ) : (
              <XCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden />
            )}
            {data.passed
              ? "All required checks passed - this application is ready to submit."
              : `${data.blocking_issues.length} blocking issue${
                  data.blocking_issues.length === 1 ? "" : "s"
                } must be resolved before submission.`}
          </div>

          {/* Per-check list */}
          {data.checks.length > 0 && (
            <ul className="divide-y divide-navy-100 rounded-lg border border-navy-200">
              {data.checks.map((check, i) => (
                <li key={i} className="flex items-start gap-3 px-4 py-3">
                  <span className="mt-0.5">
                    <StatusIcon status={check.status} />
                  </span>
                  <p className="min-w-0 flex-1 text-sm text-navy-800">
                    {check.details || check.name}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {/* Advisory AI warnings */}
          {data.warnings.length > 0 && (
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-yellow-800">
                AI Review Notes (advisory - do not block submission)
              </p>
              <ul className="space-y-1">
                {data.warnings.map((w, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-1.5 text-sm text-yellow-800"
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-xs text-navy-400">
              Checked {new Date(data.checked_at).toLocaleString()}
            </p>
            <Button
              variant="secondary"
              onClick={runCheck}
              disabled={loading}
              isLoading={loading}
            >
              <RefreshCw className="h-3 w-3" aria-hidden />
              Re-run check
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
