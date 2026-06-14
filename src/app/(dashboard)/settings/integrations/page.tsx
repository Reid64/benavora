"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Clock,
  Eye,
  EyeOff,
  Globe,
  Key,
  Play,
  Settings2,
  Shield,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import Link from "next/link";

import { Badge, Button, Card, LoadingSpinner } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatRelative } from "@/lib/utils/formatters";
import type { Enums } from "@/types/database";

type IntegrationKeyRow = {
  id: string;
  service_name: Enums<"integration_service">;
  is_active: boolean;
  last_validated_at: string | null;
  validation_status: string;
  key_hint: string;
  created_at: string;
};

const AGENT_TYPES = [
  "grants_gov_research",
  "sam_gov_research",
  "propublica_mining",
  "state_portal",
] as const;

export default function IntegrationsPage() {
  const [keys, setKeys] = useState<IntegrationKeyRow[]>([]);
  const [lastRuns, setLastRuns] = useState<
    Record<string, { completed_at: string | null; status: string } | null>
  >({});
  const [statePortalCount, setStatePortalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [runResult, setRunResult] = useState<Record<string, "ok" | "err" | null>>({});

  const [editKey, setEditKey] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [saveResult, setSaveResult] = useState<Record<string, "ok" | "err" | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    try {
      const [keysRes, runsRes, portalsRes] = await Promise.all([
        fetch("/api/integrations/keys"),
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
      ]);

      if (keysRes.ok) {
        const body = (await keysRes.json()) as { keys: IntegrationKeyRow[] };
        setKeys(body.keys ?? []);
      }

      const runMap: Record<string, { completed_at: string | null; status: string } | null> = {};
      for (const run of runsRes.data ?? []) {
        if (!runMap[run.agent_type]) {
          runMap[run.agent_type] = { completed_at: run.completed_at, status: run.status ?? "" };
        }
      }
      setLastRuns(runMap);
      setStatePortalCount(portalsRes.count ?? 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
          Integrations
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Connect data sources and services to power autonomous grant discovery.
        </p>
      </div>

      {/* Platform-managed */}
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

      {/* Self-connect */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-navy-400">
          Self-Connect — API Key Required
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
            onToggleShow={() => setShowKey((p) => ({ ...p, sam_gov: !p["sam_gov"] }))}
            onSave={() => void handleSaveKey("sam_gov")}
            onRunNow={() => void handleRunNow("sam_gov", "/api/agents/sam-gov")}
          />
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
          <KeyedCard
            name="Resend (Email)"
            icon={Key}
            description="Transactional and cold outreach email sending for campaign automation."
            lastSync="N/A"
            integrationKey={getKey("resend")}
            configured={isConfigured("resend")}
            editValue={editKey["resend"] ?? ""}
            showValue={showKey["resend"] ?? false}
            isSaving={saving["resend"] ?? false}
            saveResult={saveResult["resend"]}
            onEditChange={(v) => setEditKey((p) => ({ ...p, resend: v }))}
            onToggleShow={() =>
              setShowKey((p) => ({ ...p, resend: !p["resend"] }))
            }
            onSave={() => void handleSaveKey("resend")}
          />
        </div>
      </section>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

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
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-ink-900/40 px-3 py-1.5 text-xs font-medium text-navy-300 transition hover:border-white/25 hover:bg-ink-900/70 hover:text-navy-100"
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
          <div className="flex items-center gap-1.5 rounded-md border border-white/10 bg-ink-900/60 px-3 py-1.5">
            <Key className="h-3.5 w-3.5 shrink-0 text-navy-400" aria-hidden />
            <span className="font-mono text-xs text-navy-300">
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
              className="block w-full rounded-lg border border-white/15 bg-ink-900/60 px-3 py-2 pr-9 font-mono text-xs text-navy-100 placeholder:text-navy-500 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
            />
            <button
              type="button"
              onClick={onToggleShow}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-navy-400 hover:text-navy-200 focus:outline-none"
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

function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      className={`mt-0.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
        active ? "bg-green-400 shadow-[0_0_6px_theme(colors.green.400)]" : "bg-red-400"
      }`}
      aria-label={active ? "Active" : "Not configured"}
    />
  );
}

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
      disabled={disabled || isRunning}
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
