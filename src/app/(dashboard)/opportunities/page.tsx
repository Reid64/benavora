"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardCheck, Plus, Search, Zap } from "lucide-react";

import { Button, EmptyState, Select } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  OpportunityTable,
  type OpportunityRow,
} from "@/components/opportunities/OpportunityTable";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";

type SortOption =
  | "probability-desc"
  | "probability-asc"
  | "deadline-asc"
  | "amount-desc"
  | "eligibility-desc"
  | "name-asc";

const SORT_OPTIONS: { value: SortOption; label: string; key: string; direction: "asc" | "desc" }[] = [
  { value: "probability-desc", label: "Probability (High to Low)", key: "probability", direction: "desc" },
  { value: "probability-asc", label: "Probability (Low to High)", key: "probability", direction: "asc" },
  { value: "deadline-asc", label: "Deadline (Soonest First)", key: "deadline", direction: "asc" },
  { value: "amount-desc", label: "Amount (Highest First)", key: "amount", direction: "desc" },
  { value: "eligibility-desc", label: "Eligibility (Highest First)", key: "eligibility", direction: "desc" },
  { value: "name-asc", label: "Name (A-Z)", key: "name", direction: "asc" },
];

type ThresholdOption = "all" | "70" | "50" | "custom";

const THRESHOLD_OPTIONS: { value: ThresholdOption; label: string }[] = [
  { value: "all", label: "All" },
  { value: "70", label: "70%+" },
  { value: "50", label: "50%+" },
  { value: "custom", label: "Custom" },
];

/**
 * Opportunity list (BLUEPRINT §4.4). Reads are RLS-scoped to the organization,
 * so no organization_id filter is needed client-side. Keyword tags (from the
 * opportunity_keywords many-to-many table) and funder names are joined in for
 * search and display.
 */
export default function OpportunitiesPage() {
  const { profile } = useProfile();
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOption>("probability-desc");
  const [threshold, setThreshold] = useState<ThresholdOption>("all");
  const [customThreshold, setCustomThreshold] = useState("");
  const [isScoring, setIsScoring] = useState(false);
  const [scoringError, setScoringError] = useState<string | null>(null);
  const [isScoringEligibility, setIsScoringEligibility] = useState(false);
  const [eligibilityScoringError, setEligibilityScoringError] = useState<
    string | null
  >(null);

  async function loadOpportunities() {
    setLoading(true);
    setError(null);

    const supabase = createClient();

    const [oppsRes, fundersRes, keywordsRes, appsRes, probabilityRes] = await Promise.all([
      supabase
        .from("opportunities")
        .select("*")
        .order("match_percentage", { ascending: false, nullsFirst: false })
        .limit(1000),
      supabase.from("funders").select("id, name"),
      supabase
        .from("opportunity_keywords")
        .select("opportunity_id, keyword"),
      supabase
        .from("applications")
        .select("opportunity_id, stage, created_at"),
      // opportunity_probability_scores (migration 093) - Grant Probability Engine
      // (PLATFORM_VISION_ARCHITECTURE.md Pillar 5). RLS-scoped like the rest.
      supabase
        .from("opportunity_probability_scores")
        .select("opportunity_id, overall_score"),
    ]);

    if (oppsRes.error) {
      setError("Could not load opportunities.");
      setLoading(false);
      return;
    }

    const funderNames = new Map<string, string>();
    for (const f of fundersRes.data ?? []) {
      funderNames.set(f.id, f.name);
    }

    const keywordsByOpp = new Map<string, string[]>();
    for (const row of keywordsRes.data ?? []) {
      const list = keywordsByOpp.get(row.opportunity_id) ?? [];
      list.push(row.keyword);
      keywordsByOpp.set(row.opportunity_id, list);
    }

    // Most-recent application stage per opportunity (TASK 9).
    const stageByOpp = new Map<string, { stage: string; created_at: string }>();
    for (const a of appsRes.data ?? []) {
      const prev = stageByOpp.get(a.opportunity_id);
      if (!prev || a.created_at > prev.created_at) {
        stageByOpp.set(a.opportunity_id, { stage: a.stage, created_at: a.created_at });
      }
    }

    const probabilityByOpp = new Map<string, number | null>();
    for (const p of (probabilityRes.data ?? []) as {
      opportunity_id: string;
      overall_score: number | null;
    }[]) {
      probabilityByOpp.set(p.opportunity_id, p.overall_score);
    }

    const rows: OpportunityRow[] = (oppsRes.data ?? []).map((opp) => ({
      ...opp,
      keywords: keywordsByOpp.get(opp.id) ?? [],
      funderName: opp.funder_id
        ? (funderNames.get(opp.funder_id) ?? null)
        : null,
      applicationStage: stageByOpp.get(opp.id)?.stage ?? null,
      probabilityScore: probabilityByOpp.get(opp.id) ?? null,
    }));

    setOpportunities(rows);
    setLoading(false);
  }

  useEffect(() => {
    let active = true;
    loadOpportunities().catch(() => {
      if (active) {
        setError("Could not load opportunities.");
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editable = canEdit(profile?.role);
  const showEmpty = !loading && !error && opportunities.length === 0;

  const selectedSort =
    SORT_OPTIONS.find((o) => o.value === sort) ?? SORT_OPTIONS[0]!;

  const thresholdValue: number | null =
    threshold === "all"
      ? null
      : threshold === "custom"
        ? (customThreshold.trim() === "" ? null : Number(customThreshold))
        : Number(threshold);

  const displayedOpportunities = useMemo(() => {
    if (thresholdValue == null || Number.isNaN(thresholdValue)) return opportunities;
    return opportunities.filter(
      (opp) => opp.probabilityScore != null && opp.probabilityScore >= thresholdValue,
    );
  }, [opportunities, thresholdValue]);

  async function handleRunScoring() {
    setIsScoring(true);
    setScoringError(null);

    const results = await Promise.allSettled(
      displayedOpportunities.map((opp) =>
        fetch("/api/intelligence/grant-probability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ opportunityId: opp.id }),
        }).then((res) => {
          if (!res.ok) throw new Error(`Failed to score ${opp.id}`);
          return res.json();
        }),
      ),
    );

    const failures = results.filter((r) => r.status === "rejected").length;
    if (failures > 0) {
      setScoringError(
        `${failures} of ${displayedOpportunities.length} opportunities could not be scored.`,
      );
    }

    setIsScoring(false);
    await loadOpportunities();
  }

  // "Score All" — Eligibility Scoring Agent (AGENTS.md Agent 02).
  //
  // Deviation from the task-given spec (POST /api/autonomous/trigger with
  // agentId "ag-02-eligibility"), checked against real code rather than
  // applied literally:
  //   - "ag-02" (the autonomous EligibilityScoringAgent's agentId, see
  //     src/lib/agents/eligibility-scoring-agent.ts) was never added to the
  //     agent_type enum (verified: absent from every src/supabase/migrations
  //     file) — AutonomousAgent.startRun() would fail on every single run
  //     before scoring anything. AGENTS_v2.md §1.2 documents this as a known,
  //     unfixed gap.
  //   - /api/autonomous/trigger only inserts a bare agent_queue row with no
  //     opportunityId in its payload, but the queue processor's
  //     'eligibility_scoring' case (worker/autonomous-orchestrator.ts) requires
  //     one per item — it scores a single opportunity, not "all".
  // Instead this mirrors handleRunScoring above: fan out client-side to the
  // real, working per-opportunity route (/api/agents/eligibility, backed by
  // the live EligibilityScorer — the same class scripts/batch-score-eligibility.ts
  // and pnpm score:eligibility already use), scoped to opportunities that have
  // never been scored.
  const unscoredOpportunities = useMemo(
    () => opportunities.filter((opp) => opp.eligibility_score == null),
    [opportunities],
  );

  async function handleScoreAllEligibility() {
    setIsScoringEligibility(true);
    setEligibilityScoringError(null);

    const results = await Promise.allSettled(
      unscoredOpportunities.map((opp) =>
        fetch("/api/agents/eligibility", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ opportunityId: opp.id }),
        }).then((res) => {
          if (!res.ok) throw new Error(`Failed to score ${opp.id}`);
          return res.json();
        }),
      ),
    );

    const failures = results.filter((r) => r.status === "rejected").length;
    if (failures > 0) {
      setEligibilityScoringError(
        `${failures} of ${unscoredOpportunities.length} opportunities could not be scored.`,
      );
    }

    setIsScoringEligibility(false);
    await loadOpportunities();
  }

  return (
    <div
      className="min-h-screen space-y-6 bg-[#EEF2F7] p-6 page-bg"
      style={{ backgroundColor: "#E4E9F0" }}
    >
      <PageHeader
        title="Opportunities"
        description="Grants, donation programs, and sponsorships you're tracking."
        actions={
          editable && (
            <>
              <Button
                variant="secondary"
                onClick={handleScoreAllEligibility}
                disabled={isScoringEligibility || unscoredOpportunities.length === 0}
              >
                <ClipboardCheck className="h-4 w-4" aria-hidden />
                {isScoringEligibility
                  ? "Scoring..."
                  : `Score All${unscoredOpportunities.length > 0 ? ` (${unscoredOpportunities.length})` : ""}`}
              </Button>
              <Link
                href="/opportunities/new"
                className="flex items-center gap-2 rounded-lg bg-[#0077B6] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#005F92]"
              >
                <Plus className="h-4 w-4" aria-hidden />
                New opportunity
              </Link>
            </>
          )
        }
      />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {scoringError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {scoringError}
        </div>
      )}

      {eligibilityScoringError && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {eligibilityScoringError}
        </div>
      )}

      {!showEmpty && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4 shadow-sm sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="sm:w-64">
              <label className="mb-1.5 block text-xs font-medium text-text-muted">
                Sort by
              </label>
              <Select
                aria-label="Sort opportunities"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortOption)}
                options={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
            </div>
            <div className="sm:w-44">
              <label className="mb-1.5 block text-xs font-medium text-text-muted">
                Min probability
              </label>
              <Select
                aria-label="Filter by probability threshold"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value as ThresholdOption)}
                options={THRESHOLD_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
            </div>
            {threshold === "custom" && (
              <div className="sm:w-32">
                <label className="mb-1.5 block text-xs font-medium text-text-muted">
                  Threshold %
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={customThreshold}
                  onChange={(e) => setCustomThreshold(e.target.value)}
                  placeholder="0-100"
                  aria-label="Custom probability threshold"
                  className="block w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text shadow-sm transition placeholder:text-text-muted focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            )}
          </div>

          <Button
            variant="secondary"
            onClick={handleRunScoring}
            disabled={isScoring || displayedOpportunities.length === 0}
          >
            <Zap className="h-4 w-4" aria-hidden />
            {isScoring ? "Scoring..." : "Run Probability Scoring"}
          </Button>
        </div>
      )}

      {showEmpty ? (
        <EmptyState
          icon={Search}
          title="No opportunities yet"
          description="Add your first funding opportunity to start tracking deadlines, eligibility, and applications."
          action={
            editable ? (
              <Link
                href="/opportunities/new"
                className="flex items-center gap-2 rounded-lg bg-[#0077B6] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#005F92]"
              >
                <Plus className="h-4 w-4" aria-hidden />
                New opportunity
              </Link>
            ) : undefined
          }
        />
      ) : (
        <OpportunityTable
          key={sort}
          opportunities={displayedOpportunities}
          isLoading={loading}
          defaultSort={{ key: selectedSort.key, direction: selectedSort.direction }}
        />
      )}
    </div>
  );
}
