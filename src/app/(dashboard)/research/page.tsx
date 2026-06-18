"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { SearchConfiguration } from "@/app/(dashboard)/search-profiles/configure/SearchConfiguration";
import type { AgentType } from "@/types/agents";
import type { Enums } from "@/types/database";

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

const SOURCES: SourceConfig[] = [
  { key: "grants_gov", label: "Grants.gov", agentType: "grants_gov_research" },
  { key: "sam_gov", label: "SAM.gov", agentType: "sam_gov_research" },
  { key: "simpler_grants", label: "Simpler Grants", agentType: "government_research" },
  { key: "hud", label: "HUD", agentType: "government_research" },
  { key: "tdhca", label: "TDHCA", agentType: "state_portal" },
  { key: "state_scrapers", label: "State Scrapers", agentType: "state_portal" },
  { key: "corporate", label: "Corporate", agentType: "corporate_research" },
];

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

function sourceBadgeProps(source: string | null, sourceType: OppSourceType | null): { label: string; cls: string } {
  let label = "Unknown";
  if (source) {
    try {
      label = new URL(source).hostname.replace(/^www\./, "");
    } catch {
      label = source.length > 18 ? source.slice(0, 18) + "â€¦" : source;
    }
  } else if (sourceType) {
    label = sourceType.replace(/_/g, " ");
  }

  let cls = "bg-gray-100 text-gray-600";
  if (sourceType === "government_federal") cls = "bg-blue-100 text-blue-700";
  else if (sourceType === "government_state" || sourceType === "government_local") cls = "bg-green-100 text-green-700";
  else if (sourceType === "corporate_giving") cls = "bg-purple-100 text-purple-700";

  return { label, cls };
}

function formatAmount(min: number | null, max: number | null): string {
  const fmt = (n: number) =>
    n >= 1_000_000
      ? `$${(n / 1_000_000).toFixed(1)}M`
      : n >= 1_000
        ? `$${Math.round(n / 1_000)}K`
        : `$${n.toLocaleString()}`;
  if (min !== null && max !== null) return `${fmt(min)} â€“ ${fmt(max)}`;
  if (max !== null) return `Up to ${fmt(max)}`;
  if (min !== null) return `From ${fmt(min)}`;
  return "â€”";
}

function formatDate(iso: string | null): string {
  if (!iso) return "â€”";
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

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    const supabase = createClient();

    const [runsRes, oppsRes] = await Promise.all([
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
      const isStateScraper = src.key === "state_scrapers";
      const url = isStateScraper
        ? "/api/agents/state-scrapers"
        : "/api/agents/research";
      const body = isStateScraper ? {} : { sources: [src.key] };
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

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
          Research Command Center
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Run research agents to discover funding opportunities from government,
          corporate, and foundation sources.
        </p>
      </div>

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

      {/* CONTROL PANEL */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-navy-900">Control Panel</h2>
          <button
            onClick={handleRunAll}
            disabled={runningAll}
            className="inline-flex items-center gap-2 rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-60 transition-colors"
          >
            {runningAll && <Spinner className="h-4 w-4" />}
            {runningAll ? "Runningâ€¦" : "Run All Research Agents"}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-7">
          {SOURCES.map((src) => {
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
                className={`flex cursor-pointer flex-col rounded-xl bg-white p-4 shadow-sm transition-colors ${
                  isActive
                    ? "border-2 border-blue-400 ring-1 ring-blue-200"
                    : "border border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="flex items-start justify-between gap-1">
                  <span className="text-sm font-semibold text-navy-900 leading-tight">
                    {src.label}
                  </span>
                  {isRunning && <Spinner className="h-4 w-4 shrink-0 text-blue-500" />}
                </div>

                <div className="mt-2 flex-1 space-y-1">
                  <p className="text-xs text-navy-500">
                    Last run:{" "}
                    <span className="font-medium">
                      {stats?.lastRunAt ? formatDate(stats.lastRunAt) : "Never"}
                    </span>
                  </p>
                  <p className="text-xs text-navy-500">
                    Found:{" "}
                    <span className="font-medium">
                      {stats?.itemsFound != null
                        ? stats.itemsFound.toLocaleString()
                        : "â€”"}
                    </span>
                  </p>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleRunSource(src);
                  }}
                  disabled={isRunning || runningAll}
                  className="mt-3 w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs font-medium text-navy-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  {isRunning ? "Runningâ€¦" : "Run"}
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
                ({visibleOpportunities.length})
              </span>
            )}
          </h2>
          {activeSource && (
            <>
              <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                Filtered by {activeSourceLabel}
              </span>
              <button
                onClick={() => setActiveSource(null)}
                className="text-xs font-medium text-blue-600 underline-offset-2 hover:underline"
              >
                Show All
              </button>
            </>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center rounded-xl border border-gray-200 bg-white p-10 text-sm text-navy-500">
            <Spinner className="mr-2 h-4 w-4 text-navy-400" />
            Loading opportunitiesâ€¦
          </div>
        ) : opportunities.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-navy-500">
            No discovered opportunities yet. Run a research agent above to find
            funding sources.
          </div>
        ) : visibleOpportunities.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-navy-500">
            No discovered opportunities from {activeSourceLabel} yet.{" "}
            <button
              onClick={() => setActiveSource(null)}
              className="font-medium text-blue-600 hover:underline"
            >
              Show all sources
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr className="bg-gray-50">
                  {[
                    "Name",
                    "Source",
                    "Category",
                    "Amount Range",
                    "Deadline",
                    "Eligibility",
                    "Discovered",
                  ].map((col) => (
                    <th
                      key={col}
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-navy-500"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visibleOpportunities.map((opp) => {
                  const badge = sourceBadgeProps(opp.source, opp.source_type);
                  return (
                    <tr
                      key={opp.id}
                      onClick={() => router.push(`/opportunities/${opp.id}`)}
                      className="cursor-pointer hover:bg-gray-50 transition-colors"
                    >
                      <td className="max-w-[200px] truncate px-4 py-3 text-sm font-medium text-navy-900">
                        {opp.name}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-navy-600">
                        {categoryLabel(opp.category)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-navy-600">
                        {formatAmount(opp.amount_min, opp.amount_max)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-navy-600">
                        {formatDate(opp.deadline)}
                      </td>
                      <td className="px-4 py-3 text-xs text-navy-600">
                        {opp.eligibility_score != null
                          ? `${opp.eligibility_score}%`
                          : "â€”"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-navy-500">
                        {formatDate(opp.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* AGENT RUN HISTORY LINK (replaces the inline Agent Run Log) */}
      <div className="flex items-center justify-between border-t border-gray-200 pt-4">
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

