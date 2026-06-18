"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock,
  Image,
  Lock,
  Play,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { Button, Card, EmptyState, Select } from "@/components/ui";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { SessionList } from "@/components/automation/SessionList";
import {
  STATUS_FILTERS,
  STATUS_LABEL,
  loadAutomationSessions,
  type AutomationSessionListItem,
} from "@/components/automation/automation";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import type { AutomationStatus } from "@/types/automation";

/** Re-poll while any session is still mid-run, so status updates appear live. */
const POLL_INTERVAL_MS = 4000;

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All statuses" },
  ...STATUS_FILTERS.map((value) => ({ value, label: STATUS_LABEL[value] })),
];

type AutomationLevel = "supervised" | "semi_autonomous" | "autonomous";

const LEVEL_LABELS: Record<AutomationLevel, string> = {
  supervised: "Supervised",
  semi_autonomous: "Semi-Autonomous",
  autonomous: "Autonomous",
};

const LEVEL_DESCRIPTIONS: Record<AutomationLevel, string> = {
  supervised: "Pauses before every submission for your approval.",
  semi_autonomous: "Auto-submits when all fields have ≥90% confidence. Pauses otherwise.",
  autonomous: "Submits automatically without pause. Captures confirmation.",
};

/** Maps raw error text from error_log to a user-facing category. */
type FailureCategory =
  | "form_not_found"
  | "captcha_failed"
  | "timeout"
  | "field_mismatch"
  | "other";

const FAILURE_CATEGORY_LABEL: Record<FailureCategory, string> = {
  form_not_found: "Form not found",
  captcha_failed: "CAPTCHA failed",
  timeout: "Timeout",
  field_mismatch: "Field mismatch",
  other: "Other error",
};

const FAILURE_CATEGORY_COLOR: Record<FailureCategory, string> = {
  form_not_found: "bg-orange-100 text-orange-700",
  captcha_failed: "bg-purple-100 text-purple-700",
  timeout: "bg-amber-100 text-amber-700",
  field_mismatch: "bg-rose-100 text-rose-700",
  other: "bg-red-100 text-red-700",
};

function categorizeFailure(errorLog: unknown[]): FailureCategory {
  const lastError = errorLog.at(-1);
  if (!lastError || typeof lastError !== "object") return "other";
  const msg = String((lastError as Record<string, unknown>).error ?? "").toLowerCase();
  if (msg.includes("timeout")) return "timeout";
  if (msg.includes("captcha")) return "captcha_failed";
  if (msg.includes("form") || msg.includes("not found") || msg.includes("detect"))
    return "form_not_found";
  if (msg.includes("field") || msg.includes("mapping") || msg.includes("fill"))
    return "field_mismatch";
  return "other";
}

interface QueueItem {
  id: string;
  priority: number;
  status: string;
  automation_level: string;
  retry_count: number;
  max_retries: number;
  error_log: unknown[];
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  applications: {
    id: string;
    stage: string;
    opportunities: { name: string } | null;
  } | null;
}

interface QueueStats {
  queued: number;
  processing: number;
  paused: number;
  completed: number;
  failed: number;
}

interface DailyStats {
  used: number;
  limit: number; // -1 = unlimited
  tier: string;
}

const QUEUE_STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  processing: "Processing",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
};

const QUEUE_STATUS_COLOR: Record<string, string> = {
  queued: "bg-blue-100 text-blue-700",
  processing: "bg-yellow-100 text-yellow-700",
  paused: "bg-gray-100 text-gray-600",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt || !completedAt) return "—";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return "<1s";
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

/**
 * Browser-automation session list and queue dashboard (BLUEPRINT §Phase 3 + Tier 6).
 * Shows summary stats, filterable session list, and the automation queue with
 * per-item level selectors gated by feature flags.
 */
export default function AutomationPage() {
  const router = useRouter();
  const { profile } = useProfile();
  const canRerun = canEdit(profile?.role);
  const canApprove = profile?.role === "owner" || profile?.role === "admin";
  const canToggle = canApprove;

  const [sessions, setSessions] = useState<AutomationSessionListItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | AutomationStatus>("all");
  const [funderFilter, setFunderFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rerunningApplicationId, setRerunningApplicationId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [enabling, setEnabling] = useState(false);

  // Queue state
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [processingQueueId, setProcessingQueueId] = useState<string | null>(null);
  const [updatingLevelId, setUpdatingLevelId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryingAll, setRetryingAll] = useState(false);

  // Stats
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [dailyStats, setDailyStats] = useState<DailyStats | null>(null);

  // Feature flags
  const [hasSemiAuto, setHasSemiAuto] = useState(false);
  const [hasAutonomous, setHasAutonomous] = useState(false);

  // Global default level (platform_config: automation.default_level)
  const [defaultLevel, setDefaultLevel] = useState<AutomationLevel>("supervised");
  const [savingDefault, setSavingDefault] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/automation/stats");
      if (!res.ok) return;
      const payload = (await res.json()) as {
        stats: QueueStats;
        daily: DailyStats;
      };
      setQueueStats(payload.stats ?? null);
      setDailyStats(payload.daily ?? null);
    } catch {
      // non-fatal: stats are supplemental
    }
  }, []);

  const loadQueue = useCallback(async () => {
    setQueueLoading(true);
    try {
      const res = await fetch("/api/automation/queue");
      if (!res.ok) throw new Error("Failed to fetch queue");
      const payload = (await res.json()) as { items: QueueItem[] };
      setQueueItems(payload.items ?? []);
      setQueueError(null);
    } catch {
      setQueueError("Could not load the automation queue.");
    } finally {
      setQueueLoading(false);
    }
  }, []);

  const load = useCallback(async (initial: boolean) => {
    if (initial) setLoading(true);
    const supabase = createClient();
    try {
      const [items, flagRes, semiAutoRes, autonomousRes, defaultRes] = await Promise.all([
        loadAutomationSessions(supabase),
        supabase
          .from("platform_config")
          .select("value")
          .eq("key", "feature.browser_automation")
          .maybeSingle(),
        supabase
          .from("platform_config")
          .select("value")
          .eq("key", "feature.semi_autonomous")
          .maybeSingle(),
        supabase
          .from("platform_config")
          .select("value")
          .eq("key", "feature.autonomous_mode")
          .maybeSingle(),
        supabase
          .from("platform_config")
          .select("value")
          .eq("key", "automation.default_level")
          .maybeSingle(),
      ]);
      setSessions(items);
      setFeatureEnabled((flagRes.data?.value as string | undefined) === "true");
      setHasSemiAuto((semiAutoRes.data?.value as string | undefined) === "true");
      setHasAutonomous((autonomousRes.data?.value as string | undefined) === "true");
      const storedDefault = defaultRes.data?.value as string | undefined;
      if (storedDefault === "semi_autonomous" || storedDefault === "autonomous") {
        setDefaultLevel(storedDefault as AutomationLevel);
      }
      setError(null);
    } catch {
      setError("Could not load automation sessions.");
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
    void loadQueue();
    void loadStats();
  }, [load, loadQueue, loadStats]);

  const hasLiveSession = sessions.some(
    (s) => s.status === "pending" || s.status === "in_progress",
  );
  useEffect(() => {
    if (!hasLiveSession) return;
    const timer = setInterval(() => void load(false), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasLiveSession, load]);

  // Summary stats (across all sessions, ignoring active filters)
  const stats = useMemo(() => ({
    total: sessions.length,
    submitted: sessions.filter((s) => s.status === "submitted").length,
    awaitingApproval: sessions.filter((s) => s.status === "awaiting_approval").length,
    failed: sessions.filter((s) => s.status === "failed").length,
  }), [sessions]);

  // Funder options derived from loaded sessions
  const funderOptions = useMemo(() => {
    const names = new Set<string>();
    sessions.forEach((s) => { if (s.funderName) names.add(s.funderName); });
    return [
      { value: "all", label: "All funders" },
      ...Array.from(names).sort().map((n) => ({ value: n, label: n })),
    ];
  }, [sessions]);

  const filtered = useMemo(() => {
    let result = sessions;
    if (statusFilter !== "all") result = result.filter((s) => s.status === statusFilter);
    if (funderFilter !== "all") result = result.filter((s) => s.funderName === funderFilter);
    if (dateFrom) result = result.filter((s) => s.createdAt >= dateFrom);
    if (dateTo) result = result.filter((s) => s.createdAt <= `${dateTo}T23:59:59.999Z`);
    return result;
  }, [sessions, statusFilter, funderFilter, dateFrom, dateTo]);

  // Active (processing) and history (completed/failed last 50)
  const activeItems = useMemo(
    () => queueItems.filter((q) => q.status === "processing"),
    [queueItems],
  );
  const pendingItems = useMemo(
    () => queueItems.filter((q) => q.status === "queued" || q.status === "paused"),
    [queueItems],
  );
  const historyItems = useMemo(
    () =>
      queueItems
        .filter((q) => q.status === "completed" || q.status === "failed")
        .sort((a, b) => {
          const ta = a.completed_at ?? a.created_at;
          const tb = b.completed_at ?? b.created_at;
          return new Date(tb).getTime() - new Date(ta).getTime();
        })
        .slice(0, 50),
    [queueItems],
  );

  const failedCount = useMemo(
    () => queueItems.filter((q) => q.status === "failed").length,
    [queueItems],
  );

  function openSession(sessionId: string) {
    router.push(`/autoapply/${sessionId}`);
  }

  async function handleRerun(session: AutomationSessionListItem) {
    if (!session.applicationId) return;
    setActionError(null);
    setRerunningApplicationId(session.applicationId);
    try {
      const res = await fetch("/api/agents/automation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ applicationId: session.applicationId }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        sessionId?: string;
        error?: string;
      };
      if (!res.ok) {
        setActionError(payload.error ?? "Could not start a new session.");
        return;
      }
      await load(false);
      if (payload.sessionId) router.push(`/autoapply/${payload.sessionId}`);
    } catch {
      setActionError("Could not reach the automation agent. Please try again.");
    } finally {
      setRerunningApplicationId(null);
    }
  }

  function handleApprove(session: AutomationSessionListItem) {
    router.push(`/autoapply/${session.id}`);
  }

  async function handleEnableFeature() {
    if (!profile) return;
    setEnabling(true);
    setActionError(null);
    const supabase = createClient();
    const { error: upsertError } = await supabase.from("platform_config").upsert(
      {
        organization_id: profile.organization_id,
        key: "feature.browser_automation",
        value: "true",
      },
      { onConflict: "organization_id,key" },
    );
    setEnabling(false);
    if (upsertError) {
      setActionError("Could not enable browser automation. Please try again.");
      return;
    }
    setFeatureEnabled(true);
  }

  async function handleSaveDefaultLevel(level: AutomationLevel) {
    if (!profile) return;
    setSavingDefault(true);
    const supabase = createClient();
    await supabase.from("platform_config").upsert(
      {
        organization_id: profile.organization_id,
        key: "automation.default_level",
        value: level,
      },
      { onConflict: "organization_id,key" },
    );
    setDefaultLevel(level);
    setSavingDefault(false);
  }

  async function handleUpdateQueueLevel(itemId: string, level: AutomationLevel) {
    setUpdatingLevelId(itemId);
    try {
      const res = await fetch("/api/automation/queue", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: itemId, automationLevel: level }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(err.error ?? "Could not update automation level.");
        return;
      }
      setQueueItems((prev) =>
        prev.map((q) =>
          q.id === itemId ? { ...q, automation_level: level } : q,
        ),
      );
    } catch {
      setActionError("Failed to update queue item.");
    } finally {
      setUpdatingLevelId(null);
    }
  }

  async function handleProcessItem(itemId: string) {
    setProcessingQueueId(itemId);
    setActionError(null);
    try {
      const res = await fetch("/api/automation/process", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queueItemId: itemId }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(err.error ?? "Could not process queue item.");
        return;
      }
      await loadQueue();
      await loadStats();
    } catch {
      setActionError("Could not reach the automation worker.");
    } finally {
      setProcessingQueueId(null);
    }
  }

  async function handleRetrySingle(itemId: string) {
    setRetryingId(itemId);
    setActionError(null);
    try {
      const res = await fetch("/api/automation/queue", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: itemId }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(err.error ?? "Could not retry queue item.");
        return;
      }
      await loadQueue();
      await loadStats();
    } catch {
      setActionError("Failed to retry queue item.");
    } finally {
      setRetryingId(null);
    }
  }

  async function handleRetryAll() {
    setRetryingAll(true);
    setActionError(null);
    try {
      const res = await fetch("/api/automation/queue", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ retryAll: true }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(err.error ?? "Could not retry failed items.");
        return;
      }
      await loadQueue();
      await loadStats();
    } catch {
      setActionError("Failed to retry all failed items.");
    } finally {
      setRetryingAll(false);
    }
  }

  function levelAllowed(level: AutomationLevel): boolean {
    if (level === "autonomous") return hasAutonomous;
    if (level === "semi_autonomous") return hasSemiAuto;
    return true;
  }

  function levelUpgradeMessage(level: AutomationLevel): string | null {
    if (level === "autonomous" && !hasAutonomous) {
      return "Requires Enterprise or Consultant plan";
    }
    if (level === "semi_autonomous" && !hasSemiAuto) {
      return "Requires Professional plan or higher";
    }
    return null;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
          AutoApply
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Browser-automation sessions fill funder donation portals for your
          applications. Choose your automation level per item or set a global default.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {actionError}
        </div>
      )}

      {featureEnabled === false && (
        <Card>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-navy-900">
                Browser automation is off
              </h2>
              <p className="mt-0.5 text-sm text-navy-500">
                {canToggle
                  ? "Enable it to run portal automation for your applications."
                  : "Ask an owner or admin to enable it for your organization."}
              </p>
            </div>
            {canToggle && (
              <Button onClick={handleEnableFeature} isLoading={enabling}>
                Enable browser automation
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* Queue status counts + daily submission counter */}
      {queueStats && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
          <MetricCard
            label="Queued"
            value={String(queueStats.queued)}
            icon={Clock}
          />
          <MetricCard
            label="Processing"
            value={String(queueStats.processing)}
            icon={Bot}
          />
          <MetricCard
            label="Completed"
            value={String(queueStats.completed)}
            icon={CheckCircle2}
          />
          <MetricCard
            label="Failed"
            value={String(queueStats.failed)}
            icon={XCircle}
          />
          <MetricCard
            label="Paused"
            value={String(queueStats.paused)}
            icon={AlertCircle}
          />
          {dailyStats && (
            <div className="col-span-1">
              <Card>
                <div className="text-center">
                  <p className="text-xs font-medium uppercase tracking-wide text-navy-500">
                    Today&apos;s Submissions
                  </p>
                  <p className="mt-1 text-2xl font-bold text-navy-900">
                    {dailyStats.used}
                    <span className="text-sm font-normal text-navy-400">
                      /{dailyStats.limit === -1 ? "∞" : dailyStats.limit}
                    </span>
                  </p>
                  <p className="mt-0.5 text-xs text-navy-400 capitalize">
                    {dailyStats.tier} plan
                  </p>
                  {dailyStats.limit !== -1 && (
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-navy-100">
                      <div
                        className={`h-full rounded-full transition-all ${
                          dailyStats.used >= dailyStats.limit
                            ? "bg-red-500"
                            : dailyStats.used / dailyStats.limit > 0.8
                            ? "bg-amber-500"
                            : "bg-teal-500"
                        }`}
                        style={{
                          width: `${Math.min(100, (dailyStats.used / dailyStats.limit) * 100)}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* Summary stats for browser sessions */}
      {!loading && sessions.length > 0 && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard
            label="Total sessions"
            value={String(stats.total)}
            icon={Bot}
          />
          <MetricCard
            label="Submitted"
            value={String(stats.submitted)}
            icon={CheckCircle2}
          />
          <MetricCard
            label="Pending approval"
            value={String(stats.awaitingApproval)}
            icon={Clock}
          />
          <MetricCard
            label="Failed"
            value={String(stats.failed)}
            icon={XCircle}
          />
        </div>
      )}

      {/* Active session(s) with progress indicator */}
      {activeItems.length > 0 && (
        <Card title="Active Sessions" noPadding>
          <div className="divide-y divide-navy-100 px-5">
            {activeItems.map((item) => {
              const name = item.applications?.opportunities?.name ?? "Processing…";
              return (
                <div key={item.id} className="flex items-center gap-4 py-4">
                  <div className="relative flex h-8 w-8 shrink-0 items-center justify-center">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-60" />
                    <span className="relative inline-flex h-4 w-4 rounded-full bg-yellow-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-navy-900">{name}</p>
                    <p className="text-xs text-navy-400">
                      Started{" "}
                      {item.started_at
                        ? new Date(item.started_at).toLocaleTimeString()
                        : "just now"}
                      {" · "}
                      {LEVEL_LABELS[item.automation_level as AutomationLevel] ??
                        item.automation_level}
                    </p>
                  </div>
                  <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                    Processing
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Automation Queue */}
      <Card title="Automation Queue" noPadding>
        <div className="p-5 space-y-5">
          {/* Global default level */}
          <div className="flex flex-wrap items-start gap-6 border-b border-navy-200 pb-5">
            <div className="flex-1 min-w-48">
              <label className="block text-sm font-medium text-navy-700 mb-1">
                Default automation level
              </label>
              <p className="text-xs text-navy-500 mb-2">
                Applied when queuing new items. Can be overridden per item.
              </p>
              <div className="flex items-center gap-3">
                <div className="w-52">
                  <Select
                    aria-label="Default automation level"
                    value={defaultLevel}
                    onChange={(e) =>
                      void handleSaveDefaultLevel(e.target.value as AutomationLevel)
                    }
                    disabled={savingDefault || !canToggle}
                    options={[
                      { value: "supervised", label: "Supervised" },
                      {
                        value: "semi_autonomous",
                        label: hasSemiAuto
                          ? "Semi-Autonomous"
                          : "Semi-Autonomous (upgrade required)",
                      },
                      {
                        value: "autonomous",
                        label: hasAutonomous
                          ? "Autonomous"
                          : "Autonomous (upgrade required)",
                      },
                    ]}
                  />
                </div>
                {savingDefault && (
                  <span className="text-xs text-navy-400">Saving…</span>
                )}
              </div>
              <p className="mt-1.5 text-xs text-navy-500">
                {LEVEL_DESCRIPTIONS[defaultLevel]}
              </p>
            </div>

            {/* Level legend */}
            <div className="space-y-2 min-w-72">
              {(["supervised", "semi_autonomous", "autonomous"] as AutomationLevel[]).map(
                (lvl) => {
                  const upgrade = levelUpgradeMessage(lvl);
                  return (
                    <div key={lvl} className="flex items-start gap-2">
                      {upgrade ? (
                        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-navy-400" />
                      ) : (
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-500" />
                      )}
                      <div>
                        <span className="text-xs font-medium text-navy-700">
                          {LEVEL_LABELS[lvl]}
                        </span>
                        {upgrade && (
                          <span className="ml-1.5 text-xs text-amber-600">
                            — {upgrade}
                          </span>
                        )}
                        <p className="text-xs text-navy-400">
                          {LEVEL_DESCRIPTIONS[lvl]}
                        </p>
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          </div>

          {/* Queue items */}
          {queueLoading ? (
            <p className="text-sm text-navy-400">Loading queue…</p>
          ) : queueError ? (
            <p className="text-sm text-red-600">{queueError}</p>
          ) : pendingItems.length === 0 ? (
            <EmptyState
              icon={Play}
              title="Queue is empty"
              description="Add applications to the queue from their detail page to process them here."
            />
          ) : (
            <div className="divide-y divide-navy-100">
              {pendingItems.map((item) => {
                const opportunityName =
                  item.applications?.opportunities?.name ?? "Unknown application";
                const statusLabel =
                  QUEUE_STATUS_LABEL[item.status] ?? item.status;
                const statusColor =
                  QUEUE_STATUS_COLOR[item.status] ?? "bg-gray-100 text-gray-600";
                const canUpdate =
                  item.status === "queued" || item.status === "paused";
                const isProcessing = processingQueueId === item.id;
                const isUpdatingLevel = updatingLevelId === item.id;
                const currentLevel =
                  (item.automation_level as AutomationLevel) ?? "supervised";

                return (
                  <div
                    key={item.id}
                    className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:gap-4"
                  >
                    {/* Name + priority */}
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium text-navy-900">
                        {opportunityName}
                      </p>
                      <p className="text-xs text-navy-400">
                        Priority {item.priority} ·{" "}
                        {item.retry_count > 0
                          ? `Retry ${item.retry_count}/${item.max_retries}`
                          : "First attempt"}
                      </p>
                    </div>

                    {/* Status badge */}
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}
                    >
                      {statusLabel}
                    </span>

                    {/* Automation level selector */}
                    <div className="w-48">
                      {canUpdate ? (
                        <div>
                          <Select
                            aria-label={`Automation level for ${opportunityName}`}
                            value={currentLevel}
                            onChange={(e) => {
                              const newLevel = e.target.value as AutomationLevel;
                              if (!levelAllowed(newLevel)) return;
                              void handleUpdateQueueLevel(item.id, newLevel);
                            }}
                            disabled={isUpdatingLevel || !canRerun}
                            options={[
                              { value: "supervised", label: "Supervised" },
                              {
                                value: "semi_autonomous",
                                label: hasSemiAuto
                                  ? "Semi-Autonomous"
                                  : "Semi-Auto (locked)",
                              },
                              {
                                value: "autonomous",
                                label: hasAutonomous
                                  ? "Autonomous"
                                  : "Autonomous (locked)",
                              },
                            ]}
                          />
                          {levelUpgradeMessage(currentLevel) && (
                            <p className="mt-0.5 text-xs text-amber-600 flex items-center gap-1">
                              <Lock className="h-3 w-3" />
                              {levelUpgradeMessage(currentLevel)}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-navy-500">
                          {LEVEL_LABELS[currentLevel] ?? currentLevel}
                        </span>
                      )}
                    </div>

                    {/* Process button */}
                    {canUpdate && canRerun && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleProcessItem(item.id)}
                        isLoading={isProcessing}
                        disabled={isProcessing || !featureEnabled}
                      >
                        <Play className="mr-1 h-3.5 w-3.5" />
                        Process
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {/* History: last 50 completed/failed items */}
      {historyItems.length > 0 && (
        <Card
          title="History"
          noPadding
          actions={
            failedCount > 0 && canRerun ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void handleRetryAll()}
                isLoading={retryingAll}
                disabled={retryingAll}
              >
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                Retry all failed ({failedCount})
              </Button>
            ) : undefined
          }
        >
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-navy-100 text-sm">
              <thead>
                <tr className="bg-navy-50">
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Application
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Result
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Error type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Duration
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                    Completed
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100 bg-white">
                {historyItems.map((item) => {
                  const name =
                    item.applications?.opportunities?.name ?? "Unknown";
                  const isRetrying = retryingId === item.id;
                  const errorLog = Array.isArray(item.error_log)
                    ? item.error_log
                    : [];
                  const failCat =
                    item.status === "failed"
                      ? categorizeFailure(errorLog)
                      : null;

                  return (
                    <tr key={item.id} className="hover:bg-navy-50">
                      <td className="max-w-xs truncate px-5 py-3 font-medium text-navy-900">
                        {name}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            QUEUE_STATUS_COLOR[item.status] ?? "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {QUEUE_STATUS_LABEL[item.status] ?? item.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {failCat ? (
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${FAILURE_CATEGORY_COLOR[failCat]}`}
                          >
                            {FAILURE_CATEGORY_LABEL[failCat]}
                          </span>
                        ) : (
                          <span className="text-navy-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-navy-500">
                        {formatDuration(item.started_at, item.completed_at)}
                      </td>
                      <td className="px-4 py-3 text-navy-400 whitespace-nowrap">
                        {item.completed_at
                          ? new Date(item.completed_at).toLocaleString()
                          : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {/* Screenshot link via session detail — if applicationId exists */}
                          {item.applications?.id && (
                            <button
                              type="button"
                              title="View session screenshots"
                              onClick={() => {
                                // Navigate to the latest session for this application.
                                // Sessions list is filtered by applicationId on the session detail route.
                                router.push(
                                  `/autoapply?applicationId=${item.applications!.id}`,
                                );
                              }}
                              className="text-navy-400 hover:text-navy-700"
                            >
                              <Image className="h-4 w-4" />
                            </button>
                          )}
                          {/* Retry button for failed items */}
                          {item.status === "failed" && canRerun && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => void handleRetrySingle(item.id)}
                              isLoading={isRetrying}
                              disabled={isRetrying}
                            >
                              <RefreshCw className="mr-1 h-3 w-3" />
                              Retry
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card
        title="Sessions"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {/* Date range */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-navy-500 whitespace-nowrap">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="rounded-lg border border-navy-300 bg-white px-2 py-1.5 text-sm text-navy-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                aria-label="From date"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-navy-500 whitespace-nowrap">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="rounded-lg border border-navy-300 bg-white px-2 py-1.5 text-sm text-navy-900 focus:outline-none focus:ring-2 focus:ring-teal-500"
                aria-label="To date"
              />
            </div>
            {/* Funder filter */}
            <div className="w-40">
              <Select
                aria-label="Filter by funder"
                options={funderOptions}
                value={funderFilter}
                onChange={(e) => setFunderFilter(e.target.value)}
              />
            </div>
            {/* Status filter */}
            <div className="w-44">
              <Select
                aria-label="Filter by status"
                options={STATUS_FILTER_OPTIONS}
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as "all" | AutomationStatus)
                }
              />
            </div>
            {(dateFrom || dateTo || funderFilter !== "all" || statusFilter !== "all") && (
              <button
                type="button"
                onClick={() => {
                  setDateFrom("");
                  setDateTo("");
                  setFunderFilter("all");
                  setStatusFilter("all");
                }}
                className="text-xs text-navy-500 underline hover:text-navy-700"
              >
                Clear filters
              </button>
            )}
          </div>
        }
        noPadding
      >
        <div className="p-5">
          {!loading && sessions.length === 0 ? (
            <EmptyState
              icon={Bot}
              title="No automation sessions yet"
              description="Start a session from an application's portal to fill a funder donation form automatically. Sessions you start will appear here."
            />
          ) : (
            <SessionList
              sessions={filtered}
              isLoading={loading}
              onOpen={openSession}
              onRerun={handleRerun}
              onApprove={handleApprove}
              rerunningApplicationId={rerunningApplicationId}
              canRerun={canRerun && featureEnabled !== false}
              canApprove={canApprove && featureEnabled !== false}
              emptyMessage="No sessions match these filters."
            />
          )}
        </div>
      </Card>
    </div>
  );
}
