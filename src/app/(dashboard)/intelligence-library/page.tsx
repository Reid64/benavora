"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Building2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  ExternalLink,
  FileText,
  Plus,
  Search,
  Tag,
  X,
} from "lucide-react";

const COLORS = {
  background: "#E4E9F0",
  surface: "#FFFFFF",
  surfaceSunken: "#F7F9FC",
  primary: "#0077B6",
  primaryHover: "#005F92",
  accent: "#00B4D8",
  navy: "#1A2B3C",
  text: "#0F172A",
  textMuted: "#64748B",
  textFaint: "#94A3B8",
  border: "#E2E8F0",
  green: "#15803D",
  greenBg: "#DCFCE7",
};

const selectStyle: CSSProperties = {
  display: "block",
  marginTop: 4,
  width: "100%",
  boxSizing: "border-box",
  border: `1px solid ${COLORS.border}`,
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 13,
  color: COLORS.text,
  background: COLORS.surface,
};

const filterLabelStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: COLORS.textMuted,
};

type SourceKey = "ALL" | "NIH_REPORTER" | "NSF_AWARDS" | "FEDERAL_REGISTER" | "USASPENDING" | "NIH_NIAID";

const SOURCE_TABS: { key: SourceKey; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "NIH_REPORTER", label: "NIH" },
  { key: "NSF_AWARDS", label: "NSF" },
  { key: "FEDERAL_REGISTER", label: "Federal Register" },
  { key: "USASPENDING", label: "USASpending" },
  { key: "NIH_NIAID", label: "NIH NIAID" },
];

interface ProposalCard {
  id: string;
  source: string;
  sourceUrl: string | null;
  funderName: string | null;
  funderType: string | null;
  title: string | null;
  awardAmount: number | null;
  awardYear: number | null;
  category: string[];
  organizationName: string | null;
  abstract: string | null;
  narrativeFull: string | null;
  nteeCode: string | null;
  successFactors: string[];
  keywords: string[];
  createdAt: string;
}

const NTEE_OPTIONS: { code: string; label: string }[] = [
  { code: "A", label: "Arts, Culture & Humanities" },
  { code: "B", label: "Education" },
  { code: "C", label: "Environment" },
  { code: "D", label: "Animal-Related" },
  { code: "E", label: "Health Care" },
  { code: "F", label: "Mental Health & Crisis Intervention" },
  { code: "L", label: "Housing & Shelter" },
  { code: "O", label: "Youth Development" },
  { code: "P", label: "Human Services" },
  { code: "S", label: "Community Improvement & Capacity Building" },
  { code: "W", label: "Public & Societal Benefit — Veterans" },
];

interface NewNarrativeForm {
  title: string;
  funderName: string;
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
  grantProgram: "",
  awardAmount: "",
  awardYear: "",
  nteeCode: "",
  narrativeFull: "",
  successFactors: "",
  keywords: "",
};

interface CorpusStats {
  totalProposals: number;
  totalSources: number;
  earliestYear: number | null;
  latestYear: number | null;
  lastIngestionAt: string | null;
}

interface ProposalsResponse {
  results: ProposalCard[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  stats: CorpusStats;
}

function formatCurrency(amount: number | null): string {
  if (amount === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function truncate(value: string | null, max: number): string {
  if (!value) return "—";
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}…` : trimmed;
}

export default function IntelligenceLibraryPage() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<SourceKey>("ALL");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ProposalsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [nteeFilter, setNteeFilter] = useState("");
  const [funderTypeFilter, setFunderTypeFilter] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showAddForm, setShowAddForm] = useState(false);
  const [newNarrative, setNewNarrative] = useState<NewNarrativeForm>(EMPTY_NEW_NARRATIVE);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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

  // Debounce the search box 300ms before it drives a fetch.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (source !== "ALL") params.set("source", source);
    if (search) params.set("search", search);
    if (nteeFilter) params.set("ntee", nteeFilter);
    if (funderTypeFilter) params.set("funderType", funderTypeFilter);
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
  }, [source, search, page, nteeFilter, funderTypeFilter, minAmount, maxAmount, yearFilter, refreshKey]);

  const stats = data?.stats;
  const dateRangeLabel = useMemo(() => {
    if (!stats || stats.earliestYear === null || stats.latestYear === null) return "—";
    return stats.earliestYear === stats.latestYear
      ? String(stats.earliestYear)
      : `${stats.earliestYear}–${stats.latestYear}`;
  }, [stats]);

  return (
    <div style={{ minHeight: "100vh", background: COLORS.background, padding: 24 }}>
      {/* Header */}
      <div
        style={{
          marginBottom: 24,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: COLORS.text, margin: 0 }}>
            Intelligence Library
            {stats ? ` — ${stats.totalProposals.toLocaleString()} Awarded Grant Narratives` : ""}
          </h1>
          <p style={{ fontSize: 14, color: COLORS.textMuted, marginTop: 4 }}>
            Successful grant narratives — real and platform-authored funded proposals your AI draws
            from when drafting applications, sourced from NIH, NSF, Federal Register NOFAs,
            USASpending, ProPublica, and manually added awards.
          </p>
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
            background: "#8B5CF6",
            color: "#FFFFFF",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          {showAddForm ? <X size={15} /> : <Plus size={15} />}
          {showAddForm ? "Cancel" : "Add Awarded Grant"}
        </button>
      </div>

      {showAddForm && (
        <div
          style={{
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 12,
            padding: 20,
            marginBottom: 20,
          }}
        >
          <h3 style={{ fontSize: 15, fontWeight: 700, color: COLORS.text, margin: "0 0 14px" }}>
            Add Awarded Grant Narrative
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <FormField
              label="Title / Program *"
              value={newNarrative.title}
              onChange={(v) => setNewNarrative((f) => ({ ...f, title: v }))}
            />
            <FormField
              label="Funder Name *"
              value={newNarrative.funderName}
              onChange={(v) => setNewNarrative((f) => ({ ...f, funderName: v }))}
            />
            <FormField
              label="Award Amount"
              type="number"
              value={newNarrative.awardAmount}
              onChange={(v) => setNewNarrative((f) => ({ ...f, awardAmount: v }))}
            />
            <FormField
              label="Award Year"
              type="number"
              value={newNarrative.awardYear}
              onChange={(v) => setNewNarrative((f) => ({ ...f, awardYear: v }))}
            />
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: COLORS.textMuted }}>NTEE Category</label>
              <select
                value={newNarrative.nteeCode}
                onChange={(e) => setNewNarrative((f) => ({ ...f, nteeCode: e.target.value }))}
                style={selectStyle}
              >
                <option value="">—</option>
                {NTEE_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.code} — {o.label}
                  </option>
                ))}
              </select>
            </div>
            <FormField
              label="Success Factors (comma-separated)"
              value={newNarrative.successFactors}
              onChange={(v) => setNewNarrative((f) => ({ ...f, successFactors: v }))}
            />
            <FormField
              label="Keywords (comma-separated)"
              value={newNarrative.keywords}
              onChange={(v) => setNewNarrative((f) => ({ ...f, keywords: v }))}
            />
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: COLORS.textMuted }}>Full Narrative</label>
            <textarea
              value={newNarrative.narrativeFull}
              onChange={(e) => setNewNarrative((f) => ({ ...f, narrativeFull: e.target.value }))}
              rows={6}
              style={{
                width: "100%",
                boxSizing: "border-box",
                marginTop: 4,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
                padding: "8px 10px",
                fontSize: 13,
                color: COLORS.text,
                fontFamily: "inherit",
                resize: "vertical",
              }}
            />
          </div>
          {addError && (
            <p style={{ color: "#B91C1C", fontSize: 13, marginTop: 10 }}>{addError}</p>
          )}
          <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
            <button
              type="button"
              disabled={addSubmitting || !newNarrative.title || !newNarrative.funderName}
              onClick={handleAddNarrative}
              style={{
                padding: "9px 18px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                border: "none",
                background: addSubmitting ? COLORS.textFaint : "#8B5CF6",
                color: "#FFFFFF",
                cursor: addSubmitting ? "not-allowed" : "pointer",
              }}
            >
              {addSubmitting ? "Saving…" : "Save Narrative"}
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 12,
          padding: 16,
          marginBottom: 20,
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "flex-end",
        }}
      >
        <div>
          <label style={filterLabelStyle}>NTEE Category</label>
          <select
            value={nteeFilter}
            onChange={(e) => {
              setNteeFilter(e.target.value);
              setPage(1);
            }}
            style={selectStyle}
          >
            <option value="">All categories</option>
            {NTEE_OPTIONS.map((o) => (
              <option key={o.code} value={o.code}>
                {o.code} — {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={filterLabelStyle}>Funder Type</label>
          <input
            value={funderTypeFilter}
            onChange={(e) => {
              setFunderTypeFilter(e.target.value);
              setPage(1);
            }}
            placeholder="e.g. Private Foundation"
            style={{ ...selectStyle, width: 180 }}
          />
        </div>
        <div>
          <label style={filterLabelStyle}>Min Award ($)</label>
          <input
            type="number"
            value={minAmount}
            onChange={(e) => {
              setMinAmount(e.target.value);
              setPage(1);
            }}
            style={{ ...selectStyle, width: 120 }}
          />
        </div>
        <div>
          <label style={filterLabelStyle}>Max Award ($)</label>
          <input
            type="number"
            value={maxAmount}
            onChange={(e) => {
              setMaxAmount(e.target.value);
              setPage(1);
            }}
            style={{ ...selectStyle, width: 120 }}
          />
        </div>
        <div>
          <label style={filterLabelStyle}>Award Year</label>
          <input
            type="number"
            value={yearFilter}
            onChange={(e) => {
              setYearFilter(e.target.value);
              setPage(1);
            }}
            style={{ ...selectStyle, width: 100 }}
          />
        </div>
        {(nteeFilter || funderTypeFilter || minAmount || maxAmount || yearFilter) && (
          <button
            type="button"
            onClick={() => {
              setNteeFilter("");
              setFunderTypeFilter("");
              setMinAmount("");
              setMaxAmount("");
              setYearFilter("");
              setPage(1);
            }}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              border: `1px solid ${COLORS.border}`,
              background: COLORS.surfaceSunken,
              color: COLORS.textMuted,
              cursor: "pointer",
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Corpus stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <StatTile icon={FileText} accent={COLORS.primary} label="Total proposals" value={stats ? stats.totalProposals.toLocaleString() : "—"} />
        <StatTile icon={Database} accent={COLORS.accent} label="Sources" value={stats ? String(stats.totalSources) : "—"} />
        <StatTile icon={Calendar} accent="#7C3AED" label="Date range" value={dateRangeLabel} />
        <StatTile icon={Clock} accent="#F59E0B" label="Last ingestion" value={stats ? formatDate(stats.lastIngestionAt) : "—"} />
      </div>

      {/* Search */}
      <div style={{ position: "relative", marginBottom: 16 }}>
        <Search
          size={16}
          color={COLORS.textFaint}
          style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)" }}
        />
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by title, funder, or keyword…"
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 10,
            padding: "10px 14px 10px 38px",
            fontSize: 14,
            color: COLORS.text,
            outline: "none",
          }}
        />
      </div>

      {/* Source tabs */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
        {SOURCE_TABS.map((tab) => {
          const active = source === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setSource(tab.key);
                setPage(1);
              }}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                border: active ? `1px solid ${COLORS.primary}` : `1px solid ${COLORS.border}`,
                background: active ? COLORS.primary : COLORS.surface,
                color: active ? "#FFFFFF" : COLORS.textMuted,
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Results */}
      {error ? (
        <div
          style={{
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            borderRadius: 12,
            padding: 20,
            color: "#B91C1C",
            fontSize: 14,
          }}
        >
          {error}
        </div>
      ) : loading && !data ? (
        <div style={{ textAlign: "center", padding: 48, color: COLORS.textMuted, fontSize: 14 }}>
          Loading proposals…
        </div>
      ) : !data || data.results.length === 0 ? (
        <div
          style={{
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 12,
            padding: 48,
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: 16, fontWeight: 600, color: COLORS.text, margin: 0 }}>
            No proposals found
          </p>
          <p style={{ fontSize: 14, color: COLORS.textMuted, marginTop: 8 }}>
            {search || source !== "ALL" || nteeFilter || funderTypeFilter || minAmount || maxAmount || yearFilter
              ? "Try a different search term or filter combination."
              : "The proposal corpus is empty — ingestion scripts populate this library on schedule."}
          </p>
        </div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
              gap: 16,
              opacity: loading ? 0.6 : 1,
              transition: "opacity 150ms",
            }}
          >
            {data.results.map((proposal) => (
              <ProposalCardView
                key={proposal.id}
                proposal={proposal}
                expanded={expandedIds.has(proposal.id)}
                onToggleExpand={() => toggleExpanded(proposal.id)}
              />
            ))}
          </div>

          {/* Pagination */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 24,
              padding: "12px 4px",
            }}
          >
            <span style={{ fontSize: 13, color: COLORS.textMuted }}>
              {data.total.toLocaleString()} proposal{data.total === 1 ? "" : "s"} · Page {data.page} of{" "}
              {data.totalPages}
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
        </>
      )}
    </div>
  );
}

function StatTile({
  icon: Icon,
  accent,
  label,
  value,
}: {
  icon: typeof FileText;
  accent: string;
  label: string;
  value: string;
}) {
  return (
    <div
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 12,
        padding: 16,
        display: "flex",
        alignItems: "center",
        gap: 12,
        borderLeft: `4px solid ${accent}`,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          background: `${accent}1A`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon size={18} color={accent} />
      </div>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 18, fontWeight: 700, color: COLORS.text, margin: 0, lineHeight: 1.2 }}>
          {value}
        </p>
        <p style={{ fontSize: 12, color: COLORS.textMuted, margin: 0 }}>{label}</p>
      </div>
    </div>
  );
}

function ProposalCardView({
  proposal,
  expanded,
  onToggleExpand,
}: {
  proposal: ProposalCard;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const sourceLabel = SOURCE_TABS.find((t) => t.key === proposal.source)?.label ?? proposal.source;
  const nteeLabel = NTEE_OPTIONS.find((o) => o.code === proposal.nteeCode)?.label ?? null;

  return (
    <div
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 12,
        padding: 20,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: COLORS.text, margin: 0, lineHeight: 1.35 }}>
          {truncate(proposal.title, 80)}
        </h3>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "3px 8px",
            borderRadius: 999,
            background: "#EFF6FF",
            color: COLORS.primary,
          }}
        >
          {proposal.funderName ?? "Unknown funder"}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "3px 8px",
            borderRadius: 999,
            background: COLORS.surfaceSunken,
            color: COLORS.textMuted,
          }}
        >
          {sourceLabel}
        </span>
        {proposal.nteeCode && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              fontSize: 11,
              fontWeight: 600,
              padding: "3px 8px",
              borderRadius: 999,
              background: "#F5F3FF",
              color: "#7C3AED",
            }}
            title={nteeLabel ?? undefined}
          >
            <Tag size={10} />
            {proposal.nteeCode}
          </span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
        <div>
          <p style={{ margin: 0, color: COLORS.textFaint, fontWeight: 600, textTransform: "uppercase", fontSize: 10 }}>
            Amount
          </p>
          <p style={{ margin: "2px 0 0", color: COLORS.green, fontWeight: 700 }}>
            {formatCurrency(proposal.awardAmount)}
          </p>
        </div>
        <div>
          <p style={{ margin: 0, color: COLORS.textFaint, fontWeight: 600, textTransform: "uppercase", fontSize: 10 }}>
            Fiscal year
          </p>
          <p style={{ margin: "2px 0 0", color: COLORS.text, fontWeight: 600 }}>
            {proposal.awardYear ?? "—"}
          </p>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: COLORS.textMuted }}>
        <Building2 size={13} color={COLORS.textFaint} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {proposal.organizationName ?? "Organization not recorded"}
        </span>
      </div>

      {proposal.successFactors.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {proposal.successFactors.slice(0, expanded ? undefined : 3).map((factor, i) => (
            <span
              key={i}
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                padding: "3px 7px",
                borderRadius: 999,
                background: COLORS.greenBg,
                color: COLORS.green,
              }}
            >
              {factor}
            </span>
          ))}
        </div>
      )}

      <p style={{ fontSize: 13, color: COLORS.textMuted, margin: 0, lineHeight: 1.5, fontStyle: "italic" }}>
        {expanded ? proposal.narrativeFull ?? proposal.abstract : truncate(proposal.abstract, 300)}
      </p>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
        {proposal.narrativeFull && proposal.narrativeFull.length > 300 && (
          <button
            type="button"
            onClick={onToggleExpand}
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: COLORS.primary,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            {expanded ? "Show less" : "View Full Narrative"}
          </button>
        )}

        {proposal.sourceUrl && (
          <a
            href={proposal.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              fontWeight: 600,
              color: COLORS.primary,
              textDecoration: "none",
            }}
          >
            View source <ExternalLink size={12} />
          </a>
        )}
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
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={selectStyle}
      />
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
        border: `1px solid ${COLORS.border}`,
        background: disabled ? COLORS.surfaceSunken : COLORS.surface,
        color: disabled ? COLORS.textFaint : COLORS.text,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {!iconTrailing && <Icon size={14} />}
      {label}
      {iconTrailing && <Icon size={14} />}
    </button>
  );
}
