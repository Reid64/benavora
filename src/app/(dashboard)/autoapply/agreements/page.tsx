"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  DollarSign,
  FileCheck2,
  Plus,
} from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import type { BadgeColor } from "@/components/ui/Badge";
import { Button, Card, EmptyState, Modal } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/types/database";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgreementRow {
  id: string;
  submission_id: string | null;
  funder_id: string;
  amount_awarded: number | null;
  award_type: string | null;
  agreement_date: string | null;
  start_date: string | null;
  end_date: string | null;
  terms: string | null;
  reporting_requirements: Json | null;
  payment_schedule: Json | null;
  status: string;
  notes: string | null;
  created_at: string;
}

interface FunderOption {
  id: string;
  name: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const AWARD_TYPES = [
  { value: "grant", label: "Grant" },
  { value: "donation", label: "Donation" },
  { value: "sponsorship", label: "Sponsorship" },
  { value: "in_kind", label: "In-Kind" },
  { value: "land", label: "Land" },
  { value: "service", label: "Service" },
  { value: "volunteer", label: "Volunteer" },
  { value: "partnership", label: "Partnership" },
  { value: "other", label: "Other" },
];

const STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "on_hold", label: "On Hold" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: string): { color: BadgeColor; label: string } {
  switch (status) {
    case "active":
      return { color: "teal", label: "Active" };
    case "completed":
      return { color: "blue", label: "Completed" };
    case "cancelled":
      return { color: "red", label: "Cancelled" };
    case "on_hold":
      return { color: "gray", label: "On Hold" };
    default:
      return { color: "yellow", label: "Pending" };
  }
}

function formatCurrency(amount: number | null): string {
  if (amount == null) return "—";
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getReportingDueDate(reporting: Json | null): Date | null {
  if (!reporting || typeof reporting !== "object" || Array.isArray(reporting)) {
    return null;
  }
  const r = reporting as Record<string, Json>;
  const val = r["due_date"];
  if (typeof val !== "string" || !val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function isReportingDueSoon(dueDate: Date | null): boolean {
  if (!dueDate) return false;
  const now = Date.now();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  return dueDate.getTime() > now && dueDate.getTime() - now < thirtyDays;
}

function jsonDisplay(value: Json | null): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgreementsPage() {
  const [agreements, setAgreements] = useState<AgreementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [funders, setFunders] = useState<FunderOption[]>([]);
  const [funderMap, setFunderMap] = useState<Record<string, string>>({});

  // Log Agreement modal state
  const [logOpen, setLogOpen] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const [form, setForm] = useState({
    funder_id: "",
    amount_awarded: "",
    award_type: "grant",
    agreement_date: "",
    start_date: "",
    end_date: "",
    status: "pending",
    terms: "",
    reporting_due_date: "",
    reporting_frequency: "",
    notes: "",
    submission_id: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/autoapply/agreements");
      if (!res.ok) throw new Error("Failed to load agreements.");
      const { agreements: rows } = (await res.json()) as { agreements: AgreementRow[] };
      setAgreements(rows ?? []);
      setError(null);

      // Fetch funder names
      if (rows && rows.length > 0) {
        const ids = [...new Set(rows.map((r) => r.funder_id))];
        const supabase = createClient();
        const { data: funderRows } = await supabase
          .from("funders")
          .select("id, name")
          .in("id", ids);
        const map: Record<string, string> = {};
        for (const f of (funderRows ?? []) as FunderOption[]) {
          map[f.id] = f.name;
        }
        setFunderMap(map);
      }
    } catch {
      setError("Could not load agreements.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function openLogModal() {
    setLogOpen(true);
    setLogError(null);
    setForm({
      funder_id: "",
      amount_awarded: "",
      award_type: "grant",
      agreement_date: "",
      start_date: "",
      end_date: "",
      status: "pending",
      terms: "",
      reporting_due_date: "",
      reporting_frequency: "",
      notes: "",
      submission_id: "",
    });

    const supabase = createClient();
    const { data } = await supabase
      .from("funders")
      .select("id, name")
      .order("name");
    setFunders((data ?? []) as FunderOption[]);
  }

  async function handleLog() {
    if (!form.funder_id) {
      setLogError("Funder is required.");
      return;
    }
    setLogging(true);
    setLogError(null);
    try {
      const reporting_requirements =
        form.reporting_due_date || form.reporting_frequency
          ? {
              due_date: form.reporting_due_date || null,
              frequency: form.reporting_frequency || null,
            }
          : null;

      const body = {
        funder_id: form.funder_id,
        amount_awarded: form.amount_awarded ? Number(form.amount_awarded) : null,
        award_type: form.award_type || null,
        agreement_date: form.agreement_date || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        status: form.status,
        terms: form.terms || null,
        reporting_requirements,
        notes: form.notes || null,
        submission_id: form.submission_id || null,
      };

      const res = await fetch("/api/autoapply/agreements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setLogError(err.error ?? "Could not create agreement.");
        return;
      }

      setLogOpen(false);
      await load();
    } catch {
      setLogError("Could not create agreement. Please try again.");
    } finally {
      setLogging(false);
    }
  }

  const totalAwarded = useMemo(
    () =>
      agreements
        .filter((a) => a.status === "active" || a.status === "completed")
        .reduce((sum, a) => sum + (a.amount_awarded ?? 0), 0),
    [agreements],
  );

  const reportingWarnings = agreements.filter((a) =>
    isReportingDueSoon(getReportingDueDate(a.reporting_requirements)),
  );

  function toggleExpanded(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  function updateForm(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <div className="flex items-center gap-4">
        <Link
          href="/autoapply"
          className="flex items-center gap-1.5 text-sm text-navy-400 hover:text-navy-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to AutoApply
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
            Grant Agreements
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Track post-award agreements, reporting obligations, and payment schedules.
          </p>
        </div>
        <Button onClick={() => void openLogModal()}>
          <Plus className="mr-1.5 h-4 w-4" />
          Log Agreement
        </Button>
      </div>

      {/* Reporting warnings */}
      {reportingWarnings.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-medium text-amber-800">
              {reportingWarnings.length === 1
                ? "1 agreement has a report due within 30 days"
                : `${reportingWarnings.length} agreements have reports due within 30 days`}
            </p>
            <p className="mt-0.5 text-xs text-amber-700">
              {reportingWarnings
                .map(
                  (a) =>
                    `${funderMap[a.funder_id] ?? "Unknown funder"} (due ${formatDate(
                      (
                        (a.reporting_requirements as Record<string, Json> | null)
                          ?.["due_date"] as string | null
                      ) ?? null,
                    )})`,
                )
                .join(" · ")}
            </p>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* Total awarded stat card */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-100">
              <DollarSign className="h-5 w-5 text-teal-600" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-navy-400">
                Total Awarded
              </p>
              <p className="text-xl font-semibold text-navy-900">
                {formatCurrency(totalAwarded || null)}
              </p>
              <p className="text-xs text-navy-400">active &amp; completed</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
              <FileCheck2 className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-navy-400">
                Active Agreements
              </p>
              <p className="text-xl font-semibold text-navy-900">
                {agreements.filter((a) => a.status === "active").length}
              </p>
              <p className="text-xs text-navy-400">currently active</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-navy-400">
                Reports Due Soon
              </p>
              <p className="text-xl font-semibold text-navy-900">
                {reportingWarnings.length}
              </p>
              <p className="text-xs text-navy-400">within 30 days</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Agreements table */}
      <Card noPadding title="Agreements" description="All grant agreements for your organization">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-6 text-sm text-navy-400">Loading agreements…</div>
          ) : agreements.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={FileCheck2}
                title="No agreements yet"
                description='Click "Log Agreement" to record a successful award.'
              />
            </div>
          ) : (
            <table className="min-w-full divide-y divide-navy-100 text-sm">
              <thead>
                <tr className="bg-navy-50">
                  <th className="w-8 px-4 py-3" />
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Funder
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Agreement Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Duration
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Reporting
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100 bg-white">
                {agreements.map((a) => {
                  const { color, label } = statusBadge(a.status);
                  const reportDue = getReportingDueDate(a.reporting_requirements);
                  const reportWarn = isReportingDueSoon(reportDue);
                  const isExpanded = expandedId === a.id;

                  return (
                    <Fragment key={a.id}>
                      <tr
                        className="cursor-pointer hover:bg-navy-50"
                        onClick={() => toggleExpanded(a.id)}
                      >
                        <td className="px-4 py-3 text-navy-400">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium text-navy-900">
                          {funderMap[a.funder_id] ?? (
                            <span className="font-mono text-xs text-navy-400">
                              {a.funder_id.slice(0, 8)}…
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-semibold text-navy-900">
                          {formatCurrency(a.amount_awarded)}
                        </td>
                        <td className="px-4 py-3 text-navy-500">
                          {AWARD_TYPES.find((t) => t.value === a.award_type)?.label ??
                            a.award_type ??
                            "—"}
                        </td>
                        <td className="px-4 py-3">
                          <Badge color={color}>{label}</Badge>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-navy-500">
                          {formatDate(a.agreement_date)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-navy-500">
                          {a.start_date || a.end_date
                            ? `${formatDate(a.start_date)} → ${formatDate(a.end_date)}`
                            : "—"}
                        </td>
                        <td className="px-4 py-3">
                          {reportWarn ? (
                            <Badge variant="warning" className="gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Due {formatDate(reportDue ? reportDue.toISOString() : null)}
                            </Badge>
                          ) : reportDue ? (
                            <span className="text-xs text-navy-400">
                              {formatDate(reportDue.toISOString())}
                            </span>
                          ) : (
                            <span className="text-navy-300">—</span>
                          )}
                        </td>
                      </tr>

                      {/* Expanded row */}
                      {isExpanded && (
                        <tr className="bg-navy-50">
                          <td colSpan={8} className="px-8 py-4">
                            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                              <div>
                                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-navy-400">
                                  Terms
                                </p>
                                <p className="whitespace-pre-wrap text-sm text-navy-700">
                                  {a.terms ?? "—"}
                                </p>
                              </div>
                              <div>
                                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-navy-400">
                                  Reporting Requirements
                                </p>
                                {a.reporting_requirements ? (
                                  <pre className="overflow-auto rounded bg-white p-2 text-xs text-navy-600 ring-1 ring-navy-200">
                                    {jsonDisplay(a.reporting_requirements)}
                                  </pre>
                                ) : (
                                  <p className="text-sm text-navy-400">—</p>
                                )}
                              </div>
                              <div>
                                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-navy-400">
                                  Payment Schedule
                                </p>
                                {a.payment_schedule ? (
                                  <pre className="overflow-auto rounded bg-white p-2 text-xs text-navy-600 ring-1 ring-navy-200">
                                    {jsonDisplay(a.payment_schedule)}
                                  </pre>
                                ) : (
                                  <p className="text-sm text-navy-400">—</p>
                                )}
                                {a.notes && (
                                  <div className="mt-3">
                                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-navy-400">
                                      Notes
                                    </p>
                                    <p className="text-sm text-navy-600">{a.notes}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* Log Agreement Modal */}
      <Modal
        isOpen={logOpen}
        onClose={() => setLogOpen(false)}
        title="Log Agreement"
        description="Record a grant award and its associated terms."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setLogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleLog()}
              isLoading={logging}
              disabled={logging}
            >
              <FileCheck2 className="mr-1.5 h-4 w-4" />
              Save Agreement
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {logError && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {logError}
            </div>
          )}

          {/* Funder */}
          <div>
            <label htmlFor="log-funder" className="block text-xs font-medium text-navy-700">
              Funder <span className="text-red-500">*</span>
            </label>
            <select
              id="log-funder"
              value={form.funder_id}
              onChange={(e) => updateForm("funder_id", e.target.value)}
              className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            >
              <option value="">Select a funder…</option>
              {funders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          {/* Amount + Type */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="log-amount" className="block text-xs font-medium text-navy-700">
                Amount Awarded
              </label>
              <input
                id="log-amount"
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 25000"
                value={form.amount_awarded}
                onChange={(e) => updateForm("amount_awarded", e.target.value)}
                className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
              />
            </div>
            <div>
              <label htmlFor="log-type" className="block text-xs font-medium text-navy-700">
                Award Type
              </label>
              <select
                id="log-type"
                value={form.award_type}
                onChange={(e) => updateForm("award_type", e.target.value)}
                className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
              >
                {AWARD_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="log-agree-date"
                className="block text-xs font-medium text-navy-700"
              >
                Agreement Date
              </label>
              <input
                id="log-agree-date"
                type="date"
                value={form.agreement_date}
                onChange={(e) => updateForm("agreement_date", e.target.value)}
                className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
              />
            </div>
            <div>
              <label htmlFor="log-start" className="block text-xs font-medium text-navy-700">
                Start Date
              </label>
              <input
                id="log-start"
                type="date"
                value={form.start_date}
                onChange={(e) => updateForm("start_date", e.target.value)}
                className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
              />
            </div>
            <div>
              <label htmlFor="log-end" className="block text-xs font-medium text-navy-700">
                End Date
              </label>
              <input
                id="log-end"
                type="date"
                value={form.end_date}
                onChange={(e) => updateForm("end_date", e.target.value)}
                className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
              />
            </div>
          </div>

          {/* Status */}
          <div>
            <label htmlFor="log-status" className="block text-xs font-medium text-navy-700">
              Status
            </label>
            <select
              id="log-status"
              value={form.status}
              onChange={(e) => updateForm("status", e.target.value)}
              className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* Terms */}
          <div>
            <label htmlFor="log-terms" className="block text-xs font-medium text-navy-700">
              Terms
            </label>
            <textarea
              id="log-terms"
              rows={3}
              placeholder="Key grant terms, restrictions, or conditions…"
              value={form.terms}
              onChange={(e) => updateForm("terms", e.target.value)}
              className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>

          {/* Reporting requirements */}
          <div className="rounded-lg border border-navy-200 bg-navy-50 p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-navy-500">
              Reporting Requirements
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="log-report-due"
                  className="block text-xs font-medium text-navy-700"
                >
                  Next Report Due
                </label>
                <input
                  id="log-report-due"
                  type="date"
                  value={form.reporting_due_date}
                  onChange={(e) => updateForm("reporting_due_date", e.target.value)}
                  className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                />
              </div>
              <div>
                <label
                  htmlFor="log-report-freq"
                  className="block text-xs font-medium text-navy-700"
                >
                  Reporting Frequency
                </label>
                <select
                  id="log-report-freq"
                  value={form.reporting_frequency}
                  onChange={(e) => updateForm("reporting_frequency", e.target.value)}
                  className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                >
                  <option value="">Not required</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="semi_annual">Semi-Annual</option>
                  <option value="annual">Annual</option>
                  <option value="at_close">At Close</option>
                </select>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label htmlFor="log-notes" className="block text-xs font-medium text-navy-700">
              Notes
            </label>
            <textarea
              id="log-notes"
              rows={2}
              placeholder="Internal notes about this agreement…"
              value={form.notes}
              onChange={(e) => updateForm("notes", e.target.value)}
              className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>

          {/* Optional submission link */}
          <div>
            <label htmlFor="log-sub-id" className="block text-xs font-medium text-navy-700">
              Linked Submission ID
              <span className="ml-1 text-navy-400">(optional)</span>
            </label>
            <input
              id="log-sub-id"
              type="text"
              placeholder="UUID of the autoapply_submission that won this award"
              value={form.submission_id}
              onChange={(e) => updateForm("submission_id", e.target.value)}
              className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 font-mono text-xs text-navy-700 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
