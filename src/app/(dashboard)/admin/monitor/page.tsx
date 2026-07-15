"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, RotateCw, ShieldAlert, XCircle } from "lucide-react";

import { Badge, Button, Card, EmptyState, LoadingSpinner } from "@/components/ui";
import { useProfile } from "@/lib/hooks/useProfile";

const REFRESH_INTERVAL_MS = 10_000;

interface RecentFailure {
  id: string;
  funder_name: string;
  error_message: string;
  created_at: string;
}

interface MonitorData {
  active_count: number;
  completed_today: number;
  failed_today: number;
  recent_failures: RecentFailure[];
}

function successRate(completed: number, failed: number): number | null {
  const total = completed + failed;
  if (total === 0) return null;
  return (completed / total) * 100;
}

export default function AdminMonitorPage() {
  const { profile, loading: profileLoading } = useProfile();
  const canView = profile?.role === "owner" || profile?.role === "admin";

  const [data, setData] = useState<MonitorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/monitor");
      const json = (await res.json().catch(() => null)) as
        | (MonitorData & { error?: string })
        | null;
      if (!res.ok || !json) {
        setLoadError(json?.error ?? "Could not load monitor data.");
        return;
      }
      setData(json);
    } catch {
      setLoadError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (profileLoading) return;
    if (!canView) {
      setLoading(false);
      return;
    }
    void loadRef.current();
    const interval = setInterval(() => void loadRef.current(), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [profileLoading, canView]);

  async function handleRetry(id: string) {
    setRetryingId(id);
    setRetryError(null);
    try {
      const res = await fetch(`/api/admin/jobs/${id}/retry`, { method: "POST" });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setRetryError(json?.error ?? "Could not retry this job.");
        return;
      }
      await load();
    } catch {
      setRetryError("Could not reach the server. Please try again.");
    } finally {
      setRetryingId(null);
    }
  }

  if (profileLoading || loading) {
    return <LoadingSpinner center label="Loading Monitor..." />;
  }

  if (!canView) {
    return (
      <Card>
        <EmptyState
          icon={ShieldAlert}
          title="Admins only"
          description="Only owners and admins can view the automation Monitor dashboard."
        />
      </Card>
    );
  }

  if (loadError || !data) {
    return (
      <Card>
        <EmptyState
          icon={ShieldAlert}
          title="Could not load monitor data"
          description={loadError ?? "Unknown error."}
        />
      </Card>
    );
  }

  const rate = successRate(data.completed_today, data.failed_today);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">Monitor</h1>
          <p className="mt-1 text-sm text-navy-500">
            Live automation queue health across all tenants. Refreshes every 10 seconds.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load()}>
          <RotateCw className="mr-1.5 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card title="Active" description="Queued, processing, or paused">
          <div className="flex items-center gap-3">
            <Activity className="h-8 w-8 text-blue-400" aria-hidden />
            <p className="text-3xl font-bold text-navy-900">{data.active_count}</p>
          </div>
        </Card>

        <Card title="Completed Today" description="Submitted successfully today">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-8 w-8 text-teal-400" aria-hidden />
            <p className="text-3xl font-bold text-navy-900">{data.completed_today}</p>
          </div>
        </Card>

        <Card title="Failed Today" description="Failed submissions today">
          <div className="flex items-center gap-3">
            <XCircle className="h-8 w-8 text-red-400" aria-hidden />
            <p className="text-3xl font-bold text-navy-900">{data.failed_today}</p>
          </div>
        </Card>

        <Card title="Success Rate" description="Completed vs. failed today">
          <div className="flex items-center gap-3">
            <AlertTriangle
              className={`h-8 w-8 ${rate === null || rate >= 70 ? "text-teal-400" : rate >= 40 ? "text-amber-400" : "text-red-400"}`}
              aria-hidden
            />
            <p className="text-3xl font-bold text-navy-900">
              {rate === null ? "—" : `${rate.toFixed(0)}%`}
            </p>
          </div>
        </Card>
      </div>

      <Card
        title="Recent Failures"
        description="Last 10 failed automation jobs across all tenants"
        noPadding
      >
        {retryError && (
          <div className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">
            {retryError}
          </div>
        )}
        <div className="overflow-x-auto">
          {data.recent_failures.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={CheckCircle2}
                title="No recent failures"
                description="Failed automation jobs will appear here."
              />
            </div>
          ) : (
            <table className="min-w-full divide-y divide-navy-100 text-sm">
              <thead>
                <tr className="bg-sidebar">
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-white">
                    Funder
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-white">
                    Error
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-white">
                    Failed At
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-white">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100 bg-white">
                {data.recent_failures.map((failure) => (
                  <tr key={failure.id} className="hover:bg-navy-50">
                    <td className="px-5 py-3 font-medium text-navy-900">
                      {failure.funder_name}
                    </td>
                    <td className="max-w-md truncate px-4 py-3 text-navy-600">
                      <Badge color="red" withDot>
                        {failure.error_message}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-navy-400">
                      {new Date(failure.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleRetry(failure.id)}
                        isLoading={retryingId === failure.id}
                        disabled={retryingId === failure.id}
                      >
                        <RotateCw className="mr-1.5 h-3.5 w-3.5" />
                        Retry
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
