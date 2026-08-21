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
import {
  FUNDING_SOURCES,
  type FundingSource,
  type FundingSourceCategory,
  type FundingSourceType,
} from "@/lib/sources/funding-source-registry";

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
  if (c.includes("foundation") || c.includes("funder")) return "#7A5980";
  if (c.includes("health")) return "#2E6B66";
  if (c.includes("federal") || c.includes("registry")) return "#4F6D8F";
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
        backgroundColor: "#F8F5EE",
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
          backgroundColor: "#2E6B66",
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
            backgroundColor: "#F8F5EE",
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
                backgroundColor: "#F8F5EE",
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
                  backgroundColor: "#F8F5EE",
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
                  backgroundColor: "#2E6B66",
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
                backgroundColor: "#F8F5EE",
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
                            color: "#4F6D8F",
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

/**
 * Grouping labels for the Funding Source Directory.
 *
 * Deviation from the task's literal 6-group list (Federal, State and Local,
 * Private Foundations, Corporate, Faith-Based, Research Databases): the real
 * FUNDING_SOURCES array (funding-source-registry.ts) has no state/local
 * entries and no "foundation" entries that aren't also faith_based — that
 * data lives in a separate, differently-shaped registry
 * (state-sources-registry.ts, never seeded into the DB) which is out of
 * scope here. Grouping instead by the 5 source_type values that actually
 * exist in FUNDING_SOURCES, per this project's established practice of
 * reflecting real data over a literal spec (see funding-source-registry.ts
 * and migrations 093-097 for prior instances).
 */
const FUNDING_SOURCE_TYPE_LABELS: Record<FundingSourceType, string> = {
  federal: "Federal",
  nonprofit_intermediary: "Housing & Community Intermediaries",
  foundation: "Faith-Based Foundations",
  corporate: "Corporate",
  directory: "Research Databases",
};

const FUNDING_SOURCE_TYPE_ORDER: FundingSourceType[] = [
  "federal",
  "nonprofit_intermediary",
  "foundation",
  "corporate",
  "directory",
];

function fundingCategoryBadgeLabel(category: FundingSourceCategory): string {
  return category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface FundingSourcePollingRow {
  name: string;
  polling_enabled: boolean | null;
  active: boolean | null;
}

function FundingSourceDirectorySection() {
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pollingByName, setPollingByName] = useState<Record<string, boolean>>({});
  const [polling, setPolling] = useState(false);
  const [pollMessage, setPollMessage] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("funding_sources")
        .select("name, polling_enabled, active");
      if (!isMounted || !data) return;
      const map: Record<string, boolean> = {};
      for (const row of data as unknown as FundingSourcePollingRow[]) {
        map[row.name] = Boolean(row.polling_enabled) && row.active !== false;
      }
      setPollingByName(map);
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  const query = searchQuery.trim().toLowerCase();

  const filteredSources = useMemo(
    () =>
      query
        ? FUNDING_SOURCES.filter((s) => s.name.toLowerCase().includes(query))
        : FUNDING_SOURCES,
    [query],
  );

  const groupedSources = useMemo(() => {
    const groups: Record<string, FundingSource[]> = {};
    for (const source of filteredSources) {
      (groups[source.source_type] ??= []).push(source);
    }
    return FUNDING_SOURCE_TYPE_ORDER.map((t) => ({
      type: t,
      label: FUNDING_SOURCE_TYPE_LABELS[t],
      sources: (groups[t] ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    })).filter((group) => group.sources.length > 0);
  }, [filteredSources]);

  function toggleGroup(type: string) {
    setCollapsed((prev) => ({ ...prev, [type]: !prev[type] }));
  }

  async function handlePollNow() {
    setPolling(true);
    setPollMessage(null);
    setPollError(null);
    try {
      const res = await fetch("/api/sources/poll", { method: "POST" });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setPollError(payload.error ?? "Could not poll funding sources.");
      } else {
        setPollMessage("Poll complete. New opportunities will appear below shortly.");
      }
    } catch {
      setPollError("Could not reach the sources poll agent. Please try again.");
    }
    setPolling(false);
  }

  return (
    <section style={{ marginTop: 8 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "#0F172A", margin: 0 }}>
            Funding Source Directory
          </h2>
          <p style={{ fontSize: 13, color: "#64748B", marginTop: 4 }}>
            {FUNDING_SOURCES.length} funding sources monitored
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handlePollNow()}
          disabled={polling}
          style={{
            backgroundColor: "#2E6B66",
            color: "#FFFFFF",
            border: "none",
            borderRadius: 8,
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 600,
            cursor: polling ? "default" : "pointer",
            opacity: polling ? 0.7 : 1,
          }}
        >
          {polling ? "Polling..." : "Poll Now"}
        </button>
      </div>

      {pollMessage && (
        <div
          role="status"
          style={{
            marginBottom: 12,
            fontSize: 12,
            color: "#15803D",
            backgroundColor: "#DCFCE7",
            borderRadius: 8,
            padding: "8px 12px",
          }}
        >
          {pollMessage}
        </div>
      )}
      {pollError && (
        <div
          role="alert"
          style={{
            marginBottom: 12,
            fontSize: 12,
            color: "#B91C1C",
            backgroundColor: "#FEE2E2",
            borderRadius: 8,
            padding: "8px 12px",
          }}
        >
          {pollError}
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search funding sources by name..."
          aria-label="Search funding source directory"
          style={{
            width: "100%",
            maxWidth: 480,
            backgroundColor: "#F8F5EE",
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

      {groupedSources.length === 0 ? (
        <div
          style={{
            backgroundColor: "#F8F5EE",
            borderRadius: 12,
            padding: 24,
            textAlign: "center",
            color: "#64748B",
            fontSize: 13,
            boxShadow: "0 1px 3px rgba(15,23,42,0.08)",
          }}
        >
          No funding sources match &ldquo;{searchQuery}&rdquo;.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {groupedSources.map((group) => {
            const isCollapsed = Boolean(collapsed[group.type]);
            return (
              <div
                key={group.type}
                style={{
                  backgroundColor: "#F8F5EE",
                  borderRadius: 12,
                  boxShadow: "0 1px 3px rgba(15,23,42,0.08)",
                  overflow: "hidden",
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleGroup(group.type)}
                  aria-expanded={!isCollapsed}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "14px 16px",
                    backgroundColor: "#F8FAFC",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>
                    {group.label}
                    <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, color: "#64748B" }}>
                      ({group.sources.length})
                    </span>
                  </span>
                  <span style={{ fontSize: 12, color: "#64748B" }}>
                    {isCollapsed ? "Show ▾" : "Hide ▴"}
                  </span>
                </button>
                {!isCollapsed && (
                  <div>
                    {group.sources.map((source) => {
                      const link = source.website_url ?? source.api_url ?? null;
                      const isPolling = Boolean(pollingByName[source.name]);
                      return (
                        <div
                          key={source.name}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                            padding: "10px 16px",
                            borderTop: "1px solid #F1F5F9",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                            <span
                              aria-hidden="true"
                              title={isPolling ? "Polling enabled" : "Polling inactive"}
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: "50%",
                                backgroundColor: isPolling ? "#22C55E" : "#CBD5E1",
                                flexShrink: 0,
                              }}
                            />
                            <span
                              style={{
                                fontSize: 13,
                                fontWeight: 600,
                                color: "#0F172A",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {source.name}
                            </span>
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 600,
                                backgroundColor: "#F1F5F9",
                                color: "#475569",
                                padding: "2px 8px",
                                borderRadius: 9999,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {fundingCategoryBadgeLabel(source.category)}
                            </span>
                          </div>
                          {link ? (
                            <a
                              href={link}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: "#4F6D8F",
                                whiteSpace: "nowrap",
                                flexShrink: 0,
                              }}
                            >
                              Visit →
                            </a>
                          ) : (
                            <span style={{ fontSize: 12, color: "#94A3B8", flexShrink: 0 }}>
                              No link
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
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
    <div style={{ backgroundColor: "#D8D3C8", display: "flex", flexDirection: "column", gap: "32px" }}>
      {/* Header */}
      <PageHeader
        title="Research Command Center"
        description="Run research agents to discover funding opportunities from government, corporate, and foundation sources."
        accent="#A4712C"
      />

      {/* Research / Search Configuration tabs */}
      <div style={{ borderBottom: "1px solid #E2E8F0" }}>
        <nav style={{ display: "flex", gap: "24px" }} aria-label="Research tabs">
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
              style={{
                background: "none",
                border: "none",
                borderBottom: view === t.key ? "2px solid #A4712C" : "2px solid transparent",
                marginBottom: "-1px",
                padding: "12px 4px",
                fontSize: "14px",
                fontWeight: 600,
                color: view === t.key ? "#0F172A" : "#64748B",
                cursor: "pointer",
              }}
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

      <FundingSourceDirectorySection />

      {/* DISCOVERED OPPORTUNITIES */}
      <section style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px" }}>
          <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#0F172A", margin: 0 }}>
            Discovered Opportunities
            {!loading && (
              <span style={{ marginLeft: "8px", fontSize: "14px", fontWeight: 400, color: "#64748B" }}>
                ({searchedOpportunities.length})
              </span>
            )}
          </h2>
        </div>

        <form
          onSubmit={(e) => e.preventDefault()}
          style={{ display: "flex", flexDirection: "column", gap: "12px" }}
        >
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search discovered opportunities by name, source, or category..."
              aria-label="Search discovered opportunities"
              style={{
                flex: "1 1 320px",
                backgroundColor: "#F8F5EE",
                border: "1.5px solid #E2E8F0",
                borderRadius: "12px",
                padding: "12px 20px",
                fontSize: "14px",
                color: "#0F172A",
                outline: "none",
              }}
            />
            <button
              type="submit"
              style={{
                backgroundColor: "#2E6B66",
                color: "#FFFFFF",
                border: "none",
                borderRadius: "12px",
                padding: "12px 24px",
                fontSize: "14px",
                fontWeight: 700,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              Search
            </button>
          </div>
        </form>

        {loading ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#F8F5EE",
              boxShadow: "0 2px 8px rgba(164,113,44,0.16)",
              border: "1px solid #E2E8F0",
              borderRadius: "12px",
              padding: "40px",
              fontSize: "14px",
              color: "#64748B",
            }}
          >
            <Spinner className="mr-2 h-4 w-4" />
            Loading opportunities...
          </div>
        ) : opportunities.length === 0 ? (
          <div
            style={{
              backgroundColor: "#F8F5EE",
              boxShadow: "0 2px 8px rgba(164,113,44,0.16)",
              border: "1px solid #E2E8F0",
              borderRadius: "12px",
              padding: "40px",
              textAlign: "center",
              fontSize: "14px",
              color: "#64748B",
            }}
          >
            No discovered opportunities yet. Run a research agent above to find
            funding sources.
          </div>
        ) : searchedOpportunities.length === 0 ? (
          <div
            style={{
              backgroundColor: "#F8F5EE",
              boxShadow: "0 2px 8px rgba(164,113,44,0.16)",
              border: "1px solid #E2E8F0",
              borderRadius: "12px",
              padding: "40px",
              textAlign: "center",
              fontSize: "14px",
              color: "#64748B",
            }}
          >
            No discovered opportunities match &ldquo;{searchQuery}&rdquo;.{" "}
            <button
              onClick={() => setSearchQuery("")}
              style={{ fontWeight: 600, color: "#4F6D8F", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
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
                  style={{
                    backgroundColor: "#F8F5EE",
                    borderRadius: "12px",
                    boxShadow: "0 2px 8px rgba(164,113,44,0.16)",
                    border: "1px solid #E2E8F0",
                    padding: "20px",
                    marginBottom: "16px",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h3 style={{ fontSize: "15px", fontWeight: 700, color: "#0F172A", margin: 0 }}>
                        {opp.name}
                      </h3>
                      <div style={{ marginTop: "8px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                        <span
                          style={{
                            backgroundColor: "#EEF2F6",
                            color: "#4F6D8F",
                            padding: "3px 10px",
                            borderRadius: "999px",
                            fontSize: "11px",
                            fontWeight: 600,
                          }}
                        >
                          {badge.label}
                        </span>
                        <span style={{ fontSize: "12px", color: "#64748B" }}>
                          {categoryLabel(opp.category)}
                        </span>
                        {opp.eligibility_score != null && (
                          <span style={{ fontSize: "12px", color: "#64748B" }}>
                            &middot; Eligibility {opp.eligibility_score}%
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ flexShrink: 0, textAlign: "right" }}>
                      <p style={{ color: "#16A34A", fontWeight: 700, margin: 0 }}>
                        {formatAmount(opp.amount_min, opp.amount_max)}
                      </p>
                      <p style={{ margin: "4px 0 0 0", fontWeight: urgent ? 600 : 400, color: urgent ? "#EF4444" : "#94A3B8" }}>
                        {opp.deadline ? formatDate(opp.deadline) : "No deadline"}
                      </p>
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: "12px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      borderTop: "1px solid #F1F5F9",
                      paddingTop: "12px",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span style={{ fontSize: "12px", color: "#94A3B8" }}>
                      Discovered {formatDate(opp.created_at)}
                    </span>
                    {applied ? (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                        <Badge variant="info">
                          {applied.stage
                            .replace(/_/g, " ")
                            .replace(/\b\w/g, (c) => c.toUpperCase())}
                        </Badge>
                        <span style={{ marginTop: "4px", fontSize: "12px", color: "#64748B" }}>
                          Applied {formatDate(applied.created_at)}
                        </span>
                      </div>
                    ) : (
                      <Link
                        href={`/applications/new?opportunityId=${opp.id}`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          backgroundColor: "#2E6B66",
                          color: "#FFFFFF",
                          borderRadius: "8px",
                          padding: "4px 12px",
                          fontSize: "12px",
                          fontWeight: 600,
                          textDecoration: "none",
                        }}
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
      <section style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
          <div>
            <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#0F172A", margin: 0 }}>
              Historical Awards
            </h2>
            <p style={{ fontSize: "12px", color: "#64748B", marginTop: "4px" }}>
              Who actually received similar federal grants - competitive
              intelligence from USAspending.gov (what funders funded, not just
              what they say they fund).
            </p>
          </div>
          <button
            onClick={() => void handlePullAwards()}
            disabled={pullingAwards}
            style={{
              display: "inline-flex",
              flexShrink: 0,
              alignItems: "center",
              gap: "8px",
              backgroundColor: "#2E6B66",
              color: "#FFFFFF",
              borderRadius: "8px",
              border: "none",
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: 600,
              cursor: pullingAwards ? "default" : "pointer",
              opacity: pullingAwards ? 0.6 : 1,
            }}
          >
            {pullingAwards && <Spinner className="h-4 w-4" />}
            {pullingAwards ? "Pulling..." : "Pull Historical Awards"}
          </button>
        </div>

        {awardsError && (
          <div
            role="alert"
            style={{
              backgroundColor: "#FEF2F2",
              border: "1px solid #FECACA",
              borderRadius: "8px",
              padding: "12px 16px",
              fontSize: "13px",
              color: "#B91C1C",
            }}
          >
            {awardsError}
          </div>
        )}

        {historicalAwards.length === 0 ? (
          <div
            style={{
              backgroundColor: "#F8F5EE",
              boxShadow: "0 2px 8px rgba(164,113,44,0.16)",
              border: "1px solid #E2E8F0",
              borderRadius: "12px",
              padding: "32px",
              textAlign: "center",
              fontSize: "14px",
              color: "#64748B",
            }}
          >
            No historical awards yet. Pull awards to see who actually received
            grants like the ones you pursue.
          </div>
        ) : (
          <div
            style={{
              overflowX: "auto",
              backgroundColor: "#F8F5EE",
              boxShadow: "0 2px 8px rgba(164,113,44,0.16)",
              border: "1px solid #E2E8F0",
              borderRadius: "12px",
            }}
          >
            <table style={{ width: "100%", minWidth: "720px", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ backgroundColor: "#1A2B3C" }}>
                  {["Recipient", "Amount", "Agency", "Date", "Description"].map(
                    (col) => (
                      <th
                        key={col}
                        style={{
                          padding: "12px 16px",
                          textAlign: "left",
                          fontSize: "11px",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          color: "#FFFFFF",
                        }}
                      >
                        {col}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {historicalAwards.map((award) => (
                  <tr key={award.id} style={{ borderTop: "1px solid #F1F5F9" }}>
                    <td style={{ maxWidth: "200px", padding: "12px 16px", fontSize: "13px", fontWeight: 600, color: "#0F172A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {award.recipient_name ?? "Unknown recipient"}
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: "12px", fontWeight: 600, color: "#334155", whiteSpace: "nowrap" }}>
                      {award.award_amount != null
                        ? `$${Math.round(award.award_amount).toLocaleString("en-US")}`
                        : "-"}
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: "12px", color: "#475569" }}>
                      {award.awarding_agency ?? "-"}
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: "12px", color: "#475569", whiteSpace: "nowrap" }}>
                      {formatDate(award.award_date)}
                    </td>
                    <td style={{ maxWidth: "280px", padding: "12px 16px", fontSize: "12px", color: "#64748B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid #E2E8F0", paddingTop: "16px" }}>
        <Link
          href="/admin/audit-log"
          style={{ fontSize: "13px", fontWeight: 600, color: "#4F6D8F", textDecoration: "none" }}
        >
          View agent run history →
        </Link>
        {hasLiveRun && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#4F6D8F" }}>
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
