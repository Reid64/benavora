"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart2,
  Database,
  FileText,
  GitBranch,
  Search,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";

import { Badge, Card, LoadingSpinner } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/utils/formatters";
import { ComplianceLibrary } from "@/lib/intelligence/compliance-library";
import { EVALUATION_TEMPLATES, KPI_DATABASE } from "@/lib/intelligence/data/evaluation-templates";

// ─── Categories ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  "housing",
  "substance_abuse",
  "workforce",
  "youth",
  "food",
  "mental_health",
  "reentry",
  "veterans",
  "faith_based",
  "education",
] as const;
type Category = (typeof CATEGORIES)[number];

const CATEGORY_LABELS: Record<Category, string> = {
  housing: "Housing",
  substance_abuse: "Substance Abuse",
  workforce: "Workforce",
  youth: "Youth",
  food: "Food Security",
  mental_health: "Mental Health",
  reentry: "Reentry",
  veterans: "Veterans",
  faith_based: "Faith-Based",
  education: "Education",
};

const CATEGORY_KEYWORDS: Record<Category, string[]> = {
  housing: ["housing", "shelter", "homeless", "affordable"],
  substance_abuse: ["substance", "opioid", "addiction", "drug", "alcohol"],
  workforce: ["workforce", "employment", "job", "labor", "career"],
  youth: ["youth", "child", "teen", "juvenile", "young"],
  food: ["food", "hunger", "nutrition", "meal", "pantry"],
  mental_health: ["mental health", "behavioral", "psychiatric", "counseling"],
  reentry: ["reentry", "re-entry", "incarcerated", "justice"],
  veterans: ["veteran", "military", "service member"],
  faith_based: ["faith", "church", "religious", "congregation"],
  education: ["education", "literacy", "school", "learning", "academic"],
};

function textMatchesCategory(text: string, cat: Category): boolean {
  const lower = text.toLowerCase();
  return CATEGORY_KEYWORDS[cat].some((kw) => lower.includes(kw));
}

function arrayMatchesCategory(arr: unknown, cat: Category): boolean {
  if (!Array.isArray(arr)) return false;
  return arr.some(
    (v) => typeof v === "string" && textMatchesCategory(v, cat),
  );
}

// Maps dashboard categories to the static EVALUATION_TEMPLATES keys (Night 2
// build — 7 of 10 categories have named KPI templates; the rest have none,
// which is real coverage information, not a bug).
const EVAL_TEMPLATE_KEY: Partial<Record<Category, string>> = {
  housing: "housing",
  substance_abuse: "substance_abuse_treatment",
  workforce: "workforce_development",
  youth: "youth_programs",
  food: "food_assistance",
  mental_health: "mental_health",
  reentry: "reentry_criminal_justice",
};

const complianceLibrary = new ComplianceLibrary();

// ─── Types ─────────────────────────────────────────────────────────────────────

type Stats = {
  proposals: number;
  sections: number;
  needData: number;
  grantmakerProfiles: number;
  budgetPatterns: number;
  totalKpis: number;
};

type HeatCell = {
  funded_proposals: number;
  rubrics: number;
  logic_models: number;
  need_data: number;
  budget_patterns: number;
  evaluation: number;
  compliance: number;
  grantmaker_profiles: number;
};

type HeatMap = Record<Category, HeatCell>;

type RecentIngestion = {
  id: string;
  type: string;
  label: string;
  source: string;
  created_at: string;
};

type FreshnessItem = {
  name: string;
  lastUpdated: string | null;
  /** True for bundled static datasets (no DB ingestion timestamp) — shown neutrally instead of "stale". */
  isStatic?: boolean;
};

type SearchResultItem = {
  kb_type: string;
  id: string;
  title: string;
  excerpt?: string;
};

// ─── Constants ─────────────────────────────────────────────────────────────────

// ids match UnifiedIntelligenceSearch's KBType enum exactly — the API's
// switch has no default case, so a mismatched id throws instead of filtering.
const KB_FILTER_TYPES = [
  { id: "all", label: "All" },
  { id: "funded_proposal", label: "Proposals" },
  { id: "rubric", label: "Rubrics" },
  { id: "logic_model", label: "Logic Models" },
  { id: "need_data", label: "Need Data" },
  { id: "budget_pattern", label: "Budget" },
  { id: "evaluation", label: "Evaluation" },
  { id: "compliance", label: "Compliance" },
  { id: "grantmaker", label: "Funders" },
];

const HEAT_COLS = [
  { key: "funded_proposals" as const, label: "Proposals" },
  { key: "rubrics" as const, label: "Rubrics" },
  { key: "logic_models" as const, label: "Logic Models" },
  { key: "need_data" as const, label: "Need Data" },
  { key: "budget_patterns" as const, label: "Budget" },
  { key: "evaluation" as const, label: "Evaluation" },
  { key: "compliance" as const, label: "Compliance" },
  { key: "grantmaker_profiles" as const, label: "Funders" },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function cellColorClass(count: number): string {
  if (count === 0) return "bg-red-500/10 text-red-400";
  if (count < 3) return "bg-amber-500/10 text-amber-300";
  if (count < 10) return "bg-yellow-500/10 text-yellow-200";
  return "bg-green-500/10 text-green-400";
}

function freshnessColorClass(lastUpdated: string | null): string {
  if (!lastUpdated) return "text-red-400";
  const days = (Date.now() - new Date(lastUpdated).getTime()) / 86_400_000;
  if (days < 30) return "text-green-400";
  if (days < 90) return "text-amber-400";
  return "text-red-400";
}

function freshnessLabel(lastUpdated: string | null): string {
  if (!lastUpdated) return "Never";
  const days = Math.floor(
    (Date.now() - new Date(lastUpdated).getTime()) / 86_400_000,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

function groupResultsByKbType(
  results: SearchResultItem[],
): [string, SearchResultItem[]][] {
  const groups = new Map<string, SearchResultItem[]>();
  for (const r of results) {
    const bucket = groups.get(r.kb_type);
    if (bucket) bucket.push(r);
    else groups.set(r.kb_type, [r]);
  }
  return Array.from(groups.entries());
}

function typeBadgeColor(
  type: string,
): "teal" | "navy" | "purple" | "green" | "yellow" | "sky" | "orange" | "pink" {
  const t = type.toLowerCase();
  if (t.includes("proposal") || t.includes("funded")) return "teal";
  if (t.includes("rubric")) return "purple";
  if (t.includes("logic")) return "sky";
  if (t.includes("budget")) return "yellow";
  if (t.includes("evaluation") || t.includes("kpi")) return "pink";
  if (t.includes("compliance")) return "orange";
  if (t.includes("grantmaker") || t.includes("funder") || t.includes("profile")) return "green";
  return "navy";
}

// ─── Main component ─────────────────────────────────────────────────────────────

export default function IntelligenceLibraryDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats>({
    proposals: 0,
    sections: 0,
    needData: 0,
    grantmakerProfiles: 0,
    budgetPatterns: 0,
    totalKpis: KPI_DATABASE.length,
  });
  const [heatMap, setHeatMap] = useState<HeatMap | null>(null);
  const [recent, setRecent] = useState<RecentIngestion[]>([]);
  const [freshness, setFreshness] = useState<FreshnessItem[]>([]);

  const [searchQuery, setSearchQuery] = useState("");
  const [kbFilter, setKbFilter] = useState("all");
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    // Counts
    const [
      proposalsCount,
      sectionsCount,
      needDataCount,
      budgetPatternsCount,
      grantmakerProfilesCount,
    ] = await Promise.all([
      supabase.from("intelligence_funded_proposals").select("id", { count: "exact", head: true }),
      supabase.from("intelligence_proposal_sections").select("id", { count: "exact", head: true }),
      supabase.from("intelligence_need_data").select("id", { count: "exact", head: true }),
      supabase.from("intelligence_budget_patterns").select("id", { count: "exact", head: true }),
      supabase.from("intelligence_grantmaker_profiles").select("id", { count: "exact", head: true }),
    ]);

    setStats({
      proposals: proposalsCount.count ?? 0,
      sections: sectionsCount.count ?? 0,
      needData: needDataCount.count ?? 0,
      budgetPatterns: budgetPatternsCount.count ?? 0,
      grantmakerProfiles: grantmakerProfilesCount.count ?? 0,
      // Static bundled dataset (data/evaluation-templates.ts) — not a DB table, see STATE_OF_THE_BUILD.md KB7 note.
      totalKpis: KPI_DATABASE.length,
    });

    // Category fields for heat map
    const [
      proposalCatsRes,
      rubricCatsRes,
      logicCatsRes,
      needDataTypesRes,
      budgetCatsRes,
      grantmakerPrioritiesRes,
    ] = await Promise.all([
      supabase.from("intelligence_funded_proposals").select("category"),
      supabase.from("intelligence_scoring_rubrics").select("category"),
      supabase.from("intelligence_logic_models").select("category"),
      supabase.from("intelligence_need_data").select("data_type, source"),
      supabase.from("intelligence_budget_patterns").select("program_category"),
      supabase.from("intelligence_grantmaker_profiles").select("program_priorities"),
    ]);

    const hm = {} as HeatMap;
    for (const cat of CATEGORIES) {
      hm[cat] = {
        funded_proposals: (proposalCatsRes.data ?? []).filter((r) =>
          arrayMatchesCategory(r.category, cat),
        ).length,
        rubrics: (rubricCatsRes.data ?? []).filter((r) =>
          arrayMatchesCategory(r.category, cat),
        ).length,
        logic_models: (logicCatsRes.data ?? []).filter(
          (r) => typeof r.category === "string" && textMatchesCategory(r.category, cat),
        ).length,
        need_data: (needDataTypesRes.data ?? []).filter(
          (r) =>
            (typeof r.data_type === "string" && textMatchesCategory(r.data_type, cat)) ||
            (typeof r.source === "string" && textMatchesCategory(r.source, cat)),
        ).length,
        budget_patterns: (budgetCatsRes.data ?? []).filter(
          (r) =>
            typeof r.program_category === "string" &&
            textMatchesCategory(r.program_category, cat),
        ).length,
        grantmaker_profiles: (grantmakerPrioritiesRes.data ?? []).filter((r) =>
          arrayMatchesCategory(r.program_priorities, cat),
        ).length,
        // Static bundled datasets — no DB round-trip, computed from the same
        // library code the draft generator actually calls.
        evaluation: (() => {
          const key = EVAL_TEMPLATE_KEY[cat];
          return key ? (EVALUATION_TEMPLATES[key]?.kpis.length ?? 0) : 0;
        })(),
        compliance: complianceLibrary.getRequirements(cat, "federal").length,
      };
    }
    setHeatMap(hm);

    // Recent ingestions — last 3 per table, merge + top 10
    const [
      recentProposals,
      recentRubrics,
      recentLogicModels,
      recentNeedData,
      recentBudgetPatterns,
      recentGrantmakerProfiles,
    ] = await Promise.all([
      supabase
        .from("intelligence_funded_proposals")
        .select("id, source, funder_name, grant_program, created_at")
        .order("created_at", { ascending: false })
        .limit(3),
      supabase
        .from("intelligence_scoring_rubrics")
        .select("id, source, funder_name, grant_program, created_at")
        .order("created_at", { ascending: false })
        .limit(3),
      supabase
        .from("intelligence_logic_models")
        .select("id, source, category, subcategory, created_at")
        .order("created_at", { ascending: false })
        .limit(3),
      supabase
        .from("intelligence_need_data")
        .select("id, source, data_type, created_at")
        .order("created_at", { ascending: false })
        .limit(3),
      supabase
        .from("intelligence_budget_patterns")
        .select("id, source, program_category, created_at")
        .order("created_at", { ascending: false })
        .limit(3),
      supabase
        .from("intelligence_grantmaker_profiles")
        .select("id, name, ein, created_at")
        .order("created_at", { ascending: false })
        .limit(3),
    ]);

    const allRecent: RecentIngestion[] = [
      ...(recentProposals.data ?? []).map((r) => ({
        id: r.id,
        type: "Funded Proposal",
        label: r.grant_program ?? r.funder_name ?? "Untitled proposal",
        source: r.source ?? "unknown",
        created_at: r.created_at,
      })),
      ...(recentRubrics.data ?? []).map((r) => ({
        id: r.id,
        type: "Rubric",
        label: r.grant_program ?? r.funder_name ?? "Untitled rubric",
        source: r.source ?? "unknown",
        created_at: r.created_at,
      })),
      ...(recentLogicModels.data ?? []).map((r) => ({
        id: r.id,
        type: "Logic Model",
        label: r.subcategory ?? r.category,
        source: r.source ?? "template",
        created_at: r.created_at,
      })),
      ...(recentNeedData.data ?? []).map((r) => ({
        id: r.id,
        type: "Need Data",
        label: r.data_type,
        source: r.source,
        created_at: r.created_at,
      })),
      ...(recentBudgetPatterns.data ?? []).map((r) => ({
        id: r.id,
        type: "Budget Pattern",
        label: r.program_category,
        source: r.source ?? "unknown",
        created_at: r.created_at,
      })),
      ...(recentGrantmakerProfiles.data ?? []).map((r) => ({
        id: r.id,
        type: "Grantmaker",
        label: r.name ?? r.ein ?? "Unknown",
        source: "propublica",
        created_at: r.created_at,
      })),
    ];
    allRecent.sort((a, b) => b.created_at.localeCompare(a.created_at));
    setRecent(allRecent.slice(0, 10));

    // Data freshness — most recent created_at per source
    setFreshness([
      { name: "Funded Proposals", lastUpdated: (recentProposals.data ?? [])[0]?.created_at ?? null },
      { name: "Scoring Rubrics", lastUpdated: (recentRubrics.data ?? [])[0]?.created_at ?? null },
      { name: "Logic Models", lastUpdated: (recentLogicModels.data ?? [])[0]?.created_at ?? null },
      { name: "Need Data (Census/HUD/etc.)", lastUpdated: (recentNeedData.data ?? [])[0]?.created_at ?? null },
      { name: "Budget Patterns", lastUpdated: (recentBudgetPatterns.data ?? [])[0]?.created_at ?? null },
      { name: "Grantmaker Profiles", lastUpdated: (recentGrantmakerProfiles.data ?? [])[0]?.created_at ?? null },
      // Bundled with the codebase, not ingested into a DB table — see
      // STATE_OF_THE_BUILD.md KB7 note. "Freshness" tracks the last deploy, not decay.
      { name: "Evaluation KPI Library", lastUpdated: null, isStatic: true },
      { name: "Compliance Requirements", lastUpdated: null, isStatic: true },
    ]);

    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void runSearch(searchQuery, kbFilter);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, kbFilter]);

  async function runSearch(q: string, kbType: string) {
    setSearchLoading(true);
    try {
      const params = new URLSearchParams({ q, limit: "10" });
      if (kbType !== "all") params.set("kb_types", kbType);
      const res = await fetch(`/api/intelligence/search?${params.toString()}`);
      if (!res.ok) {
        setSearchResults([]);
        return;
      }
      const json = (await res.json()) as { results?: SearchResultItem[] };
      setSearchResults(json.results ?? []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }

  // Chart data — proposals and rubrics per category
  const chartData = heatMap
    ? CATEGORIES.map((cat) => ({
        name: CATEGORY_LABELS[cat].split(" ")[0] ?? CATEGORY_LABELS[cat],
        proposals: heatMap[cat].funded_proposals,
        rubrics: heatMap[cat].rubrics,
      }))
    : [];

  const totalInHeatMap = heatMap
    ? CATEGORIES.reduce(
        (sum, cat) =>
          sum +
          heatMap[cat].funded_proposals +
          heatMap[cat].rubrics +
          heatMap[cat].logic_models +
          heatMap[cat].need_data +
          heatMap[cat].budget_patterns +
          heatMap[cat].grantmaker_profiles,
        0,
      )
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">
          Intelligence Library
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Analytics and coverage across all knowledge bases powering the AI draft generator.
        </p>
      </div>

      {/* Tab bar */}
      <div className="border-b border-navy-200">
        <nav className="-mb-px flex gap-6" aria-label="Intelligence library tabs">
          <span className="whitespace-nowrap border-b-2 border-teal-500 pb-3 text-sm font-medium text-teal-600">
            Dashboard
          </span>
          {(
            [
              "Funded Proposals",
              "Scoring Rubrics",
              "Logic Models",
              "Data Sources",
            ] as const
          ).map((label) => (
            <Link
              key={label}
              href="/intelligence-library"
              className="whitespace-nowrap border-b-2 border-transparent pb-3 text-sm font-medium text-navy-500 hover:border-navy-300 hover:text-navy-700 transition"
            >
              {label}
            </Link>
          ))}
        </nav>
      </div>

      {loading ? (
        <LoadingSpinner center label="Loading dashboard…" />
      ) : (
        <>
          {/* ── Stats row ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard icon={FileText} label="Funded proposals" value={stats.proposals} />
            <StatCard icon={GitBranch} label="Sections indexed" value={stats.sections} />
            <StatCard icon={Database} label="Need data points" value={stats.needData} />
            <StatCard icon={Users} label="Grantmaker profiles" value={stats.grantmakerProfiles} />
            <StatCard icon={BarChart2} label="Budget patterns" value={stats.budgetPatterns} />
            <StatCard icon={Target} label="Total KPIs" value={stats.totalKpis} />
          </div>

          {/* ── Coverage heat map ─────────────────────────────────────────── */}
          <Card
            title="Coverage by Program Category"
            description={
              totalInHeatMap === 0
                ? "No data yet — start ingesting to see coverage."
                : "Green = good coverage (10+), yellow = sparse (3–9), amber = thin (1–2), red = none."
            }
          >
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-sidebar">
                  <tr>
                    <th className="py-2 pr-4 text-left font-semibold text-white whitespace-nowrap">
                      Category
                    </th>
                    {HEAT_COLS.map((col) => (
                      <th
                        key={col.key}
                        className="py-2 px-2 text-center font-semibold text-white whitespace-nowrap"
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-100">
                  {CATEGORIES.map((cat) => {
                    const row = heatMap?.[cat];
                    return (
                      <tr key={cat} className="hover:bg-navy-50">
                        <td className="py-2 pr-4 font-medium text-navy-700 whitespace-nowrap">
                          {CATEGORY_LABELS[cat]}
                        </td>
                        {HEAT_COLS.map((col) => {
                          const count = row?.[col.key] ?? 0;
                          return (
                            <td key={col.key} className="py-2 px-2 text-center">
                              <span
                                className={`inline-flex min-w-[2rem] items-center justify-center rounded px-1.5 py-0.5 font-mono font-semibold ${cellColorClass(count)}`}
                              >
                                {count}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ── Bar chart: proposals + rubrics by category ────────────────── */}
          <Card
            title="Knowledge Base Coverage"
            description="Funded proposals and scoring rubrics indexed per program category."
          >
            {totalInHeatMap === 0 ? (
              <p className="py-8 text-center text-sm text-navy-400">
                No data ingested yet. Coverage will appear here as knowledge bases are populated.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={chartData}
                  margin={{ left: -20, right: 8, bottom: 0, top: 4 }}
                >
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "#64748b", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "#64748b", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#1e293b",
                      border: "1px solid #334155",
                      borderRadius: 8,
                      color: "#f1f5f9",
                      fontSize: 12,
                    }}
                    labelStyle={{ color: "#94a3b8" }}
                  />
                  <Bar
                    dataKey="proposals"
                    name="Funded Proposals"
                    fill="#14b8a6"
                    radius={[3, 3, 0, 0]}
                  />
                  <Bar
                    dataKey="rubrics"
                    name="Rubrics"
                    fill="#6366f1"
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>

          {/* ── Unified search ────────────────────────────────────────────── */}
          <Card
            title="Unified Search"
            description="Search across all knowledge bases simultaneously."
          >
            <div className="space-y-4">
              {/* KB type chips */}
              <div className="flex flex-wrap gap-2">
                {KB_FILTER_TYPES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setKbFilter(t.id)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                      kbFilter === t.id
                        ? "bg-teal-500 text-white"
                        : "border border-navy-200 bg-surface text-navy-600 hover:border-teal-300 hover:text-teal-600"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Search input */}
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400"
                  aria-hidden
                />
                <input
                  type="search"
                  placeholder="Search funded proposals, rubrics, logic models, need data…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-navy-200 bg-surface py-2 pl-9 pr-4 text-sm text-navy-900 placeholder:text-navy-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </div>

              {/* Results */}
              {searchLoading && (
                <LoadingSpinner label="Searching…" />
              )}
              {!searchLoading && searchResults.length > 0 && (
                <div className="space-y-4">
                  {groupResultsByKbType(searchResults).map(([kbType, items]) => (
                    <div key={kbType}>
                      <div className="mb-2 flex items-center gap-2">
                        <Badge color={typeBadgeColor(kbType.replace(/_/g, " "))}>
                          {kbType.replace(/_/g, " ")}
                        </Badge>
                        <span className="text-xs text-navy-400">
                          {items.length} result{items.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="space-y-2">
                        {items.map((r) => (
                          <div
                            key={r.id}
                            className="rounded-lg border border-navy-200 bg-navy-50 p-3"
                          >
                            <span className="text-sm font-medium text-navy-900">
                              {r.title}
                            </span>
                            {r.excerpt && (
                              <p className="mt-1 line-clamp-2 text-xs text-navy-500">
                                {r.excerpt}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!searchLoading && searchQuery.trim() && searchResults.length === 0 && (
                <p className="py-4 text-center text-sm text-navy-400">
                  No results. Try different keywords or select a specific knowledge base filter.
                </p>
              )}
            </div>
          </Card>

          {/* ── Bottom row ────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Recent ingestions */}
            <Card
              title="Recent Ingestions"
              description="Last 10 items added across all knowledge bases."
            >
              {recent.length === 0 ? (
                <p className="py-4 text-center text-sm text-navy-400">
                  No items ingested yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {recent.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start justify-between gap-3 rounded-lg border border-navy-100 bg-navy-50 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge color={typeBadgeColor(item.type)}>
                            {item.type}
                          </Badge>
                          <span className="truncate text-sm font-medium text-navy-900">
                            {item.label}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-navy-400">{item.source}</p>
                      </div>
                      <span className="shrink-0 text-xs text-navy-400">
                        {formatDate(item.created_at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Data freshness */}
            <Card
              title="Data Freshness"
              description="Last ingestion per knowledge base. Green < 30 days, yellow 30–90, red > 90."
            >
              <div className="space-y-2">
                {freshness.map((item) => (
                  <div
                    key={item.name}
                    className="flex items-center justify-between gap-3 rounded-lg border border-navy-100 bg-navy-50 px-3 py-2.5"
                  >
                    <span className="text-sm font-medium text-navy-700">
                      {item.name}
                    </span>
                    <div className="flex items-center gap-2 text-right">
                      {item.isStatic ? (
                        <span className="text-xs font-semibold text-sky-500">
                          Bundled (static)
                        </span>
                      ) : (
                        <>
                          <span
                            className={`text-xs font-semibold ${freshnessColorClass(item.lastUpdated)}`}
                          >
                            {freshnessLabel(item.lastUpdated)}
                          </span>
                          {item.lastUpdated && (
                            <span className="text-xs text-navy-400">
                              {formatDate(item.lastUpdated)}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
}) {
  return (
    <Card>
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50">
          <Icon className="h-4 w-4 text-teal-600" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-xl font-semibold tabular-nums text-navy-900">
            {value.toLocaleString()}
          </p>
          <p className="truncate text-xs text-navy-500">{label}</p>
        </div>
      </div>
    </Card>
  );
}
