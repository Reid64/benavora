"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { differenceInCalendarDays } from "date-fns";
import { ChevronDown, ChevronUp, Home, Plus, Search } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { LoadingCard } from "@/components/ui/LoadingCard";
import { EmptyStateCard } from "@/components/ui/EmptyStateCard";
import { OPPORTUNITY_STATUSES } from "@/lib/utils/constants";
import { decodeHtmlEntities, formatCurrency, formatDate, humanizeEnum } from "@/lib/utils/formatters";
import type { Enums, Tables } from "@/types/database";

type OpportunitySourceType = Enums<"opportunity_source_type">;
type OpportunityStatus = Enums<"opportunity_status">;

// opportunity_probability_scores (migration 093) — the real, persisted output
// of computeGrantProbability() (src/lib/intelligence/grant-probability-engine.ts,
// FEATURE_REGISTRY_v2.md #102, BUILT — VERIFIED). This UI only reads this row;
// it never recomputes anything.
interface GrantProbabilityFactor {
  name: string;
  weight: number;
  value: number;
  contribution: number;
}

interface ProbabilityScoreRow {
  opportunity_id: string;
  overall_score: number | null;
  confidence: "high" | "medium" | "low" | null;
  factors: GrantProbabilityFactor[] | null;
  recommendation: "apply" | "consider" | "skip" | null;
  key_risks: string[] | null;
  key_strengths: string[] | null;
  estimated_roi: string | null;
  time_to_complete: string | null;
}

type OpportunityRow = Tables<"opportunities"> & {
  funderName: string | null;
  probabilityScore: number | null;
  probabilityData: ProbabilityScoreRow | null;
};

// Maps the 4 real factor.name values from grant-probability-engine.ts to a
// human-readable label. Do not add/rename factor names here — these are the
// exact literal strings the engine writes; if a 5th ever appears, it falls
// back to humanizeEnum() below rather than being silently dropped.
const FACTOR_LABELS: Record<string, string> = {
  eligibility_score: "Eligibility Fit",
  category_win_rate: "Category Win Rate",
  deadline_proximity: "Deadline Proximity",
  twin_completeness: "Digital Twin Completeness",
};

const CONFIDENCE_TONE: Record<string, string> = {
  high: "#16A34A",
  medium: "#D97706",
  low: "#94A3B8",
};

const DEFAULT_RECOMMENDATION_TONE = { bg: "#FEF3C7", color: "#B45309", label: "Consider" };

const RECOMMENDATION_TONE: Record<string, { bg: string; color: string; label: string }> = {
  apply: { bg: "#F0FDF4", color: "#16A34A", label: "Apply" },
  consider: DEFAULT_RECOMMENDATION_TONE,
  skip: { bg: "#FEF2F2", color: "#B91C1C", label: "Skip" },
};

type OrgHousingProfile = Pick<
  Tables<"organizations">,
  "target_population" | "mission_statement" | "service_area"
>;

type SourceBucket = "federal" | "foundation" | "corporate" | "state" | "land_bank";

// The real opportunity_source_type enum (migration 010) has 8 values, finer
// grained than the 4-bucket badge spec here. Government tiers other than
// federal/state and faith-based/international sources fall back to a neutral
// label rather than being forced into one of the 4 colors.
const SOURCE_BUCKET_MAP: Partial<Record<OpportunitySourceType, SourceBucket>> = {
  government_federal: "federal",
  government_state: "state",
  government_local: "state",
  private_foundation: "foundation",
  community_foundation: "foundation",
  corporate_giving: "corporate",
};

const SOURCE_LABEL: Record<SourceBucket, string> = {
  federal: "Federal",
  foundation: "Foundation",
  corporate: "Corporate",
  state: "State/Local",
  land_bank: "Land Bank",
};

// Left accent bar + category color per the design spec. Land Bank isn't in the
// spec's 4-color list; it keeps the teal already used for the Land Bank
// Spotlight section below so the two don't send conflicting color signals.
const CATEGORY_ACCENT: Record<SourceBucket, string> = {
  federal: "#0077B6",
  foundation: "#7C3AED",
  corporate: "#0EA5E9",
  state: "#10B981",
  land_bank: "#0F766E",
};

const HOUSING_KEYWORDS = ["housing", "homeless", "shelter", "transitional"];

// Research & Discovery section treatment — PAGE_TREATMENT_PROTOCOL_V2.md /
// DESIGN_SYSTEM_V2_ASSIGNMENT.md. Frame: Bronze. Secondary accent: Slate
// Blue. 2026-08-18: confirmed via live getComputedStyle audit this page
// never received the v2 rollout (still the old sky-blue/cyan palette on a
// literal white page background) - same real gap as AutoApply's.
// SECTION_ACCENT stays bronze — it's the page-frame accent only (title text,
// left border, and the card/stat-box outer-wrapper "frame" backgrounds), not
// a button. Real action buttons use CTA_TEAL_BG/CTA_TEAL_TEXT (generic
// action = Slate Blue, incl. the primary "Run Land Bank Discovery" action)
// or ADD_OPPORTUNITY_BG (the one button that gets its own distinct color).
const SECTION_ACCENT = "#A4712C";
const CTA_TEAL_BG = "#4F6D8F";
const CTA_TEAL_TEXT = "#FFFFFF";
const ADD_OPPORTUNITY_BG = "#5C6935";

/** Org-level org.source is never set to "land_bank" — only opportunities are.
 * Detects a housing-focused org from its free-text profile fields, since
 * `organizations` has no NTEE code column (that only exists on
 * foundation_directory/nonprofits — see SCHEMA_REGISTRY_v2.md). */
function isHousingOrg(
  org: { target_population: string | null; mission_statement: string | null; service_area: string | null } | null,
): boolean {
  if (!org) return false;
  const haystack = `${org.target_population ?? ""} ${org.mission_statement ?? ""} ${org.service_area ?? ""}`.toLowerCase();
  return HOUSING_KEYWORDS.some((kw) => haystack.includes(kw));
}

const STATUS_FILTER_OPTIONS: { value: "all" | OpportunityStatus; label: string }[] = [
  { value: "all", label: "All Statuses" },
  ...OPPORTUNITY_STATUSES.map((s) => ({ value: s, label: humanizeEnum(s) })),
];

type SortOption =
  | "probability-desc"
  | "probability-asc"
  | "deadline-asc"
  | "amount-desc"
  | "eligibility-desc"
  | "name-asc";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "probability-desc", label: "Probability (High to Low)" },
  { value: "probability-asc", label: "Probability (Low to High)" },
  { value: "deadline-asc", label: "Deadline (Soonest First)" },
  { value: "amount-desc", label: "Amount (Highest First)" },
  { value: "eligibility-desc", label: "Eligibility (Highest First)" },
  { value: "name-asc", label: "Name (A-Z)" },
];

// Filter pills. "state_local" folds in land_bank opportunities (state/local
// government-adjacent) so Land Bank isn't orphaned from the main filter bar.
// "rolling"/"closing_soon" filter on deadline rather than source.
type FilterChip = "all" | "federal" | "foundation" | "corporate" | "state_local" | "rolling" | "closing_soon";

const FILTER_CHIPS: { value: FilterChip; label: string }[] = [
  { value: "all", label: "All" },
  { value: "federal", label: "Federal" },
  { value: "foundation", label: "Foundation" },
  { value: "corporate", label: "Corporate" },
  { value: "state_local", label: "State/Local" },
  { value: "rolling", label: "Rolling" },
  { value: "closing_soon", label: "Closing Soon" },
];

function sourceBucket(opp: { source: string | null; source_type: OpportunitySourceType | null }): SourceBucket | null {
  // discoverLandBankOpportunities() (land-bank-client.ts) sets `source`, not
  // `source_type` (there is no land_bank value in that enum) — check it first.
  if (opp.source === "land_bank") return "land_bank";
  return opp.source_type ? (SOURCE_BUCKET_MAP[opp.source_type] ?? null) : null;
}

function matchesFilterChip(opp: OpportunityRow, chip: FilterChip): boolean {
  if (chip === "all") return true;
  if (chip === "rolling") return !opp.deadline;
  if (chip === "closing_soon") {
    if (!opp.deadline) return false;
    return differenceInCalendarDays(new Date(opp.deadline), new Date()) <= 14;
  }
  const bucket = sourceBucket(opp);
  if (chip === "state_local") return bucket === "state" || bucket === "land_bank";
  return bucket === chip;
}

function deadlineColor(deadline: string | null): string {
  if (!deadline) return "#94A3B8";
  const days = differenceInCalendarDays(new Date(deadline), new Date());
  if (days <= 14) return "#EF4444";
  if (days <= 30) return "#D97706";
  return "#334155";
}

function probabilityTone(score: number | null | undefined): { color: string; label: string } {
  if (score == null) return { color: "#64748B", label: "Not scored" };
  if (score >= 70) return { color: "#16A34A", label: `${Math.round(score)}%` };
  if (score >= 40) return { color: "#D97706", label: `${Math.round(score)}%` };
  return { color: "#EF4444", label: `${Math.round(score)}%` };
}

/**
 * Opportunity list (BLUEPRINT §4.4). Reads are RLS-scoped to the organization,
 * so no organization_id filter is needed client-side.
 */
export default function OpportunitiesPage() {
  const router = useRouter();
  const { profile } = useProfile();
  const [opportunities, setOpportunities] = useState<OpportunityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [org, setOrg] = useState<OrgHousingProfile | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const [search, setSearch] = useState("");
  const [filterChip, setFilterChip] = useState<FilterChip>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | OpportunityStatus>("all");
  const [sort, setSort] = useState<SortOption>("probability-desc");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadOpportunities = useCallback(async () => {
    setLoading(true);
    setError(null);

    const supabase = createClient();

    const [oppsRes, fundersRes, probabilityRes] = await Promise.all([
      supabase.from("opportunities").select("*").order("created_at", { ascending: false }).limit(1000),
      supabase.from("funders").select("id, name"),
      // opportunity_probability_scores (migration 093) - Grant Probability Engine
      // (computeGrantProbability(), src/lib/intelligence/grant-probability-engine.ts).
      // Full row, not just overall_score, so the expandable factor breakdown below
      // can render confidence/factors/recommendation/risks/strengths from the same
      // already-persisted data — no recompute, no second API route.
      supabase
        .from("opportunity_probability_scores")
        .select(
          "opportunity_id, overall_score, confidence, factors, recommendation, key_risks, key_strengths, estimated_roi, time_to_complete",
        ),
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

    const probabilityByOpp = new Map<string, ProbabilityScoreRow>();
    for (const p of (probabilityRes.data ?? []) as ProbabilityScoreRow[]) {
      probabilityByOpp.set(p.opportunity_id, p);
    }

    const rows: OpportunityRow[] = (oppsRes.data ?? []).map((opp) => ({
      ...opp,
      funderName: opp.funder_id ? (funderNames.get(opp.funder_id) ?? null) : null,
      probabilityScore: probabilityByOpp.get(opp.id)?.overall_score ?? null,
      probabilityData: probabilityByOpp.get(opp.id) ?? null,
    }));

    setOpportunities(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadOpportunities().catch(() => {
      setError("Could not load opportunities.");
      setLoading(false);
    });
  }, [loadOpportunities]);

  // Org profile fields used only to detect a housing-focused org (Land Bank
  // Spotlight visibility) - `organizations` has no NTEE code column, so this
  // is a free-text keyword check (see isHousingOrg above).
  useEffect(() => {
    if (!profile?.organization_id) return;
    let active = true;

    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("organizations")
        .select("target_population, mission_statement, service_area")
        .eq("id", profile.organization_id)
        .maybeSingle();
      if (active) setOrg(data ?? null);
    })();

    return () => {
      active = false;
    };
  }, [profile?.organization_id]);

  const editable = canEdit(profile?.role);
  const housingOrg = isHousingOrg(org);

  const landBankOpportunities = useMemo(() => {
    return opportunities
      .filter((opp) => opp.source === "land_bank")
      .sort((a, b) => (a.deadline ?? "9999-12-31").localeCompare(b.deadline ?? "9999-12-31"))
      .slice(0, 3);
  }, [opportunities]);

  const handleDiscoverLandBank = useCallback(async () => {
    setDiscovering(true);
    setDiscoverError(null);
    try {
      const res = await fetch("/api/intelligence/land-banks", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not run land bank discovery.");
      }
      await loadOpportunities();
    } catch (e) {
      setDiscoverError(e instanceof Error ? e.message : "Could not run land bank discovery.");
    } finally {
      setDiscovering(false);
    }
  }, [loadOpportunities]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return opportunities.filter((opp) => {
      if (dismissedIds.has(opp.id)) return false;
      if (!matchesFilterChip(opp, filterChip)) return false;
      if (statusFilter !== "all" && opp.status !== statusFilter) return false;
      if (!q) return true;
      return (
        opp.name.toLowerCase().includes(q) ||
        (opp.description?.toLowerCase().includes(q) ?? false) ||
        (opp.funderName?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [opportunities, search, filterChip, statusFilter, dismissedIds]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    switch (sort) {
      case "probability-desc":
        return rows.sort((a, b) => (b.probabilityScore ?? -1) - (a.probabilityScore ?? -1));
      case "probability-asc":
        return rows.sort((a, b) => (a.probabilityScore ?? -1) - (b.probabilityScore ?? -1));
      case "deadline-asc":
        return rows.sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
      case "amount-desc":
        return rows.sort(
          (a, b) => (b.amount_max ?? b.amount_available ?? 0) - (a.amount_max ?? a.amount_available ?? 0),
        );
      case "eligibility-desc":
        return rows.sort((a, b) => (b.eligibility_score ?? -1) - (a.eligibility_score ?? -1));
      case "name-asc":
        return rows.sort((a, b) => decodeHtmlEntities(a.name).localeCompare(decodeHtmlEntities(b.name)));
      default:
        return rows;
    }
  }, [filtered, sort]);

  const stats = useMemo(() => {
    const open = filtered.filter((o) => o.status === "open").length;
    const highProbability = filtered.filter((o) => (o.probabilityScore ?? 0) >= 70).length;
    const closingThisWeek = filtered.filter((o) => {
      if (!o.deadline) return false;
      const days = differenceInCalendarDays(new Date(o.deadline), new Date());
      return days >= 0 && days <= 7;
    }).length;
    const totalValue = filtered.reduce((sum, o) => sum + (o.amount_max ?? o.amount_available ?? 0), 0);
    return { open, highProbability, closingThisWeek, totalValue };
  }, [filtered]);

  const showEmpty = !loading && !error && opportunities.length === 0;

  const chipStyle = (active: boolean): CSSProperties => ({
    backgroundColor: active ? CTA_TEAL_BG : "#F8F5EE",
    color: active ? "#FFFFFF" : "#64748B",
    border: active ? `1px solid ${CTA_TEAL_BG}` : "1px solid rgba(16,27,45,0.15)",
    borderRadius: "20px",
    padding: "6px 16px",
    fontSize: "13px",
    fontWeight: 500,
    cursor: "pointer",
  });

  return (
    <ErrorBoundary>
      <div style={{ backgroundColor: "#D8D3C8", minHeight: "100vh", padding: "32px" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "16px",
            marginBottom: "24px",
          }}
        >
          <div style={{ borderLeft: `4px solid ${SECTION_ACCENT}`, paddingLeft: "16px" }}>
            <h1 style={{ fontSize: "24px", fontWeight: 800, color: SECTION_ACCENT, margin: 0 }}>Opportunities</h1>
            <p style={{ fontSize: "14px", color: "#64748B", marginTop: "2px" }}>
              Grants, donation programs, and sponsorships you&rsquo;re tracking.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
            {editable && housingOrg && (
              <button
                type="button"
                onClick={handleDiscoverLandBank}
                disabled={discovering}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  backgroundColor: CTA_TEAL_BG,
                  color: CTA_TEAL_TEXT,
                  border: "none",
                  borderRadius: "8px",
                  padding: "10px 20px",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: discovering ? "default" : "pointer",
                  opacity: discovering ? 0.7 : 1,
                }}
              >
                <Home size={16} aria-hidden />
                {discovering ? "Discovering..." : "Run Land Bank Discovery"}
              </button>
            )}
            {editable && (
              <Link
                href="/opportunities/new"
                style={{
                  backgroundColor: ADD_OPPORTUNITY_BG,
                  color: CTA_TEAL_TEXT,
                  border: "none",
                  borderRadius: "8px",
                  padding: "10px 20px",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  textDecoration: "none",
                }}
              >
                <Plus size={16} aria-hidden />
                Add Opportunity
              </Link>
            )}
          </div>
        </div>

        {housingOrg && (
          <div style={{ backgroundColor: SECTION_ACCENT, borderRadius: "15px", boxShadow: "0 4px 20px rgba(164,113,44,0.22)", padding: "4px", marginBottom: "20px" }}>
          <div
            style={{
              backgroundColor: "#F8F5EE",
              borderRadius: "12px",
              padding: "20px",
              borderLeft: "4px solid #0F766E",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                <Home size={20} color="#0F766E" aria-hidden style={{ marginTop: "2px", flexShrink: 0 }} />
                <div>
                  <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", margin: 0 }}>
                    Land Bank & Affordable Housing Funding
                  </h2>
                  <p style={{ fontSize: "13px", color: "#64748B", margin: "4px 0 0 0", maxWidth: "560px" }}>
                    Specialized opportunities from land bank authorities, HUD programs, and community
                    development funders.
                  </p>
                </div>
              </div>
              {editable && (
                <button
                  type="button"
                  onClick={handleDiscoverLandBank}
                  disabled={discovering}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    backgroundColor: CTA_TEAL_BG,
                    color: CTA_TEAL_TEXT,
                    padding: "9px 16px",
                    borderRadius: "8px",
                    fontSize: "13px",
                    fontWeight: 700,
                    border: "none",
                    cursor: discovering ? "default" : "pointer",
                    opacity: discovering ? 0.7 : 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  {discovering ? "Discovering..." : "Discover More Land Bank Opportunities"}
                </button>
              )}
            </div>

            {discoverError && (
              <div style={{ fontSize: "12px", color: "#B91C1C", marginTop: "10px" }}>{discoverError}</div>
            )}

            {landBankOpportunities.length > 0 ? (
              <div style={{ marginTop: "16px", display: "grid", gap: "10px" }}>
                {landBankOpportunities.map((opp) => (
                  <Link
                    key={opp.id}
                    href={`/opportunities/${opp.id}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: "12px",
                      padding: "12px 14px",
                      borderRadius: "8px",
                      backgroundColor: "rgba(15,118,110,0.08)",
                      border: "1px solid rgba(15,118,110,0.25)",
                      textDecoration: "none",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "#0F172A" }}>
                        {decodeHtmlEntities(opp.name)}
                      </div>
                      <div style={{ fontSize: "12px", color: "#0F766E", marginTop: "2px" }}>
                        {opp.funderName ?? "Land Bank Authority"}
                      </div>
                    </div>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: deadlineColor(opp.deadline), whiteSpace: "nowrap" }}>
                      {opp.deadline ? formatDate(opp.deadline) : "No deadline"}
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: "13px", color: "#94A3B8", marginTop: "16px", marginBottom: 0 }}>
                No land bank opportunities discovered yet for your service area.
              </p>
            )}
          </div>
          </div>
        )}

        {error && (
          <div
            role="alert"
            style={{
              backgroundColor: "#FEF2F2",
              border: "1px solid #FECACA",
              borderRadius: "8px",
              padding: "12px 16px",
              fontSize: "14px",
              color: "#B91C1C",
              marginBottom: "20px",
            }}
          >
            {error}
          </div>
        )}

        {!showEmpty && (
          <>
            {/* Filter pills + search/sort */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "12px",
                marginBottom: "24px",
              }}
            >
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {FILTER_CHIPS.map((chip) => (
                  <button
                    key={chip.value}
                    type="button"
                    onClick={() => setFilterChip(chip.value)}
                    style={chipStyle(filterChip === chip.value)}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <div style={{ position: "relative" }}>
                  <Search
                    size={14}
                    color="#94A3B8"
                    aria-hidden
                    style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)" }}
                  />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search opportunities, funders..."
                    aria-label="Search opportunities"
                    style={{
                      padding: "8px 12px 8px 30px",
                      borderRadius: "8px",
                      border: "1px solid rgba(16,27,45,0.15)",
                      fontSize: "13px",
                      color: "#0F172A",
                      backgroundColor: "#F8F5EE",
                      width: "200px",
                    }}
                  />
                </div>

                <select
                  aria-label="Filter by status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as "all" | OpportunityStatus)}
                  style={{
                    borderRadius: "8px",
                    border: "1px solid rgba(16,27,45,0.15)",
                    padding: "8px 12px",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#334155",
                    backgroundColor: "#F8F5EE",
                  }}
                >
                  {STATUS_FILTER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Sort opportunities"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortOption)}
                  style={{
                    borderRadius: "8px",
                    border: "1px solid rgba(16,27,45,0.15)",
                    padding: "8px 12px",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#334155",
                    backgroundColor: "#F8F5EE",
                  }}
                >
                  {SORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Stats row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: "16px",
                marginBottom: "24px",
              }}
            >
              <StatCard label="Open Opportunities" value={String(stats.open)} accent="#101B2D" />
              <StatCard label="High Probability >70%" value={String(stats.highProbability)} accent="#2E6B66" />
              <StatCard label="Closing This Week" value={String(stats.closingThisWeek)} accent="#7A5980" />
              <StatCard label="Total Potential" value={formatCurrency(stats.totalValue)} accent="#4F6D8F" />
            </div>

            {/* Opportunity cards */}
            {loading ? (
              <div style={{ display: "grid", gap: "12px" }}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <LoadingCard key={i} height={92} borderRadius={12} />
                ))}
              </div>
            ) : sorted.length === 0 ? (
              <div style={{ backgroundColor: SECTION_ACCENT, borderRadius: "15px", boxShadow: "0 4px 20px rgba(164,113,44,0.22)", padding: "4px" }}>
              <div
                style={{
                  backgroundColor: "#F8F5EE",
                  borderRadius: "12px",
                  padding: "40px",
                  textAlign: "center",
                  fontSize: "13px",
                  color: "#64748B",
                }}
              >
                No opportunities match your filters.
              </div>
              </div>
            ) : (
              <div>
                {sorted.map((opp) => {
                  const bucket = sourceBucket(opp);
                  const accent = bucket ? CATEGORY_ACCENT[bucket] : "#94A3B8";
                  const probTone = probabilityTone(opp.probabilityScore);
                  const dLineColor = deadlineColor(opp.deadline);
                  const closingSoon =
                    !!opp.deadline && differenceInCalendarDays(new Date(opp.deadline), new Date()) <= 14;

                  return (
                    <div
                      key={opp.id}
                      style={{
                        backgroundColor: SECTION_ACCENT,
                        borderRadius: "14px",
                        boxShadow: "0 4px 16px rgba(164,113,44,0.18)",
                        padding: "4px",
                        marginBottom: "12px",
                      }}
                    >
                    <div
                      style={{
                        backgroundColor: "#F8F5EE",
                        borderRadius: "11px",
                        padding: "18px 22px",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "16px",
                      }}
                    >
                      <div
                        aria-hidden
                        style={{ width: "4px", alignSelf: "stretch", borderRadius: "2px", backgroundColor: accent }}
                      />

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
                          <span style={{ fontSize: "11px", fontWeight: 700, color: accent, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                            {bucket ? SOURCE_LABEL[bucket] : opp.source_type ? humanizeEnum(opp.source_type) : "Other"}
                          </span>
                          {opp.funderName && (
                            <span style={{ fontSize: "12px", color: "#64748B" }}>&middot; {opp.funderName}</span>
                          )}
                        </div>

                        <Link
                          href={`/opportunities/${opp.id}`}
                          style={{ fontSize: "16px", fontWeight: 700, color: "#0F172A", textDecoration: "none", display: "block", marginTop: "4px" }}
                        >
                          {decodeHtmlEntities(opp.name)}
                        </Link>

                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", marginTop: "10px" }}>
                          <span
                            style={{
                              backgroundColor: `${probTone.color}15`,
                              color: probTone.color,
                              borderRadius: "6px",
                              padding: "3px 10px",
                              fontSize: "12px",
                              fontWeight: 700,
                            }}
                          >
                            {probTone.label}
                          </span>

                          {(opp.amount_max != null || opp.amount_available != null) && (
                            <span
                              style={{
                                backgroundColor: "rgba(79,109,143,0.1)",
                                color: "#4F6D8F",
                                borderRadius: "6px",
                                padding: "3px 10px",
                                fontSize: "12px",
                                fontWeight: 600,
                              }}
                            >
                              {formatCurrency(opp.amount_max ?? opp.amount_available)}
                            </span>
                          )}

                          {opp.deadline ? (
                            closingSoon ? (
                              <span
                                style={{
                                  backgroundColor: "#FEF3C7",
                                  color: "#B45309",
                                  borderRadius: "6px",
                                  padding: "3px 10px",
                                  fontSize: "12px",
                                  fontWeight: 600,
                                }}
                              >
                                Due {formatDate(opp.deadline)}
                              </span>
                            ) : (
                              <span style={{ fontSize: "12px", fontWeight: 600, color: dLineColor }}>
                                Due {formatDate(opp.deadline)}
                              </span>
                            )
                          ) : (
                            <span style={{ fontSize: "12px", color: "#94A3B8" }}>Rolling deadline</span>
                          )}

                          {opp.eligibility_score != null && (
                            <span style={{ fontSize: "12px", color: "#94A3B8" }}>
                              Eligibility {Math.round(opp.eligibility_score)}%
                            </span>
                          )}
                        </div>

                        <div style={{ display: "flex", gap: "8px", marginTop: "14px" }}>
                          <Link
                            href={`/opportunities/${opp.id}`}
                            style={{
                              backgroundColor: "#F8F5EE",
                              color: "#4F6D8F",
                              border: "1px solid #4F6D8F",
                              borderRadius: "8px",
                              padding: "6px 14px",
                              fontSize: "12px",
                              fontWeight: 700,
                              textDecoration: "none",
                            }}
                          >
                            View
                          </Link>
                          <Link
                            href={`/applications/new?opportunityId=${opp.id}`}
                            style={{
                              backgroundColor: CTA_TEAL_BG,
                              color: CTA_TEAL_TEXT,
                              border: "none",
                              borderRadius: "8px",
                              padding: "6px 14px",
                              fontSize: "12px",
                              fontWeight: 700,
                              textDecoration: "none",
                            }}
                          >
                            Apply Now
                          </Link>
                          <button
                            type="button"
                            onClick={() => setDismissedIds((prev) => new Set(prev).add(opp.id))}
                            style={{
                              backgroundColor: "#F8F5EE",
                              color: "#64748B",
                              border: "1px solid rgba(16,27,45,0.15)",
                              borderRadius: "8px",
                              padding: "6px 14px",
                              fontSize: "12px",
                              fontWeight: 600,
                              cursor: "pointer",
                            }}
                          >
                            Skip
                          </button>
                          <button
                            type="button"
                            onClick={() => setExpandedId((prev) => (prev === opp.id ? null : opp.id))}
                            aria-expanded={expandedId === opp.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                              backgroundColor: "#F8F5EE",
                              color: "#4F6D8F",
                              border: "1px solid rgba(16,27,45,0.15)",
                              borderRadius: "8px",
                              padding: "6px 14px",
                              fontSize: "12px",
                              fontWeight: 600,
                              cursor: "pointer",
                              marginLeft: "auto",
                            }}
                          >
                            {expandedId === opp.id ? "Hide Breakdown" : "Score Breakdown"}
                            {expandedId === opp.id ? (
                              <ChevronUp size={13} aria-hidden />
                            ) : (
                              <ChevronDown size={13} aria-hidden />
                            )}
                          </button>
                        </div>

                        {expandedId === opp.id && (
                          <ProbabilityBreakdown data={opp.probabilityData} />
                        )}
                      </div>
                    </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {showEmpty && (
          <EmptyStateCard
            icon="🧭"
            title="No opportunities yet"
            description="Run Research to discover grants matching your mission"
            actionLabel="Run Research Now"
            onAction={() => router.push("/research")}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}

/**
 * Expandable factor breakdown for a single opportunity's grant probability
 * score. Reads only the already-persisted opportunity_probability_scores row
 * (computeGrantProbability(), src/lib/intelligence/grant-probability-engine.ts)
 * — never recomputes. `data` is null whenever the opportunity has never been
 * batch/individually scored; that state is shown honestly rather than as a
 * fabricated placeholder score.
 */
function ProbabilityBreakdown({ data }: { data: ProbabilityScoreRow | null }) {
  if (!data) {
    return (
      <div
        style={{
          marginTop: "14px",
          padding: "14px 16px",
          borderRadius: "8px",
          backgroundColor: "#F8F5EE",
          border: "1px solid rgba(16,27,45,0.15)",
          fontSize: "12px",
          color: "#64748B",
        }}
      >
        Not yet scored. This opportunity has no grant probability score on record —
        the Grant Probability Engine hasn&rsquo;t run for it yet.
      </div>
    );
  }

  const confidence = data.confidence ?? "low";
  const recommendation = data.recommendation ?? "consider";
  const recTone = RECOMMENDATION_TONE[recommendation] ?? DEFAULT_RECOMMENDATION_TONE;
  const factors = data.factors ?? [];

  return (
    <div
      style={{
        marginTop: "14px",
        padding: "18px 20px",
        borderRadius: "10px",
        backgroundColor: "#1A2B3C",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
        <span
          style={{
            backgroundColor: recTone.bg,
            color: recTone.color,
            borderRadius: "6px",
            padding: "3px 10px",
            fontSize: "12px",
            fontWeight: 700,
          }}
        >
          {recTone.label}
        </span>
        <span style={{ fontSize: "12px", color: CONFIDENCE_TONE[confidence] ?? "#94A3B8", fontWeight: 600 }}>
          {humanizeEnum(confidence)} confidence
        </span>
        {data.estimated_roi && (
          <span style={{ fontSize: "12px", color: "#CBD5E1" }}>&middot; {data.estimated_roi}</span>
        )}
        {data.time_to_complete && (
          <span style={{ fontSize: "12px", color: "#CBD5E1" }}>&middot; {data.time_to_complete}</span>
        )}
      </div>

      {factors.length > 0 && (
        <div style={{ display: "grid", gap: "10px", marginBottom: "16px" }}>
          {factors.map((f) => (
            <div key={f.name}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: "12px",
                  color: "#E2E8F0",
                  marginBottom: "4px",
                }}
              >
                <span>
                  {FACTOR_LABELS[f.name] ?? humanizeEnum(f.name)}{" "}
                  <span style={{ color: "#64748B" }}>({Math.round(f.weight * 100)}% weight)</span>
                </span>
                <span style={{ fontWeight: 700 }}>{Math.round(f.value * 100)}%</span>
              </div>
              <div style={{ height: "6px", borderRadius: "3px", backgroundColor: "#334155", overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.round(f.value * 100)}%`,
                    borderRadius: "3px",
                    backgroundColor: "#A4712C",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <div>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#F87171", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "6px" }}>
            Key Risks
          </div>
          {data.key_risks && data.key_risks.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: "16px", fontSize: "12px", color: "#CBD5E1", lineHeight: 1.6 }}>
              {data.key_risks.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          ) : (
            <div style={{ fontSize: "12px", color: "#64748B" }}>None recorded.</div>
          )}
        </div>
        <div>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#4ADE80", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "6px" }}>
            Key Strengths
          </div>
          {data.key_strengths && data.key_strengths.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: "16px", fontSize: "12px", color: "#CBD5E1", lineHeight: 1.6 }}>
              {data.key_strengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : (
            <div style={{ fontSize: "12px", color: "#64748B" }}>None recorded.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ backgroundColor: SECTION_ACCENT, borderRadius: "14px", boxShadow: "0 4px 20px rgba(164,113,44,0.22)", padding: "3px", flex: "1" }}>
      <div style={{ backgroundColor: "#F8F5EE", borderRadius: "11px", padding: "16px 20px" }}>
        <div style={{ fontSize: "28px", fontWeight: 800, color: accent }}>{value}</div>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: "#64748B",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            marginTop: "6px",
          }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}
