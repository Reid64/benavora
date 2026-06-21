"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Plus, Send, Trash2, Webhook } from "lucide-react";

import { Badge, Button, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

const ALL_EVENTS = [
  { key: "submission_completed", label: "Submission Completed" },
  { key: "submission_failed", label: "Submission Failed" },
  { key: "queue_populated", label: "Queue Populated" },
  { key: "review_needed", label: "Review Needed" },
  { key: "agreement_received", label: "Agreement Received" },
] as const;

const WEBHOOK_TYPES = [
  { value: "slack" as const, label: "Slack" },
  { value: "generic" as const, label: "Custom / Webhook URL" },
];

type WebhookType = "slack" | "generic";

interface WebhookConfig {
  id: string;
  type: WebhookType;
  webhook_url: string;
  events: string[];
  is_active: boolean;
  created_at: string;
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 20 ? u.pathname.slice(0, 12) + "…" : u.pathname;
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return url.length > 50 ? url.slice(0, 47) + "…" : url;
  }
}

export default function WebhooksPage() {
  const [configs, setConfigs] = useState<WebhookConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [formType, setFormType] = useState<WebhookType>("slack");
  const [formUrl, setFormUrl] = useState("");
  const [formEvents, setFormEvents] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [removingId, setRemovingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testedId, setTestedId] = useState<string | null>(null);

  const loadConfigs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/autoapply/webhooks");
      if (!res.ok) {
        setError("Failed to load webhook configurations.");
        return;
      }
      const { configs: data } = (await res.json()) as { configs: WebhookConfig[] };
      setConfigs(data);
    } catch {
      setError("Failed to load webhook configurations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfigs();
  }, [loadConfigs]);

  async function handleAdd() {
    if (!formUrl.trim()) {
      setFormError("Webhook URL is required.");
      return;
    }
    if (formEvents.size === 0) {
      setFormError("Select at least one event.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/autoapply/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: formType,
          webhook_url: formUrl.trim(),
          events: [...formEvents],
        }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFormError(body.error ?? "Failed to save webhook.");
        return;
      }
      setShowAddForm(false);
      setFormUrl("");
      setFormEvents(new Set());
      await loadConfigs();
    } catch {
      setFormError("Failed to save webhook. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    try {
      await fetch(`/api/autoapply/webhooks?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      setConfigs((prev) => prev.filter((c) => c.id !== id));
    } finally {
      setRemovingId(null);
    }
  }

  async function handleToggle(config: WebhookConfig) {
    setTogglingId(config.id);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("webhook_configs")
        .update({ is_active: !config.is_active })
        .eq("id", config.id);
      if (!updateError) {
        setConfigs((prev) =>
          prev.map((c) => (c.id === config.id ? { ...c, is_active: !c.is_active } : c)),
        );
      }
    } finally {
      setTogglingId(null);
    }
  }

  async function handleTest(config: WebhookConfig) {
    setTestingId(config.id);
    setTestedId(null);
    try {
      const payload =
        config.type === "slack"
          ? { text: "🔔 Test notification from Benavora AutoApply" }
          : {
              event: "test",
              source: "benavora_autoapply",
              message: "Test notification from Benavora AutoApply",
              timestamp: new Date().toISOString(),
            };

      await fetch(config.webhook_url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        mode: "no-cors",
      });
      setTestedId(config.id);
      setTimeout(() => setTestedId((prev) => (prev === config.id ? null : prev)), 3000);
    } catch {
      // no-cors fetch won't throw for network errors; this catches other exceptions
    } finally {
      setTestingId(null);
    }
  }

  function toggleEvent(key: string) {
    setFormEvents((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
            Webhook Notifications
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Send real-time notifications to Slack channels or custom endpoints when AutoApply events
            occur.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            setShowAddForm((v) => !v);
            setFormError(null);
          }}
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Add Webhook
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* Add webhook form */}
      {showAddForm && (
        <Card title="New Webhook" description="Configure a URL to receive AutoApply event notifications.">
          <div className="space-y-5">
            {formError && <p className="text-sm text-red-600">{formError}</p>}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="wh-type" className="block text-xs font-medium text-navy-700">
                  Type
                </label>
                <select
                  id="wh-type"
                  value={formType}
                  onChange={(e) => setFormType(e.target.value as WebhookType)}
                  className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-2 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                >
                  {WEBHOOK_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="wh-url" className="block text-xs font-medium text-navy-700">
                  Webhook URL <span className="text-red-500">*</span>
                </label>
                <input
                  id="wh-url"
                  type="url"
                  placeholder={
                    formType === "slack"
                      ? "https://hooks.slack.com/services/…"
                      : "https://your-server.com/webhook"
                  }
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                />
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-navy-700">
                Events to Subscribe <span className="text-red-500">*</span>
              </p>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {ALL_EVENTS.map((ev) => (
                  <label
                    key={ev.key}
                    className="flex cursor-pointer items-center gap-2 text-sm text-navy-700"
                  >
                    <input
                      type="checkbox"
                      checked={formEvents.has(ev.key)}
                      onChange={() => toggleEvent(ev.key)}
                      className="h-3.5 w-3.5 rounded border-navy-300 text-teal-500 focus:ring-teal-400"
                    />
                    {ev.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowAddForm(false);
                  setFormError(null);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void handleAdd()}
                isLoading={saving}
                disabled={saving}
              >
                Save Webhook
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Webhook list */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-navy-400" />
        </div>
      ) : configs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-navy-200 py-16 text-center">
          <Webhook className="mx-auto h-8 w-8 text-navy-300" />
          <p className="mt-3 text-sm font-medium text-navy-600">No webhooks configured</p>
          <p className="mt-1 text-xs text-navy-400">
            Add a webhook above to receive real-time AutoApply notifications.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {configs.map((config) => {
            const isTesting = testingId === config.id;
            const justTested = testedId === config.id;
            const isToggling = togglingId === config.id;
            const isRemoving = removingId === config.id;

            return (
              <div
                key={config.id}
                className="rounded-xl border border-navy-200 bg-white px-5 py-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    {/* Type badge + URL */}
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge color={config.type === "slack" ? "teal" : "gray"}>
                        {config.type === "slack" ? "Slack" : "Custom"}
                      </Badge>
                      <span
                        className="truncate font-mono text-xs text-navy-500"
                        title={config.webhook_url}
                      >
                        {maskUrl(config.webhook_url)}
                      </span>
                    </div>

                    {/* Subscribed events */}
                    <div className="flex flex-wrap gap-1.5">
                      {config.events.map((ev) => {
                        const label =
                          ALL_EVENTS.find((e) => e.key === ev)?.label ?? ev;
                        return (
                          <span
                            key={ev}
                            className="rounded-full bg-navy-50 px-2 py-0.5 text-xs text-navy-600"
                          >
                            {label}
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  {/* Controls */}
                  <div className="flex flex-shrink-0 items-center gap-3">
                    {/* Active toggle */}
                    <button
                      type="button"
                      onClick={() => void handleToggle(config)}
                      disabled={isToggling}
                      aria-label={config.is_active ? "Disable webhook" : "Enable webhook"}
                      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                        config.is_active ? "bg-teal-500" : "bg-navy-200"
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${
                          config.is_active ? "translate-x-4" : "translate-x-0.5"
                        }`}
                      />
                    </button>

                    {/* Test button */}
                    <button
                      type="button"
                      onClick={() => void handleTest(config)}
                      disabled={isTesting || !config.is_active}
                      className="flex items-center gap-1.5 rounded-md border border-navy-200 px-2.5 py-1.5 text-xs font-medium text-navy-600 transition-colors hover:bg-navy-50 disabled:opacity-50"
                    >
                      {justTested ? (
                        <>
                          <CheckCircle2 className="h-3 w-3 text-green-500" />
                          Sent
                        </>
                      ) : isTesting ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Testing…
                        </>
                      ) : (
                        <>
                          <Send className="h-3 w-3" />
                          Test
                        </>
                      )}
                    </button>

                    {/* Remove */}
                    <button
                      type="button"
                      onClick={() => void handleRemove(config.id)}
                      disabled={isRemoving}
                      aria-label="Remove webhook"
                      className="text-navy-300 transition-colors hover:text-red-500 disabled:opacity-50"
                    >
                      {isRemoving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Info note */}
      <div className="rounded-lg border border-navy-100 bg-navy-50 px-4 py-3 text-xs text-navy-500">
        <strong className="text-navy-700">Note:</strong> Webhook payloads include the event type,
        organization ID, and relevant entity data. Slack webhooks receive a{" "}
        <code className="rounded bg-navy-100 px-1 py-0.5">text</code> field formatted for display.
        Custom webhooks receive a structured JSON object. The Test button sends a sample payload
        immediately; disable a webhook to pause notifications without deleting the configuration.
      </div>
    </div>
  );
}
