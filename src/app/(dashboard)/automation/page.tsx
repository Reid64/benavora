"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot } from "lucide-react";

import { Button, Card, EmptyState, Select } from "@/components/ui";
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

const FILTER_OPTIONS = [
  { value: "all", label: "All statuses" },
  ...STATUS_FILTERS.map((value) => ({ value, label: STATUS_LABEL[value] })),
];

/**
 * Browser-automation session list (BLUEPRINT §Phase 3). Shows every automation
 * session for the organization with a status filter, opens a session's detail
 * view on click, and offers a re-run for sessions tied to an application.
 *
 * Browser automation is a Phase 3 feature gated by the per-organization
 * `feature.browser_automation` flag (SCHEMA platform_config). When it is off,
 * an owner/admin can enable it here (mirrors the Research page's cron toggle).
 * Reads are RLS-scoped to the organization, so this client never sends an
 * organization id (Contracts §2).
 */
export default function AutomationPage() {
  const router = useRouter();
  const { profile } = useProfile();
  const canRerun = canEdit(profile?.role);
  const canToggle = profile?.role === "owner" || profile?.role === "admin";

  const [sessions, setSessions] = useState<AutomationSessionListItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | AutomationStatus>(
    "all",
  );
  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [rerunningApplicationId, setRerunningApplicationId] = useState<
    string | null
  >(null);
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

  // Poll quietly while any session is still running, so the list reflects
  // status changes without a manual refresh.
  const hasLiveSession = sessions.some(
    (s) => s.status === "pending" || s.status === "in_progress",
  );
  useEffect(() => {
    if (!hasLiveSession) return;
    const timer = setInterval(() => void load(false), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasLiveSession, load]);

  const filtered = useMemo(
    () =>
      statusFilter === "all"
        ? sessions
        : sessions.filter((s) => s.status === statusFilter),
    [sessions, statusFilter],
  );

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

      <Card
        title="Sessions"
        actions={
          <div className="w-48">
            <Select
              aria-label="Filter by status"
              options={FILTER_OPTIONS}
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as "all" | AutomationStatus)
              }
            />
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
              rerunningApplicationId={rerunningApplicationId}
              canRerun={canRerun && featureEnabled !== false}
              emptyMessage="No sessions match this status."
            />
          )}
        </div>
      </Card>
    </div>
  );
}
