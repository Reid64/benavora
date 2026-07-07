"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronDown, ChevronUp, Plus, Search, AlertCircle } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { useProfile } from "@/lib/hooks/useProfile";
import { createClient } from "@/lib/supabase/client";

interface FunderRecommendation {
  foundation_id: string;
  name: string;
  ein: string | null;
  match_score: number;
  match_reasons: string[];
  avg_award_amount: number | null;
  total_annual_giving: number | null;
  geographic_focus: string[];
  program_priorities: string[];
}

interface RecommendationsResponse {
  recommendations: FunderRecommendation[];
  count: number;
  error?: string;
}

const PROGRAM_CATEGORIES = [
  "Housing & Shelter",
  "Workforce Development",
  "Education",
  "Health & Wellness",
  "Food Security",
  "Youth Development",
  "Arts & Culture",
  "Environmental Justice",
  "Economic Development",
  "Social Services",
];

function ScoreBadge({ score }: { score: number }) {
  const variant = score < 40 ? "error" : score < 60 ? "warning" : "success";
  return <Badge variant={variant}>{score}%</Badge>;
}

function FunderCard({
  rec,
  onAdd,
  isAdding,
}: {
  rec: FunderRecommendation;
  onAdd: (rec: FunderRecommendation) => void;
  isAdding: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex items-start gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-text">{rec.name}</p>
            <ScoreBadge score={rec.match_score} />
            {rec.ein && (
              <span className="text-xs text-text-muted">EIN {rec.ein}</span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-text-muted">
            {rec.avg_award_amount !== null && (
              <span>Avg award: ${rec.avg_award_amount.toLocaleString()}</span>
            )}
            {rec.total_annual_giving !== null && (
              <span>Annual giving: ${(rec.total_annual_giving / 1_000_000).toFixed(1)}M</span>
            )}
            {rec.geographic_focus.length > 0 && (
              <span>Geo: {rec.geographic_focus.slice(0, 2).join(", ")}</span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {rec.match_reasons.slice(0, 3).map((reason, i) => (
              <span
                key={i}
                className="rounded-md bg-info-bg px-2 py-0.5 text-xs text-info-text"
              >
                {reason}
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => onAdd(rec)}
            disabled={isAdding}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Plus className="h-3 w-3" />
            {isAdding ? "Adding…" : "Add to Funders"}
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="rounded-lg p-1.5 text-text-muted transition hover:bg-surface-raised hover:text-text"
            aria-label={expanded ? "Collapse" : "Expand match reasoning"}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-border px-5 py-4 space-y-3">
          <div>
            <p className="mb-1.5 text-xs font-medium text-text-muted uppercase tracking-wide">Match reasoning</p>
            <ul className="space-y-1">
              {rec.match_reasons.map((reason, i) => (
                <li key={i} className="text-sm text-text">• {reason}</li>
              ))}
            </ul>
          </div>
          {rec.program_priorities.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-text-muted uppercase tracking-wide">Program priorities</p>
              <div className="flex flex-wrap gap-1.5">
                {rec.program_priorities.map((p, i) => (
                  <Badge key={i} variant="neutral">
                    {p}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RecommendationsPage() {
  const { profile } = useProfile();
  const orgId = profile?.organization_id ?? "";

  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("50000");
  const [recommendations, setRecommendations] = useState<FunderRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [addingId, setAddingId] = useState<string | null>(null);

  const fetchRecommendations = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (category) params.set("category", category);
      if (amount) params.set("amount", amount);
      const res = await fetch(`/api/intelligence/recommendations?${params.toString()}`);
      const data = (await res.json().catch(() => ({}))) as RecommendationsResponse;
      if (!res.ok) {
        setError(data.error ?? "Failed to load recommendations.");
      } else {
        setRecommendations(data.recommendations ?? []);
      }
    } catch {
      setError("Could not reach the recommendations API.");
    }
    setLoading(false);
  }, [orgId, category, amount]);

  useEffect(() => {
    void fetchRecommendations();
  }, [fetchRecommendations]);

  async function handleAdd(rec: FunderRecommendation) {
    if (!orgId || addedIds.has(rec.foundation_id) || addingId) return;
    setAddingId(rec.foundation_id);
    try {
      const supabase = createClient();
      const noteParts = [
        rec.ein ? `EIN ${rec.ein}` : null,
        rec.match_reasons.length > 0 ? `Match reasons: ${rec.match_reasons.join("; ")}` : null,
      ].filter(Boolean);

      const { error } = await supabase.from("funders").insert({
        organization_id: orgId,
        name: rec.name,
        category: "private_foundation",
        annual_giving_budget: rec.total_annual_giving,
        geographic_focus: rec.geographic_focus,
        notes: noteParts.length > 0 ? noteParts.join(" — ") : null,
      });

      if (!error) {
        setAddedIds((prev) => new Set([...prev, rec.foundation_id]));
      }
    } finally {
      setAddingId(null);
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Funder Recommendations
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Ranked funder matches based on geographic fit, program alignment, and award size.
        </p>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1.5 block text-xs font-medium text-text-muted" htmlFor="category-select">
              Program Category
            </label>
            <select
              id="category-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
            >
              <option value="">All categories</option>
              {PROGRAM_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[160px]">
            <label className="mb-1.5 block text-xs font-medium text-text-muted" htmlFor="amount-input">
              Grant Amount ($)
            </label>
            <input
              id="amount-input"
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
              placeholder="50000"
            />
          </div>
          <button
            onClick={() => void fetchRecommendations()}
            disabled={loading || !orgId}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Search className="h-4 w-4" />
            {loading ? "Searching…" : "Find Matches"}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-error-border bg-error-bg px-4 py-3 text-sm text-error-text"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Results */}
      {!loading && recommendations.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-surface py-20 text-center shadow-sm">
          <Search className="mb-4 h-10 w-10 text-text-muted" />
          <p className="text-base font-semibold text-text">No recommendations found</p>
          <p className="mt-2 max-w-sm text-sm text-text-muted">
            Adjust the filters or add more grantmaker profiles to the intelligence library to improve matches.
          </p>
        </div>
      )}

      {recommendations.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-text-muted">{recommendations.length} matches found</p>
          {recommendations.map((rec) => (
            <div key={rec.foundation_id} className="relative">
              {addedIds.has(rec.foundation_id) && (
                <div className="absolute right-14 top-4 z-10 rounded-md bg-success-bg px-2 py-0.5 text-xs text-success-text">
                  Added
                </div>
              )}
              <FunderCard rec={rec} onAdd={handleAdd} isAdding={addingId === rec.foundation_id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
