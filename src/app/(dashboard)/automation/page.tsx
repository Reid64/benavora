"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, CheckCircle2, Clock, XCircle } from "lucide-react";

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

/**
 * Browser-automation session list (BLUEPRINT §Phase 3). Shows summary stats,
 * filterable session list, and quick actions per session.
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

  const load = useCallback(async (initial: boolean) => {
    if (initial) setLoading(true);
    const supabase = createClient();
    try {
      const [items, flagRes] = await Promise.all([
        loadAutomationSessions(supabase),
        supabase
          .from("platform_config")
          .select("value")
          .eq("key", "feature.browser_automation")
          .maybeSingle(),
      ]);
      setSessions(items);
      setFeatureEnabled((flagRes.data?.value as string | undefined) === "true");
      setError(null);
    } catch {
      setError("Could not load automation sessions.");
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

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

  function openSession(sessionId: string) {
    router.push(`/automation/${sessionId}`);
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
      if (payload.sessionId) router.push(`/automation/${payload.sessionId}`);
    } catch {
      setActionError("Could not reach the automation agent. Please try again.");
    } finally {
      setRerunningApplicationId(null);
    }
  }

  function handleApprove(session: AutomationSessionListItem) {
    router.push(`/automation/${session.id}`);
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
          Automation
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Browser-automation sessions fill funder donation portals for your
          applications. Each session pauses for your review and never submits
          without your approval.
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

      {/* Summary stats */}
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
