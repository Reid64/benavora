"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { SearchConfiguration } from "@/app/(dashboard)/search-profiles/configure/SearchConfiguration";
import type { AgentType } from "@/types/agents";
import type { Enums } from "@/types/database";
import type { ResearchConfig } from "@/lib/research/org-research-config";
import { Badge, type BadgeVariant } from "@/components/ui/Badge";
import { PageHeader } from "@/components/layout/PageHeader";
import { ColorIcon } from "@/components/ui/ColorIcon";

type FunderCategory = Enums<"funder_category">;
type OppSourceType = Enums<"opportunity_source_type">;
type RunStatus = Enums<"agent_run_status">;

interface SourceConfig {
  key: string;
  label: string;
  agentType: AgentType;
}

interface SourceStats {
  lastRunAt: string | null;
  itemsFound: number | null;
}

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

const SOURCES: SourceConfig[] = [
  { key: "grants_gov", label: "Grants.gov", agentType: "grants_gov_research" },
  { key: "sam_gov", label: "SAM.gov", agentType: "sam_gov_research" },
  { key: "simpler_grants", label: "Simpler Grants", agentType: "government_research" },
  { key: "hud", label: "HUD", agentType: "government_research" },
  { key: "tdhca", label: "TDHCA", agentType: "state_portal" },
  { key: "state_scrapers", label: "State Scrapers", agentType: "state_portal" },
  { key: "corporate", label: "Corporate", agentType: "corporate_research" },
  { key: "foundation_finder", label: "Foundation Finder", agentType: "foundation_research" },
  { key: "housing_specific", label: "Housing Funders", agentType: "government_research" },
];

// Sources whose visibility is driven by the org's research_config. Sources NOT
// in this set (e.g. the foundation/housing scrapers) are always shown.
const CONFIG_MANAGED_SOURCES = new Set<string>([
  "grants_gov",
  "sam_gov",
  "simpler_grants",
  "hud",
  "tdhca",
  "state_scrapers",
  "corporate",
]);

// Source key -> dedicated agent route. Anything not listed uses /api/agents/research.
const SOURCE_ROUTE_MAP: Record<string, string> = {
  state_scrapers: "/api/agents/state-scrapers",
  foundation_finder: "/api/agents/foundation-finder",
  housing_specific: "/api/agents/housing-specific",
};

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

/**
 * Does a discovered opportunity belong to the given source card? Opportunities
 * carry a free-text `source` (usually a URL) and a `source_type` enum, so we
 * match on the source host/text, with corporate falling back to source_type.
 */
function opportunityMatchesSource(opp: OpportunityRow, sourceKey: string): boolean {
  const src = (opp.source ?? "").toLowerCase();
  switch (sourceKey) {
    case "grants_gov":
      return src.includes("grants.gov") || src.includes("grants_gov");
    case "sam_gov":
      return src.includes("sam.gov") || src.includes("sam_gov");
    case "simpler_grants":
      return src.includes("simpler");
    case "hud":
      return src.includes("hud");
    case "tdhca":
      return src.includes("tdhca");
    case "state_scrapers":
      return (
        opp.source_type === "government_state" &&
        !src.includes("tdhca")
      );
    case "corporate":
      return opp.source_type === "corporate_giving" || src.includes("corporate");
    default:
      return false;
  }
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
  const [sourceStats, setSourceStats] = useState<Record<string, SourceStats>>({});
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([]);
  const [agentRuns, setAgentRuns] = useState<AgentRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningAll, setRunningAll] = useState(false);
  const [runningSources, setRunningSources] = useState<Set<string>>(new Set());
  const [runError, setRunError] = useState<string | null>(null);
  // Clicking a source card filters Discovered Opportunities to that source.
  const [activeSource, setActiveSource] = useState<string | null>(null);
  // Free-text search across the discovered opportunities list.
  const [searchQuery, setSearchQuery] = useState("");

  // Applied-status (TASK 4) and historical awards (TASK 5).
  const [appsByOpp, setAppsByOpp] = useState<Record<string, AppliedInfo>>({});
  const [historicalAwards, setHistoricalAwards] = useState<HistoricalAwardRow[]>([]);
  const [pullingAwards, setPullingAwards] = useState(false);
  const [awardsError, setAwardsError] = useState<string | null>(null);

  // Org-specific research configuration from platform_config.
  const [researchConfig, setResearchConfig] = useState<ResearchConfig | null>(null);
  const [configFetched, setConfigFetched] = useState(false);
  const [configuringResearch, setConfiguringResearch] = useState(false);
  const [configureError, setConfigureError] = useState<string | null>(null);

  const visibleOpportunities = useMemo(
    () =>
      activeSource
        ? opportunities.filter((o) => opportunityMatchesSource(o, activeSource))
        : opportunities,
    [opportunities, activeSource],
  );
  const activeSourceLabel = activeSource
    ? (SOURCES.find((s) => s.key === activeSource)?.label ?? activeSource)
    : null;

  const searchedOpportunities = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return visibleOpportunities;
    return visibleOpportunities.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        (o.source ?? "").toLowerCase().includes(q) ||
        categoryLabel(o.category).toLowerCase().includes(q),
    );
  }, [visibleOpportunities, searchQuery]);

  // Sources filtered to the org's recommended list once config is loaded.
  const displayedSources = useMemo(() => {
    if (!configFetched || !researchConfig) return SOURCES;
    const recommended = new Set(researchConfig.recommended_sources as string[]);
    // Filter only the config-managed federal/state set; always show the others.
    return SOURCES.filter(
      (s) => !CONFIG_MANAGED_SOURCES.has(s.key) || recommended.has(s.key),
    );
  }, [configFetched, researchConfig]);

  const loadConfig = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("platform_config")
      .select("value")
      .eq("key", "research_config")
      .maybeSingle();
    const row = data as { value: string } | null;
    if (row?.value) {
      try {
        setResearchConfig(JSON.parse(row.value) as ResearchConfig);
      } catch {
        setResearchConfig(null);
      }
    } else {
      setResearchConfig(null);
    }
    setConfigFetched(true);
  }, []);

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
      const stats: Record<string, SourceStats> = {};
      for (const src of SOURCES) {
        const latest = rows.find((r) => r.agent_type === src.agentType);
        stats[src.key] = {
          lastRunAt: latest?.started_at ?? null,
          itemsFound: latest?.items_found ?? null,
        };
      }
      setSourceStats(stats);
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
    void loadConfig();
  }, [load, loadConfig]);

  const hasLiveRun = agentRuns.some(
    (r) => r.status === "running" || r.status === "pending",
  );

  useEffect(() => {
    if (!hasLiveRun) return;
    const timer = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [hasLiveRun, load]);

  async function handleRunAll() {
    setRunningAll(true);
    setRunError(null);
    try {
      const res = await fetch("/api/agents/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sources: ["all"] }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setRunError(payload.error ?? "Research run failed. Please try again.");
      }
    } catch {
      setRunError("Could not reach the research agent. Please try again.");
    }
    setRunningAll(false);
    await load();
  }

  async function handleRunSource(src: SourceConfig) {
    setRunningSources((prev) => {
      const next = new Set(prev);
      next.add(src.key);
      return next;
    });
    setRunError(null);
    try {
      const customUrl = SOURCE_ROUTE_MAP[src.key];
      const url = customUrl ?? "/api/agents/research";
      const body = customUrl ? {} : { sources: [src.key] };
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setRunError(payload.error ?? `${src.label} run failed. Please try again.`);
      }
    } catch {
      setRunError(`Could not reach the ${src.label} agent. Please try again.`);
    }
    setRunningSources((prev) => {
      const next = new Set(prev);
      next.delete(src.key);
      return next;
    });
    await load();
    // Running a single source auto-focuses its results (requirement 4).
    setActiveSource(src.key);
  }

  async function handleConfigureResearch() {
    setConfiguringResearch(true);
    setConfigureError(null);
    try {
      const res = await fetch("/api/agents/research-config", { method: "POST" });
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        config?: ResearchConfig;
      };
      if (!res.ok) {
        setConfigureError(
          payload.error ?? "Configuration failed. Please try again.",
        );
      } else if (payload.config) {
        setResearchConfig(payload.config);
        setConfigFetched(true);
      }
    } catch {
      setConfigureError("Could not reach the configuration service. Please try again.");
    }
    setConfiguringResearch(false);
  }

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
    <div className="space-y-8">
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
      {runError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {runError}
        </div>
      )}

      {configureError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {configureError}
        </div>
      )}

      {/* Banner shown when no org-specific config exists yet */}
      {configFetched && !researchConfig && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-sm text-blue-700">
              <strong>Showing all research sources.</strong> Run source
              configuration to customize which sources are most relevant for
              your organization.
            </p>
            <button
              onClick={() => void handleConfigureResearch()}
              disabled={configuringResearch}
              className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
            >
              {configuringResearch && <Spinner className="h-3 w-3" />}
              {configuringResearch ? "Analyzing..." : "Configure Research Sources"}
            </button>
          </div>
        </div>
      )}

      {/* CONTROL PANEL */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-navy-900">Control Panel</h2>
            {configFetched && researchConfig && (
              <button
                onClick={() => void handleConfigureResearch()}
                disabled={configuringResearch}
                className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-60"
              >
                {configuringResearch ? "Analyzing..." : "Reconfigure Sources"}
              </button>
            )}
          </div>
          <button
            onClick={handleRunAll}
            disabled={runningAll}
            className="inline-flex items-center gap-2 rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-60 transition-colors"
          >
            {runningAll && <Spinner className="h-4 w-4" />}
            {runningAll ? "Running..." : "Run All Research Agents"}
          </button>
        </div>

        {configFetched && researchConfig && (
          <p className="text-xs text-navy-500">
            Showing {displayedSources.length} of {SOURCES.length} recommended
            sources for your organization
          </p>
        )}

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-7">
          {displayedSources.map((src) => {
            const stats = sourceStats[src.key];
            const isRunning = runningSources.has(src.key);
            const isActive = activeSource === src.key;
            return (
              <div
                key={src.key}
                role="button"
                tabIndex={0}
                aria-pressed={isActive}
                onClick={() =>
                  setActiveSource((cur) => (cur === src.key ? null : src.key))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveSource((cur) => (cur === src.key ? null : src.key));
                  }
                }}
                className={`relative flex cursor-pointer flex-col overflow-hidden rounded-xl bg-surface p-4 shadow-sm transition-colors ${
                  isActive
                    ? "border-2 border-blue-400 ring-1 ring-blue-200"
                    : "border border-border hover:border-slate-300"
                }`}
              >
                <span className="absolute inset-x-0 top-0 h-[3px] bg-accent" aria-hidden />
                <div className="flex items-start justify-between gap-2">
                  <ColorIcon icon={Search} hue="cyan" size="sm" />
                  {isRunning && <Spinner className="h-4 w-4 shrink-0 text-blue-500" />}
                </div>
                <span className="mt-2 text-sm font-semibold text-slate-900 leading-tight">
                  {src.label}
                </span>

                <div className="mt-2 flex-1 space-y-1">
                  <p className="text-xs text-slate-500">
                    Last run:{" "}
                    <span className="font-medium">
                      {stats?.lastRunAt ? formatDate(stats.lastRunAt) : "Never"}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">
                    Found:{" "}
                    <span className="font-medium">
                      {stats?.itemsFound != null
                        ? stats.itemsFound.toLocaleString()
                        : "—"}
                    </span>
                  </p>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleRunSource(src);
                  }}
                  disabled={isRunning || runningAll}
                  className="mt-3 w-full rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-primary-hover disabled:opacity-50"
                >
                  {isRunning ? "Running..." : "Run"}
                </button>
              </div>
            );
          })}
        </div>
      </section>

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
          {activeSource && (
            <>
              <Badge variant="info">
                Filtered by {activeSourceLabel}
              </Badge>
              <button
                onClick={() => setActiveSource(null)}
                className="text-xs font-medium text-blue-600 underline-offset-2 hover:underline"
              >
                Show All
              </button>
            </>
          )}
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
          <div className="flex items-center justify-center rounded-xl border border-border bg-surface p-10 text-sm text-slate-500">
            <Spinner className="mr-2 h-4 w-4 text-slate-400" />
            Loading opportunities...
          </div>
        ) : opportunities.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-10 text-center text-sm text-slate-500">
            No discovered opportunities yet. Run a research agent above to find
            funding sources.
          </div>
        ) : visibleOpportunities.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-10 text-center text-sm text-slate-500">
            No discovered opportunities from {activeSourceLabel} yet.{" "}
            <button
              onClick={() => setActiveSource(null)}
              className="font-medium text-blue-600 hover:underline"
            >
              Show all sources
            </button>
          </div>
        ) : searchedOpportunities.length === 0 ? (
          <div className="rounded-xl border border-border bg-surface p-10 text-center text-sm text-slate-500">
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
                  className="bg-surface rounded-xl shadow-sm border border-border p-5 mb-4 hover:shadow-md hover:border-[#00B4D8] transition-all cursor-pointer"
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
          <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-slate-500">
            No historical awards yet. Pull awards to see who actually received
            grants like the ones you pursue.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-sm">
            <table className="min-w-full divide-y divide-slate-200">
              <thead>
                <tr className="bg-sidebar">
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
