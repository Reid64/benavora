"use client";

// PIL prospect list - GET /api/pil/prospects only returns the pil_prospects
// row itself (id, entity_type, display_name, status, source_of_record,
// timestamps - see src/lib/pil/types.ts's Prospect interface). Confidence
// score, last researched date, and research depth are not columns on that
// table; they only exist per-prospect on the dossier (evidence + research
// runs, GET /api/pil/prospects/[id]). Rather than fabricate an aggregate,
// those three columns show "-" here with a link into the dossier where the
// real numbers live - same "don't fabricate a number that isn't real" rule
// already established on /intelligence's module cards.
//
// The route also hardcodes status=active server-side, so "Active" is the
// only status this list can ever contain; the status filter reflects that
// honestly instead of offering archived/merged options that would always
// return nothing.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Search, Users } from "lucide-react";

import { Button, EmptyState, Input, Select, Table } from "@/components/ui";
import type { TableColumn } from "@/components/ui";
import { StartResearchModal } from "@/components/pil/StartResearchModal";
import { InstructionalWidget } from "@/components/InstructionalWidget";
import { formatDate, humanizeEnum } from "@/lib/utils/formatters";
import type { Prospect, ProspectEntityType } from "@/lib/pil/types";

const NAVY = "#2C4E3B";
const GOLD = "#C49A4F";
const PLUM = "#C49A4F";
const CANVAS = "#F0EBE0";
const TEXT_SECONDARY = "#64748B";

const ENTITY_TYPES: ProspectEntityType[] = [
  "individual",
  "family_foundation",
  "private_foundation",
  "community_foundation",
  "corporate_foundation",
  "corporation",
  "executive",
  "business_owner",
  "board_member",
  "trustee",
  "wealth_holder",
  "community_leader",
  "institutional_funder",
  "other",
];

export default function PilProspectsPage() {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [researchTarget, setResearchTarget] = useState<Prospect | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/pil/prospects", { cache: "no-store" });
        if (!active) return;
        if (!res.ok) {
          setError("Could not load prospects.");
        } else {
          const payload = (await res.json()) as { prospects: Prospect[] };
          setProspects(payload.prospects ?? []);
        }
      } catch {
        if (active) setError("Could not reach the server.");
      }
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const statusOptions = useMemo(() => {
    const seen = Array.from(new Set(prospects.map((p) => p.status)));
    return [{ value: "", label: "All statuses" }, ...seen.map((s) => ({ value: s, label: humanizeEnum(s) }))];
  }, [prospects]);

  const typeOptions = useMemo(
    () => [{ value: "", label: "All types" }, ...ENTITY_TYPES.map((t) => ({ value: t, label: humanizeEnum(t) }))],
    [],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return prospects.filter((p) => {
      if (typeFilter && p.entity_type !== typeFilter) return false;
      if (statusFilter && p.status !== statusFilter) return false;
      if (q && !p.display_name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [prospects, typeFilter, statusFilter, search]);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  }

  const columns: TableColumn<Prospect>[] = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      sortValue: (row) => row.display_name.toLowerCase(),
      render: (row) => (
        <div>
          <p className="font-medium" style={{ color: NAVY }}>
            {row.display_name}
          </p>
          {row.canonical_name !== row.display_name && (
            <p className="text-xs" style={{ color: TEXT_SECONDARY }}>
              {row.canonical_name}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      sortable: true,
      sortValue: (row) => row.entity_type,
      render: (row) => (
        <span
          className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"
          style={{ backgroundColor: `${GOLD}1A`, color: GOLD, borderColor: `${GOLD}40` }}
        >
          {humanizeEnum(row.entity_type)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      sortValue: (row) => row.status,
      render: (row) => (
        <span
          className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold"
          style={{ backgroundColor: `${PLUM}1A`, color: PLUM, borderColor: `${PLUM}40` }}
        >
          {humanizeEnum(row.status)}
        </span>
      ),
    },
    {
      key: "confidence",
      header: "Confidence",
      align: "right",
      render: () => <span style={{ color: TEXT_SECONDARY }}>See dossier</span>,
    },
    {
      key: "last_researched",
      header: "Last Researched",
      sortable: true,
      sortValue: (row) => row.updated_at,
      render: (row) => formatDate(row.updated_at),
    },
    {
      key: "depth",
      header: "Research Depth",
      align: "right",
      render: () => <span style={{ color: TEXT_SECONDARY }}>See dossier</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) => (
        <div className="flex items-center justify-end gap-3">
          <Link
            href={`/intelligence/pil/prospects/${row.id}`}
            onClick={(e) => e.stopPropagation()}
            style={{ color: PLUM }}
            className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
          >
            View Dossier
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setResearchTarget(row);
            }}
            style={{ backgroundColor: GOLD }}
            className="inline-flex items-center whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold text-white transition hover:opacity-90"
          >
            Start Research
          </button>
        </div>
      ),
      className: "w-64",
    },
  ];

  return (
    <div className="min-h-screen p-6" style={{ backgroundColor: CANVAS }}>
      <InstructionalWidget
        pageTitle="Prospects & Analysis"
        steps={[
          { number: 1, title: "Review your prospects", description: "Individuals and foundations identified as potential donors or funders." },
          { number: 2, title: "Filter by entity type", description: "Narrow to family foundations, executives, board members, and more." },
          { number: 3, title: "Run new analysis", description: "Start research on a new prospect to build their giving profile." },
          { number: 4, title: "Open a dossier", description: "Click a prospect to see confidence score, research depth, and evidence." },
        ]}
      />
      <div className="mb-8" style={{ borderLeft: `4px solid ${PLUM}`, paddingLeft: "1rem" }}>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: NAVY }}>
          Prospects
        </h1>
        <p className="mt-1 text-sm" style={{ color: TEXT_SECONDARY }}>
          Every active prospect in pil_prospects for your organization.
        </p>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mb-4 rounded-xl border border-slate-200 bg-surface p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select
            aria-label="Filter by status"
            options={statusOptions}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          />
          <Select
            aria-label="Filter by type"
            options={typeOptions}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          />
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              aria-label="Search prospects"
              placeholder="Search by name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </div>

      {!loading && visible.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No prospects match"
          description="Adjust your filters, or run a natural-language discovery to find new prospects."
          action={
            <Link href="/intelligence/pil/discover">
              <Button style={{ backgroundColor: PLUM }}>Discover Prospects</Button>
            </Link>
          }
        />
      ) : (
        <Table
          columns={columns}
          data={visible}
          rowKey={(row) => row.id}
          isLoading={loading}
          initialSort={{ key: "last_researched", direction: "desc" }}
          pageSize={25}
          emptyMessage="No prospects match these filters."
        />
      )}

      {researchTarget && (
        <StartResearchModal
          prospectId={researchTarget.id}
          prospectName={researchTarget.display_name}
          onClose={(runId) => {
            setResearchTarget(null);
            if (runId) showToast("Research started - see the Research monitor for progress.");
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{ backgroundColor: PLUM }}
          className="fixed right-6 top-6 z-50 flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-medium text-white shadow-xl"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
