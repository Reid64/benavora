"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Library } from "lucide-react";

import { Button, EmptyState, Input, LoadingSpinner, Select } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { FoundationCard } from "@/components/foundations/FoundationCard";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/hooks/useProfile";
import type { Tables } from "@/types/database";

type FoundationRow = Tables<"foundation_directory">;

const PAGE_SIZE = 50;

const US_STATES: { value: string; label: string }[] = [
  { value: "", label: "All States" },
  { value: "AL", label: "AL – Alabama" },
  { value: "AK", label: "AK – Alaska" },
  { value: "AZ", label: "AZ – Arizona" },
  { value: "AR", label: "AR – Arkansas" },
  { value: "CA", label: "CA – California" },
  { value: "CO", label: "CO – Colorado" },
  { value: "CT", label: "CT – Connecticut" },
  { value: "DE", label: "DE – Delaware" },
  { value: "DC", label: "DC – Washington D.C." },
  { value: "FL", label: "FL – Florida" },
  { value: "GA", label: "GA – Georgia" },
  { value: "HI", label: "HI – Hawaii" },
  { value: "ID", label: "ID – Idaho" },
  { value: "IL", label: "IL – Illinois" },
  { value: "IN", label: "IN – Indiana" },
  { value: "IA", label: "IA – Iowa" },
  { value: "KS", label: "KS – Kansas" },
  { value: "KY", label: "KY – Kentucky" },
  { value: "LA", label: "LA – Louisiana" },
  { value: "ME", label: "ME – Maine" },
  { value: "MD", label: "MD – Maryland" },
  { value: "MA", label: "MA – Massachusetts" },
  { value: "MI", label: "MI – Michigan" },
  { value: "MN", label: "MN – Minnesota" },
  { value: "MS", label: "MS – Mississippi" },
  { value: "MO", label: "MO – Missouri" },
  { value: "MT", label: "MT – Montana" },
  { value: "NE", label: "NE – Nebraska" },
  { value: "NV", label: "NV – Nevada" },
  { value: "NH", label: "NH – New Hampshire" },
  { value: "NJ", label: "NJ – New Jersey" },
  { value: "NM", label: "NM – New Mexico" },
  { value: "NY", label: "NY – New York" },
  { value: "NC", label: "NC – North Carolina" },
  { value: "ND", label: "ND – North Dakota" },
  { value: "OH", label: "OH – Ohio" },
  { value: "OK", label: "OK – Oklahoma" },
  { value: "OR", label: "OR – Oregon" },
  { value: "PA", label: "PA – Pennsylvania" },
  { value: "RI", label: "RI – Rhode Island" },
  { value: "SC", label: "SC – South Carolina" },
  { value: "SD", label: "SD – South Dakota" },
  { value: "TN", label: "TN – Tennessee" },
  { value: "TX", label: "TX – Texas" },
  { value: "UT", label: "UT – Utah" },
  { value: "VT", label: "VT – Vermont" },
  { value: "VA", label: "VA – Virginia" },
  { value: "WA", label: "WA – Washington" },
  { value: "WV", label: "WV – West Virginia" },
  { value: "WI", label: "WI – Wisconsin" },
  { value: "WY", label: "WY – Wyoming" },
  { value: "PR", label: "PR – Puerto Rico" },
  { value: "GU", label: "GU – Guam" },
  { value: "VI", label: "VI – Virgin Islands" },
  { value: "AS", label: "AS – American Samoa" },
  { value: "MP", label: "MP – N. Mariana Islands" },
];

const NTEE_CATEGORIES: { value: string; label: string }[] = [
  { value: "", label: "All NTEE Categories" },
  { value: "A", label: "A – Arts, Culture & Humanities" },
  { value: "B", label: "B – Education" },
  { value: "C", label: "C – Environment" },
  { value: "D", label: "D – Animal-Related" },
  { value: "E", label: "E – Health Care" },
  { value: "F", label: "F – Mental Health" },
  { value: "G", label: "G – Disease & Disorders" },
  { value: "H", label: "H – Medical Research" },
  { value: "I", label: "I – Crime & Legal" },
  { value: "J", label: "J – Employment" },
  { value: "K", label: "K – Food, Agriculture & Nutrition" },
  { value: "L", label: "L – Housing & Shelter" },
  { value: "M", label: "M – Public Safety" },
  { value: "N", label: "N – Recreation & Sports" },
  { value: "O", label: "O – Youth Development" },
  { value: "P", label: "P – Human Services" },
  { value: "Q", label: "Q – International" },
  { value: "R", label: "R – Civil Rights" },
  { value: "S", label: "S – Community Improvement" },
  { value: "T", label: "T – Philanthropy & Grantmaking" },
  { value: "U", label: "U – Science & Technology" },
  { value: "V", label: "V – Social Science" },
  { value: "W", label: "W – Public & Societal Benefit" },
  { value: "X", label: "X – Religion" },
  { value: "Y", label: "Y – Mutual & Membership Benefit" },
];

interface CoverageStats {
  total: number;
  enriched990: number;
  enrichedWeb: number;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-white px-5 py-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

export default function FoundationsPage() {
  const { profile } = useProfile();

  const [foundations, setFoundations] = useState<FoundationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [coverage, setCoverage] = useState<CoverageStats | null>(null);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [nteeFilter, setNteeFilter] = useState("");
  const [minRevenue, setMinRevenue] = useState("");
  const [minAssets, setMinAssets] = useState("");

  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [importingIds, setImportingIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkImporting, setBulkImporting] = useState(false);

  const [notification, setNotification] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
    };
  }, []);

  const showNotification = useCallback(
    (message: string, type: "success" | "error") => {
      setNotification({ message, type });
      if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
      notifTimerRef.current = setTimeout(() => setNotification(null), 3500);
    },
    [],
  );

  function handleSearchChange(value: string) {
    setSearch(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(1);
    }, 400);
  }

  // Cheap head-count-only queries — independent of the filtered/paginated
  // list below, so coverage stats always reflect the whole directory.
  useEffect(() => {
    let active = true;
    const supabase = createClient();

    (async () => {
      const [totalRes, enriched990Res, enrichedWebRes] = await Promise.all([
        supabase.from("foundation_directory").select("*", { count: "exact", head: true }),
        supabase
          .from("foundation_directory")
          .select("*", { count: "exact", head: true })
          .not("enriched_990_at", "is", null),
        supabase
          .from("foundation_directory")
          .select("*", { count: "exact", head: true })
          .not("enriched_web_at", "is", null),
      ]);

      if (!active) return;

      setCoverage({
        total: totalRes.count ?? 0,
        enriched990: enriched990Res.count ?? 0,
        enrichedWeb: enrichedWebRes.count ?? 0,
      });
    })();

    return () => {
      active = false;
    };
  }, []);

  // Fetch foundations from Supabase with server-side filtering and pagination
  useEffect(() => {
    let active = true;
    const supabase = createClient();

    (async () => {
      setLoading(true);
      setError(null);

      const from = (page - 1) * PAGE_SIZE;
      const to = page * PAGE_SIZE - 1;

      let q = supabase
        .from("foundation_directory")
        .select("*", { count: "exact" });

      const term = debouncedSearch.trim();
      if (term) {
        q = q.or(
          `name.ilike.%${term}%,city.ilike.%${term}%,state.ilike.%${term}%,ein.ilike.%${term}%`,
        );
      }

      if (stateFilter) {
        q = q.eq("state", stateFilter);
      }

      if (nteeFilter) {
        q = q.ilike("ntee_code", `${nteeFilter}%`);
      }

      const minRev = parseInt(minRevenue, 10);
      if (!isNaN(minRev)) {
        q = q.gte("revenue_amount", minRev);
      }

      const minAss = parseInt(minAssets, 10);
      if (!isNaN(minAss)) {
        q = q.gte("asset_amount", minAss);
      }

      const { data, error: fetchError, count } = await q
        .order("name", { ascending: true })
        .range(from, to);

      if (!active) return;

      if (fetchError) {
        setError("Could not load foundation directory.");
        setLoading(false);
        return;
      }

      setFoundations(data ?? []);
      setTotal(count ?? 0);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [debouncedSearch, stateFilter, nteeFilter, minRevenue, minAssets, page]);

  const importFoundation = useCallback(
    async (row: FoundationRow) => {
      const orgId = profile?.organization_id;
      if (!orgId) return;

      setImportingIds((prev) => new Set([...prev, row.id]));

      const supabase = createClient();
      const geoFocus = [row.city, row.state].filter(Boolean).join(", ") || null;

      const { error: insertError } = await supabase.from("funders").insert({
        organization_id: orgId,
        name: row.name,
        category: "private_foundation",
        geographic_focus: geoFocus,
        website: row.website ?? null,
        notes: row.ein ? `EIN: ${row.ein}` : null,
      });

      setImportingIds((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });

      if (insertError) {
        showNotification(`Failed to import ${row.name}.`, "error");
      } else {
        setImportedIds((prev) => new Set([...prev, row.id]));
        showNotification(`${row.name} imported as a funder.`, "success");
      }
    },
    [profile?.organization_id, showNotification],
  );

  const importSelected = useCallback(async () => {
    const orgId = profile?.organization_id;
    if (!orgId || selectedIds.size === 0) return;

    setBulkImporting(true);

    const toImport = foundations.filter(
      (f) => selectedIds.has(f.id) && !importedIds.has(f.id),
    );

    if (toImport.length === 0) {
      setBulkImporting(false);
      return;
    }

    const inserts = toImport.map((row) => ({
      organization_id: orgId,
      name: row.name,
      category: "private_foundation" as const,
      geographic_focus:
        [row.city, row.state].filter(Boolean).join(", ") || null,
      website: row.website ?? null,
      notes: row.ein ? `EIN: ${row.ein}` : null,
    }));

    const supabase = createClient();
    const { error: bulkError } = await supabase.from("funders").insert(inserts);

    setBulkImporting(false);

    if (bulkError) {
      showNotification("Some imports failed. Please try again.", "error");
    } else {
      setImportedIds((prev) => {
        const next = new Set(prev);
        toImport.forEach((f) => next.add(f.id));
        return next;
      });
      setSelectedIds(new Set());
      showNotification(
        `${inserts.length} foundation${inserts.length !== 1 ? "s" : ""} imported as funders.`,
        "success",
      );
    }
  }, [
    profile?.organization_id,
    selectedIds,
    foundations,
    importedIds,
    showNotification,
  ]);

  const allCurrentSelected =
    foundations.length > 0 && foundations.every((f) => selectedIds.has(f.id));

  function toggleAll() {
    if (allCurrentSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        foundations.forEach((f) => next.delete(f.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        foundations.forEach((f) => next.add(f.id));
        return next;
      });
    }
  }

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="min-h-screen space-y-6 bg-[#EEF2F7] p-6">
      <PageHeader
        title="Foundation Directory"
        description="Browse IRS 990 foundation data. Import foundations as funders to start tracking."
        actions={
          selectedIds.size > 0 && (
            <Button
              isLoading={bulkImporting}
              disabled={bulkImporting}
              onClick={importSelected}
            >
              Import Selected ({selectedIds.size})
            </Button>
          )
        }
      />

      {/* Enrichment coverage */}
      {coverage && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="Foundations" value={coverage.total.toLocaleString()} />
          <StatCard
            label="990 Enriched"
            value={coverage.enriched990.toLocaleString()}
            sub={`${coverage.total > 0 ? Math.round((coverage.enriched990 / coverage.total) * 100) : 0}% of ${coverage.total.toLocaleString()}`}
          />
          <StatCard
            label="Web Enriched"
            value={coverage.enrichedWeb.toLocaleString()}
            sub={`${coverage.total > 0 ? Math.round((coverage.enrichedWeb / coverage.total) * 100) : 0}% of ${coverage.total.toLocaleString()}`}
          />
        </div>
      )}

      {/* Filter bar */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="xl:col-span-2">
          <input
            type="search"
            placeholder="Search name, city, state, EIN…"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            aria-label="Search foundations"
            className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:border-[#0077B6] focus:ring-2 focus:ring-[#0077B6]/10 outline-none"
          />
        </div>
        <Select
          value={stateFilter}
          onChange={(e) => {
            setStateFilter(e.target.value);
            setPage(1);
          }}
          options={US_STATES}
        />
        <Select
          value={nteeFilter}
          onChange={(e) => {
            setNteeFilter(e.target.value);
            setPage(1);
          }}
          options={NTEE_CATEGORIES}
        />
        <Input
          placeholder="Min revenue ($)"
          type="number"
          min={0}
          value={minRevenue}
          onChange={(e) => {
            setMinRevenue(e.target.value);
            setPage(1);
          }}
        />
        <Input
          placeholder="Min assets ($)"
          type="number"
          min={0}
          value={minAssets}
          onChange={(e) => {
            setMinAssets(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {/* Result count + select all */}
      {!loading && !error && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-navy-500">
            {total.toLocaleString()} foundation{total !== 1 ? "s" : ""} found
            {selectedIds.size > 0 && (
              <span className="ml-2 font-medium text-teal-600">
                · {selectedIds.size} selected
              </span>
            )}
          </p>
          {foundations.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-navy-600">
              <input
                type="checkbox"
                checked={allCurrentSelected}
                onChange={toggleAll}
                aria-label="Select all on this page"
                className="h-4 w-4 rounded border-navy-300 text-[#0077B6] accent-[#0077B6] focus:ring-[#0077B6]"
              />
              Select all on this page
            </label>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* Empty state when no data yet and not loading */}
      {!loading && !error && foundations.length === 0 ? (
        <EmptyState
          icon={Library}
          title="No foundations found"
          description="Try adjusting your search or filters."
        />
      ) : loading && foundations.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-xl border border-slate-200 bg-slate-50"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {foundations.map((foundation) => (
            <FoundationCard
              key={foundation.id}
              foundation={foundation}
              isImported={importedIds.has(foundation.id)}
              isImporting={importingIds.has(foundation.id)}
              isSelected={selectedIds.has(foundation.id)}
              canImport={Boolean(profile?.organization_id)}
              onToggleSelect={() => toggleRow(foundation.id)}
              onImport={() => importFoundation(foundation)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-navy-500">
            Showing{" "}
            <span className="font-medium text-navy-700">
              {((page - 1) * PAGE_SIZE + 1).toLocaleString()}
            </span>
            {" – "}
            <span className="font-medium text-navy-700">
              {Math.min(page * PAGE_SIZE, total).toLocaleString()}
            </span>{" "}
            of{" "}
            <span className="font-medium text-navy-700">
              {total.toLocaleString()}
            </span>
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Previous
            </Button>
            <span className="text-sm text-navy-500">
              Page {page} of {totalPages.toLocaleString()}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Loading indicator when paginating */}
      {loading && foundations.length > 0 && (
        <div className="flex justify-center py-4">
          <LoadingSpinner label="Loading…" />
        </div>
      )}

      {/* Toast notification */}
      {notification && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
            notification.type === "success"
              ? "bg-teal-600 text-white"
              : "bg-red-600 text-white"
          }`}
        >
          {notification.message}
        </div>
      )}
    </div>
  );
}
