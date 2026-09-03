"use client";

// Corporate Marketplace (FEATURE_REGISTRY_v2.md row #97) — browse/filter surface
// over the shared corporate_prospects pool, backed by
// GET /api/intelligence/corporate-prospects. Distinct from the Outreach
// composer's prospect selector (/donor-discovery/outreach): this page is for
// discovery/filtering, not campaign composition — results link out to the
// real Corporate Giving DNA profile page and to Outreach with the prospect
// pre-selected via ?prospectId=, rather than duplicating the "select and
// queue an email" UI here.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  ChevronLeft,
  ChevronRight,
  Mail,
  Sparkles,
} from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Badge, Button, Card, EmptyState, Input, LoadingSpinner, Select } from "@/components/ui";
import { useUrlState } from "@/lib/hooks/useUrlState";
import { formatRelative } from "@/lib/utils/formatters";

interface MarketplaceProspect {
  id: string;
  legalName: string;
  dbaName: string | null;
  displayName: string;
  website: string | null;
  city: string | null;
  state: string | null;
  industry: string | null;
  employeeCountEstimate: string | null;
  revenueEstimate: string | null;
  ownership: {
    familyOwned: boolean;
    veteranOwned: boolean;
    minorityOwned: boolean;
    womanOwned: boolean;
  };
  overallScore: number | null;
  isPriorityProspect: boolean;
  scoresComputedAt: string | null;
  lastVerifiedAt: string | null;
}

interface MarketplaceResponse {
  prospects: MarketplaceProspect[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  industries: string[];
}

const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 350;

const SORT_OPTIONS = [
  { value: "name", label: "Company name (A–Z)" },
  { value: "score", label: "Highest propensity score" },
  { value: "recent", label: "Recently added" },
];

const OWNERSHIP_FILTERS: { key: "familyOwned" | "veteranOwned" | "minorityOwned" | "womanOwned"; label: string }[] = [
  { key: "familyOwned", label: "Family owned" },
  { key: "veteranOwned", label: "Veteran owned" },
  { key: "minorityOwned", label: "Minority owned" },
  { key: "womanOwned", label: "Woman owned" },
];

function scoreBadgeStyle(score: number | null): { backgroundColor: string; color: string } {
  if (score == null) return { backgroundColor: "#F1F5F9", color: "#64748B" };
  if (score >= 60) return { backgroundColor: "#DCFCE7", color: "#15803D" };
  if (score >= 30) return { backgroundColor: "#FEF3C7", color: "#92400E" };
  return { backgroundColor: "#FEE2E2", color: "#B91C1C" };
}

export default function CorporateMarketplacePage() {
  const { searchParams, setParams } = useUrlState();

  const [searchInput, setSearchInput] = useState(searchParams.get("q") ?? "");

  const q = searchParams.get("q") ?? "";
  const industry = searchParams.get("industry") ?? "";
  const sort = searchParams.get("sort") ?? "name";
  const hasScore = searchParams.get("hasScore") ?? "";
  const employeeContains = searchParams.get("employeeContains") ?? "";
  const revenueContains = searchParams.get("revenueContains") ?? "";
  const page = Number(searchParams.get("page") ?? "0") || 0;

  const [data, setData] = useState<MarketplaceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput.trim() !== q) {
        setParams({ q: searchInput.trim() || null, page: null });
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        pageSize: String(PAGE_SIZE),
        page: String(page),
        sort,
      });
      if (q) qs.set("q", q);
      if (industry) qs.set("industry", industry);
      if (hasScore) qs.set("hasScore", hasScore);
      if (employeeContains) qs.set("employeeContains", employeeContains);
      if (revenueContains) qs.set("revenueContains", revenueContains);
      for (const { key } of OWNERSHIP_FILTERS) {
        const v = searchParams.get(key);
        if (v) qs.set(key, v);
      }

      const res = await fetch(`/api/intelligence/corporate-prospects?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) {
        setError("Could not load the corporate prospect pool.");
        setData(null);
      } else {
        setData((await res.json()) as MarketplaceResponse);
      }
    } catch {
      setError("Could not reach the server.");
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, industry, sort, hasScore, employeeContains, revenueContains, page, searchParams]);

  useEffect(() => {
    void load();
  }, [load]);

  const ownershipActive = (key: string) => searchParams.get(key) === "true";
  function toggleOwnership(key: string) {
    setParams({ [key]: ownershipActive(key) ? null : "true", page: null });
  }

  const prospects = data?.prospects ?? [];
  const total = data?.total ?? 0;
  const industries = data?.industries ?? [];
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <div className="space-y-6">
      <Link
        href="/donor-discovery"
        className="inline-flex items-center gap-1.5 text-sm text-navy-500 transition hover:text-navy-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to Donor Discovery
      </Link>

      <PageHeader
        title="Corporate Marketplace"
        description="Search and filter the shared corporate prospect pool."
      />

      <Card title="Filters">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            aria-label="Search company name"
            placeholder="Search company name..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <Select
            aria-label="Industry"
            placeholder="All industries"
            options={industries.map((i) => ({ value: i, label: i }))}
            value={industry}
            onChange={(e) => setParams({ industry: e.target.value || null, page: null })}
          />
          <Select
            aria-label="Propensity score"
            options={[
              { value: "", label: "Any propensity status" },
              { value: "true", label: "Has a propensity score" },
              { value: "false", label: "Not yet scored" },
            ]}
            value={hasScore}
            onChange={(e) => setParams({ hasScore: e.target.value || null, page: null })}
          />
          <Select
            aria-label="Sort by"
            options={SORT_OPTIONS}
            value={sort}
            onChange={(e) => setParams({ sort: e.target.value === "name" ? null : e.target.value, page: null })}
          />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Input
              aria-label="Employee count contains"
              placeholder="Employee count contains..."
              value={employeeContains}
              onChange={(e) => setParams({ employeeContains: e.target.value || null, page: null })}
            />
            <p className="mt-1 text-xs text-slate-400">
              No prospect currently has this field populated — this filter will match nothing until an
              enrichment agent fills it in.
            </p>
          </div>
          <div>
            <Input
              aria-label="Revenue estimate contains"
              placeholder="Revenue estimate contains..."
              value={revenueContains}
              onChange={(e) => setParams({ revenueContains: e.target.value || null, page: null })}
            />
            <p className="mt-1 text-xs text-slate-400">
              Same as employee count — stored as free text, currently empty on every prospect.
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {OWNERSHIP_FILTERS.map(({ key, label }) => {
            const active = ownershipActive(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleOwnership(key)}
                className="rounded-full border px-3 py-1 text-xs font-medium transition"
                style={
                  active
                    ? { backgroundColor: "#3D6B50", borderColor: "#3D6B50", color: "#FFFFFF" }
                    : { backgroundColor: "#FFFFFF", borderColor: "#E2E8F0", color: "#64748B" }
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      </Card>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <LoadingSpinner center label="Loading prospects…" />
      ) : prospects.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No prospects match these filters"
          description="Try broadening your search, or run Donor Discovery to grow the corporate prospect pool."
        />
      ) : (
        <>
          <p className="text-xs text-slate-500">
            Showing {from}–{to} of {total} prospect{total === 1 ? "" : "s"}
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {prospects.map((p) => {
              const badge = scoreBadgeStyle(p.overallScore);
              return (
                <div
                  key={p.id}
                  className="flex flex-col rounded-xl p-4"
                  style={{ backgroundColor: "#FFFFFF", border: "1px solid #E2E8F0", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-sm font-semibold text-navy-900" title={p.displayName}>
                      {p.displayName}
                    </p>
                    {p.isPriorityProspect && (
                      <span title="Priority prospect">
                        <Sparkles className="h-4 w-4 shrink-0" style={{ color: "#F59E0B" }} aria-hidden />
                      </span>
                    )}
                  </div>

                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {p.industry && (
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{ backgroundColor: "#3D6B501A", color: "#3D6B50" }}
                      >
                        {p.industry}
                      </span>
                    )}
                    <span
                      className="rounded-full px-2 py-0.5 text-xs font-bold"
                      style={badge}
                      title={p.overallScore != null ? "Overall propensity score (PS-01)" : "Not yet scored"}
                    >
                      {p.overallScore != null ? p.overallScore : "Not scored"}
                    </span>
                  </div>

                  <p className="mt-1.5 text-xs text-slate-500">
                    {[p.city, p.state].filter(Boolean).join(", ") || "Location unknown"}
                  </p>

                  {(p.ownership.familyOwned || p.ownership.veteranOwned || p.ownership.minorityOwned || p.ownership.womanOwned) && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {p.ownership.familyOwned && <Badge color="teal">Family owned</Badge>}
                      {p.ownership.veteranOwned && <Badge color="teal">Veteran owned</Badge>}
                      {p.ownership.minorityOwned && <Badge color="teal">Minority owned</Badge>}
                      {p.ownership.womanOwned && <Badge color="teal">Woman owned</Badge>}
                    </div>
                  )}

                  <p className="mt-2 text-xs text-slate-400">
                    {p.lastVerifiedAt ? `Last verified ${formatRelative(p.lastVerifiedAt)}` : "Never verified"}
                  </p>

                  <div className="mt-3 flex items-center gap-2 border-t pt-3" style={{ borderColor: "#F1F5F9" }}>
                    <Link
                      href={`/donor-discovery/outreach/prospects/${p.id}`}
                      className="flex-1 rounded-lg border px-3 py-1.5 text-center text-xs font-medium transition hover:bg-slate-50"
                      style={{ borderColor: "#E2E8F0", color: "#3D6B50" }}
                    >
                      View Giving DNA
                    </Link>
                    <Link
                      href={`/donor-discovery/outreach?prospectId=${p.id}`}
                      className="flex flex-1 items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90"
                      style={{ backgroundColor: "#8B5CF6" }}
                    >
                      <Mail className="h-3 w-3" aria-hidden />
                      Add to Outreach
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={page <= 0}
              onClick={() => setParams({ page: String(page - 1) })}
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              Previous
            </Button>
            <p className="text-xs text-slate-500">
              Page {page + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!data?.hasMore}
              onClick={() => setParams({ page: String(page + 1) })}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
