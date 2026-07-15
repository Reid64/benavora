"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, Wand2 } from "lucide-react";

import { Badge, Button, EmptyState, LoadingSpinner } from "@/components/ui";
import type { BadgeVariant } from "@/components/ui";
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
  variant: BadgeVariant;
  label: string;
} {
  if (days === null)
    return { row: "", variant: "neutral", label: "No deadline" };
  if (days < 0)
    return { row: "bg-gray-50", variant: "neutral", label: "Overdue" };
  if (days <= 14)
    return {
      row: "bg-red-50",
      variant: "error",
      label: `${days}d`,
    };
  if (days <= 30)
    return {
      row: "bg-warning-bg/40",
      variant: "warning",
      label: `${days}d`,
    };
  if (days <= 60)
    return {
      row: "bg-yellow-50",
      variant: "warning",
      label: `${days}d`,
    };
  return {
    row: "",
    variant: "success",
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

const COMPLIANCE_VARIANTS: Record<string, BadgeVariant> = {
  pending: "neutral",
  in_progress: "info",
  submitted: "info",
  approved: "success",
  overdue: "error",
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
          <h1 className="text-2xl font-bold tracking-tight text-primary">
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
        {(
          [
            { label: "≤14 days", variant: "error" },
            { label: "≤30 days", variant: "warning" },
            { label: "≤60 days", variant: "warning" },
            { label: ">60 days", variant: "success" },
            { label: "No deadline", variant: "neutral" },
          ] as { label: string; variant: BadgeVariant }[]
        ).map(({ label, variant }) => (
          <Badge key={label} variant={variant}>
            {label}
          </Badge>
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
        <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
          <table className="min-w-full divide-y divide-navy-100">
            <thead className="bg-sidebar">
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
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-white"
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
                const complianceVariant: BadgeVariant =
                  COMPLIANCE_VARIANTS[renewal.compliance_status] ?? "neutral";

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
                      <Badge variant={complianceVariant}>{complianceLabel}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <Badge variant={urgency.variant} className="font-semibold">
                        {urgency.label}
                      </Badge>
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
