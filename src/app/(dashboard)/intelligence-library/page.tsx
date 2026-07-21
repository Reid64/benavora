"use client";

// Grant Intelligence Library — enterprise search + filter UI over
// intelligence_funded_proposals (supabase/migrations/048_grant_intelligence.sql).
//
// IMPORTANT SCHEMA NOTE: migration 106_intelligence_library_schema_upgrade.sql
// (funder_category, ntee_major, geographic_scope, source_type,
// persuasive_elements, winning_phrases, full_text_search_vector, etc.) is
// written but NOT applied to production as of 2026-07-21 -- verified live
// this session (SELECT of those columns returns 42703; the Management API
// PAT this repo uses for DDL also returns 401 in this session). This page
// and its two API routes (/api/intelligence/proposals,
// /api/intelligence/library/search) are built entirely against the columns
// confirmed live: source, source_url, funder_name, funder_type, grant_program,
// award_amount, award_year, category (text[]), full_text, metadata (jsonb).
// "Funder Type" and "Data Source" filters are computed server-side from those
// real columns (see src/lib/intelligence/proposals-query.ts). Winning
// Phrases / Persuasive Elements sections only render when that data is
// present -- with migration 106 unapplied, that's currently never (the API
// never fabricates them), so those sections are hidden rather than shown
// empty or faked. Once migration 106 lands and
// scripts/backfill-intelligence-library-columns.ts runs, they'll appear with
// no further frontend changes needed.
//
// Every color below is an inline hex value per BLUEPRINT_v2.md §7.5 -- no
// CSS variables, no Tailwind color classes.

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  ExternalLink,
  Info,
  Plus,
  Search,
  Tag,
  X,
} from "lucide-react";

import {
  DATA_SOURCE_OPTIONS,
  FUNDER_BUCKET_OPTIONS,
  NTEE_GROUPS,
  type FunderBucket,
} from "@/lib/intelligence/proposals-query";

const COLORS = {
  canvas: "#D6E4F0",
  card: "#0D1526",
  cardBorderColor: "rgba(255,255,255,0.08)",
  white: "#FFFFFF",
  text: "#FFFFFF",
  textMuted: "#8BA8C8",
  textFaint: "#5B7699",
  purple: "#8B5CF6",
  blue: "#0EA5E9",
  green: "#10B981",
  greenBg: "rgba(16,185,129,0.12)",
  amber: "#F59E0B",
  amberBg: "rgba(245,158,11,0.14)",
  red: "#EF4444",
};

const FUNDER_BUCKET_BADGE: Record<FunderBucket, { bg: string; fg: string; label: string }> = {
  federal: { bg: "#EFF6FF", fg: "#1D4ED8", label: "Federal Government" },
  private_foundation: { bg: "#F5F3FF", fg: "#7C3AED", label: "Private Foundation" },
  corporate_foundation: { bg: "#ECFEFF", fg: "#0891B2", label: "Corporate Foundation" },
  community_foundation: { bg: "#ECFDF5", fg: "#059669", label: "Community Foundation" },
  public_charity: { bg: "#FFFBEB", fg: "#B45309", label: "Public Charity (Self-Reported)" },
};

const SOURCE_LABELS: Record<string, string> = {
  NIH: "NIH",
  NIH_NIAID: "NIH NIAID",
  NIH_REPORTER: "NIH RePORTER",
  NSF_AWARDS: "NSF",
  FEDERAL_REGISTER: "Federal Register",
  USASPENDING: "USASpending",
  USDA: "USDA",
  HUD: "HUD",
  DOJ_OJP: "DOJ / OJP",
  PROPUBLICA_990: "ProPublica 990",
  MANUAL_ENTRY: "Manual Entry",
  INTELLIGENCE_LIBRARY_SEED: "Platform Library",
};

const YEAR_OPTIONS = ["2024", "2023", "2022", "2021", "2020", "earlier"];

const selectStyle: CSSProperties = {
  display: "block",
  marginTop: 4,
  width: "100%",
  boxSizing: "border-box",
  border: `1px solid ${COLORS.cardBorderColor}`,
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 13,
  color: COLORS.white,
  background: "#141F33",
};

const filterLabelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: COLORS.textMuted,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

interface PersuasiveElement {
  element_type: string;
  why_it_works: string;
}

interface ProposalCard {
  id: string;
  source: string;
  sourceUrl: string | null;
  funderName: string | null;
  funderType: string | null;
  funderBucket: FunderBucket | null;
  title: string | null;
  awardAmount: number | null;
  awardYear: number | null;
  category: string[];
  nteeCode: string | null;
  organizationName: string | null;
  fullText: string | null;
  successFactors: string[];
  keywords: string[];
  winningPhrases: string[];
  persuasiveElements: PersuasiveElement[];
  recordKind: string | null;
  createdAt: string;
}

interface FilteredStats {
  totalNarratives: number;
  avgAwardAmount: number | null;
  federalCount: number;
  foundationCount: number;
  corporateCount: number;
}

interface ProposalsResponse {
  results: ProposalCard[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  stats: { totalProposals: number; sources: string[] };
  filteredStats: FilteredStats;
}

interface NewNarrativeForm {
  title: string;
  funderName: string;
  funderType: string;
  organization: string;
  grantProgram: string;
  awardAmount: string;
  awardYear: string;
  nteeCode: string;
  narrativeFull: string;
  successFactors: string;
  keywords: string;
}

const EMPTY_NEW_NARRATIVE: NewNarrativeForm = {
  title: "",
  funderName: "",
  funderType: "",
  organization: "",
  grantProgram: "",
  awardAmount: "",
  awardYear: "",
  nteeCode: "",
  narrativeFull: "",
  successFactors: "",
  keywords: "",
};

function formatCurrency(amount: number | null): string {
  if (amount === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function truncate(value: string | null, max: number): string {
  if (!value) return "—";
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}…` : trimmed;
}

export default function IntelligenceLibraryPage() {
  const router = useRouter();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ProposalsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dataSourceFilter, setDataSourceFilter] = useState("");
  const [nteeFilter, setNteeFilter] = useState("");
  const [funderBucketFilter, setFunderBucketFilter] = useState<FunderBucket | "">("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [searchOverride, setSearchOverride] = useState<ProposalCard[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [openWinningPhrases, setOpenWinningPhrases] = useState<Set<string>>(new Set());
  const [openPersuasive, setOpenPersuasive] = useState<Set<string>>(new Set());
  const [overlayId, setOverlayId] = useState<string | null>(null);
  const [selectedRefs, setSelectedRefs] = useState<Map<string, string>>(new Map());

  const [showAddForm, setShowAddForm] = useState(false);
  const [newNarrative, setNewNarrative] = useState<NewNarrativeForm>(EMPTY_NEW_NARRATIVE);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [showImportInfo, setShowImportInfo] = useState(false);

  function toggleSet(setter: (fn: (prev: Set<string>) => Set<string>) => void, id: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleReference(proposal: ProposalCard) {
    setSelectedRefs((prev) => {
      const next = new Map(prev);
      if (next.has(proposal.id)) next.delete(proposal.id);
      else next.set(proposal.id, proposal.funderName ?? "Unknown funder");
      return next;
    });
  }

  function clearAllFilters() {
    setDataSourceFilter("");
    setNteeFilter("");
    setFunderBucketFilter("");
    setMinAmount("");
    setMaxAmount("");
    setYearFilter("");
    setSearchInput("");
    setSearch("");
    setSearchOverride(null);
    setPage(1);
  }

  const activeFilterCount = [
    dataSourceFilter,
    nteeFilter,
    funderBucketFilter,
    minAmount,
    maxAmount,
    yearFilter,
  ].filter(Boolean).length;

  async function handleAddNarrative() {
    setAddSubmitting(true);
    setAddError(null);
    try {
      const res = await fetch("/api/intelligence/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newNarrative.title,
          funder_name: newNarrative.funderName,
          funder_type: newNarrative.funderType || null,
          organization: newNarrative.organization || null,
          grant_program: newNarrative.grantProgram || newNarrative.title,
          award_amount: newNarrative.awardAmount ? Number(newNarrative.awardAmount) : null,
          award_year: newNarrative.awardYear ? Number(newNarrative.awardYear) : null,
          ntee_code: newNarrative.nteeCode || null,
          narrative_full: newNarrative.narrativeFull,
          success_factors: newNarrative.successFactors
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          keywords: newNarrative.keywords
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status}).`);
      }
      setNewNarrative(EMPTY_NEW_NARRATIVE);
      setShowAddForm(false);
      setPage(1);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to save narrative.");
    } finally {
      setAddSubmitting(false);
    }
  }

  async function runFullTextSearch(term: string) {
    if (!term.trim()) {
      setSearchOverride(null);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch("/api/intelligence/library/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: term,
          filters: {
            source: dataSourceFilter || undefined,
            ntee: nteeFilter || undefined,
            funderBucket: funderBucketFilter || undefined,
            minAmount: minAmount || undefined,
            maxAmount: maxAmount || undefined,
            year: yearFilter || undefined,
          },
        }),
      });
      if (!res.ok) throw new Error(`Search failed (${res.status}).`);
      const body = (await res.json()) as { results: ProposalCard[] };
      setSearchOverride(body.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  // Debounce the search box 300ms before it drives a filtered GET refetch.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
      if (!searchInput.trim()) setSearchOverride(null);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (dataSourceFilter) params.set("source", dataSourceFilter);
    if (nteeFilter) params.set("ntee", nteeFilter);
    if (funderBucketFilter) params.set("funderBucket", funderBucketFilter);
    if (minAmount) params.set("minAmount", minAmount);
    if (maxAmount) params.set("maxAmount", maxAmount);
    if (yearFilter) params.set("year", yearFilter);
    params.set("page", String(page));

    fetch(`/api/intelligence/proposals?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Request failed (${res.status}).`);
        }
        return res.json() as Promise<ProposalsResponse>;
      })
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load proposals.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [search, dataSourceFilter, nteeFilter, funderBucketFilter, minAmount, maxAmount, yearFilter, page, refreshKey]);

  const displayedResults = useMemo(() => searchOverride ?? data?.results ?? [], [searchOverride, data]);
  const overlayProposal = useMemo(
    () => displayedResults.find((p) => p.id === overlayId) ?? null,
    [displayedResults, overlayId],
  );

  const sourcePills = useMemo(() => {
    const sources = data?.stats.sources ?? [];
    return sources
      .map((s) => ({ value: s, label: SOURCE_LABELS[s] ?? s }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [data?.stats.sources]);

  function goToDraftGenerator() {
    const ids = [...selectedRefs.keys()];
    if (ids.length === 0) return;
    router.push(`/draft-generator?referenceIds=${ids.join(",")}`);
  }

  return (
    <div style={{ minHeight: "100vh", background: COLORS.canvas, padding: 24 }}>
      {/* Header */}
      <div
        style={{
          marginBottom: 20,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#0F172A", margin: 0 }}>
            Grant Intelligence Library
          </h1>
          <p style={{ fontSize: 14, color: "#3F5872", marginTop: 6, maxWidth: 640 }}>
            {data
              ? `${data.stats.totalProposals.toLocaleString()} awarded grant narratives — the AI draws from these when drafting every application`
              : "Loading corpus…"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setShowImportInfo((v) => !v)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "10px 16px",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
                border: "none",
                background: COLORS.blue,
                color: COLORS.white,
                cursor: "pointer",
              }}
            >
              <Database size={15} />
              Import More
            </button>
            {showImportInfo && (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: "calc(100% + 8px)",
                  width: 320,
                  background: COLORS.card,
                  border: `1px solid ${COLORS.cardBorderColor}`,
                  borderRadius: 12,
                  padding: 16,
                  boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
                  zIndex: 20,
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <Info size={16} color={COLORS.blue} style={{ flexShrink: 0, marginTop: 2 }} />
                  <p style={{ fontSize: 12.5, color: COLORS.textMuted, margin: 0, lineHeight: 1.5 }}>
                    New narratives are added by the ingestion pipeline (
                    <code style={{ color: COLORS.white }}>pnpm import:federal</code>, NIH RePORTER, NSF Award
                    Search, USASpending, ProPublica 990) run by a platform admin — there is no client-triggerable
                    import here yet.
                  </p>
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "10px 16px",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 600,
              border: "none",
              background: COLORS.purple,
              color: COLORS.white,
              cursor: "pointer",
            }}
          >
            {showAddForm ? <X size={15} /> : <Plus size={15} />}
            {showAddForm ? "Cancel" : "Add Awarded Grant"}
          </button>
        </div>
      </div>

      {/* Quick source pills */}
      {sourcePills.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
          <QuickPill
            active={dataSourceFilter === ""}
            label="All Sources"
            onClick={() => {
              setDataSourceFilter("");
              setPage(1);
            }}
          />
          {sourcePills.map((s) => (
            <QuickPill
              key={s.value}
              active={dataSourceFilter === s.value}
              label={s.label}
              onClick={() => {
                setDataSourceFilter((prev) => (prev === s.value ? "" : s.value));
                setPage(1);
              }}
            />
          ))}
        </div>
      )}

      {showAddForm && (
        <AddNarrativeForm
          value={newNarrative}
          onChange={setNewNarrative}
          onSubmit={handleAddNarrative}
          submitting={addSubmitting}
          error={addError}
        />
      )}

      {/* Search + filter bar */}
      <div
        style={{
          background: COLORS.card,
          border: `1px solid ${COLORS.cardBorderColor}`,
          borderRadius: 14,
          padding: 20,
          marginBottom: 20,
        }}
      >
        {/* Row 1: full-text search */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <Search
              size={16}
              color={COLORS.textFaint}
              style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)" }}
            />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runFullTextSearch(searchInput);
              }}
              placeholder="Search by funder, program, keyword, or narrative content…"
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "#141F33",
                border: `1px solid ${COLORS.cardBorderColor}`,
                borderRadius: 10,
                padding: "11px 14px 11px 38px",
                fontSize: 14,
                color: COLORS.white,
                outline: "none",
              }}
            />
          </div>
          <button
            type="button"
            onClick={() => runFullTextSearch(searchInput)}
            disabled={searching}
            style={{
              padding: "0 20px",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
              border: "none",
              background: searching ? COLORS.textFaint : COLORS.blue,
              color: COLORS.white,
              cursor: searching ? "not-allowed" : "pointer",
            }}
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </div>

        {/* Row 2: filter pills */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end" }}>
          <div style={{ minWidth: 190 }}>
            <label style={filterLabelStyle}>Funder Type</label>
            <select
              value={funderBucketFilter}
              onChange={(e) => {
                setFunderBucketFilter(e.target.value as FunderBucket | "");
                setPage(1);
              }}
              style={selectStyle}
            >
              <option value="">All Types</option>
              {FUNDER_BUCKET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ minWidth: 200 }}>
            <label style={filterLabelStyle}>NTEE Category</label>
            <select
              value={nteeFilter}
              onChange={(e) => {
                setNteeFilter(e.target.value);
                setPage(1);
              }}
              style={selectStyle}
            >
              <option value="">All Categories</option>
              {NTEE_GROUPS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ width: 110 }}>
            <label style={filterLabelStyle}>Min Award ($)</label>
            <input
              type="number"
              value={minAmount}
              onChange={(e) => {
                setMinAmount(e.target.value);
                setPage(1);
              }}
              style={selectStyle}
            />
          </div>
          <div style={{ width: 110 }}>
            <label style={filterLabelStyle}>Max Award ($)</label>
            <input
              type="number"
              value={maxAmount}
              onChange={(e) => {
                setMaxAmount(e.target.value);
                setPage(1);
              }}
              style={selectStyle}
            />
          </div>

          <div style={{ width: 130 }}>
            <label style={filterLabelStyle}>Award Year</label>
            <select
              value={yearFilter}
              onChange={(e) => {
                setYearFilter(e.target.value);
                setPage(1);
              }}
              style={selectStyle}
            >
              <option value="">All Years</option>
              {YEAR_OPTIONS.map((y) => (
                <option key={y} value={y}>
                  {y === "earlier" ? "Earlier" : y}
                </option>
              ))}
            </select>
          </div>

          <div style={{ minWidth: 170 }}>
            <label style={filterLabelStyle}>Data Source</label>
            <select
              value={dataSourceFilter}
              onChange={(e) => {
                setDataSourceFilter(e.target.value);
                setPage(1);
              }}
              style={selectStyle}
            >
              <option value="">All</option>
              {DATA_SOURCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearAllFilters}
              style={{
                padding: "8px 14px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 700,
                border: `1px solid ${COLORS.amber}`,
                background: COLORS.amberBg,
                color: COLORS.amber,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} active
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 14,
          marginBottom: 22,
        }}
      >
        <StatCard
          label="Total Narratives"
          value={data ? data.filteredStats.totalNarratives.toLocaleString() : "—"}
        />
        <StatCard
          label="Avg Award Amount"
          value={data ? formatCurrency(data.filteredStats.avgAwardAmount) : "—"}
        />
        <StatCard
          label="Federal Grants"
          value={data ? data.filteredStats.federalCount.toLocaleString() : "—"}
          accent="#1D4ED8"
        />
        <StatCard
          label="Foundation Grants"
          value={data ? data.filteredStats.foundationCount.toLocaleString() : "—"}
          accent="#7C3AED"
        />
        <StatCard
          label="Corporate Grants"
          value={data ? data.filteredStats.corporateCount.toLocaleString() : "—"}
          accent="#0891B2"
        />
      </div>

      {/* Results */}
      {error ? (
        <div
          style={{
            background: "#450A0A",
            border: `1px solid ${COLORS.red}`,
            borderRadius: 12,
            padding: 20,
            color: "#FCA5A5",
            fontSize: 14,
          }}
        >
          {error}
        </div>
      ) : loading && !data ? (
        <div style={{ textAlign: "center", padding: 48, color: "#3F5872", fontSize: 14 }}>Loading proposals…</div>
      ) : displayedResults.length === 0 ? (
        <div
          style={{
            background: COLORS.card,
            border: `1px solid ${COLORS.cardBorderColor}`,
            borderRadius: 14,
            padding: 48,
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: 16, fontWeight: 700, color: COLORS.white, margin: 0 }}>No narratives found</p>
          <p style={{ fontSize: 14, color: COLORS.textMuted, marginTop: 8 }}>
            {activeFilterCount > 0 || search
              ? "Try a different search term or filter combination."
              : "The proposal corpus is empty — ingestion scripts populate this library on schedule."}
          </p>
        </div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(440px, 1fr))",
              gap: 16,
              opacity: loading ? 0.6 : 1,
              transition: "opacity 150ms",
            }}
          >
            {displayedResults.map((proposal) => (
              <ProposalCardView
                key={proposal.id}
                proposal={proposal}
                expanded={expandedIds.has(proposal.id)}
                onToggleExpand={() => toggleSet(setExpandedIds, proposal.id)}
                winningPhrasesOpen={openWinningPhrases.has(proposal.id)}
                onToggleWinningPhrases={() => toggleSet(setOpenWinningPhrases, proposal.id)}
                persuasiveOpen={openPersuasive.has(proposal.id)}
                onTogglePersuasive={() => toggleSet(setOpenPersuasive, proposal.id)}
                selected={selectedRefs.has(proposal.id)}
                onToggleReference={() => toggleReference(proposal)}
                onOpenOverlay={() => setOverlayId(proposal.id)}
              />
            ))}
          </div>

          {!searchOverride && data && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 24,
                padding: "12px 4px",
              }}
            >
              <span style={{ fontSize: 13, color: "#3F5872" }}>
                Showing {(data.page - 1) * data.pageSize + 1}-
                {Math.min(data.page * data.pageSize, data.total)} of {data.total.toLocaleString()} results
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <PageButton
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  icon={ChevronLeft}
                  label="Previous"
                />
                <PageButton
                  disabled={page >= data.totalPages}
                  onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                  icon={ChevronRight}
                  label="Next"
                  iconTrailing
                />
              </div>
            </div>
          )}
        </>
      )}

      {overlayProposal && (
        <FullNarrativeOverlay
          proposal={overlayProposal}
          onClose={() => setOverlayId(null)}
          onUseInDraft={() => {
            toggleReference(overlayProposal);
            const ids = new Set([...selectedRefs.keys(), overlayProposal.id]);
            router.push(`/draft-generator?referenceIds=${[...ids].join(",")}`);
          }}
        />
      )}

      {selectedRefs.size > 0 && (
        <div
          style={{
            position: "fixed",
            left: 24,
            right: 24,
            bottom: 20,
            background: COLORS.card,
            border: `1px solid ${COLORS.purple}`,
            borderRadius: 14,
            padding: "16px 22px",
            boxShadow: "0 -12px 32px rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
            zIndex: 30,
          }}
        >
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: COLORS.white }}>
              {selectedRefs.size} Narrative{selectedRefs.size === 1 ? "" : "s"} Selected for AI Reference
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 12.5, color: COLORS.textMuted }}>
              {[...selectedRefs.values()].join(" · ")}
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setSelectedRefs(new Map())}
              style={{
                padding: "9px 16px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                border: `1px solid ${COLORS.cardBorderColor}`,
                background: "transparent",
                color: COLORS.textMuted,
                cursor: "pointer",
              }}
            >
              Clear Selection
            </button>
            <button
              type="button"
              onClick={goToDraftGenerator}
              style={{
                padding: "9px 18px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 700,
                border: "none",
                background: COLORS.purple,
                color: COLORS.white,
                cursor: "pointer",
              }}
            >
              Generate Draft Using These References
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function QuickPill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "7px 14px",
        borderRadius: 999,
        fontSize: 12.5,
        fontWeight: 600,
        cursor: "pointer",
        border: active ? `1px solid ${COLORS.blue}` : `1px solid rgba(15,23,42,0.12)`,
        background: active ? COLORS.blue : COLORS.white,
        color: active ? COLORS.white : "#3F5872",
      }}
    >
      {label}
    </button>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.cardBorderColor}`,
        borderRadius: 12,
        padding: 16,
        borderLeft: `4px solid ${accent ?? COLORS.blue}`,
      }}
    >
      <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: COLORS.white, lineHeight: 1.2 }}>{value}</p>
      <p style={{ margin: "4px 0 0", fontSize: 11.5, fontWeight: 600, color: COLORS.textMuted }}>{label}</p>
    </div>
  );
}

function ProposalCardView({
  proposal,
  expanded,
  onToggleExpand,
  winningPhrasesOpen,
  onToggleWinningPhrases,
  persuasiveOpen,
  onTogglePersuasive,
  selected,
  onToggleReference,
  onOpenOverlay,
}: {
  proposal: ProposalCard;
  expanded: boolean;
  onToggleExpand: () => void;
  winningPhrasesOpen: boolean;
  onToggleWinningPhrases: () => void;
  persuasiveOpen: boolean;
  onTogglePersuasive: () => void;
  selected: boolean;
  onToggleReference: () => void;
  onOpenOverlay: () => void;
}) {
  const bucketBadge = proposal.funderBucket ? FUNDER_BUCKET_BADGE[proposal.funderBucket] : null;
  const visibleFactors = proposal.successFactors.slice(0, 4);
  const extraFactors = proposal.successFactors.length - visibleFactors.length;

  return (
    <div
      style={{
        background: COLORS.card,
        border: selected ? `1px solid ${COLORS.purple}` : `1px solid ${COLORS.cardBorderColor}`,
        borderRadius: 14,
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {/* Top row */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        {bucketBadge && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "4px 10px",
              borderRadius: 999,
              background: bucketBadge.bg,
              color: bucketBadge.fg,
            }}
          >
            {bucketBadge.label}
          </span>
        )}
        {proposal.nteeCode && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              fontSize: 11,
              fontWeight: 700,
              padding: "4px 9px",
              borderRadius: 999,
              background: "rgba(139,92,246,0.16)",
              color: "#C4B5FD",
            }}
          >
            <Tag size={10} />
            {proposal.nteeCode}
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: COLORS.green }}>
            {formatCurrency(proposal.awardAmount)}
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "3px 8px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.06)",
              color: COLORS.textMuted,
            }}
          >
            {proposal.awardYear ?? "—"}
          </span>
        </div>
      </div>

      {/* Second row */}
      <div>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: COLORS.white, margin: 0, lineHeight: 1.35 }}>
          {proposal.funderName ?? "Unknown funder"}
        </h3>
        <p style={{ fontSize: 13, color: COLORS.textMuted, margin: "2px 0 0" }}>
          {truncate(proposal.title, 90)}
        </p>
        {proposal.organizationName && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 4 }}>
            <Building2 size={12} color={COLORS.textFaint} />
            <span style={{ fontSize: 12, color: COLORS.textFaint }}>{proposal.organizationName}</span>
          </div>
        )}
      </div>

      {/* Third row — excerpt */}
      <p
        style={{
          fontSize: 13,
          color: COLORS.textMuted,
          margin: 0,
          lineHeight: 1.55,
          fontStyle: "italic",
          display: "-webkit-box",
          WebkitLineClamp: expanded ? undefined : 3,
          WebkitBoxOrient: "vertical",
          overflow: expanded ? "visible" : "hidden",
        }}
      >
        {expanded ? proposal.fullText : truncate(proposal.fullText, 280)}
      </p>
      {proposal.fullText && proposal.fullText.length > 280 && (
        <button
          type="button"
          onClick={onToggleExpand}
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: COLORS.blue,
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            textAlign: "left",
          }}
        >
          {expanded ? "Show less" : "Read More"}
        </button>
      )}

      {/* Success factors */}
      {visibleFactors.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {visibleFactors.map((factor, i) => (
            <span
              key={i}
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "4px 9px",
                borderRadius: 999,
                background: COLORS.greenBg,
                color: "#6EE7B7",
              }}
            >
              {factor}
            </span>
          ))}
          {extraFactors > 0 && (
            <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.textFaint, alignSelf: "center" }}>
              +{extraFactors} more
            </span>
          )}
        </div>
      )}

      {/* Winning phrases / persuasive elements — only rendered when data exists */}
      {proposal.winningPhrases.length > 0 && (
        <div>
          <button
            type="button"
            onClick={onToggleWinningPhrases}
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: COLORS.amber,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            {winningPhrasesOpen ? "Hide Winning Phrases" : "View Winning Phrases"}
          </button>
          {winningPhrasesOpen && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {proposal.winningPhrases.map((phrase, i) => (
                <span
                  key={i}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "4px 9px",
                    borderRadius: 999,
                    background: COLORS.amberBg,
                    color: "#FCD34D",
                  }}
                >
                  {phrase}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {proposal.persuasiveElements.length > 0 && (
        <div>
          <button
            type="button"
            onClick={onTogglePersuasive}
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: COLORS.blue,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            {persuasiveOpen ? "Hide Persuasive Elements" : "View Persuasive Elements"}
          </button>
          {persuasiveOpen && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {proposal.persuasiveElements.map((el, i) => (
                <div
                  key={i}
                  style={{ background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "8px 10px" }}
                >
                  <p style={{ margin: 0, fontSize: 11.5, fontWeight: 700, color: COLORS.white }}>
                    {el.element_type}
                  </p>
                  <p style={{ margin: "3px 0 0", fontSize: 11.5, color: COLORS.textMuted }}>{el.why_it_works}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Action row */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          marginTop: 4,
          paddingTop: 12,
          borderTop: `1px solid ${COLORS.cardBorderColor}`,
        }}
      >
        <button
          type="button"
          onClick={onToggleReference}
          style={{
            padding: "7px 12px",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 700,
            border: selected ? "none" : `1px solid ${COLORS.purple}`,
            background: selected ? COLORS.purple : "transparent",
            color: selected ? COLORS.white : COLORS.purple,
            cursor: "pointer",
          }}
        >
          {selected ? "Selected as Reference" : "Use as Reference"}
        </button>
        <button
          type="button"
          onClick={onOpenOverlay}
          style={{
            padding: "7px 12px",
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 700,
            border: `1px solid ${COLORS.cardBorderColor}`,
            background: "transparent",
            color: COLORS.white,
            cursor: "pointer",
          }}
        >
          View Full Narrative
        </button>
        {proposal.winningPhrases.length > 0 && (
          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(proposal.winningPhrases.map((p) => `• ${p}`).join("\n"));
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "7px 12px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              border: `1px solid ${COLORS.cardBorderColor}`,
              background: "transparent",
              color: COLORS.textMuted,
              cursor: "pointer",
            }}
          >
            <Copy size={12} />
            Copy Winning Phrases
          </button>
        )}
        {proposal.sourceUrl && (
          <a
            href={proposal.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              fontWeight: 600,
              color: COLORS.textFaint,
              textDecoration: "none",
            }}
          >
            Source <ExternalLink size={11} />
          </a>
        )}
      </div>
    </div>
  );
}

function FullNarrativeOverlay({
  proposal,
  onClose,
  onUseInDraft,
}: {
  proposal: ProposalCard;
  onClose: () => void;
  onUseInDraft: () => void;
}) {
  const bucketBadge = proposal.funderBucket ? FUNDER_BUCKET_BADGE[proposal.funderBucket] : null;
  const paragraphs = (proposal.fullText ?? "").split(/\n\n+/).filter(Boolean);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(4,10,20,0.72)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: COLORS.white,
          borderRadius: 16,
          width: 800,
          maxWidth: "100%",
          height: "85vh",
          overflowY: "auto",
          padding: 32,
          position: "relative",
          boxShadow: "0 24px 64px rgba(0,0,0,0.4)",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          style={{
            position: "absolute",
            top: 20,
            right: 20,
            border: "none",
            background: "#F1F5F9",
            borderRadius: 999,
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <X size={16} color="#334155" />
        </button>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {bucketBadge && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "4px 10px",
                borderRadius: 999,
                background: bucketBadge.bg,
                color: bucketBadge.fg,
              }}
            >
              {bucketBadge.label}
            </span>
          )}
          {proposal.nteeCode && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "4px 9px",
                borderRadius: 999,
                background: "#F5F3FF",
                color: "#7C3AED",
              }}
            >
              {proposal.nteeCode}
            </span>
          )}
        </div>

        <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0F172A", margin: "0 0 4px" }}>
          {proposal.funderName}
        </h2>
        <p style={{ fontSize: 14, color: "#64748B", margin: 0 }}>{proposal.title}</p>

        <div style={{ display: "flex", gap: 24, margin: "16px 0", flexWrap: "wrap" }}>
          <div>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>
              Award Amount
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 800, color: "#15803D" }}>
              {formatCurrency(proposal.awardAmount)}
            </p>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>
              Award Year
            </p>
            <p style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 800, color: "#0F172A" }}>
              {proposal.awardYear ?? "—"}
            </p>
          </div>
          {proposal.organizationName && (
            <div>
              <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>
                Recipient Organization
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 14, fontWeight: 600, color: "#0F172A" }}>
                {proposal.organizationName}
              </p>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onUseInDraft}
          style={{
            width: "100%",
            padding: "12px 20px",
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 700,
            border: "none",
            background: COLORS.purple,
            color: COLORS.white,
            cursor: "pointer",
            marginBottom: 20,
          }}
        >
          Use in My Draft
        </button>

        <div style={{ borderTop: "1px solid #E2E8F0", paddingTop: 20 }}>
          {paragraphs.length > 0 ? (
            paragraphs.map((p, i) => (
              <p key={i} style={{ fontSize: 14, color: "#334155", lineHeight: 1.7, marginBottom: 14 }}>
                {p}
              </p>
            ))
          ) : (
            <p style={{ fontSize: 14, color: "#94A3B8" }}>No full narrative text recorded for this entry.</p>
          )}
        </div>

        {proposal.successFactors.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: "#0F172A", marginBottom: 8 }}>Success Factors</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {proposal.successFactors.map((f, i) => (
                <span
                  key={i}
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    padding: "4px 10px",
                    borderRadius: 999,
                    background: "#DCFCE7",
                    color: "#15803D",
                  }}
                >
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}

        {proposal.winningPhrases.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: "#0F172A", marginBottom: 8 }}>Winning Phrases</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {proposal.winningPhrases.map((p, i) => (
                <span
                  key={i}
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    padding: "4px 10px",
                    borderRadius: 999,
                    background: "#FEF3C7",
                    color: "#B45309",
                  }}
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        )}

        {proposal.persuasiveElements.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: "#0F172A", marginBottom: 8 }}>Persuasive Elements</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {proposal.persuasiveElements.map((el, i) => (
                <div key={i} style={{ background: "#F8FAFC", borderRadius: 8, padding: "10px 12px" }}>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#0F172A" }}>{el.element_type}</p>
                  <p style={{ margin: "3px 0 0", fontSize: 12, color: "#64748B" }}>{el.why_it_works}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AddNarrativeForm({
  value,
  onChange,
  onSubmit,
  submitting,
  error,
}: {
  value: NewNarrativeForm;
  onChange: (updater: (f: NewNarrativeForm) => NewNarrativeForm) => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
}) {
  return (
    <div
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.cardBorderColor}`,
        borderRadius: 14,
        padding: 20,
        marginBottom: 20,
      }}
    >
      <h3 style={{ fontSize: 15, fontWeight: 700, color: COLORS.white, margin: "0 0 14px" }}>
        Add Awarded Grant Narrative
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <FormField label="Title / Program *" value={value.title} onChange={(v) => onChange((f) => ({ ...f, title: v }))} />
        <FormField
          label="Funder Name *"
          value={value.funderName}
          onChange={(v) => onChange((f) => ({ ...f, funderName: v }))}
        />
        <FormField
          label="Funder Type"
          value={value.funderType}
          onChange={(v) => onChange((f) => ({ ...f, funderType: v }))}
        />
        <FormField
          label="Recipient Organization"
          value={value.organization}
          onChange={(v) => onChange((f) => ({ ...f, organization: v }))}
        />
        <FormField
          label="Award Amount"
          type="number"
          value={value.awardAmount}
          onChange={(v) => onChange((f) => ({ ...f, awardAmount: v }))}
        />
        <FormField
          label="Award Year"
          type="number"
          value={value.awardYear}
          onChange={(v) => onChange((f) => ({ ...f, awardYear: v }))}
        />
        <div>
          <label style={filterLabelStyle}>NTEE Category</label>
          <select
            value={value.nteeCode}
            onChange={(e) => onChange((f) => ({ ...f, nteeCode: e.target.value }))}
            style={selectStyle}
          >
            <option value="">—</option>
            {NTEE_GROUPS.map((g) => (
              <option key={g.value} value={g.codes[0]}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
        <FormField
          label="Success Factors (comma-separated)"
          value={value.successFactors}
          onChange={(v) => onChange((f) => ({ ...f, successFactors: v }))}
        />
        <FormField
          label="Keywords (comma-separated)"
          value={value.keywords}
          onChange={(v) => onChange((f) => ({ ...f, keywords: v }))}
        />
      </div>
      <div style={{ marginTop: 12 }}>
        <label style={filterLabelStyle}>Full Narrative</label>
        <textarea
          value={value.narrativeFull}
          onChange={(e) => onChange((f) => ({ ...f, narrativeFull: e.target.value }))}
          rows={6}
          style={{
            width: "100%",
            boxSizing: "border-box",
            marginTop: 4,
            border: `1px solid ${COLORS.cardBorderColor}`,
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 13,
            color: COLORS.white,
            background: "#141F33",
            fontFamily: "inherit",
            resize: "vertical",
          }}
        />
      </div>
      {error && <p style={{ color: "#FCA5A5", fontSize: 13, marginTop: 10 }}>{error}</p>}
      <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
        <button
          type="button"
          disabled={submitting || !value.title || !value.funderName}
          onClick={onSubmit}
          style={{
            padding: "9px 18px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            border: "none",
            background: submitting ? COLORS.textFaint : COLORS.purple,
            color: COLORS.white,
            cursor: submitting ? "not-allowed" : "pointer",
          }}
        >
          {submitting ? "Saving…" : "Save Narrative"}
        </button>
      </div>
    </div>
  );
}

function FormField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number";
}) {
  return (
    <div>
      <label style={filterLabelStyle}>{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} style={selectStyle} />
    </div>
  );
}

function PageButton({
  disabled,
  onClick,
  icon: Icon,
  label,
  iconTrailing,
}: {
  disabled: boolean;
  onClick: () => void;
  icon: typeof ChevronLeft;
  label: string;
  iconTrailing?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "8px 14px",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        border: `1px solid ${disabled ? "rgba(15,23,42,0.08)" : "rgba(15,23,42,0.18)"}`,
        background: disabled ? "rgba(255,255,255,0.4)" : COLORS.white,
        color: disabled ? "#94A3B8" : "#0F172A",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {!iconTrailing && <Icon size={14} />}
      {label}
      {iconTrailing && <Icon size={14} />}
    </button>
  );
}
