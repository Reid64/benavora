"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Layers, Loader2, Plus, Telescope, TrendingUp, Users } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { MetricCard } from "@/components/dashboard/MetricCard";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import type { BadgeVariant } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatDate, humanizeEnum } from "@/lib/utils/formatters";

type DdRequestStatus =
  | "queued"
  | "enumerating"
  | "enriching"
  | "scoring"
  | "complete"
  | "failed";

type DdPipelineStage =
  | "new"
  | "reviewing"
  | "contacted"
  | "applied"
  | "received"
  | "rejected"
  | "archived";

interface DdRequestCounts {
  enumerated?: number;
  enriched?: number;
  linked?: number;
  scored?: number;
}

interface DdRequestRow {
  id: string;
  name: string;
  status: DdRequestStatus;
  counts: DdRequestCounts | null;
  created_at: string;
  completed_at: string | null;
  prospect_count: number;
}

interface DdDirectoryRef {
  legal_name: string;
  website: string | null;
  hq_address: string | null;
}

interface DdProspectRow {
  id: string;
  score: number | null;
  score_rationale: string | null;
  pipeline_stage: DdPipelineStage;
  directory: DdDirectoryRef | null;
}

const PIPELINE_STAGES: DdPipelineStage[] = [
  "new",
  "reviewing",
  "contacted",
  "applied",
  "received",
  "rejected",
  "archived",
];

const ACTIVE_STATUSES: DdRequestStatus[] = [
  "queued",
  "enumerating",
  "enriching",
  "scoring",
];

const STATUS_BADGE: Record<DdRequestStatus, BadgeVariant> = {
  queued: "neutral",
  enumerating: "info",
  enriching: "info",
  scoring: "info",
  complete: "success",
  failed: "error",
};

const POLL_INTERVAL_MS = 15_000;

function countsSummary(counts: DdRequestCounts | null): string {
  if (!counts) return "Waiting to start…";
  const parts: string[] = [];
  if (counts.enumerated != null) parts.push(`${counts.enumerated} enumerated`);
  if (counts.enriched != null) parts.push(`${counts.enriched} enriched`);
  if (counts.scored != null) parts.push(`${counts.scored} scored`);
  return parts.length > 0 ? parts.join(" · ") : "Waiting to start…";
}

export default function DonorDiscoveryPage() {
  const [requests, setRequests] = useState<DdRequestRow[]>([]);
  const [stageCounts, setStageCounts] = useState<Record<DdPipelineStage, number>>(
    () => Object.fromEntries(PIPELINE_STAGES.map((s) => [s, 0])) as Record<DdPipelineStage, number>,
  );
  const [topProspects, setTopProspects] = useState<DdProspectRow[]>([]);
  const [totalProspects, setTotalProspects] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    setError(null);

    try {
      const supabase = createClient();

      const requestsPromise = fetch("/api/donor-discovery/requests", { cache: "no-store" });
      const stageCountsPromise = Promise.all(
        PIPELINE_STAGES.map((stage) =>
          supabase
            .from("donor_discovery_prospects")
            .select("*", { count: "exact", head: true })
            .eq("pipeline_stage", stage),
        ),
      );

      const [requestsRes, stageResults] = await Promise.all([requestsPromise, stageCountsPromise]);

      if (!requestsRes.ok) {
        setError("Could not load Donor Discovery requests.");
      } else {
        const payload = (await requestsRes.json()) as { requests: DdRequestRow[] };
        setRequests(payload.requests ?? []);
      }

      const nextStageCounts = Object.fromEntries(
        PIPELINE_STAGES.map((stage, i) => [stage, stageResults[i]?.count ?? 0]),
      ) as Record<DdPipelineStage, number>;
      setStageCounts(nextStageCounts);
      setTotalProspects(Object.values(nextStageCounts).reduce((a, b) => a + b, 0));

      const { data: prospects } = await supabase
        .from("donor_discovery_prospects")
        .select(
          "id, score, score_rationale, pipeline_stage, directory:donor_discovery_directory(legal_name, website, hq_address)",
        )
        .eq("pipeline_stage", "new")
        .order("score", { ascending: false, nullsFirst: false })
        .limit(8);

      setTopProspects((prospects ?? []) as unknown as DdProspectRow[]);
    } catch {
      setError("Could not load Donor Discovery data.");
    }

    if (initial) setLoading(false);
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  const hasActiveRequest = requests.some((r) => ACTIVE_STATUSES.includes(r.status));

  useEffect(() => {
    if (!hasActiveRequest) return;
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasActiveRequest, load]);

  const activeRequestCount = requests.filter((r) => ACTIVE_STATUSES.includes(r.status)).length;
  const maxStageCount = Math.max(1, ...PIPELINE_STAGES.map((s) => stageCounts[s]));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Donor Discovery"
        description="Find, score, and pipeline new prospects from the shared company directory."
        actions={
          <Link href="/donor-discovery/new">
            <Button>
              <Plus className="h-4 w-4" aria-hidden />
              New Discovery
            </Button>
          </Link>
        }
      />

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard
          label="Active Requests"
          value={loading ? "—" : String(activeRequestCount)}
          icon={Telescope}
          hue="emerald"
        />
        <MetricCard
          label="Total Prospects"
          value={loading ? "—" : totalProspects.toLocaleString()}
          icon={Users}
          hue="emerald"
        />
        <MetricCard
          label="New — Awaiting Review"
          value={loading ? "—" : stageCounts.new.toLocaleString()}
          icon={TrendingUp}
          hue="emerald"
        />
      </div>

      <Card title="Active Requests" description="Live progress for your discovery runs.">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-text-muted">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            Loading…
          </div>
        ) : requests.length === 0 ? (
          <EmptyState
            icon={Telescope}
            title="No discovery runs yet"
            description="Launch your first Donor Discovery search to start building your prospect pipeline."
            action={
              <Link href="/donor-discovery/new">
                <Button size="sm">New Discovery</Button>
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {requests.map((req) => (
              <li key={req.id} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text">{req.name}</p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {countsSummary(req.counts)} · {req.prospect_count} prospect
                    {req.prospect_count === 1 ? "" : "s"} · started {formatDate(req.created_at)}
                  </p>
                </div>
                <Badge variant={STATUS_BADGE[req.status]} withDot className="shrink-0">
                  {humanizeEnum(req.status)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Prospect Pipeline" description="All prospects by stage.">
        {totalProspects === 0 && !loading ? (
          <p className="py-6 text-center text-sm text-text-muted">
            No prospects yet — run a discovery request to start populating your pipeline.
          </p>
        ) : (
          <div className="space-y-3">
            {PIPELINE_STAGES.map((stage) => {
              const count = stageCounts[stage];
              const pct = Math.round((count / maxStageCount) * 100);
              return (
                <div key={stage} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs font-medium text-text-muted">
                    {humanizeEnum(stage)}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${count > 0 ? Math.max(pct, 4) : 0}%` }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right text-xs font-semibold text-text">
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Top-Scored New Prospects" description="Highest-scoring prospects awaiting review.">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-text-muted">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            Loading…
          </div>
        ) : topProspects.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No new prospects yet"
            description="Scored prospects will appear here once a discovery request completes enumeration, enrichment, and scoring."
          />
        ) : (
          <ul className="divide-y divide-border">
            {topProspects.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text">
                    {p.directory?.legal_name ?? "Unknown company"}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-text-muted">
                    {p.directory?.hq_address ?? "No address on file"}
                    {p.directory?.website ? (
                      <>
                        {" · "}
                        <a
                          href={p.directory.website}
                          target="_blank"
                          rel="noreferrer"
                          className="text-teal-600 hover:underline"
                        >
                          {p.directory.website.replace(/^https?:\/\//, "")}
                        </a>
                      </>
                    ) : null}
                  </p>
                  {p.score_rationale && (
                    <p className="mt-1 truncate text-xs text-text-muted">{p.score_rationale}</p>
                  )}
                </div>
                <Badge
                  variant={p.score != null && p.score >= 70 ? "success" : "neutral"}
                  className="shrink-0"
                >
                  {p.score != null ? `${p.score}` : "Unscored"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
