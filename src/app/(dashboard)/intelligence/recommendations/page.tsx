"use client";

// Funder Recommendations — ranked matches from FunderRecommender
// (src/lib/intelligence/funder-recommender.ts), scored by geographic fit,
// program alignment, and award size (match_score 0-100). This page has no
// urgency/status field of its own (that model belongs to the separate,
// unbuilt relationship_recommendations table — see AGENTS_v2.md AG-19 dead
// twin note) — so the requested "urgency bar" palette is applied to
// match_score priority tiers instead: a high score means "act on this while
// it's hot" (urgent), not an alarm. "Mark Done" has no separate persisted
// state to flip; the real terminal action is "Add to Funders" (inserts a
// real funders row), which already renders an "Added" indicator once done.
// "Dismiss" hides a card from the current view only — there's no
// dismissed_at column to persist it against.

import { useState, useEffect, useCallback } from "react";
import { ChevronDown, ChevronUp, Plus, Search, AlertCircle, X } from "lucide-react";

import { useProfile } from "@/lib/hooks/useProfile";
import { createClient } from "@/lib/supabase/client";

const CANVAS = "#D6E4F0";
const CARD_BG = "#FFFFFF";
const BORDER = "#C3D3E2";
const TEXT_PRIMARY = "#0F172A";
const TEXT_SECONDARY = "#64748B";
const TEXT_MUTED = "#94A3B8";
const ACCENT = "#0077B6";
const ERROR_BG = "#FEE2E2";
const ERROR_BORDER = "#FECACA";
const ERROR_TEXT = "#B91C1C";
const SUCCESS_BG = "#DCFCE7";
const SUCCESS_TEXT = "#15803D";
const CHIP_BG = "#E0F2FE";
const CHIP_TEXT = "#0369A1";

// Priority tiers per CURRENT TASK spec: urgent=#DC2626, normal=#0EA5E9, low=#6B7280.
// Mapped onto match_score: a strong match is "urgent" (pursue while relevant),
// a mid match is "normal" priority, a weak match is "low" priority.
type Priority = "urgent" | "normal" | "low";
const PRIORITY_COLORS: Record<Priority, string> = {
  urgent: "#DC2626",
  normal: "#0EA5E9",
  low: "#6B7280",
};
const PRIORITY_LABELS: Record<Priority, string> = {
  urgent: "High Priority",
  normal: "Worth Pursuing",
  low: "Low Priority",
};

function priorityFromScore(score: number): Priority {
  if (score >= 70) return "urgent";
  if (score >= 40) return "normal";
  return "low";
}

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

interface OrgSummary {
  name: string | null;
  mission_statement: string | null;
  state: string | null;
  service_area: string | null;
  annual_budget: number | null;
  target_population: string | null;
  default_geography: string;
}

interface RecommendationsResponse {
  recommendations: FunderRecommendation[];
  count: number;
  organization: OrgSummary | null;
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

function FunderCard({
  rec,
  onAdd,
  onDismiss,
  isAdding,
  isAdded,
}: {
  rec: FunderRecommendation;
  onAdd: (rec: FunderRecommendation) => void;
  onDismiss: (id: string) => void;
  isAdding: boolean;
  isAdded: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explanationLoading, setExplanationLoading] = useState(false);
  const [explanationError, setExplanationError] = useState<string | null>(null);

  const priority = priorityFromScore(rec.match_score);
  const color = PRIORITY_COLORS[priority];

  const toggleExpanded = useCallback(() => {
    setExpanded((v) => {
      const next = !v;
      if (next && explanation === null && !explanationLoading) {
        setExplanationLoading(true);
        setExplanationError(null);
        fetch(`/api/intelligence/recommendations/explain?funderId=${encodeURIComponent(rec.foundation_id)}`)
          .then(async (res) => {
            const data = (await res.json().catch(() => ({}))) as { explanation?: string; error?: string };
            if (!res.ok) throw new Error(data.error ?? "Failed to generate explanation.");
            setExplanation(data.explanation ?? "No explanation available.");
          })
          .catch((err: unknown) => {
            setExplanationError(err instanceof Error ? err.message : "Failed to generate explanation.");
          })
          .finally(() => setExplanationLoading(false));
      }
      return next;
    });
  }, [explanation, explanationLoading, rec.foundation_id]);

  return (
    <div
      className="flex overflow-hidden rounded-xl"
      style={{ backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: "0 2px 10px rgba(15,23,42,0.06)" }}
    >
      <div className="w-1.5 shrink-0" style={{ backgroundColor: color }} aria-hidden />
      <div className="flex-1">
        <div className="flex items-start gap-4 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold" style={{ color: TEXT_PRIMARY }}>
                {rec.name}
              </p>
              <span
                className="rounded-full px-2.5 py-0.5 text-xs font-bold"
                style={{ backgroundColor: `${color}1A`, color }}
              >
                {PRIORITY_LABELS[priority]} · {rec.match_score}%
              </span>
              {rec.ein && (
                <span className="text-xs" style={{ color: TEXT_MUTED }}>
                  EIN {rec.ein}
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs" style={{ color: TEXT_MUTED }}>
              {rec.avg_award_amount !== null && <span>Avg award: ${rec.avg_award_amount.toLocaleString()}</span>}
              {rec.total_annual_giving !== null && (
                <span>Annual giving: ${(rec.total_annual_giving / 1_000_000).toFixed(1)}M</span>
              )}
              {rec.geographic_focus.length > 0 && <span>Geo: {rec.geographic_focus.slice(0, 2).join(", ")}</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {rec.match_reasons.slice(0, 3).map((reason, i) => (
                <span
                  key={i}
                  className="rounded-md px-2 py-0.5 text-xs"
                  style={{ backgroundColor: CHIP_BG, color: CHIP_TEXT }}
                >
                  {reason}
                </span>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isAdded ? (
              <span
                className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold"
                style={{ backgroundColor: SUCCESS_BG, color: SUCCESS_TEXT }}
              >
                <Plus className="h-3 w-3" />
                Done
              </span>
            ) : (
              <button
                onClick={() => onAdd(rec)}
                disabled={isAdding}
                className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60"
                style={{ backgroundColor: ACCENT, color: "#FFFFFF" }}
              >
                <Plus className="h-3 w-3" />
                {isAdding ? "Adding…" : "Add to Funders"}
              </button>
            )}
            <button
              onClick={() => onDismiss(rec.foundation_id)}
              className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition"
              style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}`, color: TEXT_SECONDARY }}
            >
              <X className="h-3 w-3" />
              Dismiss
            </button>
            <button
              onClick={toggleExpanded}
              className="rounded-lg p-1.5 transition"
              style={{ color: TEXT_MUTED }}
              aria-label={expanded ? "Collapse" : "Expand match reasoning"}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        </div>
        {expanded && (
          <div className="px-5 py-4 space-y-3" style={{ borderTop: `1px solid ${BORDER}` }}>
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide" style={{ color: TEXT_MUTED }}>
                Match reasoning
              </p>
              <ul className="space-y-1">
                {rec.match_reasons.map((reason, i) => (
                  <li key={i} className="text-sm" style={{ color: TEXT_PRIMARY }}>
                    • {reason}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide" style={{ color: TEXT_MUTED }}>
                AI explanation
              </p>
              {explanationLoading && (
                <p className="text-sm" style={{ color: TEXT_SECONDARY }}>
                  Generating explanation…
                </p>
              )}
              {explanationError && (
                <p className="text-sm" style={{ color: ERROR_TEXT }}>
                  {explanationError}
                </p>
              )}
              {explanation && (
                <p className="text-sm" style={{ color: TEXT_PRIMARY }}>
                  {explanation}
                </p>
              )}
            </div>
            {rec.program_priorities.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide" style={{ color: TEXT_MUTED }}>
                  Program priorities
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {rec.program_priorities.map((p, i) => (
                    <span
                      key={i}
                      className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                      style={{ backgroundColor: "#F1F5F9", color: "#475569" }}
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function OrgSummaryCard({ org }: { org: OrgSummary }) {
  return (
    <div className="rounded-xl p-5" style={{ backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: "0 4px 20px rgba(15,23,42,0.08)" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold" style={{ color: TEXT_PRIMARY }}>
          {org.name ?? "Your organization"}
        </h2>
        <span className="text-xs" style={{ color: TEXT_MUTED }}>
          Recommendations are tailored to this profile
        </span>
      </div>
      {org.mission_statement && (
        <p className="mt-1.5 text-sm" style={{ color: TEXT_SECONDARY }}>
          {org.mission_statement}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-xs" style={{ color: TEXT_SECONDARY }}>
        <span>
          <span style={{ color: TEXT_MUTED }}>Service area:</span> {org.service_area ?? org.state ?? "Not specified"}
        </span>
        {org.target_population && (
          <span>
            <span style={{ color: TEXT_MUTED }}>Target population:</span> {org.target_population}
          </span>
        )}
        {org.annual_budget !== null && (
          <span>
            <span style={{ color: TEXT_MUTED }}>Annual budget:</span> ${org.annual_budget.toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}

export default function RecommendationsPage() {
  const { profile } = useProfile();
  const orgId = profile?.organization_id ?? "";

  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("50000");
  const [geography, setGeography] = useState("");
  const [geographyTouched, setGeographyTouched] = useState(false);
  const [org, setOrg] = useState<OrgSummary | null>(null);
  const [recommendations, setRecommendations] = useState<FunderRecommendation[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
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
      if (geographyTouched && geography) params.set("geography", geography);
      const res = await fetch(`/api/intelligence/recommendations?${params.toString()}`);
      const data = (await res.json().catch(() => ({}))) as RecommendationsResponse;
      if (!res.ok) {
        setError(data.error ?? "Failed to load recommendations.");
      } else {
        setRecommendations(data.recommendations ?? []);
        setDismissedIds(new Set());
        if (data.organization) {
          setOrg(data.organization);
          if (!geographyTouched) setGeography(data.organization.default_geography);
        }
      }
    } catch {
      setError("Could not reach the recommendations API.");
    }
    setLoading(false);
    // geography/geographyTouched intentionally excluded: geography is applied via the
    // "Find Matches" button, not auto-refetched on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        geographic_focus: rec.geographic_focus.length > 0 ? rec.geographic_focus.join(", ") : null,
        notes: noteParts.length > 0 ? noteParts.join(" — ") : null,
      });

      if (!error) {
        setAddedIds((prev) => new Set([...prev, rec.foundation_id]));
      }
    } finally {
      setAddingId(null);
    }
  }

  function handleDismiss(foundationId: string) {
    setDismissedIds((prev) => new Set(prev).add(foundationId));
  }

  const visibleRecommendations = recommendations.filter((r) => !dismissedIds.has(r.foundation_id));

  return (
    <div className="min-h-screen space-y-8 p-6" style={{ backgroundColor: CANVAS }}>
      <div style={{ borderLeft: `4px solid ${ACCENT}`, paddingLeft: "1rem" }}>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: TEXT_PRIMARY }}>
          Funder Recommendations
        </h1>
        <p className="mt-1 text-sm" style={{ color: TEXT_SECONDARY }}>
          Ranked funder matches based on geographic fit, program alignment, and award size.
        </p>
      </div>

      {org && <OrgSummaryCard org={org} />}

      <div className="rounded-xl p-4" style={{ backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: "0 2px 10px rgba(15,23,42,0.06)" }}>
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[200px] flex-1">
            <label className="mb-1.5 block text-xs font-medium" style={{ color: TEXT_SECONDARY }} htmlFor="category-select">
              Program Category
            </label>
            <select
              id="category-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ border: `1px solid ${BORDER}`, backgroundColor: "#FFFFFF", color: TEXT_PRIMARY }}
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
            <label className="mb-1.5 block text-xs font-medium" style={{ color: TEXT_SECONDARY }} htmlFor="amount-input">
              Grant Amount ($)
            </label>
            <input
              id="amount-input"
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ border: `1px solid ${BORDER}`, backgroundColor: "#FFFFFF", color: TEXT_PRIMARY }}
              placeholder="50000"
            />
          </div>
          <div className="min-w-[180px] flex-1">
            <label className="mb-1.5 block text-xs font-medium" style={{ color: TEXT_SECONDARY }} htmlFor="geography-input">
              Geographic Scope
            </label>
            <input
              id="geography-input"
              type="text"
              value={geography}
              onChange={(e) => {
                setGeography(e.target.value);
                setGeographyTouched(true);
              }}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ border: `1px solid ${BORDER}`, backgroundColor: "#FFFFFF", color: TEXT_PRIMARY }}
              placeholder="e.g. Texas"
            />
          </div>
          <button
            onClick={() => void fetchRecommendations()}
            disabled={loading || !orgId}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60"
            style={{ backgroundColor: ACCENT, color: "#FFFFFF" }}
          >
            <Search className="h-4 w-4" />
            {loading ? "Searching…" : "Find Matches"}
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg px-4 py-3 text-sm"
          style={{ border: `1px solid ${ERROR_BORDER}`, backgroundColor: ERROR_BG, color: ERROR_TEXT }}
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {!loading && visibleRecommendations.length === 0 && !error && (
        <div
          className="flex flex-col items-center justify-center rounded-xl py-20 text-center"
          style={{ border: `1px solid ${BORDER}`, backgroundColor: CARD_BG }}
        >
          <Search className="mb-4 h-10 w-10" style={{ color: TEXT_MUTED }} />
          <p className="text-base font-semibold" style={{ color: TEXT_PRIMARY }}>
            No recommendations found
          </p>
          <p className="mt-2 max-w-sm text-sm" style={{ color: TEXT_SECONDARY }}>
            Adjust the filters or add more grantmaker profiles to the intelligence library to improve matches.
          </p>
        </div>
      )}

      {visibleRecommendations.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: TEXT_SECONDARY }}>
            {visibleRecommendations.length} match{visibleRecommendations.length !== 1 ? "es" : ""} found
          </p>
          {visibleRecommendations.map((rec) => (
            <FunderCard
              key={rec.foundation_id}
              rec={rec}
              onAdd={handleAdd}
              onDismiss={handleDismiss}
              isAdding={addingId === rec.foundation_id}
              isAdded={addedIds.has(rec.foundation_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
