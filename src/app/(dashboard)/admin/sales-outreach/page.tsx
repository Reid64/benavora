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
  daily_remaining: number;
  total_sent: number;
  dns_verified: boolean;
};

type Prospect = {
  id: string;
  org_name: string;
  email: string;
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
  domain_perf: { domain: string; sent: number; reply_rate: number }[];
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
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/sales-outreach/campaigns");
      if (res.ok) {
        const json = (await res.json()) as { campaigns?: Campaign[] };
        setCampaigns(json.campaigns ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createCampaign() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/admin/sales-outreach/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() || null }),
      });
      setShowNew(false);
      setNewName("");
      setNewDesc("");
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
        onClose={() => setShowNew(false)}
        title="New Campaign"
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
            rows={3}
          />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowNew(false)}>
              Cancel
            </Button>
            <Button onClick={createCampaign} disabled={!newName.trim() || saving}>
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
      const res = await fetch("/api/admin/sales-outreach/domains");
      if (res.ok) {
        const json = (await res.json()) as { domains?: Domain[] };
        setDomains(json.domains ?? []);
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
      await fetch("/api/admin/sales-outreach/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: newDomain.trim(), resend_api_key: newApiKey.trim() }),
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
                  <p className="text-navy-400">Daily budget</p>
                  <p className="text-navy-700">{d.daily_remaining}/{d.daily_budget}</p>
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

const PROSPECT_STATUS_BADGE: Record<string, BadgeColor> = {
  pending: "gray",
  contacted: "blue",
  replied: "green",
  bounced: "red",
  suppressed: "orange",
};

function ProspectsTab() {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/sales-outreach/prospects");
      if (res.ok) {
        const json = (await res.json()) as { prospects?: Prospect[] };
        setProspects(json.prospects ?? []);
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
      p.email.toLowerCase().includes(search.toLowerCase()),
  );

  async function uploadCsv(file: File) {
    const form = new FormData();
    form.append("file", file);
    await fetch("/api/admin/sales-outreach/prospects/import", {
      method: "POST",
      body: form,
    });
    void load();
  }

  async function suppressSelected() {
    if (selected.size === 0) return;
    await fetch("/api/admin/sales-outreach/suppress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selected) }),
    });
    setSelected(new Set());
    void load();
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
      sortValue: (r) => r.email,
      render: (r) => <span className="text-navy-700">{r.email}</span>,
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
        <Badge color={PROSPECT_STATUS_BADGE[r.status] ?? "gray"}>
          {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
        </Badge>
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
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-navy-900">Prospects</h2>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button variant="secondary" onClick={suppressSelected}>
              Suppress {selected.size} selected
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
              if (file) void uploadCsv(file);
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
        <Card>
          <Table
            columns={columns}
            data={filtered}
            rowKey={(r) => r.id}
            pageSize={25}
            emptyMessage="No prospects match your search."
          />
        </Card>
      )}
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
      const res = await fetch("/api/admin/sales-outreach/suppression");
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
      await fetch("/api/admin/sales-outreach/suppression", {
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
    await fetch("/api/admin/sales-outreach/suppression/import", {
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
        const res = await fetch("/api/admin/sales-outreach/analytics");
        if (res.ok) {
          const json = (await res.json()) as AnalyticsData;
          setData(json);
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
                <tr className="border-b border-navy-100">
                  <th className="pb-2 text-left text-xs font-medium text-navy-400">Domain</th>
                  <th className="pb-2 text-right text-xs font-medium text-navy-400">Sent</th>
                  <th className="pb-2 text-right text-xs font-medium text-navy-400">Reply Rate</th>
                </tr>
              </thead>
              <tbody>
                {data.domain_perf.map((d) => (
                  <tr key={d.domain} className="border-b border-navy-50 last:border-0">
                    <td className="py-2 text-navy-700">{d.domain}</td>
                    <td className="py-2 text-right text-navy-700">{d.sent.toLocaleString()}</td>
                    <td className="py-2 text-right font-medium text-teal-600">{pct(d.reply_rate)}</td>
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

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await fetch("/api/admin/sales-outreach/stats");
      if (res.ok) {
        const json = (await res.json()) as StatsData;
        setStats(json);
      }
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
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
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
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900 flex items-center gap-2">
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
