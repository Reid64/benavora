"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, FileSearch, X } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import type { BadgeColor } from "@/components/ui/Badge";
import { Button, Card, EmptyState } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

interface SubmissionRow {
  id: string;
  funder_id: string | null;
  status: string;
  request_description: string | null;
  request_type: string | null;
  request_amount: number | null;
  pre_submit_screenshot_url: string | null;
  confirmation_screenshot_url: string | null;
  error_screenshot_url: string | null;
  confirmation_number: string | null;
  error_message: string | null;
  retry_count: number;
  submitted_at: string | null;
  created_at: string;
  funders: { name: string } | null;
}

const STATUS_OPTIONS = [
  "all",
  "submitted",
  "in_progress",
  "failed",
  "captcha_blocked",
  "account_required",
  "site_error",
  "already_submitted",
  "queued",
];

function statusBadge(status: string): { color: BadgeColor; label: string } {
  switch (status) {
    case "submitted":
      return { color: "green", label: "Submitted" };
    case "in_progress":
      return { color: "blue", label: "In Progress" };
    case "failed":
      return { color: "red", label: "Failed" };
    case "captcha_blocked":
      return { color: "yellow", label: "CAPTCHA Blocked" };
    case "account_required":
      return { color: "orange", label: "Account Required" };
    case "site_error":
      return { color: "red", label: "Site Error" };
    case "already_submitted":
      return { color: "teal", label: "Already Submitted" };
    case "queued":
      return { color: "gray", label: "Queued" };
    default:
      return { color: "gray", label: status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ") };
  }
}

const PAGE_SIZE = 25;

export function SubmissionHistory() {
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [screenshotLabel, setScreenshotLabel] = useState<string>("");

  const load = useCallback(async (filter: string, pageIndex: number) => {
    setLoading(true);
    const supabase = createClient();
    try {
      let query = supabase
        .from("autoapply_submissions")
        .select("*, funders(name)", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE - 1);

      if (filter !== "all") {
        query = query.eq("status", filter);
      }

      const { data, error: err, count } = await query;
      if (err) throw err;
      setSubmissions((data ?? []) as unknown as SubmissionRow[]);
      setTotal(count ?? 0);
      setError(null);
    } catch {
      setError("Could not load submission history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setPage(0);
    void load(statusFilter, 0);
  }, [statusFilter, load]);

  function handlePageChange(next: number) {
    setPage(next);
    void load(statusFilter, next);
  }

  function openScreenshot(url: string, label: string) {
    setScreenshotUrl(url);
    setScreenshotLabel(label);
  }

  function closeScreenshot() {
    setScreenshotUrl(null);
    setScreenshotLabel("");
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE + PAGE_SIZE, total);

  return (
    <>
      {/* Screenshot modal */}
      {screenshotUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={screenshotLabel}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={closeScreenshot}
        >
          <div
            className="relative max-h-[90vh] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeScreenshot}
              aria-label="Close screenshot"
              className="absolute -right-3 -top-3 flex h-7 w-7 items-center justify-center rounded-full bg-navy-800 text-navy-200 shadow hover:bg-navy-700"
            >
              <X className="h-4 w-4" />
            </button>
            <p className="mb-2 text-center text-xs font-medium uppercase tracking-wide text-navy-300">
              {screenshotLabel}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element -- remote Supabase storage URL, dimensions unknown; next/image needs remotePatterns config */}
            <img
              src={screenshotUrl}
              alt={screenshotLabel}
              className="max-h-[85vh] max-w-full rounded-lg object-contain shadow-xl"
            />
          </div>
        </div>
      )}

      <Card
        title="Submission History"
        description="All AutoApply form submission attempts"
        noPadding
        actions={
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-md border border-navy-700 bg-navy-800 px-3 py-1.5 text-xs text-navy-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
            aria-label="Filter by status"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "All statuses" : statusBadge(s).label}
              </option>
            ))}
          </select>
        }
      >
        <div className="overflow-x-auto">
          {error ? (
            <div className="p-5 text-sm text-red-400">{error}</div>
          ) : loading ? (
            <div className="p-5 text-sm text-navy-400">Loading submissions…</div>
          ) : submissions.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={FileSearch}
                title="No submissions found"
                description={
                  statusFilter === "all"
                    ? "Submissions will appear here after AutoApply runs."
                    : `No submissions with status "${statusBadge(statusFilter).label}".`
                }
              />
            </div>
          ) : (
            <>
              <table className="min-w-full divide-y divide-navy-100 text-sm">
                <thead>
                  <tr className="bg-sidebar">
                    <th className="w-8 px-4 py-3" />
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-white">
                      Funder
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-white">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-white">
                      Request Type
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-white">
                      Submitted
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-white">
                      Confirmation #
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-100 bg-white">
                  {submissions.map((sub) => {
                    const { color, label } = statusBadge(sub.status);
                    const isExpanded = expandedId === sub.id;
                    const hasScreenshots =
                      Boolean(sub.pre_submit_screenshot_url) ||
                      Boolean(sub.confirmation_screenshot_url) ||
                      Boolean(sub.error_screenshot_url);
                    const hasDetail =
                      Boolean(sub.request_description) ||
                      Boolean(sub.error_message) ||
                      sub.retry_count > 0 ||
                      hasScreenshots;

                    return (
                      <Fragment key={sub.id}>
                        <tr
                          className={`${hasDetail ? "cursor-pointer" : ""} hover:bg-navy-50`}
                          onClick={() => {
                            if (hasDetail) {
                              setExpandedId(isExpanded ? null : sub.id);
                            }
                          }}
                        >
                          <td className="px-4 py-3">
                            {hasDetail ? (
                              isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-navy-400" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-navy-400" />
                              )
                            ) : null}
                          </td>
                          <td className="px-4 py-3 font-medium text-navy-900">
                            {sub.funders?.name ?? <span className="text-navy-400">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <Badge color={color} withDot>
                              {label}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 capitalize text-navy-600">
                            {sub.request_type?.replace(/_/g, " ") ?? (
                              <span className="text-navy-400">—</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-navy-400">
                            {sub.submitted_at
                              ? new Date(sub.submitted_at).toLocaleString()
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-navy-600">
                            {sub.confirmation_number ?? (
                              <span className="text-navy-400">—</span>
                            )}
                          </td>
                        </tr>

                        {isExpanded && hasDetail && (
                          <tr className="bg-navy-50">
                            <td colSpan={6} className="px-6 py-5">
                              <div className="space-y-4">
                                {sub.request_description && (
                                  <div>
                                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-navy-500">
                                      Request Description
                                    </p>
                                    <p className="text-sm text-navy-700">
                                      {sub.request_description}
                                    </p>
                                  </div>
                                )}

                                {sub.error_message && (
                                  <div>
                                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-red-500">
                                      Error
                                    </p>
                                    <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
                                      {sub.error_message}
                                    </p>
                                  </div>
                                )}

                                {sub.retry_count > 0 && (
                                  <div>
                                    <p className="text-xs text-navy-500">
                                      <span className="font-semibold">Retry attempts:</span>{" "}
                                      {sub.retry_count}
                                    </p>
                                  </div>
                                )}

                                {hasScreenshots && (
                                  <div className="flex flex-wrap gap-5">
                                    {sub.pre_submit_screenshot_url && (
                                      <ScreenshotThumb
                                        url={sub.pre_submit_screenshot_url}
                                        label="Pre-Submit Screenshot"
                                        onOpen={openScreenshot}
                                      />
                                    )}
                                    {sub.confirmation_screenshot_url && (
                                      <ScreenshotThumb
                                        url={sub.confirmation_screenshot_url}
                                        label="Confirmation Screenshot"
                                        onOpen={openScreenshot}
                                      />
                                    )}
                                    {sub.error_screenshot_url && (
                                      <ScreenshotThumb
                                        url={sub.error_screenshot_url}
                                        label="Error Screenshot"
                                        onOpen={openScreenshot}
                                      />
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-navy-100 px-5 py-3">
                  <p className="text-xs text-navy-500">
                    {from}–{to} of {total}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handlePageChange(page - 1)}
                      disabled={page === 0}
                    >
                      Previous
                    </Button>
                    <span className="text-xs text-navy-400">
                      Page {page + 1} of {totalPages}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handlePageChange(page + 1)}
                      disabled={page >= totalPages - 1}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </Card>
    </>
  );
}

function ScreenshotThumb({
  url,
  label,
  onOpen,
}: {
  url: string;
  label: string;
  onOpen: (url: string, label: string) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-navy-500">
        {label}
      </p>
      <button
        type="button"
        onClick={() => onOpen(url, label)}
        aria-label={`View full-size ${label}`}
        className="block rounded-lg border border-navy-200 shadow-sm transition hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-teal-500"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- remote Supabase storage URL, dimensions unknown; next/image needs remotePatterns config */}
        <img
          src={url}
          alt={label}
          className="h-40 w-auto rounded-lg object-cover"
        />
      </button>
    </div>
  );
}
