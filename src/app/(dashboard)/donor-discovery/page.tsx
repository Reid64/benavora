"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plug, Plus, Sparkles, Star, Telescope } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
import type { BadgeVariant } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatRelative, humanizeEnum } from "@/lib/utils/formatters";
import { cn } from "@/lib/utils/cn";

type DdRequestStatus =
  | "queued"
  | "enumerating"
  | "enriching"
  | "scoring"
  | "complete"
  | "failed";

/** The six funnel stages surfaced on the Overview page — `archived` is
 * tracked on the Prospects table but excluded from the funnel row. */
type DdFunnelStage = "new" | "reviewing" | "contacted" | "applied" | "received" | "rejected";

interface DdRequestCounts {
  enumerated?: number;
  enriched?: number;
  scored?: number;
}

interface DdRequestRow {
  id: string;
  name: string;
  taxonomy_ids: string[];
  geography: unknown;
  status: DdRequestStatus;
  counts: DdRequestCounts | null;
  created_at: string;
  prospect_count: number;
}

interface DdDirectoryRef {
  legal_name: string;
  naics_codes: string[] | null;
  civic_kind: string | null;
}

interface DdProspectRow {
  id: string;
  score: number | null;
  score_rationale: string | null;
  directory: DdDirectoryRef | null;
}

const FUNNEL_STAGES: DdFunnelStage[] = [
  "new",
  "reviewing",
  "contacted",
  "applied",
  "received",
  "rejected",
];

const ACTIVE_STATUSES: DdRequestStatus[] = ["queued", "enumerating", "enriching", "scoring"];

const STATUS_BADGE: Record<DdRequestStatus, BadgeVariant> = {
  queued: "neutral",
  enumerating: "info",
  enriching: "info",
  scoring: "warning",
  complete: "success",
  failed: "error",
};

const STATUS_BAR_CLASS: Record<DdRequestStatus, string> = {
  queued: "bg-text-muted",
  enumerating: "bg-info-text",
  enriching: "bg-info-text",
  scoring: "bg-warning-text",
  complete: "bg-success-text",
  failed: "bg-error-text",
};

/** Coarse step progress by status — the queue doesn't expose a true percent,
 * so this approximates position in the pipeline for the progress bar. */
const STATUS_PROGRESS_PCT: Record<DdRequestStatus, number> = {
  queued: 5,
  enumerating: 30,
  enriching: 60,
  scoring: 85,
  complete: 100,
  failed: 100,
};

const POLL_INTERVAL_MS = 15_000;
const TOP_PROSPECTS_LIMIT = 5;

function countsSummary(counts: DdRequestCounts | null): string {
  if (!counts) return "Waiting to start…";
  const parts: string[] = [];
  if (counts.enumerated != null) parts.push(`${counts.enumerated} enumerated`);
  if (counts.enriched != null) parts.push(`${counts.enriched} enriched`);
  if (counts.scored != null) parts.push(`${counts.scored} scored`);
  return parts.length > 0 ? parts.join(" · ") : "Waiting to start…";
}

function formatGeography(geography: unknown): string {
  if (!geography || typeof geography !== "object") return "—";
  const g = geography as Record<string, unknown>;
  if (g.national === true) return "National";
  if (Array.isArray(g.states) && g.states.every((s) => typeof s === "string")) {
    const states = g.states as string[];
    return states.length > 0
      ? `${states.length} state${states.length === 1 ? "" : "s"}: ${states.slice(0, 4).join(", ")}${states.length > 4 ? "…" : ""}`
      : "—";
  }
  if (typeof g.radius_mi === "number") return `${g.radius_mi} mi radius`;
  return "—";
}

function scoreBadgeVariant(score: number | null): BadgeVariant {
  if (score == null) return "neutral";
  if (score > 70) return "success";
  if (score >= 40) return "warning";
  return "error";
}

export default function DonorDiscoveryPage() {
  const [requests, setRequests] = useState<DdRequestRow[]>([]);
  const [taxonomyLabelById, setTaxonomyLabelById] = useState<Map<string, string>>(new Map());
  const [taxonomyLabelByCode, setTaxonomyLabelByCode] = useState<Map<string, string>>(new Map());
  const [stageCounts, setStageCounts] = useState<Record<DdFunnelStage, number>>(
    () => Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0])) as Record<DdFunnelStage, number>,
  );
  const [topProspects, setTopProspects] = useState<DdProspectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    setError(null);

    try {
      const supabase = createClient();

      const [requestsRes, topProspectsRes, stageResults] = await Promise.all([
        fetch("/api/donor-discovery/requests", { cache: "no-store" }),
        fetch(`/api/donor-discovery/prospects?stage=new&limit=${TOP_PROSPECTS_LIMIT}`, {
          cache: "no-store",
        }),
        Promise.all(
          FUNNEL_STAGES.map((stage) =>
            supabase
              .from("donor_discovery_prospects")
              .select("*", { count: "exact", head: true })
              .eq("pipeline_stage", stage),
          ),
        ),
      ]);

      let requestRows: DdRequestRow[] = [];
      if (!requestsRes.ok) {
        setError("Could not load Donor Discovery requests.");
      } else {
        const payload = (await requestsRes.json()) as { requests: DdRequestRow[] };
        requestRows = payload.requests ?? [];
        setRequests(requestRows);
      }

      let prospectRows: DdProspectRow[] = [];
      if (topProspectsRes.ok) {
        const payload = (await topProspectsRes.json()) as { data: DdProspectRow[] };
        prospectRows = payload.data ?? [];
        setTopProspects(prospectRows);
      }

      setStageCounts(
        Object.fromEntries(
          FUNNEL_STAGES.map((stage, i) => [stage, stageResults[i]?.count ?? 0]),
        ) as Record<DdFunnelStage, number>,
      );

      const taxonomyIds = Array.from(new Set(requestRows.flatMap((r) => r.taxonomy_ids ?? [])));
      const taxonomyCodes = Array.from(
        new Set(
          prospectRows.flatMap((p) =>
            [...(p.directory?.naics_codes ?? []), p.directory?.civic_kind].filter(
              (v): v is string => Boolean(v),
            ),
          ),
        ),
      );

      const [byIdRes, byCodeRes] = await Promise.all([
        taxonomyIds.length > 0
          ? supabase.from("donor_discovery_taxonomy").select("id, label").in("id", taxonomyIds)
          : Promise.resolve({ data: [] as { id: string; label: string }[] }),
        taxonomyCodes.length > 0
          ? supabase.from("donor_discovery_taxonomy").select("code, label").in("code", taxonomyCodes)
          : Promise.resolve({ data: [] as { code: string; label: string }[] }),
      ]);

      setTaxonomyLabelById(new Map((byIdRes.data ?? []).map((n) => [n.id, n.label])));
      setTaxonomyLabelByCode(new Map((byCodeRes.data ?? []).map((n) => [n.code, n.label])));
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Donor Discovery"
        description="Find and engage corporate donors matched to your mission."
        actions={
          <>
            <Link href="/donor-discovery/connectors">
              <Button variant="secondary">
                <Plug className="h-4 w-4" aria-hidden />
                Connectors
              </Button>
            </Link>
            <Link href="/donor-discovery/new">
              <Button>
                <Plus className="h-4 w-4" aria-hidden />
                New Discovery
              </Button>
            </Link>
          </>
        }
      />

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card title="Active Requests" description="Live progress for your discovery runs.">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-text-muted">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            Loading…
          </div>
        ) : requests.length === 0 ? (
          <EmptyState
            icon={Telescope}
            title="No discovery requests yet"
            description="Launch your first one to start building your prospect pipeline."
            action={
              <Link href="/donor-discovery/new">
                <Button size="sm">New Discovery</Button>
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {requests.map((req) => {
              const taxonomyIds = req.taxonomy_ids ?? [];
              const shownTaxonomyIds = taxonomyIds.slice(0, 3);
              const extraTaxonomyCount = taxonomyIds.length - shownTaxonomyIds.length;
              return (
                <div key={req.id} className="rounded-lg border border-border bg-surface p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-semibold text-text">{req.name}</p>
                    <Badge variant={STATUS_BADGE[req.status]} withDot className="shrink-0">
                      {humanizeEnum(req.status)}
                    </Badge>
                  </div>

                  {shownTaxonomyIds.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {shownTaxonomyIds.map((id) => (
                        <Badge key={id} color="teal">
                          {taxonomyLabelById.get(id) ?? "…"}
                        </Badge>
                      ))}
                      {extraTaxonomyCount > 0 && <Badge color="gray">+{extraTaxonomyCount}</Badge>}
                    </div>
                  )}

                  <p className="mt-2 text-xs text-text-muted">{formatGeography(req.geography)}</p>

                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                    <div
                      className={cn("h-full rounded-full transition-all", STATUS_BAR_CLASS[req.status])}
                      style={{ width: `${STATUS_PROGRESS_PCT[req.status]}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-text-muted">{countsSummary(req.counts)}</p>

                  <p className="mt-2 text-xs text-text-muted">{formatRelative(req.created_at)}</p>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card
        title="Pipeline Funnel"
        description="Prospects by stage across all requests — click a stage to filter Prospects."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {FUNNEL_STAGES.map((stage) => (
            <Link
              key={stage}
              href={`/donor-discovery/prospects?stage=${stage}`}
              className="rounded-lg border border-border p-3 text-center transition hover:border-primary hover:bg-primary/5"
            >
              <p className="text-2xl font-bold text-text">{loading ? "—" : stageCounts[stage]}</p>
              <p className="mt-1 text-xs font-medium text-text-muted">{humanizeEnum(stage)}</p>
            </Link>
          ))}
        </div>
      </Card>

      <Card title="Top Prospects" description="Highest-scoring new prospects awaiting review.">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-text-muted">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            Loading…
          </div>
        ) : topProspects.length === 0 ? (
          <EmptyState
            icon={Star}
            title="No new prospects yet"
            description="Scored prospects will appear here once a discovery request completes enumeration, enrichment, and scoring."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {topProspects.map((p) => {
              const taxonomyCode = p.directory?.naics_codes?.[0] ?? p.directory?.civic_kind ?? null;
              const taxonomyLabel = taxonomyCode
                ? taxonomyLabelByCode.get(taxonomyCode) ?? taxonomyCode
                : null;
              return (
                <div key={p.id} className="flex flex-col rounded-lg border border-border bg-surface p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-semibold text-text">
                      {p.directory?.legal_name ?? "Unknown company"}
                    </p>
                    <Badge variant={scoreBadgeVariant(p.score)} className="shrink-0">
                      {p.score != null ? p.score : "—"}
                    </Badge>
                  </div>
                  {taxonomyLabel && (
                    <Badge color="teal" className="mt-2 self-start">
                      {taxonomyLabel}
                    </Badge>
                  )}
                  {p.score_rationale && (
                    <p className="mt-2 line-clamp-2 text-xs text-text-muted">{p.score_rationale}</p>
                  )}
                  <Link
                    href={`/donor-discovery/prospects/${p.id}`}
                    className="mt-3 inline-flex items-center justify-center rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/5"
                  >
                    Review
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Scout Report">
        <div className="flex items-center gap-4 rounded-lg border border-dashed border-border p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden />
          </div>
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-text">
              Weekly Scout Report
              <Badge color="gray">Coming soon</Badge>
            </p>
            <p className="mt-0.5 text-xs text-text-muted">
              Your personalized digest of new high-scoring prospects.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
