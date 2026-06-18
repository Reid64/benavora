"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, Wand2 } from "lucide-react";

import { Button, EmptyState, LoadingSpinner } from "@/components/ui";
import { ApplicationsViewToggle } from "@/components/applications/ApplicationsViewToggle";

type RenewalOpportunity = { id: string; name: string; recurrence: string | null };
type RenewalFunder = { id: string; name: string };
type RenewalApplication = {
  id: string;
  draft_content: string | null;
  awarded_amount: number | null;
};

type Renewal = {
  id: string;
  application_id: string;
  opportunity_id: string;
  funder_id: string | null;
  renewal_type: string;
  reporting_deadline: string | null;
  renewal_window_start: string | null;
  renewal_window_end: string | null;
  compliance_status: string;
  compliance_notes: string | null;
  auto_narrative_draft: string | null;
  alert_sent_60d: boolean;
  alert_sent_30d: boolean;
  alert_sent_14d: boolean;
  created_at: string;
  opportunities: RenewalOpportunity | null;
  funders: RenewalFunder | null;
  applications: RenewalApplication | null;
};

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / 86_400_000);
}

function urgencyClasses(days: number | null): {
  row: string;
  badge: string;
  label: string;
} {
  if (days === null)
    return { row: "", badge: "bg-navy-100 text-navy-600", label: "No deadline" };
  if (days < 0)
    return { row: "bg-gray-50", badge: "bg-gray-200 text-gray-600", label: "Overdue" };
  if (days <= 14)
    return {
      row: "bg-red-50",
      badge: "bg-red-100 text-red-700",
      label: `${days}d`,
    };
  if (days <= 30)
    return {
      row: "bg-orange-50",
      badge: "bg-orange-100 text-orange-700",
      label: `${days}d`,
    };
  if (days <= 60)
    return {
      row: "bg-yellow-50",
      badge: "bg-yellow-100 text-yellow-700",
      label: `${days}d`,
    };
  return {
    row: "",
    badge: "bg-green-100 text-green-700",
    label: `${days}d`,
  };
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const COMPLIANCE_LABELS: Record<string, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  submitted: "Submitted",
  approved: "Approved",
  overdue: "Overdue",
};

const COMPLIANCE_COLORS: Record<string, string> = {
  pending: "bg-navy-100 text-navy-600",
  in_progress: "bg-blue-100 text-blue-700",
  submitted: "bg-teal-100 text-teal-700",
  approved: "bg-green-100 text-green-700",
  overdue: "bg-red-100 text-red-700",
};

export default function RenewalsPage() {
  const [renewals, setRenewals] = useState<Renewal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/renewals");
      if (!res.ok) throw new Error("Failed to load");
      const json = (await res.json()) as { data: Renewal[] };
      setRenewals(json.data);
    } catch {
      setError("Could not load renewals.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const showEmpty = !loading && !error && renewals.length === 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
            Applications
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Active renewal obligations sorted by nearest reporting deadline.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ApplicationsViewToggle active="renewals" />
          <Button variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
            Refresh
          </Button>
        </div>
      </div>

      {/* Urgency legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="font-medium text-navy-500">Days remaining:</span>
        {[
          { label: "≤14 days", cls: "bg-red-100 text-red-700" },
          { label: "≤30 days", cls: "bg-orange-100 text-orange-700" },
          { label: "≤60 days", cls: "bg-yellow-100 text-yellow-700" },
          { label: ">60 days", cls: "bg-green-100 text-green-700" },
          { label: "No deadline", cls: "bg-navy-100 text-navy-600" },
        ].map(({ label, cls }) => (
          <span
            key={label}
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-medium ${cls}`}
          >
            {label}
          </span>
        ))}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {loading ? (
        <LoadingSpinner center label="Loading renewals..." />
      ) : showEmpty ? (
        <EmptyState
          icon={RefreshCw}
          title="No renewals yet"
          description="Renewal records are created automatically when an awarded outcome is recorded for a recurring opportunity."
          action={
            <Link href="/applications">
              <Button variant="secondary">View applications</Button>
            </Link>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-navy-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-navy-100">
            <thead className="bg-navy-50">
              <tr>
                {[
                  "Funder",
                  "Opportunity",
                  "Reporting Deadline",
                  "Renewal Window",
                  "Compliance",
                  "Days Remaining",
                  "Actions",
                ].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-navy-500"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {renewals.map((renewal) => {
                const days = daysUntil(renewal.reporting_deadline);
                const urgency = urgencyClasses(days);
                const funderName = renewal.funders?.name ?? "-";
                const oppName = renewal.opportunities?.name ?? "-";
                const oppId = renewal.opportunity_id;
                const appId = renewal.application_id;
                const complianceLabel =
                  COMPLIANCE_LABELS[renewal.compliance_status] ??
                  renewal.compliance_status;
                const complianceColor =
                  COMPLIANCE_COLORS[renewal.compliance_status] ??
                  "bg-navy-100 text-navy-600";

                return (
                  <tr
                    key={renewal.id}
                    className={`transition hover:bg-navy-50/50 ${urgency.row}`}
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-navy-900">
                      {funderName}
                    </td>
                    <td className="max-w-[200px] px-4 py-3 text-sm text-navy-700">
                      <span className="line-clamp-2">{oppName}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-navy-700">
                      {formatDate(renewal.reporting_deadline)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-navy-600">
                      {renewal.renewal_window_start || renewal.renewal_window_end ? (
                        <>
                          {formatDate(renewal.renewal_window_start)}
                          {" - "}
                          {formatDate(renewal.renewal_window_end)}
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${complianceColor}`}
                      >
                        {complianceLabel}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${urgency.badge}`}
                      >
                        {urgency.label}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Link
                        href={`/draft-generator?opportunity=${oppId}&application_id=${appId}&mode=renewal`}
                      >
                        <Button variant="secondary" size="sm">
                          <Wand2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                          Generate Narrative
                        </Button>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
