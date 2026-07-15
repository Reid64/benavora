"use client";

// Competitor Intelligence Dashboard (AGENTS.md Agent 24, BEHAVIORAL_CONTRACTS §27).
// Read-only view of competitors grouped by funder, derived from 990-PF giving history.
// Enterprise and Consultant tiers only. No export of competitor contact information.

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Lock, Target, TrendingUp, TrendingDown, Minus, RefreshCw } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/hooks/useProfile";
import { canEdit } from "@/lib/hooks/useProfile";
import { Badge } from "@/components/ui/Badge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CompetitionLevel = "low" | "medium" | "high" | "very_high";

interface FunderRow {
  id: string;
  name: string;
}

interface CompetitorRow {
  id: string;
  funder_id: string | null;
  competitor_name: string | null;
  grant_amount: number | null;
  grant_purpose: string | null;
  fiscal_year: number | null;
  competition_level: CompetitionLevel | null;
  estimated_applicants: number | null;
  observed_at: string;
  funders: FunderRow | FunderRow[] | null;
}

interface FunderGroup {
  funderId: string;
  funderName: string;
  competitionLevel: CompetitionLevel | null;
  estimatedApplicants: number;
  competitors: CompetitorRow[];
  lastAnalyzed: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function competitionBadge(level: CompetitionLevel | null) {
  switch (level) {
    case "very_high":
      return (
        <Badge variant="error">
          <TrendingUp className="h-3 w-3" />
          Very High
        </Badge>
      );
    case "high":
      return (
        <Badge variant="warning">
          <TrendingUp className="h-3 w-3" />
          High
        </Badge>
      );
    case "low":
      return (
        <Badge variant="success">
          <TrendingDown className="h-3 w-3" />
          Low
        </Badge>
      );
    default:
      return (
        <Badge variant="neutral">
          <Minus className="h-3 w-3" />
          Unknown
        </Badge>
      );
  }
}

function formatCurrency(amount: number | null): string {
  if (amount === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Parse the analysis fields stored in grant_purpose ("what | Difference: ... | Competitive edge: ..."). */
function parseAnalysis(grantPurpose: string | null): {
  whatTheyDo: string;
  howTheyDiffer: string;
  competitiveEdge: string;
} {
  if (!grantPurpose) return { whatTheyDo: "", howTheyDiffer: "", competitiveEdge: "" };
  const parts = grantPurpose.split(" | ");
  return {
    whatTheyDo: parts[0] ?? "",
    howTheyDiffer: (parts[1] ?? "").replace(/^Difference:\s*/i, ""),
    competitiveEdge: (parts[2] ?? "").replace(/^Competitive edge:\s*/i, ""),
  };
}

function groupByFunder(rows: CompetitorRow[]): FunderGroup[] {
  const map = new Map<string, FunderGroup>();
  for (const row of rows) {
    if (!row.funder_id) continue;
    const funderArr = Array.isArray(row.funders) ? row.funders : row.funders ? [row.funders] : [];
    const funderName = funderArr[0]?.name ?? "Unknown Funder";
    if (!map.has(row.funder_id)) {
      map.set(row.funder_id, {
        funderId: row.funder_id,
        funderName,
        competitionLevel: row.competition_level,
        estimatedApplicants: row.estimated_applicants ?? 0,
        competitors: [],
        lastAnalyzed: row.observed_at,
      });
    }
    map.get(row.funder_id)!.competitors.push(row);
  }
  return Array.from(map.values());
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CompetitorsPage() {
  const { profile } = useProfile();
  const editable = canEdit(profile?.role);

  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null);
  const [groups, setGroups] = useState<FunderGroup[]>([]);
  const [funders, setFunders] = useState<FunderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedFunder, setExpandedFunder] = useState<string | null>(null);

  // Per-funder run state
  const [runningFunderId, setRunningFunderId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const load = useCallback(async (initial: boolean) => {
    if (initial) setLoading(true);
    setError(null);
    const supabase = createClient();

    const [flagRes, competitorsRes, fundersRes] = await Promise.all([
      supabase
        .from("platform_config")
        .select("value")
        .eq("key", "feature.competitor_intel")
        .maybeSingle(),
      supabase
        .from("competitor_tracking")
        .select("id, funder_id, competitor_name, grant_amount, grant_purpose, fiscal_year, competition_level, estimated_applicants, observed_at, funders(id, name)")
        .eq("source", "competitor_intel")
        .not("competitor_name", "is", null)
        .order("observed_at", { ascending: false })
        .limit(500),
      supabase
        .from("funders")
        .select("id, name")
        .order("name", { ascending: true })
        .limit(200),
    ]);

    const enabled = (flagRes.data?.value as string | undefined) === "true";
    setFeatureEnabled(enabled);

    if (!enabled) {
      if (initial) setLoading(false);
      return;
    }

    if (competitorsRes.error) {
      setError("Could not load competitor data.");
      if (initial) setLoading(false);
      return;
    }

    const rows = (competitorsRes.data ?? []) as unknown as CompetitorRow[];
    setGroups(groupByFunder(rows));
    setFunders((fundersRes.data ?? []) as FunderRow[]);

    if (initial) setLoading(false);
  }, []);

  useEffect(() => {
    void load(true);
  }, [load]);

  async function handleRunAnalysis(funderId: string) {
    if (!editable) return;
    setRunningFunderId(funderId);
    setRunError(null);
    try {
      const res = await fetch("/api/agents/competitor-intel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ funderId }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setRunError(payload.error ?? "Analysis failed. Please try again.");
      } else {
        await load(false);
        setExpandedFunder(funderId);
      }
    } catch {
      setRunError("Could not reach the competitor intelligence agent.");
    }
    setRunningFunderId(null);
  }

  // Feature not yet loaded
  if (featureEnabled === null && loading) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-navy-400">
        Loading…
      </div>
    );
  }

  // Feature disabled — locked state (§27: hidden from non-Enterprise tiers)
  if (featureEnabled === false) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            Competitor Intelligence
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Identify organizations competing for the same funding, powered by IRS 990-PF data.
          </p>
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl border border-navy-200 bg-navy-50 py-20 text-center">
          <Lock className="mb-4 h-10 w-10 text-navy-300" />
          <p className="text-lg font-semibold text-navy-700">
            Enterprise and Consultant plans only
          </p>
          <p className="mt-2 max-w-sm text-sm text-navy-500">
            Competitor intelligence is available on Enterprise ($499/mo) and Consultant ($799/mo)
            plans. Upgrade in Billing to unlock this feature.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            Competitor Intelligence
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Organizations competing for the same funding, identified from public IRS 990-PF data.
            Read-only — no contact information is stored or displayed.
          </p>
        </div>
      </div>

      {/* Global error */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Run error */}
      {runError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {runError}
        </div>
      )}

      {/* Run analysis section */}
      {editable && funders.length > 0 && (
        <div className="rounded-xl border border-border bg-white shadow-sm p-6">
          <h2 className="mb-4 text-base font-semibold text-navy-900">
            Analyze a Funder
          </h2>
          <p className="mb-4 text-sm text-navy-500">
            Select a funder to identify competitors from their 990-PF giving history.
            Requires giving history to be populated first.
          </p>
          <div className="flex flex-wrap gap-2">
            {funders.map((f) => (
              <button
                key={f.id}
                onClick={() => void handleRunAnalysis(f.id)}
                disabled={runningFunderId !== null}
                className="inline-flex items-center gap-1.5 rounded-lg border border-navy-200 bg-white px-3 py-1.5 text-sm font-medium text-navy-700 transition hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {runningFunderId === f.id ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Target className="h-3.5 w-3.5" />
                )}
                {f.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && groups.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-navy-200 bg-navy-50 py-20 text-center">
          <Target className="mb-4 h-10 w-10 text-navy-300" />
          <p className="text-base font-semibold text-navy-700">No competitor analyses yet</p>
          <p className="mt-2 max-w-sm text-sm text-navy-500">
            Select a funder above to analyze their 990-PF giving history and identify
            competing organizations. Giving history must be populated first via the
            990 Mining agent.
          </p>
        </div>
      )}

      {/* Funder groups */}
      {groups.map((group) => (
        <div
          key={group.funderId}
          className="rounded-xl border border-border bg-white shadow-sm"
        >
          {/* Funder header */}
          <button
            className="flex w-full items-center justify-between p-5 text-left"
            onClick={() =>
              setExpandedFunder(
                expandedFunder === group.funderId ? null : group.funderId,
              )
            }
          >
            <div className="flex items-center gap-3">
              <Target className="h-5 w-5 shrink-0 text-navy-400" />
              <div>
                <p className="font-semibold text-navy-900">{group.funderName}</p>
                <p className="text-xs text-navy-500">
                  {group.competitors.length} competitor
                  {group.competitors.length !== 1 ? "s" : ""} identified ·{" "}
                  Last analyzed{" "}
                  {new Date(group.lastAnalyzed).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {competitionBadge(group.competitionLevel)}
              <svg
                className={`h-4 w-4 shrink-0 text-navy-400 transition-transform ${expandedFunder === group.funderId ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>

          {/* Competitor list */}
          {expandedFunder === group.funderId && (
            <div className="border-t border-navy-100">
              {group.competitors.length === 0 ? (
                <p className="px-5 py-4 text-sm text-navy-500">
                  No individual competitors recorded for this funder.
                </p>
              ) : (
                <div className="divide-y divide-navy-100">
                  {group.competitors.map((competitor) => {
                    const analysis = parseAnalysis(competitor.grant_purpose);
                    return (
                      <div key={competitor.id} className="px-5 py-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-navy-900">
                              {competitor.competitor_name}
                            </p>
                            {analysis.whatTheyDo && (
                              <p className="mt-1 text-sm text-navy-600">
                                {analysis.whatTheyDo}
                              </p>
                            )}
                            {analysis.howTheyDiffer && (
                              <p className="mt-1 text-xs text-navy-500">
                                <span className="font-medium">Difference:</span>{" "}
                                {analysis.howTheyDiffer}
                              </p>
                            )}
                            {analysis.competitiveEdge && (
                              <p className="mt-0.5 text-xs text-navy-500">
                                <span className="font-medium">Their edge:</span>{" "}
                                {analysis.competitiveEdge}
                              </p>
                            )}
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-medium text-navy-900">
                              {formatCurrency(competitor.grant_amount)}
                            </p>
                            {competitor.fiscal_year && (
                              <p className="text-xs text-navy-500">
                                FY {competitor.fiscal_year}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Re-run button */}
              {editable && (
                <div className="border-t border-navy-100 px-5 py-3">
                  <button
                    onClick={() => void handleRunAnalysis(group.funderId)}
                    disabled={runningFunderId !== null}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {runningFunderId === group.funderId ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    Re-run analysis
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
