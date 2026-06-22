"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Eye,
  RefreshCw,
  Send,
  Settings,
  XCircle,
  Zap,
} from "lucide-react";

import { Badge, Button, Card, LoadingSpinner, Modal, Select } from "@/components/ui";
import { humanizeEnum } from "@/lib/utils/formatters";

// ── Types ──────────────────────────────────────────────────────────────────

type DraftQueueStatus =
  | "pending"
  | "generating"
  | "generated"
  | "review"
  | "approved"
  | "rejected"
  | "submitted"
  | "failed";

type QueueItem = {
  id: string;
  opportunity_id: string;
  status: DraftQueueStatus | null;
  template_type: string;
  priority: number | null;
  confidence_score: number | null;
  gap_count: number | null;
  deadline_date: string | null;
  error_message: string | null;
  retry_count: number | null;
  opportunity?: {
    id: string;
    name: string;
    deadline: string | null;
    funder?: { id: string; name: string } | null;
  } | null;
};

type QueueStats = {
  pending?: number;
  generating?: number;
  generated?: number;
  in_review?: number;
  approved?: number;
  rejected?: number;
  submitted?: number;
  failed?: number;
  avg_confidence?: number | null;
  total?: number;
};

type AutomationConfig = {
  is_enabled: boolean | null;
  min_eligibility_score: number | null;
  auto_generate_on_discovery: boolean | null;
  auto_generate_on_deadline_days: number | null;
  daily_draft_limit: number | null;
  require_approval_before_submit: boolean | null;
  auto_submit_above_confidence: number | null;
};

// ── Constants ──────────────────────────────────────────────────────────────

const PRIORITY_BADGE: Record<
  number,
  { label: string; color: "red" | "orange" | "yellow" | "teal" | "gray" }
> = {
  1: { label: "P1", color: "red" },
  2: { label: "P2", color: "orange" },
  3: { label: "P3", color: "yellow" },
  4: { label: "P4", color: "teal" },
  5: { label: "P5", color: "gray" },
};

const STATUS_BADGE: Record<
  DraftQueueStatus,
  { label: string; color: "gray" | "teal" | "navy" | "green" | "yellow" | "red" | "purple" | "orange" }
> = {
  pending: { label: "Pending", color: "gray" },
  generating: { label: "Generating", color: "teal" },
  generated: { label: "Generated", color: "navy" },
  review: { label: "In Review", color: "yellow" },
  approved: { label: "Approved", color: "green" },
  rejected: { label: "Rejected", color: "red" },
  submitted: { label: "Submitted", color: "purple" },
  failed: { label: "Failed", color: "orange" },
};

const SORT_OPTIONS = [
  { value: "priority", label: "Priority" },
  { value: "deadline", label: "Deadline" },
  { value: "created", label: "Created" },
];

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "generating", label: "Generating" },
  { value: "generated", label: "Generated" },
  { value: "review", label: "In Review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "submitted", label: "Submitted" },
  { value: "failed", label: "Failed" },
];

const PRIORITY_FILTER_OPTIONS = [
  { value: "", label: "All priorities" },
  { value: "1", label: "P1 – Critical" },
  { value: "2", label: "P2 – High" },
  { value: "3", label: "P3 – Medium" },
  { value: "4", label: "P4 – Low" },
  { value: "5", label: "P5 – Minimal" },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function deadlineDisplay(
  dateStr: string | null,
): { label: string; colorClass: string } {
  if (!dateStr) return { label: "—", colorClass: "text-navy-400" };
  const d = new Date(dateStr);
  const days = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const label = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  if (days < 0) return { label, colorClass: "text-red-400" };
  if (days <= 7) return { label, colorClass: "text-red-400" };
  if (days <= 14) return { label, colorClass: "text-amber-400" };
  return { label, colorClass: "text-navy-300" };
}

function confidenceColor(
  score: number | null,
): "green" | "yellow" | "red" | "gray" {
  if (score == null) return "gray";
  if (score >= 75) return "green";
  if (score >= 55) return "yellow";
  return "red";
}

// ── Component ──────────────────────────────────────────────────────────────

export default function DraftQueuePage() {
  const router = useRouter();

  const [items, setItems] = useState<QueueItem[]>([]);
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [config, setConfig] = useState<AutomationConfig | null>(null);

  const [loadingItems, setLoadingItems] = useState(true);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [generatingNow, setGeneratingNow] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [actionItemId, setActionItemId] = useState<string | null>(null);
  const [bulkActing, setBulkActing] = useState(false);

  const [sortBy, setSortBy] = useState("priority");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterPriority, setFilterPriority] = useState("");

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [rejectModal, setRejectModal] = useState<{
    id: string;
    bulk: boolean;
  } | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Config form state mirrors the loaded config
  const [configForm, setConfigForm] = useState<AutomationConfig>({
    is_enabled: false,
    min_eligibility_score: 70,
    auto_generate_on_discovery: false,
    auto_generate_on_deadline_days: 14,
    daily_draft_limit: 10,
    require_approval_before_submit: true,
    auto_submit_above_confidence: null,
  });

  // ── Data loading ───────────────────────────────────────────────────────

  const loadStats = useCallback(async () => {
    setLoadingStats(true);
    try {
      const res = await fetch("/api/drafts/queue/stats");
      if (res.ok) {
        const json = (await res.json()) as { stats: QueueStats };
        setStats(json.stats);
      }
    } finally {
      setLoadingStats(false);
    }
  }, []);

  const loadItems = useCallback(async () => {
    setLoadingItems(true);
    try {
      const params = new URLSearchParams({ sort: sortBy, limit: "100" });
      if (filterStatus) params.set("status", filterStatus);
      if (filterPriority) params.set("priority", filterPriority);
      const res = await fetch(`/api/drafts/queue?${params.toString()}`);
      if (res.ok) {
        const json = (await res.json()) as { items: QueueItem[] };
        setItems(json.items ?? []);
      }
    } finally {
      setLoadingItems(false);
    }
  }, [sortBy, filterStatus, filterPriority]);

  const loadConfig = useCallback(async () => {
    setLoadingConfig(true);
    try {
      const res = await fetch("/api/drafts/queue/config");
      if (res.ok) {
        const json = (await res.json()) as { config: AutomationConfig };
        setConfig(json.config);
        setConfigForm({
          is_enabled: json.config.is_enabled,
          min_eligibility_score: json.config.min_eligibility_score,
          auto_generate_on_discovery: json.config.auto_generate_on_discovery,
          auto_generate_on_deadline_days:
            json.config.auto_generate_on_deadline_days,
          daily_draft_limit: json.config.daily_draft_limit,
          require_approval_before_submit:
            json.config.require_approval_before_submit,
          auto_submit_above_confidence:
            json.config.auto_submit_above_confidence,
        });
      }
    } finally {
      setLoadingConfig(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
    void loadConfig();
  }, [loadStats, loadConfig]);

  useEffect(() => {
    void loadItems();
    setSelected(new Set());
  }, [loadItems]);

  // ── Actions ────────────────────────────────────────────────────────────

  function flash(msg: string) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 3500);
  }

  async function callAction(
    id: string,
    body: Record<string, unknown>,
  ): Promise<boolean> {
    const res = await fetch(`/api/drafts/queue/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = (await res.json()) as { error?: string };
      setError(j.error ?? "Action failed.");
      return false;
    }
    const j = (await res.json()) as { item: QueueItem };
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...j.item } : i)));
    return true;
  }

  async function handleApprove(id: string) {
    setActionItemId(id);
    setError(null);
    const ok = await callAction(id, { action: "approve" });
    if (ok) flash("Draft approved.");
    setActionItemId(null);
    await loadStats();
  }

  async function handleReject(id: string, reason: string) {
    setActionItemId(id);
    setError(null);
    const ok = await callAction(id, { action: "reject", reason });
    if (ok) flash("Draft rejected.");
    setActionItemId(null);
    setRejectModal(null);
    setRejectReason("");
    await loadStats();
  }

  async function handleRetry(id: string) {
    setActionItemId(id);
    setError(null);
    const ok = await callAction(id, { action: "retry" });
    if (ok) flash("Queued for retry.");
    setActionItemId(null);
    await loadStats();
  }

  async function handleSubmit(id: string) {
    setActionItemId(id);
    setError(null);
    const ok = await callAction(id, { action: "submit" });
    if (ok) flash("Submitted to AutoApply.");
    setActionItemId(null);
    await loadStats();
  }

  async function handlePriority(id: string, current: number | null, delta: number) {
    const next = Math.min(5, Math.max(1, (current ?? 3) + delta));
    setActionItemId(id);
    setError(null);
    await callAction(id, { action: "prioritize", priority: next });
    setActionItemId(null);
  }

  // Bulk actions
  async function handleBulkApprove() {
    setBulkActing(true);
    setError(null);
    const ids = Array.from(selected);
    await Promise.all(ids.map((id) => callAction(id, { action: "approve" })));
    flash(`${ids.length} draft${ids.length !== 1 ? "s" : ""} approved.`);
    setSelected(new Set());
    setBulkActing(false);
    await loadStats();
  }

  async function handleBulkReject(reason: string) {
    setBulkActing(true);
    setError(null);
    const ids = Array.from(selected);
    await Promise.all(ids.map((id) => callAction(id, { action: "reject", reason })));
    flash(`${ids.length} draft${ids.length !== 1 ? "s" : ""} rejected.`);
    setSelected(new Set());
    setBulkActing(false);
    setRejectModal(null);
    setRejectReason("");
    await loadStats();
  }

  async function handleBulkSubmit() {
    setBulkActing(true);
    setError(null);
    const ids = Array.from(selected);
    await Promise.all(ids.map((id) => callAction(id, { action: "submit" })));
    flash(`${ids.length} draft${ids.length !== 1 ? "s" : ""} submitted to AutoApply.`);
    setSelected(new Set());
    setBulkActing(false);
    await loadStats();
  }

  async function handleGenerateNow() {
    setGeneratingNow(true);
    setError(null);
    try {
      const res = await fetch("/api/drafts/queue/trigger", { method: "POST" });
      if (res.ok) {
        flash("Processing started for pending items.");
        await loadItems();
        await loadStats();
      } else {
        const j = (await res.json()) as { error?: string };
        setError(j.error ?? "Could not trigger generation.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setGeneratingNow(false);
    }
  }

  async function handleConfigSave() {
    setSavingConfig(true);
    setError(null);
    try {
      const res = await fetch("/api/drafts/queue/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_enabled: configForm.is_enabled,
          min_eligibility_score: configForm.min_eligibility_score,
          auto_generate_on_discovery: configForm.auto_generate_on_discovery,
          auto_generate_on_deadline_days:
            configForm.auto_generate_on_deadline_days,
          daily_draft_limit: configForm.daily_draft_limit,
          require_approval_before_submit:
            configForm.require_approval_before_submit,
          auto_submit_above_confidence: configForm.require_approval_before_submit
            ? null
            : configForm.auto_submit_above_confidence,
        }),
      });
      if (res.ok) {
        const j = (await res.json()) as { config: AutomationConfig };
        setConfig(j.config);
        flash("Automation settings saved.");
      } else {
        const j = (await res.json()) as { error?: string };
        setError(j.error ?? "Failed to save settings.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSavingConfig(false);
    }
  }

  // ── Selection helpers ──────────────────────────────────────────────────

  function toggleAll() {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.id)));
    }
  }

  function toggleItem(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Derived ────────────────────────────────────────────────────────────

  const pendingCount = (stats?.pending ?? 0) + (stats?.generating ?? 0);
  const readyCount = (stats?.generated ?? 0) + (stats?.in_review ?? 0);
  const approvedCount = stats?.approved ?? 0;
  const submittedCount = stats?.submitted ?? 0;
  const avgConf = stats?.avg_confidence ?? null;

  const hasSelection = selected.size > 0;

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
            Draft Queue
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Morning workbench — review auto-generated drafts before they go to
            AutoApply.
          </p>
        </div>
        <Button
          onClick={handleGenerateNow}
          isLoading={generatingNow}
          disabled={generatingNow}
        >
          <Zap className="h-4 w-4" aria-hidden />
          Generate Now
        </Button>
      </div>

      {/* Alerts */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {error}
        </div>
      )}
      {successMsg && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700"
        >
          <CheckCircle className="h-4 w-4 shrink-0" aria-hidden />
          {successMsg}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <StatCard
          label="Pending Generation"
          value={loadingStats ? null : pendingCount}
          color="gray"
        />
        <StatCard
          label="Ready for Review"
          value={loadingStats ? null : readyCount}
          color="navy"
        />
        <StatCard
          label="Approved"
          value={loadingStats ? null : approvedCount}
          color="green"
        />
        <StatCard
          label="Submitted"
          value={loadingStats ? null : submittedCount}
          color="teal"
        />
        <StatCard
          label="Avg Confidence"
          value={loadingStats ? null : avgConf != null ? `${Math.round(avgConf)}/100` : "—"}
          color={
            avgConf == null ? "gray" : avgConf >= 75 ? "green" : avgConf >= 55 ? "yellow" : "red"
          }
        />
      </div>

      {/* Table section */}
      <Card
        title="Queue"
        actions={
          <div className="flex items-center gap-2">
            <Select
              options={STATUS_FILTER_OPTIONS}
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              aria-label="Filter by status"
            />
            <Select
              options={PRIORITY_FILTER_OPTIONS}
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              aria-label="Filter by priority"
            />
            <Select
              options={SORT_OPTIONS}
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              aria-label="Sort by"
            />
            <button
              type="button"
              onClick={() => { void loadItems(); void loadStats(); }}
              className="rounded-lg p-2 text-navy-400 transition hover:bg-navy-100 hover:text-navy-700"
              title="Refresh"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
            </button>
          </div>
        }
      >
        {/* Bulk actions bar */}
        {hasSelection && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-navy-200 bg-navy-50 px-3 py-2">
            <span className="text-sm font-medium text-navy-700">
              {selected.size} selected
            </span>
            <div className="ml-auto flex gap-2">
              <Button
                variant="secondary"
                onClick={handleBulkApprove}
                isLoading={bulkActing}
                disabled={bulkActing}
              >
                <CheckCircle className="h-3.5 w-3.5" aria-hidden />
                Approve Selected
              </Button>
              <Button
                variant="secondary"
                onClick={() => setRejectModal({ id: "", bulk: true })}
                disabled={bulkActing}
              >
                <XCircle className="h-3.5 w-3.5" aria-hidden />
                Reject Selected
              </Button>
              <Button
                variant="secondary"
                onClick={handleBulkSubmit}
                isLoading={bulkActing}
                disabled={bulkActing}
              >
                <Send className="h-3.5 w-3.5" aria-hidden />
                Submit to AutoApply
              </Button>
            </div>
          </div>
        )}

        {loadingItems ? (
          <LoadingSpinner center label="Loading queue..." />
        ) : items.length === 0 ? (
          <div className="py-12 text-center text-sm text-navy-500">
            No items match the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy-100 text-left text-xs font-medium uppercase tracking-wide text-navy-400">
                  <th className="pb-2 pr-3">
                    <input
                      type="checkbox"
                      checked={selected.size === items.length && items.length > 0}
                      onChange={toggleAll}
                      aria-label="Select all"
                      className="rounded border-navy-300"
                    />
                  </th>
                  <th className="pb-2 pr-3">Priority</th>
                  <th className="pb-2 pr-3">Opportunity</th>
                  <th className="pb-2 pr-3">Funder</th>
                  <th className="pb-2 pr-3">Template</th>
                  <th className="pb-2 pr-3">Deadline</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2 pr-3">Confidence</th>
                  <th className="pb-2 pr-3">Gaps</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-50">
                {items.map((item) => {
                  const pri = item.priority ?? 5;
                  const pBadge = PRIORITY_BADGE[pri] ?? { label: `P${pri}`, color: "gray" as const };
                  const st = item.status ?? "pending";
                  const sBadge = STATUS_BADGE[st] ?? { label: humanizeEnum(st), color: "gray" as const };
                  const dl = deadlineDisplay(item.deadline_date);
                  const isActing = actionItemId === item.id;

                  return (
                    <tr
                      key={item.id}
                      className="group transition hover:bg-navy-50/50"
                    >
                      <td className="py-2.5 pr-3">
                        <input
                          type="checkbox"
                          checked={selected.has(item.id)}
                          onChange={() => toggleItem(item.id)}
                          aria-label={`Select ${item.opportunity?.name ?? item.id}`}
                          className="rounded border-navy-300"
                        />
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-1">
                          <Badge color={pBadge.color}>{pBadge.label}</Badge>
                          <div className="flex flex-col">
                            <button
                              type="button"
                              onClick={() => handlePriority(item.id, item.priority, -1)}
                              disabled={isActing || pri <= 1}
                              aria-label="Increase priority"
                              className="text-navy-400 hover:text-navy-600 disabled:opacity-30"
                            >
                              <ChevronUp className="h-3 w-3" aria-hidden />
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePriority(item.id, item.priority, 1)}
                              disabled={isActing || pri >= 5}
                              aria-label="Decrease priority"
                              className="text-navy-400 hover:text-navy-600 disabled:opacity-30"
                            >
                              <ChevronDown className="h-3 w-3" aria-hidden />
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <button
                          type="button"
                          onClick={() =>
                            router.push(
                              `/draft-generator?opportunity=${item.opportunity_id}`,
                            )
                          }
                          className="text-left font-medium text-navy-900 hover:text-teal-700 hover:underline"
                        >
                          {item.opportunity?.name ?? "—"}
                        </button>
                      </td>
                      <td className="py-2.5 pr-3 text-navy-500">
                        {item.opportunity?.funder?.name ?? "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-navy-500">
                        {humanizeEnum(item.template_type)}
                      </td>
                      <td className={`py-2.5 pr-3 ${dl.colorClass}`}>
                        {dl.label}
                      </td>
                      <td className="py-2.5 pr-3">
                        <Badge color={sBadge.color}>{sBadge.label}</Badge>
                      </td>
                      <td className="py-2.5 pr-3">
                        {item.confidence_score != null ? (
                          <Badge color={confidenceColor(item.confidence_score)}>
                            {item.confidence_score}/100
                          </Badge>
                        ) : (
                          <span className="text-navy-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-navy-500">
                        {item.gap_count != null ? item.gap_count : "—"}
                      </td>
                      <td className="py-2.5">
                        <div className="flex items-center gap-1.5">
                          {(st === "generated" || st === "review") && (
                            <ActionButton
                              icon={<Eye className="h-3.5 w-3.5" aria-hidden />}
                              label="Review"
                              color="blue"
                              disabled={isActing}
                              onClick={() =>
                                router.push(
                                  `/draft-generator?opportunity=${item.opportunity_id}`,
                                )
                              }
                            />
                          )}
                          {(st === "generated" || st === "review") && (
                            <ActionButton
                              icon={<CheckCircle className="h-3.5 w-3.5" aria-hidden />}
                              label="Approve"
                              color="green"
                              disabled={isActing}
                              onClick={() => handleApprove(item.id)}
                            />
                          )}
                          {(st === "generated" || st === "review" || st === "approved") && (
                            <ActionButton
                              icon={<XCircle className="h-3.5 w-3.5" aria-hidden />}
                              label="Reject"
                              color="red"
                              disabled={isActing}
                              onClick={() => {
                                setRejectModal({ id: item.id, bulk: false });
                                setRejectReason("");
                              }}
                            />
                          )}
                          {st === "approved" && (
                            <ActionButton
                              icon={<Send className="h-3.5 w-3.5" aria-hidden />}
                              label="Submit"
                              color="teal"
                              disabled={isActing}
                              onClick={() => handleSubmit(item.id)}
                            />
                          )}
                          {st === "failed" && (
                            <ActionButton
                              icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
                              label="Retry"
                              color="orange"
                              disabled={isActing}
                              onClick={() => handleRetry(item.id)}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Automation settings */}
      <Card
        title="Automation Settings"
        description="Control how the draft automation engine discovers and generates application drafts."
        actions={
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-navy-400" aria-hidden />
          </div>
        }
      >
        {loadingConfig ? (
          <LoadingSpinner center label="Loading settings..." />
        ) : (
          <div className="space-y-5">
            {/* Enable toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-navy-900">
                  Enable auto-drafting
                </p>
                <p className="text-xs text-navy-500">
                  Automatically generate drafts when opportunities meet the
                  eligibility threshold.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={configForm.is_enabled ?? false}
                onClick={() =>
                  setConfigForm((f) => ({ ...f, is_enabled: !(f.is_enabled ?? false) }))
                }
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  configForm.is_enabled
                    ? "bg-teal-500"
                    : "bg-navy-200"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    configForm.is_enabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {/* Min eligibility score */}
              <div>
                <label
                  htmlFor="min-eligibility"
                  className="block text-sm font-medium text-navy-700"
                >
                  Min eligibility score:{" "}
                  <span className="font-semibold text-navy-900">
                    {configForm.min_eligibility_score ?? 70}
                  </span>
                </label>
                <input
                  id="min-eligibility"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={configForm.min_eligibility_score ?? 70}
                  onChange={(e) =>
                    setConfigForm((f) => ({
                      ...f,
                      min_eligibility_score: Number(e.target.value),
                    }))
                  }
                  className="mt-1 w-full accent-teal-500"
                />
                <div className="mt-0.5 flex justify-between text-xs text-navy-400">
                  <span>0</span>
                  <span>100</span>
                </div>
              </div>

              {/* Daily draft limit */}
              <div>
                <label
                  htmlFor="daily-limit"
                  className="block text-sm font-medium text-navy-700"
                >
                  Daily draft limit
                </label>
                <input
                  id="daily-limit"
                  type="number"
                  min={1}
                  max={50}
                  value={configForm.daily_draft_limit ?? 10}
                  onChange={(e) =>
                    setConfigForm((f) => ({
                      ...f,
                      daily_draft_limit: Number(e.target.value),
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-navy-200 bg-navy-50 px-3 py-2 text-sm text-navy-900 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                />
              </div>

              {/* Deadline alert days */}
              <div>
                <label
                  htmlFor="deadline-days"
                  className="block text-sm font-medium text-navy-700"
                >
                  Generate when deadline within (days)
                </label>
                <input
                  id="deadline-days"
                  type="number"
                  min={1}
                  value={configForm.auto_generate_on_deadline_days ?? 14}
                  onChange={(e) =>
                    setConfigForm((f) => ({
                      ...f,
                      auto_generate_on_deadline_days: Number(e.target.value),
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-navy-200 bg-navy-50 px-3 py-2 text-sm text-navy-900 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                />
              </div>

              {/* Auto-submit threshold */}
              <div>
                <label
                  htmlFor="auto-submit"
                  className="block text-sm font-medium text-navy-700"
                >
                  Auto-submit confidence threshold
                </label>
                <input
                  id="auto-submit"
                  type="number"
                  min={0}
                  max={100}
                  disabled={configForm.require_approval_before_submit ?? true}
                  value={configForm.auto_submit_above_confidence ?? ""}
                  placeholder="Disabled"
                  onChange={(e) =>
                    setConfigForm((f) => ({
                      ...f,
                      auto_submit_above_confidence: e.target.value
                        ? Number(e.target.value)
                        : null,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-navy-200 bg-navy-50 px-3 py-2 text-sm text-navy-900 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
                />
                {configForm.require_approval_before_submit && (
                  <p className="mt-1 text-xs text-navy-400">
                    Disabled while &ldquo;require approval&rdquo; is on.
                  </p>
                )}
              </div>
            </div>

            {/* Toggles row */}
            <div className="space-y-3 border-t border-navy-100 pt-4">
              <ConfigToggle
                id="auto-on-discovery"
                label="Auto-generate on discovery"
                description="Trigger a draft whenever a new opportunity is discovered."
                checked={configForm.auto_generate_on_discovery ?? false}
                onChange={(v) =>
                  setConfigForm((f) => ({ ...f, auto_generate_on_discovery: v }))
                }
              />
              <ConfigToggle
                id="require-approval"
                label="Require approval before submit"
                description="Drafts must be manually approved before going to AutoApply."
                checked={configForm.require_approval_before_submit ?? true}
                onChange={(v) =>
                  setConfigForm((f) => ({
                    ...f,
                    require_approval_before_submit: v,
                    auto_submit_above_confidence: v
                      ? null
                      : f.auto_submit_above_confidence,
                  }))
                }
              />
            </div>

            <div className="flex justify-end">
              <Button onClick={handleConfigSave} isLoading={savingConfig} disabled={savingConfig}>
                Save settings
              </Button>
            </div>

            {config && (
              <p className="text-right text-xs text-navy-400">
                Auto-drafting is currently{" "}
                <span className={config.is_enabled ? "text-green-500" : "text-red-400"}>
                  {config.is_enabled ? "enabled" : "disabled"}
                </span>
                .
              </p>
            )}
          </div>
        )}
      </Card>

      {/* Reject modal */}
      <Modal
        isOpen={rejectModal !== null}
        onClose={() => { setRejectModal(null); setRejectReason(""); }}
        title="Reject draft"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-navy-600">
            {rejectModal?.bulk
              ? `Provide a rejection reason for ${selected.size} selected draft${selected.size !== 1 ? "s" : ""}.`
              : "Provide a rejection reason (optional)."}
          </p>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
            placeholder="Rejection reason..."
            className="w-full rounded-lg border border-navy-200 bg-navy-50 px-3 py-2 text-sm text-navy-900 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => { setRejectModal(null); setRejectReason(""); }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!rejectModal) return;
                const reason = rejectReason.trim() || "Rejected by reviewer.";
                if (rejectModal.bulk) {
                  void handleBulkReject(reason);
                } else {
                  void handleReject(rejectModal.id, reason);
                }
              }}
            >
              Confirm rejection
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string | null;
  color: "gray" | "navy" | "green" | "teal" | "yellow" | "red";
}) {
  const accent: Record<string, string> = {
    gray: "text-navy-400",
    navy: "text-blue-400",
    green: "text-green-400",
    teal: "text-teal-400",
    yellow: "text-amber-400",
    red: "text-red-400",
  };

  return (
    <div className="rounded-xl border border-navy-100 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-navy-400">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-bold ${accent[color] ?? "text-navy-700"}`}>
        {value == null ? <span className="inline-block h-7 w-10 animate-pulse rounded bg-navy-100" /> : value}
      </p>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  color,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  label: string;
  color: "blue" | "green" | "red" | "teal" | "orange";
  onClick: () => void;
  disabled: boolean;
}) {
  const colorClass: Record<string, string> = {
    blue: "bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200",
    green: "bg-green-50 text-green-700 hover:bg-green-100 border-green-200",
    red: "bg-red-50 text-red-700 hover:bg-red-100 border-red-200",
    teal: "bg-teal-50 text-teal-700 hover:bg-teal-100 border-teal-200",
    orange: "bg-orange-50 text-orange-700 hover:bg-orange-100 border-orange-200",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${colorClass[color] ?? ""}`}
    >
      {icon}
      {label}
    </button>
  );
}

function ConfigToggle({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <label htmlFor={id} className="text-sm font-medium text-navy-900">
          {label}
        </label>
        <p className="text-xs text-navy-500">{description}</p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-teal-500" : "bg-navy-200"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}
