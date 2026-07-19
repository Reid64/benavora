"use client";

// Reputation Intelligence (PLATFORM_VISION_ARCHITECTURE.md Pillar 15,
// AGENTS_v2.md AG-18). Reads unread reputation_alerts for the org via
// GET /api/intelligence/reputation, and lets a writer run an on-demand
// DuckDuckGo + Claude sweep for any named entity via POST. reputation_signals
// carries no entity name (migration 076) - only entity_id/entity_type - so
// signals returned directly from a Check Now call are shown under the name
// the caller typed, while alerts read back from the org feed fall back to a
// generic "Monitored {entity_type}" label since nothing joins a name today.

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Search,
  ShieldAlert,
} from "lucide-react";

import { Input, Select } from "@/components/ui";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";

const CANVAS = "#D6E4F0";
const CARD_BG = "#FFFFFF";
const BORDER = "#C3D3E2";
const TEXT_PRIMARY = "#0F172A";
const TEXT_SECONDARY = "#64748B";
const TEXT_MUTED = "#94A3B8";
const ERROR_BG = "#FEE2E2";
const ERROR_BORDER = "#FECACA";
const ERROR_TEXT = "#B91C1C";
const ACCENT = "#0077B6";

type Severity = "critical" | "high" | "medium" | "low" | "positive";

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "positive"];

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  positive: "Positive",
};

// Per CURRENT TASK spec: CRITICAL=#DC2626, HIGH=#F59E0B, MEDIUM=#0EA5E9, LOW=#6B7280.
// "positive" isn't in the task's 4-tier spec but is a real reputation_signals.severity
// value (migration 076) — kept with its own color so those rows aren't miscolored.
const SEVERITY_COLORS: Record<Severity, string> = {
  critical: "#DC2626",
  high: "#F59E0B",
  medium: "#0EA5E9",
  low: "#6B7280",
  positive: "#16A34A",
};

const ENTITY_TYPE_OPTIONS = [
  { label: "Funder", value: "funder" },
  { label: "Corporate donor", value: "corporate" },
  { label: "Foundation", value: "foundation" },
];

function normalizeSeverity(value: string | null | undefined): Severity {
  return SEVERITY_ORDER.includes(value as Severity) ? (value as Severity) : "medium";
}

interface ReputationSignal {
  id: string;
  entity_id: string;
  entity_type: string;
  signal_type: string;
  severity: string;
  headline: string;
  summary: string | null;
  source_url: string | null;
  signal_date: string | null;
  verified: boolean;
}

interface ReputationAlertRow {
  id: string;
  signal_id: string;
  status: string;
  created_at: string;
  reputation_signals: ReputationSignal | ReputationSignal[] | null;
}

/** A unified card the feed renders, sourced either from the org's alert feed or a live Check Now sweep. */
interface FeedItem {
  key: string;
  alertId: string | null;
  entityName: string;
  entityType: string;
  signalType: string;
  severity: Severity;
  headline: string;
  summary: string | null;
  sourceUrl: string | null;
  signalDate: string | null;
}

function toEntityTypeLabel(entityType: string): string {
  if (!entityType) return "Entity";
  return entityType.charAt(0).toUpperCase() + entityType.slice(1);
}

function alertToFeedItem(alert: ReputationAlertRow): FeedItem | null {
  const signal = Array.isArray(alert.reputation_signals)
    ? alert.reputation_signals[0]
    : alert.reputation_signals;
  if (!signal) return null;

  return {
    key: alert.id,
    alertId: alert.id,
    entityName: `Monitored ${toEntityTypeLabel(signal.entity_type)}`,
    entityType: signal.entity_type,
    signalType: signal.signal_type,
    severity: normalizeSeverity(signal.severity),
    headline: signal.headline,
    summary: signal.summary,
    sourceUrl: signal.source_url,
    signalDate: signal.signal_date,
  };
}

export default function ReputationIntelligencePage() {
  const { profile } = useProfile();
  const editable = canEdit(profile?.role);

  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<Severity | "all">("all");

  const [entityName, setEntityName] = useState("");
  const [entityType, setEntityType] = useState("funder");
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [checkNotice, setCheckNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/intelligence/reputation");
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((payload as { error?: string }).error ?? "Could not load reputation alerts.");
        return;
      }
      const alerts = ((payload as { alerts?: ReputationAlertRow[] }).alerts ?? [])
        .map(alertToFeedItem)
        .filter((item): item is FeedItem => item !== null);
      setItems((prev) => {
        // Preserve any live Check Now results (no alertId) already in the list.
        const live = prev.filter((item) => item.alertId === null);
        return [...live, ...alerts];
      });
    } catch {
      setError("Could not reach the reputation intelligence service.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      await load();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [load]);

  async function handleMarkRead(item: FeedItem) {
    setDismissing((prev) => new Set(prev).add(item.key));

    if (!item.alertId) {
      // Locally-surfaced Check Now result — nothing persisted to dismiss server-side.
      setItems((prev) => prev.filter((row) => row.key !== item.key));
      return;
    }

    try {
      const res = await fetch("/api/intelligence/reputation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId: item.alertId, status: "read" }),
      });
      if (res.ok) {
        setItems((prev) => prev.filter((row) => row.key !== item.key));
      } else {
        const payload = await res.json().catch(() => ({}));
        setError((payload as { error?: string }).error ?? "Could not mark the alert as read.");
      }
    } catch {
      setError("Could not reach the reputation intelligence service.");
    } finally {
      setDismissing((prev) => {
        const next = new Set(prev);
        next.delete(item.key);
        return next;
      });
    }
  }

  async function handleCheckNow(event: React.FormEvent) {
    event.preventDefault();
    const trimmedName = entityName.trim();
    if (!trimmedName) {
      setCheckError("Enter a name to check.");
      return;
    }

    setChecking(true);
    setCheckError(null);
    setCheckNotice(null);

    try {
      const res = await fetch("/api/intelligence/reputation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId: crypto.randomUUID(),
          entityType,
          entityName: trimmedName,
        }),
      });
      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        setCheckError((payload as { error?: string }).error ?? "Reputation check failed.");
        return;
      }

      const signals = ((payload as { signals?: ReputationSignal[] }).signals ?? []);
      if (signals.length === 0) {
        setCheckNotice(`No reputation signals found for "${trimmedName}".`);
      } else {
        const newItems: FeedItem[] = signals.map((signal) => ({
          key: signal.id,
          alertId: null,
          entityName: trimmedName,
          entityType: signal.entity_type,
          signalType: signal.signal_type,
          severity: normalizeSeverity(signal.severity),
          headline: signal.headline,
          summary: signal.summary,
          sourceUrl: signal.source_url,
          signalDate: signal.signal_date,
        }));
        setItems((prev) => [...newItems, ...prev]);
        setCheckNotice(
          `Found ${signals.length} signal${signals.length !== 1 ? "s" : ""} for "${trimmedName}".`,
        );
      }
      setEntityName("");
    } catch {
      setCheckError("Could not reach the reputation intelligence service.");
    } finally {
      setChecking(false);
    }
  }

  const tabCounts: Record<Severity | "all", number> = {
    all: items.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    positive: 0,
  };
  for (const item of items) tabCounts[item.severity] += 1;

  const visibleItems = activeTab === "all" ? items : items.filter((i) => i.severity === activeTab);

  const grouped =
    activeTab === "all"
      ? SEVERITY_ORDER.map((severity) => ({
          severity,
          items: items.filter((item) => item.severity === severity),
        })).filter((group) => group.items.length > 0)
      : [{ severity: activeTab, items: visibleItems }].filter((g) => g.items.length > 0);

  const showEmpty = !loading && !error && visibleItems.length === 0;

  return (
    <div className="min-h-screen space-y-6 p-6" style={{ backgroundColor: CANVAS }}>
      <div style={{ borderLeft: `4px solid ${ACCENT}`, paddingLeft: "1rem" }}>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: TEXT_PRIMARY }}>
          Reputation Intelligence
        </h1>
        <p className="mt-1 text-sm" style={{ color: TEXT_SECONDARY }}>
          Monitor your funders and donors for reputation risks before investing time in applications.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg px-4 py-3 text-sm"
          style={{ border: `1px solid ${ERROR_BORDER}`, backgroundColor: ERROR_BG, color: ERROR_TEXT }}
        >
          {error}
        </div>
      )}

      {editable && (
        <div
          className="rounded-xl p-5"
          style={{ backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: "0 4px 20px rgba(15,23,42,0.08)" }}
        >
          <div className="flex items-center gap-2">
            <Search className="h-5 w-5" style={{ color: ACCENT }} aria-hidden />
            <h3 className="text-base font-semibold" style={{ color: TEXT_PRIMARY }}>
              Add Entity to Monitor
            </h3>
          </div>
          <p className="mt-0.5 text-sm" style={{ color: TEXT_SECONDARY }}>
            Runs an on-demand search for lawsuits, fraud, leadership changes, and other
            reputation signals tied to this name.
          </p>

          <form onSubmit={handleCheckNow} className="mt-4 flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-1">
              <Input
                label="Funder or donor name"
                placeholder="e.g. The Smith Family Foundation"
                value={entityName}
                onChange={(e) => setEntityName(e.target.value)}
                disabled={checking}
              />
            </div>
            <div className="w-48">
              <Select
                label="Entity type"
                options={ENTITY_TYPE_OPTIONS}
                value={entityType}
                onChange={(e) => setEntityType(e.target.value)}
                disabled={checking}
              />
            </div>
            <button
              type="submit"
              disabled={checking}
              className="inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60"
              style={{ backgroundColor: ACCENT, color: "#FFFFFF" }}
            >
              <Search className="h-4 w-4" aria-hidden />
              {checking ? "Checking…" : "Check Now"}
            </button>
          </form>

          {checkError && (
            <p className="mt-3 text-sm" style={{ color: ERROR_TEXT }}>
              {checkError}
            </p>
          )}
          {checkNotice && !checkError && (
            <p className="mt-3 text-sm" style={{ color: TEXT_SECONDARY }}>
              {checkNotice}
            </p>
          )}
        </div>
      )}

      {/* Severity filter tabs */}
      <div className="flex flex-wrap gap-2">
        {(["all", ...SEVERITY_ORDER] as const).map((tab) => {
          const isActive = activeTab === tab;
          const color = tab === "all" ? ACCENT : SEVERITY_COLORS[tab];
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="rounded-full px-4 py-1.5 text-sm font-semibold transition"
              style={{
                backgroundColor: isActive ? color : CARD_BG,
                color: isActive ? "#FFFFFF" : color,
                border: `1px solid ${color}`,
              }}
            >
              {tab === "all" ? "All" : SEVERITY_LABELS[tab]} ({tabCounts[tab]})
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex min-h-40 w-full items-center justify-center gap-2 text-sm" style={{ color: TEXT_SECONDARY }}>
          Loading reputation alerts...
        </div>
      ) : showEmpty ? (
        <div
          className="flex flex-col items-center justify-center rounded-xl px-6 py-12 text-center"
          style={{ border: `1px dashed ${BORDER}`, backgroundColor: "#EDF3F9" }}
        >
          <ShieldAlert className="h-10 w-10" style={{ color: TEXT_MUTED }} aria-hidden />
          <h3 className="mt-4 text-sm font-semibold" style={{ color: TEXT_PRIMARY }}>
            No reputation alerts
          </h3>
          <p className="mt-1 max-w-sm text-sm" style={{ color: TEXT_SECONDARY }}>
            Nothing needs your attention right now. Add a funder or donor above to run a reputation check.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.severity} className="space-y-3">
              {activeTab === "all" && (
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: SEVERITY_COLORS[group.severity] }}
                    aria-hidden
                  />
                  <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: TEXT_SECONDARY }}>
                    {SEVERITY_LABELS[group.severity]} ({group.items.length})
                  </h2>
                </div>
              )}

              <div className="space-y-3">
                {group.items.map((item) => (
                  <div
                    key={item.key}
                    className="flex overflow-hidden rounded-xl"
                    style={{ backgroundColor: CARD_BG, border: `1px solid ${BORDER}`, boxShadow: "0 2px 10px rgba(15,23,42,0.06)" }}
                  >
                    <div
                      className="w-1.5 shrink-0"
                      style={{ backgroundColor: SEVERITY_COLORS[item.severity] }}
                      aria-hidden
                    />
                    <div className="flex flex-1 flex-wrap items-start justify-between gap-4 p-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold" style={{ color: TEXT_PRIMARY }}>
                            {item.entityName}
                          </span>
                          <span
                            className="rounded-full px-2 py-0.5 text-xs font-medium"
                            style={{
                              backgroundColor: `${SEVERITY_COLORS[item.severity]}1A`,
                              color: SEVERITY_COLORS[item.severity],
                            }}
                          >
                            {item.signalType.replace(/_/g, " ")}
                          </span>
                        </div>
                        <p className="mt-1.5 text-sm font-medium" style={{ color: TEXT_PRIMARY }}>
                          {item.headline}
                        </p>
                        {item.summary && (
                          <p className="mt-1 text-sm" style={{ color: TEXT_SECONDARY }}>
                            {item.summary}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs" style={{ color: TEXT_MUTED }}>
                          {item.signalDate && (
                            <span>
                              {new Date(item.signalDate).toLocaleDateString("en-US", {
                                dateStyle: "medium",
                              })}
                            </span>
                          )}
                          {item.sourceUrl && (
                            <a
                              href={item.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 hover:underline"
                              style={{ color: ACCENT }}
                            >
                              Source
                              <ExternalLink className="h-3 w-3" aria-hidden />
                            </a>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={() => handleMarkRead(item)}
                        disabled={dismissing.has(item.key)}
                        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60"
                        style={{ backgroundColor: "#FFFFFF", border: `1px solid ${BORDER}`, color: TEXT_PRIMARY }}
                      >
                        <CheckCircle2 className="h-4 w-4" aria-hidden />
                        {dismissing.has(item.key) ? "Marking…" : "Mark Read"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && items.some((i) => i.severity === "critical") && (
        <div
          className="flex items-center gap-2 rounded-lg px-4 py-3 text-sm"
          style={{ border: `1px solid ${ERROR_BORDER}`, backgroundColor: ERROR_BG, color: ERROR_TEXT }}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          One or more critical reputation risks need attention.
        </div>
      )}
    </div>
  );
}
