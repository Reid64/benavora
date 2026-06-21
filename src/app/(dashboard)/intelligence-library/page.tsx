"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Database,
  FileText,
  GitBranch,
  Plus,
  Search,
  Target,
  type LucideIcon,
} from "lucide-react";

import { Badge, Button, Card, EmptyState, LoadingSpinner } from "@/components/ui";
import { IngestModal } from "@/components/intelligence/IngestModal";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils/formatters";
import type { Tables } from "@/types/database";

type FundedProposal = Tables<"intelligence_funded_proposals">;
type ProposalSection = Tables<"intelligence_proposal_sections">;
type ScoringRubric = Tables<"intelligence_scoring_rubrics">;
type LogicModel = Tables<"intelligence_logic_models">;

type RubricDimension = {
  name?: string;
  max_points?: number;
  description?: string;
  common_deductions?: string | string[];
};

type Stats = {
  proposalCount: number;
  sectionCount: number;
  rubricCount: number;
  logicModelCount: number;
  lastIngestionAt: string | null;
};

type NeedDataSource = {
  source: string;
  count: number;
};

type Tab = "funded-proposals" | "scoring-rubrics" | "logic-models" | "data-sources";

const TABS: { id: Tab; label: string }[] = [
  { id: "funded-proposals", label: "Funded Proposals" },
  { id: "scoring-rubrics", label: "Scoring Rubrics" },
  { id: "logic-models", label: "Logic Models" },
  { id: "data-sources", label: "Data Sources" },
];

export default function IntelligenceLibraryPage() {
  const [activeTab, setActiveTab] = useState<Tab>("funded-proposals");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [ingestOpen, setIngestOpen] = useState(false);

  const [proposals, setProposals] = useState<FundedProposal[]>([]);
  const [rubrics, setRubrics] = useState<ScoringRubric[]>([]);
  const [logicModels, setLogicModels] = useState<LogicModel[]>([]);
  const [needSources, setNeedSources] = useState<NeedDataSource[]>([]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sections, setSections] = useState<Record<string, ProposalSection[]>>({});
  const [sectionsLoading, setSectionsLoading] = useState(false);

  const [expandedRubricId, setExpandedRubricId] = useState<string | null>(null);
  const [rubricSourceFilter, setRubricSourceFilter] = useState<string>("all");

  const loadData = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    const [proposalsRes, sectionsCountRes, rubricCountRes, logicModelCountRes, proposalData, rubricData, logicData, needSourceData] =
      await Promise.all([
        supabase.from("intelligence_funded_proposals").select("id", { count: "exact", head: true }),
        supabase.from("intelligence_proposal_sections").select("id", { count: "exact", head: true }),
        supabase.from("intelligence_scoring_rubrics").select("id", { count: "exact", head: true }),
        supabase.from("intelligence_logic_models").select("id", { count: "exact", head: true }),
        supabase
          .from("intelligence_funded_proposals")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
        supabase.from("intelligence_scoring_rubrics").select("*").order("created_at", { ascending: false }),
        supabase.from("intelligence_logic_models").select("*").order("category"),
        supabase.from("intelligence_need_data").select("source"),
      ]);

    // Aggregate need data by source
    const sourceCounts: Record<string, number> = {};
    for (const row of needSourceData.data ?? []) {
      sourceCounts[row.source] = (sourceCounts[row.source] ?? 0) + 1;
    }
    const sources: NeedDataSource[] = Object.entries(sourceCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([source, count]) => ({ source, count }));

    // Last ingestion from most recent proposal
    const lastAt = (proposalData.data ?? [])[0]?.created_at ?? null;

    setStats({
      proposalCount: proposalsRes.count ?? 0,
      sectionCount: sectionsCountRes.count ?? 0,
      rubricCount: rubricCountRes.count ?? 0,
      logicModelCount: logicModelCountRes.count ?? 0,
      lastIngestionAt: lastAt,
    });
    setProposals(proposalData.data ?? []);
    setRubrics(rubricData.data ?? []);
    setLogicModels(logicData.data ?? []);
    setNeedSources(sources);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function toggleProposal(proposalId: string) {
    if (expandedId === proposalId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(proposalId);
    if (sections[proposalId]) return;

    setSectionsLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("intelligence_proposal_sections")
      .select("*")
      .eq("proposal_id", proposalId)
      .order("section_type");
    setSections((prev) => ({ ...prev, [proposalId]: data ?? [] }));
    setSectionsLoading(false);
  }

  const q = search.trim().toLowerCase();

  const filteredProposals = proposals.filter((p) =>
    !q ||
    p.funder_name?.toLowerCase().includes(q) ||
    p.grant_program?.toLowerCase().includes(q) ||
    p.source?.toLowerCase().includes(q) ||
    p.funder_type?.toLowerCase().includes(q),
  );

  const filteredRubrics = rubrics.filter((r) => {
    const matchesSearch =
      !q ||
      r.funder_name?.toLowerCase().includes(q) ||
      r.grant_program?.toLowerCase().includes(q) ||
      r.source?.toLowerCase().includes(q);
    const matchesSource =
      rubricSourceFilter === "all" || r.source === rubricSourceFilter;
    return matchesSearch && matchesSource;
  });

  const filteredLogicModels = logicModels.filter((m) =>
    !q ||
    m.category?.toLowerCase().includes(q) ||
    m.subcategory?.toLowerCase().includes(q),
  );

  const filteredNeedSources = needSources.filter((s) =>
    !q || s.source.toLowerCase().includes(q),
  );

  // Group logic models by category
  const logicModelsByCategory: Record<string, LogicModel[]> = {};
  for (const m of filteredLogicModels) {
    const key = m.category;
    if (!logicModelsByCategory[key]) logicModelsByCategory[key] = [];
    logicModelsByCategory[key].push(m);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
            Intelligence Library
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Funded proposals, scoring rubrics, logic models, and evidence data powering the AI draft generator.
          </p>
        </div>
        <Button onClick={() => setIngestOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          Add to Library
        </Button>
      </div>

      <IngestModal
        isOpen={ingestOpen}
        onClose={() => setIngestOpen(false)}
        onSuccess={() => {
          setIngestOpen(false);
          void loadData();
        }}
      />

      {loading ? (
        <LoadingSpinner center label="Loading intelligence library..." />
      ) : (
        <>
          {/* Stats cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard icon={FileText} label="Funded proposals" value={stats?.proposalCount ?? 0} />
            <StatCard icon={GitBranch} label="Sections indexed" value={stats?.sectionCount ?? 0} />
            <StatCard icon={Target} label="Scoring rubrics" value={stats?.rubricCount ?? 0} />
            <StatCard icon={BookOpen} label="Logic models" value={stats?.logicModelCount ?? 0} />
            <StatCard
              icon={Database}
              label="Last ingestion"
              value={stats?.lastIngestionAt ? formatDate(stats.lastIngestionAt) : "—"}
              isText
            />
          </div>

          {/* Search */}
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400"
              aria-hidden
            />
            <input
              type="search"
              placeholder="Search by funder name, program, or source…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-navy-200 bg-white py-2 pl-9 pr-4 text-sm text-navy-900 placeholder:text-navy-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
          </div>

          {/* Tab bar */}
          <div className="border-b border-navy-200">
            <nav className="-mb-px flex gap-6" aria-label="Intelligence library tabs">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`whitespace-nowrap border-b-2 pb-3 text-sm font-medium transition ${
                    activeTab === tab.id
                      ? "border-teal-500 text-teal-600"
                      : "border-transparent text-navy-500 hover:border-navy-300 hover:text-navy-700"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Tab content */}
          {activeTab === "funded-proposals" && (
            <Card>
              {filteredProposals.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="No funded proposals yet"
                  description="Run the NIH ingestion pipeline to populate the funded proposal library."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-navy-100 text-sm">
                    <thead>
                      <tr className="text-left text-xs font-medium uppercase tracking-wide text-navy-400">
                        <th className="pb-3 pr-4" />
                        <th className="pb-3 pr-4">Funder</th>
                        <th className="pb-3 pr-4">Program</th>
                        <th className="pb-3 pr-4">Amount</th>
                        <th className="pb-3 pr-4">Year</th>
                        <th className="pb-3 pr-4">Categories</th>
                        <th className="pb-3">Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-navy-100">
                      {filteredProposals.map((p) => (
                        <Fragment key={p.id}>
                          <tr
                            onClick={() => void toggleProposal(p.id)}
                            className="cursor-pointer hover:bg-navy-50"
                          >
                            <td className="py-3 pr-4">
                              {expandedId === p.id ? (
                                <ChevronDown className="h-4 w-4 text-navy-400" aria-hidden />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-navy-400" aria-hidden />
                              )}
                            </td>
                            <td className="py-3 pr-4 font-medium text-navy-900">
                              {p.funder_name ?? <span className="text-navy-400">—</span>}
                            </td>
                            <td className="py-3 pr-4 text-navy-600">
                              {p.grant_program ?? <span className="text-navy-400">—</span>}
                            </td>
                            <td className="py-3 pr-4 text-navy-600">
                              {p.award_amount != null
                                ? formatCurrency(p.award_amount)
                                : <span className="text-navy-400">—</span>}
                            </td>
                            <td className="py-3 pr-4 text-navy-600">
                              {p.award_year ?? <span className="text-navy-400">—</span>}
                            </td>
                            <td className="py-3 pr-4">
                              <div className="flex flex-wrap gap-1">
                                {(p.category ?? []).slice(0, 3).map((cat) => (
                                  <Badge key={cat} color="teal">
                                    {cat}
                                  </Badge>
                                ))}
                              </div>
                            </td>
                            <td className="py-3 text-navy-500">{p.source}</td>
                          </tr>
                          {expandedId === p.id && (
                            <tr>
                              <td colSpan={7} className="bg-navy-50 px-6 py-4">
                                {sectionsLoading && !sections[p.id] ? (
                                  <LoadingSpinner label="Loading sections…" />
                                ) : (sections[p.id] ?? []).length === 0 ? (
                                  <p className="text-sm text-navy-400">No sections indexed for this proposal.</p>
                                ) : (
                                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                    {(sections[p.id] ?? []).map((s) => (
                                      <div
                                        key={s.id}
                                        className="rounded-lg border border-navy-200 bg-white p-3"
                                      >
                                        <div className="mb-1.5 flex items-center justify-between gap-2">
                                          <Badge color="navy">{s.section_type.replace(/_/g, " ")}</Badge>
                                          {s.quality_score != null && (
                                            <span className="text-xs text-navy-400">
                                              Quality: {s.quality_score}/10
                                            </span>
                                          )}
                                        </div>
                                        <p className="line-clamp-4 text-xs text-navy-600">{s.section_text}</p>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {activeTab === "scoring-rubrics" && (
            <>
              {/* Source filter */}
              <div className="flex items-center gap-3">
                <label htmlFor="rubric-source-filter" className="text-sm font-medium text-navy-600">
                  Source type:
                </label>
                <select
                  id="rubric-source-filter"
                  value={rubricSourceFilter}
                  onChange={(e) => setRubricSourceFilter(e.target.value)}
                  className="rounded-lg border border-navy-200 bg-white px-3 py-1.5 text-sm text-navy-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                >
                  <option value="all">All sources</option>
                  <option value="nofa_parse">NOFA Parse</option>
                  <option value="reviewer_guide">Reviewer Guide</option>
                  <option value="inferred">Inferred</option>
                </select>
              </div>

              <Card>
                {filteredRubrics.length === 0 ? (
                  <EmptyState
                    icon={Target}
                    title="No scoring rubrics yet"
                    description="Rubrics are extracted from federal NOFOs and reviewer guides during the Night 2 build."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-navy-100 text-sm">
                      <thead>
                        <tr className="text-left text-xs font-medium uppercase tracking-wide text-navy-400">
                          <th className="pb-3 pr-4" />
                          <th className="pb-3 pr-4">Funder</th>
                          <th className="pb-3 pr-4">Program</th>
                          <th className="pb-3 pr-4">Source</th>
                          <th className="pb-3 pr-4 text-right">Dimensions</th>
                          <th className="pb-3 pr-4 text-right">Total pts</th>
                          <th className="pb-3">Added</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-navy-100">
                        {filteredRubrics.map((r) => {
                          const dims = Array.isArray(r.dimensions)
                            ? (r.dimensions as RubricDimension[])
                            : [];
                          const totalPoints = dims.reduce(
                            (sum, d) => sum + (d.max_points ?? 0),
                            0,
                          );
                          const isExpanded = expandedRubricId === r.id;
                          return (
                            <Fragment key={r.id}>
                              <tr
                                onClick={() =>
                                  setExpandedRubricId(isExpanded ? null : r.id)
                                }
                                className="cursor-pointer hover:bg-navy-50"
                              >
                                <td className="py-3 pr-4">
                                  {isExpanded ? (
                                    <ChevronDown className="h-4 w-4 text-navy-400" aria-hidden />
                                  ) : (
                                    <ChevronRight className="h-4 w-4 text-navy-400" aria-hidden />
                                  )}
                                </td>
                                <td className="py-3 pr-4 font-medium text-navy-900">
                                  {r.funder_name ?? <span className="text-navy-400">—</span>}
                                </td>
                                <td className="py-3 pr-4 text-navy-600">
                                  {r.grant_program ?? <span className="text-navy-400">—</span>}
                                </td>
                                <td className="py-3 pr-4">
                                  {r.source ? (
                                    <Badge color="navy">{r.source.replace(/_/g, " ")}</Badge>
                                  ) : (
                                    <span className="text-navy-400">—</span>
                                  )}
                                </td>
                                <td className="py-3 pr-4 text-right tabular-nums text-navy-600">
                                  {dims.length > 0 ? dims.length : <span className="text-navy-400">—</span>}
                                </td>
                                <td className="py-3 pr-4 text-right tabular-nums text-navy-600">
                                  {totalPoints > 0 ? totalPoints : <span className="text-navy-400">—</span>}
                                </td>
                                <td className="py-3 text-navy-500">
                                  {formatDate(r.created_at)}
                                </td>
                              </tr>
                              {isExpanded && (
                                <tr>
                                  <td colSpan={7} className="bg-navy-50 px-6 py-4">
                                    {dims.length === 0 ? (
                                      <p className="text-sm text-navy-400">No dimensions recorded for this rubric.</p>
                                    ) : (
                                      <div className="space-y-3">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-navy-400">
                                          Scoring Dimensions
                                        </p>
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                          {dims.map((d, i) => (
                                            <RubricDimensionCard key={i} dimension={d} />
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </>
          )}

          {activeTab === "logic-models" && (
            <>
              {filteredLogicModels.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={BookOpen}
                    title="No logic models yet"
                    description="Logic model templates by program category are built during the Night 2 build."
                  />
                </Card>
              ) : (
                Object.entries(logicModelsByCategory).map(([category, models]) => (
                  <div key={category}>
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-navy-500">
                      {category}
                    </h3>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      {models.map((m) => (
                        <LogicModelCard key={m.id} model={m} />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </>
          )}

          {activeTab === "data-sources" && (
            <Card>
              {filteredNeedSources.length === 0 ? (
                <EmptyState
                  icon={Database}
                  title="No data sources yet"
                  description="Census, HUD, SAMHSA, BLS, and CDC data are ingested during the Night 3 build."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-navy-100 text-sm">
                    <thead>
                      <tr className="text-left text-xs font-medium uppercase tracking-wide text-navy-400">
                        <th className="pb-3 pr-4">Source</th>
                        <th className="pb-3 text-right">Records</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-navy-100">
                      {filteredNeedSources.map((s) => (
                        <tr key={s.source} className="hover:bg-navy-50">
                          <td className="py-3 pr-4 font-medium text-navy-900">{s.source}</td>
                          <td className="py-3 text-right tabular-nums text-navy-600">
                            {s.count.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-navy-200">
                        <td className="py-3 pr-4 text-sm font-semibold text-navy-700">Total</td>
                        <td className="py-3 text-right tabular-nums font-semibold text-navy-700">
                          {filteredNeedSources
                            .reduce((sum, s) => sum + s.count, 0)
                            .toLocaleString()}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  isText = false,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  isText?: boolean;
}) {
  return (
    <Card>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50">
          <Icon className="h-5 w-5 text-teal-600" aria-hidden />
        </div>
        <div className="min-w-0">
          {isText ? (
            <p className="truncate text-sm font-semibold text-navy-900">{value}</p>
          ) : (
            <p className="text-2xl font-semibold text-navy-900">{value}</p>
          )}
          <p className="text-xs text-navy-500">{label}</p>
        </div>
      </div>
    </Card>
  );
}

function LogicModelCard({ model }: { model: LogicModel }) {
  const inputs = toStringArray(model.inputs);
  const activities = toStringArray(model.activities);
  const outputs = toStringArray(model.outputs);
  const outcomes = toStringArray(model.outcomes);
  const impact = toStringArray(model.impact);

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="font-medium text-navy-900">
          {model.subcategory ?? model.category}
        </h4>
        {model.is_template && (
          <Badge color="teal">Template</Badge>
        )}
      </div>
      <div className="space-y-2 text-xs">
        <LogicRow label="Inputs" items={inputs} color="bg-sky-50 text-sky-700" />
        <LogicRow label="Activities" items={activities} color="bg-teal-50 text-teal-700" />
        <LogicRow label="Outputs" items={outputs} color="bg-green-50 text-green-700" />
        <LogicRow label="Outcomes" items={outcomes} color="bg-purple-50 text-purple-700" />
        <LogicRow label="Impact" items={impact} color="bg-amber-50 text-amber-700" />
      </div>
    </Card>
  );
}

function LogicRow({
  label,
  items,
  color,
}: {
  label: string;
  items: string[];
  color: string;
}) {
  return (
    <div className="flex gap-2">
      <span className={`w-20 shrink-0 rounded px-1.5 py-0.5 text-center font-semibold ${color}`}>
        {label}
      </span>
      <span className="text-navy-600">
        {items.length > 0 ? items.slice(0, 3).join("; ") : "—"}
        {items.length > 3 && ` +${items.length - 3} more`}
      </span>
    </div>
  );
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

function RubricDimensionCard({ dimension }: { dimension: RubricDimension }) {
  const deductions = Array.isArray(dimension.common_deductions)
    ? dimension.common_deductions
    : dimension.common_deductions
      ? [dimension.common_deductions]
      : [];

  return (
    <div className="rounded-lg border border-navy-200 bg-white p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="font-medium text-navy-900 leading-tight">
          {dimension.name ?? "Unnamed dimension"}
        </p>
        {dimension.max_points != null && (
          <span className="shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700">
            {dimension.max_points} pts
          </span>
        )}
      </div>
      {dimension.description && (
        <p className="mb-2 text-xs text-navy-600 line-clamp-3">{dimension.description}</p>
      )}
      {deductions.length > 0 && (
        <div className="mt-2 border-t border-navy-100 pt-2">
          <p className="mb-1 text-xs font-semibold text-navy-400 uppercase tracking-wide">
            Common deductions
          </p>
          <ul className="space-y-0.5">
            {deductions.slice(0, 3).map((d, i) => (
              <li key={i} className="flex gap-1.5 text-xs text-navy-600">
                <span className="mt-0.5 shrink-0 text-red-400">−</span>
                <span>{d}</span>
              </li>
            ))}
            {deductions.length > 3 && (
              <li className="text-xs text-navy-400">+{deductions.length - 3} more</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
