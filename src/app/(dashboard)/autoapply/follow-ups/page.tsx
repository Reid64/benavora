"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  Mail,
  MessageSquare,
  RefreshCw,
  Send,
  TrendingUp,
  X,
} from "lucide-react";

import { Badge, Button } from "@/components/ui";
import type { BadgeColor } from "@/components/ui/Badge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FollowUp {
  id: string;
  submission_id: string;
  organization_id: string;
  funder_id: string;
  sequence_number: number;
  scheduled_at: string;
  sent_at: string | null;
  status: string;
  template_type: string;
  content: string | null;
  response_received: boolean;
  cancel_reason: string | null;
  created_at: string;
  // enriched
  funder_name?: string;
  submission_submitted_at?: string | null;
  submission_status?: string | null;
  submission_confirmation_number?: string | null;
}

interface Stats {
  total_pending: number;
  sent_this_month: number;
  response_rate: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadgeColor(status: string): BadgeColor {
  switch (status) {
    case "pending":
      return "yellow";
    case "sent":
      return "green";
    case "cancelled":
      return "gray";
    case "skipped":
      return "orange";
    default:
      return "gray";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "sent":
      return "Sent";
    case "cancelled":
      return "Cancelled";
    case "skipped":
      return "Skipped";
    default:
      return status;
  }
}

function templateLabel(type: string): string {
  switch (type) {
    case "check_in":
      return "Check-In";
    case "thank_you":
      return "Thank You";
    case "feedback_request":
      return "Feedback Request";
    case "renewal_prep":
      return "Renewal Prep";
    default:
      return type.replace(/_/g, " ");
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function isUpcoming(scheduled_at: string): boolean {
  const d = new Date(scheduled_at);
  const now = new Date();
  const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return d >= now && d <= sevenDays;
}

function isDue(scheduled_at: string): boolean {
  return new Date(scheduled_at) <= new Date();
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function apiPatch(id: string, body: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(`/api/autoapply/follow-ups/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.ok;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FollowUpsPage() {
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  // Row expansion
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Action state
  const [actingId, setActingId] = useState<string | null>(null);
  const [showCancelModal, setShowCancelModal] = useState<{
    id: string;
    cancelAll: boolean;
    funderId: string;
    funderName: string;
  } | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterStatus !== "all") params.set("status", filterStatus);
      if (filterFrom) params.set("from", filterFrom);
      if (filterTo) params.set("to", filterTo);

      const [fuRes, statsRes] = await Promise.all([
        fetch(`/api/autoapply/follow-ups?${params.toString()}`),
        fetch("/api/autoapply/follow-ups/stats"),
      ]);

      if (!fuRes.ok) {
        setError("Failed to load follow-ups.");
        return;
      }

      const fuJson = (await fuRes.json()) as { follow_ups: FollowUp[] };
      setFollowUps(fuJson.follow_ups ?? []);

      if (statsRes.ok) {
        const sJson = (await statsRes.json()) as Stats;
        setStats(sJson);
      }
    } catch {
      setError("Could not reach the server. Please try again.");
    }
  }, [filterStatus, filterFrom, filterTo]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  async function handleSendNow(id: string) {
    setActingId(id);
    const ok = await apiPatch(id, { action: "send_now" });
    if (ok) await load();
    setActingId(null);
  }

  async function handleReschedule(id: string) {
    if (!rescheduleDate) return;
    setActingId(id);
    const ok = await apiPatch(id, { action: "reschedule", scheduled_at: rescheduleDate });
    if (ok) {
      setReschedulingId(null);
      setRescheduleDate("");
      await load();
    }
    setActingId(null);
  }

  async function handleCancelConfirm() {
    if (!showCancelModal) return;
    setActingId(showCancelModal.id);
    const endpoint = showCancelModal.cancelAll
      ? `/api/autoapply/follow-ups/cancel-all/${showCancelModal.funderId}`
      : `/api/autoapply/follow-ups/${showCancelModal.id}`;
    const res = await fetch(endpoint, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "cancel", cancel_reason: cancelReason || "User cancelled" }),
    });
    if (res.ok) await load();
    setShowCancelModal(null);
    setCancelReason("");
    setActingId(null);
  }

  // -------------------------------------------------------------------------
  // Derived data
  // -------------------------------------------------------------------------

  const upcomingFollowUps = followUps.filter(
    (f) => f.status === "pending" && isUpcoming(f.scheduled_at),
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Back nav */}
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
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">Follow-Ups</h1>
          <p className="mt-1 text-sm text-navy-500">
            Manage post-submission follow-up sequences. Send check-ins, thank-yous, and feedback
            requests to funders after AutoApply submissions.
          </p>
        </div>
        <Button variant="secondary" onClick={() => load()}>
          <RefreshCw className="mr-1.5 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={<Clock className="h-5 w-5 text-amber-500" />}
          label="Total Pending"
          value={stats?.total_pending ?? "—"}
          color="amber"
        />
        <StatCard
          icon={<Send className="h-5 w-5 text-teal-500" />}
          label="Sent This Month"
          value={stats?.sent_this_month ?? "—"}
          color="teal"
        />
        <StatCard
          icon={<TrendingUp className="h-5 w-5 text-blue-500" />}
          label="Response Rate"
          value={
            stats?.response_rate != null ? `${Math.round(stats.response_rate * 100)}%` : "—"
          }
          color="blue"
        />
      </div>

      {/* Upcoming section */}
      {upcomingFollowUps.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-amber-600" />
            <h2 className="text-sm font-semibold text-amber-800">
              Due in the Next 7 Days ({upcomingFollowUps.length})
            </h2>
          </div>
          <div className="divide-y divide-amber-100">
            {upcomingFollowUps.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-navy-900">
                    {f.funder_name ?? "Unknown funder"}
                  </p>
                  <p className="text-xs text-navy-500">
                    {templateLabel(f.template_type)} · Seq #{f.sequence_number} ·{" "}
                    {isDue(f.scheduled_at) ? (
                      <span className="font-medium text-red-600">Overdue</span>
                    ) : (
                      formatDate(f.scheduled_at)
                    )}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  isLoading={actingId === f.id}
                  disabled={actingId !== null}
                  onClick={() => handleSendNow(f.id)}
                >
                  <Send className="mr-1 h-3.5 w-3.5" />
                  Send Now
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="sent">Sent</option>
          <option value="cancelled">Cancelled</option>
          <option value="skipped">Skipped</option>
        </select>

        <div className="flex items-center gap-2">
          <label className="text-sm text-navy-500">From</label>
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-navy-500">To</label>
          <input
            type="date"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            className="rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
          />
        </div>
        {(filterStatus !== "all" || filterFrom || filterTo) && (
          <button
            type="button"
            onClick={() => {
              setFilterStatus("all");
              setFilterFrom("");
              setFilterTo("");
            }}
            className="flex items-center gap-1 text-sm text-navy-400 hover:text-navy-700"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-navy-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading follow-ups…
        </div>
      ) : followUps.length === 0 ? (
        <div className="rounded-xl border border-navy-200 bg-white py-14 text-center">
          <MessageSquare className="mx-auto mb-3 h-10 w-10 text-navy-300" />
          <p className="text-sm font-medium text-navy-700">No follow-ups found</p>
          <p className="mt-1 text-xs text-navy-400">
            Follow-ups are auto-generated after AutoApply submissions are completed.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-navy-200 bg-white">
          <table className="min-w-full divide-y divide-navy-100">
            <thead>
              <tr className="bg-navy-50">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                  Funder
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                  Type
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                  Seq
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                  Scheduled
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                  Submitted
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-100">
              {followUps.map((f) => (
                <>
                  <tr
                    key={f.id}
                    className="cursor-pointer hover:bg-navy-50"
                    onClick={() => setExpandedId(expandedId === f.id ? null : f.id)}
                  >
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-navy-900">
                        {f.funder_name ?? "Unknown"}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 text-sm text-navy-700">
                        <Mail className="h-3.5 w-3.5 text-navy-400" />
                        {templateLabel(f.template_type)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-navy-500">#{f.sequence_number}</td>
                    <td className="px-4 py-3 text-sm text-navy-700">
                      <span
                        className={
                          f.status === "pending" && isDue(f.scheduled_at)
                            ? "font-medium text-red-600"
                            : ""
                        }
                      >
                        {formatDate(f.scheduled_at)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={statusBadgeColor(f.status)} withDot>
                        {statusLabel(f.status)}
                      </Badge>
                      {f.response_received && (
                        <Badge color="teal" className="ml-1.5">
                          Response
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-navy-500">
                      {f.submission_submitted_at ? formatDate(f.submission_submitted_at) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className="text-navy-400 hover:text-navy-700"
                        aria-label={expandedId === f.id ? "Collapse row" : "Expand row"}
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedId(expandedId === f.id ? null : f.id);
                        }}
                      >
                        {expandedId === f.id ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>
                    </td>
                  </tr>

                  {expandedId === f.id && (
                    <tr key={`${f.id}-expanded`} className="bg-navy-50/60">
                      <td colSpan={7} className="px-4 pb-4 pt-2">
                        <ExpandedRow
                          followUp={f}
                          actingId={actingId}
                          reschedulingId={reschedulingId}
                          rescheduleDate={rescheduleDate}
                          onSendNow={handleSendNow}
                          onStartReschedule={() => {
                            setReschedulingId(f.id);
                            setRescheduleDate(f.scheduled_at.slice(0, 10));
                          }}
                          onReschedule={handleReschedule}
                          onCancelReschedule={() => {
                            setReschedulingId(null);
                            setRescheduleDate("");
                          }}
                          onRescheduleDateChange={setRescheduleDate}
                          onCancel={() =>
                            setShowCancelModal({
                              id: f.id,
                              cancelAll: false,
                              funderId: f.funder_id,
                              funderName: f.funder_name ?? "this funder",
                            })
                          }
                          onCancelAll={() =>
                            setShowCancelModal({
                              id: f.id,
                              cancelAll: true,
                              funderId: f.funder_id,
                              funderName: f.funder_name ?? "this funder",
                            })
                          }
                        />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Cancel modal */}
      {showCancelModal && (
        <CancelModal
          cancelAll={showCancelModal.cancelAll}
          funderName={showCancelModal.funderName}
          reason={cancelReason}
          onReasonChange={setCancelReason}
          onConfirm={handleCancelConfirm}
          onClose={() => {
            setShowCancelModal(null);
            setCancelReason("");
          }}
          acting={actingId !== null}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  color: "amber" | "teal" | "blue";
}) {
  const bg = {
    amber: "bg-amber-50 border-amber-200",
    teal: "bg-teal-50 border-teal-200",
    blue: "bg-blue-50 border-blue-200",
  }[color];

  return (
    <div className={`rounded-xl border p-4 ${bg}`}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm text-navy-500">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-navy-900">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expanded Row
// ---------------------------------------------------------------------------

function ExpandedRow({
  followUp: f,
  actingId,
  reschedulingId,
  rescheduleDate,
  onSendNow,
  onStartReschedule,
  onReschedule,
  onCancelReschedule,
  onRescheduleDateChange,
  onCancel,
  onCancelAll,
}: {
  followUp: FollowUp;
  actingId: string | null;
  reschedulingId: string | null;
  rescheduleDate: string;
  onSendNow: (id: string) => void;
  onStartReschedule: () => void;
  onReschedule: (id: string) => void;
  onCancelReschedule: () => void;
  onRescheduleDateChange: (v: string) => void;
  onCancel: () => void;
  onCancelAll: () => void;
}) {
  const isPending = f.status === "pending";
  const isThisActing = actingId === f.id;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {/* Content preview */}
      <div className="sm:col-span-2">
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-navy-400">
          Follow-Up Content
        </p>
        {f.content ? (
          <div className="rounded-lg border border-navy-200 bg-white p-3 text-sm leading-relaxed text-navy-700">
            {f.content.length > 600 ? `${f.content.slice(0, 600)}…` : f.content}
          </div>
        ) : (
          <p className="text-xs text-navy-400">Content will be generated when sent.</p>
        )}

        {f.cancel_reason && (
          <p className="mt-2 text-xs text-navy-400">
            Cancel reason: <span className="italic">{f.cancel_reason}</span>
          </p>
        )}
        {f.sent_at && (
          <p className="mt-1.5 text-xs text-navy-400">Sent {formatDate(f.sent_at)}</p>
        )}
        {f.response_received && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-teal-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Response received from funder
          </div>
        )}
      </div>

      {/* Right column: submission details + actions */}
      <div className="flex flex-col gap-4">
        {/* Submission details */}
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-navy-400">
            Linked Submission
          </p>
          <div className="rounded-lg border border-navy-200 bg-white p-3 text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-navy-400">Status</span>
              <span className="font-medium text-navy-700">
                {f.submission_status ?? "—"}
              </span>
            </div>
            {f.submission_submitted_at && (
              <div className="flex justify-between">
                <span className="text-navy-400">Submitted</span>
                <span className="text-navy-700">{formatDate(f.submission_submitted_at)}</span>
              </div>
            )}
            {f.submission_confirmation_number && (
              <div className="flex justify-between">
                <span className="text-navy-400">Confirmation</span>
                <span className="font-mono text-navy-700">
                  {f.submission_confirmation_number}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        {isPending && (
          <div className="flex flex-col gap-2">
            <Button
              size="sm"
              isLoading={isThisActing}
              disabled={actingId !== null}
              onClick={() => onSendNow(f.id)}
            >
              <Send className="mr-1.5 h-3.5 w-3.5" />
              Send Now
            </Button>

            {reschedulingId === f.id ? (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={rescheduleDate}
                  onChange={(e) => onRescheduleDateChange(e.target.value)}
                  className="flex-1 rounded-md border border-navy-200 bg-white px-2 py-1.5 text-xs text-navy-900 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                />
                <button
                  type="button"
                  onClick={() => onReschedule(f.id)}
                  disabled={!rescheduleDate || actingId !== null}
                  className="rounded-md bg-teal-500 px-2 py-1.5 text-xs font-medium text-white hover:bg-teal-600 disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={onCancelReschedule}
                  className="text-navy-400 hover:text-navy-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onStartReschedule}
                disabled={actingId !== null}
                className="flex items-center justify-center gap-1.5 rounded-md border border-navy-200 bg-white px-3 py-1.5 text-xs text-navy-700 hover:bg-navy-50 disabled:opacity-50"
              >
                <Calendar className="h-3.5 w-3.5" />
                Reschedule
              </button>
            )}

            <button
              type="button"
              onClick={onCancel}
              disabled={actingId !== null}
              className="flex items-center justify-center gap-1.5 rounded-md border border-red-100 bg-red-50 px-3 py-1.5 text-xs text-red-600 hover:bg-red-100 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
              Cancel This
            </button>

            <button
              type="button"
              onClick={onCancelAll}
              disabled={actingId !== null}
              className="flex items-center justify-center gap-1.5 rounded-md border border-red-100 bg-red-50 px-3 py-1.5 text-xs text-red-600 hover:bg-red-100 disabled:opacity-50"
            >
              <X className="h-3.5 w-3.5" />
              Cancel All for Funder
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cancel Modal
// ---------------------------------------------------------------------------

function CancelModal({
  cancelAll,
  funderName,
  reason,
  onReasonChange,
  onConfirm,
  onClose,
  acting,
}: {
  cancelAll: boolean;
  funderName: string;
  reason: string;
  onReasonChange: (v: string) => void;
  onConfirm: () => void;
  onClose: () => void;
  acting: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between">
          <h2 className="text-base font-semibold text-navy-900">
            {cancelAll ? `Cancel All Follow-Ups for ${funderName}` : "Cancel Follow-Up"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-4 rounded p-1 text-navy-400 hover:bg-navy-100 hover:text-navy-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-2 text-sm text-navy-500">
          {cancelAll
            ? `This will cancel all pending follow-ups in the sequence for ${funderName}.`
            : "This will cancel this follow-up. Other items in the sequence are unaffected."}
        </p>

        <div className="mt-4">
          <label className="block text-sm font-medium text-navy-700">
            Reason (optional)
          </label>
          <textarea
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            rows={2}
            placeholder="e.g. Funder contacted us directly"
            className="mt-1.5 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
          />
        </div>

        <div className="mt-4 flex items-center justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={acting}>
            Keep
          </Button>
          <Button variant="danger" onClick={onConfirm} isLoading={acting} disabled={acting}>
            {cancelAll ? "Cancel All" : "Cancel Follow-Up"}
          </Button>
        </div>
      </div>
    </div>
  );
}
