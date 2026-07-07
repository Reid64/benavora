"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarDays,
  Check,
  Clock,
  Eye,
  EyeOff,
  Globe,
  Key,
  Mail,
  Play,
  RefreshCw,
  Settings2,
  Shield,
  Unlink,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { Badge, Button, Card, LoadingSpinner, Modal } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/hooks/useProfile";
import { formatRelative } from "@/lib/utils/formatters";
import type { Enums } from "@/types/database";

// ── Types ─────────────────────────────────────────────────────────────────────

type EmailConn = {
  id: string;
  email_address: string;
  sync_status: string;
  last_sync_at: string | null;
};

type CalConn = {
  id: string;
  calendar_name: string | null;
  sync_status: string;
  last_sync_at: string | null;
};

type IntegrationKeyRow = {
  id: string;
  service_name: Enums<"integration_service">;
  is_active: boolean;
  last_validated_at: string | null;
  validation_status: string;
  key_hint: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const AGENT_TYPES = [
  "grants_gov_research",
  "sam_gov_research",
  "propublica_mining",
  "state_portal",
] as const;

const SYNC_FREQ_OPTIONS = [
  { value: "15min", label: "Every 15 minutes" },
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "manual", label: "Manual only" },
] as const;

// ── Main content (needs useSearchParams → wrapped in Suspense) ─────────────

function IntegrationsContent() {
  const { profile } = useProfile();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Connection state
  const [emailConn, setEmailConn] = useState<EmailConn | null>(null);
  const [calConn, setCalConn] = useState<CalConn | null>(null);

  // API keys + status
  const [keys, setKeys] = useState<IntegrationKeyRow[]>([]);
  const [resendEnvConfigured, setResendEnvConfigured] = useState(false);

  // Agent last-run tracking
  const [lastRuns, setLastRuns] = useState<
    Record<string, { completed_at: string | null; status: string } | null>
  >({});
  const [statePortalCount, setStatePortalCount] = useState(0);

  const [loading, setLoading] = useState(true);

  // Notification banner
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Action states
  const [connecting, setConnecting] = useState<"gmail" | "gcal" | null>(null);
  const [syncing, setSyncing] = useState<"gmail" | "gcal" | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<"gmail" | "gcal" | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [runResult, setRunResult] = useState<Record<string, "ok" | "err" | null>>({});

  const [editKey, setEditKey] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saveResult, setSaveResult] = useState<Record<string, "ok" | "err" | null>>({});

  // Sync preferences
  const [emailAutoSync, setEmailAutoSync] = useState(true);
  const [emailSyncFreq, setEmailSyncFreq] = useState("hourly");
  const [calAutoSync, setCalAutoSync] = useState(true);
  const [calAutoDeadlines, setCalAutoDeadlines] = useState(true);

  // ── Data loading ───────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    try {
      const [keysRes, emailRes, calRes, statusRes, runsRes, portalsRes, prefsRes] =
        await Promise.all([
          fetch("/api/integrations/keys"),
          supabase
            .from("email_connections")
            .select("id, email_address, sync_status, last_sync_at")
            .eq("sync_status", "active")
            .maybeSingle(),
          supabase
            .from("calendar_connections")
            .select("id, calendar_name, sync_status, last_sync_at")
            .eq("sync_status", "active")
            .maybeSingle(),
          fetch("/api/settings/integrations/status"),
          supabase
            .from("agent_runs")
            .select("agent_type, completed_at, status")
            .in("agent_type", [...AGENT_TYPES])
            .order("created_at", { ascending: false })
            .limit(40),
          supabase
            .from("state_portals")
            .select("id", { count: "exact", head: true })
            .eq("is_active", true),
          supabase
            .from("platform_config")
            .select("key, value")
            .in("key", [
              "email.auto_sync_enabled",
              "email.sync_frequency",
              "calendar.auto_sync_enabled",
              "calendar.auto_deadlines",
            ]),
        ]);

      if (keysRes.ok) {
        const body = (await keysRes.json()) as { keys: IntegrationKeyRow[] };
        setKeys(body.keys ?? []);
      }

      setEmailConn((emailRes.data as EmailConn | null) ?? null);
      setCalConn((calRes.data as CalConn | null) ?? null);

      if (statusRes.ok) {
        const body = (await statusRes.json()) as { resend_configured: boolean };
        setResendEnvConfigured(body.resend_configured ?? false);
      }

      const runMap: Record<
        string,
        { completed_at: string | null; status: string } | null
      > = {};
      for (const run of runsRes.data ?? []) {
        if (!runMap[run.agent_type]) {
          runMap[run.agent_type] = {
            completed_at: run.completed_at,
            status: run.status ?? "",
          };
        }
      }
      setLastRuns(runMap);
      setStatePortalCount(portalsRes.count ?? 0);

      const prefsMap: Record<string, string> = {};
      for (const row of prefsRes.data ?? []) {
        prefsMap[row.key] = row.value;
      }
      if (prefsMap["email.auto_sync_enabled"] !== undefined) {
        setEmailAutoSync(prefsMap["email.auto_sync_enabled"] === "true");
      }
      if (prefsMap["email.sync_frequency"]) {
        setEmailSyncFreq(prefsMap["email.sync_frequency"]);
      }
      if (prefsMap["calendar.auto_sync_enabled"] !== undefined) {
        setCalAutoSync(prefsMap["calendar.auto_sync_enabled"] === "true");
      }
      if (prefsMap["calendar.auto_deadlines"] !== undefined) {
        setCalAutoDeadlines(prefsMap["calendar.auto_deadlines"] === "true");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Handle OAuth callback query params on mount
  useEffect(() => {
    const gmail = searchParams.get("gmail");
    const gcal = searchParams.get("gcal");
    const reason = searchParams.get("reason");
    const calendarName = searchParams.get("calendar");

    if (gmail === "connected") {
      setNotification({ type: "success", message: "Gmail connected successfully." });
    } else if (gmail === "error") {
      setNotification({
        type: "error",
        message: `Gmail connection failed${reason ? `: ${reason}` : ""}.`,
      });
    }

    if (gcal === "connected") {
      const label = calendarName ? ` (${calendarName})` : "";
      setNotification({
        type: "success",
        message: `Google Calendar connected${label}.`,
      });
    } else if (gcal === "error") {
      setNotification({
        type: "error",
        message: `Calendar connection failed${reason ? `: ${reason}` : ""}.`,
      });
    }

    if (gmail ?? gcal) {
      const p = new URLSearchParams(searchParams.toString());
      ["gmail", "gcal", "reason", "calendar"].forEach((k) => p.delete(k));
      const qs = p.toString();
      router.replace(`/settings/integrations${qs ? `?${qs}` : ""}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Preference persistence ─────────────────────────────────────────────────

  async function savePref(key: string, value: string) {
    const orgId = profile?.organization_id;
    if (!orgId) return;
    const supabase = createClient();
    try {
      await supabase
        .from("platform_config")
        .upsert(
          { organization_id: orgId, key, value },
          { onConflict: "organization_id,key" },
        );
    } catch {
      // Non-critical preference save — ignore failures silently
    }
  }

  // ── OAuth actions ──────────────────────────────────────────────────────────

  async function handleConnectGmail() {
    setConnecting("gmail");
    try {
      const redirectUri = `${window.location.origin}/api/email/callback`;
      const res = await fetch(
        `/api/email/auth?redirect_uri=${encodeURIComponent(redirectUri)}`,
      );
      if (!res.ok) throw new Error("auth failed");
      const body = (await res.json()) as { url: string };
      window.location.href = body.url;
    } catch {
      setConnecting(null);
    }
  }

  async function handleConnectCalendar() {
    setConnecting("gcal");
    try {
      const redirectUri = `${window.location.origin}/api/calendar/callback`;
      const res = await fetch(
        `/api/calendar/auth?redirect_uri=${encodeURIComponent(redirectUri)}`,
      );
      if (!res.ok) throw new Error("auth failed");
      const body = (await res.json()) as { url: string };
      window.location.href = body.url;
    } catch {
      setConnecting(null);
    }
  }

  async function handleSyncEmail() {
    setSyncing("gmail");
    try {
      await fetch("/api/email/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      void load();
    } finally {
      setSyncing(null);
    }
  }

  async function handleSyncCalendar() {
    setSyncing("gcal");
    try {
      await fetch("/api/calendar/sync", { method: "POST" });
      void load();
    } finally {
      setSyncing(null);
    }
  }

  async function handleDisconnect() {
    if (!disconnectTarget) return;
    setDisconnecting(true);
    const supabase = createClient();
    try {
      if (disconnectTarget === "gmail" && emailConn?.id) {
        await supabase
          .from("email_connections")
          .update({ sync_status: "disconnected" })
          .eq("id", emailConn.id);
        setEmailConn(null);
      } else if (disconnectTarget === "gcal" && calConn?.id) {
        await supabase
          .from("calendar_connections")
          .update({ sync_status: "disconnected" })
          .eq("id", calConn.id);
        setCalConn(null);
      }
      setNotification({
        type: "success",
        message:
          disconnectTarget === "gmail"
            ? "Gmail disconnected."
            : "Google Calendar disconnected.",
      });
      setDisconnectTarget(null);
    } finally {
      setDisconnecting(false);
    }
  }

  // ── Agent actions ──────────────────────────────────────────────────────────

  async function handleRunNow(id: string, route: string) {
    setRunning((p) => ({ ...p, [id]: true }));
    setRunResult((p) => ({ ...p, [id]: null }));
    try {
      const res = await fetch(route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setRunResult((p) => ({ ...p, [id]: res.ok ? "ok" : "err" }));
      if (res.ok) setTimeout(() => void load(), 1500);
    } catch {
      setRunResult((p) => ({ ...p, [id]: "err" }));
    } finally {
      setRunning((p) => ({ ...p, [id]: false }));
    }
  }

  async function handleSaveKey(svc: Enums<"integration_service">) {
    const key = editKey[svc]?.trim() ?? "";
    if (!key) return;
    setSaving((p) => ({ ...p, [svc]: true }));
    setSaveResult((p) => ({ ...p, [svc]: null }));
    try {
      const res = await fetch("/api/integrations/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service_name: svc, api_key: key }),
      });
      setSaveResult((p) => ({ ...p, [svc]: res.ok ? "ok" : "err" }));
      if (res.ok) {
        setEditKey((p) => ({ ...p, [svc]: "" }));
        void load();
      }
    } catch {
      setSaveResult((p) => ({ ...p, [svc]: "err" }));
    } finally {
      setSaving((p) => ({ ...p, [svc]: false }));
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function getKey(svc: Enums<"integration_service">): IntegrationKeyRow | undefined {
    return keys.find((k) => k.service_name === svc);
  }

  function isConfigured(svc: Enums<"integration_service">): boolean {
    return Boolean(getKey(svc)?.is_active);
  }

  function lastSync(agentType: string): string {
    const run = lastRuns[agentType];
    if (!run?.completed_at) return "Never";
    return formatRelative(run.completed_at);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <>
      {/* OAuth callback notification banner */}
      {notification && (
        <div
          className={`mb-6 flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${
            notification.type === "success"
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          <span>{notification.message}</span>
          <button
            type="button"
            onClick={() => setNotification(null)}
            aria-label="Dismiss notification"
            className="opacity-70 hover:opacity-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}

      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
            Integrations
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Connect data sources and services to power autonomous grant discovery.
          </p>
        </div>

        {/* ── Section 1: OAuth Connections ──────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-navy-400">
            OAuth Connections
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Gmail */}
            <GmailCard
              conn={emailConn}
              autoSync={emailAutoSync}
              syncFreq={emailSyncFreq}
              isConnecting={connecting === "gmail"}
              isSyncing={syncing === "gmail"}
              onConnect={() => void handleConnectGmail()}
              onSync={() => void handleSyncEmail()}
              onDisconnect={() => setDisconnectTarget("gmail")}
              onAutoSyncChange={(v) => {
                setEmailAutoSync(v);
                void savePref("email.auto_sync_enabled", String(v));
              }}
              onSyncFreqChange={(v) => {
                setEmailSyncFreq(v);
                void savePref("email.sync_frequency", v);
              }}
            />

            {/* Google Calendar */}
            <CalendarCard
              conn={calConn}
              autoSync={calAutoSync}
              autoDeadlines={calAutoDeadlines}
              isConnecting={connecting === "gcal"}
              isSyncing={syncing === "gcal"}
              onConnect={() => void handleConnectCalendar()}
              onSync={() => void handleSyncCalendar()}
              onDisconnect={() => setDisconnectTarget("gcal")}
              onAutoSyncChange={(v) => {
                setCalAutoSync(v);
                void savePref("calendar.auto_sync_enabled", String(v));
              }}
              onAutoDeadlinesChange={(v) => {
                setCalAutoDeadlines(v);
                void savePref("calendar.auto_deadlines", String(v));
              }}
            />
          </div>
        </section>

        {/* ── Section 2: Platform-Managed ───────────────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-navy-400">
            Platform-Managed
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <PlatformCard
              name="Grants.gov"
              icon={Globe}
              description="Federal grant opportunities from 1,000+ agencies — $700B+ in annual funding."
              lastSync={lastSync("grants_gov_research")}
              isRunning={running["grants_gov"] ?? false}
              runResult={runResult["grants_gov"]}
              onRunNow={() => void handleRunNow("grants_gov", "/api/agents/grants-gov")}
            />
            <PlatformCard
              name="ProPublica 990"
              icon={Shield}
              description="IRS 990 filings — foundation giving histories and private foundation grant data."
              lastSync={lastSync("propublica_mining")}
              isRunning={running["propublica"] ?? false}
              runResult={runResult["propublica"]}
              onRunNow={() => void handleRunNow("propublica", "/api/agents/propublica")}
            />
            <PlatformCard
              name="State Grant Portals"
              icon={Globe}
              description={`Scraping state grant portals for local funding. ${statePortalCount} state${statePortalCount !== 1 ? "s" : ""} currently active.`}
              lastSync={lastSync("state_portal")}
              isRunning={running["state_portals"] ?? false}
              runResult={runResult["state_portals"]}
              onRunNow={() =>
                void handleRunNow("state_portals", "/api/agents/state-portals")
              }
              badgeLabel={`${statePortalCount} Active`}
              configurePath="/settings/state-portals"
            />
          </div>
        </section>

        {/* ── Section 3 & 4: Self-Connect + Resend ─────────────────────── */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-navy-400">
            Self-Connect — API Key Required
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {/* SAM.gov */}
            <KeyedCard
              name="SAM.gov"
              icon={Key}
              description="Federal contracts and grant opportunities. Free API key via sam.gov (registration up to 10 business days)."
              lastSync={lastSync("sam_gov_research")}
              integrationKey={getKey("sam_gov")}
              configured={isConfigured("sam_gov")}
              editValue={editKey["sam_gov"] ?? ""}
              showValue={showKey["sam_gov"] ?? false}
              isSaving={saving["sam_gov"] ?? false}
              saveResult={saveResult["sam_gov"]}
              isRunning={running["sam_gov"] ?? false}
              runResult={runResult["sam_gov"]}
              onEditChange={(v) => setEditKey((p) => ({ ...p, sam_gov: v }))}
              onToggleShow={() =>
                setShowKey((p) => ({ ...p, sam_gov: !p["sam_gov"] }))
              }
              onSave={() => void handleSaveKey("sam_gov")}
              onRunNow={() => void handleRunNow("sam_gov", "/api/agents/sam-gov")}
            />

            {/* 2Captcha */}
            <KeyedCard
              name="2Captcha"
              icon={Shield}
              description="CAPTCHA solving for browser form automation. Supports reCAPTCHA v2 and hCaptcha."
              lastSync="N/A"
              integrationKey={getKey("two_captcha")}
              configured={isConfigured("two_captcha")}
              editValue={editKey["two_captcha"] ?? ""}
              showValue={showKey["two_captcha"] ?? false}
              isSaving={saving["two_captcha"] ?? false}
              saveResult={saveResult["two_captcha"]}
              onEditChange={(v) => setEditKey((p) => ({ ...p, two_captcha: v }))}
              onToggleShow={() =>
                setShowKey((p) => ({ ...p, two_captcha: !p["two_captcha"] }))
              }
              onSave={() => void handleSaveKey("two_captcha")}
            />

            {/* Resend — platform-managed env var, read-only status */}
            <ResendStatusCard configured={resendEnvConfigured} />
          </div>
        </section>
      </div>

      {/* Disconnect confirmation modal */}
      <Modal
        isOpen={!!disconnectTarget}
        onClose={() => setDisconnectTarget(null)}
        title={`Disconnect ${disconnectTarget === "gmail" ? "Gmail" : "Google Calendar"}?`}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-navy-400">
            {disconnectTarget === "gmail"
              ? "This will stop email syncing. Your existing synced threads will remain. You can reconnect at any time."
              : "This will stop calendar sync. Existing calendar events will remain. You can reconnect at any time."}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setDisconnectTarget(null)}
              disabled={disconnecting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => void handleDisconnect()}
              isLoading={disconnecting}
            >
              Disconnect
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ── Page export with Suspense (required for useSearchParams) ──────────────────

export default function IntegrationsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <LoadingSpinner size="lg" />
        </div>
      }
    >
      <IntegrationsContent />
    </Suspense>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

// Toggle switch (no Switch component in UI library)
function Toggle({
  id,
  checked,
  onChange,
}: {
  id?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-1 ${
        checked ? "bg-teal-500" : "bg-navy-600"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : "translate-x-1"
        }`}
      />
    </button>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      className={`mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
        active
          ? "bg-green-400 shadow-[0_0_6px_theme(colors.green.400)]"
          : "bg-navy-600"
      }`}
      aria-label={active ? "Active" : "Inactive"}
    />
  );
}

// ── Gmail Card ────────────────────────────────────────────────────────────────

type GmailCardProps = {
  conn: EmailConn | null;
  autoSync: boolean;
  syncFreq: string;
  isConnecting: boolean;
  isSyncing: boolean;
  onConnect: () => void;
  onSync: () => void;
  onDisconnect: () => void;
  onAutoSyncChange: (v: boolean) => void;
  onSyncFreqChange: (v: string) => void;
};

function GmailCard({
  conn,
  autoSync,
  syncFreq,
  isConnecting,
  isSyncing,
  onConnect,
  onSync,
  onDisconnect,
  onAutoSyncChange,
  onSyncFreqChange,
}: GmailCardProps) {
  const connected = !!conn;

  return (
    <Card noPadding>
      <div className="flex flex-col gap-4 p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                connected ? "bg-teal-500/15 text-teal-400" : "bg-navy-600/40 text-navy-400"
              }`}
            >
              <Mail className="h-5 w-5" aria-hidden />
            </div>
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-navy-900">Gmail</p>
              <Badge color={connected ? "green" : "gray"}>
                {connected ? "Connected" : "Disconnected"}
              </Badge>
            </div>
          </div>
          <StatusDot active={connected} />
        </div>

        {connected ? (
          <>
            {/* Connected email address */}
            <div className="flex items-center gap-1.5 rounded-md border border-navy-200 bg-navy-50 px-3 py-2">
              <Mail className="h-3.5 w-3.5 shrink-0 text-navy-400" aria-hidden />
              <span className="truncate text-xs text-navy-700">{conn.email_address}</span>
            </div>

            {/* Last sync */}
            {conn.last_sync_at && (
              <div className="flex items-center gap-1.5 text-xs text-navy-500">
                <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>Last sync: {formatRelative(conn.last_sync_at)}</span>
              </div>
            )}

            {/* Auto-sync toggle */}
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="gmail-auto-sync" className="text-xs text-navy-400">
                Auto-sync
              </label>
              <Toggle
                id="gmail-auto-sync"
                checked={autoSync}
                onChange={onAutoSyncChange}
              />
            </div>

            {/* Frequency selector — only shown when auto-sync is on */}
            {autoSync && (
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-xs text-navy-500">Frequency:</span>
                <select
                  value={syncFreq}
                  onChange={(e) => onSyncFreqChange(e.target.value)}
                  className="flex-1 rounded-md border border-navy-200 bg-white px-2 py-1 text-xs text-navy-900 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                >
                  {SYNC_FREQ_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" isLoading={isSyncing} onClick={onSync}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Sync Now
              </Button>
              <button
                type="button"
                onClick={onDisconnect}
                className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:border-red-300 hover:bg-red-100"
              >
                <Unlink className="h-3.5 w-3.5" aria-hidden />
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs leading-relaxed text-navy-500">
              Sync email threads, auto-link correspondence to CRM records, and enable smart
              follow-up sequences.
            </p>
            <Button
              size="sm"
              variant="secondary"
              isLoading={isConnecting}
              onClick={onConnect}
            >
              <Mail className="h-3.5 w-3.5" aria-hidden />
              Connect Gmail
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

// ── Calendar Card ─────────────────────────────────────────────────────────────

type CalendarCardProps = {
  conn: CalConn | null;
  autoSync: boolean;
  autoDeadlines: boolean;
  isConnecting: boolean;
  isSyncing: boolean;
  onConnect: () => void;
  onSync: () => void;
  onDisconnect: () => void;
  onAutoSyncChange: (v: boolean) => void;
  onAutoDeadlinesChange: (v: boolean) => void;
};

function CalendarCard({
  conn,
  autoSync,
  autoDeadlines,
  isConnecting,
  isSyncing,
  onConnect,
  onSync,
  onDisconnect,
  onAutoSyncChange,
  onAutoDeadlinesChange,
}: CalendarCardProps) {
  const connected = !!conn;

  return (
    <Card noPadding>
      <div className="flex flex-col gap-4 p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                connected ? "bg-teal-500/15 text-teal-400" : "bg-navy-600/40 text-navy-400"
              }`}
            >
              <CalendarDays className="h-5 w-5" aria-hidden />
            </div>
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-navy-900">Google Calendar</p>
              <Badge color={connected ? "green" : "gray"}>
                {connected ? "Connected" : "Disconnected"}
              </Badge>
            </div>
          </div>
          <StatusDot active={connected} />
        </div>

        {connected ? (
          <>
            {/* Calendar name */}
            {conn.calendar_name && (
              <div className="flex items-center gap-1.5 rounded-md border border-navy-200 bg-navy-50 px-3 py-2">
                <CalendarDays className="h-3.5 w-3.5 shrink-0 text-navy-400" aria-hidden />
                <span className="truncate text-xs text-navy-700">{conn.calendar_name}</span>
              </div>
            )}

            {/* Last sync */}
            {conn.last_sync_at && (
              <div className="flex items-center gap-1.5 text-xs text-navy-500">
                <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>Last sync: {formatRelative(conn.last_sync_at)}</span>
              </div>
            )}

            {/* Auto-sync toggle */}
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="cal-auto-sync" className="text-xs text-navy-400">
                Auto-sync
              </label>
              <Toggle
                id="cal-auto-sync"
                checked={autoSync}
                onChange={onAutoSyncChange}
              />
            </div>

            {/* Auto-deadlines checkbox */}
            <label className="flex cursor-pointer items-start gap-2 text-xs text-text-muted">
              <input
                type="checkbox"
                checked={autoDeadlines}
                onChange={(e) => onAutoDeadlinesChange(e.target.checked)}
                className="mt-0.5 rounded border-border bg-surface accent-primary"
              />
              Automatically create calendar events for new deadlines
            </label>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" isLoading={isSyncing} onClick={onSync}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Sync Deadlines Now
              </Button>
              <button
                type="button"
                onClick={onDisconnect}
                className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:border-red-300 hover:bg-red-100"
              >
                <Unlink className="h-3.5 w-3.5" aria-hidden />
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs leading-relaxed text-navy-500">
              Auto-sync grant deadlines to your calendar and create events for upcoming
              submissions.
            </p>
            <Button
              size="sm"
              variant="secondary"
              isLoading={isConnecting}
              onClick={onConnect}
            >
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              Connect Calendar
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

// ── Platform Card (existing, unchanged) ───────────────────────────────────────

type PlatformCardProps = {
  name: string;
  icon: LucideIcon;
  description: string;
  lastSync: string;
  isRunning: boolean;
  runResult: "ok" | "err" | null | undefined;
  onRunNow: () => void;
  badgeLabel?: string;
  configurePath?: string;
};

function PlatformCard({
  name,
  icon: Icon,
  description,
  lastSync,
  isRunning,
  runResult,
  onRunNow,
  badgeLabel,
  configurePath,
}: PlatformCardProps) {
  return (
    <Card noPadding>
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 text-teal-400">
              <Icon className="h-5 w-5" aria-hidden />
            </div>
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-navy-900">{name}</p>
              <Badge color={badgeLabel ? "teal" : "green"}>{badgeLabel ?? "Always Active"}</Badge>
            </div>
          </div>
          <StatusDot active />
        </div>

        <p className="text-xs leading-relaxed text-navy-500">{description}</p>

        <div className="flex items-center gap-1.5 text-xs text-navy-500">
          <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>Last sync: {lastSync}</span>
        </div>

        <div className="flex items-center gap-2">
          <RunNowButton isRunning={isRunning} result={runResult} onPress={onRunNow} />
          {configurePath && (
            <Link
              href={configurePath}
              className="inline-flex items-center gap-1.5 rounded-lg border border-navy-200 bg-white px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:border-navy-300 hover:bg-navy-50 hover:text-navy-900"
            >
              <Settings2 className="h-3.5 w-3.5" aria-hidden />
              Configure
            </Link>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Keyed Card (existing, unchanged) ─────────────────────────────────────────

type KeyedCardProps = {
  name: string;
  icon: LucideIcon;
  description: string;
  lastSync: string;
  integrationKey: IntegrationKeyRow | undefined;
  configured: boolean;
  editValue: string;
  showValue: boolean;
  isSaving: boolean;
  saveResult: "ok" | "err" | null | undefined;
  isRunning?: boolean;
  runResult?: "ok" | "err" | null | undefined;
  onEditChange: (v: string) => void;
  onToggleShow: () => void;
  onSave: () => void;
  onRunNow?: () => void;
};

function KeyedCard({
  name,
  icon: Icon,
  description,
  lastSync,
  integrationKey,
  configured,
  editValue,
  showValue,
  isSaving,
  saveResult,
  isRunning,
  runResult,
  onEditChange,
  onToggleShow,
  onSave,
  onRunNow,
}: KeyedCardProps) {
  return (
    <Card noPadding>
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                configured
                  ? "bg-teal-500/15 text-teal-400"
                  : "bg-navy-600/40 text-navy-400"
              }`}
            >
              <Icon className="h-5 w-5" aria-hidden />
            </div>
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-navy-900">{name}</p>
              <Badge color={configured ? "green" : "gray"}>
                {configured ? "Connected" : "Not Configured"}
              </Badge>
            </div>
          </div>
          <StatusDot active={configured} />
        </div>

        <p className="text-xs leading-relaxed text-navy-500">{description}</p>

        {/* Current key hint */}
        {integrationKey && (
          <div className="flex items-center gap-1.5 rounded-md border border-navy-200 bg-navy-50 px-3 py-1.5">
            <Key className="h-3.5 w-3.5 shrink-0 text-navy-400" aria-hidden />
            <span className="font-mono text-xs text-navy-700">
              {integrationKey.key_hint}
            </span>
            {integrationKey.validation_status === "valid" && (
              <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-green-400" aria-hidden />
            )}
          </div>
        )}

        {/* Key input + save */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showValue ? "text" : "password"}
              value={editValue}
              onChange={(e) => onEditChange(e.target.value)}
              placeholder={configured ? "Replace existing key…" : "Paste API key…"}
              autoComplete="off"
              className="block w-full rounded-lg border border-navy-300 bg-white px-3 py-2 pr-9 font-mono text-xs text-navy-900 placeholder:text-navy-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
            <button
              type="button"
              onClick={onToggleShow}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-navy-400 hover:text-navy-600 focus:outline-none"
              aria-label={showValue ? "Hide key" : "Show key"}
            >
              {showValue ? (
                <EyeOff className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Eye className="h-3.5 w-3.5" aria-hidden />
              )}
            </button>
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={!editValue.trim() || isSaving}
            isLoading={isSaving}
            onClick={onSave}
          >
            {saveResult === "ok" ? (
              <Check className="h-3.5 w-3.5 text-green-400" aria-hidden />
            ) : saveResult === "err" ? (
              <X className="h-3.5 w-3.5 text-red-400" aria-hidden />
            ) : (
              "Save"
            )}
          </Button>
        </div>

        {lastSync !== "N/A" && (
          <div className="flex items-center gap-1.5 text-xs text-navy-500">
            <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Last sync: {lastSync}</span>
          </div>
        )}

        {onRunNow && (
          <div className="flex items-center gap-2">
            <RunNowButton
              isRunning={isRunning ?? false}
              result={runResult}
              onPress={onRunNow}
              disabled={!configured}
            />
            {!configured && (
              <span className="text-xs text-navy-500">Key required to run</span>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ── Resend Status Card (read-only, platform-managed env var) ──────────────────

function ResendStatusCard({ configured }: { configured: boolean }) {
  return (
    <Card noPadding>
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                configured ? "bg-teal-500/15 text-teal-400" : "bg-navy-600/40 text-navy-400"
              }`}
            >
              <Zap className="h-5 w-5" aria-hidden />
            </div>
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-navy-900">Resend</p>
              <Badge color={configured ? "green" : "gray"}>
                {configured ? "Configured" : "Not Configured"}
              </Badge>
            </div>
          </div>
          <StatusDot active={configured} />
        </div>
        <p className="text-xs leading-relaxed text-navy-500">
          Resend is used as a fallback email sender when Gmail is not connected.
          Configured via the{" "}
          <code className="rounded bg-navy-100 px-1 font-mono text-navy-700">
            RESEND_API_KEY
          </code>{" "}
          environment variable.
        </p>
      </div>
    </Card>
  );
}

// ── Run Now Button (existing, unchanged) ──────────────────────────────────────

type RunNowButtonProps = {
  isRunning: boolean;
  result: "ok" | "err" | null | undefined;
  onPress: () => void;
  disabled?: boolean;
};

function RunNowButton({ isRunning, result, onPress, disabled }: RunNowButtonProps) {
  return (
    <Button
      size="sm"
      variant={result === "err" ? "danger" : "secondary"}
      isLoading={isRunning}
      disabled={disabled ?? isRunning}
      onClick={onPress}
    >
      {result === "ok" ? (
        <>
          <Check className="h-3.5 w-3.5 text-green-400" aria-hidden />
          Queued
        </>
      ) : result === "err" ? (
        <>
          <X className="h-3.5 w-3.5" aria-hidden />
          Failed
        </>
      ) : (
        <>
          <Play className="h-3.5 w-3.5" aria-hidden />
          Run Now
        </>
      )}
    </Button>
  );
}
