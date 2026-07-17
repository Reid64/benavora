"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Database,
  ExternalLink,
  FileText,
  Search,
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
  title: string | null;
  awardAmount: number | null;
  awardYear: number | null;
  organizationName: string | null;
  abstract: string | null;
  createdAt: string;
}

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
  }, [source, search, page]);

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
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: COLORS.text, margin: 0 }}>
          Intelligence Library
        </h1>
        <p style={{ fontSize: 14, color: COLORS.textMuted, marginTop: 4 }}>
          Funded proposals sourced from NIH, NSF, Federal Register NOFAs, and USASpending — reference
          material for the AI draft generator.
        </p>
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
            {search || source !== "ALL"
              ? "Try a different search term or source filter."
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
              <ProposalCardView key={proposal.id} proposal={proposal} />
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

function ProposalCardView({ proposal }: { proposal: ProposalCard }) {
  const sourceLabel = SOURCE_TABS.find((t) => t.key === proposal.source)?.label ?? proposal.source;

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

      <p style={{ fontSize: 13, color: COLORS.textMuted, margin: 0, lineHeight: 1.5 }}>
        {truncate(proposal.abstract, 150)}
      </p>

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
            marginTop: 4,
          }}
        >
          View source <ExternalLink size={12} />
        </a>
      )}
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
