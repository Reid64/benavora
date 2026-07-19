"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Plug, Plus, Sparkles, Star, Telescope } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Badge, Button, Card, EmptyState } from "@/components/ui";
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

const STATUS_BADGE_CLASS: Record<DdRequestStatus, string> = {
  queued: "bg-slate-100 text-slate-600",
  enumerating: "bg-[#DBEAFE] text-[#1D4ED8]",
  enriching: "bg-[#FEF3C7] text-[#92400E]",
  scoring: "bg-[#EDE9FE] text-[#6D28D9]",
  complete: "bg-[#DCFCE7] text-[#15803D]",
  failed: "bg-[#FEE2E2] text-[#B91C1C]",
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

function scoreBadgeClass(score: number | null): string {
  const shape = "px-2 py-0.5 rounded-full text-sm font-bold";
  if (score == null) return cn(shape, "bg-slate-100 text-slate-500");
  if (score > 70) return cn(shape, "bg-[#DCFCE7] text-[#15803D]");
  if (score >= 40) return cn(shape, "bg-[#FEF3C7] text-[#92400E]");
  return cn(shape, "bg-[#FEE2E2] text-[#B91C1C]");
}

export default function DonorDiscoveryPage() {
  const [requests, setRequests] = useState<DdRequestRow[]>([]);
  const [taxonomyLabelById, setTaxonomyLabelById] = useState<Map<string, string>>(new Map());
  const [taxonomyLabelByCode, setTaxonomyLabelByCode] = useState<Map<string, string>>(new Map());
  const [stageCounts, setStageCounts] = useState<Record<DdFunnelStage, number>>(
    () => Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0])) as Record<DdFunnelStage, number>,
  );
  const [topProspects, setTopProspects] = useState<DdProspectRow[]>([]);
  const [avgScore, setAvgScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    setError(null);

    try {
      const supabase = createClient();

      const [requestsRes, topProspectsRes, stageResults, scoreRes] = await Promise.all([
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
        supabase.from("donor_discovery_prospects").select("score").not("score", "is", null),
      ]);

      const scores = ((scoreRes.data ?? []) as Array<{ score: number | null }>)
        .map((row) => row.score)
        .filter((s): s is number => s != null);
      setAvgScore(scores.length > 0 ? Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length) : null);

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
  const activeRequestsCount = requests.filter((r) => ACTIVE_STATUSES.includes(r.status)).length;
  const totalProspects = Object.values(stageCounts).reduce((sum, n) => sum + n, 0);
  const highValueCount = stageCounts.new + stageCounts.reviewing;

  useEffect(() => {
    if (!hasActiveRequest) return;
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasActiveRequest, load]);

  const statCardStyle = {
    backgroundColor: "#F7F5F1",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
    border: "1px solid #D9D3C5",
  };
  const statLabelStyle = {
    fontSize: "11px",
    fontWeight: 700 as const,
    color: "#64748B",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
  };
  const statValueStyle = {
    fontSize: "28px",
    fontWeight: 900 as const,
    color: "#0F172A",
    marginTop: "6px",
  };

  return (
    <div className="space-y-6" style={{ backgroundColor: "#D6E4F0", padding: "24px", borderRadius: "16px" }}>
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
            <Link
              href="/donor-discovery/new"
              style={{ backgroundColor: "#EC4899" }}
              className="inline-flex items-center gap-2 hover:bg-[#DB2777] text-white px-6 py-3 rounded-xl font-bold text-sm shadow-md transition-colors"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Discover Prospects
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl p-5" style={statCardStyle}>
          <p style={statLabelStyle}>Total Prospects</p>
          <p style={statValueStyle}>{loading ? "—" : totalProspects}</p>
        </div>
        <div className="rounded-xl p-5" style={statCardStyle}>
          <p style={statLabelStyle}>Active Requests</p>
          <p style={statValueStyle}>{loading ? "—" : activeRequestsCount}</p>
        </div>
        <div className="rounded-xl p-5" style={statCardStyle}>
          <p style={statLabelStyle}>Avg Score</p>
          <p style={statValueStyle}>{loading || avgScore == null ? "—" : avgScore}</p>
        </div>
        <div className="rounded-xl p-5" style={statCardStyle}>
          <p style={statLabelStyle}>New &amp; Reviewing</p>
          <p style={statValueStyle}>{loading ? "—" : highValueCount}</p>
        </div>
      </div>

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
                <div
                  key={req.id}
                  className="bg-white rounded-xl shadow-sm border border-border p-5 mb-4"
                  style={{
                    backgroundColor: "#F7F5F1",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                    border: "1px solid #D9D3C5",
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-semibold text-text">{req.name}</p>
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                        STATUS_BADGE_CLASS[req.status],
                      )}
                    >
                      {humanizeEnum(req.status)}
                    </span>
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

                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#D9D3C5]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#00B4D8] to-[#0077B6] transition-all"
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
              className="bg-white shadow-sm rounded-lg border border-border px-4 py-3 text-center hover:border-[#0077B6] cursor-pointer transition-colors"
              style={{
                backgroundColor: "#F7F5F1",
                boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
              }}
            >
              <p className="text-2xl font-bold text-slate-900">{loading ? "—" : stageCounts[stage]}</p>
              <p className="text-xs text-slate-400 mt-1">{humanizeEnum(stage)}</p>
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
                <div
                  key={p.id}
                  className="flex flex-col rounded-lg border border-border bg-white p-4"
                  style={{
                    backgroundColor: "#F7F5F1",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                    border: "1px solid #D9D3C5",
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-semibold text-text">
                      {p.directory?.legal_name ?? "Unknown company"}
                    </p>
                    <span className={cn("shrink-0", scoreBadgeClass(p.score))}>
                      {p.score != null ? p.score : "—"}
                    </span>
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
