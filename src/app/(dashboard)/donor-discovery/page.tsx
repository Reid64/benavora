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
const INTENT_SIGNAL_LOOKBACK = 1000;

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

// Research & Discovery section signature accent — see
// governance/DESIGN_SYSTEM.md "Section Accent Colors" and
// src/lib/design/section-accents.ts. Matches the accent already applied to
// /research and /opportunities.
const SECTION_ACCENT = "#0284C7";
// Fixed bright teal — reserved for primary action buttons across every
// section, per PAGE_TREATMENT_PROTOCOL.md. Dark text for contrast, matching
// the precedent set on /research and /opportunities.
const CTA_TEAL_BG = "#22D3EE";
const CTA_TEAL_TEXT = "#0A1628";

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

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const [
        requestsRes,
        pipelineRes,
        intentSignalsRes,
        contactedCountRes,
        activeCampaignsRes,
        autoApplyRes,
      ] = await Promise.all([
        fetch("/api/donor-discovery/requests", { cache: "no-store" }),
        fetch("/api/donor-discovery/pipeline", { cache: "no-store" }),
        // High Intent stat + latest-signal-per-company reduction — RLS scopes
        // this to the caller's org (corporate_intent_signals, migration 093).
        supabase
          .from("corporate_intent_signals")
          .select("company_name, intent_score, created_at")
          .order("created_at", { ascending: false })
          .limit(INTENT_SIGNAL_LOOKBACK),
        // "Contacted This Month" — donor_discovery_prospects has no per-stage
        // transition timestamp, so this counts prospects in an engaged stage
        // whose row was created this month (a proxy, not a literal
        // moved-to-Contacted date — see file header).
        supabase
          .from("donor_discovery_prospects")
          .select("*", { count: "exact", head: true })
          .in("pipeline_stage", ["contacted", "applied", "received"])
          .gte("created_at", startOfMonth.toISOString()),
        // Active Outreach Campaigns — email_campaign_sequences, NOT
        // sales_campaigns (see file header for why).
        supabase
          .from("email_campaign_sequences")
          .select("*", { count: "exact", head: true })
          .eq("status", "active"),
        // Submissions via AutoApply — completed rows in this org's
        // submission_queue (migration 045_autoapply_tables.sql).
        supabase
          .from("submission_queue")
          .select("*", { count: "exact", head: true })
          .eq("status", "completed"),
      ]);

      setContactedThisMonth(contactedCountRes.count ?? 0);
      setActiveCampaignsCount(activeCampaignsRes.count ?? 0);
      setAutoApplySubmissionsCount(autoApplyRes.count ?? 0);

      const intentRows = (intentSignalsRes.data ?? []) as IntentSignalRow[];
      setRecentSignals(intentRows.slice(0, 5));
      const latestScoreByCompany = new Map<string, number | null>();
      for (const row of intentRows) {
        const key = row.company_name.trim().toLowerCase();
        if (!latestScoreByCompany.has(key)) latestScoreByCompany.set(key, row.intent_score);
      }
      setHighIntentCount(
        Array.from(latestScoreByCompany.values()).filter((s) => s != null && s >= HIGH_INTENT_THRESHOLD).length,
      );

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

  const statCardStyle = {
    backgroundColor: "#FFFFFF",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
    border: "1px solid #E2E8F0",
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

  // Dark #0D1526 stat-card row — matches intent-signals/page.tsx's StatCard
  // convention, distinct from the light #F7F5F1 cards used elsewhere on this
  // page (deliberate, per this feature's own build spec).
  function DarkStatCard({ label, value, color }: { label: string; value: string; color: string }) {
    return (
      <div
        style={{
          backgroundColor: "#0D1526",
          borderRadius: "14px",
          padding: "20px 24px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
        }}
      >
        <p
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: "#8BA8C8",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            margin: 0,
          }}
        >
          {label}
        </p>
        <p style={{ fontSize: "26px", fontWeight: 900, color, margin: "8px 0 0" }}>{value}</p>
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
      accent: "#0EA5E9",
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
      accent: "#EC4899",
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
      accent: "#8B5CF6",
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
      accent: "#F59E0B",
      icon: Radar,
      stat: `${highIntentCount} high-intent signal${highIntentCount === 1 ? "" : "s"}`,
      isEmpty: highIntentCount === 0,
      emptyHeadline: "No high-intent signals yet",
      ctaLabel: "View signals",
    },
  ];

  return (
    <div className="space-y-6" style={{ backgroundColor: "#E4E9F0", padding: "24px", borderRadius: "16px" }}>
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
              style={{ backgroundColor: CTA_TEAL_BG, color: CTA_TEAL_TEXT }}
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
        <div className="rounded-xl p-5" style={statCardStyle}>
          <p style={statLabelStyle}>Prospects Identified</p>
          <p style={accentStatValueStyle(SECTION_ACCENT)}>{loading ? "—" : totalProspects}</p>
        </div>
        <div className="rounded-xl p-5" style={statCardStyle}>
          <p style={statLabelStyle}>High-Intent Signals</p>
          <p style={accentStatValueStyle("#F59E0B")}>{loading ? "—" : highIntentCount}</p>
        </div>
        <div className="rounded-xl p-5" style={statCardStyle}>
          <p style={statLabelStyle}>Active Campaigns</p>
          <p style={accentStatValueStyle(SECTION_ACCENT)}>{loading ? "—" : activeCampaignsCount}</p>
        </div>
        <div className="rounded-xl p-5" style={statCardStyle}>
          <p style={statLabelStyle}>AutoApply Submissions</p>
          <p style={accentStatValueStyle("#10B981")}>{loading ? "—" : autoApplySubmissionsCount}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DarkStatCard
          label="Active Requests"
          value={loading ? "—" : String(activeRequestsCount)}
          color="#0EA5E9"
        />
        <DarkStatCard
          label="Avg Score"
          value={loading || avgScore == null ? "—" : String(avgScore)}
          color="#00B4D8"
        />
        <DarkStatCard
          label="New & Reviewing"
          value={loading ? "—" : String(highValueCount)}
          color="#8B5CF6"
        />
        <DarkStatCard
          label="Contacted This Month"
          value={loading ? "—" : String(contactedThisMonth)}
          color="#10B981"
        />
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
                backgroundColor: "#FFFFFF",
                boxShadow: "0 4px 20px rgba(0,0,0,0.10)",
                border: "1px solid #D9D3C5",
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
        <div style={{ backgroundColor: "#1A2B3C", borderRadius: "12px", padding: "20px", color: "white" }}>
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
            backgroundColor: "#FFFFFF",
            borderRadius: "12px",
            padding: "20px",
            boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
            border: "2px solid #E2E8F0",
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
                      backgroundColor: "#7C3AED",
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
                  className="bg-surface rounded-xl shadow-sm border border-border p-5 mb-4"
                  style={{
                    backgroundColor: "#FFFFFF",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                    border: "1px solid #E2E8F0",
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
              className="bg-surface shadow-sm rounded-lg border border-border px-4 py-3 text-center hover:border-[#0077B6] cursor-pointer transition-colors"
              style={{
                backgroundColor: "#FFFFFF",
                boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                border: "1px solid #E2E8F0",
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
                  className="flex flex-col rounded-lg border border-border bg-surface p-4"
                  style={{
                    backgroundColor: "#FFFFFF",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                    border: "1px solid #E2E8F0",
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
