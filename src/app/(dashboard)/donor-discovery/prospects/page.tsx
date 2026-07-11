"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, CheckCircle, ChevronDown, Search, Telescope } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Badge, Button, EmptyState, Input, Select, Table } from "@/components/ui";
import type { BadgeVariant, TableColumn } from "@/components/ui";
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

const STAGE_BADGE: Record<DdPipelineStage, BadgeVariant> = {
  new: "neutral",
  reviewing: "info",
  contacted: "info",
  applied: "warning",
  received: "success",
  rejected: "error",
  archived: "neutral",
};

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

function scoreVariant(score: number | null): BadgeVariant {
  if (score == null) return "neutral";
  if (score >= 70) return "success";
  if (score >= 40) return "warning";
  return "neutral";
}

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
        aria-label="Filter by taxonomy"
        className="flex w-full items-center justify-between rounded-lg border border-border bg-surface py-2 pl-3 pr-3 text-left text-sm text-text shadow-sm transition focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500"
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-navy-400" aria-hidden />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-surface shadow-lg">
          <div className="relative border-b border-border p-2">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400"
              aria-hidden
            />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search taxonomies..."
              aria-label="Search taxonomies"
              className="w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-2 text-sm text-text placeholder:text-text-muted focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
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
                  className={`block w-full px-3 py-1.5 text-left text-sm transition ${
                    value === clearOption.value
                      ? "bg-teal-50 font-medium text-teal-700"
                      : "text-text hover:bg-surface-raised"
                  }`}
                >
                  {clearOption.label}
                </button>
              </li>
            )}
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-navy-400">No matches</li>
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
                    className={`block w-full truncate px-3 py-1.5 text-left text-sm transition ${
                      value === o.value
                        ? "bg-teal-50 font-medium text-teal-700"
                        : "text-text hover:bg-surface-raised"
                    }`}
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
      { value: "", label: "All taxonomies" },
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
      { value: "", label: "All stages" },
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

  const hasActiveFilters = Boolean(taxonomyId || requestId || stage || minScoreParam);

  const editable = canEdit(profile?.role);

  const selectableIds = useMemo(() => prospects.map((p) => p.id), [prospects]);
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
    setToast(
      failed > 0
        ? `Moved ${ids.length - failed} of ${ids.length} — ${failed} failed.`
        : `Moved ${ids.length} prospect${ids.length === 1 ? "" : "s"} to ${humanizeEnum(targetStage)}.`,
    );
    setTimeout(() => setToast(null), 4000);
    await load();
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
                className="h-4 w-4 rounded border-navy-300 text-teal-600 focus:ring-teal-500 disabled:opacity-40"
              />
            ),
            render: (row: DdProspectRow) => (
              <input
                type="checkbox"
                aria-label={`Select ${row.directory?.legal_name ?? "prospect"}`}
                checked={selectedIds.has(row.id)}
                onChange={() => toggleProspect(row.id)}
                onClick={(e) => e.stopPropagation()}
                className="h-4 w-4 rounded border-navy-300 text-teal-600 focus:ring-teal-500"
              />
            ),
            className: "w-10",
          } satisfies TableColumn<DdProspectRow>,
        ]
      : []),
    {
      key: "name",
      header: "Name",
      sortable: true,
      sortValue: (row) => (row.directory?.legal_name ?? "").toLowerCase(),
      render: (row) => (
        <div>
          <p className="font-medium text-navy-900">
            {row.directory?.legal_name ?? "Unknown company"}
          </p>
          {row.directory?.website && (
            <p className="text-xs text-navy-400">
              {row.directory.website.replace(/^https?:\/\//, "")}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      render: (row) => {
        const badges = categoryBadges(row.directory);
        if (badges.length === 0) return <span className="text-navy-400">—</span>;
        const shown = badges.slice(0, 2);
        const extra = badges.length - shown.length;
        return (
          <div className="flex flex-wrap gap-1">
            {shown.map((b) => (
              <Badge key={b.key} color="teal">
                {b.label}
              </Badge>
            ))}
            {extra > 0 && <Badge color="gray">+{extra}</Badge>}
          </div>
        );
      },
    },
    {
      key: "geography",
      header: "Geography",
      sortable: true,
      sortValue: (row) => row.directory?.hq_address ?? "",
      render: (row) => row.directory?.hq_address ?? <span className="text-navy-400">—</span>,
    },
    {
      key: "score",
      header: "Score",
      align: "right",
      sortable: true,
      sortValue: (row) => row.score ?? -1,
      render: (row) => (
        <span title={row.score_rationale ?? undefined}>
          <Badge variant={scoreVariant(row.score)}>
            {row.score != null ? row.score : "Unscored"}
          </Badge>
        </span>
      ),
    },
    {
      key: "stage",
      header: "Stage",
      sortable: true,
      sortValue: (row) => row.pipeline_stage,
      render: (row) => <Badge variant={STAGE_BADGE[row.pipeline_stage]}>{humanizeEnum(row.pipeline_stage)}</Badge>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <Link
          href={`/donor-discovery/prospects/${row.id}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-sm font-medium text-teal-600 hover:text-teal-700"
        >
          View
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      ),
      className: "w-20",
    },
  ];

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
        title="Prospects"
        description="All prospects surfaced by your discovery requests, across every taxonomy and geography."
        actions={
          <Link href="/donor-discovery/new">
            <Button>New Discovery</Button>
          </Link>
        }
      />

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        <Input
          type="number"
          min={0}
          max={100}
          aria-label="Minimum score"
          placeholder="Min score"
          value={minScoreInput}
          onChange={(e) => setMinScoreInput(e.target.value)}
        />
        <Select
          aria-label="Filter by stage"
          options={stageOptions}
          value={stage}
          onChange={(e) => setParams({ stage: e.target.value || null })}
        />
      </div>

      {!loading && total > prospects.length && (
        <p className="text-sm text-navy-500">
          Showing {prospects.length} of {total} matching prospects — narrow your filters to see more.
        </p>
      )}

      {!loading && prospects.length === 0 ? (
        hasActiveFilters ? (
          <EmptyState
            icon={Telescope}
            title="No prospects match these filters"
            description="Adjust or clear your filters, or launch a new discovery request to find more prospects."
            action={
              <Link href="/donor-discovery/new">
                <Button size="sm">New Discovery</Button>
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
                <Button size="lg">Start Discovery</Button>
              </Link>
            }
          />
        )
      ) : (
        <Table
          columns={columns}
          data={prospects}
          rowKey={(row) => row.id}
          isLoading={loading}
          onRowClick={(row) => router.push(`/donor-discovery/prospects/${row.id}`)}
          initialSort={{ key: "score", direction: "desc" }}
          pageSize={25}
          emptyMessage="No prospects match these filters."
        />
      )}

      {editable && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-xl bg-navy-900 px-6 py-3 shadow-xl">
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
            className="rounded-lg bg-teal-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-teal-500 disabled:opacity-60"
          >
            {bulkUpdating ? "Moving…" : "Move to stage"}
          </button>
        </div>
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed right-6 top-6 z-50 flex items-center gap-2 rounded-xl bg-success-text px-5 py-3 text-sm font-medium text-white shadow-xl"
        >
          <CheckCircle className="h-4 w-4 flex-shrink-0" aria-hidden />
          {toast}
        </div>
      )}
    </div>
  );
}
