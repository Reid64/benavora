import type { CSSProperties } from "react";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";

// Directory reads span the full 501(c)(3) BMF import (~2M rows) with no
// per-organization scoping — never cache (same posture as dashboard/page.tsx).
export const dynamic = "force-dynamic";

const PER_PAGE = 50;

// Hardcoded rather than `select('state').not(...)` distinct-scan: nonprofits
// has ~2M rows and no index covering state alone for a DISTINCT-style query —
// a live test of the naive select returned the full ~2M-row column client-side.
// Fixed 50-state + DC list is exact for this dataset (IRS BMF is US-only) and
// costs nothing.
const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM",
  "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
  "WV", "WI", "WY",
];

// `nonprofits` (migration 098, IRS BMF import) has no generated type in
// src/types/database.ts — see benavora-database-ts-stale-migration-080 memory,
// same pattern: real live columns ahead of the generated types.
type NonprofitRow = {
  id: string;
  ein: string;
  name: string;
  city: string | null;
  state: string | null;
  ntee_code: string | null;
  revenue_amount: number | null;
  website: string | null;
  officer_name: string | null;
};

type NonprofitsPageProps = {
  searchParams?: {
    search?: string;
    state?: string;
    page?: string;
  };
};

function formatRevenue(amount: number | null): string {
  if (amount == null) return "—";
  if (Math.abs(amount) >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(amount).toLocaleString()}`;
}

const TABLE_GRID_COLUMNS = "2fr 1fr 1fr 0.8fr 1fr 1fr 1.5fr";

const SECTION_ACCENT = "#A4712C";

const chipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  backgroundColor: "rgba(164,113,44,0.12)",
  border: "1px solid rgba(164,113,44,0.4)",
  borderRadius: "8px",
  padding: "6px 14px",
  fontSize: "12px",
  color: "#2C4E3B",
  fontWeight: 600,
  marginRight: "8px",
};

const chipValueStyle: CSSProperties = {
  color: "#A4712C",
  fontWeight: 800,
};

const headerLabelStyle: CSSProperties = {
  fontSize: "10px",
  fontWeight: 700,
  color: "#64748B",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

export default async function NonprofitsPage({ searchParams }: NonprofitsPageProps) {
  const supabase = createClient();

  const searchParam = searchParams?.search ?? "";
  const stateParam = searchParams?.state ?? "";
  const pageParam = Math.max(1, Number(searchParams?.page ?? 1) || 1);
  const offset = (pageParam - 1) * PER_PAGE;
  const hasFilter = Boolean(searchParam || stateParam);

  let query = supabase
    .from("nonprofits")
    .select("id,ein,name,city,state,ntee_code,revenue_amount,website,officer_name", { count: "estimated" });

  if (searchParam) query = query.ilike("name", `%${searchParam}%`);
  if (stateParam) query = query.eq("state", stateParam);

  // Sorting the full ~2M-row table by revenue_amount (no index on that
  // column) times out server-side — verified live: 8.5s then
  // "canceling statement due to statement timeout". Only sort by
  // revenue_amount once a filter has narrowed the row count; the unfiltered
  // default view sorts by id (primary key, always indexed, fast).
  query = hasFilter
    ? query.order("revenue_amount", { ascending: false, nullsFirst: false })
    : query.order("id", { ascending: true });

  query = query.range(offset, offset + PER_PAGE - 1);

  const [
    { data: rows, count: filteredCount },
    { count: totalCount },
    { count: withWebsite },
    { count: withMission },
    { count: withOfficer },
  ] = await Promise.all([
    query,
    // `count: 'exact'` times out on this table (verified live: 57014
    // "canceling statement due to statement timeout" on an unfiltered COUNT(*)
    // over ~2M rows) — 'estimated' uses the planner's row estimate instead.
    supabase.from("nonprofits").select("*", { count: "estimated", head: true }),
    supabase.from("nonprofits").select("*", { count: "estimated", head: true }).not("website", "is", null),
    supabase.from("nonprofits").select("*", { count: "estimated", head: true }).not("mission", "is", null),
    supabase.from("nonprofits").select("*", { count: "estimated", head: true }).not("officer_name", "is", null),
  ]);

  const nonprofits = (rows ?? []) as NonprofitRow[];
  const resultCount = filteredCount ?? nonprofits.length;
  const totalPages = Math.max(1, Math.ceil(resultCount / PER_PAGE));

  function pageHref(targetPage: number): string {
    const usp = new URLSearchParams();
    if (searchParam) usp.set("search", searchParam);
    if (stateParam) usp.set("state", stateParam);
    if (targetPage > 1) usp.set("page", String(targetPage));
    const qs = usp.toString();
    return qs ? `/nonprofits?${qs}` : "/nonprofits";
  }

  return (
    <div style={{ backgroundColor: "#F0EBE0", minHeight: "100vh", padding: "24px", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
      {/* Header */}
      <div
        style={{
          backgroundColor: "#F8F5EE",
          borderRadius: "14px",
          boxShadow: "0 4px 20px rgba(164,113,44,0.22)",
          border: "1px solid rgba(44,78,59,0.12)",
          borderLeft: `4px solid ${SECTION_ACCENT}`,
          padding: "20px 24px",
          marginBottom: "16px",
        }}
      >
        <div style={{ fontSize: "22px", fontWeight: 900, color: "#2C4E3B", letterSpacing: "-0.02em" }}>
          Nonprofit Directory
        </div>
        <div style={{ fontSize: "13px", color: "rgba(44,78,59,0.6)", marginTop: "4px" }}>
          {(totalCount ?? 0).toLocaleString()} 501(c)(3) organizations on file
        </div>

        {/* Stats bar */}
        <div style={{ marginTop: "14px" }}>
          <span style={chipStyle}>Total: <span style={chipValueStyle}>{(totalCount ?? 0).toLocaleString()}</span></span>
          <span style={chipStyle}>With Website: <span style={chipValueStyle}>{(withWebsite ?? 0).toLocaleString()}</span></span>
          <span style={chipStyle}>With Mission: <span style={chipValueStyle}>{(withMission ?? 0).toLocaleString()}</span></span>
          <span style={chipStyle}>With Officer: <span style={chipValueStyle}>{(withOfficer ?? 0).toLocaleString()}</span></span>
        </div>

        {/* Search + filter row */}
        <form method="GET" style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "16px", flexWrap: "wrap" }}>
          <input
            type="text"
            name="search"
            defaultValue={searchParam}
            placeholder="Search by name..."
            style={{
              padding: "10px 16px",
              borderRadius: "10px",
              border: "1px solid rgba(44,78,59,0.15)",
              backgroundColor: "rgba(44,78,59,0.06)",
              color: "#2C4E3B",
              fontSize: "14px",
              width: "320px",
              outline: "none",
            }}
          />
          <select
            name="state"
            defaultValue={stateParam}
            style={{
              padding: "10px 14px",
              borderRadius: "10px",
              border: "1px solid rgba(44,78,59,0.15)",
              backgroundColor: "#F8F5EE",
              color: "#2C4E3B",
              fontSize: "13px",
            }}
          >
            <option value="">All States</option>
            {US_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            type="submit"
            style={{
              backgroundColor: "#A4712C",
              color: "#F8F5EE",
              border: "none",
              borderRadius: "10px",
              padding: "10px 20px",
              fontSize: "13px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Search
          </button>
          {hasFilter && (
            <Link href="/nonprofits" style={{ fontSize: "13px", color: "rgba(44,78,59,0.5)", textDecoration: "underline" }}>
              Clear
            </Link>
          )}
        </form>
      </div>

      {/* Results table */}
      <div style={{ backgroundColor: "#F8F5EE", borderRadius: "14px", boxShadow: "0 4px 20px rgba(164,113,44,0.22)", border: "1px solid rgba(44,78,59,0.12)", overflow: "hidden" }}>
        <div
          style={{
            backgroundColor: "rgba(164,113,44,0.10)",
            borderBottom: `2px solid ${SECTION_ACCENT}`,
            padding: "12px 20px",
            display: "grid",
            gridTemplateColumns: TABLE_GRID_COLUMNS,
          }}
        >
          <span style={headerLabelStyle}>Name</span>
          <span style={headerLabelStyle}>EIN</span>
          <span style={headerLabelStyle}>City/State</span>
          <span style={headerLabelStyle}>NTEE</span>
          <span style={headerLabelStyle}>Revenue</span>
          <span style={headerLabelStyle}>Website</span>
          <span style={headerLabelStyle}>Officer</span>
        </div>

        {nonprofits.length === 0 ? (
          <div style={{ padding: "40px", textAlign: "center", fontSize: "13px", color: "rgba(44,78,59,0.5)" }}>
            No nonprofits match your filters.
          </div>
        ) : (
          nonprofits.map((row, i) => (
            <div
              key={row.id}
              style={{
                backgroundColor: i % 2 === 0 ? "transparent" : "rgba(44,78,59,0.02)",
                padding: "12px 20px",
                display: "grid",
                gridTemplateColumns: TABLE_GRID_COLUMNS,
                alignItems: "center",
                borderBottom: "1px solid rgba(44,78,59,0.04)",
              }}
            >
              <span style={{ fontSize: "13px", fontWeight: 700, color: "#2C4E3B" }}>{row.name}</span>
              <span style={{ fontSize: "12px", color: "rgba(44,78,59,0.5)", fontFamily: "monospace" }}>{row.ein}</span>
              <span style={{ fontSize: "12px", color: "rgba(44,78,59,0.7)" }}>
                {row.city && row.state ? `${row.city}, ${row.state}` : (row.city ?? row.state ?? "—")}
              </span>
              <span style={{ fontSize: "11px", color: "rgba(44,78,59,0.5)" }}>{row.ntee_code ?? "—"}</span>
              <span style={{ fontSize: "12px", color: "#2C4E3B", fontWeight: 600 }}>{formatRevenue(row.revenue_amount)}</span>
              {row.website ? (
                <a
                  href={row.website.startsWith("http") ? row.website : `https://${row.website}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#4F6D8F", fontSize: "12px", textDecoration: "none" }}
                >
                  {row.website}
                </a>
              ) : (
                <span style={{ fontSize: "12px", color: "rgba(44,78,59,0.5)" }}>—</span>
              )}
              <span style={{ fontSize: "12px", color: "rgba(44,78,59,0.7)" }}>{row.officer_name ?? "—"}</span>
            </div>
          ))
        )}

        {/* Pagination */}
        <div
          style={{
            padding: "14px 20px",
            borderTop: "1px solid rgba(44,78,59,0.08)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          {pageParam > 1 ? (
            <Link href={pageHref(pageParam - 1)} style={{ fontSize: "13px", fontWeight: 700, color: "#4F6D8F", textDecoration: "none" }}>
              ← Previous
            </Link>
          ) : (
            <span style={{ fontSize: "13px", color: "rgba(44,78,59,0.3)" }}>← Previous</span>
          )}
          <span style={{ fontSize: "12px", color: "rgba(44,78,59,0.6)" }}>
            Page {pageParam} of {totalPages.toLocaleString()} — {resultCount.toLocaleString()} results
          </span>
          {pageParam < totalPages ? (
            <Link href={pageHref(pageParam + 1)} style={{ fontSize: "13px", fontWeight: 700, color: "#4F6D8F", textDecoration: "none" }}>
              Next →
            </Link>
          ) : (
            <span style={{ fontSize: "13px", color: "rgba(44,78,59,0.3)" }}>Next →</span>
          )}
        </div>
      </div>
    </div>
  );
}
