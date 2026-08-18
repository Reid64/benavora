"use client";

import { useState } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  Download,
  DollarSign,
  FileBarChart2,
  Heart,
  Loader2,
  Printer,
  TrendingUp,
  Trophy,
} from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { cn } from "@/lib/utils/cn";

function defaultDates(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    start: start.toISOString().split("T")[0]!,
    end: end.toISOString().split("T")[0]!,
  };
}

function defaultFiscalYearDates(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getFullYear(), 0, 1);
  return {
    start: start.toISOString().split("T")[0]!,
    end: end.toISOString().split("T")[0]!,
  };
}

interface BoardReportTopFunder {
  funderId: string;
  funderName: string;
  applicationCount: number;
}

interface BoardReportUpcomingDeadline {
  opportunityId: string;
  name: string;
  deadline: string;
  funderName: string | null;
}

interface BoardReportSummary {
  dateRange: { from: string; to: string };
  opportunitiesCreated: number;
  applicationsSubmitted: number;
  totalAwarded: number;
  outcomesRecorded: number;
  outcomesAwarded: number;
  successRate: number;
  topFunders: BoardReportTopFunder[];
  upcomingDeadlines: BoardReportUpcomingDeadline[];
  narrativeSummary: string;
}

function formatCurrency(amount: number): string {
  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

type ReportAccent = "teal" | "green" | "violet";

const ACCENT_CLASSES: Record<
  ReportAccent,
  { iconBg: string; iconText: string; border: string; check: string }
> = {
  teal: {
    iconBg: "bg-teal-100",
    iconText: "text-teal-600",
    border: "border-l-4 border-l-teal-500",
    check: "text-teal-600",
  },
  green: {
    iconBg: "bg-green-100",
    iconText: "text-green-600",
    border: "border-l-4 border-l-green-500",
    check: "text-green-600",
  },
  violet: {
    iconBg: "bg-violet-100",
    iconText: "text-violet-600",
    border: "border-l-4 border-l-violet-500",
    check: "text-violet-600",
  },
};

interface ReportCategory {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  accent: ReportAccent;
  items: string[];
}

const REPORT_CATEGORIES: ReportCategory[] = [
  {
    key: "grant",
    title: "Grant Reports",
    description: "Pipeline status and submission activity across your funding pipeline.",
    icon: ClipboardList,
    accent: "teal",
    items: ["Pipeline Status by stage", "Submission Activity"],
  },
  {
    key: "financial",
    title: "Financial Reports",
    description: "Awards, funding totals, and category-level financial performance.",
    icon: DollarSign,
    accent: "green",
    items: ["Awards and Funding", "Financial Overview by category"],
  },
  {
    key: "activity",
    title: "Activity Reports",
    description: "Executive summary, agent performance, and strategic recommendations.",
    icon: Activity,
    accent: "violet",
    items: ["Executive Summary & KPIs", "Agent Performance", "Strategic Recommendations"],
  },
];

type DetailedReportAccent = "blue" | "violet" | "red";

const DETAILED_REPORT_ACCENT_CLASSES: Record<
  DetailedReportAccent,
  { iconBg: string; iconText: string }
> = {
  blue: { iconBg: "bg-blue-50", iconText: "text-[#0077B6]" },
  violet: { iconBg: "bg-violet-100", iconText: "text-violet-600" },
  red: { iconBg: "bg-red-50", iconText: "text-red-500" },
};

interface DetailedReportLink {
  key: string;
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  accent: DetailedReportAccent;
}

const DETAILED_REPORTS: DetailedReportLink[] = [
  {
    key: "funding-summary",
    title: "Funding Summary Report",
    description: "Pipeline metrics, funding source breakdown, category performance, and top funders.",
    href: "/reports/funding-summary",
    icon: TrendingUp,
    accent: "blue",
  },
  {
    key: "board-report",
    title: "Board Report",
    description: "Auto-generated, printable board report with an AI-written executive summary and recommended actions.",
    href: "/reports/board-report",
    icon: FileBarChart2,
    accent: "violet",
  },
  {
    key: "impact-report",
    title: "Impact Report",
    description: "Mission, programs, stewardship, and stories of impact for donors and funders — AI-enhanced.",
    href: "/reports/impact",
    icon: Heart,
    accent: "red",
  },
];

function DetailedReportCard({ report }: { report: DetailedReportLink }) {
  const accent = DETAILED_REPORT_ACCENT_CLASSES[report.accent];
  const Icon = report.icon;
  return (
    <Link
      href={report.href}
      className="group flex items-start gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm transition-colors hover:border-[#0077B6]"
    >
      <div className={cn("flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg", accent.iconBg)}>
        <Icon className={cn("h-5 w-5", accent.iconText)} aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-slate-900">{report.title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">{report.description}</p>
      </div>
      <ArrowRight className="mt-1 h-4 w-4 flex-shrink-0 text-slate-300 transition-colors group-hover:text-[#0077B6]" aria-hidden />
    </Link>
  );
}

function ReportCategoryCard({ category }: { category: ReportCategory }) {
  const accent = ACCENT_CLASSES[category.accent];
  const Icon = category.icon;
  return (
    <div
      className={cn(
        "bg-surface rounded-xl shadow-sm border border-border p-5",
        accent.border,
      )}
    >
      <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", accent.iconBg)}>
        <Icon className={cn("h-5 w-5", accent.iconText)} aria-hidden />
      </div>
      <h3 className="mt-3 text-base font-semibold text-slate-900">{category.title}</h3>
      <p className="mt-1 text-sm text-slate-500">{category.description}</p>
      <ul className="mt-3 space-y-1.5">
        {category.items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-xs text-slate-600">
            <span className={cn("mt-0.5 font-semibold", accent.check)}>✓</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ReportsPage() {
  const defaults = defaultDates();
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [loading, setLoading] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fiscalYearDefaults = defaultFiscalYearDates();
  const [summaryStartDate, setSummaryStartDate] = useState(
    fiscalYearDefaults.start,
  );
  const [summaryEndDate, setSummaryEndDate] = useState(fiscalYearDefaults.end);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summary, setSummary] = useState<BoardReportSummary | null>(null);

  async function handleGenerateSummary() {
    if (!summaryStartDate || !summaryEndDate) return;
    if (summaryStartDate > summaryEndDate) {
      setSummaryError("Start date must be before end date.");
      return;
    }

    setSummaryLoading(true);
    setSummaryError(null);
    setSummary(null);

    try {
      const params = new URLSearchParams({
        dateFrom: summaryStartDate,
        dateTo: summaryEndDate,
      });
      const res = await fetch(`/api/reports/board-report?${params.toString()}`);

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? "Board report summary failed.");
      }

      const data = (await res.json()) as BoardReportSummary;
      setSummary(data);
    } catch (err) {
      setSummaryError(
        err instanceof Error ? err.message : "An unexpected error occurred.",
      );
    } finally {
      setSummaryLoading(false);
    }
  }

  async function handleGenerate() {
    if (!startDate || !endDate) return;
    if (startDate > endDate) {
      setError("Start date must be before end date.");
      return;
    }

    setLoading(true);
    setError(null);
    setDownloadUrl(null);
    setGeneratedAt(null);

    try {
      const res = await fetch("/api/reports/board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start_date: startDate, end_date: endDate }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? "Report generation failed.");
      }

      const data = (await res.json()) as {
        downloadUrl: string;
        generatedAt: string;
      };
      setDownloadUrl(data.downloadUrl);
      setGeneratedAt(data.generatedAt);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  const rangeLabel = (() => {
    try {
      const s = new Date(startDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const e = new Date(endDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      return `${s} - ${e}`;
    } catch {
      return "";
    }
  })();

  return (
    <div className="min-h-screen space-y-6 bg-[#EEF2F7] p-6">
      <PageHeader
        title="Board Reports"
        description="Generate a PDF board report with AI-written executive summary, pipeline status, financials, and recommendations."
      />

      {/* Report category cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {REPORT_CATEGORIES.map((category) => (
          <ReportCategoryCard key={category.key} category={category} />
        ))}
      </div>

      {/* Detailed reports */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Detailed Reports</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {DETAILED_REPORTS.map((report) => (
            <DetailedReportCard key={report.key} report={report} />
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-2xl">
        {/* Date range form */}
        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-[#0077B6]" />
            <h2 className="text-sm font-semibold text-slate-700">Report Period</h2>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="start_date"
                className="mb-1 block text-xs font-medium text-slate-600"
              >
                Start Date
              </label>
              <input
                id="start_date"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setError(null);
                  setDownloadUrl(null);
                }}
                max={endDate}
                disabled={loading}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-[#0077B6] focus:outline-none focus:ring-1 focus:ring-[#0077B6] disabled:opacity-50"
              />
            </div>
            <div>
              <label
                htmlFor="end_date"
                className="mb-1 block text-xs font-medium text-slate-600"
              >
                End Date
              </label>
              <input
                id="end_date"
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setError(null);
                  setDownloadUrl(null);
                }}
                min={startDate}
                disabled={loading}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-[#0077B6] focus:outline-none focus:ring-1 focus:ring-[#0077B6] disabled:opacity-50"
              />
            </div>
          </div>

          {rangeLabel && (
            <p className="mb-5 text-xs text-slate-400">{rangeLabel}</p>
          )}

          <button
            onClick={handleGenerate}
            disabled={loading || !startDate || !endDate}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#0077B6] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#005F92] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating Report...
              </>
            ) : (
              <>
                <FileBarChart2 className="h-4 w-4" />
                Generate Board Report
              </>
            )}
          </button>

          {loading && (
            <p className="mt-3 text-center text-xs text-slate-400">
              Aggregating data, generating AI narrative, and building PDF - this
              takes 20-40 seconds.
            </p>
          )}
        </div>

        {/* Error state */}
        {error && (
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
            <div>
              <p className="text-sm font-medium text-red-700">
                Report generation failed
              </p>
              <p className="mt-0.5 text-xs text-red-600">{error}</p>
            </div>
          </div>
        )}

        {/* Success state */}
        {downloadUrl && (
          <div className="mt-4 rounded-xl border border-teal-200 bg-teal-50 p-5">
            <div className="mb-3 flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-teal-600" />
              <p className="text-sm font-semibold text-teal-800">
                Report ready
                {generatedAt ? ` - generated ${generatedAt}` : ""}
              </p>
            </div>
            <p className="mb-4 text-xs text-teal-700">
              Your board report PDF includes an AI-generated executive summary,
              pipeline snapshot, financial overview, agent performance summary,
              and strategic recommendations.
            </p>
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              download
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-surface px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-[#0077B6] hover:text-[#0077B6]"
            >
              <Download className="h-4 w-4" />
              Download PDF
            </a>
            <p className="mt-2 text-xs text-teal-600">
              Download link expires in 1 hour.
            </p>
          </div>
        )}
      </div>

      <div className="mx-auto max-w-2xl">
        {/* Board Report summary */}
        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-2">
            <FileBarChart2 className="h-4 w-4 text-[#0077B6]" />
            <h2 className="text-sm font-semibold text-slate-700">
              Board Report Summary
            </h2>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="summary_start_date"
                className="mb-1 block text-xs font-medium text-slate-600"
              >
                Start Date
              </label>
              <input
                id="summary_start_date"
                type="date"
                value={summaryStartDate}
                onChange={(e) => {
                  setSummaryStartDate(e.target.value);
                  setSummaryError(null);
                  setSummary(null);
                }}
                max={summaryEndDate}
                disabled={summaryLoading}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-[#0077B6] focus:outline-none focus:ring-1 focus:ring-[#0077B6] disabled:opacity-50"
              />
            </div>
            <div>
              <label
                htmlFor="summary_end_date"
                className="mb-1 block text-xs font-medium text-slate-600"
              >
                End Date
              </label>
              <input
                id="summary_end_date"
                type="date"
                value={summaryEndDate}
                onChange={(e) => {
                  setSummaryEndDate(e.target.value);
                  setSummaryError(null);
                  setSummary(null);
                }}
                min={summaryStartDate}
                disabled={summaryLoading}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-[#0077B6] focus:outline-none focus:ring-1 focus:ring-[#0077B6] disabled:opacity-50"
              />
            </div>
          </div>

          <button
            onClick={handleGenerateSummary}
            disabled={summaryLoading || !summaryStartDate || !summaryEndDate}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#0077B6] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#005F92] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {summaryLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating Summary...
              </>
            ) : (
              <>
                <FileBarChart2 className="h-4 w-4" />
                Generate Board Report
              </>
            )}
          </button>
        </div>

        {/* Summary error state */}
        {summaryError && (
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
            <div>
              <p className="text-sm font-medium text-red-700">
                Summary generation failed
              </p>
              <p className="mt-0.5 text-xs text-red-600">{summaryError}</p>
            </div>
          </div>
        )}

        {/* Summary result */}
        {summary && (
          <div className="mt-4 space-y-4 print:space-y-3">
            <div className="flex items-center justify-end print:hidden">
              <button
                onClick={handlePrint}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-surface px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-[#0077B6] hover:text-[#0077B6]"
              >
                <Printer className="h-4 w-4" />
                Print / Export
              </button>
            </div>

            <div className="rounded-xl border border-border bg-surface p-5">
              <p className="text-sm leading-relaxed text-slate-600">
                {summary.narrativeSummary}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-border bg-surface p-4 text-center">
                <p className="text-2xl font-semibold text-slate-900">
                  {summary.opportunitiesCreated}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Opportunities Created
                </p>
              </div>
              <div className="rounded-xl border border-border bg-surface p-4 text-center">
                <p className="text-2xl font-semibold text-slate-900">
                  {summary.applicationsSubmitted}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Applications Submitted
                </p>
              </div>
              <div className="rounded-xl border border-border bg-surface p-4 text-center">
                <p className="text-2xl font-semibold text-teal-600">
                  {formatCurrency(summary.totalAwarded)}
                </p>
                <p className="mt-1 text-xs text-slate-500">Total Awarded</p>
              </div>
              <div className="rounded-xl border border-border bg-surface p-4 text-center">
                <p className="text-2xl font-semibold text-slate-900">
                  {Math.round(summary.successRate * 100)}%
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Success Rate ({summary.outcomesAwarded}/{summary.outcomesRecorded})
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface p-5">
              <div className="mb-3 flex items-center gap-2">
                <Trophy className="h-4 w-4 text-amber-500" />
                <h3 className="text-sm font-semibold text-slate-700">
                  Top 5 Funders by Application Count
                </h3>
              </div>
              {summary.topFunders.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs text-slate-400">
                      <th className="pb-2 font-medium">#</th>
                      <th className="pb-2 font-medium">Funder</th>
                      <th className="pb-2 text-right font-medium">Applications</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {summary.topFunders.map((funder, index) => (
                      <tr key={funder.funderId}>
                        <td className="py-2 text-slate-400">{index + 1}</td>
                        <td className="py-2 text-slate-600">
                          {funder.funderName}
                        </td>
                        <td className="py-2 text-right font-medium text-slate-900">
                          {funder.applicationCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-xs text-slate-400">
                  No funder applications in this period.
                </p>
              )}
            </div>

            <div className="rounded-xl border border-border bg-surface p-5">
              <div className="mb-3 flex items-center gap-2">
                <Clock className="h-4 w-4 text-[#0077B6]" />
                <h3 className="text-sm font-semibold text-slate-700">
                  Upcoming Deadlines (Next 90 Days)
                </h3>
              </div>
              {summary.upcomingDeadlines.length > 0 ? (
                <ul className="space-y-2">
                  {summary.upcomingDeadlines.map((deadline) => (
                    <li
                      key={deadline.opportunityId}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-slate-600">
                        {deadline.name}
                        {deadline.funderName ? ` - ${deadline.funderName}` : ""}
                      </span>
                      <span className="font-medium text-slate-900">
                        {new Date(deadline.deadline).toLocaleDateString(
                          "en-US",
                          { month: "short", day: "numeric", year: "numeric" },
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-400">
                  No upcoming deadlines in the next 90 days.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
