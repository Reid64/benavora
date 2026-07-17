"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { SearchConfiguration } from "@/app/(dashboard)/search-profiles/configure/SearchConfiguration";
import type { AgentType } from "@/types/agents";
import type { Enums } from "@/types/database";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  RESEARCH_RESOURCES,
  RESOURCE_CATEGORIES,
  type ResourceDefinition,
} from "@/lib/research/resource-registry";

type FunderCategory = Enums<"funder_category">;
type OppSourceType = Enums<"opportunity_source_type">;
type RunStatus = Enums<"agent_run_status">;

interface AgentRunRow {
  id: string;
  agent_type: AgentType;
  status: RunStatus | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  items_found: number | null;
  error_message: string | null;
}

interface OpportunityRow {
  id: string;
  name: string;
  source: string | null;
  source_type: OppSourceType | null;
  category: FunderCategory;
  amount_min: number | null;
  amount_max: number | null;
  deadline: string | null;
  eligibility_score: number | null;
  created_at: string;
}

/** Applied-status info for a discovered opportunity (TASK 4). */
interface AppliedInfo {
  id: string;
  stage: string;
  created_at: string;
}

/** Historical federal award row from historical_awards (USAspending.gov). */
interface HistoricalAwardRow {
  id: string;
  recipient_name: string | null;
  award_amount: number | null;
  award_date: string | null;
  awarding_agency: string | null;
  description: string | null;
}

const RESEARCH_AGENT_TYPES: AgentType[] = [
  "grants_gov_research",
  "sam_gov_research",
  "government_research",
  "state_portal",
  "corporate_research",
  "foundation_research",
  "local_sponsorship",
  "propublica_mining",
  "custom_api_research",
];

const POLL_INTERVAL_MS = 30_000;

function sourceBadgeProps(source: string | null, sourceType: OppSourceType | null): { label: string; variant: BadgeVariant } {
  let label = "Unknown";
  if (source) {
    try {
      label = new URL(source).hostname.replace(/^www\./, "");
    } catch {
      label = source.length > 18 ? source.slice(0, 18) + "..." : source;
    }
  } else if (sourceType) {
    label = sourceType.replace(/_/g, " ");
  }

  let variant: BadgeVariant = "neutral";
  if (sourceType === "government_federal") variant = "info";
  else if (sourceType === "government_state" || sourceType === "government_local") variant = "success";
  else if (sourceType === "corporate_giving") variant = "info";

  return { label, variant };
}

function formatAmount(min: number | null, max: number | null): string {
  const fmt = (n: number) =>
    n >= 1_000_000
      ? `$${(n / 1_000_000).toFixed(1)}M`
      : n >= 1_000
        ? `$${Math.round(n / 1_000)}K`
        : `$${n.toLocaleString()}`;
  if (min !== null && max !== null) return `${fmt(min)} – ${fmt(max)}`;
  if (max !== null) return `Up to ${fmt(max)}`;
  if (min !== null) return `From ${fmt(min)}`;
  return "—";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function categoryLabel(cat: FunderCategory): string {
  return cat
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Deadlines within 14 days (or already past) render in urgent red. */
function isDeadlineUrgent(iso: string | null): boolean {
  if (!iso) return false;
  const days = (new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return days <= 14;
}

/** Colored top-band accent per resource category: federal/registry = blue, health = teal, foundation/funder = purple, everything else (financial/statistical/registry data) = navy. */
function resourceAccentColor(category: string): string {
  const c = category.toLowerCase();
  if (c.includes("foundation") || c.includes("funder")) return "#6B48CC";
  if (c.includes("health")) return "#00B4D8";
  if (c.includes("federal") || c.includes("registry")) return "#0077B6";
  return "#1A2B3C";
}

function freshnessLabel(freshness: ResourceDefinition["dataFreshness"]): string {
  switch (freshness) {
    case "daily":
      return "Updated daily";
    case "weekly":
      return "Updated weekly";
    case "monthly":
      return "Updated monthly";
    case "static":
      return "Static reference";
    default:
      return "";
  }
}

function ResourceCard({ resource }: { resource: ResourceDefinition }) {
  const accent = resourceAccentColor(resource.category);
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "#FFFFFF",
        borderRadius: 12,
        padding: 16,
        boxShadow: "0 1px 3px rgba(15,23,42,0.08)",
        overflow: "hidden",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 6,
          backgroundColor: accent,
        }}
      />
      <span style={{ marginTop: 6, fontSize: 14, fontWeight: 700, color: "#0F172A" }}>
        {resource.name}
      </span>
      <span
        style={{
          display: "inline-block",
          marginTop: 6,
          alignSelf: "flex-start",
          backgroundColor: "#F1F5F9",
          color: "#475569",
          fontSize: 10,
          fontWeight: 600,
          padding: "2px 8px",
          borderRadius: 9999,
        }}
      >
        {resource.category}
      </span>
      <p style={{ fontSize: 12, color: "#64748B", marginTop: 8, lineHeight: 1.4, flex: 1 }}>
        {resource.description}
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        {resource.apiAvailable && (
          <span
            style={{
              backgroundColor: "#DCFCE7",
              color: "#15803D",
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 9999,
            }}
          >
            API Available
          </span>
        )}
        <span style={{ fontSize: 10, color: "#94A3B8" }}>
          {freshnessLabel(resource.dataFreshness)}
        </span>
      </div>
      <a
        href={resource.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          marginTop: 12,
          display: "inline-block",
          textAlign: "center",
          backgroundColor: "#0077B6",
          color: "#FFFFFF",
          fontSize: 12,
          fontWeight: 600,
          padding: "6px 0",
          borderRadius: 8,
          textDecoration: "none",
        }}
      >
        Visit
      </a>
    </div>
  );
}

function ResourcesSection() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [showAll, setShowAll] = useState(false);

  const query = searchQuery.trim().toLowerCase();
  const isSearching = query.length > 0;

  const pinnedResources = useMemo(
    () => RESEARCH_RESOURCES.filter((r) => r.isPinned),
    [],
  );
  const additionalResources = useMemo(
    () => RESEARCH_RESOURCES.filter((r) => !r.isPinned),
    [],
  );

  const matchesQuery = (r: ResourceDefinition) =>
    !query ||
    r.name.toLowerCase().includes(query) ||
    r.category.toLowerCase().includes(query);

  const searchResults = useMemo(() => {
    if (!isSearching) return [];
    return RESEARCH_RESOURCES.filter(
      (r) =>
        matchesQuery(r) &&
        (selectedCategory === "All" || r.category === selectedCategory),
    ).sort((a, b) => a.name.localeCompare(b.name));
  }, [isSearching, query, selectedCategory]);

  const groupedAdditional = useMemo(() => {
    const filtered = additionalResources
      .filter((r) => selectedCategory === "All" || r.category === selectedCategory)
      .sort((a, b) => a.name.localeCompare(b.name));
    const groups: Record<string, ResourceDefinition[]> = {};
    for (const r of filtered) {
      (groups[r.category] ??= []).push(r);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [additionalResources, selectedCategory]);

  return (
    <section style={{ marginTop: 8 }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: "#0F172A", margin: 0 }}>
          Research Resources
        </h2>
        <p style={{ fontSize: 13, color: "#64748B", marginTop: 4 }}>
          Authoritative data sources powering your grant research
        </p>
      </div>

      <div style={{ marginBottom: 20 }}>
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search resources..."
          aria-label="Search research resources"
          style={{
            width: "100%",
            maxWidth: 480,
            backgroundColor: "#FFFFFF",
            border: "1px solid #E2E8F0",
            borderRadius: 12,
            padding: "10px 16px",
            fontSize: 14,
            color: "#334155",
            outline: "none",
            boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
          }}
        />
      </div>

      {!isSearching && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
            gap: 16,
            marginBottom: 32,
          }}
        >
          {pinnedResources.map((r) => (
            <ResourceCard key={r.id} resource={r} />
          ))}
        </div>
      )}

      {isSearching && (
        <div style={{ marginBottom: 32 }}>
          <p style={{ fontSize: 12, color: "#64748B", marginBottom: 12 }}>
            {searchResults.length} resource{searchResults.length === 1 ? "" : "s"} match
            &ldquo;{searchQuery}&rdquo;
          </p>
          {searchResults.length === 0 ? (
            <div
              style={{
                backgroundColor: "#FFFFFF",
                borderRadius: 12,
                padding: 24,
                textAlign: "center",
                color: "#64748B",
                fontSize: 13,
                boxShadow: "0 1px 3px rgba(15,23,42,0.08)",
              }}
            >
              No resources match &ldquo;{searchQuery}&rdquo;.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                gap: 16,
              }}
            >
              {searchResults.map((r) => (
                <ResourceCard key={r.id} resource={r} />
              ))}
            </div>
          )}
        </div>
      )}

      {!isSearching && (
        <div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <h3 style={{ fontSize: 15, fontWeight: 600, color: "#0F172A", margin: 0 }}>
              All Resources
            </h3>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                aria-label="Filter resources by category"
                style={{
                  backgroundColor: "#FFFFFF",
                  border: "1px solid #E2E8F0",
                  borderRadius: 8,
                  padding: "6px 10px",
                  fontSize: 12,
                  color: "#334155",
                }}
              >
                <option value="All">All categories</option>
                {RESOURCE_CATEGORIES.slice()
                  .sort((a, b) => a.localeCompare(b))
                  .map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
              </select>
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                style={{
                  backgroundColor: "#0077B6",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: 8,
                  padding: "6px 14px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {showAll ? "Hide" : `Browse all ${additionalResources.length} resources`}
              </button>
            </div>
          </div>

          {showAll && (
            <div
              style={{
                backgroundColor: "#FFFFFF",
                borderRadius: 12,
                boxShadow: "0 1px 3px rgba(15,23,42,0.08)",
                padding: 16,
              }}
            >
              {groupedAdditional.length === 0 ? (
                <p style={{ fontSize: 13, color: "#64748B", margin: 0 }}>
                  No resources in this category.
                </p>
              ) : (
                groupedAdditional.map(([category, items]) => (
                  <div key={category} style={{ marginBottom: 16 }}>
                    <p
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        color: "#94A3B8",
                        marginBottom: 8,
                      }}
                    >
                      {category}
                    </p>
                    {items.map((r) => (
                      <div
                        key={r.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                          padding: "8px 0",
                          borderBottom: "1px solid #F1F5F9",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 500, color: "#0F172A" }}>
                            {r.name}
                          </span>
                          <span style={{ fontSize: 12, color: "#94A3B8", marginLeft: 8 }}>
                            {r.category}
                          </span>
                        </div>
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: "#0077B6",
                            whiteSpace: "nowrap",
                          }}
                        >
                          Visit →
                        </a>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

export default function ResearchPage() {
  const router = useRouter();
  const [view, setView] = useState<"research" | "config">("research");
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([]);
  const [agentRuns, setAgentRuns] = useState<AgentRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Free-text search across the discovered opportunities list.
  const [searchQuery, setSearchQuery] = useState("");

  // Applied-status (TASK 4) and historical awards (TASK 5).
  const [appsByOpp, setAppsByOpp] = useState<Record<string, AppliedInfo>>({});
  const [historicalAwards, setHistoricalAwards] = useState<HistoricalAwardRow[]>([]);
  const [pullingAwards, setPullingAwards] = useState(false);
  const [awardsError, setAwardsError] = useState<string | null>(null);

  const searchedOpportunities = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return opportunities;
    return opportunities.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        (o.source ?? "").toLowerCase().includes(q) ||
        categoryLabel(o.category).toLowerCase().includes(q),
    );
  }, [opportunities, searchQuery]);

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    const supabase = createClient();

    const [runsRes, oppsRes, appsRes, awardsRes] = await Promise.all([
      supabase
        .from("agent_runs")
        .select(
          "id, agent_type, status, started_at, completed_at, duration_ms, items_found, error_message",
        )
        .in("agent_type", RESEARCH_AGENT_TYPES)
        .order("started_at", { ascending: false, nullsFirst: false })
        .limit(50),
      supabase
        .from("opportunities")
        .select(
          "id, name, source, source_type, category, amount_min, amount_max, deadline, eligibility_score, created_at",
        )
        .not("source", "is", null)
        .neq("source", "manual")
        .order("created_at", { ascending: false })
        .limit(100),
      // Applications for the org (RLS-scoped) - drives the Applied status column.
      supabase
        .from("applications")
        .select("id, opportunity_id, stage, created_at"),
      // Historical federal awards (USAspending.gov) - competitive intelligence.
      supabase
        .from("historical_awards")
        .select(
          "id, recipient_name, award_amount, award_date, awarding_agency, description",
        )
        .order("award_amount", { ascending: false, nullsFirst: false })
        .limit(25),
    ]);

    if (!runsRes.error && runsRes.data) {
      const rows = runsRes.data as AgentRunRow[];
      setAgentRuns(rows.slice(0, 10));
    }

    if (!oppsRes.error && oppsRes.data) {
      setOpportunities(oppsRes.data as OpportunityRow[]);
    }

    if (!appsRes.error && appsRes.data) {
      const map: Record<string, AppliedInfo> = {};
      for (const a of appsRes.data as Array<{
        id: string;
        opportunity_id: string;
        stage: string;
        created_at: string;
      }>) {
        const prev = map[a.opportunity_id];
        // Keep the most recent application per opportunity.
        if (!prev || a.created_at > prev.created_at) {
          map[a.opportunity_id] = { id: a.id, stage: a.stage, created_at: a.created_at };
        }
      }
      setAppsByOpp(map);
    }

    if (!awardsRes.error && awardsRes.data) {
      setHistoricalAwards(awardsRes.data as HistoricalAwardRow[]);
    }

    if (initial) setLoading(false);
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  const hasLiveRun = agentRuns.some(
    (r) => r.status === "running" || r.status === "pending",
  );

  useEffect(() => {
    if (!hasLiveRun) return;
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasLiveRun, load]);

  async function handlePullAwards() {
    setPullingAwards(true);
    setAwardsError(null);
    try {
      const res = await fetch("/api/agents/usaspending", { method: "POST" });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setAwardsError(payload.error ?? "Could not pull historical awards.");
      }
    } catch {
      setAwardsError("Could not reach the USAspending agent. Please try again.");
    }
    setPullingAwards(false);
    await load();
  }

  return (
    <div className="space-y-8 page-bg" style={{ backgroundColor: "#E4E9F0" }}>
      {/* Header */}
      <PageHeader
        title="Research Command Center"
        description="Run research agents to discover funding opportunities from government, corporate, and foundation sources."
      />

      {/* Research / Search Configuration tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6" aria-label="Research tabs">
          {(
            [
              { key: "research", label: "Research" },
              { key: "config", label: "Search Configuration" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setView(t.key)}
              aria-current={view === t.key ? "page" : undefined}
              className={
                "whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition " +
                (view === t.key
                  ? "border-navy-900 text-navy-900"
                  : "border-transparent text-navy-500 hover:border-navy-300 hover:text-navy-700")
              }
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {view === "config" && <SearchConfiguration />}

      {view === "research" && (
        <>
      <ResourcesSection />

      {/* DISCOVERED OPPORTUNITIES */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold text-navy-900">
            Discovered Opportunities
            {!loading && (
              <span className="ml-2 text-sm font-normal text-navy-500">
                ({searchedOpportunities.length})
              </span>
            )}
          </h2>
        </div>

        <form
          onSubmit={(e) => e.preventDefault()}
          className="flex flex-col gap-3 sm:flex-row"
        >
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search discovered opportunities by name, source, or category..."
            aria-label="Search discovered opportunities"
            className="w-full bg-white border-2 border-slate-200 rounded-2xl px-6 py-4 text-base text-slate-700 placeholder-slate-400 focus:border-[#0077B6] focus:ring-4 focus:ring-[#0077B6]/10 outline-none shadow-sm"
          />
          <button
            type="submit"
            className="bg-[#0077B6] hover:bg-[#005F92] text-white px-6 py-4 rounded-2xl font-semibold shrink-0"
          >
            Search
          </button>
        </form>

        {loading ? (
          <div
            className="flex items-center justify-center rounded-xl border border-border bg-white p-10 text-sm text-slate-500"
            style={{
              backgroundColor: "#F7F5F1",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
              border: "1px solid #D9D3C5",
            }}
          >
            <Spinner className="mr-2 h-4 w-4 text-slate-400" />
            Loading opportunities...
          </div>
        ) : opportunities.length === 0 ? (
          <div
            className="rounded-xl border border-border bg-white p-10 text-center text-sm text-slate-500"
            style={{
              backgroundColor: "#F7F5F1",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
              border: "1px solid #D9D3C5",
            }}
          >
            No discovered opportunities yet. Run a research agent above to find
            funding sources.
          </div>
        ) : searchedOpportunities.length === 0 ? (
          <div
            className="rounded-xl border border-border bg-white p-10 text-center text-sm text-slate-500"
            style={{
              backgroundColor: "#F7F5F1",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
              border: "1px solid #D9D3C5",
            }}
          >
            No discovered opportunities match &ldquo;{searchQuery}&rdquo;.{" "}
            <button
              onClick={() => setSearchQuery("")}
              className="font-medium text-blue-600 hover:underline"
            >
              Clear search
            </button>
          </div>
        ) : (
          <div>
            {searchedOpportunities.map((opp) => {
              const badge = sourceBadgeProps(opp.source, opp.source_type);
              const applied = appsByOpp[opp.id];
              const urgent = isDeadlineUrgent(opp.deadline);
              return (
                <div
                  key={opp.id}
                  onClick={() => router.push(`/opportunities/${opp.id}`)}
                  className="bg-white rounded-xl shadow-sm border border-border p-5 mb-4 hover:shadow-md hover:border-[#00B4D8] transition-all cursor-pointer"
                  style={{
                    backgroundColor: "#F7F5F1",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                  }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-base font-semibold text-slate-900 hover:text-[#0077B6]">
                        {opp.name}
                      </h3>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="bg-[#EFF6FF] text-[#1D4ED8] px-2.5 py-1 rounded-full text-xs font-medium">
                          {badge.label}
                        </span>
                        <span className="text-xs text-slate-500">
                          {categoryLabel(opp.category)}
                        </span>
                        {opp.eligibility_score != null && (
                          <span className="text-xs text-slate-500">
                            · Eligibility {opp.eligibility_score}%
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[#15803D] font-bold">
                        {formatAmount(opp.amount_min, opp.amount_max)}
                      </p>
                      <p className={urgent ? "text-[#EF4444] font-medium" : "text-slate-400"}>
                        {opp.deadline ? formatDate(opp.deadline) : "No deadline"}
                      </p>
                    </div>
                  </div>

                  <div
                    className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-xs text-slate-400">
                      Discovered {formatDate(opp.created_at)}
                    </span>
                    {applied ? (
                      <div className="flex flex-col items-end">
                        <Badge variant="info">
                          {applied.stage
                            .replace(/_/g, " ")
                            .replace(/\b\w/g, (c) => c.toUpperCase())}
                        </Badge>
                        <span className="mt-1 text-xs text-slate-500">
                          Applied {formatDate(applied.created_at)}
                        </span>
                      </div>
                    ) : (
                      <Link
                        href={`/applications/new?opportunityId=${opp.id}`}
                        className="inline-flex items-center rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-white shadow-sm hover:bg-primary-hover"
                      >
                        Apply
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* HISTORICAL AWARDS (USAspending.gov competitive intelligence) */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Historical Awards
            </h2>
            <p className="text-xs text-slate-500">
              Who actually received similar federal grants - competitive
              intelligence from USAspending.gov (what funders funded, not just
              what they say they fund).
            </p>
          </div>
          <button
            onClick={() => void handlePullAwards()}
            disabled={pullingAwards}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-primary-hover disabled:opacity-60 transition-colors"
          >
            {pullingAwards && <Spinner className="h-4 w-4" />}
            {pullingAwards ? "Pulling..." : "Pull Historical Awards"}
          </button>
        </div>

        {awardsError && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {awardsError}
          </div>
        )}

        {historicalAwards.length === 0 ? (
          <div
            className="rounded-xl border border-border bg-white p-8 text-center text-sm text-slate-500"
            style={{
              backgroundColor: "#F7F5F1",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
              border: "1px solid #D9D3C5",
            }}
          >
            No historical awards yet. Pull awards to see who actually received
            grants like the ones you pursue.
          </div>
        ) : (
          <div
            className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm"
            style={{
              backgroundColor: "#F7F5F1",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
              border: "1px solid #D9D3C5",
            }}
          >
            <table className="min-w-full divide-y divide-slate-200">
              <thead>
                <tr
                  className="bg-sidebar"
                  style={{ backgroundColor: "#1A2B3C", color: "#FFFFFF" }}
                >
                  {["Recipient", "Amount", "Agency", "Date", "Description"].map(
                    (col) => (
                      <th
                        key={col}
                        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-white"
                      >
                        {col}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {historicalAwards.map((award) => (
                  <tr key={award.id}>
                    <td className="max-w-[200px] truncate px-4 py-3 text-sm font-medium text-slate-900">
                      {award.recipient_name ?? "Unknown recipient"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs font-medium text-slate-700">
                      {award.award_amount != null
                        ? `$${Math.round(award.award_amount).toLocaleString("en-US")}`
                        : "-"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {award.awarding_agency ?? "-"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                      {formatDate(award.award_date)}
                    </td>
                    <td className="max-w-[280px] truncate px-4 py-3 text-xs text-slate-500">
                      {award.description ?? "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* AGENT RUN HISTORY LINK (replaces the inline Agent Run Log) */}
      <div className="flex items-center justify-between border-t border-slate-200 pt-4">
        <Link
          href="/admin/audit-log"
          className="text-sm font-medium text-blue-600 hover:underline"
        >
          View agent run history →
        </Link>
        {hasLiveRun && (
          <span className="inline-flex items-center gap-1 text-xs text-blue-600">
            <Spinner className="h-3 w-3" />
            Auto-refreshing every 30s
          </span>
        )}
      </div>
        </>
      )}
    </div>
  );
}
