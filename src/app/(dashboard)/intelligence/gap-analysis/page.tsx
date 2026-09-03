"use client";

// Gap Analyzer (FEATURE_REGISTRY_v2.md rows #145/#146: "Geographic Gap
// Detection" + "Gap Recommendations"). Synthesis/display layer over two real
// data sources - GET /api/intelligence/gap-analysis, backed by
// src/lib/intelligence/gap-recommendations.ts, which itself combines the
// already-built per-opportunity Narrative Gap Analysis (row #144) with a new
// portfolio-wide geographic text-overlap check (row #145). Not a new
// autonomous agent - a request-scoped read for this view only.
//
// Geographic matching is text-based/best-effort (free-text
// funders.geographic_focus / opportunities.geographic_restrictions columns,
// not structured geospatial data) - the methodology copy from the API is
// shown verbatim so this is never read as a verified determination.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, MapPin, RefreshCw } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Badge, Card, EmptyState, LoadingSpinner } from "@/components/ui";

interface GapRecommendation {
  type: "narrative" | "geographic";
  category?: string;
  message: string;
}

interface OpportunityGapSummary {
  opportunityId: string;
  opportunityName: string;
  narrativeCompletenessScore: number;
  missingCategories: string[];
  narrowedByRequirements: boolean;
  geographicMismatch: {
    funderName: string | null;
    source: "opportunity" | "funder";
    geographicText: string;
  } | null;
  recommendations: GapRecommendation[];
}

interface PortfolioGapAnalysis {
  orgServiceArea: string | null;
  opportunitiesScanned: number;
  narrativeScanCapped: boolean;
  geographicMethodology: string;
  perOpportunity: OpportunityGapSummary[];
}

function completenessVariant(score: number): "success" | "warning" | "error" {
  if (score >= 80) return "success";
  if (score >= 50) return "warning";
  return "error";
}

export default function GapAnalysisPage() {
  const [data, setData] = useState<PortfolioGapAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/intelligence/gap-analysis", { cache: "no-store" });
      if (!res.ok) {
        setError("Could not load the gap analysis.");
        setData(null);
      } else {
        setData((await res.json()) as PortfolioGapAnalysis);
      }
    } catch {
      setError("Could not reach the server.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const withGaps =
    data?.perOpportunity.filter((o) => o.recommendations.length > 0) ?? [];
  const withoutGaps =
    data?.perOpportunity.filter((o) => o.recommendations.length === 0) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Gap Analysis"
        description="Narrative completeness and geographic fit checked against your open opportunity portfolio, with a concrete next action per gap."
      />

      {loading && (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      )}

      {!loading && error && (
        <Card>
          <div className="flex items-center gap-2 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            {error}
          </div>
        </Card>
      )}

      {!loading && !error && data && !data.orgServiceArea && (
        <EmptyState
          icon={MapPin}
          title="No service area on file"
          description="Add a service area in Organization Profile to enable geographic gap detection. Narrative gap results below are unaffected."
        />
      )}

      {!loading && !error && data && data.opportunitiesScanned === 0 && (
        <EmptyState
          title="No open opportunities to scan"
          description="This view checks your currently open opportunity portfolio - there's nothing open on file right now."
        />
      )}

      {!loading && !error && data && data.opportunitiesScanned > 0 && (
        <>
          <Card title="Methodology" className="text-sm text-slate-600">
            <div className="space-y-2">
              <p>{data.geographicMethodology}</p>
              {data.narrativeScanCapped && (
                <p className="text-amber-700">
                  Showing the {data.opportunitiesScanned} soonest-deadline open
                  opportunities only - some open opportunities beyond this cap
                  are not shown.
                </p>
              )}
            </div>
          </Card>

          {withGaps.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-slate-700">
                Opportunities with flagged gaps ({withGaps.length})
              </h2>
              {withGaps.map((opp) => (
                <Card
                  key={opp.opportunityId}
                  title={opp.opportunityName}
                  actions={
                    <Badge variant={completenessVariant(opp.narrativeCompletenessScore)}>
                      {opp.narrativeCompletenessScore}% narrative complete
                    </Badge>
                  }
                >
                  <div className="space-y-3">
                    {opp.geographicMismatch && (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                        <span>
                          Geographic mismatch
                          {opp.geographicMismatch.funderName
                            ? ` with ${opp.geographicMismatch.funderName}`
                            : ""}
                          : &ldquo;{opp.geographicMismatch.geographicText}&rdquo;
                        </span>
                      </div>
                    )}

                    <ul className="space-y-2">
                      {opp.recommendations.map((rec, idx) => (
                        <li
                          key={idx}
                          className="flex items-start gap-2 text-sm text-slate-700"
                        >
                          <Badge
                            variant={rec.type === "geographic" ? "warning" : "info"}
                            className="mt-0.5 shrink-0"
                          >
                            {rec.type === "geographic" ? "Geographic" : "Narrative"}
                          </Badge>
                          <span>{rec.message}</span>
                        </li>
                      ))}
                    </ul>

                    {opp.narrowedByRequirements && (
                      <p className="text-xs text-slate-400">
                        Narrative categories narrowed to this opportunity's stated requirements.
                      </p>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {withoutGaps.length > 0 && (
            <Card
              title={`No gaps flagged (${withoutGaps.length})`}
              actions={
                <button
                  type="button"
                  onClick={() => void load()}
                  className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  Refresh
                </button>
              }
            >
              <div className="flex flex-wrap gap-2">
                {withoutGaps.map((opp) => (
                  <Badge key={opp.opportunityId} variant="success">
                    {opp.opportunityName} — {opp.narrativeCompletenessScore}%
                  </Badge>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
