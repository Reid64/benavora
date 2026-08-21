"use client";

// Donor Discovery Overview — 2026-07-20 rebuild adds a dark stat-card row and
// 3 quick-action cards on top of the pre-existing Active Requests / Pipeline
// Funnel / Top Prospects cards (kept, not discarded).
//
// Two deliberate deviations from the original task spec, documented so a
// future session doesn't reintroduce them:
//   - "Active Outreach Campaigns" reads `email_campaign_sequences`
//     (organization_id, status — migration 054_email_calendar_integration.sql),
//     NOT `sales_campaigns`. `sales_campaigns` (migration 055) is Benavora's
//     own admin-only, platform-level sales-outreach-to-prospective-nonprofit-
//     customers tool — it has no organization_id at all and is unrelated to a
//     nonprofit org's own corporate donor outreach. The real org-scoped
//     "campaign" concept for Donor Discovery's Corporate Outreach flow is
//     already `email_campaign_sequences` — see route-to-email/route.ts and
//     /api/intelligence/outreach/queue, which both write to it.
//   - "Contacted This Month" counts donor_discovery_prospects in an engaged
//     stage (contacted/applied/received) whose `created_at` falls in the
//     current calendar month. donor_discovery_prospects has no per-stage
//     transition timestamp, so this is an honest proxy, not a literal
//     "moved to Contacted this month" count.
//
// Pipeline Funnel + Top Prospects now come from GET /api/donor-discovery/pipeline
// (one server round trip) instead of 6 parallel per-stage count queries plus a
// separate top-prospects fetch issued directly from the browser.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Loader2,
  Mail,
  Plug,
  Plus,
  Radar,
  Rocket,
  Sparkles,
  Star,
  Store,
  Telescope,
} from "lucide-react";

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

interface PipelineStageData {
  count: number;
  top: DdProspectRow[];
}

interface PipelineResponse {
  stages: Record<string, PipelineStageData>;
  totalProspects: number;
  avgScore: number | null;
}

interface IntentSignalRow {
  company_name: string;
  intent_score: number | null;
  created_at: string;
}

const HIGH_INTENT_THRESHOLD = 75;

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

// Research & Discovery section treatment — PAGE_TREATMENT_PROTOCOL_V2.md /
// DESIGN_SYSTEM_V2_ASSIGNMENT.md. Frame: Bronze. Secondary accent: Slate
// Blue. 2026-08-18: confirmed via live getComputedStyle audit this page
// never received the v2 rollout - same real gap as AutoApply's.
const SECTION_ACCENT = "#A4712C";
const CTA_TEAL_BG = "#A4712C";
const CTA_TEAL_TEXT = "#F8F5EE";
// "Discover Prospects" is the page's primary action — Royal Violet, distinct
// from every other bronze/action color on the page.
const DISCOVER_BG = "#5B21B6";
// Rust — the top-prospects action color (Featured Prospect + Top Prospects
// list buttons).
const RUST = "#A3492F";
// The six action colors, one per funnel stage, in FUNNEL_STAGES order
// (new, reviewing, contacted, applied, received, rejected).
const FUNNEL_STAGE_COLORS: Record<DdFunnelStage, string> = {
  new: "#2E6B66",
  reviewing: "#7A5980",
  contacted: "#4F6D8F",
  applied: "#C17817",
  received: "#A3492F",
  rejected: "#5C6935",
};

/**
 * WGR-156: previously ignored `status` entirely, so a request that finished
 * with an empty `counts` JSONB (e.g. a bulk seed script that wrote prospects
 * directly rather than through the real dd-request-processor.ts worker, so
 * counts was never populated) rendered "Waiting to start..." under a
 * "Completed" status badge - a real, misleading display bug. `status` now
 * distinguishes "no counts yet because it hasn't run" from "no counts
 * because this completed request never recorded any" - only the former is
 * genuinely "Waiting to start...".
 */
function countsSummary(counts: DdRequestCounts | null, status: DdRequestStatus): string {
  const parts: string[] = [];
  if (counts?.enumerated != null) parts.push(`${counts.enumerated} enumerated`);
  if (counts?.enriched != null) parts.push(`${counts.enriched} enriched`);
  if (counts?.scored != null) parts.push(`${counts.scored} scored`);
  if (parts.length > 0) return parts.join(" | ");
  if (status === "complete") return "Completed - no counts recorded";
  return "Waiting to start...";
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
  const [recentSignals, setRecentSignals] = useState<IntentSignalRow[]>([]);
  const [avgScore, setAvgScore] = useState<number | null>(null);
  const [highIntentCount, setHighIntentCount] = useState(0);
  const [contactedThisMonth, setContactedThisMonth] = useState(0);
  const [activeCampaignsCount, setActiveCampaignsCount] = useState(0);
  const [autoApplySubmissionsCount, setAutoApplySubmissionsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    setError(null);

    try {
      const supabase = createClient();

      const [requestsRes, pipelineRes, statsRes] = await Promise.all([
        fetch("/api/donor-discovery/requests", { cache: "no-store" }),
        fetch("/api/donor-discovery/pipeline", { cache: "no-store" }),
        // High-Intent Signals + Live Intent Signals feed, Contacted This
        // Month, Active Campaigns, AutoApply Submissions — server-derived
        // organization_id scoping (see route file header for why this moved
        // off raw browser queries that relied solely on RLS).
        fetch("/api/donor-discovery/stats", { cache: "no-store" }),
      ]);

      if (statsRes.ok) {
        const stats = (await statsRes.json()) as {
          contactedThisMonth: number;
          activeCampaignsCount: number;
          autoApplySubmissionsCount: number;
          highIntentCount: number;
          recentSignals: IntentSignalRow[];
        };
        setContactedThisMonth(stats.contactedThisMonth);
        setActiveCampaignsCount(stats.activeCampaignsCount);
        setAutoApplySubmissionsCount(stats.autoApplySubmissionsCount);
        setHighIntentCount(stats.highIntentCount);
        setRecentSignals(stats.recentSignals ?? []);
      }

      let requestRows: DdRequestRow[] = [];
      if (!requestsRes.ok) {
        setError("Could not load Donor Discovery requests.");
      } else {
        const payload = (await requestsRes.json()) as { requests: DdRequestRow[] };
        requestRows = payload.requests ?? [];
        setRequests(requestRows);
      }

      let newStageTop: DdProspectRow[] = [];
      if (pipelineRes.ok) {
        const payload = (await pipelineRes.json()) as PipelineResponse;
        setStageCounts(
          Object.fromEntries(
            FUNNEL_STAGES.map((stage) => [stage, payload.stages?.[stage]?.count ?? 0]),
          ) as Record<DdFunnelStage, number>,
        );
        setAvgScore(payload.avgScore ?? null);
        newStageTop = payload.stages?.new?.top ?? [];
        setTopProspects(newStageTop);
      }

      const taxonomyIds = Array.from(new Set(requestRows.flatMap((r) => r.taxonomy_ids ?? [])));
      const taxonomyCodes = Array.from(
        new Set(
          newStageTop.flatMap((p) =>
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
  const mostRecentRequest = requests[0] ?? null;

  useEffect(() => {
    if (!hasActiveRequest) return;
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasActiveRequest, load]);

  const statFrameStyle = {
    backgroundColor: SECTION_ACCENT,
    borderRadius: "14px",
    boxShadow: "0 4px 20px rgba(164,113,44,0.22)",
    padding: "3px",
  };
  const statCardStyle = {
    backgroundColor: "#F8F5EE",
    borderRadius: "11px",
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
  const accentStatValueStyle = (color: string) => ({ ...statValueStyle, color });

  // Second stat row - unified with the Bronze frame/Ivory technique used by
  // the row above (2026-08-18); previously a separate dark #0D1526 card
  // style with 4 unrelated colors (sky/cyan/purple/green) for 4 plain counts
  // with no real status difference between them - the exact per-card
  // rainbow pattern PAGE_TREATMENT_PROTOCOL_V2.md rules out.
  function DarkStatCard({ label, value, accent = SECTION_ACCENT }: { label: string; value: string; accent?: string }) {
    return (
      <div style={statFrameStyle}>
        <div style={{ ...statCardStyle, padding: "20px 24px" }}>
          <p style={{ fontSize: "26px", fontWeight: 900, color: accent, margin: 0 }}>{value}</p>
          <p
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#64748B",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              margin: "8px 0 0",
            }}
          >
            {label}
          </p>
        </div>
      </div>
    );
  }

  interface QuickAction {
    key: string;
    label: string;
    description: string;
    href: string;
    accent: string;
    icon: typeof Rocket;
    stat: string;
    /** No org data behind this card yet — render the polished empty
     * treatment (headline + CTA chip) instead of a plain stat line. */
    isEmpty: boolean;
    emptyHeadline: string;
    ctaLabel: string;
  }

  const quickActions: QuickAction[] = [
    {
      key: "discover",
      label: "Discover Prospects",
      description: "Search nearby businesses by industry and add them to your pipeline.",
      href: "/donor-discovery/discover",
      accent: "#4F6D8F",
      icon: Rocket,
      stat: mostRecentRequest
        ? `Last run ${formatRelative(mostRecentRequest.created_at)} · ${totalProspects} in pipeline`
        : "No discovery runs yet",
      isEmpty: !mostRecentRequest,
      emptyHeadline: "No discovery runs yet",
      ctaLabel: "Run your first search",
    },
    {
      key: "marketplace",
      label: "Corporate Marketplace",
      description: "Browse and filter the shared corporate prospect pool by industry, ownership, and score.",
      href: "/donor-discovery/marketplace",
      accent: "#7A5980",
      icon: Store,
      stat: "Search by industry, ownership & propensity score",
      // Always a browse action, not org-specific data — treated as its own
      // "always actionable" empty-style card rather than a numeric stat.
      isEmpty: true,
      emptyHeadline: "Shared prospect pool, ready to filter",
      ctaLabel: "Browse marketplace",
    },
    {
      key: "outreach",
      label: "Corporate Outreach",
      description: "Compose and queue AI-personalized outreach to your prospects.",
      href: "/donor-discovery/outreach",
      accent: "#2E6B66",
      icon: Mail,
      stat: `${activeCampaignsCount} active campaign${activeCampaignsCount === 1 ? "" : "s"}`,
      isEmpty: activeCampaignsCount === 0,
      emptyHeadline: "No active campaigns yet",
      ctaLabel: "Compose outreach",
    },
    {
      key: "intent-signals",
      label: "Intent Signals",
      description: "AI-detected corporate giving indicators — act before the window closes.",
      href: "/donor-discovery/intent-signals",
      accent: "#C17817",
      icon: Radar,
      stat: `${highIntentCount} high-intent signal${highIntentCount === 1 ? "" : "s"}`,
      isEmpty: highIntentCount === 0,
      emptyHeadline: "No high-intent signals yet",
      ctaLabel: "View signals",
    },
  ];

  return (
    <div className="space-y-6" style={{ backgroundColor: "#D8D3C8", padding: "24px", borderRadius: "16px" }}>
      <PageHeader
        title="Donor Discovery"
        description="Find and engage corporate donors matched to your mission."
        accent={SECTION_ACCENT}
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
              style={{ backgroundColor: DISCOVER_BG, color: "#FFFFFF" }}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm shadow-md transition-opacity hover:opacity-90"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Discover Prospects
            </Link>
          </>
        }
      />

      {/* Prospects Identified / High-Intent Signals / Active Campaigns / AutoApply
          Submissions — the closest real metrics to this feature's "Outreach Sent"
          and "Conversions" spec, honestly labeled (there is no literal sent-count
          or conversion-count column to report instead). */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div style={statFrameStyle}>
          <div className="p-5" style={statCardStyle}>
            <p style={accentStatValueStyle("#2E6B66")}>{loading ? "—" : totalProspects}</p>
            <p style={statLabelStyle}>Prospects Identified</p>
          </div>
        </div>
        <div style={statFrameStyle}>
          <div className="p-5" style={statCardStyle}>
            <p style={accentStatValueStyle("#F59E0B")}>{loading ? "—" : highIntentCount}</p>
            <p style={statLabelStyle}>High-Intent Signals</p>
          </div>
        </div>
        <div style={statFrameStyle}>
          <div className="p-5" style={statCardStyle}>
            <p style={accentStatValueStyle("#7A5980")}>{loading ? "—" : activeCampaignsCount}</p>
            <p style={statLabelStyle}>Active Campaigns</p>
          </div>
        </div>
        <div style={statFrameStyle}>
          <div className="p-5" style={statCardStyle}>
            <p style={accentStatValueStyle("#10B981")}>{loading ? "—" : autoApplySubmissionsCount}</p>
            <p style={statLabelStyle}>AutoApply Submissions</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DarkStatCard label="Active Requests" value={loading ? "—" : String(activeRequestsCount)} accent="#4F6D8F" />
        <DarkStatCard label="Avg Score" value={loading || avgScore == null ? "—" : String(avgScore)} accent="#C17817" />
        <DarkStatCard label="New & Reviewing" value={loading ? "—" : String(highValueCount)} accent="#A3492F" />
        <DarkStatCard label="Contacted This Month" value={loading ? "—" : String(contactedThisMonth)} accent="#5C6935" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {quickActions.map((action) => {
          const Icon = action.icon;
          return (
            <Link
              key={action.key}
              href={action.href}
              className="group flex flex-col rounded-xl p-5 transition-transform hover:-translate-y-0.5"
              style={{
                backgroundColor: "#F8F5EE",
                boxShadow: `0 4px 20px ${action.accent}33`,
                border: `1.5px solid ${action.accent}66`,
              }}
            >
              <div className="flex items-start justify-between">
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${action.accent}1A` }}
                >
                  <Icon className="h-5 w-5" style={{ color: action.accent }} aria-hidden />
                </div>
                <ArrowUpRight
                  className="h-4 w-4 text-slate-300 transition-colors group-hover:text-slate-500"
                  aria-hidden
                />
              </div>
              <p className="mt-3 text-sm font-bold text-text">{action.label}</p>
              <p className="mt-1 text-xs text-text-muted">{action.description}</p>
              {loading ? (
                <p className="mt-3 text-xs font-semibold text-text-muted">Loading…</p>
              ) : action.isEmpty ? (
                <div className="mt-3">
                  <p className="text-xs font-medium text-text-muted">{action.emptyHeadline}</p>
                  <span
                    className="mt-2 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold"
                    style={{ backgroundColor: CTA_TEAL_BG, color: CTA_TEAL_TEXT }}
                  >
                    {action.ctaLabel}
                    <ArrowUpRight className="h-3 w-3" aria-hidden />
                  </span>
                </div>
              ) : (
                <p className="mt-3 text-xs font-semibold" style={{ color: action.accent }}>
                  {action.stat}
                </p>
              )}
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div style={{ backgroundColor: "#101B2D", borderRadius: "12px", padding: "20px", color: "white" }}>
          <p
            style={{
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.12em",
              color: "#F59E0B",
              marginBottom: "14px",
              textTransform: "uppercase",
            }}
          >
            Live Intent Signals
          </p>
          {loading ? (
            <p style={{ fontSize: "13px", color: "#8BA8C8" }}>Loading signals…</p>
          ) : recentSignals.length === 0 ? (
            <p style={{ fontSize: "13px", color: "#8BA8C8" }}>
              No intent signals detected yet — the Donor Intent Agent surfaces these as it runs.
            </p>
          ) : (
            <div className="space-y-2.5">
              {recentSignals.map((s, i) => {
                const score = s.intent_score;
                const badgeStyle =
                  score != null && score >= HIGH_INTENT_THRESHOLD
                    ? {
                        backgroundColor: "rgba(220,38,38,0.2)",
                        color: "#FCA5A5",
                        borderRadius: "4px",
                        padding: "2px 8px",
                        fontSize: "11px",
                        fontWeight: 700 as const,
                      }
                    : score != null && score >= 50
                      ? {
                          backgroundColor: "rgba(245,158,11,0.2)",
                          color: "#FCD34D",
                          borderRadius: "4px",
                          padding: "2px 8px",
                          fontSize: "11px",
                          fontWeight: 700 as const,
                        }
                      : null;
                const badgeLabel = score != null && score >= HIGH_INTENT_THRESHOLD ? "HIGH" : "MEDIUM";
                return (
                  <div key={`${s.company_name}-${i}`} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate" style={{ fontSize: "13px", fontWeight: 600, color: "#FFFFFF" }}>
                        {s.company_name}
                      </p>
                      <p style={{ fontSize: "11px", color: "#64748B" }}>{formatRelative(s.created_at)}</p>
                    </div>
                    {badgeStyle && <span style={badgeStyle}>{badgeLabel}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div
          style={{
            backgroundColor: "#F8F5EE",
            borderRadius: "12px",
            padding: "20px",
            boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
            border: "2px solid rgba(16,27,45,0.15)",
          }}
        >
          <p
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#64748B",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: "10px",
            }}
          >
            Featured Prospect
          </p>
          {loading ? (
            <p style={{ fontSize: "13px", color: "#64748B" }}>Loading…</p>
          ) : topProspects.length === 0 ? (
            <p style={{ fontSize: "13px", color: "#64748B" }}>
              No scored prospects yet — run Discover Prospects to build your pipeline.
            </p>
          ) : (
            (() => {
              const p = topProspects[0];
              if (!p) return null;
              const taxonomyCode = p.directory?.naics_codes?.[0] ?? p.directory?.civic_kind ?? null;
              const taxonomyLabel = taxonomyCode ? (taxonomyLabelByCode.get(taxonomyCode) ?? taxonomyCode) : null;
              return (
                <>
                  <p style={{ fontSize: "18px", fontWeight: 700, color: "#0F172A" }}>
                    {p.directory?.legal_name ?? "Unknown company"}
                  </p>
                  {taxonomyLabel && (
                    <span
                      style={{
                        display: "inline-block",
                        marginTop: "6px",
                        backgroundColor: "#EDE9FE",
                        color: "#6D28D9",
                        fontSize: "11px",
                        fontWeight: 700,
                        borderRadius: "999px",
                        padding: "2px 10px",
                      }}
                    >
                      {taxonomyLabel}
                    </span>
                  )}
                  {p.score_rationale && (
                    <p style={{ fontSize: "13px", color: "#64748B", marginTop: "10px" }}>{p.score_rationale}</p>
                  )}
                  <Link
                    href={`/donor-discovery/prospects/${p.id}`}
                    style={{
                      backgroundColor: RUST,
                      color: "white",
                      border: "none",
                      borderRadius: "8px",
                      padding: "10px 20px",
                      fontSize: "13px",
                      fontWeight: 600,
                      display: "inline-block",
                      marginTop: "14px",
                    }}
                  >
                    View Prospect
                  </Link>
                </>
              );
            })()
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <Card
        title="Active Requests"
        description="Live progress for your discovery runs."
        style={{
          backgroundColor: "#F8F5EE",
          border: "1px solid rgba(164,113,44,0.35)",
          boxShadow: "0 4px 16px rgba(16,27,45,0.10)",
        }}
      >
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
                  className="bg-surface rounded-xl shadow-sm border border-border p-5 mb-4"
                  style={{
                    backgroundColor: "#F8F5EE",
                    boxShadow: "0 2px 8px rgba(164,113,44,0.20)",
                    border: "1.5px solid rgba(164,113,44,0.4)",
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
                      className="h-full rounded-full bg-gradient-to-r from-[#D4A94D] to-[#A4712C] transition-all"
                      style={{ width: `${STATUS_PROGRESS_PCT[req.status]}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-text-muted">{countsSummary(req.counts, req.status)}</p>

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
        style={{
          backgroundColor: "#F8F5EE",
          border: "1px solid rgba(164,113,44,0.35)",
          boxShadow: "0 4px 16px rgba(16,27,45,0.10)",
        }}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {FUNNEL_STAGES.map((stage) => {
            const stageColor = FUNNEL_STAGE_COLORS[stage];
            return (
              <div
                key={stage}
                style={{
                  backgroundColor: stageColor,
                  borderRadius: "12px",
                  boxShadow: `0 4px 20px ${stageColor}38`,
                  padding: "3px",
                }}
              >
                <Link
                  href={`/donor-discovery/prospects?stage=${stage}`}
                  className="block cursor-pointer text-center transition-colors hover:opacity-90"
                  style={{
                    backgroundColor: "#F8F5EE",
                    borderRadius: "9px",
                    padding: "12px 16px",
                  }}
                >
                  <p style={{ fontSize: "24px", fontWeight: 700, color: stageColor }}>
                    {loading ? "—" : stageCounts[stage]}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">{humanizeEnum(stage)}</p>
                </Link>
              </div>
            );
          })}
        </div>
      </Card>

      <Card
        title="Top Prospects"
        description="Highest-scoring new prospects awaiting review."
        style={{
          backgroundColor: "#F8F5EE",
          border: "1px solid rgba(164,113,44,0.35)",
          boxShadow: "0 4px 16px rgba(16,27,45,0.10)",
        }}
      >
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
                  className="flex flex-col rounded-lg border border-border bg-surface p-4"
                  style={{
                    backgroundColor: "#F8F5EE",
                    boxShadow: "0 2px 8px rgba(164,113,44,0.20)",
                    border: "1.5px solid rgba(164,113,44,0.4)",
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
                    className="mt-3 inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-xs font-bold transition hover:opacity-90"
                    style={{ backgroundColor: RUST, color: "#FFFFFF" }}
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
