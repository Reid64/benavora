"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CheckCircle,
  ChevronDown,
  MapPin,
  Search,
  Send,
  Sparkles,
  Telescope,
} from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button, EmptyState, Input, Select, Table } from "@/components/ui";
import type { TableColumn } from "@/components/ui";
import { useUrlState } from "@/lib/hooks/useUrlState";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { createClient } from "@/lib/supabase/client";
import { humanizeEnum } from "@/lib/utils/formatters";

type DdPipelineStage =
  | "new"
  | "reviewing"
  | "contacted"
  | "applied"
  | "received"
  | "rejected"
  | "archived";

const PIPELINE_STAGES: DdPipelineStage[] = [
  "new",
  "reviewing",
  "contacted",
  "applied",
  "received",
  "rejected",
  "archived",
];

// Elevated Slate stage palette — light tint background derived from the same
// hex at render time (see ColorBadge), never a raw Tailwind hue class.
const STAGE_COLORS: Record<DdPipelineStage, string> = {
  new: "#64748B",
  reviewing: "#0EA5E9",
  contacted: "#0077B6",
  applied: "#F59E0B",
  received: "#10B981",
  rejected: "#EF4444",
  archived: "#94A3B8",
};

// Prospects actively past initial contact — backs the "Contacted" stat card.
const ENGAGED_STAGES: DdPipelineStage[] = ["contacted", "applied", "received"];

interface TaxonomyNode {
  id: string;
  kind: string;
  code: string;
  label: string;
  parent_id: string | null;
}

interface DdRequestOption {
  id: string;
  name: string;
}

interface DdDirectory {
  id: string;
  legal_name: string;
  dba_name: string | null;
  naics_codes: string[] | null;
  civic_kind: string | null;
  website: string | null;
  hq_address: string | null;
}

interface DdProspectRow {
  id: string;
  score: number | null;
  score_rationale: string | null;
  pipeline_stage: DdPipelineStage;
  directory: DdDirectory | null;
}

const TAXONOMY_PAGE = 1000;

/** Fetches every row of the shared, no-RLS taxonomy table (paginated — the
 * NAICS branch alone is ~1,400 rows, well past PostgREST's default page cap). */
async function fetchAllTaxonomy(): Promise<TaxonomyNode[]> {
  const supabase = createClient();
  const rows: TaxonomyNode[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("donor_discovery_taxonomy")
      .select("id, kind, code, label, parent_id")
      .order("label", { ascending: true })
      .range(from, from + TAXONOMY_PAGE - 1);
    if (error || !data) break;
    rows.push(...(data as TaxonomyNode[]));
    if (data.length < TAXONOMY_PAGE) break;
    from += TAXONOMY_PAGE;
  }
  return rows;
}

function ancestryLabel(node: TaxonomyNode, byId: Map<string, TaxonomyNode>): string {
  const path: string[] = [node.label];
  let cur = node;
  while (cur.parent_id) {
    const parent = byId.get(cur.parent_id);
    if (!parent) break;
    path.unshift(parent.label);
    cur = parent;
  }
  return path.join(" › ");
}

function scoreBadgeClass(score: number | null): string {
  const shape = "px-2 py-0.5 rounded-full text-sm font-bold";
  if (score == null) return `${shape} bg-slate-100 text-slate-500`;
  if (score > 70) return `${shape} bg-[#DCFCE7] text-[#15803D]`;
  if (score >= 40) return `${shape} bg-[#FEF3C7] text-[#92400E]`;
  return `${shape} bg-[#FEE2E2] text-[#B91C1C]`;
}

// Industry badge coloring — a best-effort keyword heuristic over the real
// taxonomy label (donor_discovery_directory has no dedicated "industry"
// column), not a fabricated classification. Anything unmatched falls back to
// DEFAULT_INDUSTRY_COLOR rather than guessing.
const INDUSTRY_COLOR_RULES: Array<{ test: RegExp; hex: string }> = [
  { test: /tech|software|computer|internet|telecom|it services|data/i, hex: "#0EA5E9" },
  { test: /retail|store|shop|apparel|grocery|dealer|merchandis/i, hex: "#8B5CF6" },
  { test: /health|medical|hospital|pharma|clinic|dental|care/i, hex: "#10B981" },
  { test: /financ|bank|insurance|invest|credit/i, hex: "#F59E0B" },
  { test: /manufactur|industrial|construction|contractor|factory|plumbing|electrical|roofing|building material/i, hex: "#6B7280" },
];
const DEFAULT_INDUSTRY_COLOR = "#64748B";

function industryColorFor(label: string): string {
  return INDUSTRY_COLOR_RULES.find((rule) => rule.test.test(label))?.hex ?? DEFAULT_INDUSTRY_COLOR;
}

/** Light-tint pill in an arbitrary hex — used where the color is computed
 * from data (industry keyword match, pipeline stage) and can't be a static
 * Tailwind class. Mirrors the tint-bg/solid-text/mid-border shape of the
 * shared Badge component. */
function ColorBadge({ label, hex, title }: { label: string; hex: string; title?: string }) {
  return (
    <span
      title={title}
      style={{ backgroundColor: `${hex}1A`, color: hex, borderColor: `${hex}40` }}
      className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"
    >
      {label}
    </span>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof Building2;
  label: string;
  value: React.ReactNode;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span
          style={{ backgroundColor: `${accent}1A`, color: accent }}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
        >
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <div className="mt-0.5 text-xl font-bold text-navy-900">{value}</div>
        </div>
      </div>
    </div>
  );
}

// Donor Discovery & Outreach section signature accent — see
// governance/DESIGN_SYSTEM.md "Section Accent Colors" and
// src/lib/design/section-accents.ts.
const SECTION_ACCENT = "#4C51C6";

const FETCH_LIMIT = 100;

type ComboboxOption = { value: string; label: string };

/**
 * Filterable taxonomy picker. `options[0]` is treated as the always-visible
 * "clear" option (e.g. "All taxonomies") and is exempt from the text filter
 * so it's always reachable.
 */
function TaxonomyCombobox({
  options,
  value,
  onChange,
}: {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const clearOption = options[0];
  const selectableOptions = options.slice(1);
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery
    ? selectableOptions.filter((o) => o.label.toLowerCase().includes(normalizedQuery))
    : selectableOptions;

  const selectedLabel = options.find((o) => o.value === value)?.label ?? clearOption?.label ?? "";

  return (
    <div className="relative w-full" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Filter by industry"
        className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white py-2 pl-3 pr-3 text-left text-sm text-slate-700 shadow-sm transition focus:outline-none focus:ring-2"
        style={{ borderColor: open ? "#0077B6" : undefined }}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="relative border-b border-slate-200 p-2">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search industries..."
              aria-label="Search industries"
              className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-1"
            />
          </div>
          <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
            {clearOption && (
              <li role="option" aria-selected={value === clearOption.value}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(clearOption.value);
                    setOpen(false);
                  }}
                  style={
                    value === clearOption.value
                      ? { backgroundColor: "#E0F2FE", color: "#0369A1" }
                      : undefined
                  }
                  className="block w-full px-3 py-1.5 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  {clearOption.label}
                </button>
              </li>
            )}
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-slate-400">No matches</li>
            ) : (
              filtered.map((o) => (
                <li key={o.value} role="option" aria-selected={value === o.value}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    title={o.label}
                    style={
                      value === o.value ? { backgroundColor: "#E0F2FE", color: "#0369A1" } : undefined
                    }
                    className="block w-full truncate px-3 py-1.5 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                  >
                    {o.label}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function DonorDiscoveryProspectsPage() {
  const router = useRouter();
  const { profile } = useProfile();
  const { searchParams, setParams } = useUrlState();

  const [nodes, setNodes] = useState<TaxonomyNode[]>([]);
  const [requestOptions, setRequestOptions] = useState<DdRequestOption[]>([]);
  const [prospects, setProspects] = useState<DdProspectRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [targetStage, setTargetStage] = useState<DdPipelineStage>("reviewing");
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [outreachLoadingId, setOutreachLoadingId] = useState<string | null>(null);

  // Client-side refinements over the currently loaded (server-filtered) page
  // — no dedicated search/location column exists on donor_discovery_directory
  // to filter server-side, so these narrow what's already on screen.
  const [searchQuery, setSearchQuery] = useState("");
  const [locationQuery, setLocationQuery] = useState("");

  const taxonomyId = searchParams.get("taxonomy_id") ?? "";
  const requestId = searchParams.get("request_id") ?? "";
  const stage = (searchParams.get("stage") ?? "") as DdPipelineStage | "";
  const minScoreParam = searchParams.get("min_score") ?? "";

  // Local, debounced copy of the min-score filter so every keystroke doesn't
  // trigger a server round-trip (SearchBar debounces the same way internally).
  const [minScoreInput, setMinScoreInput] = useState(minScoreParam);
  useEffect(() => setMinScoreInput(minScoreParam), [minScoreParam]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (minScoreInput !== minScoreParam) {
        setParams({ min_score: minScoreInput || null });
      }
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minScoreInput]);

  // Taxonomy + request filter options load once.
  useEffect(() => {
    let active = true;
    (async () => {
      const [taxonomyRows, requestsRes] = await Promise.all([
        fetchAllTaxonomy(),
        fetch("/api/donor-discovery/requests", { cache: "no-store" }),
      ]);
      if (!active) return;
      setNodes(taxonomyRows);
      if (requestsRes.ok) {
        const payload = (await requestsRes.json()) as { requests: DdRequestOption[] };
        setRequestOptions(payload.requests ?? []);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ limit: String(FETCH_LIMIT) });
    if (taxonomyId) qs.set("taxonomy_id", taxonomyId);
    if (requestId) qs.set("request_id", requestId);
    if (stage) qs.set("stage", stage);
    if (minScoreParam) qs.set("min_score", minScoreParam);

    try {
      const res = await fetch(`/api/donor-discovery/prospects?${qs.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setError("Could not load prospects.");
        setProspects([]);
        setTotal(0);
      } else {
        const payload = (await res.json()) as { data: DdProspectRow[]; total: number };
        setProspects(payload.data ?? []);
        setTotal(payload.total ?? 0);
      }
    } catch {
      setError("Could not reach the server.");
    }
    setLoading(false);
  }, [taxonomyId, requestId, stage, minScoreParam]);

  useEffect(() => {
    void load();
    setSelectedIds(new Set());
  }, [load]);

  const nodesById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const naicsLabelByCode = useMemo(
    () => new Map(nodes.filter((n) => n.kind === "naics").map((n) => [n.code, n.label])),
    [nodes],
  );
  const civicLabelByCode = useMemo(
    () => new Map(nodes.filter((n) => n.kind !== "naics").map((n) => [n.code, n.label])),
    [nodes],
  );

  const taxonomyOptions = useMemo(
    () => [
      { value: "", label: "All industries" },
      ...nodes
        .slice()
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((n) => ({ value: n.id, label: ancestryLabel(n, nodesById) })),
    ],
    [nodes, nodesById],
  );

  const requestSelectOptions = useMemo(
    () => [
      { value: "", label: "All requests" },
      ...requestOptions.map((r) => ({ value: r.id, label: r.name })),
    ],
    [requestOptions],
  );

  const stageOptions = useMemo(
    () => [
      { value: "", label: "All statuses" },
      ...PIPELINE_STAGES.map((s) => ({ value: s, label: humanizeEnum(s) })),
    ],
    [],
  );

  function categoryBadges(directory: DdDirectory | null): { key: string; label: string }[] {
    if (!directory) return [];
    const badges: { key: string; label: string }[] = [];
    for (const code of directory.naics_codes ?? []) {
      badges.push({ key: `naics:${code}`, label: naicsLabelByCode.get(code) ?? code });
    }
    if (directory.civic_kind) {
      badges.push({
        key: `civic:${directory.civic_kind}`,
        label: civicLabelByCode.get(directory.civic_kind) ?? humanizeEnum(directory.civic_kind),
      });
    }
    return badges;
  }

  const visibleProspects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const loc = locationQuery.trim().toLowerCase();
    if (!q && !loc) return prospects;
    return prospects.filter((p) => {
      if (q) {
        const name = `${p.directory?.legal_name ?? ""} ${p.directory?.dba_name ?? ""}`.toLowerCase();
        if (!name.includes(q)) return false;
      }
      if (loc) {
        const address = (p.directory?.hq_address ?? "").toLowerCase();
        if (!address.includes(loc)) return false;
      }
      return true;
    });
  }, [prospects, searchQuery, locationQuery]);

  const topIndustries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of prospects) {
      const primary = categoryBadges(p.directory)[0]?.label;
      if (!primary) continue;
      counts.set(primary, (counts.get(primary) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prospects, naicsLabelByCode, civicLabelByCode]);

  const engagedCount = useMemo(
    () => prospects.filter((p) => ENGAGED_STAGES.includes(p.pipeline_stage)).length,
    [prospects],
  );
  const highScoreCount = useMemo(
    () => prospects.filter((p) => p.score != null && p.score >= 70).length,
    [prospects],
  );

  const hasActiveFilters = Boolean(
    taxonomyId || requestId || stage || minScoreParam || searchQuery || locationQuery,
  );

  const editable = canEdit(profile?.role);

  const selectableIds = useMemo(() => visibleProspects.map((p) => p.id), [visibleProspects]);
  const allVisibleSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  const someVisibleSelected =
    !allVisibleSelected && selectableIds.some((id) => selectedIds.has(id));

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        selectableIds.forEach((id) => next.delete(id));
      } else {
        selectableIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function toggleProspect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  }

  async function handleBulkAdvance() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkUpdating(true);
    const results = await Promise.all(
      ids.map((id) =>
        fetch(`/api/donor-discovery/prospects/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pipeline_stage: targetStage }),
        }),
      ),
    );
    const failed = results.filter((r) => !r.ok).length;
    setBulkUpdating(false);
    setSelectedIds(new Set());
    showToast(
      failed > 0
        ? `Moved ${ids.length - failed} of ${ids.length} — ${failed} failed.`
        : `Moved ${ids.length} prospect${ids.length === 1 ? "" : "s"} to ${humanizeEnum(targetStage)}.`,
    );
    await load();
  }

  async function handleAddToOutreach(id: string) {
    setOutreachLoadingId(id);
    try {
      const res = await fetch(`/api/donor-discovery/prospects/${id}/route-to-email`, {
        method: "POST",
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      showToast(res.ok ? "Added to your outreach campaign." : payload.error ?? "Could not add this prospect to outreach.");
    } catch {
      showToast("Could not reach the server.");
    }
    setOutreachLoadingId(null);
  }

  const columns: TableColumn<DdProspectRow>[] = [
    ...(editable
      ? [
          {
            key: "select",
            header: (
              <input
                type="checkbox"
                aria-label="Select all visible prospects"
                checked={allVisibleSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someVisibleSelected;
                }}
                onChange={toggleSelectAll}
                onClick={(e) => e.stopPropagation()}
                disabled={selectableIds.length === 0}
                className="h-4 w-4 rounded border-slate-300 disabled:opacity-40"
                style={{ accentColor: "#0077B6" }}
              />
            ),
            render: (row: DdProspectRow) => (
              <input
                type="checkbox"
                aria-label={`Select ${row.directory?.legal_name ?? "prospect"}`}
                checked={selectedIds.has(row.id)}
                onChange={() => toggleProspect(row.id)}
                onClick={(e) => e.stopPropagation()}
                className="h-4 w-4 rounded border-slate-300"
                style={{ accentColor: "#0077B6" }}
              />
            ),
            className: "w-10",
          } satisfies TableColumn<DdProspectRow>,
        ]
      : []),
    {
      key: "name",
      header: "Company",
      sortable: true,
      sortValue: (row) => (row.directory?.legal_name ?? "").toLowerCase(),
      render: (row) => (
        <div>
          <p className="font-medium text-navy-900">
            {row.directory?.legal_name ?? "Unknown company"}
          </p>
          {row.directory?.dba_name && (
            <p className="text-xs text-slate-500">dba {row.directory.dba_name}</p>
          )}
        </div>
      ),
    },
    {
      key: "category",
      header: "Industry",
      render: (row) => {
        const badges = categoryBadges(row.directory);
        const primary = badges[0];
        if (!primary) return <span className="text-slate-400">—</span>;
        const extra = badges.length - 1;
        return (
          <div className="flex flex-wrap items-center gap-1">
            <ColorBadge label={primary.label} hex={industryColorFor(primary.label)} />
            {extra > 0 && <ColorBadge label={`+${extra}`} hex={DEFAULT_INDUSTRY_COLOR} />}
          </div>
        );
      },
    },
    {
      key: "geography",
      header: "Location",
      sortable: true,
      sortValue: (row) => row.directory?.hq_address ?? "",
      render: (row) => row.directory?.hq_address ?? <span className="text-slate-400">—</span>,
    },
    {
      key: "score",
      header: "Score",
      align: "right",
      sortable: true,
      sortValue: (row) => row.score ?? -1,
      render: (row) => (
        <span title={row.score_rationale ?? undefined} className={scoreBadgeClass(row.score)}>
          {row.score != null ? row.score : "Unscored"}
        </span>
      ),
    },
    {
      key: "website",
      header: "Website",
      render: (row) =>
        row.directory?.website ? (
          <a
            href={row.directory.website}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ color: "#0077B6" }}
            className="text-sm font-medium hover:underline"
          >
            {row.directory.website.replace(/^https?:\/\//, "")}
          </a>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      key: "stage",
      header: "Status",
      sortable: true,
      sortValue: (row) => row.pipeline_stage,
      render: (row) => (
        <ColorBadge label={humanizeEnum(row.pipeline_stage)} hex={STAGE_COLORS[row.pipeline_stage]} />
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-2">
          <Link
            href={`/donor-discovery/prospects/${row.id}`}
            onClick={(e) => e.stopPropagation()}
            style={{ color: "#0077B6" }}
            className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
          >
            View
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
          {editable && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void handleAddToOutreach(row.id);
              }}
              disabled={outreachLoadingId === row.id}
              style={{ backgroundColor: "#8B5CF6" }}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              <Send className="h-3 w-3" aria-hidden />
              {outreachLoadingId === row.id ? "Adding…" : "Add to Outreach"}
            </button>
          )}
        </div>
      ),
      className: "w-56",
    },
  ];

  return (
    <div
      className="-m-4 min-h-full space-y-6 p-4 sm:-m-6 sm:p-6 lg:-m-8 lg:p-8"
      style={{ backgroundColor: "#D6E4F0" }}
    >
      <Link
        href="/donor-discovery"
        className="inline-flex items-center gap-1.5 text-sm text-navy-500 transition hover:text-navy-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to Donor Discovery
      </Link>

      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            Prospects
            <span
              style={{ backgroundColor: SECTION_ACCENT }}
              className="inline-flex min-w-[1.75rem] items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold text-white"
            >
              {total}
            </span>
          </span>
        }
        accent={SECTION_ACCENT}
        description="All prospects surfaced by your discovery requests, across every industry and geography."
        actions={
          <Link
            href="/donor-discovery/new"
            className="inline-flex items-center bg-[#4C51C6] hover:bg-[#3D42A3] text-white px-6 py-3 rounded-xl font-bold text-sm shadow-md transition-colors"
          >
            Discover More
          </Link>
        }
      />

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Building2} label="Total Prospects" value={total} accent={SECTION_ACCENT} />
        <StatCard
          icon={Sparkles}
          label="Top Industries"
          accent="#8B5CF6"
          value={
            topIndustries.length === 0 ? (
              <span className="text-base font-medium text-slate-400">—</span>
            ) : (
              <div className="mt-1 flex flex-wrap gap-1">
                {topIndustries.map(([label, count]) => (
                  <ColorBadge key={label} label={`${label} (${count})`} hex={industryColorFor(label)} />
                ))}
              </div>
            )
          }
        />
        <StatCard icon={CheckCircle} label="High Score (70+)" value={highScoreCount} accent="#10B981" />
        <StatCard icon={Send} label="Contacted" value={engagedCount} accent="#F59E0B" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <TaxonomyCombobox
            options={taxonomyOptions}
            value={taxonomyId}
            onChange={(value) => setParams({ taxonomy_id: value || null })}
          />
          <Select
            aria-label="Filter by request"
            options={requestSelectOptions}
            value={requestId}
            onChange={(e) => setParams({ request_id: e.target.value || null })}
          />
          <Select
            aria-label="Filter by status"
            options={stageOptions}
            value={stage}
            onChange={(e) => setParams({ stage: e.target.value || null })}
          />
          <Input
            type="number"
            min={0}
            max={100}
            aria-label="Minimum score"
            placeholder="Min score"
            value={minScoreInput}
            onChange={(e) => setMinScoreInput(e.target.value)}
          />
          <div className="relative">
            <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              aria-label="Filter by city"
              placeholder="City / location"
              value={locationQuery}
              onChange={(e) => setLocationQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              aria-label="Search prospects"
              placeholder="Search company name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </div>

      {!loading && total > prospects.length && (
        <p className="text-sm text-navy-500">
          Showing {prospects.length} of {total} matching prospects — narrow your filters to see more.
        </p>
      )}

      {!loading && visibleProspects.length === 0 ? (
        hasActiveFilters ? (
          <EmptyState
            icon={Telescope}
            title="No prospects match these filters"
            description="Adjust or clear your filters, or launch a new discovery request to find more prospects."
            action={
              <Link href="/donor-discovery/new">
                <Button size="sm">Discover More</Button>
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={Telescope}
            title="No prospects yet"
            description="Launch a discovery request to find corporate donors matched to your mission."
            action={
              <Link href="/donor-discovery/new">
                <Button size="lg">Discover More</Button>
              </Link>
            }
          />
        )
      ) : (
        <Table
          columns={columns}
          data={visibleProspects}
          rowKey={(row) => row.id}
          isLoading={loading}
          onRowClick={(row) => router.push(`/donor-discovery/prospects/${row.id}`)}
          initialSort={{ key: "score", direction: "desc" }}
          pageSize={25}
          emptyMessage="No prospects match these filters."
        />
      )}

      {editable && selectedIds.size > 0 && (
        <div
          style={{ backgroundColor: "#1A2B3C" }}
          className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-xl px-6 py-3 shadow-xl"
        >
          <span className="text-sm font-medium text-white">
            {selectedIds.size} selected
          </span>
          <div className="w-40">
            <Select
              aria-label="Target stage"
              options={PIPELINE_STAGES.map((s) => ({ value: s, label: humanizeEnum(s) }))}
              value={targetStage}
              onChange={(e) => setTargetStage(e.target.value as DdPipelineStage)}
            />
          </div>
          <button
            type="button"
            onClick={() => void handleBulkAdvance()}
            disabled={bulkUpdating}
            style={{ backgroundColor: "#0077B6" }}
            className="rounded-lg px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
          >
            {bulkUpdating ? "Moving…" : "Move to stage"}
          </button>
        </div>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{ backgroundColor: "#10B981" }}
          className="fixed right-6 top-6 z-50 flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-medium text-white shadow-xl"
        >
          <CheckCircle className="h-4 w-4 flex-shrink-0" aria-hidden />
          {toast}
        </div>
      )}
    </div>
  );
}
