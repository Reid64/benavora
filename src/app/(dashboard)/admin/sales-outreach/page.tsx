"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Globe,
  Megaphone,
  Plus,
  RefreshCw,
  ShieldAlert,
  Upload,
  X,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  LoadingSpinner,
  Modal,
  Table,
  Textarea,
} from "@/components/ui";
import type { BadgeColor, TableColumn } from "@/components/ui";
import { useProfile } from "@/lib/hooks/useProfile";

// ---------------------------------------------------------------------------
// Types
//
// The real backend for this page lives across four route groups —
// /api/admin/campaigns, /api/admin/domains, /api/admin/prospects, and
// /api/admin/sales-analytics — plus /api/admin/suppression (added alongside
// this rewrite; the suppression_list table existed and was already written
// to by ProspectManager and the bounce webhook, but had no admin CRUD route).
// None of these return exactly the shape this page originally assumed, so
// each tab below maps the real response onto these display types.
// ---------------------------------------------------------------------------

type CampaignStatus = "draft" | "active" | "paused" | "completed";

type Campaign = {
  id: string;
  name: string;
  description: string | null;
  status: CampaignStatus;
  sent: number;
  total: number;
  reply_rate: number;
  bounce_rate: number;
  created_at: string;
};

type Domain = {
  id: string;
  domain: string;
  warmup_progress: number;
  health: "green" | "yellow" | "red";
  daily_budget: number;
  daily_current: number;
  total_sent: number;
  dns_verified: boolean;
};

type Prospect = {
  id: string;
  org_name: string;
  email: string | null;
  state: string | null;
  revenue: number | null;
  status: string;
  last_contacted: string | null;
  replied: boolean;
};

type SuppressionEntry = {
  id: string;
  email: string;
  reason: string;
  source: string;
  added_at: string;
};

type StatsData = {
  total_prospects: number;
  active_campaigns: number;
  emails_sent_today: number;
  reply_rate: number;
  bounce_rate: number;
  unsubscribe_rate: number;
};

type ChartPoint = { date: string; sent: number; replies: number };

type AnalyticsData = {
  send_volume: ChartPoint[];
  top_subjects: { subject: string; reply_rate: number }[];
  best_hours: { hour: number; reply_rate: number }[];
  domain_perf: { domain: string; sent: number; bounce_rate: number }[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CAMPAIGN_BADGE: Record<CampaignStatus, BadgeColor> = {
  draft: "gray",
  active: "green",
  paused: "yellow",
  completed: "blue",
};

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

function mapCampaign(raw: Record<string, unknown>): Campaign {
  const sends = (raw["sales_sends"] as { id: string; status: string }[] | null) ?? [];
  const totalSent =
    typeof raw["total_sent"] === "number"
      ? (raw["total_sent"] as number)
      : sends.filter((s) => s.status === "sent").length;
  const totalReplied = typeof raw["total_replied"] === "number" ? (raw["total_replied"] as number) : 0;
  const totalBounced = typeof raw["total_bounced"] === "number" ? (raw["total_bounced"] as number) : 0;

  return {
    id: raw["id"] as string,
    name: raw["name"] as string,
    description: (raw["description"] as string | null) ?? null,
    status: raw["status"] as CampaignStatus,
    sent: totalSent,
    total: sends.length,
    reply_rate: totalSent > 0 ? totalReplied / totalSent : 0,
    bounce_rate: totalSent > 0 ? totalBounced / totalSent : 0,
    created_at: raw["created_at"] as string,
  };
}

function mapDomain(raw: Record<string, unknown>): Domain {
  const budget = (raw["target_daily_limit"] as number | null) ?? 0;
  const current = (raw["current_daily_limit"] as number | null) ?? 0;
  const healthStatus = raw["health_status"] as string | null;
  const health: Domain["health"] =
    healthStatus === "critical" ? "red" : healthStatus === "healthy" ? "green" : "yellow";

  return {
    id: raw["id"] as string,
    domain: raw["domain"] as string,
    warmup_progress: budget > 0 ? Math.min(100, Math.round((current / budget) * 100)) : 100,
    health,
    daily_budget: budget,
    daily_current: current,
    total_sent: (raw["total_sent"] as number | null) ?? 0,
    dns_verified: Boolean(raw["dns_verified"]),
  };
}

function mapProspect(raw: Record<string, unknown>): Prospect {
  return {
    id: raw["id"] as string,
    org_name: raw["org_name"] as string,
    email: (raw["email"] as string | null) ?? null,
    state: (raw["state"] as string | null) ?? null,
    revenue: (raw["annual_revenue"] as number | null) ?? null,
    status: raw["status"] as string,
    last_contacted: (raw["last_contacted_at"] as string | null) ?? null,
    replied: Boolean(raw["has_replied"]),
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-navy-400 uppercase tracking-wide">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-navy-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-navy-500">{sub}</p>}
    </Card>
  );
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pctVal = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-navy-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-teal-500"
          style={{ width: `${pctVal}%` }}
        />
      </div>
      <span className="text-xs text-navy-500 whitespace-nowrap">
        {value}/{max}
      </span>
    </div>
  );
}

function HealthDot({ health }: { health: Domain["health"] }) {
  const cls =
    health === "green"
      ? "bg-green-500"
      : health === "yellow"
        ? "bg-amber-400"
        : "bg-red-500";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${cls}`} />;
}

// ---------------------------------------------------------------------------
// Tab: Campaigns
// ---------------------------------------------------------------------------

function CampaignsTab() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [domainOptions, setDomainOptions] = useState<{ id: string; domain: string }[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [listId, setListId] = useState("");
  const [selectedDomainIds, setSelectedDomainIds] = useState<Set<string>>(new Set());
  const [dailyTarget, setDailyTarget] = useState("50");
  const [windowStart, setWindowStart] = useState("9");
  const [windowEnd, setWindowEnd] = useState("17");
  const [timezone, setTimezone] = useState("America/New_York");
  const [stepSubject, setStepSubject] = useState("");
  const [stepBody, setStepBody] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/campaigns");
      if (res.ok) {
        const json = (await res.json()) as { campaigns?: Record<string, unknown>[] };
        setCampaigns((json.campaigns ?? []).map(mapCampaign));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDomainOptions = useCallback(async () => {
    const res = await fetch("/api/admin/domains");
    if (res.ok) {
      const json = (await res.json()) as { domains?: { id: string; domain: string }[] };
      setDomainOptions((json.domains ?? []).map((d) => ({ id: d.id, domain: d.domain })));
    }
  }, []);

  useEffect(() => {
    void load();
    void loadDomainOptions();
  }, [load, loadDomainOptions]);

  function toggleDomain(id: string) {
    setSelectedDomainIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function resetForm() {
    setNewName("");
    setNewDesc("");
    setListId("");
    setSelectedDomainIds(new Set());
    setDailyTarget("50");
    setWindowStart("9");
    setWindowEnd("17");
    setTimezone("America/New_York");
    setStepSubject("");
    setStepBody("");
    setFormError(null);
  }

  async function createCampaign() {
    setFormError(null);
    const dailyTargetNum = parseInt(dailyTarget, 10);
    const windowStartNum = parseInt(windowStart, 10);
    const windowEndNum = parseInt(windowEnd, 10);

    if (!newName.trim()) return setFormError("Campaign name is required.");
    if (!listId.trim()) return setFormError("Prospect list ID is required.");
    if (selectedDomainIds.size === 0) return setFormError("Select at least one sending domain.");
    if (!Number.isFinite(dailyTargetNum) || dailyTargetNum <= 0)
      return setFormError("Daily send target must be a positive number.");
    if (!Number.isFinite(windowStartNum) || !Number.isFinite(windowEndNum) || windowStartNum >= windowEndNum)
      return setFormError("Send window start must be before end (0-23).");
    if (!stepSubject.trim() || !stepBody.trim())
      return setFormError("The first email step needs a subject and body.");

    setSaving(true);
    try {
      const res = await fetch("/api/admin/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDesc.trim() || undefined,
          list_id: listId.trim(),
          sending_domain_ids: Array.from(selectedDomainIds),
          daily_send_target: dailyTargetNum,
          send_window_start: windowStartNum,
          send_window_end: windowEndNum,
          send_timezone: timezone.trim() || "America/New_York",
          filter_criteria: {},
          steps: [{ subject_template: stepSubject.trim(), body_template: stepBody.trim(), delay_days: 0 }],
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setFormError(json?.error ?? "Failed to create campaign.");
        return;
      }
      setShowNew(false);
      resetForm();
      void load();
    } finally {
      setSaving(false);
    }
  }

  const columns: TableColumn<Campaign>[] = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      sortValue: (r) => r.name,
      render: (r) => (
        <span className="font-medium text-navy-900">{r.name}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      sortValue: (r) => r.status,
      render: (r) => (
        <Badge color={CAMPAIGN_BADGE[r.status]}>
          {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
        </Badge>
      ),
    },
    {
      key: "progress",
      header: "Progress",
      render: (r) => <ProgressBar value={r.sent} max={r.total} />,
    },
    {
      key: "reply_rate",
      header: "Reply Rate",
      sortable: true,
      sortValue: (r) => r.reply_rate,
      render: (r) => <span className="text-navy-700">{pct(r.reply_rate)}</span>,
    },
    {
      key: "bounce_rate",
      header: "Bounce Rate",
      sortable: true,
      sortValue: (r) => r.bounce_rate,
      render: (r) => <span className="text-navy-700">{pct(r.bounce_rate)}</span>,
    },
    {
      key: "created_at",
      header: "Created",
      sortable: true,
      sortValue: (r) => r.created_at,
      render: (r) => (
        <span className="text-navy-500 whitespace-nowrap">{fmtDate(r.created_at)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-navy-900">Campaigns</h2>
        <Button onClick={() => setShowNew(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          New Campaign
        </Button>
      </div>

      {loading ? (
        <LoadingSpinner center label="Loading campaigns…" />
      ) : (
        <Card>
          <Table
            columns={columns}
            data={campaigns}
            rowKey={(r) => r.id}
            pageSize={20}
            initialSort={{ key: "created_at", direction: "desc" }}
            emptyMessage="No campaigns yet. Create one to get started."
          />
        </Card>
      )}

      <Modal
        isOpen={showNew}
        onClose={() => {
          setShowNew(false);
          resetForm();
        }}
        title="New Campaign"
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label="Campaign Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Q3 Education Outreach"
          />
          <Textarea
            label="Description (optional)"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            rows={2}
          />
          <Input
            label="Prospect List ID"
            value={listId}
            onChange={(e) => setListId(e.target.value)}
            placeholder="UUID from a CSV import on the Prospects tab"
            helperText="There's no list picker yet — import prospects first, then copy the list ID from that import."
          />

          <div>
            <p className="mb-1.5 text-sm font-medium text-navy-700">Sending Domains</p>
            {domainOptions.length === 0 ? (
              <p className="text-sm text-navy-400">
                No sending domains configured yet — add one on the Domains tab first.
              </p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {domainOptions.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-sm text-navy-700">
                    <input
                      type="checkbox"
                      checked={selectedDomainIds.has(d.id)}
                      onChange={() => toggleDomain(d.id)}
                      className="rounded border-navy-300"
                    />
                    {d.domain}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input
              label="Daily Send Target"
              type="number"
              min={1}
              value={dailyTarget}
              onChange={(e) => setDailyTarget(e.target.value)}
            />
            <Input
              label="Window Start (0-23)"
              type="number"
              min={0}
              max={23}
              value={windowStart}
              onChange={(e) => setWindowStart(e.target.value)}
            />
            <Input
              label="Window End (0-23)"
              type="number"
              min={0}
              max={23}
              value={windowEnd}
              onChange={(e) => setWindowEnd(e.target.value)}
            />
          </div>
          <Input
            label="Timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="America/New_York"
          />

          <div className="space-y-2 border-t border-navy-100 pt-4">
            <p className="text-sm font-medium text-navy-700">First Email (Step 1)</p>
            <Input
              label="Subject Template"
              value={stepSubject}
              onChange={(e) => setStepSubject(e.target.value)}
              placeholder="Quick question, {org_name}"
            />
            <Textarea
              label="Body Template"
              value={stepBody}
              onChange={(e) => setStepBody(e.target.value)}
              rows={4}
              placeholder="Hi {first_name}, ..."
            />
            <p className="text-xs text-navy-400">
              Use {"{org_name}"}, {"{first_name}"}, {"{city}"}, {"{state}"} as placeholders. Additional
              follow-up steps can be added later via the campaign&apos;s API.
            </p>
          </div>

          {formError && <p className="text-sm text-red-600">{formError}</p>}

          <div className="flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                setShowNew(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button onClick={createCampaign} disabled={saving}>
              {saving ? "Creating…" : "Create Campaign"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Domains
// ---------------------------------------------------------------------------

function DomainsTab() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/domains");
      if (res.ok) {
        const json = (await res.json()) as { domains?: Record<string, unknown>[] };
        setDomains((json.domains ?? []).map(mapDomain));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function addDomain() {
    if (!newDomain.trim() || !newApiKey.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/admin/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: newDomain.trim(), api_key: newApiKey.trim(), provider: "resend" }),
      });
      setShowAdd(false);
      setNewDomain("");
      setNewApiKey("");
      void load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium text-navy-900">Sending Domains</h2>
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          Add Domain
        </Button>
      </div>

      {loading ? (
        <LoadingSpinner center label="Loading domains…" />
      ) : domains.length === 0 ? (
        <Card>
          <EmptyState
            icon={Globe}
            title="No domains configured"
            description="Add a sending domain to start warming up."
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {domains.map((d) => (
            <Card key={d.id} className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <HealthDot health={d.health} />
                  <span className="font-medium text-navy-900 truncate">{d.domain}</span>
                </div>
                {d.dns_verified ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" aria-label="DNS verified" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-label="DNS unverified" />
                )}
              </div>

              <div>
                <div className="flex justify-between text-xs text-navy-500 mb-1">
                  <span>Warmup</span>
                  <span>{d.warmup_progress}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-navy-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-teal-500"
                    style={{ width: `${d.warmup_progress}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-navy-400">Current / target limit</p>
                  <p className="text-navy-700">{d.daily_current}/{d.daily_budget}</p>
                </div>
                <div>
                  <p className="text-navy-400">Total sent</p>
                  <p className="text-navy-700">{d.total_sent.toLocaleString()}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title="Add Sending Domain">
        <div className="space-y-4">
          <Input
            label="Domain"
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            placeholder="mail.example.com"
          />
          <Input
            label="Resend API Key"
            value={newApiKey}
            onChange={(e) => setNewApiKey(e.target.value)}
            placeholder="re_…"
            type="password"
          />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button
              onClick={addDomain}
              disabled={!newDomain.trim() || !newApiKey.trim() || saving}
            >
              {saving ? "Adding…" : "Add Domain"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Prospects
// ---------------------------------------------------------------------------

// Elevated Slate pill classes, matching the pipeline color system used for
// application stages (pipeline.ts's stagePillClassName) — same hex pairs per
// semantic color family, just keyed by prospect status instead of stage.
const PROSPECT_STATUS_PILL: Record<string, string> = {
  pending: "bg-[#F1F5F9] text-[#64748B] px-3 py-1 rounded-full text-xs font-semibold",
  contacted: "bg-[#DBEAFE] text-[#1D4ED8] px-3 py-1 rounded-full text-xs font-semibold",
  replied: "bg-[#DCFCE7] text-[#15803D] px-3 py-1 rounded-full text-xs font-semibold",
  bounced: "bg-[#FEE2E2] text-[#B91C1C] px-3 py-1 rounded-full text-xs font-semibold",
  suppressed: "bg-[#FEF3C7] text-[#92400E] px-3 py-1 rounded-full text-xs font-semibold",
};

function ProspectsTab() {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [suppressing, setSuppressing] = useState(false);
  const [suppressingId, setSuppressingId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [importListName, setImportListName] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingFileRef = useRef<File | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/prospects?per_page=100");
      if (res.ok) {
        const json = (await res.json()) as { prospects?: Record<string, unknown>[] };
        setProspects((json.prospects ?? []).map(mapProspect));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = prospects.filter(
    (p) =>
      !search ||
      p.org_name.toLowerCase().includes(search.toLowerCase()) ||
      (p.email ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  function openImportModal(file: File) {
    pendingFileRef.current = file;
    setImportListName("");
    setImportResult(null);
    setShowImport(true);
  }

  async function runImport() {
    const file = pendingFileRef.current;
    if (!file || !importListName.trim()) return;
    setImporting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("list_name", importListName.trim());
      form.append("source", "upload");
      const res = await fetch("/api/admin/prospects", { method: "POST", body: form });
      const json = (await res.json().catch(() => null)) as
        | { result?: { imported: number; skipped_suppressed: number; skipped_duplicate: number } }
        | { error?: string }
        | null;
      if (res.ok && json && "result" in json && json.result) {
        setImportResult(
          `Imported ${json.result.imported}, skipped ${json.result.skipped_suppressed + json.result.skipped_duplicate}.`,
        );
        void load();
      } else {
        setImportResult(
          (json && "error" in json && json.error) || "Import failed.",
        );
      }
    } finally {
      setImporting(false);
    }
  }

  async function suppressSelected() {
    if (selected.size === 0) return;
    setSuppressing(true);
    try {
      await Promise.all(
        Array.from(selected).map((id) =>
          fetch(`/api/admin/prospects/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ suppressed: true, suppressed_reason: "manual_bulk_suppress" }),
          }),
        ),
      );
      setSelected(new Set());
      void load();
    } finally {
      setSuppressing(false);
    }
  }

  async function suppressOne(id: string) {
    setSuppressingId(id);
    try {
      await fetch(`/api/admin/prospects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suppressed: true, suppressed_reason: "manual_suppress" }),
      });
      void load();
    } finally {
      setSuppressingId(null);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const columns: TableColumn<Prospect>[] = [
    {
      key: "select",
      header: "",
      render: (r) => (
        <input
          type="checkbox"
          checked={selected.has(r.id)}
          onChange={() => toggleSelect(r.id)}
          className="rounded border-navy-300"
          aria-label={`Select ${r.org_name}`}
        />
      ),
    },
    {
      key: "org_name",
      header: "Organization",
      sortable: true,
      sortValue: (r) => r.org_name,
      render: (r) => <span className="font-medium text-navy-900">{r.org_name}</span>,
    },
    {
      key: "email",
      header: "Email",
      sortable: true,
      sortValue: (r) => r.email ?? "",
      render: (r) => <span className="text-navy-700">{r.email ?? "—"}</span>,
    },
    {
      key: "state",
      header: "State",
      sortable: true,
      sortValue: (r) => r.state ?? "",
      render: (r) => <span className="text-navy-700">{r.state ?? "—"}</span>,
    },
    {
      key: "revenue",
      header: "Revenue",
      sortable: true,
      sortValue: (r) => r.revenue ?? 0,
      render: (r) => (
        <span className="text-navy-700">
          {r.revenue != null ? `$${(r.revenue / 1_000_000).toFixed(1)}M` : "—"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      sortValue: (r) => r.status,
      render: (r) => (
        <span className={PROSPECT_STATUS_PILL[r.status] ?? PROSPECT_STATUS_PILL.pending}>
          {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
        </span>
      ),
    },
    {
      key: "last_contacted",
      header: "Last Contacted",
      sortable: true,
      sortValue: (r) => r.last_contacted ?? "",
      render: (r) => (
        <span className="text-navy-500 whitespace-nowrap">
          {fmtDate(r.last_contacted)}
        </span>
      ),
    },
    {
      key: "replied",
      header: "Replied",
      render: (r) =>
        r.replied ? (
          <CheckCircle2 className="h-4 w-4 text-green-500" aria-label="Replied" />
        ) : (
          <X className="h-4 w-4 text-navy-300" aria-label="Not replied" />
        ),
    },
    {
      key: "actions",
      header: "",
      render: (r) =>
        r.status === "suppressed" ? (
          <span className="text-xs text-slate-400">—</span>
        ) : (
          <button
            type="button"
            onClick={() => void suppressOne(r.id)}
            disabled={suppressingId === r.id}
            className="bg-[#0077B6] text-white px-3 py-1 rounded-lg text-xs font-semibold hover:bg-[#005F92] transition-colors disabled:opacity-60"
          >
            {suppressingId === r.id ? "Suppressing…" : "Suppress"}
          </button>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-navy-900">Prospects</h2>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button variant="secondary" onClick={suppressSelected} disabled={suppressing}>
              {suppressing ? "Suppressing…" : `Suppress ${selected.size} selected`}
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-4 w-4" aria-hidden />
            Import CSV
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) openImportModal(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="max-w-sm">
        <Input
          label=""
          placeholder="Search by org or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <LoadingSpinner center label="Loading prospects…" />
      ) : (
        <Table
          columns={columns}
          data={filtered}
          rowKey={(r) => r.id}
          pageSize={25}
          emptyMessage="No prospects match your search."
          containerClassName="bg-surface rounded-xl shadow-sm border border-border overflow-x-auto"
          tableClassName="min-w-[700px] divide-y divide-slate-200"
          theadClassName="bg-sidebar"
          thClassName="bg-sidebar text-white text-xs font-semibold uppercase tracking-wide px-4 py-3"
          tbodyClassName="divide-y divide-slate-200 bg-surface"
          rowClassName="hover:bg-slate-50 transition-colors"
        />
      )}

      <Modal isOpen={showImport} onClose={() => setShowImport(false)} title="Import Prospects">
        <div className="space-y-4">
          <Input
            label="List Name"
            value={importListName}
            onChange={(e) => setImportListName(e.target.value)}
            placeholder="e.g. Q3 Education Prospects"
            helperText="Every import creates a new prospect list; copy its ID from the result to use in a campaign."
          />
          {importResult && <p className="text-sm text-navy-700">{importResult}</p>}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowImport(false)}>
              Close
            </Button>
            <Button onClick={runImport} disabled={!importListName.trim() || importing}>
              {importing ? "Importing…" : "Import"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Suppression List
// ---------------------------------------------------------------------------

function SuppressionTab() {
  const [entries, setEntries] = useState<SuppressionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newReason, setNewReason] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/suppression");
      if (res.ok) {
        const json = (await res.json()) as { entries?: SuppressionEntry[] };
        setEntries(json.entries ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = entries.filter(
    (e) =>
      !search ||
      e.email.toLowerCase().includes(search.toLowerCase()),
  );

  async function addEmail() {
    if (!newEmail.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/admin/suppression", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim(), reason: newReason.trim() || "manual" }),
      });
      setShowAdd(false);
      setNewEmail("");
      setNewReason("");
      void load();
    } finally {
      setSaving(false);
    }
  }

  async function uploadCsv(file: File) {
    const form = new FormData();
    form.append("file", file);
    await fetch("/api/admin/suppression/import", {
      method: "POST",
      body: form,
    });
    void load();
  }

  const columns: TableColumn<SuppressionEntry>[] = [
    {
      key: "email",
      header: "Email",
      sortable: true,
      sortValue: (r) => r.email,
      render: (r) => <span className="font-medium text-navy-900">{r.email}</span>,
    },
    {
      key: "reason",
      header: "Reason",
      sortable: true,
      sortValue: (r) => r.reason,
      render: (r) => <span className="text-navy-700">{r.reason}</span>,
    },
    {
      key: "source",
      header: "Source",
      sortable: true,
      sortValue: (r) => r.source,
      render: (r) => <span className="text-navy-500">{r.source}</span>,
    },
    {
      key: "added_at",
      header: "Added",
      sortable: true,
      sortValue: (r) => r.added_at,
      render: (r) => (
        <span className="text-navy-500 whitespace-nowrap">{fmtDate(r.added_at)}</span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-navy-900">Suppression List</h2>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" aria-hidden />
            Import List
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadCsv(file);
              e.target.value = "";
            }}
          />
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            Add Email
          </Button>
        </div>
      </div>

      <div className="max-w-sm">
        <Input
          label=""
          placeholder="Search by email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <LoadingSpinner center label="Loading suppression list…" />
      ) : (
        <Card>
          <Table
            columns={columns}
            data={filtered}
            rowKey={(r) => r.id}
            pageSize={25}
            emptyMessage="No suppressed emails."
          />
        </Card>
      )}

      <Modal isOpen={showAdd} onClose={() => setShowAdd(false)} title="Add to Suppression List">
        <div className="space-y-4">
          <Input
            label="Email"
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="user@example.com"
          />
          <Input
            label="Reason (optional)"
            value={newReason}
            onChange={(e) => setNewReason(e.target.value)}
            placeholder="e.g. unsubscribed, complaint"
          />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button onClick={addEmail} disabled={!newEmail.trim() || saving}>
              {saving ? "Adding…" : "Add Email"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Analytics
// ---------------------------------------------------------------------------

function AnalyticsTab() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/admin/sales-analytics?period=30d");
        if (res.ok) {
          const raw = (await res.json()) as {
            by_day?: { date: string; sent: number; replied: number }[];
            top_subject_lines?: { subject: string; reply_rate: number }[];
            send_time_performance?: { hour: number; sends: number; reply_rate: number }[];
            by_domain?: { domain: string; sent: number; bounce_rate: number }[];
          };
          setData({
            send_volume: (raw.by_day ?? []).map((d) => ({
              date: d.date,
              sent: d.sent,
              replies: d.replied,
            })),
            top_subjects: (raw.top_subject_lines ?? []).map((s) => ({
              subject: s.subject,
              reply_rate: s.reply_rate / 100,
            })),
            best_hours: [...(raw.send_time_performance ?? [])]
              .filter((h) => h.sends > 0)
              .sort((a, b) => b.reply_rate - a.reply_rate)
              .map((h) => ({ hour: h.hour, reply_rate: h.reply_rate / 100 })),
            domain_perf: (raw.by_domain ?? []).map((d) => ({
              domain: d.domain,
              sent: d.sent,
              bounce_rate: d.bounce_rate / 100,
            })),
          });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <LoadingSpinner center label="Loading analytics…" />;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium text-navy-900">Analytics</h2>

      {/* Send volume chart (simple bar representation) */}
      <Card className="p-4">
        <p className="mb-3 text-sm font-medium text-navy-700">
          Send Volume — Last 30 Days
        </p>
        {data.send_volume.length === 0 ? (
          <p className="text-sm text-navy-400">No data yet.</p>
        ) : (
          <div className="flex items-end gap-1 h-24 overflow-x-auto">
            {data.send_volume.map((pt) => {
              const max = Math.max(...data.send_volume.map((p) => p.sent), 1);
              const heightPct = (pt.sent / max) * 100;
              return (
                <div
                  key={pt.date}
                  className="flex flex-col items-center gap-1 shrink-0"
                  title={`${pt.date}: ${pt.sent} sent, ${pt.replies} replies`}
                >
                  <div
                    className="w-3 rounded-t bg-teal-500"
                    style={{ height: `${heightPct}%`, minHeight: 2 }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Top subject lines */}
        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-navy-700">
            Best Performing Subject Lines
          </p>
          {data.top_subjects.length === 0 ? (
            <p className="text-sm text-navy-400">No data yet.</p>
          ) : (
            <ul className="space-y-2">
              {data.top_subjects.slice(0, 5).map((s, i) => (
                <li key={i} className="flex items-start justify-between gap-3">
                  <span className="text-sm text-navy-700 truncate">{s.subject}</span>
                  <span className="shrink-0 text-xs font-medium text-teal-600">
                    {pct(s.reply_rate)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Best send hours */}
        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-navy-700">
            Best Performing Send Times
          </p>
          {data.best_hours.length === 0 ? (
            <p className="text-sm text-navy-400">No data yet.</p>
          ) : (
            <ul className="space-y-2">
              {data.best_hours.slice(0, 5).map((h) => {
                const label =
                  h.hour === 0
                    ? "12 AM"
                    : h.hour < 12
                      ? `${h.hour} AM`
                      : h.hour === 12
                        ? "12 PM"
                        : `${h.hour - 12} PM`;
                return (
                  <li key={h.hour} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-navy-700">{label}</span>
                    <span className="text-xs font-medium text-teal-600">
                      {pct(h.reply_rate)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {/* Domain performance */}
      <Card className="p-4">
        <p className="mb-3 text-sm font-medium text-navy-700">
          Domain Performance
        </p>
        {data.domain_perf.length === 0 ? (
          <p className="text-sm text-navy-400">No data yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-sidebar">
                  <th className="px-2 py-2 text-left text-xs font-medium text-white">Domain</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-white">Sent</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-white">Bounce Rate</th>
                </tr>
              </thead>
              <tbody>
                {data.domain_perf.map((d) => (
                  <tr key={d.domain} className="border-b border-navy-50 last:border-0">
                    <td className="py-2 text-navy-700">{d.domain}</td>
                    <td className="py-2 text-right text-navy-700">{d.sent.toLocaleString()}</td>
                    <td className="py-2 text-right font-medium text-teal-600">{pct(d.bounce_rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats row
// ---------------------------------------------------------------------------

function StatsRow({ stats }: { stats: StatsData }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <StatCard label="Total Prospects" value={stats.total_prospects.toLocaleString()} />
      <StatCard label="Active Campaigns" value={stats.active_campaigns} />
      <StatCard label="Emails Sent Today" value={stats.emails_sent_today.toLocaleString()} />
      <StatCard label="Reply Rate" value={pct(stats.reply_rate)} sub="all time" />
      <StatCard label="Bounce Rate" value={pct(stats.bounce_rate)} sub="all time" />
      <StatCard label="Unsubscribe Rate" value={pct(stats.unsubscribe_rate)} sub="all time" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Tab = "campaigns" | "domains" | "prospects" | "suppression" | "analytics";

const TABS: { id: Tab; label: string }[] = [
  { id: "campaigns", label: "Campaigns" },
  { id: "domains", label: "Domains" },
  { id: "prospects", label: "Prospects" },
  { id: "suppression", label: "Suppression List" },
  { id: "analytics", label: "Analytics" },
];

export default function SalesOutreachPage() {
  const { profile, loading: profileLoading } = useProfile();
  const isAdmin = profile?.role === "owner" || profile?.role === "admin";

  const [activeTab, setActiveTab] = useState<Tab>("campaigns");
  const [stats, setStats] = useState<StatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // No single endpoint returns this dashboard's summary shape, so it's
  // assembled from three real endpoints: prospect totals, campaign statuses,
  // and all-time + last-7-day analytics (for "sent today").
  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const todayStr = new Date().toISOString().slice(0, 10);
      const [prospectsRes, campaignsRes, allTimeRes, recentRes] = await Promise.all([
        fetch("/api/admin/prospects/stats"),
        fetch("/api/admin/campaigns"),
        fetch("/api/admin/sales-analytics?period=all"),
        fetch("/api/admin/sales-analytics?period=7d"),
      ]);

      const prospectsJson = prospectsRes.ok
        ? ((await prospectsRes.json()) as { stats?: { total: number } })
        : null;
      const campaignsJson = campaignsRes.ok
        ? ((await campaignsRes.json()) as { campaigns?: { status: string }[] })
        : null;
      const allTimeJson = allTimeRes.ok
        ? ((await allTimeRes.json()) as {
            rates?: { reply_rate: number; bounce_rate: number; unsubscribe_rate: number };
          })
        : null;
      const recentJson = recentRes.ok
        ? ((await recentRes.json()) as { by_day?: { date: string; sent: number }[] })
        : null;

      const emailsSentToday = recentJson?.by_day?.find((d) => d.date === todayStr)?.sent ?? 0;

      setStats({
        total_prospects: prospectsJson?.stats?.total ?? 0,
        active_campaigns: (campaignsJson?.campaigns ?? []).filter((c) => c.status === "active").length,
        emails_sent_today: emailsSentToday,
        reply_rate: (allTimeJson?.rates?.reply_rate ?? 0) / 100,
        bounce_rate: (allTimeJson?.rates?.bounce_rate ?? 0) / 100,
        unsubscribe_rate: (allTimeJson?.rates?.unsubscribe_rate ?? 0) / 100,
      });
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!profileLoading && isAdmin) void loadStats();
    else if (!profileLoading) setStatsLoading(false);
  }, [profileLoading, isAdmin, loadStats, refreshKey]);

  if (profileLoading) {
    return <LoadingSpinner center label="Loading…" />;
  }

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight text-primary">
          Sales Outreach
        </h1>
        <Card>
          <EmptyState
            icon={ShieldAlert}
            title="Admins only"
            description="Only owners and admins can access Sales Outreach."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-teal-500" aria-hidden />
            Sales Outreach
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Manage outreach campaigns, domains, prospects, and analytics.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            setRefreshKey((k) => k + 1);
            void loadStats();
          }}
          disabled={statsLoading}
        >
          <RefreshCw className={`h-4 w-4 ${statsLoading ? "animate-spin" : ""}`} aria-hidden />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      {statsLoading ? (
        <LoadingSpinner label="Loading stats…" />
      ) : stats ? (
        <StatsRow stats={stats} />
      ) : null}

      {/* Tab nav */}
      <div className="border-b border-navy-100">
        <nav className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "border-teal-500 text-teal-600"
                  : "border-transparent text-navy-500 hover:text-navy-700 hover:border-navy-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === "campaigns" && <CampaignsTab />}
      {activeTab === "domains" && <DomainsTab />}
      {activeTab === "prospects" && <ProspectsTab />}
      {activeTab === "suppression" && <SuppressionTab />}
      {activeTab === "analytics" && <AnalyticsTab />}
    </div>
  );
}
