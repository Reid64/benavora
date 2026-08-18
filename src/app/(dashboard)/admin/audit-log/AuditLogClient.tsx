"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Download, ShieldAlert } from "lucide-react";

import {
  Badge,
  Button,
  EmptyState,
  Input,
  LoadingSpinner,
  Select,
  Table,
} from "@/components/ui";
import type { BadgeColor, TableColumn } from "@/components/ui";
import { recordAudit } from "@/lib/audit/client";
import { useProfile } from "@/lib/hooks/useProfile";
import { humanizeEnum } from "@/lib/utils/formatters";

// Audit Log viewer (BLUEPRINT updated §3.3 / Behavioral Contracts §24).
//
// Owner/admin only - the sidebar hides it for others and this page re-checks the
// session role as a second barrier (the API route is the real gate). Lists the
// org's audit trail with filtering by user, action, entity type, and date range,
// and exports the filtered view as CSV (itself an audited 'export' action, §24).

type AuditEntry = {
  id: string;
  createdAt: string;
  organizationId: string;
  organizationName: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown>;
  ipAddress: string | null;
};

type Actor = { id: string; name: string | null; email: string | null };
type Org = { id: string; name: string };

// The audit_action enum (SCHEMA_REGISTRY) - drives the action filter.
const AUDIT_ACTIONS = [
  "create",
  "update",
  "delete",
  "login",
  "logout",
  "export",
  "invite",
  "role_change",
  "billing_change",
  "agent_run",
  "submission",
] as const;

// Admin/Platform section treatment — PAGE_TREATMENT_PROTOCOL_V2.md. Frame:
// Deep Navy. Secondary accent: Rich Gold. ACTION_BADGE below is a real
// action-type distinction (shared Badge component) and is never touched.
const FRAME_NAVY = "#101B2D";
const ACCENT_GOLD = "#B88A2E";
const CARD_BG = "#F8F5EE";

function FramedCard({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div style={{ backgroundColor: FRAME_NAVY, borderRadius: "14px", boxShadow: "0 4px 20px rgba(16,27,45,0.22)", padding: "3px" }}>
      <div className={className ?? "p-5"} style={{ backgroundColor: CARD_BG, borderRadius: "11px" }}>
        {children}
      </div>
    </div>
  );
}

const ACTION_BADGE: Record<string, BadgeColor> = {
  create: "green",
  update: "blue",
  delete: "red",
  login: "gray",
  logout: "gray",
  export: "indigo",
  invite: "teal",
  role_change: "yellow",
  billing_change: "purple",
  agent_run: "blue",
  submission: "teal",
};

function actorLabel(entry: AuditEntry): string {
  if (entry.userName) return entry.userName;
  if (entry.userEmail) return entry.userEmail;
  return entry.userId ? "Unknown user" : "System";
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function entityLabel(entry: AuditEntry): string {
  if (!entry.entityType) return "-";
  return humanizeEnum(entry.entityType);
}

function detailsSummary(details: Record<string, unknown>): string {
  const keys = Object.keys(details ?? {});
  if (keys.length === 0) return "";
  return keys
    .map((k) => `${k}: ${formatDetailValue(details[k])}`)
    .join(", ");
}

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Quote a CSV field, escaping embedded quotes (RFC 4180). */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export default function AuditLogClient() {
  const { profile, loading: profileLoading } = useProfile();
  const canView = profile?.role === "owner" || profile?.role === "admin";

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [actors, setActors] = useState<Actor[]>([]);
  const [organizations, setOrganizations] = useState<Org[]>([]);
  const [isOwnerView, setIsOwnerView] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filters.
  const [actionFilter, setActionFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [orgFilter, setOrgFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/audit-log");
      const json = (await res.json().catch(() => null)) as
        | {
            entries?: AuditEntry[];
            actors?: Actor[];
            organizations?: Org[];
            isOwner?: boolean;
            error?: string;
          }
        | null;
      if (!res.ok || !json) {
        setLoadError(json?.error ?? "Could not load the audit log.");
        setLoading(false);
        return;
      }
      setEntries(json.entries ?? []);
      setActors(json.actors ?? []);
      setOrganizations(json.organizations ?? []);
      setIsOwnerView(json.isOwner ?? false);
    } catch {
      setLoadError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!profileLoading && canView) void load();
    else if (!profileLoading) setLoading(false);
  }, [profileLoading, canView, load]);

  // Entity types present, for the entity filter dropdown.
  const entityTypes = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) if (e.entityType) set.add(e.entityType);
    return Array.from(set).sort();
  }, [entries]);

  // Client-side filtering over the loaded rows.
  const filtered = useMemo(() => {
    const fromTs = fromDate ? new Date(fromDate).getTime() : null;
    // Inclusive of the whole "to" day.
    const toTs = toDate ? new Date(toDate).getTime() + 24 * 60 * 60 * 1000 : null;
    return entries.filter((e) => {
      if (actionFilter && e.action !== actionFilter) return false;
      if (userFilter && e.userId !== userFilter) return false;
      if (entityFilter && e.entityType !== entityFilter) return false;
      if (orgFilter && e.organizationId !== orgFilter) return false;
      const ts = new Date(e.createdAt).getTime();
      if (fromTs !== null && ts < fromTs) return false;
      if (toTs !== null && ts >= toTs) return false;
      return true;
    });
  }, [entries, actionFilter, userFilter, entityFilter, orgFilter, fromDate, toDate]);

  function exportCsv() {
    const header = [
      ...(isOwnerView ? ["Organization"] : []),
      "Timestamp",
      "User",
      "Email",
      "Action",
      "Entity",
      "Entity ID",
      "IP Address",
      "Details",
    ];
    const lines = filtered.map((e) =>
      [
        ...(isOwnerView ? [e.organizationName ?? e.organizationId] : []),
        formatTimestamp(e.createdAt),
        actorLabel(e),
        e.userEmail ?? "",
        e.action,
        e.entityType ?? "",
        e.entityId ?? "",
        e.ipAddress ?? "",
        detailsSummary(e.details),
      ]
        .map(csvCell)
        .join(","),
    );
    const csv = [header.map(csvCell).join(","), ...lines].join("\r\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Exporting the audit log is itself an audited action (Contracts §24).
    void recordAudit({
      action: "export",
      entityType: "audit_log",
      details: { rows: filtered.length },
    });
  }

  const columns: TableColumn<AuditEntry>[] = [
    {
      key: "createdAt",
      header: "Timestamp",
      sortable: true,
      sortValue: (r) => r.createdAt,
      render: (r) => (
        <span className="whitespace-nowrap text-navy-700">
          {formatTimestamp(r.createdAt)}
        </span>
      ),
    },
    ...(isOwnerView
      ? [
          {
            key: "organization",
            header: "Organization",
            sortable: true,
            sortValue: (r: AuditEntry) => r.organizationName ?? "",
            render: (r: AuditEntry) => (
              <span className="truncate text-navy-700">
                {r.organizationName ?? r.organizationId}
              </span>
            ),
          } satisfies TableColumn<AuditEntry>,
        ]
      : []),
    {
      key: "user",
      header: "User",
      sortable: true,
      sortValue: (r) => actorLabel(r),
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-navy-900">{actorLabel(r)}</p>
          {r.ipAddress && (
            <p className="truncate text-xs text-navy-400">{r.ipAddress}</p>
          )}
        </div>
      ),
    },
    {
      key: "action",
      header: "Action",
      sortable: true,
      sortValue: (r) => r.action,
      render: (r) => (
        <Badge color={ACTION_BADGE[r.action] ?? "gray"}>
          {humanizeEnum(r.action)}
        </Badge>
      ),
    },
    {
      key: "entity",
      header: "Entity",
      sortable: true,
      sortValue: (r) => r.entityType ?? "",
      render: (r) => (
        <span className="text-navy-700">{entityLabel(r)}</span>
      ),
    },
    {
      key: "details",
      header: "Details",
      render: (r) => {
        const summary = detailsSummary(r.details);
        return (
          <span className="block max-w-md truncate text-sm text-navy-500">
            {summary || "-"}
          </span>
        );
      },
    },
  ];

  const actorOptions = [
    { value: "", label: "All users" },
    ...actors.map((a) => ({
      value: a.id,
      label: a.name ?? a.email ?? a.id,
    })),
  ];
  const actionOptions = [
    { value: "", label: "All actions" },
    ...AUDIT_ACTIONS.map((a) => ({ value: a, label: humanizeEnum(a) })),
  ];
  const entityOptions = [
    { value: "", label: "All entities" },
    ...entityTypes.map((t) => ({ value: t, label: humanizeEnum(t) })),
  ];
  const orgOptions = [
    { value: "", label: "All organizations" },
    ...organizations.map((o) => ({ value: o.id, label: o.name })),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: FRAME_NAVY }}>
            Audit Log
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            {isOwnerView
              ? "A complete, append-only record of activity across every organization on the platform."
              : "A complete, append-only record of activity in your organization."}
          </p>
        </div>
        {canView && entries.length > 0 && (
          <Button
            variant="ghost"
            onClick={exportCsv}
            style={{ border: `1.5px solid ${ACCENT_GOLD}`, backgroundColor: "rgba(184,138,46,0.1)", color: "#8A6A22" }}
          >
            <Download className="h-4 w-4" aria-hidden />
            Export CSV
          </Button>
        )}
      </div>

      {profileLoading || loading ? (
        <LoadingSpinner center label="Loading audit log..." />
      ) : !canView ? (
        <FramedCard>
          <EmptyState
            icon={ShieldAlert}
            title="Admins only"
            description="Only owners and admins can view the audit log."
          />
        </FramedCard>
      ) : loadError ? (
        <FramedCard>
          <EmptyState
            icon={ShieldAlert}
            title="Could not load the audit log"
            description={loadError}
          />
        </FramedCard>
      ) : (
        <FramedCard>
          <div
            className={`mb-4 grid gap-3 sm:grid-cols-2 ${
              isOwnerView ? "lg:grid-cols-6" : "lg:grid-cols-5"
            }`}
          >
            {isOwnerView && (
              <Select
                label="Organization"
                options={orgOptions}
                value={orgFilter}
                onChange={(e) => setOrgFilter(e.target.value)}
              />
            )}
            <Select
              label="Action"
              options={actionOptions}
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
            />
            <Select
              label="User"
              options={actorOptions}
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
            />
            <Select
              label="Entity"
              options={entityOptions}
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
            />
            <Input
              label="From"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
            <Input
              label="To"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>

          <Table
            columns={columns}
            data={filtered}
            rowKey={(r) => r.id}
            pageSize={25}
            initialSort={{ key: "createdAt", direction: "desc" }}
            emptyMessage="No audit entries match your filters."
            containerClassName="overflow-x-auto rounded-lg"
            tbodyClassName="divide-y divide-slate-200"
          />
        </FramedCard>
      )}
    </div>
  );
}
