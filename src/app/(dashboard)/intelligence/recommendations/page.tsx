"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronDown, ChevronUp, Plus, Search, AlertCircle } from "lucide-react";

import { useProfile } from "@/lib/hooks/useProfile";

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
  let cls = "bg-green-900/40 text-green-300";
  if (score < 60) cls = "bg-yellow-900/40 text-yellow-300";
  if (score < 40) cls = "bg-red-900/40 text-red-300";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {score}%
    </span>
  );
}

function FunderCard({
  rec,
  onAdd,
}: {
  rec: FunderRecommendation;
  onAdd: (rec: FunderRecommendation) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800">
      <div className="flex items-start gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-white">{rec.name}</p>
            <ScoreBadge score={rec.match_score} />
            {rec.ein && (
              <span className="text-xs text-gray-400">EIN {rec.ein}</span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-gray-400">
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
                className="rounded-md bg-blue-900/30 px-2 py-0.5 text-xs text-blue-300"
              >
                {reason}
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => onAdd(rec)}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-700"
          >
            <Plus className="h-3 w-3" />
            Add to Funders
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-700 hover:text-white"
            aria-label={expanded ? "Collapse" : "Expand match reasoning"}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-gray-700 px-5 py-4 space-y-3">
          <div>
            <p className="mb-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide">Match reasoning</p>
            <ul className="space-y-1">
              {rec.match_reasons.map((reason, i) => (
                <li key={i} className="text-sm text-gray-300">• {reason}</li>
              ))}
            </ul>
          </div>
          {rec.program_priorities.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-gray-500 uppercase tracking-wide">Program priorities</p>
              <div className="flex flex-wrap gap-1.5">
                {rec.program_priorities.map((p, i) => (
                  <span key={i} className="rounded-md bg-gray-700 px-2 py-0.5 text-xs text-gray-300">
                    {p}
                  </span>
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

  function handleAdd(rec: FunderRecommendation) {
    setAddedIds((prev) => new Set([...prev, rec.foundation_id]));
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Funder Recommendations
        </h1>
        <p className="mt-1 text-sm text-gray-400">
          Ranked funder matches based on geographic fit, program alignment, and award size.
        </p>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-gray-700 bg-gray-800 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1.5 block text-xs font-medium text-gray-400" htmlFor="category-select">
              Program Category
            </label>
            <select
              id="category-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
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
            <label className="mb-1.5 block text-xs font-medium text-gray-400" htmlFor="amount-input">
              Grant Amount ($)
            </label>
            <input
              id="amount-input"
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
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
          className="flex items-start gap-2 rounded-lg border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Results */}
      {!loading && recommendations.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-gray-700 bg-gray-800 py-20 text-center">
          <Search className="mb-4 h-10 w-10 text-gray-600" />
          <p className="text-base font-semibold text-gray-300">No recommendations found</p>
          <p className="mt-2 max-w-sm text-sm text-gray-500">
            Adjust the filters or add more grantmaker profiles to the intelligence library to improve matches.
          </p>
        </div>
      )}

      {recommendations.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">{recommendations.length} matches found</p>
          {recommendations.map((rec) => (
            <div key={rec.foundation_id} className="relative">
              {addedIds.has(rec.foundation_id) && (
                <div className="absolute right-14 top-4 z-10 rounded-md bg-green-900/50 px-2 py-0.5 text-xs text-green-300">
                  Added
                </div>
              )}
              <FunderCard rec={rec} onAdd={handleAdd} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
