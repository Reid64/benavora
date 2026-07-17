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

import { Button, EmptyState, Input, LoadingSpinner, Select } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";

type Severity = "critical" | "high" | "medium" | "low" | "positive";

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "positive"];

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  positive: "Positive",
};

const SEVERITY_COLORS: Record<Severity, string> = {
  critical: "#DC2626",
  high: "#EA580C",
  medium: "#D97706",
  low: "#2563EB",
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

  const grouped = SEVERITY_ORDER.map((severity) => ({
    severity,
    items: items.filter((item) => item.severity === severity),
  })).filter((group) => group.items.length > 0);

  const showEmpty = !loading && !error && items.length === 0;

  return (
    <div className="min-h-screen space-y-6 bg-[#EEF2F7] p-6 page-bg">
      <PageHeader
        title="Reputation Intelligence"
        description="Monitor your funders and donors for reputation risks before investing time in applications."
      />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {editable && (
        <div className="bg-white rounded-xl shadow-sm border border-border p-5">
          <div className="flex items-center gap-2 text-slate-900">
            <Search className="h-5 w-5 text-[#0077B6]" aria-hidden />
            <h3 className="text-base font-semibold text-slate-900">Add Entity to Monitor</h3>
          </div>
          <p className="mt-0.5 text-sm text-slate-500">
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
            <Button type="submit" isLoading={checking}>
              <Search className="h-4 w-4" aria-hidden />
              Check Now
            </Button>
          </form>

          {checkError && <p className="mt-3 text-sm text-red-600">{checkError}</p>}
          {checkNotice && !checkError && (
            <p className="mt-3 text-sm text-slate-500">{checkNotice}</p>
          )}
        </div>
      )}

      {loading ? (
        <LoadingSpinner center label="Loading reputation alerts..." />
      ) : showEmpty ? (
        <EmptyState
          icon={ShieldAlert}
          title="No reputation alerts"
          description="Nothing needs your attention right now. Add a funder or donor above to run a reputation check."
        />
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.severity} className="space-y-3">
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: SEVERITY_COLORS[group.severity] }}
                  aria-hidden
                />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {SEVERITY_LABELS[group.severity]} ({group.items.length})
                </h2>
              </div>

              <div className="space-y-3">
                {group.items.map((item) => (
                  <div
                    key={item.key}
                    className="flex overflow-hidden rounded-xl border border-border bg-white shadow-sm"
                  >
                    <div
                      className="w-1.5 shrink-0"
                      style={{ backgroundColor: SEVERITY_COLORS[item.severity] }}
                      aria-hidden
                    />
                    <div className="flex flex-1 flex-wrap items-start justify-between gap-4 p-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-slate-900">{item.entityName}</span>
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
                        <p className="mt-1.5 text-sm font-medium text-slate-800">
                          {item.headline}
                        </p>
                        {item.summary && (
                          <p className="mt-1 text-sm text-slate-500">{item.summary}</p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
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
                              className="inline-flex items-center gap-1 text-[#0077B6] hover:underline"
                            >
                              Source
                              <ExternalLink className="h-3 w-3" aria-hidden />
                            </a>
                          )}
                        </div>
                      </div>

                      <Button
                        variant="secondary"
                        size="sm"
                        isLoading={dismissing.has(item.key)}
                        onClick={() => handleMarkRead(item)}
                      >
                        <CheckCircle2 className="h-4 w-4" aria-hidden />
                        Mark Read
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !showEmpty && items.some((i) => i.severity === "critical") && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          One or more critical reputation risks need attention.
        </div>
      )}
    </div>
  );
}
