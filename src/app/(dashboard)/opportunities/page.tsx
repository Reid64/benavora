"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { differenceInCalendarDays, isThisMonth } from "date-fns";
import { Plus, Search } from "lucide-react";

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

type OpportunityRow = Tables<"opportunities"> & {
  funderName: string | null;
  probabilityScore: number | null;
};

type SourceBucket = "federal" | "foundation" | "corporate" | "state";

// The real opportunity_source_type enum (migration 010) has 8 values, finer
// grained than the 4-bucket badge spec here. Government tiers other than
// federal/state and faith-based/international sources fall back to a neutral
// badge rather than being forced into one of the 4 colors.
const SOURCE_BUCKET_MAP: Partial<Record<OpportunitySourceType, SourceBucket>> = {
  government_federal: "federal",
  government_state: "state",
  government_local: "state",
  private_foundation: "foundation",
  community_foundation: "foundation",
  corporate_giving: "corporate",
};

const SOURCE_BADGE_STYLE: Record<SourceBucket, { label: string; color: string; bg: string }> = {
  federal: { label: "Federal", color: "#1D4ED8", bg: "#EFF6FF" },
  foundation: { label: "Foundation", color: "#7C3AED", bg: "#F5F3FF" },
  corporate: { label: "Corporate", color: "#0891B2", bg: "#ECFEFF" },
  state: { label: "State", color: "#16A34A", bg: "#F0FDF4" },
};

const SOURCE_FILTER_OPTIONS: { value: "all" | SourceBucket; label: string }[] = [
  { value: "all", label: "All Sources" },
  { value: "federal", label: "Federal" },
  { value: "foundation", label: "Foundation" },
  { value: "corporate", label: "Corporate" },
  { value: "state", label: "State" },
];

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

function sourceBucket(sourceType: OpportunitySourceType | null): SourceBucket | null {
  return sourceType ? (SOURCE_BUCKET_MAP[sourceType] ?? null) : null;
}

function deadlineColor(deadline: string | null): string {
  if (!deadline) return "#94A3B8";
  const days = differenceInCalendarDays(new Date(deadline), new Date());
  if (days <= 14) return "#EF4444";
  if (days <= 30) return "#F59E0B";
  return "#334155";
}

function scoreTone(score: number | null | undefined): { color: string; bg: string; label: string } {
  if (score == null) return { color: "#64748B", bg: "#F1F5F9", label: "Not scored" };
  if (score >= 70) return { color: "#FFFFFF", bg: "#10B981", label: `${Math.round(score)}%` };
  if (score >= 50) return { color: "#FFFFFF", bg: "#F59E0B", label: `${Math.round(score)}%` };
  return { color: "#FFFFFF", bg: "#EF4444", label: `${Math.round(score)}%` };
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

  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | SourceBucket>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | OpportunityStatus>("all");
  const [sort, setSort] = useState<SortOption>("probability-desc");

  useEffect(() => {
    let active = true;

    async function loadOpportunities() {
      setLoading(true);
      setError(null);

      const supabase = createClient();

      const [oppsRes, fundersRes, probabilityRes] = await Promise.all([
        supabase.from("opportunities").select("*").order("created_at", { ascending: false }).limit(1000),
        supabase.from("funders").select("id, name"),
        // opportunity_probability_scores (migration 093) - Grant Probability Engine.
        supabase.from("opportunity_probability_scores").select("opportunity_id, overall_score"),
      ]);

      if (!active) return;

      if (oppsRes.error) {
        setError("Could not load opportunities.");
        setLoading(false);
        return;
      }

      const funderNames = new Map<string, string>();
      for (const f of fundersRes.data ?? []) {
        funderNames.set(f.id, f.name);
      }

      const probabilityByOpp = new Map<string, number | null>();
      for (const p of (probabilityRes.data ?? []) as { opportunity_id: string; overall_score: number | null }[]) {
        probabilityByOpp.set(p.opportunity_id, p.overall_score);
      }

      const rows: OpportunityRow[] = (oppsRes.data ?? []).map((opp) => ({
        ...opp,
        funderName: opp.funder_id ? (funderNames.get(opp.funder_id) ?? null) : null,
        probabilityScore: probabilityByOpp.get(opp.id) ?? null,
      }));

      setOpportunities(rows);
      setLoading(false);
    }

    loadOpportunities().catch(() => {
      if (active) {
        setError("Could not load opportunities.");
        setLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  const editable = canEdit(profile?.role);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return opportunities.filter((opp) => {
      if (sourceFilter !== "all" && sourceBucket(opp.source_type) !== sourceFilter) return false;
      if (statusFilter !== "all" && opp.status !== statusFilter) return false;
      if (!q) return true;
      return (
        opp.name.toLowerCase().includes(q) ||
        (opp.description?.toLowerCase().includes(q) ?? false) ||
        (opp.funderName?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [opportunities, search, sourceFilter, statusFilter]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    switch (sort) {
      case "probability-desc":
        return rows.sort((a, b) => (b.probabilityScore ?? -1) - (a.probabilityScore ?? -1));
      case "probability-asc":
        return rows.sort((a, b) => (a.probabilityScore ?? -1) - (b.probabilityScore ?? -1));
      case "deadline-asc":
        return rows.sort((a, b) => (a.deadline ?? "9999") .localeCompare(b.deadline ?? "9999"));
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
    const total = filtered.length;
    const highProbability = filtered.filter((o) => (o.probabilityScore ?? 0) >= 70).length;
    const closingThisMonth = filtered.filter((o) => o.deadline && isThisMonth(new Date(o.deadline))).length;
    const totalValue = filtered.reduce((sum, o) => sum + (o.amount_max ?? o.amount_available ?? 0), 0);
    return { total, highProbability, closingThisMonth, totalValue };
  }, [filtered]);

  const showEmpty = !loading && !error && opportunities.length === 0;

  return (
    <ErrorBoundary>
    <div style={{ backgroundColor: "#D6E4F0", minHeight: "100vh", padding: "32px" }}>
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
        <div>
          <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#1A2B3C", margin: 0, letterSpacing: "-0.02em" }}>
            Opportunities
          </h1>
          <p style={{ fontSize: "14px", color: "#6B7280", margin: "4px 0 0 0" }}>
            Grants, donation programs, and sponsorships you&rsquo;re tracking.
          </p>
        </div>
        {editable && (
          <Link
            href="/opportunities/new"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              backgroundColor: "#0EA5E9",
              color: "#FFFFFF",
              padding: "10px 20px",
              borderRadius: "10px",
              fontSize: "14px",
              fontWeight: 600,
              boxShadow: "0 2px 8px rgba(14,165,233,0.35)",
              textDecoration: "none",
            }}
          >
            <Plus size={16} aria-hidden />
            New Opportunity
          </Link>
        )}
      </div>

      {error && (
        <div
          role="alert"
          style={{
            backgroundColor: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: "10px",
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
          {/* Filter bar */}
          <div
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: "14px",
              padding: "16px 20px",
              boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
              marginBottom: "20px",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <div style={{ position: "relative", flex: "1 1 240px", minWidth: "220px" }}>
              <Search
                size={16}
                color="#94A3B8"
                aria-hidden
                style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)" }}
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search opportunities, funders..."
                aria-label="Search opportunities"
                style={{
                  width: "100%",
                  padding: "9px 14px 9px 36px",
                  borderRadius: "999px",
                  border: "1px solid #E2E8F0",
                  fontSize: "13px",
                  color: "#1A2B3C",
                  backgroundColor: "#F8FAFC",
                }}
              />
            </div>

            <select
              aria-label="Filter by source"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as "all" | SourceBucket)}
              style={{
                borderRadius: "999px",
                border: "1px solid #E2E8F0",
                padding: "9px 14px",
                fontSize: "13px",
                fontWeight: 600,
                color: "#334155",
                backgroundColor: "#F8FAFC",
              }}
            >
              {SOURCE_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | OpportunityStatus)}
              style={{
                borderRadius: "999px",
                border: "1px solid #E2E8F0",
                padding: "9px 14px",
                fontSize: "13px",
                fontWeight: 600,
                color: "#334155",
                backgroundColor: "#F8FAFC",
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
                borderRadius: "999px",
                border: "1px solid #E2E8F0",
                padding: "9px 14px",
                fontSize: "13px",
                fontWeight: 600,
                color: "#334155",
                backgroundColor: "#F8FAFC",
              }}
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Stats row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: "16px",
              marginBottom: "20px",
            }}
          >
            <StatCard label="Total Opportunities" value={String(stats.total)} band="#0EA5E9" />
            <StatCard label="High Probability" value={String(stats.highProbability)} band="#10B981" />
            <StatCard label="Closing This Month" value={String(stats.closingThisMonth)} band="#F59E0B" />
            <StatCard label="Total Value" value={formatCurrency(stats.totalValue)} band="#8B5CF6" />
          </div>

          {/* Table */}
          <div
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: "14px",
              boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
              overflow: "hidden",
            }}
          >
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "900px" }}>
                <thead>
                  <tr style={{ backgroundColor: "#1A2B3C" }}>
                    {["Title", "Source", "Funder", "Amount", "Deadline", "Probability", "Eligibility", "Actions"].map(
                      (col, i) => (
                        <th
                          key={col}
                          style={{
                            textAlign: i === 3 ? "right" : "left",
                            padding: "12px 20px",
                            fontSize: "11px",
                            fontWeight: 700,
                            color: "#FFFFFF",
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                          }}
                        >
                          {col}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={8} style={{ padding: "16px 20px" }}>
                        {Array.from({ length: 8 }).map((_, i) => (
                          <div key={i} style={{ marginBottom: i === 7 ? 0 : "8px" }}>
                            <LoadingCard height={44} borderRadius={8} />
                          </div>
                        ))}
                      </td>
                    </tr>
                  ) : sorted.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: "40px", textAlign: "center", fontSize: "13px", color: "#94A3B8" }}>
                        No opportunities match your filters.
                      </td>
                    </tr>
                  ) : (
                    sorted.map((opp) => {
                      const bucket = sourceBucket(opp.source_type);
                      const sourceStyle = bucket ? SOURCE_BADGE_STYLE[bucket] : null;
                      const probTone = scoreTone(opp.probabilityScore);
                      const eligTone = scoreTone(opp.eligibility_score);
                      const dLineColor = deadlineColor(opp.deadline);
                      return (
                        <tr key={opp.id} style={{ borderTop: "1px solid #F1F5F9" }}>
                          <td style={{ padding: "14px 20px", fontSize: "13px", fontWeight: 600, color: "#1A2B3C", maxWidth: "260px" }}>
                            {decodeHtmlEntities(opp.name)}
                          </td>
                          <td style={{ padding: "14px 20px" }}>
                            {sourceStyle ? (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  fontSize: "11px",
                                  fontWeight: 700,
                                  color: sourceStyle.color,
                                  backgroundColor: sourceStyle.bg,
                                  borderRadius: "999px",
                                  padding: "3px 10px",
                                }}
                              >
                                {sourceStyle.label}
                              </span>
                            ) : (
                              <span style={{ fontSize: "12px", color: "#94A3B8" }}>
                                {opp.source_type ? humanizeEnum(opp.source_type) : "-"}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: "14px 20px", fontSize: "13px", color: "#475569" }}>
                            {opp.funderName ?? <span style={{ color: "#94A3B8" }}>-</span>}
                          </td>
                          <td style={{ padding: "14px 20px", fontSize: "13px", fontWeight: 600, color: "#1A2B3C", textAlign: "right" }}>
                            {opp.amount_max != null || opp.amount_available != null
                              ? formatCurrency(opp.amount_max ?? opp.amount_available)
                              : <span style={{ color: "#94A3B8", fontWeight: 400 }}>-</span>}
                          </td>
                          <td style={{ padding: "14px 20px", fontSize: "13px", fontWeight: 600, color: dLineColor }}>
                            {opp.deadline ? formatDate(opp.deadline) : <span style={{ color: "#94A3B8", fontWeight: 400 }}>-</span>}
                          </td>
                          <td style={{ padding: "14px 20px" }}>
                            <span
                              style={{
                                display: "inline-flex",
                                fontSize: "11px",
                                fontWeight: 700,
                                color: probTone.color,
                                backgroundColor: probTone.bg,
                                borderRadius: "999px",
                                padding: "3px 10px",
                              }}
                            >
                              {probTone.label}
                            </span>
                          </td>
                          <td style={{ padding: "14px 20px" }}>
                            <span
                              style={{
                                display: "inline-flex",
                                fontSize: "11px",
                                fontWeight: 700,
                                color: eligTone.color,
                                backgroundColor: eligTone.bg,
                                borderRadius: "999px",
                                padding: "3px 10px",
                              }}
                            >
                              {eligTone.label}
                            </span>
                          </td>
                          <td style={{ padding: "14px 20px" }}>
                            <Link
                              href={`/opportunities/${opp.id}`}
                              style={{ fontSize: "12px", fontWeight: 700, color: "#0EA5E9", textDecoration: "none" }}
                            >
                              View →
                            </Link>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
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

function StatCard({ label, value, band }: { label: string; value: string; band: string }) {
  return (
    <div
      style={{
        backgroundColor: "#FFFFFF",
        borderRadius: "14px",
        boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
        overflow: "hidden",
      }}
    >
      <div style={{ height: "6px", backgroundColor: band }} />
      <div style={{ padding: "18px 20px" }}>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 700,
            color: "#64748B",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          {label}
        </div>
        <div style={{ fontSize: "28px", fontWeight: 800, color: "#1A2B3C", marginTop: "4px" }}>{value}</div>
      </div>
    </div>
  );
}
