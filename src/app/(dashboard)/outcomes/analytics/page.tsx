"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button, LoadingSpinner } from "@/components/ui";
import { SuccessAnalytics } from "@/components/outcomes/SuccessAnalytics";
import { createClient } from "@/lib/supabase/client";
import {
  analyzeOutcomes,
  rankNarratives,
  type NarrativeRankInput,
  type OutcomeInput,
} from "@/lib/ai/learning/outcome-analyzer";
import type { Enums } from "@/types/database";

type FunderCategory = Enums<"funder_category">;

/**
 * Success-rate analytics dashboards (BLUEPRINT §4.10). Aggregates real outcome
 * rows with {@link analyzeOutcomes} and ranks proven narratives with
 * {@link rankNarratives}; both reads are RLS-scoped to the organization. All
 * computation is client-side over fetched rows — no mocks, no server roundtrip.
 */
export default function OutcomeAnalyticsPage() {
  const [outcomes, setOutcomes] = useState<OutcomeInput[]>([]);
  const [narratives, setNarratives] = useState<NarrativeRankInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const [outcomesRes, narrativesRes] = await Promise.all([
      supabase
        .from("outcomes")
        .select(
          "result, awarded_amount, requested_amount, funder_category, opportunity_category, denial_reason, recorded_at",
        ),
      supabase
        .from("proven_narratives")
        .select(
          "id, narrative_text, section_type, funder_category, success_count, effectiveness_score, last_used_at",
        ),
    ]);

    if (outcomesRes.error) {
      setError("Could not load analytics.");
      setLoading(false);
      return;
    }

    setOutcomes(outcomesRes.data ?? []);
    setNarratives(narrativesRes.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const analysis = useMemo(() => analyzeOutcomes(outcomes), [outcomes]);

  const topNarratives = useMemo(() => {
    // Denied outcomes per funder category, used as the failure tally when
    // recomputing effectiveness for ranking (Behavioral Contracts §10).
    const failuresByCategory = new Map<FunderCategory, number>();
    for (const o of outcomes) {
      if (o.result === "denied" && o.funder_category) {
        failuresByCategory.set(
          o.funder_category,
          (failuresByCategory.get(o.funder_category) ?? 0) + 1,
        );
      }
    }
    return rankNarratives(narratives, failuresByCategory, 5);
  }, [narratives, outcomes]);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/outcomes"
          className="inline-flex items-center gap-1.5 text-sm text-navy-500 transition hover:text-navy-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to outcomes
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-navy-900">
          Outcomes &amp; Analytics
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Success rates by category and over time, dollar efficiency, and your
          top performing narratives.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
          <div className="mt-2">
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <LoadingSpinner center label="Loading analytics…" />
      ) : (
        <SuccessAnalytics analysis={analysis} topNarratives={topNarratives} />
      )}
    </div>
  );
}
